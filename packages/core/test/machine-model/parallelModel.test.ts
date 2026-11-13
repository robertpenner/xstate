import { compareParallelTrace, type Config } from './parallelAdapter';

const record = vi.fn();
type Logged = NonNullable<Config['states']>[string];
function logged(name: string, state: Logged = {}): Logged {
  return {
    ...state,
    entry: (_, enq) => {
      enq(record, `enter ${name}`);
    },
    exit: (_, enq) => {
      enq(record, `exit ${name}`);
    }
  };
}
const labels = (step: { effects: readonly { args: unknown[] }[] }) =>
  step.effects.map((effect) => effect.args[0]);

function lights(on: Logged['on'] = {}, regionOn: Logged['on'] = {}): Config {
  return {
    id: 'root',
    context: {},
    initial: 'p',
    states: {
      p: logged('p', {
        type: 'parallel',
        on,
        states: {
          a: logged('a', {
            initial: 'a1',
            on: regionOn,
            states: {
              a1: logged('a1', { on: { next: { target: 'a2' } } }),
              a2: logged('a2')
            }
          }),
          b: logged('b', {
            initial: 'b1',
            states: {
              b1: logged('b1', { on: { other: { target: 'b2' } } }),
              b2: logged('b2', { on: { back: { target: '#root.p.b.b1' } } })
            }
          })
        }
      }),
      off: logged('off')
    }
  };
}

