import { validateFlow } from './validation.js';
import type { CompiledFlowDefinition, FlowDefinition } from './types.js';

/**
 * Compiling validates the graph and freezes its structure and Agent references. Agent prompts are
 * NOT baked in here — they are resolved live from the Agent library when a Run starts, so improving
 * an agent reaches every Flow that uses it without republishing.
 */
export function compileFlow(definition: FlowDefinition, knownAgentKeys?: Set<string>): CompiledFlowDefinition {
  const validation = validateFlow(definition, knownAgentKeys);
  if (!validation.valid) {
    const error = new Error('Flow cannot be compiled because it is invalid.');
    Object.assign(error, { problems: validation.problems });
    throw error;
  }
  return structuredClone(definition);
}
