import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const packageRoot = process.cwd();
const packageJson = JSON.parse(readFileSync(join(packageRoot, 'package.json'), 'utf8'));
const readme = readFileSync(join(packageRoot, 'README.md'), 'utf8');
const runbookPath = join(packageRoot, '..', '..', 'docs', 'deployment', 'hostinger-probe-runbook.md');
const runbook = readFileSync(runbookPath, 'utf8');
const schema = JSON.parse(readFileSync(join(packageRoot, 'evidence.schema.json'), 'utf8'));

const requiredScripts = {
  build: 'next build && node scripts/copy-standalone-assets.mjs',
  start: 'node .next/standalone/server.js',
  migrate: 'node scripts/migrate.mjs',
  scheduled: 'node scripts/scheduled-check.mjs'
};

const requiredContracts = [
  'ops/hostinger-probe/',
  'npm ci',
  'npm run build',
  'npm start',
  'npm run migrate',
  'npm run scheduled',
  'GET /api/health',
  'POST /api/restart-filesystem',
  'GET /api/restart-filesystem',
  'GET /api/scheduled',
  'GET /api/database',
  'POST /api/migration',
  'node ops/hostinger-probe/verify.mjs --self-check',
  'node ops/hostinger-probe/verify.mjs --evidence ops/hostinger-probe/evidence/hostinger-evidence.json',
  'markerState: "malformed"',
  'markerState: "unreadable"',
  'ops/hostinger-probe/evidence/logs/',
  'hostingConfiguration',
  'restartObservation',
   'schedulerConfiguration',
  'databaseConnectionLimit',
  'deployment.temporaryUrl',
  'deployment.assignedPort',
  'no un enlace simbólico, junction ni redirección de punto de análisis',
  'Websites → Add Website → Deploy Web App → Import Git Repository',
  'Node **22.x**',
  'despliegues automáticos al recibir un push',
  '`PROBE_STATE_DIR_VERSION`',
  '`PROBE_MYSQL_SERVER`',
  '`PROBE_MYSQL_TCP`',
  '`PROBE_MYSQL_SCHEMA_MANUAL`',
  '`PROBE_DB_USER`',
  '`PROBE_DB_PASSWORD`',
  '**Compatibilidad local:**',
  'no ofrece una sección nativa equivalente a **Advanced Cron Jobs**',
  'Registrar la comprobación 7 como no disponible, no como aprobada.'
];

const staleEnglishInstructions = [
  '# Run the Hostinger Capability Probe',
  '## Quick path',
  'This disposable page proves',
  '## Troubleshooting',
  'web root',
  'rollback',
  'baseline',
  'dashboard'
];

const forbiddenHostingerVariables = ['PROBE_DB_HOST', 'PROBE_DB_PORT'];
const localFallbackVariables = ['PROBE_STATE_DIR', 'PROBE_MYSQL_SCHEMA', 'PROBE_DB_NAME'];
const requiredReadmeContracts = [
  '`PROBE_MYSQL_SCHEMA`, `PROBE_DB_HOST`, `PROBE_DB_PORT`, and `PROBE_DB_NAME` are local/backward-compatibility fallbacks only and are never Hostinger canonical.',
  '`PROBE_STATE_DIR` is a local/backward-compatibility fallback only and is never Hostinger canonical;'
];

for (const [name, expected] of Object.entries(requiredScripts)) {
  if (packageJson.scripts[name] !== expected) throw new Error(`Package script mismatch: ${name}`);
}
for (const contract of requiredContracts) {
  if (!runbook.includes(contract)) throw new Error(`Missing runbook contract: ${contract}`);
}
for (const staleInstruction of staleEnglishInstructions) {
  if (runbook.includes(staleInstruction)) throw new Error(`Stale English instruction: ${staleInstruction}`);
}
for (const contract of requiredReadmeContracts) {
  if (!readme.includes(contract)) throw new Error(`Missing README canonical/fallback contract: ${contract}`);
}
for (const variable of forbiddenHostingerVariables) {
  if (new RegExp(`\\b${variable}\\b`).test(runbook)) throw new Error(`Obsolete Hostinger variable instruction: ${variable}`);
}
for (const [index, line] of runbook.split(/\r?\n/).entries()) {
  for (const variable of localFallbackVariables) {
    if (new RegExp(`\\b${variable}\\b`).test(line) && !line.includes('**Compatibilidad local:**')) {
      throw new Error(`Unlabeled local fallback reference at line ${index + 1}: ${variable}`);
    }
  }
}
for (const property of ['hostingConfiguration', 'restartObservation', 'schedulerConfiguration']) {
  if (!schema.required.includes(property) || schema.additionalProperties !== false) throw new Error(`Evidence schema contract mismatch: ${property}`);
}
if (!schema.properties.platformFacts.required.includes('databaseConnectionLimit')) throw new Error('Evidence schema missing databaseConnectionLimit.');
if (!schema.properties.deployment.required.includes('temporaryUrl') || !schema.properties.deployment.required.includes('assignedPort')) throw new Error('Evidence schema missing temporary URL or assigned port.');
const scheduledLimitationSection = runbook.indexOf('## 5. Registrar la limitación de tareas programadas antes de comprobar');
const orderedChecksSection = runbook.indexOf('## 6. Ejecutar las nueve comprobaciones');
if (scheduledLimitationSection === -1 || orderedChecksSection === -1 || scheduledLimitationSection >= orderedChecksSection) {
  throw new Error('Scheduled-task limitation must precede the nine checks.');
}
if (runbook.indexOf('quitar todas las variables `PROBE_*`') >= runbook.indexOf('eliminarla.')) throw new Error('Environment removal must precede temporary application deletion.');
if ((runbook.match(/^\| [1-9] \|/gm) ?? []).length !== 9) throw new Error('The runbook must retain all nine ordered checks.');

console.log(JSON.stringify({
  event: 'runbook-contract-audit-passed',
  scripts: Object.keys(requiredScripts).length,
  contracts: requiredContracts.length,
  staleEnglishInstructions: 0,
  obsoleteHostingerVariables: 0,
  unlabeledLocalFallbackReferences: 0,
  readmeCanonicalFallbackContracts: requiredReadmeContracts.length,
  orderedChecks: 9
}));
