import { createElement } from 'react';
import { describe, expect, it } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { ReactFlowProvider } from '@xyflow/react';
import { executionDagNode } from './ExecutionDagNode';

describe('ExecutionDagNode', () => {
  it('shows a live badge for the current executing node', () => {
    const markup = renderToStaticMarkup(
      createElement(
        ReactFlowProvider,
        null,
        createElement(
          executionDagNode as unknown as React.ComponentType<unknown>,
          {
            id: 'current-node',
            type: 'executionNode',
            selected: false,
            dragging: false,
            zIndex: 0,
            isConnectable: false,
            data: {
              id: 'current-node',
              label: 'Current Step',
              nodeType: 'prompt',
              current: true,
              status: 'running',
            },
            positionAbsoluteX: 0,
            positionAbsoluteY: 0,
          } as Record<string, unknown>
        )
      )
    );

    expect(markup).toContain('LIVE');
    expect(markup).toContain('Current Step');
  });
});
