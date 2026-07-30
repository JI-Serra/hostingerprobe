import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const packageRoot = process.cwd();
const packageJson = JSON.parse(readFileSync(join(packageRoot, 'package.json'), 'utf8'));
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
  'despliegues automáticos al recibir un push'
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

for (const [name, expected] of Object.entries(requiredScripts)) {
  if (packageJson.scripts[name] !== expected) throw new Error(`Package script mismatch: ${name}`);
}
for (const contract of requiredContracts) {
  if (!runbook.includes(contract)) throw new Error(`Missing runbook contract: ${contract}`);
}
for (const staleInstruction of staleEnglishInstructions) {
  if (runbook.includes(staleInstruction)) throw new Error(`Stale English instruction: ${staleInstruction}`);
}
for (const property of ['hostingConfiguration', 'restartObservation', 'schedulerConfiguration']) {
  if (!schema.required.includes(property) || schema.additionalProperties !== false) throw new Error(`Evidence schema contract mismatch: ${property}`);
}
if (!schema.properties.platformFacts.required.includes('databaseConnectionLimit')) throw new Error('Evidence schema missing databaseConnectionLimit.');
if (!schema.properties.deployment.required.includes('temporaryUrl') || !schema.properties.deployment.required.includes('assignedPort')) throw new Error('Evidence schema missing temporary URL or assigned port.');
if (runbook.indexOf('## 5. Configurar la tarea programada') >= runbook.indexOf('## 6. Ejecutar las nueve comprobaciones')) throw new Error('Scheduled-task setup must precede the nine checks.');
if (runbook.indexOf('quitar todas las variables `PROBE_*`') >= runbook.indexOf('eliminarla.')) throw new Error('Environment removal must precede temporary application deletion.');
if ((runbook.match(/^\| [1-9] \|/gm) ?? []).length !== 9) throw new Error('The runbook must retain all nine ordered checks.');

console.log(JSON.stringify({ event: 'runbook-contract-audit-passed', scripts: 4, contracts: 22, staleEnglishInstructions: 0, orderedChecks: 9 }));