describe('single parallel subtree model', () => {
  it('enters every region of a root-level parallel machine in document order', () => {
    const trace = compareParallelTrace(
      {
        id: 'root',
        type: 'parallel',
        context: {},
        states: {
          a: logged('a', {
            initial: 'a1',
            states: { a1: logged('a1') }
          }),
          b: logged('b')
        }
      },
      []
    );
    expect(trace[0].value).toEqual({ a: 'a1', b: {} });
    expect(labels(trace[0])).toEqual(['enter a', 'enter a1', 'enter b']);
  });

  it('enters a parallel node below compound ancestors and regions at different depths', () => {
    const trace = compareParallelTrace(
      {
        id: 'root',
        context: {},
        initial: 'outer',
        states: {
          outer: logged('outer', {
            initial: 'p',
            states: {
              p: logged('p', {
                type: 'parallel',
                states: {
                  shallow: logged('shallow'),
                  deep: logged('deep', {
                    initial: 'd1',
                    states: {
                      d1: logged('d1', {
                        initial: 'd2',
                        states: { d2: logged('d2') }
                      })
                    }
                  })
                }
              })
            }
          })
        }
      },
      []
    );
    expect(trace[0].value).toEqual({
      outer: { p: { shallow: {}, deep: { d1: 'd2' } } }
    });
    expect(labels(trace[0])).toEqual([
      'enter outer',
      'enter p',
      'enter shallow',
      'enter deep',
      'enter d1',
      'enter d2'
    ]);
  });

  it('lets an event declined in one region be handled in another', () => {
    const trace = compareParallelTrace(lights(), [
      { type: 'other' },
      { type: 'missing' }
    ]);
    expect(trace[1].value).toEqual({ p: { a: 'a1', b: 'b2' } });
    expect(labels(trace[1])).toEqual(['exit b1', 'enter b2']);
    expect(trace[2].snapshotReused).toBe(true);
  });

  it('narrows a cross-region transition to the target region', () => {
    const config = lights();
    config.states!.p.states!.a.states!.a2.on = {
      jump: { target: '#root.p.b.b2' }
    };
    const trace = compareParallelTrace(config, [
      { type: 'next' },
      { type: 'jump' }
    ]);
    expect(trace[2].value).toEqual({ p: { a: 'a2', b: 'b2' } });
    expect(labels(trace[2])).toEqual(['exit b1', 'enter b2']);
  });

  it('narrows to a region when the parallel node is the source', () => {
    const trace = compareParallelTrace(lights({ jump: { target: '.b.b2' } }), [
      { type: 'next' },
      { type: 'jump' }
    ]);
    expect(trace[2].value).toEqual({ p: { a: 'a2', b: 'b2' } });
    expect(labels(trace[2])).toEqual(['exit b1', 'enter b2']);
  });

  it('resets every region when a compound ancestor targets one region', () => {
    const config = lights();
    config.on = { jump: { target: '#root.p.b.b2' } };
    const trace = compareParallelTrace(config, [
      { type: 'next' },
      { type: 'jump' }
    ]);
    expect(trace[2].value).toEqual({ p: { a: 'a1', b: 'b2' } });
    expect(labels(trace[2])).toEqual([
      'exit b1',
      'exit b',
      'exit a2',
      'exit a',
      'exit p',
      'enter p',
      'enter a',
      'enter a1',
      'enter b',
      'enter b2'
    ]);
  });

  it('resets every region when a reentering compound ancestor targets one region', () => {
    const trace = compareParallelTrace(
      {
        id: 'root',
        context: {},
        initial: 'w',
        states: {
          w: logged('w', {
            initial: 'p',
            on: { jump: { target: '#root.w.p.b.b2', reenter: true } },
            states: {
              p: logged('p', {
                type: 'parallel',
                states: {
                  a: logged('a', {
                    initial: 'a1',
                    states: {
                      a1: logged('a1', { on: { next: { target: 'a2' } } }),
                      a2: logged('a2')
                    }
                  }),
                  b: logged('b', {
                    initial: 'b1',
                    states: { b1: logged('b1'), b2: logged('b2') }
                  })
                }
              })
            }
          })
        }
      },
      [{ type: 'next' }, { type: 'jump' }]
    );
    expect(trace[2].value).toEqual({ w: { p: { a: 'a1', b: 'b2' } } });
    expect(labels(trace[2])).toEqual([
      'exit b1',
      'exit b',
      'exit a2',
      'exit a',
      'exit p',
      'exit w',
      'enter w',
      'enter p',
      'enter a',
      'enter a1',
      'enter b',
      'enter b2'
    ]);
  });

  it('resets every region below the parallel node when it targets itself without reentry', () => {
    const trace = compareParallelTrace(
      lights({ jump: { target: '#root.p' } }),
      [{ type: 'next' }, { type: 'jump' }]
    );
    expect(trace[2].value).toEqual({ p: { a: 'a1', b: 'b1' } });
    expect(labels(trace[2])).toEqual([
      'exit b1',
      'exit b',
      'exit a2',
      'exit a',
      'enter a',
      'enter a1',
      'enter b',
      'enter b1'
    ]);
  });

  it('exits and reenters every region when the parallel node reenters itself', () => {
    const trace = compareParallelTrace(
      lights({ jump: { target: '#root.p', reenter: true } }),
      [{ type: 'next' }, { type: 'jump' }]
    );
    expect(trace[2].value).toEqual({ p: { a: 'a1', b: 'b1' } });
    expect(labels(trace[2])).toEqual([
      'exit b1',
      'exit b',
      'exit a2',
      'exit a',
      'exit p',
      'enter p',
      'enter a',
      'enter a1',
      'enter b',
      'enter b1'
    ]);
  });

  it('widens a reentering cross-region transition to every region but not the parallel node', () => {
    const config = lights();
    config.states!.p.states!.a.states!.a2.on = {
      jump: { target: '#root.p.b.b2', reenter: true }
    };
    const trace = compareParallelTrace(config, [
      { type: 'next' },
      { type: 'jump' }
    ]);
    expect(trace[2].value).toEqual({ p: { a: 'a1', b: 'b2' } });
    expect(labels(trace[2])).toEqual([
      'exit b1',
      'exit b',
      'exit a2',
      'exit a',
      'enter a',
      'enter a1',
      'enter b',
      'enter b2'
    ]);
  });

  it('reenters the parallel node itself when it is a reentering source', () => {
    const trace = compareParallelTrace(
      lights({ jump: { target: '.b.b2', reenter: true } }),
      [{ type: 'next' }, { type: 'jump' }]
    );
    expect(trace[2].value).toEqual({ p: { a: 'a1', b: 'b2' } });
    expect(labels(trace[2])).toEqual([
      'exit b1',
      'exit b',
      'exit a2',
      'exit a',
      'exit p',
      'enter p',
      'enter a',
      'enter a1',
      'enter b',
      'enter b2'
    ]);
  });

  it('enters the subtree from outside with a deep target and leaves it again', () => {
    const config = lights();
    config.initial = 'off';
    config.states!.off.on = { start: { target: '#root.p.b.b2' } };
    config.states!.p.on = { stop: { target: '#root.off' } };
    const trace = compareParallelTrace(config, [
      { type: 'start' },
      { type: 'stop' }
    ]);
    expect(trace.map((step) => step.value)).toEqual([
      'off',
      { p: { a: 'a1', b: 'b2' } },
      'off'
    ]);
    expect(labels(trace[1])).toEqual([
      'exit off',
      'enter p',
      'enter a',
      'enter a1',
      'enter b',
      'enter b2'
    ]);
    expect(labels(trace[2])).toEqual([
      'exit b2',
      'exit b',
      'exit a1',
      'exit a',
      'exit p',
      'enter off'
    ]);
  });

  it('falls back to the parallel node only when every region declines', () => {
    const trace = compareParallelTrace(
      lights({ next: { target: '#root.off' } }),
      [{ type: 'next' }, { type: 'next' }]
    );
    expect(trace[1].value).toEqual({ p: { a: 'a2', b: 'b1' } });
    expect(trace[2].value).toEqual('off');
  });

  it('applies targetless and region-level transitions with pre-step context', () => {
    const trace = compareParallelTrace(
      {
        ...lights(
          {},
          {
            bump: ({ context }) => ({
              context: { count: Number(context.count) + 1 }
            })
          }
        ),
        context: { count: 0 }
      },
      [{ type: 'bump' }, { type: 'bump' }]
    );
    expect(trace.map((step) => step.context)).toEqual([
      { count: 0 },
      { count: 1 },
      { count: 2 }
    ]);
    expect(trace[1].value).toEqual({ p: { a: 'a1', b: 'b1' } });
  });

  it('refuses nested or multiple parallel nodes and parallel initial before running', () => {
    expect(() =>
      compareParallelTrace(
        {
          context: {},
          type: 'parallel',
          states: {
            a: { type: 'parallel', states: { x: {}, y: {} } },
            b: {}
          }
        },
        []
      )
    ).toThrow(/Unsupported second parallel state/);
    expect(() =>
      compareParallelTrace(
        {
          context: {},
          initial: 'a',
          states: {
            a: { type: 'parallel', states: { x: {} } },
            b: { type: 'parallel', states: { y: {} } }
          }
        },
        []
      )
    ).toThrow(/Unsupported second parallel state/);
    expect(() =>
      compareParallelTrace(
        { context: {}, type: 'parallel', initial: 'a', states: { a: {} } },
        []
      )
    ).toThrow(/Unsupported parallel initial/);
  });

  it('refuses array targets before running', () => {
    expect(() =>
      compareParallelTrace(
        lights({ jump: { target: ['.a.a2', '.b.b2'] } as never }),
        []
      )
    ).toThrow(/Unsupported target/);
  });

  it('refuses a target of an already active region with or without reentry', () => {
    expect(() =>
      compareParallelTrace(lights({ jump: { target: '.b' } }), [
        { type: 'jump' }
      ])
    ).toThrow(/Unsupported step: jump \(active region target\)/);
    expect(() =>
      compareParallelTrace(lights({ jump: { target: '.b', reenter: true } }), [
        { type: 'jump' }
      ])
    ).toThrow(/Unsupported step: jump \(active region target\)/);
  });

  it('refuses the statelyai/xstate#5895 machine at its active-region target', () => {
    expect(() =>
      compareParallelTrace(
        {
          id: 'm',
          context: {},
          initial: 'P',
          states: {
            P: logged('P', {
              type: 'parallel',
              states: {
                A: logged('A', {
                  initial: 'a1',
                  states: {
                    a1: logged('a1', { on: { E: { target: '#m.P.B' } } }),
                    a2: logged('a2')
                  }
                }),
                B: logged('B', { on: { E: { target: '#m.X' } } })
              }
            }),
            X: logged('X')
          }
        },
        [{ type: 'E' }]
      )
    ).toThrow(/Unsupported step: E \(active region target\)/);
  });
});

