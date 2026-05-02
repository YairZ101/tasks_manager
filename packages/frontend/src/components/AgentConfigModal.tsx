import { useState, useEffect } from 'react';
import { toast } from 'sonner';
import { useAppStore } from '../hooks/useTaskStore.js';
import { api } from '../api/client.js';

const PRESETS = [
  { label: 'Crush', cli_cmd: 'crush run', cli_prompt_mode: 'argument', cli_prompt_flag: null },
  { label: 'Claude Code', cli_cmd: 'claude', cli_prompt_mode: 'flag', cli_prompt_flag: '--print -p' },
  { label: 'Aider', cli_cmd: 'aider', cli_prompt_mode: 'flag', cli_prompt_flag: '--message' },
  { label: 'Codex', cli_cmd: 'codex', cli_prompt_mode: 'argument', cli_prompt_flag: null },
  { label: 'Custom CLI', cli_cmd: '', cli_prompt_mode: 'stdin', cli_prompt_flag: null },
] as const;

type SettingsPage = 'agent' | 'concurrency' | 'git';

const NAV_ITEMS: { id: SettingsPage; label: string; icon: React.ReactNode }[] = [
  {
    id: 'agent',
    label: 'Agent',
    icon: (
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
        <rect x="2" y="2" width="10" height="10" rx="2" stroke="currentColor" strokeWidth="1.3" />
        <path d="M5 6h4M5 8.5h2.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
      </svg>
    ),
  },
  {
    id: 'concurrency',
    label: 'Concurrency',
    icon: (
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
        <path d="M3 4h3M3 7h3M3 10h3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
        <path d="M8 4h3M8 7h3M8 10h3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
      </svg>
    ),
  },
  {
    id: 'git',
    label: 'Git',
    icon: (
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
        <circle cx="4" cy="4" r="1.5" stroke="currentColor" strokeWidth="1.2" />
        <circle cx="10" cy="4" r="1.5" stroke="currentColor" strokeWidth="1.2" />
        <circle cx="4" cy="10" r="1.5" stroke="currentColor" strokeWidth="1.2" />
        <path d="M4 5.5v3M5.5 4h3" stroke="currentColor" strokeWidth="1.2" />
      </svg>
    ),
  },
];

