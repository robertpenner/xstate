# A verified model of `xstate/fsm`

This directory holds a [LemmaScript](https://www.npmjs.com/package/lemmascript)
model of `createFSM` from [`src/fsm.ts`](../../src/fsm.ts), Dafny proofs of 31
laws about it, and tests that compare the model with `createFSM`.

[`fsmModel.ts`](./fsmModel.ts) writes `createFSM`'s `initialState` and
`transition` as a TypeScript module that LemmaScript can translate.
LemmaScript translates it to [`formal/fsmModel.dfy.gen`](./formal/fsmModel.dfy.gen),
and [`formal/fsmModel.dfy`](./formal/fsmModel.dfy) is that file with the laws
appended. Dafny proves the laws for every machine configuration whose
transition functions are pure, over every context value JavaScript `===` can
tell apart, including `-0`, `NaN`, `undefined`, and keys a context inherits
from `Object.prototype`. Nothing proves that the model matches `fsm.ts`; the
tests in this directory check that they agree.

## What `createFSM` does

For a snapshot `{ value, context }` and an event, `transition`:

1. reads `config.states[value]?.on` and takes the entry for `event.type` only
   if it is an own key (`Object.hasOwn`), so a `toString` or `__proto__` event
   finds an entry the config declares under that name and ignores one that
   `on` only inherits;
2. treats a string as a target, calls a function with `{ context, event }`, and
   uses an object as is, with a missing transition or a function that returns
   nothing becoming `{}`;
3. defaults the target to the current value, compares `patch[key] !==
context[key]` for each key of `{ ...patch }`, and on the first difference
   replaces the context with `{ ...context, ...patch }`, where `context[key]`
   reads through the prototype, so a key the context does not own reads its
   `Object.prototype` value or `undefined`;
4. returns the same snapshot object when the target equals the value and no
   copy happened, and a new snapshot otherwise.

## Model

The model has ten functions: `strictEquals` (`===`), `sameValue`
(`Object.is`), `read` (`context[key]`), `initialState`, `lookupTransition`,
`resolveTransition`, `patchChanges`, `mergePatch`, `transition`, and `run`.
`transition` returns the next snapshot and a `reused` flag that stands for
`createFSM` returning the same object. The model differs from `fsm.ts` in how
it represents data:

- A context or patch value is a `Value`: an integer (`0` is +0), `-0`, `NaN`,
  `undefined`, or an opaque value with an id. Opaque values stand for strings,
  booleans, `null`, fractions, functions, and objects, and two are `===`
  exactly when their ids match. The model does no arithmetic, so mapping each
  integral number to an exact integer keeps `===`.
- `Machine.inherited` holds the value read for each key the context does not
  own: the properties of `Object.prototype`. `read` returns the own value, then
  the inherited one, then `undefined`.
- A patch is a list of `{ key, value }` entries with distinct keys. `fsm.ts`
  merges a patch object with one spread; the model merges entry by entry.
  After the first copy every key matches, so the two merges agree.
- Transition and state tables are `Map`s, which find only their own keys.

## Laws

Each function carries an `//@ ensures` contract that Dafny proves with no
hints, such as "a reused step returns the given snapshot". The laws in
`formal/fsmModel.dfy` say, among other things:

- `===` is symmetric, reflexive except for `NaN`, and differs from `Object.is`
  only on `NaN` against `NaN` and on `0` against `-0`.
- The next snapshot is the resolved target (or the current value), with the
  patch merged exactly when the patch changes something; a changed patch never
  reuses the snapshot; a missing transition or a `{}` result reuses it; a
  string transition `T` resolves the same as `{ target: T }`.
- When the copy is skipped, every key still reads a value `===` to what a full
  merge would read, but the context can lack an own key the patch named
  (`undefined` for an absent key, or a value `===` to the inherited one) and
  can keep `0` where the patch said `-0`. Whether `-0` lands depends on whether
  another entry in the same patch changes.
- With distinct patch keys and no `NaN`, a step reuses the snapshot exactly
  when the next snapshot equals it. A `NaN` patch value always counts as a
  change.
- A step never removes a context key, and no sequence of events does.
- If every target the machine can produce is a declared state, the initial
  snapshot and every step from a declared state stay declared.
- `run` over one event is one step, and running `a` then `b` equals running
  `a + b`.

[`formal/fsmModel.manifest.json`](./formal/fsmModel.manifest.json) lists all
31 law names and the contract of each function.

## Deliberate defects

The manifest also lists thirteen edits to `fsmModel.ts`. Dafny must reject
each one with a proof failure:

- a self-transition with no change copies the snapshot;
- the merge drops patched values;
- a patch for a key the context does not own counts as unchanged;
- patches compare with `Object.is` instead of `===`;
- a key the context does not own counts as changed;
- the copy drops the first patch entry;
- inherited keys read as `undefined`;
- `NaN` is `===` to `NaN`;
- the configured target is ignored;
- a string transition loses its target;
- the initial snapshot drops the configured context;
- `run` skips each event's transition;
- an undeclared value uses the initial state's transitions.

The manifest also lists a rewrite of `strictEquals` that keeps its behavior.
The verifier checks that the rewrite makes the committed Dafny stale and that
the regenerated model verifies with the same laws.

## Tests

[`fsmAdapter.ts`](./fsmAdapter.ts) converts a `createFSM` config into the
model's `Machine` and runs both on the same events. It prefixes every context
key with `:`, which no `Object.prototype` property starts with, so `key in
context` in the model's TypeScript finds own keys only, as a Dafny map does. It
interns values by `Object.is`, builds `inherited` from `Object.prototype`, and
decodes each model context back to a JavaScript object. After every event it
compares the value, the context entries in order under `Object.is`, whether the
snapshot object was reused, and whether the context object was reused. It also
checks what the model leaves out: every snapshot has exactly the keys
`context`, `error`, `output`, `status`, and `value`, with `status: 'active'`
and undefined `output` and `error`; every transition returns no effects;
`initialTransition` and `getInitialSnapshot` return the initial snapshot; and
`getPersistedSnapshot` returns its argument.

The adapter refuses a context or patch whose prototype is not
`Object.prototype`, or that has symbol keys, accessors, or non-enumerable
properties. `createFSM` reads an accessor twice, compares no symbol keys but
copies them, and reads absent keys through other prototypes, so the model does
not cover those inputs.

[`fsmModel.test.ts`](./fsmModel.test.ts) runs named cases: inherited event
types, the empty-string target, functions that return `undefined` or `{}`, an
undeclared snapshot value, a table of patches that keep or copy the context
(`undefined` for an absent key, `-0` alone and beside a change, `NaN`, equal
and different strings, the same and a distinct reference, and `toString` with
and without its inherited value), own and inherited `__proto__` keys, and the
adapter's refusals.

[`fsmModel.property.test.ts`](./fsmModel.property.test.ts) runs the comparison
on up to 1,000 generated configurations with
[fast-check](https://fast-check.dev/), stopping early at a 4-second limit. It
draws state names including `''`, `__proto__`, and `toString`, with targets
that may be undeclared; event types including `toString`, `constructor`,
`__proto__`, and `''`; string, object, function, and `undefined` transitions;
context and patch keys including `toString` and `__proto__`; and values from
`-2` to `2`, `-0`, `0.5`, `NaN`, `undefined`, `'a'`, `'b'`, `true`, one shared
object, and fresh objects. A context and a patch rarely share a key holding
`0` and `-0` or `NaN` and `NaN`, so the named cases are what reliably catch a
change from `!==` to `Object.is` in `fsm.ts`.

Both test files run in `pnpm test`.

## Trust base and limits

- Nobody proves that LemmaScript preserves the meaning of `fsmModel.ts`.
  Dafny 4.11.0 checks the proof. The verifier uses unmodified
  `lemmascript@0.6.6` from npm.
- Agreement between the model and `fsm.ts` is tested, not proved, and so are
  the adapter's key encoding and value interning.
- `inherited` is read from `Object.prototype` when the adapter builds the
  machine. A program that changes `Object.prototype` later is outside the
  model.
- `fsm.ts` finds a state's transitions through `config.states[value]?.on`,
  which reads inherited properties. A `states` object built with
  `Object.create` or a literal `__proto__: { ... }` can give `createFSM`
  transitions that the model lacks. The generator builds `states` with
  `Object.fromEntries`, so a generated `__proto__` state is an own property,
  and no named case inherits a state.
- Transition functions are total and pure in Dafny. A function that throws,
  mutates its argument, or reads outside state is outside the model.
- `setup`, schemas, and actors are outside the model.

## Reproduce

The verifier needs Dafny 4.11.0 on `PATH` and LemmaScript 0.6.6 installed
outside this workspace:

```sh
npm install --prefix /tmp/lemmascript --ignore-scripts lemmascript@0.6.6
LEMMASCRIPT_LSC=/tmp/lemmascript/node_modules/lemmascript/tools/dist/lsc.js \
  node scripts/verify-fsm-model.mjs
```

It checks that the committed `.dfy.gen` is what LemmaScript generates from
`fsmModel.ts`, verifies the model (62 Dafny tasks), rejects the thirteen
defects, and checks the rewrite. The `fsm model verification` workflow runs it
on pull requests that change `src/fsm.ts` or this directory.

After editing `fsmModel.ts`, run `node "$LEMMASCRIPT_LSC" regen
--backend=dafny fsmModel.ts` in this directory, review the generated changes
and any merge left in `formal/fsmModel.dfy`, delete the `.dfy.base` file it
writes, and rerun the verifier. When a change to `src/fsm.ts` alters behavior,
update the model to match; the tests compare the two on every run.

## LemmaScript 0.6.6 notes

- `type Context = Record<string, Value>` becomes an opaque Dafny type, so the
  model writes `Record<string, Value>` everywhere.
- A union discriminated by `kind` becomes a Dafny datatype. A kind that is a
  Dafny keyword is renamed, so `opaque` becomes `opaque_`.
- `key in context` becomes Dafny map membership, but at run time it also finds
  inherited keys. The adapter's key prefix keeps the two the same.
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
