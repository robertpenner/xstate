import * as fc from 'fast-check';
import {
  assertAgrees,
  type JsConfig,
  type JsTransition
} from './fsmAdapter.ts';

// Generated machines comparing the LemmaScript model with createFSM. The named
// cases are in fsmModel.test.ts.

const stateNames = ['a', 'b', 'c', '', '__proto__', 'toString'];
const eventTypes = ['go', 'back', 'toString', 'constructor', '__proto__', ''];
const contextKeys = ['x', 'y', 'toString', '__proto__'];

// Integers, -0, NaN and undefined have their own model kinds. Strings,
// booleans, fractions and references are opaque: the shared reference and
// equal strings compare equal, and each fresh object compares unequal.
const shared = { label: 'shared' };
const contextValue = fc.oneof(
  fc.integer({ min: -2, max: 2 }),
  fc.constantFrom<unknown>(
    -0,
    Number.NaN,
    0.5,
    undefined,
    'a',
    'b',
    true,
    shared
  ),
  fc.constant(null).map(() => ({ label: 'fresh' }))
);
// Builds objects with Object.fromEntries, which defines own data properties,
// so a `__proto__` entry is an own key.
const record = <T>(keys: string[], value: fc.Arbitrary<T>) =>
  fc
    .uniqueArray(fc.tuple(fc.constantFrom(...keys), value), {
      selector: ([key]) => key,
      maxLength: keys.length
    })
    .map((entries) => Object.fromEntries(entries));
const patch = record(contextKeys, contextValue);
const target = fc.constantFrom(...stateNames);
const configObject = fc.oneof(
  fc.constant({}),
  target.map((name) => ({ target: name })),
  patch.map((context) => ({ context })),
  fc.record({ target, context: patch }),
  fc.constant({ target: undefined })
);
const outcome = fc.oneof(
  fc.constant(undefined),
  configObject,
  fc.constantFrom('x', 'y').map((key) => ({ increment: key }))
);
// Function transitions choose an outcome from the event payload, and the
// increment outcome reads the current context.
const transitionFunction = fc
  .array(outcome, { minLength: 1, maxLength: 3 })
  .map(
    (outcomes): JsTransition =>
      ({ context, event }) => {
        const chosen = outcomes[Math.abs(event.payload) % outcomes.length];
        if (chosen === undefined || !('increment' in chosen)) return chosen;
        const key = chosen.increment;
        const current = context[key];
        return {
          context: {
            [key]: (typeof current === 'number' ? current : 0) + 1
          }
        };
      }
  );
const definition = fc.oneof(
  target,
  configObject,
  transitionFunction,
  fc.constant(undefined)
);
// Copies own data properties, keeping a `__proto__` key own, onto an object
// whose prototype is `base`. Both levels draw from the same names, so an own
// entry often shadows an inherited one.
const withPrototype = ([own, base]: [object, object]) =>
  Object.defineProperties(
    Object.create(base),
    Object.getOwnPropertyDescriptors(own)
  );
const table = <T>(keys: string[], value: fc.Arbitrary<T>) =>
  fc.oneof(
    { weight: 2, arbitrary: record(keys, value) },
    {
      weight: 1,
      arbitrary: fc
        .tuple(record(keys, value), record(keys, value))
        .map(withPrototype)
    }
  );
const stateNode = table(eventTypes, definition).map((on) => ({ on }));
const config: fc.Arbitrary<JsConfig> = fc.record(
  {
    initial: target,
    context: record(contextKeys, contextValue),
    states: table(stateNames, stateNode)
  },
  { requiredKeys: ['initial', 'states'] }
);
const event = fc.record({
  type: fc.constantFrom(...eventTypes),
  payload: fc.integer({ min: 0, max: 5 })
});

describe('the fsm model and createFSM', () => {
  it('agree on generated machines', () => {
    fc.assert(
      fc.property(config, fc.array(event, { maxLength: 12 }), assertAgrees),
      { numRuns: 1_000, interruptAfterTimeLimit: 4_000 }
    );
  });
});
