# XState parallel-subtree formalization

**Status:** active

**Branch:** `machine-formalization-parallel`

**Pull request:** not yet opened (base `machine-formalized`)

**Started:** 2026-11-11 10:25:15 UTC

**Goal:** Implement robertpenner/xstate#15 and then robertpenner/xstate#16
under the shared contract in robertpenner/xstate#14. Preserve production
behavior. Record behavior that looks unintended, with reproductions, and
distinguish observations from suspected defects.

**Execution:** sequential. #16 is blocked by #15.

**Baseline:** `47cfafb` (`origin/machine-formalized`, carrying upstream `next`
at `da64b0a`).

**Verified integration head:** `47cfafb` (baseline only).

## Workflow authorization

The user approved an XState-specific workflow for the previous run: a sibling
worktree, the fork's verification commands, and a draft PR. The user later
asked for formalization PRs to target the long-lived `machine-formalized`
branch. This run reuses the clean `xstate-machine-model` worktree on a new
branch. Penner's pooled workstream and PR-lifecycle scripts do not exist in
this fork. The `main`, `fsm-formalized`, and upstream-fix worktrees are not
touched.

## Ticket progress

| Issue | Outcome                                                      | Status      | Blocker                | Integration | Verification |
| ----- | ------------------------------------------------------------ | ----------- | ---------------------- | ----------- | ------------ |
| #15   | Parallel configurations and single-transition steps          | in progress | None                   | none        | none         |
| #16   | Multi-transition selection, conflict removal and composition | blocked     | #15 not yet integrated | none        | none         |

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

## Commits

None yet.
