import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { resolveProbeStateDirectory } from '../lib/probe-state.mjs';

const baseUrl = process.env.PROBE_SMOKE_URL ?? 'http://127.0.0.1:3100';
const stateDirectory = resolveProbeStateDirectory();

const statePath = join(stateDirectory, 'restart-filesystem.json');
mkdirSync(stateDirectory, { recursive: true });
writeFileSync(statePath, '{corrupted-state', { encoding: 'utf8', mode: 0o600 });

try {
  const response = await fetch(`${baseUrl}/api/restart-filesystem`);
  const body = await response.json();
  if (response.status !== 503 || body.status !== 'error' || body.markerState !== 'malformed') {
    throw new Error('Corrupted restart state did not fail closed.');
  }
  if (JSON.stringify(body).includes('corrupted-state') || JSON.stringify(body).includes(stateDirectory)) {
    throw new Error('Corruption response exposed unsafe state details.');
  }
  console.log(JSON.stringify({ event: 'corruption-runtime-failed-closed', hostingerQualificationReady: false }));
} finally {
  rmSync(statePath, { force: true });
}
