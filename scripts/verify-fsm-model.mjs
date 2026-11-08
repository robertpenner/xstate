// Checks the LemmaScript model of `xstate/fsm` in packages/core/test/fsm-model
// (see its README): the committed Dafny matches what LemmaScript generates from
// fsmModel.ts, the laws verify, every deliberate defect in the manifest makes
// verification fail, and a behavior-preserving rewrite makes the committed
// Dafny stale but still verifies after regeneration.
//
// Requires Dafny 4.11.0 on PATH and LEMMASCRIPT_LSC set to `tools/dist/lsc.js`
// from lemmascript@0.6.6, installed outside this workspace.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync
} from 'node:fs';
import { availableParallelism, tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const modelDirectory = path.join(root, 'packages/core/test/fsm-model');
const generatedPath = 'formal/fsmModel.dfy.gen';
const proofPath = 'formal/fsmModel.dfy';
const lscOptions = [
  '--backend=dafny',
  '--time-limit=15',
  '--extra-flags=--cores=2'
];
const proofFailure =
  /a postcondition could not be proved|assertion might not hold/;

const read = (file) => readFileSync(path.join(modelDirectory, file), 'utf8');
const manifest = JSON.parse(read('formal/fsmModel.manifest.json'));
const inputs = {
  source: read(manifest.source),
  config: read('lemmascript.json'),
  generated: read(generatedPath),
  proof: read(proofPath)
};

const lsc = process.env.LEMMASCRIPT_LSC;
assert.ok(
  lsc,
  'Set LEMMASCRIPT_LSC to tools/dist/lsc.js from lemmascript@0.6.6.'
);

function run(command, args, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd });
    let output = '';
    child.stdout.on('data', (chunk) => (output += chunk));
    child.stderr.on('data', (chunk) => (output += chunk));
    child.on('error', reject);
    child.on('close', (status) => resolve({ status, output }));
  });
}

const runLsc = (mode, directory) =>
  run(process.execPath, [lsc, mode, ...lscOptions, manifest.source], directory);

const names = (text, pattern) =>
  [...text.matchAll(pattern)].map((match) => match[1]).sort();

