import { assertAgrees, toModel, type JsConfig } from './fsmAdapter.ts';
import { initialState, run, transition } from './fsmModel.ts';

const setOwn = (object: object, key: PropertyKey, value: unknown) =>
  Object.defineProperty(object, key, {
    value,
    enumerable: true,
    writable: true,
    configurable: true
  });

// Named cases comparing the LemmaScript model with createFSM. Generated
// machines run in fsmModel.property.test.ts.

describe('the fsm model and createFSM', () => {
  it('treats inherited object keys as non-transitions', () => {
    const config = {
      initial: 'idle',
      states: { idle: { on: { go: 'busy' } } }
    };
    for (const type of [
      'toString',
      'constructor',
      'hasOwnProperty',
      '__proto__'
    ])
      assertAgrees(config, [{ type, payload: 0 }]);
  });

  // The second event starts from '', an own state with no `on` table.
  it('accepts the empty string as a transition target', () => {
    assertAgrees(
      { initial: 'idle', states: { idle: { on: { go: '' } }, '': {} } },
      [
        { type: 'go', payload: 0 },
        { type: 'go', payload: 0 }
      ]
    );
  });

  it('keeps the snapshot for functions returning nothing or an empty config', () => {
    const config: JsConfig = {
      initial: 'idle',
      context: { x: 1 },
      states: {
        idle: {
          on: {
            none: () => undefined,
            empty: () => ({}),
            same: () => ({ context: { x: 1 } })
          }
        }
      }
    };
    assertAgrees(
      config,
      ['none', 'empty', 'same'].map((type) => ({ type, payload: 0 }))
    );
  });

  it('gives an undeclared snapshot value no transitions', () => {
    assertAgrees(
      { initial: 'gone', states: { idle: { on: { go: 'idle' } } } },
      [{ type: 'go', payload: 0 }]
    );
  });

  const events = (...types: string[]) =>
    types.map((type) => ({ type, payload: 0 }));
  const finalValue = (config: JsConfig, types: string[]) => {
    const { machine } = toModel(config);
    return run(machine, initialState(machine), events(...types)).value;
  };

  it('passes the current context to transition functions', () => {
    const config: JsConfig = {
      initial: 'idle',
      context: { count: 1 },
      states: {
        idle: {
          on: {
            increment: ({ context }) => ({
              context: { count: (context.count as number) + 1 }
            })
          }
        }
      }
    };
    const { machine, decodeContext } = toModel(config);
    const end = run(
      machine,
      initialState(machine),
      events('increment', 'increment')
    );
    expect(decodeContext(end.context)).toEqual({ count: 3 });
    assertAgrees(config, events('increment', 'increment'));
  });

  it('copies when only a later patch key changes', () => {
    const config: JsConfig = {
      initial: 'idle',
      context: { x: 1, y: 1 },
      states: { idle: { on: { go: { context: { x: 1, y: 2 } } } } }
    };
    const { machine } = toModel(config);
    expect(
      transition(machine, initialState(machine), events('go')[0]).reused
    ).toBe(false);
    assertAgrees(config, events('go', 'go'));
  });

  it('gives a state that config.states inherits through Object.create no transitions', () => {
    const base = { busy: { on: { back: 'idle' } } };
    const deeper = Object.create(base) as JsConfig['states'];
    setOwn(deeper, 'done', { on: { reset: 'idle' } });
    const states = Object.create(deeper) as JsConfig['states'];
    setOwn(states, 'idle', { on: { go: 'busy', finish: 'done' } });
    const config: JsConfig = { initial: 'idle', states };
    expect(finalValue(config, ['go', 'back'])).toBe('busy');
    expect(finalValue(config, ['finish', 'reset'])).toBe('done');
    assertAgrees(config, events('go', 'back', 'go'));
    assertAgrees(config, events('finish', 'reset', 'go'));
  });

  it('gives a state inherited through a literal __proto__ no transitions', () => {
    const config: JsConfig = {
      initial: 'idle',
      states: {
        idle: { on: { go: 'busy' } },
        __proto__: { busy: { on: { back: 'idle' } } }
      } as JsConfig['states']
    };
    expect(Object.hasOwn(config.states, 'busy')).toBe(false);
    expect(finalValue(config, ['go', 'back'])).toBe('busy');
    assertAgrees(config, events('go', 'back'));
  });

  it('ignores an inherited state with the same name as an own state', () => {
    const states = Object.create({
      idle: { on: { go: 'inherited' } },
      inherited: {}
    }) as JsConfig['states'];
    setOwn(states, 'idle', { on: { stay: { context: { x: 2 } } } });
    const config: JsConfig = { initial: 'idle', context: { x: 1 }, states };
    const { machine } = toModel(config);
    expect(machine.inheritedStates.has('idle')).toBe(true);
    expect(finalValue(config, ['go', 'stay'])).toBe('idle');
    assertAgrees(config, events('go', 'stay', 'go'));
  });

  it.each(['idle', 'away'])(
    'does not take an event that the on table of the %s state inherits',
    (initial) => {
      const on = Object.create({ go: 'busy' }) as Record<string, string>;
      setOwn(on, 'stay', 'idle');
      const states = Object.create({ away: { on } }) as JsConfig['states'];
      setOwn(states, 'idle', { on });
      setOwn(states, 'busy', {});
      const config: JsConfig = { initial, states };
      const { machine } = toModel(config);
      expect(machine.states.has(initial)).toBe(initial === 'idle');
      const step = transition(machine, initialState(machine), events('go')[0]);
      expect(step.reused).toBe(true);
      expect(step.snapshot.value).toBe(initial);
      assertAgrees(config, events('go', 'stay', 'go'));
    }
  );

  it.each(['toString', 'constructor', 'hasOwnProperty', '__proto__'])(
    'gives the snapshot value %s no transitions with a plain states object',
    (initial) => {
      const config: JsConfig = {
        initial,
        states: { idle: { on: { go: 'idle' } } }
      };
      const { machine } = toModel(config);
      for (const event of events('go', 'on', 'toString'))
        expect(transition(machine, initialState(machine), event).reused).toBe(
          true
        );
      assertAgrees(config, events('go', 'on', 'toString'));
    }
  );

  it('finds a non-enumerable own state and transition', () => {
    const on: Record<string, string> = {};
    Object.defineProperty(on, 'go', { value: 'busy' });
    const states = { idle: { on } } as JsConfig['states'];
    Object.defineProperty(states, 'busy', { value: { on: { back: 'idle' } } });
    const config: JsConfig = { initial: 'idle', states };
    expect(finalValue(config, ['go'])).toBe('busy');
    assertAgrees(config, events('go', 'back'));
  });

  // Each case patches the context `{ zero: 0, text: 'a', ref, nan: NaN }`
  // and states whether createFSM keeps the snapshot.
  const ref = { label: 'ref' };
  const keepOrCopy: [string, Record<string, unknown>, boolean][] = [
    ['undefined for an absent key', { absent: undefined }, false],
    ['-0 over 0 alone', { zero: -0 }, false],
    ['-0 over 0 beside a change', { zero: -0, text: 'b' }, false],
    ['0 over 0', { zero: 0 }, true],
    ['NaN for an absent key', { added: Number.NaN }, false],
    ['NaN over an own NaN', { nan: Number.NaN }, true],
    ['an equal string', { text: 'a' }, true],
    ['a different string', { text: 'b' }, false],
    ['the same reference', { ref }, true],
    ['an equal but distinct object', { ref: { label: 'ref' } }, false],
    [
      'Object.prototype.toString for the inherited toString',
      { toString: Object.prototype.toString },
      false
    ],
    ['another value for toString', { toString: 'own' }, false]
  ];

  it.each(keepOrCopy)(
    'copies a patch exactly when some key is not own or some value differs under Object.is: %s',
    (_name, patch, keeps) => {
      const config: JsConfig = {
        initial: 'idle',
        context: { zero: 0, text: 'a', ref, nan: Number.NaN },
        states: { idle: { on: { patch: { context: patch } } } }
      };
      const { machine, decodeContext } = toModel(config);
      const step = transition(machine, initialState(machine), {
        type: 'patch',
        payload: 0
      });
      expect(step.reused).toBe(keeps);
      const context = decodeContext(step.snapshot.context);
      if (keeps)
        expect(Object.keys(context)).toEqual(['zero', 'text', 'ref', 'nan']);
      else
        for (const [key, value] of Object.entries(patch)) {
          expect(Object.hasOwn(context, key), key).toBe(true);
          expect(context[key], key).toBe(value);
        }
      assertAgrees(config, [{ type: 'patch', payload: 0 }]);
    }
  );

  it('keeps the snapshot for NaN over an own NaN, and copies for 0 over -0', () => {
    const config: JsConfig = {
      initial: 'idle',
      context: { x: Number.NaN, y: -0 },
      states: {
        idle: {
          on: {
            nan: { context: { x: Number.NaN } },
            zero: { context: { y: 0 } }
          }
        }
      }
    };
    const { machine, decodeContext } = toModel(config);
    const start = initialState(machine);
    expect(transition(machine, start, { type: 'nan', payload: 0 }).reused).toBe(
      true
    );
    const zero = transition(machine, start, { type: 'zero', payload: 0 });
    expect(zero.reused).toBe(false);
    expect(decodeContext(zero.snapshot.context).y).toBe(0);
    assertAgrees(config, [
      { type: 'nan', payload: 0 },
      { type: 'zero', payload: 0 }
    ]);
  });

  it('treats an own __proto__ key as an ordinary context key', () => {
    const context = {};
    setOwn(context, '__proto__', 1);
    const same = {};
    setOwn(same, '__proto__', 1);
    const other = {};
    setOwn(other, '__proto__', 2);
    const config: JsConfig = {
      initial: 'idle',
      context,
      states: {
        idle: { on: { same: { context: same }, other: { context: other } } }
      }
    };
    assertAgrees(config, [
      { type: 'same', payload: 0 },
      { type: 'other', payload: 0 },
      { type: 'other', payload: 0 }
    ]);
  });

  it('copies a patch for an absent __proto__, even with Object.prototype', () => {
    const inheritedProto = {};
    setOwn(inheritedProto, '__proto__', Object.prototype);
    const otherProto = {};
    setOwn(otherProto, '__proto__', null);
    const config: JsConfig = {
      initial: 'idle',
      context: {},
      states: {
        idle: {
          on: {
            inherited: { context: inheritedProto },
            other: { context: otherProto }
          }
        }
      }
    };
    const { machine } = toModel(config);
    for (const type of ['inherited', 'other'])
      expect(
        transition(machine, initialState(machine), { type, payload: 0 }).reused,
        type
      ).toBe(false);
    assertAgrees(config, [
      { type: 'inherited', payload: 0 },
      { type: 'other', payload: 0 }
    ]);
  });

  it('agrees for a null-prototype context, whose prototype createFSM never reads', () => {
    const context = Object.create(null) as Record<string, unknown>;
    context.x = 1;
    const config: JsConfig = {
      initial: 'idle',
      context,
      states: {
        idle: {
          on: {
            same: { context: { x: 1 } },
            toString: { context: { toString: 'own' } }
          }
        }
      }
    };
    assertAgrees(config, events('same', 'toString', 'same'));
  });

  it('compares symbol keys like string keys', () => {
    const s = Symbol('s');
    const t = Symbol('t');
    const config: JsConfig = {
      initial: 'idle',
      context: { x: 1, [s]: 1 },
      states: {
        idle: {
          on: {
            same: { context: { [s]: 1 } },
            other: { context: { [s]: 2 } },
            absent: { context: { [t]: undefined } }
          }
        }
      }
    };
    const { machine } = toModel(config);
    const start = initialState(machine);
    expect(transition(machine, start, events('same')[0]).reused).toBe(true);
    expect(transition(machine, start, events('other')[0]).reused).toBe(false);
    expect(transition(machine, start, events('absent')[0]).reused).toBe(false);
    assertAgrees(config, events('same', 'other', 'other', 'absent', 'absent'));
  });

  it.each([
    [
      'a patch with an accessor',
      {},
      {
        go: {
          context: Object.defineProperty({}, 'x', {
            get: () => 1,
            enumerable: true
          })
        }
      }
    ]
  ])('refuses %s, which is outside the model', (_name, context, on) => {
    expect(() =>
      assertAgrees({ initial: 'idle', context, states: { idle: { on } } }, [
        { type: 'go', payload: 0 }
      ])
    ).toThrow(/outside the model|must be/);
  });

  const accessor = (object: object, key: string, value: unknown) =>
    Object.defineProperty(object, key, { get: () => value, enumerable: true });
  it.each([
    ['an own state with an accessor', () => accessor({ idle: {} }, 'busy', {})],
    [
      'an inherited state with an accessor',
      () => {
        const states = Object.create(accessor({}, 'busy', {}));
        setOwn(states, 'idle', {});
        return states;
      }
    ],
    [
      'a transition with an accessor',
      () => ({ idle: { on: accessor({}, 'go', 'idle') } })
    ]
  ])('refuses states with %s, which is outside the model', (_name, build) => {
    expect(() =>
      assertAgrees({ initial: '__proto__', states: build() }, events('go'))
    ).toThrow(/outside the model|must be/);
  });

  it('gives the snapshot value __proto__ no transitions when states inherits a state named on', () => {
    const states = Object.create({ on: { on: { go: 'idle' } } });
    setOwn(states, 'idle', {});
    assertAgrees({ initial: '__proto__', states }, events('go'));
  });

  it('ignores a state that a polluted Object.prototype supplies', () => {
    Object.defineProperty(Object.prototype, 'polluted', {
      value: { on: { go: 'idle' } },
      configurable: true
    });
    try {
      const config: JsConfig = { initial: 'polluted', states: { idle: {} } };
      expect(finalValue(config, ['go'])).toBe('polluted');
      assertAgrees(config, events('go'));
    } finally {
      delete (Object.prototype as Record<string, unknown>).polluted;
    }
  });
});
