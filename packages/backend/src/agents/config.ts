import type { AgentConfig } from '../types.js';

export type AgentSetupInput = Pick<AgentConfig, 'cli_cmd' | 'cli_prompt_mode' | 'cli_prompt_flag'>;

type ParseResult = { config: AgentConfig } | { error: string };

export function parseAgentSetup(input: unknown, current: AgentConfig): ParseResult {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return { error: 'Agent setup is required.' };
  const values = input as Partial<AgentSetupInput>;
  if (typeof values.cli_cmd !== 'string' || !values.cli_cmd.trim()) return { error: 'Agent CLI command is required.' };
  const cli_prompt_mode = values.cli_prompt_mode;
  if (cli_prompt_mode !== 'stdin' && cli_prompt_mode !== 'argument' && cli_prompt_mode !== 'flag') return { error: 'Choose how the prompt is sent to the Agent CLI.' };
  if (values.cli_prompt_flag !== undefined && typeof values.cli_prompt_flag !== 'string') return { error: 'Prompt flag must be a string.' };

  const cli_prompt_flag = values.cli_prompt_flag?.trim() ?? '';
  if (values.cli_prompt_mode === 'flag' && !cli_prompt_flag) return { error: 'A prompt flag is required when using named-flag delivery.' };

  return {
    config: {
      ...current,
      cli_cmd: values.cli_cmd.trim(),
      cli_prompt_mode,
      cli_prompt_flag: cli_prompt_flag || null,
    },
  };
}
