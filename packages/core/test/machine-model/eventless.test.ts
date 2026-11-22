import { compareRun, compareTrace, type Config } from './machineAdapter';

const counter = (limit: number, maxIterations?: number): Config => ({
  initial: 'a',
  context: { n: 0 },
  options: maxIterations === undefined ? undefined : { maxIterations },
  states: {
    a: {
      always: ({ context }) =>
        Number(context.n) < limit
          ? { context: { n: Number(context.n) + 1 } }
          : undefined
    }
  }
});

describe('eventless transitions', () => {
  it('chains eventless targets during initialization', () => {
    const trace = compareTrace(
      {
        initial: 'a',
        context: {},
        states: {
          a: { always: { target: 'b' } },
          b: { always: { target: 'c' } },
          c: {}
        }
      },
      []
    );
    expect(trace.map((step) => step.value)).toEqual(['c']);
  });

  it('chains eventless targets after an external event', () => {
    const trace = compareTrace(
      {
        initial: 'a',
        context: {},
        states: {
          a: { on: { go: { target: 'b' } } },
          b: { always: { target: 'c' } },
          c: { always: { target: 'd' } },
          d: {}
        }
      },
      [{ type: 'go' }]
    );
    expect(trace.map((step) => step.value)).toEqual(['a', 'd']);
  });

  it('passes the macrostep event to eventless callbacks', () => {
    const seen: string[] = [];
    compareTrace(
      {
        initial: 'a',
        context: {},
        states: {
          a: {
            always: ({ event }) => {
              seen.push(event.type);
            },
            on: { go: { target: 'b' } }
          },
          b: {
            always: ({ event }) => {
              seen.push(event.type);
            }
          }
        }
      },
      [{ type: 'go', payload: 1 }]
    );
    expect(seen).toContain('xstate.init');
    expect(seen).toContain('go');
    expect(
      seen.filter((type) => type !== 'xstate.init' && type !== 'go')
    ).toEqual([]);
  });

  it('runs an effect-only eventless transition once per macrostep', () => {
    const record = vi.fn();
    const trace = compareTrace(
      {
        initial: 'a',
        context: {},
        states: {
          a: {
            always: (_, enq) => {
              enq(record, 'always');
            },
            on: { ping: {} }
          }
        }
      },
      [{ type: 'ping' }]
    );
    expect(trace.map((step) => step.effects.length)).toEqual([1, 1]);
  });

  it('reuses the snapshot when an unhandled event runs only eventless effects', () => {
    const record = vi.fn();
    const trace = compareTrace(
      {
        initial: 'a',
        context: {},
        states: {
          a: {
            always: (_, enq) => {
              enq(record, 'always');
            }
          }
        }
      },
      [{ type: 'missing' }]
    );
    expect(trace.map((step) => step.snapshotReused)).toEqual([false, true]);
    expect(trace[1].effects).toHaveLength(1);
  });

  it('runs a self-targeting eventless transition once per macrostep', () => {
    const record = vi.fn();
    const trace = compareTrace(
      {
        initial: 'a',
        context: {},
        states: {
          a: {
            entry: (_, enq) => {
              enq(record, 'entry');
            },
            always: (_, enq) => {
              enq(record, 'always');
              return { target: 'a' };
            }
          }
        }
      },
      []
    );
    expect(trace[0].effects.map((effect) => effect.args[0])).toEqual([
      'entry',
      'always'
    ]);
  });

  it('settles a counter that stops patching', () => {
    const trace = compareTrace(counter(3), []);
    expect(trace[0].context).toEqual({ n: 3 });
    expect(trace[0].contextReused).toBe(false);
  });

  it('reports an unfinished macrostep for an empty patch', () => {
    const run = compareRun(
      {
        initial: 'a',
        context: {},
        options: { maxIterations: 5 },
        states: { a: { always: { context: {} } } }
      },
      []
    );
    expect(run.unfinished).toEqual({ maxIterations: 5, afterEvents: 0 });
  });

  it('reports an unfinished macrostep for a two-state cycle after an event', () => {
    const run = compareRun(
      {
        initial: 'idle',
        context: {},
        options: { maxIterations: 7 },
        states: {
          idle: { on: { go: { target: 'a' } } },
          a: { always: { target: 'b' } },
          b: { always: { target: 'a' } }
        }
      },
      [{ type: 'go' }]
    );
    expect(run.trace.map((step) => step.value)).toEqual(['idle']);
    expect(run.unfinished).toEqual({ maxIterations: 7, afterEvents: 0 });
  });

  it('finishes K eventless steps with one spare iteration and stops at bound K', () => {
    for (const steps of [1, 2, 5]) {
      expect(compareRun(counter(steps, steps + 1), []).unfinished).toBe(
        undefined
      );
      expect(compareRun(counter(steps, steps), []).unfinished).toEqual({
        maxIterations: steps,
        afterEvents: 0
      });
    }
  });

  it('refuses an unbounded macrostep that never settles', () => {
    expect(() =>
      compareTrace(
        {
          initial: 'a',
          context: {},
          states: { a: { always: { context: {} } } }
        },
        []
      )
    ).toThrow(/Unsupported unbounded macrostep/);
  });

  it.each([
    ['always array', { a: { always: [{ target: 'a' }] } }, undefined],
    ['always unknown target', { a: { always: { target: 'z' } } }, undefined],
    ['zero bound', { a: {} }, 0],
    ['fractional bound', { a: {} }, 1.5]
  ])('refuses %s', (_, states, maxIterations) => {
    expect(() =>
      compareTrace(
        {
          initial: 'a',
          context: {},
          options: maxIterations === undefined ? undefined : { maxIterations },
          // @ts-expect-error Deliberately unsupported configuration.
          states
        },
        []
      )
    ).toThrow(/Unsupported/);
  });
});
