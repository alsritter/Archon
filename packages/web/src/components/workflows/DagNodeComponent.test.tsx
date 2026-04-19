import { createElement } from 'react';
import { describe, expect, it } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { ReactFlowProvider } from '@xyflow/react';
import { dagNodeComponent } from './DagNodeComponent';

describe('DagNodeComponent', () => {
  it('renders command preview text when present', () => {
    const markup = renderToStaticMarkup(
      createElement(
        ReactFlowProvider,
        null,
        createElement(
          dagNodeComponent as unknown as React.ComponentType<unknown>,
          {
            id: 'draft-design',
            type: 'dagNode',
            selected: false,
            dragging: false,
            zIndex: 0,
            isConnectable: false,
            data: {
              id: 'draft-design',
              label: 'story-draft-design',
              nodeType: 'command',
              command: 'story-draft-design',
              commandPreview: '根据已确认方案输出结构化设计草稿。',
            },
            positionAbsoluteX: 0,
            positionAbsoluteY: 0,
          } as Record<string, unknown>
        )
      )
    );

    expect(markup).toContain('story-draft-design');
    expect(markup).toContain('根据已确认方案输出结构化设计草稿。');
  });
});
