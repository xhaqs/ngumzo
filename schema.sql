-- Ngumzo Pilot Database Schema (Cloudflare D1)
-- Stores anonymous usage counts and tester metadata only.
-- Never stores message content, room codes, or user identities.

-- Daily translation counts per tester
CREATE TABLE IF NOT EXISTS daily_counts (
  date TEXT NOT NULL,           -- YYYY-MM-DD format
  tester TEXT NOT NULL,         -- tester name or guest device ID
  count INTEGER DEFAULT 0,
  PRIMARY KEY (date, tester)
);

-- Tester and referral metadata
CREATE TABLE IF NOT EXISTS testers (
  name TEXT PRIMARY KEY,        -- tester name or guest device ID
  type TEXT NOT NULL,           -- 'tester' or 'referral'
  referrer TEXT,                -- NULL for testers, tester name for referrals
  first_seen INTEGER NOT NULL,  -- timestamp (ms)
  last_seen INTEGER NOT NULL,   -- timestamp (ms)
  total_translations INTEGER DEFAULT 0
);

-- Language pair usage (anonymous aggregates)
CREATE TABLE IF NOT EXISTS lang_pairs (
  tester TEXT NOT NULL,
  from_lang TEXT NOT NULL,
  to_lang TEXT NOT NULL,
  count INTEGER DEFAULT 0,
  PRIMARY KEY (tester, from_lang, to_lang)
);

-- Indexes for efficient queries
CREATE INDEX IF NOT EXISTS idx_daily_counts_date ON daily_counts(date);
CREATE INDEX IF NOT EXISTS idx_testers_type ON testers(type);
CREATE INDEX IF NOT EXISTS idx_testers_referrer ON testers(referrer);
