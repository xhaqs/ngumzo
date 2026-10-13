/* ============================================================
   NGUMZO — /api/stats-login
   ------------------------------------------------------------
   Server-side proxy to live Keystone authentication.

   POST { password } -> forwards to Keystone with app="ngumzo"
   Returns { ok, token, user: { userId, name, role, apps } }

   Never logs passwords. Server-side only to avoid CORS issues.
   ============================================================ */

// Live Keystone URL (keystone.riakoine.com)
const KEYSTONE_URL = "https://keystone.riakoine.com/api/keystone";

export async function onRequestPost(context) {
  try {
    const body = await context.request.json();

    // Validate required field (never log password/master phrase)
    if (!body.password) {
      return new Response(
        JSON.stringify({ ok: false, error: "PASSWORD_REQUIRED" }),
        {
          status: 400,
          headers: { "Content-Type": "application/json" },
        },
      );
    }

    // Forward to live Keystone login endpoint
    const response = await fetch(`${KEYSTONE_URL}?action=login`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: "https://keystone.riakoine.com",
      },
      body: JSON.stringify({
        password: body.password,
        app: "ngumzo",
      }),
    });

    // Forward the response from Keystone
    const data = await response.json();

    return new Response(JSON.stringify(data), {
      status: response.status,
      headers: { "Content-Type": "application/json" },
    });
  } catch (error) {
    return new Response(JSON.stringify({ ok: false, error: "LOGIN_FAILED" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}

export async function onRequest(context) {
  if (context.request.method === "POST") {
    return onRequestPost(context);
  }
  return new Response(JSON.stringify({ error: "POST only" }), {
    status: 405,
    headers: { "Content-Type": "application/json" },
  });
}
