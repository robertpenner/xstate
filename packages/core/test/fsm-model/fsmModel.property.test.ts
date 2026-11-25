import * as fc from 'fast-check';
import fixture from './atm-prefix-replay.json';
import { assertAtmReplay } from './atmReplay';
import {
  assertAgrees,
  type JsConfig,
  type JsContext,
  type JsEvent,
  type JsSnapshot,
  type JsStateConfig,
  type JsTransition,
  type JsTransitionConfig
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
        const chosen = outcomes[Math.abs(event.payload ?? 0) % outcomes.length];
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
  configObject,
  transitionFunction,
  fc.constant(undefined)
);

// Always transitions are restricted so every generated machine settles within
// a small finite bound (<= 42 steps < DEFAULT_FUEL):
// - any target change moves to a strictly higher index in `stateNames`;
// - any in-place config uses a fixed patch (settles in <= 1 step);
// - any in-place increment caps `x` at 3 (settles in <= 6 steps).
const alwaysForRank = (
  rank: number
): fc.Arbitrary<JsTransition | undefined> => {
  const selfName = stateNames[rank];
  const higherNames = stateNames.slice(rank + 1);
  const higherTarget =
    higherNames.length > 0 ? fc.constantFrom(...higherNames) : undefined;
  const safeConfig: fc.Arbitrary<JsTransitionConfig> = higherTarget
    ? fc.oneof(
        fc.constant({}),
        fc.constant({ target: selfName }),
        higherTarget.map((name) => ({ target: name })),
        patch.map((context) => ({ context })),
        fc.record({ target: higherTarget, context: patch }),
        fc.constant({ target: undefined })
      )
    : fc.oneof(
        fc.constant({}),
        fc.constant({ target: selfName }),
        patch.map((context) => ({ context })),
        fc.constant({ target: undefined })
      );
  const safeOutcome = fc.oneof(
    fc.constant(undefined),
    safeConfig,
    fc.constant({ boundedIncrement: 'x' as const })
  );
  const safeFunction = fc
    .array(safeOutcome, { minLength: 1, maxLength: 3 })
    .map(
      (outcomes): JsTransition =>
        ({ context, event }) => {
          const index =
            event.type === 'xstate.init'
              ? 0
              : Math.abs(event.payload ?? 0) % outcomes.length;
          const chosen = outcomes[index];
          if (chosen === undefined || !('boundedIncrement' in chosen))
            return chosen;
          const key = chosen.boundedIncrement;
          const current = context[key];
          const n =
            typeof current === 'number' && Number.isFinite(current)
              ? current
              : 0;
          if (n >= 3) return undefined;
          return { context: { [key]: n + 1 } };
        }
    );
  return fc.oneof(
    { weight: 2, arbitrary: fc.constant(undefined) },
    { weight: 1, arbitrary: safeConfig },
    { weight: 1, arbitrary: safeFunction }
  );
};

// Pre-built once at module load so `.chain(...)` never reconstructs fast-check
// arbitrary trees on every generated machine.
const onTable = table(eventTypes, definition, 1);
const stateNodeWithoutAlways: fc.Arbitrary<JsStateConfig> = onTable.map(
  (on) => ({ on })
);
const alwaysByRank = stateNames.map((_, rank) => alwaysForRank(rank));
const stateNodeWithAlwaysByName = new Map<string, fc.Arbitrary<JsStateConfig>>(
  stateNames.map((name, rank) => [
    name,
    fc
      .tuple(onTable, alwaysByRank[rank], fc.boolean())
      .map(([on, always, inheritAlways]) => {
        if (always === undefined) return { on };
        if (!inheritAlways) return { on, always };
        const node = Object.create({ always }) as JsStateConfig;
        node.on = on;
        return node;
      })
  ])
);

