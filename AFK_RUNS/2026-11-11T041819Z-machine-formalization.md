# XState machine formalization

**Status:** active

**Branch:** `machine-formalized`

**Pull request:** not yet created

**Started:** 2026-11-11 04:18:19 UTC

**Goal:** Implement robertpenner/xstate#9 and then robertpenner/xstate#10 under
the shared contract in robertpenner/xstate#8. Preserve production behavior.
Record suspected runtime bugs with reproductions and distinguish observations
from confirmed defects.

**Execution:** sequential.

**Baseline:** `bcd3840` (`origin/next`, refreshed before creating the worktree).

**Verified integration head:** not yet verified.

## Workflow authorization

The user approved a sibling XState worktree based on `origin/next`, a draft PR
targeting `next`, and the fork's verification commands. Penner's pooled
worktree/lifecycle scripts do not exist in this fork. Existing `main` and
`fsm-formalized` worktrees remain untouched.

## Ticket progress

| Issue | Outcome                                        | Status      | Blocker                    | Integration | Verification |
| ----- | ---------------------------------------------- | ----------- | -------------------------- | ----------- | ------------ |
| #9    | Flat-machine model, proofs, differential tests | in-progress | None                       | None        | Pending      |
| #10   | Nested compound-state model and evidence       | blocked     | #9 integrated and verified | None        | Pending      |

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

## Publication at stop or handoff

**Published head:** not yet published.

**Unverified checkpoint:** none.

**Remaining local work:** active implementation.

## Final series review

**Base/head:** pending.

**Contracts:** robertpenner/xstate#8, #9, #10 and refreshed agent briefs.

**Evidence:** pending.

**Findings:** pending.

**Remaining blockers:** #10 awaits #9.

**Completed:** pending.

**Duration:** not measured.

**Final verification:** pending.

**Result:** in progress.

**Pre-existing unrelated failures:** not yet assessed on this XState baseline.
