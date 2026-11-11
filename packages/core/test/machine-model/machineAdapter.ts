import assert from 'node:assert/strict';
import {
  createMachine,
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
  entry?: Callback;
  exit?: Callback;
};
export type Config = {
  initial: string;
  context: Context;
  states: Record<string, State>;
};

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
  fields(config, ['initial', 'context', 'states'], 'config');
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
    fields(node, ['on', 'entry', 'exit'], `states.${name}`);
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

export function compareTrace(config: Config, events: readonly Event[]) {
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
          entry: evaluate(node.entry, true, resolveTarget),
          exit: evaluate(node.exit, true, resolveTarget)
        }
      ])
    )
  };
  const runtime = createMachine(config);
  let expected = model.initialTransition(machine, {
    type: 'xstate.init',
    value: encodeValue({ type: 'xstate.init', input: undefined })
  });
  let [actual, actualEffects] = initialTransition(runtime);
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
  for (const event of events) {
    const previous = actual;
    expected = model.transition(machine, expected.snapshot, {
      type: event.type,
      value: encodeValue(event)
    });
    [actual, actualEffects] = transition(runtime, actual, event);
    trace.push(compare(previous));
  }
  return trace;
}
