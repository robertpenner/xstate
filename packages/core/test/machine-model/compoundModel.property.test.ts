import fc from 'fast-check';
import {
  compareCompoundTrace,
  type Config,
  type State
} from './compoundAdapter';

const effect = () => {
  throw new Error('Effects must not execute');
};

it('compares generated compound trees, cross-branch targets and event traces', () => {
  fc.assert(
    fc.property(
      fc.integer({ min: 1, max: 4 }),
      fc.array(fc.integer({ min: 0, max: 100 }), {
        minLength: 80,
        maxLength: 80
      }),
      fc.array(fc.constantFrom('a', 'b', 'missing'), {
        minLength: 1,
        maxLength: 20
      }),
      (depth, numbers, events) => {
        const all: State[] = [];
        function tree(level: number): State {
          const index = all.length;
          const node: State = {
            id: `id${index}`,
            entry: ({ context }, enq) => {
              enq(effect, 'entry', index, context.count);
              return { context: { count: Number(context.count) + 1 } };
            },
            exit: ({ context }, enq) => {
              enq(effect, 'exit', index, context.count);
              return { context: { count: Number(context.count) + 2 } };
            }
          };
          all.push(node);
          if (level < depth) {
            node.initial = 'x';
            node.states = { x: tree(level + 1) };
            if (numbers[index] % 2) node.states.y = tree(level + 1);
          }
          return node;
        }
        const config: Config = { ...tree(0), context: { count: 0 } };
        all[0] = config;
        for (const [index, node] of all.entries()) {
          node.on = {};
          for (const [offset, type] of ['a', 'b'].entries()) {
            const n = numbers[(2 * index + offset) % numbers.length];
            const result = {
              target: n % 5 === 0 ? undefined : `#id${n % all.length}`,
              reenter: n % 3 === 0,
              context: { count: n }
            };
            if (n % 7 === 0) continue;
            if (n % 7 === 1) node.on[type] = undefined;
            else if (n % 7 === 2) node.on[type] = () => undefined;
            else if (n % 7 === 3)
              node.on[type] = (_, enq) => {
                enq(effect, 'effect-only');
              };
            else if (n % 7 === 4) node.on[type] = result;
            else
              node.on[type] = ({ context }, enq) => {
                enq(effect, 'transition', index, context.count);
                return result;
              };
          }
        }
        compareCompoundTrace(
          config,
          events.map((type) => ({ type }))
        );
      }
    ),
    {
      seed: 8912,
      numRuns: 500,
      interruptAfterTimeLimit: 4000,
      markInterruptAsFailure: true
    }
  );
});
