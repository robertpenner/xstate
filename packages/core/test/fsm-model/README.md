# A verified model of `xstate/fsm`

This directory holds a [LemmaScript](https://www.npmjs.com/package/lemmascript)
model of `createFSM` from [`src/fsm.ts`](../../src/fsm.ts), Dafny proofs of 51
laws about it, and tests that compare the model with `createFSM`.

[`fsmModel.ts`](./fsmModel.ts) writes `createFSM`'s `initialState` and
`transition` as a TypeScript module that LemmaScript can translate.
LemmaScript translates it to [`formal/fsmModel.dfy.gen`](./formal/fsmModel.dfy.gen),
and [`formal/fsmModel.dfy`](./formal/fsmModel.dfy) is that file with the laws
appended. Dafny proves the laws for every machine configuration whose
transition functions are pure functions of the context's entries and the
event. Context values are integers, `-0`, `NaN`, `undefined`, and opaque values
that stand for everything else, kept apart as `Object.is` keeps them apart.
Nothing proves that the model matches `fsm.ts`; the tests in this directory
check that they agree.

The model follows `fsm.ts` after `757b605` (statelyai/xstate#5885, own-state
lookup), `c70dd85` (statelyai/xstate#5884, own-key and `Object.is` patch
comparison), `65afd99` (statelyai/xstate#5904, object-only transition targets
and eventless `always` transitions), and `1f7caa6` (statelyai/xstate#5947,
stopping `always` settling when a transition changes nothing).

## What `createFSM` does

When `createFSM(config)` runs:

1. It iterates `Object.getOwnPropertyNames(config.states)`. For each own state,
   it throws a `TypeError` if `state?.always` is a string, records whether any
   own state defines `state?.always !== undefined` (`hasAlways`), and iterates
   `Object.getOwnPropertyNames(state?.on ?? {})` to throw a `TypeError` if any
   own `on` entry is a string.
2. It creates `initialSnapshot` with `config.initial` and `config.context ?? {}`.
   If `hasAlways` is true, it settles `always` transitions starting from
   `initialSnapshot` with `{ type: 'xstate.init' }` to produce `initialState`.

For a snapshot `{ value, context }` and an event, `transition`:

1. finds the state `config.states` owns under `value`
   (`Object.hasOwn(config.states, value)`), and in its `on` table the entry
   it owns under `event.type` (`Object.hasOwn`), so a state or event that is
   only inherited, such as `toString` or `__proto__`, finds nothing;
2. runs `step(snapshot, selected, event)`: calls a function with `{ context,
   event }` or uses an object config as is, throws a `TypeError` if the result
   is a string, and returns `undefined` if the result is falsy (a missing
   transition or a function returning `undefined`);
3. for a truthy transition config, defaults `target` to `snapshot.value` and,
   for each own key of the patch, string or symbol (`Reflect.ownKeys({ ...patch
   })`), replaces the context with `{ ...context, ...patch }` when the context
   does not own the key or holds a value that is not `Object.is` to the patch
   value, then returns `snapshot` unchanged when `target === value` and no copy
   happened, or a new snapshot otherwise;
4. if `step` returned `undefined`, returns `[snapshot, []]` without running
   `always`. Otherwise, if `hasAlways` is true, settles `always` transitions
   from the resulting snapshot with the triggering `event`: each iteration
   reads `getState(cur.value)?.always` (using `Object.hasOwn(config.states,
   cur.value)` for the state, while allowing `always` to come from that own
   state's prototype), calls `step`, and stops as soon as `step` returns
   `undefined` or the same snapshot object (`!next || next === cur`).

After the first copy the context owns every patch key with the patch's value,
so later keys compare equal, `NaN` included.

## Model

The model has fourteen functions: `sameValue` (`Object.is`), `rawInitialState`,
`lookupState` (the own state named `value`), `lookupTransition`,
`lookupAlways`, `resolveTransition`, `entryUnchanged` (the context owns the key
with the same value), `patchChanges`, `mergePatch`, `applyTransition`,
`settle`, `initialState`, `transition`, and `run`. `applyTransition` returns
`{ snapshot, reused }` or `undefined` when no transition resolves. `settle`,
`initialState`, and `transition` take a non-negative `fuel: number` and return
`{ snapshot, reused, settled }`, where `reused` stands for `createFSM`
returning the same object and `settled` is `false` when `fuel` runs out while a
changing `always` transition is still enabled. `run` takes `fuel` and returns
`{ snapshot, settled }`. Fuel keeps `settle` terminating in Dafny without
forbidding cyclic `always` graphs in the machine type.

The model differs from `fsm.ts` in how it represents data:

- A context or patch value is a `Value`: an integer (`0` is +0), `-0`, `NaN`,
  `undefined`, or an opaque value with an id. Opaque values stand for strings,
  booleans, `null`, fractions, functions, and objects, and two are `Object.is`
  exactly when their ids match. The model does no arithmetic, so mapping each
  integral number to an exact integer keeps `Object.is`.
- A context is a map from string keys. The adapter encodes each string and
  symbol key of the JavaScript context as a distinct string.
- A patch is a list of `{ key, value }` entries with distinct keys. On the
  first change `fsm.ts` spreads the whole patch over the context; the model
  merges entry by entry, which gives the same entries.
- An event is `{ type, payload }` where `payload` is an optional integer
  (`undefined` on `{ type: 'xstate.init' }`).
- A transition is either an object config (`config`) or a pure function
  (`function_`). String transitions are rejected with `TypeError` at runtime
  and refused by the adapter before reaching the model.
- Transition and state tables are `Map`s, which find only their own keys.
  `Machine.states` holds the states `config.states` owns, and each `StateNode`
  holds `on`, `inheritedOn`, and `always`. `Machine.inheritedStates` holds the
  states `config.states` inherits, and `inheritedOn` holds the transitions an
  `on` table inherits. The model never reads either; they are there so the laws
  can say that nothing a configuration inherits changes a step.

## Laws

Each function carries an `//@ ensures` contract (and `requires fuel >= 0` on
fuel-taking functions) that Dafny proves with no hints, such as "a reused step
returns the given snapshot". The laws in `formal/fsmModel.dfy` say, among other
things:

- A patch changes nothing exactly when the context already owns every patched
  key with a value `Object.is` to the patch's (`PatchUnchangedIffOwned`).
- A single `applyTransition` step produces the resolved target (or the current
  value), merges the patch whenever it changes something
  (`ApplyContextIsFullMerge`, `ChangedPatchCopies`), reuses the snapshot on a
  `{}` result or an unchanged patch under a matching target
  (`EmptyConfigKeepsSnapshot`, `UnchangedPatchKeepsSnapshot`), and evaluates a
  function transition with the current context and event
  (`FunctionTransitionComputes`). With distinct patch keys, the next context
  owns every patched key with the patch's value (`PatchKeysOwnedAfterApply`),
  merging the same patch again changes nothing (`MergeSettles`,
  `MergeIdempotent`), and `applyTransition` reuses the snapshot exactly when
  the next snapshot equals the input (`ApplyReuseIsExact`), for every value
  including `NaN` and `-0`.
- A patch entry for a key the context does not own always copies and gives the
  context that key, whatever the value: `undefined`, or a value equal to one
  the context inherits, such as `Object.prototype.toString`
  (`AbsentKeyAlwaysChanges`). For a key the context owns, a step that keeps
  the state reuses the snapshot exactly when the patch value is `Object.is` to
  the owned one (`OwnedEntryComparesWithObjectIs`): `-0` over `0` copies and
  stores `-0`, and `NaN` over `NaN` reuses the snapshot.
- A value is declared when `config.states` owns a state with that name. A
  declared value finds its `on` transitions in that state's own `on` table and
  its `always` transition on that state (`DeclaredStateLookup`,
  `DeclaredStateAlwaysLookup`). An event the `on` table does not own finds
  nothing (`InheritedEventIsNotFound`). A value that `config.states` only
  inherits finds neither `on` nor `always` transitions
  (`InheritedStateHasNoTransitions`, `InheritedStateHasNoAlways`), and
  replacing every inherited state leaves every `transition` unchanged
  (`InheritedStatesIgnored`).
- Settling (`always`) laws: if no own state declares `always`, `settle` returns
  immediately with `reused: true, settled: true` (`NoAlwaysSettlesImmediately`,
  justifying the `hasAlways` fast path in `fsm.ts`). An `always` transition
  that resolves to `undefined` or reuses the snapshot stops settling
  immediately, even with zero fuel (`NoOpAlwaysSettles`, capturing
  statelyai/xstate#5947). With zero fuel, `settle` always keeps the snapshot
  (`reused: true`) and reports `settled: false` iff a changing `always`
  transition is enabled (`SettleZeroFuel`). Each changing `always` step
  consumes one unit of fuel and marks `reused: false` (`SettleStep`). A
  settled result has no changing `always` transition left (`SettleRest`), is
  idempotent (`SettleIdempotent`), and is independent of any larger fuel bound
  (`SettleStable`). If settling runs out of fuel, the final snapshot still has
  a changing `always` transition enabled (`SettleOutOfFuel`), and a two-state
  `always` cycle (`CycleMachine`) never settles for any fuel
  (`CycleNeverSettles`).
- `transition` and `initialState` composition: a missing `on` transition or a
  transition function returning `undefined` keeps the snapshot and skips
  `always` (`MissingTransitionKeepsSnapshot`, `UndefinedFunctionSkipsAlways`);
  a handled no-op transition still runs `always` (`HandledNoOpRunsAlways`); a
  taken transition composes `applyTransition` with `settle` under the same
  event and reports `reused` iff both stages reused the snapshot
  (`TransitionMeaning`); and `initialState` settles `rawInitialState` with
  `{ type: 'xstate.init', payload: undefined }` (`InitialContextAndSettle`).
- `applyTransition`, `settle`, `transition`, and `run` never remove a context
  key (`ApplyKeepsContextKeys`, `SettleKeepsContextKeys`, `ContextKeysKept`,
  `RunKeepsContextKeys`).
- If every target the machine can produce (from `on` or `always`) is a declared
  state, `settle`, `initialState`, `transition`, and `run` keep declared states
  declared (`SettleStaysDeclared`, `InitialDeclared`, `StepStaysDeclared`,
  `RunStaysDeclared`).
- `run` over one event is one `transition` (`RunSingleEvent`), and running `a`
  then `b` equals running `a + b` when the first prefix settles (`RunConcat`).

[`formal/fsmModel.manifest.json`](./formal/fsmModel.manifest.json) lists all
51 law names and the contract of each function.

Forty-six laws have preconditions, and a law whose preconditions no case meets
would be proved without saying anything. Each of the forty-six has a witness in
`formal/fsmModel.dfy`: a lemma with no parameters or preconditions that builds
one concrete machine, snapshot, or patch and calls the law, so Dafny must
prove that the case meets the law's preconditions. For example,
`ChangedPatchCopiesWitness` patches `x` from `1` to `2`,
`InheritedStateHasNoAlwaysWitness` uses a state that `config.states` inherits,
`CycleNeverSettlesWitness` instantiates `CycleMachine` with fuel `2`, and
`StepStaysDeclaredWitness` uses a transition function whose target is declared.
The manifest's `witnesses` map pairs each law with its witness, and the
verifier checks that exactly the laws with `requires` clauses have one and that
each witness calls its law.

Earlier laws that no longer apply were removed as `fsm.ts` evolved:

- `StringTargetIsConfigTarget` described string transitions, which `65afd99`
  (statelyai/xstate#5904) removed in favor of throwing `TypeError`.
- `StrictEqualsSymmetric`, `StrictEqualsReflexiveExceptNaN`, and
  `StrictEqualsDiffersFromSameValue` described `===`, which `fsm.ts` no
  longer uses.
- `UnchangedMergeReadsStrictlyEqual` and `TransitionReadsMatchMerge` said a
  skipped copy reads values `===` to a full merge. `ApplyContextIsFullMerge`
  now says the skipped copy is the full merge.
- `OwnStateShadowsInherited` and `InheritedStateLookup` described inherited
  states being found. `InheritedStateHasNoTransitions`,
  `InheritedStateHasNoAlways`, and `InheritedStatesIgnored` replace them.
- `ReuseIsExactWithoutNaN` and `EqualCopyIsOwnNaN` described `NaN` forcing a
  copy of an equal snapshot. `ApplyReuseIsExact` replaces both without the
  `NaN` exception.
- `UndefinedOnAbsentKeyIsUnchanged`, `InheritedValueIsUnchanged`, and
  `InheritedMismatchOwnsKey` described an absent key reading `undefined` or
  its inherited value. `AbsentKeyAlwaysChanges` replaces them.
- `NegativeZeroOverZeroIsUnchanged` said `-0` over `0` was skipped, and
  `NegativeZeroAppliesWithAnotherChange` said it landed only beside another
  change. `NegativeZeroOverZeroCopies` and `PatchKeysOwnedAfterApply` replace
  them.
- `NotANumberAlwaysChanges` no longer holds: `NaN` over an owned `NaN` keeps
  the snapshot (`NotANumberOverOwnNotANumberKeepsSnapshot`).
- `OpaqueComparesByIdentity` is a case of `OwnedEntryComparesWithObjectIs`.

## Deliberate defects

The manifest also lists twenty-four edits to `fsmModel.ts`. Dafny must reject
each one with a proof failure:

- a self-transition with no change copies the snapshot;
- the merge drops patched values;
- the copy applies only the first changed entry;
- the copy drops the first patch entry;
- a patch for a key the context does not own counts as unchanged;
- a key the context does not own compares as `undefined`, as reading through
  the prototype would;
- `-0` equals `0` and `NaN` differs from `NaN`, as with `===`;
- the configured target is ignored;
- the initial snapshot drops the configured context;
- `run` skips each event's transition;
- every value uses the initial state's transitions;
- state lookup reads inherited states;
- event lookup reads inherited events;
- a function transition drops the current context;
- a no-op `always` transition does not end settling;
- `always` lookup reads inherited states;
- settling reports fuel exhaustion as settled;
- settling with zero fuel marks the snapshot as copied;
- settling marks a multi-step `always` chain as reused;
- `initialState` skips settling `always` transitions;
- `initialState` settles with the wrong init event type;
- an unhandled event still runs `always` transitions;
- `transition` skips settling `always` transitions;
- `transition` ignores a first-step copy when reporting reuse.

The manifest also lists a rewrite of `entryUnchanged` that swaps the
arguments of `sameValue`, which keeps its behavior. The verifier checks that
the rewrite makes the committed Dafny stale and that the regenerated model
verifies with the same laws.

## Tests

[`fsmAdapter.ts`](./fsmAdapter.ts) converts a `createFSM` config into the
model's `Machine` and runs both on the same events with `DEFAULT_FUEL = 100`.
It encodes a string key `k` as `:k` and a symbol key as `#` and an interned
number. No `Object.prototype` property starts with `:` or `#`, so `key in
context` in the model's TypeScript finds own keys only, as a Dafny map does. It
interns values by `Object.is` and decodes each model context back to a
JavaScript object. It rejects string transitions in own `on` tables, in own or
inherited `always` on own states, and returned by transition functions, matching
`createFSM`'s `TypeError`. After initialization and after every event it
asserts `settled === true` and compares the value, the context's own keys in
order (strings, then symbols) and their values under `Object.is`, whether the
snapshot object was reused, and whether the context object was reused. It also
checks what the model leaves out: every snapshot has exactly the keys
`context`, `error`, `output`, `status`, and `value`, with `status: 'active'`
and undefined `output` and `error`; every transition returns no effects;
`initialTransition` and `getInitialSnapshot` return the initial snapshot; and
`getPersistedSnapshot` returns its argument. The model calls a transition
function itself with a decoded copy of the context, so each function runs
twice per step: once in `createFSM` and once in the model.

The adapter reads `config.states` and each `on` table level by level, from the
object up its prototype chain to `Object.prototype` or `null`, with
`Object.getOwnPropertyNames`, so non-enumerable states and transitions count
as they do for `Object.hasOwn`. The object's own level fills `states` or `on`;
each prototype level below `Object.prototype` fills `inheritedStates` or
`inheritedOn` with the names that no nearer prototype has. For each own state,
it also walks the state object's prototype chain to read `always` (stopping at
`Object.prototype` or `null`), matching `state?.always` in `fsm.ts`.

The adapter refuses a context or patch with accessors or non-enumerable
properties: `createFSM` reads an accessor more than once, and it finds a
non-enumerable own context key with `Object.hasOwn` but drops it when it
spreads the context. A context or patch may have any prototype, including
`null`, because `createFSM` reads only their own keys. The adapter also
refuses an accessor on any level of `config.states`, any `on` table, or any
own state's `always` property (own or inherited). That refusal is
conservative: `createFSM` never reads an inherited state or `on` entry, so
some refused accessors would never run, but the adapter does not try to tell
which.

[`fsmModel.test.ts`](./fsmModel.test.ts) runs named cases: inherited event
types, the empty-string target and an event from that state (which has no `on`
table), functions that return `undefined` or `{}`, a function that reads the
context, a patch whose second key alone changes, an undeclared snapshot value,
states inherited through `Object.create` (two levels deep) and through a
literal `__proto__: { ... }` that find no transitions, an own state beside an
inherited state of the same name, an event that the `on` table of a state
inherits and that is not taken, the snapshot values `toString`, `constructor`,
`hasOwnProperty`, and `__proto__` finding no transitions in a plain `states`
object, a non-enumerable own state and transition, a table of patches that
keep or copy the context (`undefined` and `NaN` for an absent key, `-0` over
`0` alone and beside a change, `0` over `0`, `NaN` over an owned `NaN`, equal
and different strings, the same and a distinct reference, and `toString` with
and without the inherited value), `0` over an owned `-0`, own and absent
`__proto__` keys, a null-prototype context, symbol keys, a `states` object
that inherits a state named `on`, an `Object.prototype` polluted with a
property that has an `on`, the adapter's refusals (including own and inherited
`always` accessors), string transition rejection (`#5904`) on own `on`, empty
string `on`, non-enumerable own `on`, own `always` on initial and non-initial
states, non-enumerable own states, non-enumerable own `always`, inherited
`always` on an own state, and transition functions returning a string (while
confirming inherited `on` entries and inherited states do not throw), and
`always` settling (initial chains with `{ type: 'xstate.init' }` and no
`payload` property, post-event multi-step chains receiving the triggering
event, no-op stops for `{}`, same target, unchanged context, `NaN` over own
`NaN`, `undefined` function, and `{}` function, `-0` over `0` copying once
then settling, unhandled events and `undefined` transition functions skipping
`always` while handled no-ops run `always`, non-enumerable own states with
`always`, round-trip `always` returning to the original state value with
`reused: false`, inherited `always` on an own state vs ignored `always` on an
inherited state, and a non-terminating cycle returning `settled: false`).

[`fsmModel.property.test.ts`](./fsmModel.property.test.ts) runs the comparison
on up to 1,000 generated configurations with
[fast-check](https://fast-check.dev/), stopping early at a 4-second limit. It
draws state names including `''`, `__proto__`, and `toString`, with targets
that may be undeclared; `states` and `on` tables and patches that, one time
in three, are built on a prototype holding more entries from the same names;
event types including `toString`, `constructor`, `__proto__`, and `''`;
object, function, and `undefined` transitions; guaranteed-terminating `always`
transitions (using strictly increasing state ranks in `stateNames`, constant
in-place patches, or context-capped `x < 3` increments, with inherited `always`
on own states and one-third of machines omitting `always` entirely to exercise
the `hasAlways === false` fast path); context and patch keys including
`toString`, `__proto__`, and one symbol; and values from `-2` to `2`,
`undefined`, `-0`, `0.5`, `NaN`, `'a'`, `'b'`, `true`, one shared object, and
fresh objects. Contexts have no prototype entries, because a transition
function in the model reads a decoded copy without the context's prototype.

A machine that starts in, or moves to, a state it does not own takes no
transitions for the rest of its events, so the generator steers away from
that without ruling it out. Every `states` table owns at least two states and
every `on` table at least one entry. Two in three initial states are own
states, and two in three events use a type that an own state defines with a
value other than `undefined`. Values draw `0`, `-0`, or `NaN` twice as often as
any other group, because `Object.is` and `===` disagree only on those, and a
patch shows the difference only when it meets a context holding the same key.

The test labels each initialization and step by the path `createFSM` takes and
fails when a label falls below its minimum. The minimums are about a quarter to
a third of the lowest count from seeds 1 to 8, so a run that the time limit
cuts short still passes, while a generator change that loses a case fails.

| Label                                | Minimum | Lowest of seeds 1 to 8 | Exercises                                                 |
| ------------------------------------ | ------: | ---------------------: | --------------------------------------------------------- |
| every step                           |   2,000 |                  4,580 | most of the 1,000 runs                                    |
| transition missing                   |   1,000 |                  3,113 | no own state, no own event entry, or an `undefined` entry |
| function transition                  |     150 |                    734 | a function that reads the context                         |
| object transition                    |     150 |                    667 | a transition config object                                |
| snapshot value is an inherited state |     100 |                    411 | the own-key guard on `config.states`                      |
| patch changes nothing                |      25 |                    191 | snapshot reuse after a patch                              |
| patch's first key changes            |     100 |                    719 | copying the context                                       |
| only a later patch key changes       |       1 |                     10 | checking every key after an unchanged one                 |
| patch entry for an absent key        |     100 |                    551 | the own-key check before comparing                        |
| `NaN` over own `NaN`                 |       5 |                     57 | `Object.is` treating `NaN` as unchanged                   |
| `-0` over `0`, or `0` over `-0`      |       2 |                      6 | `Object.is` treating signed zeros as changed              |
| opaque patch value                   |      20 |                    208 | strings by content and references by identity             |
| `always`: no always fast path        |     100 |                    393 | skipping `settle` when `hasAlways` is false               |
| `always`: initial fires              |      30 |                    117 | initial state settling via `always`                       |
| `always`: event fires                |      15 |                     43 | post-event settling via `always`                          |
| `always`: chain                      |      15 |                     62 | multi-step `always` chains in one `settle`                |
| `always`: noop stops                 |      50 |                    314 | stopping `settle` on unchanged snapshot (`#5947`)         |
| `always`: undefined stops            |      50 |                    198 | stopping `settle` when `always` returns `undefined`       |
| `always`: inherited on own state     |      50 |                    413 | reading `always` through own state prototype              |
| `always`: skipped on unhandled event |     100 |                    628 | not settling when an event has no transition              |

`FSM_MODEL_REPORT=1` prints the counts, and `FSM_MODEL_SEED` fixes the seed
and disables the 25-second wall-clock cutoff so all 1,000 generated machines run
deterministically regardless of CPU load.

### Mutation testing

[`scripts/fsm-model-mutants.mjs`](../../../../scripts/fsm-model-mutants.mjs)
rewrites one expression in `fsm.ts` at a time, runs both test files with
`FSM_MODEL_SEED=1`, and restores `fsm.ts`. It refuses to start when `fsm.ts`
has uncommitted changes, and it exits 1 when a mutant survives that is not
listed as expected to survive, or when a listed one is caught. Across seeds 1,
2, and 3, the suite catches all 39 killable mutants: the named cases catch all
39 (`39/39`), and the generated comparison catches 32 (`32/39`) — every
killable mutant except the 7 outside the generator's domain (string
transitions `M07`, `M28`, `M29`, `M30`; non-enumerable own state/event keys
`M31`, `M32`; and initial `always` event type `M37`, where the generator's
`always` function falls back to index `0` when `payload` is absent):

| Mutant | Edit to `createFSM`                                                                    |
| ------ | -------------------------------------------------------------------------------------- |
| M01    | compare patch values with `!==` instead of `Object.is`                                 |
| M02    | drop the own-key check before comparing a patch value                                  |
| M03    | iterate the patch with `for...in` instead of own keys                                  |
| M04    | look up the state for `always` without the own-key guard                               |
| M05    | look up the event with `in` instead of `Object.hasOwn`                                 |
| M06    | reuse the snapshot without checking the target                                         |
| M07    | skip string check on transition function return value                                  |
| M08    | reuse the snapshot without checking the context                                        |
| M09    | reuse the snapshot when either the target or context matches                           |
| M10    | let the old context override the patch                                                 |
| M11    | replace the context with the patch                                                     |
| M12    | copy the context without applying the patch                                            |
| M13    | iterate string keys only, skipping symbol keys                                         |
| M16    | default a missing target to the initial state                                          |
| M17    | pass an empty context to transition functions                                          |
| M18    | copy when a patch value is unchanged instead of changed                                |
| M19    | copy only when the key is missing and the value changed                                |
| M20    | start from an empty context instead of `config.context`                                |
| M21    | look up the state for `always` with `in` instead of `Object.hasOwn`                    |
| M22    | treat an empty-string target as no target                                              |
| M24    | check only the first patch key                                                         |
| M25    | compare with `!==` and no own-key check, as before `c70dd85`                           |
| M26    | look up the state for `on` without the own-key guard                                   |
| M27    | look up the state for `on` with `in` instead of `Object.hasOwn`                        |
| M28    | disable string transition check in `checkTransition`                                   |
| M29    | skip string check on `state.always` at construction                                    |
| M30    | skip string check on `state.on` entries at construction                                |
| M31    | enumerate states with `Object.keys` instead of `Object.getOwnPropertyNames`            |
| M32    | enumerate `on` entries with `Object.keys` instead of `Object.getOwnPropertyNames`      |
| M33    | never detect `always` transitions (force `hasAlways = false`)                          |
| M34    | skip initial `always` settling                                                         |
| M35    | skip post-event `always` settling                                                      |
| M36    | run `always` even when an event is unhandled                                           |
| M37    | pass wrong event type during initial `always` settling                                 |
| M38    | pass init event instead of triggering event during post-event settling                 |
| M39    | stop settling on context-only `always` changes (check value equality only)             |
| M40    | take at most one `always` step instead of chaining                                     |
| M41    | return snapshot instead of `undefined` when a transition is missing or returns nothing |
| M42    | drop the `next === snapshot` stop guard in `settle` (`#5947` infinite-loop bug)        |

M04 and M26 undo `757b605`, M25 undoes `c70dd85`, and M42 reintroduces the
infinite loop fixed in `statelyai/xstate#5947`.

Running this suite against the `#5904`/`#5947` tests uncovered five named-test
gaps that were closed in `fsmModel.test.ts`: `M29` (string `always` was only
tested on the initial state, where `settle` still caught it), `M31` (no test
placed a string or `always` transition on a non-enumerable own state), `M36`
and `M41` (the named test's `always` function returned `undefined` for
unhandled events even if erroneously called), and `M16` (no named test took a
targetless transition from a non-initial state). It also caught that a 4-second
wall-clock interruption limit caused non-deterministic cutoff under heavy CPU load
(raised to 25 seconds for unseeded runs and disabled under `FSM_MODEL_SEED`).

Five mutants pass every test:

- M14 iterates `Reflect.ownKeys(patch ?? {})` instead of a spread copy. For a
  patch with a non-enumerable own key, the mutant copies the context and
  `createFSM` does not. That patch is outside the model, and the adapter
  refuses it.
- M15 adds `break` after the context is copied. After the copy, every own data
  key of the patch holds the same value in the new context, so no later key
  copies again.
- M23 replaces `config.context ?? {}` with `config.context || {}`. A context is
  an object or `undefined`, and the two differ only for other falsy values.
- M43 always runs `settle` on `initialSnapshot` without checking `hasAlways`.
  Equivalent: proved by `NoAlwaysSettlesImmediately`, when no own state defines
  `always`, `settle` returns its input immediately.
- M44 always runs `settle` after an event without checking `hasAlways`.
  Equivalent for the same reason (`NoAlwaysSettlesImmediately`).

Both test files run in `pnpm test`.

### Proof mutation testing

[`scripts/fsm-proof-mutants.mjs`](../../../../scripts/fsm-proof-mutants.mjs)
parses `fsmModel.ts` with the TypeScript compiler API, generates a
deterministic set of AST mutants across all fourteen model functions
(`sameValue`, `initialSnapshot`, `initialState`, `lookupState`,
`lookupTransition`, `lookupAlways`, `resolveTransition`, `entryUnchanged`,
`patchChanges`, `mergePatch`, `applyTransition`, `settle`, `transition`, and
`run`), and runs each mutant through `lsc regen` (the same
regenerate-and-verify path used by `scripts/verify-fsm-model.mjs`). It stays
out of CI.

Operator set (14 deterministic AST operators):

1. `boolean-literal`: flip `true` and `false`
2. `equality-flip`: flip `===` and `!==`
3. `logical-swap`: swap `&&` and `||`
4. `negation-removal`: remove unary `!`
5. `conditional-collapse`: collapse `c ? a : b` to `a` and to `b`
6. `nullish-fallback`: replace `a ?? b` with `b`
7. `branch-force`: force `if (c)` to `if (true)` and `if (false)`
8. `optional-return`: in functions returning `T | undefined`, replace non-`undefined` return expressions with `undefined`
9. `object-property-drop` / `property-undefined`: drop each entry (including `...spread`) from spread object literals, and set `target` property initializers to `undefined`
10. `array-method-swap` / `slice-tail`: swap `.some` to `.every`, and replace `.slice(1)` with `[]` and `.slice(2)`
11. `numeric-literal`: perturb `0` to `1` and `1` to `0` (excluding `fuel - 1` decrement and `fuel === 0` base-case termination literals)
12. `sibling-field` / `param-swap` / `string-empty`: swap `.states` to `.inheritedStates` and `.on` to `.inheritedOn`, swap same-type string parameters at call sites, and replace `machine.initial` or `'xstate.init'` with `''`
13. `arg-blank`: replace `context` / `snapshot.context` call arguments with `{}` and `event` call arguments with `{ type: '', payload: 0 }`
14. `fuel-skip`: replace `fuel` with `0` at `settle` call sites

Results with Dafny 4.11.0 and `lemmascript@0.6.6` (`--jobs 5`):

| Run | Total | Rejected by proof | Rejected by tools | Accepted | Wall time |
| --- | ---: | ---: | ---: | ---: | ---: |
| Before `SettleZeroFuel` | 113 | 90 | 22 | 1 (`P83`) | 574.7s |
| After `SettleZeroFuel` | 113 | 91 | 22 | 0 | 8.8s (targeted `P83`) |

- **Accepted mutant before the new law:** `P83` (`settle`, `boolean-literal`:
  `if (fuel === 0) return { snapshot, reused: true, settled: false }` ->
  `reused: false`). Classification: **missing law**. No law specified what
  `settle` returns for `reused` when `fuel === 0`. Adding the unconditional law
  `SettleZeroFuel` (no preconditions, so no witness is required) and recording
  `"settling with zero fuel marks the snapshot as copied"` in
  `formal/fsmModel.manifest.json` closes the gap; `P83` is then rejected by
  proof in 8.8s. (Earlier, before `#5904`, proof mutation testing had similarly
  uncovered missing law `FunctionTransitionComputes` for `resolveTransition`.)
- **Rejected by tools (22 mutants, counted separately and not evidence of law
  coverage):** `P19–P21` (`lookupTransition` guard mutations), `P25–P27`
  (`lookupAlways` guard mutations), `P29–P31` and `P35` (`resolveTransition`
  guard mutations and untyped `event` literal in higher-order `compute` call),
  `P36–P37` (`entryUnchanged` `in`-guard mutations), `P54–P56`
  (`applyTransition` `config === undefined` guard mutations), `P73–P76`
  (`settle` `state === undefined` and `always === undefined` guard mutations),
  and `P91–P93` (`transition` `tr === undefined` guard mutations). Each fails
  LemmaScript narrowing/emission or Dafny type checking before verification
  runs.
- **Matches to manifest defects:** `P15` (initial snapshot drops configured
  context), `P34` (function transition drops current context), `P38` (absent
  key counts as unchanged), `P57` (configured target ignored), `P66`
  (self-transition with no change copies snapshot), `P83` (settling with zero
  fuel marks snapshot as copied), `P84` (settling ignores zero fuel and keeps
  stepping), `P87` (settling continues after a no-op `always` transition),
  `P89` (settling marks a multi-step `always` result as reused), and `P48`
  (dropping `[entry.key]: entry.value` from `{ ...context, [entry.key]:
  entry.value }`, equivalent to "the merge drops patched values").

## Requirement map

`InvariantAtEveryPrefix` lifts a machine's initialization and one-event
preservation proofs to all prefixes of a finite input sequence, given a
positive fuel budget `fuel` that suffices to settle the initial state and every
step. An event must be permitted in the snapshot **before** it runs. The empty
prefix is included. The induction uses `RunConcat` and `RunSingleEvent` and
needs no declared-target premise.

`AtmAuthorizedAtEveryPrefix` instantiates this law on a flat ATM, for all
inputs and any `fuel >= 1`. `AtmPreservesAuthorization` proves from the actual
transition rules that a `banking` snapshot owns `:authorized` with the value
for true. `LOGIN` enters `banking` and sets it; `EXPIRE` clears it and leaves
for `idle`; unhandled events reuse the snapshot; no state defines `always`, so
every `settle` returns immediately. The proof uses distinct opaque IDs for
false and true. The verifier changes just the expiry target in a disposable
copy: `[LOGIN, EXPIRE]` then leaves the machine in `banking` with authorization
false. It requires the ATM postcondition to fail and every other task,
including the generic induction, to verify.

This section maps the runtime lines of `createFSM` in `src/fsm.ts` at
`1f7caa6` (after `statelyai/xstate#5904` and the no-op `always` stop fix in
`statelyai/xstate#5947`) to the model, the laws, and the tests. "Mutants" are
named as in the mutation testing section, and "defects" are the model edits
that Dafny must reject. The general FSM comparisons call `assertAgrees` after
initialization and after each step to check the value, context, snapshot
identity, and context identity. The separate ATM replay compares state and
context values, authorization at every prefix, and snapshot reuse. It does not
compare context identity.

- **430–437**, `createSnapshot`, builds `{ status: 'active', value, context,
  output: undefined, error: undefined }`. The model's `Snapshot` keeps only
  `value` and `context`, so no law covers the other three keys. The adapter
  checks them after initialization and every step.
- **438–444**, `checkTransition`, throws a `TypeError` when a transition entry
  or function return value is a string. No model law (the model's `Transition`
  union has no string variant; only object and function variants exist). Named
  cases: string transitions in own `on`, empty string `on`, non-enumerable own
  `on`, own `always` on initial and non-initial states, non-enumerable own
  states, non-enumerable own `always`, inherited `always` on an own state, and
  functions returning a string; inherited `on` entries and inherited states do
  not throw. Mutants: M07, M28, M29, M30, M31, M32.
- **445–453**, construction loop scanning `Object.getOwnPropertyNames(config.states)`
  for string transitions and setting `hasAlways`. Model: `lookupAlways` reads
  the own state's `always` (including inherited `always` on an own state);
  `NoAlwaysSettlesImmediately` justifies the `hasAlways` fast path. Named
  cases: non-enumerable own states with string or `always` transitions,
  inherited `always` on an own state, `always` on an inherited state ignored.
  Label: `always`: no always fast path, `always`: inherited on own state.
  Mutants: M29, M30, M31, M32, M33, and M43, M44 (equivalent fast-path mutants).
- **454–455**, `getState(value)` checking `Object.hasOwn(config.states, value)`.
  Model: `lookupState`, `lookupTransition`, `lookupAlways`. Laws:
  `lookupState_ensures`, `lookupTransition_ensures`, `lookupAlways_ensures`,
  `DeclaredStateLookup`, `InheritedStateHasNoTransitions`,
  `InheritedStatesIgnored`, `AlwaysIgnoredOnInheritedState`. Named cases:
  undeclared snapshot value, states inherited through `Object.create` and
  `__proto__`, own state beside inherited state of the same name, `toString`/
  `constructor`/`hasOwnProperty`/`__proto__` snapshot values, non-enumerable
  own state, inherited state named `on`, polluted `Object.prototype`,
  `always` on an inherited state. Label: snapshot value is an inherited state.
  Mutants: M04, M21, M26, M27. Defects: every value uses the initial state's
  transitions; state lookup reads inherited states; `always` lookup reads
  inherited states.
- **456–468**, `step(snapshot, tr, event)`: resolves function transitions, runs
  `checkTransition(result)`, and returns `undefined` when `!result`. Model:
  `resolveTransition` and `applyTransition`. Laws: `resolveTransition_ensures`,
  `FunctionTransitionComputes`, `applyTransition_ensures`,
  `EmptyConfigKeepsSnapshot`, `TransitionMeaning`. Named cases: functions
  returning `undefined` or `{}`, function reading context, function returning
  string, unhandled event vs `undefined`-returning function skipping `always`.
  Labels: function and object transitions, `always`: undefined stops, `always`:
  skipped on unhandled event. Mutants: M07, M17, M41. Defects: a function
  transition drops the current context; `applyTransition` copies when resolved
  to `undefined`.
- **469–470**, `{ value, context } = snapshot` and `{ target = value, context:
  patch } = result`. Model: `applyTransition`. Laws: `TransitionMeaning`,
  `EmptyConfigKeepsSnapshot`. Named cases: empty-string target, targetless
  transition from a non-initial state. Mutants: M16, M22. Defect: the
  configured target is ignored.
- **471–478**, `Reflect.ownKeys({ ...patch })`, `Object.hasOwn`, `Object.is`,
  and `context = { ...context, ...patch }`. Model: `sameValue`,
  `entryUnchanged`, `patchChanges`, `mergePatch`. Laws: `sameValue_ensures`,
  `entryUnchanged_ensures`, `patchChanges_ensures`, `mergePatch_ensures`,
  `MergeKeys`, `MergeValues`, `PatchUnchangedIffOwned`,
  `AbsentKeyAlwaysChanges`, `OwnedEntryComparesWithObjectIs`,
  `NegativeZeroOverZeroCopies`, `NotANumberOverOwnNotANumberKeepsSnapshot`,
  `MergeOfOwnedValuesIsIdentity`, `ChangedPatchCopies`, `ContextIsFullMerge`,
  `PatchKeysOwnedAfterStep`, `MergeSettles`, `MergeIdempotent`,
  `ContextKeysKept`, `RunKeepsContextKeys`. Named cases: keep-or-copy table,
  `NaN` over `NaN`, `0` over `-0`, own and absent `__proto__` keys,
  null-prototype context, later patch key changing, symbol keys. Labels:
  patch's first key changes, only a later patch key changes, patch entry for
  an absent key, `NaN` over own `NaN`, `-0` over `0` or `0` over `-0`, opaque
  patch value. Mutants: M01, M02, M03, M10, M11, M12, M13, M18, M19, M24, M25,
  and M14, M15 (expected to survive). Defects: absent key counts as unchanged;
  absent key compares as `undefined`; `-0` equals `0` and `NaN` differs from
  `NaN`; merge drops patched values; copy applies only first changed entry;
  copy drops first patch entry.
- **479–481**, returning `snapshot` when `target === value && context ===
  snapshot.context`, else `createSnapshot(target, context)`. Model: `reused`
  flag of `applyTransition`. Laws: `applyTransition_ensures`, `ReuseIsExact`,
  `UnchangedPatchKeepsSnapshot`, `EmptyConfigKeepsSnapshot`. Label: patch
  changes nothing. Mutants: M06, M08, M09. Defect: a self-transition with no
  change copies the snapshot.
- **483–494**, `settle(snapshot, event)`: repeats `always` on `getState(snapshot.value)?.always`
  until `!next || next === snapshot`. Model: `settle(machine, snapshot, event,
  fuel)`. Laws: `settle_ensures`, `SettleZeroFuel`, `SettleAbsentAlwaysStops`,
  `SettleNoopStops`, `SettleUndefinedStops`, `SettleChainSteps`,
  `SettleStepTracksReuse`, `SettleFixedPoint`, `SettleIdempotent`,
  `NoAlwaysSettlesImmediately`, `AlwaysIgnoredOnInheritedState`. Named cases:
  initial and post-event `always` chains, no-op stops (`{}`, same target,
  unchanged context, `NaN` over own `NaN`, `undefined` and `{}` functions),
  `-0` over `0` copying once then settling, round-trip `always` returning to
  the original value with `reused: false`, inherited `always` on own state,
  non-terminating cycle (`settled: false`). Labels: `always`: initial fires,
  `always`: event fires, `always`: chain, `always`: noop stops, `always`:
  undefined stops, `always`: inherited on own state.   Mutants: M04, M21, M39, M40, M42. Defects: settling with zero fuel marks snapshot as
  copied; settling ignores zero fuel; settling runs `always` without checking
  the own-state guard; settling continues after a no-op `always` transition;
  settling marks a multi-step `always` result as reused.
- **495–501**, `initialSnapshot` (`config.context ?? {}`) and `initialState`
  (`hasAlways ? settle(initialSnapshot, { type: 'xstate.init' }) :
  initialSnapshot`). Model: `initialSnapshot` and `initialState`. Laws:
  `initialSnapshot_ensures`, `initialState_ensures`, `InitialContext`,
  `InitialDeclared`, `InitialSettlesWithInitEvent`,
  `InitialNoAlwaysSkipsSettle`. Named cases: initial context, initial `always`
  receiving `{ type: 'xstate.init' }` with no `payload`, initial `always`
  chain. Label: `always`: initial fires, `always`: no always fast path.
  Mutants: M20, M34, M37, and M23, M43 (expected to survive). Defects: the
  initial snapshot drops the configured context; `initialState` skips settling
  initial `always` transitions; `initialState` passes the wrong event type to
  initial `always`.
- **506–509**, `initialState`, `initialTransition`, `getInitialSnapshot`, and
  `getPersistedSnapshot`. No model or law for the wrapper methods. The adapter
  checks each.
- **510–523**, `transition(snapshot, event)`: own-state lookup, own-event
  lookup (`Object.hasOwn`), `step`, post-event `settle` (only when `next` is
  defined and `hasAlways`), returning `[snapshot, []]` or `[settled, []]`.
  Model: `transition(machine, snapshot, event, fuel)`. Laws:
  `transition_ensures`, `DeclaredStateLookup`, `InheritedEventIsNotFound`,
  `MissingTransitionKeepsSnapshot`, `UnhandledEventSkipsAlways`,
  `HandledNoopStillSettlesAlways`, `TransitionSettledPassesEvent`,
  `ReuseIsExact`. Named cases: inherited event types, inherited `on` entries,
  non-enumerable own transitions, unhandled events and `undefined` transition
  functions skipping `always`, handled no-op running `always`, post-event
  `always` chain receiving the triggering event. Labels: transition missing,
  `always`: event fires, `always`: skipped on unhandled event. Mutants: M05,
  M26, M27, M35, M36, M38, M41, and M44 (expected to survive). Defects: event lookup reads
  inherited events; `transition` skips settling `always` after a handled
  transition. The empty effects list `[]` has no model or law; the adapter
  checks it.

`run` has no line in `fsm.ts`. It stands for calling `transition` once per
event, as `assertAgrees` does, and `RunSingleEvent`, `RunConcat`,
`StepStaysDeclared`, `RunStaysDeclared`, and `InvariantAtEveryPrefix` describe
it. Defect: `run` skips each event's transition.

Every line has a test. The lines with no law are 430–437 for `status`,
`output`, and `error`, 438–444 for `checkTransition` throwing on strings,
506–509, and the empty effects list on 515/520/522, all outside the model. Five
edits to covered lines change nothing a test can observe: `config.context ||
{}` on line 496 (M23), `break` after line 476 (M15), `hasAlways` always true
(M43), dropping `hasAlways` guards (M44), and M14 on line 471 (which changes
behavior only for a patch with a non-enumerable own key, outside the model).

## Trust base and limits

- Nobody proves that LemmaScript preserves the meaning of `fsmModel.ts`.
  Dafny 4.11.0 checks the proof. The verifier uses unmodified
  `lemmascript@0.6.6` from npm.
- Agreement between the model and `fsm.ts` is tested, not proved, and so are
  the adapter's key encoding and value interning.
- `AtmMachine()` in `formal/fsmModel.dfy` is written by hand rather than
  generated from `atm-prefix-replay.json`. `fsmModel.test.ts` checks that
  `toModel(fixture.variants.intended).machine` has the same structure up to the
  opaque-value id assignment.
- `settle` in Dafny uses an explicit fuel counter (`DEFAULT_FUEL = 100` in
  `fsmAdapter.ts`) for termination, whereas `createFSM` uses `while (true)`.
  For any machine whose `always` chains terminate in at most `fuel` steps,
  `settled === true` and the two agree; a non-terminating `always` cycle hangs
  `createFSM` and returns `settled: false` in the model.
- String transition rejection (`checkTransition` throwing `TypeError` at
  construction or when a transition function returns a string) is tested
  directly in `fsmModel.test.ts` and enforced in `fsmAdapter.ts`, not modeled
  as a Dafny exception.
- Symbol keys are modeled by encoding each one as a string key that no string
  key can produce. `createFSM` compares and copies symbol keys the same way
  as string keys, so the encoding lets the tests cover them without a second
  key type in the model.
- The adapter builds the machine once. A program that adds, removes, or
  replaces a state or transition in `config.states`, an `on` table, or a
  state's `always` property after `createFSM` is called is outside the model.
- The adapter reads each state's `on` once, through its prototype, and does
  not check it for an accessor, which `createFSM` would run on every event.
- The generator builds one prototype level for `config.states`, each `on`
  table, and own state `always` properties; the named cases cover two levels
  for `config.states`.
- Transition functions are total and pure in Dafny: each result depends only
  on the context's entries and the event. A function that throws, mutates its
  argument, reads outside state, reads the context's prototype, or returns
  different results on its two calls is outside the model.
- Events carry `type` and an optional integer `payload` (omitted for the
  synthetic `{ type: 'xstate.init' }` event).
- `setup`, schemas, and actors are outside the model.

## Reproduce

The verifier needs Dafny 4.11.0 on `PATH` and LemmaScript 0.6.6 installed
outside this workspace:

```sh
mkdir -p /tmp/lemmascript
cp .github/fsm-model/package.json .github/fsm-model/package-lock.json /tmp/lemmascript/
(cd /tmp/lemmascript && npm ci --ignore-scripts)
LEMMASCRIPT_LSC=/tmp/lemmascript/node_modules/lemmascript/tools/dist/lsc.js \
  node scripts/verify-fsm-model.mjs
```

[`.github/fsm-model/package-lock.json`](../../../../.github/fsm-model/package-lock.json)
locks LemmaScript and its dependencies.

It checks that the committed `.dfy.gen` is what LemmaScript generates from
`fsmModel.ts`, checks that every law with preconditions has a witness,
verifies the model, laws, and witnesses (173 Dafny tasks), rejects the 24
defects, checks the rewrite, and checks the faulty ATM expiry defect. The
`fsm model verification` workflow runs it on pull requests that change
`src/fsm.ts` or this directory.

The `fsm.ts` mutant runner needs only the workspace's dependencies. It takes
about four minutes from the repository root:

```sh
node scripts/fsm-model-mutants.mjs
node scripts/fsm-model-mutants.mjs --seed 3 --only M01,M24
```

The proof mutant runner uses Dafny 4.11.0 and `lemmascript@0.6.6` and runs
locally (about ten minutes for all 113 mutants with `--jobs 5`):

```sh
node scripts/fsm-proof-mutants.mjs --list
LEMMASCRIPT_LSC=/tmp/lemmascript/node_modules/lemmascript/tools/dist/lsc.js \
  node scripts/fsm-proof-mutants.mjs --jobs 5
LEMMASCRIPT_LSC=/tmp/lemmascript/node_modules/lemmascript/tools/dist/lsc.js \
  node scripts/fsm-proof-mutants.mjs --only P83 --fn settle
```

After editing `fsmModel.ts`, run `node "$LEMMASCRIPT_LSC" regen
--backend=dafny fsmModel.ts` in this directory, review the generated changes
and any merge left in `formal/fsmModel.dfy`, delete the `.dfy.base` file it
writes, and rerun the verifier. When a change to `src/fsm.ts` alters behavior,
update the model to match; the tests compare the two on every run.

The model last followed `fsm.ts` at `1f7caa6` (after `statelyai/xstate#5904`
and `statelyai/xstate#5947`). To find later changes, run
`git log 1f7caa6..HEAD -- packages/core/src/fsm.ts` and read each commit it
lists. A change that alters what `transition`, `initialState`, or `createFSM`
returns needs the model, its laws, and the named cases updated together; update
the commit named here and the line numbers and commit in the requirement map
when the model catches up.

## LemmaScript 0.6.6 notes

- `type Context = Record<string, Value>` becomes an opaque Dafny type, so the
  model writes `Record<string, Value>` everywhere.
- A union discriminated by `kind` becomes a Dafny datatype. A kind that is a
  Dafny keyword is renamed, so `opaque` becomes `opaque_` and `function`
  becomes `function_`.
- `key in context` becomes Dafny map membership, but at run time it also finds
  inherited keys. The adapter's key encoding keeps the two the same.
- Inside a lambda, `context[key]` after `key in context &&` becomes an
  `Option` read and fails to type-check. Inside `if (key in context) return
  ...` it becomes a plain map read, so `entryUnchanged` uses an `if`.
- A type alias for the transition function becomes a Dafny `type` declaration,
  which the verifier refuses, so the function type is written inline.
- Calling a function stored in a field fails to translate; the model binds it
  to a local first.
- `{ ...a, ...b }` on records fails to translate, while `{ ...a, [k]: v }`
  becomes a map update. A `for...of` loop over `Object.entries` becomes a
  Dafny `method`, which lemmas cannot call, so the patch is an entry list with
  a recursive merge.
- Ghost predicates that quantify over function values must be declared
  `ghost`; the manifest lists them under `specFunctions`.
