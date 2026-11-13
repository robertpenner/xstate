# AFK Run — Multiple and nested parallel states (#23 PRD, #25–#27)

**Status:** completed

**Branch:** `machine-nested-parallel-25-27`, in the sibling worktree
`xstate-nested-parallel`, based on `machine-formalized` at `886402a`.

**Pull request:** [robertpenner/xstate#29](https://github.com/robertpenner/xstate/pull/29) (ready for review)

**Started:** 2026-11-13 10:21:28 UTC

**Goal:** Extend the verified machine model from at most one parallel node to
arbitrary finite parallel nesting: initialization (#25), single-selection steps
(#26), and simultaneous transitions with conflict removal (#27), each with
Dafny laws, seeded model defects, differential tests, and runtime mutations.

**Execution:** sequential.

**Verified integration head:** `c519d25` (#27 plus review fixes).

### Slice progress

| Issue                                                   | Slice                                    | Status      | Blocked by / reason | Integration commit | Verification       |
| ------------------------------------------------------- | ---------------------------------------- | ----------- | ------------------- | ------------------ | ------------------ |
| [#25](https://github.com/robertpenner/xstate/issues/25) | Initialization                           | integrated/verified |                     | `773e55c`, `95e824d` | see evidence below |
| [#26](https://github.com/robertpenner/xstate/issues/26) | Single-selection transitions             | integrated/verified |                     | `5e692fc`, `58455e3` | see evidence below |
| [#27](https://github.com/robertpenner/xstate/issues/27) | Simultaneous transitions across regions  | integrated/verified |                     | `1d2b483`, `c2fb9fa` | see evidence below |

### Verification evidence

**Baseline (`886402a`, before edits).** `pnpm test:machine-model`: 121 tests
passed. `pnpm verify:machine-model`: 462 verified, 0 errors; 11 proof
weakenings and 27 defects rejected; refactor verified. Its final
unchanged-source assertion then failed (exit 1) because #25 edits to
`machineModel.ts` were made while it ran; the driver works in temporary
directories, so the earlier results are unaffected.

**#25 (`773e55c` model, proofs, adapters, tests, mutation; `95e824d` README).**
Checks ran on the exact uncommitted tree committed as those two commits.

- `pnpm verify:machine-model` (`MACHINE_MODEL_VERIFY_TIMEOUT_MS=600000`, run
  alone): 465 verified, 0 errors; 11 proof weakenings and 30 defects rejected;
  refactor verified; exit 0.
- `pnpm test:machine-model:runtime-defects` (run alone): all 9 runtime
  mutations rejected, exit 0. The first attempt at a nested runtime mutation
  (dropping a nested region in the `addDescendantStatesToEnter` parallel loop)
  went undetected; dropping it in `getInitialStateNodes` also left behavior
  unchanged, because `getInitialStateNodes`, `addAncestorStatesToEnter`, and
  `addDescendantStatesToEnter` each add missing regions. The committed mutation
  makes compound regions of a nested parallel node enter every child, which
  the named test rejects.
- `pnpm test:machine-model`: 127 tests passed.
- New property at seed 2541, 300 runs: 182 machines with more than one active
  parallel node, 86 with active parallel nodes on separate branches, maximum 4
  parallel nodes on one path, 51 with an inactive parallel node, 105 refused
  steps. (Refused under #25's rule, which refused every step on a machine with
  more than one parallel node; #27 reports the 87 of these steps with two or
  more selections.)
- `pnpm typecheck`, `pnpm lint`, `pnpm format:check`, `pnpm build`: exit 0.
- `pnpm test:tooling`: 28 tests passed.
- `pnpm test:core`: 3078 passed, 32 skipped, 3 todo; 1 failed file,
  `test/declarations.test.ts`, with `Hook timed out in 60000ms`. Rerun alone:
  20 tests passed. The file emits TypeScript declarations and does not use the
  machine model.

**#26 (`5e692fc` model, proofs, adapter, tests, mutations; `58455e3` README).**
Brief: [#26 comment](https://github.com/robertpenner/xstate/issues/26#issuecomment-6852049072).
Checks ran on the exact uncommitted tree committed as those two commits,
except that the property 3 run count was then lowered from 800 to 400 (below)
and `pnpm test:machine-model`, `pnpm test:core`, and `pnpm format:check`
were rerun on the final tree. The property change does not touch the Dafny
inputs.

- `pnpm verify:machine-model` (`MACHINE_MODEL_VERIFY_TIMEOUT_MS=600000`, run
  alone): 472 verified, 0 errors; 11 proof weakenings and 33 defects
  rejected; freshness, additions-only inventory and refactor verified; exit 0.
- `pnpm test:machine-model:runtime-defects` (run alone): all 11 runtime
  mutations rejected, exit 0.
- `pnpm test:machine-model`: 143 tests passed.
- New property 3 at seed 6113, 400 runs: 319 machines with more than one
  parallel node, 346 compared steps with a selection on such machines, 50
  narrowed steps (9 through two or more parallel levels), 10 parallel
  fallbacks, 39 deep entries, 31 deep exits, 1112 dropped events (744
  simultaneous selections with several parallel nodes, 368 active-region
  targets). At 800 runs it took 1.7 s alone, but in the full suite under a
  machine load average near 90 fast-check interrupted it at its 4000 ms limit
  after 146 runs (and after 202 in `test:core`); at 400 runs it took 990 ms
  alone and passed in both suites.
- `pnpm typecheck`, `pnpm lint`, `pnpm format:check`, `pnpm build`: exit 0.
- `pnpm test:tooling`: 28 tests passed.
- `pnpm test:core`: 3097 passed, 29 skipped, 3 todo; exit 0. The first run
  also hit the known `test/declarations.test.ts` hook timeout.

**#27 (`1d2b483` model, proofs, adapter, tests, mutations; `c2fb9fa` README).**
Brief: [#27 comment](https://github.com/robertpenner/xstate/issues/27#issuecomment-6854017167).
Checks ran on the exact uncommitted tree committed as those two commits.

- Removing the refusal from `parallelStepReady` produced no model/runtime
  mismatch in the differential tests; only tests that expected the refusal
  failed. Regeneration changed only that function, and only
  `MultipleParallelSelectionsRefused` failed to verify; it was deleted. The new
  laws `SelectedSourcesApart`, `SelectedConflictsGreedy`, and
  `SimultaneousReadyMeaning` (with helpers) show that selected sources are
  pairwise incomparable, that conflict removal on them is greedy filtering,
  and that readiness depends only on each selection's target. The existing
  multi-step laws needed no change.
- `pnpm verify:machine-model` (`MACHINE_MODEL_VERIFY_TIMEOUT_MS=600000`, run
  alone): 492 verified, 0 errors; 11 proof weakenings and 36 defects
  rejected; freshness, additions-only inventory and refactor verified; exit 0.
- `pnpm test:machine-model:runtime-defects` (run alone): all 13 runtime
  mutations rejected, exit 0.
- `pnpm test:machine-model`: 152 tests passed.
- Property 2 at seed 2541 now compares the 87 steps it previously refused.
  Property 3 at seed 6113, 400 runs: 319 machines with more than one parallel
  node, 544 compared steps with a selection on such machines, 105 narrowed (19
  through two or more levels), 12 parallel fallbacks, 71 deep entries, 60 deep
  exits, 186 simultaneous steps (93 mixed source depths, 160 sources below two
  or more parallel nodes, 33 conflicting, 6 independent moves, 3 strictly
  nested kept domains), 913 dropped events, all active-region targets.
- `pnpm typecheck`, `pnpm lint`, `pnpm format:check`, `pnpm build`: exit 0.
- `pnpm test:tooling`: 28 tests passed.
- `pnpm test:core`: 3106 passed, 29 skipped, 3 todo; exit 0.
- Correction: the #26 README stated 155 laws while its manifest listed 154.
  The #27 README states the manifest's 166.

### Recovery

Not resumed.

### Publication at stop or handoff

**Published head:** `32d26f4` (code head `c519d25`).

**Unverified checkpoint:** none.

**Remaining local work:** none.

### Final series review

**Base/head:** `886402a` (`origin/machine-formalized`, merge base) to
`148135e`; 11 changed files, 9 commits. Artifacts materialized under the run's
scratch `review/` directory with `provenance.txt`; every child quoted the head
ref and file count from it.

**Contracts:** parent PRD #23; newest just-in-time briefs on #25, #26, and #27;
xstate `AGENTS.md`/`CONTRIBUTING.md`; penner `CODING_STANDARDS.md` as guidance;
the code-review skill's Ideas and evidence procedure.

**Evidence:** three separate `review-axis` agents (Standards, Spec, Ideas and
evidence) read only the materialized artifacts. The coordinator validated each
finding against the worktree before acting.

**Findings and resolutions** (`c8643d4` tests, `c519d25` README):

- README overstated `AncestorResetsSubtree` for any ancestor; the lemma
  requires a non-parallel source, and a parallel ancestor narrows. Qualified.
- README's SCXML comparison still described single-parallel region-first
  selection. Restated for the recursive rule.
- README presented `comparable sources` as a live refusal; `SelectedSourcesApart`
  makes it unreachable. Documented, and the nested property now asserts that
  `active region target` is the only refusal reason seen.
- No named case moved two sibling inner parallel nodes independently. Added
  `moves two sibling inner parallel nodes independently` (region sources and
  an inner parallel fallback that narrows).
- #26 property did not lower-bound several transition classes. Added
  `deepDomains` (55), `reenteredParallels` (71), and `stoppedFallback` (224)
  with lower bounds, plus a bound on `narrowedSteps` (105). A probe showed
  `reenteredParallels` and `deepEntries` differ on 52 steps despite equal
  totals.
- The initialization property never gave the root its `go` handler because
  `config` was copied before handlers were set. Fixed; seed results unchanged.
- The nested self-target case did not assert `nestedDomains`; it now does.
- README misstated the nested fixture, said "two levels deeper" (one level),
  omitted #26/#27 from the issue list, claimed all three runtime region loops
  were tried (two were), described a defect as "nested" when it triggers on
  more than one parallel node, and said "single-parallel models". Corrected.
- Run log: the #25 "105 refused steps" and #27 "87" counts measure different
  things; clarified above.

Not changed, with reasons: `SelectSource` has no remaining callers but is an
inventoried law about compound `select` and still verifies; `Distinct` restates
the inline distinctness clause of the generated `ParallelWellFormed`, which
cannot be edited without changing generated code; `parallelReady` and
`selectionReady` share a clause in generated code and laws such as
`ParallelStepDelegates` depend on both; `parallelFallback` keeps its name and
gains a comment stating that it counts declined descendant handlers.

**Verification after fixes** (uncommitted tree later committed as `c8643d4`,
`c519d25`): `pnpm test:machine-model` 154 passed;
`pnpm test:machine-model:runtime-defects` (alone) 13 mutations rejected;
`pnpm test:core` 3108 passed, 29 skipped, 3 todo; `pnpm typecheck`,
`pnpm lint`, `pnpm format:check`, `pnpm build` exit 0. `machineModel.ts`,
the Dafny files, and the manifest are unchanged since `1d2b483`, whose
`pnpm verify:machine-model` run reported 492 verified, 0 errors.

**Remaining blockers:** none.

### Completion

**Final verification:** at `c519d25`, `pnpm test:machine-model` 154 passed,
`pnpm test:machine-model:runtime-defects` 13 mutations rejected,
`pnpm test:core` 3108 passed (29 skipped, 3 todo), `pnpm typecheck`,
`pnpm lint`, `pnpm format:check`, `pnpm build` exit 0;
`pnpm verify:machine-model` 492 verified, 0 errors at `1d2b483` with model,
Dafny, and manifest unchanged since. `gh pr checks 29`: `build` passed
(10m47s) on `32d26f4` after the PR was marked ready.

**Pre-existing failures:** none observed in the final runs. Earlier,
`declarations.test.ts` hit a 60-second hook timeout once in `pnpm test:core`
under load and passed when rerun alone (recorded under #25).

**Parent summary:**
[#23 comment](https://github.com/robertpenner/xstate/issues/23#issuecomment-6856465734).

**Result:** #25, #26, and #27 integrated and verified on PR #29; the machine
model now proves initialization, single-selection steps, and simultaneous
steps for any finite parallel nesting, compared against the runtime by named
and generated differential tests. Issues remain open until the PR merges.
