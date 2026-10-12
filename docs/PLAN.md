# Ngumzo: product and tier plan (written 2026-10-12)

## Products

- Interpreter: one phone, two people. Free tier. Uses phone voices (no server voice cost).
- Room Chat: multi-person rooms, each reads in their own language. Pro tier.

## Current state

- Live on Cloudflare Pages at ngumzo.pages.dev. Translation: Cloudflare Workers AI (m2m100) with Google fallback (Google is usually blocked from Cloudflare servers).
- Voice: server voice is unavailable (Google endpoint blocked, no Azure subscription). The app falls back to the phone's own voices, which need voice data installed per language.
- Room cap of 6 is enforced only in the app on each phone. It is a placeholder.

## Tiers (draft, prices undecided)

- Free: Interpreter, cheap translation engine, daily limits, phone voices.
- Pro (Traveler Pass, weekly/monthly, KES via mobile money): Room Chat, server voices for all languages with a fair-use cap on spoken characters, better translation engine, rooms up to about 6.
- Team: larger rooms (10-20), higher voice cap, for tour groups, NGOs, agencies.
- Developer (later): API access to the engine router with own keys, for local developers serving clients in their regions.

## Cost logic

- Charge where cost occurs: server voice (per character spoken) and the premium translation engine (per character). Rooms and languages are weak cost drivers.
- Room size multiplies cost: each message is translated for each listener.
- Verify current provider prices and free quotas before setting any price. Price at roughly 3-5x worst-case per-user voice cost, then adjust after the first paying users.

## Engine router (foundation for all tiers)

- One server route picks translation and voice engine by language, tier and cost.
- Free: cheap engine with a stable free allowance. Pro: LLM (Gemini or Claude) or a dedicated service, whichever tests better per cost.
- Free tier quality must be good enough to impress; it is the shop window.
- Test first: compare engines side by side on about 10 real travel phrases (prices, directions, food, taxi) into Indonesian and Swahili.

## Limits

- Daily limits on free need server-side counting (anonymous device ID plus rate limiting by network address, or sign-in for Pro). App-only limits are easy to bypass.
- Room size limit must move into Firebase rules or a server check before it is sold.

## Developer tier cautions

- Needs API keys, metering, per-key limits, docs, abuse protection.
- Check each provider's terms on reselling or white-labelling. Never resell the free Google endpoints.

## Order of work

1. Get real users (first user: a Kenyan traveller in Indonesia). Collect feedback.
2. Engine test page, then the engine router and server-side limits.
3. Server voice with a fresh free-tier speech resource, then payments.
4. Pro tier launch.
5. Developer tier only after Pro has paying users.

## Small to-dos

- Make the voice-missing toast say which voice to install in phone settings.
- Interpreter polish: done (copy, share, delete, directional translate buttons).
