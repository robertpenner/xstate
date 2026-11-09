import { createMachine } from 'xstate';
import { createFSM } from 'xstate/fsm';

// Event lookup uses Object.hasOwn, so createFSM ignores an inherited event.
const events = createFSM({
  initial: 'a',
  states: {
    a: { on: Object.create({ go: { target: 'b' } }) },
    b: {}
  }
});
const [afterInherited] = events.transition(events.initialState, { type: 'go' });
console.log(`createFSM, inherited event 'go': value ${afterInherited.value}`);

// State lookup reads config.states[value], so createFSM uses an inherited state.
const states = Object.create({ b: { on: { back: { target: 'a' } } } });
states.a = { on: { go: { target: 'b' } } };
const fsm = createFSM({ initial: 'a', states });
let [state] = fsm.transition(fsm.initialState, { type: 'go' });
console.log(`createFSM, after 'go': value ${state.value}, 'b' is own: ${Object.hasOwn(states, 'b')}`);
[state] = fsm.transition(state, { type: 'back' });
console.log(`createFSM, after 'back': value ${state.value}`);

// createMachine reads only the own states and rejects the same config.
try {
  createMachine({ initial: 'a', states });
  console.log('createMachine: created');
} catch (error) {
  console.log(`createMachine: ${error.message}`);
}
