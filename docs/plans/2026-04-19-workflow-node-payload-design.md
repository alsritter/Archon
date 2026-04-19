# Workflow Node Output/Payload Dual-Channel Design

## 背景

Archon 当前工作流节点之间的正式传递通道只有 `node_output: string`。这带来几个持续性问题：

- `prompt` 节点即使声明了 `output_format`，下游本质上仍然是在消费一个字符串，并依赖 `JSON.parse($nodeId.output)` 或 `$nodeId.output.field` 的隐式解析。
- `script` / `bash` 节点如果要向下游传递结构化数据，只能把 JSON 打到 stdout，再让下游把它当字符串重新解析。
- 聊天、飞书、运行页展示和“供下游机器消费的真实结构化数据”共用一个通道，导致我们很难既保留自然语言展示，又安全传参。
- 一旦把自由文本或 JSON 直接内联到脚本源码里，反引号、引号、换行、超长文本都会变成脆弱点。

这次设计的目标，是把“对人展示的输出”和“对机器消费的载荷”正式拆开，同时尽量不破坏现有 workflow 写法。

## 目标

- 保留现有 `$nodeId.output` 语义，保证旧 workflow 可继续运行。
- 新增正式的结构化传递通道，避免下游必须从字符串里猜 JSON。
- 允许 `prompt`、`script`、`bash` 节点产出私有结构化结果，而不把 JSON 原样显示在聊天/飞书里。
- 让运行页能同时查看展示输出和结构化载荷，方便排查问题。

## 非目标

- 不在这一轮重写所有 workflow。
- 不取消 artifact 机制；artifact 仍然适合承载大文档和长文本。
- 不在这一轮引入复杂的多通道 stdout/stderr 协议。

## 方案概览

引入 `output / payload` 双通道模型：

- `output`
  - 面向人类展示
  - 类型保持为 `string`
  - 用于聊天、飞书、运行页默认展示
- `payload`
  - 面向机器消费
  - 类型允许为任意 JSON 值
  - 用于节点间结构化传参和条件判断

推荐语义：

- 自然语言摘要、审批文案、shell 可读日志写到 `output`
- 结构化分类结果、回写 payload、计划对象写到 `payload`
- 长文档正文或大对象仍优先写入 artifact 文件

## 数据模型改造

### 1. NodeOutput 结构

当前 `NodeOutput` 只包含 `output`。改造后增加可选 `payload`：

```ts
type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

type NodeOutput =
  | { state: 'completed' | 'running'; output: string; payload?: JsonValue; sessionId?: string }
  | { state: 'failed'; output: string; payload?: JsonValue; sessionId?: string; error: string }
  | { state: 'pending' | 'skipped'; output: string };
```

说明：

- `payload` 只在运行中、完成或失败节点上出现。
- `pending` / `skipped` 不需要 `payload`。
- `payload` 只接受 JSON 兼容值，避免塞入不可序列化对象。

### 2. Workflow Event 存储

`remote_agent_workflow_events.data` 里新增 `node_payload` 字段：

```json
{
  "node_output": "给人看的摘要",
  "node_payload": {
    "action": "direct_develop",
    "next_status": "开发中"
  }
}
```

兼容策略：

- 老事件只有 `node_output`
- 新代码读取时把缺失 `node_payload` 当 `undefined`

## 变量替换语义

### 保留

- `$nodeId.output`
- `$nodeId.output.field`

### 新增

- `$nodeId.payload`
- `$nodeId.payload.field`

推荐语义：

- `$nodeId.output` 永远返回展示字符串
- `$nodeId.payload` 返回 JSON 字符串化后的完整 payload，主要供调试或传给脚本文件
- `$nodeId.payload.field` 返回 payload 上对应字段的标量值

兼容规则：

- 如果 workflow 继续使用 `$nodeId.output.field`，且该节点有 `payload`，优先尝试从 `payload` 取字段
- 如果没有 `payload`，再按旧逻辑从 `JSON.parse(output)` 回退
- 运行日志增加一次性 warning，引导作者迁移到 `$nodeId.payload.field`

## 节点产出策略

### prompt 节点

- 当声明 `output_format` 时：
  - 结构化结果写入 `payload`
  - provider 返回的自然语言文本写入 `output`
