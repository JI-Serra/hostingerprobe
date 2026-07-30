import { NextResponse } from 'next/server';
import { safeCorrelationId } from '../../../lib/probe-contract.mjs';
import { logProbeEvent, logProbeFailure } from '../../../lib/probe-log.mjs';
import { recordRestartFilesystemProbe, restartFilesystemSnapshot } from '../../../lib/probe-state.mjs';
import { isProbeRequestAuthorized } from '../../../lib/probe-auth.mjs';

export const dynamic = 'force-dynamic';

export async function GET(request) {
  if (!isProbeRequestAuthorized(request)) return NextResponse.json({ status: 'unauthorized' }, { status: 401 });
  const snapshot = restartFilesystemSnapshot();
  if (snapshot.markerState === 'malformed' || snapshot.markerState === 'unreadable') {
    logProbeEvent('restart-filesystem-state-unavailable', { markerState: snapshot.markerState });
    return NextResponse.json(
      { status: 'error', markerState: snapshot.markerState, message: 'Restart/filesystem state is unavailable for qualification.' },
      { status: 503 }
    );
  }
  return NextResponse.json({ status: 'observed', ...snapshot });
}

export async function POST(request) {
  if (!isProbeRequestAuthorized(request)) return NextResponse.json({ status: 'unauthorized' }, { status: 401 });
  const correlationId = safeCorrelationId(request.headers.get('x-probe-correlation-id'));
  try {
    const marker = recordRestartFilesystemProbe(correlationId);
    logProbeEvent('restart-filesystem-marker-written', { correlationId, markerId: marker.markerId });
    return NextResponse.json({ status: 'pass', correlationId, marker, runtime: restartFilesystemSnapshot().runtime });
  } catch (error) {
    logProbeFailure('restart-filesystem-marker-write-failed', correlationId, error);
    return NextResponse.json(
      { status: 'error', message: 'Restart/filesystem marker could not be written.' },
      { status: 503 }
    );
  }
}
