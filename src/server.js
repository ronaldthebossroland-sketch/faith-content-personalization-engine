require('dotenv').config();

const fs = require('fs');
const os = require('os');
const path = require('path');
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const { v4: uuidv4 } = require('uuid');
const { GoogleGenAI } = require('@google/genai');
const { createClient: createSupabaseClient } = require('@supabase/supabase-js');

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

const supabaseTables = {
  users: 'faith_users',
  events: 'faith_events',
  consentHistory: 'faith_consent_history',
  contentLibrary: 'faith_content_library'
};

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
  const storageDriver = normalizeKey(
    options.storageDriver || process.env.STORAGE_DRIVER || (DatabaseSync ? 'sqlite' : 'json'),
    DatabaseSync ? 'sqlite' : 'json'
  );
  const defaultDataFile = storageDriver === 'sqlite'
    ? path.join(__dirname, '../data/local-store.sqlite')
    : path.join(__dirname, '../data/local-store.json');
  const supabaseKey = options.supabaseKey
    ?? options.supabaseServiceRoleKey
    ?? process.env.SUPABASE_SECRET_KEY
    ?? process.env.SUPABASE_SERVICE_ROLE_KEY;

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
    dataFilePath: storageDriver === 'supabase'
      ? null
      : (options.dataFilePath || process.env.DATA_FILE_PATH || defaultDataFile),
    supabaseUrl: options.supabaseUrl || process.env.SUPABASE_URL,
    supabaseKey,
    corsOrigins: parseList(options.corsOrigins || process.env.CORS_ORIGIN, ['*']),
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
    user.knownUser = sanitizeKnownUser(user.knownUser);
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

function openSupabase(config) {
  if (!config.supabaseUrl || !config.supabaseKey) {
    throw new Error('Supabase storage requires SUPABASE_URL and SUPABASE_SECRET_KEY or SUPABASE_SERVICE_ROLE_KEY.');
  }

  return createSupabaseClient(config.supabaseUrl, config.supabaseKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false
    }
  });
}

function chunkRows(rows, size = 200) {
  const chunks = [];
  for (let i = 0; i < rows.length; i += size) chunks.push(rows.slice(i, i + size));
  return chunks;
}

function parseSupabaseData(row) {
  if (!row?.data) return null;
  return typeof row.data === 'string' ? JSON.parse(row.data) : row.data;
}

async function fetchAllSupabaseRows(client, table, columns, orderBy) {
  const pageSize = 1000;
  const rows = [];

  for (let from = 0; ; from += pageSize) {
    let query = client.from(table).select(columns);
    if (orderBy) query = query.order(orderBy, { ascending: true });
    query = query.range(from, from + pageSize - 1);

    const { data, error } = await query;
    if (error) throw new Error(`Supabase ${table} query failed: ${error.message}`);
    rows.push(...(data || []));
    if (!data || data.length < pageSize) break;
  }

  return rows;
}

async function loadSupabaseStore(config) {
  const client = openSupabase(config);
  const [userRows, eventRows, consentRows, contentRows] = await Promise.all([
    fetchAllSupabaseRows(client, supabaseTables.users, 'data', 'updated_at'),
    fetchAllSupabaseRows(client, supabaseTables.events, 'data', 'created_at'),
    fetchAllSupabaseRows(client, supabaseTables.consentHistory, 'data', 'created_at'),
    fetchAllSupabaseRows(client, supabaseTables.contentLibrary, 'data', 'id')
  ]);

  const store = createEmptyStore();
  store.users = {};

  for (const row of userRows) {
    const user = parseSupabaseData(row);
    if (user?.anonymousUserId) store.users[user.anonymousUserId] = user;
  }

  store.events = eventRows.map(parseSupabaseData).filter(Boolean);
  store.consentHistory = consentRows.map(parseSupabaseData).filter(Boolean);

  if (contentRows.length) {
    store.contentLibrary = contentRows.map(parseSupabaseData).filter(Boolean);
  } else {
    const seedRows = defaultContentLibrary.map(item => ({
      id: item.id,
      data: item,
      updated_at: new Date().toISOString()
    }));
    const { error } = await client
      .from(supabaseTables.contentLibrary)
      .upsert(seedRows, { onConflict: 'id' });
    if (error) throw new Error(`Supabase content seed failed: ${error.message}`);
    store.contentLibrary = defaultContentLibrary;
  }

  return migrateStore(store);
}

