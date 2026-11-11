# A verified model of `xstate/fsm`

This directory holds a [LemmaScript](https://www.npmjs.com/package/lemmascript)
model of `createFSM` from [`src/fsm.ts`](../../src/fsm.ts), Dafny proofs of 31
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

The model follows `fsm.ts` on the `next` branch after two upstream changes:
`757b605` (statelyai/xstate#5885), which makes `transition` ignore states that
`config.states` inherits, and `c70dd85` (statelyai/xstate#5884), which makes it
compare a context patch by own key and `Object.is`.

## What `createFSM` does

For a snapshot `{ value, context }` and an event, `transition`:

1. finds the state `config.states` owns under `value`
   (`Object.hasOwn(config.states, value)`), and in its `on` table the entry
   it owns under `event.type` (`Object.hasOwn`), so a state or event that is
   only inherited, such as `toString` or `__proto__`, finds nothing;
2. treats a string as a target, calls a function with `{ context, event }`, and
   uses an object as is, with a missing transition or a function that returns
   nothing becoming `{}`;
3. defaults the target to the current value and, for each own key of the
   patch, string or symbol (`Reflect.ownKeys({ ...patch })`), replaces the
   context with `{ ...context, ...patch }` when the context does not own the
   key or holds a value that is not `Object.is` to the patch value;
4. returns the same snapshot object when the target equals the value and no
   copy happened, and a new snapshot otherwise.

After the first copy the context owns every patch key with the patch's value,
so later keys compare equal, `NaN` included.

## Model

The model has ten functions: `sameValue` (`Object.is`), `initialState`,
`lookupState` (the own state named `value`), `lookupTransition`,
`resolveTransition`, `entryUnchanged` (the context owns the key with the same
value), `patchChanges`, `mergePatch`, `transition`, and `run`. `transition`
returns the next snapshot and a `reused` flag that stands for `createFSM`
returning the same object. The model differs from `fsm.ts` in how it
represents data:

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
- An event is `{ type, payload }` with an integer payload.
- Transition and state tables are `Map`s, which find only their own keys.
  `Machine.states` holds the states `config.states` owns.
  `Machine.inheritedStates` holds the states it inherits, and each state's
  `inheritedOn` holds the transitions its `on` table inherits. The model never
  reads either; they are there so the laws can say that nothing a
  configuration inherits changes a step.

## Laws

Each function carries an `//@ ensures` contract that Dafny proves with no
hints, such as "a reused step returns the given snapshot". The laws in
`formal/fsmModel.dfy` say, among other things:

- A patch changes nothing exactly when the context already owns every patched
  key with a value `Object.is` to the patch's (`PatchUnchangedIffOwned`).
- The next snapshot is the resolved target (or the current value), with the
  patch merged exactly when the patch changes something
  (`TransitionMeaning`). A changed patch never reuses the snapshot
  (`ChangedPatchCopies`). A missing transition, a `{}` result, or a patch that
  changes nothing under a target equal to the value reuses it. A string
  transition `T` resolves the same as `{ target: T }`.
- Whether or not it copies, a step's next context is the full merge of the
  resolved patch (`ContextIsFullMerge`). With distinct patch keys, which every
  JavaScript patch object has, the next context owns every patched key with
  the patch's value (`PatchKeysOwnedAfterStep`), and merging the same patch
  again changes nothing (`MergeSettles`, `MergeIdempotent`).
- With distinct patch keys, a step reuses the snapshot exactly when the next
  snapshot equals it (`ReuseIsExact`), for every value including `NaN` and
  `-0`.
- A patch entry for a key the context does not own always copies and gives the
  context that key, whatever the value: `undefined`, or a value equal to one
  the context inherits, such as `Object.prototype.toString`
  (`AbsentKeyAlwaysChanges`). For a key the context owns, a step that keeps
  the state reuses the snapshot exactly when the patch value is `Object.is` to
  the owned one (`OwnedEntryComparesWithObjectIs`): `-0` over `0` copies and
  stores `-0`, and `NaN` over `NaN` reuses the snapshot.
- A value is declared when `config.states` owns a state with that name. A
  declared value finds its transitions in that state's own `on` table, and an
  event that table does not own finds nothing, whatever it inherits. A value
  that `config.states` only inherits finds no transitions, and replacing every
  inherited state leaves every step unchanged.
- A step never removes a context key, and no sequence of events does.
- If every target the machine can produce is a declared state, the initial
  snapshot and every step from a declared state stay declared.
- `run` over one event is one step, and running `a` then `b` equals running
  `a + b`.

[`formal/fsmModel.manifest.json`](./formal/fsmModel.manifest.json) lists all
31 law names and the contract of each function.

The model of the beta.1 `createFSM`, which read state names and absent context
keys through prototypes and compared with `===`, had laws that no longer hold
or no longer apply. They were removed:

- `StrictEqualsSymmetric`, `StrictEqualsReflexiveExceptNaN`, and
  `StrictEqualsDiffersFromSameValue` described `===`, which `fsm.ts` no
  longer uses.
- `UnchangedMergeReadsStrictlyEqual` and `TransitionReadsMatchMerge` said a
  skipped copy reads values `===` to a full merge. `ContextIsFullMerge` now
  says the skipped copy is the full merge.
- `OwnStateShadowsInherited` and `InheritedStateLookup` described inherited
  states being found. `InheritedStateHasNoTransitions` and
  `InheritedStatesIgnored` replace them.
- `ReuseIsExactWithoutNaN` and `EqualCopyIsOwnNaN` described `NaN` forcing a
  copy of an equal snapshot. `ReuseIsExact` replaces both without the `NaN`
  exception.
- `UndefinedOnAbsentKeyIsUnchanged`, `InheritedValueIsUnchanged`, and
  `InheritedMismatchOwnsKey` described an absent key reading `undefined` or
  its inherited value. `AbsentKeyAlwaysChanges` replaces them.
- `NegativeZeroOverZeroIsUnchanged` said `-0` over `0` was skipped, and
  `NegativeZeroAppliesWithAnotherChange` said it landed only beside another
  change. `NegativeZeroOverZeroCopies` and `PatchKeysOwnedAfterStep` replace
  them.
- `NotANumberAlwaysChanges` no longer holds: `NaN` over an owned `NaN` keeps
  the snapshot (`NotANumberOverOwnNotANumberKeepsSnapshot`).
- `OpaqueComparesByIdentity` is a case of `OwnedEntryComparesWithObjectIs`.

## Deliberate defects

The manifest also lists fourteen edits to `fsmModel.ts`. Dafny must reject
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
- a string transition loses its target;
- the initial snapshot drops the configured context;
- `run` skips each event's transition;
- every value uses the initial state's transitions;
- state lookup reads inherited states;
- event lookup reads inherited events.

The manifest also lists a rewrite of `entryUnchanged` that swaps the
arguments of `sameValue`, which keeps its behavior. The verifier checks that
the rewrite makes the committed Dafny stale and that the regenerated model
verifies with the same laws.

## Tests

[`fsmAdapter.ts`](./fsmAdapter.ts) converts a `createFSM` config into the
model's `Machine` and runs both on the same events. It encodes a string key `k`
as `:k` and a symbol key as `#` and an interned number. No `Object.prototype`
property starts with `:` or `#`, so `key in context` in the model's
TypeScript finds own keys only, as a Dafny map does. It interns values by
`Object.is` and decodes each model context back to a JavaScript object. After
every event it compares the value, the context's own keys in order (strings,
then symbols) and their values under `Object.is`, whether the snapshot object
was reused, and whether the context object was reused. It also checks what
the model leaves out: every snapshot has exactly the keys `context`, `error`,
`output`, `status`, and `value`, with `status: 'active'` and undefined
`output` and `error`; every transition returns no effects;
`initialTransition` and `getInitialSnapshot` return the initial snapshot; and
`getPersistedSnapshot` returns its argument. The model calls a transition
function itself with a decoded copy of the context, so each function runs
twice per event: once in `createFSM` and once in the model.

The adapter reads `config.states` and each `on` table level by level, from the
object up its prototype chain to `Object.prototype` or `null`, with
`Object.getOwnPropertyNames`, so non-enumerable states and transitions count
as they do for `Object.hasOwn`. The object's own level fills `states` or `on`;
each prototype level below `Object.prototype` fills `inheritedStates` or
`inheritedOn` with the names that no nearer prototype has.

The adapter refuses a context or patch with accessors or non-enumerable
properties: `createFSM` reads an accessor more than once, and it finds a
non-enumerable own context key with `Object.hasOwn` but drops it when it
spreads the context. A context or patch may have any prototype, including
`null`, because `createFSM` reads only their own keys. The adapter also
refuses an accessor on any level of `config.states` or an `on` table. That
refusal is conservative: `createFSM` never reads an inherited state or `on`
entry, so some refused accessors would never run, but the adapter does not
try to tell which.

[`fsmModel.test.ts`](./fsmModel.test.ts) runs named cases: inherited event
types, the empty-string target, functions that return `undefined` or `{}`, an
undeclared snapshot value, states inherited through `Object.create` (two
levels deep) and through a literal `__proto__: { ... }` that find no
transitions, an own state beside an inherited state of the same name, an event
that the `on` table of a state inherits and that is not taken, the snapshot
values `toString`, `constructor`, `hasOwnProperty`, and `__proto__` finding no
transitions in a plain `states` object, a non-enumerable own state and
transition, a table of patches that keep or copy the context (`undefined`
and `NaN` for an absent key, `-0` over `0` alone and beside a change, `0`
over `0`, `NaN` over an owned `NaN`, equal and different strings, the same
and a distinct reference, and `toString` with and without the inherited
value), `0` over an owned `-0`, own and absent `__proto__` keys, a
null-prototype context, symbol keys, a `states` object that inherits a state
named `on`, an `Object.prototype` polluted with a property that has an `on`,
and the adapter's refusals.

[`fsmModel.property.test.ts`](./fsmModel.property.test.ts) runs the comparison
on up to 1,000 generated configurations with
[fast-check](https://fast-check.dev/), stopping early at a 4-second limit. It
draws state names including `''`, `__proto__`, and `toString`, with targets
that may be undeclared; `states` and `on` tables and patches that, one time
in three, are built on a prototype holding more entries from the same names;
event types including `toString`, `constructor`, `__proto__`, and `''`;
string, object, function, and `undefined` transitions; context and patch keys
including `toString`, `__proto__`, and one symbol; and values from `-2` to
`2`, `undefined`, `-0`, `0.5`, `NaN`, `'a'`, `'b'`, `true`, one shared object,
and fresh objects. Contexts have no prototype entries, because a transition
function in the model reads a decoded copy without the context's prototype.

Four edits to `fsm.ts` that undo parts of `757b605` and `c70dd85` each fail
named cases:

- reading `config.states[value]?.on` through the prototype fails the cases for
  states inherited through `Object.create` and a literal `__proto__`, the
  inherited `away` state, and the polluted `Object.prototype`;
- comparing `patch[key] !== context[key]` fails the `undefined`, `-0`,
  `NaN`, and inherited `toString` patches, the absent `__proto__` patch, and
  the symbol keys;
- dropping only the own-key check fails the `undefined` and inherited
  `toString` patches, the absent `__proto__` patch, and the symbol keys;
- comparing own keys with `!==` fails the `-0` over `0` and `NaN` over `NaN`
  cases.

The generated comparison fails for the first, second, and fourth edit. For
the third, it found a counterexample in four of five runs, after 164 to 896
configurations.

Both test files run in `pnpm test`.

## Trust base and limits

- Nobody proves that LemmaScript preserves the meaning of `fsmModel.ts`.
  Dafny 4.11.0 checks the proof. The verifier uses unmodified
  `lemmascript@0.6.6` from npm.
- Agreement between the model and `fsm.ts` is tested, not proved, and so are
  the adapter's key encoding and value interning.
- Symbol keys are modeled by encoding each one as a string key that no string
  key can produce. `createFSM` compares and copies symbol keys the same way
  as string keys, so the encoding lets the tests cover them without a second
  key type in the model.
- The adapter builds the machine once. A program that adds, removes, or
  replaces a state or transition in `config.states` or an `on` table after
  `createFSM` is called is outside the model.
- The adapter reads each state's `on` once, through its prototype, and does
  not check it for an accessor, which `createFSM` would run on every event.
- The generator builds one prototype level for `config.states` and each `on`
  table; the named cases cover two levels for `config.states`.
- Transition functions are total and pure in Dafny: each result depends only
  on the context's entries and the event. A function that throws, mutates its
  argument, reads outside state, reads the context's prototype, or returns
  different results on its two calls is outside the model.
- Events carry only `type` and an integer `payload`.
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
`fsmModel.ts`, verifies the model (61 Dafny tasks), rejects the fourteen
defects, and checks the rewrite. The `fsm model verification` workflow runs it
on pull requests that change `src/fsm.ts` or this directory.

After editing `fsmModel.ts`, run `node "$LEMMASCRIPT_LSC" regen
--backend=dafny fsmModel.ts` in this directory, review the generated changes
and any merge left in `formal/fsmModel.dfy`, delete the `.dfy.base` file it
writes, and rerun the verifier. When a change to `src/fsm.ts` alters behavior,
update the model to match; the tests compare the two on every run.

The model last followed `fsm.ts` at `c70dd85`. To find later changes, run
`git log c70dd85..HEAD -- packages/core/src/fsm.ts` and read each commit it
lists. A change that alters what `transition` or `initialState` returns
needs the model, its laws, and the named cases updated together; update the
commit named here when the model catches up.

## LemmaScript 0.6.6 notes

- `type Context = Record<string, Value>` becomes an opaque Dafny type, so the
  model writes `Record<string, Value>` everywhere.
- A union discriminated by `kind` becomes a Dafny datatype. A kind that is a
  Dafny keyword is renamed, so `opaque` becomes `opaque_`.
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
