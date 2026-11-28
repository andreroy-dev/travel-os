# Travel OS — Next Phase: Platform, Sharing and Store Launch

Written 26 Nov 2026. This replaces the timeline in `BUILD_PLAN.md` (sections 5–6); the store rules and PRD audit there still apply.

## 1. The short version

The features are mostly built. They still run on your Mac, use one SQLite file and a temporary Cloudflare address, and have no real sign-in. This phase turns them into a real service, in eight steps. Each step ends with something you can test before we move on.

| # | Step | You get | Dates (if accounts arrive on time) |
|---|---|---|---|
| 0 | **Accounts and decisions (you)** | Apple, Google Play, domain, Supabase, Render, Expo | Now: 26–27 Nov |
| 1 | **Permanent addresses** | Google Console set up once, never touched again | 27–28 Nov |
| 2 | **Staging environment** | A hosted test copy with a real database; the Mac is no longer needed for the API | 30 Nov – 1 Dec |
| 3 | **Real sign-in and security** | Apple / Google / email-code sign-in, many users safely kept apart | 2–4 Dec |
| 4 | **Store pipeline** | TestFlight and Play test builds; Android's 14-day clock starts | 3–4 Dec |
| 5 | **Shared trips** | Share a trip with a link; friends join and plan together | 7–11 Dec |
| 6 | **Production environment** | The live service, with backups and monitoring; your real data moved in | 14–15 Dec |
| 7 | **Launch** | Store listings, legal pages, submission | iOS submitted 16 Dec |

**What this means for launch:**
- **iOS:** goes live around 18–21 December instead of early December. The extra two weeks are staging, security and shared trips, which you've now asked to have before launch.
- **Android:** needs its 14-day closed test, so the earliest production request is about 18 December. It's live before Christmas if Google approves quickly; otherwise early January.
- **Checkpoint on 11 Dec:** if shared trips aren't solid by then, we ship without them and add them in v1.1 in January, rather than delay launch.

## 2. Decisions I need from you

1. ✅ **Apple and Google seller: decided 26 Nov — individual for now.** Your name shows as the seller. We move the app to a Simplelyft AI company account later, once it has a D-U-N-S number (section 4 has the caveat).
2. **Final bundle ID**, e.g. `com.simplelyft.travelos`. It can't change after the first store build, which is Step 4.
3. **App name and domain.** "Travel OS" may already be taken on the App Store, so check before buying the domain.
4. **Sharing defaults** (section 6):
   - Does someone who joins by link get **edit** or **view-only** access?
   - How long do links last?
   - Should bookings imported from your Gmail show to everyone on the trip?
5. **Hosting:** Render (API) + Supabase (database, sign-in, files) is what's already configured and is my recommendation.

## 3. The three environments

Every change moves left to right. Nothing reaches users without passing staging first.

| | Local (your Mac) | Staging (test) | Production (live) |
|---|---|---|---|
| **Purpose** | Building and quick checks | Testing changes on a real phone before release | What App Store / Play users use |
| **API address** | `dev-api.<domain>`: a *named* Cloudflare tunnel, permanent | `api-staging.<domain>` | `api.<domain>` |
| **Database** | SQLite file (as now) | Supabase project "travelos-staging" (Postgres) | Supabase project "travelos-prod" (Postgres, daily backups) |
| **Sign-in** | Dev email login allowed | Real sign-in only | Real sign-in only |
| **Files (wallet scans)** | Disk | Supabase Storage, private bucket | Supabase Storage, private bucket |
| **App** | Expo Go / dev build | "Travel OS Staging" app (TestFlight internal, Play internal track) | "Travel OS" from the stores |
| **Data** | Test accounts | Test trips only; never copies of real users | Real users |
| **Deploys** | — | Automatically when code merges to `main` | When you approve a release |

**How a change ships:**
1. I work on a branch and open a pull request.
2. Automated checks run: backend tests on Postgres, a type check and `expo-doctor`.
3. The PR is merged into `main`, and staging updates by itself.
4. You test it on the Staging app.
5. You say "release", and the same code is promoted to production.

