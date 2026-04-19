# Workflow Node Payload Dual-Channel Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a first-class structured `payload` channel for workflow nodes so Archon can pass machine-readable data without forcing JSON into human-facing output.

**Architecture:** Extend the runtime node result model from string-only output to dual-channel `output + payload`, persist payload in workflow events, teach substitution to read `$nodeId.payload`, and surface payload in the workflow run UI. Prompt nodes write payload from `output_format`, while `bash` and `script` nodes populate payload through a standard artifact file convention.

**Tech Stack:** TypeScript, Bun, Zod, React, Zustand, workflow DAG executor, provider adapters

---

### Task 1: Add runtime schema support for `node_payload`

**Files:**
- Modify: `/Users/alsritter/Documents/projects/code/alsritter.icu/Archon/packages/workflows/src/schemas/workflow-run.ts`
- Test: `/Users/alsritter/Documents/projects/code/alsritter.icu/Archon/packages/workflows/src/schemas/workflow-run.test.ts`

**Step 1: Write the failing test**

Add tests covering:
- completed node output may include `payload`
- failed node output may include `payload`
- `payload` accepts object, array, scalar, and null
- `pending` / `skipped` nodes reject unexpected payload if that rule is chosen

**Step 2: Run test to verify it fails**

Run: `bun test /Users/alsritter/Documents/projects/code/alsritter.icu/Archon/packages/workflows/src/schemas/workflow-run.test.ts`

Expected: FAIL because `nodeOutputSchema` does not yet support `payload`

**Step 3: Write minimal implementation**

Implement:
- reusable JSON value schema
- optional `payload` on running/completed/failed node states

**Step 4: Run test to verify it passes**

Run the same test command and confirm PASS.

**Step 5: Commit**

```bash
git -C /Users/alsritter/Documents/projects/code/alsritter.icu/Archon add packages/workflows/src/schemas/workflow-run.ts packages/workflows/src/schemas/workflow-run.test.ts
git -C /Users/alsritter/Documents/projects/code/alsritter.icu/Archon commit -m "feat: add workflow node payload schema"
```

### Task 2: Persist `node_payload` in workflow events

**Files:**
- Modify: `/Users/alsritter/Documents/projects/code/alsritter.icu/Archon/packages/core/src/db/workflow-events.ts`
- Test: `/Users/alsritter/Documents/projects/code/alsritter.icu/Archon/packages/core/src/db/workflow-events.test.ts`

**Step 1: Write the failing test**

Add tests covering:
- `getCompletedDagNodeOutputs()` restores both `node_output` and `node_payload`
- old rows with only `node_output` still work
- malformed `node_payload` is ignored with safe fallback

**Step 2: Run test to verify it fails**

Run: `bun test /Users/alsritter/Documents/projects/code/alsritter.icu/Archon/packages/core/src/db/workflow-events.test.ts`

Expected: FAIL because the restore helper only returns strings today.

**Step 3: Write minimal implementation**

Change the restore path so it returns enough information for the DAG executor to rebuild full `NodeOutput` values, not just output strings.

**Step 4: Run test to verify it passes**

Run the same test command and confirm PASS.

**Step 5: Commit**

```bash
git -C /Users/alsritter/Documents/projects/code/alsritter.icu/Archon add packages/core/src/db/workflow-events.ts packages/core/src/db/workflow-events.test.ts
git -C /Users/alsritter/Documents/projects/code/alsritter.icu/Archon commit -m "feat: persist workflow node payload events"
```

### Task 3: Teach substitution to support `$nodeId.payload`

**Files:**
- Modify: `/Users/alsritter/Documents/projects/code/alsritter.icu/Archon/packages/workflows/src/dag-executor.ts`
- Modify: `/Users/alsritter/Documents/projects/code/alsritter.icu/Archon/packages/workflows/src/condition-evaluator.ts`
- Test: `/Users/alsritter/Documents/projects/code/alsritter.icu/Archon/packages/workflows/src/dag-executor.test.ts`
- Test: `/Users/alsritter/Documents/projects/code/alsritter.icu/Archon/packages/workflows/src/condition-evaluator.test.ts`

**Step 1: Write the failing test**

Add tests for:
- `$nodeId.payload`
- `$nodeId.payload.field`
- fallback behavior for missing payload
- compatibility of `$nodeId.output.field` when payload exists

**Step 2: Run test to verify it fails**

Run:
- `bun test /Users/alsritter/Documents/projects/code/alsritter.icu/Archon/packages/workflows/src/dag-executor.test.ts`
- `bun test /Users/alsritter/Documents/projects/code/alsritter.icu/Archon/packages/workflows/src/condition-evaluator.test.ts`

Expected: FAIL because only `.output` references exist today.

**Step 3: Write minimal implementation**

Update substitution parsing to:
- resolve `.payload`
- resolve `.payload.field`
- keep `.output` unchanged
- optionally prefer payload when handling `.output.field` compatibility

