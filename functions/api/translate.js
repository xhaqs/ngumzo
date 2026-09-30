/* ============================================================
   NGUMZO — /api/translate
   ------------------------------------------------------------
   A thin, STATELESS proxy. It exists only because browsers
   cannot call Google Translate directly (CORS blocks it).

   What it does:  receives { text, from, to }, asks Google,
                  returns { translated }.
   What it does NOT do:  no database, no logging of message
                  text, no knowledge of the room code or who
                  is talking. It forwards one string and forgets.

   This is consistent with Ngumzo's promise: the RELAY never
   sees plaintext. This translate route sees only the single
   phrase a user chose to translate — never the conversation,
   never the ciphertext, never the room.
   ============================================================ */

// Cloudflare Pages Functions format
export async function onRequestPost(context) {
  try {
    const body = await context.request.json();
    const { text, from, to } = body || {};

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

    // Google's free translate endpoint (the one the web widget uses).
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
      return new Response(JSON.stringify({ error: "upstream failed" }), {
        status: 502,
        headers: { "Content-Type": "application/json" },
      });
    }

    const data = await g.json();
    const translated = data[0]?.map((x) => x[0]).join("") || "";

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
