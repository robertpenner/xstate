// Temporary mutations run only in a clean, dedicated worktree. Original source
// is restored even when a test process fails; do not run other checks concurrently.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const defects = [
  {
    name: 'fast-path ignores static targets',
    file: 'packages/core/src/StateMachine.ts',
    before: 'const targetNode = selected.target?.[0] ?? sourceNode;',
    after: 'const targetNode = sourceNode;',
    test: 'initializes, handles targetless events'
  },
  {
    name: 'patch merge discards values',
    file: 'packages/core/src/transitionActions.ts',
    before: 'return { ...context, ...patch };',
    after: 'return { ...context };',
    test: 'orders exit, transition, and entry effects'
  }
];
for (const defect of defects) {
  const file = path.join(root, defect.file);
  const original = readFileSync(file, 'utf8');
  const status = spawnSync(
    'git',
    ['status', '--porcelain', '--', defect.file],
    {
      cwd: root,
      encoding: 'utf8'
    }
  );
  assert.equal(status.status, 0, status.stderr);
  assert.equal(
    status.stdout,
    '',
    `Refusing to mutate edited source: ${defect.file}`
  );
  assert.equal(original.split(defect.before).length, 2, defect.name);
  try {
    writeFileSync(file, original.replace(defect.before, defect.after));
    const result = spawnSync(
      'pnpm',
      [
        'exec',
        'vitest',
        'run',
        '--project',
        'xstate',
        'packages/core/test/machine-model/machineModel.test.ts',
        '-t',
        defect.test
      ],
      { cwd: root, encoding: 'utf8', timeout: 60_000 }
    );
    if (result.error) throw result.error;
    assert.equal(result.signal, null);
    const output = result.stdout + result.stderr;
    assert.notEqual(
      result.status,
      0,
      `Undetected runtime defect: ${defect.name}`
    );
    assert.match(output, /AssertionError/, output);
    assert.match(output, /1 failed/, output);
    console.log(`Rejected runtime defect: ${defect.name}`);
  } finally {
    writeFileSync(file, original);
  }
  assert.equal(readFileSync(file, 'utf8'), original);
}
console.log('Runtime defects rejected; original source restored.');
