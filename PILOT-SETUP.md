# Ngumzo Pilot - Cloudflare Setup Steps

Manual steps required in the Cloudflare dashboard:

## 1. Create D1 Database

1. Log in to Cloudflare dashboard
2. Go to Workers & Pages → D1
3. Click "Create database"
4. Name: `ngumzo-pilot`
5. Click "Create"
6. Copy the database ID (shown after creation)

## 2. Run Database Schema

1. In the D1 database page, click "Console" tab
2. Copy and paste the entire contents of `schema.sql`
3. Click "Execute"
4. Verify: should see "Success" and tables created

## 3. Create KV Namespace

1. Go to Workers & Pages → KV
2. Click "Create a namespace"
3. Name: `PILOT_CONFIG`
4. Click "Add"
5. Copy the namespace ID (shown in the list)

## 4. Upload Initial Config to KV

1. Click on the `PILOT_CONFIG` namespace
2. Click "Add entry"
3. Key: `pilot:config`
4. Value: Copy and paste contents of `pilot-config-example.json`
   - By default, only `phoenix` is configured as the owner (unlimited access)
   - Other testers auto-register when they visit `?t=<name>` (names must match `^[a-z0-9-]{3,32}$`)
   - Auto-registration uses `testerDefaults` (100 translations/day, 30-day trial)
   - Set `autoRegisterTesters: false` to disable auto-registration
5. Click "Save"

## 5. Add Bindings to Cloudflare Pages

1. Go to Workers & Pages → ngumzo (your Pages project)
2. Click "Settings" → "Functions"
3. Scroll to "D1 database bindings"
4. Click "Add binding"
   - Variable name: `PILOT_DB`
   - D1 database: Select `ngumzo-pilot`
   - Click "Save"
5. Scroll to "KV namespace bindings"
6. Click "Add binding"
   - Variable name: `PILOT_CONFIG`
   - KV namespace: Select `PILOT_CONFIG`
   - Click "Save"

## 6. Deploy

1. Push code to git: `git push`
2. Cloudflare Pages will auto-deploy
3. Wait 1-2 minutes for deployment to complete

## 7. Verify

Test the pilot system:

- Visit: `https://ngumzo.pages.dev/?t=phoenix`
- Translate something
- Check stats: `https://ngumzo.pages.dev/api/stats?key=YOUR_ADMIN_KEY`
- Should see `pilot` section in JSON response

---

## Phone Editing (After Setup)

**Edit tester config:**

- Cloudflare dashboard → KV → PILOT_CONFIG → Edit `pilot:config` key

**View stats:**

- Visit: `https://ngumzo.pages.dev/api/stats?key=YOUR_ADMIN_KEY` in mobile browser
