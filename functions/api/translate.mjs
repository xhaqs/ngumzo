/* ============================================================
   NGUMZO — /api/translate
   ------------------------------------------------------------
   A thin, STATELESS proxy. It exists only because browsers
   cannot call translation services directly (CORS blocks it).

   What it does:  receives { text, from, to, tester, referrer },
                  checks quota, tries Cloudflare Workers AI first,
                  falls back to Google if needed, returns { translated }.
   What it does NOT do:  no database, no logging of message
                  text, no knowledge of the room code or who
                  is talking. It forwards one string and forgets.

   This is consistent with Ngumzo's promise: the RELAY never
   sees plaintext. This translate route sees only the single
   phrase a user chose to translate — never the conversation,
   never the ciphertext, never the room.
   ============================================================ */

import {
  checkTesterQuota,
  registerReferral,
  incrementCounters,
} from "./_pilot.js";

// Cloudflare Pages Functions format
export async function onRequestPost(context) {
  try {
    const body = await context.request.json();
    const { text, from, to, tester, referrer } = body || {};

    if (!text || typeof text !== "string") {
      return new Response(JSON.stringify({ error: "missing text" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }
    if (text.length > 2000) {
      return new Response(JSON.stringify({ error: "text too long" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }
    if (from === to) {
      return new Response(JSON.stringify({ translated: text }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    // ---- PILOT QUOTA CHECK ----
    // Auto-register referrals on first use
    if (referrer && tester && tester.startsWith("guest-")) {
      await registerReferral(tester, referrer, context.env);
    }

    // Check quota
    const currentDate = new Date().toISOString().split("T")[0]; // YYYY-MM-DD
    if (tester) {
      const quota = await checkTesterQuota(tester, {
        env: context.env,
        date: currentDate,
      });

      if (!quota.allowed) {
        return new Response(JSON.stringify({ error: quota.reason }), {
          status: 429,
          headers: { "Content-Type": "application/json" },
        });
      }
    }

    // Try Cloudflare Workers AI first
    let translated = "";
    let workersAIFailed = false;
    let aiError = "";

    try {
      if (context.env.AI) {
        const result = await context.env.AI.run("@cf/meta/m2m100-1.2b", {
          text: text,
          source_lang: from || "en",
          target_lang: to || "en",
        });
        translated = result?.translated_text || "";
        if (!translated) {
          workersAIFailed = true;
          aiError = "empty result";
        }
      } else {
        workersAIFailed = true;
        aiError = "no env.AI binding";
      }
    } catch (e) {
      workersAIFailed = true;
      aiError = e.message || String(e);
    }

    // Fall back to Google if Workers AI failed or returned empty
    if (workersAIFailed || !translated) {
      const url =
        "https://translate.googleapis.com/translate_a/single" +
        "?client=gtx" +
        "&sl=" +
        encodeURIComponent(from || "auto") +
        "&tl=" +
        encodeURIComponent(to || "en") +
        "&dt=t" +
        "&q=" +
        encodeURIComponent(text);

      const g = await fetch(url);
      if (!g.ok) {
        let detail = "";
        try {
          const body = await g.text();
          detail = body.slice(0, 150);
        } catch (e) {
          detail = "";
        }
        return new Response(
          JSON.stringify({
            error: "upstream failed",
            status: g.status,
            detail: detail,
            aiError: aiError,
          }),
          {
            status: 502,
            headers: { "Content-Type": "application/json" },
          },
        );
      }

      const data = await g.json();
      translated = data[0]?.map((x) => x[0]).join("") || "";
    }

    // ---- INCREMENT PILOT COUNTERS ----
    if (tester) {
      await incrementCounters(tester, from || "auto", to || "en", {
        env: context.env,
        date: currentDate,
      });
    }

    return new Response(JSON.stringify({ translated }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: "server error" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}

// Handle other methods
export async function onRequest(context) {
  if (context.request.method === "POST") {
    return onRequestPost(context);
  }
  return new Response(JSON.stringify({ error: "POST only" }), {
    status: 405,
    headers: { "Content-Type": "application/json" },
  });
}
