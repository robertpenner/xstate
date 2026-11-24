// Cycle and bound-counting probes for robertpenner/xstate#24. Every machine
// sets maxIterations. A regression that removed the bound would hang inside a
// synchronous loop where vitest timeouts cannot fire, so run this file through
// `pnpm test:machine-model:sync-probes`, which kills the process at a deadline.
import {
  AnyStateMachine,
  createActor,
  createMachine,
  getMicrosteps,
  initialTransition,
  transition
} from '../../src';

const record = (..._args: unknown[]) => {};

function infinite(maxIterations: number, states: string[]) {
  return expect.objectContaining({
    name: 'InfiniteTransitionError',
    maxIterations,
    states
  });
}

// Returns the smallest maxIterations for which `act` does not throw
// InfiniteTransitionError. The loop checks the bound before it looks for each
// further microstep, counting the external or initial microstep as the first.
// A macrostep that ends active therefore needs a bound equal to its microstep
// count; one that ends done skips the final check and needs one less.
function smallestBound(
  make: (maxIterations: number) => AnyStateMachine,
  act: (machine: AnyStateMachine) => unknown
): number {
  for (let bound = 0; bound <= 20; bound++) {
    try {
      act(make(bound));
      return bound;
    } catch (error: any) {
      if (error?.name !== 'InfiniteTransitionError') throw error;
    }
  }
  throw new Error('no bound up to 20 succeeded');
}

