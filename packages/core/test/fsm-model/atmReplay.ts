import { createFSM } from '../../src/fsm';
import fixture from './atm-prefix-replay.json';
import { toModel, type JsSnapshot } from './fsmAdapter';
import { initialState, transition, type FSMEvent } from './fsmModel';

const authorizedInBanking = ({ value, context }: JsSnapshot) =>
  value !== 'banking' ||
  (Object.hasOwn(context, 'authorized') && context.authorized === true);

export function assertAtmReplay({
  events,
  faultyFirstBadPrefix
}: {
  events: readonly FSMEvent[];
  faultyFirstBadPrefix: number | null;
}) {
  for (const variant of ['intended', 'faulty'] as const) {
    const config = fixture.variants[variant];
    const fsm = createFSM<{ authorized: boolean }, FSMEvent>(config);
    const { machine, decodeContext } = toModel(config);
    let runtime = fsm.initialState;
    let model = initialState(machine);

    function checkPrefix(length: number) {
      const label = `${variant} at prefix ${length}: ${JSON.stringify(events.slice(0, length))}`;
      const decoded = {
        value: model.value,
        context: decodeContext(model.context)
      };
      expect(runtime.value, label).toBe(decoded.value);
      expect(runtime.context, label).toStrictEqual(decoded.context);
      const valid =
        variant === 'intended' ||
        faultyFirstBadPrefix === null ||
        length < faultyFirstBadPrefix;
      expect(authorizedInBanking(runtime), `${label} (runtime)`).toBe(valid);
      expect(authorizedInBanking(decoded), `${label} (model)`).toBe(valid);
    }

    expect(runtime).toMatchObject({
      value: 'idle',
      context: { authorized: false }
    });
    checkPrefix(0);
    for (const [index, event] of events.entries()) {
      const [next] = fsm.transition(runtime, event);
      const step = transition(machine, model, event);
      expect(next === runtime).toBe(step.reused);
      if (runtime.value === 'idle' && event.type === 'LOGIN') {
        expect(next).toMatchObject({
          value: 'banking',
          context: { authorized: true }
        });
      } else if (runtime.value === 'banking' && event.type === 'EXPIRE') {
        expect(next).toMatchObject({
          value: variant === 'intended' ? 'idle' : 'banking',
          context: { authorized: false }
        });
      } else {
        expect(next).toBe(runtime);
        expect(step.snapshot).toBe(model);
      }
      runtime = next;
      model = step.snapshot;
      checkPrefix(index + 1);
    }
  }
}
