const baseUrl = process.env.PROBE_SMOKE_URL ?? 'http://127.0.0.1:3100';
const correlationId = '00000000-0000-4000-8000-000000000099';
const accessCredential = process.env.PROBE_ACCESS_TOKEN;
const request = async (path, options = {}) => {
  const response = await fetch(`${baseUrl}${path}`, {
    ...options,
    headers: { authorization: `Bearer ${accessCredential}`, 'x-probe-correlation-id': correlationId, ...(options.headers ?? {}) }
  });
  const body = await response.json();
  return { response, body };
};

const page = await fetch(baseUrl, { headers: { 'x-probe-correlation-id': correlationId } });
if (!page.ok || !(await page.text()).includes('Hostinger Capability Probe')) throw new Error('SSR probe page did not respond as expected.');

const health = await request('/api/health');
if (!health.response.ok || health.body.status !== 'pass' || health.body.environmentMarkerConfigured !== true) throw new Error('Health route did not expose safe runtime and environment presence.');

const marker = await request('/api/restart-filesystem', { method: 'POST' });
if (!marker.response.ok || marker.body.status !== 'pass') throw new Error('Restart/filesystem marker did not persist locally.');

const scheduled = await request('/api/scheduled');
if (!scheduled.response.ok || scheduled.body.status !== 'observed') throw new Error('Scheduled invocation was not observable locally.');

const database = await request('/api/database');
if (database.response.status !== 503 || database.body.status !== 'pending') throw new Error('Database check must stay pending without disposable database configuration.');

console.log(JSON.stringify({ event: 'local-production-smoke-passed', hostingerQualificationReady: false }));
