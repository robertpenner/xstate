import assert from 'node:assert/strict';
import {
  createMachine,
  getInitialMicrosteps,
  getMicrosteps,
  initialTransition,
  transition,
  type AnyMachineSnapshot,
  type ExecutableEffect
} from '../../src';
import {
  collectTree,
  iterationBound,
  type AuthoredNode,
  type Config
} from './compoundAdapter';
import {
  createEncoding,
  expectUnfinished,
  plainRecord,
  settledRuntime,
  unboundedCap,
  validateResult,
  type Event,
  type Unfinished
} from './machineAdapter';
import * as model from './machineModel';

export type { Config } from './compoundAdapter';

// Builds the model machine and the runtime machine from one config and checks
// that they list nodes in the same document order. Completion allows final
// states, `onDone`, `output`, `options` and raised events.
function buildParallel(config: Config, completion: boolean) {
  const encoding = createEncoding((id) => id.slice(1));
  const { registry, root, resolveTarget } = collectTree(
    config,
    true,
    completion
  );
  const modelId = (node: { id: string }) => `:${node.id}`;
  const authored = (id: string) => registry.get(id.slice(1))!;
  function initialPath(node: AuthoredNode): string[] {
    if (node.config.initial === undefined) return node.path;
    return initialPath(node.children.get(node.config.initial)!);
  }
  const nodes: Record<string, model.CompoundNode> = {};
  const parallels: string[] = [];
  for (const node of registry.values()) {
    const resolve = (target: string) => resolveTarget(node, target);
    const handlers = Object.entries(node.config.on ?? {});
    // The runtime matches `onDone` by the done event's state id; the model
    // keys it by the done event's type, which names the same state.
    if (node.config.onDone !== undefined)
      handlers.push([`xstate.done.state.${modelId(node)}`, node.config.onDone]);
    for (const [, handler] of handlers)
      if (typeof handler !== 'function')
        validateResult(handler, resolve, false);
    if (node.config.type === 'parallel') parallels.push(modelId(node));
    nodes[modelId(node)] = {
      path: node.path,
      initialPath: initialPath(node),
      children: [...node.children.values()].map(modelId),
      initial:
        node.config.initial === undefined
          ? undefined
          : modelId(node.children.get(node.config.initial)!),
      on: new Map(
        handlers.map(([type, definition]) => [
          type,
          encoding.evaluate(definition, false, resolve, completion)
        ])
      ),
      entry: encoding.evaluate(node.config.entry, true, resolve, completion),
      exit: encoding.evaluate(node.config.exit, true, resolve, completion),
      final: node.config.type === 'final',
      output: encoding.evaluateOutput(node.config.output)
    };
  }
  const machine: model.ParallelMachine = {
    root: modelId(root),
    context: encoding.encode(config.context),
    nodes,
    order: [...registry.values()].map(modelId),
    parallels
  };
  const runtime = createMachine(config);
  type RuntimeNode = typeof runtime.root;
  const runtimeNodes: RuntimeNode[] = [];
  const walk = (node: RuntimeNode) => {
    runtimeNodes.push(node);
    Object.values(node.states).forEach(walk);
  };
  walk(runtime.root);
  assert.deepEqual(
    runtimeNodes.sort((a, b) => a.order - b.order).map(modelId),
    machine.order,
    'Model document order must match runtime document order'
  );
  function valueOf(node: AuthoredNode, active: ReadonlySet<string>): unknown {
    if (node.config.type === 'parallel') {
      return Object.fromEntries(
        [...node.children.values()].map((child) => [
          child.key,
          valueOf(child, active)
        ])
      );
    }
    const child = [...node.children.values()].find((candidate) =>
      active.has(modelId(candidate))
    );
    if (child === undefined) return {};
    if (child.children.size === 0) return child.key;
    return { [child.key]: valueOf(child, active) };
  }
  return { encoding, root, modelId, authored, machine, runtime, valueOf };
}

