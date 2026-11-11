# XState machine formalization

**Status:** active

**Branch:** `machine-formalized`

**Pull request:** <https://github.com/robertpenner/xstate/pull/11> (draft, base `next`)

**Started:** 2026-11-11 04:18:19 UTC

**Goal:** Implement robertpenner/xstate#9 and then robertpenner/xstate#10 under
the shared contract in robertpenner/xstate#8. Preserve production behavior.
Record suspected runtime bugs with reproductions and distinguish observations
from confirmed defects.

**Execution:** sequential.

**Baseline:** `bcd3840` (`origin/next`, refreshed before creating the worktree).

**Verified integration head:** `f3e9b7d` (flat milestone, evidence below).

## Workflow authorization

The user approved a sibling XState worktree based on `origin/next`, a draft PR
targeting `next`, and the fork's verification commands. Penner's pooled
worktree/lifecycle scripts do not exist in this fork. Existing `main` and
`fsm-formalized` worktrees remain untouched.

## Ticket progress

| Issue | Outcome                                        | Status              | Blocker                  | Integration           | Verification             |
| ----- | ---------------------------------------------- | ------------------- | ------------------------ | --------------------- | ------------------------ |
| #9    | Flat-machine model, proofs, differential tests | integrated/verified | None                     | `f3e9b7d`             | Flat milestone below     |
| #10   | Nested compound-state model and evidence       | integrated/verified | None; consumes `f3e9b7d` | This milestone commit | Compound milestone below |

## Verification evidence

### Flat-machine milestone

The exact changes checked are the new `machine-model` directory, both
verification scripts, the three root package scripts, the core fast-check
development dependency and its three-line lockfile entry. Production source
is byte-identical to `bcd3840`.

- `pnpm test:core`: 184 files passed; 2981 tests passed, 29 skipped, 3 todo.
- `pnpm test:machine-model`: 35 tests passed, including 500 generated traces.
- `pnpm verify:machine-model` (with the recorded LemmaScript path):
  39 Dafny verification tasks passed; all eight seeded model defects rejected
  by proof failures; freshness, additions-only inventory and refactor passed.
- `pnpm test:machine-model:runtime-defects`: both temporary runtime mutations
  failed the selected differential assertions; production source restored.
- `pnpm build`, `pnpm typecheck`, `pnpm lint`, `pnpm format:check`: passed.
- Explicit changed-file Markdown formatting and check: passed.
- `pnpm install` removed registry tarball URLs from unrelated lock entries.
  That task-owned churn was discarded. Only the already-resolved fast-check
  importer entry remains, and subsequent pnpm invocation accepted it.
- Fresh #9 brief:
  <https://github.com/robertpenner/xstate/issues/9#issuecomment-6786901156>.

- Baseline checkout is `bcd3840`. The initial `pnpm test:core -- --help`
  invocation ran the core suite (the separator passed the flag as a filter).
  It passed: 181 files, 2946 tests, 29 skipped and 3 todo. No production files
  or existing tests had been edited.
- The fresh checkout's pnpm invocation automatically restored its dependencies.
  pnpm 11.8.0, LemmaScript 0.6.6 and Dafny 4.11.0 were measured.
- The first differential test failed on the missing adapter, then passed.
  The lifecycle test failed on missing initial-entry processing, then passed.
  It confirms selection callbacks observe pre-exit context, while entry observes
  the transition patch applied after exit patches.
- Initial generated model contracts: 8 verified, 0 errors. This is not the
  completed law inventory.
- Temporary evidence:
  `/Users/robertpenner/git/penner-agent-scratch/branch-xstate-machine-model/run-sXCxa90t`.

## Suspected bugs and unexpected behavior

### Compound proof and generator limitations

- LemmaScript 0.6.6 emits cross-module calls as axioms. The combined flat and
  compound model therefore lives in one TypeScript translation unit; the proof
  driver rejects axioms.
- A negative slice endpoint, `slice(0, -1)`, emitted an invalid Dafny slice.
  The executable model uses the equivalent explicit length-minus-one endpoint.
- Direct calls to function-valued node fields (`node.exit(context, event)`)
  are rejected by this emitter as unsupported method calls. Binding each field
  to a local function before calling it translates successfully.
- Dafny 4.11.0 rejected a small conditional-function application equality:
  given `N(entry: int -> int, exit: int -> int)` and `!b`, the assertion
  `(if b then n.exit else n.entry)(value) == n.entry(value)` did not verify.
  Explicit local callback types changed which obligation failed. This is
  unexpected verifier behavior, not a confirmed unsoundness or runtime bug.
  The model's equivalent conditional over callback results verifies.
- The first extended defect run rejected ten edits but refused to count the
  unaffected-ancestor mutation: its only result was a timeout. A concrete
  sibling/reentry lifecycle witness was added alongside the general laws.
  The driver continues to require a semantic proof failure for each edit.

### Descendant targeting root enters root without exiting it

- Revision: `bcd3840`.
- Reproducer: `packages/core/test/machine-model/runtimeFindings.test.ts`,
  `targeting the root from a descendant enters root without exiting it`.
- A root with `id: 'root'`, initial child `a`, and a transition from `a`
  with `{ target: '#root' }` invokes root entry without root exit.
- Compound generated testing found this with seed 8912 after six cases and
  77 shrinks. The standalone public-API reproducer preserves the minimal
  behavior independently of the generated harness.
- Status: suspected runtime bug, not an approved production fix. The model
  preserves this behavior using separate exit and entry cuts for root targets.
