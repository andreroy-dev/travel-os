# Travel OS — Launch Build Plan

Last updated: 20 Nov 2026 · Target: App Store in early December 2026, Play Store right after.

## 1. The short version

- **v1.0 is PRD Release 1:** organise real travel in one place. That means Travel Spaces, bookings (import + manual), the itinerary with stay gaps and travel prompts, flight details, places, the calendar and a basic assistant. The rest of the PRD (marketplace, photos, wallet, expenses, social) ships as monthly updates after launch.
- **The app is mostly built.** What stands between us and the stores is shipping infrastructure, not features:
  - real sign-in
  - a hosted backend
  - store builds
  - legal pages
  - removing "coming soon" screens
- **Two things outside our control set the dates:**
  1. **Gmail access:** the public can't use it until Google approves the app.
  2. **Google Play:** a new personal developer account must run a 14-day closed test first.

  Both are covered below; they mean **iOS can launch in early December, while Android most likely lands about a week later.**

## 2. What is built today

| Area | State |
|---|---|
| Travel Spaces: create, edit, archive with confirm, restore, merge | ✅ |
| Itinerary: night-by-night stay coverage, gap prompts, "how are you getting there?" prompts | ✅ |
| Your own stays (friend, family, own place) and journeys | ✅ |
| Bookings: manual add, edit, status, move, delete | ✅ |
| Gmail import (sync per space, provider parsers, dedupe) | ✅ works for you, **blocked for the public** (see 4.2) |
| Flight detail (legs, layovers, link to original email) | ✅ needs your wireframes |
| Places tab, Calendar tab | ✅ |
| Adaptive home dashboard | ✅ |
| Assistant (Companion tab) | ⚠️ answers questions; no OpenAI key set and no actions yet |
| Sign-in | ⚠️ email-only dev sign-in, no password |
| Hosting | ⚠️ runs on your Mac through tunnels; SQLite database |
| Account deletion | ⚠️ API exists, no button in the app |
| Discover, Photos, Budget, Docs tabs | ❌ placeholder screens |
| Map view, push notifications, offline access | ❌ |
| Store setup: bundle IDs, EAS builds, icon, privacy policy, listings | ❌ |

## 3. Launch scope (v1.0)

**In:**
- Travel Spaces
- Bookings: manual entry, Gmail (for invited testers; see 4.2), forwarding email and PDF/screenshot import
- Itinerary and Calendar, stays and journeys, flight details, saved places
- Home dashboard and the assistant
- Push notifications for new imports and check-in reminders
- Profile, settings and account deletion

**Out (hidden in v1, not shown as "coming soon"):** Discover/marketplace, Photos, Budget/expenses, Docs/wallet, social.
Apple rejects apps with placeholder screens or unfinished features (guideline 2.1), so these tabs come out until they're real.

## 4. Store requirements we must meet

### 4.1 Apple App Store
- **Apple Developer Program:** $99/year. An organisation account needs a D-U-N-S number.
- **Sign in with Apple:** required if we offer Google sign-in (guideline 4.8). Plan: email one-time code + Sign in with Apple + Google, all through Supabase Auth.
- **Account deletion inside the app** (guideline 5.1.1(v)).
- **Store pages and details:** privacy policy URL, support URL, the App Privacy questionnaire, age rating, and a review demo account with sample trips.
- **No dev-only code, no placeholders,** and a stable hosted backend (the review team uses it).

### 4.2 Gmail: the biggest launch risk
- We read Gmail with `gmail.readonly`, which Google classes as a **restricted scope**. Before the public can connect Gmail, Google needs:
  - OAuth app verification, which requires a verified domain, a privacy policy and a demo video
  - a paid annual **CASA security assessment** by an approved lab
