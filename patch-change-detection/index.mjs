import { createFSM } from 'xstate/fsm';

function step(context, patch) {
  const machine = createFSM({
    initial: 'idle',
    context,
    states: { idle: { on: { set: { context: patch } } } }
  });
  const before = machine.initialState;
  const [after] = machine.transition(before, { type: 'set' });
  return { after, reused: after === before };
}

function show(label, { after, reused }) {
  const entries = Object.entries(after.context).map(([key, value]) =>
    `${key}: ${Object.is(value, -0) ? '-0' : typeof value === 'function' ? 'ƒ' : String(value)}`
  );
  console.log(`${label}\n  context { ${entries.join(', ')} }, same snapshot: ${reused}`);
}

// 1. NaN over NaN
show('{ x: NaN } over { x: NaN }', step({ x: NaN }, { x: NaN }));

// 2. undefined for a key the context does not have
show('{ z: undefined } over { x: 0 }', step({ x: 0 }, { z: undefined }));
show('{ z: undefined, x: 1 } over { x: 0 }', step({ x: 0 }, { z: undefined, x: 1 }));

// 3. A value equal to the one the context inherits
const toString = Object.prototype.toString;
show('{ toString } over { x: 0 }', step({ x: 0 }, { toString }));
show('{ toString, x: 1 } over { x: 0 }', step({ x: 0 }, { toString, x: 1 }));

// 4. -0 over 0
show('{ x: -0 } over { x: 0, y: 0 }', step({ x: 0, y: 0 }, { x: -0 }));
show('{ x: -0, y: 1 } over { x: 0, y: 0 }', step({ x: 0, y: 0 }, { x: -0, y: 1 }));
