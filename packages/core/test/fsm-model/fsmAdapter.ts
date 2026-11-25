import { createFSM } from '../../src/fsm.ts';
import {
  initialState,
  run,
  transition,
  type FSMEvent,
  type Machine,
  type StateNode,
  type Transition,
  type TransitionConfig,
  type Value
} from './fsmModel.ts';

// Runs the LemmaScript model's TypeScript beside `createFSM` and requires the
// same value, the same context entries under Object.is, and the same object
// reuse after every event. It also checks the parts of the snapshot surface
// the model leaves out.
//
// The model's contexts are plain objects whose keys are strings: ':' and the
// name for a string key, and '#' and an interned number for a symbol key. No
// Object.prototype property starts with ':' or '#', so `key in context` and
// `context[key]` in the model's TypeScript find own keys only, as Dafny map
// lookups and `createFSM`'s `Object.hasOwn` checks do. Values become the
// model's `Value`: integers, -0, NaN and undefined by kind, and everything
// else an opaque id interned by Object.is, so strings compare by content and
// objects by identity.

export type JsContext = Record<PropertyKey, unknown>;
export type JsEvent = { type: string; payload?: number };
export type JsTransitionConfig = { target?: string; context?: JsContext };
export type JsTransition =
  | JsTransitionConfig
  | ((args: {
      context: JsContext;
      event: JsEvent;
    }) => JsTransitionConfig | undefined)
  | undefined;
export type JsStateConfig = {
  on?: Record<string, JsTransition>;
  always?: JsTransition;
};
export type JsConfig = {
  initial: string;
  context?: JsContext;
  states: Record<string, JsStateConfig>;
};

export const DEFAULT_FUEL = 100;

const keyLabel = (key: PropertyKey) =>
  typeof key === 'symbol' ? key.toString() : JSON.stringify(key);

const setOwn = (object: object, key: PropertyKey, value: unknown) =>
  Object.defineProperty(object, key, {
    value,
    enumerable: true,
    writable: true,
    configurable: true
  });

// The model covers contexts and patches made of own, enumerable data
// properties, with string or symbol keys, on an object with any prototype.
// `createFSM` reads only own keys of both, so their prototypes never matter.
// It reads accessors more than once, and it finds a non-enumerable own
// context key with `Object.hasOwn` but drops it when spreading, so those
// inputs are refused.
export function assertPlainData(object: object, label: string) {
  for (const key of Reflect.ownKeys(object)) {
    const descriptor = Object.getOwnPropertyDescriptor(object, key)!;
    expect(
      'value' in descriptor && descriptor.enumerable,
      `${label}: ${keyLabel(key)} must be an enumerable data property`
    ).toBe(true);
  }
}

