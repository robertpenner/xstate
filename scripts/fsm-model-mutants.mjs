// Mutation testing for the tests in packages/core/test/fsm-model (see its
// README). Each mutant rewrites one expression in packages/core/src/fsm.ts,
// runs the named tests and the property test once, and records which of them
// fail. The script restores fsm.ts after every mutant and refuses to start
// when fsm.ts has uncommitted changes.
//
// Usage: node scripts/fsm-model-mutants.mjs [--seed N] [--only M01,M02]
//
// The property test uses FSM_MODEL_SEED (default 1) so that every mutant
// meets the same generated machines. Exits 1 when a mutant that is not listed
// as expected to survive passes, when a mutant listed that way is caught, or
// when the unmutated source fails.
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sourceFile = 'packages/core/src/fsm.ts';
const sourcePath = path.join(root, sourceFile);
const testDirectory = 'packages/core/test/fsm-model';
const files = {
  named: 'fsmModel.test.ts',
  property: 'fsmModel.property.test.ts'
};

// `find` must occur exactly once in fsm.ts. `survives` gives the reason a
// mutant is expected to pass: either it cannot change behavior, or it changes
// behavior only for inputs that the model does not cover.
const mutants = [
  {
    id: 'M01',
    description: 'compare patch values with !== instead of Object.is',
    find: '!Object.is(patch![key], context[key])',
    replace: 'patch![key] !== context[key]'
  },
  {
    id: 'M02',
    description: 'drop the own-key check before comparing a patch value',
    find: '!Object.hasOwn(context, key) ||',
    replace: 'false ||'
  },
  {
    id: 'M03',
    description: 'iterate the patch with for...in instead of own keys',
    find: 'for (const key of Reflect.ownKeys({ ...patch }) as (keyof TContext)[])',
    replace: 'for (const key in patch as any)'
  },
  {
    id: 'M04',
    description: 'look up the state without the own-key guard',
    find: 'Object.hasOwn(config.states, value) ? config.states[value] : undefined',
    replace: 'config.states[value]'
  },
  {
    id: 'M05',
    description: 'look up the event with `in` instead of Object.hasOwn',
    find: 'Object.hasOwn(transitions || {}, event.type) &&',
    replace: 'event.type in (transitions || {}) &&'
  },
  {
    id: 'M06',
    description: 'reuse the snapshot without checking the target',
    find: 'target === value && context === snapshot.context',
    replace: 'true && context === snapshot.context'
  },
  {
    id: 'M07',
    description: 'default a falsy transition result with ?? instead of ||',
    find: ': transition) || {};',
    replace: ': transition) ?? {};',
    survives:
      'Equivalent: || and ?? differ only for false, 0, NaN, 0n and the empty string, and destructuring those gives an undefined target and patch, as {} does.'
  },
  {
    id: 'M08',
    description: 'reuse the snapshot without checking the context',
    find: 'target === value && context === snapshot.context',
    replace: 'target === value && true'
  },
  {
    id: 'M09',
    description: 'reuse the snapshot when either the target or context matches',
    find: 'target === value && context === snapshot.context',
    replace: 'target === value || context === snapshot.context'
  },
  {
    id: 'M10',
    description: 'let the old context override the patch',
    find: 'context = { ...context, ...patch };',
    replace: 'context = { ...patch, ...context };'
  },
  {
    id: 'M11',
    description: 'replace the context with the patch',
    find: 'context = { ...context, ...patch };',
    replace: 'context = { ...patch };'
  },
  {
    id: 'M12',
    description: 'copy the context without applying the patch',
    find: 'context = { ...context, ...patch };',
    replace: 'context = { ...context };'
  },
  {
    id: 'M13',
    description: 'iterate string keys only, skipping symbol keys',
    find: 'Reflect.ownKeys({ ...patch })',
    replace: 'Object.keys({ ...patch })'
  },
  {
    id: 'M14',
    description: 'iterate the patch directly instead of a spread copy',
    find: 'Reflect.ownKeys({ ...patch })',
    replace: 'Reflect.ownKeys(patch ?? {})',
    survives:
      'Outside the model: with a non-enumerable own patch key, the mutant copies the context and createFSM does not. The adapter refuses non-enumerable keys.'
  },
  {
    id: 'M15',
    description: 'stop iterating after the first copy',
    find: 'context = { ...context, ...patch };',
    replace: 'context = { ...context, ...patch }; break;',
    survives:
      'Equivalent: after the copy, every own data key of the patch holds the same value in the new context, so later keys never copy again.'
  },
  {
    id: 'M16',
    description: 'default a missing target to the initial state',
    find: 'const { target = value,',
    replace: 'const { target = config.initial,'
  },
  {
    id: 'M17',
    description: 'pass an empty context to transition functions',
    find: 'transition({ context, event })',
    replace: 'transition({ context: {} as TContext, event })'
  },
  {
    id: 'M18',
    description: 'copy when a patch value is unchanged instead of changed',
    find: '!Object.is(patch![key], context[key])',
    replace: 'Object.is(patch![key], context[key])'
  },
  {
    id: 'M19',
    description: 'copy only when the key is missing and the value changed',
    find: '!Object.hasOwn(context, key) ||',
    replace: '!Object.hasOwn(context, key) &&'
  },
  {
    id: 'M20',
    description: 'start from an empty context instead of config.context',
    find: 'config.context ?? ({} as TContext)',
    replace: '({} as TContext)'
  },
  {
    id: 'M21',
    description: 'look up the state with `in` instead of Object.hasOwn',
    find: 'Object.hasOwn(config.states, value)',
    replace: 'value in config.states'
  },
  {
    id: 'M22',
    description: 'treat an empty-string target as no target',
    find: 'createSnapshot(target, context)',
    replace: 'createSnapshot(target || value, context)'
  },
  {
    id: 'M23',
    description: 'default a missing initial context with || instead of ??',
    find: 'config.context ?? ({} as TContext)',
    replace: 'config.context || ({} as TContext)',
    survives:
      'Equivalent: a context is an object or undefined, and || and ?? differ only for falsy values other than null and undefined.'
  },
  {
    id: 'M24',
    description: 'check only the first patch key',
    find: 'Reflect.ownKeys({ ...patch })',
    replace: 'Reflect.ownKeys({ ...patch }).slice(0, 1)'
  },
  {
    id: 'M25',
    description: 'compare with !== and no own-key check, as before c70dd85',
    find: '!Object.hasOwn(context, key) ||\n          !Object.is(patch![key], context[key])',
    replace: 'patch![key] !== context[key]'
  }
];

