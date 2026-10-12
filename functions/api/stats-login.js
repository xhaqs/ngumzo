/* ============================================================
   NGUMZO — /api/stats-login
   ------------------------------------------------------------
   Server-side proxy to Keystone authentication.

   POST { userId, password } -> forwards to Keystone /login
   Returns { token, userId, name, role, apps, expiresAt }

   Never logs passwords. Server-side only to avoid CORS issues.
   ============================================================ */

// Keystone API URL - configurable via environment variable
const KEYSTONE_URL =
  typeof process !== "undefined" && process.env.KEYSTONE_URL
    ? process.env.KEYSTONE_URL
    : "https://keystone-api.riakoine.workers.dev";

export async function onRequestPost(context) {
  try {
    const body = await context.request.json();

    // Validate required fields (never log passwords)
    if (!body.userId || !body.password) {
      return new Response(
        JSON.stringify({ error: "Missing userId or password" }),
        {
          status: 400,
          headers: { "Content-Type": "application/json" },
        },
      );
    }

    // Forward to Keystone /login
    const response = await fetch(`${KEYSTONE_URL}/login`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        userId: body.userId,
        password: body.password,
      }),
    });

    // Forward the response from Keystone
    const data = await response.json();

    return new Response(JSON.stringify(data), {
      status: response.status,
      headers: { "Content-Type": "application/json" },
    });
  } catch (error) {
    return new Response(
      JSON.stringify({ error: "Login failed", detail: error.message }),
      {
        status: 500,
        headers: { "Content-Type": "application/json" },
      },
    );
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