// The own data properties of `object`, and for each name the value from the
// nearest prototype below Object.prototype that has it, whether or not the
// object also owns the name. `createFSM` finds states and transitions with
// `Object.hasOwn`, which finds non-enumerable properties, so every string
// key counts. The inherited entries let the model state that `createFSM`
// ignores them. `createFSM` would run an own accessor on every lookup.
// Accessors are refused on every level, including the inherited entries
// `createFSM` never reads, which refuses some configs it handles.
function ownAndInherited<T>(
  object: object,
  label: string,
  convert: (value: unknown, key: string) => T | undefined
) {
  const levels: object[] = [];
  for (
    let level: object | null = object;
    level !== null && level !== Object.prototype;
    level = Object.getPrototypeOf(level)
  )
    levels.push(level);
  const [own, inherited] = [new Map<string, T>(), new Map<string, T>()];
  const seen = new Set<string>();
  for (const [depth, level] of levels.entries())
    for (const key of Object.getOwnPropertyNames(level)) {
      const descriptor = Object.getOwnPropertyDescriptor(level, key)!;
      expect(
        'value' in descriptor,
        `${label}: ${JSON.stringify(key)} must be a data property`
      ).toBe(true);
      if (depth > 0) {
        if (seen.has(key)) continue;
        seen.add(key);
      }
      const converted = convert(descriptor.value, key);
      if (converted !== undefined)
        (depth === 0 ? own : inherited).set(key, converted);
    }
  return { own, inherited };
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
  const symbols: symbol[] = [];
  const encodeKey = (key: PropertyKey) => {
    if (typeof key !== 'symbol') return `:${String(key)}`;
    if (!symbols.includes(key)) symbols.push(key);
    return `#${symbols.indexOf(key)}`;
  };
  const decodeKey = (key: string): PropertyKey =>
    key.startsWith('#') ? symbols[Number(key.slice(1))] : key.slice(1);
  const encodeContext = (object: JsContext, label: string) => {
    assertPlainData(object, label);
    const context: Record<string, Value> = {};
    for (const key of Reflect.ownKeys(object))
      setOwn(context, encodeKey(key), values.toValue(object[key]));
    return context;
  };
  // Setting keys in the model's order lets JavaScript move integer-like keys
  // first and symbols last, as it does for the objects `createFSM` spreads.
  const decodeContext = (context: Record<string, Value>) => {
    const object: JsContext = {};
    for (const [key, value] of Object.entries(context))
      setOwn(object, decodeKey(key), values.fromValue(value));
    return object;
  };
  const patchEntries = (patch: JsContext) => {
    assertPlainData(patch, 'patch');
    return Reflect.ownKeys(patch).map((key) => ({
      key: encodeKey(key),
      value: values.toValue(patch[key])
    }));
  };
  const decodeEvent = (event: FSMEvent): JsEvent =>
    event.payload === undefined
      ? { type: event.type }
      : { type: event.type, payload: event.payload };
  const toConfig = (
    result: JsTransitionConfig | undefined
  ): TransitionConfig | undefined => {
    expect(
      typeof result !== 'string',
      'transition result must be a config object or undefined, not a string'
    ).toBe(true);
    return result
      ? {
          target: result.target,
          context:
            result.context === undefined
              ? undefined
              : patchEntries(result.context)
        }
      : undefined;
  };
  const toTransition = (
    definition: Exclude<JsTransition, undefined>,
    label: string
  ): Transition => {
    expect(
      typeof definition !== 'string',
      `${label}: string transitions are rejected by createFSM`
    ).toBe(true);
    if (typeof definition === 'function')
      return {
        kind: 'function',
        compute: (context, event) =>
          toConfig(
            definition({
              context: decodeContext(context),
              event: decodeEvent(event)
            })
          )
      };
    return { kind: 'config', config: toConfig(definition)! };
  };
  // `createFSM` reads `state?.always` through the state object's prototype
  // chain (unlike `config.states` and `state.on`, which use `Object.hasOwn`).
  // Walk the chain below Object.prototype so accessors are refused at every
  // level and an inherited data property on a state node is faithfully modeled.
  const readAlways = (node: unknown, label: string): Transition | undefined => {
    if (node === null || node === undefined || typeof node !== 'object')
      return undefined;
    let found = false;
    let raw: unknown = undefined;
    for (
      let level: object | null = node;
      level !== null && level !== Object.prototype;
      level = Object.getPrototypeOf(level)
    ) {
      const descriptor = Object.getOwnPropertyDescriptor(level, 'always');
      if (descriptor === undefined) continue;
      expect(
        'value' in descriptor,
        `${label}.always must be a data property`
      ).toBe(true);
      if (!found) {
        found = true;
        raw = descriptor.value;
      }
    }
    return raw === undefined
      ? undefined
      : toTransition(
          raw as Exclude<JsTransition, undefined>,
          `${label}.always`
        );
  };
  // createFSM treats an undefined transition as no transition, so the
  // model's transition tables leave it out. An object config `{ target: '' }`
  // targets the empty-string state; raw string transitions are rejected by
  // createFSM and tested separately. A state whose `on` is missing has no
  // transitions, and it still shadows an inherited state of the same name.
  const toStateNode = (node: unknown, label: string): StateNode => {
    const { own, inherited } = ownAndInherited(
      (node as { on?: object } | null | undefined)?.on ?? {},
      `${label}.on`,
      (definition, key) =>
        definition === undefined
          ? undefined
          : toTransition(
              definition as Exclude<JsTransition, undefined>,
              `${label}.on[${JSON.stringify(key)}]`
            )
    );
    return {
      on: own,
      inheritedOn: inherited,
      always: readAlways(node, label)
    };
  };
  const states = ownAndInherited(config.states, 'config.states', (node, name) =>
    toStateNode(node, `config.states[${JSON.stringify(name)}]`)
  );
  const machine: Machine = {
    initial: config.initial,
    context:
      config.context === undefined
        ? undefined
        : encodeContext(config.context, 'config.context'),
    states: states.own,
    inheritedStates: states.inherited
  };
  return { machine, decodeContext };
}

export type JsSnapshot = { value: string; context: JsContext };
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
  const decoded = decodeContext(expected.context);
  const keys = Reflect.ownKeys(decoded);
  expect(Reflect.ownKeys(actual.context), `${label}: context keys`).toEqual(
    keys
  );
  for (const key of keys)
    expect(actual.context[key], `${label}: context ${keyLabel(key)}`).toBe(
      decoded[key]
    );
}

// `onStep` sees each createFSM snapshot and the event it is about to receive.
// The model runs first with a finite fuel bound so a non-terminating `always`
// chain fails cleanly instead of hanging the runtime test.
export function assertAgrees(
  config: JsConfig,
  events: readonly FSMEvent[],
  onStep?: (snapshot: JsSnapshot, event: FSMEvent) => void,
  fuel = DEFAULT_FUEL
) {
  const { machine, decodeContext } = toModel(config);
  const init = initialState(machine, fuel);
  expect(init.settled, 'initial: always chain must settle within fuel').toBe(
    true
  );
  const fsm = createFSM<JsContext, JsEvent>(config);
  let actual = fsm.initialState;
  let expected = init.snapshot;
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
    const label = `event ${index} (${event.type})`;
    const step = transition(machine, expected, event, fuel);
    expect(step.settled, `${label}: always chain must settle within fuel`).toBe(
      true
    );
    onStep?.(actual, event);
    const jsEvent: JsEvent =
      event.payload === undefined
        ? { type: event.type }
        : { type: event.type, payload: event.payload };
    const [next, effects] = fsm.transition(actual, jsEvent);
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
  const ran = run(machine, init.snapshot, events, fuel);
  expect(ran.settled, 'run: settled').toBe(true);
  assertSameSnapshot(actual, ran.snapshot, decodeContext, 'run');
}
