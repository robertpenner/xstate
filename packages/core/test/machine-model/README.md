# Verified flat-machine model

This directory models XState v6 `createMachine` initialization and external-event
steps. The runtime baseline is `bcd3840` on the fork's `next` branch. Work belongs
to [#9](https://github.com/robertpenner/xstate/issues/9), under
[#8](https://github.com/robertpenner/xstate/issues/8). Nested compound states are
the dependent [#10](https://github.com/robertpenner/xstate/issues/10).

## What is verified

[`machineModel.ts`](./machineModel.ts) is executable TypeScript translated by
unmodified LemmaScript 0.6.6. Dafny 4.11.0 proves its contracts and the laws in
[`formal/machineModel.dfy`](./formal/machineModel.dfy).
[`formal/machineModel.manifest.json`](./formal/machineModel.manifest.json) lists
20 laws (including one patch helper), five generated function contracts, and
eight deliberately incorrect model edits. The complete proof currently checks
39 verification tasks.

The laws establish:

- Initialization selects the initial state, preserves declared membership, and
  applies its entry callback's patch and ordered effects.
- Context patches retain unrelated keys and store the last supplied value for
  each patched key. Missing keys and present values remain distinct.
- Every supplied patch copies context, including an empty or unchanged patch.
  No supplied patch preserves context identity.
- Missing and declining handlers leave the snapshot unchanged. A handled no-op
  creates a snapshot but preserves context. Effect-only callbacks handle events.
- A selected target becomes the next state; valid targets preserve membership.
- Targetless and non-reentering self-transitions skip exit and entry callbacks.
- Targeted transitions exit before applying the transition patch, then enter.
  The selected callback observes pre-exit context. The exit callback also observes
  pre-exit context. The entry callback observes exit patches overwritten by any
  transition patch. Effects are returned in exit, transition, entry order.
- Targetless `reenter: true` currently runs entry without exit. Its separate
  characterization law records an apparent runtime bug, not an intended
  lifecycle rule.

The patch and identity contracts differ from `createFSM`, which compares patch
values before deciding whether to copy. No FSM reuse law is imported here.

## Supported domain and explicit refusals

The current adapter accepts a root with a declared `initial`, a plain `context`
record, and flat atomic `states`. State definitions accept `on`, `entry` and
`exit`. Local target names are nonempty strings without dots or hashes.
Exact event names may not contain `*`; the empty event name is refused.
Transition definitions are objects, callbacks, or an explicit `undefined`
event block. Objects and callback results accept `target`, `context`, `reenter`.
Entry/exit callbacks accept a returned `context` patch. Context mappers on
object-form transitions are currently refused; use a transition callback.

Configuration, event, context, and patch records must have only enumerable own
string data properties and an ordinary or null prototype. Accessors,
non-enumerable properties, symbol keys and custom prototypes are refused before
comparison. Context values and ordinary effect arguments may be opaque values,
including references, `undefined`, `NaN` and signed zero. Configuration and
callback-result fields not listed above cause explicit refusal. Unknown
callback arguments and enqueue operations also cause explicit refusal.

Callbacks receive `context` and `event`; `enq(fn, ...args)` records an ordinary
effect. The model never invokes the effect body. Callback purity, termination
and determinism are assumptions. In particular, callback-produced opaque values
must be stable under `Object.is` across the two evaluations used for comparison.
Fresh reference allocation inside a callback cannot satisfy that assumption;
the differential harness reports disagreement instead of claiming equivalence.
Callback invocation counts and identity of the context record passed into a
callback are not modeled.

Root handlers/lifecycle callbacks, nested states, relative/ID targets, parallel
regions, choices, history, completion, eventless transitions, raised events,
timers, actors, routes, state input and persistence are refused at this stage.
The nested-state ticket extends this domain. Refusal is not a statement that
the runtime lacks these features.

## Representation and trust

The adapter interns values with `Object.is`. Each distinct value receives an
integer token; tokens preserve opaque identity, `NaN` and signed-zero
distinctions. String keys receive a `:` prefix so JavaScript prototype keys
cannot collide with map lookup in the executable model. Encoding/decoding and
normalization are tested, not proved.

Callbacks become total mathematical functions over encoded contexts and events.
Their target-validity assumptions appear in the membership laws. Runtime
snapshot/context identity is represented by explicit reuse flags. An empty
patch can therefore retain the mathematical map while requiring a new runtime
context object.

The model does not import production selection, lifecycle, or context-merge
algorithms. The adapter runs callbacks independently for the model and runtime,
then compares state, own context keys/values, both reuse flags, and ordered
effect identities/arguments at initialization and after every event.

Dafny proves properties of the translated model. Differential tests sample
agreement with XState. Neither proves implementation equivalence or correctness
of the translator, adapter, JavaScript engine, Dafny, or solver.

## Tests and reproductions

[`machineModel.test.ts`](./machineModel.test.ts) covers initialization,
missing/declined/blocked/handled events, effect-only callbacks, self-transition
and reentry, lifecycle context observations, absent keys, present `undefined`,
`NaN`, signed zero, unchanged patches, opaque references, prototype-looking
string keys, unsupported fields and object shapes.

[`machineModel.property.test.ts`](./machineModel.property.test.ts) generates
500 flat two-state machines using seed 8911. Each machine has up to two handlers
per state and a trace of up to 24 external events. It varies missing handlers,
blocks, object/callback results, declining/effect-only callbacks, patches,
targets, reentry and entry/exit patches/effects. It uses a four-second
interruption limit that fails the test if reached. It does not generate arbitrary
JavaScript callbacks or prove complete runtime coverage.

[`runtimeFindings.test.ts`](./runtimeFindings.test.ts) is a direct public-API
reproduction of the targetless-reentry finding. It asserts the observed output
so a runtime change requires revisiting this characterization and its model law.
The AFK run log records the investigation; no production fix is included.

## Reproduce

Use the fork's pinned pnpm version and install its dependencies. Install
`lemmascript@0.6.6` separately from this workspace and put Dafny 4.11.0 on `PATH`.
Set `LEMMASCRIPT_LSC` to that package's `tools/dist/lsc.js`.

```sh
pnpm test:machine-model
pnpm verify:machine-model
pnpm test:machine-model:runtime-defects
pnpm typecheck
pnpm lint
pnpm format:check
pnpm test:core
pnpm build
```

The proof driver regenerates into temporary directories, checks exact freshness,
requires an unchanged generated prefix in the proof, checks the declaration
inventory, rejects assumptions/attributes, and requires every seeded edit to
produce a proof failure. Parser/type/tool failures do not count as rejected
defects. It also checks that a behavior-preserving rewrite changes the generated
artifact and still proves after regeneration.

The runtime-defect command temporarily changes a clean production file, runs
the corresponding differential test, requires an assertion failure, and restores
the original bytes in `finally`. Run it only in a dedicated checkout with no
other test/build process. It tests an ignored fast-path target and a dropped
context patch; production mutations are never committed.

After model edits:

```sh
cd packages/core/test/machine-model
node "$LEMMASCRIPT_LSC" regen --backend=dafny machineModel.ts
```

Never edit the generated `.dfy.gen` file. Add proofs only to `.dfy`; preserve
its generated prefix. Keep `.dfy.base` and other temporary merge artifacts out
of commits. Update the manifest when intentionally adding laws or contracts.
