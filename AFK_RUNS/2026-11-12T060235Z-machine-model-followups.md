# AFK Run: machine-model follow-ups

**Status:** completed

**Branch:** `machine-model-followups-19-21`

**Pull request:** <https://github.com/robertpenner/xstate/pull/22>
(base `machine-formalized`).

**Started:** 2026-11-12 06:02:35 UTC

**Goal:** Stop timed-out verification descendants, extend validity to nested kept
domains, and settle the comparable-domain refusal converse for
robertpenner/xstate#19, robertpenner/xstate#20, and robertpenner/xstate#21.

**Execution:** sequential.

**Verified integration head:** `656c070` (all issue outcomes and review improvement).

### Slice progress

| Issue                  | Slice                       | Status              | Blocked by / reason | Integration commit | Verification                         |
| ---------------------- | --------------------------- | ------------------- | ------------------- | ------------------ | ------------------------------------ |
| robertpenner/xstate#19 | Process-tree cleanup        | integrated/verified |                     | `ed94c63`          | See process-runner evidence          |
| robertpenner/xstate#20 | Nested kept-domain validity | integrated/verified |                     | `587ddcd`          | See nested-domain evidence           |
| robertpenner/xstate#21 | Refusal converse            | integrated/verified |                     | `976c4a3`          | No comparable-domain refusal remains |

### Verification evidence

- Baseline `f5ae474`: `pnpm test:tooling` passed, 13 tests.
- Runtime reference remains `da64b0a`. Upstream statelyai/xstate#5898 and
  statelyai/xstate#5899 were both open when checked.

### Process-runner checks (changes on `f5ae474`)

Authoritative brief:
<https://github.com/robertpenner/xstate/issues/19#issuecomment-6816069518>.

- `pnpm test:tooling`: 20 tests passed, including 7 process-runner tests.
- `pnpm test:machine-model:runtime-defects`: 7 mutations rejected, original
  production source restored.
- `pnpm test:core`: 189 files passed, 3062 tests passed, 29 skipped, 3 todo.
- `pnpm build`, `pnpm typecheck`, `pnpm lint`, `pnpm format:check`: passed.
- Prettier formatting and explicit Markdown checks passed for the changed README
  and this run log.
- A real driver run with `MACHINE_MODEL_VERIFY_TIMEOUT_MS=8000` failed during
  `lsc check` with the command and 8000 ms in its diagnostic. Observed driver
  PID 59107, version-check Dafny PID 59130, proof Dafny PID 60866, and Z3 PID
  64472 were all stopped when the driver returned. The probe also tracked its
  Node descendants; none remained running.
- The initial tooling integration run exposed load-sensitive fixture startup:
  a Node fixture did not start before its 500 ms deadline and a normal Node
  command exceeded its 2000 ms test deadline. The timeout fixture now uses a
  shell child with a TERM-resistant `sleep` grandchild, a 1000 ms limit, and a
  longer allowance for successful Node startup. The complete tooling rerun
  passed all 20 tests in 4745.430916 ms.
- The installed working-copy translator reports 0.6.8. The required, missing
  LemmaScript 0.6.6 was installed separately in this run's scratch directory;
  Dafny reports 4.11.0. Repository dependencies and tool pins were not changed.
- Full `pnpm verify:machine-model` passed: 462 verified, 0 errors, all 22
  seeded defects and 11 proof weakenings rejected; freshness and the
  behavior-preserving refactor passed. Evidence: `verify-19.log`.

### Nested-domain checks (changes on `ed94c63`)

Authoritative brief:
<https://github.com/robertpenner/xstate/issues/20#issuecomment-6816447019>.

- Removed only the incomparable-kept-domain readiness restriction. The adapter,
  comparisons, coverage assertion, generated proof, handwritten proof, inventory,
  and README describe the resulting accepted domain.
- The atomic-self-target/ancestor-exit comparison first failed with the old
  comparable-domain refusal. Both selection orders now compare configuration,
  context, and ordered effects, retaining both kept results.
- `pnpm test:machine-model`: 8 files, 117 tests passed. Seed 8912, 500 generated
  machines: 284 parallel machines, 87 mixed-region-height machines, 2131 compared
  steps in completed traces, 315 multi-selection steps, 38 conflict-removal steps,
  and 3 strictly nested kept-domain steps. There were 143 refused traces:
  114 active-region targets and 29 targetless reentries.
- `pnpm verify:machine-model`: 474 verified, 0 errors; 148 laws, 22 contracts,
  all 23 seeded defects and 11 proof weakenings rejected, freshness and the
  behavior-preserving refactor passed. Evidence: `verify-20.log`.
- The new nested-domain defect fails the independently stated
  `MultiStepMembers` equality; a standalone probe confirmed an assertion failure.
