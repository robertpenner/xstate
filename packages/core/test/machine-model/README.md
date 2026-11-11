# Verified flat and compound machine models

This directory models XState v6 `createMachine` initialization and external-event
steps. The runtime baseline is `bcd3840` on the fork's `next` branch. Work belongs
to [#9](https://github.com/robertpenner/xstate/issues/9) and the compound extension
[#10](https://github.com/robertpenner/xstate/issues/10), under
[#8](https://github.com/robertpenner/xstate/issues/8).

## What is verified

[`machineModel.ts`](./machineModel.ts) is executable TypeScript translated by
unmodified LemmaScript 0.6.6. Dafny 4.11.0 proves its contracts and the laws in
[`formal/machineModel.dfy`](./formal/machineModel.dfy).
[`formal/machineModel.manifest.json`](./formal/machineModel.manifest.json) lists
35 laws (including proof helpers and a concrete lifecycle witness), 13 generated
contract lemmas, and 13 deliberately incorrect model edits. The complete proof
currently checks 252 verification tasks. Function postconditions support
composition; they are also checked against the generated bodies.
Nine additional proof-weakening probes check that generated contracts cannot
gain restrictive preconditions or lose their original postconditions.

The laws establish:

- Initialization selects the initial state, preserves declared membership, and
  applies its entry callback's patch and ordered effects.
- Context patches retain unrelated keys and store the last supplied value for
  each patched key. Missing keys and present values remain distinct.
- Every supplied patch copies context, including an empty or unchanged patch.
  Omitting a patch preserves context identity.
- Missing and declining handlers leave the snapshot unchanged. A handled no-op
  creates a snapshot but preserves context. Effect-only callbacks handle events.
- A selected target becomes the next state; valid targets preserve membership.
- Flat targetless and non-reentering self-transitions skip exit and entry callbacks.
- Targeted transitions exit before applying the transition patch, then enter.
  The selected callback observes pre-exit context. The exit callback also observes
  pre-exit context. The entry callback observes exit patches overwritten by any
  transition patch. Effects are returned in exit, transition, entry order.
- Targetless `reenter: true` currently runs entry without exit. Its separate
  characterization law records an apparent runtime bug, not an intended
  lifecycle rule.
- Compound initialization and event steps preserve declared active nodes,
  required ancestors, and exactly one active direct child for each active
  compound node, assuming a well-formed normalized machine and valid targets.
- Selection considers the deepest active node first. A declining callback
  falls back to ancestors; an explicit block or an effect-only callback handles
  the event.
- Initial entry follows initial-child pointers to an atomic leaf. The normalized
  path witness supplies the termination measure and is proved equal to that
  traversal's result.
- Compound self-targets reset active descendants to initial descendants.
  Reentry additionally exits and enters the source. Exit callbacks run from
  leaf to ancestor; entry callbacks run from ancestor to leaf. Each callback
  sees patches from the preceding lifecycle callbacks.
- The complete compound step's effects and context equal the composition of
  its exit plan, preselected transition result, and entry plan. An ancestor
  before the exit cut is preserved. A concrete sibling/self-reentry witness
  additionally checks the plan against distinguishable callback effects.

The patch and identity contracts differ from `createFSM`, which compares patch
values before deciding whether to copy. No FSM reuse law is imported here.

## Supported domain and explicit refusals

The flat adapter accepts a root with a declared `initial`, a plain `context`
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
Refusals remain fatal to comparison even if an authored callback catches the
exception. Probes for unsupported capabilities, enumeration, and prototype
inspection of callback argument/enqueue objects are refused. Direct membership
and descriptor checks for the supported `context` and `event` arguments remain
allowed.

[`compoundAdapter.ts`](./compoundAdapter.ts) additionally accepts root handlers
and lifecycle callbacks, nested atomic/compound states, and a root-only atomic
machine. Every compound node declares an initial direct child. It supports
relative `.child` targets, ordinary sibling paths, and exact `#id` lookup.
IDs containing dots remain exact IDs. Implicit IDs use the root machine ID and
the authored key path, even below an explicitly named parent. Duplicate IDs,
missing initial children, unknown targets, and inconsistent state types are
refused.

Callbacks receive `context` and `event`; `enq(fn, ...args)` records an ordinary
effect. The model never invokes the effect body. Callback purity, termination
and determinism are assumptions. In particular, callback-produced opaque values
must be stable under `Object.is` across the two evaluations used for comparison.
Fresh reference allocation inside a callback cannot satisfy that assumption;
the differential harness reports disagreement instead of claiming equivalence.
Callback invocation counts and identity of the context record passed into a
callback are not modeled.

Parallel regions, choices, history, completion, eventless transitions, raised
events, timers, actors, routes, state input and persistence remain refused.
Refusal is not a statement that
the runtime lacks these features.

## Representation and trust

The adapter interns values with `Object.is`. Each distinct value receives an
integer token; tokens preserve opaque identity, `NaN` and signed-zero
distinctions. String keys receive a `:` prefix so JavaScript prototype keys
cannot collide with map lookup in the executable model. Encoding/decoding and
normalization are tested, not proved. The reserved `$prototype` map key records
the context prototype as another token; user keys always start with `:` and
cannot collide with it. Decoding preserves a null prototype until a supplied
patch changes it to `Object.prototype`, including an empty or null-prototype
patch. Callbacks therefore observe the same inherited properties. Prototype
information is in the map value, so callback interpretation remains a function
of the mathematical context.

Callbacks become total mathematical functions over encoded contexts and events.
Their target-validity assumptions appear in the membership laws. Runtime
snapshot/context identity is represented by explicit reuse flags. An empty
patch can therefore retain the mathematical map while requiring a new runtime
context object.

The model does not import production selection, lifecycle, or context-merge
algorithms. The adapter runs callbacks independently for the model and runtime,
then compares state, own context keys/values, both reuse flags, and ordered
effect identities/arguments at initialization and after every event. Compound
comparisons also inspect the public snapshot's active `nodes`, hierarchical
state value, parent membership, and exactly-one-active-child condition.

The compound laws assume the normalized tree's path and initial-child
relationships. Authored target resolution and construction of that normalized
tree remain executable adapter code covered by comparisons and refusal tests.
The model functions share one translation unit because LemmaScript emits
cross-module function calls as axioms, which this proof inventory forbids.

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

[`compoundModel.test.ts`](./compoundModel.test.ts) covers descendant entry,
deepest selection, fallback through multiple ancestors, explicit blocks,
effect-only handlers, root-only machines, ancestor/relative/exact-ID targets,
compound self-reset from a noninitial descendant, root reentry, lifecycle context
and effect order, invalid trees, and excluded nested features.

[`compoundModel.property.test.ts`](./compoundModel.property.test.ts) generates
500 trees with seed 8912, nesting depths one through four, and one or two
children per compound node. Traces contain up to 20 events. Handlers vary among
missing, blocked, declining, effect-only, and object/callback results. ID targets
range over the generated tree, including roots, ancestors, siblings and other
branches. Reentry, patches, and lifecycle effects are varied. This test has the
same four-second fail-on-interruption limit.

[`runtimeFindings.test.ts`](./runtimeFindings.test.ts) contains direct public-API
reproductions of two suspected runtime bugs:

- Targetless reentry runs entry without exit.
- A descendant targeting the root without reentry invokes root entry without
  root exit. Seed 8912 discovered this after six cases and 77 shrinks; the named
  reproduction retains the minimal root/child behavior.

Both assert observed output, so a runtime change requires revisiting these
characterizations and the model's exit/entry plans.
The AFK run log records the investigation; no production fix is included.

[`adapterContract.test.ts`](./adapterContract.test.ts) checks both adapters
against caught refusals, reflective capability probes, null-prototype contexts,
empty patches, and pre-exit versus post-patch prototype observations.

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
requires every generated line to remain in order, and checks the declaration
inventory. Generated executable bodies may only gain checked assertions.
Proof additions include function postconditions and ghost declarations.
Generated preconditions, termination clauses and existing postconditions must
remain unchanged. The driver tests attempts to add `requires false` to a
generated function or contract lemma and to weaken an existing postcondition
with `|| true`; all are rejected before verification. Probes include multiple
clauses on one line, nested comments, and string/character literals containing
comment markers. The scanner distinguishes specification keywords from strings
and comments without treating line breaks as clause delimiters.
It also checks balanced body braces and requires a declaration or end of file
after the closing brace. Ambiguous header layouts, including column-zero set
displays in added postconditions, are rejected instead of hiding later clauses.
The driver rejects assumptions and proof-disabling attributes; only
`induction false` and `isolate_assertions` are allowed to control proof search.
It requires every seeded edit to
produce a proof failure. Parser/type/tool failures do not count as rejected
defects; a timeout alone also does not count. The compound edits select an
ancestor prematurely, skip initial descent, exit an unaffected ancestor,
reverse lifecycle effects, and ignore source reentry. It also checks that a
behavior-preserving rewrite changes the generated
artifact and still proves after regeneration.

The runtime-defect command temporarily changes a clean production file, runs
the corresponding differential test, requires an assertion failure, and restores
the original bytes in `finally`. Run it only in a dedicated checkout with no
other test/build process. It tests an ignored fast-path target, a dropped
context patch, and compound exits ordered ancestor-before-descendant.
Production mutations are never committed.

After model edits:

```sh
cd packages/core/test/machine-model
node "$LEMMASCRIPT_LSC" regen --backend=dafny machineModel.ts
```

Never edit the generated `.dfy.gen` file. Add proofs only to `.dfy`; preserve
its generated prefix. Keep `.dfy.base` and other temporary merge artifacts out
of commits. Update the manifest when intentionally adding laws or contracts.
