import { scheduledInvocationRecord } from '../lib/probe-contract.mjs';
import { logProbeEvent } from '../lib/probe-log.mjs';
import { recordScheduledInvocation } from '../lib/probe-state.mjs';

const record = recordScheduledInvocation(scheduledInvocationRecord());
logProbeEvent('scheduled-invocation-recorded', { runId: record.runId });