- `pnpm test:tooling`: 20 tests passed.
- `pnpm test:core`: 189 files, 3063 tests passed, 29 skipped, 3 todo.
- `pnpm build`, `pnpm typecheck`, `pnpm lint`, `pnpm format:check`: passed.
  Existing module-type warnings during lint did not fail the check.
- `pnpm test:machine-model:runtime-defects`: all 7 mutations rejected in a clean
  sequential rerun after stopping watchers and completing the other checks.
  Source restoration and the empty production diff against `da64b0a` passed.
- Explicit Prettier formatting/checks cover the README and run log.
- Removed only the task-generated `machineModel.dfy.base` translator scratch
  file. No production changes or unproved assumptions were introduced.

### Refusal-converse outcome

Authoritative brief:
<https://github.com/robertpenner/xstate/issues/21#issuecomment-6817039235>.

Prerequisite robertpenner/xstate#20 is integrated and published as `587ddcd`.
The issue's "nothing left to prove" outcome applies: `multiReady` and the
adapter no longer refuse comparable domains. The README removes the converse
and comparable-domain refusal count and accounts for statelyai/xstate#5895
through the active-region-target refusal. The retained pattern laws describe
geometry only. No new law or counterexample is needed.

This documentation-only outcome reuses the exact model/proof source verified
for `587ddcd`; no executable file changes follow that verification. The issue
remains open until the series PR merges.

### Recovery

Not resumed. User corrected the repository from `robertpenner/state` to
`robertpenner/xstate` and explicitly approved a dedicated sibling worktree,
branching from and targeting `machine-formalized`, using this repository's
verification commands. Penner's pooled-slot and lifecycle scripts do not exist
in XState. Worktree:
`/Users/robertpenner/git/robertpenner/xstate-machine-model-followups`.

No separate coding standards, glossary, scoped agent instructions, or rejected
requests were found in the worktree. The inherited XState `AGENTS.md` applies.
The installed repository-pinned pnpm reports 11.8.0.

Temporary verification evidence:
`/Users/robertpenner/git/penner-agent-scratch/branch-xstate-afk-19-21/run-F2trAD5Q`.

### Potential bugs and diagnosis

The user requested v6/v5/SCXML diagnosis and checking existing upstream reports
before recording findings. Queried all issues authored by `robertpenner` in
`statelyai/xstate`, then read the relevant bodies and every comment. These are
already reported, so the log keeps their canonical references without repeating
their reproductions or diagnoses:

