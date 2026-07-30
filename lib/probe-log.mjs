export function logProbeEvent(event, details = {}) {
  const entry = {
    source: 'hostinger-capability-probe',
    event,
    timestamp: new Date().toISOString(),
    ...details
  };
  console.log(JSON.stringify(entry));
}

export function logProbeFailure(event, correlationId, error) {
  logProbeEvent(event, {
    correlationId,
    errorCode: typeof error?.code === 'string' ? error.code : 'PROBE_OPERATION_FAILED'
  });
}
