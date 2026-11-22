import { compareCompoundRun, compareCompoundTrace } from './compoundAdapter';

const n = (context: Record<string, unknown>) => Number(context.n);

describe('compound completion', () => {
  it('raises a done event for the parent of a final child and passes its output to onDone', () => {
    const trace = compareCompoundTrace(
      {
        context: { n: 2, seen: 0 },
        initial: 'p',
        states: {
          p: {
            initial: 'a',
            onDone: ({ context, event }) => ({
              target: 'q',
              context: { ...context, seen: event.output }
            }),
            states: {
              a: { on: { go: { target: 'f' } } },
              f: { type: 'final', output: ({ context }) => n(context) * 10 }
            }
          },
          q: {}
        }
      },
      [{ type: 'go' }]
    );
    expect(trace.map(({ value }) => value)).toEqual([{ p: 'a' }, 'q']);
    expect(trace[1].status).toBe('active');
    expect(trace[1].context).toEqual({ n: 2, seen: 20 });
  });

  it('queues the done event after the final entry raises', () => {
    const trace = compareCompoundTrace(
      {
        context: { n: 0, seen: -1 },
        initial: 'p',
        on: { R: ({ context }) => ({ context: { ...context, n: 1 } }) },
        states: {
          p: {
            initial: 'a',
            onDone: ({ context, event }) => ({
              target: 'q',
              context: { ...context, seen: n(context), stateId: event.stateId }
            }),
            states: {
              a: { on: { go: { target: 'f' } } },
              f: {
                type: 'final',
                entry: (_, enq) => {
                  enq.raise({ type: 'R' });
                }
              }
            }
          },
          q: {}
        }
      },
      [{ type: 'go' }]
    );
    expect(trace[1].context).toEqual({
      n: 1,
      seen: 1,
      stateId: 'p'
    });
  });

  it('completes a nested final state during initialization', () => {
    const trace = compareCompoundTrace(
      {
        context: {},
        initial: 'p',
        states: {
          p: {
            initial: 'f',
            onDone: { target: 'q' },
            states: { f: { type: 'final' } }
          },
          q: {}
        }
      },
      []
    );
    expect(trace[0].value).toBe('q');
    expect(trace[0].status).toBe('active');
  });

  it('completes the machine when a final child of the root is initial', () => {
    const trace = compareCompoundTrace(
      {
        context: {},
        initial: 'f',
        states: { f: { type: 'final', output: () => 'leaf' } }
      },
      [{ type: 'go' }]
    );
    expect(trace.map(({ status }) => status)).toEqual(['done', 'done']);
    expect(trace[0].output).toBe('leaf');
    expect(trace[1].snapshotReused).toBe(true);
    expect(trace[1].effects).toEqual([]);
  });

  it('reports the leaf output as machine output when the root declares none', () => {
    const trace = compareCompoundTrace(
      {
        context: { n: 3 },
        initial: 'a',
        states: {
          a: { on: { go: { target: 'f' } } },
          f: { type: 'final', output: ({ context }) => n(context) + 1 }
        }
      },
      [{ type: 'go' }]
    );
    expect(trace[1].status).toBe('done');
    expect(trace[1].output).toBe(4);
  });

  // statelyai/xstate#5949: the runtime resolves root output before exit patches apply.
  it('resolves root output from the done event before exit patches apply', () => {
    const trace = compareCompoundTrace(
      {
        context: { n: 0 },
        initial: 'a',
        output: ({ context, event }) =>
          `${String(event.type)}:${String(event.output)}:${n(context)}`,
        states: {
          a: { on: { go: { target: 'f' } } },
          f: {
            type: 'final',
            entry: ({ context }) => ({ context: { n: n(context) + 10 } }),
            exit: ({ context }) => ({ context: { n: n(context) + 100 } }),
            output: ({ context }) => n(context)
          }
        }
      },
      [{ type: 'go' }]
    );
    expect(trace[1].output).toBe('xstate.done.state:10:10');
    expect(trace[1].context).toEqual({ n: 110 });
  });

  it('discards raised events still queued when the machine completes', () => {
    const trace = compareCompoundTrace(
      {
        context: { n: 0 },
        initial: 'a',
        on: { later: () => ({ context: { n: 1 } }) },
        states: {
          a: {
            on: {
              go: (_, enq) => {
                enq.raise({ type: 'later' });
                return { target: 'f' };
              }
            }
          },
          f: {
            type: 'final',
            output: ({ context }) => n(context)
          }
        }
      },
      [{ type: 'go' }]
    );
    expect(trace[1].status).toBe('done');
    expect(trace[1].output).toBe(0);
    expect(trace[1].context).toEqual({ n: 0 });
  });

  it('completes nested parents one level at a time', () => {
    const trace = compareCompoundTrace(
      {
        context: { n: 0 },
        initial: 'p',
        states: {
          p: {
            initial: 'r',
            onDone: { target: 'q' },
            states: {
              r: {
                initial: 'a',
                onDone: { target: 'g' },
                states: {
                  a: { on: { go: { target: 'f' } } },
                  f: { type: 'final' }
                }
              },
              g: { type: 'final' }
            }
          },
          q: {}
        }
      },
      [{ type: 'go' }]
    );
    expect(trace[1].value).toBe('q');
  });

  it('counts the done event dequeue against maxIterations', () => {
    const config = (maxIterations: number) => ({
      context: {},
      initial: 'p',
      options: { maxIterations },
      states: {
        p: {
          initial: 'a',
          onDone: { target: 'q' },
          states: {
            a: { on: { go: { target: 'f' } } },
            f: { type: 'final' as const }
          }
        },
        q: {}
      }
    });
    expect(compareCompoundRun(config(1), [{ type: 'go' }]).unfinished).toEqual({
      maxIterations: 1,
      afterEvents: 0
    });
    const run = compareCompoundRun(config(2), [{ type: 'go' }]);
    expect(run.unfinished).toBeUndefined();
    expect(run.trace[1].value).toBe('q');
  });

  describe('refusals', () => {
    const refused = (
      config: Parameters<typeof compareCompoundTrace>[0],
      message: string | RegExp
    ) => expect(() => compareCompoundTrace(config, [])).toThrow(message);

    it('refuses a final root', () => {
      refused({ context: {}, type: 'final' }, /Unsupported state type: final/);
    });

    it('refuses children and transitions on final states', () => {
      refused(
        {
          context: {},
          initial: 'f',
          states: { f: { type: 'final', on: { go: { target: 'f' } } } }
        },
        /Unsupported transitions on final state/
      );
      refused(
        {
          context: {},
          initial: 'f',
          states: {
            f: { type: 'final', initial: 'a', states: { a: {} } }
          }
        },
        /Unsupported transitions on final state/
      );
    });

    it('refuses output on a non-final child', () => {
      refused(
        { context: {}, initial: 'a', states: { a: { output: () => 1 } } },
        /Unsupported .*\.output/
      );
    });

    it('refuses onDone on atomic states and the root', () => {
      refused(
        {
          context: {},
          initial: 'a',
          states: { a: { onDone: { target: 'a' } } }
        },
        /Unsupported .*\.onDone/
      );
      refused(
        {
          context: {},
          initial: 'a',
          onDone: { target: 'a' },
          states: { a: {} }
        },
        /Unsupported .*\.onDone/
      );
    });

    it('refuses authored handlers for done events', () => {
      refused(
        {
          context: {},
          initial: 'a',
          on: { 'xstate.done.state.(machine).a': {} },
          states: { a: {} }
        },
        /Unsupported event name/
      );
    });
  });
});
