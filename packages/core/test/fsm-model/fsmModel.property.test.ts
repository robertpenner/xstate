import * as fc from 'fast-check';
import {
  assertAgrees,
  type JsConfig,
  type JsContext,
  type JsSnapshot,
  type JsTransition
} from './fsmAdapter.ts';
import type { FSMEvent } from './fsmModel.ts';

// Generated machines comparing the LemmaScript model with createFSM. The named
// cases are in fsmModel.test.ts.

const stateNames = ['a', 'b', 'c', '', '__proto__', 'toString'];
const eventTypes = ['go', 'back', 'toString', 'constructor', '__proto__', ''];
const contextKeys: PropertyKey[] = [
  'x',
  'y',
  'toString',
  '__proto__',
  Symbol('shared')
];

// Integers, -0, NaN and undefined have their own model kinds. Strings,
// booleans, fractions and references are opaque: the shared reference and
// equal strings compare equal, and each fresh object compares unequal.
// `undefined` has its own branch because a patch of `undefined` for a key the
// context does not own is the case where own-key and prototype reads differ.
// 0, -0 and NaN are weighted up because Object.is and === disagree only on
// them, and a patch must meet a context holding the same key and value class.
const shared = { label: 'shared' };
const contextValue = fc.oneof(
  fc.integer({ min: -2, max: 2 }),
  { weight: 2, arbitrary: fc.constantFrom(0, -0, Number.NaN) },
  fc.constant(undefined),
  fc.constantFrom<unknown>(0.5, 'a', 'b', true, shared),
  fc.constant(null).map(() => ({ label: 'fresh' }))
);
// Builds objects with Object.fromEntries, which defines own data properties,
// so a `__proto__` entry is an own key.
const record = <T>(
  keys: PropertyKey[],
  value: fc.Arbitrary<T>,
  minLength = 0
) =>
  fc
    .uniqueArray(fc.tuple(fc.constantFrom(...keys), value), {
      selector: ([key]) => key,
      minLength,
      maxLength: keys.length,
      size: '+1'
    })
    .map((entries) => Object.fromEntries(entries));
// Copies own data properties, keeping a `__proto__` key own, onto an object
// whose prototype is `base`. Both levels draw from the same names, so an own
// entry often shadows an inherited one.
const withPrototype = ([own, base]: [object, object]) =>
  Object.defineProperties(
    Object.create(base),
    Object.getOwnPropertyDescriptors(own)
  );
// `minLength` applies to the own entries.
const table = <T>(keys: PropertyKey[], value: fc.Arbitrary<T>, minLength = 0) =>
  fc.oneof(
    { weight: 2, arbitrary: record(keys, value, minLength) },
    {
      weight: 1,
      arbitrary: fc
        .tuple(record(keys, value, minLength), record(keys, value))
        .map(withPrototype)
    }
  );
// createFSM reads only a patch's own keys, so an inherited patch entry
// changes nothing. Contexts stay without inherited entries: function
// transitions read the adapter's decoded copy, which has no prototype.
const patch = table(contextKeys, contextValue);
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
const stateNode = table(eventTypes, definition, 1).map((on) => ({ on }));
// A machine that starts in, or moves to, a state it does not own has no
// transitions for the rest of the run. So every machine owns at least two
// states, two in three initial states are own states, and two in three
// events use a type that some own state defines.
const parts: fc.Arbitrary<Omit<JsConfig, 'initial'>> = fc.record(
  {
    context: record(contextKeys, contextValue),
    states: table(stateNames, stateNode, 2)
  },
  { requiredKeys: ['states'] }
);
const preferring = (all: readonly string[], preferred: readonly string[]) =>
  fc.oneof(fc.constantFrom(...all), {
    weight: 2,
    arbitrary: fc.constantFrom(...preferred)
  });
const machine = parts.chain((generated) => {
  const ownStates = Object.keys(generated.states);
  const declared = [
    ...new Set(
      Object.values(generated.states).flatMap((node) =>
        Object.entries(node.on ?? {}).flatMap(([type, definition]) =>
          definition === undefined ? [] : [type]
        )
      )
    )
  ];
  const type =
    declared.length === 0
      ? fc.constantFrom(...eventTypes)
      : preferring(eventTypes, declared);
  const event = fc.record({ type, payload: fc.integer({ min: 0, max: 5 }) });
  return fc.tuple(
    preferring(stateNames, ownStates).map(
      (initial): JsConfig => ({ initial, ...generated })
    ),
    fc.array(event, { maxLength: 12 })
  );
});