async function syncSupabaseTable(client, table, idColumn, rows) {
  for (const chunk of chunkRows(rows)) {
    const { error } = await client.from(table).upsert(chunk, { onConflict: idColumn });
    if (error) throw new Error(`Supabase ${table} upsert failed: ${error.message}`);
  }

  const existingRows = await fetchAllSupabaseRows(client, table, idColumn, idColumn);
  const currentIds = new Set(rows.map(row => row[idColumn]));
  const staleIds = existingRows
    .map(row => row[idColumn])
    .filter(id => id && !currentIds.has(id));

  for (const chunk of chunkRows(staleIds)) {
    const { error } = await client.from(table).delete().in(idColumn, chunk);
    if (error) throw new Error(`Supabase ${table} cleanup failed: ${error.message}`);
  }
}

async function writeSupabaseStore(config, rawStore) {
  const client = openSupabase(config);
  const store = migrateStore(rawStore);
  const now = new Date().toISOString();

  await syncSupabaseTable(
    client,
    supabaseTables.users,
    'anonymous_user_id',
    Object.values(store.users).map(user => ({
      anonymous_user_id: user.anonymousUserId,
      data: user,
      updated_at: user.lastUpdatedAt || user.consentUpdatedAt || user.createdAt || now
    }))
  );

  await syncSupabaseTable(
    client,
    supabaseTables.contentLibrary,
    'id',
    store.contentLibrary.map(item => ({
      id: item.id,
      data: item,
      updated_at: now
    }))
  );

  await syncSupabaseTable(
    client,
    supabaseTables.consentHistory,
    'id',
    store.consentHistory.map(consent => ({
      id: consent.id,
      anonymous_user_id: consent.anonymousUserId,
      data: consent,
      created_at: consent.createdAt || now
    }))
  );

  await syncSupabaseTable(
    client,
    supabaseTables.events,
    'id',
    store.events.map(event => ({
      id: event.id,
      anonymous_user_id: event.anonymousUserId,
      data: event,
      created_at: event.createdAt || now
    }))
  );
}

function loadStore(config) {
  if (config.storageDriver === 'supabase') return createEmptyStore();
  if (config.storageDriver === 'sqlite' && DatabaseSync) return loadSqliteStore(config.dataFilePath);
  return loadJsonStore(config.dataFilePath);
}

async function loadStoreAsync(config) {
  if (config.storageDriver === 'supabase') return loadSupabaseStore(config);
  return loadStore(config);
}