App-only fixes (screens, wording) can go out as **over-the-air updates** through EAS Update channels, staging first and then production, without another store review. Changes to native code still need a new store build.

## 4. Accounts: what, how and when

**When: now.** Accounts are the slowest part of the whole plan. They can't be rushed once started, and they gate Steps 1, 4, 6 and 7.

### Apple Developer Program ($99 a year)
- **Individual:**
  - Approved in about 1–2 days.
  - The App Store shows your personal legal name as the seller.
  - Needs an Apple Account with two-factor authentication. Enroll through the Apple Developer app on your iPhone; identity check by ID scan is fastest.
- **Organisation (Simplelyft AI):**
  - The App Store shows the company name.
  - You'll need:
    - a legal entity and its D-U-N-S number
    - a company website
    - an email on the company domain
    - authority to sign for the company
  - Apple says 2–4 weeks, and many developers in 2026 report 40+ days.
- **Decided 26 Nov: individual for now**, for both Apple and Google Play.
- **The reasoning:**
  - **If the company already has a D-U-N-S number,** enroll as an organisation today.
  - **If it doesn't,** request one now (free from Dun & Bradstreet; Apple has a lookup tool), but enroll as an **individual** today so builds aren't blocked.
  - Apps can be transferred to a company account later. Caveat: Sign in with Apple accounts must be migrated during a transfer, which is extra work, so decide early if you can.
- **After approval:**
  1. Create an **App Store Connect API key** (Users and Access → Integrations) so EAS can build and upload without your password.
  2. Create the app record with the final bundle ID.
  3. Add yourself and testers to **TestFlight**. Internal testing (up to 100 people on your team) needs no review; external testers need a short beta review.

### Google Play Console ($25 once)
- **Personal account:**
  - Google checks your ID, which takes a few days.
  - Before production, you need a **closed test with at least 12 testers opted in for 14 days in a row**. Then you apply for production access, and Google reviews that too.
- **Organisation account:** skips the 12-tester test, but needs the D-U-N-S number.
- **My recommendation:** a personal account now, unless the D-U-N-S number already exists. Start collecting **12–15 testers' Google account emails** today (friends, family, the team); recruit a few extra in case someone drops out.
- The 14-day clock counts testers, not builds. We start it with the first build in Step 4 and keep updating that build.

### Everything else

| Account | Why | Cost (approx., check current pricing) |
|---|---|---|
| **Domain** + **Cloudflare** (free plan) | Permanent addresses, the join links, legal pages, forwarding email | Domain ~$10–40/yr |
| **Supabase**: two projects (staging, prod) | Postgres, sign-in, file storage | Staging free; production Pro ~$25/mo (backups) |
| **Render** | Hosts the API: one staging service, one production service | ~$7/mo each to start |
| **Expo / EAS** | Builds, store uploads, over-the-air updates | Free tier to start |
| **Google Cloud**: two projects | (1) "Sign in with Google": quick approval. (2) "Gmail import": slow, restricted-scope approval. Kept apart so sign-in is never blocked by Gmail review. | Free; the Gmail security assessment is a paid audit (get quotes) |
| **Sentry** (or similar) | Crash and error reports from the app and API | Free tier |
| **OpenAI** | The assistant | Pay as you go, with a monthly cap |

**Rough monthly running cost at launch: $40–60, plus the one-off fees.**

## 5. The steps in detail

### Step 0 — Accounts and decisions (you, 26–27 Nov)
- Enroll at Apple and Google Play (section 4), buy the domain and add it to Cloudflare.
- Create Supabase, Render and Expo accounts. Either invite me as a collaborator, or create the projects and share access the way you prefer.
- Answer the decisions in section 2.

### Step 1 — Permanent addresses (27–28 Nov, about half a day once the domain is on Cloudflare)
**Fixes the problem you hit:** Gmail sign-in breaking after every server restart.
- Replace the random quick tunnel with a **named Cloudflare tunnel** at `dev-api.<domain>`. It's the same address forever, even across Mac restarts.
- Register three return addresses in Google Cloud **once**: dev, staging and production (`…/api/v1/integrations/gmail/callback` on each). After this you never open Google Console for addresses again.
- `dev-remote.sh` uses the named tunnel automatically.

