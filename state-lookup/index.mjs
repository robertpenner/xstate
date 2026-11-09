import { createFSM } from 'xstate/fsm';

// Event lookup uses Object.hasOwn, so an inherited event key is ignored.
const events = createFSM({
  initial: 'a',
  states: {
    a: { on: Object.create({ go: 'b' }) },
    b: {}
  }
});
const [afterInherited] = events.transition(events.initialState, { type: 'go' });
console.log(`inherited event 'go': value ${afterInherited.value}`);

// State lookup reads config.states[value], so an inherited state is found.
const states = Object.create({ b: { on: { back: 'a' } } });
states.a = { on: { go: 'b' } };
const machine = createFSM({ initial: 'a', states });
let [state] = machine.transition(machine.initialState, { type: 'go' });
console.log(`after 'go': value ${state.value}, 'b' is own: ${Object.hasOwn(states, 'b')}`);
[state] = machine.transition(state, { type: 'back' });
console.log(`after 'back': value ${state.value}`);

