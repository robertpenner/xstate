# AFK Run — Multiple and nested parallel states (#23 PRD, #25–#27)

**Status:** active

**Branch:** `machine-nested-parallel-25-27`, in the sibling worktree
`xstate-nested-parallel`, based on `machine-formalized` at `886402a`.

**Pull request:** not yet created

**Started:** 2026-11-13 10:21:28 UTC

**Goal:** Extend the verified machine model from at most one parallel node to
arbitrary finite parallel nesting: initialization (#25), single-selection steps
(#26), and simultaneous transitions with conflict removal (#27), each with
Dafny laws, seeded model defects, differential tests, and runtime mutations.

**Execution:** sequential.

**Verified integration head:** `95e824d` (#25).

### Slice progress

| Issue                                                   | Slice                                    | Status      | Blocked by / reason | Integration commit | Verification       |
| ------------------------------------------------------- | ---------------------------------------- | ----------- | ------------------- | ------------------ | ------------------ |
| [#25](https://github.com/robertpenner/xstate/issues/25) | Initialization                           | integrated/verified |                     | `773e55c`, `95e824d` | see evidence below |
| [#26](https://github.com/robertpenner/xstate/issues/26) | Single-selection transitions             | pending     | #25                 |                    |                    |
| [#27](https://github.com/robertpenner/xstate/issues/27) | Simultaneous transitions across regions  | pending     | #26                 |                    |                    |

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
  steps.
- `pnpm typecheck`, `pnpm lint`, `pnpm format:check`, `pnpm build`: exit 0.
- `pnpm test:tooling`: 28 tests passed.
- `pnpm test:core`: 3078 passed, 32 skipped, 3 todo; 1 failed file,
  `test/declarations.test.ts`, with `Hook timed out in 60000ms`. Rerun alone:
  20 tests passed. The file emits TypeScript declarations and does not use the
  machine model.

### Recovery

Not resumed.

### Publication at stop or handoff

**Published head:** not yet published.

**Unverified checkpoint:** none.

**Remaining local work:** none.

### Final series review

**Base/head:** pending.

**Contracts:** pending.

**Evidence:** pending.

**Findings:** pending until reviewed.

**Remaining blockers:** #26 and #27 not started.
