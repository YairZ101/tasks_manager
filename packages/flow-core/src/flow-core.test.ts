import { describe, expect, test } from 'bun:test';
import { compileFlow, createBlankFlow, createMinimalFlow, createRecommendedFlow, validateFlow } from './index.js';

describe('flow validation', () => {
  test('accepts minimal and recommended flows', () => {
    expect(validateFlow(createBlankFlow())).toEqual({ valid: true, problems: [] });
    expect(validateFlow(createMinimalFlow())).toEqual({ valid: true, problems: [] });
    expect(validateFlow(createRecommendedFlow())).toEqual({ valid: true, problems: [] });
  });

  test('accepts a feedback cycle that passes through a Decision', () => {
    const flow = createRecommendedFlow();
    expect(flow.connections.some((edge) => edge.targetNodeId === 'development' && edge.sourceNodeId === 'final-decision')).toBe(true);
    expect(validateFlow(flow).valid).toBe(true);
  });

  test('rejects an automatic cycle', () => {
    const flow = createMinimalFlow();
    flow.connections.push({ id: 'cycle', sourceNodeId: 'development', sourceOutcomeId: 'failed', targetNodeId: 'development' });
    expect(validateFlow(flow).problems.some((problem) => problem.code === 'automatic_cycle')).toBe(true);
  });

  test('rejects fan-out from one outcome', () => {
    const flow = createMinimalFlow();
    flow.connections.push({ id: 'fan', sourceNodeId: 'development', sourceOutcomeId: 'completed', targetNodeId: 'completed' });
    expect(validateFlow(flow).problems.some((problem) => problem.code === 'fan_out')).toBe(true);
  });

  test('compiles stable Agent instructions', () => {
    const compiled = compileFlow(createMinimalFlow());
    const agent = compiled.nodes.find((node) => node.type === 'agent');
    expect(agent?.type).toBe('agent');
    if (agent?.type === 'agent') expect(agent.config.compiledInstructions).toContain('Implement the task');
  });
});
