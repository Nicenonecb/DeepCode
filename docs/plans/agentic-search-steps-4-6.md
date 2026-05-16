---
title: Agentic Search Steps 4-6
status: completed
created: 2026-05-16
---

# Agentic Search Steps 4-6

## Summary

Complete the remaining Agentic Search production path after the existing planner,
WebSearch/WebFetch executor, and source runner work. The implementation will add
structured evidence extraction and cross-checking, produce a citation-ready RAG
pack for Query/Agent integration surfaces, and extend metrics plus benchmark
fixtures so Agentic Search can be compared against regular RAG.

## Requirements

- STEP 4: Extract claims, source dates, source types, citation snippets, and
  conflict groups from WebFetch/source runner evidence.
- STEP 4: Candidate answers must be able to distinguish primary-source support
  from independent cross-check evidence.
- STEP 5: Compress extracted evidence into a citation-ready evidence pack.
- STEP 5: Expose pack metadata for ContextPacker, Query loop, and agent task
  metadata without prematurely wiring every runtime call site.
- STEP 5: Control injected evidence by effort/thinking budget.
- STEP 6: Record search rounds, fetch concurrency, evidence hits, cross-check
  coverage, citation compression, cost-related counters, and success/comparison
  metrics.
- STEP 6: Add BenchmarkHarness coverage for RAG vs Agentic Search A/B.
- Keep `deepcode-deepseek-gap.html` current with completed work, verification,
  affected files, remaining risk, and next step.

## Assumptions

- Existing STEP 1-3 files under `src/services/agenticSearch/` are the correct
  home for this work.
- Runtime Query/Agent wiring can begin with stable exported pack/metadata
  contracts and benchmark fixtures; direct query loop invocation can remain a
  follow-up if it would require broad model request plumbing.
- Evidence extraction should be deterministic and testable without an LLM.
- Cost metrics can use token/character estimates until real provider billing
  data is available.

## Scope Boundaries

- Do not call real WebSearch/WebFetch providers in tests.
- Do not implement live MCP server execution in this step; keep source runner
  adapter boundaries injectable.
- Do not rewrite ContextPacker or QueryEngine architecture.
- Do not open broad UI work beyond metadata/status surfaces and the gap board.

## Existing Patterns To Follow

- `src/services/agenticSearch/AgenticSearchPlanner.ts`
- `src/services/agenticSearch/AgenticSearchExecutor.ts`
- `src/services/agenticSearch/__tests__/AgenticSearchExecutor.test.ts`
- `src/services/benchmark/types.ts`
- `src/services/benchmark/BenchmarkHarness.ts`
- `src/services/benchmark/Reporter.ts`
- `tests/benchmark/fixtures/deepseek-long-context.json`
- `deepcode-deepseek-gap.html`

## Implementation Units

### U1: Evidence Extractor And Cross-Check Model

Goal: Convert raw fetched/source evidence into structured claims with source
type, date, snippet, support strength, and conflict grouping.

Files:
- Create: `src/services/agenticSearch/AgenticSearchEvidence.ts`
- Modify: `src/services/agenticSearch/types.ts`
- Modify: `src/services/agenticSearch/index.ts`
- Test: `src/services/agenticSearch/__tests__/AgenticSearchEvidence.test.ts`

Approach:
- Add deterministic extraction helpers that inspect URL, title, content, and
  originating source kind.
- Classify sources as primary, independent, local, private, or unknown.
- Extract citation snippets within per-snippet and total-character limits.
- Extract probable dates from URLs/content/title when available.
- Group conflicting claims with simple contradiction cues suitable for tests and
  future LLM-assisted refinement.
- Produce a cross-check summary that explicitly counts primary-source and
  independent evidence.

Test scenarios:
- Primary provider/docs URL is classified as primary source.
- Independent article/source URL is classified as independent cross-check.
- MCP/local/Bash evidence is retained as implementation/private context.
- Snippets are bounded and citation-ready.
- Conflicting positive/negative claims are grouped together.
- Cross-check summary reports missing primary or independent support.

### U2: Citation-Ready Evidence Pack And Query/Agent Metadata Contract

Goal: Compress extracted evidence into a bounded pack that can be injected into
ContextPacker, Query loop, or agent task metadata.

