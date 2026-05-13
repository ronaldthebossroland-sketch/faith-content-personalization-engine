require('dotenv').config();

const fs = require('fs');
const os = require('os');
const path = require('path');
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const { v4: uuidv4 } = require('uuid');
const { GoogleGenerativeAI } = require('@google/generative-ai');

let DatabaseSync = null;
try {
  ({ DatabaseSync } = require('node:sqlite'));
} catch {
  DatabaseSync = null;
}

const defaultContentLibrary = [
  {
    id: 'content_001',
    title: 'Faith for Healing: Strength for Today',
    topic: 'faith_for_healing',
    type: 'short_video',
    url: '/content/faith-for-healing',
    language: 'en',
    ageGroup: 'adult',
    freshnessRank: 7
  },
  {
    id: 'content_002',
    title: 'Healing Streams Testimony Highlights',
    topic: 'healing_testimonies',
    type: 'video',
    url: '/content/healing-streams-testimonies',
    language: 'en',
    ageGroup: 'general',
    freshnessRank: 9
  },
  {
    id: 'content_003',
    title: 'Prayer Preparation for Healing Streams',
    topic: 'prayer',
    type: 'article',
    url: '/content/prayer-preparation',
    language: 'en',
    ageGroup: 'adult',
    freshnessRank: 8
  },
  {
    id: 'content_004',
    title: 'Partnership Impact: Reaching the Nations',
    topic: 'partnership_impact',
    type: 'video',
    url: '/content/partnership-impact',
    language: 'en',
    ageGroup: 'adult',
    freshnessRank: 5
  },
  {
    id: 'content_005',
    title: 'Daily Devotional: Growing in the Word',
    topic: 'devotional',
    type: 'article',
    url: '/content/daily-devotional',
    language: 'en',
    ageGroup: 'general',
    freshnessRank: 10
  },
  {
    id: 'content_006',
    title: 'Family and Children Healing Testimonies',
    topic: 'family_healing',
    type: 'video',
    url: '/content/family-healing',
    language: 'en',
    ageGroup: 'family',
    freshnessRank: 6
  },
  {
    id: 'content_007',
    title: 'How to Prepare for Healing Streams Live Healing Services',
    topic: 'healing_streams',
    type: 'guide',
    url: '/content/prepare-for-healing-streams',
    language: 'en',
    ageGroup: 'general',
    freshnessRank: 8
  },
  {
    id: 'content_008',
    title: 'Short Faith Confessions for Your Day',
    topic: 'faith_confessions',
    type: 'short_video',
    url: '/content/faith-confessions',
    language: 'en',
    ageGroup: 'general',
    freshnessRank: 9
  },
  {
    id: 'content_009',
    title: 'Healing Streams Registration Guide',
    topic: 'healing_streams',
    type: 'guide',
    url: '/content/healing-streams-registration',
    language: 'en',
    ageGroup: 'general',
    freshnessRank: 10
  },
  {
    id: 'content_010',
    title: 'Faith-Filled Testimonies for Families',
    topic: 'family_healing',
    type: 'article',
    url: '/content/family-testimonies',
    language: 'en',
    ageGroup: 'family',
    freshnessRank: 7
  }
];

const allowedEventTypes = new Set([
  'search_topic',
  'content_viewed',
  'video_watched',
  'article_read',
  'link_clicked',
  'notification_opened',
  'content_saved',
  'content_shared',
  'program_interest',
  'topic_selected',
  'external_campaign_click'
]);

const allowedConsentScopes = new Set([
  'app_activity',
  'approved_platform_activity',
  'recommendations',
  'ai_summary'
]);

const defaultConsentScopes = [
  'app_activity',
  'approved_platform_activity',
  'recommendations',
  'ai_summary'
];

const topicAliases = {
  healing: 'healing_testimonies',
  testimony: 'healing_testimonies',
  testimonies: 'healing_testimonies',
  prayer: 'prayer',
  pray: 'prayer',
  partner: 'partnership_impact',
  partnership: 'partnership_impact',
  devotional: 'devotional',
  family: 'family_healing',
  children: 'family_healing',
  kids: 'family_healing',
  faith: 'faith_for_healing',
  streams: 'healing_streams',
  'healing streams': 'healing_streams',
  confession: 'faith_confessions',
  confessions: 'faith_confessions'
};

function parseList(value, fallback) {
  if (!value) return fallback;
  const parsed = String(value)
    .split(',')
    .map(item => item.trim())
    .filter(Boolean);
  return parsed.length ? parsed : fallback;
}

