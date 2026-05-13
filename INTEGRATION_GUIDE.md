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

### Vue.js

```js
// composables/usePersonalization.js
import { ref } from 'vue';

const API = import.meta.env.VITE_PROFILER_URL || 'http://localhost:5001';

export function usePersonalization() {
  const userId = ref(null);

  async function init() {
    let id = localStorage.getItem('anon_user_id');
    if (!id) {
      const res = await fetch(`${API}/api/users/anonymous`, { method: 'POST' });
      const data = await res.json();
      id = data.anonymousUserId;
      localStorage.setItem('anon_user_id', id);
    }
    userId.value = id;
  }

  async function track(eventType, topic, contentType, timeSpentSeconds = 0) {
    if (!userId.value) return;
    await fetch(`${API}/api/events/track`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        anonymousUserId: userId.value,
        eventType,
        topic,
        contentType,
        source: 'healing_school_app',
        timeSpentSeconds
      })
    });
  }

  async function getRecommendations() {
    if (!userId.value) return [];
    const res = await fetch(`${API}/api/recommendations/${userId.value}`);
    const data = await res.json();
    return data.recommendations || [];
  }

  return { userId, init, track, getRecommendations };
}
```

Usage in a component:

```vue
<script setup>
import { onMounted } from 'vue';
import { usePersonalization } from '@/composables/usePersonalization';

const { init, track, getRecommendations } = usePersonalization();

onMounted(() => init());

function onVideoWatched() {
  track('video_watched', 'healing testimonies', 'video', 240);
}
</script>
```

---

### Next.js (App Router)

```js
// lib/profiler.js
const API = process.env.NEXT_PUBLIC_PROFILER_URL || 'http://localhost:5001';

export async function initUser() {
  let userId = localStorage.getItem('anon_user_id');
  if (!userId) {
    const res = await fetch(`${API}/api/users/anonymous`, { method: 'POST' });
    const data = await res.json();
    userId = data.anonymousUserId;
    localStorage.setItem('anon_user_id', userId);
  }
  return userId;
}

export async function trackEvent(userId, eventType, topic, contentType, timeSpentSeconds = 0) {
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

export async function getRecommendations(userId) {
  const res = await fetch(`${API}/api/recommendations/${userId}`, {
    cache: 'no-store'
  });
  const data = await res.json();
  return data.recommendations || [];
}
```

Usage in a client component:

```jsx
'use client';
import { useEffect } from 'react';
import { initUser, trackEvent, getRecommendations } from '@/lib/profiler';

export default function ContentPage() {
  useEffect(() => { initUser(); }, []);

  async function handleVideoWatch() {
    const userId = localStorage.getItem('anon_user_id');
    await trackEvent(userId, 'video_watched', 'healing testimonies', 'video', 180);
    const recs = await getRecommendations(userId);
    console.log(recs);
  }
}
```

---

### Python

Works in any Python project — Django, Flask, FastAPI, or a standalone script. Requires the `requests` library (`pip install requests`).

```python
import requests
import json
import os

API = os.getenv('PROFILER_URL', 'http://localhost:5001')

def init_user():
    res = requests.post(f'{API}/api/users/anonymous')
    return res.json()['anonymousUserId']

def give_consent(user_id):
    requests.post(f'{API}/api/consent', json={
        'anonymousUserId': user_id,
        'consent': True,
        'scopes': ['app_activity', 'approved_platform_activity', 'recommendations', 'ai_summary']
    })

def track_event(user_id, event_type, topic, content_type, time_spent_seconds=0):
    requests.post(f'{API}/api/events/track', json={
        'anonymousUserId': user_id,
        'eventType': event_type,
        'topic': topic,
        'contentType': content_type,
        'source': 'healing_school_app',
        'timeSpentSeconds': time_spent_seconds
    })

def get_recommendations(user_id):
    res = requests.get(f'{API}/api/recommendations/{user_id}')
    return res.json().get('recommendations', [])
```

