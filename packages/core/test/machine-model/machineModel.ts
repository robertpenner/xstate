// Values are interned by Object.is in the adapter. User keys start with ":".
export type PatchEntry = { key: string; value: number };
export type Event = { type: string; value: number };
export type Effect = { action: number; args: readonly number[] };
export type Result = {
  target: string | undefined;
  patch: readonly PatchEntry[] | undefined;
  reenter: boolean;
};
// Raised events stay apart from ordinary effects: the runtime queues them.
export type Evaluation = {
  result: Result | undefined;
  effects: readonly Effect[];
  raises: readonly Event[];
};
export type Node = {
  on: Map<
    string,
    (context: Record<string, number>, event: Event) => Evaluation
  >;
  always: (context: Record<string, number>, event: Event) => Evaluation;
  entry: (context: Record<string, number>, event: Event) => Evaluation;
  exit: (context: Record<string, number>, event: Event) => Evaluation;
  final: boolean;
  output: (context: Record<string, number>, event: Event) => number;
};
export type Machine = {
  initial: string;
  context: Record<string, number>;
  states: Map<string, Node>;
  hasOutput: boolean;
  output: (context: Record<string, number>, event: Event) => number;
};
// Output stays undefined until the machine completes.
export type Snapshot = {
  value: string;
  context: Record<string, number>;
  output: number | undefined;
};
export type Step = {
  snapshot: Snapshot;
  snapshotReused: boolean;
  contextReused: boolean;
  effects: readonly Effect[];
  raised: readonly Event[];
};
// A macrostep that runs out of budget is unfinished: settled is false.
export type Macrostep = {
  settled: boolean;
  step: Step;
  queue: readonly Event[];
  trace: readonly Step[];
};

export type Applied = {
  context: Record<string, number>;
  reused: boolean;
  effects: readonly Effect[];
  raises: readonly Event[];
};
export type Completion = {
  context: Record<string, number>;
  reused: boolean;
  effects: readonly Effect[];
  output: number | undefined;
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
    effects: evaluation.effects,
    raises: evaluation.raises
  };
}

export function emptyEvaluation(): Evaluation {
  //@ verify
  //@ ensures \result.result === undefined
  return { result: undefined, effects: [], raises: [] };
}

export function completed(machine: Machine, value: string): boolean {
  //@ verify
  const node = machine.states.get(value);
  return node === undefined ? false : node.final;
}

// The adapter decodes this as { type: 'xstate.done.state', stateId, output }.
export function doneEvent(id: string, output: number): Event {
  //@ verify
  return { type: 'xstate.done.state.' + id, value: output };
}

// Entering a final root child completes the machine. The runtime resolves the
// final output, then the root output from the same context and a done event
// carrying the final output, and only then runs the final node's exit.
export function completion(
  machine: Machine,
  value: string,
  context: Record<string, number>,
  event: Event
): Completion {
  //@ verify
  //@ ensures !completed(machine, value) ==> \result.context === context && \result.reused && \result.effects.length === 0 && \result.output === undefined
  const node = machine.states.get(value);
  if (node === undefined || !node.final)
    return { context, reused: true, effects: [], output: undefined };
  const finalOutputOf = node.output;
  const finalOutput = finalOutputOf(context, event);
  const rootOutputOf = machine.output;
  const output = machine.hasOutput
    ? rootOutputOf(context, doneEvent(value, finalOutput))
    : finalOutput;
  const exit = node.exit;
  const exited = apply(context, exit(context, event));
  return {
    context: exited.context,
    reused: exited.reused,
    effects: exited.effects,
    output
  };
}

export function initialTransition(machine: Machine, event: Event): Step {
  //@ verify
  //@ ensures \result.snapshot.value === machine.initial
  const node = machine.states.get(machine.initial);
  const entry = node === undefined ? undefined : node.entry;
  const entering =
    entry === undefined ? emptyEvaluation() : entry(machine.context, event);
  const applied = apply(machine.context, entering);
  const done = completion(machine, machine.initial, applied.context, event);
  return {
    snapshot: {
      value: machine.initial,
      context: done.context,
      output: done.output
    },
    snapshotReused: false,
    contextReused: applied.reused && done.reused,
    effects: [...applied.effects, ...done.effects],
    raised: entering.raises
  };
}

