import { compareCompoundTrace } from './compoundAdapter';

describe('compound machine model', () => {
  it('initializes descendants and selects the deepest enabled handler', () => {
    const trace = compareCompoundTrace(
      {
        id: 'm',
        context: {},
        initial: 'p',
        states: {
          p: {
            initial: 'a',
            on: { event: { target: 'q' } },
            states: {
              a: { on: { event: { target: 'b' } } },
              b: {}
            }
          },
          q: {}
        }
      },
      [{ type: 'event' }, { type: 'event' }]
    );
    expect(trace.map((step) => step.value)).toEqual([
      { p: 'a' },
      { p: 'b' },
      'q'
    ]);
  });

  it.each([false, true])(
    'compound self-target with non-initial child, reenter=%s',
    (reenter) => {
      const record = vi.fn();
      const trace = compareCompoundTrace(
        {
          id: 'm',
          context: {},
          initial: 'p',
          states: {
            p: {
              initial: 'a',
              entry: (_, enq) => {
                enq(record, 'enter p');
              },
              exit: (_, enq) => {
                enq(record, 'exit p');
              },
              on: { reset: { target: 'p', reenter }, internal: { reenter } },
              states: {
                a: {
                  entry: (_, enq) => {
                    enq(record, 'enter a');
                  },
                  on: { next: { target: 'b' } }
                },
                b: {
                  exit: (_, enq) => {
                    enq(record, 'exit b');
                  }
                }
              }
            }
          }
        },
        [{ type: 'next' }, { type: 'reset' }, { type: 'internal' }]
      );
      expect(trace[1].value).toEqual({ p: 'b' });
      expect(trace[2].value).toEqual({ p: 'a' });
      expect(trace[2].effects.map((effect) => effect.args)).toEqual(
        reenter
          ? [['exit b'], ['exit p'], ['enter p'], ['enter a']]
          : [['exit b'], ['enter a']]
      );
      expect(record).not.toHaveBeenCalled();
    }
  );

  it.each(['block', 'decline', 'effect'] as const)(
    'child %s controls ancestor fallback',
    (kind) => {
      const record = vi.fn();
      const trace = compareCompoundTrace(
        {
          id: 'm',
          initial: 'p',
          context: {},
          on: { event: { target: '.q' } },
          states: {
            p: {
              initial: 'nested',
              states: {
                nested: {
                  initial: 'a',
                  states: {
                    a: {
                      on: {
                        event:
                          kind === 'block'
                            ? undefined
                            : (_, enq) => {
                                if (kind === 'effect') enq(record, 'handled');
                              }
                      }
                    }
                  }
                }
              }
            },
            q: {}
          }
        },
        [{ type: 'event' }]
      );
      expect(trace[1].value).toEqual(
        kind === 'decline' ? 'q' : { p: { nested: 'a' } }
      );
    }
  );

  it('uses exact ID targets and relative child paths while preserving unaffected ancestors', () => {
    const trace = compareCompoundTrace(
      {
        id: 'm',
        initial: 'p',
        context: { count: 0 },
        states: {
          p: {
            initial: 'a',
            on: { relative: { target: '.b' }, ancestor: { target: '#p' } },
            id: 'p',
            states: {
              a: { on: { id: { target: '#custom' } } },
              b: { id: 'custom' }
            }
          }
        }
      },
      [{ type: 'relative' }, { type: 'ancestor' }, { type: 'id' }]
    );
    expect(trace.map((step) => step.value)).toEqual([
      { p: 'a' },
      { p: 'b' },
      { p: 'a' },
      { p: 'b' }
    ]);
  });

  it('orders multiple exits and entries around a pre-exit transition calculation', () => {
    const record = vi.fn();
    const trace = compareCompoundTrace(
      {
        id: 'm',
        context: { count: 0 },
        initial: 'p',
        entry: ({ context }, enq) => {
          enq(record, 'root', context.count);
          return { context: { count: 1 } };
        },
        states: {
          p: {
            initial: 'a',
            exit: ({ context }, enq) => {
              enq(record, 'p.exit', context.count);
              return { context: { count: Number(context.count) + 10 } };
            },
            states: {
              a: {
                exit: ({ context }, enq) => {
                  enq(record, 'a.exit', context.count);
                  return { context: { count: Number(context.count) + 1 } };
                },
                on: {
                  go: ({ context }, enq) => {
                    enq(record, 'go', context.count);
                    return { target: '#q', context: { count: 100 } };
                  }
                }
              }
            }
          },
          q: {
            id: 'q',
            initial: 'b',
            entry: ({ context }, enq) => {
              enq(record, 'q.entry', context.count);
              return { context: { count: 1000 } };
            },
            states: {
              b: {
                entry: ({ context }, enq) => {
                  enq(record, 'b.entry', context.count);
                }
              }
            }
          }
        }
      },
      [{ type: 'go' }]
    );
    expect(trace[1].effects.map((effect) => effect.args)).toEqual([
      ['a.exit', 1],
      ['p.exit', 2],
      ['go', 1],
      ['q.entry', 100],
      ['b.entry', 1000]
    ]);
    expect(trace[1].context).toEqual({ count: 1000 });
  });

  it('records a descendant target of the root entering root without exiting it', () => {
    const record = vi.fn();
    const trace = compareCompoundTrace(
      {
        id: 'm',
        context: {},
        initial: 'a',
        entry: (_, enq) => {
          enq(record, 'enter root');
        },
        exit: (_, enq) => {
          enq(record, 'exit root');
        },
        states: {
          a: {
            entry: (_, enq) => {
              enq(record, 'enter a');
            },
            exit: (_, enq) => {
              enq(record, 'exit a');
            },
            on: { event: { target: '#m' } }
          }
        }
      },
      [{ type: 'event' }]
    );
    expect(trace[1].effects.map((effect) => effect.args)).toEqual([
      ['exit a'],
      ['enter root'],
      ['enter a']
    ]);
  });
});