Django example — store the user ID in the session:

```python
# views.py
def home(request):
    if 'anon_user_id' not in request.session:
        request.session['anon_user_id'] = init_user()

    track_event(
        request.session['anon_user_id'],
        'content_viewed',
        'healing testimonies',
        'video'
    )
    recs = get_recommendations(request.session['anon_user_id'])
    return render(request, 'home.html', {'recommendations': recs})
```

---

### PHP

```php
<?php
define('PROFILER_API', getenv('PROFILER_URL') ?: 'http://localhost:5001');

function profiler_request(string $method, string $endpoint, array $body = []): array {
    $ch = curl_init(PROFILER_API . $endpoint);
    curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
    curl_setopt($ch, CURLOPT_CUSTOMREQUEST, $method);
    if (!empty($body)) {
        curl_setopt($ch, CURLOPT_POSTFIELDS, json_encode($body));
        curl_setopt($ch, CURLOPT_HTTPHEADER, ['Content-Type: application/json']);
    }
    $result = json_decode(curl_exec($ch), true);
    curl_close($ch);
    return $result;
}

function init_user(): string {
    $data = profiler_request('POST', '/api/users/anonymous');
    return $data['anonymousUserId'];
}

function give_consent(string $userId): void {
    profiler_request('POST', '/api/consent', [
        'anonymousUserId' => $userId,
        'consent' => true,
        'scopes' => ['app_activity', 'approved_platform_activity', 'recommendations', 'ai_summary']
    ]);
}

function track_event(string $userId, string $eventType, string $topic, string $contentType, int $timeSpentSeconds = 0): void {
    profiler_request('POST', '/api/events/track', [
        'anonymousUserId'  => $userId,
        'eventType'        => $eventType,
        'topic'            => $topic,
        'contentType'      => $contentType,
        'source'           => 'healing_school_app',
        'timeSpentSeconds' => $timeSpentSeconds
    ]);
}

function get_recommendations(string $userId): array {
    $data = profiler_request('GET', '/api/recommendations/' . $userId);
    return $data['recommendations'] ?? [];
}
?>
```

Usage:

```php
<?php
session_start();
require_once 'profiler.php';

if (!isset($_SESSION['anon_user_id'])) {
    $_SESSION['anon_user_id'] = init_user();
}

track_event($_SESSION['anon_user_id'], 'content_viewed', 'prayer', 'article');
$recs = get_recommendations($_SESSION['anon_user_id']);
?>
```

---

### Swift (iOS)

```swift
import Foundation

class FaithProfiler {
    static let shared = FaithProfiler()
    private let api = "http://localhost:5001" // swap for deployed URL
    private let userIdKey = "anon_user_id"

    var userId: String? {
        get { UserDefaults.standard.string(forKey: userIdKey) }
        set { UserDefaults.standard.set(newValue, forKey: userIdKey) }
    }

    func initUser() async {
        guard userId == nil else { return }
        guard let url = URL(string: "\(api)/api/users/anonymous") else { return }
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        if let (data, _) = try? await URLSession.shared.data(for: request),
           let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
           let id = json["anonymousUserId"] as? String {
            userId = id
        }
    }

    func giveConsent() async {
        guard let id = userId,
              let url = URL(string: "\(api)/api/consent") else { return }
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try? JSONSerialization.data(withJSONObject: [
            "anonymousUserId": id,
            "consent": true,
            "scopes": ["app_activity", "approved_platform_activity", "recommendations", "ai_summary"]
        ])
        try? await URLSession.shared.data(for: request)
    }

    func trackEvent(eventType: String, topic: String, contentType: String, timeSpent: Int = 0) async {
        guard let id = userId,
              let url = URL(string: "\(api)/api/events/track") else { return }
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try? JSONSerialization.data(withJSONObject: [
            "anonymousUserId": id,
            "eventType": eventType,
            "topic": topic,
            "contentType": contentType,
            "source": "healing_school_app",
            "timeSpentSeconds": timeSpent
        ])
        try? await URLSession.shared.data(for: request)
    }

    func getRecommendations() async -> [[String: Any]] {
        guard let id = userId,
              let url = URL(string: "\(api)/api/recommendations/\(id)") else { return [] }
        if let (data, _) = try? await URLSession.shared.data(from: url),
           let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
           let recs = json["recommendations"] as? [[String: Any]] {
            return recs
        }
        return []
    }
}
```

