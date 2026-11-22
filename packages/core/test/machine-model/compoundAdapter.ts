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
  createEncoding,
  expectUnfinished,
  fields,
  plainRecord,
  settledRuntime,
  unboundedCap,
  validateResult,
  type Callback,
  type Context,
  type Event,
  type Output,
  type Transition,
  type Unfinished
} from './machineAdapter';
import * as model from './machineModel';

export type State = {
  id?: string;
  type?: 'atomic' | 'compound' | 'parallel' | 'final';
  initial?: string;
  states?: Record<string, State>;
  on?: Record<string, Transition>;
  onDone?: Transition;
  entry?: Callback;
  exit?: Callback;
  output?: Output;
};
export type Config = State & {
  context: Context;
  options?: { maxIterations?: number };
};
export type AuthoredNode = {
  config: State;
  id: string;
  key: string;
  parent: AuthoredNode | undefined;
  children: Map<string, AuthoredNode>;
  path: string[];
};

// Completion fields are `onDone`, `output`, final states and the root's
// `options`.
export function collectTree(
  config: Config,
  allowParallel: boolean,
  allowCompletion = !allowParallel
) {
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
        ...(allowCompletion ? ['onDone', 'output'] : []),
        ...(parent === undefined
          ? ['context', ...(allowCompletion ? ['options'] : [])]
          : [])
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
    if (state.output !== undefined && typeof state.output !== 'function')
      throw new Error(`Unsupported ${id}.output`);
    if (state.on !== undefined) {
      plainRecord(state.on, `${id}.on`);
      for (const type of Object.keys(state.on))
        if (!type || type.includes('*') || type.startsWith('xstate.'))
          throw new Error(`Unsupported event name: ${type}`);
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
      if (state.output !== undefined && parent !== undefined)
        throw new Error(`Unsupported ${id}.output`);
      if (state.onDone !== undefined && parent === undefined)
        throw new Error(`Unsupported ${id}.onDone`);
      return node;
    }
    if (state.type === 'final') {
      if (!allowCompletion || parent === undefined)
        throw new Error(`Unsupported state type: ${state.type}`);
      if (
        node.children.size > 0 ||
        state.initial !== undefined ||
        state.on !== undefined ||
        state.onDone !== undefined
      )
        throw new Error(`Unsupported transitions on final state ${id}`);
      return node;
    }
    // Root output is the machine output; other output belongs on final states.
    if (state.output !== undefined && parent !== undefined)
      throw new Error(`Unsupported ${id}.output`);
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
    // A done event for the root is discarded when the machine completes.
    if (state.onDone !== undefined && (!compound || parent === undefined))
      throw new Error(`Unsupported ${id}.onDone`);
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

export function iterationBound(config: Config): number | undefined {
  if (config.options === undefined) return undefined;
  plainRecord(config.options, 'options');
  fields(config.options, ['maxIterations'], 'options');
  const bound = config.options.maxIterations;
  if (bound !== undefined && (!Number.isInteger(bound) || bound < 1))
    throw new Error(`Unsupported options.maxIterations: ${String(bound)}`);
  return bound;
}

export function compareCompoundTrace(config: Config, events: readonly Event[]) {
  const run = compareCompoundRun(config, events);
  if (run.unfinished)
    throw new Error(
      `Macrostep reached maxIterations ${run.unfinished.maxIterations}`
    );
  return run.trace;
}

export function compareCompoundRun(config: Config, events: readonly Event[]) {
  for (const event of events) {
    plainRecord(event, 'event');
    if (typeof event.type !== 'string' || event.type.startsWith('xstate.'))
      throw new Error('Unsupported event.type');
  }
  const { registry, root, resolveTarget } = collectTree(config, false);
  const bound = iterationBound(config);
  const encoding = createEncoding((id) => id.slice(1));
  function initialPath(node: AuthoredNode): string[] {
    if (node.config.initial === undefined) return node.path;
    const child = node.children.get(node.config.initial);
    assert.ok(child, 'Validated initial child must exist');
    return initialPath(child);
  }
  const nodes: Record<string, model.CompoundNode> = {};
  for (const node of registry.values()) {
    const resolve = (target: string) => resolveTarget(node, target);
    const handlers = Object.entries(node.config.on ?? {});
    // The runtime matches `onDone` by the done event's state id; the model
    // keys it by the done event's type, which names the same state.
    if (node.config.onDone !== undefined)
      handlers.push([`xstate.done.state.:${node.id}`, node.config.onDone]);
    for (const [, handler] of handlers)
      if (typeof handler !== 'function')
        validateResult(handler, resolve, false);
    nodes[`:${node.id}`] = {
      path: node.path,
      initialPath: initialPath(node),
      children: [...node.children.values()].map((child) => `:${child.id}`),
      initial:
        node.config.initial === undefined
          ? undefined
          : `:${node.children.get(node.config.initial)!.id}`,
      on: new Map(
        handlers.map(([type, definition]) => [
          type,
          encoding.evaluate(definition, false, resolve, true)
        ])
      ),
      entry: encoding.evaluate(node.config.entry, true, resolve, true),
      exit: encoding.evaluate(node.config.exit, true, resolve, true),
      final: node.config.type === 'final',
      output: encoding.evaluateOutput(node.config.output)
    };
  }
  const machine: model.CompoundMachine = {
    root: `:${root.id}`,
    nodes,
    context: encoding.encode(config.context),
    hasOutput: config.output !== undefined,
    output: encoding.evaluateOutput(config.output)
  };
  const done = (step: model.CompoundStep) =>
    model.compoundDone(machine, step.snapshot.path);
  // The runtime ends a macrostep that completes the machine with a builtin
  // termination effect, which the model represents by its done status.
  const withoutTermination = (
    effects: readonly ExecutableEffect[],
    terminates: boolean
  ) => {
    if (!terminates) return effects;
    assert.equal(effects.at(-1)?.type, '@xstate.terminate');
    return effects.slice(0, -1);
  };
  const budget = bound ?? unboundedCap;
  const settled = (macrostep: model.CompoundMacrostep) => {
    if (macrostep.refused)
      throw new Error('Unsupported raised event outside the model domain');
    if (!macrostep.settled && bound === undefined)
      throw new Error(
        `Unsupported unbounded macrostep: no rest within ${unboundedCap} iterations`
      );
    return macrostep;
  };
  const value = (path: readonly string[]) => {
    const keys = path.slice(1).map((id) => registry.get(id.slice(1))!.key);
    let result: string | Record<string, unknown> = keys.at(-1) ?? {};
    for (let index = keys.length - 2; index >= 0; index--)
      result = { [keys[index]]: result };
    return result;
  };
  const runtime = createMachine(config);
  const initialEvent = {
    type: 'xstate.init',
    value: encoding.encodeValue({ type: 'xstate.init', input: undefined })
  };
  let macrostep = settled(
    model.compoundInitialMacrostep(machine, initialEvent, budget)
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
      model.compoundInitialTransition(machine, initialEvent),
      ...macrostep.trace
    ],
    done(macrostep.step)
  );
  let expected = macrostep.step;
  let [actual, actualEffects] = initialTransition(runtime);
  function compareMicrosteps(
    microsteps: ReadonlyArray<
      readonly [AnyMachineSnapshot, readonly ExecutableEffect[], unknown]
    >,
    steps: readonly model.CompoundStep[],
    terminates: boolean
  ) {
    assert.equal(microsteps.length, steps.length);
    steps.forEach((step, index) => {
      const [snapshot, effects] = microsteps[index];
      assert.deepEqual(snapshot.value, value(step.snapshot.path));
      assert.deepEqual(
        encoding.encode(snapshot.context),
        step.snapshot.context
      );
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
  function compare(previous: AnyMachineSnapshot | undefined) {
    const status = done(expected) ? 'done' : 'active';
    assert.equal(actual.status, status);
    assert.equal(
      encoding.encodeValue(actual.output),
      expected.snapshot.output ?? encoding.encodeValue(undefined)
    );
    assert.deepEqual(
      actual.nodes.map((node) => `:${node.id}`).sort(),
      [...expected.snapshot.path].sort()
    );
    assert.deepEqual(actual.value, value(expected.snapshot.path));
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
    const terminates = status === 'done' && previous?.status !== 'done';
    assert.deepEqual(
      encoding.encodeEffects(withoutTermination(actualEffects, terminates)),
      expected.effects
    );
    for (const node of actual.nodes) {
      const children: typeof actual.nodes = actual.nodes.filter(
        (child) => child.parent === node
      );
      assert.equal(children.length, node.type === 'compound' ? 1 : 0);
      if (node.parent) assert.ok(actual.nodes.includes(node.parent));
    }
    return {
      value: actual.value,
      status,
      output: actual.output,
      context: actual.context,
      effects: encoding.decodeEffects(expected.effects),
      snapshotReused: expected.snapshotReused,
      contextReused: expected.contextReused
    };
  }
  const trace = [compare(undefined)];
  for (const [index, event] of events.entries()) {
    const previous = actual;
    const modelEvent = {
      type: event.type,
      value: encoding.encodeValue(event)
    };
    macrostep = settled(
      model.compoundMacrostep(machine, expected.snapshot, modelEvent, budget)
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
    compareMicrosteps(
      settledRuntime(() => getMicrosteps(runtime, previous, event)),
      [
        model.compoundTransition(machine, expected.snapshot, modelEvent),
        ...macrostep.trace
      ],
      done(macrostep.step) && !done(expected)
    );
    expected = macrostep.step;
    [actual, actualEffects] = transition(runtime, actual, event);
    trace.push(compare(previous));
  }
  return { trace, unfinished: undefined as Unfinished | undefined };
}
