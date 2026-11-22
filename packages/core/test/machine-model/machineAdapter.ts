import assert from 'node:assert/strict';
import {
  createMachine,
  getInitialMicrosteps,
  getMicrosteps,
  InfiniteTransitionError,
  initialTransition,
  transition,
  type AnyMachineSnapshot,
  type ExecutableEffect
} from '../../src';
import * as model from './machineModel';

export type Context = Record<string, unknown>;
export type Event = { type: string; [key: string]: unknown };
type Result = { target?: string; context?: Context; reenter?: boolean };
type Enqueue = (
  action: (...args: unknown[]) => void,
  ...args: unknown[]
) => void;
export type Callback = (
  args: { context: Context; event: Event },
  enq: Enqueue
) => Result | void;
export type Transition = Result | Callback | undefined;
type State = {
  on?: Record<string, Transition>;
  always?: Transition;
  entry?: Callback;
  exit?: Callback;
};
export type Config = {
  initial: string;
  context: Context;
  states: Record<string, State>;
  options?: { maxIterations?: number };
};

// The runtime's default bound is unlimited. Without an explicit bound the
// adapter runs the model to this cap and refuses a macrostep that reaches it.
const unboundedCap = 1000;

export function plainRecord(
  value: unknown,
  location: string
): asserts value is Context {
  if (
    typeof value !== 'object' ||
    value === null ||
    (Object.getPrototypeOf(value) !== Object.prototype &&
      Object.getPrototypeOf(value) !== null)
  ) {
    throw new Error(`Unsupported record at ${location}`);
  }
  for (const key of Reflect.ownKeys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key)!;
    if (
      typeof key !== 'string' ||
      !descriptor.enumerable ||
      !('value' in descriptor)
    ) {
      throw new Error(`Unsupported property at ${location}.${String(key)}`);
    }
  }
}

export function fields(
  value: unknown,
  allowed: readonly string[],
  location: string
) {
  plainRecord(value, location);
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key))
      throw new Error(`Unsupported field ${location}.${key}`);
  }
}

export function validateResult(
  value: unknown,
  resolveTarget: (target: string) => string,
  lifecycle: boolean
) {
  if (value === undefined) return;
  fields(
    value,
    lifecycle ? ['context'] : ['target', 'context', 'reenter'],
    'result'
  );
  const result = value as Result;
  if (result.target !== undefined && typeof result.target !== 'string') {
    throw new Error(`Unsupported target: ${String(result.target)}`);
  }
  if (result.target !== undefined) resolveTarget(result.target);
  if (result.reenter !== undefined && typeof result.reenter !== 'boolean') {
    throw new Error('Unsupported result.reenter');
  }
  if (result.context !== undefined) plainRecord(result.context, 'patch');
}

