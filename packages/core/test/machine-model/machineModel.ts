// Values are interned by Object.is in the adapter. User keys start with ":".
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

export type CompoundNode = {
  path: readonly string[];
  initialPath: readonly string[];
  children: readonly string[];
  initial: string | undefined;
  on: Map<
    string,
    (context: Record<string, number>, event: Event) => Evaluation
  >;
  entry: (context: Record<string, number>, event: Event) => Evaluation;
  exit: (context: Record<string, number>, event: Event) => Evaluation;
};
export type CompoundMachine = {
  root: string;
  context: Record<string, number>;
  nodes: Record<string, CompoundNode>;
};
export type CompoundSnapshot = {
  path: readonly string[];
  context: Record<string, number>;
};
export type Selection = {
  id: string;
  node: CompoundNode;
  evaluation: Evaluation;
};
export type CompoundStep = {
  snapshot: CompoundSnapshot;
  snapshotReused: boolean;
  contextReused: boolean;
  effects: readonly Effect[];
};

export function declaredPath(
  nodes: Record<string, CompoundNode>,
  path: readonly string[]
): boolean {
  //@ verify
  //@ ensures path.length === 0 ==> \result
  //@ decreases path.length
  if (path.length === 0) return true;
  return path[0] in nodes && declaredPath(nodes, path.slice(1));
}

export function lookupNode(
  nodes: Record<string, CompoundNode>,
  id: string
): CompoundNode {
  //@ verify
  //@ requires id in nodes
  return nodes[id];
}

export function select(
  nodes: Record<string, CompoundNode>,
  path: readonly string[],
  context: Record<string, number>,
  event: Event
): Selection | undefined {
  //@ verify
  //@ requires declaredPath(nodes, path)
  //@ ensures path.length === 0 ==> \result === undefined
  //@ decreases path.length
  if (path.length === 0) return undefined;
  const id = path[path.length - 1];
  const node = lookupNode(nodes, id);
  const on: Map<
    string,
    (context: Record<string, number>, event: Event) => Evaluation
  > = node.on;
  const handler = on.get(event.type);
  const evaluation =
    handler === undefined ? emptyEvaluation() : handler(context, event);
  if (evaluation.result !== undefined || evaluation.effects.length > 0) {
    return { id, node, evaluation };
  }
  return select(nodes, path.slice(0, path.length - 1), context, event);
}

export function commonPrefix(
  a: readonly string[],
  b: readonly string[]
): number {
  //@ verify
  //@ ensures 0 <= \result && \result <= a.length && \result <= b.length
  //@ decreases a.length
  if (a.length === 0 || b.length === 0) return 0;
  if (a[0] !== b[0]) return 0;
  return 1 + commonPrefix(a.slice(1), b.slice(1));
}

export function initialWitness(
  nodes: Record<string, CompoundNode>,
  id: string
): boolean {
  //@ verify
  //@ requires id in nodes
  const node = lookupNode(nodes, id);
  if (node.path.length > node.initialPath.length) return false;
  const initial = node.initial;
  if (initial === undefined) {
    return (
      node.path.length === node.initialPath.length &&
      commonPrefix(node.path, node.initialPath) === node.path.length
    );
  }
  if (!(initial in nodes)) return false;
  const child = lookupNode(nodes, initial);
  return (
    child.path.length > node.path.length &&
    child.initialPath.length === node.initialPath.length &&
    commonPrefix(child.initialPath, node.initialPath) ===
      node.initialPath.length
  );
}

export function descend(
  nodes: Record<string, CompoundNode>,
  id: string
): readonly string[] {
  //@ verify
  //@ requires id in nodes
  //@ requires forall(k: string, k in nodes ==> initialWitness(nodes, k))
  //@ ensures \result === lookupNode(nodes, id).initialPath
  //@ decreases lookupNode(nodes, id).initialPath.length - lookupNode(nodes, id).path.length
  const node = lookupNode(nodes, id);
  const initial = node.initial;
  if (initial === undefined) return node.path;
  return descend(nodes, initial);
}

export function reverse(path: readonly string[]): readonly string[] {
  //@ verify
  //@ ensures \result.length === path.length
  //@ decreases path.length
  if (path.length === 0) return [];
  return [...reverse(path.slice(1)), path[0]];
}

