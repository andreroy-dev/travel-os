# Travel OS — Launch Build Plan

Last updated: 24 Nov 2026 · Target: App Store in early December 2026, Play Store right after.

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

## 2. Where the app stands against the PRD (audit 24 Nov)

Grok's edits added most of the later PRD modules. This table is the state after that work plus this session's fixes.

| PRD module | State | What's still missing for the PRD |
|---|---|---|
| 3. Travel Spaces, states, adaptive home | ✅ Home now changes per situation: at home (upcoming trips, history), planning (countdown, nights sorted, bookings, packing), short holiday (tonight, open nights, spend, places), long stay (tonight, monthly budget, visa days, local life), paused, after a trip (memories, spend, visited) | Weather and "nearby" need location and weather providers |
| 1. Discover | ⚠️ Saved links, open-gap list, and **provider search links** (Booking.com, Airbnb, Google Hotels with the gap's city and dates) | Real listings need provider APIs (PRD 2.2), destination guides, curated collections, personalised suggestions |
| 2. Marketplace and providers | ⚠️ Adapter framework, saved listings, click logging, affiliate-ready search links (`BOOKING_AFFILIATE_ID`) | Licensed provider feeds, comparison, conversion tracking |
| 3. Booking management | ✅ Gmail, PDF/screenshot upload, manual entry, edit/move/cancel, cancellation emails update bookings; forwarding import built but **hidden until we own a receiving domain** | Outlook, calendar integration |
| Itinerary (chronological, calendar, map) | ✅ Long stays now browse month by month (was cut off after 62 days) | Routing and travel times (PRD 6.3) |
| 4. AI companion | ⚠️ Answers from real trip data; proposes stays, plans and places, and saves them only after you confirm | Needs an OpenAI key for free-form chat; weather, proactive suggestions |
| 5. Stays and local life | ✅ Recurring costs, monthly budgets, local services, neighbourhood notes (safety needs a source), events | Cost-of-living estimates (must be sourced) |
| 6. Maps | ⚠️ Pins for bookings, places and photos | Uses OpenStreetMap's public tiles in a web view, which their tile policy doesn't allow for a store app. Swap to native maps (Apple/Google) before launch. No geocoding, so most bookings have no pin yet |
| 7. Memories | ✅ Photo picker with date/GPS from EXIF, captions, albums, journal notes | Photos stay on the phone only (no backup), no recaps/video |
| 8. Wallet and visa | ✅ Documents with expiry reminders, emergency contacts, 90/180 and countdown stay logs | Document files/scans, offline copy, official requirement lookup |
| 9. Expenses | ✅ Multi-currency expenses, splits, settlement, ECB rates via Frankfurter, trip and monthly budgets | Receipt scanning |
| 10. Social | ❌ | Shared spaces and invitations |
| 11. Utilities | ⚠️ Currency converter, packing lists, world clocks | Weather, translation, eSIM, flight status |
| 12. Rewards and subscriptions | ❌ | Post-launch |
| Notifications | ⚠️ Local reminders (flight/check-in tomorrow, open nights, document expiry, visa days) | Server push (tokens are stored, nothing sends yet) |
| Security and privacy | ⚠️ Export and delete account, webhook now needs a shared secret | Real sign-in is built but off until Supabase keys arrive; dev sign-in is email-only |

**Fixed in this audit:**
- **Database migrations** for the 18 tables Grok added (hosted Postgres would have been missing them).
- **Forwarding import:**
  - It no longer hands out a `forward.travelos.app` address on a domain we don't own.
  - The inbound webhook now needs `INBOUND_EMAIL_SECRET`.
- **Long trips:** the 62-day itinerary limit is gone.
- **Adaptive Home**, as above.
- **"Find a place to book"** on gaps.
- **Small fixes:**
  - The trip's Docs tab shows only that trip's documents plus general ones.
  - Planned items on Home were labelled "Saved place".
  - Removed outdated assistant wording, a TypeScript error, and the unused "Coming later" screen and template files.

**Changes in the 24 Nov UX pass:**
- **Native map.** Apple Maps on iOS and Google Maps on Android replace the web view and OpenStreetMap tiles. It has a full-screen layout, floating trip and type filters, and a bottom panel with Directions and Open.
  - **Pin them from their addresses:** the phone looks up bookings and places that have no coordinates and saves the result.
  - Every other module then has those coordinates too: the itinerary, Home and the map.
- **Travel Space hub** replaces the "Manage space" dropdown. It has:
  - a hero card with status, dates, timeline, nights sorted (with a progress bar) and booking count
  - four quick actions: Add booking, Import, Add travel, Sync Gmail
  - module tiles with live counts: Expenses, Map, Packing, Documents, Memories, Local life
  - segmented tabs: Itinerary, Calendar, Bookings, Places

  Edit, merge and archive moved behind •••.
- **Modules connected:**
  - Booking prices count toward the trip's cost, shown as "Booked in advance" in Expenses and included in the converted total. Cancelling a booking removes its cost.
  - Saved places have **Plan a day**, which adds them to the itinerary as a plan. Plans can be removed by tapping them.
  - The hub and Home read the same per-trip summary, `GET /travel-spaces/{id}/summary`.
- **UI kit:**
  - haptic feedback on buttons and selections
  - a highlighted border on the field you're typing in
  - softer card and button shadows
  - accessible labels on pressable elements
- **Android release note:** Android store builds need a Google Maps API key, set in the `react-native-maps` plugin (`androidGoogleMapsApiKey`) via `app.config.js`. iOS needs none.

**Product requirements added 24 Nov (beyond PRD v2.0):**
- **Trip photos sync from the gallery automatically.**
  - **Window:** from the day before a trip starts until the day after it ends. Every photo taken is added to that trip with its date, coordinates and place name.
  - **Views:** photos are browsed **by place** or **by day**, open full screen, and appear on the trip map.
  - **Privacy:** images stay in the phone's gallery; Travel OS stores only the reference, date and location.
  - **When it runs:** whenever the app opens (Home or Memories), at most every 30 minutes, and only after you've allowed photo access once. It never shows the permission prompt by itself.
  - **Not yet:** syncing while the app is closed needs a development build with background tasks.
- **Wallet holds real documents.** You upload or scan the passport, visa, insurance, driving licence, International Driving Permit, vaccination record and so on, and tap to show it full screen. A copy is kept on the phone, so it opens offline at a border. Name, number and expiry are optional. Files are private to the owner (`UPLOAD_DIR/documents/<user>/`, to move to S3 when hosted) and deleted with the account.
- **"Your stay" means the current one.** Every screen shows the stay in progress today, else the next one, never just the first hotel booked. Home's ticket tiles open the full list of the trip's flights or stays.
- **Typing is never hidden.** Sheets sit on top of the keyboard, forms scroll the field into view, money fields use a number pad, and "24,50" or "1 000" are understood. Errors name the field and what it needs.
- **Expenses and monthly costs can be deleted** from Expenses and Living.

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
