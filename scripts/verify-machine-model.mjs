import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const directory = path.join(root, 'packages/core/test/machine-model');
const read = (file) => readFileSync(path.join(directory, file), 'utf8');
const manifest = JSON.parse(read('formal/machineModel.manifest.json'));
const source = read(manifest.source);
const generated = read('formal/machineModel.dfy.gen');
const proof = read('formal/machineModel.dfy');
const config = read('lemmascript.json');
const lsc = process.env.LEMMASCRIPT_LSC;
assert.ok(lsc, 'Set LEMMASCRIPT_LSC to lemmascript@0.6.6/tools/dist/lsc.js');

function run(command, args, cwd) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: 'utf8',
    timeout: 180_000,
    maxBuffer: 8 * 1024 * 1024
  });
  if (result.error) throw result.error;
  assert.equal(
    result.signal,
    null,
    `${command} terminated by ${result.signal}`
  );
  return { status: result.status, output: result.stdout + result.stderr };
}

function names(text, pattern) {
  return [...text.matchAll(pattern)].map((match) => match[1]).sort();
}

function checkInventory(gen, proven) {
  assert.ok(
    proven.startsWith(gen),
    'Proof must retain the exact generated prefix'
  );
  const code = proven.replace(/\/\/[^\n]*|\/\*[\s\S]*?\*\//g, '');
  const added = proven
    .slice(gen.length)
    .replace(/\/\/[^\n]*|\/\*[\s\S]*?\*\//g, '');
  assert.doesNotMatch(
    code,
    /\b(assume|expect|include|import|method|const|axiom)\b|\{\s*:/
  );
  assert.doesNotMatch(
    added,
    /\b(datatype|type|class|trait|module|newtype|codatatype)\b/
  );
  assert.deepEqual(
    names(code, /\b(?:function|predicate) (\w+)/g),
    [...manifest.functions, ...manifest.specFunctions].sort()
  );
  assert.deepEqual(
    names(added, /\bghost (?:function|predicate) (\w+)/g),
    [...manifest.specFunctions].sort()
  );
  assert.deepEqual(
    names(code, /\blemma (\w+)/g),
    [
      ...manifest.functions.map((name) => `${name}_ensures`),
      ...manifest.laws
    ].sort()
  );
  assert.equal(
    manifest.defects.length >= 4,
    true,
    'Keep required defect coverage'
  );
}

function replaceOnce(text, edit) {
  assert.equal(
    text.split(edit.before).length,
    2,
    `Ambiguous mutation: ${edit.name ?? 'refactor'}`
  );
  return text.replace(edit.before, edit.after);
}

function prepare(parent, name, input) {
  const cwd = path.join(parent, name);
  mkdirSync(path.join(cwd, 'formal'), { recursive: true });
  writeFileSync(path.join(cwd, manifest.source), input);
  writeFileSync(path.join(cwd, 'lemmascript.json'), config);
  writeFileSync(path.join(cwd, 'formal/machineModel.dfy.gen'), generated);
  writeFileSync(path.join(cwd, 'formal/machineModel.dfy'), proof);
  return cwd;
}

function translate(mode, cwd) {
  return run(
    process.execPath,
    [
      lsc,
      mode,
      '--backend=dafny',
      '--time-limit=15',
      '--extra-flags=--cores=2',
      manifest.source
    ],
    cwd
  );
}

function verified(result) {
  assert.equal(result.status, 0, result.output);
  assert.match(
    result.output,
    new RegExp(`finished with ${manifest.verifiedCount} verified, 0 errors`)
  );
}

const dafny = run('dafny', ['--version'], root);
assert.equal(dafny.status, 0, dafny.output);
assert.match(dafny.output, /^4\.11\.0\b/);
const translator = run(process.execPath, [lsc, 'version'], root);
assert.equal(translator.status, 0, translator.output);
assert.equal(translator.output.trim(), '0.6.6');
checkInventory(generated, proof);
const scratch = mkdtempSync(
  path.join(process.env.TMPDIR ?? tmpdir(), 'xstate-machine-proof-')
);
try {
  const baseline = prepare(scratch, 'baseline', source);
  const generation = translate('gen', baseline);
  assert.equal(generation.status, 0, generation.output);
  assert.equal(
    readFileSync(path.join(baseline, 'formal/machineModel.dfy.gen'), 'utf8'),
    generated,
    'Generated model is stale'
  );
  const result = translate('check', baseline);
  verified(result);
  console.log(result.output.trim().split('\n').at(-1));
  for (const [index, defect] of manifest.defects.entries()) {
    const cwd = prepare(
      scratch,
      `defect-${index}`,
      replaceOnce(source, defect)
    );
    const rejected = translate('regen', cwd);
    assert.notEqual(rejected.status, 0, `Accepted defect: ${defect.name}`);
    assert.match(
      rejected.output,
      /a postcondition could not be proved|assertion might not hold|possible violation of postcondition/,
      `Expected a proof failure, not a tool failure: ${defect.name}\n${rejected.output}`
    );
    checkInventory(
      readFileSync(path.join(cwd, 'formal/machineModel.dfy.gen'), 'utf8'),
      readFileSync(path.join(cwd, 'formal/machineModel.dfy'), 'utf8')
    );
    console.log(`Rejected defect: ${defect.name}`);
  }
  const refactor = prepare(
    scratch,
    'refactor',
    replaceOnce(source, manifest.refactor)
  );
  const regenerated = translate('regen', refactor);
  verified(regenerated);
  const changed = readFileSync(
    path.join(refactor, 'formal/machineModel.dfy.gen'),
    'utf8'
  );
  assert.notEqual(changed, generated, 'Refactor must change generated output');
  checkInventory(
    changed,
    readFileSync(path.join(refactor, 'formal/machineModel.dfy'), 'utf8')
  );
  console.log(
    'Freshness, additions-only inventory, defects and refactor verified.'
  );
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
assert.equal(read(manifest.source), source);
assert.equal(read('formal/machineModel.dfy.gen'), generated);
assert.equal(read('formal/machineModel.dfy'), proof);
