// Mutation testing for the Dafny proofs in packages/core/test/fsm-model.
// Parses packages/core/test/fsm-model/fsmModel.ts with the TypeScript
// compiler API, applies a deterministic set of AST mutation operators across
// all model functions, and runs each mutant through `lsc regen` (the same
// regenerate-and-verify path used by scripts/verify-fsm-model.mjs).
//
// Usage:
//   LEMMASCRIPT_LSC=/tmp/lemmascript/node_modules/lemmascript/tools/dist/lsc.js \
//     node scripts/fsm-proof-mutants.mjs [--list] [--only P01,P02] [--fn transition] [--jobs N] [--json out.json]
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
import ts from 'typescript';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const modelDirectory = path.join(root, 'packages/core/test/fsm-model');
const generatedPath = 'formal/fsmModel.dfy.gen';
const proofPath = 'formal/fsmModel.dfy';
const lscOptions = [
  '--backend=dafny',
  '--time-limit=15',
  '--extra-flags=--cores=2'
];

const read = (file) => readFileSync(path.join(modelDirectory, file), 'utf8');
const manifest = JSON.parse(read('formal/fsmModel.manifest.json'));
const inputs = {
  source: read(manifest.source),
  config: read('lemmascript.json'),
  generated: read(generatedPath),
  proof: read(proofPath)
};

// Dafny verifier failures (as opposed to LemmaScript translation or Dafny
// parse/resolution/type errors). Dafny prints "Dafny program verifier
// finished with X verified, Y errors" only after parsing, resolution, and
// typechecking succeed.
const verifierFinished =
  /Dafny program verifier finished with (\d+) verified, (\d+) error/;
const proofFailurePattern =
  /a postcondition could not be proved|assertion might not hold|possible violation of postcondition|cannot prove termination|decreases expression|index out of range|element might not be in domain|value does not satisfy the subset constraints|timed out/i;

const SIBLING_FIELDS = new Map([
  ['states', 'inheritedStates'],
  ['on', 'inheritedOn']
]);

function splice(source, start, end, replacement) {
  return source.slice(0, start) + replacement + source.slice(end);
}

function isUndefinedIdentifier(node) {
  return ts.isIdentifier(node) && node.text === 'undefined';
}

function returnsUndefined(fn) {
  if (!fn.type || !ts.isUnionTypeNode(fn.type)) return false;
  return fn.type.types.some((t) => t.kind === ts.SyntaxKind.UndefinedKeyword);
}

function sameTypeStringParams(fn) {
  return fn.parameters
    .filter(
      (p) =>
        ts.isIdentifier(p.name) &&
        p.type &&
        p.type.kind === ts.SyntaxKind.StringKeyword
    )
    .map((p) => p.name.text);
}

