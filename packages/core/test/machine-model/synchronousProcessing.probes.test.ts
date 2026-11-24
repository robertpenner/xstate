// Exploratory probes for robertpenner/xstate#24. Each test records what the
// runtime does today for eventless transitions, immediate raised events, and
// completion. The title tag says where the expectation comes from:
//   [runtime]   observed v6 behavior only
//   [SCXML]     also required by normative SCXML 2015 text
//   [Appendix D] also matches the informative SCXML algorithm
//   [v5]        xstate@5.33.4 gives the same result
//   [differs]   SCXML or v5 gives a different result (see SYNCHRONOUS_PROCESSING.md)
// Every machine sets maxIterations so that a regression fails instead of hanging.
// Cycle probes and bound counting live in synchronousProcessing.cycles.test.ts.
import {
  AnyMachineSnapshot,
  createMachine,
  getInitialMicrosteps,
  getMicrosteps,
  initialTransition,
  transition
} from '../../src';

const record = (..._args: unknown[]) => {};
const maxIterations = 50;

type Step = readonly [AnyMachineSnapshot, readonly unknown[], readonly any[]];

function labels(effects: readonly unknown[]): string[] {
  return effects.flatMap((effect: any) =>
    'args' in effect && typeof effect.args[0] === 'string'
      ? [effect.args.join(' ')]
      : []
  );
}

function trace(steps: readonly Step[]) {
  return steps.map(([snapshot, effects, transitions]) => ({
    value: snapshot.value,
    events: transitions.map((t) => t.eventType),
    log: labels(effects)
  }));
}

