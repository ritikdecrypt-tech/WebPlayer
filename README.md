# Kinora story web player

Next.js **player only** — not a website. Paste a shared story URL and the story plays full-screen.

Share links look like:

```text
https://hellokinora.com/s/{short_code}?ref={short_code}
```

Anyone with the link can watch in a browser — no Kinora app or account. Free-tier shares always show the Kinora watermark; Family shares do not. The `ref` query param is the story's unique share code and is kept through playback so the End Card can credit the referrer.

Locally:

```text
http://localhost:3000/s/{short_code}
```

## Run locally

```bash
cd web-player
cp .env.example .env.local   # same Supabase URL + anon key as the app
npm install
npm run dev
```

Then open `http://localhost:3000/s/YOURCODE`.

## Deploy on Netlify

1. Connect this `web-player` repo/folder as a Netlify site.
2. Build settings are in `netlify.toml` (`npm run build`, publish `.next`, Next.js plugin).
3. Set environment variables in **Netlify → Site settings → Environment variables**:
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `SUPABASE_SERVICE_ROLE_KEY` (server-only)
   - `NEXT_PUBLIC_APP_URL` (your Netlify URL or custom domain)
4. Trigger a new deploy. Test: `https://YOUR-SITE.netlify.app/s/YOURCODE`

If you see Netlify’s purple “Page not found”, the last deploy failed or env vars are missing — check **Deploys** logs, then redeploy.

## Supabase

1. Deploy the public edge function (optional if using service role in this app):

```bash
cd kidz
supabase functions deploy story-player --no-verify-jwt
```

2. Point share links at this player (`APP_BASE_URL` secret on `create-share-link`):

```text
APP_BASE_URL=https://YOUR-SITE.netlify.app
# or your custom domain, e.g. https://hellokinora.com
```
