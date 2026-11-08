import { createFSM } from '../../src/fsm.ts';
import {
  initialState,
  run,
  transition,
  type FSMEvent,
  type Machine,
  type Transition,
  type TransitionConfig,
  type Value
} from './fsmModel.ts';

// Runs the LemmaScript model's TypeScript beside `createFSM` and requires the
// same value, the same context entries under Object.is, and the same object
// reuse after every event. It also checks the parts of the snapshot surface
// the model leaves out.
//
// The model's contexts are plain objects whose keys carry a ':' prefix. No
// Object.prototype property starts with ':', so `key in context` and
// `context[key]` in the model's TypeScript find own keys only, as Dafny map
// lookups do. Values become the model's `Value`: integers, -0, NaN and
// undefined by kind, and everything else an opaque id interned by Object.is,
// so strings compare by content and objects by identity.

export type JsContext = Record<string, unknown>;
export type JsTransitionConfig = { target?: string; context?: JsContext };
export type JsTransition =
  | string
  | JsTransitionConfig
  | ((args: {
      context: JsContext;
      event: FSMEvent;
    }) => JsTransitionConfig | undefined)
  | undefined;
export type JsConfig = {
  initial: string;
  context?: JsContext;
  states: Record<string, { on?: Record<string, JsTransition> }>;
};

const encodeKey = (key: string) => `:${key}`;
const decodeKey = (key: string) => key.slice(1);

const setOwn = (object: object, key: string, value: unknown) =>
  Object.defineProperty(object, key, {
    value,
    enumerable: true,
    writable: true,
    configurable: true
  });

// The model covers contexts and patches made of own, enumerable, string-keyed
// data properties on an object whose prototype is Object.prototype.
// `createFSM` reads accessors twice, skips symbol keys when comparing but
// copies them, and reads keys through other prototypes, so those inputs are
// refused.
export function assertPlainData(object: object, label: string) {
  expect(
    Object.getPrototypeOf(object),
    `${label}: prototype must be Object.prototype`
  ).toBe(Object.prototype);
  expect(
    Object.getOwnPropertySymbols(object),
    `${label}: symbol keys are outside the model`
  ).toEqual([]);
  for (const [key, descriptor] of Object.entries(
    Object.getOwnPropertyDescriptors(object)
  ))
    expect(
      'value' in descriptor && descriptor.enumerable,
      `${label}: ${JSON.stringify(key)} must be an enumerable data property`
    ).toBe(true);
}

class Values {
  #ids = new Map<unknown, number>();
  #opaque: unknown[] = [];

  toValue(value: unknown): Value {
    if (value === undefined) return { kind: 'undefinedValue' };
    if (typeof value === 'number') {
      if (Number.isNaN(value)) return { kind: 'notANumber' };
      if (Object.is(value, -0)) return { kind: 'negativeZero' };
      if (Number.isInteger(value)) return { kind: 'integer', value };
    }
    // Map keys compare with SameValueZero, which is Object.is apart from the
    // zeros and NaN handled above.
    let id = this.#ids.get(value);
    if (id === undefined) {
      id = this.#opaque.length;
      this.#ids.set(value, id);
      this.#opaque.push(value);
    }
    return { kind: 'opaque', id };
  }

  fromValue(value: Value): unknown {
    switch (value.kind) {
      case 'integer':
        return value.value;
      case 'negativeZero':
        return -0;
      case 'notANumber':
        return Number.NaN;
      case 'undefinedValue':
        return undefined;
      case 'opaque':
        return this.#opaque[value.id];
    }
  }
}

