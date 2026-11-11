# XState parallel-subtree formalization

**Status:** completed

**Branch:** `machine-formalization-parallel`

**Pull request:** robertpenner/xstate#17 (draft, base `machine-formalized`)

**Started:** 2026-11-11 10:25:15 UTC

**Goal:** Implement robertpenner/xstate#15 and then robertpenner/xstate#16
under the shared contract in robertpenner/xstate#14. Preserve production
behavior. Record behavior that looks unintended, with reproductions, and
distinguish observations from suspected defects.

**Execution:** sequential. #16 is blocked by #15.

**Baseline:** `47cfafb` (`origin/machine-formalized`, carrying upstream `next`
at `da64b0a`).

**Verified integration head:** `93829d7` (#16 plus final-review fixes).

## Workflow authorization

The user approved an XState-specific workflow for the previous run: a sibling
worktree, the fork's verification commands, and a draft PR. The user later
asked for formalization PRs to target the long-lived `machine-formalized`
branch. This run reuses the clean `xstate-machine-model` worktree on a new
branch. Penner's pooled workstream and PR-lifecycle scripts do not exist in
this fork. The `main`, `fsm-formalized`, and upstream-fix worktrees are not
touched.

## Ticket progress

| Issue | Outcome                                                      | Status              | Blocker | Integration | Verification     |
| ----- | ------------------------------------------------------------ | ------------------- | ------- | ----------- | ---------------- |
| #15   | Parallel configurations and single-transition steps          | integrated/verified | None    | `d3968eb`   | see #15 evidence |
| #16   | Multi-transition selection, conflict removal and composition | integrated/verified | None    | `5ec20b1`   | see #16 evidence |

## Verification evidence

### Baseline at `47cfafb`

LemmaScript 0.6.6 at `/tmp/lemmascript/node_modules/lemmascript/tools/dist/lsc.js`;
Dafny 4.11.0.

- `pnpm install --frozen-lockfile`, `pnpm build`, `pnpm postinstall`: passed.
- `pnpm test:machine-model`: 6 files, 83 tests passed.
- `pnpm verify:machine-model`: passed; all 11 proof weakenings and 13 seeded
  model defects rejected.
- `pnpm test:machine-model:runtime-defects`: all three runtime mutations
  rejected; production source restored.

These results re-verify the existing flat and compound suites against runtime
`da64b0a`.

## Briefs

- #15: <https://github.com/robertpenner/xstate/issues/15#issuecomment-6793589017>
- #16: <https://github.com/robertpenner/xstate/issues/16#issuecomment-6795766891>

### #15 proof and differential evidence (`eeed21f`..`d3968eb`)

- `dafny verify --verification-time-limit 15 --cores 2 formal/machineModel.dfy`:
  388 verified, 0 errors.
- `pnpm test:machine-model`: 8 files, 99 tests passed.
- `pnpm typecheck`, `pnpm lint`, `pnpm format:check`: passed.
- First driver runs: the baseline proved, but the seeded defect "cross-region
  transition exits the source region" produced only timeouts in `DomainActive`
  and `CrossDomain`, which the driver treats as a tool failure. `CrossDomain`
  now hides every definition except `transitionDomain` and `narrow`; under
  that defect it fails with "a postcondition could not be proved". The
  `DomainActive` timeout remains under that defect, but it does not affect
  the baseline, where `DomainActive` takes about 1 s.
- `pnpm verify:machine-model` (after that change): 388 verified, 0 errors;
  all 11 proof weakenings and all 17 seeded defects rejected; freshness and
  refactor checks passed.
- `pnpm test:machine-model:runtime-defects`: all five runtime mutations
  rejected, including the two new parallel mutations; production source
  restored.

### #16 proof and differential evidence (`636d804`..`5ec20b1`)

- `dafny verify --verification-time-limit 15 --cores 4 formal/machineModel.dfy`
  (no `--allow-warnings`): 454 verified, 0 errors.
- Each new seeded defect was first applied to the `.dfy` directly. Four failed
  with postcondition or assertion errors. "Parallel step keeps exited nodes"
  timed out in `MultiStepMembers`; that lemma now hides every definition
  except `parallelStep`, `Combined` and `ParallelWellFormed`, and fails under
  the defect with "assertion might not hold".
- First driver run: the baseline proved, but Dafny warned about the
  indentation of an `exists` in `Greedy`, and the driver does not allow
  warnings. Parenthesized.
- Second driver run: the existing defect "reverses lifecycle callback
  effects" was ambiguous because `applyAll` (added in `636d804`) repeats its
  `effects: [...first.effects, ...rest.effects]` anchor. The anchor now
  includes the preceding `lifecycle(...)` line.
- Third driver run: "ancestor preempts descendant" produced a LemmaScript
  three-way merge conflict, which the driver counts as a tool failure. The
  line-based merge aligned the mutated `preempts` line with the
  `ChildrenActive` body inside the #15 proof block, which sat between the #15
  and #16 generated declarations. The #15 proof block now follows the #16
  generated code, so all generated declarations form one contiguous prefix.
  All 22 defects then regenerated without conflicts in temporary copies.
- `pnpm verify:machine-model` (final): 454 verified, 0 errors; all 11 proof
  weakenings and all 22 seeded defects rejected; freshness, additions-only
  inventory and refactor checks passed.
- `pnpm test:machine-model:runtime-defects`: all seven runtime mutations
  rejected, including "a later conflicting transition preempts an earlier
  one" and "kept transition patches merge in reverse order"; production source
  restored and `packages/core/src` clean.
- `pnpm test:machine-model`: 8 files, 112 tests passed.
- Parallel property statistics (seed 8912, 500 runs): 329 machines with a
  parallel node, 2175 compared steps, 445 steps with two or more selections,
  83 steps where conflict removal dropped a selection; refusals 107 active
  region target, 28 targetless reentry, 4 comparable domains.
- `pnpm typecheck`, `pnpm lint`, `pnpm format:check`: passed.

## Final series review

Base `47cfafb` (`origin/machine-formalized`), head `d31954f`, 12 changed
files. The `code-review` skill ran three `review-axis` children over
materialized artifacts: Standards, Spec (the #14 contract, the #15 and #16
bodies and newest briefs), and Ideas and evidence. No finding changed the
model, proofs or manifest. Resolutions are in `f2adfc4` (tests) and `93829d7`
(README), plus this log.

Resolved findings:

- The README listed two runtime reproductions; `runtimeFindings.test.ts` has
  four. The README now lists all four, and behavior entry 7 records the
  statelyai/xstate#5895 characterization.
- The orphaned-leaf test asserted that an unused spy was never called. It now
  logs entry and exit callbacks and pins the observed order; behavior entry 4
  now matches the test's names (`a1`, event `E`).
- The README described the active-region refusal as non-reentering only. The
  code refuses both; the README says so, and a test checks the reentering
  case and the exact statelyai/xstate#5895 machine through the adapter.
- The brief's separate #5895-pattern refusal is subsumed by the
  comparable-domains refusal. The README and behavior entry 5 give the
  informal argument and the valid runtime case it also refuses.
- The README's validity claims omitted the well-formed-machine,
  valid-configuration and `parallelStepReady` preconditions; they are now
  stated.
- The SCXML comparison omitted SCXML's conflict-removal pass. The README now
  cites Appendix D and limits the visible difference to non-overlapping exit
  sets. Behavior entry 1 now names SCXML internal transitions.
- Behavior entry 3 cited no losing transition. A probe with two regions both
  leaving the parallel node recorded `A saw 0, B saw 0`, kept `A`'s result,
  and is recorded in the entry.
- Missing #15 named cases now exist: a reentering compound ancestor into a
  region, and the parallel node targeting itself with and without `reenter`.
  The non-reentering self-target resets both regions without exiting the
  parallel node; model and runtime agree.
- The property generator gave every leaf the same depth. Nodes below the root
  can now stop early; at seed 8912, 87 machines had parallel regions of
  different heights. README statistics were re-measured and now say they are
  printed, not asserted, and count only traces that ran to completion.
- Refusal tests now assert the specific messages; the nested-parallel test
  name includes the parallel-initial case.
- The README notes that `ParallelWellFormed` does not require `order` to be
  a preorder, and labels the pre-step-context and reentry-half claims as
  following from definitions instead of named laws.

Accepted without change:

- Duplicated readiness checks between `parallelReady` and `selectionReady`,
  adapter duplication, the `ParallelPlan.active` name, `exiting` parameter
  shadowing, recomputed `kept` in `parallelAdapter`, and the unreachable
  `?? 'single'` fallback. Changing model code would require re-proving
  unchanged laws for no behavior change.
- Optional stronger laws (`Subseq(kept, selections)`,
  `sourcesApart ⇒ NoDescendantSources`, a fuller `ReenterWidens`) are left for
  a later ticket.

No actionable findings remain.

## Behavior log

Entries record runtime behavior observed at `da64b0a` that looks unintended or
that contradicts a ticket. Each entry gives a classification and evidence.

1. **Compound ancestor into one region resets every region (documentation
   ambiguity, not a suspected bug).** From `a > p(parallel) > {r1, r2}`, a
   transition on `a` targeting `#r2y` exits and re-enters `p` and both
   regions. The same target from `p` exits only `r2x` and enters `r2y`.
   `narrowParallelDomain` narrows only while the domain is a parallel node,
   so the result matches SCXML's domain for an internal transition from a
   compound source (SCXML 1.0 Appendix D, `getTransitionDomain`); XState's
   non-reentering transition corresponds to SCXML `type="internal"`. The
   `parallel-regions-scoped` changeset says "a transition targeting a state
   inside one region no longer exits and resets sibling regions" without
   restricting the source. Its example uses a source on the parallel node.
   #15 assumed narrowing for ancestors too; the brief corrects that.
2. **Region-first ancestor fallback (implemented by `transitionNode`; differs
   from SCXML).** When any region selects a transition, the parallel node and
   its ancestors are not consulted, even for regions that declined. SCXML
   lets each atomic state fall back to its own ancestors independently, then
   resolves conflicts. With one parallel node, two selected transitions
   always come from different regions, so neither source is an ancestor of
   the other. #16's "descendant source wins" rule cannot fire in that domain.
3. **Callbacks of losing transitions run (observation).** Every selected
   transition's callback runs during selection against the pre-step context,
   before conflict removal. A transition that later loses has already run its
   callback; only its returned patch and effects are discarded. Probe during
   the final review: regions `A` and `B` of root-level child `P` both handle
   `E` with callbacks that record the `count` they see and return
   `{ target: '#m.X', context: { count: 10 } }` and
   `{ target: '#m.Y', context: { count: 20 } }`. Both exit `P`, so conflict
   removal keeps `A`'s. The runtime recorded `A saw 0, B saw 0` and ended in
   `X` with `count: 10`. The model does not represent invocation counts, so
   no committed test checks this.
4. **Targetless reentry plus a parallel-node reentry leaves an orphaned leaf
   (suspected runtime bug).** Region `A` sits in `a1`, which handles `E`
   with a targetless `reenter: true`; region `B` handles `E` with
   `{ target: '#m.P', reenter: true }`. The exit sets do not overlap (the
   targetless one is empty), so both are kept. The runtime logged
   `exit B, exit a1, exit A, exit P, enter P, enter a1, enter B` and ended with
   active ids `m, m.P, m.P.A.a1, m.P.B`: region `A` exits and is never
   re-entered, while its leaf `a1` is. Targetless reentry also has the
   entry-without-exit behavior in statelyai/xstate#5897; I did not trace how
   the runtime chooses region entries when both transitions are kept. The
   reproduction is "targetless reentry beside a parallel-node reentry leaves a
   leaf without its region" in `runtimeFindings.test.ts`. The #16 model
   refuses a targetless reentry in any multi-selection step.

5. **Comparable-domain refusal covers the statelyai/xstate#5895 pattern
   (model limitation, not a runtime finding).** The #16 brief listed the
   #5895 pattern (two kept transitions with disjoint exit sets, where one
   exit set contains the other's target or an ancestor of it) as its own
   refusal. The adapter has no separate check. If transition 2's target, or
   an ancestor of it, lies in transition 1's exit set, it lies strictly below
   domain 1; domain 2 is an ancestor of that target, so both domains lie on
   the target's path and are comparable. `domainsApart` therefore refuses
   every instance. This argument is informal, not a proved law. Some refused
   instances are valid in the runtime: an atomic self-target in one region
   (domain is the atomic node itself, so it is neither exited nor entered)
   kept alongside a region transition that exits the parallel node yields a
   valid configuration. The validity proof needs pairwise incomparable
   domains; a later extension could prove the union case.
6. **LemmaScript regen merge can misalign short generated bodies (tooling).**
   When proof text separates two generated sections, `lsc regen`'s
   three-way merge can match a changed one-line body against unrelated proof
   lines with the same surrounding braces and report a conflict. Keeping
   generated declarations contiguous avoids it. Not reported upstream.

7. **Cross-region transition plus an exit from the parallel node
   (suspected runtime bug, statelyai/xstate#5895).** Region `A`'s `a1`
   targets region `#m.P.B` while atomic region `B` targets `#m.X`. The
   cross-region domain narrows to `B`, so it exits nothing; the exit sets are
   disjoint and both transitions are kept. The runtime logged
   `exit B, exit a1, exit A, exit P, enter B, enter X` and ended with active
   ids `m, m.P.B, m.X`: region `B` is active without its parent `P`. The
   reproduction is "cross-region transition and an exit from the parallel
   node are both taken" in `runtimeFindings.test.ts`. The adapter refuses
   this machine at the active-region target.

## Commits

- `0b40291` chore(machine-model): start parallel formalization run log
- `c0aad13` chore(machine-model): checkpoint parallel model and adapter
  (unverified checkpoint; superseded by the commits below)
- `eeed21f` feat(machine-model): prove single-parallel machine laws
- `9fda475` test(machine-model): add parallel runtime mutations and
  array-target refusal
- `d3968eb` docs(machine-model): document the single-parallel model
- `cc9d371` chore(machine-model): record #15 integration in run log
- `0d878d3` chore(machine-model): record #16 brief and runtime findings
- `636d804` chore(machine-model): checkpoint multi-transition parallel steps
  (unverified checkpoint; verified by the commits below)
- `e9042e7` feat(machine-model): prove multi-transition parallel laws
- `452bc52` test(machine-model): add multi-transition runtime mutations
- `5ec20b1` docs(machine-model): document multi-transition parallel steps
- `d31954f` chore(machine-model): record #16 integration in run log
- `f2adfc4` test(machine-model): add review-requested parallel cases
- `93829d7` docs(machine-model): correct parallel claims from series review

## Final verification at `93829d7`

- `pnpm test:machine-model`: 8 files, 116 tests passed.
- `pnpm verify:machine-model` (last run at `5ec20b1`; the `.dfy`, manifest
  and `machineModel.ts` are unchanged since): 454 verified, 0 errors; 11 proof
  weakenings and 22 seeded defects rejected.
- `pnpm test:machine-model:runtime-defects`: 7 mutations rejected; source
  restored.
- `pnpm typecheck`, `pnpm lint`, `pnpm format:check`, `pnpm build`: passed.
- `pnpm test:core`: 189 files; 3062 passed, 29 skipped, 3 todo.
- No pre-existing failures were observed.

## Result

#15 and #16 are integrated and verified on robertpenner/xstate#17. The model
covers machines with at most one parallel node, single- and multi-transition
steps with faithful conflict removal, 135 Dafny laws (454 verified
obligations), 22 rejected seeded defects, and 7 rejected runtime mutations.
The run characterized two new suspected runtime bugs (behavior entries 4 and
7, the latter filed as statelyai/xstate#5895) and one documentation
ambiguity (entry 1). Issues stay open until the PR merges.

**Duration:** 3 h 35 min 0 s (final run-log commit at 2026-11-11T09:00:15-05:00 minus Started)
