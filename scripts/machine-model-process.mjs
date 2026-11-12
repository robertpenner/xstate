import { execFile, spawn } from 'node:child_process';
import { constants } from 'node:os';
import { promisify } from 'node:util';
import { setTimeout as delay } from 'node:timers/promises';

const execute = promisify(execFile);
const interruptSignals = ['SIGINT', 'SIGTERM', 'SIGHUP'];

async function waitForGroup(pid) {
  if (!pid) return;
  for (;;) {
    const { stdout } = await execute('ps', ['-axo', 'pgid=,stat=']);
    const alive = stdout.split('\n').some((line) => {
      const [group, state] = line.trim().split(/\s+/);
      return Number(group) === pid && !state?.startsWith('Z');
    });
    if (!alive) return;
    await delay(25);
  }
}

export function childTimeout(name, defaultMs) {
  const value = process.env[name];
  if (value === undefined) return defaultMs;
  const timeoutMs = Number(value);
  if (
    !Number.isFinite(timeoutMs) ||
    timeoutMs <= 0 ||
    timeoutMs > 2 ** 31 - 1
  ) {
    throw new Error(
      `${name} must be a positive number of milliseconds <= 2147483647`
    );
  }
  return timeoutMs;
}

export function runCommand(
  command,
  args,
  { cwd, timeoutMs, maxBuffer = 8 * 1024 * 1024 }
) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      detached: true,
      stdio: ['ignore', 'pipe', 'pipe']
    });
    if (!child.pid) {
      child.once('error', reject);
      return;
    }
    const stdout = [];
    const stderr = [];
    let bytes = 0;
    let failure;
    let closed;
    let escalation;
    let cleanupDone = false;
    const label = [command, ...args].join(' ');
    const finish = () => {
      if (!closed || (failure && !cleanupDone)) return;
      clearTimeout(deadline);
      clearTimeout(escalation);
      for (const signal of interruptSignals)
        process.removeListener(signal, interrupt);
      if (failure) reject(failure);
      else
        resolve({
          status: closed.status,
          signal: closed.signal,
          output:
            Buffer.concat(stdout).toString() + Buffer.concat(stderr).toString()
        });
    };
    const signalGroup = (signal) => {
      if (!child.pid) return;
      try {
        process.kill(-child.pid, signal);
      } catch (error) {
        if (error.code !== 'ESRCH') failure = error;
      }
    };
    const terminate = (error) => {
      if (failure) return;
      failure = error;
      clearTimeout(deadline);
      signalGroup('SIGTERM');
      // The leader may exit first. Always escalate against its original group.
      escalation = setTimeout(async () => {
        signalGroup('SIGKILL');
        try {
          await waitForGroup(child.pid);
        } catch (error) {
          failure = new Error(
            `Could not confirm process-group cleanup for ${label}`,
            { cause: error }
          );
        } finally {
          cleanupDone = true;
          finish();
        }
      }, 100);
    };
    const interrupt = (signal) => {
      process.exitCode = 128 + constants.signals[signal];
      terminate(new Error(`${label} interrupted by ${signal}`));
    };
    const deadline = setTimeout(() => {
      terminate(new Error(`${label} timed out after ${timeoutMs} ms`));
    }, timeoutMs);
    for (const signal of interruptSignals) process.on(signal, interrupt);
    for (const [stream, chunks] of [
      [child.stdout, stdout],
      [child.stderr, stderr]
    ]) {
      stream.on('data', (chunk) => {
        bytes += chunk.length;
        if (bytes > maxBuffer)
          terminate(new Error(`${label} exceeded ${maxBuffer} output bytes`));
        else chunks.push(chunk);
      });
    }
    child.on('error', (error) => terminate(error));
    child.on('close', (status, signal) => {
      closed = { status, signal };
      finish();
    });
  });
}