Usage in a SwiftUI view:

```swift
.onAppear {
    Task {
        await FaithProfiler.shared.initUser()
        await FaithProfiler.shared.trackEvent(
            eventType: "content_viewed",
            topic: "healing testimonies",
            contentType: "video"
        )
    }
}
```

---

### Kotlin (Android)

Add to `build.gradle`: `implementation 'com.squareup.okhttp3:okhttp:4.12.0'`

```kotlin
import okhttp3.*
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONObject
import android.content.Context

object FaithProfiler {
    private const val API = "http://192.168.x.x:5001" // use LAN IP for device testing
    private const val KEY = "anon_user_id"
    private val client = OkHttpClient()
    private val JSON = "application/json".toMediaType()

    private fun post(endpoint: String, body: JSONObject): JSONObject? {
        val request = Request.Builder()
            .url("$API$endpoint")
            .post(body.toString().toRequestBody(JSON))
            .build()
        return client.newCall(request).execute().use {
            if (it.isSuccessful) JSONObject(it.body!!.string()) else null
        }
    }

    fun initUser(context: Context) {
        val prefs = context.getSharedPreferences("profiler", Context.MODE_PRIVATE)
        if (prefs.getString(KEY, null) != null) return
        val result = post("/api/users/anonymous", JSONObject()) ?: return
        prefs.edit().putString(KEY, result.getString("anonymousUserId")).apply()
    }

    fun giveConsent(context: Context) {
        val userId = getUserId(context) ?: return
        post("/api/consent", JSONObject().apply {
            put("anonymousUserId", userId)
            put("consent", true)
            put("scopes", org.json.JSONArray(listOf("app_activity", "approved_platform_activity", "recommendations", "ai_summary")))
        })
    }

    fun trackEvent(context: Context, eventType: String, topic: String, contentType: String, timeSpent: Int = 0) {
        val userId = getUserId(context) ?: return
        post("/api/events/track", JSONObject().apply {
            put("anonymousUserId", userId)
            put("eventType", eventType)
            put("topic", topic)
            put("contentType", contentType)
            put("source", "healing_school_app")
            put("timeSpentSeconds", timeSpent)
        })
    }

    private fun getUserId(context: Context): String? {
        return context.getSharedPreferences("profiler", Context.MODE_PRIVATE).getString(KEY, null)
    }
}
```

Usage (run in a coroutine or background thread — never on the main thread):

```kotlin
lifecycleScope.launch(Dispatchers.IO) {
    FaithProfiler.initUser(context)
    FaithProfiler.trackEvent(context, "video_watched", "healing testimonies", "video", 240)
}
```

---

### Flutter / Dart

