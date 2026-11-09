# xstate/fsm 6.0.0-beta.1 reproductions

Each directory is a standalone npm project pinned to `xstate@6.0.0-beta.1`. Run `npm install && npm start` in a directory, or open it in StackBlitz:

- `patch-change-detection`: how `transition` decides whether a context patch changes anything (`NaN`, `undefined` for an absent key, a value equal to an inherited one, `-0`).
- `state-lookup`: state lookup finds inherited states, while event lookup uses `Object.hasOwn`.