function validateConfig(config: Config) {
  fields(config, ['initial', 'context', 'states', 'options'], 'config');
  if (config.options !== undefined) {
    fields(config.options, ['maxIterations'], 'options');
    const bound = config.options.maxIterations;
    if (bound !== undefined && !(Number.isSafeInteger(bound) && bound >= 1))
      throw new Error(`Unsupported options.maxIterations: ${String(bound)}`);
  }
  plainRecord(config.states, 'states');
  plainRecord(config.context, 'context');
  if (
    typeof config.initial !== 'string' ||
    !Object.hasOwn(config.states, config.initial)
  ) {
    throw new Error('Unsupported initial state');
  }
  for (const [name, node] of Object.entries(config.states)) {
    if (!name || /[.#]/.test(name))
      throw new Error(`Unsupported flat state name: ${name}`);
    fields(node, ['on', 'always', 'entry', 'exit'], `states.${name}`);
    if (Array.isArray(node.always))
      throw new Error(`Unsupported states.${name}.always array`);
    if (node.always !== undefined && typeof node.always !== 'function')
      validateResult(
        node.always,
        (target) => flatTarget(config, target),
        false
      );
    for (const kind of ['entry', 'exit'] as const) {
      if (node[kind] !== undefined && typeof node[kind] !== 'function') {
        throw new Error(`Unsupported states.${name}.${kind}`);
      }
    }
    if (node.on === undefined) continue;
    plainRecord(node.on, `states.${name}.on`);
    for (const [type, handler] of Object.entries(node.on)) {
      if (!type || type.includes('*'))
        throw new Error(`Unsupported event name: ${type}`);
      if (typeof handler !== 'function')
        validateResult(handler, (target) => flatTarget(config, target), false);
    }
  }
}

function flatTarget(config: Config, target: string) {
  if (!Object.hasOwn(config.states, target))
    throw new Error(`Unsupported target: ${target}`);
  return target;
}

export function createEncoding() {
  const values: unknown[] = [];
  const encodeValue = (value: unknown) => {
    const found = values.findIndex((entry) => Object.is(value, entry));
    if (found >= 0) return found;
    values.push(value);
    return values.length - 1;
  };
  const encode = (context: Context): Record<string, number> => {
    plainRecord(context, 'context');
    return {
      $prototype: encodeValue(Object.getPrototypeOf(context)),
      ...Object.fromEntries(
        Object.entries(context).map(([key, value]) => [
          `:${key}`,
          encodeValue(value)
        ])
      )
    };
  };
  const decode = (context: Record<string, number>): Context => {
    const prototype = values[context.$prototype];
    assert.ok(
      prototype === null || prototype === Object.prototype,
      'Encoded context must retain its prototype'
    );
    const decoded = Object.fromEntries(
      Object.entries(context)
        .filter(([key]) => key !== '$prototype')
        .map(([key, value]) => [key.slice(1), values[value]])
    );
    Object.setPrototypeOf(decoded, prototype);
    return decoded;
  };
  const evaluate =
    (
      definition: Transition,
      lifecycle: boolean,
      resolveTarget: (target: string) => string
    ) =>
    (context: Record<string, number>, event: model.Event): model.Evaluation => {
      const effects: model.Effect[] = [];
      let unsupported: Error | undefined;
      const refuse = (message: string): never => {
        unsupported ??= new Error(message);
        throw unsupported;
      };
      const enqueueAccess = (_target: Enqueue, key: string | symbol): never =>
        refuse(`Unsupported enqueue operation: ${String(key)}`);
      const argumentKey = (key: string | symbol) => {
        if (key !== 'context' && key !== 'event')
          refuse(`Unsupported callback argument: ${String(key)}`);
      };
      const enqueue: Enqueue = new Proxy(
        (action: (...args: unknown[]) => void, ...args: unknown[]) => {
          if (typeof action !== 'function') refuse('Unsupported effect');
          effects.push({
            action: encodeValue(action),
            args: args.map(encodeValue)
          });
        },
        {
          get: enqueueAccess,
          has: enqueueAccess,
          getOwnPropertyDescriptor: enqueueAccess,
          ownKeys: () => refuse('Unsupported enqueue enumeration'),
          getPrototypeOf: () =>
            refuse('Unsupported enqueue prototype inspection')
        }
      );
      const result =
        typeof definition === 'function'
          ? definition(
              new Proxy(
                {
                  context: decode(context),
                  event: values[event.value] as Event
                },
                {
                  get: (target, key, receiver) => {
                    argumentKey(key);
                    return Reflect.get(target, key, receiver);
                  },
                  has: (target, key) => {
                    argumentKey(key);
                    return Reflect.has(target, key);
                  },
                  getOwnPropertyDescriptor: (target, key) => {
                    argumentKey(key);
                    return Reflect.getOwnPropertyDescriptor(target, key);
                  },
                  ownKeys: () =>
                    refuse('Unsupported callback argument enumeration'),
                  getPrototypeOf: () =>
                    refuse('Unsupported callback argument prototype inspection')
                }
              ),
              enqueue
            )
          : definition;
      if (unsupported) throw unsupported;
      validateResult(result, resolveTarget, lifecycle);
      const normalized =
        result ??
        (typeof definition === 'function' || lifecycle ? undefined : {});
      return {
        result:
          normalized === undefined
            ? undefined
            : {
                target:
                  normalized.target === undefined
                    ? undefined
                    : resolveTarget(normalized.target),
                reenter: normalized.reenter ?? false,
                patch:
                  normalized.context === undefined
                    ? undefined
                    : Object.entries(encode({ ...normalized.context })).map(
                        ([key, value]) => ({ key, value })
                      )
              },
        effects
      };
    };
  const encodeEffects = (effects: readonly ExecutableEffect[]) =>
    effects.map((effect) => {
      if (
        !('action' in effect) ||
        typeof effect.action !== 'function' ||
        !('args' in effect)
      ) {
        throw new Error(`Unsupported runtime effect: ${effect.type}`);
      }
      return {
        action: encodeValue(effect.action),
        args: effect.args.map(encodeValue)
      };
    });
  const decodeEffects = (effects: readonly model.Effect[]) =>
    effects.map((effect) => ({
      action: values[effect.action],
      args: effect.args.map((arg) => values[arg])
    }));
  return {
    encodeValue,
    encode,
    decode,
    evaluate,
    encodeEffects,
    decodeEffects
  };
}

export type Unfinished = { maxIterations: number; afterEvents: number };

export function compareTrace(config: Config, events: readonly Event[]) {
  const run = compareRun(config, events);
  if (run.unfinished)
    throw new Error(
      `Macrostep reached maxIterations ${run.unfinished.maxIterations}`
    );
  return run.trace;
}

export function compareRun(config: Config, events: readonly Event[]) {
  validateConfig(config);
  for (const event of events) {
    plainRecord(event, 'event');
    if (typeof event.type !== 'string')
      throw new Error('Unsupported event.type');
  }
  const {
    encodeValue,
    encode,
    decode,
    evaluate,
    encodeEffects,
    decodeEffects
  } = createEncoding();
  const resolveTarget = (target: string) => flatTarget(config, target);
  const machine: model.Machine = {
    initial: config.initial,
    context: encode(config.context),
    states: new Map(
      Object.entries(config.states).map(([key, node]) => [
        key,
        {
          on: new Map(
            Object.entries(node.on ?? {}).map(([event, result]) => [
              event,
              evaluate(result, false, resolveTarget)
            ])
          ),
          always:
            node.always === undefined
              ? declining
              : evaluate(node.always, false, resolveTarget),
          entry: evaluate(node.entry, true, resolveTarget),
          exit: evaluate(node.exit, true, resolveTarget)
        }
      ])
    )
  };
  const runtime = createMachine(config);
  const bound = config.options?.maxIterations;
  const budget = bound ?? unboundedCap;
  const settled = (macrostep: model.Macrostep) => {
    if (!macrostep.settled && bound === undefined)
      throw new Error(
        `Unsupported unbounded macrostep: no rest within ${unboundedCap} iterations`
      );
    return macrostep;
  };
  const initialEvent = {
    type: 'xstate.init',
    value: encodeValue({ type: 'xstate.init', input: undefined })
  };
  let macrostep = settled(
    model.initialMacrostep(machine, initialEvent, budget)
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
    model.initialTransition(machine, initialEvent),
    macrostep.trace
  );
  let expected = macrostep.step;
  let [actual, actualEffects] = initialTransition(runtime);
  function compareMicrosteps(
    microsteps: ReadonlyArray<
      readonly [AnyMachineSnapshot, readonly ExecutableEffect[], unknown]
    >,
    first: model.Step,
    eventless: readonly model.Step[]
  ) {
    assert.equal(microsteps.length, 1 + eventless.length);
    [first, ...eventless].forEach((step, index) => {
      const [snapshot, effects] = microsteps[index];
      assert.equal(snapshot.value, step.snapshot.value);
      assert.deepEqual(encode(snapshot.context), step.snapshot.context);
      assert.deepEqual(encodeEffects(effects), step.effects);
      // Snapshot identity is compared per macrostep only: the runtime replaces
      // the last microstep's snapshot with a clone when a handled macrostep
      // would otherwise return the previous snapshot.
      if (index > 0) {
        const [before] = microsteps[index - 1];
        assert.equal(snapshot.context === before.context, step.contextReused);
      }
    });
  }
  function compare(previous: AnyMachineSnapshot | undefined) {
    assert.equal(actual.status, 'active');
    assert.equal(actual.value, expected.snapshot.value);
    assert.deepEqual(encode(actual.context), expected.snapshot.context);
    assert.deepEqual(
      Object.keys(actual.context),
      Object.keys(decode(expected.snapshot.context))
    );
    assert.equal(actual === previous, expected.snapshotReused);
    assert.equal(
      actual.context === (previous?.context ?? config.context),
      expected.contextReused
    );
    assert.deepEqual(encodeEffects(actualEffects), expected.effects);
    return {
      value: expected.snapshot.value,
      context: actual.context,
      effects: decodeEffects(expected.effects),
      snapshotReused: expected.snapshotReused,
      contextReused: expected.contextReused
    };
  }
  const trace = [compare(undefined)];
  for (const [index, event] of events.entries()) {
    const previous = actual;
    const modelEvent = { type: event.type, value: encodeValue(event) };
    macrostep = settled(
      model.transitionMacrostep(machine, expected.snapshot, modelEvent, budget)
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
      model.transition(machine, expected.snapshot, modelEvent),
      macrostep.trace
    );
    expected = macrostep.step;
    [actual, actualEffects] = transition(runtime, actual, event);
    trace.push(compare(previous));
  }
  return { trace, unfinished: undefined as Unfinished | undefined };
}

const declining = (): model.Evaluation => ({ result: undefined, effects: [] });

// The model settled, so a runtime InfiniteTransitionError is a disagreement.
function settledRuntime<T>(run: () => T): T {
  let result: T | undefined;
  assert.doesNotThrow(() => {
    result = run();
  });
  return result as T;
}

function expectUnfinished(run: () => unknown, maxIterations: number) {
  assert.throws(
    run,
    (error: unknown) =>
      error instanceof InfiniteTransitionError &&
      error.maxIterations === maxIterations
  );
}
