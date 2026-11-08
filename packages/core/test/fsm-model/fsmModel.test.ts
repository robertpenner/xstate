import { assertAgrees, toModel, type JsConfig } from './fsmAdapter.ts';
import { initialState, transition } from './fsmModel.ts';

const setOwn = (object: object, key: string, value: unknown) =>
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

  it('accepts the empty string as a transition target', () => {
    assertAgrees(
      { initial: 'idle', states: { idle: { on: { go: '' } }, '': {} } },
      [{ type: 'go', payload: 0 }]
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

  // Each case patches the context `{ zero: 0, text: 'a', ref }` and states
  // whether createFSM keeps the snapshot.
  const ref = { label: 'ref' };
  const keepOrCopy: [string, Record<string, unknown>, boolean][] = [
    ['undefined for an absent key', { absent: undefined }, true],
    ['-0 over 0 alone', { zero: -0 }, true],
    ['-0 over 0 beside a change', { zero: -0, text: 'b' }, false],
    ['NaN', { added: Number.NaN }, false],
    ['an equal string', { text: 'a' }, true],
    ['a different string', { text: 'b' }, false],
    ['the same reference', { ref }, true],
    ['an equal but distinct object', { ref: { label: 'ref' } }, false],
    [
      'Object.prototype.toString for toString',
      { toString: Object.prototype.toString },
      true
    ],
    ['another value for toString', { toString: 'own' }, false]
  ];

  it.each(keepOrCopy)(
    'copies a patch exactly when some value is not === to the value read: %s',
    (_name, patch, keeps) => {
      const config: JsConfig = {
        initial: 'idle',
        context: { zero: 0, text: 'a', ref },
        states: { idle: { on: { patch: { context: patch } } } }
      };
      const { machine, decodeContext } = toModel(config);
      const step = transition(machine, initialState(machine), {
        type: 'patch',
        payload: 0
      });
      expect(step.reused).toBe(keeps);
      const context = decodeContext(step.snapshot.context);
      if (keeps) expect(Object.keys(context)).toEqual(['zero', 'text', 'ref']);
      else
        for (const [key, value] of Object.entries(patch))
          expect(context[key], key).toBe(value);
      assertAgrees(config, [{ type: 'patch', payload: 0 }]);
    }
  );

  it('always copies for a NaN patch value, and not for 0 over -0', () => {
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
      false
    );
    const zero = transition(machine, start, { type: 'zero', payload: 0 });
    expect(zero.reused).toBe(true);
    expect(decodeContext(zero.snapshot.context).y).toBe(-0);
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

  it('compares a patch for an absent __proto__ with Object.prototype', () => {
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
    assertAgrees(config, [
      { type: 'inherited', payload: 0 },
      { type: 'other', payload: 0 }
    ]);
  });

  it.each([
    ['a null-prototype context', Object.create(null), {}],
    ['a context with a symbol key', { [Symbol('s')]: 1 }, {}],
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
});
