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
  },
  {
    name: 'compound exits run ancestor before descendant',
    file: 'packages/core/src/stateUtils.ts',
    before: 'statesToExit.sort((a, b) => b.order - a.order);',
    after: 'statesToExit.sort((a, b) => a.order - b.order);',
    testFile: 'packages/core/test/machine-model/compoundModel.test.ts',
    test: 'orders multiple exits and entries around a pre-exit transition calculation'
  },
  {
    name: 'parallel domain is never narrowed to a region',
    file: 'packages/core/src/stateUtils.ts',
    before: "while (narrowed.type === 'parallel') {",
    after: "while (narrowed.type === 'parallel' && targetStates.length < 0) {",
    testFile: 'packages/core/test/machine-model/parallelModel.test.ts',
    test: 'narrows a cross-region transition to the target region'
  },
  {
    name: 'parallel regions are entered in reverse document order',
    file: 'packages/core/src/stateUtils.ts',
    before: `for (const stateNodeToEnter of [...statesToEnter].sort(
        (a, b) => a.order - b.order`,
    after: `for (const stateNodeToEnter of [...statesToEnter].sort(
        (a, b) => b.order - a.order`,
    testFile: 'packages/core/test/machine-model/parallelModel.test.ts',
    test: 'enters every region of a root-level parallel machine in document order'
  },
  {
    name: 'a later conflicting transition preempts an earlier one',
    file: 'packages/core/src/stateUtils.ts',
    before: 'if (isDescendant(t1.source, t2.source)) {',
    after: 'if (t1 !== t2) {',
    testFile: 'packages/core/test/machine-model/parallelModel.test.ts',
    test: 'keeps the earlier of two regions that both leave the parallel node'
  },
  {
    name: 'kept transition patches merge in reverse order',
    file: 'packages/core/src/stateUtils.ts',
    before: 'for (const t of filteredTransitions) {',
    after: 'for (const t of [...filteredTransitions].reverse()) {',
    testFile: 'packages/core/test/machine-model/parallelModel.test.ts',
    test: 'merges patches in region order'
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
        defect.testFile ??
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