export function transition(
  machine: Machine,
  snapshot: Snapshot,
  event: Event
): Step {
  //@ verify
  //@ ensures \result.snapshotReused ==> \result.snapshot === snapshot
  // Final states take no transitions, and a done machine processes no events.
  const node = machine.states.get(snapshot.value);
  const handler =
    node === undefined
      ? undefined
      : node.final
        ? undefined
        : node.on.get(event.type);
  const selected =
    handler === undefined
      ? emptyEvaluation()
      : handler(snapshot.context, event);
  return takeTransition(machine, snapshot, event, node, selected);
}

export function takeTransition(
  machine: Machine,
  snapshot: Snapshot,
  event: Event,
  node: Node | undefined,
  selected: Evaluation
): Step {
  //@ verify
  //@ ensures \result.snapshotReused ==> \result.snapshot === snapshot
  if (
    selected.result === undefined &&
    selected.effects.length === 0 &&
    selected.raises.length === 0
  ) {
    return {
      snapshot,
      snapshotReused: true,
      contextReused: true,
      effects: [],
      raised: []
    };
  }
  const result = selected.result;
  const target = result === undefined ? undefined : result.target;
  const next = target ?? snapshot.value;
  const reenter = result === undefined ? false : result.reenter;
  const changes = target !== undefined && (next !== snapshot.value || reenter);
  const exit = node === undefined ? undefined : node.exit;
  const exiting =
    changes && exit !== undefined
      ? exit(snapshot.context, event)
      : emptyEvaluation();
  const exited = apply(snapshot.context, exiting);
  const updated = apply(exited.context, selected);
  const destination = machine.states.get(next);
  const entry = destination === undefined ? undefined : destination.entry;
  const entering =
    changes && entry !== undefined
      ? entry(updated.context, event)
      : emptyEvaluation();
  const entered = apply(updated.context, entering);
  const done = changes
    ? completion(machine, next, entered.context, event)
    : {
        context: entered.context,
        reused: true,
        effects: [],
        output: snapshot.output
      };
  return {
    snapshot: { value: next, context: done.context, output: done.output },
    snapshotReused: false,
    contextReused:
      exited.reused && updated.reused && entered.reused && done.reused,
    effects: [
      ...exited.effects,
      ...updated.effects,
      ...entered.effects,
      ...done.effects
    ],
    raised: [...exiting.raises, ...selected.raises, ...entering.raises]
  };
}

export function alwaysSelected(
  machine: Machine,
  snapshot: Snapshot,
  event: Event
): Evaluation {
  //@ verify
  const source = machine.states.get(snapshot.value);
  const always = source === undefined ? undefined : source.always;
  return always === undefined
    ? emptyEvaluation()
    : always(snapshot.context, event);
}

// The runtime reuses the snapshot object when an eventless microstep leaves
// the value and the context object unchanged, and then stops reselecting.
export function eventlessStep(
  machine: Machine,
  snapshot: Snapshot,
  event: Event,
  selected: Evaluation
): Step {
  //@ verify
  //@ ensures \result.snapshotReused ==> \result.snapshot === snapshot
  const taken = takeTransition(
    machine,
    snapshot,
    event,
    machine.states.get(snapshot.value),
    selected
  );
  const kept = taken.snapshot.value === snapshot.value && taken.contextReused;
  return {
    snapshot: kept ? snapshot : taken.snapshot,
    snapshotReused: kept,
    contextReused: taken.contextReused,
    effects: taken.effects,
    raised: taken.raised
  };
}

