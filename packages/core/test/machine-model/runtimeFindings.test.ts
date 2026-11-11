import { createMachine, initialTransition, transition } from '../../src';

describe('recorded runtime findings at bcd3840', () => {
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
});
