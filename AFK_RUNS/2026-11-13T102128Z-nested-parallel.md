# AFK Run — Multiple and nested parallel states (#23 PRD, #25–#27)

**Status:** active

**Branch:** `machine-nested-parallel-25-27`, in the sibling worktree
`xstate-nested-parallel`, based on `machine-formalized` at `886402a`.

**Pull request:** [robertpenner/xstate#29](https://github.com/robertpenner/xstate/pull/29) (draft)

**Started:** 2026-11-13 10:21:28 UTC

**Goal:** Extend the verified machine model from at most one parallel node to
arbitrary finite parallel nesting: initialization (#25), single-selection steps
(#26), and simultaneous transitions with conflict removal (#27), each with
Dafny laws, seeded model defects, differential tests, and runtime mutations.

**Execution:** sequential.

**Verified integration head:** `58455e3` (#26).

### Slice progress

| Issue                                                   | Slice                                    | Status      | Blocked by / reason | Integration commit | Verification       |
| ------------------------------------------------------- | ---------------------------------------- | ----------- | ------------------- | ------------------ | ------------------ |
| [#25](https://github.com/robertpenner/xstate/issues/25) | Initialization                           | integrated/verified |                     | `773e55c`, `95e824d` | see evidence below |
| [#26](https://github.com/robertpenner/xstate/issues/26) | Single-selection transitions             | integrated/verified |                     | `5e692fc`, `58455e3` | see evidence below |
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

### Recovery

Not resumed.

### Publication at stop or handoff

**Published head:** `58455e3`.

**Unverified checkpoint:** none.

**Remaining local work:** none.

### Final series review

**Base/head:** pending.

**Contracts:** pending.

**Evidence:** pending.

**Findings:** pending until reviewed.

**Remaining blockers:** #27 not started.
