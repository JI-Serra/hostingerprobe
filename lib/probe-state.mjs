import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { isScheduledInvocationRecord } from './probe-contract.mjs';

export function resolveProbeStateDirectory(environment = process.env, cwd = process.cwd()) {
  const configuredStateDirectory = [environment.PROBE_STATE_DIR_VERSION, environment.PROBE_STATE_DIR]
    .find((value) => typeof value === 'string' && value.trim() !== '');
  return typeof configuredStateDirectory === 'string' && isAbsolute(configuredStateDirectory)
    ? resolve(configuredStateDirectory)
    : join(cwd, '.probe-state');
}

const runtime = globalThis.__hostingerCapabilityProbeRuntime ?? {
  bootId: randomUUID(),
  startedAt: new Date().toISOString()
};
globalThis.__hostingerCapabilityProbeRuntime = runtime;

const defaultFileSystem = { mkdirSync, readFileSync, renameSync, writeFileSync };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isRestartMarker(value) {
  return value !== null
    && typeof value === 'object'
    && !Array.isArray(value)
    && UUID.test(value.markerId)
    && UUID.test(value.correlationId)
    && typeof value.writtenAt === 'string'
    && !Number.isNaN(Date.parse(value.writtenAt))
    && UUID.test(value.bootId);
}

function readState(path, validate, fileSystem) {
  let raw;
  try {
    raw = fileSystem.readFileSync(path, 'utf8');
  } catch (error) {
    return { state: error?.code === 'ENOENT' ? 'missing' : 'unreadable' };
  }
  try {
    const value = JSON.parse(raw);
    return validate(value) ? { state: 'valid', value } : { state: 'malformed' };
  } catch {
    return { state: 'malformed' };
  }
}

function writeState(path, value, stateDirectory, fileSystem) {
  fileSystem.mkdirSync(stateDirectory, { recursive: true });
  const temporaryPath = `${path}.${process.pid}.${randomUUID()}.tmp`;
  fileSystem.writeFileSync(temporaryPath, JSON.stringify(value), { encoding: 'utf8', mode: 0o600 });
  fileSystem.renameSync(temporaryPath, path);
}

export function runtimeSnapshot() {
  return { bootId: runtime.bootId, startedAt: runtime.startedAt, processId: process.pid };
}

export function createProbeStateStore({ stateDirectory = resolveProbeStateDirectory(), fileSystem = {} } = {}) {
  const files = { ...defaultFileSystem, ...fileSystem };
  const restartStatePath = join(stateDirectory, 'restart-filesystem.json');
  const scheduledStatePath = join(stateDirectory, 'scheduled-invocation.json');

  return {
    recordRestartFilesystemProbe(correlationId) {
      const marker = {
        markerId: randomUUID(),
        correlationId,
        writtenAt: new Date().toISOString(),
        bootId: runtime.bootId
      };
      writeState(restartStatePath, marker, stateDirectory, files);
      return { markerPresent: true, markerId: marker.markerId, writtenAt: marker.writtenAt, bootId: marker.bootId };
    },

    restartFilesystemSnapshot() {
      const result = readState(restartStatePath, isRestartMarker, files);
      const marker = result.state === 'valid' ? result.value : null;
      return {
        runtime: runtimeSnapshot(),
        markerState: result.state,
        markerPresent: marker !== null,
        markerId: marker?.markerId ?? null,
        markerWrittenAt: marker?.writtenAt ?? null,
        markerBootId: marker?.bootId ?? null
      };
    },

    recordScheduledInvocation(record) {
      writeState(scheduledStatePath, record, stateDirectory, files);
      return record;
    },

    scheduledInvocationSnapshot() {
      const result = readState(scheduledStatePath, isScheduledInvocationRecord, files);
      const record = result.state === 'valid' ? result.value : null;
      return {
        recorded: record !== null,
        recordState: result.state,
        record: record === null ? null : {
          kind: record.kind,
          runId: record.runId,
          observedAt: record.observedAt,
          runtimeVersion: record.runtimeVersion,
          environmentMarkerConfigured: record.environmentMarkerConfigured
        }
      };
    }
  };
}

const defaultStore = createProbeStateStore();
export const recordRestartFilesystemProbe = (...arguments_) => defaultStore.recordRestartFilesystemProbe(...arguments_);
export const restartFilesystemSnapshot = () => defaultStore.restartFilesystemSnapshot();
export const recordScheduledInvocation = (...arguments_) => defaultStore.recordScheduledInvocation(...arguments_);
export const scheduledInvocationSnapshot = () => defaultStore.scheduledInvocationSnapshot();