const options = parseArguments(process.argv.slice(2));
const original = readFileSync(sourcePath, 'utf8');
const scratch = mkdtempSync(path.join(tmpdir(), 'fsm-model-mutants-'));
let failed = false;

const dirty = spawnSync('git', ['status', '--porcelain', '--', sourceFile], {
  cwd: root,
  encoding: 'utf8'
});
if (dirty.status !== 0 || dirty.stdout.trim() !== '') {
  console.error(`${sourceFile} has uncommitted changes; commit or stash them.`);
  process.exit(1);
}

const restore = () => writeFileSync(sourcePath, original);
for (const signal of ['SIGINT', 'SIGTERM'])
  process.on(signal, () => {
    restore();
    process.exit(130);
  });

try {
  const baseline = runTests('baseline');
  if (!baseline.named || !baseline.property) {
    console.error('The unmutated source fails the tests:', baseline);
    process.exit(1);
  }
  console.log(`seed ${options.seed}; unmutated source passes\n`);

  const selected = mutants.filter(
    (mutant) => !options.only || options.only.includes(mutant.id)
  );
  const results = [];
  for (const mutant of selected) {
    const count = original.split(mutant.find).length - 1;
    if (count !== 1)
      throw new Error(`${mutant.id}: expected one match, found ${count}`);
    writeFileSync(sourcePath, original.replace(mutant.find, mutant.replace));
    let passed;
    try {
      passed = runTests(mutant.id);
    } finally {
      restore();
    }
    const caughtBy = Object.keys(files).filter((name) => !passed[name]);
    const caught = caughtBy.length > 0;
    const unexpected = caught === Boolean(mutant.survives);
    if (unexpected) failed = true;
    results.push({ mutant, caughtBy });
    console.log(
      `${mutant.id} ${caught ? `caught by ${caughtBy.join(' and ')}` : 'survived'}` +
        `${mutant.survives ? ' (expected to survive)' : ''}` +
        `${unexpected ? ' UNEXPECTED' : ''}: ${mutant.description}`
    );
  }

  const killable = results.filter(({ mutant }) => !mutant.survives);
  const count = (name) =>
    killable.filter(({ caughtBy }) => caughtBy.includes(name)).length;
  const caught = killable.filter(({ caughtBy }) => caughtBy.length > 0).length;
  console.log(
    `\n${caught}/${killable.length} mutants caught ` +
      `(named tests ${count('named')}, property test ${count('property')}); ` +
      `${results.length - killable.length} expected to survive`
  );
} finally {
  restore();
  rmSync(scratch, { recursive: true, force: true });
}
if (readFileSync(sourcePath, 'utf8') !== original)
  throw new Error(`${sourceFile} was not restored`);
process.exit(failed ? 1 : 0);

// Returns whether each test file passed.
function runTests(label) {
  const report = path.join(scratch, `${label}.json`);
  spawnSync(
    path.join(root, 'node_modules/.bin/vitest'),
    [
      'run',
      '--project',
      'xstate',
      testDirectory,
      '--reporter=json',
      `--outputFile=${report}`
    ],
    {
      cwd: root,
      env: { ...process.env, FSM_MODEL_SEED: String(options.seed) },
      stdio: 'ignore'
    }
  );
  const { testResults } = JSON.parse(readFileSync(report, 'utf8'));
  return Object.fromEntries(
    Object.entries(files).map(([name, file]) => {
      const result = testResults.find((entry) => entry.name.endsWith(file));
      if (!result) throw new Error(`${label}: no result for ${file}`);
      return [name, result.status === 'passed'];
    })
  );
}

function parseArguments(argv) {
  const parsed = { seed: 1, only: undefined };
  for (let index = 0; index < argv.length; index += 2) {
    const [flag, value] = [argv[index], argv[index + 1]];
    if (flag === '--seed' && Number.isInteger(Number(value)))
      parsed.seed = Number(value);
    else if (flag === '--only' && value) parsed.only = value.split(',');
    else {
      console.error(
        'Usage: node scripts/fsm-model-mutants.mjs [--seed N] [--only M01,M02]'
      );
      process.exit(2);
    }
  }
  return parsed;
}
