import fc from 'fast-check';
import { compareTrace, type Config } from './machineAdapter';

const effect = () => {
  throw new Error('Symbolic effects must not execute');
};
const shared = { marker: true };
const value = fc.constantFrom(undefined, NaN, -0, 0, 1, 'text', shared, null);
const patch = fc.dictionary(
  fc.constantFrom('count', 'key', '__proto__', 'toString'),
  value
);
const rule = fc.record({
  mode: fc.integer({ min: 0, max: 5 }),
  target: fc.constantFrom('a', 'b', undefined),
  patch: fc.option(patch, { nil: undefined }),
  reenter: fc.boolean(),
  effect: fc.boolean()
});

it('compares generated flat machines over complete event traces', () => {
  fc.assert(
    fc.property(
      patch,
      fc.array(rule, { minLength: 4, maxLength: 4 }),
      fc.array(fc.constantFrom('go', 'edit', 'missing'), { maxLength: 24 }),
      fc.boolean(),
      (context, rules, events, lifecycle) => {
        const states: Config['states'] = {};
        for (const [index, name] of ['a', 'b'].entries()) {
          const on: NonNullable<Config['states'][string]['on']> = {};
          for (const [offset, type] of ['go', 'edit'].entries()) {
            const r = rules[index * 2 + offset];
            const result = {
              target: r.target,
              context: r.patch,
              reenter: r.reenter
            };
            if (r.mode === 0) continue;
            if (r.mode === 1) on[type] = undefined;
            if (r.mode === 2) on[type] = result;
            if (r.mode >= 3)
              on[type] = ({ context, event }, enq) => {
                if (r.effect) enq(effect, name, event.type, context.key);
                if (r.mode === 3) return;
                if (r.mode === 4) return result;
                return {
                  ...result,
                  context: { count: Number(context.count ?? 0) + 1 }
                };
              };
          }
          states[name] = {
            on,
            entry: lifecycle
              ? ({ context }, enq) => {
                  enq(effect, 'entry', name, context.count);
                  return { context: { count: Number(context.count ?? 0) + 2 } };
                }
              : undefined,
            exit: lifecycle
              ? ({ context }, enq) => {
                  enq(effect, 'exit', name, context.count);
                  return { context: { count: Number(context.count ?? 0) + 3 } };
                }
              : undefined
          };
        }
        compareTrace(
          { initial: 'a', context, states },
          events.map((type) => ({ type }))
        );
      }
    ),
    {
      seed: 8911,
      numRuns: 500,
      interruptAfterTimeLimit: 4000,
      markInterruptAsFailure: true
    }
  );
});
