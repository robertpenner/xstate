import { createMachine, initialTransition, transition } from '../../src';

describe('recorded runtime findings at da64b0a', () => {
  it('targeting the root from a descendant enters root without exiting it', () => {
    const record = vi.fn();
    const machine = createMachine({
      id: 'root',
      initial: 'a',
      entry: (_, enq) => {
        enq(record, 'root entry');
      },
      exit: (_, enq) => {
        enq(record, 'root exit');
      },
      states: { a: { on: { event: { target: '#root' } } } }
    });
    const [initial] = initialTransition(machine);
    const [, effects] = transition(machine, initial, { type: 'event' });
    expect(
      effects.map((effect) => ('args' in effect ? effect.args : undefined))
    ).toEqual([['root entry']]);
  });

  it('targetless reenter runs entry without exit (suspected bug)', () => {
    const record = vi.fn();
    const machine = createMachine({
      initial: 'a',
      states: {
        a: {
          entry: (_, enq) => {
            enq(record, 'enter');
          },
          exit: (_, enq) => {
            enq(record, 'exit');
          },
          on: { event: { reenter: true } }
        }
      }
    });
    const [initial] = initialTransition(machine);
    const [next, effects] = transition(machine, initial, { type: 'event' });
    expect(next.value).toBe('a');
    expect(
      effects.map((effect) => ('args' in effect ? effect.args : undefined))
    ).toEqual([['enter']]);
    expect(record).not.toHaveBeenCalled();
  });

  it('cross-region transition and an exit from the parallel node are both taken (suspected bug, statelyai/xstate#5895)', () => {
    const record = vi.fn();
    const log = (name: string) => ({
      entry: (_: unknown, enq: (fn: typeof record, arg: string) => void) => {
        enq(record, `enter ${name}`);
      },
      exit: (_: unknown, enq: (fn: typeof record, arg: string) => void) => {
        enq(record, `exit ${name}`);
      }
    });
    const machine = createMachine({
      id: 'm',
      initial: 'P',
      states: {
        P: {
          ...log('P'),
          type: 'parallel',
          states: {
            A: {
              ...log('A'),
              initial: 'a1',
              states: {
                a1: { ...log('a1'), on: { E: { target: '#m.P.B' } } },
                a2: {}
              }
            },
            B: { ...log('B'), on: { E: { target: '#m.X' } } }
          }
        },
        X: log('X')
      }
    });
    const [initial] = initialTransition(machine);
    const [next, effects] = transition(machine, initial, { type: 'E' });
    expect(
      effects.map((effect) => ('args' in effect ? effect.args[0] : undefined))
    ).toEqual(['exit B', 'exit a1', 'exit A', 'exit P', 'enter B', 'enter X']);
    expect(next.value).toBe('X');
    expect(next.nodes.map((node) => node.id)).toEqual(['m', 'm.P.B', 'm.X']);
  });

  it('targetless reentry beside a parallel-node reentry leaves a leaf without its region (suspected bug)', () => {
    const record = vi.fn();
    const machine = createMachine({
      id: 'm',
      initial: 'P',
      states: {
        P: {
          type: 'parallel',
          states: {
            A: {
              initial: 'a1',
              states: { a1: { on: { E: { reenter: true } } }, a2: {} }
            },
            B: { on: { E: { target: '#m.P', reenter: true } } }
          }
        }
      }
    });
    const [initial] = initialTransition(machine);
    const [next] = transition(machine, initial, { type: 'E' });
    expect(next.nodes.map((node) => node.id)).toEqual([
      'm',
      'm.P',
      'm.P.A.a1',
      'm.P.B'
    ]);
    expect(record).not.toHaveBeenCalled();
  });
});
