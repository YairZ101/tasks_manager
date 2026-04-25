import { useState } from 'react';
import { toast } from 'sonner';
import { useAppStore } from '../hooks/useTaskStore.js';
import { api } from '../api/client.js';

export default function CreateTaskModal() {
  const { createTaskDefaultStatus, setShowCreateTask, updateTaskInStore } = useAppStore();

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [acceptance, setAcceptance] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const handleCreate = async (run = false) => {
    if (!title.trim()) {
      toast.error('Title is required');
      return;
    }

    setSubmitting(true);
    try {
      const data = await api.createTask({
        title: title.trim(),
        description: description.trim(),
        acceptance: acceptance.trim(),
        status: createTaskDefaultStatus,
        run,
      });
      updateTaskInStore(data.task);
      setShowCreateTask(false);
      toast.success(`${data.task.task_key} created`);
    } catch (err: any) {
      toast.error(err.data?.error || err.message || 'Failed to create task');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center animate-fade-in">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={() => setShowCreateTask(false)}
      />

      {/* Modal */}
      <div className="relative w-full max-w-lg bg-bg-raised border border-border rounded-xl shadow-2xl animate-slide-up">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <h2 className="text-sm font-semibold text-text">Create Task</h2>
          <button
            onClick={() => setShowCreateTask(false)}
            title="Close"
            className="p-1 rounded-md text-text-muted hover:text-text hover:bg-bg-hover transition-colors"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        {/* Form */}
        <div className="p-5 space-y-4">
          <div>
            <label className="block text-xs font-semibold text-text-muted uppercase tracking-wide mb-1">
              Title <span className="text-danger">*</span>
            </label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="What needs to be done?"
              autoFocus
              maxLength={500}
              className="w-full px-3 py-2 text-sm bg-bg-input border border-border rounded-lg text-text placeholder:text-text-dim focus:outline-none focus:border-border-focus transition-colors"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-text-muted uppercase tracking-wide mb-1">
              Description
            </label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Detailed description of the task..."
              rows={4}
              maxLength={50000}
              className="w-full px-3 py-2 text-sm bg-bg-input border border-border rounded-lg text-text placeholder:text-text-dim resize-none focus:outline-none focus:border-border-focus transition-colors"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-text-muted uppercase tracking-wide mb-1">
              Acceptance Criteria
            </label>
            <textarea
              value={acceptance}
              onChange={(e) => setAcceptance(e.target.value)}
              placeholder="How will the agent know when this is done?"
              rows={3}
              maxLength={50000}
              className="w-full px-3 py-2 text-sm bg-bg-input border border-border rounded-lg text-text placeholder:text-text-dim resize-none focus:outline-none focus:border-border-focus transition-colors"
            />
          </div>
        </div>

        {/* Actions */}
        <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-border">
          <button
            onClick={() => setShowCreateTask(false)}
            className="px-3 py-1.5 text-xs font-medium text-text-muted hover:text-text hover:bg-bg-hover rounded-lg transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={() => handleCreate(true)}
            disabled={submitting || !title.trim()}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-success bg-success-dim hover:bg-success/20 rounded-lg transition-colors disabled:opacity-30"
          >
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
              <path d="M2 1l8 5-8 5V1z" fill="currentColor" />
            </svg>
            Create & Run
          </button>
          <button
            onClick={() => handleCreate(false)}
            disabled={submitting || !title.trim()}
            className="px-3 py-1.5 text-xs font-medium text-white bg-accent hover:bg-accent-hover rounded-lg transition-colors disabled:opacity-30"
          >
            Create
          </button>
        </div>
      </div>
    </div>
  );
}