**Step 4: Run test to verify it passes**

Run the same test commands and confirm PASS.

**Step 5: Commit**

```bash
git -C /Users/alsritter/Documents/projects/code/alsritter.icu/Archon add packages/workflows/src/dag-executor.ts packages/workflows/src/condition-evaluator.ts packages/workflows/src/dag-executor.test.ts packages/workflows/src/condition-evaluator.test.ts
git -C /Users/alsritter/Documents/projects/code/alsritter.icu/Archon commit -m "feat: support workflow payload substitution"
```

### Task 4: Populate payload for `prompt` nodes using `output_format`

**Files:**
- Modify: `/Users/alsritter/Documents/projects/code/alsritter.icu/Archon/packages/providers/src/codex/provider.ts`
- Modify: `/Users/alsritter/Documents/projects/code/alsritter.icu/Archon/packages/workflows/src/dag-executor.ts`
- Test: `/Users/alsritter/Documents/projects/code/alsritter.icu/Archon/packages/providers/src/codex/provider.test.ts`
- Test: `/Users/alsritter/Documents/projects/code/alsritter.icu/Archon/packages/workflows/src/dag-executor.test.ts`

**Step 1: Write the failing test**

Cover:
- structured provider response produces `payload`
- human-readable output still lands in `output`
- invalid structured output leaves payload empty and does not crash

**Step 2: Run test to verify it fails**

Run:
- `bun test /Users/alsritter/Documents/projects/code/alsritter.icu/Archon/packages/providers/src/codex/provider.test.ts`
- `bun test /Users/alsritter/Documents/projects/code/alsritter.icu/Archon/packages/workflows/src/dag-executor.test.ts`

Expected: FAIL because structured output is currently folded back into the text output path.

**Step 3: Write minimal implementation**

Make prompt execution:
- retain display text in `output`
- store parsed structured result in `payload`
- emit both fields in `node_completed`

**Step 4: Run test to verify it passes**

Run the same tests and confirm PASS.

**Step 5: Commit**

```bash
git -C /Users/alsritter/Documents/projects/code/alsritter.icu/Archon add packages/providers/src/codex/provider.ts packages/providers/src/codex/provider.test.ts packages/workflows/src/dag-executor.ts packages/workflows/src/dag-executor.test.ts
git -C /Users/alsritter/Documents/projects/code/alsritter.icu/Archon commit -m "feat: store prompt structured output as payload"
```

### Task 5: Add payload file ingestion for `script` and `bash`

**Files:**
- Modify: `/Users/alsritter/Documents/projects/code/alsritter.icu/Archon/packages/workflows/src/dag-executor.ts`
- Test: `/Users/alsritter/Documents/projects/code/alsritter.icu/Archon/packages/workflows/src/dag-executor.test.ts`

**Step 1: Write the failing test**

Add tests covering:
- `script` writes `$ARTIFACTS_DIR/<nodeId>.payload.json` and executor captures it
- `bash` writes the same file and executor captures it
- missing file leaves payload undefined
- invalid JSON file causes node failure or warning, depending on desired policy

**Step 2: Run test to verify it fails**

Run: `bun test /Users/alsritter/Documents/projects/code/alsritter.icu/Archon/packages/workflows/src/dag-executor.test.ts`

Expected: FAIL because executor does not read payload files today.

**Step 3: Write minimal implementation**

Implement a small helper:
- look for `<nodeId>.payload.json` in artifacts dir after `script` / `bash`
- parse JSON safely
- attach to node result as `payload`

**Step 4: Run test to verify it passes**

Run the same test command and confirm PASS.

**Step 5: Commit**

```bash
git -C /Users/alsritter/Documents/projects/code/alsritter.icu/Archon add packages/workflows/src/dag-executor.ts packages/workflows/src/dag-executor.test.ts
git -C /Users/alsritter/Documents/projects/code/alsritter.icu/Archon commit -m "feat: ingest workflow payload files"
```

### Task 6: Surface payload in workflow run UI

**Files:**
- Modify: `/Users/alsritter/Documents/projects/code/alsritter.icu/Archon/packages/web/src/components/workflows/WorkflowNodeDetails.tsx`
- Modify: `/Users/alsritter/Documents/projects/code/alsritter.icu/Archon/packages/web/src/components/workflows/WorkflowExecution.tsx`
- Modify: `/Users/alsritter/Documents/projects/code/alsritter.icu/Archon/packages/web/src/lib/workflow-node-details.ts`
- Test: `/Users/alsritter/Documents/projects/code/alsritter.icu/Archon/packages/web/src/lib/workflow-node-details.test.ts`
- Test: `/Users/alsritter/Documents/projects/code/alsritter.icu/Archon/packages/web/src/components/workflows/WorkflowExecution.test.ts`

**Step 1: Write the failing test**

