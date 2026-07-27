import type { AgentNodeConfig, AgentPresetDefinition } from './types.js';

export const AGENT_PRESETS: AgentPresetDefinition[] = [
  {
    key: 'planning',
    name: 'Planning',
    description: 'Explore the repository and write an implementation plan.',
    effectLevel: 'workspace_write',
    defaultConfig: { planLocation: 'doc/plans/', trackInGit: true },
  },
  {
    key: 'development',
    name: 'Development',
    description: 'Implement the task and run the project checks.',
    effectLevel: 'workspace_write',
    defaultConfig: {},
  },
  {
    key: 'visual-qa',
    name: 'Visual QA',
    description: 'Open the application and verify the affected experience.',
    effectLevel: 'read_only',
    defaultConfig: {},
  },
  {
    key: 'open-pr',
    name: 'Open PR',
    description: 'Commit the workspace, push the branch, and open a pull request.',
    effectLevel: 'external_write',
    defaultConfig: { draftPullRequest: false },
  },
  {
    key: 'custom',
    name: 'Custom agent',
    description: 'Run the configured agent with your own instructions.',
    effectLevel: 'workspace_write',
    defaultConfig: {},
  },
];

export const AGENT_PRESET_MAP = new Map(AGENT_PRESETS.map((preset) => [preset.key, preset]));

export function getAgentPresetInstructions(config: AgentNodeConfig): string {
  const extra = config.instructions?.trim();
  let instructions: string;

  switch (config.preset) {
    case 'planning': {
      const location = config.planLocation?.trim() || 'doc/plans/';
      instructions = [
        'Create an implementation plan for this task.',
        'Explore the repository and identify the files, behavior, tests, risks, and acceptance criteria involved.',
        `Write the plan to ${location}<task_key>.md.`,
        'Do not implement product code in this block.',
        'Do not run git commands.',
      ].join('\n');
      break;
    }
    case 'development':
      instructions = [
        'Implement the task described below.',
        'Read any plan produced earlier in this run.',
        'Follow repository instructions and existing patterns.',
        'Add or update tests with every behavior change.',
        'Run the relevant tests, type checks, and build commands.',
        'Do not run git commands.',
      ].join('\n');
      break;
    case 'visual-qa':
      instructions = [
        'Test the affected user interface in a real browser.',
        'Verify layout, interaction, responsive behavior, keyboard access, and browser console output.',
        'Report what passed and any specific failures.',
        'Do not modify product code and do not run git commands.',
      ].join('\n');
      break;
    case 'open-pr':
      instructions = [
        'Review all workspace changes, create logical commits, push the task branch, and open a pull request.',
        'Account for every changed and untracked file before committing.',
        config.draftPullRequest ? 'Open the pull request as a draft.' : 'Open the pull request as ready for review.',
      ].join('\n');
      break;
    case 'custom':
      instructions = extra || 'Complete the configured work for this task.';
      return instructions;
  }

  return extra ? `${instructions}\n\nAdditional instructions:\n${extra}` : instructions;
}

export function createAgentConfig(preset: AgentNodeConfig['preset'], name?: string): AgentNodeConfig {
  const definition = AGENT_PRESET_MAP.get(preset) ?? AGENT_PRESET_MAP.get('custom')!;
  return {
    name: name || definition.name,
    preset,
    effectLevel: definition.effectLevel,
    ...definition.defaultConfig,
  };
}
