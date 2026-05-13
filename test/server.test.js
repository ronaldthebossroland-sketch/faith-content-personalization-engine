const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createRuntime } = require('../src/server');

function createTestRuntime(options = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'faith-engine-'));
  const dataFilePath = path.join(dir, 'store.sqlite');
  const runtime = createRuntime({
    dataFilePath,
    storageDriver: 'sqlite',
    adminApiKey: 'test-admin-key',
    approvedEventSources: 'healing_school_app,approved_campaign',
    geminiApiKey: '',
    logRequests: false,
    bypassConsent: false,
    ...options
  });

  return { runtime, dataFilePath };
}

async function withServer(runtime, callback) {
  const server = runtime.app.listen(0);
  await new Promise(resolve => server.once('listening', resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  try {
    await callback(baseUrl);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
}

async function jsonRequest(baseUrl, route, options = {}) {
  const response = await fetch(baseUrl + route, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {})
    }
  });
  const data = await response.json();
  return { response, data };
}

async function createUser(baseUrl) {
  const { response, data } = await jsonRequest(baseUrl, '/api/users/anonymous', {
    method: 'POST',
    body: JSON.stringify({})
  });
  assert.equal(response.status, 201);
  assert.match(data.anonymousUserId, /^anon_/);
  return data.anonymousUserId;
}

async function saveConsent(baseUrl, anonymousUserId, scopes) {
  const { response, data } = await jsonRequest(baseUrl, '/api/consent', {
    method: 'POST',
    body: JSON.stringify({
      anonymousUserId,
      consent: true,
      scopes
    })
  });
  assert.equal(response.status, 200);
  assert.equal(data.profile.consent, true);
  return data.profile;
}

test('tracking is blocked until personalization consent exists', async () => {
  const { runtime } = createTestRuntime();

  await withServer(runtime, async baseUrl => {
    const anonymousUserId = await createUser(baseUrl);
    const { response, data } = await jsonRequest(baseUrl, '/api/events/track', {
      method: 'POST',
      body: JSON.stringify({
        anonymousUserId,
        eventType: 'video_watched',
        topic: 'healing testimonies',
        contentType: 'video',
        source: 'healing_school_app'
      })
    });

    assert.equal(response.status, 403);
    assert.match(data.message, /consent/i);
  });
});

test('approved outside-platform signals require both approved source and consent scope', async () => {
  const { runtime } = createTestRuntime();

  await withServer(runtime, async baseUrl => {
    const anonymousUserId = await createUser(baseUrl);
    await saveConsent(baseUrl, anonymousUserId, ['app_activity', 'recommendations']);

    const externalWithoutScope = await jsonRequest(baseUrl, '/api/events/track', {
      method: 'POST',
      body: JSON.stringify({
        anonymousUserId,
        eventType: 'external_campaign_click',
        topic: 'Healing Streams registration',
        contentType: 'campaign_link',
        source: 'approved_campaign'
      })
    });
    assert.equal(externalWithoutScope.response.status, 403);
    assert.match(externalWithoutScope.data.message, /outside-platform/i);

    await saveConsent(baseUrl, anonymousUserId, [
      'app_activity',
      'approved_platform_activity',
      'recommendations',
      'ai_summary'
    ]);

    const unapproved = await jsonRequest(baseUrl, '/api/events/track', {
      method: 'POST',
      body: JSON.stringify({
        anonymousUserId,
        eventType: 'external_campaign_click',
        topic: 'Healing Streams registration',
        contentType: 'campaign_link',
        source: 'unknown_website'
      })
    });
    assert.equal(unapproved.response.status, 403);
    assert.match(unapproved.data.message, /not approved/i);

    const approved = await jsonRequest(baseUrl, '/api/events/track', {
      method: 'POST',
      body: JSON.stringify({
        anonymousUserId,
        eventType: 'external_campaign_click',
        topic: 'Healing Streams registration',
        contentType: 'campaign_link',
        source: 'approved_campaign',
        metadata: { campaignId: 'campaign_1', contentId: 'content_009' }
      })
    });
    assert.equal(approved.response.status, 201);
    assert.equal(approved.data.profile.sourceCounts.approved_campaign, 1);
  });
});

test('admin endpoints require the configured API key', async () => {
  const { runtime } = createTestRuntime();

  await withServer(runtime, async baseUrl => {
    const denied = await jsonRequest(baseUrl, '/api/admin/events');
    assert.equal(denied.response.status, 401);

    const allowed = await jsonRequest(baseUrl, '/api/admin/events', {
      headers: { 'x-admin-api-key': 'test-admin-key' }
    });
    assert.equal(allowed.response.status, 200);
    assert.equal(allowed.data.success, true);
  });
});

test('network info exposes phone-testing details without bypassing consent', async () => {
  const { runtime } = createTestRuntime({ host: '0.0.0.0', port: 5055 });

  await withServer(runtime, async baseUrl => {
    const { response, data } = await jsonRequest(baseUrl, '/api/network-info');
    assert.equal(response.status, 200);
    assert.equal(data.phoneTestingEnabled, true);
    assert.equal(data.localUrl, 'http://localhost:5055');
    assert.match(data.note, /consent/i);
  });
});

test('retention sweep removes expired events', async () => {
  const { runtime } = createTestRuntime({ dataRetentionDays: 1 });

  await withServer(runtime, async baseUrl => {
    const anonymousUserId = await createUser(baseUrl);
    await saveConsent(baseUrl, anonymousUserId, ['app_activity', 'recommendations']);

    const tracked = await jsonRequest(baseUrl, '/api/events/track', {
      method: 'POST',
      body: JSON.stringify({
        anonymousUserId,
        eventType: 'content_viewed',
        topic: 'faith for healing',
        contentType: 'article',
        source: 'healing_school_app'
      })
    });
    assert.equal(tracked.response.status, 201);

    runtime.store.events[0].createdAt = new Date(Date.now() - 3 * 86400000).toISOString();

    const retention = await jsonRequest(baseUrl, '/api/admin/retention/run', {
      method: 'POST',
      headers: { 'x-admin-api-key': 'test-admin-key' }
    });
    assert.equal(retention.response.status, 200);
    assert.equal(retention.data.removed, 1);
    assert.equal(retention.data.retainedEvents, 0);
  });
});

test('local SQLite storage persists users and events across runtime instances', async () => {
  const { runtime, dataFilePath } = createTestRuntime();

  await withServer(runtime, async baseUrl => {
    const anonymousUserId = await createUser(baseUrl);
    await saveConsent(baseUrl, anonymousUserId, ['app_activity', 'recommendations']);
    const tracked = await jsonRequest(baseUrl, '/api/events/track', {
      method: 'POST',
      body: JSON.stringify({
        anonymousUserId,
        eventType: 'article_read',
        topic: 'prayer preparation',
        contentType: 'article',
        source: 'healing_school_app'
      })
    });
    assert.equal(tracked.response.status, 201);
  });

  assert.equal(fs.existsSync(dataFilePath), true);

  const restored = createRuntime({
    dataFilePath,
    storageDriver: 'sqlite',
    adminApiKey: 'test-admin-key',
    approvedEventSources: 'healing_school_app,approved_campaign',
    geminiApiKey: '',
    logRequests: false
  });

  assert.equal(Object.keys(restored.store.users).length, 1);
  assert.equal(restored.store.events.length, 1);
  assert.equal(restored.store.consentHistory.length, 1);
});
