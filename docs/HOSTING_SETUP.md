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
- Dev email-only login is forced off in production; real sign-in uses Supabase Auth.
- Migrations run automatically on every deploy (Dockerfile).

## Not done yet (needs your accounts)

- Row level security policies on Supabase tables (applied when the prod project exists).
- Supabase Auth keys, Apple and Google sign-in provider setup.
- Real domain in `eas.json` and `GOOGLE_REDIRECT_URI`.
