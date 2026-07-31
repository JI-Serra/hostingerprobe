import mysql from 'mysql2/promise';
import { databaseConfigurationStatus, resolveDatabaseConfiguration } from './probe-contract.mjs';

function connectionOptions(environment = process.env) {
  const configuration = resolveDatabaseConfiguration(environment);
  return {
    ...configuration,
    port: Number(configuration.port),
    connectTimeout: 5_000
  };
}

async function withConnection(operation, environment = process.env) {
  const status = databaseConfigurationStatus(environment);
  if (!status.configured) return { status: 'pending' };

  const connection = await mysql.createConnection(connectionOptions(environment));
  try {
    return await operation(connection);
  } finally {
    await connection.end();
  }
}

export async function checkDatabaseConnectivity(environment = process.env) {
  return withConnection(async (connection) => {
    const [rows] = await connection.query('SELECT VERSION() AS engineVersion');
    return { status: 'pass', engineVersion: rows[0].engineVersion };
  }, environment);
}

export async function runDisposableMigration(environment = process.env) {
  return withConnection(async (connection) => {
    await connection.query(`
      CREATE TABLE IF NOT EXISTS hostinger_probe_migrations (
        migration_key VARCHAR(64) NOT NULL PRIMARY KEY,
        applied_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);
    await connection.execute(
      'INSERT IGNORE INTO hostinger_probe_migrations (migration_key) VALUES (?)',
      ['hostinger-capability-probe-v1']
    );
    const [rows] = await connection.query(
      'SELECT migration_key, applied_at FROM hostinger_probe_migrations WHERE migration_key = ?',
      ['hostinger-capability-probe-v1']
    );
    return { status: 'pass', migrationKey: rows[0].migration_key, appliedAt: String(rows[0].applied_at) };
  }, environment);
}
