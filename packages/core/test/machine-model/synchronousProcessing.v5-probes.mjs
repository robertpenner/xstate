// Comparison probes against xstate@5.33.4 for robertpenner/xstate#24. This
// file is not part of the test suite and xstate v5 is not a repo dependency.
// To reproduce, copy it into an empty directory, then run:
//   npm install xstate@5.33.4 && node synchronousProcessing.v5-probes.mjs
// Results are recorded in SYNCHRONOUS_PROCESSING.md.
import {
  createMachine,
  createActor,
  assign,
  raise,
  initialTransition,
  transition
} from 'xstate';
const log = [];
const L = (s) => () => log.push(s);
const out = {};
const run = (n, f) => {
  log.length = 0;
  try {
    const r = f();
    out[n] = { r, log: [...log] };
  } catch (e) {
    out[n] = { threw: e.message.slice(0, 60), log: [...log] };
  }
};
const settle = (m, ev) => {
  const a = createActor(m);
  let err;
  a.subscribe({ error: (e) => (err = e.message.slice(0, 50)) });
  a.start();
  for (const e of ev) a.send(e);
  const s = a.getSnapshot();
  return {
    value: s.value,
    status: s.status,
    output: s.output,
    context: s.context,
    err
  };
};

// V1 eventless before raised; event seen by always guard
run('V1', () =>
  settle(
    createMachine({
      initial: 'idle',
      states: {
        idle: { on: { GO: { target: 'x', actions: raise({ type: 'R' }) } } },
        x: {
          always: {
            target: 'y',
            actions: ({ event }) => log.push('x-always-sees:' + event.type)
          }
        },
        y: { on: { R: 'z' } },
        z: {}
      }
    }),
    [{ type: 'GO' }]
  )
);
// V2 FIFO
run('V2', () =>
  settle(
    createMachine({
      initial: 'a',
      states: {
        a: {
          exit: raise({ type: 'R0' }),
          on: {
            GO: {
              target: 'b',
              actions: [raise({ type: 'R1' }), raise({ type: 'R2' })]
            }
          }
        },
        b: {
          entry: raise({ type: 'R3' }),
          on: {
            R0: { actions: L('R0') },
            R1: { actions: [L('R1'), raise({ type: 'R4' })] },
            R2: { actions: L('R2') },
            R3: { actions: L('R3') },
            R4: { actions: L('R4') }
          }
        }
      }
    }),
    [{ type: 'GO' }]
  )
);
// V3 effect-only always runs once per processed event
run('V3', () =>
  settle(
    createMachine({
      options: { maxIterations: 20 },
      initial: 'a',
      states: {
        a: {
          always: { actions: L('eff') },
          on: { GO: { actions: raise({ type: 'U' }) } }
        }
      }
    }),
    [{ type: 'GO' }]
  )
);
// V4 raise-only always loops
run('V4', () =>
  settle(
    createMachine({
      options: { maxIterations: 20 },
      initial: 'a',
      states: { a: { always: { actions: raise({ type: 'R' }) } } }
    }),
    []
  )
);
// V5 parallel eventless ancestor selection vs event region-first
run('V5', () =>
  settle(
    createMachine({
      initial: 'par',
      context: { log: '' },
      states: {
        par: {
          type: 'parallel',
          always: {
            guard: ({ context }) => !context.log.includes('P'),
            actions: assign({ log: ({ context }) => context.log + 'P' })
          },
          on: {
            EV: { actions: assign({ log: ({ context }) => context.log + 'p' }) }
          },
          states: {
            r1: { initial: 'a', states: { a: {} } },
            r2: {
              initial: 'a',
              states: {
                a: {
                  always: {
                    guard: ({ context }) => !context.log.includes('B'),
                    actions: assign({ log: ({ context }) => context.log + 'B' })
                  },
                  on: {
                    EV: {
                      actions: assign({
                        log: ({ context }) => context.log + 'b'
                      })
                    }
                  }
                }
              }
            }
          }
        }
      }
    }),
    [{ type: 'EV' }]
  )
);
// V6 root parallel output with no root output; compound root final output
run('V6par', () =>
  settle(
    createMachine({
      type: 'parallel',
      states: {
        r1: {
          initial: 'a',
          states: {
            a: { on: { GO: 'f' } },
            f: { type: 'final', output: () => 1 }
          }
        },
        r2: { initial: 'f', states: { f: { type: 'final', output: () => 2 } } }
      }
    }),
    [{ type: 'GO' }]
  )
);
run('V6cmp', () =>
  settle(
    createMachine({
      initial: 'a',
      states: {
        a: { on: { GO: 'f' } },
        f: { type: 'final', output: () => 'fo' }
      }
    }),
    [{ type: 'GO' }]
  )
);
// V7 done ordering
run('V7', () =>
  settle(
    createMachine({
      initial: 'p',
      states: {
        p: {
          initial: 'a',
          onDone: {
            target: 'after',
            actions: ({ event }) =>
              log.push('onDone:' + JSON.stringify(event.output))
          },
          on: { R: { actions: L('R') }, E: { actions: L('E') } },
          states: {
            a: { on: { GO: { target: 'f', actions: raise({ type: 'R' }) } } },
            f: {
              type: 'final',
              entry: raise({ type: 'E' }),
              output: () => ({ v: 1 })
            }
          }
        },
        after: {}
      }
    }),
    [{ type: 'GO' }]
  )
);
// V8 counting: min maxIterations for k-chain after GO, and for NOOP
const chain = (k, max) =>
  createMachine({
    options: { maxIterations: max },
    initial: 'idle',
    states: {
      idle: { on: { GO: 's0', NOOP: { actions: L('n') } } },
      ...Object.fromEntries(
        Array.from({ length: k + 1 }, (_, i) => [
          `s${i}`,
          i < k ? { always: `s${i + 1}` } : {}
        ])
      )
    }
  });
const minB = (mk, act) => {
  for (let n = 0; n < 12; n++) {
    try {
      act(mk(n));
      return n;
    } catch (e) {
      if (!/Infinite loop/.test(e.message)) throw e;
    }
  }
};
const at = (m) => m.resolveState({ value: 'idle', context: {} });
for (const k of [0, 2, 4])
  run('V8-GO-k' + k, () =>
    minB(
      (n) => chain(k, n),
      (m) => transition(m, at(m), { type: 'GO' })
    )
  );
run('V8-NOOP-k0', () =>
  minB(
    (n) => chain(0, n),
    (m) => transition(m, at(m), { type: 'NOOP' })
  )
);
run('V8-init-k2', () =>
  minB(
    (n) => chain(2, n),
    (m) => initialTransition(m)
  )
);
// V9 root final discards queued raise
run('V9', () =>
  settle(
    createMachine({
      initial: 'a',
      on: { R: { actions: L('R') } },
      states: {
        a: { on: { GO: { target: 'f', actions: raise({ type: 'R' }) } } },
        f: { type: 'final' }
      }
    }),
    [{ type: 'GO' }, { type: 'R' }]
  )
);
// V10 root output computed before exit actions at completion
run('V10', () =>
  settle(
    createMachine({
      context: { n: 0 },
      initial: 'a',
      output: ({ context }) => context.n,
      exit: assign({ n: ({ context }) => context.n + 100 }),
      states: {
        a: { on: { GO: 'f' } },
        f: {
          type: 'final',
          exit: assign({ n: ({ context }) => context.n + 10 })
        }
      }
    }),
    [{ type: 'GO' }]
  )
);
console.log(JSON.stringify(out, null, 1));
