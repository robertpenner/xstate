import assert from 'node:assert/strict';
import { createMachine, initialTransition, transition } from '../../src';
import { collectTree, type AuthoredNode, type Config } from './compoundAdapter';
import {
  createEncoding,
  plainRecord,
  validateResult,
  type Event
} from './machineAdapter';
import * as model from './machineModel';

export type { Config } from './compoundAdapter';

export function compareParallelTrace(config: Config, events: readonly Event[]) {
  for (const event of events) {
    plainRecord(event, 'event');
    if (typeof event.type !== 'string')
      throw new Error('Unsupported event.type');
  }
  const encoding = createEncoding();
  const { registry, root, resolveTarget } = collectTree(config, true);
  const modelId = (node: { id: string }) => `:${node.id}`;
  const authored = (id: string) => registry.get(id.slice(1))!;
  function initialPath(node: AuthoredNode): string[] {
    if (node.config.initial === undefined) return node.path;
    return initialPath(node.children.get(node.config.initial)!);
  }
  const nodes: Record<string, model.CompoundNode> = {};
  let parallel: string | undefined;
  for (const node of registry.values()) {
    const resolve = (target: string) => resolveTarget(node, target);
    for (const [type, handler] of Object.entries(node.config.on ?? {})) {
      if (!type || type.includes('*'))
        throw new Error(`Unsupported event name: ${type}`);
      if (typeof handler !== 'function')
        validateResult(handler, resolve, false);
    }
    if (node.config.type === 'parallel') parallel = modelId(node);
    nodes[modelId(node)] = {
      path: node.path,
      initialPath: initialPath(node),
      children: [...node.children.values()].map(modelId),
      initial:
        node.config.initial === undefined
          ? undefined
          : modelId(node.children.get(node.config.initial)!),
      on: new Map(
        Object.entries(node.config.on ?? {}).map(([type, definition]) => [
          type,
          encoding.evaluate(definition, false, resolve)
        ])
      ),
      entry: encoding.evaluate(node.config.entry, true, resolve),
      exit: encoding.evaluate(node.config.exit, true, resolve)
    };
  }
  const machine: model.ParallelMachine = {
    root: modelId(root),
    context: encoding.encode(config.context),
    nodes,
    order: [...registry.values()].map(modelId),
    parallel
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
    { ...compare(undefined), selections: 0, kept: 0, nestedDomains: false }
  ];
  for (const event of events) {
    const previous = actual;
    const modelEvent = {
      type: event.type,
      value: encoding.encodeValue(event)
    };
    if (!model.parallelStepReady(machine, expected.snapshot, modelEvent)) {
      const reason = refusalReason(machine, expected.snapshot, modelEvent);
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
    expected = model.parallelStep(machine, expected.snapshot, modelEvent);
    [actual, actualEffects] = transition(runtime, actual, event);
    trace.push({ ...compare(previous), selections, kept, nestedDomains });
  }
  return trace;
}

export type RefusalReason =
  | 'unknown target'
  | 'active region target'
  | 'targetless reentry'
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
    if (target === undefined) {
      if (selections.length > 1 && result?.reenter) return 'targetless reentry';
    } else if (!(target in machine.nodes)) {
      return 'unknown target';
    } else if (!model.selectionReady(machine, snapshot.active, selection)) {
      return 'active region target';
    }
  }
  if (!model.sourcesApart(selections)) return 'comparable sources';
  throw new Error('No refusal reason for an accepted step');
}
