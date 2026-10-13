/* ============================================================
   NGUMZO — /api/stats
   ------------------------------------------------------------
   Tiny, privacy-respecting analytics counter.

   What it counts:
     - opens         (every app load)
     - rooms_created (every "New Room" tap)
     - messages_sent (every send)

   What it NEVER records:
     - message content (impossible anyway — server only sees ciphertext)
     - who sent what
     - which user is in which room
     - room codes
     - IP addresses
     - persistent user identifiers

   Storage is in-memory only — counts reset whenever Vercel restarts
   the function. That's fine for now: this is a directional indicator
   for the launch phase, not an audit log. If we need persistence
   later we add a tiny database; today we don't.

   View counts:  GET /api/stats?key=<ADMIN_KEY>
   Increment:    POST /api/stats  with { event: "open" | "room_created" | "message_sent" }
   ============================================================ */

// Vercel serverless functions are stateless across cold starts, but warm
// instances retain memory. Counts here are best-effort and may reset.
const ADMIN_KEY = process.env.NGUMZO_STATS_KEY || "phoenix-ngumzo-2026";

// Live Keystone URL (keystone.riakoine.com)
const KEYSTONE_URL = "https://keystone.riakoine.com/api/keystone";

// module-level counter survives within a single warm instance
const counts = (globalThis.__ngumzo_counts ||= {
  opens: 0,
  rooms_created: 0,
  messages_sent: 0,
  since: new Date().toISOString(),
});

/**
 * Verify admin access via Bearer token or legacy API key
 * @param {Request|Object} req - Request object (Vercel or Cloudflare format)
 * @returns {Promise<boolean>} - true if authorized
 */
async function verifyAdminAccess(req) {
  // Try Bearer token first
  const authHeader =
    req.headers?.get?.("authorization") || req.headers?.authorization || "";

  if (authHeader && authHeader.toLowerCase().startsWith("bearer ")) {
    const token = authHeader.substring(7);

    try {
      const response = await fetch(`${KEYSTONE_URL}?action=verify`, {
        method: "GET",
        headers: {
          "x-keystone-token": token,
          Origin: "https://keystone.riakoine.com",
        },
      });

      if (response.ok) {
        const data = await response.json();
        // Only allow admin role (live Keystone returns user.role)
        return data.ok && data.user?.role === "admin";
      }
    } catch (e) {
      // Token verification failed, fall through to legacy key
    }
  }

  // Fall back to legacy API key
  const key = (req.query && req.query.key) || "";
  return key === ADMIN_KEY;
}

export default async function handler(req, res) {
  if (req.method === "POST") {
    try {
      const { event } = req.body || {};
      if (event === "open") counts.opens++;
      else if (event === "room_created") counts.rooms_created++;
      else if (event === "message_sent") counts.messages_sent++;
      // unknown events are silently ignored — no error feedback to clients
      res.status(204).end();
    } catch (e) {
      res.status(204).end(); // never let analytics break the app
    }
    return;
  }

  if (req.method === "GET") {
    // Verify admin access (Bearer token or legacy API key)
    const isAuthorized = await verifyAdminAccess(req);
    if (!isAuthorized) {
      res.status(404).end(); // hide the endpoint from casual snooping
      return;
    }

    // Basic counts (in-memory)
    const result = { ...counts };

    // Add pilot stats if available (via edge function)
    try {
      const pilotStats = await fetch(
        req.headers.host.startsWith("localhost")
          ? "http://localhost:8788/api/_pilot-stats"
          : `https://${req.headers.host}/api/_pilot-stats`,
        {
          headers: { "X-Admin-Key": ADMIN_KEY },
        },
      );
      if (pilotStats.ok) {
        result.pilot = await pilotStats.json();
      }
    } catch (e) {
      // Pilot stats unavailable (expected if not deployed or no bindings)
    }

    res.status(200).json(result);
    return;
  }

  res.status(405).end();
}
