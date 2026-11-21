# Synchronous event processing: findings for #24

This document records how the v6 runtime processes eventless transitions,
immediately raised events, and completion inside one macrostep. It compares
that behavior with SCXML and xstate v5, and it proposes how the machine model
can claim this behavior without assuming that every macrostep terminates. It
answers [robertpenner/xstate#24](https://github.com/robertpenner/xstate/issues/24)
under parent #23. The owner still has to decide which observations become
model claims; the open decisions are listed at the end.

## Evidence

| Source                     | Revision                                                                                                                       |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| v6 runtime                 | `machine-formalized` at c300ae6 (upstream `next` baseline 3893cf0), `xstate` 6.0.0-beta.4                                      |
| v5 runtime                 | `xstate@5.33.4` from npm                                                                                                       |
| SCXML                      | [W3C Recommendation, 1 September 2015](https://www.w3.org/TR/2015/REC-scxml-20150901/), sections 3.7, 3.13, 5.10.1, Appendix D |
| Node and package manager   | Node 24.17.0, pnpm 11.8.0                                                                                                      |
| Runtime source of interest | `macrostep`, `microstep`, `selectEventlessTransitions`, `enterStates` in `packages/core/src/stateUtils.ts`                      |

The probes are executable and assert every observation below:

- [`synchronousProcessing.probes.test.ts`](./synchronousProcessing.probes.test.ts)
  covers ordering, selection, completion, and snapshot identity.
- [`synchronousProcessing.cycles.test.ts`](./synchronousProcessing.cycles.test.ts)
  covers cycles and how `maxIterations` counts microsteps.
- [`synchronousProcessing.v5-probes.mjs`](./synchronousProcessing.v5-probes.mjs)
  repeats the comparable cases against v5. It is not part of the suite; its
  header explains how to run it.

Every probe machine sets `maxIterations`. A cycle that escaped the bound would
loop synchronously, and vitest cannot interrupt a synchronous loop with its
own test timeout. `pnpm test:machine-model:sync-probes` therefore runs both
probe files in a child process and kills the process group after
`MACHINE_MODEL_SYNC_PROBES_TIMEOUT_MS` (default 120000). It exits 2 for a
deadline, and 1 for an assertion failure, and it says whether the failure
output mentions `InfiniteTransitionError`.

Each test title carries a tag. `[runtime]` means observed v6 behavior only.
`[SCXML]` means normative SCXML text requires the same result. `[v5]` means
the v5 probe gave the same result. `[differs]` marks a result that differs
from SCXML or v5, explained below.

## How one macrostep runs

The runtime processes one external event (or initialization) as follows.

1. If the snapshot is not `active`, return it unchanged with no effects. A
   done machine ignores later events, and `transition` returns the same
   snapshot object.
2. Take the microstep for the external event, or the initial microstep. Raises
   enqueued during that microstep join the internal queue.
3. If the internal queue is empty and the machine has no `always` transition
   anywhere, stop.
4. Loop while the snapshot is `active`. Each iteration first checks the bound,
   then does exactly one of the following:
   - If eventless transitions should be selected, select them. If any are
     enabled, take one microstep for them.
   - Otherwise, if the internal queue is not empty, remove its first event and
     take a microstep for it, even when no transition handles that event.
   - Otherwise, stop.

Eventless transitions are selected after every microstep for an event,
external or internal. After an eventless microstep they are selected again
only if that microstep produced a different snapshot object. Raised events
join the end of the queue in the order the microstep applied them: raises
from exit functions, then from transitions, then from entry functions, then
the done events of any completed parents. A done event has the shape
`{ type: 'xstate.done.state', stateId, output }`; this document writes it as
`done.state`.

Two other paths skip this loop:

- `StateMachine._transitionFast` answers `transition()` directly when the
  root has no `always`, the active state is a root-level atomic state without
  exit, `always`, delays, or invocations, and exactly one static transition
  (no guard, actions, or callback context) handles the event. When that
  transition changes state, the target must also be a root-level atomic state
  without entry, `always`, delays, or invocations. `always` elsewhere in the
  machine does not disable it.
- The empty-queue check in step 3 skips it for machines without `always`.

## Observations

### Order of eventless transitions and raised events

**Eventless transitions run before the next raised event is dequeued.**
`[SCXML][v5]` After `GO` raises `R` and enters `a`, the machine first takes
`a`'s `always` to `b`, then dequeues `R` and takes `b`'s handler to `c`.
Section 3.13 requires this: an implementation "MUST select" eventless
transitions before it removes an internal event. `docs/scxml.md` already
states it.

**Raised events are first-in, first-out across the whole macrostep.**
`[SCXML][v5]` A transition that exits a state raising `R1`, raises `R2`
itself, and enters a state raising `R3` processes `R1`, `R2`, `R3`. A raise
made while handling `R1` (`R4`) runs after all three. SCXML's `<raise>` places
the event at the rear of the internal queue.

**A raise from a transition callback is applied after the exit raises.**
`[runtime]` Selection evaluates a transition callback before any exit
function runs, but the runtime records that callback's raises and replays them
when it applies the transition. SCXML has no equivalent because SCXML
executable content runs only once, during the transition.

**A raise from a selection that conflict resolution removes is discarded.**
`[runtime]` When two regions of a parallel node each leave it on the same
event, the earlier region's transition wins. The later callback already ran
and raised `FROM_R2`, but that raise never reaches the queue. Only `FROM_R1`
is processed.

**A raised event with no handler still costs a microstep.** `[runtime]`
`getMicrosteps` returns a microstep with no transitions for it. This matters
for the bound (see below).

**An eventless callback sees the last processed event.** `[SCXML][v5]` During
initialization it sees `xstate.init`, after an external event it sees that
event, and after a dequeued raise it sees the raised event. Section 5.10.1
keeps `_event` bound until the next event is processed.

**Initialization behaves like a macrostep.** `[SCXML]` Entry raises queued by
the initial microstep wait until eventless transitions have run.

### Selection of eventless transitions

**An effect-only `always` runs once per processed event.** `[runtime][v5]`
`[differs]` A callback that enqueues an effect but returns no target or
context produces the same snapshot object, so the runtime does not select it
again until another event is processed. SCXML would select the same enabled
targetless transition again after every microstep, and the macrostep would
not end. This is a deliberate runtime convention that v5 shares, and it is
what makes an effect-only `always` usable at all.

**A context-only `always` runs until its callback declines.** `[runtime]`
Each patch produces a new snapshot, so the callback is called again. A
counter that increments to 3 produces microsteps with 0, 1, 2, 3.

**An `always` returning an empty context patch never ends.** `[runtime]` The
patch `{}` produces a new context object, so the snapshot is new and the same
callback is selected again until the bound fires. The model already treats
the runtime context object as distinct from its mathematical value (the
README's reuse flags). Any model of eventless reselection has to carry that
flag, because a mathematically unchanged context does not stop the loop.

**A self-targeted `always` without a context patch does not loop.**
`[runtime]` With or without `reenter: true`, an atomic state targeting itself
leaves the active states and context unchanged, so the snapshot object is
reused and the transition is taken once.

**Eventless selection walks ancestors per atomic state. Event selection is
region-first.** `[runtime][v5]` In a parallel node `p` with regions `r1`
(no transitions) and `r2` (whose atomic state `b` has its own `always`), both
`p.always` and `b.always` are selected in one microstep: `p`'s on behalf of
`r1` and `b`'s on behalf of `r2`. For an event `EV` that both `p` and `b`
handle, only `b`'s handler runs. SCXML uses the per-atomic-state rule for
both: it calls a transition "optimally enabled" in an atomic state and
collects one per atomic state for events too (section 3.13). The model's
`RegionFirstSelection` describes the runtime's event selection and does not
carry over to eventless selection.

In that same probe, both eventless callbacks compute patches from the context
before the microstep. The later patch in document order wins for the shared
key, so the microstep ends with `log: 'B'` and `p`'s write is lost. v5 runs
`assign` actions in sequence, so each write sees the previous one. This is the
existing v6 patch-merge rule applied to a multi-selection eventless step.

### Completion

**`done.state` follows the final state's entry raises.** `[SCXML][v5]` A
transition raising `T` into a final state whose entry raises `E` produces
`T`, `E`, then the parent's `onDone`. Section 3.7 orders the done event after
the final state's `onentry`.

**A parallel node completes once, when every region is final.** `[SCXML]`
One region finishing produces only that region's `onDone`. The second region
finishing produces its own `onDone` and then the parallel node's, with output
`{ r1: 1, r2: 2 }`. The runtime prevents a second done event for the same
node in one microstep.

**Nested final output reaches the root.** `[runtime]` Output from an inner
final state passes through each `onDone` event to the root's final output.

**Reaching a root final state discards queued raises.** `[SCXML][v5]` Section
3.7 halts the state machine on a top-level final state. The runtime sets
`status: 'done'` inside the microstep, so the loop never dequeues the raise.

**Root output is computed before exit functions run.** `[runtime]` When the
machine reaches its root final state, the exit functions of the states still
active run after the final state's `output` callback. In the probe, `output`
is 1 while the resulting `context` is 111. A raise from such an exit function
is discarded. The pending changeset
`.changeset/pre/entry-exit-parameter-count.md` describes the exit behavior;
nothing documents the order relative to `output`.

**A machine can be done at initialization.** `[runtime]` An initial final
state makes `initialTransition` return a done snapshot, and initialization
raises are discarded.

**Root output differs by root type.** `[runtime][differs]` Without a root
`output`, a compound root forwards its final state's output, while v5 returns
`undefined`. A parallel root returns `undefined`. `docs/final-states.md`
documents both cases as intended.

### Snapshot identity

**Internal no-op microsteps keep the snapshot object.** `[runtime]` An
eventless or raised-event microstep that changes nothing returns the previous
snapshot object. The existing `completeMacrostep` clone for handled external
events is unchanged.

### Cycles and the bound

**Every cycle shape is stopped by `maxIterations`.** `[runtime]` The cycle
probes cover an eventless cycle, a raised-event cycle, a cycle that alternates
an entry raise and an `always`, and an `always` whose callback only raises.
`transition` and `initialTransition` throw `InfiniteTransitionError`; an
actor's status becomes `'error'` and its subscriber receives the error. v5
throws a plain `Error`.

**The bound counts microsteps including the first.** `[runtime][v5]`
`docs/configuration.md` describes `maxIterations` as the number of microsteps
one event may take. The loop checks the bound before it looks for each further
microstep, and it counts the external or initial microstep as the first. A
macrostep that ends active needs a bound equal to its total microstep count:

| Macrostep                                          | Microsteps | Smallest bound |
| -------------------------------------------------- | ---------: | -------------: |
| Event plus K eventless microsteps (K = 0, 1, 2, 4) |      K + 1 |          K + 1 |
| Event handled or unhandled, nothing follows        |          1 |              1 |
| Event plus two unhandled raised events             |          3 |              3 |
| Initialization plus one effect-only `always`       |          2 |              2 |
| Event straight to a root final state               |          1 |              0 |
| Machine without `always` or raises                 |          1 |              0 |
| `transition()` through `_transitionFast`           |          1 |              0 |

The last three rows succeed with less than the microstep count. Reaching
`done` ends the loop without the final check, and both fast paths skip the
loop. Both fast paths apply only when no internal step follows, so they
differ from the loop count only at `maxIterations: 0`. This leniency is
harmless at runtime, but a model that mirrors the bound
must reproduce it or define the bound in terms of a quantity both sides
agree on. For external events, v5 gives the same counts for K = 0, 2, 4 and
for an unhandled event, except that it has no fast paths. The v5
initialization result with a bound of 0 was not examined further.

## Candidate issues for upstream

None of these is a crash or a spec violation that users are likely to hit, and
upstream searches found no report of them. The nearest reports are
statelyai/xstate#5430 (adds the bound), statelyai/xstate#5853 (unbounded by
default), statelyai/xstate#5908 (an eventless callback called twice, fixed),
statelyai/xstate#5901 (timer and `always` order), and statelyai/xstate#5926
(documentation of microsteps). They are listed so the owner can decide whether to file
them.

1. The bound's effective count depends on whether the macrostep ends done and
   on which fast path applies. A model can only mirror it exactly by encoding
   those paths.
2. Eventless and event selection use different rules in parallel states. If
   upstream intends region-first selection everywhere, eventless selection
   is the outlier; if SCXML's rule is intended, event selection is.
3. An empty context patch from an `always` loops forever, although it changes
   nothing a user can observe.
4. Root `output` ignores context changes made by exit functions at completion.

## How the model can claim this behavior

The model's callbacks are total functions, and the model proves properties of
single microsteps. A macrostep is a loop that may not end, so the model cannot
define its result as a total function without a choice. Three choices fit.

**A. Finite-prefix step safety.** Define one internal step (an eventless
microstep or one dequeued event) and prove that every step preserves
validity and queue order. Compare the runtime's `getMicrosteps` output against
the model's step relation one microstep at a time. This claims nothing about
where the macrostep ends.

**B. Bounded evaluation with an explicit unfinished result.** Define
`macrostep(n, snapshot, queue)` that takes at most `n` internal steps and
returns either a settled snapshot with its trace or an exhausted trace prefix.
With `n` set from `maxIterations` and the counting rule above, an exhausted
result corresponds to `InfiniteTransitionError`. The function is total by
recursion on `n`, the comparison can include the rest condition, and the
runtime's error becomes a modeled outcome.

**C. Termination under sufficient conditions.** Prove that the macrostep ends
when the eventless transitions form an acyclic graph over targets and no
raise can trigger a raise cycle, or under a ranking function supplied by the
author. This is the strongest claim and the hardest to state for callbacks,
because a callback can choose any target or raise from any context.

**Recommendation:** build B on top of A. A gives the per-step laws that B
needs, and B is the smallest definition that lets the differential harness
compare complete macrosteps, including bounded failure. Defer C until there is
a concrete user need, and then state it for object-form transitions first.

### Proposed laws

- **Step validity.** Every internal step from a valid snapshot yields a valid
  snapshot. This extends the current per-microstep validity laws to eventless
  and dequeued-event steps.
- **Eventless first.** An internal step dequeues an event only if no eventless
  transition is enabled under the reselection rule.
- **FIFO.** The queue after a step is the old queue without its head (if one
  was dequeued), followed by the step's raises in exit, transition, entry,
  completion order.
- **Rest.** A settled result has an empty queue and no eventless transition
  enabled under the reselection rule, or is done.
- **Faithful bounded failure.** `macrostep(n, …)` is exhausted exactly when
  the runtime with `maxIterations = n` throws `InfiniteTransitionError`. This
  law has to include the done and fast-path exceptions from the counting
  table, or restrict its claim to macrosteps they do not affect.
- **Completion.** A `done.state` event is queued for a compound parent exactly
  when one of its final children is entered, and for a parallel node exactly
  once, when its last region becomes final. Reaching a root final state
  empties the queue and makes later events no-ops.

### Adapter extensions

The adapters currently refuse every feature involved. Supporting them
requires:

- An internal queue in the model state and in the comparison.
- `enq.raise` with an event record, distinct from ordinary `enq(fn, ...args)`
  effects. Delayed raises remain refused.
- `always` in object and callback form.
- `type: 'final'` states, `onDone` handlers, and `output` callbacks, which
  extend the callback domain.
- Done-event normalization: `{ type: 'xstate.done.state', stateId, output }`.
- Reuse flags for snapshot identity, because the reselection rule depends on
  object identity.
- The bound as an adapter input, with the counting rule above.

## Implementation breakdown

Each slice compares complete runtime traces for its machines and adds its own
laws. Later slices depend on earlier ones.

1. **Eventless transitions without raises.** Add `always` to the flat model,
   the reselection rule including reuse flags, and bounded evaluation (choice
   B). Compare traces and the bounded failure against `maxIterations`.
2. **Immediate raised events.** Add the queue, `enq.raise`, FIFO ordering,
   unhandled-event microsteps, and the discard rule for raises from removed
   selections. Depends on 1 for the eventless-first rule.
3. **Completion.** Add final states, `onDone`, `output`, done-event order
   after entry raises, single parallel completion, root halting, and output
   before exit functions. Depends on 2, because done events travel through the
   queue.
4. **Compound and parallel traces.** Extend 1 to 3 to the compound and
   parallel adapters, including per-atomic eventless selection beside
   region-first event selection. Depends on 1 to 3 and on the owner's decision
   about candidate issue 2.

## Decisions for the owner

1. Choose the termination treatment: A only, A then B (recommended), or C.
2. Decide whether the model should mirror the runtime's reselection-by-identity
   rule, including the empty-patch loop, or refuse callbacks whose results
   could loop on an unchanged snapshot.
3. Decide whether the model should state the bound exactly, including the
   done and fast-path leniency, or claim it only for macrosteps that end
   active outside the fast paths.
4. Decide whether to file candidate issues 1 to 4 upstream before modeling
   the behavior they describe.
5. Decide whether eventless selection in parallel states is in scope for the
   first model or refused until candidate issue 2 is settled.