async function writeStore(config, store) {
  if (config.storageDriver === 'supabase') {
    await writeSupabaseStore(config, store);
    return;
  }

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

function cleanString(value, maxLength) {
  if (value === undefined || value === null) return null;
  const cleaned = String(value).trim().replace(/\s+/g, ' ').slice(0, maxLength);
  return cleaned || null;
}

function normalizeEmail(value) {
  const cleaned = cleanString(value, 120);
  if (!cleaned) return null;
  const email = cleaned.toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : null;
}

function sanitizeKnownUser(rawKnownUser = {}) {
  if (!rawKnownUser || typeof rawKnownUser !== 'object') return null;

  const knownUser = {
    displayName: cleanString(rawKnownUser.displayName || rawKnownUser.name, 80),
    email: normalizeEmail(rawKnownUser.email),
    externalUserId: cleanString(rawKnownUser.externalUserId || rawKnownUser.userId, 100),
    source: normalizeKey(rawKnownUser.source || 'trusted_app_login', 'trusted_app_login'),
    linkedAt: rawKnownUser.linkedAt || new Date().toISOString()
  };

  if (!knownUser.displayName && !knownUser.email && !knownUser.externalUserId) return null;
  return knownUser;
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
    ? new GoogleGenAI({ apiKey: config.geminiApiKey })
    : null;
  let storageReady = false;
  let storageReadyAt = null;
  let storageError = null;

  async function saveStore() {
    await writeStore(config, store);
  }

  async function pruneExpiredEvents() {
    const cutoff = Date.now() - (config.dataRetentionDays * 86400000);
    const before = store.events.length;
    store.events = store.events.filter(event => {
      const createdAt = new Date(event.createdAt).getTime();
      return Number.isFinite(createdAt) && createdAt >= cutoff;
    });
    const removed = before - store.events.length;
    if (removed > 0) await saveStore();
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
        knownUser: null,
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

  // Derives a spending/support pattern label from interest signals.
  // Based on content engagement — not actual financial data.
  function detectSpendingPattern(topTopics, eventTypeCounts) {
    if (!topTopics.length) return 'Not enough data';

    const topicSet = new Set(topTopics.map(t => t.topic));
    const partnershipScore = topTopics.find(t => t.topic === 'partnership_impact')?.score || 0;
    const healingStreamsScore = topTopics.find(t => t.topic === 'healing_streams')?.score || 0;
    const campaignClicks = eventTypeCounts.external_campaign_click || 0;
    const programInterest = eventTypeCounts.program_interest || 0;
    const shares = eventTypeCounts.content_shared || 0;

    if (partnershipScore > 20 || programInterest >= 2) return 'Partnership-related';
    if (healingStreamsScore > 15 || campaignClicks >= 2) return 'Event-focused (Healing Streams supporter)';
    if (shares >= 3) return 'Content advocate';
    if (topicSet.has('devotional') || topicSet.has('prayer')) return 'Devotional engagement';
    return 'General interest';
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
      const result = await genAI.models.generateContent({
        model: config.geminiModel,
        contents: prompt
      });
      const raw = result.text.replace(/```json|```/g, '').trim();
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
    await pruneExpiredEvents();
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

    // Cap at 200 points = 100% — gives a meaningful scale without capping too early
    const engagementScore = Math.min(Math.round((totalScore / 200) * 100), 100);

    const topInterests = sortedTopics.slice(0, 5).map(item => item.topic);
    const preferredContentType = sortedContentTypes[0]?.type || 'mixed_content';
    const persona = detectPersona(sortedTopics, eventTypeCounts);
    const spendingPattern = detectSpendingPattern(sortedTopics, eventTypeCounts);

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
      engagementScore,
      spendingPattern,
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

  function replaceStoreContents(loadedStore) {
    const migratedStore = migrateStore(loadedStore);
    store.users = migratedStore.users;
    store.events = migratedStore.events;
    store.consentHistory = migratedStore.consentHistory;
    store.contentLibrary = migratedStore.contentLibrary;
  }

  const ready = (async () => {
    if (config.storageDriver === 'supabase') {
      replaceStoreContents(await loadStoreAsync(config));
    }

    await pruneExpiredEvents();
    storageReady = true;
    storageReadyAt = new Date().toISOString();
  })();

  ready.catch(err => {
    storageError = err;
    console.error(`Storage initialization failed: ${err.message}`);
  });

  function buildCorsOptions() {
    if (config.corsOrigins.includes('*')) return { origin: true };

    return {
      origin(origin, callback) {
        if (!origin || config.corsOrigins.includes(origin)) {
          callback(null, true);
          return;
        }

        callback(new Error('Origin is not allowed by CORS.'));
      }
    };
  }

  async function requireStorageReady(req, res, next) {
    try {
      await ready;
      return next();
    } catch (err) {
      return res.status(503).json({
        success: false,
        message: 'Storage is not ready. Check Supabase environment variables and schema.',
        error: err.message
      });
    }
  }

  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);
  app.use(helmet({ contentSecurityPolicy: false }));
  app.use(cors(buildCorsOptions()));
  app.use(express.json({ limit: '1mb' }));
  if (config.logRequests) app.use(morgan('dev'));
  app.use(requireStorageReady);
  app.use(express.static(path.join(__dirname, '../public')));

  app.get('/embed.js', (req, res) => {
    const rawSource = req.query.source || config.approvedEventSources[0] || 'healing_school_app';
    const source = config.approvedEventSources.includes(normalizeKey(rawSource))
      ? normalizeKey(rawSource)
      : config.approvedEventSources[0] || 'healing_school_app';
    const forwardedProto = String(req.headers['x-forwarded-proto'] || '')
      .split(',')[0]
      .trim()
      .toLowerCase();
    const proto = forwardedProto === 'https' || req.secure ? 'https' : 'http';
    const host = String(req.headers.host || `localhost:${config.port}`)
      .replace(/[^A-Za-z0-9.:[\]-]/g, '') || `localhost:${config.port}`;
    const serverUrl = `${proto}://${host}`;
    const serverLiteral = JSON.stringify(serverUrl);
    const sourceLiteral = JSON.stringify(source);

    res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
    res.setHeader('Cache-Control', 'public, max-age=300');
    res.send(`/* Faith Content Personalization Engine — embed.js
 * Source : ${source}
 * Server : ${serverUrl}
 * Drop-in: <script src="${serverUrl}/embed.js?source=${source}"></script>
 * Manual : FaithEngine.track(eventType, topic, options)
 *
 * Auto-tracked: page views, time on page, search queries, SPA navigation
 */
(function (SERVER, SOURCE) {
  var UID_KEY     = 'faith_uid_'     + SOURCE;
  var CONSENT_KEY = 'faith_consent_' + SOURCE;

  // Search param names to detect as searches
  var SEARCH_PARAMS = ['q', 'search', 'query', 'keyword', 's', 'term'];

  // URL path keywords → faith topic
  var TOPIC_MAP = {
    healing: 'healing_testimonies', testimony: 'healing_testimonies',
    testimonies: 'healing_testimonies', prayer: 'prayer', pray: 'prayer',
    devotional: 'devotional', partner: 'partnership_impact',
    partnership: 'partnership_impact', family: 'family_healing',
    children: 'family_healing', faith: 'faith_for_healing',
    streams: 'healing_streams', confession: 'faith_confessions'
  };

  var userId    = null;
  var consented = false;
  var pageStart = Date.now();
  var pagePath  = location.pathname;

  function storageGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function storageSet(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }

  userId    = storageGet(UID_KEY);
  consented = storageGet(CONSENT_KEY) === 'true';

  // ── HTTP helpers ─────────────────────────────────────────────────────────
  function post(path, body) {
    return fetch(SERVER + path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (d) {
        if (!r.ok) throw d;
        return d;
      });
    });
  }

  // Reliable fire-and-forget for page unload
  function beacon(body) {
    try {
      navigator.sendBeacon(
        SERVER + '/api/events/track',
        new Blob([JSON.stringify(body)], { type: 'application/json' })
      );
    } catch (e) {}
  }

  // ── User & consent ───────────────────────────────────────────────────────
  function ensureUser() {
    if (userId) return Promise.resolve();
    return post('/api/users/anonymous', {}).then(function (d) {
      userId = d.anonymousUserId;
      storageSet(UID_KEY, userId);
    });
  }

  function acceptConsent() {
    return ensureUser().then(function () {
      return post('/api/consent', {
        anonymousUserId: userId,
        consent: true,
        consentTextVersion: '1.1',
        scopes: ['app_activity', 'approved_platform_activity', 'recommendations', 'ai_summary'],
        source: SOURCE
      });
    }).then(function () {
      consented = true;
      storageSet(CONSENT_KEY, 'true');
    });
  }

  function declineConsent() {
    consented = false;
    storageSet(CONSENT_KEY, 'false');
  }

  function removeConsentBanner() {
    var existing = document.getElementById('faith-engine-banner');
    if (existing && existing.remove) existing.remove();
  }

  function showConsentBanner() {
    if (consented || document.getElementById('faith-engine-banner')) return;

    var banner = document.createElement('div');
    banner.id = 'faith-engine-banner';
    banner.style.cssText = 'position:fixed;left:16px;right:16px;bottom:16px;z-index:2147483647;max-width:720px;margin:0 auto;background:#0f172a;color:#fff;border-radius:12px;padding:14px 16px;box-shadow:0 12px 40px rgba(15,23,42,.28);font:14px/1.45 system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;';
    banner.innerHTML =
      '<div style="font-weight:700;margin-bottom:4px">Personalized faith content</div>' +
      '<div style="opacity:.86;margin-bottom:12px">Allow this approved platform to use your consented content activity for recommendations. No private messages, contacts, passwords, or hidden activity are collected.</div>' +
      '<div style="display:flex;gap:8px;flex-wrap:wrap">' +
        '<button id="fe-accept" style="border:0;border-radius:8px;padding:8px 12px;background:#14b8a6;color:#fff;font-weight:700;cursor:pointer">Allow</button>' +
        '<button id="fe-decline" style="border:1px solid rgba(255,255,255,.28);border-radius:8px;padding:8px 12px;background:transparent;color:#fff;font-weight:700;cursor:pointer">Not now</button>' +
      '</div>';

    document.body.appendChild(banner);

    var accept = document.getElementById('fe-accept');
    var decline = document.getElementById('fe-decline');

    if (accept) {
      accept.onclick = function () {
        acceptConsent().then(function () {
          removeConsentBanner();
          startTracking();
        }).catch(function () {});
      };
    }

    if (decline) {
      decline.onclick = function () {
        declineConsent();
        removeConsentBanner();
      };
    }
  }

  // ── Topic inference from URL ─────────────────────────────────────────────
  function inferTopic(path, search) {
    var text = ((path || '') + ' ' + (search || '')).toLowerCase();
    for (var kw in TOPIC_MAP) {
      if (text.indexOf(kw) !== -1) return TOPIC_MAP[kw];
    }
    return 'general_faith_content';
  }

  // ── Tracking ─────────────────────────────────────────────────────────────
  function track(eventType, topic, options) {
    if (!userId) return Promise.resolve();
    return post('/api/events/track', Object.assign(
      { anonymousUserId: userId, eventType: eventType,
        topic: topic || inferTopic(location.pathname, location.search),
        source: SOURCE },
      options || {}
    )).catch(function () {});
  }

  // Track page view with topic inferred from URL
  function trackPageView() {
    track('content_viewed', inferTopic(location.pathname, location.search), {
      metadata: { page: location.pathname }
    });
  }

  // Detect search query in the current URL
  function detectSearch() {
    var params = new URLSearchParams(location.search);
    for (var i = 0; i < SEARCH_PARAMS.length; i++) {
      var val = params.get(SEARCH_PARAMS[i]);
      if (val && val.trim()) {
        track('search_topic', val.trim(), { metadata: { page: location.pathname } });
        return;
      }
    }
  }

  // Send time-on-page via beacon (works on tab close / navigate away)
  function sendTimeOnPage() {
    if (!userId) return;
    var seconds = Math.floor((Date.now() - pageStart) / 1000);
    if (seconds < 10) return; // ignore bounces under 10s
    beacon({
      anonymousUserId: userId,
      eventType: 'content_viewed',
      topic: inferTopic(pagePath, ''),
      source: SOURCE,
      timeSpentSeconds: Math.min(seconds, 28800),
      metadata: { page: pagePath }
    });
  }

  // Handle SPA navigation (pushState / popstate)
  function onNavigate() {
    sendTimeOnPage();
    pageStart = Date.now();
    pagePath  = location.pathname;
    setTimeout(function () { trackPageView(); detectSearch(); }, 150);
  }

  // ── Hooks ────────────────────────────────────────────────────────────────
  function hookNavigation() {
    var origPush = history.pushState.bind(history);
    history.pushState = function () { origPush.apply(history, arguments); onNavigate(); };
    window.addEventListener('popstate', onNavigate);
  }

  function hookTimeOnPage() {
    window.addEventListener('beforeunload', sendTimeOnPage);
    // Also send on visibility change (mobile tab switch)
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'hidden') sendTimeOnPage();
    });
  }

  // Auto-detect search form submissions
  function hookSearchForms() {
    document.addEventListener('submit', function (e) {
      var input = e.target.querySelector(
        'input[type="search"],input[name="q"],input[name="search"],' +
        'input[name="query"],input[name="keyword"],input[name="s"]'
      );
      if (input && input.value.trim()) {
        track('search_topic', input.value.trim(), { metadata: { page: location.pathname } });
      }
    });
  }

  function startTracking() {
    trackPageView();
    detectSearch();
    hookNavigation();
    hookTimeOnPage();
    hookSearchForms();
  }

  // ── Boot ─────────────────────────────────────────────────────────────────
  function init() {
    if (!consented) {
      showConsentBanner();
      return;
    }

    ensureUser().then(startTracking).catch(function () {});
  }

  window.FaithEngine = {
    track: track,
    getUserId: function () { return userId; }
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})(${serverLiteral}, ${sourceLiteral});
`);
  });

  app.get('/api/health', (req, res) => {
    res.json({
      success: true,
      app: config.appName,
      host: config.host,
      port: config.port,
      storage: config.storageDriver,
      storageReady,
      storageReadyAt,
      storageTarget: config.storageDriver === 'supabase' ? 'supabase' : config.dataFilePath,
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
      await saveStore();
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
      await saveStore();

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

      await saveStore();
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
      await pruneExpiredEvents();
      await saveStore();

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
      await saveStore();

      res.json({ success: true, message: 'Interest profile reset.', profile: await buildProfile(user) });
    } catch (err) {
      res.status(500).json({ success: false, message: 'Failed to reset profile.', error: err.message });
    }
  });

  app.delete('/api/users/:anonymousUserId', async (req, res) => {
    try {
      const user = store.users[req.params.anonymousUserId];
      if (!user) return res.status(404).json({ success: false, message: 'User not found.' });

      delete store.users[req.params.anonymousUserId];
      store.events = store.events.filter(event => event.anonymousUserId !== req.params.anonymousUserId);
      store.consentHistory = store.consentHistory.filter(item => item.anonymousUserId !== req.params.anonymousUserId);
      await saveStore();

      return res.json({ success: true, message: 'User data deleted.' });
    } catch (err) {
      return res.status(500).json({ success: false, message: 'Failed to delete user.', error: err.message });
    }
  });

  app.get('/api/admin/events', requireAdmin, async (req, res) => {
    try {
      await pruneExpiredEvents();
      res.json({
        success: true,
        count: store.events.length,
        events: store.events.slice(-100).reverse()
      });
    } catch (err) {
      res.status(500).json({ success: false, message: 'Failed to load events.', error: err.message });
    }
  });

  app.get('/api/admin/consent-history', requireAdmin, (req, res) => {
    res.json({
      success: true,
      count: store.consentHistory.length,
      consentHistory: store.consentHistory.slice(-100).reverse()
    });
  });

  app.post('/api/admin/retention/run', requireAdmin, async (req, res) => {
    try {
      const removed = await pruneExpiredEvents();
      res.json({
        success: true,
        removed,
        retainedEvents: store.events.length,
        dataRetentionDays: config.dataRetentionDays
      });
    } catch (err) {
      res.status(500).json({ success: false, message: 'Failed to run retention.', error: err.message });
    }
  });

  app.post('/api/admin/users/:anonymousUserId/known-user', requireAdmin, async (req, res) => {
    try {
      const user = store.users[req.params.anonymousUserId];
      if (!user) return res.status(404).json({ success: false, message: 'User not found.' });
      if (!user.consent) {
        return res.status(403).json({
          success: false,
          message: 'Known-user linking requires the user to consent first.'
        });
      }

      const knownUser = sanitizeKnownUser(req.body || {});
      if (!knownUser) {
        return res.status(400).json({
          success: false,
          message: 'Provide at least one of displayName, email, or externalUserId.'
        });
      }

      user.knownUser = knownUser;
      user.lastUpdatedAt = new Date().toISOString();
      await saveStore();

      return res.json({
        success: true,
        message: 'Known user linked.',
        anonymousUserId: user.anonymousUserId,
        knownUser: user.knownUser
      });
    } catch (err) {
      return res.status(500).json({ success: false, message: 'Failed to link known user.', error: err.message });
    }
  });

  app.delete('/api/admin/users/:anonymousUserId/known-user', requireAdmin, async (req, res) => {
    try {
      const user = store.users[req.params.anonymousUserId];
      if (!user) return res.status(404).json({ success: false, message: 'User not found.' });

      user.knownUser = null;
      user.lastUpdatedAt = new Date().toISOString();
      await saveStore();

      return res.json({
        success: true,
        message: 'Known user unlinked.',
        anonymousUserId: user.anonymousUserId
      });
    } catch (err) {
      return res.status(500).json({ success: false, message: 'Failed to unlink known user.', error: err.message });
    }
  });

  app.get('/api/admin/sources', requireAdmin, (req, res) => {
    const sourceCounts = {};
    const sourceUsers = {};
    const sourceTopics = {};
    const sourceLastEvent = {};

    for (const source of config.approvedEventSources) {
      sourceCounts[source] = 0;
      sourceUsers[source] = new Set();
      sourceTopics[source] = {};
      sourceLastEvent[source] = null;
    }

    for (const event of store.events) {
      const { source } = event;
      if (!Object.hasOwn(sourceCounts, source)) {
        sourceCounts[source] = 0;
        sourceUsers[source] = new Set();
        sourceTopics[source] = {};
        sourceLastEvent[source] = null;
      }
      sourceCounts[source]++;
      sourceUsers[source].add(event.anonymousUserId);
      const topic = event.topic || 'unknown';
      sourceTopics[source][topic] = (sourceTopics[source][topic] || 0) + 1;
      if (!sourceLastEvent[source] || event.createdAt > sourceLastEvent[source]) {
        sourceLastEvent[source] = event.createdAt;
      }
    }

    const sources = config.approvedEventSources.map(source => ({
      source,
      eventCount: sourceCounts[source] || 0,
      uniqueUsers: (sourceUsers[source] || new Set()).size,
      topTopics: Object.entries(sourceTopics[source] || {})
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([topic, count]) => ({ topic, count })),
      lastEventAt: sourceLastEvent[source] || null
    }));

    res.json({
      success: true,
      sources,
      totalEvents: store.events.length,
      totalUsers: Object.keys(store.users).length
    });
  });

  app.get('/api/admin/users', requireAdmin, (req, res) => {
    const users = Object.values(store.users).map(user => {
      const userEvents = store.events.filter(e => e.anonymousUserId === user.anonymousUserId);
      const sourceCounts = Object.create(null);
      const topicCounts = Object.create(null);
      const eventTypeCounts = Object.create(null);

      for (const event of userEvents) {
        sourceCounts[event.source] = (sourceCounts[event.source] || 0) + 1;
        topicCounts[event.topic] = (topicCounts[event.topic] || 0) + 1;
        eventTypeCounts[event.eventType] = (eventTypeCounts[event.eventType] || 0) + 1;
      }

      const topSources = Object.entries(sourceCounts)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3)
        .map(([s]) => s);

      const sortedTopics = Object.entries(topicCounts)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([topic, count]) => ({ topic, score: count }));

      const persona = detectPersona(sortedTopics, eventTypeCounts);
      const totalWeight = sortedTopics.reduce((sum, t) => sum + t.score, 0);
      const engagementLevel = userEvents.length === 0
        ? 'none'
        : totalWeight >= 20 ? 'high' : totalWeight >= 6 ? 'medium' : 'low';

      return {
        anonymousUserId: user.anonymousUserId,
        knownUser: user.knownUser || null,
        consent: user.consent,
        consentScopes: user.consentScopes || [],
        totalEvents: userEvents.length,
        topSources,
        sourceCounts,
        topTopics: sortedTopics.map(t => t.topic),
        persona,
        engagementLevel,
        createdAt: user.createdAt,
        lastUpdatedAt: user.lastUpdatedAt
      };
    });

    res.json({ success: true, count: users.length, users });
  });

  return {
    app,
    config,
    store,
    ready,
    saveStore,
    pruneExpiredEvents,
    buildProfile
  };
}

