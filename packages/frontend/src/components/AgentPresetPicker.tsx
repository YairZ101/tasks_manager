import { Icon } from './Icon.js';

export type AgentCliConfig = {
  cli_cmd: string;
  cli_prompt_mode: 'stdin' | 'argument' | 'flag';
  cli_prompt_flag?: string | null;
};

export type AgentCliPreset = AgentCliConfig & {
  key: 'codex' | 'claude';
  name: string;
  commandLabel: string;
  description: string;
  autonomyNote: string;
};

export const AGENT_CLI_PRESETS: AgentCliPreset[] = [
  {
    key: 'codex',
    name: 'Codex',
    commandLabel: 'codex exec --full-auto',
    cli_cmd: 'codex exec --full-auto',
    cli_prompt_mode: 'stdin',
    cli_prompt_flag: '',
    description: 'OpenAI Codex with the task prompt sent through standard input.',
    autonomyNote: 'Runs in Full Auto mode for unattended task execution.',
  },
  {
    key: 'claude',
    name: 'Claude Code',
    commandLabel: 'claude -p --dangerously-skip-permissions',
    cli_cmd: 'claude -p --dangerously-skip-permissions',
    cli_prompt_mode: 'argument',
    cli_prompt_flag: '',
    description: 'Claude Code print mode with the task prompt passed as the final argument.',
    autonomyNote: 'Skips Claude permission prompts. Use only in a trusted workspace.',
  },
];

function isSameConfig(a: AgentCliConfig, b: AgentCliConfig): boolean {
  return a.cli_cmd.trim() === b.cli_cmd && a.cli_prompt_mode === b.cli_prompt_mode && (a.cli_prompt_flag?.trim() ?? '') === (b.cli_prompt_flag?.trim() ?? '');
}

export function getMatchingAgentPreset(config: AgentCliConfig): AgentCliPreset | undefined {
  return AGENT_CLI_PRESETS.find((preset) => isSameConfig(config, preset));
}

export function AgentPresetPicker({ value, onSelect }: { value: AgentCliConfig; onSelect: (preset: AgentCliPreset) => void }) {
  const active = getMatchingAgentPreset(value);
  return <section className="agent-preset-picker" aria-labelledby="agent-presets-label">
    <div className="preset-heading"><span className="eyebrow" id="agent-presets-label">CLI PRESETS</span><small>{active ? `${active.name} selected` : 'Custom command'}</small></div>
    <div className="agent-preset-grid">
      {AGENT_CLI_PRESETS.map((preset) => <button
        key={preset.key}
        type="button"
        className={`agent-preset-card ${active?.key === preset.key ? 'selected' : ''}`}
        aria-pressed={active?.key === preset.key}
        onClick={() => onSelect(preset)}
      >
        <span className={`preset-mark ${preset.key}`}><Icon name="terminal" size={16} /></span>
        <span className="preset-copy"><strong>{preset.name}</strong><code>{preset.commandLabel}</code><small>{preset.description}</small></span>
      </button>)}
    </div>
    {active && <p className={`preset-note ${active.key}`}><Icon name="alert" size={13} />{active.autonomyNote}</p>}
  </section>;
}