type On = Logged['on'];
function regions(aOn: On, bOn: On, cOn: On = {}, pOn: On = {}): Config {
  return {
    id: 'm',
    context: { count: 0 },
    initial: 'p',
    states: {
      p: logged('p', {
        type: 'parallel',
        on: pOn,
        states: {
          a: logged('a', {
            initial: 'a1',
            states: { a1: logged('a1', { on: aOn }), a2: logged('a2') }
          }),
          b: logged('b', {
            initial: 'b1',
            states: { b1: logged('b1', { on: bOn }), b2: logged('b2') }
          }),
          c: logged('c', {
            initial: 'c1',
            states: { c1: logged('c1', { on: cOn }), c2: logged('c2') }
          })
        }
      }),
      off: logged('off')
    }
  };
}
const patch =
  (count: number, target?: string, reenter?: boolean) =>
  ({ context }: { context: Record<string, unknown> }) => ({
    ...(target === undefined ? {} : { target }),
    ...(reenter === undefined ? {} : { reenter }),
    context: { count: Number(context.count) * 10 + count }
  });

describe('multi-transition parallel steps', () => {
  it('takes independent region transitions together, exiting in reverse document order', () => {
    const trace = compareParallelTrace(
      regions({ go: { target: 'a2' } }, { go: { target: 'b2' } }),
      [{ type: 'go' }]
    );
    expect(trace[1].selections).toBe(2);
    expect(trace[1].value).toEqual({ p: { a: 'a2', b: 'b2', c: 'c1' } });
    expect(labels(trace[1])).toEqual([
      'exit b1',
      'exit a1',
      'enter a2',
      'enter b2'
    ]);
  });

  it('combines handled, declined and blocked regions', () => {
    const trace = compareParallelTrace(
      regions(
        { go: patch(1, 'a2') },
        { go: (): undefined => undefined },
        { go: undefined }
      ),
      [{ type: 'go' }]
    );
    expect(trace[1].selections).toBe(2);
    expect(trace[1].value).toEqual({ p: { a: 'a2', b: 'b1', c: 'c1' } });
    expect(trace[1].context).toEqual({ count: 1 });
  });

  it('runs every selected callback on the pre-step context and merges patches in region order', () => {
    const trace = compareParallelTrace(
      regions({ go: patch(1) }, { go: patch(2) }, { go: patch(3) }),
      [{ type: 'go' }, { type: 'go' }]
    );
    expect(trace[1].selections).toBe(3);
    expect(trace.map((step) => step.context)).toEqual([
      { count: 0 },
      { count: 3 },
      { count: 33 }
    ]);
  });

  it.each([
    [
      'cross-region first',
      { go: patch(1, '#m.p.b.b2') },
      { go: patch(2, 'b2') }
    ],
    ['local first', { go: patch(1, 'a2') }, { go: patch(2, '#m.p.a.a2') }]
  ] as const)(
    'keeps the earlier region when a cross-region transition overlaps a local one (%s)',
    (_, aOn, bOn) => {
      const trace = compareParallelTrace(regions(aOn, bOn), [{ type: 'go' }]);
      expect(trace[1].selections).toBe(2);
      expect(trace[1].context).toEqual({ count: 1 });
    }
  );

  it('keeps the earlier of two regions that both leave the parallel node', () => {
    const trace = compareParallelTrace(
      regions({ go: patch(1, '#m.off') }, { go: patch(2, '#m.off') }),
      [{ type: 'go' }]
    );
    expect(trace[1].value).toBe('off');
    expect(trace[1].context).toEqual({ count: 1 });
    expect(labels(trace[1])).toEqual([
      'exit c1',
      'exit c',
      'exit b1',
      'exit b',
      'exit a1',
      'exit a',
      'exit p',
      'enter off'
    ]);
  });

  it('keeps an atomic self-target result when another kept domain exits it', () => {
    const trace = compareParallelTrace(
      regions(
        {
          go: (_, enq) => {
            enq(record, 'self');
            return { target: '#m.p.a.a1', context: { count: 1 } };
          }
        },
        {
          go: (_, enq) => {
            enq(record, 'leave');
            return { target: '#m.off', context: { count: 2 } };
          }
        }
      ),
      [{ type: 'go' }]
    );
    expect(trace[1].selections).toBe(2);
    expect(trace[1].kept).toBe(2);
    expect(trace[1].nestedDomains).toBe(true);
    expect(trace[1].value).toBe('off');
    expect(trace[1].active).toEqual(['m', 'm.off']);
    expect(trace[1].context).toEqual({ count: 2 });
    expect(labels(trace[1])).toEqual([
      'exit c1',
      'exit c',
      'exit b1',
      'exit b',
      'exit a1',
      'exit a',
      'exit p',
      'self',
      'leave',
      'enter off'
    ]);
  });

  it('keeps a later atomic self-target result after the earlier region leaves', () => {
    const trace = compareParallelTrace(
      regions(
        {
          go: (_, enq) => {
            enq(record, 'leave');
            return { target: '#m.off', context: { count: 1 } };
          }
        },
        {
          go: (_, enq) => {
            enq(record, 'self');
            return { target: '#m.p.b.b1', context: { count: 2 } };
          }
        }
      ),
      [{ type: 'go' }]
    );
    expect(trace[1].kept).toBe(2);
    expect(trace[1].nestedDomains).toBe(true);
    expect(trace[1].active).toEqual(['m', 'm.off']);
    expect(trace[1].context).toEqual({ count: 2 });
    expect(labels(trace[1])).toEqual([
      'exit c1',
      'exit c',
      'exit b1',
      'exit b',
      'exit a1',
      'exit a',
      'exit p',
      'leave',
      'self',
      'enter off'
    ]);
  });

  it.each([
    [
      'local first',
      { go: patch(1, 'a2') },
      { go: patch(2, '#m.p', true) },
      { a: 'a2', b: 'b1', c: 'c1' }
    ],
    [
      'reentry first',
      { go: patch(1, '#m.p', true) },
      { go: patch(2, 'b2') },
      { a: 'a1', b: 'b1', c: 'c1' }
    ]
  ] as const)(
    'resolves a region transition against a reentry of the parallel node (%s)',
    (_, aOn, bOn, value) => {
      const trace = compareParallelTrace(regions(aOn, bOn), [{ type: 'go' }]);
      expect(trace[1].context).toEqual({ count: 1 });
      expect(trace[1].value).toEqual({ p: value });
    }
  );

  it('selects the parallel node once when every region declines', () => {
    const trace = compareParallelTrace(regions({}, {}, {}, { go: patch(1) }), [
      { type: 'go' }
    ]);
    expect(trace[1].selections).toBe(1);
    expect(trace[1].context).toEqual({ count: 1 });
  });

  it.each(['local', 'parallel reentry', 'leave'] as const)(
    'keeps targetless-reentry results beside a %s transition in both orders',
    (kind) => {
      for (const targetlessFirst of [true, false]) {
        const targetless: On = {
          go: ({ context }, enq) => {
            enq(record, 'targetless', context.count);
            return { reenter: true, context: { count: 1 } };
          }
        };
        const moving: On = {
          go: ({ context }, enq) => {
            enq(record, 'moving', context.count);
            return {
              target:
                kind === 'local'
                  ? targetlessFirst
                    ? 'b2'
                    : 'a2'
                  : kind === 'parallel reentry'
                    ? '#m.p'
                    : '#m.off',
              reenter: kind === 'parallel reentry',
              context: { count: 2 }
            };
          }
        };
        const trace = compareParallelTrace(
          regions(
            targetlessFirst ? targetless : moving,
            targetlessFirst ? moving : targetless
          ),
          [{ type: 'go' }]
        );
        expect(trace[1].selections).toBe(2);
        expect(trace[1].kept).toBe(2);
        expect(trace[1].context).toEqual({ count: targetlessFirst ? 2 : 1 });
        const results = targetlessFirst
          ? ['targetless', 'moving']
          : ['moving', 'targetless'];
        const exits = [
          'exit c1',
          'exit c',
          'exit b1',
          'exit b',
          'exit a1',
          'exit a',
          'exit p'
        ];
        if (kind === 'local') {
          expect(trace[1].value).toEqual({
            p: targetlessFirst
              ? { a: 'a1', b: 'b2', c: 'c1' }
              : { a: 'a2', b: 'b1', c: 'c1' }
          });
          expect(labels(trace[1])).toEqual([
            targetlessFirst ? 'exit b1' : 'exit a1',
            ...results,
            targetlessFirst ? 'enter b2' : 'enter a2'
          ]);
        } else if (kind === 'parallel reentry') {
          expect(trace[1].active).toEqual([
            'm',
            'm.p',
            'm.p.a',
            'm.p.a.a1',
            'm.p.b',
            'm.p.b.b1',
            'm.p.c',
            'm.p.c.c1'
          ]);
          expect(labels(trace[1])).toEqual([
            ...exits,
            ...results,
            'enter p',
            'enter a',
            'enter a1',
            'enter b',
            'enter b1',
            'enter c',
            'enter c1'
          ]);
        } else {
          expect(trace[1].active).toEqual(['m', 'm.off']);
          expect(labels(trace[1])).toEqual([...exits, ...results, 'enter off']);
        }
        expect(
          trace[1].effects
            .filter((effect) => results.includes(String(effect.args[0])))
            .map((effect) => effect.args)
        ).toEqual(results.map((name) => [name, 0]));
      }
    }
  );

  it.each([undefined, {}])(
    'keeps lifecycle-free targetless selections with patch %j',
    (context) => {
      const on: On = { go: { reenter: true, context } };
      const trace = compareParallelTrace(regions(on, on), [{ type: 'go' }]);
      expect(trace[1].selections).toBe(2);
      expect(trace[1].kept).toBe(2);
      expect(trace[1].active).toEqual(trace[0].active);
      expect(trace[1].effects).toEqual([]);
      expect(trace[1].snapshotReused).toBe(false);
      expect(trace[1].contextReused).toBe(context === undefined);
      expect(trace[1].context).toEqual({ count: 0 });
    }
  );

  it('refuses an active region target before running', () => {
    expect(() =>
      compareParallelTrace(
        regions({ go: { target: '#m.p.b' } }, { go: { target: '#m.off' } }),
        [{ type: 'go' }]
      )
    ).toThrow('Unsupported step: go (active region target)');
  });
});
