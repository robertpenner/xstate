import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { test } from 'node:test';
import { childTimeout, runCommand } from './machine-model-process.mjs';

function running(pid) {
  const result = spawnSync('ps', ['-o', 'stat=', '-p', String(pid)], {
    encoding: 'utf8'
  });
  return result.status === 0 && !result.stdout.trim().startsWith('Z');
}

test('timeout names the command and stops a TERM-resistant grandchild', async () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'xstate-process-test-'));
  const pids = path.join(directory, 'pids');
  const child = path.join(directory, 'child.sh');
  writeFileSync(
    child,
    `trap '' TERM
sleep 30 &
printf '%s,%s' "$$" "$!" > "$1"
wait
`
  );
  try {
    await assert.rejects(
      runCommand('/bin/sh', [child, pids], { timeoutMs: 1000 }),
      (error) => {
        assert.match(error.message, /timed out/);
        assert.ok(error.message.includes(child));
        assert.match(error.message, /1000 ms/);
        return true;
      }
    );
    for (const pid of readFileSync(pids, 'utf8').split(',').map(Number)) {
      assert.equal(running(pid), false, `Process ${pid} survived timeout`);
    }
  } finally {
    if (existsSync(pids)) {
      for (const pid of readFileSync(pids, 'utf8').split(',').map(Number)) {
        if (running(pid)) process.kill(pid, 'SIGKILL');
      }
    }
    rmSync(directory, { recursive: true, force: true });
  }
});

test('preserves successful output and nonzero exit statuses', async () => {
  const result = await runCommand(
    process.execPath,
    [
      '-e',
      "process.stdout.write('out'); process.stderr.write('err'); process.exitCode = 7;"
    ],
    { timeoutMs: 10_000 }
  );
  assert.deepEqual(result, { status: 7, signal: null, output: 'outerr' });
  await assert.rejects(
    runCommand('/nonexistent/xstate-command', [], { timeoutMs: 10_000 }),
    /ENOENT/
  );
});

test('environment overrides change the deadline and reject invalid values', async () => {
  const name = 'XSTATE_TEST_CHILD_TIMEOUT_MS';
  const previous = process.env[name];
  try {
    delete process.env[name];
    assert.equal(childTimeout(name, 180_000), 180_000);
    process.env[name] = '100';
    const timeoutMs = childTimeout(name, 180_000);
    assert.equal(timeoutMs, 100);
    await assert.rejects(
      runCommand(process.execPath, ['-e', 'setTimeout(() => {}, 1000)'], {
        timeoutMs
      }),
      /timed out after 100 ms/
    );
    for (const invalid of [
      '',
      ' ',
      '0',
      '-1',
      'Infinity',
      'NaN',
      'abc',
      '2147483648'
    ]) {
      process.env[name] = invalid;
      assert.throws(() => childTimeout(name, 180_000), new RegExp(name));
    }
  } finally {
    if (previous === undefined) delete process.env[name];
    else process.env[name] = previous;
  }
});

test('both drivers reject invalid limits before checking or mutating files', () => {
  for (const [script, variable] of [
    ['verify-machine-model.mjs', 'MACHINE_MODEL_VERIFY_TIMEOUT_MS'],
    [
      'check-machine-model-runtime-defects.mjs',
      'MACHINE_MODEL_RUNTIME_TIMEOUT_MS'
    ]
  ]) {
    const result = spawnSync(
      process.execPath,
      [new URL(script, import.meta.url).pathname],
      { env: { ...process.env, [variable]: 'invalid' }, encoding: 'utf8' }
    );
    assert.equal(result.status, 1);
    assert.ok(result.stderr.includes(variable), result.stderr);
    assert.doesNotMatch(result.stdout, /Rejected/);
  }
});

test('output overflow fails explicitly and stops the producing command', async () => {
  await assert.rejects(
    runCommand(
      process.execPath,
      [
        '-e',
        "process.stdout.write('x'.repeat(100)); setInterval(() => {}, 1000)"
      ],
      { timeoutMs: 10_000, maxBuffer: 10 }
    ),
    /exceeded 10 output bytes/
  );
});

const interruptions = [
  ['SIGINT', 130],
  ['SIGTERM', 143],
  ['SIGHUP', 129]
];
for (const [signal, status] of interruptions) {
  test(`${signal} stops descendants before caller cleanup`, async () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'xstate-signal-test-'));
    const pids = path.join(directory, 'pids');
    const restored = path.join(directory, 'restored');
    const script = path.join(directory, 'driver.mjs');
    const childCode = `const { spawn } = require('node:child_process');
const { writeFileSync } = require('node:fs');
const grandchild = spawn(process.execPath, ['-e',
  "process.on('SIGTERM', () => {}); setInterval(() => {}, 1000)"
], { stdio: 'ignore' });
writeFileSync(${JSON.stringify(pids)}, process.pid + ',' + grandchild.pid);
setInterval(() => {}, 1000);`;
    writeFileSync(
      script,
      `
import { runCommand } from ${JSON.stringify(new URL('./machine-model-process.mjs', import.meta.url).href)};
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
${running.toString()}
try {
  await runCommand(process.execPath, ['-e', ${JSON.stringify(childCode)}], { timeoutMs: 10000 });
} catch (error) {
  console.error(error.message);
} finally {
  for (const pid of readFileSync(${JSON.stringify(pids)}, 'utf8').split(',').map(Number)) {
    assert.equal(running(pid), false, 'Process ' + pid + ' survived until caller cleanup');
  }
  writeFileSync(${JSON.stringify(restored)}, 'restored');
}`
    );
    const driver = spawn(process.execPath, [script], {
      stdio: ['ignore', 'pipe', 'pipe']
    });
    let output = '';
    driver.stderr.on('data', (data) => {
      output += data;
    });
    const completed = new Promise((resolve) =>
      driver.on('close', (status) => resolve(status))
    );
    try {
      for (let attempt = 0; attempt < 250 && !existsSync(pids); attempt++)
        await delay(20);
      assert.equal(existsSync(pids), true, 'Child did not start');
      // Allow the grandchild to install its TERM handler.
      await delay(100);
      driver.kill(signal);
      assert.equal(await completed, status);
      assert.match(output, new RegExp(`interrupted by ${signal}`));
      assert.equal(readFileSync(restored, 'utf8'), 'restored');
      for (const pid of readFileSync(pids, 'utf8').split(',').map(Number)) {
        assert.equal(running(pid), false, `Process ${pid} survived ${signal}`);
      }
    } finally {
      if (running(driver.pid)) driver.kill('SIGKILL');
      if (existsSync(pids)) {
        for (const pid of readFileSync(pids, 'utf8').split(',').map(Number)) {
          if (running(pid)) process.kill(pid, 'SIGKILL');
        }
      }
      await completed;
      rmSync(directory, { recursive: true, force: true });
    }
  });
}

