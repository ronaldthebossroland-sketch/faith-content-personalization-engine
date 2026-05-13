# Faith Content Personalization Engine

A VS Code-ready Node/Express service for consent-first faith-content personalization.

The engine tracks approved interest signals, builds an anonymous profile, and recommends Healing School-style content such as testimonies, prayers, devotionals, Healing Streams updates, and partnership impact stories.

## What changed

- SQLite persistence with `data/local-store.sqlite`
- Admin API key protection for event/consent inspection
- Approved source validation for app and outside-platform signals
- Consent history with explicit scopes
- Retention cleanup using `DATA_RETENTION_DAYS`
- Stronger recommendation scoring with seen-content lowering, preferences, freshness, and source-aware boosts
- Safer Gemini summaries that receive only aggregate, consented signals
- User controls for preferences, reset, turn-off, and delete
- Node test coverage for the privacy-critical flows
- A fuller browser dashboard at `http://localhost:5000`

## Does it look outside the app?

No. It does not secretly inspect a person's phone, browser, other apps, messages, contacts, microphone, emails, or unrelated websites.

It can accept outside-platform interest signals only when all of these are true:

- the outside platform is on `APPROVED_EVENT_SOURCES`
- the user has consented to `approved_platform_activity`
- that approved platform deliberately sends an event to `POST /api/events/track`

Example: an official Healing Streams registration page could send an `external_campaign_click` event. A random website or hidden phone activity cannot.

## What it tracks

Allowed consented signals include:

- search topics
- content viewed
- videos watched
- articles read
- links clicked
- notifications opened
- content saved
- content shared
- program interest
- selected topics
- approved external campaign clicks

## What it must not track

Do not use this system to collect:

- private messages
- passwords
- bank details
- contacts
- microphone recordings
- secret browser history
- unrelated phone activity
- hidden activity from other apps or websites

## Setup

1. Install dependencies:

```bash
npm install
```

2. Create `.env` from `.env.example`, then set a real `ADMIN_API_KEY`.

3. Start the app:

```bash
npm run dev
```

4. Open:

```text
http://localhost:5000
```

Use the value in `PORT` if your local `.env` is set to a different port.

## Environment

```env
HOST=0.0.0.0
PORT=5000
APP_NAME="Healing School Faith Personalization Engine"
DATA_RETENTION_DAYS=365
DECAY_LAMBDA=0.02
ADMIN_API_KEY=change_me_dev_admin_key
APPROVED_EVENT_SOURCES=healing_school_app,healing_streams_registration_page,approved_healing_school_campaign,official_ministry_website,approved_email_campaign
STORAGE_DRIVER=sqlite
DATA_FILE_PATH=data/local-store.sqlite
GEMINI_MODEL=gemini-1.5-flash
GEMINI_API_KEY=your_gemini_api_key_here
```

`GEMINI_API_KEY` is optional. Without it, the app uses local fallback summaries.

## Phone testing

This project will not inspect a phone or other apps without consent. To test safely on your own phone:

1. Keep `HOST=0.0.0.0` in `.env`.
2. Run `npm run dev`.
3. Open the dashboard on your computer and look at the Phone Test panel, or call:

```http
GET /api/network-info
```

4. Open one of the LAN URLs on your phone while it is on the same Wi-Fi network.
5. Create an anonymous user, accept consent scopes, then send approved test signals from the dashboard.

If Windows Firewall blocks the phone, allow Node.js on private networks.

## Main API endpoints

```http
GET /api/health
GET /api/privacy-notice
GET /api/config
GET /api/content
POST /api/users/anonymous
GET /api/users/:anonymousUserId/settings
POST /api/users/:anonymousUserId/preferences
POST /api/consent
POST /api/events/track
GET /api/profiles/:anonymousUserId
GET /api/recommendations/:anonymousUserId
POST /api/profiles/:anonymousUserId/reset
DELETE /api/users/:anonymousUserId
```

Admin endpoints require `x-admin-api-key` or `Authorization: Bearer <key>`:

```http
GET /api/admin/events
GET /api/admin/consent-history
POST /api/admin/retention/run
```

## Consent example

```http
POST /api/consent
Content-Type: application/json

{
  "anonymousUserId": "anon_example",
  "consent": true,
  "consentTextVersion": "1.1",
  "scopes": [
    "app_activity",
    "approved_platform_activity",
    "recommendations",
    "ai_summary"
  ],
  "source": "onboarding"
}
```

## Track event example

```http
POST /api/events/track
Content-Type: application/json

{
  "anonymousUserId": "anon_example",
  "eventType": "external_campaign_click",
  "topic": "Healing Streams registration",
  "contentType": "campaign_link",
  "source": "approved_healing_school_campaign",
  "timeSpentSeconds": 15,
  "metadata": {
    "contentId": "content_009",
    "campaignId": "healing_streams_2026",
    "platform": "approved_healing_school_campaign",
    "page": "registration"
  }
}
```

Only safe metadata fields are stored.

## Testing

```bash
npm test
```

The tests cover:

- blocking tracking before consent
- outside-platform source and scope enforcement
- admin API key enforcement
- retention cleanup
- SQLite persistence across runtime instances

## Production notes

This now uses a local SQLite database, which is much better than memory-only demo storage. For a deployed multi-server production system, move the storage adapter to PostgreSQL, Supabase, Firebase, or another managed database, and keep the same privacy rules:

- explicit consent before tracking
- approved sources only
- short retention by default
- admin authentication
- user reset/delete controls
- aggregate-only AI prompts
