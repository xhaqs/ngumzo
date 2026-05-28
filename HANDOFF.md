# Ngumzo — Handoff Notes

The hard-won details, so nothing is lost between sessions.

## What Ngumzo is
Private cross-language chat. Two-to-six people, each writing in their own
language; every message reaches each person in theirs. Built for the Gulf
labour market (Kenyans working with Filipinos, Indians, Bangladeshis, etc.).

Live at: **ngumzo.vercel.app**
Repo: **github.com/xhaqs/ngumzo**  •  Firebase project: **ngumzo-3a115**

## Architecture (the important part)
- **Single repo, deploys to Vercel.** `public/` = the app, `api/` = serverless.
- **Messages are end-to-end-ish encrypted.** AES-GCM in the browser; key is
  derived (PBKDF2, 120k iterations, salt `ngumzo-v1-salt-<code>`) from the room
  code. The Firebase relay stores ONLY ciphertext `{c, ts}`. The promise is:
  *the relay never sees plaintext.*
- **Translation** (`/api/translate`) and **voice** (`/api/tts`) DO see the one
  phrase being translated/spoken — they call Google. This is disclosed in the UI.
  Chat content in the relay stays encrypted; only the on-demand phrase leaves.

## The pieces
- `public/index.html` — all UI + styling + plasma engine. Iridescent plasma with
  Kenyan-flag orbs. Native `<dialog>` for language switch & message actions.
- `public/app.js` — all logic: encryption, room sync, translation, voice,
  analytics, long-press copy/share.
- `public/config.js` — Firebase keys (public by design; safe to commit).
- `api/translate.js` — stateless Google Translate proxy.
- `api/tts.js` — server-side text-to-speech (Google translate_tts → MP3).
- `api/stats.js` — privacy-respecting counter (opens/rooms/messages, never content).
  View: `ngumzo.vercel.app/api/stats?key=phoenix-ngumzo-2026`
- `firebase-rules.json` — DB rules (ciphertext-only validation + seats branch).
  MUST be pasted into Firebase console manually; pushing code does NOT update them.

## Voice — the thing that ate a whole session
- Browser `speechSynthesis` only plays voices INSTALLED on the device. A cheap
  A04 Chrome has ~7 Latin-script voices only — no Arabic/Chinese/Japanese/etc.
- So on-device TTS fails for exactly the languages the Gulf market needs.
- BABEL plays them because BABEL uses SERVER-side TTS (audio file). Same trick
  now in `api/tts.js`.
- `speakText()` logic: use a local device voice if one exists (instant, free);
  otherwise fall back to `/api/tts` server audio. Best of both.
- Cost: Google TTS ~$4 / million chars. Scales with users. Watch it.
- ~200 char cap per TTS request (Google limit).

## Deploy quirks (Termux / Samsung A04)
- Android renames re-downloads: `app.js` → `app-2.js`, `index-13.html`, etc.
  To find the right file, grep for a unique string:
  `grep -l "<unique string>" ~/storage/downloads/app*.js`
- Always verify with `grep -c` BEFORE pushing — copying the wrong (old) file
  has wasted several deploy cycles.
- Sequence: copy file → grep to confirm → `git add` → `commit` → `push`.
- Vercel auto-deploys on push (~1 min). Firebase rules are separate.

## Capacity / privacy model
- `ROOM_CAPACITY = 6` (raised from 2 for the testing-launch phase).
- Room seals when full; a 7th person is refused. Dropped users can rejoin
  (Firebase `onDisconnect` frees their seat).
- The room code IS the key. Anyone with it can read. v1 is for groups who
  trust each other. Verified identity / per-user keys = a real v2.

## Languages
- ~72, three honest tiers: Reliable / Good / Experimental.
- Shown English-first with native script: "Hindi · हिन्दी".
- Experimental (Gĩkũyũ, Luo, etc.) translate poorly — labelled as such.

## Parked for v2 (real, but need the identity foundation)
- Claude-as-translator for languages Google does badly (Sheng, Gikuyu slang).
  Needs Anthropic API key. The likely real moat.
- SMS / phone-number verified identity.
- Invite-only group video.
- Creator / mute permissions.
- Sentinel as the empire-wide control room (metadata only, never message content).
- Searchable language + country pickers (for the long lists).
- Expanded country list (~200) with search.

## The recurring discipline note
Features keep getting added without real-user feedback. The highest-value next
step is almost always: **get it in front of the 3 Gulf testers and listen**,
not build the next guessed feature.
