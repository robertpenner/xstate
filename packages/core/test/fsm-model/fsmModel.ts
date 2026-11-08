// LemmaScript model of `createFSM` from `xstate/fsm`. Its `transition` follows
// `packages/core/src/fsm.ts`, which matches the published 6.0.0-beta.1 build.
// A context or patch value is a JavaScript value as `Object.is` tells them
// apart: an integer (`0` is +0), -0, NaN, undefined, or an opaque value with an
// id (strings by content; booleans, null, fractions, and objects by `===`).
// `strictEquals` is JavaScript `===` over these values. A context patch is the entry list of the patch object, so its keys
// are distinct. Transition tables are Maps, which find only own keys, as
// xstate's `Object.hasOwn` lookup does.
export type Value =
  | { kind: 'integer'; value: number }
  | { kind: 'negativeZero' }
  | { kind: 'notANumber' }
  | { kind: 'undefinedValue' }
  | { kind: 'opaque'; id: number };
export type PatchEntry = { key: string; value: Value };
export type FSMEvent = { type: string; payload: number };
export type TransitionConfig = {
  target: string | undefined;
  context: readonly PatchEntry[] | undefined;
};
export type Transition =
  | { kind: 'target'; target: string }
  | { kind: 'config'; config: TransitionConfig }
  | {
      kind: 'function';
      compute: (
        context: Record<string, Value>,
        event: FSMEvent
      ) => TransitionConfig | undefined;
    };
export type StateNode = { on: Map<string, Transition> };
// `inherited` holds the values a context reads for keys it does not own: the
// properties of its prototype, Object.prototype.
export type Machine = {
  initial: string;
  context: Record<string, Value> | undefined;
  inherited: Record<string, Value>;
  states: Map<string, StateNode>;
};
export type Snapshot = { value: string; context: Record<string, Value> };
export type Step = { snapshot: Snapshot; reused: boolean };

// JavaScript `===`.
export function strictEquals(a: Value, b: Value): boolean {
  //@ verify
  //@ ensures a.kind === 'notANumber' ==> !\result
  switch (a.kind) {
    case 'integer':
      return b.kind === 'integer'
        ? b.value === a.value
        : b.kind === 'negativeZero' && a.value === 0;
    case 'negativeZero':
      return b.kind === 'integer' ? b.value === 0 : b.kind === 'negativeZero';
    case 'notANumber':
      return false;
    case 'undefinedValue':
      return b.kind === 'undefinedValue';
    case 'opaque':
      return b.kind === 'opaque' ? b.id === a.id : false;
  }
}

// JavaScript `Object.is`.
export function sameValue(a: Value, b: Value): boolean {
  //@ verify
  //@ ensures \result === (a === b)
  switch (a.kind) {
    case 'integer':
      return b.kind === 'integer' ? b.value === a.value : false;
    case 'negativeZero':
      return b.kind === 'negativeZero';
    case 'notANumber':
      return b.kind === 'notANumber';
    case 'undefinedValue':
      return b.kind === 'undefinedValue';
    case 'opaque':
      return b.kind === 'opaque' ? b.id === a.id : false;
  }
}

// `context[key]`: the own value, else the inherited value, else undefined.
export function read(
  inherited: Record<string, Value>,
  context: Record<string, Value>,
  key: string
): Value {
  //@ verify
  //@ ensures key in context ==> \result === context[key]
  if (key in context) return context[key];
  if (key in inherited) return inherited[key];
  return { kind: 'undefinedValue' };
}

export function initialState(machine: Machine): Snapshot {
  //@ verify
  //@ ensures \result.value === machine.initial
  return { value: machine.initial, context: machine.context ?? {} };
}

export function lookupTransition(
  machine: Machine,
  value: string,
  type: string
): Transition | undefined {
  //@ verify
  //@ ensures !machine.states.has(value) ==> \result === undefined
  const node = machine.states.get(value);
  if (node === undefined) return undefined;
  return node.on.get(type);
}

export function resolveTransition(
  transition: Transition | undefined,
  context: Record<string, Value>,
  event: FSMEvent
): TransitionConfig | undefined {
  //@ verify
  //@ ensures transition === undefined ==> \result === undefined
  if (transition === undefined) return undefined;
  switch (transition.kind) {
    case 'target':
      return { target: transition.target, context: undefined };
    case 'config':
      return transition.config;
    case 'function': {
      const compute = transition.compute;
      return compute(context, event);
    }
  }
}

// `transition` copies when `patch[key] !== context[key]` for some patch key.
export function patchChanges(
  inherited: Record<string, Value>,
  context: Record<string, Value>,
  patch: readonly PatchEntry[]
): boolean {
  //@ verify
  //@ ensures patch.length === 0 ==> !\result
  return patch.some(
    (entry) => !strictEquals(entry.value, read(inherited, context, entry.key))
  );
}

export function mergePatch(
  context: Record<string, Value>,
  patch: readonly PatchEntry[]
): Record<string, Value> {
  //@ verify
  //@ ensures patch.length === 0 ==> \result === context
  //@ decreases patch.length
  if (patch.length === 0) return context;
  const entry = patch[0];
  return mergePatch({ ...context, [entry.key]: entry.value }, patch.slice(1));
}

export function transition(
  machine: Machine,
  snapshot: Snapshot,
  event: FSMEvent
): Step {
  //@ verify
  //@ ensures \result.reused ==> \result.snapshot === snapshot
  const config = resolveTransition(
    lookupTransition(machine, snapshot.value, event.type),
    snapshot.context,
    event
  );
  if (config === undefined) return { snapshot, reused: true };
  const target = config.target ?? snapshot.value;
  const patch = config.context ?? [];
  const changed = patchChanges(machine.inherited, snapshot.context, patch);
  if (target === snapshot.value && !changed) return { snapshot, reused: true };
  return {
    snapshot: {
      value: target,
      context: changed ? mergePatch(snapshot.context, patch) : snapshot.context
    },
    reused: false
  };
}

export function run(
  machine: Machine,
  snapshot: Snapshot,
  events: readonly FSMEvent[]
): Snapshot {
  //@ verify
  //@ ensures events.length === 0 ==> \result === snapshot
  //@ decreases events.length
  if (events.length === 0) return snapshot;
  return run(
    machine,
    transition(machine, snapshot, events[0]).snapshot,
    events.slice(1)
  );
}