// Throws on a refused event unless `onRefusal` is given, in which case the
// event is skipped and the trace continues from the same snapshot.
export function compareParallelTrace(
  config: Config,
  events: readonly Event[],
  onRefusal?: (reason: RefusalReason, event: Event) => void
) {
  for (const event of events) {
    plainRecord(event, 'event');
    if (typeof event.type !== 'string')
      throw new Error('Unsupported event.type');
  }
  const { encoding, root, modelId, authored, machine, runtime, valueOf } =
    buildParallel(config, false);
  let expected = model.parallelInitialTransition(machine, {
    type: 'xstate.init',
    value: encoding.encodeValue({ type: 'xstate.init', input: undefined })
  });
  let [actual, actualEffects] = initialTransition(runtime);
  function compare(previous: typeof actual | undefined) {
    assert.equal(actual.status, 'active');
    const active = new Set(expected.snapshot.active);
    assert.deepEqual(
      [...actual.nodes].sort((a, b) => a.order - b.order).map(modelId),
      expected.snapshot.active
    );
    assert.deepEqual(actual.value, valueOf(root, active));
    assert.deepEqual(
      encoding.encode(actual.context),
      expected.snapshot.context
    );
    assert.deepEqual(
      Object.keys(actual.context),
      Object.keys(encoding.decode(expected.snapshot.context))
    );
    assert.equal(actual === previous, expected.snapshotReused);
    assert.equal(
      actual.context === (previous?.context ?? config.context),
      expected.contextReused
    );
    assert.deepEqual(encoding.encodeEffects(actualEffects), expected.effects);
    for (const id of expected.snapshot.active) {
      const node = authored(id);
      const activeChildren = [...node.children.values()].filter((child) =>
        active.has(modelId(child))
      );
      assert.equal(
        activeChildren.length,
        node.config.type === 'parallel'
          ? node.children.size
          : Math.min(node.children.size, 1)
      );
      if (node.parent) assert.ok(active.has(modelId(node.parent)));
    }
    return {
      value: actual.value,
      active: expected.snapshot.active.map((id) => id.slice(1)),
      context: actual.context,
      effects: encoding.decodeEffects(expected.effects),
      snapshotReused: expected.snapshotReused,
      contextReused: expected.contextReused
    };
  }
  const trace = [
    {
      ...compare(undefined),
      selections: 0,
      kept: 0,
      nestedDomains: false,
      narrowing: 0,
      parallelFallback: false,
      enteredParallels: 0,
      exitedParallels: 0,
      movingPlans: 0,
      sourceDepths: 0,
      sourceParallels: 0,
      domainParallels: 0,
      reenteredParallels: 0,
      stoppedFallback: false
    }
  ];
  for (const event of events) {
    const previous = actual;
    const modelEvent = {
      type: event.type,
      value: encoding.encodeValue(event)
    };
    if (!model.parallelStepReady(machine, expected.snapshot, modelEvent)) {
      const reason = refusalReason(machine, expected.snapshot, modelEvent);
      if (onRefusal) {
        onRefusal(reason, event);
        continue;
      }
      throw new Error(`Unsupported step: ${event.type} (${reason})`);
    }
    const selected = model.parallelSelections(
      machine,
      expected.snapshot,
      modelEvent
    );
    const selections = selected.length;
    const keptSelections =
      selections < 2
        ? selected
        : model.removeConflicts(
            machine,
            expected.snapshot.active,
            selected,
            []
          );
    const kept = keptSelections.length;
    const plans = model.selectionPlans(
      machine,
      expected.snapshot.active,
      keptSelections
    );
    const nestedDomains = plans.some((plan, index) =>
      plans.some(
        (other, otherIndex) =>
          index < otherIndex &&
          plan.domain.length !== other.domain.length &&
          model.comparable(plan.domain, other.domain)
      )
    );
    const { nodes, parallels } = machine;
    const active = expected.snapshot.active;
    // How many parallel levels a domain descends below the lowest common
    // compound ancestor of source and target.
    const narrowing = Math.max(
      0,
      ...keptSelections.map((selection) => {
        const result = selection.evaluation.result;
        const target = result?.target;
        if (result === undefined || target === undefined || !(target in nodes))
          return 0;
        const source = nodes[selection.id].path;
        const targetPath = nodes[target].path;
        return (
          model.transitionDomain(parallels, source, targetPath, result.reenter)
            .length -
          model.transitionDomain([], source, targetPath, result.reenter).length
        );
      })
    );
    // A parallel node was selected although an active node below it declares a
    // handler for the event, so that handler declined.
    const parallelFallback = selected.some(
      (selection) =>
        parallels.includes(selection.id) &&
        active.some(
          (id) =>
            model.below(nodes[id].path, nodes[selection.id].path) &&
            nodes[id].on.has(event.type)
        )
    );
    const countParallels = (ids: readonly string[]) =>
      ids.filter((id) => parallels.includes(id)).length;
    const enteredParallels = Math.max(
      0,
      ...plans.map((plan) => countParallels(plan.entries))
    );
    const exitedParallels = Math.max(
      0,
      ...plans.map((plan) => countParallels(plan.exits))
    );
    const movingPlans = plans.filter(
      (plan) => plan.exits.length > 0 || plan.entries.length > 0
    ).length;
    const sourceDepths = new Set(
      selected.map((selection) => nodes[selection.id].path.length)
    ).size;
    // The most parallel nodes strictly above any selected source.
    const sourceParallels = Math.max(
      0,
      ...selected.map((selection) =>
        countParallels(nodes[selection.id].path.slice(0, -1))
      )
    );
    // The most parallel nodes strictly above a moving plan's domain.
    const domainParallels = Math.max(
      0,
      ...plans
        .filter((plan) => plan.exits.length > 0 || plan.entries.length > 0)
        .map((plan) => countParallels(plan.domain.slice(0, -1)))
    );
    // The most parallel nodes one plan both exits and reenters.
    const reenteredParallels = Math.max(
      0,
      ...plans.map((plan) =>
        countParallels(plan.exits.filter((id) => plan.entries.includes(id)))
      )
    );
    // A selected block or effect-only handler kept an active ancestor's
    // handler for the same event from being selected.
    const stoppedFallback = selected.some(
      (selection) =>
        selection.evaluation.result?.target === undefined &&
        nodes[selection.id].path
          .slice(0, -1)
          .some((id) => nodes[id].on.has(event.type))
    );
    expected = model.parallelStep(machine, expected.snapshot, modelEvent);
    [actual, actualEffects] = transition(runtime, actual, event);
    trace.push({
      ...compare(previous),
      selections,
      kept,
      nestedDomains,
      narrowing,
      parallelFallback,
      enteredParallels,
      exitedParallels,
      movingPlans,
      sourceDepths,
      sourceParallels,
      domainParallels,
      reenteredParallels,
      stoppedFallback
    });
  }
  return trace;
}

