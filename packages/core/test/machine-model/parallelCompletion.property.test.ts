import fc from 'fast-check';
import { compareParallelRun, type Config } from './parallelAdapter';

type State = NonNullable<Config['states']>[string];
type Enqueue = Parameters<Extract<State['entry'], Function>>[1];
const effect = () => {
  throw new Error('Effects must not execute');
};

it('compares generated parallel completion, raised events and done events', () => {
  const stats = {
    runs: 0,
    done: 0,
    doneEvents: 0,
    parallelDoneEvents: 0,
    raisedSteps: 0,
    unfinished: 0,
    refused: 0
  };
  fc.assert(
    fc.property(
      fc.integer({ min: 1, max: 3 }),
      fc.array(fc.integer({ min: 0, max: 100 }), {
        minLength: 80,
        maxLength: 80
      }),
      fc.array(fc.constantFrom('a', 'b', 'missing'), {
        minLength: 1,
        maxLength: 12
      }),
      (depth, numbers, events) => {
        let cursor = 0;
        const pick = () => numbers[cursor++ % numbers.length];
        const all: State[] = [];
        const parallels = new Set<string>();
        const raise = (enq: Enqueue, n: number) =>
          enq.raise({ type: n % 2 ? 'a' : 'b' });
        function tree(level: number): State {
          const index = all.length;
          const node: State = {
            id: `id${index}`,
            entry: ({ context }, enq) => {
              enq(effect, 'entry', index, context.count);
              return { context: { count: Number(context.count) + 1 } };
            },
            exit: ({ context }, enq) => {
              enq(effect, 'exit', index, context.count);
              return { context: { count: Number(context.count) + 2 } };
            }
          };
          all.push(node);
          const n = pick();
          if (level >= depth || (level > 0 && n % 5 === 0)) {
            if (level > 0 && n % 2 === 0) {
              node.type = 'final';
              node.output = ({ context }) => `${index}:${context.count}`;
            }
            return node;
          }
          if (n % 3 === 0) {
            node.type = 'parallel';
            parallels.add(node.id!);
            node.states = { x: tree(level + 1), y: tree(level + 1) };
            if (pick() % 2) node.states.z = tree(level + 1);
          } else {
            node.initial = 'x';
            node.states = { x: tree(level + 1), y: tree(level + 1) };
            if (pick() % 2)
              node.states.f = {
                id: `id${all.push({}) - 1}`,
                type: 'final',
                output: ({ context }) => `f${index}:${context.count}`
              };
          }
          return node;
        }
        const config: Config = {
          ...tree(0),
          context: { count: 0 },
          options: { maxIterations: 8 }
        };
        all[0] = config;
        if (pick() % 2)
          config.output = ({ context, event }) => ({
            count: context.count,
            output: (event as { output?: unknown }).output
          });
        for (const [index, node] of all.entries()) {
          if (node.type === 'final' || node.id === undefined) continue;
          node.on = {};
          for (const [offset, type] of ['a', 'b'].entries()) {
            const n = numbers[(2 * index + offset) % numbers.length];
            const result = {
              target: n % 5 === 0 ? undefined : `#id${n % all.length}`,
              reenter: n % 3 === 0,
              context: { count: n }
            };
            if (n % 8 === 0) continue;
            if (n % 8 === 1) node.on[type] = undefined;
            else if (n % 8 === 2) node.on[type] = () => undefined;
            else if (n % 8 === 3)
              node.on[type] = (_, enq) => {
                enq(effect, 'effect-only');
              };
            else if (n % 8 === 4) node.on[type] = result;
            else if (n % 8 === 5)
              node.on[type] = (_, enq) => {
                raise(enq, n);
                return result;
              };
            else
              node.on[type] = ({ context }, enq) => {
                enq(effect, 'transition', index, context.count);
                return result;
              };
          }
          const n = pick();
          if (index > 0 && node.states !== undefined && n % 2)
            node.onDone = ({ context, event }, enq) => {
              enq(effect, 'done', index, context.count);
              if (n % 3 === 0) raise(enq, n);
              return {
                target: n % 5 === 0 ? `#id${n % all.length}` : undefined,
                context: {
                  count: `${context.count}/${JSON.stringify(
                    (event as { output?: unknown }).output
                  )}`
                }
              };
            };
        }
        stats.runs++;
        try {
          const run = compareParallelRun(
            config,
            events.map((type) => ({ type }))
          );
          if (run.unfinished) stats.unfinished++;
          if (run.trace.at(-1)?.status === 'done') stats.done++;
          for (const step of run.trace) {
            const done = step.raised.filter((type) =>
              type.startsWith('xstate.done.state.')
            );
            stats.doneEvents += done.length;
            stats.parallelDoneEvents += done.filter((type) =>
              parallels.has(type.slice('xstate.done.state.'.length))
            ).length;
            if (step.microsteps > 1) stats.raisedSteps++;
          }
        } catch (error) {
          if (
            !(error instanceof Error) ||
            !/^Unsupported (step|raised event)/.test(error.message)
          )
            throw error;
          stats.refused++;
        }
      }
    ),
    {
      seed: 3838,
      numRuns: 400,
      interruptAfterTimeLimit: 4000,
      markInterruptAsFailure: true
    }
  );
  console.info('parallel completion property coverage', stats);
  expect(stats.done).toBeGreaterThan(0);
  expect(stats.parallelDoneEvents).toBeGreaterThan(0);
  expect(stats.raisedSteps).toBeGreaterThan(stats.runs / 10);
  expect(stats.unfinished).toBeGreaterThan(0);
  expect(stats.refused).toBeLessThan(stats.runs / 2);
});
