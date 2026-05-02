import { useState } from 'react';
import { toast } from 'sonner';
import { useAppStore, type WorkflowStep } from '../hooks/useTaskStore.js';
import { api } from '../api/client.js';
import WorkflowEditor, { type EditorStep } from './WorkflowEditor.js';
import ConfirmDialog from './ConfirmDialog.js';

export default function WorkflowSettingsModal({ onClose }: { onClose: () => void }) {
  const { workflowSteps, fetchWorkflowSteps } = useAppStore();
  const [deleteTarget, setDeleteTarget] = useState<WorkflowStep | null>(null);
  const [moveTasksTo, setMoveTasksTo] = useState<string>('todo');

  const editorSteps: EditorStep[] = workflowSteps.map(s => ({
    id: String(s.id),
    slug: s.slug,
    name: s.name,
    requires_review: !!s.requires_review,
    config: s.config,
  }));

  const handleAdd = async (slug: string) => {
    try {
      await api.addWorkflowStep(slug);
      await fetchWorkflowSteps();
    } catch (err: any) {
      toast.error(err.data?.error || err.message || 'Failed to add step');
    }
  };

  const handleRemove = (step: EditorStep) => {
    const ws = workflowSteps.find(s => String(s.id) === step.id);
    if (ws) setDeleteTarget(ws);
  };

  const handleConfirmRemove = async () => {
    if (!deleteTarget) return;
    try {
      await api.removeWorkflowStep(deleteTarget.id, moveTasksTo);
      await fetchWorkflowSteps();
      toast.success(`Removed "${deleteTarget.name}"`);
    } catch (err: any) {
      toast.error(err.data?.error || err.message || 'Failed to remove step');
    } finally {
      setDeleteTarget(null);
    }
  };

  const handleReorder = async (newSteps: EditorStep[]) => {
    // Find which step moved and compute its new sort_order
    const oldOrder = workflowSteps.map(s => String(s.id));
    const newOrder = newSteps.map(s => s.id);

    for (let i = 0; i < newOrder.length; i++) {
      if (oldOrder[i] !== newOrder[i]) {
        // This step moved — calculate sort_order from neighbors
        const movedId = Number(newOrder[i]);
        let newSortOrder: number;
        if (i === 0) {
          newSortOrder = workflowSteps[0].sort_order - 1;
        } else if (i >= newOrder.length - 1) {
          newSortOrder = workflowSteps[workflowSteps.length - 1].sort_order + 1;
        } else {
          // Find the actual sort_orders of the neighbors in the NEW arrangement
          const prevStep = workflowSteps.find(s => String(s.id) === newOrder[i - 1]);
          const nextStep = workflowSteps.find(s => String(s.id) === newOrder[i + 1]);
          if (prevStep && nextStep) {
            newSortOrder = (prevStep.sort_order + nextStep.sort_order) / 2;
          } else {
            newSortOrder = i + 1;
          }
        }

        try {
          await api.updateWorkflowStep(movedId, { sort_order: newSortOrder });
          await fetchWorkflowSteps();
        } catch (err: any) {
          toast.error(err.message || 'Failed to reorder');
        }
        break;
      }
    }
  };

  const handleToggleReview = async (step: EditorStep) => {
    try {
      await api.updateWorkflowStep(Number(step.id), { requires_review: !step.requires_review });
      await fetchWorkflowSteps();
    } catch (err: any) {
      toast.error(err.message || 'Failed to update step');
    }
  };

  const handleSaveConfig = async (step: EditorStep, config: Record<string, any>) => {
    try {
      await api.updateWorkflowStep(Number(step.id), { config });
      await fetchWorkflowSteps();
      toast.success(`Updated ${step.name} config`);
    } catch (err: any) {
      toast.error(err.data?.error || err.message || 'Failed to save config');
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center animate-fade-in">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-lg bg-bg-raised rounded-xl border border-border shadow-2xl shadow-black/40 overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <h2 className="text-base font-semibold text-text">Workflow Steps</h2>
          <button
            onClick={onClose}
            className="p-1 text-text-muted hover:text-text rounded-lg hover:bg-bg-hover transition-colors"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        <div className="p-5 max-h-[60vh] overflow-y-auto">
          <WorkflowEditor
            steps={editorSteps}
            onAdd={handleAdd}
            onRemove={handleRemove}
            onReorder={handleReorder}
            onToggleReview={handleToggleReview}
            onSaveConfig={handleSaveConfig}
            showConfig
          />
        </div>

        <div className="flex items-center justify-end px-5 py-3 border-t border-border">
          <button
            onClick={onClose}
            className="px-4 py-1.5 text-xs font-medium text-text-muted hover:text-text hover:bg-bg-hover rounded-lg transition-colors"
          >
            Close
          </button>
        </div>
      </div>

      {deleteTarget && (
        <ConfirmDialog
          title={`Remove "${deleteTarget.name}"?`}
          message="Where should tasks in this step be moved?"
          confirmLabel="Remove Step"
          onConfirm={handleConfirmRemove}
          onCancel={() => setDeleteTarget(null)}
        >
          <select
            value={moveTasksTo}
            onChange={(e) => setMoveTasksTo(e.target.value)}
            className="w-full mt-2 px-3 py-2 text-sm bg-bg-input border border-border rounded-lg text-text"
          >
            <option value="todo">Todo</option>
            {workflowSteps
              .filter(s => s.id !== deleteTarget.id)
              .map(s => <option key={s.slug} value={s.slug}>{s.name}</option>)}
            <option value="done">Done</option>
          </select>
        </ConfirmDialog>
      )}
    </div>
  );
}
