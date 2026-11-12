import assert from 'node:assert/strict';
import { childTimeout, runCommand } from './machine-model-process.mjs';
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
const timeoutMs = childTimeout('MACHINE_MODEL_VERIFY_TIMEOUT_MS', 180_000);
const directory = path.join(root, 'packages/core/test/machine-model');
const read = (file) => readFileSync(path.join(directory, file), 'utf8');
const manifest = JSON.parse(read('formal/machineModel.manifest.json'));
const source = read(manifest.source);
const generated = read('formal/machineModel.dfy.gen');
const proof = read('formal/machineModel.dfy');
const config = read('lemmascript.json');
const lsc = process.env.LEMMASCRIPT_LSC;
assert.ok(lsc, 'Set LEMMASCRIPT_LSC to lemmascript@0.6.6/tools/dist/lsc.js');

async function run(command, args, cwd) {
  const result = await runCommand(command, args, { cwd, timeoutMs });
  assert.equal(
    result.signal,
    null,
    `${command} terminated by ${result.signal}`
  );
  return result;
}

function names(text, pattern) {
  return [...text.matchAll(pattern)].map((match) => match[1]).sort();
}

function proofCode(text) {
  const token =
    /@"(?:[^"]|"")*"|"(?:\\[\s\S]|[^"\\])*"|'(?:\\(?:u[0-9a-fA-F]{4}|U\{[0-9a-fA-F]+\}|[^\r\n])|[^'\\\r\n])'|[\p{ID_Start}_][\p{ID_Continue}'?]*/uy;
  const parts = [];
  let index = 0;
  while (index < text.length) {
    if (text.startsWith('//', index)) {
      const newline = text.slice(index).search(/[\r\n]/);
      const end = newline < 0 ? text.length : index + newline;
      parts.push(' '.repeat(end - index));
      index = end;
    } else if (text.startsWith('/*', index)) {
      let end = index + 2;
      let depth = 1;
      while (end < text.length && depth > 0) {
        if (text.startsWith('/*', end)) {
          depth++;
          end += 2;
        } else if (text.startsWith('*/', end)) {
          depth--;
          end += 2;
        } else {
          end++;
        }
      }
      assert.equal(depth, 0, 'Unterminated proof comment');
      parts.push(text.slice(index, end).replace(/[^\r\n]/g, ' '));
      index = end;
    } else {
      token.lastIndex = index;
      const match = token.exec(text);
      if (match) {
        const value = match[0];
        parts.push(
          value.startsWith('"') ||
            value.startsWith('@"') ||
            value.startsWith("'")
            ? `__literal_${Buffer.from(value).toString('hex')}__`
            : value
        );
        index += value.length;
      } else {
        parts.push(text[index++]);
      }
    }
  }
  return parts.join('');
}

