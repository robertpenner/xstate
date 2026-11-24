// Runs the synchronous-processing probes for robertpenner/xstate#24 under an
// external deadline. A cycle that escapes maxIterations loops synchronously,
// which vitest's own test timeout cannot interrupt, so the whole process group
// is killed when the deadline passes.
import { childTimeout, runCommand } from './machine-model-process.mjs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const timeoutMs = childTimeout('MACHINE_MODEL_SYNC_PROBES_TIMEOUT_MS', 120_000);
const files = [
  'packages/core/test/machine-model/synchronousProcessing.probes.test.ts',
  'packages/core/test/machine-model/synchronousProcessing.cycles.test.ts'
];

let result;
try {
  result = await runCommand(
    'pnpm',
    ['exec', 'vitest', 'run', '--project', 'xstate', ...files],
    { cwd: root, timeoutMs }
  );
} catch (error) {
  console.error(
    `Harness deadline or interruption: ${error.message}\n` +
      'A probe may have entered an unbounded synchronous loop.'
  );
  process.exit(process.exitCode || 2);
}

process.stdout.write(result.output);
if (result.status !== 0) {
  const unexpectedBound = /InfiniteTransitionError/.test(result.output);
  console.error(
    unexpectedBound
      ? 'Probe failure that mentions InfiniteTransitionError: a bound fired where the probe expected none, or with different details.'
      : 'Probe assertion failure: runtime behavior differs from the recorded observation.'
  );
  process.exit(1);
}
