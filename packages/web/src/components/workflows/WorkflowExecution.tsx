import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router';
import { MessageSquare } from 'lucide-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';

import { DagNodeProgress } from './DagNodeProgress';
import { StepLogs } from './StepLogs';
import { WorkflowLogs } from './WorkflowLogs';
import { WorkflowDagViewer } from './WorkflowDagViewer';
import { ArtifactSummary } from './ArtifactSummary';
import { WorkflowNodeDetails } from './WorkflowNodeDetails';
import { getWorkflowExecutionLayout } from './workflow-execution-layout';
import { ChatInterface } from '@/components/chat/ChatInterface';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ResizablePanelGroup, ResizablePanel, ResizableHandle } from '@/components/ui/resizable';
import { useWorkflowStore } from '@/stores/workflow-store';
import {
  getWorkflowRun,
  getWorkflowRunByWorker,
  getCodebase,
  getWorkflow,
  updateConversation,
} from '@/lib/api';
import { ensureUtc, formatDurationMs } from '@/lib/format';
import { selectInitialNode } from '@/lib/select-initial-node';
import { cn } from '@/lib/utils';
import { getWorkflowRunDisplayStatus, isActiveWorkflowRun } from '@/lib/workflow-utils';
import { useIsMobile } from '@/hooks/useIsMobile';
import {
  buildWorkflowConversationTitle,
  findWorkflowNode,
  getWorkflowStageInfo,
} from '@/lib/workflow-node-details';
import type {
  WorkflowState,
  ArtifactType,
  WorkflowRunStatus,
  DagNodeState,
  WorkflowStepStatus,
  LoopIterationInfo,
} from '@/lib/types';

import type { WorkflowEventResponse } from '@/lib/api';

/** Tool call event extracted from workflow_events for display in WorkflowLogs. */
export interface ToolEvent {
  id: string;
  name: string;
  input: Record<string, unknown>;
  stepName?: string;
  stepIndex?: number;
  createdAt: string;
  duration?: number;
}

const TERMINAL_STATUSES: readonly WorkflowRunStatus[] = ['completed', 'failed', 'cancelled'];

function isTerminal(status: WorkflowRunStatus): boolean {
  return TERMINAL_STATUSES.includes(status);
}

interface WorkflowRunQueryData {
  workflowState: WorkflowState;
  workerPlatformId: string | null;
  parentPlatformId: string | null;
  conversationPlatformId: string | null;
  codebaseId: string | null;
  isStale: boolean;
  staleReason: string | null;
  events: WorkflowEventResponse[];
}

interface WorkflowExecutionProps {
  runId: string;
}

export function mergeWorkflowExecutionState(
  initialData: WorkflowState | null,
  liveWorkflow: WorkflowState | undefined,
  runId: string
): WorkflowState | null {
  if (!liveWorkflow) return initialData;
  if (!initialData) return liveWorkflow;
  if (isTerminal(initialData.status) && initialData.status !== liveWorkflow.status) {
    console.warn('[WorkflowExecution] REST overrides conflicting live status', {
      runId,
      restStatus: initialData.status,
      liveStatus: liveWorkflow.status,
    });
    return initialData;
  }
  if (isTerminal(initialData.status) && !isTerminal(liveWorkflow.status)) {
    console.warn('[WorkflowExecution] REST overrides stale SSE status', {
      runId,
      restStatus: initialData.status,
      sseStatus: liveWorkflow.status,
    });
    return initialData;
  }
  return {
    ...initialData,
    status: liveWorkflow.status,
    completedAt: liveWorkflow.completedAt ?? initialData.completedAt,
    error: liveWorkflow.error ?? initialData.error,
    // SSE accumulates dagNodes/artifacts incrementally — prefer them when populated,
    // otherwise fall back to the REST snapshot.
    dagNodes: liveWorkflow.dagNodes.length > 0 ? liveWorkflow.dagNodes : initialData.dagNodes,
    artifacts: liveWorkflow.artifacts.length > 0 ? liveWorkflow.artifacts : initialData.artifacts,
    currentIteration: liveWorkflow.currentIteration ?? initialData.currentIteration,
    maxIterations: liveWorkflow.maxIterations ?? initialData.maxIterations,
  };
}