// Each call is one iteration of the runtime's macrostep loop, which counts
// the final selection that finds nothing enabled. Eventless transitions run
// before the next raised event is dequeued; after a dequeue they are always
// reselected and see the dequeued event.
export function settle(
  machine: Machine,
  step: Step,
  event: Event,
  select: boolean,
  queue: readonly Event[],
  remaining: number
): Macrostep {
  //@ verify
  //@ decreases remaining
  // A done machine leaves the loop before the budget is counted, and the
  // runtime discards its queue.
  if (completed(machine, step.snapshot.value))
    return { settled: true, step, queue: [], trace: [] };
  if (remaining <= 0) return { settled: false, step, queue, trace: [] };
  const selected = select
    ? alwaysSelected(machine, step.snapshot, event)
    : emptyEvaluation();
  const enabled =
    selected.result !== undefined ||
    selected.effects.length > 0 ||
    selected.raises.length > 0;
  if (!enabled && queue.length === 0)
    return { settled: true, step, queue, trace: [] };
  const processed = enabled ? event : queue[0];
  const next = enabled
    ? eventlessStep(machine, step.snapshot, event, selected)
    : transition(machine, step.snapshot, processed);
  const waiting = enabled ? queue : queue.slice(1);
  const rest = settle(
    machine,
    {
      snapshot: next.snapshot,
      snapshotReused: step.snapshotReused && next.snapshotReused,
      contextReused: step.contextReused && next.contextReused,
      effects: [...step.effects, ...next.effects],
      raised: [...step.raised, ...next.raised]
    },
    processed,
    !enabled || !next.snapshotReused,
    [...waiting, ...next.raised],
    remaining - 1
  );
  return {
    settled: rest.settled,
    step: rest.step,
    queue: rest.queue,
    trace: [next, ...rest.trace]
  };
}

export function initialMacrostep(
  machine: Machine,
  event: Event,
  maxIterations: number
): Macrostep {
  //@ verify
  const first = initialTransition(machine, event);
  return settle(machine, first, event, true, first.raised, maxIterations);
}

