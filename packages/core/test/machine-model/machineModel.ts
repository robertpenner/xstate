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

export type ParallelMachine = {
  root: string;
  context: Record<string, number>;
  nodes: Record<string, CompoundNode>;
  order: readonly string[];
  parallel: string | undefined;
};
export type ParallelSnapshot = {
  active: readonly string[];
  context: Record<string, number>;
};
export type ParallelStep = {
  snapshot: ParallelSnapshot;
  snapshotReused: boolean;
  contextReused: boolean;
  effects: readonly Effect[];
};

export function below(
  path: readonly string[],
  prefix: readonly string[]
): boolean {
  //@ verify
  //@ ensures \result ==> path.length > prefix.length
  return (
    path.length > prefix.length && commonPrefix(path, prefix) === prefix.length
  );
}

export function samePath(a: readonly string[], b: readonly string[]): boolean {
  //@ verify
  //@ ensures \result ==> a.length === b.length
  return a.length === b.length && commonPrefix(a, b) === a.length;
}

export function completes(
  nodes: Record<string, CompoundNode>,
  parallel: string | undefined,
  target: readonly string[],
  path: readonly string[]
): boolean {
  //@ verify
  //@ ensures path.length < 2 ==> \result
  //@ decreases path.length
  if (path.length < 2) return true;
  const id = path[0];
  if (!(id in nodes)) return false;
  const node = lookupNode(nodes, id);
  const child = path[1];
  const allowed =
    id === parallel ||
    (below(target, node.path)
      ? child === target[node.path.length]
      : child === node.initial);
  return allowed && completes(nodes, parallel, target, path.slice(1));
}

export function entering(
  nodes: Record<string, CompoundNode>,
  parallel: string | undefined,
  target: readonly string[],
  domain: readonly string[],
  extra: string | undefined,
  id: string
): boolean {
  //@ verify
  if (!(id in nodes)) return false;
  if (id === extra) return true;
  const path = lookupNode(nodes, id).path;
  return (
    below(path, domain) &&
    completes(
      nodes,
      parallel,
      target,
      path.slice(domain.length === 0 ? 0 : domain.length - 1)
    )
  );
}

export function exiting(
  nodes: Record<string, CompoundNode>,
  domain: readonly string[],
  reentered: string | undefined,
  id: string
): boolean {
  //@ verify
  if (!(id in nodes)) return false;
  if (id === reentered) return true;
  return below(lookupNode(nodes, id).path, domain);
}

export function narrow(
  parallel: string | undefined,
  target: readonly string[],
  domain: readonly string[]
): readonly string[] {
  //@ verify
  if (domain.length === 0 || !below(target, domain)) return domain;
  if (domain[domain.length - 1] !== parallel) return domain;
  return target.slice(0, domain.length + 1);
}

export function transitionDomain(
  parallel: string | undefined,
  source: readonly string[],
  target: readonly string[],
  reenter: boolean
): readonly string[] {
  //@ verify
  if (commonPrefix(source, target) === source.length) {
    return reenter ? source : narrow(parallel, target, source);
  }
  if (target.length === 0) return [];
  const ancestors = target.slice(0, target.length - 1);
  const lca = commonPrefix(source, ancestors);
  if (reenter) return source.slice(0, lca);
  return narrow(
    parallel,
    target,
    lca === 0 ? target.slice(0, 1) : source.slice(0, lca)
  );
}

export function runLifecycle(
  nodes: Record<string, CompoundNode>,
  path: readonly string[],
  context: Record<string, number>,
  event: Event,
  exiting: boolean
): Applied {
  //@ verify
  if (!declaredPath(nodes, path)) return { context, reused: true, effects: [] };
  return lifecycle(nodes, path, context, event, exiting);
}

export function leafSelection(
  nodes: Record<string, CompoundNode>,
  id: string,
  base: number,
  context: Record<string, number>,
  event: Event
): Selection | undefined {
  //@ verify
  if (!(id in nodes)) return undefined;
  const node = lookupNode(nodes, id);
  if (node.children.length > 0 || base < 0 || base > node.path.length)
    return undefined;
  const path = node.path.slice(base);
  if (!declaredPath(nodes, path)) return undefined;
  return select(nodes, path, context, event);
}

export function regionSelections(
  nodes: Record<string, CompoundNode>,
  active: readonly string[],
  base: number,
  context: Record<string, number>,
  event: Event
): readonly Selection[] {
  //@ verify
  //@ ensures active.length === 0 ==> \result.length === 0
  //@ decreases active.length
  if (active.length === 0) return [];
  const first = leafSelection(nodes, active[0], base, context, event);
  const rest = regionSelections(nodes, active.slice(1), base, context, event);
  return first === undefined ? rest : [first, ...rest];
}

export function activeParallel(
  machine: ParallelMachine,
  active: readonly string[]
): readonly string[] {
  //@ verify
  const parallel = machine.parallel;
  if (
    parallel === undefined ||
    !active.includes(parallel) ||
    !(parallel in machine.nodes)
  )
    return [];
  return lookupNode(machine.nodes, parallel).path;
}