// Builds the model machine for a createFSM config, with the decoder that
// translates the model's contexts back to JavaScript objects.
export function toModel(config: JsConfig) {
  const values = new Values();
  const encodeContext = (object: JsContext, label: string) => {
    assertPlainData(object, label);
    const context: Record<string, Value> = {};
    for (const [key, value] of Object.entries(object))
      setOwn(context, encodeKey(key), values.toValue(value));
    return context;
  };
  // Setting keys in the model's order lets JavaScript move integer-like keys
  // first, as it does for the objects `createFSM` spreads.
  const decodeContext = (context: Record<string, Value>) => {
    const object: JsContext = {};
    for (const [key, value] of Object.entries(context))
      setOwn(object, decodeKey(key), values.fromValue(value));
    return object;
  };
  const patchEntries = (patch: JsContext) => {
    assertPlainData(patch, 'patch');
    return Object.entries(patch).map(([key, value]) => ({
      key: encodeKey(key),
      value: values.toValue(value)
    }));
  };
  const toConfig = (
    result: JsTransitionConfig | undefined
  ): TransitionConfig | undefined =>
    result
      ? {
          target: result.target,
          context:
            result.context === undefined
              ? undefined
              : patchEntries(result.context)
        }
      : undefined;
  const toTransition = (
    definition: Exclude<JsTransition, undefined>
  ): Transition => {
    if (typeof definition === 'string')
      return { kind: 'target', target: definition };
    if (typeof definition === 'function')
      return {
        kind: 'function',
        compute: (context, event) =>
          toConfig(definition({ context: decodeContext(context), event }))
      };
    return { kind: 'config', config: toConfig(definition)! };
  };
  const inherited: Record<string, Value> = {};
  for (const key of Object.getOwnPropertyNames(Object.prototype))
    setOwn(inherited, encodeKey(key), values.toValue(({} as JsContext)[key]));
  const machine: Machine = {
    initial: config.initial,
    context:
      config.context === undefined
        ? undefined
        : encodeContext(config.context, 'config.context'),
    inherited,
    // createFSM treats an undefined transition as no transition, so the
    // model's transition table leaves it out. The empty string is a target.
    states: new Map(
      Object.entries(config.states).map(([name, node]) => [
        name,
        {
          on: new Map(
            Object.entries(node.on ?? {}).flatMap(([type, definition]) =>
              definition === undefined
                ? []
                : [[type, toTransition(definition)] as const]
            )
          )
        }
      ])
    )
  };
  return { machine, decodeContext };
}

type JsSnapshot = { value: string; context: JsContext };
type ModelSnapshot = { value: string; context: Record<string, Value> };

function assertSurface(
  snapshot: { status: string; output: unknown; error: unknown },
  label: string
) {
  expect(Object.keys(snapshot).sort(), `${label}: keys`).toEqual([
    'context',
    'error',
    'output',
    'status',
    'value'
  ]);
  expect(snapshot.status, `${label}: status`).toBe('active');
  expect(snapshot.output, `${label}: output`).toBe(undefined);
  expect(snapshot.error, `${label}: error`).toBe(undefined);
}

function assertSameSnapshot(
  actual: JsSnapshot,
  expected: ModelSnapshot,
  decodeContext: (context: Record<string, Value>) => JsContext,
  label: string
) {
  expect(actual.value, `${label}: value`).toBe(expected.value);
  const entries = Object.entries(decodeContext(expected.context));
  expect(Object.keys(actual.context), `${label}: context keys`).toEqual(
    entries.map(([key]) => key)
  );
  for (const [key, value] of entries)
    expect(
      actual.context[key],
      `${label}: context ${JSON.stringify(key)}`
    ).toBe(value);
}

export function assertAgrees(config: JsConfig, events: readonly FSMEvent[]) {
  const fsm = createFSM<JsContext, FSMEvent>(config);
  const { machine, decodeContext } = toModel(config);
  let actual = fsm.initialState;
  let expected = initialState(machine);
  assertSurface(actual, 'initial');
  assertSameSnapshot(actual, expected, decodeContext, 'initial');
  expect(actual.context === config.context, 'initial context identity').toBe(
    expected.context === machine.context
  );
  const [initial, initialEffects] = fsm.initialTransition();
  expect(initial, 'initialTransition snapshot').toBe(actual);
  expect(initialEffects, 'initialTransition effects').toEqual([]);
  expect(fsm.getInitialSnapshot(), 'getInitialSnapshot').toBe(actual);
  for (const [index, event] of events.entries()) {
    const [next, effects] = fsm.transition(actual, event);
    const step = transition(machine, expected, event);
    const label = `event ${index} (${event.type})`;
    assertSurface(next, label);
    expect(effects, `${label}: effects`).toEqual([]);
    expect(fsm.getPersistedSnapshot(next), `${label}: persisted`).toBe(next);
    assertSameSnapshot(next, step.snapshot, decodeContext, label);
    expect(next === actual, `${label}: snapshot reuse`).toBe(step.reused);
    expect(next.context === actual.context, `${label}: context reuse`).toBe(
      step.snapshot.context === expected.context
    );
    actual = next;
    expected = step.snapshot;
  }
  assertSameSnapshot(
    actual,
    run(machine, initialState(machine), events),
    decodeContext,
    'run'
  );
}
