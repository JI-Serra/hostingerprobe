import { NextResponse } from 'next/server';
import { scheduledInvocationSnapshot } from '../../../lib/probe-state.mjs';
import { isProbeRequestAuthorized } from '../../../lib/probe-auth.mjs';

export const dynamic = 'force-dynamic';

export async function GET(request) {
  if (!isProbeRequestAuthorized(request)) return NextResponse.json({ status: 'unauthorized' }, { status: 401 });
  const snapshot = scheduledInvocationSnapshot();
  return NextResponse.json({ status: snapshot.recorded ? 'observed' : 'pending', ...snapshot }, { status: snapshot.recorded ? 200 : 503 });
}
