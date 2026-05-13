# Integration Guide — Faith Content Personalization Engine

## Does it run already?

**Yes.** As long as your `.env` file exists and has a valid `GEMINI_API_KEY`, you can start the server right now:

```bash
npm install       # first time only
npm run dev       # starts with auto-reload (development)
npm start         # starts without auto-reload (stable)
```

The server will be live at `http://localhost:5001` (or whatever `PORT` you set in `.env`).

That's it. No database setup, no migrations — it creates `data/local-store.sqlite` automatically on first run.

---

## What you need in `.env`

At minimum:

```env
GEMINI_API_KEY=your_real_key_here   # from aistudio.google.com/app/apikey
PORT=5001
```

Everything else already has sensible defaults.

---

## How to attach this to any project

This is a standalone HTTP API. Your app — website, mobile app, dashboard — talks to it over the network. There are only **3 things your app needs to do**:

### Step 1 — Create an anonymous user (once per device/session)

```http
POST /api/users/anonymous
```

Store the returned `anonymousUserId` locally (localStorage, AsyncStorage, etc). You only do this once per user.

### Step 2 — Record consent (once, after showing the user your privacy notice)

```http
POST /api/consent
{
  "anonymousUserId": "anon_abc123",
  "consent": true,
  "scopes": ["app_activity", "approved_platform_activity", "recommendations", "ai_summary"]
}
```

Skip this step only if `BYPASS_CONSENT=true` in `.env` (dev/testing only).

### Step 3 — Track events as the user engages

Fire this whenever a user watches a video, reads an article, searches, saves, etc:

```http
POST /api/events/track
{
  "anonymousUserId": "anon_abc123",
  "eventType": "video_watched",
  "topic": "healing testimonies",
  "contentType": "video",
  "source": "healing_school_app",
  "timeSpentSeconds": 240
}
```

Then fetch recommendations whenever you want to show personalised content:

```http
GET /api/recommendations/anon_abc123
```

---

## Code snippets

### Vanilla JavaScript / any website

```js
const API = 'http://localhost:5001'; // swap for your deployed URL in production

// Call once on first visit
async function initUser() {
  let userId = localStorage.getItem('anon_user_id');
  if (!userId) {
    const res = await fetch(`${API}/api/users/anonymous`, { method: 'POST' });
    const data = await res.json();
    userId = data.anonymousUserId;
    localStorage.setItem('anon_user_id', userId);
  }
  return userId;
}

// Call after user agrees to personalization
async function giveConsent(userId) {
  await fetch(`${API}/api/consent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      anonymousUserId: userId,
      consent: true,
      scopes: ['app_activity', 'approved_platform_activity', 'recommendations', 'ai_summary']
    })
  });
}

// Call whenever a user engages with content
async function trackEvent(userId, eventType, topic, contentType, timeSpentSeconds = 0) {
  await fetch(`${API}/api/events/track`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      anonymousUserId: userId,
      eventType,
      topic,
      contentType,
      source: 'healing_school_app',
      timeSpentSeconds
    })
  });
}

// Call to get personalised content recommendations
async function getRecommendations(userId) {
  const res = await fetch(`${API}/api/recommendations/${userId}`);
  const data = await res.json();
  return data.recommendations; // array of content items
}
```

### React (web)

```jsx
import { useEffect, useState } from 'react';

const API = process.env.REACT_APP_PROFILER_URL || 'http://localhost:5001';

export function usePersonalization() {
  const [userId, setUserId] = useState(null);

  useEffect(() => {
    async function init() {
      let id = localStorage.getItem('anon_user_id');
      if (!id) {
        const res = await fetch(`${API}/api/users/anonymous`, { method: 'POST' });
        const data = await res.json();
        id = data.anonymousUserId;
        localStorage.setItem('anon_user_id', id);
      }
      setUserId(id);
    }
    init();
  }, []);

  async function track(eventType, topic, contentType, timeSpentSeconds = 0) {
    if (!userId) return;
    await fetch(`${API}/api/events/track`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        anonymousUserId: userId,
        eventType,
        topic,
        contentType,
        source: 'healing_school_app',
        timeSpentSeconds
      })
    });
  }

  async function getRecommendations() {
    if (!userId) return [];
    const res = await fetch(`${API}/api/recommendations/${userId}`);
    const data = await res.json();
    return data.recommendations || [];
  }

  return { userId, track, getRecommendations };
}
```

Usage in a component:

```jsx
const { track, getRecommendations } = usePersonalization();

