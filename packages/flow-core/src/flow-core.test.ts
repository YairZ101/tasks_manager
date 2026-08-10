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

  test('compiles a valid Flow, keeping Agent references without baking any prompt', () => {
    const compiled = compileFlow(createMinimalFlow());
    const agent = compiled.nodes.find((node) => node.type === 'agent');
    expect(agent?.type).toBe('agent');
    if (agent?.type === 'agent') {
      expect(agent.config.preset).toBe('development');
      expect('compiledInstructions' in agent.config).toBe(false);
      expect('systemPrompt' in agent.config).toBe(false);
    }
  });

  test('validates Agent blocks against the known agent library', () => {
    const flow = createMinimalFlow();
    const agent = flow.nodes.find((node) => node.type === 'agent');
    if (!agent || agent.type !== 'agent') throw new Error('Expected Agent block');
    agent.config = { ...agent.config, preset: 'release-engineer' };
    // An agent that is not in the library is invalid...
    expect(validateFlow(flow).problems.some((problem) => problem.code === 'agent_preset')).toBe(true);
    // ...unless the caller supplies the current library keys.
    expect(validateFlow(flow, new Set(['release-engineer'])).valid).toBe(true);
    expect(() => compileFlow(flow)).toThrow();
    expect(compileFlow(flow, new Set(['release-engineer'])).nodes.length).toBe(flow.nodes.length);
  });
});
