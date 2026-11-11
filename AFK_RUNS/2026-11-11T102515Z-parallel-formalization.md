# XState parallel-subtree formalization

**Status:** active

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

**Verified integration head:** `5ec20b1` (#16).

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

## Behavior log

Entries record runtime behavior observed at `da64b0a` that looks unintended or
that contradicts a ticket. Each entry gives a classification and evidence.

1. **Compound ancestor into one region resets every region (documentation
   ambiguity, not a suspected bug).** From `a > p(parallel) > {r1, r2}`, a
   transition on `a` targeting `#r2y` exits and re-enters `p` and both
   regions. The same target from `p` exits only `r2x` and enters `r2y`.
   `narrowParallelDomain` narrows only while the domain is a parallel node,
   so the result matches SCXML's domain for a compound source. The
   `parallel-regions-scoped` changeset says "a transition targeting a state
   inside one region no longer exits and resets sibling regions" without
   restricting the source. Its example uses a source on the parallel node.
   #15 assumed narrowing for ancestors too; the brief corrects that.
2. **Region-first ancestor fallback (intended per `transitionNode`; differs
   from SCXML).** When any region selects a transition, the parallel node and
   its ancestors are not consulted, even for regions that declined. SCXML
   lets each atomic state fall back to its own ancestors independently, then
   resolves conflicts. With one parallel node, two selected transitions
   always come from different regions, so neither source is an ancestor of
   the other. #16's "descendant source wins" rule cannot fire in that domain.
3. **Callbacks of losing transitions run (observation).** Every selected
   transition's callback runs during selection against the pre-step context,
   before conflict removal. A transition that later loses has already run its
   callback; only its returned patch and effects are discarded. Two regions
   patching `count` to 10 and 20 from `count: 0` both saw `0`, and the step
   ended with `count: 20`.
4. **Targetless reentry plus a parallel-node reentry leaves an orphaned leaf
   (suspected runtime bug).** Region `A` sits in `a2`, which handles `go`
   with a targetless `reenter: true`; region `B` handles `go` with
   `{ target: '#m.P', reenter: true }`. The exit sets do not overlap (the
   targetless one is empty), so both are kept. The runtime logged
   `exit B, exit a2, exit A, exit P, enter P, enter a2, enter B` and ended with
   active ids `m, m.P, m.P.A.a2, m.P.B`: `a2` is active while its region `A`
   is not. The targetless reentry adds `a2` to the entry set without an exit
   (statelyai/xstate#5897), and nothing re-enters `A`. The #16 model refuses a
   targetless reentry in any multi-selection step.

5. **Comparable-domain refusal is conservative (model limitation, not a
   runtime finding).** An atomic self-target in one region kept alongside a
   region transition that exits the parallel node has comparable domains,
   so the model refuses it. The runtime produces a valid configuration for
   that step. The validity proof needs pairwise incomparable domains; a
   later extension could prove the union case.
6. **LemmaScript regen merge can misalign short generated bodies (tooling).**
   When proof text separates two generated sections, `lsc regen`'s
   three-way merge can match a changed one-line body against unrelated proof
   lines with the same surrounding braces and report a conflict. Keeping
   generated declarations contiguous avoids it. Not reported upstream.

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
