import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { mkdirSync, mkdtempSync, renameSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';

import {
  CANONICAL_WORKSPACE_ROOT,
  assertCanonicalWorkspaceRoot,
  assertSafeCommandInput,
  redactSensitiveText,
  runFixedCommand,
  assertEvidenceLogIntegrity,
  assertAllowedEvidencePath,
  validateEvidenceRecord as validateEvidenceRecordImpl
} from './verify.mjs';

const CAPABILITIES = [
  'nextjs_ssr',
  'server_action_or_api_route',
  'node_runtime',
  'environment_variables',
  'logs',
  'restart_and_filesystem',
  'scheduled_commands',
  'database_access',
  'migration_execution'
];

const checksum = 'sha256:' + 'a'.repeat(64);
const fixtureRoot = mkdtempSync(join(tmpdir(), 'hostinger-probe-evidence-'));
const fixtureLogReference = 'evidence/logs/verify-fixture.log';
const fixtureLogPath = join(fixtureRoot, ...fixtureLogReference.split('/'));
const fixtureLogContent = 'redacted evidence fixture\n';
mkdirSync(dirname(fixtureLogPath), { recursive: true });
writeFileSync(fixtureLogPath, fixtureLogContent, 'utf8');
const fixtureChecksum = `sha256:${createHash('sha256').update(fixtureLogContent).digest('hex')}`;
process.on('exit', () => rmSync(fixtureRoot, { recursive: true, force: true }));
const integrityOptions = { workspaceRoot: fixtureRoot, logDirectory: dirname(fixtureLogPath) };
const validateEvidenceRecord = (record) => validateEvidenceRecordImpl(record, integrityOptions);

function approvedEvidence() {
  return {
    schemaVersion: '1.0',
    evidenceId: '00000000-0000-4000-8000-000000000001',
    account: { id: 'account-reference', product: 'Business Web Hosting' },
    deployment: { id: 'deployment-reference', buildId: 'build-reference', temporaryUrl: 'https://probe.example.test', assignedPort: 443 },
    capturedAt: '2026-07-30T12:00:00.000Z',
    operator: 'operator-reference',
    platformFacts: { nodeVersion: 'v22.0.0', databaseEngine: 'MariaDB', databaseVersion: '11.0', databaseConnectionLimit: '100' },
    hostingConfiguration: {
      nodeApplicationNavigation: 'Websites > Dashboard > Node.js',
      logsNavigation: 'Websites > Dashboard > Logs',
      databaseNavigation: 'Websites > Dashboard > MySQL Databases',
      schedulerNavigation: 'Websites > Dashboard > Advanced Cron Jobs',
      applicationRoot: '/home/example/hostinger-probe',
      selectedNodeVersion: 'v22.0.0',
      installCommand: 'npm ci',
      buildCommand: 'npm run build',
      startCommand: 'npm start',
      portBehavior: 'Provider-assigned port consumed through PORT when present'
    },
    restartObservation: {
      restartControl: 'hPanel restart control',
      bootIdBefore: 'boot-before',
      bootIdAfter: 'boot-after',
      markerState: 'valid'
    },
    schedulerConfiguration: {
      command: 'npm run scheduled',
      schedule: 'one-time qualification run',
      workingDirectory: '/home/example/hostinger-probe',
      nodeRuntimeReference: 'hPanel-selected Node runtime'
    },
    checks: CAPABILITIES.map((capability) => ({
      capability,
      expected: 'Expected probe result',
      observed: 'Observed probe result',
      status: 'pass',
      redactedLogRef: fixtureLogReference,
      checksum: fixtureChecksum
    })),
    approval: {
      approver: 'authorized-reviewer',
      decision: 'approved',
      timestamp: '2026-07-30T12:05:00.000Z',
      rationale: 'All required capabilities have account-specific evidence.'
    }
  };
}

function childProcessFixture({ stdout = '', stderr = '', closeCode = 0, neverClose = false } = {}) {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.kill = () => {
    queueMicrotask(() => child.emit('close', 1, 'SIGTERM'));
    return true;
  };
  if (!neverClose) {
    queueMicrotask(() => {
      if (stdout) child.stdout.emit('data', Buffer.from(stdout));
      if (stderr) child.stderr.emit('data', Buffer.from(stderr));
      child.emit('close', closeCode, null);
    });
  }
  return child;
}

test('accepts only the canonical workspace root', () => {
  assert.equal(assertCanonicalWorkspaceRoot(CANONICAL_WORKSPACE_ROOT), CANONICAL_WORKSPACE_ROOT);
});

test('rejects git -C repository selectors before a command can run', () => {
  assert.throws(() => assertCanonicalWorkspaceRoot('git -C C:/outside status'), /canonical workspace root/i);
});

test('rejects external relative repository selectors', () => {
  assert.throws(() => assertCanonicalWorkspaceRoot('../outside'), /canonical workspace root/i);
});

test('rejects external absolute repository selectors', () => {
  assert.throws(() => assertCanonicalWorkspaceRoot('C:/outside'), /canonical workspace root/i);
});

test('rejects shell metacharacters from command names and arguments', () => {
  assert.throws(() => assertSafeCommandInput('node; whoami', ['--version']), /allowlisted/i);
  assert.throws(() => assertSafeCommandInput('node-version', ['--version; whoami']), /metacharacters/i);
});

test('fails closed when a fixed command exceeds its timeout', async () => {
  const result = await runFixedCommand('node-version', {
    timeoutMs: 10,
    spawnImpl: () => childProcessFixture({ neverClose: true })
  });

  assert.equal(result.ok, false);
  assert.equal(result.timedOut, true);
  assert.match(result.stderr, /timed out/i);
});

test('fails closed when the fixed command cannot start', async () => {
  const result = await runFixedCommand('node-version', {
    spawnImpl: () => {
      throw new Error('fixture startup failure');
    }
  });

  assert.equal(result.ok, false);
  assert.match(result.stderr, /failed to start/i);
});

test('uses fixed argv and shell false for the local runtime command', async () => {
  let invocation;
  const result = await runFixedCommand('node-version', {
    spawnImpl: (command, args, options) => {
      invocation = { command, args, options };
      return childProcessFixture({ stdout: 'v22.0.0\n' });
    }
  });

  assert.equal(result.ok, true);
  assert.deepEqual(invocation.args, ['--version']);
  assert.equal(invocation.options.shell, false);
  assert.equal(invocation.options.cwd, CANONICAL_WORKSPACE_ROOT);
});

test('redacts secrets from stdout, stderr, and evidence validation failures', async () => {
  const secret = 'TOP_SECRET_VALUE';
  const result = await runFixedCommand('node-version', {
    secrets: [secret],
    spawnImpl: () => childProcessFixture({ stdout: `stdout=${secret}`, stderr: `stderr=${secret}`, closeCode: 1 })
  });

  assert.doesNotMatch(result.stdout, new RegExp(secret));
  assert.doesNotMatch(result.stderr, new RegExp(secret));
  assert.match(result.stdout, /\[REDACTED\]/);
  assert.match(result.stderr, /\[REDACTED\]/);
  assert.equal(redactSensitiveText(`token=${secret}`, [secret]), 'token=[REDACTED]');

  const evidence = approvedEvidence();
  evidence.checks[0].observed = secret;
  assert.throws(() => validateEvidenceRecord(evidence), (error) => {
    assert.doesNotMatch(error.message, new RegExp(secret));
    return /prohibited secret/i.test(error.message);
  });
});

test('requires all nine passing capability checks and explicit approval', () => {
  assert.equal(validateEvidenceRecord(approvedEvidence()).ready, true);

  const incomplete = approvedEvidence();
  incomplete.checks.pop();
  assert.throws(() => validateEvidenceRecord(incomplete), /nine required capability checks/i);

  const unapproved = approvedEvidence();
  unapproved.approval.decision = 'rejected';
  assert.throws(() => validateEvidenceRecord(unapproved), /approved/i);
});

test('requires strict RFC3339 timestamps and a changed restart boot ID', () => {
  const invalidDate = approvedEvidence();
  invalidDate.capturedAt = '2026-02-30T12:00:00Z';
  assert.throws(() => validateEvidenceRecord(invalidDate), /RFC3339/i);
  const unchangedBoot = approvedEvidence();
  unchangedBoot.restartObservation.bootIdAfter = unchangedBoot.restartObservation.bootIdBefore;
  assert.throws(() => validateEvidenceRecord(unchangedBoot), /different boot IDs/i);
});

test('rejects evidence input paths whose canonical target escapes the workspace', () => {
  assert.throws(() => assertAllowedEvidencePath('ops/hostinger-probe/evidence.json', { realpathImpl: () => join(dirname(CANONICAL_WORKSPACE_ROOT), 'outside.json') }), /resolve inside/i);
});

test('rejects secret-bearing bytes in referenced redacted logs', () => {
  const secretContent = 'password=not-redacted\n';
  writeFileSync(fixtureLogPath, secretContent, 'utf8');
  const evidence = approvedEvidence();
  evidence.checks[0].checksum = `sha256:${createHash('sha256').update(secretContent).digest('hex')}`;
  try { assert.throws(() => validateEvidenceRecord(evidence), /prohibited secret/i); }
  finally { writeFileSync(fixtureLogPath, fixtureLogContent, 'utf8'); }
});

test('rejects local evidence references outside the dedicated evidence directory', () => {
  const traversal = approvedEvidence();
  traversal.checks[0].redactedLogRef = '../outside.log';
  assert.throws(() => validateEvidenceRecord(traversal), /safe local evidence file/i);

  const absolute = approvedEvidence();
  absolute.checks[0].redactedLogRef = 'C:/outside.log';
  assert.throws(() => validateEvidenceRecord(absolute), /safe local evidence file/i);

  const outsideEvidenceDirectory = approvedEvidence();
  outsideEvidenceDirectory.checks[0].redactedLogRef = 'docs/deployment/hostinger-evidence.yaml';
  assert.throws(() => validateEvidenceRecord(outsideEvidenceDirectory), /safe local evidence file/i);
});

test('rejects missing evidence files and checksum mismatches without exposing their contents', () => {
  const missing = approvedEvidence();
  missing.checks[0].redactedLogRef = 'evidence/logs/missing.log';
  assert.throws(() => validateEvidenceRecord(missing), /safe local evidence file/i);

  const tampered = approvedEvidence();
  tampered.checks[0].checksum = 'sha256:' + 'b'.repeat(64);
  assert.throws(() => validateEvidenceRecord(tampered), /checksum/i);
});

test('rejects an evidence link whose canonical target escapes the evidence directory', () => {
  const outsideTarget = join(fixtureRoot, 'outside-evidence-target.log');
  const linkReference = 'evidence/logs/linked-outside.log';
  const linkPath = join(fixtureRoot, ...linkReference.split('/'));
  writeFileSync(outsideTarget, fixtureLogContent, 'utf8');
  try {
    try {
      symlinkSync(outsideTarget, linkPath, 'file');
      const linkedEvidence = approvedEvidence();
      linkedEvidence.checks[0].redactedLogRef = linkReference;
      assert.throws(() => validateEvidenceRecord(linkedEvidence), /safe local evidence file/i);
    } catch (error) {
      if (error?.code !== 'EPERM' && error?.code !== 'EACCES') throw error;
      assert.throws(
        () => assertEvidenceLogIntegrity(fixtureLogReference, fixtureChecksum, { ...integrityOptions, realpathImpl: (path) => path === fixtureLogPath ? outsideTarget : path }),
        /safe local evidence file/i
      );
    }
  } finally {
    try { unlinkSync(linkPath); } catch {}
    rmSync(outsideTarget, { force: true });
  }
});

test('rejects an evidence logs directory link whose canonical target escapes the workspace', () => {
  const logsDirectory = dirname(fixtureLogPath);
  const parkedDirectory = `${logsDirectory}-parked`;
  const outsideDirectory = `${fixtureRoot}-outside-logs`;
  mkdirSync(outsideDirectory, { recursive: true });
  writeFileSync(join(outsideDirectory, 'verify-fixture.log'), fixtureLogContent, 'utf8');
  renameSync(logsDirectory, parkedDirectory);
  try {
    try {
      symlinkSync(outsideDirectory, logsDirectory, process.platform === 'win32' ? 'junction' : 'dir');
      assert.throws(() => validateEvidenceRecord(approvedEvidence()), /safe local evidence file/i);
    } catch (error) {
      if (error?.code !== 'EPERM' && error?.code !== 'EACCES') throw error;
      assert.throws(
        () => assertEvidenceLogIntegrity(fixtureLogReference, fixtureChecksum, {
          ...integrityOptions,
          realpathImpl: (path) => path === logsDirectory || path === fixtureLogPath
            ? join(outsideDirectory, path === logsDirectory ? '' : 'verify-fixture.log')
            : path
        }),
        /safe local evidence file/i
      );
    }
  } finally {
    try { unlinkSync(logsDirectory); } catch {}
    renameSync(parkedDirectory, logsDirectory);
    rmSync(outsideDirectory, { recursive: true, force: true });
  }
});
