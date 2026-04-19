import type { DagNode } from '@/lib/api';
import type { DagNodeState, WorkflowState } from '@/lib/types';

export interface WorkflowStageInfo {
  nodeId: string | null;
  label: string;
}

export interface WorkflowNodeSection {
  title: string;
  content: string;
  language?: 'json' | 'bash' | 'python' | 'typescript' | 'text';
}

export function findWorkflowNode(
  dagNodes: DagNode[] | null | undefined,
  nodeId: string | null
): DagNode | null {
  if (!dagNodes || !nodeId) return null;
  return dagNodes.find(node => node.id === nodeId) ?? null;
}

export function getDagNodeKind(node: DagNode): string {
  if ('script' in node) return 'script';
  if ('bash' in node) return 'bash';
  if ('loop' in node) return 'loop';
  if ('approval' in node) return 'approval';
  if ('command' in node) return 'command';
  if ('classify' in node) return 'classify';
  if ('prompt' in node) return 'prompt';
  if ('cancel' in node) return 'cancel';
  return 'unknown';
}

export function buildWorkflowNodeSections(
  node: DagNode,
  liveState?: DagNodeState | null
): WorkflowNodeSection[] {
  const sections: WorkflowNodeSection[] = [];

  if (typeof liveState?.resolvedPrompt === 'string' && liveState.resolvedPrompt.trim()) {
    sections.push({
      title: 'Resolved Prompt',
      content: liveState.resolvedPrompt,
      language: 'text',
    });
  }

  if ('prompt' in node && typeof node.prompt === 'string') {
    sections.push({ title: 'Prompt', content: node.prompt, language: 'text' });
  }

  if ('classify' in node && typeof node.classify === 'string') {
    sections.push({ title: 'Classifier Instructions', content: node.classify, language: 'text' });
  }

  if ('script' in node && typeof node.script === 'string') {
    sections.push({
      title: `Script (${node.runtime})`,
      content: node.script,
      language: node.runtime === 'uv' ? 'python' : 'typescript',
    });
  }

  if ('bash' in node && typeof node.bash === 'string') {
    sections.push({ title: 'Shell', content: node.bash, language: 'bash' });
  }

  if ('approval' in node && node.approval) {
    sections.push({
      title: 'Approval Message',
      content: node.approval.message,
      language: 'text',
    });
    if (node.approval.on_reject) {
      sections.push({
        title: 'On Reject',
        content: JSON.stringify(node.approval.on_reject, null, 2),
        language: 'json',
      });
    }
  }

  if ('loop' in node) {
    if (typeof node.loop?.prompt === 'string') {
      sections.push({ title: 'Prompt Template', content: node.loop.prompt, language: 'text' });
    }
    sections.push({
      title: 'Loop Config',
      content: JSON.stringify(node.loop, null, 2),
      language: 'json',
    });
  }

  if ('command' in node && typeof node.command === 'string') {
    sections.push({ title: 'Command', content: node.command, language: 'text' });
  }

  sections.push({
    title: 'Raw Node JSON',
    content: JSON.stringify(node, null, 2),
    language: 'json',
  });

  return sections;
}

export function getWorkflowStageInfo(
  workflow: Pick<WorkflowState, 'status' | 'dagNodes' | 'approval' | 'workflowName'>,
  currentlyExecuting?: { nodeName: string } | null
): WorkflowStageInfo {
  if (currentlyExecuting?.nodeName) {
    return { nodeId: currentlyExecuting.nodeName, label: currentlyExecuting.nodeName };
  }

  if (workflow.status === 'paused' && workflow.approval?.nodeId) {
    return { nodeId: workflow.approval.nodeId, label: workflow.approval.nodeId };
  }

  const priorityOrder = ['failed', 'running', 'completed', 'skipped'] as const;
  for (const status of priorityOrder) {
    const match = [...workflow.dagNodes].reverse().find(node => node.status === status);
    if (match) {
      return { nodeId: match.nodeId, label: match.nodeId };
    }
  }

  return { nodeId: null, label: workflow.status };
}

export function buildWorkflowConversationTitle(
  workflowName: string,
  status: WorkflowState['status'],
  stage: WorkflowStageInfo | null | undefined
): string {
  const suffix =
    status === 'running' || status === 'paused'
      ? (stage?.label ?? status)
      : status === 'failed'
        ? stage?.label
          ? `failed @ ${stage.label}`
          : 'failed'
        : status;

  const title = `${workflowName} · ${suffix}`;
  return title.length > 100 ? `${title.slice(0, 97)}...` : title;
}
