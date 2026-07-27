import { getAgentPresetInstructions } from './catalog.js';
import { validateFlow } from './validation.js';
import type { CompiledFlowDefinition, FlowDefinition } from './types.js';

export function compileFlow(definition: FlowDefinition): CompiledFlowDefinition {
  const validation = validateFlow(definition);
  if (!validation.valid) {
    const error = new Error('Flow cannot be compiled because it is invalid.');
    Object.assign(error, { problems: validation.problems });
    throw error;
  }

  return {
    ...definition,
    nodes: definition.nodes.map((node) => {
      if (node.type !== 'agent') return structuredClone(node);
      return {
        ...structuredClone(node),
        config: {
          ...structuredClone(node.config),
          compiledInstructions: getAgentPresetInstructions(node.config),
        },
      };
    }),
  };
}
