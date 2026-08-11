import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { api } from '../api/client.js';
import { useAppStore } from '../hooks/useTaskStore.js';
import { AgentPresetPicker, type AgentCliPreset } from './AgentPresetPicker.js';
import { Icon } from './Icon.js';
import type { WorkspaceSetup } from '../api/client.js';

export default function SettingsPanel() {
  const close = useAppStore((state) => state.setSettingsOpen);
  const bootstrap = useAppStore((state) => state.bootstrap);
  const [config, setConfig] = useState<any>({ cli_cmd: '', cli_prompt_mode: 'stdin', cli_prompt_flag: '', timeout_ms: 1800000, max_concurrent_executions: 3 });
  const [workspace, setWorkspace] = useState<WorkspaceSetup>({ setup_command: '', timeout_ms: 600000 });
  const [workspaceSuggestion, setWorkspaceSuggestion] = useState('');
  const [testing, setTesting] = useState(false);
  const [testingWorkspace, setTestingWorkspace] = useState(false);
  const [workspaceTest, setWorkspaceTest] = useState<{ success: boolean; output: string; error?: string } | null>(null);
  useEffect(() => {
    void Promise.all([api.getAgentConfig(), api.getWorkspaceConfig()]).then(([agent, setup]) => {
      setConfig(agent.config);
      setWorkspace({ setup_command: setup.config.setup_command ?? '', timeout_ms: setup.config.timeout_ms });
      setWorkspaceSuggestion(setup.suggestedCommand);
    });
  }, []);
  const save = async () => { await Promise.all([api.updateAgentConfig(config), api.updateWorkspaceConfig(workspace)]); await bootstrap(); close(false); toast.success('Execution settings saved.'); };
  const test = async () => { setTesting(true); try { const result = await api.testAgentConfig(); result.success ? toast.success(`Agent responded in ${result.durationMs}ms.`) : toast.error(result.error); } finally { setTesting(false); } };
  const testWorkspace = async () => {
    setTestingWorkspace(true);
    setWorkspaceTest(null);
    try {
      const result = await api.testWorkspaceConfig(workspace);
      setWorkspaceTest(result);
      result.success ? toast.success('Workspace setup passed in a temporary worktree.') : toast.error(result.error);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Could not test workspace setup.';
      setWorkspaceTest({ success: false, output: '', error: message });
      toast.error(message);
    } finally { setTestingWorkspace(false); }
  };
  const applyPreset = (preset: AgentCliPreset) => setConfig({ ...config, cli_cmd: preset.cli_cmd, cli_prompt_mode: preset.cli_prompt_mode, cli_prompt_flag: preset.cli_prompt_flag ?? '' });
  return <div className="modal-layer" onMouseDown={(e) => e.target === e.currentTarget && close(false)}><div className="settings-panel">
    <header><div><span className="eyebrow">RUNTIME</span><h2>Execution settings</h2></div><button className="icon-button" aria-label="Close settings" onClick={() => close(false)}><Icon name="close" /></button></header>
    <p className="lead">One CLI agent powers every Agent block. Each block contributes its own compiled instructions.</p>
    <AgentPresetPicker value={config} onSelect={applyPreset} />
    <label>CLI command<input value={config.cli_cmd ?? ''} onChange={(e) => setConfig({ ...config, cli_cmd: e.target.value })} placeholder="codex exec --full-auto" /></label>
    <div className="field-grid"><label>Prompt delivery<select value={config.cli_prompt_mode} onChange={(e) => setConfig({ ...config, cli_prompt_mode: e.target.value })}><option value="stdin">Standard input</option><option value="argument">Final argument</option><option value="flag">Named flag</option></select></label><label>Prompt flag<input value={config.cli_prompt_flag ?? ''} disabled={config.cli_prompt_mode !== 'flag'} onChange={(e) => setConfig({ ...config, cli_prompt_flag: e.target.value })} placeholder="--prompt" /></label></div>
    <div className="field-grid"><label>Timeout (minutes)<input type="number" min="1" value={Math.round(config.timeout_ms / 60000)} onChange={(e) => setConfig({ ...config, timeout_ms: Number(e.target.value) * 60000 })} /></label><label>Concurrent executions<input type="number" min="1" max="10" value={config.max_concurrent_executions} onChange={(e) => setConfig({ ...config, max_concurrent_executions: Number(e.target.value) })} /></label></div>
    <div className="settings-note"><Icon name="branch" /><div><strong>One shared capacity pool</strong><p>Agent and Check blocks count against the same limit. Non-Git projects safely fall back to one execution.</p></div></div>
    <section className="workspace-setup-settings">
      <header><div><h3>Workspace preparation</h3><p>Runs in the task worktree before every Run. Leave the command empty to disable it.</p></div><button type="button" className="button ghost" onClick={() => void testWorkspace()} disabled={testingWorkspace || !workspace.setup_command.trim()}>{testingWorkspace ? 'Testing setup…' : 'Test setup'}</button></header>
      <label>Setup command<input value={workspace.setup_command} onChange={(event) => { setWorkspace({ ...workspace, setup_command: event.target.value }); setWorkspaceTest(null); }} placeholder={workspaceSuggestion || 'bun install --frozen-lockfile'} /></label>
      {!workspace.setup_command && workspaceSuggestion ? <button type="button" className="suggested-setup" onClick={() => setWorkspace({ ...workspace, setup_command: workspaceSuggestion })}>Use detected command · <code>{workspaceSuggestion}</code></button> : null}
      <label>Setup timeout (minutes)<input type="number" min="1" max="60" value={Math.round(workspace.timeout_ms / 60000)} onChange={(event) => setWorkspace({ ...workspace, timeout_ms: Number(event.target.value) * 60000 })} /></label>
      {workspaceTest ? <div className={`workspace-test-output ${workspaceTest.success ? 'success' : 'failure'}`} role="status"><strong>{workspaceTest.success ? 'Temporary worktree passed' : 'Setup test failed'}</strong>{(workspaceTest.output || workspaceTest.error) ? <pre>{workspaceTest.output || workspaceTest.error}</pre> : null}</div> : null}
    </section>
    <footer><button className="button ghost" onClick={test} disabled={testing || !config.cli_cmd}>{testing ? 'Testing…' : 'Test agent'}</button><button className="button primary" onClick={save}>Save settings</button></footer>
  </div></div>;
}
