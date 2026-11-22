# AFK Run — Synchronous processing (#23 PRD, #34–#38)

**Status:** completed

**Branch:** `machine-sync-34-38`, in the sibling worktree `xstate-sync-model`,
based on `investigate/sync-event-processing` (PR #33) at `dbe2265`.

**Pull request:** [#39](https://github.com/robertpenner/xstate/pull/39) (ready for review), base `investigate/sync-event-processing`.

**Started:** 2026-11-21 23:12:05 UTC

**Ended:** 2026-11-22 10:35:15 UTC (duration 11 h 23 min, measured with `date -u`)

**Goal:** Extend the verified machine model to eventless transitions (#34),
immediate raised events (#35), completion (#37), and combined compound and
parallel traces (#38), each with Dafny laws written before the implementation,
seeded model defects, and differential tests. Report the two upstream
candidate issues (#36). Keep a log of potential bugs found along the way.

**Execution:** sequential.

**Verified integration head:** `f756e58` (#38 review fixes).

### Slice progress

| Issue                                                   | Slice                                   | Status              | Blocked by / reason | Integration commit   | Verification       |
| ------------------------------------------------------- | --------------------------------------- | ------------------- | ------------------- | -------------------- | ------------------ |
| [#34](https://github.com/robertpenner/xstate/issues/34) | Eventless transitions in the flat model | integrated/verified |                     | `49d7a53`, `e79b6f8` | see evidence below |
| [#35](https://github.com/robertpenner/xstate/issues/35) | Immediate raised events                 | integrated/verified |                     | `7c5c7e8`, `4ac69fe` | see evidence below |
| [#36](https://github.com/robertpenner/xstate/issues/36) | Upstream reports                        | integrated/verified |                     | `23784c5`            | see evidence below |
| [#37](https://github.com/robertpenner/xstate/issues/37) | Completion                              | integrated/verified |                     | `40d84e4`, `7cab525` | see evidence below |
| [#38](https://github.com/robertpenner/xstate/issues/38) | Combined compound and parallel traces   | integrated/verified |                     | `bf2318a`, `8fddd06` | see evidence below |

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
  later one (`log: 'B'`). v5 selects the same transitions but runs both
  `assign` actions in sequence, so no write is lost: probe `V5` in
  `synchronousProcessing.v5-probes.mjs` ends with `log: 'PBb'` (rerun during
  the series review).
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

**#38 (parallel completion and raised events).** Brief:
https://github.com/robertpenner/xstate/issues/38#issuecomment-7073017164.
Laws were written first, then the model and proofs. Checks on the
uncommitted tree that became `bf2318a` and `8fddd06` (the committed files
were compared byte for byte with the verified checkout):

- `pnpm verify:machine-model` on a detached checkout of `40f1622` plus the
  #38 changes: the first run failed with `Ambiguous mutation` (Potential bug
  13). After the two anchors were extended, the rerun exited 0, ending
  "Freshness, additions-only inventory, defects and refactor verified."
  Dafny reported 883 verified, 0 errors; all 87 model defects (18 new) were
  rejected.
- `pnpm test:machine-model:runtime-defects` (run alone): exit 0, 19 runtime
  defects rejected (2 new: a parallel node completing twice in one
  microstep, and a nested parallel region contributing no output).
- `pnpm test:machine-model`: 258 tests passed (16 files). After a type-only
  cast fix in `parallelCompletion.test.ts`, that file passed 9 of 9.
- `pnpm typecheck`, `pnpm lint`, `pnpm format:check`: exit 0.
- `pnpm test:core` ran with the final series verification below.

**Series review.** A code-review agent reviewed base `dbe2265` to head
`2ea8157` (22 files, 13 commits) against #23 and #34 to #38. It reported no
blockers, five should-fix findings, and seven notes. Resolutions:

- Stale README counts: updated to 223 laws, 27 contracts, 88 defects, and 887
  tasks (`f756e58`).
- The v5 claim for the lost eventless write contradicted bug 2: probe `V5`
  rerun against `xstate@5.33.4` ends with `log: 'PBb'`, so v5 keeps both
  writes. Corrected here and in `SYNCHRONOUS_PROCESSING.md` (`593cea4`).
- Incomplete #38 verification record: completed by the final verification
  below.
- `SYNCHRONOUS_PROCESSING.md` still said a parallel node completes once and
  that the adapters refuse every feature: qualified with bugs 17 and 18, and
  the adapter plan now reads as history (`593cea4`).
- The #38 brief's refusal of a region output object stored in context or
  passed to an effect was missing: `compareParallelRun` now refuses both, with
  a named test (`a9610da`). Machine output stays compared structurally,
  because the runtime allocates that object and structural comparison is
  sound for it; this departs from the brief's wording "or output".
- The brief's law "a parallel node completes at most once per microstep" had
  no whole-pass lemma: `FinalEnteredBookkeeping` and
  `ParallelEnterCompletesOnce` were written first, `ParallelEntered` now
  exposes `completed`, and the new defect "entry pass forgets earlier
  completions" is rejected (`313a59b`).
- Notes: the flat `SettleBudget` text, done-order citations, evidence labels
  on bugs 1, 4, 7, 11, 15, and 18, the v5 probes described as printing rather
  than asserting, bug 18's SCXML comparison (SCXML forbids `<final>` directly
  under `<parallel>`), refusals counted by reason in the parallel property
  test (seed 3838: 70 active-region targets and 11 unrepresentable raises of
  400 runs), and `Number.isSafeInteger` in `iterationBound`.

Checks on the uncommitted review fixes, compared byte for byte with the
committed files:

- `pnpm verify:machine-model` on a detached checkout of `2ea8157` plus the
  fixes: exit 0, ending "Freshness, additions-only inventory, defects and
  refactor verified." Dafny reported 887 verified, 0 errors; all 88 model
  defects and 11 proof-weakening probes were rejected.
- `pnpm test:machine-model:runtime-defects` (run alone): exit 0, 19 runtime
  defects rejected.

### Final verification

On `f756e58`, in the worktree:

- `pnpm build`, `pnpm typecheck`, `pnpm lint`, `pnpm format:check`: exit 0.
- `pnpm test:core`: 3352 passed, 28 skipped, 3 todo (206 files).
- `pnpm test:machine-model`: 259 passed (16 files).

Hosted CI on `d7b95b3`: `Node CI` run 45012402249, job `build` passed in
9m5s.

**Result:** #34 to #38 are integrated and verified on PR #39, which is ready
for review. The model proves 223 laws over 887 Dafny tasks and rejects 88
model defects and 19 runtime mutants. Two upstream reports were filed
(statelyai/xstate#5948, statelyai/xstate#5949); 18 potential bugs are listed
below. Bugs 11, 15, and 18 are runtime behaviors that have not been reported
upstream; bug 4 is deliberately not filed (decision 4).

### Potential bugs

Runtime behavior, tool quirks, and suspected defects found during the run.
Each entry says what was observed, where, and what happened to it.

1. **Parallel eventless and event selection differ** (runtime, v5 too).
   `selectEventlessTransitions` takes the first enabled `always` on each
   atomic state's ancestor chain, while `transitionNode` lets a region's
   handler hide the parallel ancestor's handler. Evidence: probe
   `[runtime][v5] selects eventless transitions per atomic state but events
region-first` and v5 probe `V5`. Filed as statelyai/xstate#5948.
2. **Simultaneous eventless patches lose a write** (runtime, v6 only). Two
   eventless transitions selected in one microstep both compute patches from
   the pre-step context, and the later one in document order wins. v5 runs
   `assign` actions in sequence. Included in statelyai/xstate#5948.
3. **Root `output` ignores exit-function context** (runtime, v5 too). Exit
   functions run after `getMachineOutput` at completion. Filed as
   statelyai/xstate#5949.
4. **An empty context patch from `always` loops forever** (runtime).
   `mergeContextPatch` returns a new object for `{}`, so the reselection rule
   sees a new snapshot. Evidence: probe `[runtime] loops on an eventless
callback that returns an empty context patch`. Not filed, by decision 4 in
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
   reselection. Inferred from reading `completeMacrostep`; no test exercises
   it. The adapter compares snapshot identity per macrostep only.
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
    takes `p.onDone`. Evidence: a scratch probe outside the repo; no committed
    test runs this machine. The model adapter refuses any transitions on final
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
    same count would catch it in seconds. It happened again in #38 in the
    other direction: the parallel settle loop repeats two lines that #37
    defects use as anchors ("compound completion keeps the queue" and
    "compound raised events processed last-in first-out"), so each anchor
    matched twice. The #38 screen applied the mutations without checking
    uniqueness, and the first full verify failed with `Ambiguous mutation`
    after 64 defects had already been rejected. Both anchors now include
    preceding lines that only the compound settle function contains.
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
    Evidence: `parallelCompletion.test.ts` test `loses the output of a nested
parallel region that completed earlier`. Not filed yet.
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
18. **An atomic final region counts as final before it is entered** (runtime,
    no SCXML counterpart). The runtime's `isInFinalState` treats an atomic node
    as final when its type is `final`, without checking that it is active. A
    parallel node `p` with atomic final regions `x` and `y` whose entries
    raise `RX` and `RY` queues `RX`, then `xstate.done.state.m.p`, then `RY`:
    the parallel's done event is queued while `y` is still being entered, and
    the done handler runs between the two raises (context log `|rx|done|ry`).
    SCXML has no equivalent case: a `<parallel>` element may not contain a
    `<final>` child, so its regions are always compound or parallel. The
    model mirrors the runtime (`FinalAtMeaning`). Evidence:
    `parallelCompletion.test.ts` test
    `queues the done event of atomic final regions between their entry raises`,
    which also rejects the runtime
    mutant `a parallel node completes more than once in one microstep`. Not
    filed yet.
