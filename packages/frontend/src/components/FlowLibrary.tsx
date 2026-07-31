import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { api } from '../api/client.js';
import type { Flow } from '../domain.js';
import { useAppStore } from '../hooks/useTaskStore.js';
import ConfirmDialog from './ConfirmDialog.js';
import FlowComposer from './FlowComposer.js';
import { BlockIcon, Icon } from './Icon.js';

export default function FlowLibrary() {
  const { flows, editFlow, refreshFlows } = useAppStore();
  const [createOpen, setCreateOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Flow | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [editingNameFor, setEditingNameFor] = useState<number | null>(null);
  const [nameDraft, setNameDraft] = useState('');
  const [renaming, setRenaming] = useState(false);
  const nameInputRef = useRef<HTMLInputElement | null>(null);
  useEffect(() => {
    if (editingNameFor === null) return;
    const frame = requestAnimationFrame(() => {
      nameInputRef.current?.focus();
      nameInputRef.current?.select();
    });
    return () => cancelAnimationFrame(frame);
  }, [editingNameFor]);
  const create = async (name: string) => {
    const { flow } = await api.createFlow(name);
    editFlow(flow.id);
    void refreshFlows().catch((error) => {
      toast.error(error instanceof Error ? `Flow created, but the library could not refresh: ${error.message}` : 'Flow created, but the library could not refresh.');
    });
  };
  const remove = async () => {
    if (!deleteTarget || deleting) return;
    setDeleting(true);
    try {
      await api.deleteFlow(deleteTarget.id);
      setDeleteTarget(null);
      await refreshFlows();
      toast.success(`Deleted ${deleteTarget.name}.`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not delete the Flow.');
    } finally {
      setDeleting(false);
    }
  };
  const beginRename = (flow: Flow) => {
    setNameDraft(flow.name);
    setEditingNameFor(flow.id);
  };
  const cancelRename = () => {
    setEditingNameFor(null);
    setNameDraft('');
  };
  const commitRename = async (flow: Flow) => {
    if (renaming) return;
    const name = nameDraft.trim();
    if (!name) { toast.error('Flow name is required.'); setNameDraft(flow.name); return; }
    if (name === flow.name) { cancelRename(); return; }
    setRenaming(true);
    try {
      const result = await api.updateFlow(flow.id, { name });
      useAppStore.setState((state) => ({ flows: state.flows.map((item) => item.id === flow.id ? { ...item, ...result.flow } : item) }));
      cancelRename();
      await refreshFlows();
      toast.success('Flow name updated.');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not update the Flow name.');
    } finally {
      setRenaming(false);
    }
  };
  return <div className="flow-library">
    <div className="library-intro"><div><span className="eyebrow">VERSIONED AUTOMATION</span><h2>Design how outcomes happen.</h2><p>Tasks stay simple. Flows hold the logic—agents, checks, human decisions, and explicit results.</p></div><button className="button primary" onClick={() => setCreateOpen(true)}><Icon name="plus" />New Flow</button></div>
    <div className="flow-grid">
      {flows.map((flow) => <article key={flow.id} className="flow-card">
        <div className="flow-card-top"><span className="flow-symbol"><Icon name="nodes" size={21} /></span><div>{flow.is_default ? <span className="default-badge">DEFAULT</span> : <span className="muted-badge">FLOW</span>}<h3>{editingNameFor === flow.id ? <input ref={nameInputRef} className="library-flow-name-input" aria-label={`Flow name for ${flow.name}`} value={nameDraft} disabled={renaming} onChange={(event) => setNameDraft(event.target.value)} onBlur={() => void commitRename(flow)} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); event.currentTarget.blur(); } if (event.key === 'Escape') { event.preventDefault(); cancelRename(); } }} /> : <button type="button" className="library-flow-name-button" aria-label={`Rename flow ${flow.name}`} title="Rename flow" onClick={() => beginRename(flow)}><span>{flow.name}</span><Icon name="edit" size={13} /></button>}</h3></div></div>
        <button type="button" className="flow-card-open" onClick={() => editFlow(flow.id)} aria-label={`Edit ${flow.name}`}>
          <div className="flow-mini">
            {(flow.activeVersion?.definition.nodes ?? []).filter((node) => node.type !== 'note').slice(0, 7).map((node, index) => <span key={node.id} className={node.type} data-block-icon={node.type}>{index > 0 && <i />}<BlockIcon type={node.type} /></span>)}
          </div>
          <div className="flow-stats"><span><strong>{flow.activeVersion?.definition.nodes.filter((node) => node.type !== 'note').length ?? 0}</strong> blocks</span><span><strong>{flow.activeVersion ? `v${flow.activeVersion.version}` : '—'}</strong> published</span></div>
        </button>
        <footer><div className="flow-card-actions"><button className="text-danger" disabled={Boolean(flow.is_default)} title={flow.is_default ? 'Set another published Flow as default before deleting this one.' : undefined} onClick={() => setDeleteTarget(flow)}><Icon name="trash" size={15} />Delete Flow</button></div>{!flow.is_default && flow.active_version_id && <button className="text-button" onClick={async () => { await api.makeDefault(flow.id); await refreshFlows(); toast.success('Default Flow updated.'); }}>Make default</button>}</footer>
      </article>)}
      <button className="flow-card add-flow" onClick={() => setCreateOpen(true)}><span><Icon name="plus" size={25} /></span><strong>Create another Flow</strong><small>Start from the recommended delivery graph</small></button>
    </div>
    {createOpen && <FlowComposer onClose={() => setCreateOpen(false)} onCreate={create} />}
    {deleteTarget && <ConfirmDialog title={`Delete ${deleteTarget.name}?`} message="This permanently deletes the Flow and its versions. Flows with run history cannot be deleted." confirmLabel="Delete flow" destructive disabled={deleting} onConfirm={() => void remove()} onCancel={() => !deleting && setDeleteTarget(null)} />}
  </div>;
}