// When user watches a video
track('video_watched', 'healing testimonies', 'video', 240);

// When user opens a recommendations section
const recs = await getRecommendations();
```

### React Native (mobile app)

```js
import AsyncStorage from '@react-native-async-storage/async-storage';

const API = 'http://192.168.x.x:5001'; // use your LAN IP from /api/network-info when testing on phone

async function initUser() {
  let userId = await AsyncStorage.getItem('anon_user_id');
  if (!userId) {
    const res = await fetch(`${API}/api/users/anonymous`, { method: 'POST' });
    const data = await res.json();
    userId = data.anonymousUserId;
    await AsyncStorage.setItem('anon_user_id', userId);
  }
  return userId;
}

async function trackEvent(userId, eventType, topic, contentType, timeSpentSeconds = 0) {
  await fetch(`${API}/api/events/track`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      anonymousUserId: userId,
      eventType,
      topic,
      contentType,
      source: 'healing_school_app',
      timeSpentSeconds
    })
  });
}
```

For phone testing, get your LAN URL from:
```
GET /api/network-info
```
That endpoint returns all the IP addresses the server is reachable on from your local network.

---

## All available endpoints

| Method | Endpoint | What it does |
|--------|----------|--------------|
| GET | `/api/health` | Check the server is running |
| GET | `/api/privacy-notice` | Get the privacy notice text to show users |
| GET | `/api/config` | Get allowed event types, scopes, sources |
| GET | `/api/content` | Get the full content library |
| GET | `/api/network-info` | Get LAN URLs for phone testing |
| POST | `/api/users/anonymous` | Create a new anonymous user |
| GET | `/api/users/:id/settings` | Get a user's consent and preferences |
| POST | `/api/users/:id/preferences` | Update language, age group, preferred formats |
| POST | `/api/consent` | Save consent (on/off + scopes) |
| POST | `/api/events/track` | Track an interest event |
| GET | `/api/profiles/:id` | Get the full AI profile |
| GET | `/api/recommendations/:id` | Get recommended content + AI summary |
| POST | `/api/profiles/:id/reset` | Clear interest history |
| DELETE | `/api/users/:id` | Delete all user data (GDPR) |
| GET | `/api/admin/events` | See recent events (requires `ADMIN_API_KEY`) |
| GET | `/api/admin/consent-history` | See consent log (requires `ADMIN_API_KEY`) |
| POST | `/api/admin/retention/run` | Manually trigger data retention sweep |

---

## Allowed event types

| Event Type | When to fire |
|---|---|
| `video_watched` | User finishes or watches significant portion of a video |
| `article_read` | User reads an article |
| `content_viewed` | User opens any content item |
| `content_saved` | User saves/bookmarks content |
| `content_shared` | User shares content |
| `search_topic` | User searches for a topic |
| `topic_selected` | User taps a topic tag or category |
| `link_clicked` | User clicks a content link |
| `notification_opened` | User opens a push notification |
| `program_interest` | User shows interest in a program or event |
| `external_campaign_click` | User clicks a link from an approved ministry platform |

---

## Deploying for production

When you're ready to go live:

1. Set `BYPASS_CONSENT=false` in `.env`
2. Change `ADMIN_API_KEY` to something strong and secret
3. Deploy to any Node.js host (Railway, Render, Fly.io, VPS)
4. Set `HOST=0.0.0.0` so the server binds correctly
5. Update your app's API base URL to point at the deployed server

For multi-server production, swap the SQLite adapter for PostgreSQL or Supabase — the privacy logic and all endpoints stay exactly the same.