*You test:* restart the servers twice; Gmail Reconnect still works with no Console changes.

### Step 2 — Staging environment (30 Nov – 1 Dec)
- Supabase staging project: Postgres, plus a private Storage bucket for wallet documents. Hosted servers lose their local disk on every deploy, so files must move off disk.
- Render staging service from `main`, at `api-staging.<domain>`. It runs migrations on every deploy (the Dockerfile already does).
- **GitHub Actions checks** on every pull request:
  - backend tests on a real Postgres database, not just SQLite
  - type check and `expo-doctor`
- Expo Go can point at staging, so the API no longer depends on your Mac being on.
- Seed staging with sample trips (no real personal data).

*You test:* the app on your phone against staging while your Mac is off.

### Step 3 — Real sign-in and security baseline (2–4 Dec)
Sign-in is already built and only waiting for keys.
- **Switch on Supabase Auth on staging:**
  - Sign in with Apple, Continue with Google, and an emailed 6-digit code.
  - Your first real sign-in links to your existing account by email.
- **Dev login off** everywhere except your Mac.
- **The security checklist in section 7**: everything marked *before launch*.
- **An automatic "isolation" test.** It signs in as two users and calls **every** endpoint, proving one user can never read or change another's data. It runs on every pull request, so a new feature can't quietly break this.

*You test:* create a second account on another phone or with another email, and confirm you can't see each other's trips.

### Step 4 — Store pipeline (3–4 Dec, once Apple and Google approve the accounts)
- **App variants:** "Travel OS Staging" (its own bundle ID, points at staging) and "Travel OS" (production). Both can sit on your phone side by side.
- **First EAS builds:**
  - iOS goes to **TestFlight**.
  - Android goes to the Play **internal** track (instant) and the **closed test** with your 12+ testers. **The 14-day clock starts here.**
