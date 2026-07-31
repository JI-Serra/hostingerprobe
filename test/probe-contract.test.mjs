import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  createProbeObservation,
  databaseConfigurationStatus,
  isScheduledInvocationRecord,
  resolveDatabaseConfiguration,
  safeCorrelationId,
  scheduledInvocationRecord
} from '../lib/probe-contract.mjs';
import { createProbeStateStore, resolveProbeStateDirectory } from '../lib/probe-state.mjs';
import { isProbeRequestAuthorized } from '../lib/probe-auth.mjs';

const requestWithToken = (value) => ({ headers: new Headers(value === undefined ? {} : { authorization: `Bearer ${value}` }) });

test('fails closed without configuration and accepts only the correct bearer token', () => {
  assert.equal(isProbeRequestAuthorized(requestWithToken(), {}), false);
  assert.equal(isProbeRequestAuthorized(requestWithToken(), { PROBE_ACCESS_TOKEN: 'configured' }), false);
  assert.equal(isProbeRequestAuthorized(requestWithToken('wrong'), { PROBE_ACCESS_TOKEN: 'configured' }), false);
  assert.equal(isProbeRequestAuthorized(requestWithToken('configured'), { PROBE_ACCESS_TOKEN: 'configured' }), true);
});

test('uses a generated correlation ID when a request ID is unsafe', () => {
  const correlationId = safeCorrelationId('untrusted\nlog-injection');

  assert.match(correlationId, /^[0-9a-f-]{36}$/i);
  assert.notEqual(correlationId, 'untrusted\nlog-injection');
});

test('records environment presence without revealing its value', () => {
  const observation = createProbeObservation({
    correlationId: '00000000-0000-4000-8000-000000000001',
    environment: { PROBE_ENV_MARKER: 'actual-private-value' }
  });

  assert.equal(observation.environmentMarkerConfigured, true);
  assert.doesNotMatch(JSON.stringify(observation), /actual-private-value/);
});

test('resolves the canonical Hostinger database environment names', () => {
  const environment = {
    PROBE_MYSQL_SERVER: 'localhost',
    PROBE_MYSQL_TCP: '3306',
    PROBE_MYSQL_SCHEMA: 'probe_schema',
    PROBE_DB_USER: 'probe_user',
    PROBE_DB_PASSWORD: 'replace-with-test-value'
  };

  assert.deepEqual(resolveDatabaseConfiguration(environment), {
    host: 'localhost',
    port: '3306',
    database: 'probe_schema',
    user: 'probe_user',
    password: 'replace-with-test-value'
  });
  assert.deepEqual(databaseConfigurationStatus(environment), { configured: true, status: 'configured' });
});

test('retains the legacy local database environment names as fallback', () => {
  const environment = {
    PROBE_DB_HOST: '127.0.0.1',
    PROBE_DB_PORT: '3307',
    PROBE_DB_NAME: 'local_probe',
    PROBE_DB_USER: 'local_user',
    PROBE_DB_PASSWORD: 'replace-with-test-value'
  };

  assert.deepEqual(resolveDatabaseConfiguration(environment), {
    host: '127.0.0.1',
    port: '3307',
    database: 'local_probe',
    user: 'local_user',
    password: 'replace-with-test-value'
  });
  assert.deepEqual(databaseConfigurationStatus(environment), { configured: true, status: 'configured' });
});

test('keeps mixed database configuration pending when any logical field is missing', () => {
  const pending = databaseConfigurationStatus({
    PROBE_MYSQL_SERVER: 'localhost',
    PROBE_DB_PORT: '3306',
    PROBE_MYSQL_SCHEMA: 'probe_schema',
    PROBE_DB_USER: 'probe_user'
  });

  assert.deepEqual(pending, { configured: false, status: 'pending' });
});

test('creates a redacted scheduled invocation record', () => {
  const record = scheduledInvocationRecord({ PROBE_RUN_ID: 'run-001', PROBE_ENV_MARKER: 'private-value' });

  assert.equal(record.kind, 'scheduled-invocation');
  assert.equal(record.runId, 'run-001');
  assert.doesNotMatch(JSON.stringify(record), /private-value/);
});

test('uses an explicit absolute state directory shared by web and scheduled processes', () => {
  const stateDirectory = resolveProbeStateDirectory(
    { PROBE_STATE_DIR: 'C:\\hostinger-probe-state' },
    'C:\\irrelevant-working-directory'
  );

  assert.equal(stateDirectory.toLowerCase(), 'c:\\hostinger-probe-state');
});

test('distinguishes a proven missing restart marker from malformed state without returning raw content', () => {
  const stateDirectory = mkdtempSync(join(tmpdir(), 'hostinger-probe-state-'));
  try {
    const store = createProbeStateStore({ stateDirectory });
    assert.equal(store.restartFilesystemSnapshot().markerState, 'missing');

    writeFileSync(join(stateDirectory, 'restart-filesystem.json'), '{not-valid-json', 'utf8');
    const snapshot = store.restartFilesystemSnapshot();
    assert.equal(snapshot.markerState, 'malformed');
    assert.equal(snapshot.markerPresent, false);
    assert.doesNotMatch(JSON.stringify(snapshot), /not-valid-json/);
  } finally {
    rmSync(stateDirectory, { recursive: true, force: true });
  }
});

test('classifies non-missing read failures as unreadable state', () => {
  const readFailure = Object.assign(new Error('sensitive filesystem details'), { code: 'EACCES' });
  const store = createProbeStateStore({
    stateDirectory: 'C:\\hostinger-probe-state',
    fileSystem: { readFileSync: () => { throw readFailure; } }
  });

  const snapshot = store.restartFilesystemSnapshot();
  assert.equal(snapshot.markerState, 'unreadable');
  assert.doesNotMatch(JSON.stringify(snapshot), /sensitive filesystem details|hostinger-probe-state/);
});

test('rejects malformed scheduled invocation state', () => {
  const stateDirectory = mkdtempSync(join(tmpdir(), 'hostinger-probe-state-'));
  try {
    writeFileSync(join(stateDirectory, 'scheduled-invocation.json'), '{}', 'utf8');
    const snapshot = createProbeStateStore({ stateDirectory }).scheduledInvocationSnapshot();
    assert.equal(snapshot.recorded, false);
    assert.equal(snapshot.recordState, 'malformed');
  } finally {
    rmSync(stateDirectory, { recursive: true, force: true });
  }
});

test('accepts real RFC3339 dates and rejects impossible calendar dates', () => {
  const record = {
    kind: 'scheduled-invocation',
    runId: 'run-001',
    observedAt: '2024-02-29T12:00:00.123Z',
    runtimeVersion: 'v22.0.0',
    environmentMarkerConfigured: false
  };

  assert.equal(isScheduledInvocationRecord(record), true);
  assert.equal(isScheduledInvocationRecord({ ...record, observedAt: '2026-02-30T12:00:00Z' }), false);
  assert.equal(isScheduledInvocationRecord({ ...record, observedAt: '2026-07-30T12:00:00-03:00' }), true);
});