function checkInventory(gen, proven) {
  const generatedLines = gen.trimEnd().split('\n');
  let retained = 0;
  for (const line of proven.split('\n')) {
    if (line === generatedLines[retained]) retained++;
  }
  assert.equal(
    retained,
    generatedLines.length,
    'Proof must retain every generated line in order'
  );
  const code = proofCode(proven).replace(
    /\{:\s*(?:induction false|isolate_assertions)\s*\}/g,
    ''
  );
  const declarations = (text) =>
    new Map(
      [...text.matchAll(/^((?:function|lemma) (\w+)[\s\S]*?)^\{/gm)].map(
        (match) => {
          const [, header, name] = match;
          const message = `Generated declaration contract must remain unchanged: ${name}`;
          let end = match.index + match[0].length;
          let depth = 1;
          while (end < text.length && depth > 0) {
            if (text[end] === '{') depth++;
            if (text[end] === '}') depth--;
            end++;
          }
          assert.equal(depth, 0, message);
          // A specification's set display must not masquerade as the body.
          assert.match(
            text.slice(end),
            /^\s*(?:(?:ghost\s+)?(?:function|predicate|lemma|datatype|type)\b|$)/,
            message
          );
          const clauses = [
            ...header.matchAll(
              /(?<![\p{ID_Continue}'?])(requires|ensures|decreases|reads|modifies)(?![\p{ID_Continue}'?])/gu
            )
          ];
          return [
            name,
            {
              signature: header.slice(0, clauses[0]?.index).trim(),
              clauses: clauses.map((clause, index) => ({
                kind: clause[1],
                text: header
                  .slice(clause.index, clauses[index + 1]?.index)
                  .trim()
              }))
            }
          ];
        }
      )
    );
  const retainedDeclarations = declarations(code);
  for (const [name, original] of declarations(proofCode(gen))) {
    const retainedDeclaration = retainedDeclarations.get(name);
    const message = `Generated declaration contract must remain unchanged: ${name}`;
    assert.ok(retainedDeclaration, message);
    assert.equal(retainedDeclaration.signature, original.signature, message);
    assert.deepEqual(
      retainedDeclaration.clauses.filter(({ kind }) => kind !== 'ensures'),
      original.clauses.filter(({ kind }) => kind !== 'ensures'),
      message
    );
    for (const clause of original.clauses.filter(
      ({ kind }) => kind === 'ensures'
    )) {
      assert.ok(
        retainedDeclaration.clauses.some(({ text }) => text === clause.text),
        message
      );
    }
  }
  const bodies = (text) =>
    [...text.matchAll(/^function (\w+)[\s\S]*?^\{([\s\S]*?)^\}/gm)].map(
      ([, name, body]) => [
        name,
        body.replace(/^\s*assert [^;\n{}]*;\s*$/gm, '').trim()
      ]
    );
  assert.deepEqual(
    bodies(proofCode(proven)),
    bodies(proofCode(gen)),
    'Generated executable bodies may only gain checked assertions'
  );
  assert.doesNotMatch(
    code,
    /\b(assume|expect|include|import|method|const|axiom)\b|\{\s*:/
  );
  assert.deepEqual(
    names(
      code,
      /\b(datatype|type|class|trait|module|newtype|codatatype)\s+\w+/g
    ),
    names(
      proofCode(gen),
      /\b(datatype|type|class|trait|module|newtype|codatatype)\s+\w+/g
    )
  );
  assert.deepEqual(
    names(code, /\b(?:function|predicate) (\w+)/g),
    [...manifest.functions, ...manifest.specFunctions].sort()
  );
  assert.deepEqual(
    names(code, /\bghost (?:function|predicate) (\w+)/g),
    [...manifest.specFunctions].sort()
  );
  assert.deepEqual(
    names(code, /\blemma\s+(\w+)/g),
    [...manifest.contracts, ...manifest.laws].sort()
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

const dafny = await run('dafny', ['--version'], root);
assert.equal(dafny.status, 0, dafny.output);
assert.match(dafny.output, /^4\.11\.0\b/);
const translator = await run(process.execPath, [lsc, 'version'], root);
assert.equal(translator.status, 0, translator.output);
assert.equal(translator.output.trim(), '0.6.6');
checkInventory(generated, proof);
for (const defect of manifest.proofDefects) {
  assert.throws(
    () => checkInventory(generated, replaceOnce(proof, defect)),
    /Generated declaration contract must remain unchanged/,
    `Accepted proof weakening: ${defect.name}`
  );
  console.log(`Rejected proof weakening: ${defect.name}`);
}
const scratch = mkdtempSync(
  path.join(process.env.TMPDIR ?? tmpdir(), 'xstate-machine-proof-')
);
try {
  const baseline = prepare(scratch, 'baseline', source);
  const generation = await translate('gen', baseline);
  assert.equal(generation.status, 0, generation.output);
  assert.equal(
    readFileSync(path.join(baseline, 'formal/machineModel.dfy.gen'), 'utf8'),
    generated,
    'Generated model is stale'
  );
  const result = await translate('check', baseline);
  verified(result);
  console.log(result.output.trim().split('\n').at(-1));
  for (const [index, defect] of manifest.defects.entries()) {
    const cwd = prepare(
      scratch,
      `defect-${index}`,
      replaceOnce(source, defect)
    );
    const rejected = await translate('regen', cwd);
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
  const regenerated = await translate('regen', refactor);
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