const stripComments = (text) =>
  text.replace(/\/\/[^\n]*|\/\*[\s\S]*?\*\//g, '');

const declarationKeyword =
  /\b(?:lemma|function|predicate|method|constructor|datatype|codatatype|newtype|type|const|class|trait|module|iterator)\b/;
const clauseKeyword = /\b(?:requires|ensures|decreases|reads|modifies)\b/;

// Words after which Dafny still expects an expression, so a following `{`
// would open a set display or a `match` body inside the clause.
const continuingWord = new Set(
  (
    'in if then else match case set iset multiset map imap seq forall exists ' +
    'var calc assert assume expect reveal requires ensures decreases reads ' +
    'modifies as is by old fresh unchanged allocated new label'
  ).split(' ')
);

const balanced = (text, open, close) => {
  let depth = 0;
  for (const character of text) {
    if (character === open) depth += 1;
    else if (character === close && --depth < 0) return false;
  }
  return depth === 0;
};

// True when the clause text before a line-opening `{` is a complete
// expression, so the `{` cannot continue it.
function endsClauses(header) {
  if (
    !balanced(header, '(', ')') ||
    !balanced(header, '[', ']') ||
    !balanced(header, '{', '}')
  )
    return false;
  if (!clauseKeyword.test(header)) return true;
  const matches = [...header.matchAll(/\bmatch\b/g)];
  if (matches.length > 0 && !header.slice(matches.at(-1).index).includes('{'))
    return false;
  const end = header.trimEnd();
  if (/[)\]}"]$/.test(end)) return true;
  if (/(?:^|[^|])\|[A-Za-z_][\w.'?]*\|$/.test(end)) return true;
  const word = end.match(/(?:^|[^\w.'?])([\w.'?]*[\w'?])$/)?.[1];
  return word !== undefined && !continuingWord.has(word.split('.').at(-1));
}

// Names the declarations whose body opens a line after complete clauses. A
// lemma or function without a body would be an axiom; Dafny warns about it
// and `dafny verify` fails, but this check names the declaration first.
const bodied = (text, keyword) =>
  [
    ...text.matchAll(
      new RegExp(
        `\\b${keyword} (\\w+)(\\([^\\n]*\\n(?:[ \\t]+[^\\n]*\\n)*)\\{`,
        'g'
      )
    )
  ]
    .filter(
      ([, , header]) => !declarationKeyword.test(header) && endsClauses(header)
    )
    .map(([, name]) => name)
    .sort();

// The proof file is the generated model followed by specification functions
// and lemmas. It may not assume anything, declare executable code, or use
// verifier attributes, and every contract and law in the manifest must remain.
function assertProof(generated, proof) {
  const functions = Object.keys(manifest.functions);
  const lemmas = [
    ...functions.map((name) => `${name}_ensures`),
    ...manifest.laws
  ].sort();
  assert.ok(
    proof.startsWith(generated),
    'The proof must begin with the generated model, unchanged.'
  );
  const code = stripComments(proof);
  const appended = stripComments(proof.slice(generated.length));
  assert.doesNotMatch(
    code,
    /\b(assume|expect|include|import|method|type|const)\b|\{\s*:/,
    'The proof may not use assumptions, executable code, or attributes.'
  );
  assert.deepEqual(
    names(code, /\b(?:function|predicate) (\w+)/g),
    [...functions, ...manifest.specFunctions].sort(),
    'Only model functions and listed specification functions may be declared.'
  );
  assert.deepEqual(
    names(appended, /\bghost (?:function|predicate) (\w+)/g),
    [...manifest.specFunctions].sort(),
    'Specification functions must be ghost declarations after the model.'
  );
  assert.deepEqual(
    bodied(appended, 'ghost (?:function|predicate)'),
    [...manifest.specFunctions].sort(),
    'Every specification function must have a body.'
  );
  assert.deepEqual(
    names(code, /\blemma (\w+)/g),
    lemmas,
    'Every contract and law in the manifest must be present.'
  );
  assert.deepEqual(
    bodied(code, 'lemma'),
    lemmas,
    'Every lemma must have a proof body.'
  );
  const lines = generated.split('\n');
  for (const declaration of manifest.modelDeclarations)
    assert.ok(
      lines.includes(declaration),
      `Missing generated declaration: ${declaration}`
    );
  for (const [name, { ensures }] of Object.entries(manifest.functions)) {
    for (const declaration of [`function ${name}`, `lemma ${name}_ensures`]) {
      const header = generated.match(
        new RegExp(`^${declaration}\\([^\\n]*\\n((?:  [^\\n]*\\n)*)\\{`, 'm')
      );
      assert.ok(header, `Missing generated declaration: ${declaration}`);
      const clauses = header[1]
        .split('\n')
        .filter((line) => /^\s*(requires|ensures) /.test(line));
      assert.deepEqual(
        clauses,
        declaration.startsWith('lemma ')
          ? ensures.map((clause) => `  ensures ${clause}`)
          : [],
        `${declaration} must have exactly the manifest's contract.`
      );
    }
  }
}

function prepare(directory, source) {
  mkdirSync(path.join(directory, 'formal'), { recursive: true });
  writeFileSync(path.join(directory, manifest.source), source);
  writeFileSync(path.join(directory, 'lemmascript.json'), inputs.config);
  writeFileSync(path.join(directory, generatedPath), inputs.generated);
  writeFileSync(path.join(directory, proofPath), inputs.proof);
}

function replaceOnce(text, before, after) {
  assert.equal(
    text.split(before).length,
    2,
    `Expected one occurrence of ${JSON.stringify(before)}`
  );
  return text.replace(before, after);
}

function assertVerified(result) {
  assert.equal(result.status, 0, result.output);
  assert.match(
    result.output,
    new RegExp(`finished with ${manifest.verifiedCount} verified, 0 errors`)
  );
}

function assertRegenerated(directory) {
  assertProof(
    readFileSync(path.join(directory, generatedPath), 'utf8'),
    readFileSync(path.join(directory, proofPath), 'utf8')
  );
}

async function verifyBaseline(directory) {
  prepare(directory, inputs.source);
  const generation = await runLsc('gen', directory);
  assert.equal(generation.status, 0, generation.output);
  assert.equal(
    readFileSync(path.join(directory, generatedPath), 'utf8'),
    inputs.generated,
    `${generatedPath} is stale. Regenerate it with lsc regen and review the proof.`
  );
  const check = await runLsc('check', directory);
  assertVerified(check);
  console.log(check.output.trim().split('\n').at(-1));
}

async function rejectDefect(directory, defect) {
  prepare(directory, replaceOnce(inputs.source, defect.before, defect.after));
  const result = await runLsc('regen', directory);
  assert.notEqual(result.status, 0, `Verification accepted: ${defect.name}`);
  assert.match(
    result.output,
    proofFailure,
    `Expected a proof failure, not a tool failure: ${defect.name}\n${result.output}`
  );
  assertRegenerated(directory);
  return `Rejected defect: ${defect.name}`;
}

async function regenerateRefactor(directory) {
  const source = replaceOnce(
    inputs.source,
    manifest.refactor.before,
    manifest.refactor.after
  );
  prepare(directory, source);
  const generation = await runLsc('gen', directory);
  assert.equal(generation.status, 0, generation.output);
  assert.notEqual(
    readFileSync(path.join(directory, generatedPath), 'utf8'),
    inputs.generated,
    'The refactor must change the generated model, or staleness goes untested.'
  );
  prepare(directory, source);
  assertVerified(await runLsc('regen', directory));
  assertRegenerated(directory);
  return 'Detected stale Dafny after the refactor; regeneration verifies.';
}

async function inParallel(tasks, limit) {
  const results = new Array(tasks.length);
  let next = 0;
  const worker = async () => {
    while (next < tasks.length) {
      const index = next++;
      results[index] = await tasks[index]();
    }
  };
  await Promise.all(Array.from({ length: limit }, worker));
  return results;
}

const dafny = await run('dafny', ['--version'], root);
assert.equal(dafny.status, 0, dafny.output);
assert.match(dafny.output.trim(), /^4\.11\.0\b/, 'Dafny 4.11.0 is required.');
const version = await run(process.execPath, [lsc, 'version'], root);
assert.equal(version.output.trim(), '0.6.6', 'lemmascript@0.6.6 is required.');

assertProof(inputs.generated, inputs.proof);
const scratch = mkdtempSync(path.join(tmpdir(), 'xstate-fsm-model-'));
try {
  await verifyBaseline(path.join(scratch, 'baseline'));
  const results = await inParallel(
    [
      ...manifest.defects.map(
        (defect, index) => () =>
          rejectDefect(path.join(scratch, `defect-${index}`), defect)
      ),
      () => regenerateRefactor(path.join(scratch, 'refactor'))
    ],
    Math.max(1, Math.floor(availableParallelism() / 2))
  );
  for (const line of results) console.log(line);
  for (const [name, file] of [
    ['source', manifest.source],
    ['config', 'lemmascript.json'],
    ['generated', generatedPath],
    ['proof', proofPath]
  ])
    assert.equal(read(file), inputs[name], `${file} changed during the check.`);
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
