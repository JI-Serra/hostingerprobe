import { NextResponse } from 'next/server';
import { safeCorrelationId } from '../../../lib/probe-contract.mjs';
import { runDisposableMigration } from '../../../lib/probe-database.mjs';
import { logProbeEvent, logProbeFailure } from '../../../lib/probe-log.mjs';
import { isProbeRequestAuthorized } from '../../../lib/probe-auth.mjs';

export const dynamic = 'force-dynamic';

export async function POST(request) {
  if (!isProbeRequestAuthorized(request)) return NextResponse.json({ status: 'unauthorized' }, { status: 401 });
  const correlationId = safeCorrelationId(request.headers.get('x-probe-correlation-id'));
  try {
    const result = await runDisposableMigration();
    logProbeEvent('migration-executed', { correlationId, status: result.status, migrationKey: result.migrationKey });
    return NextResponse.json({ correlationId, ...result }, { status: result.status === 'pending' ? 503 : 200 });
  } catch (error) {
    logProbeFailure('migration-failed', correlationId, error);
    return NextResponse.json({ correlationId, status: 'fail', message: 'Migration failed. Inspect the correlated application log.' }, { status: 502 });
  }
}
