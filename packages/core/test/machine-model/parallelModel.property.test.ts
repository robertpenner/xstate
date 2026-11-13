import fc from 'fast-check';
import { compareParallelTrace, type Config } from './parallelAdapter';

type State = NonNullable<Config['states']>[string];
const effect = () => {
  throw new Error('Effects must not execute');
};

it('compares generated single-parallel trees, targets and event traces', () => {
  const stats = {
    runs: 0,
    parallel: 0,
    refused: 0,
    steps: 0,
    multiSteps: 0,
    conflictSteps: 0,
    nestedDomainSteps: 0,
    mixedRegions: 0,
    reasons: {} as Record<string, number>
  };
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
        let parallel = false;
        let regionHeights: number[] = [];
        const height = (node: State): number =>
          Math.max(
            0,
            ...Object.values(node.states ?? {}).map(
              (child) => 1 + height(child!)
            )
          );
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
          const stopsEarly =
            level > 0 && numbers[(7 * index + 3) % numbers.length] % 4 === 0;
          if (level < depth && !stopsEarly) {
            if (!parallel && numbers[index] % 3 === 0) {
              parallel = true;
              node.type = 'parallel';
              node.states = { x: tree(level + 1), y: tree(level + 1) };
              if (numbers[index + 1] % 2) node.states.z = tree(level + 1);
              regionHeights = Object.values(node.states).map((region) =>
                height(region!)
              );
            } else {
              node.initial = 'x';
              node.states = { x: tree(level + 1) };
              if (numbers[index] % 2) node.states.y = tree(level + 1);
            }
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
        stats.runs++;
        if (parallel) stats.parallel++;
        if (new Set(regionHeights).size > 1) stats.mixedRegions++;
        try {
          const trace = compareParallelTrace(
            config,
            events.map((type) => ({ type }))
          );
          stats.steps += trace.length - 1;
          for (const step of trace) {
            if (step.selections > 1) stats.multiSteps++;
            if (step.kept < step.selections) stats.conflictSteps++;
            if (step.nestedDomains) stats.nestedDomainSteps++;
          }
        } catch (error) {
          if (
            !(error instanceof Error) ||
            !/^Unsupported step/.test(error.message)
          )
            throw error;
          stats.refused++;
          const reason = /\((.*)\)$/.exec(error.message)?.[1] ?? 'single';
          stats.reasons[reason] = (stats.reasons[reason] ?? 0) + 1;
        }
      }
    ),
    {
      seed: 8912,
      numRuns: 500,
      interruptAfterTimeLimit: 4000,
      markInterruptAsFailure: true
    }
  );
  console.info('parallel property coverage', stats);
  expect(stats.parallel).toBeGreaterThan(stats.runs / 4);
  expect(stats.steps).toBeGreaterThan(stats.runs);
  expect(stats.multiSteps).toBeGreaterThan(0);
  expect(stats.conflictSteps).toBeGreaterThan(0);
  expect(stats.nestedDomainSteps).toBeGreaterThan(0);
  expect(stats.mixedRegions).toBeGreaterThan(0);
});

it('compares generated initialization of multiple and nested parallel trees', () => {
  const stats = {
    runs: 0,
    multipleActiveParallel: 0,
    siblingActiveParallel: 0,
    maxNestedParallelDepth: 0,
    inactiveParallel: 0,
    refusedSteps: 0
  };
  fc.assert(
    fc.property(
      fc.integer({ min: 2, max: 4 }),
      fc.array(fc.integer({ min: 0, max: 100 }), {
        minLength: 80,
        maxLength: 80
      }),
      fc.boolean(),
      (depth, numbers, step) => {
        const all: State[] = [];
        const parallelIds = new Set<string>();
        const parentOf = new Map<string, string>();
        function tree(level: number, parent?: string): State {
          const index = all.length;
          const id = `id${index}`;
          if (parent !== undefined) parentOf.set(id, parent);
          const node: State = {
            id,
            entry: ({ context }, enq) => {
              enq(effect, 'entry', index, context.trail);
              return {
                context: { trail: (Number(context.trail) * 7 + index) % 1e9 }
              };
            }
          };
          all.push(node);
          const n = numbers[index % numbers.length];
          if (level < depth && (level === 0 || n % 4 !== 0)) {
            const states: Record<string, State> = { x: tree(level + 1, id) };
            if (n % 2 === 0) states.y = tree(level + 1, id);
            if (n % 5 === 0) states.z = tree(level + 1, id);
            node.states = states;
            if (n % 3 !== 1) {
              node.type = 'parallel';
              parallelIds.add(id);
            } else {
              node.initial = n % 2 === 0 && n % 7 === 0 ? 'y' : 'x';
            }
          }
          return node;
        }
        const root = tree(0);
        const config: Config = { ...root, context: { trail: 0 } };
        for (const node of all) node.on = { go: { target: '#id0' } };
        stats.runs++;
        const trace = (() => {
          try {
            return compareParallelTrace(config, step ? [{ type: 'go' }] : []);
          } catch (error) {
            if (
              !step ||
              !(error instanceof Error) ||
              error.message !== 'Unsupported step: go (multiple parallel nodes)'
            )
              throw error;
            stats.refusedSteps++;
            return compareParallelTrace(config, []);
          }
        })();
        if (step && parallelIds.size > 1) expect(trace).toHaveLength(1);
        const active = new Set(trace[0].active);
        const activeParallel = [...parallelIds].filter((id) => active.has(id));
        if (activeParallel.length < parallelIds.size) stats.inactiveParallel++;
        if (activeParallel.length > 1) stats.multipleActiveParallel++;
        let deepest = 0;
        for (const id of activeParallel) {
          let nested = 1;
          for (let p = parentOf.get(id); p !== undefined; p = parentOf.get(p))
            if (parallelIds.has(p)) nested++;
          deepest = Math.max(deepest, nested);
        }
        const isAncestor = (ancestor: string, id: string): boolean => {
          for (let p = parentOf.get(id); p !== undefined; p = parentOf.get(p))
            if (p === ancestor) return true;
          return false;
        };
        if (
          activeParallel.some((a) =>
            activeParallel.some(
              (b) => a < b && !isAncestor(a, b) && !isAncestor(b, a)
            )
          )
        )
          stats.siblingActiveParallel++;
        stats.maxNestedParallelDepth = Math.max(
          stats.maxNestedParallelDepth,
          deepest
        );
      }
    ),
    {
      seed: 2541,
      numRuns: 300,
      interruptAfterTimeLimit: 4000,
      markInterruptAsFailure: true
    }
  );
  console.info('nested parallel initialization coverage', stats);
  expect(stats.multipleActiveParallel).toBeGreaterThan(stats.runs / 4);
  expect(stats.siblingActiveParallel).toBeGreaterThan(stats.runs / 20);
  expect(stats.maxNestedParallelDepth).toBeGreaterThan(2);
  expect(stats.inactiveParallel).toBeGreaterThan(0);
  expect(stats.refusedSteps).toBeGreaterThan(0);
});
