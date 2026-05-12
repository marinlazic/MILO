# MILO Sync — Chrome extension

One-click daily sync from Bridge Athletic into your MILO dashboard.

## Install (~30 seconds, one-time)

1. Open Chrome → `chrome://extensions`
2. Toggle **Developer mode** ON (top-right)
3. Click **Load unpacked**
4. Select this `extension/` folder
5. Pin the MILO Sync icon to your Chrome toolbar (puzzle-piece menu → pin)

## Use daily

1. Make sure you're logged into Bridge in any tab (`bridgeathletic.com`)
2. Click the **MILO Sync** icon in your toolbar
3. First time only: paste your `SYNC_SECRET` (the value you set in Vercel env vars) — it saves locally
4. Click **Sync now**
5. ~30-60s later: ✓ Synced. Vercel deploys, dashboard fresh in another minute.

## How it works

- Extension has `host_permissions` for both `bridgeathletic.com` and `milo-cyan.vercel.app`, so it bypasses Bridge's Content Security Policy
- On click, injects the sync function into the active Bridge tab
- That function calls Bridge's internal API (with your cookies) and POSTs the resulting data to `https://milo-cyan.vercel.app/api/sync`
- The `/api/sync` Vercel function commits the data files to your GitHub repo
- Vercel auto-deploys

## Files

- `manifest.json` — extension manifest (MV3)
- `popup.html` / `popup.js` — the UI that opens when you click the toolbar icon
- `icon.png` — toolbar icon