export type RefusalReason =
  | 'unknown target'
  | 'active region target'
  | 'comparable sources';

// Names the first `parallelStepReady` clause that fails, in the order the
// model checks them.
export function refusalReason(
  machine: model.ParallelMachine,
  snapshot: model.ParallelSnapshot,
  event: model.Event
): RefusalReason {
  const selections = model.parallelSelections(machine, snapshot, event);
  for (const selection of selections) {
    const result = selection.evaluation.result;
    const target = result?.target;
    if (target === undefined) continue;
    if (!(target in machine.nodes)) {
      return 'unknown target';
    } else if (!model.selectionReady(machine, snapshot.active, selection)) {
      return 'active region target';
    }
  }
  if (!model.sourcesApart(selections)) return 'comparable sources';
  throw new Error('No refusal reason for an accepted step');
}

export function compareParallelCompletion(
  config: Config,
  events: readonly Event[]
) {
  const run = compareParallelRun(config, events);
  if (run.unfinished)
    throw new Error(
      `Macrostep reached maxIterations ${run.unfinished.maxIterations}`
    );
  return run.trace;
}

// Runs whole macrosteps: raised events, done events and machine completion.
// Each external event and each processed raised event is compared as one
// runtime microstep.
export function compareParallelRun(config: Config, events: readonly Event[]) {
  for (const event of events) {
    plainRecord(event, 'event');
    if (typeof event.type !== 'string' || event.type.startsWith('xstate.'))
      throw new Error('Unsupported event.type');
  }
  const { encoding, root, modelId, authored, machine, runtime, valueOf } =
    buildParallel(config, true);
  const bound = iterationBound(config);
  const budget = bound ?? unboundedCap;
  const missing = encoding.encodeValue(undefined);
  // The model evaluates outputs more than once; equal region outputs share
  // one encoding so the model sees one value.
  const combined = new Map<string, number>();
  const outputs: model.ParallelOutputs = {
    hasOutput: config.output !== undefined,
    output: encoding.evaluateOutput(config.output),
    regions: (id, values) => {
      const key = `${id}|${values.join(',')}`;
      let found = combined.get(key);
      if (found === undefined) {
        const regions = [...authored(id).children.values()];
        assert.equal(values.length, regions.length);
        found = encoding.encodeValue(
          Object.fromEntries(
            regions.map((region, index) => [
              region.key,
              encoding.decodeValue(values[index])
            ])
          )
        );
        combined.set(key, found);
      }
      return found;
    },
    missing
  };
  // The runtime ends a macrostep that completes the machine with a builtin
  // termination effect, which the model represents by its done flag.
  const withoutTermination = (
    effects: readonly ExecutableEffect[],
    terminates: boolean
  ) => {
    if (!terminates) return effects;
    assert.equal(effects.at(-1)?.type, '@xstate.terminate');
    return effects.slice(0, -1);
  };
  const settled = (macrostep: model.ParallelMacrostep) => {
    if (macrostep.refused)
      throw new Error('Unsupported raised event outside the model domain');
    if (!macrostep.settled && bound === undefined)
      throw new Error(
        `Unsupported unbounded macrostep: no rest within ${unboundedCap} iterations`
      );
    return macrostep;
  };
  const ids = (snapshot: AnyMachineSnapshot) =>
    [...snapshot.nodes].sort((a, b) => a.order - b.order).map(modelId);
  function compareMicrosteps(
    microsteps: ReadonlyArray<
      readonly [AnyMachineSnapshot, readonly ExecutableEffect[], unknown]
    >,
    steps: readonly model.ParallelMicro[],
    terminates: boolean
  ) {
    assert.equal(microsteps.length, steps.length);
    steps.forEach((step, index) => {
      const [snapshot, effects] = microsteps[index];
      const { active, context } = step.state.snapshot;
      assert.equal(snapshot.status, step.state.done ? 'done' : 'active');
      assert.deepEqual(ids(snapshot), active);
      assert.deepEqual(snapshot.value, valueOf(root, new Set(active)));
      assert.deepEqual(encoding.encode(snapshot.context), context);
      assert.deepEqual(
        encoding.encodeEffects(
          withoutTermination(effects, terminates && index === steps.length - 1)
        ),
        step.effects
      );
      if (index > 0) {
        const [before] = microsteps[index - 1];
        assert.equal(snapshot.context === before.context, step.contextReused);
      }
    });
  }
  const initialEvent = {
    type: 'xstate.init',
    value: encoding.encodeValue({ type: 'xstate.init', input: undefined })
  };
  let macrostep = settled(
    model.parallelInitialMacrostep(machine, outputs, initialEvent, budget)
  );
  if (!macrostep.settled) {
    expectUnfinished(() => initialTransition(runtime), bound!);
    expectUnfinished(() => getInitialMicrosteps(runtime), bound!);
    return {
      trace: [] as ReturnType<typeof compare>[],
      unfinished: { maxIterations: bound!, afterEvents: 0 } as Unfinished
    };
  }
  compareMicrosteps(
    settledRuntime(() => getInitialMicrosteps(runtime)),
    [
      model.parallelInitialMicro(machine, outputs, initialEvent),
      ...macrostep.trace
    ],
    macrostep.step.state.done
  );
  let expected = macrostep;
  let [actual, actualEffects] = initialTransition(runtime);
  function compare(previous: AnyMachineSnapshot | undefined) {
    const { state } = expected.step;
    const status = state.done ? 'done' : 'active';
    assert.equal(actual.status, status);
    assert.deepEqual(
      actual.output,
      encoding.decodeValue(state.output ?? missing)
    );
    const active = new Set(state.snapshot.active);
    assert.deepEqual(ids(actual), state.snapshot.active);
    assert.deepEqual(actual.value, valueOf(root, active));
    assert.deepEqual(encoding.encode(actual.context), state.snapshot.context);
    assert.deepEqual(
      Object.keys(actual.context),
      Object.keys(encoding.decode(state.snapshot.context))
    );
    assert.equal(actual === previous, expected.step.snapshotReused);
    assert.equal(
      actual.context === (previous?.context ?? config.context),
      expected.step.contextReused
    );
    const terminates = status === 'done' && previous?.status !== 'done';
    assert.deepEqual(
      encoding.encodeEffects(withoutTermination(actualEffects, terminates)),
      expected.step.effects
    );
    for (const id of state.snapshot.active) {
      const node = authored(id);
      const activeChildren = [...node.children.values()].filter((child) =>
        active.has(modelId(child))
      );
      assert.equal(
        activeChildren.length,
        node.config.type === 'parallel'
          ? node.children.size
          : Math.min(node.children.size, 1)
      );
      if (node.parent) assert.ok(active.has(modelId(node.parent)));
    }
    return {
      value: actual.value,
      status,
      output: actual.output,
      context: actual.context,
      effects: encoding.decodeEffects(expected.step.effects),
      // Raised and done events in the order the macrostep queued them.
      raised: expected.step.raised.map((event) =>
        event.type.startsWith('xstate.done.state.:')
          ? `xstate.done.state.${event.type.slice(19)}`
          : event.type
      ),
      microsteps: expected.trace.length + 1,
      snapshotReused: expected.step.snapshotReused,
      contextReused: expected.step.contextReused
    };
  }
  const trace = [compare(undefined)];
  for (const [index, event] of events.entries()) {
    const previous = actual;
    const state = expected.step.state;
    const modelEvent = {
      type: event.type,
      value: encoding.encodeValue(event)
    };
    if (
      !state.done &&
      !model.parallelStepReady(machine, state.snapshot, modelEvent)
    ) {
      const reason = refusalReason(machine, state.snapshot, modelEvent);
      throw new Error(`Unsupported step: ${event.type} (${reason})`);
    }
    macrostep = settled(
      model.parallelMacrostep(machine, outputs, state, modelEvent, budget)
    );
    if (!macrostep.settled) {
      expectUnfinished(() => transition(runtime, previous, event), bound!);
      expectUnfinished(() => getMicrosteps(runtime, previous, event), bound!);
      return {
        trace,
        unfinished: {
          maxIterations: bound!,
          afterEvents: index
        } as Unfinished | undefined
      };
    }
    if (!state.done)
      compareMicrosteps(
        settledRuntime(() => getMicrosteps(runtime, previous, event)),
        [
          model.parallelMicrostep(machine, outputs, state, modelEvent, []),
          ...macrostep.trace
        ],
        macrostep.step.state.done
      );
    expected = macrostep;
    [actual, actualEffects] = transition(runtime, actual, event);
    trace.push(compare(previous));
  }
  return { trace, unfinished: undefined as Unfinished | undefined };
}
