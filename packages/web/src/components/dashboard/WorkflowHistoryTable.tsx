import { Link } from 'react-router';
import { Globe, Terminal, Hash, Send, GitBranch, Trash2 } from 'lucide-react';
import type { DashboardRunResponse } from '@/lib/api';
import { cn } from '@/lib/utils';
import { formatDuration, formatStarted } from '@/lib/format';
import { getWorkflowRunDisplayStatus, isStaleWorkflowRun } from '@/lib/workflow-utils';
import { ConfirmRunActionDialog } from './ConfirmRunActionDialog';

interface WorkflowHistoryTableProps {
  runs: DashboardRunResponse[];
  onDelete?: (runId: string) => void;
}

const STATUS_DOT_COLORS: Record<string, string> = {
  completed: 'bg-success',
  failed: 'bg-destructive',
  cancelled: 'bg-text-tertiary',
};

const PLATFORM_ICONS: Record<string, React.ReactElement> = {
  web: <Globe className="h-3 w-3" />,
  cli: <Terminal className="h-3 w-3" />,
  slack: <Hash className="h-3 w-3" />,
  telegram: <Send className="h-3 w-3" />,
  github: <GitBranch className="h-3 w-3" />,
};

export function WorkflowHistoryTable({
  runs,
  onDelete,
}: WorkflowHistoryTableProps): React.ReactElement {
  if (runs.length === 0) {
    return (
      <div className="flex items-center justify-center py-8">
        <span className="text-xs text-text-tertiary">No history</span>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="space-y-3 md:hidden">
        {runs.map(run =>
          ((): React.ReactElement => {
            const displayStatus = getWorkflowRunDisplayStatus(run);
            const isStale = isStaleWorkflowRun(run);
            return (
              <div
                key={run.id}
                className={cn(
                  'rounded-xl border border-border bg-surface p-4 shadow-sm',
                  (run.status === 'failed' || isStale) && 'border-destructive/40'
                )}
              >
                <div className="flex items-start gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <div
                        className={cn(
                          'h-2.5 w-2.5 shrink-0 rounded-full',
                          STATUS_DOT_COLORS[run.status] ??
                            (isStale ? 'bg-destructive' : 'bg-text-tertiary')
                        )}
                      />
                      <Link
                        to={`/workflows/runs/${run.id}`}
                        className="block min-w-0 truncate text-sm font-medium text-text-primary hover:text-primary"
                      >
                        {run.workflow_name}
                      </Link>
                    </div>
                    {run.user_message && (
                      <p className="mt-2 line-clamp-2 text-xs leading-5 text-text-tertiary">
                        {run.user_message}
                      </p>
                    )}
                    {isStale && run.stale_reason && (
                      <p className="mt-2 text-xs leading-5 text-destructive">
                        {displayStatus}: {run.stale_reason}
                      </p>
                    )}
                  </div>
                  {onDelete && (
                    <ConfirmRunActionDialog
                      trigger={
                        <button
                          className="mt-[-2px] rounded-md p-1 text-text-tertiary hover:bg-surface-elevated hover:text-error transition-colors"
                          title="Delete run"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      }
                      title="Delete workflow run?"
                      description={
                        <>
                          Permanently delete the run record for <strong>{run.workflow_name}</strong>{' '}
                          and its events. This cannot be undone.
                        </>
                      }
                      confirmLabel="Delete"
                      onConfirm={(): void => {
                        onDelete(run.id);
                      }}
                    />
                  )}
                </div>
                <div className="mt-4 space-y-3 rounded-lg bg-surface-elevated/50 p-3">
                  <div className="space-y-1">
                    <p className="text-[11px] uppercase tracking-wide text-text-tertiary">
                      Project
                    </p>
                    <p className="truncate text-xs leading-5 text-text-secondary">
                      {run.codebase_name ?? '\u2014'}
                    </p>
                  </div>
                  <div className="grid grid-cols-3 gap-3 text-xs">
                    <div className="col-span-1">
                      <p className="text-[11px] uppercase tracking-wide text-text-tertiary">
                        Source
                      </p>
                      <span className="mt-1 flex items-center gap-1 text-text-secondary">
                        {PLATFORM_ICONS[run.platform_type ?? ''] ?? null}
                        {run.platform_type ?? '\u2014'}
                      </span>
                    </div>
                    <div className="col-span-1">
                      <p className="text-[11px] uppercase tracking-wide text-text-tertiary">
                        Duration
                      </p>
                      <p className="mt-1 text-text-secondary">
                        {formatDuration(run.started_at, run.completed_at)}
                      </p>
                    </div>
                    <div className="col-span-1">
                      <p className="text-[11px] uppercase tracking-wide text-text-tertiary">
                        Started
                      </p>
                      <p className="mt-1 text-text-secondary">{formatStarted(run.started_at)}</p>
                    </div>
                  </div>
                </div>
                <div className="mt-4">
                  <Link
                    to={`/workflows/runs/${run.id}`}
                    className="inline-flex items-center text-sm font-medium text-primary hover:text-primary/80 transition-colors"
                  >
                    View Logs
                  </Link>
                </div>
              </div>
            );
          })()
        )}
      </div>

      <div className="hidden overflow-x-auto rounded-lg border border-border md:block">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-border bg-surface-elevated text-left text-text-tertiary">
              <th className="px-3 py-2 font-medium w-8">Status</th>
              <th className="px-3 py-2 font-medium">Workflow</th>
              <th className="px-3 py-2 font-medium">Project</th>
              <th className="px-3 py-2 font-medium w-16">Source</th>
              <th className="px-3 py-2 font-medium w-20">Duration</th>
              <th className="px-3 py-2 font-medium w-32">Started</th>
              <th className="px-3 py-2 font-medium w-20">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {runs.map(run =>
              ((): React.ReactElement => {
                const displayStatus = getWorkflowRunDisplayStatus(run);
                const isStale = isStaleWorkflowRun(run);
                return (
                  <tr
                    key={run.id}
                    className={cn(
                      'hover:bg-surface-elevated transition-colors',
                      (run.status === 'failed' || isStale) && 'border-l-2 border-l-destructive'
                    )}
                  >
                    <td className="px-3 py-2">
                      <div
                        className={cn(
                          'h-2 w-2 rounded-full',
                          STATUS_DOT_COLORS[run.status] ??
                            (isStale ? 'bg-destructive' : 'bg-text-tertiary')
                        )}
                      />
                    </td>
                    <td className="px-3 py-2">
                      <Link
                        to={`/workflows/runs/${run.id}`}
                        className="text-text-primary hover:text-primary truncate block"
                      >
                        {run.workflow_name}
                      </Link>
                      {isStale && (
                        <p className="text-[11px] text-destructive truncate max-w-[300px]">
                          {displayStatus}: {run.stale_reason}
                        </p>
                      )}
                      {run.user_message && (
                        <p className="text-[11px] text-text-tertiary truncate max-w-[300px]">
                          {run.user_message}
                        </p>
                      )}
                    </td>
                    <td className="px-3 py-2 text-text-secondary truncate">
                      {run.codebase_name ?? '\u2014'}
                    </td>
                    <td className="px-3 py-2">
                      <span className="flex items-center gap-1 text-text-secondary">
                        {PLATFORM_ICONS[run.platform_type ?? ''] ?? null}
                        {run.platform_type ?? '\u2014'}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-text-secondary">
                      {formatDuration(run.started_at, run.completed_at)}
                    </td>
                    <td className="px-3 py-2 text-text-secondary">
                      {formatStarted(run.started_at)}
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-2">
                        <Link
                          to={`/workflows/runs/${run.id}`}
                          className="text-primary hover:text-primary/80 transition-colors"
                        >
                          View Logs
                        </Link>
                        {onDelete && (
                          <ConfirmRunActionDialog
                            trigger={
                              <button
                                className="text-text-tertiary hover:text-error transition-colors"
                                title="Delete run"
                              >
                                <Trash2 className="h-3 w-3" />
                              </button>
                            }
                            title="Delete workflow run?"
                            description={
                              <>
                                Permanently delete the run record for{' '}
                                <strong>{run.workflow_name}</strong> and its events. This cannot be
                                undone.
                              </>
                            }
                            confirmLabel="Delete"
                            onConfirm={(): void => {
                              onDelete(run.id);
                            }}
                          />
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })()
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