export function generateMutants(source) {
  const sf = ts.createSourceFile(
    manifest.source,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS
  );

  const raw = [];
  const seenSources = new Set();

  function add(fnName, operator, description, node, replacement) {
    const start = node.getStart(sf);
    const end = node.getEnd();
    const before = source.slice(start, end);
    if (before === replacement) return;
    const mutated = splice(source, start, end, replacement);
    if (seenSources.has(mutated)) return;
    seenSources.add(mutated);
    const { line } = sf.getLineAndCharacterOfPosition(start);
    raw.push({
      fn: fnName,
      line: line + 1,
      operator,
      description,
      before,
      after: replacement,
      source: mutated
    });
  }

  for (const stmt of sf.statements) {
    if (!ts.isFunctionDeclaration(stmt) || !stmt.name || !stmt.body) continue;
    const fnName = stmt.name.text;
    const canReturnUndefined = returnsUndefined(stmt);
    const stringParams = sameTypeStringParams(stmt);

    function visit(node) {
      // 1. Boolean literal flip: true <-> false
      if (node.kind === ts.SyntaxKind.TrueKeyword) {
        add(fnName, 'boolean-literal', 'flip `true` to `false`', node, 'false');
      } else if (node.kind === ts.SyntaxKind.FalseKeyword) {
        add(fnName, 'boolean-literal', 'flip `false` to `true`', node, 'true');
      }

      // 2. Binary operators: === <-> !==, && <-> ||, ?? fallback
      if (ts.isBinaryExpression(node)) {
        const op = node.operatorToken.kind;
        if (op === ts.SyntaxKind.EqualsEqualsEqualsToken) {
          add(
            fnName,
            'equality-flip',
            `flip \`===\` to \`!==\` in \`${node.getText(sf)}\``,
            node.operatorToken,
            '!=='
          );
        } else if (op === ts.SyntaxKind.ExclamationEqualsEqualsToken) {
          add(
            fnName,
            'equality-flip',
            `flip \`!==\` to \`===\` in \`${node.getText(sf)}\``,
            node.operatorToken,
            '==='
          );
        } else if (op === ts.SyntaxKind.AmpersandAmpersandToken) {
          add(
            fnName,
            'logical-swap',
            `swap \`&&\` to \`||\` in \`${node.getText(sf)}\``,
            node.operatorToken,
            '||'
          );
        } else if (op === ts.SyntaxKind.BarBarToken) {
          add(
            fnName,
            'logical-swap',
            `swap \`||\` to \`&&\` in \`${node.getText(sf)}\``,
            node.operatorToken,
            '&&'
          );
        } else if (op === ts.SyntaxKind.QuestionQuestionToken) {
          const right = node.right.getText(sf);
          add(
            fnName,
            'nullish-fallback',
            `drop left operand of \`${node.getText(sf)}\` -> \`${right}\``,
            node,
            right
          );
        }
      }

      // 3. Unary negation removal: !x -> x
      if (
        ts.isPrefixUnaryExpression(node) &&
        node.operator === ts.SyntaxKind.ExclamationToken
      ) {
        const inner = node.operand.getText(sf);
        add(
          fnName,
          'negation-removal',
          `remove \`!\` in \`${node.getText(sf)}\``,
          node,
          inner
        );
      }

      // 4. Conditional branch collapse: c ? a : b -> a, b
      if (ts.isConditionalExpression(node)) {
        const whenTrue = node.whenTrue.getText(sf);
        const whenFalse = node.whenFalse.getText(sf);
        add(
          fnName,
          'conditional-collapse',
          `collapse ternary to true branch \`${whenTrue}\``,
          node,
          whenTrue
        );
        add(
          fnName,
          'conditional-collapse',
          `collapse ternary to false branch \`${whenFalse}\``,
          node,
          whenFalse
        );
      }

      // 5. If-branch condition force: if (c) -> if (true), if (false)
      if (ts.isIfStatement(node)) {
        add(
          fnName,
          'branch-force',
          `force \`if (${node.expression.getText(sf)})\` to \`true\``,
          node.expression,
          'true'
        );
        add(
          fnName,
          'branch-force',
          `force \`if (${node.expression.getText(sf)})\` to \`false\``,
          node.expression,
          'false'
        );
      }

      // 6. Optional return collapse: return expr -> return undefined
      if (
        canReturnUndefined &&
        ts.isReturnStatement(node) &&
        node.expression &&
        !isUndefinedIdentifier(node.expression)
      ) {
        add(
          fnName,
          'optional-return',
          `replace \`return ${node.expression.getText(sf)}\` with \`return undefined\``,
          node.expression,
          'undefined'
        );
      }

      // 7. Object literal spread/property drop & optional target drop
      if (ts.isObjectLiteralExpression(node) && node.properties.length >= 2) {
        const hasSpread = node.properties.some(ts.isSpreadAssignment);
        if (hasSpread) {
          for (let i = 0; i < node.properties.length; i++) {
            const prop = node.properties[i];
            const remaining = node.properties
              .filter((_, j) => j !== i)
              .map((p) => p.getText(sf))
              .join(', ');
            add(
              fnName,
              'object-property-drop',
              `drop \`${prop.getText(sf)}\` from \`${node.getText(sf)}\``,
              node,
              `{ ${remaining} }`
            );
          }
        }
        for (const prop of node.properties) {
          if (
            ts.isPropertyAssignment(prop) &&
            ts.isIdentifier(prop.name) &&
            prop.name.text === 'target' &&
            !isUndefinedIdentifier(prop.initializer)
          ) {
            add(
              fnName,
              'property-undefined',
              `set \`target\` to \`undefined\` in \`${node.getText(sf)}\``,
              prop.initializer,
              'undefined'
            );
          }
        }
      }

      // 8. Array method & slice mutations
      if (
        ts.isCallExpression(node) &&
        ts.isPropertyAccessExpression(node.expression)
      ) {
        const method = node.expression.name.text;
        if (method === 'some') {
          add(
            fnName,
            'array-method-swap',
            `swap \`.some\` to \`.every\` in \`${node.getText(sf)}\``,
            node.expression.name,
            'every'
          );
        } else if (
          method === 'slice' &&
          node.arguments.length === 1 &&
          node.arguments[0].getText(sf) === '1'
        ) {
          add(
            fnName,
            'slice-tail',
            `replace \`${node.getText(sf)}\` with \`[]\``,
            node,
            '[]'
          );
          add(
            fnName,
            'slice-tail',
            `replace \`${node.getText(sf)}\` with \`.slice(2)\``,
            node.arguments[0],
            '2'
          );
        }
      }

      // 9. Numeric literal perturbation: 0 -> 1, 1 -> 0
      if (ts.isNumericLiteral(node)) {
        if (node.text === '0') {
          add(
            fnName,
            'numeric-literal',
            `change \`0\` to \`1\` in \`${node.parent.getText(sf)}\``,
            node,
            '1'
          );
        } else if (node.text === '1') {
          add(
            fnName,
            'numeric-literal',
            `change \`1\` to \`0\` in \`${node.parent.getText(sf)}\``,
            node,
            '0'
          );
        }
      }

      // 10. Sibling field substitution: states -> inheritedStates, on -> inheritedOn
      if (ts.isPropertyAccessExpression(node)) {
        const replacement = SIBLING_FIELDS.get(node.name.text);
        if (replacement) {
          add(
            fnName,
            'sibling-field',
            `replace \`.${node.name.text}\` with \`.${replacement}\``,
            node.name,
            replacement
          );
        }
      }

      // 11. Same-type string parameter swap at call sites
      if (
        stringParams.length === 2 &&
        ts.isIdentifier(node) &&
        ts.isCallExpression(node.parent) &&
        node.parent.arguments.includes(node)
      ) {
        const other =
          node.text === stringParams[0]
            ? stringParams[1]
            : node.text === stringParams[1]
              ? stringParams[0]
              : undefined;
        if (other) {
          add(
            fnName,
            'param-swap',
            `swap argument \`${node.text}\` to \`${other}\` in \`${node.parent.getText(sf)}\``,
            node,
            other
          );
        }
      }

      // 12. Initial-state value drop: machine.initial -> '', 'xstate.init' -> ''
      if (
        ts.isPropertyAccessExpression(node) &&
        node.getText(sf) === 'machine.initial'
      ) {
        add(
          fnName,
          'string-empty',
          `replace \`machine.initial\` with \`''\``,
          node,
          "''"
        );
      } else if (ts.isStringLiteral(node) && node.text === 'xstate.init') {
        add(
          fnName,
          'string-empty',
          `replace \`'xstate.init'\` with \`''\``,
          node,
          "''"
        );
      }

      // 13. Call-argument blanking: replace context / event / fuel arguments
      // with empty/zero values at call sites.
      if (ts.isCallExpression(node)) {
        const callText = node.getText(sf).replace(/\s+/g, ' ');
        for (const arg of node.arguments) {
          const text = arg.getText(sf);
          if (text === 'context' || text === 'snapshot.context') {
            add(
              fnName,
              'arg-blank',
              `blank \`${text}\` to \`{}\` in \`${callText}\``,
              arg,
              '{}'
            );
          } else if (text === 'event') {
            add(
              fnName,
              'arg-blank',
              `blank \`event\` to \`{ type: '', payload: 0 }\` in \`${callText}\``,
              arg,
              "{ type: '', payload: 0 }"
            );
          } else if (text === 'fuel') {
            add(
              fnName,
              'arg-blank',
              `blank \`fuel\` to \`0\` in \`${callText}\``,
              arg,
              '0'
            );
          }
        }
      }

      ts.forEachChild(node, visit);
    }

    visit(stmt.body);
  }

  // Match against existing manifest defects by normalized mutated source.
  const defectBySource = new Map();
  for (const defect of manifest.defects) {
    if (inputs.source.split(defect.before).length === 2) {
      defectBySource.set(
        inputs.source.replace(defect.before, defect.after),
        defect.name
      );
    }
  }

  return raw.map((mutant, index) => ({
    id: `P${String(index + 1).padStart(2, '0')}`,
    ...mutant,
    matchesDefect: defectBySource.get(mutant.source) ?? null
  }));
}

