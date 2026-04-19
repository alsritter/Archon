import { describe, expect, it } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { NodeInspector } from './NodeInspector';
import type { DagFlowNode } from './DagNodeComponent';

describe('NodeInspector', () => {
  it('renders script-specific controls for script nodes', () => {
    const node: DagFlowNode['data'] = {
      id: 'script-node',
      label: 'Script',
      nodeType: 'script',
      bashScript: 'import fs from "node:fs";',
      runtime: 'bun',
    };

    const markup = renderToStaticMarkup(
      <NodeInspector
        node={node}
        commands={[]}
        onUpdate={(): void => undefined}
        onDelete={(): void => undefined}
        onClose={(): void => undefined}
      />
    );

    expect(markup).toContain('value="script"');
    expect(markup).toContain('Script');
    expect(markup).toContain('Runtime');
    expect(markup).toContain('import fs from');
  });
});