describe('synchronous processing probes (#24)', () => {
  describe('order of eventless transitions and raised events', () => {
    it('[SCXML][v5] takes eventless transitions before dequeuing a raised event', () => {
      const machine = createMachine({
        options: { maxIterations },
        initial: 'idle',
        states: {
          idle: {
            on: {
              GO: (_, enq) => {
                enq.raise({ type: 'R' });
                return { target: 'a' };
              }
            }
          },
          a: { always: { target: 'b' } },
          b: { on: { R: { target: 'c' } } },
          c: {}
        }
      });
      const steps = getMicrosteps(machine, initialTransition(machine)[0], {
        type: 'GO'
      });
      expect(trace(steps).map((s) => [s.value, s.events])).toEqual([
        ['a', ['GO']],
        ['b', ['']],
        ['c', ['R']]
      ]);
    });

    it('[SCXML][v5] processes raised events FIFO: exit, transition, entry, then later steps', () => {
      const machine = createMachine({
        options: { maxIterations },
        initial: 'a',
        states: {
          a: {
            exit: (_, enq) => enq.raise({ type: 'R1' }),
            on: {
              GO: (_, enq) => {
                enq.raise({ type: 'R2' });
                return { target: 'b' };
              }
            }
          },
          b: {
            entry: (_, enq) => enq.raise({ type: 'R3' }),
            on: {
              R1: (_, enq) => {
                enq(record, 'R1');
                enq.raise({ type: 'R4' });
              },
              R2: (_, enq) => enq(record, 'R2'),
              R3: (_, enq) => enq(record, 'R3'),
              R4: (_, enq) => enq(record, 'R4')
            }
          }
        }
      });
      const [, effects] = transition(machine, initialTransition(machine)[0], {
        type: 'GO'
      });
      expect(labels(effects)).toEqual(['R1', 'R2', 'R3', 'R4']);
    });

    it('[runtime] replays a raise from a transition callback after the exit raises', () => {
      const machine = createMachine({
        options: { maxIterations },
        initial: 'a',
        states: {
          a: {
            exit: (_, enq) => enq.raise({ type: 'EXIT' }),
            on: {
              GO: (_, enq) => {
                enq.raise({ type: 'TRANSITION' });
                return { target: 'b' };
              }
            }
          },
          b: {}
        },
        on: {
          EXIT: (_, enq) => enq(record, 'EXIT'),
          TRANSITION: (_, enq) => enq(record, 'TRANSITION')
        }
      });
      const [, effects] = transition(machine, initialTransition(machine)[0], {
        type: 'GO'
      });
      expect(labels(effects)).toEqual(['EXIT', 'TRANSITION']);
    });

    it('[runtime] processes a raised event that no transition handles as its own microstep', () => {
      const machine = createMachine({
        options: { maxIterations },
        initial: 'a',
        states: {
          a: {
            on: {
              GO: (_, enq) => {
                enq.raise({ type: 'UNHANDLED' });
              }
            }
          }
        }
      });
      const steps = getMicrosteps(machine, initialTransition(machine)[0], {
        type: 'GO'
      });
      expect(steps.map(([, , ts]) => ts.length)).toEqual([1, 0]);
    });

    it('[SCXML][v5] lets an eventless callback see the last processed event', () => {
      const seen: string[] = [];
      const machine = createMachine({
        options: { maxIterations },
        initial: 'idle',
        states: {
          idle: {
            always: ({ event }) => {
              seen.push(event.type);
              return undefined;
            },
            on: {
              GO: (_, enq) => {
                enq.raise({ type: 'R' });
              }
            }
          }
        }
      });
      transition(machine, initialTransition(machine)[0], { type: 'GO' });
      expect(seen).toEqual(['xstate.init', 'GO', 'R']);
    });

    it('[SCXML] runs initialization like a macrostep: entry raises after eventless transitions', () => {
      const machine = createMachine({
        options: { maxIterations },
        initial: 'a',
        entry: (_, enq) => enq.raise({ type: 'R' }),
        states: {
          a: { always: { target: 'b' } },
          b: { on: { R: { target: 'c' } } },
          c: {}
        }
      });
      const steps = getInitialMicrosteps(machine);
      expect(trace(steps).map((s) => [s.value, s.events])).toEqual([
        ['a', []],
        ['b', ['']],
        ['c', ['R']]
      ]);
    });

    it('[runtime] discards a raise from a selection removed by conflict resolution', () => {
      const machine = createMachine({
        options: { maxIterations },
        id: 'm',
        initial: 'p',
        states: {
          p: {
            type: 'parallel',
            states: {
              r1: {
                initial: 'a',
                states: {
                  a: {
                    on: {
                      GO: (_, enq) => {
                        enq.raise({ type: 'FROM_R1' });
                        return { target: '#m.out' };
                      }
                    }
                  }
                }
              },
              r2: {
                initial: 'a',
                states: {
                  a: {
                    on: {
                      GO: (_, enq) => {
                        enq.raise({ type: 'FROM_R2' });
                        return { target: '#m.other' };
                      }
                    }
                  }
                }
              }
            }
          },
          out: {
            on: {
              FROM_R1: (_, enq) => enq(record, 'FROM_R1'),
              FROM_R2: (_, enq) => enq(record, 'FROM_R2')
            }
          },
          other: {}
        }
      });
      const [next, effects] = transition(
        machine,
        initialTransition(machine)[0],
        { type: 'GO' }
      );
      expect(next.value).toBe('out');
      expect(labels(effects)).toEqual(['FROM_R1']);
    });
  });

  describe('eventless transition selection', () => {
    it('[runtime][v5] takes an effect-only eventless callback once per processed event', () => {
      const machine = createMachine({
        options: { maxIterations },
        initial: 'a',
        states: {
          a: {
            always: (_, enq) => {
              enq(record, 'always');
            },
            on: { GO: (_, enq) => enq.raise({ type: 'R' }) }
          }
        }
      });
      const [initial, initialEffects] = initialTransition(machine);
      const [, effects] = transition(machine, initial, { type: 'GO' });
      expect(labels(initialEffects)).toEqual(['always']);
      // [differs] SCXML would select this enabled targetless transition again forever.
      expect(labels(effects)).toEqual(['always', 'always']);
    });

    it('[runtime] reselects a context-only eventless callback until it declines', () => {
      const machine = createMachine({
        options: { maxIterations },
        context: { n: 0 },
        initial: 'a',
        states: {
          a: {
            always: ({ context }) =>
              context.n < 3 ? { context: { n: context.n + 1 } } : undefined
          }
        }
      });
      const steps = getInitialMicrosteps(machine);
      expect(steps.map(([s]) => s.context.n)).toEqual([0, 1, 2, 3]);
    });

    it.each([false, true])(
      '[runtime] does not loop on a self-targeted eventless transition (reenter: %s)',
      (reenter) => {
        const machine = createMachine({
          options: { maxIterations },
          initial: 'a',
          states: { a: { always: { target: 'a', reenter } } }
        });
        expect(getInitialMicrosteps(machine)).toHaveLength(2);
      }
    );

    it('[runtime] emits done events as xstate.done.state with stateId and output', () => {
      const seen: unknown[] = [];
      const machine = createMachine({
        options: { maxIterations },
        initial: 'p',
        states: {
          p: {
            initial: 'f',
            states: { f: { type: 'final', output: () => 'out' } },
            onDone: ({ event }) => {
              seen.push(event);
              return undefined;
            }
          }
        }
      });
      initialTransition(machine);
      expect(seen).toEqual([
        { type: 'xstate.done.state', stateId: 'p', output: 'out' }
      ]);
    });

    it('[runtime][v5] selects eventless transitions per atomic state but events region-first', () => {
      const machine = createMachine({
        options: { maxIterations },
        context: { log: '' },
        initial: 'p',
        states: {
          p: {
            type: 'parallel',
            always: ({ context }) =>
              context.log === '' ? { context: { log: 'P' } } : undefined,
            on: { EV: () => ({ context: { log: 'P' } }) },
            states: {
              r1: { initial: 'a', states: { a: {} } },
              r2: {
                initial: 'b',
                states: {
                  b: {
                    always: ({ context }) =>
                      context.log === ''
                        ? { context: { log: 'B' } }
                        : undefined,
                    on: { EV: () => ({ context: { log: 'b' } }) }
                  }
                }
              }
            }
          }
        }
      });
      const steps = getInitialMicrosteps(machine);
      // p's eventless transition is selected for r1 even though r2 selects
      // its own. Both patches are computed from pre-step context and the later
      // one in document order wins.
      expect(steps.map(([s]) => s.context.log)).toEqual(['', 'B']);
      const [, , ts] = steps[1];
      expect(ts.map((t) => t.source.key)).toEqual(['p', 'b']);

      const reset = machine.resolveState({
        value: { p: { r1: 'a', r2: 'b' } },
        context: { log: 'x' }
      });
      const [, , eventTransitions] = getMicrosteps(machine, reset, {
        type: 'EV'
      })[0];
      expect(eventTransitions.map((t) => t.source.key)).toEqual(['b']);
    });
  });

  describe('completion', () => {
    it('[SCXML][v5] raises done.state after the final state entry raises', () => {
      const machine = createMachine({
        options: { maxIterations },
        initial: 'p',
        states: {
          p: {
            initial: 'a',
            states: {
              a: {
                on: {
                  GO: (_, enq) => {
                    enq.raise({ type: 'T' });
                    return { target: 'f' };
                  }
                }
              },
              f: {
                type: 'final',
                entry: (_, enq) => enq.raise({ type: 'E' })
              }
            },
            on: {
              T: (_, enq) => enq(record, 'T'),
              E: (_, enq) => enq(record, 'E')
            },
            onDone: (_, enq) => {
              enq(record, 'done');
              return { target: 'q' };
            }
          },
          q: {}
        }
      });
      const [next, effects] = transition(
        machine,
        initialTransition(machine)[0],
        { type: 'GO' }
      );
      expect(labels(effects)).toEqual(['T', 'E', 'done']);
      expect(next.value).toBe('q');
    });

    it('[SCXML] completes a parallel node once, only when every region is final', () => {
      const machine = createMachine({
        options: { maxIterations },
        initial: 'p',
        states: {
          p: {
            type: 'parallel',
            states: {
              r1: {
                initial: 'a',
                states: {
                  a: { on: { ONE: { target: 'f' } } },
                  f: { type: 'final', output: () => 1 }
                },
                onDone: (_, enq) => enq(record, 'r1 done')
              },
              r2: {
                initial: 'a',
                states: {
                  a: { on: { TWO: { target: 'f' } } },
                  f: { type: 'final', output: () => 2 }
                },
                onDone: (_, enq) => enq(record, 'r2 done')
              }
            },
            onDone: ({ event }, enq) => {
              enq(record, `p done ${JSON.stringify(event.output)}`);
            }
          }
        }
      });
      const [initial] = initialTransition(machine);
      const [afterOne, oneEffects] = transition(machine, initial, {
        type: 'ONE'
      });
      expect(labels(oneEffects)).toEqual(['r1 done']);
      const [, twoEffects] = transition(machine, afterOne, { type: 'TWO' });
      expect(labels(twoEffects)).toEqual(['r2 done', 'p done {"r1":1,"r2":2}']);
    });

    it('[runtime] propagates nested final output through onDone events', () => {
      const machine = createMachine({
        options: { maxIterations },
        initial: 'outer',
        states: {
          outer: {
            initial: 'inner',
            states: {
              inner: {
                initial: 'x',
                states: { x: { type: 'final', output: () => ({ from: 'x' }) } },
                onDone: ({ event }: any) => ({
                  target: 'end',
                  context: { got: event.output }
                })
              },
              end: {
                type: 'final',
                output: ({ context }: any) => ({ wrapped: context.got })
              }
            },
            onDone: ({ event }: any) => ({
              target: 'root',
              context: { got: event.output }
            })
          },
          root: { type: 'final', output: ({ context }: any) => context.got }
        }
      } as any);
      const [snapshot] = initialTransition(machine);
      expect(snapshot.status).toBe('done');
      expect(snapshot.output).toEqual({ wrapped: { from: 'x' } });
    });

    it('[SCXML][v5] discards queued raises when the machine reaches a root final state', () => {
      const machine = createMachine({
        options: { maxIterations },
        initial: 'a',
        states: {
          a: {
            on: {
              GO: (_, enq) => {
                enq.raise({ type: 'LATE' });
                return { target: 'f' };
              }
            }
          },
          f: { type: 'final' }
        },
        on: { LATE: (_, enq) => enq(record, 'LATE') }
      });
      const steps = getMicrosteps(machine, initialTransition(machine)[0], {
        type: 'GO'
      });
      expect(steps).toHaveLength(1);
      expect(steps[0][0].status).toBe('done');
      expect(labels(steps[0][1])).toEqual([]);
    });

    it('[runtime] computes root output before exit functions change context at completion', () => {
      const machine = createMachine({
        options: { maxIterations },
        context: { n: 0 },
        initial: 'a',
        exit: ({ context }) => ({ context: { n: context.n + 100 } }),
        states: {
          a: { on: { GO: { target: 'f' } } },
          f: {
            type: 'final',
            entry: () => ({ context: { n: 1 } }),
            exit: ({ context }, enq) => {
              enq.raise({ type: 'LATE' });
              return { context: { n: context.n + 10 } };
            },
            output: ({ context }) => context.n
          }
        },
        on: { LATE: (_, enq) => enq(record, 'LATE') }
      });
      const [done, effects] = transition(
        machine,
        initialTransition(machine)[0],
        { type: 'GO' }
      );
      expect(done.output).toBe(1);
      expect(done.context).toEqual({ n: 111 });
      expect(labels(effects)).toEqual([]);
    });

    it('[runtime] becomes done during initialization and drops initialization raises', () => {
      const machine = createMachine({
        options: { maxIterations },
        initial: 'f',
        entry: (_, enq) => enq.raise({ type: 'R' }),
        states: { f: { type: 'final' } },
        on: { R: (_, enq) => enq(record, 'R') }
      });
      const [snapshot, effects] = initialTransition(machine);
      expect(snapshot.status).toBe('done');
      expect(labels(effects)).toEqual([]);
    });

    it('[SCXML] ignores events after completion and returns the same snapshot', () => {
      const machine = createMachine({
        options: { maxIterations },
        initial: 'f',
        states: { f: { type: 'final' } },
        on: { GO: (_, enq) => enq(record, 'GO') }
      });
      const [done] = initialTransition(machine);
      const steps = getMicrosteps(machine, done, { type: 'GO' });
      expect(steps).toHaveLength(1);
      expect(steps[0][0]).toBe(done);
      expect(steps[0][1]).toEqual([]);
      expect(transition(machine, done, { type: 'GO' })[0]).toBe(done);
    });

    it('[runtime][differs] forwards a compound root final output but not a parallel root aggregate', () => {
      const compound = createMachine({
        options: { maxIterations },
        initial: 'f',
        states: { f: { type: 'final', output: () => 'fo' } }
      });
      expect(initialTransition(compound)[0].output).toBe('fo');
      const parallel = createMachine({
        options: { maxIterations },
        type: 'parallel',
        states: {
          r1: {
            initial: 'f',
            states: { f: { type: 'final', output: () => 1 } }
          },
          r2: {
            initial: 'f',
            states: { f: { type: 'final', output: () => 2 } }
          }
        }
      });
      const [snapshot] = initialTransition(parallel);
      expect(snapshot.status).toBe('done');
      expect(snapshot.output).toBeUndefined();
    });
  });

  describe('snapshot identity', () => {
    it('[runtime] keeps the snapshot object across internal no-op microsteps', () => {
      const machine = createMachine({
        options: { maxIterations },
        initial: 'a',
        states: {
          a: {
            always: (_, enq) => {
              enq(record, 'always');
            },
            on: {
              GO: (_, enq) => {
                enq.raise({ type: 'R' });
                return { target: 'b' };
              }
            }
          },
          b: { on: { R: (_, enq) => enq(record, 'R') } }
        }
      });
      const steps = getMicrosteps(machine, initialTransition(machine)[0], {
        type: 'GO'
      });
      expect(steps).toHaveLength(2);
      expect(steps[1][0]).toBe(steps[0][0]);
    });

    it('[runtime] loops on an eventless callback that returns an empty context patch', () => {
      const machine = createMachine({
        options: { maxIterations: 20 },
        initial: 'a',
        states: { a: { always: () => ({ context: {} }) } }
      });
      expect(() => getInitialMicrosteps(machine)).toThrow(
        expect.objectContaining({ name: 'InfiniteTransitionError' })
      );
    });
  });
});