export function lifecycle(
  nodes: Record<string, CompoundNode>,
  path: readonly string[],
  context: Record<string, number>,
  event: Event,
  exiting: boolean
): Applied {
  //@ verify
  //@ requires declaredPath(nodes, path)
  //@ ensures path.length === 0 ==> \result.context === context
  //@ decreases path.length
  if (path.length === 0) return { context, reused: true, effects: [] };
  const node = lookupNode(nodes, path[0]);
  const exit = node.exit;
  const entry = node.entry;
  const evaluation = exiting ? exit(context, event) : entry(context, event);
  const first = apply(context, evaluation);
  const rest = lifecycle(nodes, path.slice(1), first.context, event, exiting);
  return {
    context: rest.context,
    reused: first.reused && rest.reused,
    effects: [...first.effects, ...rest.effects]
  };
}

export function ready(
  machine: CompoundMachine,
  snapshot: CompoundSnapshot,
  event: Event
): boolean {
  //@ verify
  //@ requires declaredPath(machine.nodes, snapshot.path)
  const selected = select(
    machine.nodes,
    snapshot.path,
    snapshot.context,
    event
  );
  if (selected === undefined) return true;
  const sourcePath = selected.node.path;
  if (sourcePath.length === 0) return false;
  if (commonPrefix(sourcePath, snapshot.path) !== sourcePath.length)
    return false;
  const result = selected.evaluation.result;
  if (result === undefined) return true;
  const target = result.target;
  if (target === undefined) return true;
  if (!(target in machine.nodes)) return false;
  const destination = lookupNode(machine.nodes, target);
  if (destination.path.length === 0) return false;
  if (
    commonPrefix(destination.path, destination.initialPath) !==
    destination.path.length
  )
    return false;
  return declaredPath(machine.nodes, destination.initialPath);
}

export function compoundInitialTransition(
  machine: CompoundMachine,
  event: Event
): CompoundStep {
  //@ verify
  //@ requires machine.root in machine.nodes
  //@ requires declaredPath(machine.nodes, lookupNode(machine.nodes, machine.root).initialPath)
  //@ requires forall(k: string, k in machine.nodes ==> initialWitness(machine.nodes, k))
  //@ ensures !\result.snapshotReused
  const path = descend(machine.nodes, machine.root);
  const entered = lifecycle(machine.nodes, path, machine.context, event, false);
  return {
    snapshot: { path, context: entered.context },
    snapshotReused: false,
    contextReused: entered.reused,
    effects: entered.effects
  };
}

export function compoundTransition(
  machine: CompoundMachine,
  snapshot: CompoundSnapshot,
  event: Event
): CompoundStep {
  //@ verify
  //@ requires declaredPath(machine.nodes, snapshot.path)
  //@ requires ready(machine, snapshot, event)
  //@ requires forall(k: string, k in machine.nodes ==> initialWitness(machine.nodes, k))
  //@ ensures \result.snapshotReused ==> \result.snapshot === snapshot
  const selected = select(
    machine.nodes,
    snapshot.path,
    snapshot.context,
    event
  );
  if (selected === undefined) {
    return { snapshot, snapshotReused: true, contextReused: true, effects: [] };
  }
  const result = selected.evaluation.result;
  const target = result === undefined ? undefined : result.target;
  const reenter = result === undefined ? false : result.reenter;
  const nextPath =
    target === undefined ? snapshot.path : descend(machine.nodes, target);
  const targetPath =
    target === undefined ? [] : lookupNode(machine.nodes, target).path;
  const sourcePath = selected.node.path;
  const contained = commonPrefix(sourcePath, targetPath) === sourcePath.length;
  const targetAncestors =
    targetPath.length === 0 ? [] : targetPath.slice(0, targetPath.length - 1);
  const kept = contained
    ? sourcePath.length - (reenter ? 1 : 0)
    : commonPrefix(sourcePath, targetAncestors);
  const exitKept = target === machine.root && !reenter ? 1 : kept;
  const exitPath =
    target === undefined ? [] : reverse(snapshot.path.slice(exitKept));
  const entryPath =
    target === undefined
      ? reenter
        ? [selected.id]
        : []
      : nextPath.slice(kept);
  const exited = lifecycle(
    machine.nodes,
    exitPath,
    snapshot.context,
    event,
    true
  );
  const updated = apply(exited.context, selected.evaluation);
  const entered = lifecycle(
    machine.nodes,
    entryPath,
    updated.context,
    event,
    false
  );
  return {
    snapshot: { path: nextPath, context: entered.context },
    snapshotReused: false,
    contextReused: exited.reused && updated.reused && entered.reused,
    effects: [...exited.effects, ...updated.effects, ...entered.effects]
  };
}