- **Native features this unlocks** (they don't work in Expo Go):
  - push notifications (Apple push key)
  - background photo sync
  - universal links for sharing, needed in Step 5
- **Android Google Maps key** for the map.

*You test:* install from TestFlight and Play like a real user; no Mac, no QR codes.

### Step 5 — Shared trips (7–11 Dec)
The full design is in section 6.
- Members and roles, the share link, joining, leaving and removing people.
- What's shared and what stays private.
- Activity notes ("Priya added a hotel") and push notifications.
- Expense splits between members.

*You test:* share a trip from your phone to a friend's. They tap the link, install or open the app, sign in and join. You both edit and see each other's changes.

**Checkpoint, 11 Dec:** sharing goes in v1.0, or moves to v1.1 so launch isn't delayed.

### Step 6 — Production environment (14–15 Dec)
- **Hosting:** Supabase prod (Pro plan, daily backups) and Render prod at `api.<domain>`, each with its own secrets. The current local keys are never reused.
- **Your data:** copy only your real account and trips into production (not the test accounts). `copy_database.py` gets a "these users only" option.
- **Monitoring:**
  - error alerts (Sentry)
  - an uptime check on `/api/v1/health`
  - a **tested restore** from backup (a backup that's never been restored isn't proven)
- **Release process:** a "Promote to production" step that you approve.

### Step 7 — Launch (15–16 Dec, then reviews)
- Privacy policy, terms and support page on the domain. The Gmail review needs them too.
- **Store listings:**
  - screenshots and description
  - Apple's App Privacy answers and Google's Data safety form
  - age rating
  - a demo account with a sample trip for reviewers
- **Hide unfinished screens:** placeholder screens get apps rejected, as in `BUILD_PLAN.md` 4.1.
- **Security review:** a full security review of the code, then fix anything it finds.
- **Submit iOS by 16 Dec.** Review usually takes 1–3 days and gets slower over Christmas week.
- **Android:** apply for production when the 14 days end (about 18 Dec).
- **Gmail verification:** submit Google's restricted-scope request (domain, privacy policy, demo video, security assessment). This takes weeks.
  - Until it's approved, Gmail import works only for up to 100 named testers, and Google cuts their access every 7 days (the "Reconnect" you saw).
  - The **forwarding email import** (`trips+code@in.<domain>`) is the main import path for everyone else. It needs the domain and an inbound-email service (Cloudflare Email Routing or Postmark).

## 6. Shared trips: how it will work

PRD Module 10.1 lists shared spaces, invitations, collaborative editing, shared places, group expenses, voting and roles. It also says to build collaboration before any social network, so this phase covers collaboration only.

### People and roles

| Role | Can do |
|---|---|
| **Owner** (whoever created the trip) | Everything: edit, invite, remove people, change roles, archive or delete the trip, hand ownership to someone else |
| **Editor** | Add and edit bookings, plans, stays, travel, places, packing and expenses; create suggestions; vote |
| **Contributor** | Create suggestions and comments; vote; cannot edit confirmed items |
| **Viewer** | See everything shared; change nothing |

Document access is separate from role: identity documents are never shared by default, and grants are per document and per member.

### The share link
1. The owner taps **Share trip** and chooses the role people get (edit or view) and how long the link lasts (default 7 days).
2. The link looks like `https://<domain>/join/<code>`. The code is long and random, and only a scrambled copy is stored, so a database leak doesn't reveal working links.
3. Tapping it **opens the app** if installed (universal links on iOS, App Links on Android). If not, it opens a small web page with the trip name and App Store / Play buttons.
4. The person signs in if needed, then sees **"Join *Germany trip* with Andre? You'll see its bookings, itinerary, places and shared expenses."** One tap to join.
5. The owner can **turn the link off or make a new one** at any time; old links stop working immediately. Optional later: "ask me before people join".

### Shared vs private

| Shared with the trip | Always private to each person |
|---|---|
| Trip dates, title, status | Wallet documents (passport, visa, insurance…) |
| Itinerary, plans, stays, travel | Gmail connections and imported emails |
| Bookings filed to the trip (with a "shared from Andre's Gmail" note) | Visa day counting |
| Saved places, packing list (plus a personal packing list) | Personal monthly budgets and recurring costs |
| Group expenses and who owes whom | Account settings |
| Photos: **later**. Today photos stay on each phone; sharing them means uploading images, which is a storage cost decision for after launch | Photos, for now |

### Under the hood
- **New tables:**
  - trip members (person, role, who invited them, when)
  - invite links (scrambled code, role, expiry, revoked or not, times used)
  - a small activity log
- **Every trip-related check changes** from "is this yours?" to "are you a member, and is your role allowed to do this?". That's about 170 places in the API.
  - They go through **one helper**, so the rule lives in one place.
  - The isolation test from Step 3 grows to cover owner / editor / viewer / outsider on every endpoint.
- **Expense splits** link to members instead of typed names, so balances follow real people.
- **Edge cases handled:**
  - Leaving a trip.
  - The owner deleting their account: ownership passes to the longest-standing editor, or the trip is deleted if nobody is left.
  - Merging and archiving: owner only.
  - Two people editing at once: the last save wins, and each item shows who changed it last.

## 7. Security checklist

| Item | When |
|---|---|
| Real sign-in only (Apple / Google / email code); dev login on your Mac only | Before launch (Step 3) |
| Every request checked for a valid sign-in; access checked per trip and per role | Before launch (Steps 3, 5) |
| Automatic isolation test on every pull request | Before launch (Step 3) |
| **Supabase:** "row level security" switched on for every table, so the public key inside the app can't read the database directly (only our API can) | Before launch (Step 2) |
| Secrets only in Render / Supabase / EAS settings; separate secrets for staging and production; nothing in git | Before launch (Steps 2, 6) |
| Login tokens kept in the phone's secure storage (already the case) | Done |
| Gmail tokens encrypted (already the case); wallet files in a private bucket, opened only through the API | Before launch (Step 2) |
| HTTPS everywhere; CORS limited to our own addresses (today it allows any site) | Before launch (Step 2) |
| Rate limits on sign-in, imports, uploads and the assistant | Before launch (Step 3) |
| Audit log of sensitive actions: sign-in, Gmail connect/disconnect, export, deletion, sharing and member changes (PRD 7.1) | Before launch (Steps 3, 5) |
| Data minimisation: keep the parsed booking, delete raw email text after a set period | Before launch (Step 3); the Gmail review asks about this |
| Error reporting with personal details removed | Before launch (Step 6) |
| Dependency vulnerability checks in CI | Before launch (Step 2) |
| Backups with a tested restore | Before launch (Step 6) |
| Full security review of the code | Before submitting (Step 7) |
| Gmail security assessment (CASA) by an approved lab | After launch, for Gmail-for-everyone |

## 8. After launch: feature backlog

Roughly in order of value. Each is a separate release through staging first.

1. **Gmail for everyone** (once Google approves) and **Outlook import**.
2. **Push notifications from the server:** check-in tomorrow, flight tomorrow, new import, a friend joined your trip.
3. **Receipt scanning** into expenses.
4. **Weather** on Home and each itinerary day.
5. **Flight status:** gate, delay and cancellation alerts.
6. **Calendar export:** add the trip to Apple or Google Calendar.
7. **Missing-booking checks:** "no stay the night you land", "flight lands after check-in closes".
8. **Shared photo albums** for a trip (needs image upload and storage).
9. **Activity voting** for group trips (PRD 10.1).
10. **Trip recap** from photos, places, spending and distance.
11. **Background jobs** (PRD: Redis and Celery), so Gmail sync and imports run in the background instead of while you wait.
12. **Discover and marketplace** with real provider listings, then **subscriptions** (PRD 12).

## 9. Risks

- **Account approvals set the dates, not the code.** An Apple organisation enrollment or a D-U-N-S request can take weeks, so enroll today.
- **Android's 14-day test** can't be shortened on a personal account. If Google rejects the production request, the test may need to run again.
- **Gmail stays limited** (100 testers, reconnect weekly) until Google's verification and security assessment pass, likely January or February. Forwarding import covers everyone else.
- **Shared trips touch almost every part of the API.** The isolation test and the 11 Dec checkpoint are there so this can't ship half-done.
- **Christmas week** slows Apple and Google reviews, so submitting by 16 Dec matters.

## 10. Build phases (PRD v3 Part V, revised after the gap analysis)

Each phase is done only when its new tests pass, the full suite is green and the affected screens are checked by hand.

| # | Phase | Status |
|---|---|---|
| 1 | Booking identity fields | Done |
| 2 | Profile and onboarding fields. Gap to close: preferred currency, language, time zone, budget, interests, food and accessibility (C1) | Built, C1 fields to add |
| 3 | Permission helper and trip members (owner, editor, contributor, viewer). Includes the D3 rule: a member who leaves keeps personal copies of bookings they imported | In progress |
| 3b | Identity-document protection: per-user encryption, masked values, biometric view, per-document grants, retention and one-tap delete, no passport images sent to AI unless the user asks | Planned |
| 4 | Audit log | Planned |
| 5 | Invites, suggestions and votes (owner breaks ties) | Planned |
| 6 | Expense ledger: one trip currency, rate stored at entry, balances by member | Planned |
| 7 | Remaining ingestion paths, plus email-security handling (A5): discard raw bodies, quarantine unsafe attachments, flag unauthenticated senders | Planned |
| 8a | Provider bridge: adapter interface, capability matrix, routing | Planned |
| 8b | Discovery and Path B/C | Planned |
| 8c | Part N features | Planned |
| 8d | AI controls | Planned |
| 8e | Policy and privacy artefacts | Planned |
| 8f | Community | Planned |

Also checked before launch: an in-app account deletion button exists and works.

### Open decisions (Part Q)
Launch markets, Outlook timing, offline maps, and whether the Part S proposals (guest participants, equal-split default) are confirmed.