export function transitionMacrostep(
  machine: Machine,
  snapshot: Snapshot,
  event: Event,
  maxIterations: number
): Macrostep {
  //@ verify
  const first = transition(machine, snapshot, event);
  return settle(machine, first, event, true, first.raised, maxIterations);
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
  final: boolean;
  output: (context: Record<string, number>, event: Event) => number;
};
export type CompoundMachine = {
  root: string;
  context: Record<string, number>;
  nodes: Record<string, CompoundNode>;
  hasOutput: boolean;
  output: (context: Record<string, number>, event: Event) => number;
};
// Output stays undefined until the machine completes.
export type CompoundSnapshot = {
  path: readonly string[];
  context: Record<string, number>;
  output: number | undefined;
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
  raised: readonly Event[];
};
export type CompoundCompletion = {
  context: Record<string, number>;
  reused: boolean;
  effects: readonly Effect[];
  raised: readonly Event[];
  output: number | undefined;
};
// A guard in the loop can stop it without a budget failure; the adapter
// refuses such a run.
export type CompoundMacrostep = {
  settled: boolean;
  refused: boolean;
  step: CompoundStep;
  queue: readonly Event[];
  trace: readonly CompoundStep[];
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
  if (
    evaluation.result !== undefined ||
    evaluation.effects.length > 0 ||
    evaluation.raises.length > 0
  ) {
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
  if (path.length === 0)
    return { context, reused: true, effects: [], raises: [] };
  const node = lookupNode(nodes, path[0]);
  const exit = node.exit;
  const entry = node.entry;
  const evaluation = exiting ? exit(context, event) : entry(context, event);
  const first = apply(context, evaluation);
  const rest = lifecycle(nodes, path.slice(1), first.context, event, exiting);
  return {
    context: rest.context,
    reused: first.reused && rest.reused,
    effects: [...first.effects, ...rest.effects],
    raises: [...first.raises, ...rest.raises]
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

// The machine is done when the active leaf is a final child of the root.
export function compoundDone(
  machine: CompoundMachine,
  path: readonly string[]
): boolean {
  //@ verify
  //@ requires declaredPath(machine.nodes, path)
  if (path.length < 2) return false;
  if (path[path.length - 2] !== machine.root) return false;
  return lookupNode(machine.nodes, path[path.length - 1]).final;
}

// Entering a final leaf queues a done event for its parent after the entry
// raises. When the parent is the root, the machine completes instead: the
// root output is resolved from the entered context and a done event carrying
// the final output, then every active node exits from the leaf up.
export function compoundCompletion(
  machine: CompoundMachine,
  path: readonly string[],
  entering: boolean,
  context: Record<string, number>,
  event: Event
): CompoundCompletion {
  //@ verify
  //@ requires declaredPath(machine.nodes, path)
  if (!entering || path.length < 2)
    return {
      context,
      reused: true,
      effects: [],
      raised: [],
      output: undefined
    };
  const leafId = path[path.length - 1];
  const leaf = lookupNode(machine.nodes, leafId);
  if (!leaf.final)
    return {
      context,
      reused: true,
      effects: [],
      raised: [],
      output: undefined
    };
  const leafOutput = leaf.output;
  const finalOutput = leafOutput(context, event);
  const parentId = path[path.length - 2];
  if (parentId !== machine.root)
    return {
      context,
      reused: true,
      effects: [],
      raised: [doneEvent(parentId, finalOutput)],
      output: undefined
    };
  const rootOutput = machine.output;
  const output = machine.hasOutput
    ? rootOutput(context, doneEvent(leafId, finalOutput))
    : finalOutput;
  const exited = lifecycle(machine.nodes, reverse(path), context, event, true);
  return {
    context: exited.context,
    reused: exited.reused,
    effects: exited.effects,
    raised: [],
    output
  };
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
  const done = compoundCompletion(machine, path, true, entered.context, event);
  return {
    snapshot: { path, context: done.context, output: done.output },
    snapshotReused: false,
    contextReused: entered.reused && done.reused,
    effects: [...entered.effects, ...done.effects],
    raised: [...entered.raises, ...done.raised]
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
  // A done machine processes no events.
  if (compoundDone(machine, snapshot.path))
    return {
      snapshot,
      snapshotReused: true,
      contextReused: true,
      effects: [],
      raised: []
    };
  const selected = select(
    machine.nodes,
    snapshot.path,
    snapshot.context,
    event
  );
  if (selected === undefined) {
    return {
      snapshot,
      snapshotReused: true,
      contextReused: true,
      effects: [],
      raised: []
    };
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
  const entryPath = target === undefined ? [] : nextPath.slice(kept);
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
  const done = compoundCompletion(
    machine,
    nextPath,
    entryPath.length > 0,
    entered.context,
    event
  );
  return {
    snapshot: { path: nextPath, context: done.context, output: done.output },
    snapshotReused: false,
    contextReused:
      exited.reused && updated.reused && entered.reused && done.reused,
    effects: [
      ...exited.effects,
      ...updated.effects,
      ...entered.effects,
      ...done.effects
    ],
    raised: [
      ...exited.raises,
      ...updated.raises,
      ...entered.raises,
      ...done.raised
    ]
  };
}

// Raised events are processed in FIFO order, each counting against the
// budget. A done machine leaves the loop before the budget is counted and
// discards its queue.
export function compoundSettle(
  machine: CompoundMachine,
  step: CompoundStep,
  queue: readonly Event[],
  remaining: number
): CompoundMacrostep {
  //@ verify
  //@ requires forall(k: string, k in machine.nodes ==> initialWitness(machine.nodes, k))
  //@ decreases remaining
  if (!declaredPath(machine.nodes, step.snapshot.path))
    return { settled: false, refused: true, step, queue, trace: [] };
  if (compoundDone(machine, step.snapshot.path))
    return { settled: true, refused: false, step, queue: [], trace: [] };
  if (remaining <= 0)
    return { settled: false, refused: false, step, queue, trace: [] };
  if (queue.length === 0)
    return { settled: true, refused: false, step, queue, trace: [] };
  if (!ready(machine, step.snapshot, queue[0]))
    return { settled: false, refused: true, step, queue, trace: [] };
  const next = compoundTransition(machine, step.snapshot, queue[0]);
  const rest = compoundSettle(
    machine,
    {
      snapshot: next.snapshot,
      snapshotReused: step.snapshotReused && next.snapshotReused,
      contextReused: step.contextReused && next.contextReused,
      effects: [...step.effects, ...next.effects],
      raised: [...step.raised, ...next.raised]
    },
    [...queue.slice(1), ...next.raised],
    remaining - 1
  );
  return {
    settled: rest.settled,
    refused: rest.refused,
    step: rest.step,
    queue: rest.queue,
    trace: [next, ...rest.trace]
  };
}

export function compoundInitialMacrostep(
  machine: CompoundMachine,
  event: Event,
  maxIterations: number
): CompoundMacrostep {
  //@ verify
  //@ requires machine.root in machine.nodes
  //@ requires declaredPath(machine.nodes, lookupNode(machine.nodes, machine.root).initialPath)
  //@ requires forall(k: string, k in machine.nodes ==> initialWitness(machine.nodes, k))
  const first = compoundInitialTransition(machine, event);
  return compoundSettle(machine, first, first.raised, maxIterations);
}

export function compoundMacrostep(
  machine: CompoundMachine,
  snapshot: CompoundSnapshot,
  event: Event,
  maxIterations: number
): CompoundMacrostep {
  //@ verify
  //@ requires declaredPath(machine.nodes, snapshot.path)
  //@ requires ready(machine, snapshot, event)
  //@ requires forall(k: string, k in machine.nodes ==> initialWitness(machine.nodes, k))
  const first = compoundTransition(machine, snapshot, event);
  return compoundSettle(machine, first, first.raised, maxIterations);
}

export type ParallelMachine = {
  root: string;
  context: Record<string, number>;
  nodes: Record<string, CompoundNode>;
  order: readonly string[];
  parallels: readonly string[];
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
  parallels: readonly string[],
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
    parallels.includes(id) ||
    (below(target, node.path)
      ? child === target[node.path.length]
      : child === node.initial);
  return allowed && completes(nodes, parallels, target, path.slice(1));
}

export function entering(
  nodes: Record<string, CompoundNode>,
  parallels: readonly string[],
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
      parallels,
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
  parallels: readonly string[],
  target: readonly string[],
  domain: readonly string[]
): readonly string[] {
  //@ verify
  //@ decreases target.length - domain.length
  if (domain.length === 0 || !below(target, domain)) return domain;
  if (!parallels.includes(domain[domain.length - 1])) return domain;
  return narrow(parallels, target, target.slice(0, domain.length + 1));
}

export function transitionDomain(
  parallels: readonly string[],
  source: readonly string[],
  target: readonly string[],
  reenter: boolean
): readonly string[] {
  //@ verify
  if (commonPrefix(source, target) === source.length) {
    return reenter ? source : narrow(parallels, target, source);
  }
  if (target.length === 0) return [];
  const ancestors = target.slice(0, target.length - 1);
  const lca = commonPrefix(source, ancestors);
  if (reenter) return source.slice(0, lca);
  return narrow(
    parallels,
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
  if (!declaredPath(nodes, path))
    return { context, reused: true, effects: [], raises: [] };
  return lifecycle(nodes, path, context, event, exiting);
}

export function ownSelection(
  nodes: Record<string, CompoundNode>,
  id: string,
  context: Record<string, number>,
  event: Event
): Selection | undefined {
  //@ verify
  if (!(id in nodes)) return undefined;
  return select(nodes, [id], context, event);
}

export function handledBelow(
  nodes: Record<string, CompoundNode>,
  active: readonly string[],
  path: readonly string[],
  context: Record<string, number>,
  event: Event
): boolean {
  //@ verify
  return active.some(
    (id) =>
      id in nodes &&
      below(lookupNode(nodes, id).path, path) &&
      ownSelection(nodes, id, context, event) !== undefined
  );
}

// The runtime selects recursively: a compound node defers to its active
// child and a parallel node to all of its regions, falling back to its own
// handler only when nothing below it handles the event. The result is every
// active handler with no handling active descendant, in document order.
export function enabledSelections(
  nodes: Record<string, CompoundNode>,
  active: readonly string[],
  candidates: readonly string[],
  context: Record<string, number>,
  event: Event
): readonly Selection[] {
  //@ verify
  //@ ensures candidates.length === 0 ==> \result.length === 0
  //@ decreases candidates.length
  if (candidates.length === 0) return [];
  const rest = enabledSelections(
    nodes,
    active,
    candidates.slice(1),
    context,
    event
  );
  const id = candidates[0];
  if (!(id in nodes)) return rest;
  const own = ownSelection(nodes, id, context, event);
  if (
    own === undefined ||
    handledBelow(nodes, active, lookupNode(nodes, id).path, context, event)
  )
    return rest;
  return [own, ...rest];
}

export function parallelSelections(
  machine: ParallelMachine,
  snapshot: ParallelSnapshot,
  event: Event
): readonly Selection[] {
  //@ verify
  return enabledSelections(
    machine.nodes,
    snapshot.active,
    snapshot.active,
    snapshot.context,
    event
  );
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
    machine.parallels.includes(targetPath[targetPath.length - 2]) &&
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
  const parallels = machine.parallels;
  const target =
    machine.root in nodes ? lookupNode(nodes, machine.root).path : [];
  const entries = machine.order.filter((id) =>
    entering(nodes, parallels, target, [], undefined, id)
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
  const parallels = machine.parallels;
  const sourcePath = source in nodes ? lookupNode(nodes, source).path : [];
  const targetPath = target in nodes ? lookupNode(nodes, target).path : [];
  const domain = transitionDomain(parallels, sourcePath, targetPath, reenter);
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
    entering(nodes, parallels, targetPath, domain, extra, id)
  );
  const next = machine.order.filter(
    (id) =>
      (active.includes(id) && !exiting(nodes, domain, reentered, id)) ||
      entering(nodes, parallels, targetPath, domain, extra, id)
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
    return {
      snapshot: { active: snapshot.active, context: updated.context },
      snapshotReused: false,
      contextReused: updated.reused,
      effects: updated.effects
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

export function selectionPlan(
  machine: ParallelMachine,
  active: readonly string[],
  selection: Selection
): ParallelPlan | undefined {
  //@ verify
  const result = selection.evaluation.result;
  if (result === undefined) return undefined;
  const target = result.target;
  if (target === undefined || !(target in machine.nodes)) return undefined;
  return parallelPlan(machine, active, selection.id, target, result.reenter);
}

export function conflictExits(
  machine: ParallelMachine,
  active: readonly string[],
  selection: Selection
): readonly string[] {
  //@ verify
  const plan = selectionPlan(machine, active, selection);
  return plan === undefined ? [] : plan.exits;
}

export function overlaps(a: readonly string[], b: readonly string[]): boolean {
  //@ verify
  return a.some((id) => b.includes(id));
}

export function preempts(
  machine: ParallelMachine,
  active: readonly string[],
  candidate: Selection,
  kept: Selection
): boolean {
  //@ verify
  return (
    overlaps(
      conflictExits(machine, active, candidate),
      conflictExits(machine, active, kept)
    ) && !below(candidate.node.path, kept.node.path)
  );
}

export function anyPreempts(
  machine: ParallelMachine,
  active: readonly string[],
  candidate: Selection,
  kept: readonly Selection[]
): boolean {
  //@ verify
  //@ decreases kept.length
  if (kept.length === 0) return false;
  return (
    preempts(machine, active, candidate, kept[0]) ||
    anyPreempts(machine, active, candidate, kept.slice(1))
  );
}

export function removeConflicts(
  machine: ParallelMachine,
  active: readonly string[],
  pending: readonly Selection[],
  kept: readonly Selection[]
): readonly Selection[] {
  //@ verify
  //@ decreases pending.length
  if (pending.length === 0) return kept;
  const first = pending[0];
  const rest = pending.slice(1);
  if (anyPreempts(machine, active, first, kept)) {
    return removeConflicts(machine, active, rest, kept);
  }
  const exits = conflictExits(machine, active, first);
  const survivors = kept.filter(
    (other) => !overlaps(exits, conflictExits(machine, active, other))
  );
  return removeConflicts(machine, active, rest, [...survivors, first]);
}

export function selectionPlans(
  machine: ParallelMachine,
  active: readonly string[],
  selections: readonly Selection[]
): readonly ParallelPlan[] {
  //@ verify
  //@ ensures \result.length <= selections.length
  //@ decreases selections.length
  if (selections.length === 0) return [];
  const plan = selectionPlan(machine, active, selections[0]);
  const rest = selectionPlans(machine, active, selections.slice(1));
  return plan === undefined ? rest : [plan, ...rest];
}

export function plansExit(plans: readonly ParallelPlan[], id: string): boolean {
  //@ verify
  return plans.some((plan) => plan.exits.includes(id));
}

export function plansEnter(
  plans: readonly ParallelPlan[],
  id: string
): boolean {
  //@ verify
  return plans.some((plan) => plan.entries.includes(id));
}

export function applyAll(
  context: Record<string, number>,
  selections: readonly Selection[]
): Applied {
  //@ verify
  //@ ensures selections.length === 0 ==> \result.context === context
  //@ decreases selections.length
  if (selections.length === 0)
    return { context, reused: true, effects: [], raises: [] };
  const first = apply(context, selections[0].evaluation);
  const rest = applyAll(first.context, selections.slice(1));
  return {
    context: rest.context,
    reused: first.reused && rest.reused,
    effects: [...first.effects, ...rest.effects],
    raises: [...first.raises, ...rest.raises]
  };
}

export function selectionReady(
  machine: ParallelMachine,
  active: readonly string[],
  selection: Selection
): boolean {
  //@ verify
  const result = selection.evaluation.result;
  if (result === undefined) return true;
  const target = result.target;
  if (target === undefined) return true;
  if (!(target in machine.nodes)) return false;
  const targetPath = lookupNode(machine.nodes, target).path;
  if (targetPath.length < 2) return true;
  return !(
    machine.parallels.includes(targetPath[targetPath.length - 2]) &&
    active.includes(target)
  );
}

export function comparable(
  a: readonly string[],
  b: readonly string[]
): boolean {
  //@ verify
  const shared = commonPrefix(a, b);
  return shared === a.length || shared === b.length;
}

export function sourceApart(
  path: readonly string[],
  selections: readonly Selection[]
): boolean {
  //@ verify
  //@ decreases selections.length
  if (selections.length === 0) return true;
  return (
    !comparable(path, selections[0].node.path) &&
    sourceApart(path, selections.slice(1))
  );
}

export function sourcesApart(selections: readonly Selection[]): boolean {
  //@ verify
  //@ decreases selections.length
  if (selections.length === 0) return true;
  const first = selections[0];
  const rest = selections.slice(1);
  return sourceApart(first.node.path, rest) && sourcesApart(rest);
}

export function domainsApart(plans: readonly ParallelPlan[]): boolean {
  //@ verify
  //@ decreases plans.length
  if (plans.length === 0) return true;
  const first = plans[0];
  const rest = plans.slice(1);
  return (
    !rest.some((other) => comparable(first.domain, other.domain)) &&
    domainsApart(rest)
  );
}

export function multiReady(
  machine: ParallelMachine,
  active: readonly string[],
  selections: readonly Selection[]
): boolean {
  //@ verify
  return (
    selections.every((selection) =>
      selectionReady(machine, active, selection)
    ) && sourcesApart(selections)
  );
}

export function parallelStepReady(
  machine: ParallelMachine,
  snapshot: ParallelSnapshot,
  event: Event
): boolean {
  //@ verify
  const selections = parallelSelections(machine, snapshot, event);
  if (selections.length < 2) return parallelReady(machine, snapshot, event);
  return multiReady(machine, snapshot.active, selections);
}

export function parallelStep(
  machine: ParallelMachine,
  snapshot: ParallelSnapshot,
  event: Event
): ParallelStep {
  //@ verify
  //@ ensures \result.snapshotReused ==> \result.snapshot === snapshot
  const selections = parallelSelections(machine, snapshot, event);
  if (selections.length < 2)
    return parallelTransition(machine, snapshot, event);
  const nodes = machine.nodes;
  const active = snapshot.active;
  const kept = removeConflicts(machine, active, selections, []);
  const plans = selectionPlans(machine, active, kept);
  const exits = reverse(active.filter((id) => plansExit(plans, id)));
  const entries = machine.order.filter((id) => plansEnter(plans, id));
  const next = machine.order.filter(
    (id) =>
      (active.includes(id) && !plansExit(plans, id)) || plansEnter(plans, id)
  );
  const exited = runLifecycle(nodes, exits, snapshot.context, event, true);
  const updated = applyAll(exited.context, kept);
  const entered = runLifecycle(nodes, entries, updated.context, event, false);
  return {
    snapshot: { active: next, context: entered.context },
    snapshotReused: false,
    contextReused: exited.reused && updated.reused && entered.reused,
    effects: [...exited.effects, ...updated.effects, ...entered.effects]
  };
}
