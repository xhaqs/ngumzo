/* ============================================================
   NGUMZO — Pilot Quota System
   ------------------------------------------------------------
   Single-responsibility module: decide if a translation request
   is allowed based on tester quotas.

   Input:  tester name, context (env, date)
   Output: { allowed: boolean, reason: string, testerType: string }

   Reasons:
   - "ok"              → allowed
   - "daily_limit"     → hit daily quota
   - "trial_ended"     → trial period expired
   - "global_cap"      → circuit-breaker hit
   - "not_found"       → no tester/referral found
   - "disabled"        → pilot system disabled
   - "invite_required" → Keystone gate requires invite (useGate mode)
   - "app_off"         → Keystone gate app disabled (useGate mode)
   - "gate_unavailable"→ Keystone gate error (useGate mode)

   Design:
   This is the ONLY place that checks quotas. Later, Keystone
   can replace the internals without touching translate.js or app.js.
   ============================================================ */

// In-memory cache for gate results (60 second TTL)
const gateCache = new Map();
const GATE_CACHE_TTL = 60 * 1000; // 60 seconds

// Keystone gate URL
const KEYSTONE_GATE_URL =
  "https://keystone.riakoine.com/api/keystone?action=gate&app=ngumzo";

/**
 * Check Keystone gate with caching.
 * @param {string} inviteCode - Tester invite code
 * @returns {Promise<{allowed: boolean, reason: string}>}
 */