function parseArgs(argv) {
  const options = {
    list: false,
    only: null,
    fn: null,
    jobs: Math.max(1, Math.floor(availableParallelism() / 2)),
    json: null
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--list') {
      options.list = true;
    } else if (arg === '--only') {
      options.only = new Set(argv[++i].split(',').filter(Boolean));
    } else if (arg === '--fn') {
      options.fn = new Set(argv[++i].split(',').filter(Boolean));
    } else if (arg === '--jobs') {
      options.jobs = Number(argv[++i]);
      assert.ok(Number.isInteger(options.jobs) && options.jobs >= 1);
    } else if (arg === '--json') {
      options.json = argv[++i];
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }
  return options;
}

const activeChildren = new Set();

function killAllChildren() {
  for (const child of activeChildren) {
    try {
      process.kill(-child.pid, 'SIGTERM');
    } catch {
      try {
        child.kill('SIGTERM');
      } catch {
        // Child already exited.
      }
    }
  }
}

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    killAllChildren();
    process.exit(signal === 'SIGINT' ? 130 : 143);
  });
}

function run(command, args, cwd, timeoutMs = 120_000) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, detached: true });
    activeChildren.add(child);
    let output = '';
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      try {
        process.kill(-child.pid, 'SIGTERM');
      } catch {
        child.kill('SIGTERM');
      }
    }, timeoutMs);
    child.stdout.on('data', (chunk) => (output += chunk));
    child.stderr.on('data', (chunk) => (output += chunk));
    child.on('error', (error) => {
      clearTimeout(timer);
      activeChildren.delete(child);
      reject(error);
    });
    child.on('close', (status) => {
      clearTimeout(timer);
      activeChildren.delete(child);
      resolve({ status, output, timedOut });
    });
  });
}

