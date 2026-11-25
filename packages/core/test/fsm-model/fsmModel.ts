// LemmaScript model of `createFSM` from `xstate/fsm`. Its `transition` and
// `initialState` follow `packages/core/src/fsm.ts` on `next` after 757b605
// (inherited states are ignored), c70dd85 (patches compare own keys with
// Object.is), 65afd99 (object-only targets and eventless `always`
// transitions), and statelyai/xstate#5947 (an `always` transition that changes
// nothing ends the eventless chain). A context or patch value is a JavaScript
// value as `Object.is` tells them apart: an integer (`0` is +0), -0, NaN,
// undefined, or an opaque value with an id (strings by content; booleans,
// null, fractions, and objects by identity). A context patch is the entry list
// of the patch object, so its keys are distinct. Context, state, and
// transition tables are Maps, which find only own keys, as xstate's
// `Object.hasOwn` checks do.
export type Value =
  | { kind: 'integer'; value: number }
  | { kind: 'negativeZero' }
  | { kind: 'notANumber' }
  | { kind: 'undefinedValue' }
  | { kind: 'opaque'; id: number };
export type PatchEntry = { key: string; value: Value };
export type FSMEvent = { type: string; payload: number | undefined };
export type TransitionConfig = {
  target: string | undefined;
  context: readonly PatchEntry[] | undefined;
};
export type Transition =
  | { kind: 'config'; config: TransitionConfig }
  | {
      kind: 'function';
      compute: (
        context: Record<string, Value>,
        event: FSMEvent
      ) => TransitionConfig | undefined;
    };
// `inheritedOn` holds the transitions an `on` table inherits from its
// prototypes, which xstate never takes. `always` is the state's eventless
// transition, if any.
export type StateNode = {
  on: Map<string, Transition>;
  inheritedOn: Map<string, Transition>;
  always: Transition | undefined;
};
// `inheritedStates` holds, for each name, the state from the nearest prototype
// of `config.states` that has one, which xstate never reads.
export type Machine = {
  initial: string;
  context: Record<string, Value> | undefined;
  states: Map<string, StateNode>;
  inheritedStates: Map<string, StateNode>;
};
export type Snapshot = { value: string; context: Record<string, Value> };
export type Step = { snapshot: Snapshot; reused: boolean };
export type SettleResult = {
  snapshot: Snapshot;
  reused: boolean;
  settled: boolean;
};
export type RunResult = { snapshot: Snapshot; settled: boolean };

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

export function rawInitialState(machine: Machine): Snapshot {
  //@ verify
  //@ ensures \result.value === machine.initial
  return { value: machine.initial, context: machine.context ?? {} };
}

// `Object.hasOwn(config.states, value) ? config.states[value] : undefined`.
export function lookupState(
  machine: Machine,
  value: string
): StateNode | undefined {
  //@ verify
  //@ ensures !machine.states.has(value) ==> \result === undefined
  return machine.states.get(value);
}

export function lookupTransition(
  machine: Machine,
  value: string,
  type: string
): Transition | undefined {
  //@ verify
  //@ ensures !machine.states.has(value) ==> \result === undefined
  const node = lookupState(machine, value);
  if (node === undefined) return undefined;
  return node.on.get(type);
}

export function lookupAlways(
  machine: Machine,
  value: string
): Transition | undefined {
  //@ verify
  //@ ensures !machine.states.has(value) ==> \result === undefined
  const node = lookupState(machine, value);
  if (node === undefined) return undefined;
  return node.always;
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
    case 'config':
      return transition.config;
    case 'function': {
      const compute = transition.compute;
      return compute(context, event);
    }
  }
}

// `Object.hasOwn(context, key) && Object.is(patch[key], context[key])`.
export function entryUnchanged(
  context: Record<string, Value>,
  entry: PatchEntry
): boolean {
  //@ verify
  //@ ensures !(entry.key in context) ==> !\result
  if (entry.key in context) return sameValue(entry.value, context[entry.key]);
  return false;
}