```dart
import 'dart:convert';
import 'package:http/http.dart' as http;
import 'package:shared_preferences/shared_preferences.dart';

class FaithProfiler {
  static const String _api = 'http://localhost:5001'; // swap for deployed URL
  static const String _key = 'anon_user_id';

  static Future<String> initUser() async {
    final prefs = await SharedPreferences.getInstance();
    String? userId = prefs.getString(_key);
    if (userId == null) {
      final res = await http.post(Uri.parse('$_api/api/users/anonymous'));
      final data = jsonDecode(res.body);
      userId = data['anonymousUserId'];
      await prefs.setString(_key, userId!);
    }
    return userId!;
  }

  static Future<void> giveConsent(String userId) async {
    await http.post(
      Uri.parse('$_api/api/consent'),
      headers: {'Content-Type': 'application/json'},
      body: jsonEncode({
        'anonymousUserId': userId,
        'consent': true,
        'scopes': ['app_activity', 'approved_platform_activity', 'recommendations', 'ai_summary'],
      }),
    );
  }

  static Future<void> trackEvent(
    String userId,
    String eventType,
    String topic,
    String contentType, {
    int timeSpentSeconds = 0,
  }) async {
    await http.post(
      Uri.parse('$_api/api/events/track'),
      headers: {'Content-Type': 'application/json'},
      body: jsonEncode({
        'anonymousUserId': userId,
        'eventType': eventType,
        'topic': topic,
        'contentType': contentType,
        'source': 'healing_school_app',
        'timeSpentSeconds': timeSpentSeconds,
      }),
    );
  }

  static Future<List<dynamic>> getRecommendations(String userId) async {
    final res = await http.get(Uri.parse('$_api/api/recommendations/$userId'));
    final data = jsonDecode(res.body);
    return data['recommendations'] ?? [];
  }
}
```

Usage in a widget:

```dart
@override
void initState() {
  super.initState();
  _setup();
}

Future<void> _setup() async {
  final userId = await FaithProfiler.initUser();
  await FaithProfiler.trackEvent(userId, 'content_viewed', 'prayer', 'article');
  final recs = await FaithProfiler.getRecommendations(userId);
  setState(() => _recommendations = recs);
}
```

Add dependencies to `pubspec.yaml`:
```yaml
dependencies:
  http: ^1.2.0
  shared_preferences: ^2.2.0
```

---

### C# (.NET / Unity / MAUI)

```csharp
using System.Net.Http;
using System.Text;
using System.Text.Json;

public class FaithProfiler
{
    private static readonly HttpClient _client = new();
    private const string Api = "http://localhost:5001"; // swap for deployed URL
    private string? _userId;

    public async Task InitUserAsync()
    {
        _userId = await SecureStorage.GetAsync("anon_user_id");
        if (_userId != null) return;

        var res = await _client.PostAsync($"{Api}/api/users/anonymous", null);
        var json = await JsonDocument.ParseAsync(await res.Content.ReadAsStreamAsync());
        _userId = json.RootElement.GetProperty("anonymousUserId").GetString();
        await SecureStorage.SetAsync("anon_user_id", _userId!);
    }

    public async Task GiveConsentAsync()
    {
        if (_userId == null) return;
        var body = JsonSerializer.Serialize(new {
            anonymousUserId = _userId,
            consent = true,
            scopes = new[] { "app_activity", "approved_platform_activity", "recommendations", "ai_summary" }
        });
        await _client.PostAsync($"{Api}/api/consent",
            new StringContent(body, Encoding.UTF8, "application/json"));
    }

    public async Task TrackEventAsync(string eventType, string topic, string contentType, int timeSpentSeconds = 0)
    {
        if (_userId == null) return;
        var body = JsonSerializer.Serialize(new {
            anonymousUserId = _userId,
            eventType,
            topic,
            contentType,
            source = "healing_school_app",
            timeSpentSeconds
        });
        await _client.PostAsync($"{Api}/api/events/track",
            new StringContent(body, Encoding.UTF8, "application/json"));
    }

    public async Task<JsonElement> GetRecommendationsAsync()
    {
        if (_userId == null) return default;
        var res = await _client.GetAsync($"{Api}/api/recommendations/{_userId}");
        var json = await JsonDocument.ParseAsync(await res.Content.ReadAsStreamAsync());
        return json.RootElement.GetProperty("recommendations");
    }
}
```

For **Unity**, replace `SecureStorage` with `PlayerPrefs`:
```csharp
// Save
PlayerPrefs.SetString("anon_user_id", userId);
// Load
string userId = PlayerPrefs.GetString("anon_user_id", null);
```

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
