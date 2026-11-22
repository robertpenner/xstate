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

**Verified integration head:** `7cab525` (#37).

### Slice progress

| Issue                                                   | Slice                                   | Status              | Blocked by / reason | Integration commit   | Verification       |
| ------------------------------------------------------- | --------------------------------------- | ------------------- | ------------------- | -------------------- | ------------------ |
| [#34](https://github.com/robertpenner/xstate/issues/34) | Eventless transitions in the flat model | integrated/verified |                     | `49d7a53`, `e79b6f8` | see evidence below |
| [#35](https://github.com/robertpenner/xstate/issues/35) | Immediate raised events                 | integrated/verified |                     | `7c5c7e8`, `4ac69fe` | see evidence below |
| [#36](https://github.com/robertpenner/xstate/issues/36) | Upstream reports                        | integrated/verified |                     | `23784c5`            | see evidence below |
| [#37](https://github.com/robertpenner/xstate/issues/37) | Completion                              | integrated/verified |                     | `40d84e4`, `7cab525` | see evidence below |
| [#38](https://github.com/robertpenner/xstate/issues/38) | Combined compound and parallel traces   | in progress         |                     |                      |                    |

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

**#35 (immediate raised events).** Brief:
https://github.com/robertpenner/xstate/issues/35#issuecomment-7071744038
(posted before implementation). Checks on the uncommitted tree that became `7c5c7e8` and
`4ac69fe`:

- `pnpm verify:machine-model` (first run): exit 1. Every one of the 55 model
  defects (10 new) and the proof-weakening probes were rejected, then the
  behavior-preserving refactor step timed out on `SettleAccumulates` at the
  15-second limit with the load average at 41. I added `{:isolate_assertions}`
  to that hand-written lemma, which splits it into separate verification
  tasks and raises the count from 535 to 568. Rerun directly: `dafny verify`
  on the proof, 568 verified, 0 errors; `lsc regen` of the refactored model,
  568 verified, 0 errors. A full rerun of `verify:machine-model` on a
  detached checkout of `4ac69fe` then exited 0: baseline and refactor
  regen both verified, every defect rejected, ending "Freshness,
  additions-only inventory, defects and refactor verified."
- `pnpm test:machine-model:runtime-defects` (run alone): exit 0, 16 runtime
  defects rejected (1 new: raised events dequeued last in, first out).
- `pnpm test:machine-model`: 221 tests passed.
- `pnpm test:machine-model:sync-probes`: 38 passed.
- `pnpm test:core`: 3314 passed, 28 skipped, 3 todo.
- `pnpm typecheck`, `pnpm lint`, `pnpm format:check`, `pnpm build`,
  `pnpm test:tooling`: exit 0.

**#37 (completion).** Brief:
https://github.com/robertpenner/xstate/issues/37#issuecomment-7072865526.
Laws were written first, then the model and proofs. Checks on the
uncommitted tree that became `40d84e4` and `7cab525` (the files were compared
byte for byte with the verified checkout after the pre-commit hook ran):

- `pnpm verify:machine-model` on a detached checkout of `4ac69fe` plus the
  #37 changes: exit 0, ending "Freshness, additions-only inventory, defects
  and refactor verified." 742 verification tasks, 201 laws, all 69 model
  defects (14 new) and the proof-weakening probes rejected.
- `pnpm test:machine-model:runtime-defects` (run alone): exit 0, 17 runtime
  defects rejected (1 new: a nested done event names the final child).
- `pnpm test:machine-model`: 248 tests passed (14 files).
- `pnpm test:core`: 3341 passed, 28 skipped, 3 todo (204 files).
- `pnpm typecheck`, `pnpm lint`, `pnpm format:check`: exit 0.

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
10. **`lsc regen` three-way merge can align the wrong one-line body**
    (tooling, LemmaScript 0.6.6). `regen` merges with
    `git merge-file dfy base gen`. After the #35 proofs shifted line numbers,
    the mutated body of `completes` (defect "parallel enters only its first
    region") was aligned against the one-line body of lemma
    `CompoundInitialValid` and conflicted. The verify script reported it as a
    tool failure. Moving the #34/#35 section of ghost declarations to the end
    of `machineModel.dfy` restored the alignment; a merge-only prescreen of all
    55 defects (`lsc gen` plus `git merge-file`) found no conflicts. Not filed.
11. **A final node's `always` is taken, and a stale done event still fires
    `onDone`** (runtime, probed on the fork's dist). Final nodes otherwise
    ignore `on`, `after`, and `invoke` (`getTransitionData` returns
    `undefined`, and `FINAL_STATE_IGNORED_KEYS` warns in development), but
    `always` is neither blocked nor warned. With
    `p: { initial: 'a', states: { a: { on: { go: { target: 'b' } } }, b: { type: 'final', always: { target: 'a' } } }, onDone: { target: 'q' } }`,
    sending `go` steps `{p: b}`, then `{p: a}`, then `q`: the done event queued
    on entering `b` is dequeued after `p` has left its final child and still
    takes `p.onDone`. The model adapter refuses any transitions on final
    nodes. Not filed yet.
12. **Wall-clock proof timeouts under shared load** (tooling). With the load
    average between 30 and 55, lemmas that verify in a few seconds alone
    (`PlanFromFacts`, `SettleAccumulates`, `DomainActive`) intermittently pass
    the 15-second limit. The verify script fails the whole run on any timeout.
    Worked around with `{:isolate_assertions}` on the affected hand-written
    lemmas; Dafny's `--resource-limit` would make the limit independent of
    load. Not changed in this run.
13. **A seeded defect's anchor was broken silently by a later model change**
    (tooling, this repo). The flat #37 edit changed the text that defect 7
    ("reversed lifecycle effects") replaces, so `replaceOnce` would have thrown
    only inside the 40-minute verify. A scratch prescreen that counts each
    defect's `before` text in the model caught it. A unit test that runs the
    same count would catch it in seconds.
14. **An abstract law can time out instead of failing on its defect** (proof
    design). Under the defect that names the done event for the final child,
    `NestedFinalRaisesDone` timed out: its ids are symbolic, so nothing tells
    Dafny that the leaf and parent differ, and the verify script does not count
    a timeout as a rejection. The concrete witness `NestedDoneNamesParent`
    (ids `p` and `f`) fails at once and now rejects the defect.
15. **A nested parallel region's output depends on macrostep timing**
    (runtime, probed in `packages/core`). When a parallel node completes, the
    output for a region that is itself parallel is read with
    `internalQueue.find` for that region's done event. If the nested parallel
    completed in an earlier macrostep, its done event was already processed,
    and the region's key is `undefined`. For a parallel root `P` with a nested
    parallel region `N` (final outputs `n1`, `n2`) and a compound region `R`
    (final output `r`), sending `GO_N` then `GO_R` ends with machine output
    `{ R: 'r' }` (`N` undefined); one event completing both ends with
    `{ N: { n1: 'n1', n2: 'n2' }, R: 'r' }`. Compound regions do not have this
    problem because their output is reevaluated from the active final child.
    Not filed yet.
16. **Region outputs in a parallel done event are reevaluated** (runtime
    observation). A compound region's own done event carries its final
    child's output evaluated on entry, but the parallel done event evaluates
    that output again with the context current when the last region finishes.
    In the probe, region `R`'s done event carried `1` and the parallel's
    output reported `R: 2` after a context update in between.
17. **An already complete parallel completes again** (runtime observation,
    SCXML-consistent). While every region stays final, a region transition
    from one final child to another queues the region's done event and then
    the parallel's done event a second time. `completedNodes` only prevents a
    second done event within one microstep. SCXML's `enterStates` behaves the
    same way, so the model mirrors it.
