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

export default function AgentConfigModal() {
  const { setShowAgentConfig, tasks } = useAppStore();
  const hasRunningAgent = tasks.some((t) => t.agent_status === 'running');

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);

  // Config state
  const [configType, setConfigType] = useState<'cli' | 'api'>('cli');
  const [cliCmd, setCliCmd] = useState('');
  const [cliPromptMode, setCliPromptMode] = useState<string>('stdin');
  const [cliPromptFlag, setCliPromptFlag] = useState('');
  const [apiUrl, setApiUrl] = useState('');
  const [apiHeaders, setApiHeaders] = useState('');
  const [apiModel, setApiModel] = useState('');
  const [apiRequestFormat, setApiRequestFormat] = useState('openai');
  const [apiStreamFormat, setApiStreamFormat] = useState('sse');
  const [timeoutMs, setTimeoutMs] = useState(1800000);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [testResult, setTestResult] = useState<{ success: boolean; error?: string } | null>(null);

  // Load config
  useEffect(() => {
    async function load() {
      try {
        const data = await api.getAgentConfig();
        const c = data.config;
        if (c) {
          setConfigType(c.type || 'cli');
          setCliCmd(c.cli_cmd || '');
          setCliPromptMode(c.cli_prompt_mode || 'stdin');
          setCliPromptFlag(c.cli_prompt_flag || '');
          setApiUrl(c.api_url || '');
          setApiHeaders(c.api_headers || '');
          setApiModel(c.api_model || '');
          setApiRequestFormat(c.api_request_format || 'openai');
          setApiStreamFormat(c.api_stream_format || 'sse');
          setTimeoutMs(c.timeout_ms || 1800000);
        }
      } catch {
        toast.error('Failed to load agent config');
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
      await api.updateAgentConfig({
        type: configType,
        cli_cmd: cliCmd || null,
        cli_prompt_mode: cliPromptMode,
        cli_prompt_flag: cliPromptFlag || null,
        api_url: apiUrl || null,
        api_headers: apiHeaders || null,
        api_model: apiModel || null,
        api_request_format: apiRequestFormat,
        api_stream_format: apiStreamFormat,
        timeout_ms: timeoutMs,
      });
      toast.success('Agent config saved');
      setShowAgentConfig(false);
    } catch (err: any) {
      toast.error(err.message || 'Failed to save config');
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
        type: configType,
        cli_cmd: cliCmd || null,
        cli_prompt_mode: cliPromptMode,
        cli_prompt_flag: cliPromptFlag || null,
        api_url: apiUrl || null,
        api_headers: apiHeaders || null,
        api_model: apiModel || null,
        api_request_format: apiRequestFormat,
        api_stream_format: apiStreamFormat,
        timeout_ms: timeoutMs,
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

      <div className="relative w-full max-w-lg max-h-[85vh] bg-bg-raised border border-border rounded-xl shadow-2xl flex flex-col animate-slide-up">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border flex-shrink-0">
          <h2 className="text-sm font-semibold text-text">Agent Configuration</h2>
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

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {loading ? (
            <div className="flex items-center justify-center py-8">
              <div className="w-6 h-6 border-2 border-accent border-t-transparent rounded-full animate-spin-slow" />
            </div>
          ) : (
            <>
              {/* Type tabs */}
              <div className="flex border border-border rounded-lg overflow-hidden">
                <button
                  onClick={() => setConfigType('cli')}
                  className={`flex-1 py-2 text-xs font-medium transition-colors ${
                    configType === 'cli'
                      ? 'bg-accent text-white'
                      : 'bg-bg text-text-muted hover:text-text'
                  }`}
                >
                  CLI
                </button>
                <button
                  onClick={() => setConfigType('api')}
                  className={`flex-1 py-2 text-xs font-medium transition-colors ${
                    configType === 'api'
                      ? 'bg-accent text-white'
                      : 'bg-bg text-text-muted hover:text-text'
                  }`}
                >
                  API
                </button>
              </div>

              {configType === 'cli' ? (
                <>
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

                  {/* Advanced */}
                  <button
                    onClick={() => setShowAdvanced(!showAdvanced)}
                    className="flex items-center gap-1 text-xs text-text-muted hover:text-text transition-colors"
                  >
                    <svg
                      width="12"
                      height="12"
                      viewBox="0 0 12 12"
                      className={`transition-transform ${showAdvanced ? 'rotate-90' : ''}`}
                    >
                      <path d="M4 2l4 4-4 4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                    Advanced
                  </button>

                  {showAdvanced && (
                    <div className="space-y-3 pl-4 border-l-2 border-border">
                      <div>
                        <label className="block text-xs font-semibold text-text-muted mb-1">
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
                          <label className="block text-xs font-semibold text-text-muted mb-1">
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

                      <div>
                        <label className="block text-xs font-semibold text-text-muted mb-1">
                          Timeout (minutes)
                        </label>
                        <input
                          type="number"
                          value={Math.round(timeoutMs / 60000)}
                          onChange={(e) => setTimeoutMs(parseInt(e.target.value) * 60000)}
                          min={1}
                          className="w-24 px-3 py-2 text-sm bg-bg-input border border-border rounded-lg text-text focus:outline-none focus:border-border-focus"
                        />
                      </div>
                    </div>
                  )}
                </>
              ) : (
                <>
                  {/* API config */}
                  <div>
                    <label className="block text-xs font-semibold text-text-muted uppercase tracking-wide mb-1">
                      API URL
                    </label>
                    <input
                      type="text"
                      value={apiUrl}
                      onChange={(e) => setApiUrl(e.target.value)}
                      placeholder="http://localhost:11434/v1/chat/completions"
                      className="w-full px-3 py-2 text-sm font-mono bg-bg-input border border-border rounded-lg text-text placeholder:text-text-dim focus:outline-none focus:border-border-focus transition-colors"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-text-muted uppercase tracking-wide mb-1">
                      Model
                    </label>
                    <input
                      type="text"
                      value={apiModel}
                      onChange={(e) => setApiModel(e.target.value)}
                      placeholder="e.g. gpt-4, llama3"
                      className="w-full px-3 py-2 text-sm bg-bg-input border border-border rounded-lg text-text placeholder:text-text-dim focus:outline-none focus:border-border-focus transition-colors"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-text-muted uppercase tracking-wide mb-1">
                      Headers (JSON)
                    </label>
                    <textarea
                      value={apiHeaders}
                      onChange={(e) => setApiHeaders(e.target.value)}
                      placeholder='{"Authorization": "Bearer sk-..."}'
                      rows={3}
                      className="w-full px-3 py-2 text-sm font-mono bg-bg-input border border-border rounded-lg text-text placeholder:text-text-dim resize-none focus:outline-none focus:border-border-focus transition-colors"
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-semibold text-text-muted mb-1">
                        Request Format
                      </label>
                      <select
                        value={apiRequestFormat}
                        onChange={(e) => setApiRequestFormat(e.target.value)}
                        className="w-full px-3 py-2 text-sm bg-bg-input border border-border rounded-lg text-text focus:outline-none focus:border-border-focus"
                      >
                        <option value="openai">OpenAI-compatible</option>
                        <option value="ollama">Ollama native</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-text-muted mb-1">
                        Stream Format
                      </label>
                      <select
                        value={apiStreamFormat}
                        onChange={(e) => setApiStreamFormat(e.target.value)}
                        className="w-full px-3 py-2 text-sm bg-bg-input border border-border rounded-lg text-text focus:outline-none focus:border-border-focus"
                      >
                        <option value="sse">SSE (data:)</option>
                        <option value="ndjson">NDJSON</option>
                        <option value="none">No streaming</option>
                      </select>
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-text-muted mb-1">
                      Timeout (minutes)
                    </label>
                    <input
                      type="number"
                      value={Math.round(timeoutMs / 60000)}
                      onChange={(e) => setTimeoutMs(parseInt(e.target.value) * 60000)}
                      min={1}
                      className="w-24 px-3 py-2 text-sm bg-bg-input border border-border rounded-lg text-text focus:outline-none focus:border-border-focus"
                    />
                  </div>
                </>
              )}

              {/* Test result */}
              {testResult && (
                <div
                  className={`px-3 py-2 rounded-lg text-xs font-medium border ${
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
            </>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-5 py-4 border-t border-border flex-shrink-0">
          <button
            onClick={handleTest}
            disabled={testing || loading}
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

          <div className="flex gap-2">
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
    </div>
  );
}
