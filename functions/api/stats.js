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

// module-level counter survives within a single warm instance
const counts = (globalThis.__ngumzo_counts ||= {
  opens: 0,
  rooms_created: 0,
  messages_sent: 0,
  since: new Date().toISOString()
});

export default function handler(req, res) {
  if (req.method === "POST") {
    try {
      const { event } = req.body || {};
      if (event === "open")          counts.opens++;
      else if (event === "room_created") counts.rooms_created++;
      else if (event === "message_sent") counts.messages_sent++;
      // unknown events are silently ignored — no error feedback to clients
      res.status(204).end();
    } catch (e) {
      res.status(204).end();   // never let analytics break the app
    }
    return;
  }

  if (req.method === "GET") {
    const key = (req.query && req.query.key) || "";
    if (key !== ADMIN_KEY) {
      res.status(404).end();   // hide the endpoint from casual snooping
      return;
    }
    res.status(200).json(counts);
    return;
  }

  res.status(405).end();
}
