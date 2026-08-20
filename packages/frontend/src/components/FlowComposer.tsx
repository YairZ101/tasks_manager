import { useState } from 'react';
import Button from './Button.js';
import DialogFrame from './DialogFrame.js';
import DialogLayer from './DialogLayer.js';

type FlowComposerProps = {
  onClose(): void;
  onCreate(name: string): Promise<void>;
};

export default function FlowComposer({ onClose, onCreate }: FlowComposerProps) {
  const [name, setName] = useState('Delivery flow');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

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

  return <DialogLayer onDismiss={onClose} dismissDisabled={saving}>
    <DialogFrame className="composer flow-composer" contextLabel="NEW FLOW" title="Name the workflow" closeLabel="Close new Flow" onClose={onClose} closeDisabled={saving} busy={saving} onSubmit={submit} footer={<><Button variant="ghost" disabled={saving} onClick={onClose}>Cancel</Button><Button type="submit" variant="primary" loading={saving} loadingLabel="Creating…" disabled={!name.trim()}>Create Flow</Button></>}>
      <fieldset className="dialog-fields" disabled={saving}>
        <p className="lead">A blank Flow with only a Begin and Completed block will open as a draft. Add the work steps you need, then publish it.</p>
        <label>Flow name<input autoFocus required maxLength={200} value={name} onChange={(event) => setName(event.target.value)} placeholder="For example, Release delivery" aria-describedby={error ? 'flow-name-error' : undefined} /></label>
        {error && <p className="field-error" id="flow-name-error" role="alert">{error}</p>}
        <div className="composer-queue-note"><strong>DRAFT FIRST</strong><span>New Flows are private drafts until you publish a version.</span></div>
      </fieldset>
    </DialogFrame>
  </DialogLayer>;
}