// Labels each step by the createFSM code path it takes, reading config,
// snapshot and event the way createFSM does. A transition function runs once
// more here; the generated ones are pure.
const isOpaque = (value: unknown) =>
  !(value === undefined || Number.isInteger(value) || Number.isNaN(value));
function stepLabels(
  config: JsConfig,
  { value, context }: JsSnapshot,
  event: FSMEvent
) {
  const labels: string[] = [];
  const { states } = config;
  const ownState = Object.hasOwn(states, value);
  if (!ownState && value in states) labels.push('state: inherited');
  const on = ownState ? states[value]?.on : undefined;
  const definition =
    on && Object.hasOwn(on, event.type) ? on[event.type] : undefined;
  labels.push(
    `transition: ${definition === undefined ? 'missing' : typeof definition}`
  );
  const result =
    typeof definition === 'function'
      ? definition({ context, event })
      : typeof definition === 'object'
        ? definition
        : undefined;
  const patch: JsContext | undefined = result?.context;
  if (patch === undefined) return labels;
  const keys = Reflect.ownKeys(patch);
  const changed = keys.findIndex(
    (key) =>
      !Object.hasOwn(context, key) || !Object.is(patch[key], context[key])
  );
  labels.push(
    changed === -1
      ? 'patch: changes nothing'
      : changed === 0
        ? 'patch: first key changes'
        : 'patch: a later key changes'
  );
  for (const key of keys) {
    const [next, current] = [patch[key], context[key]];
    if (!Object.hasOwn(context, key)) labels.push('entry: absent key');
    else if (Number.isNaN(next) && Number.isNaN(current))
      labels.push('entry: NaN over own NaN');
    else if (next === 0 && current === 0 && !Object.is(next, current))
      labels.push('entry: -0 over 0, or 0 over -0');
    else if (isOpaque(next)) labels.push('entry: opaque value');
  }
  return labels;
}

// The fewest steps each label needs in one run, and the createFSM behavior
// that label exercises. Eight seeds gave three to four times these counts;
// the margin covers other seeds and runs that the time limit cuts short. The
// README lists the counts.
const minimums: [label: string, minimum: number, exercises: string][] = [
  ['step', 2_000, 'most of the 1,000 runs, each up to 12 events'],
  [
    'transition: missing',
    1_000,
    'no own state, no own event entry, or an undefined entry'
  ],
  ['transition: string', 100, 'a target-only transition'],
  ['transition: function', 150, 'a function that reads the context'],
  ['transition: object', 150, 'a transition config object'],
  ['state: inherited', 100, 'the own-key guard on config.states'],
  ['patch: changes nothing', 25, 'snapshot reuse after a patch'],
  ['patch: first key changes', 100, 'copying the context'],
  [
    'patch: a later key changes',
    1,
    'checking every key after an unchanged one'
  ],
  ['entry: absent key', 100, 'the own-key check before comparing'],
  ['entry: NaN over own NaN', 5, 'Object.is treating NaN as unchanged'],
  [
    'entry: -0 over 0, or 0 over -0',
    2,
    'Object.is treating signed zeros as changed'
  ],
  ['entry: opaque value', 20, 'strings and references under Object.is']
];

// scripts/fsm-model-mutants.mjs sets FSM_MODEL_SEED so each mutant meets the
// same generated machines. FSM_MODEL_REPORT=1 prints the label counts.
const seed = process.env.FSM_MODEL_SEED;

describe('the fsm model and createFSM', () => {
  it('agree on generated machines', () => {
    const counts = new Map<string, number>();
    const count = (label: string) =>
      counts.set(label, (counts.get(label) ?? 0) + 1);
    fc.assert(
      fc.property(machine, ([generated, events]) =>
        assertAgrees(generated, events, (snapshot, step) => {
          count('step');
          stepLabels(generated, snapshot, step).forEach(count);
        })
      ),
      {
        numRuns: 1_000,
        interruptAfterTimeLimit: 4_000,
        ...(seed === undefined ? {} : { seed: Number(seed) })
      }
    );
    const report = [...counts]
      .sort()
      .map(([label, n]) => `${label}: ${n}`)
      .join('\n');
    if (process.env.FSM_MODEL_REPORT) console.log(report);
    for (const [label, minimum, exercises] of minimums)
      expect(
        counts.get(label) ?? 0,
        `${label} (${exercises}); counts:\n${report}`
      ).toBeGreaterThanOrEqual(minimum);
  });
});
