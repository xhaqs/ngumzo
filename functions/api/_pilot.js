/* ============================================================
   NGUMZO — Pilot Quota System
   ------------------------------------------------------------
   Single-responsibility module: decide if a translation request
   is allowed based on tester quotas.

   Input:  tester name, context (env, date)
   Output: { allowed: boolean, reason: string, testerType: string }

   Reasons:
   - "ok"           → allowed
   - "daily_limit"  → hit daily quota
   - "trial_ended"  → trial period expired
   - "global_cap"   → circuit-breaker hit
   - "not_found"    → no tester/referral found
   - "disabled"     → pilot system disabled

   Design:
   This is the ONLY place that checks quotas. Later, Keystone
   can replace the internals without touching translate.js or app.js.
   ============================================================ */

/**
 * Check if a tester is allowed to translate.
 * @param {string} name - Tester name or guest device ID
 * @param {object} context - { env, date } where env has PILOT_CONFIG and PILOT_DB bindings
 * @returns {Promise<{allowed: boolean, reason: string, testerType: string}>}
 */
export async function checkTesterQuota(name, context) {
  const { env, date } = context;

  // Safe rollout: if no bindings or config disabled, allow everything
  if (!env.PILOT_CONFIG || !env.PILOT_DB) {
    return { allowed: true, reason: "ok", testerType: "none" };
  }

  try {
    // Read config from KV
    const configJson = await env.PILOT_CONFIG.get("pilot:config");
    if (!configJson) {
      return { allowed: true, reason: "ok", testerType: "none" };
    }

    const config = JSON.parse(configJson);
    if (!config.enabled) {
      return { allowed: true, reason: "ok", testerType: "none" };
    }

    // Check global daily cap (circuit-breaker)
    const globalCount = await getGlobalDailyCount(env.PILOT_DB, date);
    if (config.globalDailyCap && globalCount >= config.globalDailyCap) {
      return { allowed: false, reason: "global_cap", testerType: "none" };
    }

    // Check if this is a known tester
    const tester = config.testers[name];
    if (tester) {
      // Named tester
      const allowed = await checkTesterLimits(env.PILOT_DB, name, tester, date);
      return {
        allowed: allowed.ok,
        reason: allowed.reason,
        testerType: "tester",
      };
    }

    // Check if this is a referral (guest) in the database
    const guest = await getGuestInfo(env.PILOT_DB, name);
    if (guest) {
      const limits = config.referralDefaults || { limit: 20, days: 14 };
      const allowed = await checkTesterLimits(
        env.PILOT_DB,
        name,
        {
          limit: limits.limit,
          days: limits.days,
          startDate: new Date(guest.first_seen).toISOString().split("T")[0],
        },
        date,
      );
      return {
        allowed: allowed.ok,
        reason: allowed.reason,
        testerType: "referral",
      };
    }

    // Not found
    return { allowed: false, reason: "not_found", testerType: "none" };
  } catch (e) {
    // On error, fail open (allow) to avoid breaking Ngumzo
    console.error("Pilot quota check error:", e);
    return { allowed: true, reason: "ok", testerType: "none" };
  }
}

/**
 * Register a new referral guest.
 * @param {string} guestId - Random device ID
 * @param {string} referrer - Tester name who shared the link
 * @param {object} env - Cloudflare env with PILOT_DB binding
 */
export async function registerReferral(guestId, referrer, env) {
  if (!env.PILOT_DB) return;

  try {
    const now = Date.now();
    await env.PILOT_DB.prepare(
      `INSERT OR IGNORE INTO testers (name, type, referrer, first_seen, last_seen, total_translations)
       VALUES (?, 'referral', ?, ?, ?, 0)`,
    )
      .bind(guestId, referrer, now, now)
      .run();
  } catch (e) {
    console.error("Failed to register referral:", e);
  }
}

/**
 * Increment translation counters.
 * @param {string} name - Tester or guest ID
 * @param {string} fromLang - Source language code
 * @param {string} toLang - Target language code
 * @param {object} context - { env, date }
 */
export async function incrementCounters(name, fromLang, toLang, context) {
  const { env, date } = context;
  if (!env.PILOT_DB) return;

  try {
    const now = Date.now();
    const db = env.PILOT_DB;

    // Increment daily count
    await db
      .prepare(
        `INSERT INTO daily_counts (date, tester, count) VALUES (?, ?, 1)
         ON CONFLICT(date, tester) DO UPDATE SET count = count + 1`,
      )
      .bind(date, name)
      .run();

    // Update tester stats
    await db
      .prepare(
        `INSERT INTO testers (name, type, referrer, first_seen, last_seen, total_translations)
         VALUES (?, 'tester', NULL, ?, ?, 1)
         ON CONFLICT(name) DO UPDATE SET last_seen = ?, total_translations = total_translations + 1`,
      )
      .bind(name, now, now, now)
      .run();

    // Increment language pair count
    await db
      .prepare(
        `INSERT INTO lang_pairs (tester, from_lang, to_lang, count) VALUES (?, ?, ?, 1)
         ON CONFLICT(tester, from_lang, to_lang) DO UPDATE SET count = count + 1`,
      )
      .bind(name, fromLang, toLang)
      .run();
  } catch (e) {
    console.error("Failed to increment counters:", e);
  }
}

// ---- Internal helpers ----

async function getGlobalDailyCount(db, date) {
  try {
    const result = await db
      .prepare(`SELECT SUM(count) as total FROM daily_counts WHERE date = ?`)
      .bind(date)
      .first();
    return result?.total || 0;
  } catch (e) {
    return 0;
  }
}

async function getGuestInfo(db, guestId) {
  try {
    return await db
      .prepare(`SELECT * FROM testers WHERE name = ? AND type = 'referral'`)
      .bind(guestId)
      .first();
  } catch (e) {
    return null;
  }
}

async function checkTesterLimits(db, name, config, currentDate) {
  // Unlimited access if limit is 0
  if (config.limit === 0) {
    return { ok: true, reason: "ok" };
  }

  // Check trial expiry
  if (config.days > 0 && config.startDate) {
    const start = new Date(config.startDate);
    const current = new Date(currentDate);
    const daysSinceStart = Math.floor(
      (current - start) / (1000 * 60 * 60 * 24),
    );
    if (daysSinceStart >= config.days) {
      return { ok: false, reason: "trial_ended" };
    }
  }

  // Check daily limit
  try {
    const result = await db
      .prepare(`SELECT count FROM daily_counts WHERE date = ? AND tester = ?`)
      .bind(currentDate, name)
      .first();
    const todayCount = result?.count || 0;
    if (todayCount >= config.limit) {
      return { ok: false, reason: "daily_limit" };
    }
  } catch (e) {
    // On error, allow (fail open)
    return { ok: true, reason: "ok" };
  }

  return { ok: true, reason: "ok" };
}