describe('synchronous processing cycles (#24)', () => {
  it('stops an eventless cycle at the bound', () => {
    const machine = createMachine({
      options: { maxIterations: 10 },
      initial: 'idle',
      states: {
        idle: { on: { GO: { target: 'a' } } },
        a: { always: { target: 'b' } },
        b: { always: { target: 'a' } }
      }
    });
    expect(() =>
      transition(machine, initialTransition(machine)[0], { type: 'GO' })
    ).toThrow(infinite(10, ['b', 'a', 'b', 'a', 'b']));
  });

  it('stops a raised-event cycle at the bound', () => {
    const machine = createMachine({
      options: { maxIterations: 10 },
      initial: 'a',
      states: { a: { on: { GO: (_, enq) => enq.raise({ type: 'GO' }) } } }
    });
    expect(() =>
      transition(machine, initialTransition(machine)[0], { type: 'GO' })
    ).toThrow(expect.objectContaining({ name: 'InfiniteTransitionError' }));
  });

  it('stops a cycle that alternates an eventless transition and a raised event', () => {
    const machine = createMachine({
      options: { maxIterations: 9 },
      initial: 'idle',
      states: {
        idle: { on: { GO: { target: 'a' } } },
        a: {
          entry: (_, enq) => enq.raise({ type: 'R' }),
          always: { target: 'b' }
        },
        b: { on: { R: { target: 'a' } } }
      }
    });
    expect(() =>
      transition(machine, initialTransition(machine)[0], { type: 'GO' })
    ).toThrow(infinite(9, ['a', 'b', 'a', 'b', 'a']));
  });

  it('stops an eventless callback that only raises', () => {
    const machine = createMachine({
      options: { maxIterations: 10 },
      initial: 'a',
      states: { a: { always: (_, enq) => enq.raise({ type: 'R' }) } }
    });
    expect(() => initialTransition(machine)).toThrow(
      expect.objectContaining({ name: 'InfiniteTransitionError' })
    );
  });

  it('reports the bound as an actor error instead of throwing from send', () => {
    const actor = createActor(
      createMachine({
        options: { maxIterations: 10 },
        initial: 'a',
        states: { a: { on: { GO: (_, enq) => enq.raise({ type: 'GO' }) } } }
      })
    );
    const errors: string[] = [];
    actor.subscribe({ error: (error: any) => errors.push(error.name) });
    actor.start();
    actor.send({ type: 'GO' });
    expect(actor.getSnapshot().status).toBe('error');
    expect(errors).toEqual(['InfiniteTransitionError']);
  });

  describe('smallest maxIterations that succeeds', () => {
    // idle -GO-> s0 -always-> s1 ... -always-> sK. The extra `marker` state
    // keeps an eventless transition in the machine when K is 0, so the
    // fast path for machines without eventless transitions does not apply.
    // createMachine cannot infer a config whose state keys are generated, so
    // the config is widened to the parameter type.
    const chain = (k: number) => (maxIterations: number) =>
      createMachine(<Parameters<typeof createMachine>[0]>{
        options: { maxIterations },
        initial: 'idle',
        states: {
          idle: {
            on: {
              GO: { target: 's0' },
              NOOP: (_, enq) => enq(record, 'noop'),
              RAISE2: (_, enq) => {
                enq.raise({ type: 'U1' });
                enq.raise({ type: 'U2' });
              },
              FIN: { target: 'f' }
            }
          },
          ...Object.fromEntries(
            Array.from({ length: k + 1 }, (_, i) => [
              `s${i}`,
              i < k ? { always: { target: `s${i + 1}` } } : {}
            ])
          ),
          marker: { always: { target: 'idle' } },
          f: { type: 'final' }
        }
      });
    const fromIdle = (event: string) => (machine: AnyStateMachine) =>
      getMicrosteps(
        machine,
        machine.resolveState({ value: 'idle', context: {} }),
        { type: event }
      );

    it('skips the bound in transition() when its flat-machine fast path applies', () => {
      // StateMachine._transitionFast handles a single static transition
      // between root-level atomic states that have no eventless transitions
      // of their own, and never enters the counting loop. The `marker`
      // state's `always` does not disable it.
      const viaTransition = (machine: AnyStateMachine) =>
        transition(
          machine,
          machine.resolveState({ value: 'idle', context: {} }),
          { type: 'GO' }
        );
      expect(smallestBound(chain(0), viaTransition)).toBe(0);
      expect(smallestBound(chain(0), fromIdle('GO'))).toBe(1);
    });

    it.each([
      [0, 1],
      [1, 2],
      [2, 3],
      [4, 5]
    ])(
      'counts the event microstep: an event plus K eventless microsteps needs K + 1 (K = %i)',
      (k, bound) => {
        expect(smallestBound(chain(k), fromIdle('GO'))).toBe(bound);
      }
    );

    it('needs 1 for a single handled or unhandled event microstep', () => {
      expect(smallestBound(chain(2), fromIdle('NOOP'))).toBe(1);
      expect(smallestBound(chain(2), fromIdle('NOPE'))).toBe(1);
    });

    it('needs 3 for an event microstep plus two unhandled raised-event microsteps', () => {
      expect(smallestBound(chain(2), fromIdle('RAISE2'))).toBe(3);
    });

    it('needs one less when the macrostep ends done: a single microstep to a root final state needs 0', () => {
      expect(smallestBound(chain(2), fromIdle('FIN'))).toBe(0);
    });

    it('needs 0 when the macrostep fast path applies (no eventless transitions, empty queue)', () => {
      const machine = (maxIterations: number) =>
        createMachine({
          options: { maxIterations },
          initial: 'a',
          states: { a: { on: { GO: { target: 'b' } } }, b: {} }
        });
      expect(
        smallestBound(machine, (m) =>
          getMicrosteps(m, initialTransition(m)[0], { type: 'GO' })
        )
      ).toBe(0);
    });

    it('needs 2 for the initial microstep plus one effect-only eventless microstep', () => {
      const machine = (maxIterations: number) =>
        createMachine({
          options: { maxIterations },
          initial: 'a',
          states: {
            a: {
              always: (_, enq) => {
                enq(record, 'always');
              }
            }
          }
        });
      expect(smallestBound(machine, (m) => initialTransition(m))).toBe(2);
    });
  });
});
