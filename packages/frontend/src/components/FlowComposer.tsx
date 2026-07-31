import { useEffect, useState } from 'react';
import { Icon } from './Icon.js';

type FlowComposerProps = {
  onClose(): void;
  onCreate(name: string): Promise<void>;
};

export default function FlowComposer({ onClose, onCreate }: FlowComposerProps) {
  const [name, setName] = useState('Delivery flow');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !saving) onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose, saving]);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    const trimmedName = name.trim();
    if (!trimmedName) return;
    setSaving(true);
    setError(null);
    try {
      await onCreate(trimmedName);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not create the Flow. Try again.');
      setSaving(false);
    }
  };

  return <div className="modal-layer" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && !saving && onClose()}>
    <form className="composer flow-composer" role="dialog" aria-modal="true" aria-labelledby="new-flow-title" onSubmit={submit}>
      <header>
        <div><span className="eyebrow">NEW FLOW</span><h2 id="new-flow-title">Name the workflow</h2></div>
        <button type="button" className="icon-button" aria-label="Close new Flow" disabled={saving} onClick={onClose}><Icon name="close" /></button>
      </header>
      <p className="lead">A blank Flow with only a Begin and Completed block will open as a draft. Add the work steps you need, then publish it.</p>
      <label>Flow name<input autoFocus required maxLength={200} value={name} onChange={(event) => setName(event.target.value)} placeholder="For example, Release delivery" aria-describedby={error ? 'flow-name-error' : undefined} /></label>
      {error && <p className="field-error" id="flow-name-error" role="alert">{error}</p>}
      <div className="composer-queue-note"><strong>DRAFT FIRST</strong><span>New Flows are private drafts until you publish a version.</span></div>
      <footer><button type="button" className="button ghost" disabled={saving} onClick={onClose}>Cancel</button><button className="button primary" disabled={saving || !name.trim()}>{saving ? 'Creating…' : 'Create Flow'}</button></footer>
    </form>
  </div>;
}