if (require.main === module) {
  (async () => {
    try {
      const runtime = createRuntime();
      await runtime.ready;

      runtime.app.listen(runtime.config.port, runtime.config.host, () => {
        const localUrl = `http://localhost:${runtime.config.port}`;
        const storageTarget = runtime.config.dataFilePath || 'managed Supabase tables';
        console.log(`${runtime.config.appName} running on ${localUrl}`);
        if (runtime.config.host === '0.0.0.0') {
          const lanUrls = getLanUrls(runtime.config.port);
          if (lanUrls.length) console.log(`Phone/LAN URLs: ${lanUrls.join(', ')}`);
        }
        console.log(`Storage: ${runtime.config.storageDriver} (${storageTarget})`);
        console.log(`Approved event sources: ${runtime.config.approvedEventSources.join(', ')}`);
        if (!runtime.config.adminApiKey) console.warn('ADMIN_API_KEY is not set; admin endpoints are disabled.');
        if (!isGeminiKeyUsable(runtime.config.geminiApiKey)) console.warn('GEMINI_API_KEY is not set; AI summaries will use local fallback templates.');
        if (runtime.config.bypassConsent) console.warn('[DEV] BYPASS_CONSENT=true - consent checks are OFF. Set to false before going live.');
      });
    } catch (err) {
      console.error(`Failed to start server: ${err.message}`);
      process.exit(1);
    }
  })();
}

module.exports = {
  createRuntime,
  normalizeTopic,
  getWeight,
  defaultContentLibrary,
  allowedEventTypes,
  allowedConsentScopes
};
