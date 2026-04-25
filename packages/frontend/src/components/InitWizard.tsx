import { useState, useEffect } from 'react';
import { toast } from 'sonner';
import { useAppStore } from '../hooks/useTaskStore.js';
import { api } from '../api/client.js';

type WizardStep = 'agent-config' | 'test' | 'prefix' | 'manual-prefix';

const PRESETS = [
  { label: 'Crush', cli_cmd: 'crush run', cli_prompt_mode: 'argument', cli_prompt_flag: null },
  { label: 'Claude Code', cli_cmd: 'claude', cli_prompt_mode: 'flag', cli_prompt_flag: '--print -p' },
  { label: 'Aider', cli_cmd: 'aider', cli_prompt_mode: 'flag', cli_prompt_flag: '--message' },
  { label: 'Codex', cli_cmd: 'codex', cli_prompt_mode: 'argument', cli_prompt_flag: null },
] as const;

export default function InitWizard() {
  const { checkStatus, repoName } = useAppStore();
  const [step, setStep] = useState<WizardStep>('agent-config');

  // Agent config
  const [configType, setConfigType] = useState<'cli' | 'api'>('cli');
  const [cliCmd, setCliCmd] = useState('crush run');
  const [cliPromptMode, setCliPromptMode] = useState('argument');
  const [cliPromptFlag, setCliPromptFlag] = useState('');
  const [apiUrl, setApiUrl] = useState('');
  const [apiModel, setApiModel] = useState('');
  const [apiHeaders, setApiHeaders] = useState('');
  const [showAdvanced, setShowAdvanced] = useState(false);

  // Test
  const [testing, setTesting] = useState(false);
  const [testPassed, setTestPassed] = useState(false);
  const [testError, setTestError] = useState('');

  // Prefix
  const [generating, setGenerating] = useState(false);
  const [generatedPrefix, setGeneratedPrefix] = useState('');
  const [manualPrefix, setManualPrefix] = useState('');
  const [savingPrefix, setSavingPrefix] = useState(false);
  const [prefixError, setPrefixError] = useState('');

  // Check if agent config already exists (partial init)
  useEffect(() => {
    async function checkPartialInit() {
      try {
        const data = await api.getAgentConfig();
        if (data.config?.cli_cmd || data.config?.api_url) {
          setStep('test');
          if (data.config.type) setConfigType(data.config.type);
          if (data.config.cli_cmd) setCliCmd(data.config.cli_cmd);
          if (data.config.cli_prompt_mode) setCliPromptMode(data.config.cli_prompt_mode);
          if (data.config.cli_prompt_flag) setCliPromptFlag(data.config.cli_prompt_flag);
          if (data.config.api_url) setApiUrl(data.config.api_url);
        }
      } catch {
        // Fresh start
      }
    }
    checkPartialInit();
  }, []);

  const saveConfig = async () => {
    try {
      await api.updateAgentConfig({
        type: configType,
        cli_cmd: cliCmd || null,
        cli_prompt_mode: cliPromptMode,
        cli_prompt_flag: cliPromptFlag || null,
        api_url: apiUrl || null,
        api_headers: apiHeaders || null,
        api_model: apiModel || null,
      });
      return true;
    } catch (err: any) {
      toast.error(err.message || 'Failed to save config');
      return false;
    }
  };

  const handleTest = async () => {
    setTesting(true);
    setTestError('');
    setTestPassed(false);

    const saved = await saveConfig();
    if (!saved) {
      setTesting(false);
      return;
    }

    try {
      const result = await api.testAgentConfig();
      if (result.success) {
        setTestPassed(true);
      } else {
        setTestError(result.error || 'Connection test failed');
      }
    } catch (err: any) {
      setTestError(err.message || 'Connection test failed');
    } finally {
      setTesting(false);
    }
  };

  const handleGeneratePrefix = async () => {
    setGenerating(true);
    setPrefixError('');

    try {
      const result = await api.generatePrefix(repoName || 'project');
      setGeneratedPrefix(result.prefix);
    } catch (err: any) {
      setPrefixError(err.data?.error || err.message || 'Failed to generate prefix');
      setStep('manual-prefix');
    } finally {
      setGenerating(false);
    }
  };

  const handleSavePrefix = async (prefix: string) => {
    setSavingPrefix(true);
    try {
      await api.savePrefix(prefix);
      await checkStatus();
    } catch (err: any) {
      toast.error(err.data?.error || err.message || 'Failed to save prefix');
    } finally {
      setSavingPrefix(false);
    }
  };

  const handleProceedToPrefix = () => {
    setStep('prefix');
    handleGeneratePrefix();
  };

  return (
    <div className="flex items-center justify-center min-h-screen bg-bg p-6">
      <div className="w-full max-w-lg">
        {/* Logo / Title */}
        <div className="text-center mb-8">
          <div className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-accent-dim flex items-center justify-center">
            <svg width="28" height="28" viewBox="0 0 28 28" fill="none">
              <rect x="2" y="2" width="7" height="24" rx="2" stroke="var(--color-accent)" strokeWidth="1.5" />
              <rect x="10.5" y="2" width="7" height="24" rx="2" stroke="var(--color-accent)" strokeWidth="1.5" />
              <rect x="19" y="2" width="7" height="24" rx="2" stroke="var(--color-accent)" strokeWidth="1.5" />
            </svg>
          </div>
          <h1 className="text-xl font-bold text-text">Tasks Manager</h1>
          <p className="text-sm text-text-muted mt-1">Set up your AI agent to get started</p>
        </div>

        {/* Steps indicator */}
        <div className="flex items-center justify-center gap-2 mb-8">
          {['Agent Setup', 'Test', 'Project Key'].map((label, i) => {
            const stepIndex = i;
            const currentIndex = step === 'agent-config' ? 0 : step === 'test' ? 1 : 2;
            const isActive = stepIndex === currentIndex;
            const isDone = stepIndex < currentIndex;

            return (
              <div key={label} className="flex items-center gap-2">
                {i > 0 && (
                  <div className={`w-8 h-px ${isDone ? 'bg-accent' : 'bg-border'}`} />
                )}
                <div className="flex items-center gap-1.5">
                  <div
                    className={`w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold ${
                      isActive
                        ? 'bg-accent text-white'
                        : isDone
                        ? 'bg-success text-white'
                        : 'bg-bg-card text-text-dim border border-border'
                    }`}
                  >
                    {isDone ? '✓' : i + 1}
                  </div>
                  <span className={`text-xs ${isActive ? 'text-text font-medium' : 'text-text-dim'}`}>
                    {label}
                  </span>
                </div>
              </div>
            );
          })}
        </div>

        {/* Step content */}
        <div className="bg-bg-raised border border-border rounded-xl p-6 animate-slide-up">
          {step === 'agent-config' && (
            <div className="space-y-4">
              <h2 className="text-sm font-semibold text-text">Configure your agent</h2>

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
                  CLI Tool
                </button>
                <button
                  onClick={() => setConfigType('api')}
                  className={`flex-1 py-2 text-xs font-medium transition-colors ${
                    configType === 'api'
                      ? 'bg-accent text-white'
                      : 'bg-bg text-text-muted hover:text-text'
                  }`}
                >
                  API Endpoint
                </button>
              </div>

              {configType === 'cli' ? (
                <>
                  {/* Presets */}
                  <div className="flex flex-wrap gap-1.5">
                    {PRESETS.map((preset) => (
                      <button
                        key={preset.label}
                        onClick={() => {
                          setCliCmd(preset.cli_cmd);
                          setCliPromptMode(preset.cli_prompt_mode);
                          setCliPromptFlag(preset.cli_prompt_flag || '');
                        }}
                        className={`px-2.5 py-1 text-xs font-medium rounded-md border transition-colors ${
                          cliCmd === preset.cli_cmd
                            ? 'border-accent text-accent bg-accent-dim'
                            : 'border-border text-text-muted hover:text-text hover:bg-bg-hover'
                        }`}
                      >
                        {preset.label}
                      </button>
                    ))}
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-text-muted mb-1">Command</label>
                    <input
                      type="text"
                      value={cliCmd}
                      onChange={(e) => setCliCmd(e.target.value)}
                      placeholder="e.g. claude"
                      className="w-full px-3 py-2 text-sm font-mono bg-bg-input border border-border rounded-lg text-text placeholder:text-text-dim focus:outline-none focus:border-border-focus transition-colors"
                    />
                  </div>

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
                        <label className="block text-xs font-semibold text-text-muted mb-1">Prompt Mode</label>
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
                          <label className="block text-xs font-semibold text-text-muted mb-1">Prompt Flag</label>
                          <input
                            type="text"
                            value={cliPromptFlag}
                            onChange={(e) => setCliPromptFlag(e.target.value)}
                            placeholder="e.g. --message"
                            className="w-full px-3 py-2 text-sm font-mono bg-bg-input border border-border rounded-lg text-text placeholder:text-text-dim focus:outline-none focus:border-border-focus transition-colors"
                          />
                        </div>
                      )}
                    </div>
                  )}
                </>
              ) : (
                <>
                  <div>
                    <label className="block text-xs font-semibold text-text-muted mb-1">API URL</label>
                    <input
                      type="text"
                      value={apiUrl}
                      onChange={(e) => setApiUrl(e.target.value)}
                      placeholder="http://localhost:11434/v1/chat/completions"
                      className="w-full px-3 py-2 text-sm font-mono bg-bg-input border border-border rounded-lg text-text placeholder:text-text-dim focus:outline-none focus:border-border-focus transition-colors"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-text-muted mb-1">Model</label>
                    <input
                      type="text"
                      value={apiModel}
                      onChange={(e) => setApiModel(e.target.value)}
                      placeholder="e.g. gpt-4"
                      className="w-full px-3 py-2 text-sm bg-bg-input border border-border rounded-lg text-text placeholder:text-text-dim focus:outline-none focus:border-border-focus transition-colors"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-text-muted mb-1">Headers (JSON)</label>
                    <textarea
                      value={apiHeaders}
                      onChange={(e) => setApiHeaders(e.target.value)}
                      placeholder='{"Authorization": "Bearer sk-..."}'
                      rows={2}
                      className="w-full px-3 py-2 text-sm font-mono bg-bg-input border border-border rounded-lg text-text placeholder:text-text-dim resize-none focus:outline-none focus:border-border-focus transition-colors"
                    />
                  </div>
                </>
              )}

              <button
                onClick={() => setStep('test')}
                disabled={configType === 'cli' ? !cliCmd : !apiUrl}
                className="w-full py-2.5 bg-accent hover:bg-accent-hover text-white text-sm font-medium rounded-lg transition-colors disabled:opacity-30"
              >
                Continue
              </button>
            </div>
          )}

          {step === 'test' && (
            <div className="space-y-4">
              <h2 className="text-sm font-semibold text-text">Test your agent connection</h2>
              <p className="text-xs text-text-muted">
                We&apos;ll send a quick test prompt to make sure your agent is reachable.
              </p>

              {testError && (
                <div className="px-3 py-2 bg-danger-dim border border-danger/20 rounded-lg text-xs text-danger">
                  {testError}
                </div>
              )}

              {testPassed && (
                <div className="px-3 py-2 bg-success-dim border border-success/20 rounded-lg text-xs text-success">
                  Connection test passed!
                </div>
              )}

              <div className="flex gap-2">
                <button
                  onClick={() => setStep('agent-config')}
                  className="px-4 py-2.5 text-sm font-medium text-text-muted hover:text-text hover:bg-bg-hover rounded-lg transition-colors"
                >
                  Back
                </button>
                {testPassed ? (
                  <button
                    onClick={handleProceedToPrefix}
                    className="flex-1 py-2.5 bg-accent hover:bg-accent-hover text-white text-sm font-medium rounded-lg transition-colors"
                  >
                    Continue
                  </button>
                ) : (
                  <button
                    onClick={handleTest}
                    disabled={testing}
                    className="flex-1 py-2.5 bg-accent hover:bg-accent-hover text-white text-sm font-medium rounded-lg transition-colors disabled:opacity-60"
                  >
                    {testing ? (
                      <span className="flex items-center justify-center gap-2">
                        <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin-slow" />
                        Testing...
                      </span>
                    ) : (
                      'Test Connection'
                    )}
                  </button>
                )}
              </div>
            </div>
          )}

          {step === 'prefix' && (
            <div className="space-y-4">
              <h2 className="text-sm font-semibold text-text">Project Key</h2>
              <p className="text-xs text-text-muted">
                Your AI agent is generating a short project key for task IDs (like JIRA).
              </p>

              {generating ? (
                <div className="flex items-center justify-center py-8">
                  <div className="flex flex-col items-center gap-3">
                    <div className="w-8 h-8 border-2 border-accent border-t-transparent rounded-full animate-spin-slow" />
                    <span className="text-xs text-text-muted">Generating prefix...</span>
                  </div>
                </div>
              ) : generatedPrefix ? (
                <>
                  <div className="flex items-center justify-center py-6">
                    <span className="text-3xl font-bold font-mono text-accent tracking-widest">
                      {generatedPrefix}
                    </span>
                  </div>
                  <p className="text-xs text-text-dim text-center">
                    Tasks will be named {generatedPrefix}-1, {generatedPrefix}-2, etc.
                  </p>

                  <div className="flex gap-2">
                    <button
                      onClick={() => setStep('manual-prefix')}
                      className="px-4 py-2.5 text-sm font-medium text-text-muted hover:text-text hover:bg-bg-hover rounded-lg transition-colors"
                    >
                      Change
                    </button>
                    <button
                      onClick={() => handleSavePrefix(generatedPrefix)}
                      disabled={savingPrefix}
                      className="flex-1 py-2.5 bg-accent hover:bg-accent-hover text-white text-sm font-medium rounded-lg transition-colors disabled:opacity-60"
                    >
                      {savingPrefix ? 'Setting up...' : 'Use this prefix'}
                    </button>
                  </div>
                </>
              ) : (
                <>
                  {prefixError && (
                    <div className="px-3 py-2 bg-danger-dim border border-danger/20 rounded-lg text-xs text-danger">
                      {prefixError}
                    </div>
                  )}
                  <button
                    onClick={handleGeneratePrefix}
                    className="w-full py-2.5 bg-accent hover:bg-accent-hover text-white text-sm font-medium rounded-lg transition-colors"
                  >
                    Try Again
                  </button>
                </>
              )}
            </div>
          )}

          {step === 'manual-prefix' && (
            <div className="space-y-4">
              <h2 className="text-sm font-semibold text-text">Enter Project Key</h2>
              <p className="text-xs text-text-muted">
                Enter 1-5 uppercase letters or numbers for your task prefix.
              </p>

              <input
                type="text"
                value={manualPrefix}
                onChange={(e) => setManualPrefix(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').substring(0, 5))}
                placeholder="e.g. PROJ"
                maxLength={5}
                className="w-full px-3 py-2 text-lg font-mono font-bold text-center bg-bg-input border border-border rounded-lg text-text placeholder:text-text-dim focus:outline-none focus:border-border-focus tracking-widest transition-colors"
              />

              {manualPrefix && (
                <p className="text-xs text-text-dim text-center">
                  Tasks: {manualPrefix}-1, {manualPrefix}-2, etc.
                </p>
              )}

              <div className="flex gap-2">
                <button
                  onClick={() => {
                    setStep('prefix');
                    if (!generatedPrefix) handleGeneratePrefix();
                  }}
                  className="px-4 py-2.5 text-sm font-medium text-text-muted hover:text-text hover:bg-bg-hover rounded-lg transition-colors"
                >
                  Back
                </button>
                <button
                  onClick={() => handleSavePrefix(manualPrefix)}
                  disabled={!manualPrefix || savingPrefix}
                  className="flex-1 py-2.5 bg-accent hover:bg-accent-hover text-white text-sm font-medium rounded-lg transition-colors disabled:opacity-30"
                >
                  {savingPrefix ? 'Setting up...' : 'Continue'}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