export default function AgentConfigModal() {
  const { setShowAgentConfig, tasks } = useAppStore();
  const hasRunningAgent = tasks.some((t) => t.agent_status === 'running');

  const [activePage, setActivePage] = useState<SettingsPage>('agent');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);

  // Config state
  const [cliCmd, setCliCmd] = useState('');
  const [cliPromptMode, setCliPromptMode] = useState<string>('stdin');
  const [cliPromptFlag, setCliPromptFlag] = useState('');
  const [timeoutMs, setTimeoutMs] = useState(1800000);
  const [maxConcurrent, setMaxConcurrent] = useState(3);
  const [testResult, setTestResult] = useState<{ success: boolean; error?: string } | null>(null);
  const [deleteBranchOnDone, setDeleteBranchOnDone] = useState(true);

  // Load config
  useEffect(() => {
    async function load() {
      try {
        const [agentData, statusData] = await Promise.all([
          api.getAgentConfig(),
          api.getStatus(),
        ]);
        const c = agentData.config;
        if (c) {
          setCliCmd(c.cli_cmd || '');
          setCliPromptMode(c.cli_prompt_mode || 'stdin');
          setCliPromptFlag(c.cli_prompt_flag || '');
          setTimeoutMs(c.timeout_ms || 1800000);
          setMaxConcurrent(c.max_concurrent_agents ?? 3);
        }
        if (statusData.projectConfig) {
          setDeleteBranchOnDone(!!statusData.projectConfig.delete_branch_on_done);
        }
      } catch {
        toast.error('Failed to load settings');
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  const applyPreset = (preset: (typeof PRESETS)[number]) => {
    setCliCmd(preset.cli_cmd);
    setCliPromptMode(preset.cli_prompt_mode);
    setCliPromptFlag(preset.cli_prompt_flag || '');
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await Promise.all([
        api.updateAgentConfig({
          cli_cmd: cliCmd || null,
          cli_prompt_mode: cliPromptMode,
          cli_prompt_flag: cliPromptFlag || null,
          timeout_ms: timeoutMs,
          max_concurrent_agents: maxConcurrent,
        }),
        api.updateProjectConfig({
          delete_branch_on_done: deleteBranchOnDone,
        }),
      ]);
      toast.success('Settings saved');
      useAppStore.setState({ maxConcurrentAgents: maxConcurrent });
      setShowAgentConfig(false);
    } catch (err: any) {
      toast.error(err.message || 'Failed to save settings');
    } finally {
      setSaving(false);
    }
  };

  const handleTest = async () => {
    setTesting(true);
    setTestResult(null);

    // Save first
    try {
      await api.updateAgentConfig({
        cli_cmd: cliCmd || null,
        cli_prompt_mode: cliPromptMode,
        cli_prompt_flag: cliPromptFlag || null,
        timeout_ms: timeoutMs,
        max_concurrent_agents: maxConcurrent,
      });
    } catch (err: any) {
      setTestResult({ success: false, error: err.message });
      setTesting(false);
      return;
    }

    try {
      const result = await api.testAgentConfig();
      setTestResult(result);
    } catch (err: any) {
      setTestResult({ success: false, error: err.message });
    } finally {
      setTesting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center animate-fade-in">
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={() => setShowAgentConfig(false)}
      />

      <div className="relative w-full max-w-2xl max-h-[85vh] bg-bg-raised border border-border rounded-xl shadow-2xl flex flex-col animate-slide-up">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border flex-shrink-0">
          <h2 className="text-sm font-semibold text-text">Settings</h2>
          <button
            onClick={() => setShowAgentConfig(false)}
            title="Close"
            className="p-1 rounded-md text-text-muted hover:text-text hover:bg-bg-hover transition-colors"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        {/* Warning banner */}
        {hasRunningAgent && (
          <div className="mx-5 mt-4 px-3 py-2 bg-warning-dim border border-warning/20 rounded-lg text-xs text-warning">
            Config changes apply to future runs only.
          </div>
        )}

        {/* Body: sidebar + content */}
        <div className="flex flex-1 overflow-hidden min-h-0">
          {/* Sidebar nav */}
          <nav className="w-40 flex-shrink-0 border-r border-border p-2 space-y-0.5">
            {NAV_ITEMS.map((item) => (
              <button
                key={item.id}
                onClick={() => setActivePage(item.id)}
                className={`flex items-center gap-2 w-full px-2.5 py-1.5 text-xs font-medium rounded-md transition-colors ${
                  activePage === item.id
                    ? 'bg-bg-hover text-text'
                    : 'text-text-muted hover:text-text hover:bg-bg-hover/50'
                }`}
              >
                {item.icon}
                {item.label}
              </button>
            ))}
          </nav>

          {/* Content */}
          <div className="flex-1 overflow-y-auto p-5">
            {loading ? (
              <div className="flex items-center justify-center py-8">
                <div className="w-6 h-6 border-2 border-accent border-t-transparent rounded-full animate-spin-slow" />
              </div>
            ) : (
              <>
                {activePage === 'agent' && <AgentPage
                  cliCmd={cliCmd}
                  setCliCmd={setCliCmd}
                  cliPromptMode={cliPromptMode}
                  setCliPromptMode={setCliPromptMode}
                  cliPromptFlag={cliPromptFlag}
                  setCliPromptFlag={setCliPromptFlag}
                  timeoutMs={timeoutMs}
                  setTimeoutMs={setTimeoutMs}
                  applyPreset={applyPreset}
                  testResult={testResult}
                  testing={testing}
                  handleTest={handleTest}
                />}
                {activePage === 'concurrency' && <ConcurrencyPage
                  maxConcurrent={maxConcurrent}
                  setMaxConcurrent={setMaxConcurrent}
                />}
                {activePage === 'git' && <GitPage
                  deleteBranchOnDone={deleteBranchOnDone}
                  setDeleteBranchOnDone={setDeleteBranchOnDone}
                />}
              </>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-border flex-shrink-0">
          <button
            onClick={() => setShowAgentConfig(false)}
            className="px-3 py-1.5 text-xs font-medium text-text-muted hover:text-text hover:bg-bg-hover rounded-lg transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={saving || loading}
            className="px-3 py-1.5 text-xs font-medium text-white bg-accent hover:bg-accent-hover rounded-lg transition-colors disabled:opacity-30"
          >
            {saving ? 'Saving...' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}

function AgentPage({
  cliCmd, setCliCmd,
  cliPromptMode, setCliPromptMode,
  cliPromptFlag, setCliPromptFlag,
  timeoutMs, setTimeoutMs,
  applyPreset,
  testResult, testing, handleTest,
}: {
  cliCmd: string; setCliCmd: (v: string) => void;
  cliPromptMode: string; setCliPromptMode: (v: string) => void;
  cliPromptFlag: string; setCliPromptFlag: (v: string) => void;
  timeoutMs: number; setTimeoutMs: (v: number) => void;
  applyPreset: (preset: (typeof PRESETS)[number]) => void;
  testResult: { success: boolean; error?: string } | null;
  testing: boolean; handleTest: () => void;
}) {
  return (
    <div className="space-y-4">
      {/* Presets */}
      <div>
        <label className="block text-xs font-semibold text-text-muted uppercase tracking-wide mb-1">
          Preset
        </label>
        <div className="flex flex-wrap gap-1.5">
          {PRESETS.map((preset) => (
            <button
              key={preset.label}
              onClick={() => applyPreset(preset)}
              className={`px-2.5 py-1 text-xs font-medium rounded-md border transition-colors ${
                cliCmd === preset.cli_cmd && cliPromptMode === preset.cli_prompt_mode
                  ? 'border-accent text-accent bg-accent-dim'
                  : 'border-border text-text-muted hover:text-text hover:bg-bg-hover'
              }`}
            >
              {preset.label}
            </button>
          ))}
        </div>
      </div>

      {/* Command */}
      <div>
        <label className="block text-xs font-semibold text-text-muted uppercase tracking-wide mb-1">
          Command
        </label>
        <input
          type="text"
          value={cliCmd}
          onChange={(e) => setCliCmd(e.target.value)}
          placeholder="e.g. claude"
          className="w-full px-3 py-2 text-sm font-mono bg-bg-input border border-border rounded-lg text-text placeholder:text-text-dim focus:outline-none focus:border-border-focus transition-colors"
        />
      </div>

      {/* Prompt Mode */}
      <div>
        <label className="block text-xs font-semibold text-text-muted uppercase tracking-wide mb-1">
          Prompt Mode
        </label>
        <select
          value={cliPromptMode}
          onChange={(e) => setCliPromptMode(e.target.value)}
          className="w-full px-3 py-2 text-sm bg-bg-input border border-border rounded-lg text-text focus:outline-none focus:border-border-focus"
        >
          <option value="stdin">stdin (pipe)</option>
          <option value="argument">Positional argument</option>
          <option value="flag">Flag</option>
        </select>
      </div>

      {cliPromptMode === 'flag' && (
        <div>
          <label className="block text-xs font-semibold text-text-muted uppercase tracking-wide mb-1">
            Prompt Flag
          </label>
          <input
            type="text"
            value={cliPromptFlag}
            onChange={(e) => setCliPromptFlag(e.target.value)}
            placeholder="e.g. --message"
            className="w-full px-3 py-2 text-sm font-mono bg-bg-input border border-border rounded-lg text-text placeholder:text-text-dim focus:outline-none focus:border-border-focus transition-colors"
          />
        </div>
      )}

      {/* Timeout */}
      <div>
        <label className="block text-xs font-semibold text-text-muted uppercase tracking-wide mb-1">
          Timeout (minutes)
        </label>
        <input
          type="number"
          value={parseFloat((timeoutMs / 60000).toFixed(1))}
          onChange={(e) => setTimeoutMs(Math.max(Math.round((parseFloat(e.target.value) || 0.5) * 60000), 30000))}
          min={0.5}
          step={0.5}
          className="w-24 px-3 py-2 text-sm bg-bg-input border border-border rounded-lg text-text focus:outline-none focus:border-border-focus"
        />
      </div>

      {/* Test Connection */}
      <div className="pt-2 border-t border-border">
        <button
          onClick={handleTest}
          disabled={testing}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-text-muted hover:text-text border border-border hover:bg-bg-hover rounded-lg transition-colors disabled:opacity-30"
        >
          {testing ? (
            <>
              <div className="w-3 h-3 border border-text-muted border-t-transparent rounded-full animate-spin-slow" />
              Testing...
            </>
          ) : (
            'Test Connection'
          )}
        </button>

        {testResult && (
          <div
            className={`mt-2 px-3 py-2 rounded-lg text-xs font-medium border ${
              testResult.success
                ? 'bg-success-dim border-success/20 text-success'
                : 'bg-danger-dim border-danger/20 text-danger'
            }`}
          >
            {testResult.success
              ? 'Connection test passed!'
              : `Connection test failed: ${testResult.error || 'Unknown error'}`}
          </div>
        )}
      </div>
    </div>
  );
}

function ConcurrencyPage({
  maxConcurrent,
  setMaxConcurrent,
}: {
  maxConcurrent: number;
  setMaxConcurrent: (v: number) => void;
}) {
  return (
    <div className="space-y-4">
      <div>
        <label className="block text-xs font-semibold text-text-muted uppercase tracking-wide mb-1">
          Max Concurrent Agents
        </label>
        <input
          type="number"
          value={maxConcurrent}
          onChange={(e) => setMaxConcurrent(Math.max(1, Math.min(10, parseInt(e.target.value, 10) || 1)))}
          min={1}
          max={10}
          className="w-24 px-3 py-2 text-sm bg-bg-input border border-border rounded-lg text-text focus:outline-none focus:border-border-focus"
        />
        <p className="text-xs text-text-muted mt-2">
          How many agents can work on tasks at the same time. Each agent runs in its own git worktree, so they won't interfere with each other.
        </p>
        <p className="text-[10px] text-text-dim mt-1">
          Requires a git repository for values above 1. Non-git projects are limited to 1.
        </p>
      </div>
    </div>
  );
}

function GitPage({
  deleteBranchOnDone,
  setDeleteBranchOnDone,
}: {
  deleteBranchOnDone: boolean;
  setDeleteBranchOnDone: (v: boolean) => void;
}) {
  return (
    <div className="space-y-4">
      <div>
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={deleteBranchOnDone}
            onChange={(e) => setDeleteBranchOnDone(e.target.checked)}
            className="w-3.5 h-3.5 rounded border-border accent-accent"
          />
          <span className="text-xs font-semibold text-text">Delete branch when task is done</span>
        </label>
        <p className="text-xs text-text-muted mt-2 ml-5.5">
          When enabled, the <code className="text-[11px] font-mono bg-bg-hover px-1 rounded">agent/{'<task-key>'}</code> branch is deleted after the task reaches Done. Disable to keep branches for reference or manual PR creation.
        </p>
      </div>
    </div>
  );
}