- That usually takes **several weeks to a few months**, so it won't be done by early December.
- Until then the Google project stays in "testing", which is **limited to 100 named test users** who see an "unverified app" warning.
- **Plan for launch:**
  1. **Forwarding import (new for v1):** each user gets their own address (e.g. `trips+abc123@in.travelos.app`). They forward confirmation emails to it, and they're parsed with the same Gmail parsers. Needs no Google approval, and works for Outlook, iCloud and any other inbox.
  2. **Gmail connect stays as a "beta" option** for invited testers, and we start Google verification now. It opens to everyone in an update once approved.

### 4.3 Google Play
- **Google Play Console:** $25 one-time.
- **New personal account:** must run a **closed test with at least 12 testers for 14 days in a row** before it can publish to production. Starting by 23 Nov makes 7 Dec the earliest Android launch.
- **Organisation account:** skips this, but needs a D-U-N-S number, which can take days to weeks.
- **Other requirements:** Data safety form, privacy policy, target API level (EAS handles it), content rating, and the same Gmail limits as iOS.

## 5. Build plan and timeline

Dates assume I get the items in section 6 on time. Each phase lists what you'll be able to test.

### Phase A — Store foundations (20–24 Nov)

**Done (20 Nov), no accounts needed:**
- ✅ **Account deletion and data export:** Profile now has **Export my data** (a JSON file of everything) and **Delete account**, with two confirmations. Deleting revokes Gmail access with Google, then removes all your data.
- ✅ **Real sign-in, built and waiting for keys:**
  - The sign-in screen offers Sign in with Apple, Continue with Google and an emailed 6-digit code, using Supabase Auth.
  - It switches on automatically once `EXPO_PUBLIC_SUPABASE_URL` / `EXPO_PUBLIC_SUPABASE_ANON_KEY` are set.
  - The API accepts both newer (JWKS) and older (shared-secret) Supabase tokens.
  - The first real sign-in links to your existing account by email, so the Germany trip carries over.
  - Developer sign-in is hidden behind a link, and turns off in production.
- ✅ **Postgres-ready database:**
  - Alembic migrations, checked to match the models exactly and to produce valid Postgres SQL.
  - Your local database is marked as up to date.
  - `scripts/copy_database.py` copies everything into Postgres. Tested: all 4 users, 5 spaces, 16 bookings and 73 imported emails copied correctly.
- ✅ **Hosting config:**
  - `apps/api/Dockerfile` runs migrations on start.
  - `render.yaml` blueprint and `apps/api/.env.example`.
  - The API refuses to start in production without a real token key and Supabase.
