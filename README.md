# xstate/fsm 6.0.0-beta.1 reproductions

Each directory is a standalone npm project pinned to `xstate@6.0.0-beta.1`. Run `npm install && npm start` in a directory, or open it in StackBlitz. Each script runs the same config through `createFSM` and through `createMachine` with `initialTransition` and `transition`, and prints both results.

- `patch-change-detection`: how `transition` decides whether a context patch changes anything (`NaN`, `undefined` for an absent key, a value equal to an inherited one, `-0`), compared with the context `createMachine` produces.
- `state-lookup`: `createFSM` finds inherited states, while its event lookup uses `Object.hasOwn`. `createMachine` rejects the same config with E12 wrapping E14.