- The adjusted comparison passes 500 generated compound trees/traces.

### Targetless reentry runs entry without exit

- Revision: `bcd3840`.
- Reproducer: `packages/core/test/machine-model/runtimeFindings.test.ts`,
  `targetless reenter runs entry without exit`.
- Observed through the differential harness: an atomic state's handler
  `{ reenter: true }` emits its entry effect but no exit effect. An explicit
  self-target with `reenter: true` emits both.
- Expected from `docs/transitions.md`: targetless transitions do not leave the
  current state; reentry is documented for self-targets. Entry without a
  corresponding exit appears unintended.
- Hypotheses, in order: entry processing adds a reentering source despite no
  target; exit effects are dropped; the model adapter misidentifies the effects.
  The standalone public-API reproducer removes the adapter from the comparison.
- Status: suspected runtime bug, dedicated reproducer added; no production fix.
  The formal model must describe the observed behavior or explicitly report
  the unresolved discrepancy, not claim agreement while omitting it.
- The standalone reproduction passes. Source inspection confirms exit-set
  calculation requires a nonempty target list, while entry-set calculation adds
  a source whose `reenter` is true even without targets. The model now records
  this asymmetry and its separate characterization law.

### LemmaScript optional narrowing during defect generation

- Toolchain: unmodified LemmaScript 0.6.6 and Dafny 4.11.0.
- A valid TypeScript mutation using
  `patch === undefined || patch.length === 0` emitted a Dafny size operation on
  `Option<seq<PatchEntry>>`, causing a type error. An equivalent ternary
  generated valid Dafny.
- Replacing the whole unhandled condition with `selected.result === undefined`
  caused subsequent generated code to match `Some` against an already-unwrapped
  `Result`. Keeping the conjunction and changing its length comparison avoids
  that emitter path.
- These appear to be translator narrowing defects. The verification harness
  correctly refused to count parser/type failures as proof rejection.
  No translator modifications are included.

## Recovery

Fresh run. Both implementation issues are open and labeled `ready-for-agent`.
The parent is coordination only. #10 has the native dependency on #9.

The resumed run confirmed `f3e9b7d` is the published integration. The compound
implementation and unfinished proofs are being preserved as a checkpoint at the
user's request for frequent pushes. This checkpoint does not complete #10.

### Compound checkpoint verification

- Nine named compound tests and 500 generated compound cases passed before
  the latest proof-only additions.
- Dafny check of the expanded model: 91 verified, two errors in
  `DeepestSelection`, three timeouts in `LifecycleConcatenation`,
  `CompoundLifecycleMeaning`, and `ReverseLifecycleOrder`.
- Typecheck found an inferred recursive type in the adapter's local children
  array. An explicit type annotation fixed it; `pnpm typecheck` passes.
- Full core regression suite is running; build, lint and final formatting
  checks have not yet been rerun for compound changes.
- The proof manifest and verification driver still describe the flat milestone.
  Their inventory, additions-only validation, and mutation coverage must be
  extended before #10 can be marked verified.
- Next: complete the compound proofs without assumptions, update the driver,
  add compound semantic defects, rerun all required checks, and publish the
  verified milestone. Final independent review remains pending.

### Compound milestone

- Checkpoint `8bba6df` was pushed and the remote branch was confirmed equal to
  local HEAD. The PR remains draft.
- All compound proofs now pass: 252 verification tasks, zero errors and no
  warnings. The inventory includes 35 named laws and 13 generated contracts.
- `pnpm test:machine-model`: 59 tests pass, including 500 generated flat cases
  and 500 generated compound cases. The compound named suite has 22 cases.
- `pnpm typecheck`: passes after the refusal fixture includes a supported
  structural field alongside the intentionally unsupported field.
- `pnpm test:machine-model:runtime-defects`: all three mutations fail their
  differential assertion, including reversed compound exit order. The original
  production source bytes were restored.
- `pnpm verify:machine-model`: 252 verification tasks pass; all 13 model
  defects cause semantic proof failures. Freshness, additions-only inventory,
  unchanged generated executable bodies, and the behavior-preserving refactor
  all pass.
- `pnpm test:core`: 186 files passed, 3005 tests passed, 29 skipped, three todo.
- `pnpm build`, `pnpm typecheck`, `pnpm lint`, `pnpm format:check`: pass.
  Changed-file Markdown formatting and check also pass.
- The exact checked changes extend the combined model, proof and manifest,
  shared encoding adapter, compound adapter, named/generated tests, runtime
  reproductions, verifier and runtime mutation driver. Documentation and this
  log describe those changes. Production source remains identical to `bcd3840`.
- All implementation outcomes are now locally verified. Final independent
  series review and PR publication checks remain pending.

## Publication at stop or handoff

**Published verified head:** `f3e9b7d`.

**Unverified checkpoint:** compound implementation and proof work; see verification
above. The checkpoint's commit is identified by its `chore(core): checkpoint`
message and the Git history containing this log.

**Remaining local work:** publish the verified compound milestone and complete
independent series review.

## Final series review

**Base/head:** pending.

**Contracts:** robertpenner/xstate#8, #9, #10 and refreshed agent briefs.

**Evidence:** pending.

**Findings:** pending.

**Remaining blockers:** final independent review and PR publication checks.

**Completed:** pending.

**Duration:** not measured.

**Final verification:** pending.

**Result:** in progress.

**Pre-existing unrelated failures:** none found in required checks. Lint emits
the existing Node module-type warning for `scripts/oxlint-plugin-xstate-react.ts`;
it exits successfully.