const statesRecord = (
  allowAlways: boolean,
  minLength = 0
): fc.Arbitrary<Record<string, JsStateConfig>> =>
  allowAlways
    ? fc
        .uniqueArray(fc.constantFrom(...stateNames), {
          minLength,
          maxLength: stateNames.length,
          size: '+1'
        })
        .chain((names) =>
          names.length === 0
            ? fc.constant({})
            : fc
                .tuple(
                  ...names.map((name) => stateNodeWithAlwaysByName.get(name)!)
                )
                .map((nodes) =>
                  Object.fromEntries(names.map((name, i) => [name, nodes[i]]))
                )
        )
    : record(stateNames, stateNodeWithoutAlways, minLength);

const statesTable = (allowAlways: boolean) =>
  fc.oneof(
    { weight: 2, arbitrary: statesRecord(allowAlways, 2) },
    {
      weight: 1,
      arbitrary: fc
        .tuple(statesRecord(allowAlways, 2), statesRecord(allowAlways, 0))
        .map(withPrototype)
    }
  );

// A machine that starts in, or moves to, a state it does not own has no
// transitions for the rest of the run. So every machine owns at least two
// states, two in three initial states are own states, and two in three
// events use a type that some own state defines. Roughly two in three
// machines may declare `always` transitions; the rest exercise the no-always
// fast path.
const parts: fc.Arbitrary<Omit<JsConfig, 'initial'>> = fc.oneof(
  {
    weight: 2,
    arbitrary: fc.record(
      {
        context: record(contextKeys, contextValue),
        states: statesTable(true)
      },
      { requiredKeys: ['states'] }
    )
  },
  {
    weight: 1,
    arbitrary: fc.record(
      {
        context: record(contextKeys, contextValue),
        states: statesTable(false)
      },
      { requiredKeys: ['states'] }
    )
  }
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
// snapshot and event the way createFSM does. Transition functions run once
// more here; the generated ones are pure.
const isOpaque = (value: unknown) =>
  !(value === undefined || Number.isInteger(value) || Number.isNaN(value));

function applyForLabels(
  snapshot: JsSnapshot,
  selected: JsTransition | undefined,
  event: JsEvent,
  labels: string[]
): { next: JsSnapshot; changed: boolean } | undefined {
  const result =
    typeof selected === 'function'
      ? selected({ context: snapshot.context, event })
      : selected;
  if (!result) return undefined;
  let { value, context } = snapshot;
  const { target = value, context: patch } = result;
  if (patch !== undefined) {
    const keys = Reflect.ownKeys({ ...patch });
    const changedIndex = keys.findIndex(
      (key) =>
        !Object.hasOwn(context, key) || !Object.is(patch[key], context[key])
    );
    labels.push(
      changedIndex === -1
        ? 'patch: changes nothing'
        : changedIndex === 0
          ? 'patch: first key changes'
          : 'patch: a later key changes'
    );
    for (const key of keys) {
      const [nextVal, currentVal] = [patch[key], context[key]];
      if (!Object.hasOwn(context, key)) labels.push('entry: absent key');
      else if (Number.isNaN(nextVal) && Number.isNaN(currentVal))
        labels.push('entry: NaN over own NaN');
      else if (
        nextVal === 0 &&
        currentVal === 0 &&
        !Object.is(nextVal, currentVal)
      )
        labels.push('entry: -0 over 0, or 0 over -0');
      else if (isOpaque(nextVal)) labels.push('entry: opaque value');
    }
    if (changedIndex !== -1) context = { ...context, ...patch };
  }
  const changed = target !== value || context !== snapshot.context;
  return { next: changed ? { value: target, context } : snapshot, changed };
}

function settleLabels(
  config: JsConfig,
  start: JsSnapshot,
  event: JsEvent,
  kind: 'initial' | 'event'
) {
  const labels: string[] = [];
  let current = start;
  let fired = 0;
  for (;;) {
    const ownState = Object.hasOwn(config.states, current.value);
    const node = ownState ? config.states[current.value] : undefined;
    const always = node?.always;
    if (always === undefined) break;
    if (!Object.hasOwn(node!, 'always'))
      labels.push('always: inherited on own state');
    const step = applyForLabels(current, always, event, labels);
    if (!step) {
      labels.push('always: undefined stops');
      break;
    }
    if (!step.changed) {
      labels.push('always: noop stops');
      break;
    }
    fired += 1;
    current = step.next;
  }
  if (fired > 0) labels.push(`always: ${kind} fires`);
  if (fired >= 2) labels.push('always: chain');
  return labels;
}

function initialLabels(config: JsConfig) {
  const labels: string[] = [];
  const hasAlways = Object.getOwnPropertyNames(config.states).some(
    (name) => config.states[name]?.always !== undefined
  );
  if (!hasAlways) {
    labels.push('always: no always fast path');
    return labels;
  }
  return settleLabels(
    config,
    { value: config.initial, context: config.context ?? {} },
    { type: 'xstate.init' },
    'initial'
  );
}

function stepLabels(config: JsConfig, snapshot: JsSnapshot, event: FSMEvent) {
  const labels: string[] = [];
  const { states } = config;
  const ownState = Object.hasOwn(states, snapshot.value);
  if (!ownState && snapshot.value in states) labels.push('state: inherited');
  const node = ownState ? states[snapshot.value] : undefined;
  const on = node?.on;
  const definition =
    on && Object.hasOwn(on, event.type) ? on[event.type] : undefined;
  labels.push(
    `transition: ${definition === undefined ? 'missing' : typeof definition}`
  );
  const step = applyForLabels(snapshot, definition, event, labels);
  if (!step) {
    if (node?.always !== undefined)
      labels.push('always: skipped on unhandled event');
    return labels;
  }
  labels.push(...settleLabels(config, step.next, event, 'event'));
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
  ['entry: opaque value', 20, 'strings and references under Object.is'],
  [
    'always: no always fast path',
    100,
    'skipping settle when hasAlways is false'
  ],
  ['always: initial fires', 30, 'initial state settling via always'],
  ['always: event fires', 15, 'post-event settling via always'],
  ['always: chain', 15, 'multi-step always chains in one settle'],
  ['always: noop stops', 50, 'stopping settle on unchanged snapshot (#5947)'],
  [
    'always: undefined stops',
    50,
    'stopping settle when always returns undefined'
  ],
  [
    'always: inherited on own state',
    50,
    'reading always through own state prototype'
  ],
  [
    'always: skipped on unhandled event',
    100,
    'not settling when an event has no transition'
  ]
];

// scripts/fsm-model-mutants.mjs sets FSM_MODEL_SEED so each mutant meets the
// same generated machines. FSM_MODEL_REPORT=1 prints the label counts.
const seed = process.env.FSM_MODEL_SEED;

describe('the fsm model and createFSM', () => {
  it('replays the generated ATM events on both expiry variants', () => {
    const event = fc
      .constantFrom('LOGIN', 'EXPIRE', 'IGNORED')
      .map((type) => ({ type, payload: 0 }));
    const traces = fc.sample(fc.array(event, { maxLength: 8 }), {
      seed: 5056,
      numRuns: 12
    });
    expect(traces).toEqual(fixture.generated.map((trace) => trace.events));
    fixture.generated.forEach(assertAtmReplay);
  });

  it('agree on generated machines', () => {
    const counts = new Map<string, number>();
    const count = (label: string) =>
      counts.set(label, (counts.get(label) ?? 0) + 1);
    fc.assert(
      fc.property(machine, ([generated, events]) => {
        initialLabels(generated).forEach(count);
        assertAgrees(generated, events, (snapshot, step) => {
          count('step');
          stepLabels(generated, snapshot, step).forEach(count);
        });
      }),
      {
        numRuns: 1_000,
        ...(seed === undefined
          ? { interruptAfterTimeLimit: 25_000 }
          : { seed: Number(seed) })
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
  }, 30_000);
});