// `step` copies when some patch entry is not unchanged.
export function patchChanges(
  context: Record<string, Value>,
  patch: readonly PatchEntry[]
): boolean {
  //@ verify
  //@ ensures patch.length === 0 ==> !\result
  return patch.some((entry) => !entryUnchanged(context, entry));
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

// Mirrors `step` in `fsm.ts`: returns `undefined` when no transition resolves,
// `{ snapshot, reused: true }` when the resolved transition changes nothing,
// and a new snapshot with `reused: false` otherwise.
export function applyTransition(
  selected: Transition | undefined,
  snapshot: Snapshot,
  event: FSMEvent
): Step | undefined {
  //@ verify
  //@ ensures \result !== undefined && \result.reused ==> \result.snapshot === snapshot
  const config = resolveTransition(selected, snapshot.context, event);
  if (config === undefined) return undefined;
  const target = config.target ?? snapshot.value;
  const patch = config.context ?? [];
  const changed = patchChanges(snapshot.context, patch);
  if (target === snapshot.value && !changed) return { snapshot, reused: true };
  return {
    snapshot: {
      value: target,
      context: changed ? mergePatch(snapshot.context, patch) : snapshot.context
    },
    reused: false
  };
}

// Fuel-bounded model of `settle` in `fsm.ts`. Stops with `settled: true` when
// the current state's `always` transition does not resolve or changes nothing;
// stops with `settled: false` if an enabled changing `always` remains after
// `fuel` transitions.
export function settle(
  machine: Machine,
  snapshot: Snapshot,
  event: FSMEvent,
  fuel: number
): SettleResult {
  //@ verify
  //@ requires fuel >= 0
  //@ ensures \result.reused ==> \result.snapshot === snapshot
  //@ decreases fuel
  const next = applyTransition(
    lookupAlways(machine, snapshot.value),
    snapshot,
    event
  );
  if (next === undefined || next.reused) {
    return { snapshot, reused: true, settled: true };
  }
  if (fuel === 0) {
    return { snapshot, reused: true, settled: false };
  }
  const rest = settle(machine, next.snapshot, event, fuel - 1);
  return {
    snapshot: rest.snapshot,
    reused: false,
    settled: rest.settled
  };
}

export function initialState(machine: Machine, fuel: number): SettleResult {
  //@ verify
  //@ requires fuel >= 0
  //@ ensures \result.reused ==> \result.snapshot === rawInitialState(machine)
  return settle(
    machine,
    rawInitialState(machine),
    { type: 'xstate.init', payload: undefined },
    fuel
  );
}

export function transition(
  machine: Machine,
  snapshot: Snapshot,
  event: FSMEvent,
  fuel: number
): SettleResult {
  //@ verify
  //@ requires fuel >= 0
  //@ ensures \result.reused ==> \result.snapshot === snapshot
  const next = applyTransition(
    lookupTransition(machine, snapshot.value, event.type),
    snapshot,
    event
  );
  if (next === undefined) {
    return { snapshot, reused: true, settled: true };
  }
  const settled = settle(machine, next.snapshot, event, fuel);
  return {
    snapshot: settled.snapshot,
    reused: next.reused && settled.reused,
    settled: settled.settled
  };
}

export function run(
  machine: Machine,
  snapshot: Snapshot,
  events: readonly FSMEvent[],
  fuel: number
): RunResult {
  //@ verify
  //@ requires fuel >= 0
  //@ ensures events.length === 0 ==> \result.snapshot === snapshot && \result.settled
  //@ decreases events.length
  if (events.length === 0) return { snapshot, settled: true };
  const step = transition(machine, snapshot, events[0], fuel);
  if (!step.settled) return { snapshot: step.snapshot, settled: false };
  return run(machine, step.snapshot, events.slice(1), fuel);
}
