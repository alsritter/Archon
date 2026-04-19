import { describe, expect, test } from 'bun:test';

import {
  buildWorkflowConversationTitle,
  buildWorkflowNodeSections,
  findWorkflowNode,
  getDagNodeKind,
  getWorkflowStageInfo,
} from './workflow-node-details';
import type { DagNode } from '@/lib/api';
import type { DagNodeState, WorkflowState } from '@/lib/types';

const promptNode = {
  id: 'classify_gap',
  prompt: 'Decide whether this story has a requirement gap.',
  depends_on: ['load_story'],
} as DagNode;

const scriptNode = {
  id: 'load_story',
  script: "import fs from 'node:fs';",
  runtime: 'bun',
} as DagNode;

const loopNode = {
  id: 'design_gap_loop',
  loop: {
    prompt: '补齐方案缺口：$review_context.output',
    until: 'READY',
    max_iterations: 3,
  },
} as DagNode;

function makeWorkflow(overrides: Partial<WorkflowState> = {}): WorkflowState {
  return {
    runId: 'run-1',
    workflowName: 'story-review',
    status: 'running',
    dagNodes: [
      { nodeId: 'load_story', name: 'load_story', status: 'completed' },
      { nodeId: 'classify_gap', name: 'classify_gap', status: 'running' },
    ],
    artifacts: [],
    startedAt: 1_000,
    currentTool: null,
    ...overrides,
  };
}

describe('workflow-node-details', () => {
  test('finds workflow node by selected id', () => {
    expect(findWorkflowNode([scriptNode, promptNode], 'classify_gap')).toEqual(promptNode);
    expect(findWorkflowNode([scriptNode, promptNode], 'missing')).toBeNull();
  });

  test('derives node kind and sections for prompt/script nodes', () => {
    expect(getDagNodeKind(promptNode)).toBe('prompt');
    expect(getDagNodeKind(scriptNode)).toBe('script');

    expect(buildWorkflowNodeSections(promptNode).map(section => section.title)).toEqual([
      'Prompt',
      'Raw Node JSON',
    ]);
    expect(buildWorkflowNodeSections(scriptNode).map(section => section.title)).toEqual([
      'Script (bun)',
      'Raw Node JSON',
    ]);
  });

  test('shows resolved prompt before the loop template when runtime prompt exists', () => {
    const liveState = {
      nodeId: 'design_gap_loop',
      name: 'design_gap_loop',
      status: 'running',
      resolvedPrompt: '补齐方案缺口：这里已经是拼接后的真实内容',
    } satisfies DagNodeState;

    expect(buildWorkflowNodeSections(loopNode, liveState).map(section => section.title)).toEqual([
      'Resolved Prompt',
      'Prompt Template',
      'Loop Config',
      'Raw Node JSON',
    ]);
  });

  test('prefers currently executing node as stage label', () => {
    const stage = getWorkflowStageInfo(makeWorkflow(), { nodeName: 'classify_gap' });
    expect(stage).toEqual({ nodeId: 'classify_gap', label: 'classify_gap' });
  });

  test('falls back to approval node when paused', () => {
    const stage = getWorkflowStageInfo(
      makeWorkflow({
        status: 'paused',
        approval: { nodeId: 'approve_design', message: 'Please review' },
        dagNodes: [{ nodeId: 'approve_design', name: 'approve_design', status: 'running' }],
      }),
      null
    );

    expect(stage).toEqual({ nodeId: 'approve_design', label: 'approve_design' });
  });

  test('builds concise conversation titles with stage context', () => {
    const stage = { nodeId: 'classify_gap', label: 'classify_gap' };
    expect(buildWorkflowConversationTitle('story-review', 'running', stage)).toBe(
      'story-review · classify_gap'
    );
    expect(buildWorkflowConversationTitle('story-review', 'failed', stage)).toBe(
      'story-review · failed @ classify_gap'
    );
    expect(buildWorkflowConversationTitle('story-review', 'completed', stage)).toBe(
      'story-review · completed'
    );
  });
});
