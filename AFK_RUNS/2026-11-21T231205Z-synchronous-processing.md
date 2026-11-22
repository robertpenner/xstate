# AFK Run — Synchronous processing (#23 PRD, #34–#38)

**Status:** active

**Branch:** `machine-sync-34-38`, in the sibling worktree `xstate-sync-model`,
based on `investigate/sync-event-processing` (PR #33) at `dbe2265`.

**Pull request:** [#39](https://github.com/robertpenner/xstate/pull/39) (draft), base `investigate/sync-event-processing`.

**Started:** 2026-11-21 23:12:05 UTC

**Goal:** Extend the verified machine model to eventless transitions (#34),
immediate raised events (#35), completion (#37), and combined compound and
parallel traces (#38), each with Dafny laws written before the implementation,
seeded model defects, and differential tests. Report the two upstream
candidate issues (#36). Keep a log of potential bugs found along the way.

**Execution:** sequential.

**Verified integration head:** `e79b6f8` (#34).

### Slice progress

| Issue                                                   | Slice                                  | Status      | Blocked by / reason | Integration commit | Verification       |
| ------------------------------------------------------- | -------------------------------------- | ----------- | ------------------- | ------------------ | ------------------ |
| [#34](https://github.com/robertpenner/xstate/issues/34) | Eventless transitions in the flat model | integrated/verified |             | `49d7a53`, `e79b6f8` | see evidence below |
| [#35](https://github.com/robertpenner/xstate/issues/35) | Immediate raised events                | ready       |                     |                    |                    |
| [#36](https://github.com/robertpenner/xstate/issues/36) | Upstream reports                       | integrated/verified |             | `23784c5`          | see evidence below |
| [#37](https://github.com/robertpenner/xstate/issues/37) | Completion                             | blocked     | #35                 |                    |                    |
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

**#34 (eventless transitions).** Brief posted late, during implementation:
https://github.com/robertpenner/xstate/issues/34#issuecomment-7071026815.
Laws were written first in a scratch Dafny file, then the model, then the
proofs. Checks on the uncommitted tree that became `49d7a53` and `e79b6f8`
(the pre-commit hook only reformatted):

- `LEMMASCRIPT_LSC=… MACHINE_MODEL_VERIFY_TIMEOUT_MS=900000 pnpm verify:machine-model`:
  exit 0. 521 verification tasks; all 45 model defects (9 new) and the
  proof-weakening probes rejected. The baseline `PlanFromFacts` timeout did not
  recur.
- `pnpm test:machine-model:runtime-defects` (run alone): exit 0, 15 runtime
  defects rejected (2 new: the bound off by one, no reselection).
- `pnpm test:machine-model`: 206 tests passed (11 files).
- `pnpm test:machine-model:sync-probes`: 38 passed.
- `pnpm test:core`: 3299 passed, 28 skipped, 3 todo (201 files).
- `pnpm typecheck`, `pnpm lint`, `pnpm format:check`, `pnpm build`,
  `pnpm test:tooling`: exit 0.

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
6. **LemmaScript cannot call a function-typed field** (tooling,
   LemmaScript 0.6.6). `source.always(context, event)` fails translation with
   "Unsupported Dafny method call"; binding the field to a local first works.
   Worked around in `alwaysSelected`. Not filed.
7. **A handled macrostep's last microstep snapshot is replaced at completion**
   (runtime observation, likely intended). When a handled macrostep would
   return the previous snapshot, `completeMacrostep` clones it and overwrites
   the last entry of the microstep list, so `getMicrosteps` reports a
   different object for that microstep than the loop used to decide
   reselection. The adapter compares snapshot identity per macrostep only.
8. **An unhandled event returns the previous snapshot together with eventless
   effects** (runtime observation). With an effect-only `always`, sending an
   unhandled event returns the same snapshot object and a non-empty effect
   list. Consistent with "unchanged snapshot", but callers that treat
   `snapshot === previous` as "nothing happened" would skip those effects.
   Not filed.
9. **Runtime-defect test filters are regular expressions** (tooling, this
   repo). A test name containing `+` passed to `vitest -t` matched no tests;
   vitest exited 0 and the lane failed with "Undetected runtime defect", which
   points at the mutant rather than the filter. Fixed by renaming the test.