function prepare(directory, source) {
  mkdirSync(path.join(directory, 'formal'), { recursive: true });
  writeFileSync(path.join(directory, manifest.source), source);
  writeFileSync(path.join(directory, 'lemmascript.json'), inputs.config);
  writeFileSync(path.join(directory, generatedPath), inputs.generated);
  writeFileSync(path.join(directory, proofPath), inputs.proof);
}

function classify(result) {
  const summary = result.output.match(verifierFinished);
  if (result.status === 0 && summary && Number(summary[2]) === 0) {
    return {
      outcome: 'accepted',
      detail: summary[0]
    };
  }
  if (
    result.timedOut ||
    (summary && Number(summary[2]) > 0) ||
    proofFailurePattern.test(result.output)
  ) {
    const firstError =
      result.output
        .split('\n')
        .find((line) => /Error:|timed out/i.test(line))
        ?.trim() ??
      summary?.[0] ??
      'verification failed';
    return {
      outcome: 'rejected-by-proof',
      detail: firstError
    };
  }
  const firstLine =
    result.output
      .split('\n')
      .find((line) => /Error|error|Failed|failed|cannot|Cannot/.test(line))
      ?.trim() ??
    result.output.trim().split('\n')[0] ??
    `exit ${result.status}`;
  return {
    outcome: 'rejected-by-tools',
    detail: firstLine
  };
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
  await Promise.all(
    Array.from({ length: Math.min(limit, tasks.length) }, worker)
  );
  return results;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const allMutants = generateMutants(inputs.source);

  let selected = allMutants;
  if (options.only) {
    selected = selected.filter((m) => options.only.has(m.id));
  }
  if (options.fn) {
    selected = selected.filter((m) => options.fn.has(m.fn));
  }

  if (options.list) {
    for (const m of selected) {
      const defectTag = m.matchesDefect
        ? ` [matches defect: ${m.matchesDefect}]`
        : '';
      console.log(
        `${m.id}  L${String(m.line).padStart(3)}  ${m.fn.padEnd(18)}  ${m.operator.padEnd(20)}  ${m.description}${defectTag}`
      );
    }
    const covered = new Set(allMutants.map((m) => m.fn));
    console.log(
      `\nTotal: ${selected.length} mutants (${allMutants.length} generated across ${covered.size}/${Object.keys(manifest.functions).length} functions)`
    );
    return;
  }

  const lsc = process.env.LEMMASCRIPT_LSC;
  assert.ok(
    lsc,
    'Set LEMMASCRIPT_LSC to tools/dist/lsc.js from lemmascript@0.6.6.'
  );

  const dafny = await run('dafny', ['--version'], root);
  assert.equal(dafny.status, 0, dafny.output);
  assert.match(dafny.output.trim(), /^4\.11\.0\b/, 'Dafny 4.11.0 is required.');
  const version = await run(process.execPath, [lsc, 'version'], root);
  assert.equal(
    version.output.trim(),
    '0.6.6',
    'lemmascript@0.6.6 is required.'
  );

  const startedAt = Date.now();
  const scratch = mkdtempSync(path.join(tmpdir(), 'xstate-fsm-proof-mutants-'));
  try {
    console.log(
      `Running ${selected.length} proof mutants with jobs=${options.jobs} (Dafny ${dafny.output.trim().split('+')[0]}, LemmaScript ${version.output.trim()})...`
    );
    const results = await inParallel(
      selected.map((mutant) => async () => {
        const dir = path.join(scratch, mutant.id);
        prepare(dir, mutant.source);
        const t0 = Date.now();
        const res = await run(
          process.execPath,
          [lsc, 'regen', ...lscOptions, manifest.source],
          dir
        );
        const elapsedMs = Date.now() - t0;
        const verdict = classify(res);
        const tag =
          verdict.outcome === 'accepted'
            ? 'ACCEPTED'
            : verdict.outcome === 'rejected-by-proof'
              ? 'PROOF   '
              : 'TOOLS   ';
        const defectNote = mutant.matchesDefect
          ? ` [defect: ${mutant.matchesDefect}]`
          : '';
        console.log(
          `${mutant.id}  ${tag}  ${(elapsedMs / 1000).toFixed(1).padStart(5)}s  ${mutant.fn} (L${mutant.line}): ${mutant.description}${defectNote}`
        );
        return {
          id: mutant.id,
          fn: mutant.fn,
          line: mutant.line,
          operator: mutant.operator,
          description: mutant.description,
          before: mutant.before,
          after: mutant.after,
          matchesDefect: mutant.matchesDefect,
          outcome: verdict.outcome,
          detail: verdict.detail,
          elapsedMs
        };
      }),
      options.jobs
    );

    const wallSeconds = ((Date.now() - startedAt) / 1000).toFixed(1);
    const counts = {
      'rejected-by-proof': 0,
      'rejected-by-tools': 0,
      accepted: 0
    };
    for (const r of results) counts[r.outcome] += 1;

    console.log('\nSummary:');
    console.log(`  Total mutants:     ${results.length}`);
    console.log(`  Rejected by proof: ${counts['rejected-by-proof']}`);
    console.log(`  Rejected by tools: ${counts['rejected-by-tools']}`);
    console.log(`  Accepted:          ${counts.accepted}`);
    console.log(`  Wall time:         ${wallSeconds}s`);

    if (counts.accepted > 0) {
      console.log('\nAccepted mutants:');
      for (const r of results.filter((x) => x.outcome === 'accepted')) {
        console.log(
          `  ${r.id}  ${r.fn} (L${r.line}) [${r.operator}]: ${r.description}`
        );
      }
    }

    if (options.json) {
      writeFileSync(
        options.json,
        JSON.stringify(
          {
            dafny: dafny.output.trim(),
            lemmascript: version.output.trim(),
            wallSeconds: Number(wallSeconds),
            counts,
            results
          },
          null,
          2
        ) + '\n'
      );
    }
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

main();
