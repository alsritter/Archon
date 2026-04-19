import { describe, expect, it } from 'bun:test';
import type { Edge } from '@xyflow/react';
import { reactFlowToDagNodes } from './WorkflowCanvas';
import type { DagFlowNode } from './DagNodeComponent';
import { resolveNodeDisplay } from '@/lib/dag-layout';

describe('reactFlowToDagNodes', () => {
  it('maps command_preview from workflow nodes into commandPreview display data', () => {
    const display = resolveNodeDisplay({
      id: 'draft-design',
      command: 'story-draft-design',
      command_preview:
        'Turn an approved brainstorming design snapshot into a structured design draft for one story',
    } as any);

    expect(display).toMatchObject({
      label: 'story-draft-design',
      nodeType: 'command',
      commandPreview:
        'Turn an approved brainstorming design snapshot into a structured design draft for one story',
    });
  });

  it('falls back to the raw command name when serializing command nodes without labels', () => {
    const nodes: DagFlowNode[] = [
      {
        id: 'draft-design',
        type: 'dagNode',
        position: { x: 0, y: 0 },
        data: {
          id: 'draft-design',
          label: '',
          nodeType: 'command',
          command: 'story-draft-design',
        },
      },
    ];

    const dagNodes = reactFlowToDagNodes(nodes, []);

    expect(dagNodes).toEqual([
      {
        id: 'draft-design',
        command: 'story-draft-design',
        depends_on: undefined,
        when: undefined,
        trigger_rule: undefined,
        model: undefined,
        provider: undefined,
        context: undefined,
        output_format: undefined,
        allowed_tools: undefined,
        denied_tools: undefined,
        hooks: undefined,
        mcp: undefined,
        skills: undefined,
      },
    ]);
  });

  it('preserves script, approval, and loop nodes when converting back to DAG nodes', () => {
    const nodes: DagFlowNode[] = [
      {
        id: 'script-node',
        type: 'dagNode',
        position: { x: 0, y: 0 },
        data: {
          id: 'script-node',
          label: 'Script',
          nodeType: 'script',
          bashScript: 'console.log("hi")',
          runtime: 'bun',
        },
      },
      {
        id: 'approval-node',
        type: 'dagNode',
        position: { x: 0, y: 100 },
        data: {
          id: 'approval-node',
          label: 'Approval',
          nodeType: 'approval',
          promptText: '请确认是否继续',
          approval: {
            message: '请确认是否继续',
            capture_response: true,
          },
        },
      },
      {
        id: 'loop-node',
        type: 'dagNode',
        position: { x: 0, y: 200 },
        data: {
          id: 'loop-node',
          label: 'Loop',
          nodeType: 'loop',
          promptText: '继续迭代',
          loop: {
            prompt: '继续迭代',
            until: 'DONE',
            max_iterations: 3,
            fresh_context: false,
          },
        },
      },
    ];

    const edges: Edge[] = [
      { id: 'script-node->approval-node', source: 'script-node', target: 'approval-node' },
      { id: 'approval-node->loop-node', source: 'approval-node', target: 'loop-node' },
    ];

    const dagNodes = reactFlowToDagNodes(nodes, edges);

    expect(dagNodes[0]).toMatchObject({
      id: 'script-node',
      script: 'console.log("hi")',
      runtime: 'bun',
    });
    expect(dagNodes[1]).toMatchObject({
      id: 'approval-node',
      approval: {
        message: '请确认是否继续',
        capture_response: true,
      },
    });
    expect(dagNodes[2]).toMatchObject({
      id: 'loop-node',
      loop: {
        prompt: '继续迭代',
        until: 'DONE',
        max_iterations: 3,
        fresh_context: false,
      },
    });
  });

  it('preserves classify nodes when converting back to DAG nodes', () => {
    const nodes: DagFlowNode[] = [
      {
        id: 'route-node',
        type: 'dagNode',
        position: { x: 0, y: 0 },
        data: {
          id: 'route-node',
          label: 'Classifier',
          nodeType: 'classify',
          promptText: 'Choose the route',
          output_format: {
            type: 'object',
            properties: {
              route: { type: 'string' },
            },
            required: ['route'],
          },
        },
      },
    ];

    const dagNodes = reactFlowToDagNodes(nodes, []);

    expect(dagNodes[0]).toMatchObject({
      id: 'route-node',
      classify: 'Choose the route',
      output_format: {
        type: 'object',
        properties: {
          route: { type: 'string' },
        },
        required: ['route'],
      },
    });
  });
});