Files:
- Create: `src/services/agenticSearch/AgenticSearchEvidencePack.ts`
- Modify: `src/services/agenticSearch/types.ts`
- Modify: `src/services/agenticSearch/index.ts`
- Test: `src/services/agenticSearch/__tests__/AgenticSearchEvidencePack.test.ts`

Approach:
- Add effort-aware pack budgets derived from `AgenticSearchPlan.budget`.
- Rank evidence by source type, support strength, snippet quality, and
  cross-check usefulness.
- Emit a stable text pack with citation IDs and structured metadata.
- Include metadata fields useful for Query/Agent integration: pack chars,
  budget chars, citation count, truncation count, cross-check coverage, and
  recommended injection target.
- Avoid direct QueryEngine changes unless the existing call path has a small,
  obvious metadata hook.

Test scenarios:
- Pack keeps primary and independent evidence when both are available.
- Pack truncates low-priority evidence before primary evidence.
- Pack metadata reports pack chars, budget chars, citation count, and truncation.
- Pack output is stable and citation IDs map back to source URLs/evidence.
- Max/deep effort allows larger pack budget than fast effort.

### U3: Metrics And Benchmark A/B Evidence

Goal: Extend execution metrics and BenchmarkHarness fixture coverage so Agentic
Search can be compared with regular RAG.

Files:
- Modify: `src/services/agenticSearch/types.ts`
- Modify: `src/services/agenticSearch/AgenticSearchExecutor.ts`
- Modify: `src/services/benchmark/types.ts`
- Modify: `src/services/benchmark/BenchmarkHarness.ts`
- Modify: `src/services/benchmark/Reporter.ts`
- Create: `tests/benchmark/fixtures/agentic-search-ab.json`
- Test: `src/services/benchmark/__tests__/BenchmarkHarness.test.ts`
- Test: `src/services/benchmark/__tests__/Reporter.test.ts`

Approach:
- Add Agentic Search metrics for search rounds, fetch concurrency,
  source-runner evidence, private URL skips, evidence hits, cross-check coverage,
  citation compression, estimated tokens/cost, and comparison mode.
- Extend benchmark task context expectations with agentic search expectations.
- Add a dry-run A/B fixture comparing `rag-baseline` and `agentic-search`
  candidates.
- Ensure reports surface the Agentic Search metrics without requiring real
  provider execution.

Test scenarios:
- Benchmark summary preserves Agentic Search metrics from task runs.
- Reporter JSON/Markdown include search rounds, evidence hits, cross-check
  coverage, citation compression, and comparison mode.
- A/B fixture loads and dry-runs with both baseline and agentic candidates.

### U4: Gap Board And Verification

Goal: Keep the fixed browser board accurate and verify the completed work.

Files:
- Modify: `deepcode-deepseek-gap.html`

Approach:
- Mark STEP 4-6 as DONE only after implementation and tests pass.
- Update current-round target, completed changes, verification commands, affected
  files, remaining risk, and suggested follow-up.

Verification:
- `bun test src/services/agenticSearch/__tests__/AgenticSearchPlanner.test.ts src/services/agenticSearch/__tests__/AgenticSearchExecutor.test.ts src/services/agenticSearch/__tests__/AgenticSearchEvidence.test.ts src/services/agenticSearch/__tests__/AgenticSearchEvidencePack.test.ts`
- `bun test src/services/benchmark/__tests__/BenchmarkHarness.test.ts src/services/benchmark/__tests__/Reporter.test.ts`
- `bunx tsc --noEmit`
- `bunx biome check src/services/agenticSearch src/services/benchmark`
- `git diff --check`

## Dependencies And Sequencing

1. U1 first, because evidence extraction is the input to packing and metrics.
2. U2 second, because Query/Agent metadata depends on extracted evidence.
3. U3 third, because metrics and benchmark fixtures depend on U1/U2 outputs.
4. U4 last, after all verification results are known.

## Deferred To Follow-Up Work

- Real provider WebSearch/WebFetch execution evidence.
- Direct QueryEngine runtime invocation if the metadata contract requires a
  broader model request change.
- Full UI beyond existing status/debug/board surfaces.
