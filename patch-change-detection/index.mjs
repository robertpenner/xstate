import { createMachine, initialTransition, transition } from 'xstate';
import { createFSM } from 'xstate/fsm';

const config = (context, patch) => ({
  initial: 'idle',
  context: { ...context },
  states: { idle: { on: { set: { context: patch } } } }
});

function viaFSM(context, patch) {
  const machine = createFSM(config(context, patch));
  const before = machine.initialState;
  const [after] = machine.transition(before, { type: 'set' });
  return { context: after.context, reused: after === before };
}

function viaMachine(context, patch) {
  const machine = createMachine(config(context, patch));
  const [before] = initialTransition(machine);
  const [after] = transition(machine, before, { type: 'set' });
  return { context: after.context, reused: after === before };
}

function format(context) {
  const entries = Object.entries(context).map(([key, value]) => {
    const shown = Object.is(value, -0) ? '-0' : typeof value === 'function' ? '[function]' : String(value);
    return `${key}: ${shown}`;
  });
  return `{ ${entries.join(', ')} }`;
}

function compare(label, context, patch) {
  const fsm = viaFSM(context, patch);
  const machine = viaMachine(context, patch);
  console.log(label);
  console.log(`  createFSM:     ${format(fsm.context)}, same snapshot: ${fsm.reused}`);
  console.log(`  createMachine: ${format(machine.context)}, same snapshot: ${machine.reused}`);
}

// 1. NaN over NaN
compare('{ x: NaN } over { x: NaN }', { x: NaN }, { x: NaN });

// 2. undefined for a key the context does not have
compare('{ z: undefined } over { x: 0 }', { x: 0 }, { z: undefined });
compare('{ z: undefined, x: 1 } over { x: 0 }', { x: 0 }, { z: undefined, x: 1 });

// 3. A value equal to the one the context inherits
const toString = Object.prototype.toString;
compare('{ toString } over { x: 0 }', { x: 0 }, { toString });
compare('{ toString, x: 1 } over { x: 0 }', { x: 0 }, { toString, x: 1 });

// 4. -0 over 0
compare('{ x: -0 } over { x: 0, y: 0 }', { x: 0, y: 0 }, { x: -0 });
compare('{ x: -0, y: 1 } over { x: 0, y: 0 }', { x: 0, y: 0 }, { x: -0, y: 1 });

// For comparison: a patch that changes nothing
compare('{ x: 1 } over { x: 1 }', { x: 1 }, { x: 1 });
