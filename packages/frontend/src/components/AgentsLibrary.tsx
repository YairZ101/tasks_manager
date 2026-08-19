import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import type { AgentPreset } from '../domain.js';
import { api } from '../api/client.js';
import Button from './Button.js';
import { Icon } from './Icon.js';
import PageHeader from './PageHeader.js';
import PageHeaderAction from './PageHeaderAction.js';

type PresetDraft = Pick<AgentPreset, 'name' | 'description' | 'system_prompt'>;

const emptyDraft: PresetDraft = {
  name: '',
  description: '',
  system_prompt: '',
};

function toDraft(preset: AgentPreset): PresetDraft {
  return {
    name: preset.name,
    description: preset.description,
    system_prompt: preset.system_prompt,
  };
}

const ignoreDirtyChange = (_dirty: boolean) => {};
const noop = () => {};

export default function AgentsLibrary({ onDirtyChange = ignoreDirtyChange, focusPresetKey = null, onFocusConsumed = noop }: { onDirtyChange?: (dirty: boolean) => void; focusPresetKey?: string | null; onFocusConsumed?: () => void }) {
  const [presets, setPresets] = useState<AgentPreset[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [draft, setDraft] = useState<PresetDraft>(emptyDraft);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const selected = useMemo(() => presets.find((preset) => preset.id === selectedId) ?? null, [presets, selectedId]);
  const dirty = selected
    ? JSON.stringify(draft) !== JSON.stringify(toDraft(selected))
    : draft.name !== '' || draft.system_prompt !== '' || draft.description !== '';

  useEffect(() => {
    onDirtyChange(dirty);
  }, [dirty, onDirtyChange]);

  useEffect(() => () => onDirtyChange(false), [onDirtyChange]);

  useEffect(() => {
    if (!dirty) return;
    const protectDraft = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', protectDraft);
    return () => window.removeEventListener('beforeunload', protectDraft);
  }, [dirty]);

  useEffect(() => {
    let cancelled = false;
    void api.listAgentPresets().then(({ presets: loaded }) => {
      if (cancelled) return;
      setPresets(loaded);
      // Prefer the preset the user came to edit (from an Agent block); fall back to the first.
      const initial = loaded.find((preset) => preset.preset_key === focusPresetKey) ?? loaded[0];
      if (initial) {
        setSelectedId(initial.id);
        setDraft(toDraft(initial));
      }
    }).catch((error) => {
      if (!cancelled) toast.error(error instanceof Error ? error.message : 'Could not load Agent presets.');
    }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
    // Runs once on mount; focusPresetKey is captured here (the component remounts on each navigation to Agents).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    // Wait until presets are loaded before matching, so the focus key is not consumed prematurely.
    if (!focusPresetKey || !presets.length) return;
    const match = presets.find((preset) => preset.preset_key === focusPresetKey);
    if (match) {
      setSelectedId(match.id);
      setDraft(toDraft(match));
    }
    onFocusConsumed();
  }, [focusPresetKey, presets, onFocusConsumed]);

  const choosePreset = (preset: AgentPreset) => {
    if (dirty && !window.confirm('Discard unsaved changes to this Agent preset?')) return;
    setSelectedId(preset.id);
    setDraft(toDraft(preset));
  };

  const startNew = () => {
    if (dirty && !window.confirm('Discard unsaved changes to this Agent preset?')) return;
    setSelectedId(null);
    setDraft(emptyDraft);
  };

  const save = async () => {
    if (!draft.name.trim()) { toast.error('Agent name is required.'); return; }
    if (!draft.system_prompt.trim()) { toast.error('System prompt is required.'); return; }
    setSaving(true);
    try {
      const result = selected
        ? await api.updateAgentPreset(selected.id, draft)
        : await api.createAgentPreset(draft);
      setPresets((current) => [...current.filter((preset) => preset.id !== result.preset.id), result.preset].sort((a, b) => a.name.localeCompare(b.name)));
      setSelectedId(result.preset.id);
      setDraft(toDraft(result.preset));
      toast.success(selected ? 'Agent preset updated.' : 'Agent preset created.');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not save the Agent preset.');
    } finally { setSaving(false); }
  };

  const remove = async () => {
    if (!selected || !window.confirm(`Delete “${selected.name}”? Flows still using this agent must switch to another first.`)) return;
    setDeleting(true);
    try {
      await api.deleteAgentPreset(selected.id);
      const remaining = presets.filter((preset) => preset.id !== selected.id);
      setPresets(remaining);
      setSelectedId(remaining[0]?.id ?? null);
      setDraft(remaining[0] ? toDraft(remaining[0]) : emptyDraft);
      toast.success('Agent preset deleted.');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not delete the Agent preset.');
    } finally { setDeleting(false); }
  };

  return <section className="agents-library" aria-labelledby="agents-library-title">
    <PageHeader title="Agents" titleId="agents-library-title" description="Create reusable Agent presets.">
      <PageHeaderAction label="New agent" onClick={startNew} />
    </PageHeader>

    <div className="agents-library-content"><div className="agent-studio">
      <aside className="agent-roster" aria-label="Agent presets">
        <div className="agent-roster-head"><strong>Preset roster</strong><span>{presets.length.toString().padStart(2, '0')}</span></div>
        <div className="agent-roster-list">
          {loading ? <div className="agent-roster-empty">Loading Agent presets…</div> : presets.length ? presets.map((preset, index) => <button
            key={preset.id}
            type="button"
            className={preset.id === selectedId ? 'selected' : ''}
            aria-pressed={preset.id === selectedId}
            onClick={() => choosePreset(preset)}
          >
            <span className="agent-roster-index">{String(index + 1).padStart(2, '0')}</span>
            <span className="agent-roster-glyph"><Icon name="agent" size={18} /></span>
            <span className="agent-roster-copy"><strong>{preset.name}</strong><small>{preset.description || 'No description'}</small></span>
          </button>) : <div className="agent-roster-empty"><Icon name="agent" size={24} /><strong>No presets yet</strong><span>Create an Agent to make it available in Flow blocks.</span></div>}
        </div>
      </aside>

      <form className="agent-configurator" onSubmit={(event) => { event.preventDefault(); void save(); }}>
        <header>
          <span className="agent-config-glyph"><Icon name="agent" size={28} /></span>
          <div><span className="eyebrow">{selected ? `PRESET / ${selected.preset_key}` : 'NEW PRESET'}</span><h3>{draft.name || 'Untitled Agent'}</h3></div>
          <span className={`agent-edit-state ${dirty ? 'dirty' : ''}`}>{dirty ? 'Unsaved' : 'Saved'}</span>
        </header>
        <div className="agent-config-scroll">
          <section className="agent-config-section" aria-labelledby="agent-identity-label">
            <div className="agent-section-label"><span>01</span><div><strong id="agent-identity-label">Identity</strong><small>How this preset appears in the Agent block picker.</small></div></div>
            <label>Agent name<input value={draft.name} maxLength={120} placeholder="Release engineer" onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))} /></label>
            <label>Description<textarea className="agent-description" value={draft.description} maxLength={500} placeholder="What should this Agent handle?" onChange={(event) => setDraft((current) => ({ ...current, description: event.target.value }))} /></label>
          </section>
          <section className="agent-config-section prompt-section" aria-label="System prompt configuration">
            <div className="agent-section-label"><span>02</span><div><strong id="agent-prompt-label">System prompt</strong><small>The standing instructions copied into each Agent block.</small></div><em>{draft.system_prompt.length.toLocaleString()} chars</em></div>
            <label className="prompt-field"><span className="sr-only">System prompt</span><textarea className="mono" value={draft.system_prompt} maxLength={50_000} placeholder="Define the Agent’s role, method, constraints, and completion criteria…" onChange={(event) => setDraft((current) => ({ ...current, system_prompt: event.target.value }))} /></label>
          </section>
        </div>
        <footer>
          <div>{selected && <Button variant="text" tone="danger" icon="trash" iconSize={14} loading={deleting} loadingLabel="Deleting…" onClick={() => void remove()}>Delete preset</Button>}</div>
          <Button type="submit" variant="primary" loading={saving} loadingLabel="Saving…" disabled={!dirty}>{selected ? 'Save changes' : 'Create Agent'}</Button>
        </footer>
      </form>
    </div></div>
  </section>;
}
