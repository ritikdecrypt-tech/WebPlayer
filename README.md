# Kinora story web player

Next.js **player only** — not a website. Paste a shared story URL and the story plays full-screen.

Share links look like:

```text
https://hellokinora.com/s/{short_code}
```

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

## Required backend

1. Deploy the public edge function:

```bash
cd kidz
supabase functions deploy story-player --no-verify-jwt
```

2. Point share links at wherever this player is hosted (`APP_BASE_URL` secret on `create-share-link`):

```text
# local
APP_BASE_URL=http://localhost:3000

# production (after you deploy this player to the domain)
APP_BASE_URL=https://hellokinora.com
```

Until this player is deployed to `hellokinora.com`, that domain will keep showing Apache’s 404. Use localhost for testing.