async function checkKeystoneGate(inviteCode) {
  const codePrefix = inviteCode.slice(0, 4); // Only log first 4 chars

  // Check cache first
  const cached = gateCache.get(inviteCode);
  if (cached && Date.now() < cached.expiresAt) {
    return { allowed: cached.allowed, reason: cached.reason };
  }

  try {
    const response = await fetch(
      `${KEYSTONE_GATE_URL}&invite=${encodeURIComponent(inviteCode)}`,
      {
        headers: {
          Origin: "https://ngumzo.pages.dev",
        },
      },
    );

    if (!response.ok) {
      console.error(
        `Gate check failed for ${codePrefix}...: HTTP ${response.status}`,
      );
      // Fail closed: deny access if gate is down
      return { allowed: false, reason: "gate_unavailable" };
    }

    const data = await response.json();

    if (!data.ok) {
      console.error(`Gate returned error for ${codePrefix}...:`, data.error);
      return { allowed: false, reason: "gate_unavailable" };
    }

    // Map gate reasons to friendly messages
    let reason = data.reason;
    if (!data.allowed) {
      // Keep the specific gate reasons: invite_required, app_off, gate_unavailable
      if (
        data.reason === "invite_required" ||
        data.reason === "app_off" ||
        data.reason === "gate_unavailable"
      ) {
        reason = data.reason;
      } else {
        // Default to invite_required for other denial reasons
        reason = "invite_required";
      }
    }

    // Cache the result (only cache allowed=true for 60 seconds)
    if (data.allowed) {
      gateCache.set(inviteCode, {
        allowed: true,
        reason: reason,
        expiresAt: Date.now() + GATE_CACHE_TTL,
      });
    }

    return { allowed: data.allowed, reason: reason };
  } catch (error) {
    console.error(`Gate check exception for ${codePrefix}...:`, error.message);
    // Fail closed: deny access on network/parse errors
    return { allowed: false, reason: "gate_unavailable" };
  }
}

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

    // Normalize invite code to uppercase (for config lookup and gate check)
    const normalizedName = name.toUpperCase();

    // Check global daily cap (circuit-breaker)
    const globalCount = await getGlobalDailyCount(env.PILOT_DB, date);
    if (config.globalDailyCap && globalCount >= config.globalDailyCap) {
      return { allowed: false, reason: "global_cap", testerType: "none" };
    }

    // Check if this is a known tester in config (skip gate for config testers)
    const tester = config.testers[normalizedName];
    if (tester) {
      // Named tester from config - unlimited access if limit is 0
      const allowed = await checkTesterLimits(
        env.PILOT_DB,
        normalizedName,
        tester,
        date,
      );
      return {
        allowed: allowed.ok,
        reason: allowed.reason,
        testerType: "tester",
      };
    }

    // ---- KEYSTONE GATE CHECK (if useGate is enabled) ----
    if (config.useGate === true) {
      // Skip gate check for guest IDs (referrals) - they're validated via referrer
      if (!name.startsWith("guest-")) {
        const gateResult = await checkKeystoneGate(normalizedName);

        if (!gateResult.allowed) {
          return {
            allowed: false,
            reason: gateResult.reason,
            testerType: "none",
          };
        }

        // Gate allowed - continue with quota checks below
      }
    }

    // Check if this is a tester in the database
    const dbTester = await getTesterInfo(env.PILOT_DB, normalizedName);
    if (dbTester && dbTester.type === "tester") {
      // Auto-registered tester from D1
      const limits = config.testerDefaults || { limit: 100, days: 30 };
      const allowed = await checkTesterLimits(
        env.PILOT_DB,
        normalizedName,
        {
          limit: limits.limit,
          days: limits.days,
          startDate: new Date(dbTester.first_seen).toISOString().split("T")[0],
        },
        date,
      );
      return {
        allowed: allowed.ok,
        reason: allowed.reason,
        testerType: "tester",
      };
    }

    // Check if this is a referral (guest) in the database
    if (dbTester && dbTester.type === "referral") {
      const limits = config.referralDefaults || { limit: 20, days: 14 };
      const allowed = await checkTesterLimits(
        env.PILOT_DB,
        normalizedName,
        {
          limit: limits.limit,
          days: limits.days,
          startDate: new Date(dbTester.first_seen).toISOString().split("T")[0],
        },
        date,
      );
      return {
        allowed: allowed.ok,
        reason: allowed.reason,
        testerType: "referral",
      };
    }

    // Auto-register new tester if allowed
    if (config.useGate === true) {
      // When useGate is true, only register if gate check passed above
      // Guests (guest-*) should NOT auto-register - they must be registered via referral
      if (name.startsWith("guest-")) {
        // Guest not in DB and no referral registration - deny
        return { allowed: false, reason: "not_found", testerType: "none" };
      }

      if (!isValidInviteCode(normalizedName)) {
        return { allowed: false, reason: "not_found", testerType: "none" };
      }

      // If we reach here, gate check passed and tester is not in DB
      // Register them now (first allowed use)
      const limits = config.testerDefaults || { limit: 100, days: 30 };
      await registerTester(normalizedName, env.PILOT_DB, limits);

      // Allow this first request
      return { allowed: true, reason: "ok", testerType: "tester" };
    } else if (config.autoRegisterTesters !== false) {
      // Legacy auto-register mode (when useGate is false)
      if (!isValidTesterName(name)) {
        // Invalid name - reject with not_found
        return { allowed: false, reason: "not_found", testerType: "none" };
      }

      // Register the tester
      const limits = config.testerDefaults || { limit: 100, days: 30 };
      await registerTester(name, env.PILOT_DB, limits);

      // Allow this first request
      return { allowed: true, reason: "ok", testerType: "tester" };
    }

    // Not found
    return { allowed: false, reason: "not_found", testerType: "none" };
  } catch (e) {
    // When useGate is enabled, fail closed for safety
    // Otherwise fail open to avoid breaking Ngumzo
    console.error("Pilot quota check error:", e);

    try {
      const configJson = await env.PILOT_CONFIG.get("pilot:config");
      if (configJson) {
        const config = JSON.parse(configJson);
        if (config.useGate === true) {
          // Fail closed in gate mode
          return {
            allowed: false,
            reason: "gate_unavailable",
            testerType: "none",
          };
        }
      }
    } catch (innerE) {
      // If we can't even read config, fail open
    }

    return { allowed: true, reason: "ok", testerType: "none" };
  }
}

/**
 * Register a new referral guest.
 * @param {string} guestId - Random device ID
 * @param {string} referrer - Tester name who shared the link
 * @param {object} env - Cloudflare env with PILOT_CONFIG and PILOT_DB bindings
 */