function parsePositiveInt(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function parsePositiveFloat(value, fallback) {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function normalizeKey(value = '', fallback = 'unknown') {
  const normalized = String(value)
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return normalized || fallback;
}

function normalizeTopic(rawTopic = '') {
  const text = String(rawTopic).toLowerCase().trim();
  if (!text) return 'general_faith_content';

  for (const [keyword, topic] of Object.entries(topicAliases)) {
    if (text.includes(keyword)) return topic;
  }

  return normalizeKey(text, 'general_faith_content');
}

function getWeight(eventType, timeSpentSeconds = 0) {
  const baseWeights = {
    search_topic: 4,
    content_viewed: 5,
    video_watched: 8,
    article_read: 7,
    link_clicked: 4,
    notification_opened: 3,
    content_saved: 12,
    content_shared: 14,
    program_interest: 15,
    topic_selected: 16,
    external_campaign_click: 6
  };

  const safeSeconds = Math.max(0, Math.min(Number(timeSpentSeconds || 0), 28800));
  const base = baseWeights[eventType] || 3;
  const timeBonus = Math.min(Math.floor(safeSeconds / 60), 10);
  return base + timeBonus;
}

function getConfig(options = {}) {
  const defaultSources = [
    'healing_school_app',
    'healing_streams_registration_page',
    'approved_healing_school_campaign',
    'official_ministry_website',
    'approved_email_campaign'
  ];
  const storageDriver = options.storageDriver || process.env.STORAGE_DRIVER || (DatabaseSync ? 'sqlite' : 'json');
  const defaultDataFile = storageDriver === 'sqlite'
    ? path.join(__dirname, '../data/local-store.sqlite')
    : path.join(__dirname, '../data/local-store.json');

  return {
    appName: options.appName || process.env.APP_NAME || 'Faith Content Personalization Engine',
    host: options.host || process.env.HOST || '127.0.0.1',
    port: options.port || process.env.PORT || 5000,
    adminApiKey: options.adminApiKey ?? process.env.ADMIN_API_KEY,
    approvedEventSources: parseList(options.approvedEventSources || process.env.APPROVED_EVENT_SOURCES, defaultSources)
      .map(source => normalizeKey(source, 'unknown')),
    dataRetentionDays: parsePositiveInt(options.dataRetentionDays || process.env.DATA_RETENTION_DAYS, 365),
    decayLambda: parsePositiveFloat(options.decayLambda || process.env.DECAY_LAMBDA, 0.02),
    storageDriver,
    dataFilePath: options.dataFilePath || process.env.DATA_FILE_PATH || defaultDataFile,
    geminiApiKey: options.geminiApiKey ?? process.env.GEMINI_API_KEY,
    geminiModel: options.geminiModel || process.env.GEMINI_MODEL || 'gemini-1.5-flash',
    logRequests: options.logRequests ?? process.env.NODE_ENV !== 'test',
    bypassConsent: options.bypassConsent ?? (process.env.BYPASS_CONSENT === 'true')
  };
}

function getLanUrls(port) {
  const interfaces = os.networkInterfaces();
  const urls = [];

  for (const addresses of Object.values(interfaces)) {
    for (const address of addresses || []) {
      if (address.family === 'IPv4' && !address.internal) {
        urls.push(`http://${address.address}:${port}`);
      }
    }
  }

  return urls;
}

function createEmptyStore() {
  return {
    users: {},
    events: [],
    consentHistory: [],
    contentLibrary: defaultContentLibrary
  };
}

function migrateStore(rawStore) {
  const store = {
    ...createEmptyStore(),
    ...rawStore
  };

  store.users = store.users && typeof store.users === 'object' ? store.users : {};
  store.events = Array.isArray(store.events) ? store.events : [];
  store.consentHistory = Array.isArray(store.consentHistory) ? store.consentHistory : [];
  store.contentLibrary = Array.isArray(store.contentLibrary) && store.contentLibrary.length
    ? store.contentLibrary
    : defaultContentLibrary;

  for (const user of Object.values(store.users)) {
    user.createdAt = user.createdAt || new Date().toISOString();
    user.consent = Boolean(user.consent);
    user.consentTextVersion = user.consentTextVersion || null;
    user.consentUpdatedAt = user.consentUpdatedAt || user.lastUpdatedAt || null;
    user.consentScopes = Array.isArray(user.consentScopes)
      ? user.consentScopes.filter(scope => allowedConsentScopes.has(scope))
      : (user.consent ? defaultConsentScopes : []);
    user.preferences = normalizePreferences(user.preferences || {});
    user.lastUpdatedAt = user.lastUpdatedAt || null;
  }

  return store;
}

function openSqlite(filePath) {
  if (!DatabaseSync) throw new Error('node:sqlite is not available in this Node.js runtime.');
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const db = new DatabaseSync(filePath);
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      anonymous_user_id TEXT PRIMARY KEY,
      data TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS events (
      id TEXT PRIMARY KEY,
      anonymous_user_id TEXT NOT NULL,
      data TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_events_user ON events (anonymous_user_id);
    CREATE INDEX IF NOT EXISTS idx_events_created_at ON events (created_at);
    CREATE TABLE IF NOT EXISTS consent_history (
      id TEXT PRIMARY KEY,
      anonymous_user_id TEXT NOT NULL,
      data TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_consent_user ON consent_history (anonymous_user_id);
    CREATE TABLE IF NOT EXISTS content_library (
      id TEXT PRIMARY KEY,
      data TEXT NOT NULL
    );
  `);
  return db;
}

function loadJsonStore(filePath) {
  try {
    if (!fs.existsSync(filePath)) return createEmptyStore();
    const raw = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    return migrateStore(raw);
  } catch (err) {
    console.warn(`Could not load local store at ${filePath}: ${err.message}`);
    return createEmptyStore();
  }
}

function writeJsonStore(filePath, store) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.tmp`;
  fs.writeFileSync(tempPath, JSON.stringify(store, null, 2));
  fs.renameSync(tempPath, filePath);
}

function loadSqliteStore(filePath) {
  let db;
  try {
    db = openSqlite(filePath);
    const store = createEmptyStore();

    const userRows = db.prepare('SELECT data FROM users').all();
    for (const row of userRows) {
      const user = JSON.parse(row.data);
      store.users[user.anonymousUserId] = user;
    }

    const eventRows = db.prepare('SELECT data FROM events ORDER BY created_at ASC').all();
    store.events = eventRows.map(row => JSON.parse(row.data));

    const consentRows = db.prepare('SELECT data FROM consent_history ORDER BY created_at ASC').all();
    store.consentHistory = consentRows.map(row => JSON.parse(row.data));

    const contentRows = db.prepare('SELECT data FROM content_library').all();
    if (contentRows.length) {
      store.contentLibrary = contentRows.map(row => JSON.parse(row.data));
    } else {
      const insertContent = db.prepare('INSERT INTO content_library (id, data) VALUES (?, ?)');
      db.exec('BEGIN');
      try {
        for (const item of defaultContentLibrary) {
          insertContent.run(item.id, JSON.stringify(item));
        }
        db.exec('COMMIT');
      } catch (err) {
        db.exec('ROLLBACK');
        throw err;
      }
      store.contentLibrary = defaultContentLibrary;
    }

    return migrateStore(store);
  } catch (err) {
    console.warn(`Could not load SQLite store at ${filePath}: ${err.message}`);
    return createEmptyStore();
  } finally {
    if (db) db.close();
  }
}

function writeSqliteStore(filePath, store) {
  let db;
  try {
    db = openSqlite(filePath);
    const insertUser = db.prepare('INSERT INTO users (anonymous_user_id, data, updated_at) VALUES (?, ?, ?)');
    const insertEvent = db.prepare('INSERT INTO events (id, anonymous_user_id, data, created_at) VALUES (?, ?, ?, ?)');
    const insertConsent = db.prepare('INSERT INTO consent_history (id, anonymous_user_id, data, created_at) VALUES (?, ?, ?, ?)');
    const insertContent = db.prepare('INSERT INTO content_library (id, data) VALUES (?, ?)');

    db.exec('BEGIN');
    try {
      db.exec('DELETE FROM users; DELETE FROM events; DELETE FROM consent_history; DELETE FROM content_library;');

      for (const user of Object.values(store.users)) {
        insertUser.run(user.anonymousUserId, JSON.stringify(user), user.lastUpdatedAt || user.createdAt || new Date().toISOString());
      }

      for (const event of store.events) {
        insertEvent.run(event.id, event.anonymousUserId, JSON.stringify(event), event.createdAt);
      }

      for (const consent of store.consentHistory) {
        insertConsent.run(consent.id, consent.anonymousUserId, JSON.stringify(consent), consent.createdAt);
      }

      for (const item of store.contentLibrary) {
        insertContent.run(item.id, JSON.stringify(item));
      }

      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
  } finally {
    if (db) db.close();
  }
}

function loadStore(config) {
  if (config.storageDriver === 'sqlite' && DatabaseSync) return loadSqliteStore(config.dataFilePath);
  return loadJsonStore(config.dataFilePath);
}

function writeStore(config, store) {
  if (config.storageDriver === 'sqlite' && DatabaseSync) {
    writeSqliteStore(config.dataFilePath, store);
    return;
  }

  writeJsonStore(config.dataFilePath, store);
}

function normalizePreferences(preferences = {}) {
  const preferredFormats = Array.isArray(preferences.preferredFormats)
    ? preferences.preferredFormats.map(item => normalizeKey(item)).filter(Boolean).slice(0, 5)
    : [];

  const preferredTopics = Array.isArray(preferences.preferredTopics)
    ? preferences.preferredTopics.map(item => normalizeTopic(item)).filter(Boolean).slice(0, 10)
    : [];

  const blockedTopics = Array.isArray(preferences.blockedTopics)
    ? preferences.blockedTopics.map(item => normalizeTopic(item)).filter(Boolean).slice(0, 10)
    : [];

  return {
    language: normalizeKey(preferences.language || 'en', 'en'),
    country: normalizeKey(preferences.country || 'unspecified', 'unspecified'),
    ageGroup: normalizeKey(preferences.ageGroup || 'general', 'general'),
    preferredFormats,
    preferredTopics,
    blockedTopics
  };
}

function sanitizeMetadata(metadata = {}) {
  return {
    contentId: metadata.contentId ? String(metadata.contentId).slice(0, 80) : undefined,
    campaignId: metadata.campaignId ? String(metadata.campaignId).slice(0, 80) : undefined,
    platform: metadata.platform ? normalizeKey(metadata.platform) : undefined,
    page: metadata.page ? String(metadata.page).slice(0, 120) : undefined,
    placement: metadata.placement ? normalizeKey(metadata.placement) : undefined,
    language: metadata.language ? normalizeKey(metadata.language, 'en') : undefined
  };
}

function buildSourceCounts(events) {
  return events.reduce((counts, event) => {
    counts[event.source] = (counts[event.source] || 0) + 1;
    return counts;
  }, {});
}

function isGeminiKeyUsable(key) {
  if (!key) return false;
  const normalized = String(key).trim();
  return Boolean(normalized) && normalized !== 'your_gemini_api_key_here';
}

function createRuntime(options = {}) {
  const config = getConfig(options);
  const store = migrateStore(loadStore(config));
  const approvedSourceSet = new Set(config.approvedEventSources);
  const genAI = isGeminiKeyUsable(config.geminiApiKey)
    ? new GoogleGenerativeAI(config.geminiApiKey)
    : null;

  function saveStore() {
    writeStore(config, store);
  }

  function pruneExpiredEvents() {
    const cutoff = Date.now() - (config.dataRetentionDays * 86400000);
    const before = store.events.length;
    store.events = store.events.filter(event => {
      const createdAt = new Date(event.createdAt).getTime();
      return Number.isFinite(createdAt) && createdAt >= cutoff;
    });
    const removed = before - store.events.length;
    if (removed > 0) saveStore();
    return removed;
  }

  function ensureUser(anonymousUserId, preferences = {}) {
    if (!store.users[anonymousUserId]) {
      store.users[anonymousUserId] = {
        anonymousUserId,
        createdAt: new Date().toISOString(),
        consent: false,
        consentTextVersion: null,
        consentUpdatedAt: null,
        consentScopes: [],
        preferences: normalizePreferences(preferences),
        lastUpdatedAt: null
      };
    }

    store.users[anonymousUserId].preferences = normalizePreferences(store.users[anonymousUserId].preferences || {});
    return store.users[anonymousUserId];
  }

  function userEventsFor(anonymousUserId) {
    return store.events.filter(event => event.anonymousUserId === anonymousUserId);
  }

  function calculateDecayedScores(anonymousUserId) {
    const userEvents = userEventsFor(anonymousUserId);
    const topicScores = {};
    const contentTypeScores = {};
    const eventTypeCounts = {};
    const now = Date.now();

    for (const event of userEvents) {
      const createdAt = new Date(event.createdAt).getTime();
      if (!Number.isFinite(createdAt)) continue;
      const ageInDays = Math.max(0, (now - createdAt) / 86400000);
      const decayFactor = Math.exp(-config.decayLambda * ageInDays);
      const weight = getWeight(event.eventType, event.timeSpentSeconds) * decayFactor;

      topicScores[event.topic] = (topicScores[event.topic] || 0) + weight;
      contentTypeScores[event.contentType] = (contentTypeScores[event.contentType] || 0) + weight;
      eventTypeCounts[event.eventType] = (eventTypeCounts[event.eventType] || 0) + 1;
    }

    return {
      topicScores,
      contentTypeScores,
      eventTypeCounts,
      sourceCounts: buildSourceCounts(userEvents),
      totalEvents: userEvents.length,
      seenContentIds: userEvents
        .map(event => event.metadata?.contentId)
        .filter(Boolean)
    };
  }

  function detectPersona(topTopics, eventTypeCounts) {
    if (!topTopics.length) return 'New Visitor';

    const topicSet = new Set(topTopics.map(topic => topic.topic));
    const searches = eventTypeCounts.search_topic || 0;
    const saves = eventTypeCounts.content_saved || 0;
    const shares = eventTypeCounts.content_shared || 0;
    const programInterest = eventTypeCounts.program_interest || 0;

    const healingTopics = ['healing_testimonies', 'faith_for_healing', 'healing_streams'];
    const devotionalTopics = ['devotional', 'prayer', 'faith_confessions'];

    const healingOverlap = healingTopics.filter(topic => topicSet.has(topic)).length;
    const devotionalOverlap = devotionalTopics.filter(topic => topicSet.has(topic)).length;

    if (topTopics[0]?.topic === 'partnership_impact' || shares >= 3 || programInterest >= 2) return 'Ministry Partner';
    if (topicSet.has('family_healing') && healingOverlap >= 1) return 'Caregiver';
    if (healingOverlap >= 2) return 'Healing-Focused Believer';
    if (devotionalOverlap >= 2 || saves >= 3) return 'Devotional Learner';
    if (searches > (saves + shares) * 2) return 'Active Seeker';
    return 'General Believer';
  }

  async function generateAISummary({
    user,
    persona,
    engagementLevel,
    topTopics,
    preferredContentType,
    eventTypeCounts,
    sourceCounts,
    totalEvents,
    accountAgeDays,
    daysSinceLastActivity
  }) {
    const fallback = topTopics.length
      ? `This user is a ${persona} with ${engagementLevel} engagement, drawn to ${topTopics.slice(0, 3).map(topic => topic.topic.replace(/_/g, ' ')).join(', ')}. Serve them more ${preferredContentType.replace(/_/g, ' ')} content and keep recommendations aligned with their consented activity.`
      : 'New user with no tracked activity yet. Serve general faith-building content, healing testimonies, and a clear path to Healing Streams resources.';

    if (!config.bypassConsent && !user.consentScopes.includes('ai_summary')) {
      return {
        aiSummary: fallback,
        recommendationRationale: 'AI summary scope is not enabled for this user, so the app used a local fallback summary.',
        aiSummarySource: 'local_fallback'
      };
    }

    if (!genAI) {
      return {
        aiSummary: fallback,
        recommendationRationale: 'Set GEMINI_API_KEY in your .env file to unlock Gemini-powered rationale.',
        aiSummarySource: 'local_fallback'
      };
    }

    const topicsReadable = topTopics.slice(0, 5)
      .map(topic => `${topic.topic.replace(/_/g, ' ')} (score: ${Math.round(topic.score)})`)
      .join(', ');

    const eventBreakdown = Object.entries(eventTypeCounts)
      .map(([type, count]) => `${type}: ${count}`)
      .join(', ');

    const sourceBreakdown = Object.entries(sourceCounts)
      .map(([source, count]) => `${source}: ${count}`)
      .join(', ');

    const prompt = `You are an AI audience profiler for a Christian faith-content app focused on healing, faith, prayer, testimonies, devotionals, and ministry resources.

Use only the aggregate, consented signals below. Do not infer private identity, health condition, finances, family status, location precision, or activity outside approved ministry platforms.

USER SIGNALS:
- Persona archetype: ${persona}
- Engagement level: ${engagementLevel}
- Top interest topics with decay-adjusted scores: ${topicsReadable || 'none yet'}
- Preferred content format: ${preferredContentType}
- Event breakdown: ${eventBreakdown || 'none'}
- Approved source breakdown: ${sourceBreakdown || 'none'}
- Total tracked interactions: ${totalEvents}
- Account age: ${accountAgeDays} days
- Last active: ${daysSinceLastActivity} days ago
- Voluntary preferences: language ${user.preferences.language}, age group ${user.preferences.ageGroup}

Respond only with valid JSON:
{
  "aiSummary": "2-3 warm, specific sentences about how to serve this user with faith-based content.",
  "recommendationRationale": "1-2 sentences explaining the recommendation strategy from these aggregate signals."
}`;

    try {
      const model = genAI.getGenerativeModel({ model: config.geminiModel });
      const result = await model.generateContent(prompt);
      const raw = result.response.text().replace(/```json|```/g, '').trim();
      const parsed = JSON.parse(raw);
      return {
        aiSummary: parsed.aiSummary || fallback,
        recommendationRationale: parsed.recommendationRationale || 'Recommendations are based on consented aggregate interest signals.',
        aiSummarySource: config.geminiModel
      };
    } catch (err) {
      return {
        aiSummary: fallback,
        recommendationRationale: `Gemini summary failed, so the app used a local fallback. ${err.message}`,
        aiSummarySource: 'local_fallback'
      };
    }
  }

  function recommendContent(sortedTopics, sortedContentTypes, user, seenContentIds) {
    const topicScoreMap = new Map(sortedTopics.map(topic => [topic.topic, topic.score]));
    const seenSet = new Set(seenContentIds);
    const preferredContentType = sortedContentTypes[0]?.type || 'mixed_content';
    const preference = user.preferences;
    const blockedTopics = new Set(preference.blockedTopics);
    const preferredFormats = new Set(preference.preferredFormats);
    const preferredTopics = new Set(preference.preferredTopics);

    return store.contentLibrary
      .filter(item => !blockedTopics.has(item.topic))
      .map(item => {
        let score = Number(item.freshnessRank || 0);
        const reasons = [];

        const topicScore = topicScoreMap.get(item.topic) || 0;
        if (topicScore > 0) {
          score += topicScore * 3;
          reasons.push('matches top interest');
        }

        if (item.type === preferredContentType) {
          score += 12;
          reasons.push('matches preferred format');
        }

        if (preferredFormats.has(item.type)) {
          score += 10;
          reasons.push('matches chosen format');
        }

        if (preferredTopics.has(item.topic)) {
          score += 15;
          reasons.push('matches chosen topic');
        }

        if (item.language === preference.language) {
          score += 6;
          reasons.push('matches language preference');
        }

        if (item.ageGroup === preference.ageGroup || item.ageGroup === 'general') {
          score += 4;
          reasons.push('fits audience preference');
        }

        if (user.consentScopes.includes('approved_platform_activity') && item.topic === 'healing_streams') {
          score += 3;
        }

        if (seenSet.has(item.id)) {
          score -= 18;
          reasons.push('already seen, lowered priority');
        }

        return {
          ...item,
          recommendationScore: Math.round(score),
          reasons: reasons.length ? reasons : ['general faith-building fallback']
        };
      })
      .sort((a, b) => b.recommendationScore - a.recommendationScore)
      .slice(0, 5);
  }

  async function buildProfile(user) {
    pruneExpiredEvents();
    const {
      topicScores,
      contentTypeScores,
      eventTypeCounts,
      sourceCounts,
      totalEvents,
      seenContentIds
    } = calculateDecayedScores(user.anonymousUserId);

    const sortedTopics = Object.entries(topicScores)
      .sort((a, b) => b[1] - a[1])
      .map(([topic, score]) => ({ topic, score }));

    const sortedContentTypes = Object.entries(contentTypeScores)
      .sort((a, b) => b[1] - a[1])
      .map(([type, score]) => ({ type, score }));

    const totalScore = sortedTopics.reduce((sum, item) => sum + item.score, 0);
    let engagementLevel = 'low';
    if (totalScore >= 80) engagementLevel = 'high';
    else if (totalScore >= 35) engagementLevel = 'medium';

    const topInterests = sortedTopics.slice(0, 5).map(item => item.topic);
    const preferredContentType = sortedContentTypes[0]?.type || 'mixed_content';
    const persona = detectPersona(sortedTopics, eventTypeCounts);

    const now = Date.now();
    const accountAgeDays = Math.max(0, Math.floor((now - new Date(user.createdAt).getTime()) / 86400000));
    const daysSinceLastActivity = user.lastUpdatedAt
      ? Math.max(0, Math.floor((now - new Date(user.lastUpdatedAt).getTime()) / 86400000))
      : accountAgeDays;

    const aiResult = await generateAISummary({
      user,
      persona,
      engagementLevel,
      topTopics: sortedTopics,
      preferredContentType,
      eventTypeCounts,
      sourceCounts,
      totalEvents,
      accountAgeDays,
      daysSinceLastActivity
    });

    return {
      anonymousUserId: user.anonymousUserId,
      consent: user.consent,
      consentTextVersion: user.consentTextVersion,
      consentScopes: user.consentScopes,
      consentUpdatedAt: user.consentUpdatedAt,
      persona,
      topInterests,
      preferredContentType,
      engagementLevel,
      topicScores,
      contentTypeScores,
      eventTypeCounts,
      sourceCounts,
      totalEvents,
      preferences: user.preferences,
      dataRetentionDays: config.dataRetentionDays,
      lastUpdatedAt: user.lastUpdatedAt,
      ...aiResult,
      recommendedContent: recommendContent(sortedTopics, sortedContentTypes, user, seenContentIds)
    };
  }

  function requireAdmin(req, res, next) {
    if (!config.adminApiKey) {
      return res.status(503).json({
        success: false,
        message: 'Admin API key is not configured. Set ADMIN_API_KEY in .env.'
      });
    }

    const bearer = req.get('authorization')?.replace(/^Bearer\s+/i, '');
    const key = req.get('x-admin-api-key') || bearer;
    if (key !== config.adminApiKey) {
      return res.status(401).json({ success: false, message: 'Admin API key is required.' });
    }

    return next();
  }

  function validateSource(source) {
    const normalizedSource = normalizeKey(source || 'healing_school_app');
    return {
      source: normalizedSource,
      approved: approvedSourceSet.has(normalizedSource)
    };
  }

  pruneExpiredEvents();

  const app = express();
  app.use(helmet({ contentSecurityPolicy: false }));
  app.use(cors());
  app.use(express.json({ limit: '1mb' }));
  if (config.logRequests) app.use(morgan('dev'));
  app.use(express.static(path.join(__dirname, '../public')));

  app.get('/api/health', (req, res) => {
    res.json({
      success: true,
      app: config.appName,
      host: config.host,
      port: config.port,
      storage: config.storageDriver,
      dataFilePath: config.dataFilePath,
      dataRetentionDays: config.dataRetentionDays,
      geminiEnabled: Boolean(genAI),
      approvedEventSources: config.approvedEventSources,
      message: 'API is running',
      timestamp: new Date().toISOString()
    });
  });

  app.get('/api/network-info', (req, res) => {
    const localUrl = `http://localhost:${config.port}`;
    res.json({
      success: true,
      host: config.host,
      port: config.port,
      localUrl,
      lanUrls: getLanUrls(config.port),
      phoneTestingEnabled: config.host === '0.0.0.0',
      note: 'Use a LAN URL from a phone on the same Wi-Fi network. Phone testing still requires explicit consent in the dashboard.'
    });
  });

  app.get('/api/privacy-notice', (req, res) => {
    res.json({
      success: true,
      version: '1.1',
      approvedEventSources: config.approvedEventSources,
      notice: 'We use your consented content activity and interest signals to personalize your faith-based experience. This may include searches, content views, clicks, saved content, shared content, and engagement from this app or approved ministry platforms only. We do not collect private messages, passwords, bank details, contacts, microphone recordings, secret browser history, unrelated app activity, or hidden activity from other websites. You can turn personalization off or reset your profile.'
    });
  });

  app.get('/api/config', (req, res) => {
    res.json({
      success: true,
      allowedEventTypes: [...allowedEventTypes],
      consentScopes: [...allowedConsentScopes],
      defaultConsentScopes,
      approvedEventSources: config.approvedEventSources,
      dataRetentionDays: config.dataRetentionDays,
      contentCount: store.contentLibrary.length
    });
  });

  app.get('/api/content', (req, res) => {
    res.json({ success: true, content: store.contentLibrary });
  });

  app.post('/api/users/anonymous', async (req, res) => {
    try {
      const anonymousUserId = `anon_${uuidv4().replace(/-/g, '').slice(0, 16)}`;
      const user = ensureUser(anonymousUserId, req.body?.preferences || {});
      saveStore();
      res.status(201).json({ success: true, anonymousUserId, profile: await buildProfile(user) });
    } catch (err) {
      res.status(500).json({ success: false, message: 'Failed to create user.', error: err.message });
    }
  });

  app.get('/api/users/:anonymousUserId/settings', (req, res) => {
    const user = store.users[req.params.anonymousUserId];
    if (!user) return res.status(404).json({ success: false, message: 'User not found.' });

    return res.json({
      success: true,
      settings: {
        anonymousUserId: user.anonymousUserId,
        consent: user.consent,
        consentTextVersion: user.consentTextVersion,
        consentUpdatedAt: user.consentUpdatedAt,
        consentScopes: user.consentScopes,
        preferences: user.preferences,
        availableConsentScopes: [...allowedConsentScopes],
        approvedEventSources: config.approvedEventSources
      }
    });
  });

  app.post('/api/users/:anonymousUserId/preferences', async (req, res) => {
    try {
      const user = store.users[req.params.anonymousUserId];
      if (!user) return res.status(404).json({ success: false, message: 'User not found.' });

      user.preferences = normalizePreferences({
        ...user.preferences,
        ...(req.body || {})
      });
      user.lastUpdatedAt = new Date().toISOString();
      saveStore();

      res.json({ success: true, message: 'Preferences saved.', profile: await buildProfile(user) });
    } catch (err) {
      res.status(500).json({ success: false, message: 'Failed to save preferences.', error: err.message });
    }
  });

  app.post('/api/consent', async (req, res) => {
    try {
      const {
        anonymousUserId,
        consent,
        consentTextVersion = '1.1',
        scopes,
        source = 'user_settings'
      } = req.body;

      if (!anonymousUserId || typeof consent !== 'boolean') {
        return res.status(400).json({ success: false, message: 'anonymousUserId and consent boolean are required.' });
      }

      const requestedScopes = Array.isArray(scopes) ? scopes : defaultConsentScopes;
      const consentScopes = consent
        ? requestedScopes.filter(scope => allowedConsentScopes.has(scope))
        : [];

      if (consent && consentScopes.length === 0) {
        return res.status(400).json({ success: false, message: 'At least one valid consent scope is required.' });
      }

      const user = ensureUser(anonymousUserId);
      const now = new Date().toISOString();
      user.consent = consent;
      user.consentTextVersion = consentTextVersion;
      user.consentScopes = consentScopes;
      user.consentUpdatedAt = now;
      user.lastUpdatedAt = now;

      store.consentHistory.push({
        id: uuidv4(),
        anonymousUserId,
        consent,
        consentTextVersion,
        consentScopes,
        source: normalizeKey(source, 'user_settings'),
        createdAt: now
      });

      saveStore();
      res.json({ success: true, message: 'Consent preference saved.', profile: await buildProfile(user) });
    } catch (err) {
      res.status(500).json({ success: false, message: 'Failed to save consent.', error: err.message });
    }
  });

  app.post('/api/events/track', async (req, res) => {
    try {
      const {
        anonymousUserId,
        eventType,
        topic,
        contentType = 'unknown',
        source = 'healing_school_app',
        timeSpentSeconds = 0,
        metadata = {}
      } = req.body;

      if (!anonymousUserId || !eventType || !topic) {
        return res.status(400).json({ success: false, message: 'anonymousUserId, eventType, and topic are required.' });
      }

      if (!allowedEventTypes.has(eventType)) {
        return res.status(400).json({ success: false, message: `Unsupported eventType. Use one of: ${[...allowedEventTypes].join(', ')}` });
      }

      const sourceCheck = validateSource(source);
      if (!sourceCheck.approved) {
        return res.status(403).json({
          success: false,
          message: 'Event source is not approved for personalization tracking.',
          approvedEventSources: config.approvedEventSources
        });
      }

      const user = ensureUser(anonymousUserId);
      if (!config.bypassConsent && (!user.consent || !user.consentScopes.includes('app_activity'))) {
        return res.status(403).json({
          success: false,
          message: 'Personalization consent is required before tracking interest events.'
        });
      }

      const isExternalSource = sourceCheck.source !== 'healing_school_app';
      if (!config.bypassConsent && isExternalSource && !user.consentScopes.includes('approved_platform_activity')) {
        return res.status(403).json({
          success: false,
          message: 'Approved-platform tracking scope is required for outside-platform signals.'
        });
      }

      const normalizedTopic = normalizeTopic(topic);
      const safeContentType = normalizeKey(contentType, 'unknown');
      const safeSeconds = Math.max(0, Math.min(Number(timeSpentSeconds || 0), 28800));
      const safeMetadata = sanitizeMetadata(metadata);
      const now = new Date().toISOString();

      store.events.push({
        id: uuidv4(),
        anonymousUserId,
        eventType,
        topic: normalizedTopic,
        contentType: safeContentType,
        source: sourceCheck.source,
        timeSpentSeconds: safeSeconds,
        metadata: safeMetadata,
        createdAt: now
      });

      user.lastUpdatedAt = now;
      pruneExpiredEvents();
      saveStore();

      res.status(201).json({ success: true, message: 'Interest event tracked.', profile: await buildProfile(user) });
    } catch (err) {
      res.status(500).json({ success: false, message: 'Failed to track event.', error: err.message });
    }
  });

  app.get('/api/profiles/:anonymousUserId', async (req, res) => {
    try {
      const user = store.users[req.params.anonymousUserId];
      if (!user) return res.status(404).json({ success: false, message: 'Profile not found.' });
      res.json({ success: true, profile: await buildProfile(user) });
    } catch (err) {
      res.status(500).json({ success: false, message: 'Failed to load profile.', error: err.message });
    }
  });

  app.get('/api/recommendations/:anonymousUserId', async (req, res) => {
    try {
      const user = store.users[req.params.anonymousUserId];
      if (!user) return res.status(404).json({ success: false, message: 'Profile not found.' });
      const profile = await buildProfile(user);
      res.json({
        success: true,
        persona: profile.persona,
        recommendations: profile.recommendedContent,
        aiSummary: profile.aiSummary,
        recommendationRationale: profile.recommendationRationale,
        aiSummarySource: profile.aiSummarySource
      });
    } catch (err) {
      res.status(500).json({ success: false, message: 'Failed to load recommendations.', error: err.message });
    }
  });

  app.post('/api/profiles/:anonymousUserId/reset', async (req, res) => {
    try {
      const user = store.users[req.params.anonymousUserId];
      if (!user) return res.status(404).json({ success: false, message: 'Profile not found.' });

      user.lastUpdatedAt = new Date().toISOString();
      store.events = store.events.filter(event => event.anonymousUserId !== req.params.anonymousUserId);
      saveStore();

      res.json({ success: true, message: 'Interest profile reset.', profile: await buildProfile(user) });
    } catch (err) {
      res.status(500).json({ success: false, message: 'Failed to reset profile.', error: err.message });
    }
  });

  app.delete('/api/users/:anonymousUserId', (req, res) => {
    const user = store.users[req.params.anonymousUserId];
    if (!user) return res.status(404).json({ success: false, message: 'User not found.' });

    delete store.users[req.params.anonymousUserId];
    store.events = store.events.filter(event => event.anonymousUserId !== req.params.anonymousUserId);
    store.consentHistory = store.consentHistory.filter(item => item.anonymousUserId !== req.params.anonymousUserId);
    saveStore();

    return res.json({ success: true, message: 'User data deleted.' });
  });

  app.get('/api/admin/events', requireAdmin, (req, res) => {
    pruneExpiredEvents();
    res.json({
      success: true,
      count: store.events.length,
      events: store.events.slice(-100).reverse()
    });
  });

  app.get('/api/admin/consent-history', requireAdmin, (req, res) => {
    res.json({
      success: true,
      count: store.consentHistory.length,
      consentHistory: store.consentHistory.slice(-100).reverse()
    });
  });

  app.post('/api/admin/retention/run', requireAdmin, (req, res) => {
    const removed = pruneExpiredEvents();
    res.json({
      success: true,
      removed,
      retainedEvents: store.events.length,
      dataRetentionDays: config.dataRetentionDays
    });
  });

  return {
    app,
    config,
    store,
    saveStore,
    pruneExpiredEvents,
    buildProfile
  };
}

if (require.main === module) {
  const runtime = createRuntime();
  runtime.app.listen(runtime.config.port, runtime.config.host, () => {
    const localUrl = `http://localhost:${runtime.config.port}`;
    console.log(`${runtime.config.appName} running on ${localUrl}`);
    if (runtime.config.host === '0.0.0.0') {
      const lanUrls = getLanUrls(runtime.config.port);
      if (lanUrls.length) console.log(`Phone/LAN URLs: ${lanUrls.join(', ')}`);
    }
    console.log(`Storage: ${runtime.config.storageDriver} (${runtime.config.dataFilePath})`);
    console.log(`Approved event sources: ${runtime.config.approvedEventSources.join(', ')}`);
    if (!runtime.config.adminApiKey) console.warn('ADMIN_API_KEY is not set; admin endpoints are disabled.');
    if (!isGeminiKeyUsable(runtime.config.geminiApiKey)) console.warn('GEMINI_API_KEY is not set; AI summaries will use local fallback templates.');
    if (runtime.config.bypassConsent) console.warn('[DEV] BYPASS_CONSENT=true — consent checks are OFF. Set to false before going live.');
  });
}

module.exports = {
  createRuntime,
  normalizeTopic,
  getWeight,
  defaultContentLibrary,
  allowedEventTypes,
  allowedConsentScopes
};
