import { createFSM } from '../../src/fsm';
import fixture from './atm-prefix-replay.json';
import { assertAtmReplay } from './atmReplay';
import {
  assertAgrees,
  DEFAULT_FUEL,
  toModel,
  type JsConfig,
  type JsTransition
} from './fsmAdapter.ts';
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
  it.each(fixture.named)('ATM: $name', assertAtmReplay);

  it('first violates banking authorization at EXPIRE only on the faulty ATM', () => {
    const { events, faultyFirstBadPrefix } = fixture.minimizedFailure;
    expect(events.map((event) => event.type)).toEqual(['LOGIN', 'EXPIRE']);
    expect(faultyFirstBadPrefix).toBe(2);
    assertAtmReplay(fixture.minimizedFailure);
  });

  // Matches AtmMachine() in formal/fsmModel.dfy up to opaque-value id
  // assignment, so the Dafny proof and JSON replay stay on the same machine.
  it('encodes the intended ATM fixture to match AtmMachine() in formal/fsmModel.dfy', () => {
    const { machine, decodeContext } = toModel(fixture.variants.intended);
    const falseValue = machine.context?.[':authorized'];
    const login = machine.states.get('idle')?.on.get('LOGIN');
    const trueValue =
      login?.kind === 'config' ? login.config.context?.[0]?.value : undefined;
    expect(falseValue).toEqual({ kind: 'opaque', id: expect.any(Number) });
    expect(trueValue).toEqual({ kind: 'opaque', id: expect.any(Number) });
    expect(falseValue).not.toEqual(trueValue);
    expect(decodeContext({ ':authorized': falseValue! })).toEqual({
      authorized: false
    });
    expect(decodeContext({ ':authorized': trueValue! })).toEqual({
      authorized: true
    });
    expect(machine).toEqual({
      initial: 'idle',
      context: { ':authorized': falseValue },
      states: new Map([
        [
          'idle',
          {
            on: new Map([
              [
                'LOGIN',
                {
                  kind: 'config',
                  config: {
                    target: 'banking',
                    context: [{ key: ':authorized', value: trueValue }]
                  }
                }
              ]
            ]),
            inheritedOn: new Map(),
            always: undefined
          }
        ],
        [
          'banking',
          {
            on: new Map([
              [
                'EXPIRE',
                {
                  kind: 'config',
                  config: {
                    target: 'idle',
                    context: [{ key: ':authorized', value: falseValue }]
                  }
                }
              ]
            ]),
            inheritedOn: new Map(),
            always: undefined
          }
        ]
      ]),
      inheritedStates: new Map()
    });
  });

  it('treats inherited object keys as non-transitions', () => {
    const config: JsConfig = {
      initial: 'idle',
      states: { idle: { on: { go: { target: 'busy' } } } }
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
      {
        initial: 'idle',
        states: { idle: { on: { go: { target: '' } } }, '': {} }
      },
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

  it('defaults a missing target to the current state, not the initial state', () => {
    const config: JsConfig = {
      initial: 'idle',
      context: { count: 0 },
      states: {
        idle: { on: { start: { target: 'active' } } },
        active: { on: { bump: { context: { count: 1 } }, noop: {} } }
      }
    };
    assertAgrees(
      config,
      ['start', 'bump', 'noop'].map((type) => ({ type, payload: 0 }))
    );
  });

  it('gives an undeclared snapshot value no transitions', () => {
    assertAgrees(
      { initial: 'gone', states: { idle: { on: { go: { target: 'idle' } } } } },
      [{ type: 'go', payload: 0 }]
    );
  });

  const events = (...types: string[]) =>
    types.map((type) => ({ type, payload: 0 }));
  const finalValue = (config: JsConfig, types: string[]) => {
    const { machine } = toModel(config);
    const start = initialState(machine, DEFAULT_FUEL);
    expect(start.settled).toBe(true);
    const end = run(machine, start.snapshot, events(...types), DEFAULT_FUEL);
    expect(end.settled).toBe(true);
    return end.snapshot.value;
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
      initialState(machine, DEFAULT_FUEL).snapshot,
      events('increment', 'increment'),
      DEFAULT_FUEL
    );
    expect(end.settled).toBe(true);
    expect(decodeContext(end.snapshot.context)).toEqual({ count: 3 });
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
      transition(
        machine,
        initialState(machine, DEFAULT_FUEL).snapshot,
        events('go')[0],
        DEFAULT_FUEL
      ).reused
    ).toBe(false);
    assertAgrees(config, events('go', 'go'));
  });

  it('gives a state that config.states inherits through Object.create no transitions', () => {
    const base = { busy: { on: { back: { target: 'idle' } } } };
    const deeper = Object.create(base) as JsConfig['states'];
    setOwn(deeper, 'done', { on: { reset: { target: 'idle' } } });
    const states = Object.create(deeper) as JsConfig['states'];
    setOwn(states, 'idle', {
      on: { go: { target: 'busy' }, finish: { target: 'done' } }
    });
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
        idle: { on: { go: { target: 'busy' } } },
        __proto__: { busy: { on: { back: { target: 'idle' } } } }
      } as JsConfig['states']
    };
    expect(Object.hasOwn(config.states, 'busy')).toBe(false);
    expect(finalValue(config, ['go', 'back'])).toBe('busy');
    assertAgrees(config, events('go', 'back'));
  });

  it('ignores an inherited state with the same name as an own state', () => {
    const states = Object.create({
      idle: { on: { go: { target: 'inherited' } } },
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
      const on = Object.create({
        go: { target: 'busy' }
      }) as Record<string, JsTransition>;
      setOwn(on, 'stay', { target: 'idle' });
      const states = Object.create({ away: { on } }) as JsConfig['states'];
      setOwn(states, 'idle', { on });
      setOwn(states, 'busy', {});
      const config: JsConfig = { initial, states };
      const { machine } = toModel(config);
      expect(machine.states.has(initial)).toBe(initial === 'idle');
      const step = transition(
        machine,
        initialState(machine, DEFAULT_FUEL).snapshot,
        events('go')[0],
        DEFAULT_FUEL
      );
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
        states: { idle: { on: { go: { target: 'idle' } } } }
      };
      const { machine } = toModel(config);
      for (const event of events('go', 'on', 'toString'))
        expect(
          transition(
            machine,
            initialState(machine, DEFAULT_FUEL).snapshot,
            event,
            DEFAULT_FUEL
          ).reused
        ).toBe(true);
      assertAgrees(config, events('go', 'on', 'toString'));
    }
  );

  it('finds a non-enumerable own state and transition', () => {
    const on: Record<string, JsTransition> = {};
    Object.defineProperty(on, 'go', { value: { target: 'busy' } });
    const states = { idle: { on } } as JsConfig['states'];
    Object.defineProperty(states, 'busy', {
      value: { on: { back: { target: 'idle' } } }
    });
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
      const step = transition(
        machine,
        initialState(machine, DEFAULT_FUEL).snapshot,
        { type: 'patch', payload: 0 },
        DEFAULT_FUEL
      );
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
    const start = initialState(machine, DEFAULT_FUEL).snapshot;
    expect(
      transition(machine, start, { type: 'nan', payload: 0 }, DEFAULT_FUEL)
        .reused
    ).toBe(true);
    const zero = transition(
      machine,
      start,
      { type: 'zero', payload: 0 },
      DEFAULT_FUEL
    );
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
        transition(
          machine,
          initialState(machine, DEFAULT_FUEL).snapshot,
          { type, payload: 0 },
          DEFAULT_FUEL
        ).reused,
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
    const start = initialState(machine, DEFAULT_FUEL).snapshot;
    expect(
      transition(machine, start, events('same')[0], DEFAULT_FUEL).reused
    ).toBe(true);
    expect(
      transition(machine, start, events('other')[0], DEFAULT_FUEL).reused
    ).toBe(false);
    expect(
      transition(machine, start, events('absent')[0], DEFAULT_FUEL).reused
    ).toBe(false);
    assertAgrees(config, events('same', 'other', 'other', 'absent', 'absent'));
  });

  it.each([
    [
      'a context with an accessor',
      Object.defineProperty({}, 'x', {
        get: () => 1,
        enumerable: true
      }),
      { go: { target: 'idle' } }
    ],
    [
      'a context with a non-enumerable property',
      Object.defineProperty({}, 'x', {
        value: 1,
        enumerable: false
      }),
      { go: { target: 'idle' } }
    ],
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
    ],
    [
      'a patch with a non-enumerable property',
      {},
      {
        go: {
          context: Object.defineProperty({}, 'x', {
            value: 1,
            enumerable: false
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
      () => ({ idle: { on: accessor({}, 'go', { target: 'idle' }) } })
    ],
    [
      'an always transition with an accessor',
      () => ({ idle: accessor({}, 'always', { target: 'idle' }) })
    ],
    [
      'an inherited always transition with an accessor',
      () => {
        const state = Object.create(accessor({}, 'always', { target: 'idle' }));
        return { idle: state };
      }
    ]
  ])('refuses states with %s, which is outside the model', (_name, build) => {
    expect(() =>
      assertAgrees({ initial: '__proto__', states: build() }, events('go'))
    ).toThrow(/outside the model|must be/);
  });

  it('gives the snapshot value __proto__ no transitions when states inherits a state named on', () => {
    const states = Object.create({ on: { on: { go: { target: 'idle' } } } });
    setOwn(states, 'idle', {});
    assertAgrees({ initial: '__proto__', states }, events('go'));
  });

  it('ignores a state that a polluted Object.prototype supplies', () => {
    Object.defineProperty(Object.prototype, 'polluted', {
      value: { on: { go: { target: 'idle' } } },
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

  describe('string transition rejection (#5904)', () => {
    it.each([
      [
        'an own on transition',
        () => ({ initial: 'idle', states: { idle: { on: { go: 'busy' } } } })
      ],
      [
        'an empty string on transition',
        () => ({ initial: 'idle', states: { idle: { on: { go: '' } } } })
      ],
      [
        'a non-enumerable own on transition',
        () => {
          const on: Record<string, unknown> = {};
          Object.defineProperty(on, 'go', { value: 'busy' });
          return { initial: 'idle', states: { idle: { on } } };
        }
      ],
      [
        'an own always transition',
        () => ({ initial: 'idle', states: { idle: { always: 'busy' } } })
      ],
      [
        'an own always transition on a non-initial state',
        () => ({
          initial: 'idle',
          states: { idle: {}, busy: { always: 'idle' } }
        })
      ],
      [
        'a non-enumerable own state with a string transition',
        () => {
          const states: Record<string, unknown> = { idle: {} };
          Object.defineProperty(states, 'hidden', {
            value: { on: { go: 'idle' } }
          });
          return { initial: 'idle', states };
        }
      ],
      [
        'a non-enumerable own always transition',
        () => {
          const idle = {};
          Object.defineProperty(idle, 'always', { value: 'busy' });
          return { initial: 'idle', states: { idle } };
        }
      ],
      [
        'an inherited always transition on an own state',
        () => {
          const idle = Object.create({ always: 'busy' });
          return { initial: 'idle', states: { idle } };
        }
      ]
    ])(
      'rejects %s with TypeError at createFSM construction',
      (_name, build) => {
        const config = build();
        expect(() => createFSM(config as never)).toThrow(TypeError);
        expect(() => toModel(config as JsConfig)).toThrow(
          /string transitions are rejected/
        );
      }
    );

    it('rejects a transition function returning a string at step time', () => {
      const config = {
        initial: 'idle',
        states: {
          idle: {
            on: {
              go: () => 'busy'
            }
          },
          busy: {}
        }
      };
      const fsm = createFSM(config as never);
      expect(() => fsm.transition(fsm.initialState, { type: 'go' })).toThrow(
        TypeError
      );
      expect(() => assertAgrees(config as never, events('go'))).toThrow(
        /transition result must be a config object/
      );
    });

    it('rejects an always transition function returning a string at step time', () => {
      const config = {
        initial: 'idle',
        states: {
          idle: {
            always: () => 'busy'
          },
          busy: {}
        }
      };
      expect(() => createFSM(config as never)).toThrow(TypeError);
    });

    it('does not throw at construction for inherited string on entries or inherited states', () => {
      const on = Object.create({ go: 'busy' });
      const states = Object.create({
        inherited: { on: { back: 'idle' }, always: 'idle' }
      });
      setOwn(states, 'idle', { on });
      const fsm = createFSM({ initial: 'idle', states } as never);
      expect(fsm.initialState.value).toBe('idle');
      const [next] = fsm.transition(fsm.initialState, { type: 'go' });
      expect(next).toBe(fsm.initialState);
    });
  });

  describe('always transitions and settling', () => {
    it('settles initial always chains with { type: "xstate.init" } and no payload property', () => {
      const seen: Array<{ type: string; hasPayload: boolean }> = [];
      const config: JsConfig = {
        initial: 'a',
        context: { count: 0 },
        states: {
          a: {
            always: ({ context, event }) => {
              seen.push({
                type: event.type,
                hasPayload: Object.hasOwn(event, 'payload')
              });
              return {
                target: 'b',
                context: { count: (context.count as number) + 1 }
              };
            }
          },
          b: {
            always: ({ context, event }) => {
              seen.push({
                type: event.type,
                hasPayload: Object.hasOwn(event, 'payload')
              });
              return {
                target: 'c',
                context: { count: (context.count as number) + 1 }
              };
            }
          },
          c: {}
        }
      };
      assertAgrees(config, []);
      expect(seen.every((entry) => entry.type === 'xstate.init')).toBe(true);
      expect(seen.every((entry) => entry.hasPayload === false)).toBe(true);
    });

    it('passes the triggering event through multi-step always chains', () => {
      const config: JsConfig = {
        initial: 'a',
        context: { sum: 0 },
        states: {
          a: {
            on: {
              add: ({ context, event }) => ({
                target: 'b',
                context: {
                  sum: (context.sum as number) + (event.payload ?? 0)
                }
              })
            }
          },
          b: {
            always: ({ context, event }) => ({
              target: 'c',
              context: {
                sum: (context.sum as number) + (event.payload ?? 0)
              }
            })
          },
          c: {
            always: ({ context, event }) => ({
              target: 'd',
              context: {
                sum: (context.sum as number) + (event.payload ?? 0)
              }
            })
          },
          d: {}
        }
      };
      const seq = [{ type: 'add', payload: 3 }];
      assertAgrees(config, seq);
      const { machine, decodeContext } = toModel(config);
      const step = transition(
        machine,
        initialState(machine, DEFAULT_FUEL).snapshot,
        { type: 'add', payload: 3 },
        DEFAULT_FUEL
      );
      expect(step.settled).toBe(true);
      expect(step.snapshot.value).toBe('d');
      expect(decodeContext(step.snapshot.context)).toEqual({ sum: 9 });
    });

    it.each([
      ['empty object', {}],
      ['same target', { target: 'idle' }],
      ['unchanged context patch', { context: { x: 1 } }],
      ['NaN over own NaN', { context: { nan: Number.NaN } }],
      ['function returning undefined', () => undefined],
      ['function returning empty object', () => ({})]
    ])('stops settling on a no-op always transition: %s', (_name, always) => {
      const config: JsConfig = {
        initial: 'idle',
        context: { x: 1, nan: Number.NaN },
        states: {
          idle: {
            always: always as JsTransition,
            on: { ping: { context: { x: 2 } } }
          }
        }
      };
      assertAgrees(config, events('ping'));
    });

    it('copies once for -0 over 0 in always and then settles', () => {
      const config: JsConfig = {
        initial: 'idle',
        context: { zero: 0 },
        states: {
          idle: { always: { context: { zero: -0 } } }
        }
      };
      const { machine, decodeContext } = toModel(config);
      const start = initialState(machine, DEFAULT_FUEL);
      expect(start.settled).toBe(true);
      expect(start.reused).toBe(false);
      expect(Object.is(decodeContext(start.snapshot.context).zero, -0)).toBe(
        true
      );
      assertAgrees(config, []);
    });

    it('skips always when an event is unhandled or a transition function returns undefined, but runs always on a handled no-op', () => {
      const config: JsConfig = {
        initial: 'a',
        context: { x: 0 },
        states: {
          a: {
            always: ({ event }) =>
              event.type !== 'xstate.init' ? { target: 'b' } : undefined,
            on: {
              poke: {},
              drop: () => undefined
            }
          },
          b: {}
        }
      };
      assertAgrees(config, events('missing', 'drop', 'poke'));
      expect(finalValue(config, ['missing', 'drop'])).toBe('a');
      expect(finalValue(config, ['missing', 'drop', 'poke'])).toBe('b');
    });

    it('detects and runs always on a non-enumerable own state', () => {
      const states: JsConfig['states'] = {
        a: { on: { go: { target: 'hidden' } } },
        done: {}
      };
      Object.defineProperty(states, 'hidden', {
        value: { always: { target: 'done' } }
      });
      const config: JsConfig = { initial: 'a', states };
      assertAgrees(config, events('go'));
      expect(finalValue(config, ['go'])).toBe('done');
    });

    it('allocates a fresh snapshot when always returns to the original state value', () => {
      const config: JsConfig = {
        initial: 'a',
        context: { x: 1 },
        states: {
          a: { on: { loop: { target: 'b' } } },
          b: { always: { target: 'a' } }
        }
      };
      const { machine } = toModel(config);
      const start = initialState(machine, DEFAULT_FUEL);
      const step = transition(
        machine,
        start.snapshot,
        events('loop')[0],
        DEFAULT_FUEL
      );
      expect(step.settled).toBe(true);
      expect(step.reused).toBe(false);
      expect(step.snapshot.value).toBe('a');
      assertAgrees(config, events('loop'));
    });

    it('takes an inherited always on an own state, and ignores always on an inherited state', () => {
      const ownWithInheritedAlways = Object.create({
        always: { target: 'done' }
      });
      const states = Object.create({
        inherited: { always: { target: 'done' } }
      }) as JsConfig['states'];
      setOwn(states, 'start', ownWithInheritedAlways);
      setOwn(states, 'done', {});
      assertAgrees({ initial: 'start', states }, []);
      expect(finalValue({ initial: 'start', states }, [])).toBe('done');
      assertAgrees({ initial: 'inherited', states }, []);
      expect(finalValue({ initial: 'inherited', states }, [])).toBe(
        'inherited'
      );
    });

    it('reports settled: false for a non-terminating always cycle at any fuel', () => {
      const config: JsConfig = {
        initial: 'a',
        states: {
          a: { always: { target: 'b' } },
          b: { always: { target: 'a' } }
        }
      };
      const { machine } = toModel(config);
      for (const fuel of [0, 1, 5, 20]) {
        expect(initialState(machine, fuel).settled).toBe(false);
      }
      expect(() => assertAgrees(config, [])).toThrow(
        /always chain must settle within fuel/
      );
    });
  });
});