- 如果 provider 只返回结构化 JSON，没有自然语言摘要：
  - `output` 可退化为原始文本
  - UI 明确提示“该节点主要产出结构化 payload”

这能解决“下游需要结构化数据，但聊天里不想看到一坨 JSON”的问题。

### script / bash 节点

为避免破坏现有 stdout 约定，采用标准 payload 文件探测：

- stdout 继续写入 `output`
- 若节点执行完成后存在：
  - `$ARTIFACTS_DIR/<nodeId>.payload.json`
- 执行器自动读取并解析该文件，将结果写入 `payload`

这样作者可以：

- 用 `console.log("已生成回写摘要")` 控制展示文本
- 用写文件的方式传递结构化结果

避免“为了传参而把 JSON 打到飞书里”。

### approval 节点

第一阶段保持不变：

- 审批评论继续进 `output`
- 不新增复杂 payload 表单

后续如有需要，可以单独支持结构化审批结果。

## 运行页与 Builder 展示

运行页节点详情新增 3 个视图：

- `Display Output`
- `Structured Payload`
- `Raw Event`

默认体验：

- 默认展开 `Display Output`
- 仅当存在 `payload` 时显示 `Structured Payload` tab
- `Raw Event` 用于调试事件级问题

这能把“给用户/飞书看的内容”和“给开发排查看的真实结构”分开。

Builder 文案和文档同步更新：

- 在变量参考里新增 `$nodeId.payload` / `$nodeId.payload.field`
- 在节点编辑器里补充帮助说明：
  - `output_format` 的结构化结果会进入 `payload`
  - `bash/script` 可通过标准 payload 文件产出结构化结果

## Artifact 的角色

双通道不是要替代 artifact，而是分层：

- `output`：短文本、摘要、给人看
- `payload`：小到中等规模结构化对象、给机器传参
- `artifact`：大文本、完整文档、产物文件

经验规则：

- 几 KB 以内、字段化明显的数据，放 `payload`
- PRD、Plan、完整 Markdown 文档、日志大段内容，放 artifact

## 向后兼容与迁移

第一阶段不改任何现有 workflow 行为：

- 没有 `payload` 的节点，完全按旧逻辑运行
- 老 workflow 继续使用 `$nodeId.output`
- 条件表达式仍可用 `$nodeId.output.field`

推荐迁移顺序：

1. 新 workflow 优先使用 `$nodeId.payload.field`
2. 旧 workflow 在需要维护时逐步迁移
3. 文档中明确把 `$nodeId.output.field` 标注为兼容写法，而非首选

## 风险与取舍

### 风险 1：运行态对象变复杂

增加 `payload` 后，事件、恢复逻辑、UI 读取路径都会多一层判断。

缓解：

- 保持 `payload` 可选
- 所有读取点先兼容老事件
- 增加专门的 schema/恢复测试

### 风险 2：stdout 与 payload 文件双源不一致

`script` / `bash` 同时有 stdout 和 payload 文件时，作者可能写出互相冲突的信息。

缓解：

- 文档明确：
  - stdout 是展示摘要
  - payload 文件是机器数据
- 运行页同时展示两者，便于定位不一致

### 风险 3：现有 `.output.field` 语义混乱

如果继续同时支持从 `output` JSON 和 `payload` 取字段，作者可能搞不清楚来源。

缓解：

- 文档和 warning 明确首选 `payload.field`
- 仅把 `.output.field` 保留为兼容层

## 推荐实施范围

建议按最小可用集落地：

1. schema + 事件存储支持 `node_payload`
2. 执行器恢复和 substitution 支持 `$nodeId.payload` / `$nodeId.payload.field`
3. `prompt.output_format` 自动写入 `payload`
4. `bash/script` 支持标准 payload 文件自动收集
5. 运行页新增 payload 展示
6. 文档更新

这样已经足以支撑：

- 不在飞书里打印 JSON
- 稳定传递结构化对象
- 在运行页排查真实 payload

## 验收标准

- 一个 `prompt + output_format` 节点可以产出自然语言 `output` 和结构化 `payload`
- 下游能用 `$nodeId.payload.field` 获取字段，不必再依赖 `JSON.parse(output)`
- 一个 `script` 节点可通过标准 payload 文件传递对象，同时 stdout 只显示摘要
- 运行页能同时查看 `Display Output` 与 `Structured Payload`
- 旧 workflow 不修改也能继续运行
