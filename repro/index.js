// Two transitions on the same event E:
//   P.A.a1 -> P.B   (cross-region; v6 narrows its domain to region B)
//   P.B    -> X     (leaves the parallel state P)
// v5 treats them as a conflict and takes one. v6 takes both and leaves
// region B active without its parent P.
import * as v6 from 'xstate';
import * as v5 from 'xstate-v5';

function config(log) {
  const logged = (name) => ({
    entry: () => log.push(`enter ${name}`),
    exit: () => log.push(`exit ${name}`)
  });
  return {
    id: 'm',
    initial: 'P',
    states: {
      P: {
        ...logged('P'),
        type: 'parallel',
        states: {
          A: {
            ...logged('A'),
            initial: 'a1',
            states: {
              a1: { ...logged('a1'), on: { E: { target: '#m.P.B' } } },
              a2: {}
            }
          },
          B: { ...logged('B'), on: { E: { target: '#m.X' } } }
        }
      },
      X: logged('X')
    }
  };
}

for (const [name, xstate, nodesOf] of [
  ['xstate 5.32.5', v5, (s) => s._nodes],
  ['xstate 6.0.0-beta.1', v6, (s) => s.nodes]
]) {
  const log = [];
  const actor = xstate.createActor(xstate.createMachine(config(log))).start();
  log.length = 0;
  actor.send({ type: 'E' });
  const snapshot = actor.getSnapshot();
  const active = nodesOf(snapshot).map((n) => n.id);
  console.log(`\n${name}`);
  console.log('  after E:', log.join(', '));
  console.log('  value:  ', JSON.stringify(snapshot.value));
  console.log('  active: ', active.join(', '));
  const orphan = active.find((id) => {
    const parent = id.split('.').slice(0, -1).join('.');
    return parent && !active.includes(parent);
  });
  console.log(
    orphan
      ? `  INVALID: ${orphan} is active but its parent is not`
      : '  valid configuration'
  );
}
