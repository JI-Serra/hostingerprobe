import { createHash, timingSafeEqual } from 'node:crypto';

const digest = (value) => createHash('sha256').update(value).digest();

export function isProbeRequestAuthorized(request, environment = process.env) {
  const expected = environment.PROBE_ACCESS_TOKEN;
  const authorization = request?.headers?.get?.('authorization');
  if (typeof expected !== 'string' || expected.length === 0 || typeof authorization !== 'string' || !authorization.startsWith('Bearer ')) return false;
  return timingSafeEqual(digest(authorization.slice(7)), digest(expected));
}
