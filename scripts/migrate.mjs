import { runDisposableMigration } from '../lib/probe-database.mjs';
import { logProbeEvent, logProbeFailure } from '../lib/probe-log.mjs';

try {
  const result = await runDisposableMigration();
  logProbeEvent('migration-cli-finished', { status: result.status, migrationKey: result.migrationKey });
  process.exitCode = result.status === 'pass' ? 0 : 2;
} catch (error) {
  logProbeFailure('migration-cli-failed', 'migration-cli', error);
  process.exitCode = 1;
}
