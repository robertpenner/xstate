import { compareCompoundTrace } from './compoundAdapter';
import { compareRun, compareTrace, type Config } from './machineAdapter';

const initRaise = (maxIterations: number): Config => ({
  initial: 'a',
  context: {},
  options: { maxIterations },
  states: {
    a: {
      entry: (_, enq) => {
        enq.raise({ type: 'go' });
      },
      on: { go: { target: 'b' } }
    },
    b: {}
  }
});

describe('raised events', () => {
  it('queues exit, transition and entry raises in that order', () => {
    const seen: string[] = [];
    const record = ({ event }: { event: { type: string } }) => {
      seen.push(event.type);
      return {};
    };
    compareTrace(
      {
        initial: 'a',
        context: {},
        states: {
          a: {
            exit: (_, enq) => {
              enq.raise({ type: 'X1' });
            },
            on: {
              go: (_, enq) => {
                enq.raise({ type: 'T1' });
                return { target: 'b' };
              }
            }
          },
          b: {
            entry: (_, enq) => {
              enq.raise({ type: 'N1' });
            },
            on: { X1: record, T1: record, N1: record }
          }
        }
      },
      [{ type: 'go' }]
    );
    // compareTrace runs the macrostep in the model and the runtime.
    expect(seen.join(' ')).toMatch(/^X1 T1 N1( X1 T1 N1)+$/);
  });

  it('processes a raise cascade within one macrostep', () => {
    const trace = compareTrace(
      {
        initial: 'a',
        context: { n: 0 },
        states: {
          a: {
            on: {
              go: (_, enq) => {
                enq.raise({ type: 'first' });
              },
              first: ({ context }, enq) => {
                enq.raise({ type: 'second' });
                return { target: 'b', context: { n: Number(context.n) + 1 } };
              }
            }
          },
          b: {
            on: {
              second: ({ context }) => ({
                target: 'c',
                context: { n: Number(context.n) + 10 }
              })
            }
          },
          c: {}
        }
      },
      [{ type: 'go' }]
    );
    expect(trace.map((step) => [step.value, step.context.n])).toEqual([
      ['a', 0],
      ['c', 11]
    ]);
    expect(trace[1].snapshotReused).toBe(false);
  });

  it('processes raises in separate macrosteps for separate external events', () => {
    const trace = compareTrace(
      {
        initial: 'a',
        context: { n: 0 },
        states: {
          a: {
            on: {
              go: (_, enq) => {
                enq.raise({ type: 'bump' });
              },
              bump: ({ context }) => ({
                context: { n: Number(context.n) + 1 }
              })
            }
          }
        }
      },
      [{ type: 'go' }, { type: 'go' }]
    );
    expect(trace.map((step) => step.context.n)).toEqual([0, 1, 2]);
  });

  it('processes an entry raise during initialization', () => {
    const trace = compareTrace(initRaise(10), []);
    expect(trace.map((step) => step.value)).toEqual(['b']);
  });

  it('counts each dequeue against maxIterations', () => {
    expect(compareRun(initRaise(1), []).unfinished).toEqual({
      maxIterations: 1,
      afterEvents: 0
    });
    expect(compareRun(initRaise(2), []).unfinished).toBeUndefined();
  });

  it('dequeues an unhandled raised event and passes it to eventless callbacks', () => {
    const seen: string[] = [];
    const trace = compareTrace(
      {
        initial: 'a',
        context: { n: 0 },
        states: {
          a: {
            entry: (_, enq) => {
              enq.raise({ type: 'unhandled' });
            },
            always: ({ context, event }) => {
              seen.push(`${event.type}:${String(context.n)}`);
              return Number(context.n) < 1
                ? { context: { n: Number(context.n) + 1 } }
                : undefined;
            }
          }
        }
      },
      []
    );
    expect(trace.map((step) => step.context.n)).toEqual([1]);
    expect(seen).toContain('unhandled:1');
  });

  it('runs eventless transitions before dequeuing a raised event', () => {
    const seen: string[] = [];
    compareTrace(
      {
        initial: 'a',
        context: {},
        states: {
          a: {
            entry: (_, enq) => {
              enq.raise({ type: 'R' });
            },
            always: { target: 'b' },
            on: {
              R: () => {
                seen.push('a');
                return {};
              }
            }
          },
          b: {
            on: {
              R: () => {
                seen.push('b');
                return {};
              }
            }
          }
        }
      },
      []
    );
    expect(new Set(seen)).toEqual(new Set(['b']));
  });

  it('treats a handler that only raises as handled', () => {
    const trace = compareTrace(
      {
        initial: 'a',
        context: {},
        states: {
          a: {
            on: {
              go: (_, enq) => {
                enq.raise({ type: 'unhandled' });
              }
            }
          }
        }
      },
      [{ type: 'go' }]
    );
    expect(trace[1].snapshotReused).toBe(false);
  });

  it('passes the raised event object to its handler', () => {
    const payload = { id: 1 };
    const trace = compareTrace(
      {
        initial: 'a',
        context: {},
        states: {
          a: {
            on: {
              go: (_, enq) => {
                enq.raise({ type: 'R', payload });
              },
              R: ({ event }) => ({ context: { got: event.payload } })
            }
          }
        }
      },
      [{ type: 'go' }]
    );
    expect(trace[1].context.got).toBe(payload);
  });

  it('reports an unfinished macrostep for a raise-only eventless cycle', () => {
    expect(
      compareRun(
        {
          initial: 'a',
          context: {},
          options: { maxIterations: 10 },
          states: {
            a: {
              always: (_, enq) => {
                enq.raise({ type: 'R' });
              }
            }
          }
        },
        []
      ).unfinished
    ).toEqual({ maxIterations: 10, afterEvents: 0 });
  });

  it('reports an unfinished macrostep for a cycle of eventless and raised transitions', () => {
    expect(
      compareRun(
        {
          initial: 'idle',
          context: {},
          options: { maxIterations: 7 },
          states: {
            idle: { on: { go: { target: 'a' } } },
            a: { always: { target: 'b' } },
            b: {
              entry: (_, enq) => {
                enq.raise({ type: 'back' });
              },
              on: { back: { target: 'a' } }
            }
          }
        },
        [{ type: 'go' }]
      ).unfinished
    ).toEqual({ maxIterations: 7, afterEvents: 0 });
  });

  it.each([
    [
      'a delayed raise',
      (enq: { raise: (event: { type: string }) => void }) =>
        Reflect.apply(enq.raise, undefined, [{ type: 'R' }, { delay: 1 }]),
      /Unsupported raise options/
    ],
    [
      'a built-in event type',
      (enq: { raise: (event: { type: string }) => void }) =>
        enq.raise({ type: 'xstate.done.state.a' }),
      /Unsupported raised event type/
    ],
    [
      'a non-plain event',
      (enq: { raise: (event: { type: string }) => void }) =>
        enq.raise(
          new (class Custom {
            type = 'R';
          })()
        ),
      /Unsupported record at raised event/
    ]
  ])('refuses %s', (_, raise, message) => {
    expect(() =>
      compareTrace(
        {
          initial: 'a',
          context: {},
          states: {
            a: {
              on: {
                go: (_, enq) => {
                  raise(enq);
                }
              }
            }
          }
        },
        [{ type: 'go' }]
      )
    ).toThrow(message);
  });

  it('processes raises in compound machines', () => {
    const trace = compareCompoundTrace(
      {
        initial: 'a',
        context: {},
        states: {
          a: {
            on: {
              go: (_, enq) => {
                enq.raise({ type: 'R' });
              },
              R: { target: 'b' }
            }
          },
          b: {}
        }
      },
      [{ type: 'go' }]
    );
    expect(trace[1].value).toBe('b');
  });
});