export async function registerReferral(guestId, referrer, env) {
  if (!env.PILOT_DB || !env.PILOT_CONFIG) return;

  try {
    // Normalize referrer code to uppercase
    const normalizedReferrer = referrer.toUpperCase();

    // Read config
    const configJson = await env.PILOT_CONFIG.get("pilot:config");
    if (!configJson) return;

    const config = JSON.parse(configJson);

    // When useGate is true, validate referrer code through gate first
    if (config.useGate === true) {
      const gateResult = await checkKeystoneGate(normalizedReferrer);
      if (!gateResult.allowed) {
        // Referrer code is not valid, don't register guest
        const codePrefix = normalizedReferrer.slice(0, 4);
        console.log(
          `Referral rejected: referrer ${codePrefix}... not allowed by gate`,
        );
        return;
      }
      // Gate allowed - continue with registration
    } else {
      // Legacy mode: verify referrer exists in config or D1
      const isConfigTester =
        config.testers && config.testers[normalizedReferrer];
      const dbTester = await getTesterInfo(env.PILOT_DB, normalizedReferrer);
      const isDbTester = dbTester && dbTester.type === "tester";

      if (!isConfigTester && !isDbTester) {
        // Referrer is not a valid tester, don't register
        return;
      }
    }

    const now = Date.now();
    await env.PILOT_DB.prepare(
      `INSERT OR IGNORE INTO testers (name, type, referrer, first_seen, last_seen, total_translations)
       VALUES (?, 'referral', ?, ?, ?, 0)`,
    )
      .bind(guestId, normalizedReferrer, now, now)
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
    // Normalize invite codes to uppercase (but not guest IDs)
    const normalizedName = name.startsWith("guest-")
      ? name
      : name.toUpperCase();

    const now = Date.now();
    const db = env.PILOT_DB;

    // Increment daily count
    await db
      .prepare(
        `INSERT INTO daily_counts (date, tester, count) VALUES (?, ?, 1)
         ON CONFLICT(date, tester) DO UPDATE SET count = count + 1`,
      )
      .bind(date, normalizedName)
      .run();

    // Update tester stats
    await db
      .prepare(
        `INSERT INTO testers (name, type, referrer, first_seen, last_seen, total_translations)
         VALUES (?, 'tester', NULL, ?, ?, 1)
         ON CONFLICT(name) DO UPDATE SET last_seen = ?, total_translations = total_translations + 1`,
      )
      .bind(normalizedName, now, now, now)
      .run();

    // Increment language pair count
    await db
      .prepare(
        `INSERT INTO lang_pairs (tester, from_lang, to_lang, count) VALUES (?, ?, ?, 1)
         ON CONFLICT(tester, from_lang, to_lang) DO UPDATE SET count = count + 1`,
      )
      .bind(normalizedName, fromLang, toLang)
      .run();
  } catch (e) {
    console.error("Failed to increment counters:", e);
  }
}

// ---- Internal helpers ----

function isValidInviteCode(code) {
  // Must match ^[A-Z0-9-]{4,64}$
  const regex = /^[A-Z0-9-]{4,64}$/;
  return regex.test(code);
}

function isValidTesterName(name) {
  // Must match ^[a-z0-9-]{3,32}$ (legacy mode only)
  const regex = /^[a-z0-9-]{3,32}$/;
  return regex.test(name);
}

async function getTesterInfo(db, name) {
  try {
    return await db
      .prepare(`SELECT * FROM testers WHERE name = ?`)
      .bind(name)
      .first();
  } catch (e) {
    return null;
  }
}

async function registerTester(name, db, limits) {
  try {
    const now = Date.now();
    await db
      .prepare(
        `INSERT OR IGNORE INTO testers (name, type, referrer, first_seen, last_seen, total_translations)
         VALUES (?, 'tester', NULL, ?, ?, 0)`,
      )
      .bind(name, now, now)
      .run();
  } catch (e) {
    console.error("Failed to register tester:", e);
  }
}

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
