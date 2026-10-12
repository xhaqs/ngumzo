/* ============================================================
   NGUMZO — Pilot Stats (internal endpoint)
   ------------------------------------------------------------
   Returns anonymous aggregates from the pilot database:
   - Total testers and referrals
   - Daily translation counts
   - Top language pairs
   - Referral attribution

   Never returns message content or user identities.
   Requires X-Admin-Key header matching NGUMZO_STATS_KEY.
   ============================================================ */

const ADMIN_KEY =
  typeof process !== "undefined"
    ? process.env.NGUMZO_STATS_KEY || "phoenix-ngumzo-2026"
    : "phoenix-ngumzo-2026";

export async function onRequestGet(context) {
  // Verify admin key
  const key = context.request.headers.get("X-Admin-Key") || "";
  if (key !== ADMIN_KEY) {
    return new Response(JSON.stringify({ error: "unauthorized" }), {
      status: 404,
      headers: { "Content-Type": "application/json" },
    });
  }

  // If no D1 binding, return empty stats
  if (!context.env.PILOT_DB) {
    return new Response(
      JSON.stringify({ enabled: false, reason: "no database binding" }),
      {
        status: 200,
        headers: { "Content-Type": "application/json" },
      },
    );
  }

  try {
    const db = context.env.PILOT_DB;
    const today = new Date().toISOString().split("T")[0];

    // Total testers by type
    const testerCounts = await db
      .prepare(`SELECT type, COUNT(*) as count FROM testers GROUP BY type`)
      .all();

    // Today's translation count
    const todayCount = await db
      .prepare(`SELECT SUM(count) as total FROM daily_counts WHERE date = ?`)
      .bind(today)
      .first();

    // Total translations ever
    const totalCount = await db
      .prepare(`SELECT SUM(total_translations) as total FROM testers`)
      .first();

    // Top 10 language pairs
    const topPairs = await db
      .prepare(
        `SELECT from_lang, to_lang, SUM(count) as total
         FROM lang_pairs
         GROUP BY from_lang, to_lang
         ORDER BY total DESC
         LIMIT 10`,
      )
      .all();

    // Referral leaderboard (who has the most referrals)
    const referrers = await db
      .prepare(
        `SELECT referrer, COUNT(*) as count
         FROM testers
         WHERE type = 'referral' AND referrer IS NOT NULL
         GROUP BY referrer
         ORDER BY count DESC
         LIMIT 10`,
      )
      .all();

    // Recent activity (last 7 days)
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
      .toISOString()
      .split("T")[0];
    const recentActivity = await db
      .prepare(
        `SELECT date, SUM(count) as total
         FROM daily_counts
         WHERE date >= ?
         GROUP BY date
         ORDER BY date DESC`,
      )
      .bind(sevenDaysAgo)
      .all();

    return new Response(
      JSON.stringify({
        enabled: true,
        testers: testerCounts.results || [],
        today: todayCount?.total || 0,
        total: totalCount?.total || 0,
        topLanguagePairs: topPairs.results || [],
        topReferrers: referrers.results || [],
        last7Days: recentActivity.results || [],
      }),
      {
        status: 200,
        headers: { "Content-Type": "application/json" },
      },
    );
  } catch (error) {
    return new Response(
      JSON.stringify({ error: "database error", detail: error.message }),
      {
        status: 500,
        headers: { "Content-Type": "application/json" },
      },
    );
  }
}

export async function onRequest(context) {
  if (context.request.method === "GET") {
    return onRequestGet(context);
  }
  return new Response(JSON.stringify({ error: "GET only" }), {
    status: 405,
    headers: { "Content-Type": "application/json" },
  });
}
