import assert from 'node:assert/strict';
import test from 'node:test';

import { scanCandidateText } from '../scripts/audit-publication.mjs';

test('an acknowledged signature occurrence does not mask another occurrence', () => {
  const credentialKey = ['tok', 'en'].join('');
  const fixture = `${credentialKey}=synthetic-placeholder\n${credentialKey}=synthetic-real-looking-value`;
  const expected = new Map([
    ['fixture.txt:credential-value', { count: 1, explanation: 'Synthetic fixture occurrence.' }]
  ]);

  const result = scanCandidateText('fixture.txt', fixture, expected);

  assert.equal(result.acknowledgedFindings.length, 1);
  assert.equal(result.findings.length, 1);
  assert.ok(result.findings[0].offset > result.acknowledgedFindings[0].offset);
});
