# Verified flat, compound, and single-parallel machine models

This directory models XState v6 `createMachine` initialization and external-event
steps. The runtime baseline is `da64b0a` on the fork's `next` branch, the base of
`machine-formalized`. Its `packages/core/src` is identical to `bcd3840`, the
baseline recorded for the flat and compound work. Work belongs to
[#9](https://github.com/robertpenner/xstate/issues/9), the compound extension
[#10](https://github.com/robertpenner/xstate/issues/10), and the single-parallel
extension [#15](https://github.com/robertpenner/xstate/issues/15), and the
multi-transition parallel extension
[#16](https://github.com/robertpenner/xstate/issues/16), under
[#8](https://github.com/robertpenner/xstate/issues/8) and
[#14](https://github.com/robertpenner/xstate/issues/14).

## What is verified

[`machineModel.ts`](./machineModel.ts) is executable TypeScript translated by
unmodified LemmaScript 0.6.6. Dafny 4.11.0 proves its contracts and the laws in
[`formal/machineModel.dfy`](./formal/machineModel.dfy).
[`formal/machineModel.manifest.json`](./formal/machineModel.manifest.json) lists
148 laws (including proof helpers and a concrete lifecycle witness), 22 generated
contract lemmas, and 23 deliberately incorrect model edits. The complete proof
currently checks 474 verification tasks. Function postconditions support
composition; they are also checked against the generated bodies.
Eleven additional proof-weakening probes check that generated contracts cannot
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

- Machines with at most one parallel node start with every node on the path from
  the root through the initial descendants, entering all regions of the
  parallel node. Active nodes, and entry callbacks, follow document order.
  For a well-formed machine, initialization yields a valid configuration, and
  every handled single-selection step from a valid configuration preserves
  validity: the root is active,
  each active node's parent is active, an active parallel node has every region
  active, and an active compound node has exactly one active child.
- Selection is region-first. Each active atomic node tries its own path below
  the parallel node, deepest first. When any of those nodes handles the event,
  the selections come only from the regions. Otherwise the parallel node and
  then its ancestors are tried, deepest first. If nothing handles the event,
  the snapshot is unchanged.
- A handled step equals the composition of its exit plan, the selected
  transition result, and the entry plan, with the same context threading and
  effect order as compound steps. Exits run in reverse document order;
  entries in document order. Targetless transitions keep the active set.
- A transition between two regions narrows its domain to the target's
  region: the source region stays active and none of its nodes exit. With
  `reenter: true` the domain widens to the parallel node, which itself neither
  exits nor enters, and every active node below the parallel node exits
  (`ReenterWidens`). A transition from the parallel node to one of its
  descendants narrows the same way. A reentering self-transition on the
  parallel node exits and reenters it.
- A transition from an ancestor of the parallel node into one region exits
  every active node below the parallel node (`AncestorResetsSubtree`). All
  regions are then reentered from their initial descendants, not only the
  targeted region; no separate law states this half, which follows from the
  validity law and the entry plan's definition. With `reenter: true`, a
  transition from the parallel node or one of its ancestors into a region has
  the source as its domain: the source exits and reenters, and so does every
  active node at or below the parallel node (`ReenterResetsSubtree`).
- Every active node outside the transition domain, other than a reentered
  source, remains active and does not exit.

- When two or more regions select transitions for one event, conflict removal
  walks the selections in region order. A later selection whose exit set
  overlaps an earlier kept selection's exit set replaces it only when its
  source is a descendant of that selection's source; otherwise the later
  selection is dropped. The kept list never grows longer than the selections,
  every kept selection was drawn from them, and kept selections have pairwise
  disjoint exit sets. With pairwise incomparable sources, the result equals
  greedy filtering in selection order. For two overlapping selections, the
  descendant source wins in either order. With one parallel node, selected
  sources come from different regions, so that rule is proved for the model
  function but never fires in the supported domain.
- Fewer than two selections delegate to the single-transition step.
- A multi-transition step exits the union of the kept plans' exit sets in
  reverse document order, applies every kept result in selection order, then
  enters the union of their entry sets in document order. By the definition of
  the model's selection, each transition callback observes the pre-step
  context, because selection evaluates it before any exit. Patches merge in
  selection order, so, as a consequence of sequential application, a later
  region's value wins for a shared key. Effects are returned as exits, kept transition effects in
  selection order, then entries. Dropped selections contribute neither patch
  nor effects.
- The next active set contains every node that was active and not exited, plus
  every entered node, in document order. For a well-formed machine starting
  from a valid configuration, every step accepted by `parallelStepReady`
  remains valid. Kept plans may have nested or equal domains. The proof
  discards lifecycle-free plans only when reasoning about active nodes:
  `MovingCombined` proves that this preserves the exit and entry unions, and
  `ReadyMovingDomainsApart` proves that the remaining plans have incomparable
  domains. A moving atomic-domain plan must exit its atomic domain
  (`ReadyAtomicPlanExits`); two moving plans with nested or equal domains
  would share an exit (`NestedMovingPlansOverlap`) and cannot both survive
  conflict removal. Every kept result still contributes its patch and effects.
- Two kept plans in the statelyai/xstate#5895 pattern, where one exit set
  contains the other's target or an ancestor of it, always have comparable
  domains (`PatternDomainsComparable`, `PatternDomainsNotApart`). This does not
  imply that their combined configuration is invalid.

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

[`parallelAdapter.ts`](./parallelAdapter.ts) reuses the compound tree builder
and accepts at most one `type: 'parallel'` node, at any depth, including the
root. The parallel node needs at least one region and may not declare
`initial`. A second parallel node, including one nested inside a region, is
refused before running. A target must be a string, so array (multi-target)
transitions are refused. Each step is checked against the model's
`parallelStepReady` before it runs. When fewer than two regions select, this is
the single-selection `parallelReady` check. When several regions select, every
selection must pass that check and sources must lie on pairwise incomparable
paths. A step is
also refused when a transition, with or without `reenter`, targets an already
active direct region of the parallel node, including in single-selection steps.
Without `reenter`, the runtime runs the targeted region's entry actions again
without exiting it; the open
[statelyai/xstate#5899](https://github.com/statelyai/xstate/pull/5899) keeps
the region active and skips that entry. Until it lands, the model makes no
claim about these steps. That
refusal also covers the reproduction machine of
[statelyai/xstate#5895](https://github.com/statelyai/xstate/issues/5895).
Targetless `reenter: true` transitions are refused when several regions
select, because the runtime's targetless-reentry lifecycle is a separate
suspected bug.

The general #5895 pattern is that one
transition's exit set contains another transition's target or an ancestor of
that target. `PatternDomainsComparable` proves that the two domains are then
comparable. The exited node lies inside or at the first domain (a reentering
source can be its own domain), and both domains are ancestors-or-self of the
second target. `PatternDomainsNotApart` states that such a pair makes
`domainsApart` false. This is a geometric property, not a refusal condition.
The pattern includes valid steps: an atomic self-target without reentry has
empty exit and entry sets and may be kept alongside a transition that exits
its parallel ancestor. Both transition results run in selection order, while
the ancestor-exiting plan determines that atomic node's removal.

There is no comparable-domain refusal left, so there is no refusal converse
to prove or comparable-domain refusal count to interpret. The active-region
target refusal still covers the statelyai/xstate#5895 reproduction. All
remaining comparable-domain cases are subject to the same listed readiness
checks as other steps.

Multiple parallel nodes, choices, history, completion, eventless transitions,
raised events, timers, actors, routes, state input and persistence remain
refused.
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
Parallel comparisons check active nodes in runtime document order, the
hierarchical value with every region of an active parallel node, and that an
active parallel node has every region active. The adapter also checks that its
document order equals the runtime's node `order`. `ParallelWellFormed` requires
`order` to list every node exactly once but does not require it to be a
preorder of the tree, so the lifecycle-order laws hold relative to that list.

The compound laws assume the normalized tree's path and initial-child
relationships. Authored target resolution and construction of that normalized
tree remain executable adapter code covered by comparisons and refusal tests.
The parallel model selects in region-first order: one selection per active
atomic node below the parallel node, then the parallel node and its ancestors
only when no region selects. SCXML instead selects, for every active atomic
state, the first enabled transition among it and its ancestors, removes
duplicates, then removes conflicting transitions; in that last pass a
transition whose source is a descendant of a conflicting transition's source
replaces it (SCXML 1.0 Appendix D, `selectTransitions` and
`removeConflictingTransitions`; the appendix is informative). The runtime's `transitionNode` matches the model: it consults the
parallel node only when every region returns no transition. The two orders
differ when one region declines and the parallel node or an ancestor handles
the event while another region selects. SCXML would also select that ancestor
transition for the declining region; the runtime and the model do not. When
the ancestor transition's exit set overlaps the region selection's, SCXML's
conflict removal keeps the region selection, which matches the region-first
result. The difference is visible only when the exit sets do not overlap, for
example with a targetless transition on the parallel node.
Region-first selection is a model assumption checked only by the differential
tests.

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

[`parallelModel.test.ts`](./parallelModel.test.ts) covers root-level and nested
parallel nodes with regions at different depths, region fallback when one
region declines, cross-region narrowing from a region and from the parallel
node, ancestor transitions that reset every region with and without
`reenter`, reentering widening, the parallel node as a reentering source and
targeting itself with and without `reenter`, entry from outside with deep
targets, fallback to the parallel node only when every region declines,
targetless transitions, and the nested/multiple-parallel, parallel-initial,
array-target, and active-region refusals. The active-region refusal is checked
with and without `reenter` and on the statelyai/xstate#5895 reproduction
machine. Its
multi-transition cases cover independent region transitions exiting in reverse
document order, mixed handled/declined/blocked regions, pre-step callback
context with patches merged in region order, conflicts where the earlier
region wins in either order, two regions that both leave the parallel node, a
region transition against a reentry of the parallel node, and the
targetless-reentry refusal. Atomic self-targets beside an ancestor exit are
compared in both selection orders, including configuration, patches, and
exit/transition/entry effect order.

[`parallelModel.property.test.ts`](./parallelModel.property.test.ts) generates
500 trees with seed 8912 and depths one through four, turning at most one
compound node into a parallel node with two or three regions. Any node below
the root can stop early as an atomic leaf, so regions of one parallel node can
differ in height. Handlers use the
same variation as the compound property test, with ID targets anywhere in the
tree. Steps refused by `parallelStepReady` end the trace. It uses the same
four-second fail-on-interruption limit. The test prints coverage statistics
with `console.info` and asserts only lower bounds on them. At seed 8912 it
reported 284 machines with a parallel node, 87 whose regions differ in
height, 2131 compared steps in traces that ran to completion, 315 steps with
two or more selections, 38 steps where conflict removal dropped a
selection, and 3 compared steps with strictly nested kept domains. The last
count has an asserted positive lower bound. Refusals cut short 143 of the
284 traces with a parallel node: 114
at an active-region target and 29 at a targetless reentry among several
selections. Steps compared before a refusal are
not counted.

[`runtimeFindings.test.ts`](./runtimeFindings.test.ts) contains direct public-API
characterizations of four previously reported behaviors:

- Targetless reentry runs entry without exit (statelyai/xstate#5897).
- A descendant targeting the root without reentry invokes root entry without
  root exit. Seed 8912 discovered this after six cases and 77 shrinks; the named
  reproduction retains the minimal root/child behavior
  ([statelyai/xstate#5896](https://github.com/statelyai/xstate/issues/5896),
  also observed in v5).
- When one region targets a sibling region and another region leaves the
  parallel node in the same step, the runtime exits the parallel node and then
  re-enters the sibling region without its parent, ending in `m, m.P.B, m.X`
  (statelyai/xstate#5895).
- A targetless reentry in one region beside a reentry of the parallel node in
  another exits region `A` and never re-enters it, while re-entering its leaf
  `a1`. This is already recorded in
  [statelyai/xstate#5897's follow-up comment](https://github.com/statelyai/xstate/issues/5897#issuecomment-6806469021)
  and covered by the proposed fix in
  [statelyai/xstate#5898](https://github.com/statelyai/xstate/pull/5898).

All four assert observed output, so a runtime change requires revisiting these
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

The drivers stop their complete child process groups on timeout, SIGINT, or
SIGTERM before removing temporary proof files or restoring mutated runtime files.
`MACHINE_MODEL_VERIFY_TIMEOUT_MS` overrides the verification driver's default
180000-millisecond per-command limit. `MACHINE_MODEL_RUNTIME_TIMEOUT_MS`
overrides the runtime-defect driver's 60000-millisecond limit. Each override must
be a finite positive number of milliseconds no greater than 2147483647; invalid
values fail before any checks or mutations. A timeout reports the command and
its limit and fails the run. `pnpm test:tooling` includes process-tree cleanup
regressions for these drivers.

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
reverse lifecycle effects, and ignore source reentry. The parallel edits enter
only the first region, leave atomic descendants of an exited parallel node
active, exit the source region in a cross-region transition, and run exits in
document order. The multi-transition edits let an ancestor source preempt a
descendant, apply dropped selections' patches and effects, apply a kept
result twice, apply kept results in reverse order, and keep exited nodes in
the next active set. A nested-domain edit incorrectly retains an atomic
self-target's domain node when another kept plan exits it; `MultiStepMembers`
rejects it. It also checks that a
behavior-preserving rewrite changes the generated
artifact and still proves after regeneration.

The runtime-defect command temporarily changes a clean production file, runs
the corresponding differential test, requires an assertion failure, and restores
the original bytes in `finally`. Run it only in a dedicated checkout with no
other test/build process. It tests an ignored fast-path target, a dropped
context patch, compound exits ordered ancestor-before-descendant, a parallel
domain that is never narrowed to a region, regions entered in reverse
document order, a later conflicting transition preempting an earlier one, and
kept transition patches merged in reverse order.
Production mutations are never committed.

After model edits:

```sh
cd packages/core/test/machine-model
node "$LEMMASCRIPT_LSC" regen --backend=dafny machineModel.ts
```

Never edit the generated `.dfy.gen` file. Add proofs only to `.dfy`; preserve
its generated prefix. Keep `.dfy.base` and other temporary merge artifacts out
of commits. Update the manifest when intentionally adding laws or contracts.
