# Travel OS hosting: setup, cost and account checklist

One codebase (Expo) builds both the iOS and Android apps. One backend serves both.

```
Phone app (iOS + Android, built by EAS)
        |  HTTPS
        v
API  (FastAPI, Docker)  -- Render, region near most users
        |
        v
Supabase: Postgres (data) + Auth (sign-in) + Storage (wallet files, private bucket)
```

## Cost by stage

| Stage | Users | Monthly | One-off / yearly |
|---|---|---|---|
| Build and test | you + a few testers | $0 to $7 (Render free sleeps after 15 min idle; $7 Starter stays awake) | Apple Developer $99/yr, Google Play $25 once, domain ~$12/yr |
| Beta (TestFlight and Play internal testing) | up to ~100 | ~$7 API + $0 Supabase free tier | same |
| Public launch | hundreds to low thousands | ~$7 to $25 API + $25 Supabase Pro (daily backups, no pausing) | same |
| Growth | tens of thousands | scale the API plan, Supabase compute add-on, CDN for photos | same |

Supabase free projects pause after a week of no activity and have no backups, so move to Pro before real
users store real data. EAS builds: the free tier gives a small monthly build allowance, enough for beta.
Prices change; check each vendor's page before paying.

## Worldwide users

Pick the Render and Supabase regions closest to most users (US East or EU West are the usual defaults).
Distance only adds latency, it does not block anyone. Add a second region later only if latency complaints appear.

Keep the API and the database in the same region (Render Virginia with Supabase `us-east-1`, or Render Singapore
with Supabase `ap-southeast-1`). Every query crosses the gap between them, so a Seoul database behind a Virginia API
adds about 0.2 s to each query, and a screen that runs ten queries waits two seconds.

## Accounts to create (you do these; I cannot create accounts or enter passwords/codes)

1. **Supabase** (supabase.com): create two projects, `travelos-staging` and later `travelos-prod`.
   Collect: project URL, `service_role` key (secret), database connection string, JWT settings.
   Create a **private** Storage bucket named `documents`.
2. **Render** (render.com): connect the GitHub repo, create a Blueprint from `render.yaml`.
   Paste the secrets marked `sync: false` in its dashboard.
3. **Expo / EAS** (expo.dev): free account; run `eas login` and `eas build:configure` once.
4. **Apple Developer Program** ($99/yr, developer.apple.com): needed for TestFlight and the App Store.
   Enrollment can take a day or two. Sign in with Apple must be on if Google sign-in is offered.
5. **Google Play Console** ($25 once, play.google.com/console): identity check takes a few days.
   New personal accounts must run a closed test with 12 testers for 14 days before public release.
6. **Domain** (any registrar): `api.<domain>` for production, `api-staging.<domain>` for staging.
7. Later: Google Cloud OAuth client (Gmail import), OpenAI key (AI features), inbound email provider.

## Secrets: where each one lives

| Secret | Lives in |
|---|---|
| DATABASE_URL, SUPABASE_SERVICE_KEY, JWT_SECRET, TOKEN_ENCRYPTION_KEY, GOOGLE_*, OPENAI_API_KEY | Render environment |
| Supabase project keys | Supabase dashboard |
| Apple/Google signing credentials | EAS (managed by `eas credentials`) |
| Mobile `EXPO_PUBLIC_API_URL` | `apps/mobile/eas.json` (public, not secret) |

Never commit a secret. The `service_role` key bypasses row level security and must stay on the server.

## Current staging setup

- Render builds the **`main`** branch and redeploys on every push to it. Work on other branches does not reach the
  server until it is merged into `main`. The Render service runs in Virginia.
- Supabase: project `travel-os-staging-us` in `us-east-1`, beside the Render service, with the private `documents`
  bucket. The first project, `travel-os-staging` in Seoul, is no longer used.
- API on Render: `https://travel-os-mh5v.onrender.com` (health: `/api/v1/health`). Both the `preview` and
  `production` profiles in `apps/mobile/eas.json` point here until a custom domain exists.
- Gmail sign-in returns to `https://travel-os-mh5v.onrender.com/api/v1/integrations/gmail/callback`. Put that in
  `GOOGLE_REDIRECT_URI` on Render and in the Google Cloud OAuth client's authorized redirect URIs.
- If the service was created as a plain Web Service rather than from the Blueprint, set Language **Docker**,
  Root Directory **`apps/api`** and Health Check Path **`/api/v1/health`** in its Settings, or the build cannot find the Dockerfile.

### Values to paste into Render (Environment tab)

| Key | Where to get it |
|---|---|
| `ENVIRONMENT` | `production` |
| `DATABASE_URL` | Supabase > Connect > **Session pooler** string (Render has no IPv6, so not the direct one). Change `postgresql://` to `postgresql+psycopg://` and fill in the database password. |
| `SUPABASE_URL` | Supabase > Project Settings > Data API > Project URL |
| `SUPABASE_SERVICE_KEY` | Supabase > Project Settings > API Keys > `service_role` (secret) |
| `JWT_SECRET` | Generated by the Blueprint; otherwise `python3 -c "import secrets;print(secrets.token_urlsafe(48))"` |
| `TOKEN_ENCRYPTION_KEY` | From `apps/api`: `uv run python -c "from cryptography.fernet import Fernet;print(Fernet.generate_key().decode())"`. Keep it fixed: changing it disconnects every Gmail inbox. |
| `STORAGE_BUCKET` | `documents` (a private bucket in Supabase Storage) |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI` | Google Cloud OAuth web client (Gmail import) |
| `OPENAI_API_KEY` | Optional; AI features stay off without it |

Production refuses to start without `DATABASE_URL` (Postgres), `JWT_SECRET`, `SUPABASE_URL` and
`SUPABASE_SERVICE_KEY`; the reason appears in the Render deploy log.

## Order of operations

1. Create Supabase staging; run `alembic upgrade head` against its connection string.
2. Create the `documents` bucket (private).
3. Deploy to Render with staging values; check `/api/v1/health`.
4. Set `EXPO_PUBLIC_API_URL` in `eas.json`; `eas build --profile preview` for iOS and Android.
5. Invite testers (TestFlight, Play internal track).
6. Repeat with the prod Supabase project before public launch.

## Done in code already

- Wallet files go to Supabase Storage when `SUPABASE_URL` and `SUPABASE_SERVICE_KEY` are set; production refuses
  to start without them (so uploads can never be lost on a deploy).
- Production also refuses to start on SQLite, so a missing `DATABASE_URL` can never lose data on a redeploy.
- Dev email-only login is forced off in production; real sign-in uses Supabase Auth.
- Migrations run automatically on every deploy (Dockerfile).

## Not done yet (needs your accounts)

- Row level security policies on Supabase tables (applied when the prod project exists).
- Supabase Auth keys, Apple and Google sign-in provider setup.
- Custom domain (`api.<domain>`) to replace the `onrender.com` address in `eas.json` and `GOOGLE_REDIRECT_URI`.