for (const script of [
  'verify-machine-model.mjs',
  'check-machine-model-runtime-defects.mjs'
]) {
  for (const [signal, status] of interruptions) {
    test(`${script} preserves ${signal} status after cleanup`, async () => {
      const directory = mkdtempSync(path.join(tmpdir(), 'xstate-driver-test-'));
      const bin = path.join(directory, 'bin');
      const pidFile = path.join(directory, 'pid');
      const sourceFile = path.join(
        directory,
        'packages/core/src/StateMachine.ts'
      );
      const original = 'const targetNode = selected.target?.[0] ?? sourceNode;';
      mkdirSync(bin);
      const command = `#!${process.execPath}
const { writeFileSync } = require('node:fs');
writeFileSync(${JSON.stringify(pidFile)}, String(process.pid));
setInterval(() => {}, 1000);
`;
      for (const name of ['dafny', 'pnpm'])
        writeFileSync(path.join(bin, name), command, { mode: 0o755 });
      writeFileSync(path.join(bin, 'git'), '#!/bin/sh\nexit 0\n', {
        mode: 0o755
      });
      let entry = new URL(script, import.meta.url).pathname;
      if (script === 'check-machine-model-runtime-defects.mjs') {
        mkdirSync(path.join(directory, 'scripts'));
        mkdirSync(path.dirname(sourceFile), { recursive: true });
        writeFileSync(sourceFile, original);
        for (const name of [script, 'machine-model-process.mjs'])
          copyFileSync(
            new URL(name, import.meta.url),
            path.join(directory, 'scripts', name)
          );
        entry = path.join(directory, 'scripts', script);
      }
      const driver = spawn(process.execPath, [entry], {
        env: {
          ...process.env,
          PATH: bin + path.delimiter + process.env.PATH,
          LEMMASCRIPT_LSC: 'unused'
        },
        stdio: ['ignore', 'ignore', 'pipe']
      });
      let output = '';
      driver.stderr.on('data', (data) => {
        output += data;
      });
      const completed = new Promise((resolve) =>
        driver.on('close', (code) => resolve(code))
      );
      try {
        for (let attempt = 0; attempt < 250 && !existsSync(pidFile); attempt++)
          await delay(20);
        assert.equal(existsSync(pidFile), true, 'Driver command did not start');
        driver.kill(signal);
        assert.equal(await completed, status, output);
        assert.match(output, new RegExp(`interrupted by ${signal}`));
        assert.equal(running(Number(readFileSync(pidFile, 'utf8'))), false);
        if (script === 'check-machine-model-runtime-defects.mjs')
          assert.equal(readFileSync(sourceFile, 'utf8'), original);
      } finally {
        if (running(driver.pid)) driver.kill('SIGKILL');
        if (existsSync(pidFile)) {
          const pid = Number(readFileSync(pidFile, 'utf8'));
          if (running(pid)) process.kill(pid, 'SIGKILL');
        }
        await completed;
        rmSync(directory, { recursive: true, force: true });
      }
    });
  }
}

test('descriptor exhaustion reports the spawn error without leaking listeners', () => {
  const program = `
import assert from 'node:assert/strict';
import { closeSync, openSync } from 'node:fs';
import { runCommand } from ${JSON.stringify(new URL('./machine-model-process.mjs', import.meta.url).href)};
const signals = ${JSON.stringify(interruptions.map(([signal]) => signal))};
const listeners = signals.map((signal) => process.listenerCount(signal));
const descriptors = [];
try {
  for (;;) {
    try {
      descriptors.push(openSync('/dev/null', 'r'));
    } catch (error) {
      assert.equal(error.code, 'EMFILE');
      break;
    }
  }
  await assert.rejects(runCommand(process.execPath, ['-e', ''], { timeoutMs: 2000 }), { code: 'EMFILE' });
} finally {
  for (const descriptor of descriptors) closeSync(descriptor);
}
assert.deepEqual(signals.map((signal) => process.listenerCount(signal)), listeners);
`;
  const result = spawnSync(
    '/bin/sh',
    [
      '-c',
      'ulimit -n 64; exec "$1" --input-type=module -e "$2"',
      'spawn-failure-test',
      process.execPath,
      program
    ],
    { encoding: 'utf8', timeout: 10_000 }
  );
  assert.equal(result.status, 0, result.stderr);
});