- ✅ **App identity:**
  - Bundle ID / package `com.travelos.app` (**confirm before the first build: it can't be changed after publishing**).
  - Sign in with Apple capability, encryption-export flag, iPhone-only for v1.
  - `eas.json` with development, preview and production profiles.
  - Expo packages updated; `expo-doctor` passes 20/20.

**Waiting on you (section 6) to finish Phase A:**
- Supabase project → turn on real sign-in, then configure Apple and Google providers in Supabase.
- Hosting account + domain → deploy the API, copy the data across, set `EXPO_PUBLIC_API_URL` in `eas.json`.
- Expo + Apple Developer accounts → first EAS build and TestFlight.
- Google Play account → closed test with 12+ testers.
- Google Cloud project → submit Gmail verification.

*You test:* sign in with Apple or email on a real TestFlight build, talking to the hosted backend; no Mac or tunnel needed.

### Phase B — Finish v1 features (25–30 Nov)
1. **Your wireframes:** flight, accommodation, booking list and space screens.
2. **Forwarding-address import:** inbound email service (Postmark or Mailgun), per-user address, parsing, "Imported" notifications.
3. **Upload a PDF or screenshot** of a confirmation (the API exists; needs an app screen and a camera/photo picker).
4. **Push notifications** (Expo push for iOS and Android): new booking imported, check-in tomorrow, flight tomorrow, an open gap 7 days before.
5. **Assistant v1:** OpenAI key, answers from your real trips ("what's tomorrow?", "where am I staying on the 16th?"). Consequential actions only with confirmation, e.g. adding a stay for a gap.
6. **Hide placeholder tabs.** Profile gets settings: home currency, time zone, notifications.
7. **Map view (stretch):** Google Maps with stays and bookings pinned. Needs a Maps key; geocoding addresses we already have.
8. **Offline basics:** cache the last-loaded spaces, itinerary and bookings so they open without signal.
9. **Skip control:** "I've sorted this" for gap and move prompts (needs your answer, question 9).

*You test:* the full v1 on TestFlight, plus Android on the closed test.

### Phase C — Polish and submit (1–5 Dec)
1. Bug bash on your real trips, then fixes.
2. Store listings: screenshots (6.7" and 6.5" iPhone, Android phone), description, keywords, promo text, App Privacy and Data safety answers, a demo reviewer account with a sample trip.
3. Privacy policy, terms and support page on the domain.
4. **Submit iOS by 2 Dec.** Review usually takes 1–2 days; allow time for one rejection round.
5. **Android:** promote from closed test to production once the 14 days are up (about 7–8 Dec on a personal account).

### After launch — monthly updates (roughly PRD Releases 2–8)

| Update | Contents |
|---|---|
| v1.1 (Jan) | Gmail for everyone (after Google approval), Outlook import, booking change/cancel emails, Android parity fixes |
| v1.2 | **Discover + marketplace:** provider adapters, stays filtered to your gap dates and city, saved listings, affiliate links |
| v1.3 | **Assistant actions + context:** plan days, weather, proactive reminders, natural-language itinerary |
| v1.4 | **Long stays:** monthly accommodation, recurring costs, coworking/gyms, visa and Schengen 90/180 tracking |
| v1.5 | **Memories:** photo picker, matching photos to trips, memory map, recaps |
| v1.6 | **Wallet + money:** documents with offline access, expenses, multi-currency budgets, group splits |
| v1.7 | **Monetisation:** Plus/Premium subscriptions (in-app purchase), partner offers |
| v1.8 | **Community:** shared spaces, collaborators, public itineraries |

## 6. What I need from you

**Accounts (only you can create these; they take the longest, so please start today)**
1. **Apple Developer Program:** individual or organisation? Add me as a developer or tell me the team, so EAS can build.
2. **Google Play Console:** personal or organisation? If personal, we need **12+ testers' Google emails** within the next few days.
3. **Expo account** for EAS builds: create one or tell me which to use.
4. **Domain** for the app, privacy policy and forwarding email (e.g. `travelos.app`). Is "Travel OS" the final store name? It may already be taken on the App Store.
5. **Supabase project** (or permission to create one), and a **hosting choice/budget**. A small Render/Railway server plus Supabase free tier is roughly $10–30 a month.
6. **Google Cloud project** where Gmail OAuth lives (for verification), and a **Google Maps API key** if we want the map in v1.
7. **OpenAI API key** for the assistant, with a monthly spend cap you're comfortable with.

**Design and content**

8. **Wireframes:** flight detail, accommodation detail, booking list, space screen, and anything else you have (home, onboarding).
9. **Product decisions:**
   - Can gaps and moves be dismissed?
   - Free at launch with no subscriptions? (Recommended.)
   - Launch countries: worldwide?
10. **Brand:** final app icon, colours, logo, and any screenshots/marketing copy direction.
11. **Support email and company/legal name** for the privacy policy and store listings.

## 7. Known risks
- **Gmail verification won't finish before launch.** Covered by forwarding import plus a Gmail beta for testers.
- **The Android 14-day test** pushes Android about a week past iOS on a personal account.
- **App Store rejection** for placeholder screens or missing account deletion. Covered in Phases B and C.
- **Security is deferred at your request:** today's tunnel sign-in is email-only with no password. Anyone who finds the tunnel URL can sign in with any email, so don't share it beyond your testers. Phase A replaces it with real sign-in before anything goes to the stores.
