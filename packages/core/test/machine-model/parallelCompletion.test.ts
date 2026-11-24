import {
  compareParallelCompletion,
  compareParallelRun,
  type Config
} from './parallelAdapter';

type Log = { log: string };
const append =
  (entry: (event: { type: string; output?: unknown }) => string) =>
  ({ context, event }: { context: Log; event: never }) => ({
    context: { log: `${context.log}|${entry(event)}` }
  });
const output = (event: { output?: unknown }) =>
  JSON.stringify(event.output, (_, value) =>
    value === undefined ? 'undefined' : value
  );
const region = (on: string, final: Record<string, unknown> = {}) => ({
  initial: 'idle',
  states: {
    idle: { on: { [on]: { target: 'end' } } },
    end: { type: 'final' as const, ...final }
  }
});

describe('parallel completion', () => {
  it('queues the done event only when every region is final', () => {
    const config: Config = {
      id: 'm',
      initial: 'p',
      context: { log: '' },
      states: {
        p: {
          type: 'parallel',
          onDone: append((event) => `done ${output(event)}`) as never,
          states: {
            a: region('A', { output: () => 'a' }),
            b: region('B')
          }
        }
      }
    };
    const trace = compareParallelCompletion(config, [
      { type: 'A' },
      { type: 'B' }
    ]);
    expect(trace[1].raised).toEqual(['xstate.done.state.m.p.a']);
    expect(trace[1].context).toEqual({ log: '' });
    expect(trace[2].raised).toEqual([
      'xstate.done.state.m.p.b',
      'xstate.done.state.m.p'
    ]);
    expect(trace[2].context).toEqual({
      log: '|done {"a":"a","b":"undefined"}'
    });
  });

  it('refuses a region output object stored in context or passed to an effect', () => {
    const machine = (onDone: unknown): Config => ({
      id: 'm',
      initial: 'p',
      context: { kept: undefined },
      states: {
        p: {
          type: 'parallel',
          onDone: onDone as never,
          states: { a: region('A', { output: () => 'a' }) }
        }
      }
    });
    const stored = ({ event }: { event: { output: unknown } }) => ({
      context: { kept: event.output }
    });
    const effect = () => {};
    const passed = (
      { event }: { event: { output: unknown } },
      enq: (fn: (value: unknown) => void, value: unknown) => void
    ) => {
      enq(effect, event.output);
    };
    const field = ({ event }: { event: { output: { a: unknown } } }) => ({
      context: { kept: event.output.a }
    });
    expect(() =>
      compareParallelCompletion(machine(stored), [{ type: 'A' }])
    ).toThrow(
      'Unsupported parallel region output stored in context or passed to an effect'
    );
    expect(() =>
      compareParallelCompletion(machine(passed), [{ type: 'A' }])
    ).toThrow(
      'Unsupported parallel region output stored in context or passed to an effect'
    );
    const trace = compareParallelCompletion(machine(field), [{ type: 'A' }]);
    expect(trace[1].context).toEqual({ kept: 'a' });
  });

  it('completes a parallel root from final regions and reads its done event', () => {
    const regions = {
      x: { type: 'final' as const, output: () => 1 },
      y: { type: 'final' as const }
    };
    const withOutput = compareParallelCompletion(
      {
        id: 'm',
        type: 'parallel',
        context: {},
        output: ({ event }) => (event as unknown as { output: unknown }).output,
        states: regions
      },
      []
    );
    expect(withOutput[0].status).toBe('done');
    expect(withOutput[0].output).toEqual({ x: 1, y: undefined });
    expect(Object.keys(withOutput[0].output as object)).toEqual(['x', 'y']);
    const without = compareParallelCompletion(
      { id: 'm', type: 'parallel', context: {}, states: regions },
      []
    );
    expect(without[0].status).toBe('done');
    expect(without[0].output).toBeUndefined();
  });

  // Potential bug 18: an atomic final region counts as final before its entry
  // runs, so the parallel's done event is queued after the first region's
  // entry raise and before the second's.
  it('queues the done event of atomic final regions between their entry raises', () => {
    const raising = (type: string) => ({
      type: 'final' as const,
      entry: (
        _: unknown,
        enq: { raise: (event: { type: string }) => void }
      ) => {
        enq.raise({ type });
      }
    });
    const trace = compareParallelCompletion(
      {
        id: 'm',
        initial: 'p',
        context: { log: '' },
        on: {
          RX: append(() => 'rx') as never,
          RY: append(() => 'ry') as never
        },
        states: {
          p: {
            type: 'parallel',
            onDone: append(() => 'done') as never,
            states: { x: raising('RX') as never, y: raising('RY') as never }
          }
        }
      },
      []
    );
    expect(trace[0].raised).toEqual(['RX', 'xstate.done.state.m.p', 'RY']);
    expect(trace[0].context).toEqual({ log: '|rx|done|ry' });
  });

  it('completes a nested parallel and its parent in one microstep', () => {
    const trace = compareParallelCompletion(
      {
        id: 'm',
        initial: 'p',
        context: { log: '' },
        states: {
          p: {
            type: 'parallel',
            onDone: append((event) => `p ${output(event)}`) as never,
            states: {
              q: {
                type: 'parallel',
                onDone: append((event) => `q ${output(event)}`) as never,
                states: {
                  q1: region('GO', { output: () => 'q1' }),
                  q2: { type: 'final', output: () => 'q2' }
                }
              },
              r: region('GO', { output: () => 'r' })
            }
          }
        }
      },
      [{ type: 'GO' }]
    );
    expect(trace[1].raised).toEqual([
      'xstate.done.state.m.p.q.q1',
      'xstate.done.state.m.p.q',
      'xstate.done.state.m.p.r',
      'xstate.done.state.m.p'
    ]);
    expect(trace[1].context).toEqual({
      log: '|q {"q1":"q1","q2":"q2"}|p {"q":{"q1":"q1","q2":"q2"},"r":"r"}'
    });
  });

  // Potential bug 15: the done event of a nested parallel region is looked up
  // in the current internal queue, so a region that completed in an earlier
  // macrostep contributes `undefined`.
  it('loses the output of a nested parallel region that completed earlier', () => {
    const config: Config = {
      id: 'P',
      type: 'parallel',
      context: {},
      output: ({ event }) => (event as unknown as { output: unknown }).output,
      states: {
        N: {
          type: 'parallel',
          states: {
            n1: region('GO_N', { output: () => 'n1' }),
            n2: { type: 'final', output: () => 'n2' }
          }
        },
        R: region('GO_R', { output: () => 'r' })
      }
    };
    const split = compareParallelCompletion(config, [
      { type: 'GO_N' },
      { type: 'GO_R' }
    ]);
    expect(split[2].output).toEqual({ N: undefined, R: 'r' });
    const together = compareParallelCompletion(
      {
        ...config,
        states: {
          ...config.states,
          N: {
            ...config.states!.N,
            states: {
              n1: region('GO_R', { output: () => 'n1' }),
              n2: { type: 'final', output: () => 'n2' }
            }
          }
        }
      },
      [{ type: 'GO_R' }]
    );
    expect(together[1].output).toEqual({ N: { n1: 'n1', n2: 'n2' }, R: 'r' });
  });

  // Potential bugs 16 and 17: a parallel node that already completed queues
  // its done event again when a later microstep enters a final state below
  // it, and its region outputs are evaluated again with the current context.
  it('queues the done event of a completed parallel again', () => {
    const trace = compareParallelCompletion(
      {
        id: 'root',
        initial: 'p',
        context: { n: 1, log: '' },
        states: {
          p: {
            type: 'parallel',
            onDone: ({ context, event }) => ({
              context: {
                log: `${context.log}|p ${output(event as never)}`
              }
            }),
            states: {
              R: {
                initial: 'x',
                on: { SWAP: { target: '.f2' }, BUMP: { context: { n: 2 } } },
                states: {
                  x: { on: { GO_R: { target: 'f1' } } },
                  f1: {
                    type: 'final',
                    output: ({ context }) => context.n
                  },
                  f2: { type: 'final', output: () => 'f2' }
                }
              },
              S: region('GO_S')
            }
          }
        }
      },
      [{ type: 'GO_R' }, { type: 'BUMP' }, { type: 'GO_S' }, { type: 'SWAP' }]
    );
    expect(trace[3].context).toEqual({
      n: 2,
      log: '|p {"R":2,"S":"undefined"}'
    });
    expect(trace[4].context).toEqual({
      n: 2,
      log: '|p {"R":2,"S":"undefined"}|p {"R":"f2","S":"undefined"}'
    });
  });

  it('processes events raised in one region by another region', () => {
    const trace = compareParallelCompletion(
      {
        id: 'm',
        type: 'parallel',
        context: { log: '' },
        states: {
          a: {
            initial: 'a1',
            states: {
              a1: {
                on: {
                  GO: (_, enq) => {
                    enq.raise({ type: 'PING' });
                    return { target: 'a2' };
                  }
                }
              },
              a2: {}
            }
          },
          b: {
            initial: 'b1',
            states: {
              b1: { on: { PING: { target: 'b2' } } },
              b2: { entry: append(() => 'b2') as never }
            }
          }
        }
      },
      [{ type: 'GO' }]
    );
    expect(trace[1].value).toEqual({ a: 'a2', b: 'b2' });
    expect(trace[1].microsteps).toBe(2);
    expect(trace[1].context).toEqual({ log: '|b2' });
  });

  // A raise from a selection dropped by conflict removal is not queued,
  // although its callback ran.
  it('does not queue a raise from a selection removed by a conflict', () => {
    const fromRegion =
      (type: string) =>
      (_: unknown, enq: { raise: (event: { type: string }) => void }) => {
        enq.raise({ type });
        return { target: '#q' };
      };
    const trace = compareParallelCompletion(
      {
        id: 'r',
        initial: 'p',
        context: { log: '' },
        states: {
          p: {
            type: 'parallel',
            states: {
              a: {
                initial: 'a1',
                states: { a1: { on: { X: fromRegion('FROM_A') as never } } }
              },
              b: {
                initial: 'b1',
                states: { b1: { on: { X: fromRegion('FROM_B') as never } } }
              }
            }
          },
          q: {
            id: 'q',
            on: {
              FROM_A: append(() => 'a') as never,
              FROM_B: append(() => 'b') as never
            }
          }
        }
      },
      [{ type: 'X' }]
    );
    expect(trace[1].raised).toEqual(['FROM_A']);
    expect(trace[1].context).toEqual({ log: '|a' });
  });

  it('stops a raise cycle between regions at maxIterations', () => {
    const ping =
      (type: string) =>
      (_: unknown, enq: { raise: (event: { type: string }) => void }) => {
        enq.raise({ type });
      };
    const config: Config = {
      id: 'm',
      type: 'parallel',
      context: {},
      options: { maxIterations: 5 },
      states: {
        a: { on: { GO: ping('PING') as never, PONG: ping('PING') as never } },
        b: { on: { PING: ping('PONG') as never } }
      }
    };
    const run = compareParallelRun(config, [{ type: 'GO' }]);
    expect(run.unfinished).toEqual({ maxIterations: 5, afterEvents: 0 });
    expect(run.trace).toHaveLength(1);
  });
});