function StatusBadge({ status }: { status: string }): React.ReactElement {
  const colors: Record<string, string> = {
    pending: 'bg-accent/20 text-accent',
    running: 'bg-accent/20 text-accent',
    stale: 'bg-error/20 text-error',
    completed: 'bg-success/20 text-success',
    failed: 'bg-error/20 text-error',
    cancelled: 'bg-surface text-text-secondary',
  };
  return (
    <span
      className={`px-2 py-0.5 rounded-full text-xs font-medium ${colors[status] ?? 'bg-surface text-text-secondary'}`}
    >
      {status}
    </span>
  );
}

export function WorkflowExecution({ runId }: WorkflowExecutionProps): React.ReactElement {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const liveWorkflow = useWorkflowStore(s => s.workflows.get(runId));
  const [selectedDagNode, setSelectedDagNode] = useState<string | null>(null);
  const [codebaseName, setCodebaseName] = useState<string | null>(null);
  const [codebaseCwd, setCodebaseCwd] = useState<string | null>(null);
  const [workerRunId, setWorkerRunId] = useState<string | null>(null);
  const [activeView, setActiveView] = useState<'graph' | 'logs' | 'chat'>('graph');
  const isMobile = useIsMobile();
  const [isMobileGraphDetailsOpen, setIsMobileGraphDetailsOpen] = useState(false);
  const [hasManuallySelectedNode, setHasManuallySelectedNode] = useState(false);
  // Increments on every user-initiated node click to trigger scroll in WorkflowLogs
  const [nodeScrollTrigger, setNodeScrollTrigger] = useState(0);
  // Track which codebaseId we've already fetched to avoid stale re-fetches during runId transitions
  const fetchedCodebaseIdRef = useRef<string | null>(null);

  // Reset local state when navigating to a different workflow run
  useEffect(() => {
    setSelectedDagNode(null);
    setCodebaseName(null);
    setCodebaseCwd(null);
    setWorkerRunId(null);
    setActiveView('graph');
    setIsMobileGraphDetailsOpen(false);
    setHasManuallySelectedNode(false);
    setNodeScrollTrigger(0);
    fetchedCodebaseIdRef.current = null;
  }, [runId]);

  useEffect(() => {
    if (!isMobile) {
      setIsMobileGraphDetailsOpen(false);
    }
  }, [isMobile]);

  // Fetch workflow run data with polling while running
  const { data: queryData, error: queryError } = useQuery({
    queryKey: ['workflowRun', runId],
    queryFn: async (): Promise<WorkflowRunQueryData> => {
      const data = await getWorkflowRun(runId);
      return {
        workflowState: {
          runId: data.run.id,
          workflowName: data.run.workflow_name,
          status: data.run.status,
          dagNodes: ((): DagNodeState[] => {
            const nodeMap = new Map<string, DagNodeState>();
            for (const e of data.events.filter(ev => ev.event_type.startsWith('node_'))) {
              const nodeId = e.step_name ?? (e.data.nodeId as string) ?? '';
              if (!nodeId) continue;
              const status =
                e.event_type === 'node_started'
                  ? 'running'
                  : e.event_type === 'node_completed'
                    ? 'completed'
                    : e.event_type === 'node_failed'
                      ? 'failed'
                      : 'skipped';
              const existing = nodeMap.get(nodeId);
              const resolvedPrompt =
                typeof e.data.resolved_prompt === 'string' ? e.data.resolved_prompt : undefined;
              // Keep the latest non-running status (completed/failed/skipped override running)
              if (!existing || status !== 'running') {
                nodeMap.set(nodeId, {
                  nodeId,
                  name: nodeId,
                  status: status as WorkflowStepStatus,
                  duration: e.data.duration_ms as number | undefined,
                  error: e.data.error as string | undefined,
                  reason: e.data.reason as 'when_condition' | 'trigger_rule' | undefined,
                  resolvedPrompt: resolvedPrompt ?? existing?.resolvedPrompt,
                });
              } else if (resolvedPrompt) {
                nodeMap.set(nodeId, {
                  ...existing,
                  resolvedPrompt,
                });
              }
            }

            // Second pass: enrich loop nodes with iteration data
            for (const e of data.events.filter(ev => ev.event_type.startsWith('loop_iteration_'))) {
              const nodeId = e.step_name ?? '';
              if (!nodeId) continue;
              const existing = nodeMap.get(nodeId);
              if (!existing) continue; // No node_started event yet — skip (events ordered in DB)

              const iteration = e.data.iteration as number | undefined;
              const maxIter = e.data.maxIterations as number | undefined;
              if (iteration === undefined) continue;

              let iterStatus: LoopIterationInfo['status'];
              if (e.event_type === 'loop_iteration_started') {
                iterStatus = 'running';
              } else if (e.event_type === 'loop_iteration_completed') {
                iterStatus = 'completed';
              } else {
                iterStatus = 'failed';
              }

              const existingIters: LoopIterationInfo[] = existing.iterations ?? [];
              const iterIdx = existingIters.findIndex(it => it.iteration === iteration);
              const resolvedPrompt =
                typeof e.data.resolved_prompt === 'string' ? e.data.resolved_prompt : undefined;
              const iterState: LoopIterationInfo = {
                iteration,
                status: iterStatus,
                duration: e.data.duration_ms as number | undefined,
              };
              const newIters = [...existingIters];
              if (iterIdx >= 0) {
                newIters[iterIdx] = iterState;
              } else {
                newIters.push(iterState);
              }

              nodeMap.set(nodeId, {
                ...existing,
                currentIteration: iteration,
                maxIterations: maxIter ?? existing.maxIterations,
                iterations: newIters,
                resolvedPrompt: resolvedPrompt ?? existing.resolvedPrompt,
              });
            }

            return Array.from(nodeMap.values());
          })(),
          artifacts: data.events
            .filter(e => e.event_type === 'workflow_artifact')
            .map(e => {
              const d = e.data;
              return {
                type: (d.artifactType as ArtifactType) ?? 'commit',
                label: (d.label as string) ?? '',
                url: d.url as string | undefined,
                path: d.path as string | undefined,
              };
            })
            .filter(a => a.label || a.url || a.path),
          startedAt: new Date(ensureUtc(data.run.started_at)).getTime(),
          completedAt: data.run.completed_at
            ? new Date(ensureUtc(data.run.completed_at)).getTime()
            : undefined,
        },
        workerPlatformId: data.run.worker_platform_id ?? null,
        parentPlatformId: data.run.parent_platform_id ?? null,
        conversationPlatformId: data.run.conversation_platform_id ?? null,
        codebaseId: data.run.codebase_id ?? null,
        isStale: data.run.is_stale === true,
        staleReason: data.run.stale_reason ?? null,
        events: data.events,
      };
    },
    refetchInterval: (query): number | false => {
      const status = query.state.data?.workflowState.status;
      if (status && isTerminal(status)) return false;
      return 3000;
    },
    staleTime: 0,
  });

  const initialData = queryData?.workflowState ?? null;
  const workerPlatformId = queryData?.workerPlatformId ?? null;
  const parentPlatformId = queryData?.parentPlatformId ?? null;
  const conversationPlatformId = queryData?.conversationPlatformId ?? null;
  const error = queryError
    ? queryError instanceof Error
      ? queryError.message
      : String(queryError)
    : null;

  // Extract tool_called events from workflow events for WorkflowLogs,
  // matching each with its corresponding tool_completed to get duration.
  const toolEvents = useMemo((): ToolEvent[] => {
    const allEvents = queryData?.events ?? [];
    const completedEvents = allEvents
      .filter(ev => ev.event_type === 'tool_completed')
      .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());

    // Greedy match: claim the earliest tool_completed with matching name after evTime.
    // usedCompleted tracks claimed IDs to prevent double-use. Local mutation is intentional.
    const usedCompleted = new Set<string>();

    return allEvents
      .filter(ev => ev.event_type === 'tool_called')
      .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())
      .map(ev => {
        const evTime = new Date(ev.created_at).getTime();
        const toolName = ev.data.tool_name as string;
        const stepName = ev.step_name ?? undefined;
        const completed = completedEvents.find(
          c =>
            !usedCompleted.has(c.id) &&
            (c.data.tool_name as string) === toolName &&
            new Date(c.created_at).getTime() >= evTime &&
            (c.step_name ?? undefined) === stepName
        );
        if (completed) usedCompleted.add(completed.id);
        return {
          id: ev.id,
          name: toolName,
          input: (ev.data.tool_input as Record<string, unknown>) ?? {},
          stepName: ev.step_name ?? undefined,
          stepIndex: ev.step_index ?? undefined,
          createdAt: ev.created_at,
          duration: completed ? (completed.data.duration_ms as number | undefined) : undefined,
        };
      });
  }, [queryData?.events]);

  // Fetch codebase name when run data becomes available
  const codebaseId = queryData?.codebaseId ?? null;
  useEffect(() => {
    if (!codebaseId || fetchedCodebaseIdRef.current === codebaseId) return;
    fetchedCodebaseIdRef.current = codebaseId;
    void getCodebase(codebaseId)
      .then(cb => {
        setCodebaseName(cb.name);
        setCodebaseCwd(cb.default_cwd);
      })
      .catch((err: unknown) => {
        console.warn('[WorkflowExecution] Failed to load codebase name', {
          codebaseId,
          error: err instanceof Error ? err.message : err,
        });
      });
  }, [codebaseId]);

  // Fetch workflow definition for DAG topology (depends_on edges).
  // Only gated on workflowName — codebaseCwd is optional; when absent the server tries the
  // first registered codebase before falling back to bundled defaults (handles CLI runs and
  // "No project" web runs).
  const { data: workflowDef } = useQuery({
    queryKey: ['workflowDefinition', initialData?.workflowName, codebaseCwd],
    queryFn: () => getWorkflow(initialData?.workflowName ?? '', codebaseCwd ?? undefined),
    enabled: !!initialData?.workflowName,
    staleTime: Infinity,
  });
  const dagDefinitionNodes = workflowDef?.workflow?.nodes ?? null;
  // Use workflow definition when available, fall back to dagNodes from run state.
  const isDag = dagDefinitionNodes !== null || (initialData?.dagNodes.length ?? 0) > 0;

  // When SSE reports a terminal status but React Query data is still stale,
  // invalidate the cache to trigger an immediate re-fetch with correct data.
  const liveStatus = liveWorkflow?.status;
  useEffect(() => {
    if (!liveStatus || !isTerminal(liveStatus)) return;
    if (initialData && isTerminal(initialData.status)) return; // Already up to date
    void queryClient.invalidateQueries({ queryKey: ['workflowRun', runId] });
  }, [runId, liveStatus, initialData, queryClient]);

  // Look up the workflow run associated with this worker conversation
  useEffect(() => {
    if (!workerPlatformId) return;
    getWorkflowRunByWorker(workerPlatformId)
      .then(result => {
        if (result) {
          setWorkerRunId(result.run.id);
        }
      })
      .catch((err: unknown) => {
        // Non-critical — "View Run" link just won't appear
        console.warn('[WorkflowExecution] Failed to look up worker run', {
          workerPlatformId,
          error: err instanceof Error ? err.message : err,
        });
      });
  }, [workerPlatformId]);

  // Merge REST (initialData) and SSE (liveWorkflow) data.
  // REST provides structural data (steps, startedAt, artifacts) from DB.
  // SSE provides live status updates (status, completedAt, error).
  // When a `running` SSE event is missed (no buffering), the first SSE event
  // seen is `completed` — which creates liveWorkflow with steps:[] and
  // startedAt=completionTime. We must preserve initialData's structure in that case.
  const workflow = mergeWorkflowExecutionState(initialData, liveWorkflow, runId);
  const selectedNodeDefinition = findWorkflowNode(dagDefinitionNodes, selectedDagNode);
  const selectedNodeLiveState =
    selectedDagNode !== null
      ? (workflow?.dagNodes.find(node => node.nodeId === selectedDagNode) ?? null)
      : null;
  const syncedTitlesRef = useRef<Map<string, string>>(new Map());

  // Auto-select the first DAG node when workflow data loads and no node is selected.
  // Prefer the currently executing node (for running workflows), otherwise pick the first node.
  useEffect(() => {
    if (selectedDagNode !== null || hasManuallySelectedNode) return;
    const nodeId = selectInitialNode(workflow?.dagNodes);
    if (nodeId) setSelectedDagNode(nodeId);
  }, [selectedDagNode, workflow?.dagNodes, hasManuallySelectedNode]);

  // Force re-render every second while workflow is running (for live timer)
  const [, setTick] = useState(0);
  useEffect(() => {
    if (workflow?.status !== 'running' && workflow?.status !== 'pending') return;
    const interval = setInterval(() => {
      setTick(t => t + 1);
    }, 1000);
    return (): void => {
      clearInterval(interval);
    };
  }, [workflow?.status]);

  // Derive the currently executing node/step from events data
  const currentlyExecuting = useMemo((): { nodeName: string; startedAt: number } | null => {
    if (!queryData?.events || workflow?.status !== 'running') return null;
    const events = queryData.events;

    // Find nodes that started but haven't completed/failed/skipped
    const startedNodes = new Set<string>();
    const completedNodes = new Set<string>();

    for (const e of events) {
      const nodeId = e.step_name ?? '';
      if (e.event_type === 'node_started') startedNodes.add(nodeId);
      if (
        e.event_type === 'node_completed' ||
        e.event_type === 'node_failed' ||
        e.event_type === 'node_skipped'
      ) {
        completedNodes.add(nodeId);
      }
    }

    // Find the first started-but-not-completed node
    for (const nodeId of startedNodes) {
      if (!completedNodes.has(nodeId)) {
        const startEvent = events.find(
          e => e.event_type === 'node_started' && e.step_name === nodeId
        );
        if (startEvent) {
          return {
            nodeName: nodeId,
            startedAt: new Date(ensureUtc(startEvent.created_at)).getTime(),
          };
        }
      }
    }

    return null;
  }, [queryData?.events, workflow?.status]);

  useEffect(() => {
    if (!currentlyExecuting || hasManuallySelectedNode) return;
    setSelectedDagNode(currentlyExecuting.nodeName);
  }, [currentlyExecuting, hasManuallySelectedNode]);

  const stageInfo = workflow ? getWorkflowStageInfo(workflow, currentlyExecuting) : null;
  const stageTitle = workflow
    ? buildWorkflowConversationTitle(workflow.workflowName, workflow.status, stageInfo)
    : null;

  useEffect(() => {
    if (!stageTitle || !workflow) return;
    if (
      workflow.status !== 'running' &&
      workflow.status !== 'paused' &&
      workflow.status !== 'failed'
    ) {
      return;
    }

    const targets = [workerPlatformId, parentPlatformId].filter(
      (value, index, all): value is string => !!value && all.indexOf(value) === index
    );

    for (const conversationId of targets) {
      if (syncedTitlesRef.current.get(conversationId) === stageTitle) continue;
      syncedTitlesRef.current.set(conversationId, stageTitle);
      void updateConversation(conversationId, { title: stageTitle }).catch((err: unknown) => {
        syncedTitlesRef.current.delete(conversationId);
        console.warn('[WorkflowExecution] Failed to sync workflow stage title', {
          conversationId,
          title: stageTitle,
          error: err instanceof Error ? err.message : err,
        });
      });
    }
  }, [stageTitle, workflow, workerPlatformId, parentPlatformId]);

  // Compute formatted log lines for the selected DAG node from DB events.
  const stepLogLines = useMemo((): string[] => {
    const events = queryData?.events ?? [];
    const stepEvents =
      selectedDagNode !== null ? events.filter(e => e.step_name === selectedDagNode) : [];
    if (stepEvents.length === 0) return [];

    return stepEvents.map(e => {
      const ts = new Date(ensureUtc(e.created_at)).toLocaleTimeString();
      switch (e.event_type) {
        case 'loop_iteration_started':
          return `[${ts}] Iteration ${String(e.data.iteration)}/${String((e.data.maxIterations as number | undefined) ?? '?')} started`;
        case 'loop_iteration_completed': {
          const dur = e.data.duration_ms as number | undefined;
          const durStr = dur !== undefined ? ` (${String(Math.round(dur / 100) / 10)}s)` : '';
          return `[${ts}] Iteration ${String(e.data.iteration)} completed${durStr}`;
        }
        case 'loop_iteration_failed':
          return `[${ts}] Iteration ${String(e.data.iteration)} failed: ${(e.data.error as string | undefined) ?? 'Unknown error'}`;
        case 'node_started':
          return `[${ts}] Node started: ${e.step_name ?? 'node'}`;
        case 'node_completed':
          return `[${ts}] Node completed: ${e.step_name ?? 'node'}`;
        case 'node_failed':
          return `[${ts}] Node failed: ${e.step_name ?? 'node'}: ${(e.data.error as string | undefined) ?? 'Unknown error'}`;
        case 'node_skipped':
          return `[${ts}] Node skipped: ${e.step_name ?? 'node'}`;
        default:
          return `[${ts}] ${e.event_type}${e.step_name ? `: ${e.step_name}` : ''}`;
      }
    });
  }, [queryData?.events, selectedDagNode]);

  // Detect whether the selected node has any DB events so we can show an empty-state
  // overlay when a node has no output. Guard with isRunning so we never hide the live stream
  // for a currently-executing node that hasn't emitted events yet.
  const selectedStepHasEvents = useMemo((): boolean => {
    if (!queryData?.events || selectedDagNode === null) return false;
    return queryData.events.some(e => e.step_name === selectedDagNode);
  }, [queryData?.events, selectedDagNode]);

  // Compute start timestamps for each DAG node from workflow events.
  // Used to filter logs down to the selected node's execution window.
  const selectedNodeWindow = useMemo((): { startedAt: number; endedAt: number | null } | null => {
    if (!selectedDagNode) return null;
    const events = queryData?.events ?? [];
    const startEvent = events.find(
      e => e.event_type === 'node_started' && e.step_name === selectedDagNode
    );
    if (!startEvent) return null;

    const endEvent = events.find(
      e =>
        e.step_name === selectedDagNode &&
        (e.event_type === 'node_completed' ||
          e.event_type === 'node_failed' ||
          e.event_type === 'node_skipped')
    );

    return {
      startedAt: new Date(ensureUtc(startEvent.created_at)).getTime(),
      endedAt: endEvent ? new Date(ensureUtc(endEvent.created_at)).getTime() : null,
    };
  }, [queryData?.events, selectedDagNode]);

  // Handler for user-initiated node clicks (graph or sidebar).
  // Increments scroll trigger so WorkflowLogs scrolls to the node's section.
  const handleNodeClick = useCallback(
    (nodeId: string): void => {
      setHasManuallySelectedNode(true);
      setSelectedDagNode(nodeId);
      setNodeScrollTrigger(prev => prev + 1);
      if (isMobile) {
        setIsMobileGraphDetailsOpen(true);
      }
    },
    [isMobile]
  );

  if (error) {
    return (
      <div className="flex items-center justify-center h-full text-error">
        <p>Failed to load workflow run: {error}</p>
      </div>
    );
  }

  if (!workflow) {
    return (
      <div className="flex items-center justify-center h-full text-text-secondary">
        <p>Loading workflow execution...</p>
      </div>
    );
  }

  // Only trust initialData.startedAt (from DB) for elapsed calculation.
  // SSE's startedAt is unreliable when 'running' was missed and the first event
  // is 'completed', which sets startedAt = completedAt = same Date.now().
  // Show 0 until REST fetch provides the authoritative timestamp.
  const startedAt = initialData?.startedAt ?? 0;
  const completedAt =
    initialData && isTerminal(initialData.status) && initialData.completedAt
      ? initialData.completedAt
      : (workflow.completedAt ?? (startedAt ? Date.now() : 0));
  const elapsed = startedAt ? Math.max(0, completedAt - startedAt) : 0;

  const displayStatus = liveWorkflow
    ? workflow.status
    : getWorkflowRunDisplayStatus({
        status: workflow.status,
        is_stale: queryData?.isStale,
      });
  const isRunning = liveWorkflow
    ? workflow.status === 'running' || workflow.status === 'pending'
    : isActiveWorkflowRun({
        status: workflow.status,
        is_stale: queryData?.isStale,
      });

  // Pick the platform ID for logs: worker takes precedence over conversation.
  const logsPlatformId = workerPlatformId ?? conversationPlatformId;

  // Logs panel — detect whether the selected node has any DB events so we can show an empty-state
  const logsPanel = (
    <div className="flex-1 flex flex-col overflow-hidden min-h-0 h-full">
      <WorkflowNodeDetails node={selectedNodeDefinition} liveState={selectedNodeLiveState} />
      <div className="flex-1 flex flex-col overflow-hidden min-h-0">
        {logsPlatformId && !selectedStepHasEvents && !isRunning ? (
          <div className="flex-1 flex items-center justify-center text-text-secondary text-sm">
            No output available for this step.
          </div>
        ) : logsPlatformId ? (
          <WorkflowLogs
            conversationId={logsPlatformId}
            startedAt={selectedNodeWindow?.startedAt ?? initialData?.startedAt}
            endedAt={selectedNodeWindow?.endedAt ?? null}
            isRunning={isRunning}
            currentlyExecuting={currentlyExecuting}
            toolEvents={toolEvents}
            scrollToNodeTimestamp={selectedNodeWindow?.startedAt ?? null}
            nodeScrollTrigger={nodeScrollTrigger}
          />
        ) : (
          <StepLogs runId={runId} lines={stepLogLines} />
        )}
      </div>
      {!isRunning && workflow.artifacts.length > 0 && (
        <div className="border-t border-border p-3">
          <ArtifactSummary artifacts={workflow.artifacts} runId={runId} />
        </div>
      )}
    </div>
  );

  const renderBody = (): React.ReactElement => {
    const layout = getWorkflowExecutionLayout({ activeView, isMobile });

    if (isDag && activeView === 'graph' && layout.mode === 'split') {
      return (
        <ResizablePanelGroup orientation="horizontal" className="flex-1 min-h-0">
          <ResizablePanel defaultSize={60} minSize={30}>
            {dagDefinitionNodes ? (
              <WorkflowDagViewer
                dagNodes={dagDefinitionNodes}
                liveStatus={workflow.dagNodes}
                isRunning={isRunning}
                currentlyExecuting={currentlyExecuting ?? undefined}
                selectedNodeId={selectedDagNode}
                onNodeClick={handleNodeClick}
                isMobile={isMobile}
              />
            ) : (
              <div className="flex items-center justify-center h-full text-text-secondary">
                <span className="inline-block h-5 w-5 animate-spin rounded-full border-2 border-accent border-t-transparent mr-2" />
                Loading graph...
              </div>
            )}
          </ResizablePanel>
          <ResizableHandle withHandle />
          <ResizablePanel defaultSize={40} minSize={20}>
            {logsPanel}
          </ResizablePanel>
        </ResizablePanelGroup>
      );
    }
    if (isDag && activeView === 'graph') {
      return (
        <div className="flex flex-1 flex-col overflow-hidden min-h-0">
          <div
            className={cn(
              'min-h-[260px] border-b border-border',
              isMobileGraphDetailsOpen ? 'flex-[0_0_45%]' : 'flex-1'
            )}
          >
            {dagDefinitionNodes ? (
              <WorkflowDagViewer
                dagNodes={dagDefinitionNodes}
                liveStatus={workflow.dagNodes}
                isRunning={isRunning}
                currentlyExecuting={currentlyExecuting ?? undefined}
                selectedNodeId={selectedDagNode}
                onNodeClick={handleNodeClick}
                isMobile={isMobile}
              />
            ) : (
              <div className="flex items-center justify-center h-full text-text-secondary">
                <span className="inline-block h-5 w-5 animate-spin rounded-full border-2 border-accent border-t-transparent mr-2" />
                Loading graph...
              </div>
            )}
          </div>
          <button
            type="button"
            onClick={(): void => {
              setIsMobileGraphDetailsOpen(open => !open);
            }}
            className="flex items-center justify-between border-b border-border bg-surface px-4 py-2 text-sm text-text-secondary"
          >
            <span>{isMobileGraphDetailsOpen ? 'Hide step details' : 'Show step details'}</span>
            <span className="text-xs text-text-tertiary">
              {isMobileGraphDetailsOpen ? '\u25B2' : '\u25BC'}
            </span>
          </button>
          {isMobileGraphDetailsOpen && <div className="min-h-0 flex-1">{logsPanel}</div>}
        </div>
      );
    }
    if (isDag && activeView === 'chat' && parentPlatformId) {
      return (
        <div className="flex flex-col flex-1 overflow-hidden min-h-0">
          <ChatInterface conversationId={parentPlatformId} />
        </div>
      );
    }
    // Logs view: DAG "Logs" tab
    if (layout.mode === 'stacked' && layout.showNodeList) {
      return (
        <div className="flex flex-1 flex-col overflow-hidden min-h-0">
          <div className="max-h-56 border-b border-border overflow-auto bg-surface">
            <DagNodeProgress
              nodes={workflow.dagNodes}
              activeNodeId={selectedDagNode}
              onNodeClick={handleNodeClick}
            />
          </div>
          {logsPanel}
        </div>
      );
    }
    return (
      <div className="flex flex-1 overflow-hidden min-h-0">
        <div className="w-64 border-r border-border overflow-auto">
          <DagNodeProgress
            nodes={workflow.dagNodes}
            activeNodeId={selectedDagNode}
            onNodeClick={handleNodeClick}
          />
        </div>
        {logsPanel}
      </div>
    );
  };

  return (
    <div className="flex flex-col h-full min-h-0 overflow-hidden">
      {/* Header */}
      <div className="flex flex-wrap items-center gap-2 px-4 py-3 border-b border-border sm:gap-3">
        <button
          onClick={(): void => {
            if (window.history.length > 1) {
              navigate(-1);
            } else {
              navigate('/workflows');
            }
          }}
          className="text-text-secondary hover:text-text-primary transition-colors text-sm"
          title="Back"
        >
          &larr;
        </button>
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <div className="min-w-0">
            <h2 className="font-semibold text-text-primary truncate">{workflow.workflowName}</h2>
            {stageInfo?.label && (
              <p className="truncate text-xs text-text-secondary">
                Current stage: {stageInfo.label}
              </p>
            )}
          </div>
          <StatusBadge status={displayStatus} />
        </div>
        <div className="flex w-full flex-wrap items-center gap-2 text-xs sm:ml-auto sm:w-auto sm:shrink-0">
          {codebaseName && <span className="text-xs text-text-secondary">{codebaseName}</span>}
          {workerRunId && (
            <button
              onClick={(): void => {
                navigate(`/workflows/runs/${workerRunId}`);
              }}
              className="flex items-center gap-1 text-xs text-primary hover:text-accent-bright transition-colors"
              title="View workflow run details"
            >
              <span>Run Details</span>
            </button>
          )}
          <span className="text-xs text-text-secondary">{formatDurationMs(elapsed)}</span>
        </div>
      </div>

      {!liveWorkflow && queryData?.isStale && queryData.staleReason && (
        <div className="border-b border-error/20 bg-error/5 px-4 py-2 text-xs text-error">
          {queryData.staleReason}
        </div>
      )}

      {/* View tabs — only for DAG workflows */}
      {isDag && (
        <div className="flex items-center overflow-x-auto px-4 py-1.5 border-b border-border">
          <Tabs
            value={activeView}
            onValueChange={(v): void => {
              setActiveView(v as typeof activeView);
            }}
          >
            <TabsList className="min-w-max">
              <TabsTrigger value="graph">Graph</TabsTrigger>
              <TabsTrigger value="logs">Logs</TabsTrigger>
              {parentPlatformId && (
                <TabsTrigger value="chat">
                  <MessageSquare className="h-3 w-3 mr-1" />
                  Chat
                </TabsTrigger>
              )}
            </TabsList>
          </Tabs>
        </div>
      )}

      {/* Body — content depends on activeView for DAG, or default layout for sequential */}
      {renderBody()}
    </div>
  );
}