Add tests for:
- details panel shows `Structured Payload` tab only when payload exists
- payload renders formatted JSON
- output tab still works for nodes without payload

**Step 2: Run test to verify it fails**

Run:
- `bun test /Users/alsritter/Documents/projects/code/alsritter.icu/Archon/packages/web/src/lib/workflow-node-details.test.ts`
- `bun test /Users/alsritter/Documents/projects/code/alsritter.icu/Archon/packages/web/src/components/workflows/WorkflowExecution.test.ts`

Expected: FAIL because the UI currently only models text output.

**Step 3: Write minimal implementation**

Update view-model and components so nodes can expose both display output and payload.

**Step 4: Run test to verify it passes**

Run the same tests and confirm PASS.

**Step 5: Commit**

```bash
git -C /Users/alsritter/Documents/projects/code/alsritter.icu/Archon add packages/web/src/components/workflows/WorkflowNodeDetails.tsx packages/web/src/components/workflows/WorkflowExecution.tsx packages/web/src/lib/workflow-node-details.ts packages/web/src/lib/workflow-node-details.test.ts packages/web/src/components/workflows/WorkflowExecution.test.ts
git -C /Users/alsritter/Documents/projects/code/alsritter.icu/Archon commit -m "feat: show workflow node payload in run details"
```

### Task 7: Update docs and builder guidance

**Files:**
- Modify: `/Users/alsritter/Documents/projects/code/alsritter.icu/Archon/packages/docs-web/src/content/docs/reference/variables.md`
- Modify: `/Users/alsritter/Documents/projects/code/alsritter.icu/Archon/packages/web/src/components/workflows/NodeInspector.tsx`
- Test: `/Users/alsritter/Documents/projects/code/alsritter.icu/Archon/packages/web/src/components/workflows/NodeInspector.test.tsx`

**Step 1: Write the failing test**

Add coverage for:
- inspector help text mentions payload behavior where relevant
- docs examples include `$nodeId.payload.field`

**Step 2: Run test to verify it fails**

Run: `bun test /Users/alsritter/Documents/projects/code/alsritter.icu/Archon/packages/web/src/components/workflows/NodeInspector.test.tsx`

Expected: FAIL because there is no payload guidance today.

**Step 3: Write minimal implementation**

Update docs and inspector copy to explain:
- `output` is for display
- `payload` is for structured machine data
- `script` / `bash` can emit payload files

**Step 4: Run test to verify it passes**

Run the same test command and confirm PASS.

**Step 5: Commit**

```bash
git -C /Users/alsritter/Documents/projects/code/alsritter.icu/Archon add packages/docs-web/src/content/docs/reference/variables.md packages/web/src/components/workflows/NodeInspector.tsx packages/web/src/components/workflows/NodeInspector.test.tsx
git -C /Users/alsritter/Documents/projects/code/alsritter.icu/Archon commit -m "docs: document workflow payload channel"
```

### Task 8: Run full verification sweep

**Files:**
- No code changes required unless failures are found

**Step 1: Run targeted tests**

Run:
- `bun test /Users/alsritter/Documents/projects/code/alsritter.icu/Archon/packages/workflows/src/schemas/workflow-run.test.ts`
- `bun test /Users/alsritter/Documents/projects/code/alsritter.icu/Archon/packages/core/src/db/workflow-events.test.ts`
- `bun test /Users/alsritter/Documents/projects/code/alsritter.icu/Archon/packages/workflows/src/dag-executor.test.ts`
- `bun test /Users/alsritter/Documents/projects/code/alsritter.icu/Archon/packages/workflows/src/condition-evaluator.test.ts`
- `bun test /Users/alsritter/Documents/projects/code/alsritter.icu/Archon/packages/providers/src/codex/provider.test.ts`
- `bun test /Users/alsritter/Documents/projects/code/alsritter.icu/Archon/packages/web/src/lib/workflow-node-details.test.ts`
- `bun test /Users/alsritter/Documents/projects/code/alsritter.icu/Archon/packages/web/src/components/workflows/WorkflowExecution.test.ts`
- `bun test /Users/alsritter/Documents/projects/code/alsritter.icu/Archon/packages/web/src/components/workflows/NodeInspector.test.tsx`

**Step 2: Run type-check**

Run: `bun --cwd /Users/alsritter/Documents/projects/code/alsritter.icu/Archon run type-check`

Expected: PASS

**Step 3: Smoke-test one real workflow**

Suggested scenario:
- create a prompt node with `output_format`
- create a script node that writes `<nodeId>.payload.json`
- verify run page shows summary in output and structured object in payload

**Step 4: Commit final stabilization if needed**

```bash
git -C /Users/alsritter/Documents/projects/code/alsritter.icu/Archon add -A
git -C /Users/alsritter/Documents/projects/code/alsritter.icu/Archon commit -m "test: verify workflow payload dual-channel support"
```
