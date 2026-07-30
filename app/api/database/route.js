import { NextResponse } from 'next/server';
import { safeCorrelationId } from '../../../lib/probe-contract.mjs';
import { checkDatabaseConnectivity } from '../../../lib/probe-database.mjs';
import { logProbeEvent, logProbeFailure } from '../../../lib/probe-log.mjs';
import { isProbeRequestAuthorized } from '../../../lib/probe-auth.mjs';

export const dynamic = 'force-dynamic';

export async function GET(request) {
  if (!isProbeRequestAuthorized(request)) return NextResponse.json({ status: 'unauthorized' }, { status: 401 });
  const correlationId = safeCorrelationId(request.headers.get('x-probe-correlation-id'));
  try {
    const result = await checkDatabaseConnectivity();
    logProbeEvent('database-checked', { correlationId, status: result.status });
    return NextResponse.json({ correlationId, ...result }, { status: result.status === 'pending' ? 503 : 200 });
  } catch (error) {
    logProbeFailure('database-check-failed', correlationId, error);
    return NextResponse.json({ correlationId, status: 'fail', message: 'Database connection failed. Inspect the correlated application log.' }, { status: 502 });
  }
}