export function parallelSelections(
  machine: ParallelMachine,
  snapshot: ParallelSnapshot,
  event: Event
): readonly Selection[] {
  //@ verify
  const parallelPath = activeParallel(machine, snapshot.active);
  const regions = regionSelections(
    machine.nodes,
    snapshot.active,
    parallelPath.length,
    snapshot.context,
    event
  );
  if (regions.length > 0 || !declaredPath(machine.nodes, parallelPath))
    return regions;
  const fallback = select(machine.nodes, parallelPath, snapshot.context, event);
  return fallback === undefined ? [] : [fallback];
}

export function parallelReady(
  machine: ParallelMachine,
  snapshot: ParallelSnapshot,
  event: Event
): boolean {
  //@ verify
  const selections = parallelSelections(machine, snapshot, event);
  if (selections.length === 0) return true;
  if (selections.length > 1) return false;
  const result = selections[0].evaluation.result;
  if (result === undefined) return true;
  const target = result.target;
  if (target === undefined) return true;
  if (!(target in machine.nodes)) return false;
  const targetPath = lookupNode(machine.nodes, target).path;
  if (targetPath.length < 2) return true;
  return !(
    targetPath[targetPath.length - 2] === machine.parallel &&
    snapshot.active.includes(target)
  );
}

export function parallelInitialTransition(
  machine: ParallelMachine,
  event: Event
): ParallelStep {
  //@ verify
  //@ ensures !\result.snapshotReused
  const nodes = machine.nodes;
  const parallel = machine.parallel;
  const target =
    machine.root in nodes ? lookupNode(nodes, machine.root).path : [];
  const entries = machine.order.filter((id) =>
    entering(nodes, parallel, target, [], undefined, id)
  );
  const entered = runLifecycle(nodes, entries, machine.context, event, false);
  return {
    snapshot: { active: entries, context: entered.context },
    snapshotReused: false,
    contextReused: entered.reused,
    effects: entered.effects
  };
}

export type ParallelPlan = {
  domain: readonly string[];
  reentered: string | undefined;
  extra: string | undefined;
  exits: readonly string[];
  entries: readonly string[];
  active: readonly string[];
};

export function parallelPlan(
  machine: ParallelMachine,
  active: readonly string[],
  source: string,
  target: string,
  reenter: boolean
): ParallelPlan {
  //@ verify
  const nodes = machine.nodes;
  const parallel = machine.parallel;
  const sourcePath = source in nodes ? lookupNode(nodes, source).path : [];
  const targetPath = target in nodes ? lookupNode(nodes, target).path : [];
  const domain = transitionDomain(parallel, sourcePath, targetPath, reenter);
  const reentered =
    reenter && samePath(domain, sourcePath) ? source : undefined;
  const extra =
    reentered !== undefined
      ? reentered
      : samePath(domain, targetPath) && target !== source
        ? target
        : undefined;
  const exits = reverse(
    active.filter((id) => exiting(nodes, domain, reentered, id))
  );
  const entries = machine.order.filter((id) =>
    entering(nodes, parallel, targetPath, domain, extra, id)
  );
  const next = machine.order.filter(
    (id) =>
      (active.includes(id) && !exiting(nodes, domain, reentered, id)) ||
      entering(nodes, parallel, targetPath, domain, extra, id)
  );
  return { domain, reentered, extra, exits, entries, active: next };
}

export function parallelTransition(
  machine: ParallelMachine,
  snapshot: ParallelSnapshot,
  event: Event
): ParallelStep {
  //@ verify
  //@ ensures \result.snapshotReused ==> \result.snapshot === snapshot
  const selections = parallelSelections(machine, snapshot, event);
  if (selections.length === 0) {
    return { snapshot, snapshotReused: true, contextReused: true, effects: [] };
  }
  const selected = selections[0];
  const nodes = machine.nodes;
  const result = selected.evaluation.result;
  const target = result === undefined ? undefined : result.target;
  const reenter = result === undefined ? false : result.reenter;
  if (target === undefined || !(target in nodes)) {
    const updated = apply(snapshot.context, selected.evaluation);
    const entered = runLifecycle(
      nodes,
      reenter ? [selected.id] : [],
      updated.context,
      event,
      false
    );
    return {
      snapshot: { active: snapshot.active, context: entered.context },
      snapshotReused: false,
      contextReused: updated.reused && entered.reused,
      effects: [...updated.effects, ...entered.effects]
    };
  }
  const plan = parallelPlan(
    machine,
    snapshot.active,
    selected.id,
    target,
    reenter
  );
  const exited = runLifecycle(nodes, plan.exits, snapshot.context, event, true);
  const updated = apply(exited.context, selected.evaluation);
  const entered = runLifecycle(
    nodes,
    plan.entries,
    updated.context,
    event,
    false
  );
  return {
    snapshot: { active: plan.active, context: entered.context },
    snapshotReused: false,
    contextReused: exited.reused && updated.reused && entered.reused,
    effects: [...exited.effects, ...updated.effects, ...entered.effects]
  };
}
