import { createHash } from 'node:crypto';
import { realpathSync, readFileSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn as nodeSpawn } from 'node:child_process';

const moduleDirectory = dirname(fileURLToPath(import.meta.url));
export const CANONICAL_WORKSPACE_ROOT = realpathSync(resolve(moduleDirectory, '../..'));

export const REQUIRED_CAPABILITIES = Object.freeze([
  'nextjs_ssr',
  'server_action_or_api_route',
  'node_runtime',
  'environment_variables',
  'logs',
  'restart_and_filesystem',
  'scheduled_commands',
  'database_access',
  'migration_execution'
]);

const FIXED_COMMANDS = Object.freeze({
  'node-version': Object.freeze({ command: process.execPath, args: Object.freeze(['--version']) })
});

const SHELL_METACHARACTERS = /[;&|`$<>(){}\[\]*?!\r\n]/;
const SENSITIVE_KEY = /(password|passwd|secret|token|api[_-]?key|authorization|credential|cookie)/i;
const SECRET_VALUE = /(begin [a-z ]*private key|\b(?:password|passwd|secret|token|api[_-]?key)\s*[=:]|(?:^|[_\s-])(secret|token|password|api[_-]?key)(?:$|[_\s-])|(?:[a-z][a-z0-9+.-]*:\/\/[^:\s/]+:)[^@\s/]+@)/i;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA256 = /^sha256:[a-f0-9]{64}$/;
const RFC3339 = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:Z|[+-](\d{2}):(\d{2}))$/;
const EVIDENCE_LOG_DIRECTORY = resolve(CANONICAL_WORKSPACE_ROOT, 'ops', 'hostinger-probe', 'evidence', 'logs');

function normalizedPath(path) {
  return process.platform === 'win32' ? path.toLowerCase() : path;
}

function fail(message) {
  throw new Error(message);
}

function assertPlainObject(value, name) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    fail(`${name} must be an object.`);
  }
}

function assertExactKeys(value, keys, name) {
  assertPlainObject(value, name);
  const actualKeys = Object.keys(value).sort();
  const expectedKeys = [...keys].sort();
  if (actualKeys.length !== expectedKeys.length || actualKeys.some((key, index) => key !== expectedKeys[index])) {
    fail(`${name} contains unsupported or missing fields.`);
  }
}

function assertNonEmptyString(value, name) {
  if (typeof value !== 'string' || value.trim() === '') {
    fail(`${name} must be a non-empty string.`);
  }
}

function assertIsoTimestamp(value, name) {
  assertNonEmptyString(value, name);
  const match = RFC3339.exec(value);
  const date = match && new Date(Date.UTC(+match[1], +match[2] - 1, +match[3]));
  if (!match || date.getUTCFullYear() !== +match[1] || date.getUTCMonth() !== +match[2] - 1 || date.getUTCDate() !== +match[3]
    || +match[4] > 23 || +match[5] > 59 || +match[6] > 59 || +(match[7] ?? 0) > 23 || +(match[8] ?? 0) > 59 || Number.isNaN(Date.parse(value))) fail(`${name} must be an RFC3339 date-time.`);
}

function assertSecretFree(value, path = 'evidence') {
  if (typeof value === 'string') {
    if (SECRET_VALUE.test(value)) {
      fail('Evidence contains a prohibited secret.');
    }
    return;
  }

  if (Array.isArray(value)) {
    value.forEach((item, index) => assertSecretFree(item, `${path}[${index}]`));
    return;
  }

  if (value && typeof value === 'object') {
    for (const [key, item] of Object.entries(value)) {
      if (SENSITIVE_KEY.test(key)) {
        fail('Evidence contains a prohibited secret.');
      }
      assertSecretFree(item, `${path}.${key}`);
    }
  }
}

export function assertCanonicalWorkspaceRoot(candidate) {
  if (typeof candidate !== 'string' || candidate.trim() === '' || SHELL_METACHARACTERS.test(candidate) || !isAbsolute(candidate)) {
    fail('Repository selection must be the canonical workspace root.');
  }

  let resolvedCandidate;
  try {
    resolvedCandidate = realpathSync(candidate);
  } catch {
    fail('Repository selection must be the canonical workspace root.');
  }

  if (normalizedPath(resolvedCandidate) !== normalizedPath(CANONICAL_WORKSPACE_ROOT)) {
    fail('Repository selection must be the canonical workspace root.');
  }
  return CANONICAL_WORKSPACE_ROOT;
}

export function assertSafeCommandInput(commandId, args) {
  if (typeof commandId !== 'string' || !(commandId in FIXED_COMMANDS)) {
    fail('Command must be allowlisted.');
  }
  if (!Array.isArray(args) || args.some((argument) => typeof argument !== 'string')) {
    fail('Command arguments must be an array of strings.');
  }
  if (args.some((argument) => SHELL_METACHARACTERS.test(argument))) {
    fail('Command arguments must not contain shell metacharacters.');
  }

  const fixedArgs = FIXED_COMMANDS[commandId].args;
  if (args.length !== fixedArgs.length || args.some((argument, index) => argument !== fixedArgs[index])) {
    fail('Command arguments must match the fixed allowlisted argv.');
  }
  return FIXED_COMMANDS[commandId];
}

export function redactSensitiveText(value, secrets = []) {
  let redacted = String(value ?? '');
  for (const secret of secrets) {
    if (typeof secret === 'string' && secret.length > 0) {
      redacted = redacted.replaceAll(secret, '[REDACTED]');
    }
  }
  redacted = redacted.replace(/\b(password|passwd|secret|token|api[_-]?key|authorization|cookie)\s*([=:])\s*([^\s,;]+)/gi, '$1$2[REDACTED]');
  redacted = redacted.replace(/([a-z][a-z0-9+.-]*:\/\/[^:\s/]+:)([^@\s/]+)@/gi, '$1[REDACTED]@');
  return redacted;
}

export function checksumForRedactedText(value) {
  return `sha256:${createHash('sha256').update(String(value), 'utf8').digest('hex')}`;
}

export function assertEvidenceLogIntegrity(reference, declaredChecksum, { realpathImpl = realpathSync, workspaceRoot = CANONICAL_WORKSPACE_ROOT, logDirectory = EVIDENCE_LOG_DIRECTORY } = {}) {
  if (typeof reference !== 'string' || !SHA256.test(declaredChecksum ?? '')) fail('Evidence must reference a safe local evidence file with a valid checksum.');
  if (isAbsolute(reference) || SHELL_METACHARACTERS.test(reference)) fail('Evidence must reference a safe local evidence file.');
  const resolvedReference = resolve(workspaceRoot, reference);
  let canonicalLogDirectory;
  let canonicalReference;
  let canonicalWorkspaceRoot;
  try {
    canonicalWorkspaceRoot = realpathImpl(workspaceRoot);
    canonicalLogDirectory = realpathImpl(logDirectory);
    canonicalReference = realpathImpl(resolvedReference);
  } catch {
    fail('Evidence must reference a safe local evidence file.');
  }
  const relativeDirectoryPath = relative(canonicalWorkspaceRoot, canonicalLogDirectory);
  if (relativeDirectoryPath === '' || relativeDirectoryPath.startsWith('..') || isAbsolute(relativeDirectoryPath)) fail('Evidence must reference a safe local evidence file.');
  const relativeLogPath = relative(canonicalLogDirectory, canonicalReference);
  if (relativeLogPath === '' || relativeLogPath.startsWith('..') || isAbsolute(relativeLogPath)) fail('Evidence must reference a safe local evidence file.');

  let contents;
  try {
    contents = readFileSync(canonicalReference);
  } catch {
    fail('Evidence must reference a safe local evidence file.');
  }
  assertSecretFree(contents.toString('utf8'));
  const actualChecksum = `sha256:${createHash('sha256').update(contents).digest('hex')}`;
  if (actualChecksum !== declaredChecksum) fail('Evidence file checksum does not match the declared checksum.');
}

export async function runFixedCommand(commandId, { timeoutMs = 10_000, secrets = [], spawnImpl = nodeSpawn } = {}) {
  const fixed = assertSafeCommandInput(commandId, FIXED_COMMANDS[commandId]?.args ?? []);
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 30_000) {
    fail('Command timeout must be an integer between 1 and 30000 milliseconds.');
  }

  return new Promise((resolveResult) => {
    let stdout = '';
    let stderr = '';
    let settled = false;
    let timedOut = false;
    let timeout;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      if (timeout) clearTimeout(timeout);
      const safeStdout = redactSensitiveText(stdout, secrets);
      const safeStderr = redactSensitiveText(stderr, secrets);
      resolveResult({
        ...result,
        stdout: safeStdout,
        stderr: safeStderr,
        stdoutChecksum: checksumForRedactedText(safeStdout),
        stderrChecksum: checksumForRedactedText(safeStderr)
      });
    };

    let child;
    try {
      child = spawnImpl(fixed.command, [...fixed.args], {
        cwd: CANONICAL_WORKSPACE_ROOT,
        shell: false,
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe']
      });
    } catch {
      stderr += 'Failed to start fixed command.';
      finish({ ok: false, timedOut: false, exitCode: null, signal: null });
      return;
    }

    timeout = setTimeout(() => {
      timedOut = true;
      stderr += 'Fixed command timed out.';
      try {
        child.kill('SIGTERM');
      } catch {
        finish({ ok: false, timedOut: true, exitCode: null, signal: null });
      }
    }, timeoutMs);

    child.stdout?.on('data', (chunk) => { stdout += chunk.toString(); });
    child.stderr?.on('data', (chunk) => { stderr += chunk.toString(); });
    child.on('error', () => {
      stderr += 'Failed to run fixed command.';
      finish({ ok: false, timedOut, exitCode: null, signal: null });
    });
    child.on('close', (exitCode, signal) => finish({ ok: !timedOut && exitCode === 0, timedOut, exitCode, signal }));
  });
}

export function assertAllowedEvidencePath(candidate, { realpathImpl = realpathSync } = {}) {
  assertNonEmptyString(candidate, 'Evidence path');
  if (SHELL_METACHARACTERS.test(candidate)) {
    fail('Evidence path contains prohibited shell metacharacters.');
  }
  const resolvedPath = resolve(CANONICAL_WORKSPACE_ROOT, candidate);
  const workspaceRelativePath = relative(CANONICAL_WORKSPACE_ROOT, resolvedPath);
  if (workspaceRelativePath === '' || workspaceRelativePath.startsWith('..') || isAbsolute(workspaceRelativePath) || !resolvedPath.endsWith('.json')) {
    fail('Evidence path must be a JSON file inside the canonical workspace root.');
  }
  let canonicalPath;
  try { canonicalPath = realpathImpl(resolvedPath); } catch { fail('Evidence path must be a readable JSON file inside the canonical workspace root.'); }
  const canonicalRelativePath = relative(CANONICAL_WORKSPACE_ROOT, canonicalPath);
  if (canonicalRelativePath.startsWith('..') || isAbsolute(canonicalRelativePath)) fail('Evidence path must resolve inside the canonical workspace root.');
  return canonicalPath;
}

export function validateEvidenceRecord(record, integrityOptions) {
  assertExactKeys(record, ['schemaVersion', 'evidenceId', 'account', 'deployment', 'capturedAt', 'operator', 'platformFacts', 'hostingConfiguration', 'restartObservation', 'schedulerConfiguration', 'checks', 'approval'], 'Evidence record');
  assertSecretFree(record);
  if (record.schemaVersion !== '1.0') fail('Evidence record schemaVersion must be 1.0.');
  if (typeof record.evidenceId !== 'string' || !UUID.test(record.evidenceId)) fail('Evidence record must have an immutable UUID evidenceId.');
  assertIsoTimestamp(record.capturedAt, 'Evidence capturedAt');
  assertNonEmptyString(record.operator, 'Evidence operator');

  assertExactKeys(record.account, ['id', 'product'], 'Evidence account');
  assertNonEmptyString(record.account.id, 'Evidence account id');
  assertNonEmptyString(record.account.product, 'Evidence account product');
  assertExactKeys(record.deployment, ['id', 'buildId', 'temporaryUrl', 'assignedPort'], 'Evidence deployment');
  assertNonEmptyString(record.deployment.id, 'Evidence deployment id');
  assertNonEmptyString(record.deployment.buildId, 'Evidence deployment buildId');
  assertNonEmptyString(record.deployment.temporaryUrl, 'Evidence deployment temporaryUrl');
  try {
    const temporaryUrl = new URL(record.deployment.temporaryUrl);
    if (!['http:', 'https:'].includes(temporaryUrl.protocol)) fail('Evidence deployment temporaryUrl must be an HTTP(S) URL.');
  } catch {
    fail('Evidence deployment temporaryUrl must be an HTTP(S) URL.');
  }
  if (!Number.isInteger(record.deployment.assignedPort) || record.deployment.assignedPort < 1 || record.deployment.assignedPort > 65535) {
    fail('Evidence deployment assignedPort must be an integer between 1 and 65535.');
  }
  assertExactKeys(record.platformFacts, ['nodeVersion', 'databaseEngine', 'databaseVersion', 'databaseConnectionLimit'], 'Evidence platform facts');
  for (const key of ['nodeVersion', 'databaseEngine', 'databaseVersion', 'databaseConnectionLimit']) assertNonEmptyString(record.platformFacts[key], `Evidence platform fact ${key}`);
  assertExactKeys(record.hostingConfiguration, ['nodeApplicationNavigation', 'logsNavigation', 'databaseNavigation', 'schedulerNavigation', 'applicationRoot', 'selectedNodeVersion', 'installCommand', 'buildCommand', 'startCommand', 'portBehavior'], 'Evidence hosting configuration');
  for (const key of ['nodeApplicationNavigation', 'logsNavigation', 'databaseNavigation', 'schedulerNavigation', 'applicationRoot', 'selectedNodeVersion', 'installCommand', 'buildCommand', 'startCommand', 'portBehavior']) assertNonEmptyString(record.hostingConfiguration[key], `Evidence hosting configuration ${key}`);
  assertExactKeys(record.restartObservation, ['restartControl', 'bootIdBefore', 'bootIdAfter', 'markerState'], 'Evidence restart observation');
  for (const key of ['restartControl', 'bootIdBefore', 'bootIdAfter', 'markerState']) assertNonEmptyString(record.restartObservation[key], `Evidence restart observation ${key}`);
  if (record.restartObservation.bootIdBefore === record.restartObservation.bootIdAfter) fail('Evidence restart observation must prove different boot IDs.');
  if (!['valid', 'missing'].includes(record.restartObservation.markerState)) fail('Evidence restart observation markerState must be valid or missing.');
  assertExactKeys(record.schedulerConfiguration, ['command', 'schedule', 'workingDirectory', 'nodeRuntimeReference'], 'Evidence scheduler configuration');
  for (const key of ['command', 'schedule', 'workingDirectory', 'nodeRuntimeReference']) assertNonEmptyString(record.schedulerConfiguration[key], `Evidence scheduler configuration ${key}`);

  if (!Array.isArray(record.checks) || record.checks.length !== REQUIRED_CAPABILITIES.length) {
    fail('Evidence record must contain all nine required capability checks.');
  }
  const receivedCapabilities = new Set();
  for (const check of record.checks) {
    assertExactKeys(check, ['capability', 'expected', 'observed', 'status', 'redactedLogRef', 'checksum'], 'Evidence capability check');
    if (!REQUIRED_CAPABILITIES.includes(check.capability) || receivedCapabilities.has(check.capability)) {
      fail('Evidence record contains an unknown or duplicate capability check.');
    }
    receivedCapabilities.add(check.capability);
    for (const key of ['expected', 'observed', 'redactedLogRef']) assertNonEmptyString(check[key], `Evidence ${check.capability} ${key}`);
    if (check.status !== 'pass') fail(`Evidence capability ${check.capability} did not pass.`);
    assertEvidenceLogIntegrity(check.redactedLogRef, check.checksum, integrityOptions);
  }
  if (receivedCapabilities.size !== REQUIRED_CAPABILITIES.length) fail('Evidence record must contain all nine required capability checks.');

  assertExactKeys(record.approval, ['approver', 'decision', 'timestamp', 'rationale'], 'Evidence approval');
  assertNonEmptyString(record.approval.approver, 'Evidence approval approver');
  assertIsoTimestamp(record.approval.timestamp, 'Evidence approval timestamp');
  assertNonEmptyString(record.approval.rationale, 'Evidence approval rationale');
  if (record.approval.decision !== 'approved') fail('Evidence approval must be explicitly approved.');

  return { ready: true, evidenceId: record.evidenceId, capabilities: [...receivedCapabilities].sort() };
}

export function verifyEvidenceFile(candidate) {
  const evidencePath = assertAllowedEvidencePath(candidate);
  let record;
  try {
    record = JSON.parse(readFileSync(evidencePath, 'utf8'));
  } catch {
    fail('Evidence file must be readable JSON.');
  }
  return validateEvidenceRecord(record);
}

async function main() {
  const [mode, value, ...extra] = process.argv.slice(2);
  if (mode === '--self-check' && value === undefined && extra.length === 0) {
    const runtime = await runFixedCommand('node-version');
    const output = {
      mode: 'local-safety-self-check',
      qualificationReady: false,
      runtime
    };
    console.log(JSON.stringify(output));
    process.exitCode = runtime.ok ? 0 : 1;
    return;
  }
  if (mode === '--evidence' && typeof value === 'string' && extra.length === 0) {
    const result = verifyEvidenceFile(value);
    console.log(JSON.stringify({ qualificationReady: true, ...result }));
    return;
  }

  console.error('Usage: node ops/hostinger-probe/verify.mjs --self-check | --evidence <workspace-json-path>');
  process.exitCode = 2;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(() => {
    console.error(JSON.stringify({ qualificationReady: false, error: 'Evidence validation failed.' }));
    process.exitCode = 1;
  });
}
