import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const listed = spawnSync('git', ['ls-files', '--cached', '--others', '--exclude-standard'], { encoding: 'utf8' });
if (listed.status !== 0) throw new Error('Unable to inventory Git publication candidates.');

const candidates = listed.stdout.split(/\r?\n/).filter(Boolean).sort();
const findings = [];
const acknowledgedFindings = [];
const expectedFindings = new Map([
  ['lib/probe-database.mjs:credential-value', { count: 1, explanation: 'References an environment variable name; no credential value is committed.' }],
  ['verify.mjs:credential-value', { count: 1, explanation: 'Contains the redaction detector pattern; no credential value is committed.' }],
  ['verify.test.mjs:credential-value', { count: 4, explanation: 'Contains synthetic redaction test input; no credential value is committed.' }],
  ['test/probe-contract.test.mjs:credential-value', { count: 4, explanation: 'Contains synthetic authorization test configuration; no credential value is committed.' }]
]);
const signatureChecks = [
  { name: 'private-key', expression: /-----BEGIN [A-Z ]*PRIVATE KEY-----/ },
  { name: 'github-token', expression: /(?:ghp_|github_pat_)[A-Za-z0-9_]+/ },
  { name: 'aws-access-key', expression: /AKIA[0-9A-Z]{16}/ },
  { name: 'credential-value', expression: /(?:password|passwd|token|secret|api[_-]?key)\s*[=:]\s*(?!replace|configurar|placeholder|<)/i },
  { name: 'workspace-path', expression: /C:\\Desarrollos\\MetriBar/i }
];

export function scanCandidateText(candidate, text, expected = expectedFindings) {
  const findings = [];
  const acknowledgedFindings = [];
  for (const check of signatureChecks) {
    const expression = new RegExp(check.expression.source, `${check.expression.flags.replace('g', '')}g`);
    let acknowledged = 0;
    for (const match of text.matchAll(expression)) {
      const key = `${candidate}:${check.name}`;
      const expectation = expected.get(key);
      const finding = { file: candidate, kind: check.name, offset: match.index };
      if (expectation && acknowledged < expectation.count) {
        acknowledgedFindings.push({ ...finding, explanation: expectation.explanation });
        acknowledged += 1;
      } else findings.push(finding);
    }
  }
  return { findings, acknowledgedFindings };
}

const manifest = candidates.map((candidate) => {
  const bytes = readFileSync(candidate);
  const scanned = scanCandidateText(candidate, bytes.toString('utf8'));
  findings.push(...scanned.findings);
  acknowledgedFindings.push(...scanned.acknowledgedFindings);
  return { file: candidate, sha256: createHash('sha256').update(bytes).digest('hex') };
});

const digest = createHash('sha256').update(JSON.stringify(manifest)).digest('hex');
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  console.log(JSON.stringify({ event: 'publication-inventory', candidates: manifest.length, digest: `sha256:${digest}`, findings, acknowledgedFindings }));
  if (findings.length > 0) process.exitCode = 1;
}
