# AFK Run — Synchronous processing (#23 PRD, #34–#38)

**Status:** active

**Branch:** `machine-sync-34-38`, in the sibling worktree `xstate-sync-model`,
based on `investigate/sync-event-processing` (PR #33) at `dbe2265`.

**Pull request:** not yet created.

**Started:** 2026-11-21 23:12:05 UTC

**Goal:** Extend the verified machine model to eventless transitions (#34),
immediate raised events (#35), completion (#37), and combined compound and
parallel traces (#38), each with Dafny laws written before the implementation,
seeded model defects, and differential tests. Report the two upstream
candidate issues (#36). Keep a log of potential bugs found along the way.

**Execution:** sequential.

**Verified integration head:** not yet recorded.

### Slice progress

| Issue                                                   | Slice                                  | Status      | Blocked by / reason | Integration commit | Verification       |
| ------------------------------------------------------- | -------------------------------------- | ----------- | ------------------- | ------------------ | ------------------ |
| [#34](https://github.com/robertpenner/xstate/issues/34) | Eventless transitions in the flat model | ready       |                     |                    |                    |
| [#35](https://github.com/robertpenner/xstate/issues/35) | Immediate raised events                | blocked     | #34                 |                    |                    |
| [#36](https://github.com/robertpenner/xstate/issues/36) | Upstream reports                       | in progress |                     |                    | see evidence below |
| [#37](https://github.com/robertpenner/xstate/issues/37) | Completion                             | blocked     | #35, #36            |                    |                    |
| [#38](https://github.com/robertpenner/xstate/issues/38) | Combined compound and parallel traces  | blocked     | #37                 |                    |                    |

### Verification evidence

**Baseline (`dbe2265`, before edits).** `pnpm verify:machine-model` exited 1:
491 verified, 1 timeout. The timeout is `PlanFromFacts` at the 15-second
limit. Run alone with `--filter-symbol=PlanFromFacts` it verifies in 13 to 17
seconds. The load average was about 55 while other agents' test processes ran.
This failure is pre-existing and is not counted as a regression.

**#36 (upstream reports).** Both reproductions ran against the published
`xstate@6.0.0-beta.4` and `xstate@5.33.4` from npm, in scratch directories
outside the repo:

- Parallel selection: `start` logs `p always`, `b always`; `EV` logs `b EV`,
  `p always`, `b always`. Two eventless patches to the same key end with the
  later one (`log: 'B'`). Same on v5.
- Root output: `{ status: 'done', output: 0, context: { n: 110 } }`. Same on
  v5 (new probe `V10` in `synchronousProcessing.v5-probes.mjs`).
- Filed statelyai/xstate#5948 and statelyai/xstate#5949.
- `pnpm test:machine-model:sync-probes`: 38 tests passed. `pnpm format:check`:
  exit 0.

### Potential bugs

Runtime behavior, tool quirks, and suspected defects found during the run.
Each entry says what was observed, where, and what happened to it.

1. **Parallel eventless and event selection differ** (runtime, v5 too).
   `selectEventlessTransitions` takes the first enabled `always` on each
   atomic state's ancestor chain, while `transitionNode` lets a region's
   handler hide the parallel ancestor's handler. Filed as
   statelyai/xstate#5948.
2. **Simultaneous eventless patches lose a write** (runtime, v6 only). Two
   eventless transitions selected in one microstep both compute patches from
   the pre-step context, and the later one in document order wins. v5 runs
   `assign` actions in sequence. Included in statelyai/xstate#5948.
3. **Root `output` ignores exit-function context** (runtime, v5 too). Exit
   functions run after `getMachineOutput` at completion. Filed as
   statelyai/xstate#5949.
4. **An empty context patch from `always` loops forever** (runtime).
   `mergeContextPatch` returns a new object for `{}`, so the reselection rule
   sees a new snapshot. Not filed, by decision 4 in
   `SYNCHRONOUS_PROCESSING.md`; the owner's statelyai/xstate#5945 covers the
   `xstate/fsm` counterpart.
5. **The preconstruct dev entry cannot be imported as ESM** (tooling).
   `packages/core/dist/xstate.cjs.js` in a dev checkout is a Babel
   require-hook stub; `import` from Node fails, `require` works, and Node's
   type stripping rejects `src/index.ts`. Reproductions use `require` or the
   published package.
