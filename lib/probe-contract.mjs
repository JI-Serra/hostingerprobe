import { randomUUID } from 'node:crypto';

const SAFE_RUN_ID = /^[A-Za-z0-9._-]{1,80}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const RFC3339 = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;

function hasValidCalendarDate(value) {
  const [, yearText, monthText, dayText] = /^(\d{4})-(\d{2})-(\d{2})/.exec(value) ?? [];
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const daysInMonth = [31, leapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return month >= 1 && month <= 12 && day >= 1 && day <= daysInMonth[month - 1];
}

export function isScheduledInvocationRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).sort().join() === 'environmentMarkerConfigured,kind,observedAt,runId,runtimeVersion'
    && value.kind === 'scheduled-invocation' && SAFE_RUN_ID.test(value.runId)
    && typeof value.observedAt === 'string' && RFC3339.test(value.observedAt)
    && hasValidCalendarDate(value.observedAt) && !Number.isNaN(Date.parse(value.observedAt))
    && /^v\d+\.\d+\.\d+/.test(value.runtimeVersion) && typeof value.environmentMarkerConfigured === 'boolean';
}

export function safeCorrelationId(candidate) {
  return typeof candidate === 'string' && UUID.test(candidate) ? candidate : randomUUID();
}

export function resolveDatabaseConfiguration(environment = process.env) {
  const firstConfigured = (...keys) => keys
    .map((key) => environment[key])
    .find((value) => typeof value === 'string' && value.trim() !== '');

  return {
    host: firstConfigured('PROBE_MYSQL_SERVER', 'PROBE_DB_HOST'),
    port: firstConfigured('PROBE_MYSQL_TCP', 'PROBE_DB_PORT'),
    database: firstConfigured('PROBE_MYSQL_SCHEMA', 'PROBE_DB_NAME'),
    user: firstConfigured('PROBE_DB_USER'),
    password: firstConfigured('PROBE_DB_PASSWORD')
  };
}

export function databaseConfigurationStatus(environment = process.env) {
  const configured = Object.values(resolveDatabaseConfiguration(environment)).every((value) => value !== undefined);
  return {
    configured,
    status: configured ? 'configured' : 'pending'
  };
}

export function createProbeObservation({ correlationId, environment = process.env } = {}) {
  return {
    correlationId: safeCorrelationId(correlationId),
    observedAt: new Date().toISOString(),
    runtimeVersion: process.version,
    environmentMarkerConfigured: typeof environment.PROBE_ENV_MARKER === 'string' && environment.PROBE_ENV_MARKER.trim() !== '',
    database: databaseConfigurationStatus(environment)
  };
}

export function scheduledInvocationRecord(environment = process.env) {
  const configuredRunId = environment.PROBE_RUN_ID;
  return {
    kind: 'scheduled-invocation',
    runId: typeof configuredRunId === 'string' && SAFE_RUN_ID.test(configuredRunId) ? configuredRunId : randomUUID(),
    observedAt: new Date().toISOString(),
    runtimeVersion: process.version,
    environmentMarkerConfigured: typeof environment.PROBE_ENV_MARKER === 'string' && environment.PROBE_ENV_MARKER.trim() !== ''
  };
}
