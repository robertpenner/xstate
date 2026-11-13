import assert from 'node:assert/strict';
import { createMachine, initialTransition, transition } from '../../src';
import {
  createEncoding,
  fields,
  plainRecord,
  validateResult,
  type Callback,
  type Context,
  type Event,
  type Transition
} from './machineAdapter';
import * as model from './machineModel';

export type State = {
  id?: string;
  type?: 'atomic' | 'compound' | 'parallel';
  initial?: string;
  states?: Record<string, State>;
  on?: Record<string, Transition>;
  entry?: Callback;
  exit?: Callback;
};
export type Config = State & { context: Context };
export type AuthoredNode = {
  config: State;
  id: string;
  key: string;
  parent: AuthoredNode | undefined;
  children: Map<string, AuthoredNode>;
  path: string[];
};

export function collectTree(config: Config, allowParallel: boolean) {
  plainRecord(config.context, 'context');
  const registry = new Map<string, AuthoredNode>();
  const rootId = config.id ?? '';
  function collect(
    state: State,
    keyPath: string[],
    parent?: AuthoredNode
  ): AuthoredNode {
    fields(
      state,
      [
        'id',
        'type',
        'initial',
        'states',
        'on',
        'entry',
        'exit',
        ...(parent === undefined ? ['context'] : [])
      ],
      keyPath.join('.') || 'root'
    );
    if (state.id !== undefined && typeof state.id !== 'string')
      throw new Error('Unsupported id');
    const id = state.id || [rootId, ...keyPath].filter(Boolean).join('.');
    if (registry.has(id)) throw new Error(`Unsupported duplicate id: ${id}`);
    const node: AuthoredNode = {
      config: state,
      id,
      key: keyPath.at(-1) ?? '',
      parent,
      children: new Map(),
      path: [...(parent?.path ?? []), `:${id}`]
    };
    registry.set(id, node);
    for (const kind of ['entry', 'exit'] as const) {
      if (state[kind] !== undefined && typeof state[kind] !== 'function') {
        throw new Error(`Unsupported ${id}.${kind}`);
      }
    }
    if (state.states !== undefined) {
      plainRecord(state.states, `${id}.states`);
      for (const [key, child] of Object.entries(state.states)) {
        if (!key || /[.#]/.test(key))
          throw new Error(`Unsupported state key: ${key}`);
        node.children.set(key, collect(child, [...keyPath, key], node));
      }
    }
    if (state.type === 'parallel') {
      if (!allowParallel)
        throw new Error(`Unsupported state type: ${state.type}`);
      if (node.children.size === 0)
        throw new Error(`Unsupported parallel state without regions at ${id}`);
      if (state.initial !== undefined)
        throw new Error(`Unsupported parallel initial at ${id}`);
      if (state.on !== undefined) plainRecord(state.on, `${id}.on`);
      return node;
    }
    const compound = node.children.size > 0;
    if (
      state.type !== undefined &&
      state.type !== (compound ? 'compound' : 'atomic')
    ) {
      throw new Error(`Unsupported state type: ${state.type}`);
    }
    if (
      compound &&
      (typeof state.initial !== 'string' || !node.children.has(state.initial))
    ) {
      throw new Error(`Unsupported initial state at ${id}`);
    }
    if (!compound && state.initial !== undefined)
      throw new Error(`Unsupported atomic initial at ${id}`);
    if (state.on !== undefined) plainRecord(state.on, `${id}.on`);
    return node;
  }
  function resolveTarget(source: AuthoredNode, target: string): string {
    if (target.startsWith('#')) {
      if (target.length === 1 || !registry.has(target.slice(1))) {
        throw new Error(`Unsupported ID target: ${target}`);
      }
      return `:${target.slice(1)}`;
    }
    const relative = target.startsWith('.');
    const keys = (relative ? target.slice(1) : target).split('.');
    let node = relative ? source : (source.parent ?? source);
    for (const key of keys) {
      const child = node.children.get(key);
      if (!child) throw new Error(`Unsupported relative target: ${target}`);
      node = child;
    }
    return `:${node.id}`;
  }
  const root = collect(config, []);
  return { registry, root, resolveTarget };
}

export function compareCompoundTrace(config: Config, events: readonly Event[]) {
  for (const event of events) {
    plainRecord(event, 'event');
    if (typeof event.type !== 'string')
      throw new Error('Unsupported event.type');
  }
  const encoding = createEncoding();
  const { registry, root, resolveTarget } = collectTree(config, false);
  function initialPath(node: AuthoredNode): string[] {
    if (node.config.initial === undefined) return node.path;
    const child = node.children.get(node.config.initial);
    assert.ok(child, 'Validated initial child must exist');
    return initialPath(child);
  }
  const nodes: Record<string, model.CompoundNode> = {};
  for (const node of registry.values()) {
    const resolve = (target: string) => resolveTarget(node, target);
    for (const [type, handler] of Object.entries(node.config.on ?? {})) {
      if (!type || type.includes('*'))
        throw new Error(`Unsupported event name: ${type}`);
      if (typeof handler !== 'function')
        validateResult(handler, resolve, false);
    }
    nodes[`:${node.id}`] = {
      path: node.path,
      initialPath: initialPath(node),
      children: [...node.children.values()].map((child) => `:${child.id}`),
      initial:
        node.config.initial === undefined
          ? undefined
          : `:${node.children.get(node.config.initial)!.id}`,
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
  const machine: model.CompoundMachine = {
    root: `:${root.id}`,
    nodes,
    context: encoding.encode(config.context)
  };
  const runtime = createMachine(config);
  let expected = model.compoundInitialTransition(machine, {
    type: 'xstate.init',
    value: encoding.encodeValue({ type: 'xstate.init', input: undefined })
  });
  let [actual, actualEffects] = initialTransition(runtime);
  function compare(previous: typeof actual | undefined) {
    assert.equal(actual.status, 'active');
    assert.deepEqual(
      actual.nodes.map((node) => `:${node.id}`).sort(),
      [...expected.snapshot.path].sort()
    );
    const keys = expected.snapshot.path
      .slice(1)
      .map((id) => registry.get(id.slice(1))!.key);
    let value: string | Record<string, unknown> = keys.at(-1) ?? {};
    for (let index = keys.length - 2; index >= 0; index--)
      value = { [keys[index]]: value };
    assert.deepEqual(actual.value, value);
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
    for (const node of actual.nodes) {
      const children: typeof actual.nodes = actual.nodes.filter(
        (child) => child.parent === node
      );
      assert.equal(children.length, node.type === 'compound' ? 1 : 0);
      if (node.parent) assert.ok(actual.nodes.includes(node.parent));
    }
    return {
      value: actual.value,
      context: actual.context,
      effects: encoding.decodeEffects(expected.effects),
      snapshotReused: expected.snapshotReused,
      contextReused: expected.contextReused
    };
  }
  const trace = [compare(undefined)];
  for (const event of events) {
    const previous = actual;
    expected = model.compoundTransition(machine, expected.snapshot, {
      type: event.type,
      value: encoding.encodeValue(event)
    });
    [actual, actualEffects] = transition(runtime, actual, event);
    trace.push(compare(previous));
  }
  return trace;
}
