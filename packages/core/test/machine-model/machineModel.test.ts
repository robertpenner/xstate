import { compareTrace } from './machineAdapter';

describe('flat machine model', () => {
  it('initializes, handles targetless events, and distinguishes missing events', () => {
    const trace = compareTrace(
      {
        initial: 'a',
        context: { count: 0 },
        states: { a: { on: { stay: {}, go: { target: 'b' } } }, b: {} }
      },
      [{ type: 'missing' }, { type: 'stay' }, { type: 'go' }]
    );
    expect(trace.map((step) => step.value)).toEqual(['a', 'a', 'a', 'b']);
    expect(trace.map((step) => step.snapshotReused)).toEqual([
      false,
      true,
      false,
      false
    ]);
    expect(trace.map((step) => step.contextReused)).toEqual([
      true,
      true,
      true,
      true
    ]);
  });

  it('orders exit, transition, and entry effects with their observed context', () => {
    const record = vi.fn();
    const trace = compareTrace(
      {
        initial: 'a',
        context: { count: 0 },
        states: {
          a: {
            entry: ({ context }, enq) => {
              enq(record, 'initial', context.count);
              return { context: { count: Number(context.count) + 1 } };
            },
            exit: ({ context }, enq) => {
              enq(record, 'exit', context.count);
              return { context: { count: Number(context.count) + 10 } };
            },
            on: {
              go: ({ context }, enq) => {
                enq(record, 'transition', context.count);
                return {
                  target: 'b',
                  context: { count: Number(context.count) + 100 }
                };
              }
            }
          },
          b: {
            entry: ({ context }, enq) => {
              enq(record, 'entry', context.count);
              return { context: { count: Number(context.count) + 1000 } };
            }
          }
        }
      },
      [{ type: 'go' }]
    );
    expect(trace.map((step) => step.context)).toEqual([
      { count: 1 },
      { count: 1101 }
    ]);
    expect(trace[1].effects.map((effect) => effect.args)).toEqual([
      ['exit', 1],
      ['transition', 1],
      ['entry', 101]
    ]);
    expect(record).not.toHaveBeenCalled();
  });

  it.each([
    ['missing', {}, true],
    ['declined', { on: { event: (): undefined => undefined } }, true],
    ['blocked', { on: { event: undefined } }, false],
    ['handled no-op', { on: { event: {} } }, false],
    ['callback no-op', { on: { event: () => ({}) } }, false]
  ] as const)('distinguishes %s', (_name, state, reused) => {
    const trace = compareTrace(
      { initial: 'a', context: {}, states: { a: state } },
      [{ type: 'event' }]
    );
    expect(trace[1].snapshotReused).toBe(reused);
    expect(trace[1].contextReused).toBe(true);
  });

  it('handles an effect-only callback without executing its effect', () => {
    const effect = vi.fn();
    const trace = compareTrace(
      {
        initial: 'a',
        context: {},
        states: {
          a: {
            on: {
              event: (_, enq) => {
                enq(effect, 'payload');
              }
            }
          }
        }
      },
      [{ type: 'event' }]
    );
    expect(trace[1].snapshotReused).toBe(false);
    expect(trace[1].contextReused).toBe(true);
    expect(trace[1].effects).toEqual([{ action: effect, args: ['payload'] }]);
    expect(effect).not.toHaveBeenCalled();
  });

  it.each([false, true])('self-target lifecycle with reenter=%s', (reenter) => {
    const effect = vi.fn();
    const trace = compareTrace(
      {
        initial: 'a',
        context: {},
        states: {
          a: {
            entry: (_, enq) => {
              enq(effect, 'enter');
            },
            exit: (_, enq) => {
              enq(effect, 'exit');
            },
            on: { self: { target: 'a', reenter }, internal: {} }
          }
        }
      },
      [{ type: 'self' }, { type: 'internal' }]
    );
    expect(trace[1].effects.map((effect) => effect.args)).toEqual(
      reenter ? [['exit'], ['enter']] : []
    );
    expect(trace[2].effects).toEqual([]);
  });

  const shared = {};
  it.each([
    [{}, { key: undefined }],
    [{ key: undefined }, { key: undefined }],
    [{ key: NaN }, { key: NaN }],
    [{ key: 0 }, { key: -0 }],
    [{ key: -0 }, { key: 0 }],
    [{ key: shared }, { key: shared }],
    [{ key: shared }, { key: {} }],
    [{ key: 1 }, {}],
    [{}, { ['__proto__']: shared, toString: undefined }]
  ])(
    'copies every supplied patch, preserving own values: %j / %j',
    (context, patch) => {
      const trace = compareTrace(
        {
          initial: 'a',
          context,
          states: {
            a: {
              on: {
                object: { context: patch },
                callback: () => ({ context: patch })
              }
            }
          }
        },
        [{ type: 'object' }, { type: 'callback' }]
      );
      expect(trace[1].contextReused).toBe(false);
      expect(trace[2].contextReused).toBe(false);
      for (const [key, value] of Object.entries(patch)) {
        expect(Object.hasOwn(trace[2].context, key)).toBe(true);
        expect(Object.is(trace[2].context[key], value)).toBe(true);
      }
    }
  );

  it('refuses unsupported config features before evaluating callbacks', () => {
    const entry = vi.fn();
    expect(() =>
      compareTrace(
        {
          initial: 'a',
          context: {},
          states: {
            // @ts-expect-error Deliberately unsupported configuration.
            a: { entry, always: { target: 'b' } },
            b: {}
          }
        },
        []
      )
    ).toThrow(/Unsupported.*always/);
    expect(entry).not.toHaveBeenCalled();
  });

  it('keeps targetless-reentry patches and effects without lifecycle callbacks', () => {
    const effect = vi.fn();
    const trace = compareTrace(
      {
        initial: 'a',
        context: { count: 0 },
        states: {
          a: {
            entry: (_, enq) => {
              enq(effect, 'entry');
            },
            exit: (_, enq) => {
              enq(effect, 'exit');
            },
            on: {
              event: ({ context }, enq) => {
                enq(effect, 'transition');
                return {
                  reenter: true,
                  context: { count: Number(context.count) + 1 }
                };
              }
            }
          }
        }
      },
      [{ type: 'event' }]
    );
    expect(trace[1].context).toEqual({ count: 1 });
    expect(trace[1].effects.map((effect) => effect.args)).toEqual([
      ['transition']
    ]);
  });

  it.each([
    { [Symbol('key')]: 1 },
    Object.defineProperty({}, 'key', { get: () => 1, enumerable: true }),
    Object.defineProperty({}, 'key', { value: 1 }),
    Object.create({ key: 1 })
  ])('refuses unsupported context and patch shapes', (value) => {
    expect(() =>
      compareTrace(
        {
          initial: 'a',
          context: value,
          states: { a: {} }
        },
        []
      )
    ).toThrow(/Unsupported/);
    expect(() =>
      compareTrace(
        {
          initial: 'a',
          context: {},
          states: { a: { on: { event: () => ({ context: value }) } } }
        },
        [{ type: 'event' }]
      )
    ).toThrow(/Unsupported/);
  });

  it.each(['always', 'after', 'invoke', 'states', 'type', 'history', 'input'])(
    'refuses state feature %s',
    (key) => {
      expect(() =>
        compareTrace(
          {
            initial: 'a',
            context: {},
            states: { a: { [key]: {} } }
          },
          []
        )
      ).toThrow(/Unsupported/);
    }
  );

  it('refuses unknown callback output and enqueue operations', () => {
    expect(() =>
      compareTrace(
        {
          initial: 'a',
          context: {},
          states: {
            a: {
              on: {
                event: () => ({
                  context: {},
                  children: {}
                })
              }
            }
          }
        },
        [{ type: 'event' }]
      )
    ).toThrow(/Unsupported.*children/);
    expect(() =>
      compareTrace(
        {
          initial: 'a',
          context: {},
          states: {
            a: {
              on: {
                event: (_, enq) => {
                  // @ts-expect-error Deliberately unsupported enqueue operation.
                  enq.raise({ type: 'event' });
                }
              }
            }
          }
        },
        [{ type: 'event' }]
      )
    ).toThrow(/Unsupported.*raise/);
  });
});
