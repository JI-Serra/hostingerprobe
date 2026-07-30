import { headers } from 'next/headers';
import { createProbeObservation } from '../lib/probe-contract.mjs';
import { logProbeEvent } from '../lib/probe-log.mjs';

export const dynamic = 'force-dynamic';

export default async function ProbePage() {
  const requestHeaders = await headers();
  const observation = createProbeObservation({ correlationId: requestHeaders.get('x-probe-correlation-id') });
  logProbeEvent('ssr-rendered', { correlationId: observation.correlationId });

  return (
    <main>
      <h1>Hostinger Capability Probe</h1>
      <p>This disposable page proves server-side rendering only when observed on the target account.</p>
      <dl>
        <dt>Correlation ID</dt><dd>{observation.correlationId}</dd>
        <dt>Node runtime</dt><dd>{observation.runtimeVersion}</dd>
        <dt>Environment marker configured</dt><dd>{String(observation.environmentMarkerConfigured)}</dd>
        <dt>Database configuration</dt><dd>{observation.database.status}</dd>
      </dl>
      <p>Use the runbook to exercise the API, restart/filesystem, scheduler, database, and migration checks.</p>
    </main>
  );
}
