import { describe, expect, test } from 'bun:test'
import {
  createAgenticSearchPlan,
  shouldUseAgenticSearch,
  summarizeAgenticSearchPlan,
} from '../AgenticSearchPlanner.js'

describe('AgenticSearchPlanner', () => {
  test('creates a multi-round deep plan with primary and cross-check evidence', () => {
    const plan = createAgenticSearchPlan({
      task: 'Verify the latest DeepSeek V4 provider API docs and compare claims with independent evidence',
      effort: 'deep',
      now: 1_234,
    })

    expect(plan.effort).toBe('deep')
    expect(plan.intent).toBe('cross_source_fact_check')
    expect(plan.mustCrossCheck).toBe(true)
    expect(plan.createdAt).toBe(1_234)
    expect(plan.evidenceRequirements).toContain('citation')
    expect(plan.evidenceRequirements).toContain('primary_source')
    expect(plan.evidenceRequirements).toContain('cross_check')
    expect(plan.evidenceRequirements).toContain('recency')
    expect(plan.steps.some(step => step.source === 'web_search')).toBe(true)
    expect(plan.steps.some(step => step.source === 'web_fetch')).toBe(true)
    expect(Math.max(...plan.steps.map(step => step.round))).toBe(3)
    expect(
      plan.steps.filter(step => step.source === 'web_search').length,
    ).toBeLessThanOrEqual(plan.budget.maxSearches)
  })

  test('keeps fast plans within a single round and small fetch budget', () => {
    const plan = createAgenticSearchPlan({
      task: 'Quickly check current pricing for an API',
      effort: 'fast',
    })

    expect(plan.budget.maxRounds).toBe(1)
    expect(plan.steps.every(step => step.round === 1)).toBe(true)
    expect(
      plan.steps.filter(step => step.source === 'web_search').length,
    ).toBeLessThanOrEqual(1)
    expect(
      plan.steps.filter(step => step.source === 'web_fetch').length,
    ).toBeLessThanOrEqual(plan.budget.maxFetches)
  })

  test('routes authenticated knowledge tasks through MCP before public web search', () => {
    const plan = createAgenticSearchPlan({
      task: 'Search internal GitHub MCP and Confluence for the private rollout notes',
      effort: 'balanced',
    })

    expect(plan.intent).toBe('tool_or_mcp_lookup')
    expect(plan.evidenceRequirements).toContain('implementation_context')
    expect(plan.steps[0]?.source).toBe('mcp_search')
    expect(plan.steps.some(step => step.source === 'web_search')).toBe(true)
  })

  test('respects preferred source restrictions', () => {
    const plan = createAgenticSearchPlan({
      task: 'Verify current provider docs',
      effort: 'balanced',
      preferredSources: ['web_search'],
    })

    expect(plan.steps.length).toBeGreaterThan(0)
    expect(plan.steps.every(step => step.source === 'web_search')).toBe(true)
  })

  test('summarizes plan counts for metrics and debug surfaces', () => {
    const plan = createAgenticSearchPlan({
      task: 'Run a comprehensive benchmark evidence search with citations',
      effort: 'deep',
      now: 42,
    })
    const summary = summarizeAgenticSearchPlan(plan)

    expect(summary.planId).toBe(plan.id)
    expect(summary.stepCount).toBe(plan.steps.length)
    expect(summary.webSearchCount).toBeGreaterThan(0)
    expect(summary.webFetchCount).toBeGreaterThan(0)
    expect(summary.maxEvidenceChars).toBe(plan.budget.maxEvidenceChars)
    expect(summary.mustCrossCheck).toBe(true)
  })

  test('detects prompts that need agentic search', () => {
    expect(shouldUseAgenticSearch('What is the latest SDK changelog?')).toBe(
      true,
    )
    expect(shouldUseAgenticSearch('Summarize this local paragraph')).toBe(false)
  })
})
