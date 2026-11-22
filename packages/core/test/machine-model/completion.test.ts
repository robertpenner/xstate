import { compareRun, compareTrace, type Config } from './machineAdapter';

const n = (context: Record<string, unknown>) => Number(context.n);

describe('completion', () => {
  it('completes on entering a final state and reports its output', () => {
    const trace = compareTrace(
      {
        initial: 'a',
        context: { n: 1 },
        states: {
          a: { on: { go: { target: 'b' } } },
          b: { type: 'final', output: ({ context }) => n(context) * 10 }
        }
      },
      [{ type: 'go' }]
    );
    expect(trace.map(({ status }) => status)).toEqual(['active', 'done']);
    expect(trace[1].output).toBe(10);
  });

  // statelyai/xstate#5949: the runtime resolves root output before exits run.
  it('resolves root output from the done event before exit patches apply', () => {
    const trace = compareTrace(
      {
        initial: 'a',
        context: { n: 0 },
        output: ({ context, event }) =>
          `${String(event.type)}:${String(event.stateId)}:${String(event.output)}:${n(context)}`,
        states: {
          a: { on: { go: { target: 'b' } } },
          b: {
            type: 'final',
            entry: ({ context }) => ({ context: { n: n(context) + 10 } }),
            exit: ({ context }) => ({ context: { n: n(context) + 100 } }),
            output: ({ context }) => n(context)
          }
        }
      },
      [{ type: 'go' }]
    );
    expect(trace[1].output).toBe('xstate.done.state:b:10:10');
    expect(trace[1].context).toEqual({ n: 110 });
  });

  it('reports the final output as root output when the root declares none', () => {
    const trace = compareTrace(
      {
        initial: 'a',
        context: {},
        states: {
          a: { on: { go: { target: 'b' } } },
          b: { type: 'final', output: () => 'final' }
        }
      },
      [{ type: 'go' }]
    );
    expect(trace[1].output).toBe('final');
  });

  it('leaves output undefined when no output is declared', () => {
    const trace = compareTrace(
      {
        initial: 'a',
        context: {},
        states: { a: { on: { go: { target: 'b' } } }, b: { type: 'final' } }
      },
      [{ type: 'go' }]
    );
    expect(trace[1].status).toBe('done');
    expect(trace[1].output).toBeUndefined();
  });

  it('discards events raised by the final entry and exit', () => {
    const trace = compareTrace(
      {
        initial: 'a',
        context: { n: 0 },
        states: {
          a: {
            on: {
              go: (_, enq) => {
                enq.raise({ type: 'late' });
                return { target: 'b' };
              },
              late: { target: 'a' }
            }
          },
          b: {
            type: 'final',
            entry: (_, enq) => {
              enq.raise({ type: 'late' });
            },
            exit: ({ context }, enq) => {
              enq.raise({ type: 'late' });
              return { context: { n: n(context) + 1 } };
            }
          }
        }
      },
      [{ type: 'go' }]
    );
    expect(trace[1]).toMatchObject({ value: 'b', status: 'done' });
    expect(trace[1].context).toEqual({ n: 1 });
  });

  it('returns the same done snapshot with no effects for later events', () => {
    const trace = compareTrace(
      {
        initial: 'a',
        context: {},
        states: {
          a: { on: { go: { target: 'b' } } },
          b: { type: 'final', output: () => 1 }
        }
      },
      [{ type: 'go' }, { type: 'go' }, { type: 'other' }]
    );
    expect(trace.slice(2)).toEqual([
      expect.objectContaining({
        status: 'done',
        snapshotReused: true,
        effects: []
      }),
      expect.objectContaining({
        status: 'done',
        snapshotReused: true,
        effects: []
      })
    ]);
  });

  it('completes during initialization', () => {
    const trace = compareTrace(
      {
        initial: 'a',
        context: { n: 2 },
        output: ({ event }) => Number(event.output) + 1,
        states: {
          a: {
            type: 'final',
            entry: ({ context }) => ({ context: { n: n(context) * 3 } }),
            output: ({ context }) => n(context)
          }
        }
      },
      [{ type: 'go' }]
    );
    expect(trace[0]).toMatchObject({ status: 'done', output: 7 });
    expect(trace[1]).toMatchObject({ snapshotReused: true, effects: [] });
  });

  it('completes through an eventless transition', () => {
    const trace = compareTrace(
      {
        initial: 'a',
        context: {},
        states: {
          a: { on: { go: { target: 'b' } } },
          b: { always: { target: 'c' } },
          c: { type: 'final', output: () => 'c' }
        }
      },
      [{ type: 'go' }]
    );
    expect(trace[1]).toMatchObject({ value: 'c', status: 'done', output: 'c' });
  });

  describe('iteration bound', () => {
    const viaEventless = (final: boolean, maxIterations: number): Config => ({
      initial: 'a',
      context: {},
      options: { maxIterations },
      states: {
        a: { always: { target: 'b' } },
        b: final ? { type: 'final' } : {}
      }
    });

    it('lets a macrostep that ends done use every iteration', () => {
      const run = compareRun(viaEventless(true, 1), []);
      expect(run.unfinished).toBeUndefined();
      expect(run.trace[0].status).toBe('done');
    });

    it('needs one more iteration for a macrostep that ends active', () => {
      expect(compareRun(viaEventless(false, 1), []).unfinished).toEqual({
        maxIterations: 1,
        afterEvents: 0
      });
      expect(compareRun(viaEventless(false, 2), []).unfinished).toBeUndefined();
    });
  });

  describe('refusals', () => {
    const refused = (config: Config, message: string) =>
      expect(() => compareRun(config, [])).toThrow(message);

    it('refuses transitions on final states', () => {
      refused(
        {
          initial: 'a',
          context: {},
          states: { a: { type: 'final', on: { go: { target: 'a' } } } }
        },
        'Unsupported transitions on final state a'
      );
      refused(
        {
          initial: 'a',
          context: {},
          states: { a: { type: 'final', always: { target: 'a' } } }
        },
        'Unsupported transitions on final state a'
      );
    });

    it('refuses output on a non-final state', () => {
      refused(
        { initial: 'a', context: {}, states: { a: { output: () => 1 } } },
        'Unsupported states.a.output'
      );
    });

    it('refuses unknown state types', () => {
      refused(
        {
          initial: 'a',
          context: {},
          states: { a: { type: 'history' as 'final' } }
        },
        'Unsupported states.a.type'
      );
    });

    it('refuses external events in the xstate namespace', () => {
      expect(() =>
        compareRun(
          {
            initial: 'a',
            context: {},
            states: { a: { on: { go: { target: 'a' } } } }
          },
          [{ type: 'xstate.done.state' }]
        )
      ).toThrow('Unsupported event.type');
    });
  });
});
