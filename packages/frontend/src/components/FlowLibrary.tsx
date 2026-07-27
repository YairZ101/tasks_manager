import { useState } from 'react';
import { toast } from 'sonner';
import { api } from '../api/client.js';
import { useAppStore } from '../hooks/useTaskStore.js';
import { Icon } from './Icon.js';

export default function FlowLibrary() {
  const { flows, editFlow, refreshFlows } = useAppStore();
  const [creating, setCreating] = useState(false);
  const create = async () => {
    const name = window.prompt('Name this Flow', 'Delivery flow');
    if (!name?.trim()) return;
    setCreating(true);
    try { const { flow } = await api.createFlow(name); await refreshFlows(); editFlow(flow.id); }
    catch (error) { toast.error(error instanceof Error ? error.message : 'Could not create Flow.'); }
    finally { setCreating(false); }
  };
  return <div className="flow-library">
    <div className="library-intro"><div><span className="eyebrow">VERSIONED AUTOMATION</span><h2>Design how outcomes happen.</h2><p>Tasks stay simple. Flows hold the logic—agents, checks, human decisions, and explicit results.</p></div><button className="button primary" onClick={create} disabled={creating}><Icon name="plus" />New Flow</button></div>
    <div className="flow-grid">
      {flows.map((flow) => <article key={flow.id} className="flow-card">
        <div className="flow-card-top"><span className="flow-symbol"><Icon name="nodes" size={21} /></span><div>{flow.is_default ? <span className="default-badge">DEFAULT</span> : <span className="muted-badge">FLOW</span>}<h3>{flow.name}</h3></div></div>
        <div className="flow-mini">
          {(flow.activeVersion?.definition.nodes ?? []).filter((node) => node.type !== 'note').slice(0, 7).map((node, index) => <span key={node.id} className={node.type}>{index > 0 && <i />}{node.type.slice(0, 1).toUpperCase()}</span>)}
        </div>
        <div className="flow-stats"><span><strong>{flow.activeVersion?.definition.nodes.filter((node) => node.type !== 'note').length ?? 0}</strong> blocks</span><span><strong>{flow.activeVersion ? `v${flow.activeVersion.version}` : '—'}</strong> published</span></div>
        <footer><button className="button ghost" onClick={() => editFlow(flow.id)}><Icon name="edit" size={15} />Edit Flow</button>{!flow.is_default && flow.active_version_id && <button className="text-button" onClick={async () => { await api.makeDefault(flow.id); await refreshFlows(); toast.success('Default Flow updated.'); }}>Make default</button>}</footer>
      </article>)}
      <button className="flow-card add-flow" onClick={create}><span><Icon name="plus" size={25} /></span><strong>Create another Flow</strong><small>Start from the recommended delivery graph</small></button>
    </div>
  </div>;
}
