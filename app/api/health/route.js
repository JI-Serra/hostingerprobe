import { NextResponse } from 'next/server';
import { createProbeObservation } from '../../../lib/probe-contract.mjs';
import { logProbeEvent } from '../../../lib/probe-log.mjs';

export const dynamic = 'force-dynamic';

export async function GET(request) {
  const observation = createProbeObservation({ correlationId: request.headers.get('x-probe-correlation-id') });
  logProbeEvent('health-checked', { correlationId: observation.correlationId });
  return NextResponse.json({ status: 'pass', ...observation });
}