| Existing report                                                                                                           | Scope                                                                                 | Status when checked                             |
| ------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- | ----------------------------------------------- |
| [statelyai/xstate#5895](https://github.com/statelyai/xstate/issues/5895)                                                  | Cross-region conflicts, including the smaller repeated-region-entry case              | Open; fix statelyai/xstate#5899 open            |
| [statelyai/xstate#5896](https://github.com/statelyai/xstate/issues/5896)                                                  | Root lifecycle shared by v5 and v6; includes the SCXML wrapper qualification          | Open; asks for intended semantics               |
| [statelyai/xstate#5897](https://github.com/statelyai/xstate/issues/5897)                                                  | Targetless reentry                                                                    | Open; fix statelyai/xstate#5898 open            |
| [Orphaned-leaf comment on statelyai/xstate#5897](https://github.com/statelyai/xstate/issues/5897#issuecomment-6806469021) | Parallel-region omission, its cause, and regression coverage in statelyai/xstate#5898 | Already covered by the same upstream report/fix |
| [statelyai/xstate#5901](https://github.com/statelyai/xstate/issues/5901)                                                  | Timer/eventless ordering                                                              | Open; outside this run                          |

The orphaned-leaf case was initially listed separately for investigation. The
upstream comment establishes that it is already reported and tested in the fix;
it is not a new finding from this run. No duplicate upstream issue or comment was
created. Closed FSM reports and the older missing-initial-state report do not
overlap the current machine-model work.

The v6 reference is `da64b0a`; `git diff da64b0a -- packages/core/src` is empty.
The isolated npm v5 reference is 5.33.4, whose upstream tag resolves to `bd77717`.
Nine minimized cross-version probes passed. Seven rechecked the reports above
and their controls, with no new discrepancy to add to them. The other two
compare the newly accepted atomic-self-target/ancestor-exit step in both
selection orders: v5 and v6 agree in active nodes, context, and ordered effects.
This confirms the model over-refusal addressed by robertpenner/xstate#20.

Evidence: `compare-versions.mjs` and `version-comparison.jsonl` in the scratch
directory. They use version-correct pure transition APIs. The probe's first
attempt used v5's second `createMachine` argument on v6 and received E71; that
was a fixture error and was corrected before the successful comparisons.

**New v6 runtime bugs discovered in this run:** none so far. The verification
process defect belongs to robertpenner/xstate#19; the accepted-domain defect
belongs to the model in robertpenner/xstate#20. Production behavior is unchanged.

#### SCXML interpretation relevant to the new accepted domain

Primary sources:

- [SCXML 3.11](https://www.w3.org/TR/2015/REC-scxml-20150901/#LegalStateConfigurations)
  and [3.13](https://www.w3.org/TR/2015/REC-scxml-20150901/#SelectingTransitions)
  are normative. Their ancestry, exit/entry, and conflict definitions were
  checked alongside the upstream reports.
- [SCXML 3.5, default transition type](https://www.w3.org/TR/2015/REC-scxml-20150901/#transition)
  is external. An atomic explicit self-target exits/reenters that state even
  when marked internal, because its source is not compound. XState's default
  non-reentering self-target is therefore not a literal SCXML self-transition.
  A targetless SCXML transition is the lifecycle-free analogue for the newly
  accepted XState step. An explicit self-target beside an ancestor exit would
  conflict under literal SCXML semantics.
- [SCXML Appendix D](https://www.w3.org/TR/2015/REC-scxml-20150901/#AlgorithmforSCXMLInterpretation)
  is informative. Its `getTransitionDomain`/`findLCCA` algorithm agrees with
  the normative compound-ancestor definition. V5's general least-common-ancestor
  implementation can choose a parallel domain, so v5 is a comparison reference,
  not a substitute for the SCXML rules.
- [V6 source at `da64b0a`](https://github.com/robertpenner/xstate/blob/da64b0a/packages/core/src/stateUtils.ts)
  and [v5 source at `bd77717`](https://github.com/statelyai/xstate/blob/bd77717/packages/core/src/stateUtils.ts).

No SCXML processor was executed. These SCXML conclusions follow from the cited
normative definitions and the explicit mappings above. The existing root report
owns its wrapper/targetability qualification.

### Publication at stop or handoff

**Published code/test head at AFK completion:** `656c070`; final AFK documentation
commit `d198d61`. Its final PR-check result is recorded in the parent-issue summary
after readiness. Later review repairs are recorded separately below.

**Unverified checkpoint:** none.

**Remaining local work:** none after publishing this final log commit. Staged,
unstaged, untracked, and remote-head checks are required immediately after push.

### Final series review

**Base/head:** `f5ae474` / `976c4a3`, 15 changed files, no uncommitted snapshot.

**Contracts:** issue bodies and refreshed briefs for robertpenner/xstate#19,
robertpenner/xstate#20, and robertpenner/xstate#21; parent
robertpenner/xstate#14; XState `AGENTS.md`.

**Evidence:** Fixed-revision patch, full changed files, unchanged definitions,
issue bodies/comments, fresh briefs, standards, primary sources, and measured
checks were materialized under `review/` in the scratch directory. The separate
review context read the provenance and reviewed Standards, Spec, and Ideas and
evidence. Its report is `review/review-result.txt`.

**Findings:** zero confirmed defects and zero material unresolved questions on
each axis. The reviewer challenged equal/root/atomic domains, moving-plan
overlap, retained patch/effect application, process-group cleanup ordering,
SCXML mappings, and upstream-report novelty. The coordinator checked the new
proof argument and the cited cleanup code against the pinned artifacts.

One optional improvement was implemented: SIGINT and SIGTERM fixtures now check
the tracked child and grandchild inside caller `finally`, before the restoration
marker. This directly observes cleanup order. `pnpm test:tooling` passed all
20 tests; `pnpm lint` and `pnpm format:check` passed. The coordinator reviewed
this test-only correction against the finding. Model/proof and compiled-package
sources are unchanged from `587ddcd`, so their recorded checks remain applicable.

**Review limitations:** Read-only source review; execution evidence was supplied,
not independently rerun. Local process tests ran on macOS and cover descendants
that remain in the process group. No claim covers deliberate session/group
escape. Formal proofs concern the translated model; differential evidence is
sampled. No SCXML processor or proposed upstream fix was executed.

**Remaining blockers:** none in implementation or review. The final PR-check
result is reported after the ready transition in the parent-issue summary.

**Completed:** 2026-11-12 07:15:11 UTC.

**Duration:** 1 hour, 12 minutes, 36 seconds (4356 seconds), measured as
`d198d61`'s committer timestamp minus the start timestamp.

**Final verification:** `pnpm verify:machine-model` passed 474 obligations,
all 23 model defects and 11 proof weakenings; `pnpm test:core` passed 3063
tests; `pnpm test:machine-model` passed 117 tests; the sequential
`pnpm test:machine-model:runtime-defects` rejected all 7 mutations.
Build and typecheck passed on the unchanged model/package code at `587ddcd`.
After the review's test-only improvement, `pnpm test:tooling` passed all 20 tests,
and lint and full formatting checks passed. Explicit changed-Markdown checks
passed before the final documentation commit. No required local check failed.

**Result:** robertpenner/xstate#19, robertpenner/xstate#20, and
robertpenner/xstate#21 are integrated and verified in the series PR. Independent
review found no confirmed defect or material unresolved question; its optional
test improvement is implemented. Issues remain open until merge. The run log
links existing upstream reports instead of duplicating their diagnoses; no new
v6 runtime bug or production behavior change is claimed.

**Pre-existing unrelated failure(s):** none observed.

### Fresh Opus review follow-up (2026-11-12)

The user requested a new Opus context, a PR review comment, and repairs. Claude
Opus 5.5 reviewed `f5ae474...d198d61` across Standards, Spec, and Ideas and
evidence. The [published review](https://github.com/robertpenner/xstate/pull/22#pullrequestreview-5871125363)
records the findings and their validation. The pinned 15-file change, fresh issue bodies/briefs, primary sources,
and results are under
`/Users/robertpenner/git/penner-agent-scratch/pr-22/run-OAXJNmKu`.
The source review raised hypotheses; coordinator probes established:

- **SIGHUP cleanup:** the driver died by signal before caller cleanup. The
  regression failed with a null status instead of 129. SIGHUP now uses the same
  group-cleanup path as SIGINT/SIGTERM.
- **CLI interruption status:** after wiring SIGHUP cleanup, six actual-driver regressions returned 1 instead
  of 130/143/129. The drivers now report failures after their `finally` cleanup
  and preserve the interruption status. Runtime fixtures mutate isolated source
  and check exact restoration.
- **Failed spawn:** exhausting descriptors in an isolated Node 24 subprocess
  aborted during signal-watcher setup. A failed spawn now rejects with its
  original EMFILE before allocating deadlines or signal handlers; listener counts
  remain unchanged.

The Linux question was resolved from the original clean-head CI job log:
Ubuntu 26.04 ran `pnpm test:tooling`, with 20 passes including SIGINT/SIGTERM.
The README now describes readiness without asserting an accepted equal-domain
example and documents the SIGKILL/session-escape limitation. Closing keywords do
not close issues when the PR targets a non-default branch; issues remain open
under the default-branch merge policy.

These are verification-tool findings. No new v6 runtime issue was found, and
v5/SCXML semantics do not govern these process-control failures. The existing
upstream-report index remains authoritative without duplicate diagnoses.

**Follow-up verification:** watched process regressions passed all 15 tests;
the complete tooling suite passed 28 tests. All seven runtime mutations were
rejected and production source was restored exactly. Build, typecheck, lint,
and formatting passed.

The first full proof attempt hit the baseline translator command's 180000 ms
wall-clock limit after rejecting all 11 proof weakenings. No Dafny semantic
error was returned. The concurrent core run passed 3055 tests but failed the
parallel property test's 4000 ms interruption budget after 376 cases (seed 8912),
three declaration hooks' 60000 ms budgets, and a worker RPC timeout. It returned
no property counterexample. These were time-limit failures, with no established
runtime defect. Both affected core
files passed alone (21 tests); the parallel property completed in 214 ms.
The subsequent `pnpm test:core --maxWorkers=1` passed all 189 files and 3063
tests in 365.61 seconds, with unchanged test budgets. No core source or test was
changed for these reruns. This establishes that the first timing failures do
not reproduce in the serialized run; it does not identify their precise cause.
The next complete proof run used the documented finite
`MACHINE_MODEL_VERIFY_TIMEOUT_MS=600000` override without concurrent core or
build commands. Its baseline passed 474 obligations with zero errors, and all
23 model mutations and 11 proof weakenings were rejected. The final regenerated
refactor passed 473 obligations but `PlanFromFacts` reached the unchanged
15-second per-lemma limit. Dafny reported zero semantic errors and one timeout.
The formal inputs are unchanged from `d198d61`.

A further complete serialized run with the same 600000 ms command limit and
15-second per-lemma limit passed: 474 verified, zero errors; all 23 model
mutations and 11 proof weakenings rejected; freshness, additions-only inventory,
and regenerated refactor verified. No model, generated proof, handwritten proof,
manifest, or production source changed to obtain this result. The failed
attempts above remain part of the verification record.

The repair commit belongs to the existing PR branch. Publication, final
clean-checkout CI, and the disposition of the review are recorded on
[robertpenner/xstate#22](https://github.com/robertpenner/xstate/pull/22).
