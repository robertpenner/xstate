// Values are interned by Object.is in the adapter. Encoded keys start with ":".
export type PatchEntry = { key: string; value: number };
export type Event = { type: string; value: number };
export type Effect = { action: number; args: readonly number[] };
export type Result = {
  target: string | undefined;
  patch: readonly PatchEntry[] | undefined;
  reenter: boolean;
};
export type Evaluation = {
  result: Result | undefined;
  effects: readonly Effect[];
};
export type Node = {
  on: Map<
    string,
    (context: Record<string, number>, event: Event) => Evaluation
  >;
  entry: (context: Record<string, number>, event: Event) => Evaluation;
  exit: (context: Record<string, number>, event: Event) => Evaluation;
};
export type Machine = {
  initial: string;
  context: Record<string, number>;
  states: Map<string, Node>;
};
export type Snapshot = { value: string; context: Record<string, number> };
export type Step = {
  snapshot: Snapshot;
  snapshotReused: boolean;
  contextReused: boolean;
  effects: readonly Effect[];
};

export type Applied = {
  context: Record<string, number>;
  reused: boolean;
  effects: readonly Effect[];
};

export function mergePatch(
  context: Record<string, number>,
  patch: readonly PatchEntry[]
): Record<string, number> {
  //@ verify
  //@ ensures patch.length === 0 ==> \result === context
  //@ decreases patch.length
  if (patch.length === 0) return context;
  const first = patch[0];
  return mergePatch({ ...context, [first.key]: first.value }, patch.slice(1));
}

export function apply(
  context: Record<string, number>,
  evaluation: Evaluation
): Applied {
  //@ verify
  //@ ensures \result.reused ==> \result.context === context
  const result = evaluation.result;
  const patch = result === undefined ? undefined : result.patch;
  return {
    context: patch === undefined ? context : mergePatch(context, patch),
    reused: patch === undefined,
    effects: evaluation.effects
  };
}

export function emptyEvaluation(): Evaluation {
  //@ verify
  //@ ensures \result.result === undefined
  return { result: undefined, effects: [] };
}

export function initialTransition(machine: Machine, event: Event): Step {
  //@ verify
  //@ ensures \result.snapshot.value === machine.initial
  const node = machine.states.get(machine.initial);
  const entry = node === undefined ? undefined : node.entry;
  const applied = apply(
    machine.context,
    entry === undefined ? emptyEvaluation() : entry(machine.context, event)
  );
  return {
    snapshot: { value: machine.initial, context: applied.context },
    snapshotReused: false,
    contextReused: applied.reused,
    effects: applied.effects
  };
}

export function transition(
  machine: Machine,
  snapshot: Snapshot,
  event: Event
): Step {
  //@ verify
  //@ ensures \result.snapshotReused ==> \result.snapshot === snapshot
  const node = machine.states.get(snapshot.value);
  const handler = node === undefined ? undefined : node.on.get(event.type);
  const selected =
    handler === undefined
      ? emptyEvaluation()
      : handler(snapshot.context, event);
  if (selected.result === undefined && selected.effects.length === 0) {
    return { snapshot, snapshotReused: true, contextReused: true, effects: [] };
  }
  const result = selected.result;
  const target = result === undefined ? undefined : result.target;
  const next = target ?? snapshot.value;
  const reenter = result === undefined ? false : result.reenter;
  const changes = target !== undefined && (next !== snapshot.value || reenter);
  const exit = node === undefined ? undefined : node.exit;
  const exited = apply(
    snapshot.context,
    changes && exit !== undefined
      ? exit(snapshot.context, event)
      : emptyEvaluation()
  );
  const updated = apply(exited.context, selected);
  const destination = machine.states.get(next);
  const entry = destination === undefined ? undefined : destination.entry;
  const entered = apply(
    updated.context,
    (changes || reenter) && entry !== undefined
      ? entry(updated.context, event)
      : emptyEvaluation()
  );
  return {
    snapshot: { value: next, context: entered.context },
    snapshotReused: false,
    contextReused: exited.reused && updated.reused && entered.reused,
    effects: [...exited.effects, ...updated.effects, ...entered.effects]
  };
}
