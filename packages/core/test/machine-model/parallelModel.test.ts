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

  it('refuses nested or multiple parallel nodes before running', () => {
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
    ).toThrow(/Unsupported/);
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
    ).toThrow(/Unsupported/);
    expect(() =>
      compareParallelTrace(
        { context: {}, type: 'parallel', initial: 'a', states: { a: {} } },
        []
      )
    ).toThrow(/Unsupported/);
  });

  it('refuses array targets before running', () => {
    expect(() =>
      compareParallelTrace(
        lights({ jump: { target: ['.a.a2', '.b.b2'] } as never }),
        []
      )
    ).toThrow(/Unsupported target/);
  });

  it('refuses steps where more than one region selects a transition', () => {
    const config = lights();
    config.states!.p.states!.b.states!.b1.on = { next: { target: 'b2' } };
    expect(() => compareParallelTrace(config, [{ type: 'next' }])).toThrow(
      /Unsupported step/
    );
  });

  it('refuses a non-reentering target of an already active region', () => {
    expect(() =>
      compareParallelTrace(lights({ jump: { target: '.b' } }), [
        { type: 'jump' }
      ])
    ).toThrow(/Unsupported step/);
  });
});
