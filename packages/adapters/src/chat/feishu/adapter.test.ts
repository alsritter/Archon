import { beforeEach, describe, expect, mock, test } from 'bun:test';

const mockLogger = {
  fatal: mock(() => undefined),
  error: mock(() => undefined),
  warn: mock(() => undefined),
  info: mock(() => undefined),
  debug: mock(() => undefined),
  trace: mock(() => undefined),
  child: mock(function (this: unknown) {
    return this;
  }),
  bindings: mock(() => ({ module: 'test' })),
  isLevelEnabled: mock(() => true),
  level: 'info',
};

const wsStartMock = mock(() => Promise.resolve(undefined));
const wsCloseMock = mock(() => undefined);
let registeredHandlers: Record<string, (data: unknown) => Promise<void> | void> = {};

const eventDispatcherRegisterMock = mock(
  (handles: Record<string, (data: unknown) => Promise<void> | void>) => {
    registeredHandlers = handles;
    return { register: eventDispatcherRegisterMock };
  }
);
const getOrCreateConversationMock = mock(async () => ({ id: 'conv-db-1' }));
const findConversationByPlatformIdMock = mock(async () => ({ id: 'conv-db-1' }));
const addMessageMock = mock(async () => ({
  id: 'msg-1',
  conversation_id: 'conv-db-1',
  role: 'assistant',
  content: 'persisted',
  metadata: '{}',
  created_at: new Date().toISOString(),
}));

mock.module('@archon/paths', () => ({
  createLogger: mock(() => mockLogger),
}));

mock.module('@archon/core', () => ({
  conversationDb: {
    getOrCreateConversation: getOrCreateConversationMock,
    findConversationByPlatformId: findConversationByPlatformIdMock,
  },
  messageDb: {
    addMessage: addMessageMock,
  },
}));

mock.module('@larksuiteoapi/node-sdk', () => ({
  LoggerLevel: { error: 'error' },
  Domain: { Feishu: 'feishu', Lark: 'lark' },
  EventDispatcher: mock(() => ({
    register: eventDispatcherRegisterMock,
  })),
  WSClient: mock(() => ({
    start: wsStartMock,
    close: wsCloseMock,
  })),
}));

import { FeishuAdapter } from './adapter';

describe('FeishuAdapter', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    registeredHandlers = {};
    wsStartMock.mockClear();
    wsCloseMock.mockClear();
    eventDispatcherRegisterMock.mockClear();
    getOrCreateConversationMock.mockClear();
    findConversationByPlatformIdMock.mockClear();
    addMessageMock.mockClear();
    mockLogger.info.mockClear();
    globalThis.fetch = mock(async (input: string | URL) => {
      const url = String(input);
      if (url.includes('/auth/v3/tenant_access_token/internal')) {
        return new Response(
          JSON.stringify({ code: 0, tenant_access_token: 'tenant-token', expire: 7200 })
        );
      }
      if (url.includes('/reactions')) {
        return new Response(
          JSON.stringify({ code: 0, msg: 'ok', data: { reaction_id: 'reaction-1' } })
        );
      }
      if (url.includes('/reply')) {
        return new Response(
          JSON.stringify({
            code: 0,
            msg: 'ok',
            data: { message_id: 'om_reply_1', chat_id: 'oc_123' },
          })
        );
      }
      return new Response(
        JSON.stringify({ code: 0, msg: 'ok', data: { message_id: 'om_sent_1', chat_id: 'oc_123' } })
      );
    }) as typeof fetch;
  });

  test('returns feishu as platform type', () => {
    const adapter = new FeishuAdapter('app-id', 'app-secret');
    expect(adapter.getPlatformType()).toBe('feishu');
  });

  test('defaults to batch streaming mode', () => {
    const adapter = new FeishuAdapter('app-id', 'app-secret');
    expect(adapter.getStreamingMode()).toBe('batch');
  });

  test('start registers receive handler and starts websocket client', async () => {
    const adapter = new FeishuAdapter('app-id', 'app-secret');

    await adapter.start();

    expect(eventDispatcherRegisterMock).toHaveBeenCalledTimes(1);
    expect(Object.keys(registeredHandlers)).toContain('im.message.receive_v1');
    expect(Object.keys(registeredHandlers)).toContain('card.action.trigger');
    expect(wsStartMock).toHaveBeenCalledTimes(1);
  });

  test('sendMessage uses chat create API for chat conversation ids', async () => {
    const fetchMock = globalThis.fetch as ReturnType<typeof mock>;
    const adapter = new FeishuAdapter('app-id', 'app-secret');

    await adapter.sendMessage('chat:oc_123', 'hello feishu');

    expect(fetchMock.mock.calls[1]?.[0]).toBe(
      'https://open.feishu.cn/open-apis/im/v1/messages?receive_id_type=chat_id'
    );
    const body = JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body)) as {
      msg_type: string;
      content: string;
    };
    expect(body.msg_type).toBe('text');
    expect(JSON.parse(body.content)).toEqual({ text: 'hello feishu' });
    expect(findConversationByPlatformIdMock).toHaveBeenCalledWith('chat:oc_123');
    expect(addMessageMock).toHaveBeenCalledWith(
      'conv-db-1',
      'assistant',
      'hello feishu',
      undefined
    );
  });

  test('setMessageProgressState adds reaction to user message', async () => {
    const fetchMock = globalThis.fetch as ReturnType<typeof mock>;
    const adapter = new FeishuAdapter('app-id', 'app-secret');

    await adapter.setMessageProgressState('om_123', 'received');

    expect(fetchMock.mock.calls[1]?.[0]).toBe(
      'https://open.feishu.cn/open-apis/im/v1/messages/om_123/reactions'
    );
    expect(JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body))).toEqual({
      reaction_type: { emoji_type: 'EYES' },
    });
  });

  test('setMessageProgressState replaces previous reaction when state changes', async () => {
    const fetchMock = globalThis.fetch as ReturnType<typeof mock>;
    const adapter = new FeishuAdapter('app-id', 'app-secret');

    await adapter.setMessageProgressState('om_123', 'received');
    await adapter.setMessageProgressState('om_123', 'done');

    expect(fetchMock.mock.calls[2]?.[0]).toBe(
      'https://open.feishu.cn/open-apis/im/v1/messages/om_123/reactions/reaction-1'
    );
    expect(fetchMock.mock.calls[2]?.[1]?.method).toBe('DELETE');
    expect(fetchMock.mock.calls[3]?.[0]).toBe(
      'https://open.feishu.cn/open-apis/im/v1/messages/om_123/reactions'
    );
    expect(JSON.parse(String(fetchMock.mock.calls[3]?.[1]?.body))).toEqual({
      reaction_type: { emoji_type: 'DONE' },
    });
  });

  test('sendMessage uses reply API for reply conversation ids', async () => {
    const fetchMock = globalThis.fetch as ReturnType<typeof mock>;
    const adapter = new FeishuAdapter('app-id', 'app-secret');

    await adapter.sendMessage('chat:oc_123:reply:om_456', 'reply text');

    expect(fetchMock.mock.calls[1]?.[0]).toBe(
      'https://open.feishu.cn/open-apis/im/v1/messages/om_456/reply'
    );
  });

  test('sendMessage renders workflow dispatch messages as interactive cards', async () => {
    const fetchMock = globalThis.fetch as ReturnType<typeof mock>;
    const adapter = new FeishuAdapter('app-id', 'app-secret');

    await adapter.sendMessage('chat:oc_123', 'Starting workflow: `story-brainstorm-design`', {
      category: 'workflow_dispatch_status',
      workflowDispatch: {
        workerConversationId: 'worker-1',
        workflowName: 'story-brainstorm-design',
        runId: 'run_dispatch_1',
      },
    });

    const body = JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body)) as {
      msg_type: string;
      content: string;
    };
    expect(body.msg_type).toBe('interactive');
    const card = JSON.parse(body.content) as {
      header?: { title?: { content?: string } };
      elements?: Array<{ text?: { content?: string } }>;
    };
    expect(card.header?.title?.content).toContain('story-brainstorm-design');
    expect(card.elements?.[0]?.text?.content).toContain('Starting workflow');
  });

  test('sendMessage hides approve and reject buttons for selection-style approval prompts', async () => {
    const fetchMock = globalThis.fetch as ReturnType<typeof mock>;
    const adapter = new FeishuAdapter('app-id', 'app-secret');

    await adapter.sendMessage(
      'chat:oc_123',
      '⏸ **Approval required**: 请选择一条状态为 设计中 的需求，回复“序号”或“record_id”即可。\n\n候选列表：\n1. 需求 A | record_id:rec_123\n2. 需求 B | record_id:rec_456\n\nRun ID: `run_456`\n直接在当前会话回复内容继续，或输入 `/workflow reject run_456` 取消。',
      {
        category: 'workflow_approval',
      }
    );

    const body = JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body)) as {
      msg_type: string;
      content: string;
    };
    expect(body.msg_type).toBe('interactive');
    const card = JSON.parse(body.content) as {
      elements?: Array<Record<string, unknown>>;
    };
    const content = String(
      (card.elements?.[0] as { text?: { content?: string } } | undefined)?.text?.content ?? ''
    );
    expect(content).toContain('1. 需求 A | record_id:rec_123');
    expect(content).toContain('2. 需求 B | record_id:rec_456');
    const actionBlock = card.elements?.find(element => 'actions' in element) as
      | { actions?: Array<unknown> }
      | undefined;
    expect(actionBlock).toBeUndefined();
    const noteBlock = card.elements?.find(element =>
      (element as { elements?: Array<{ content?: string }> }).elements?.[0]?.content?.includes(
        '直接在当前会话回复内容继续。'
      )
    ) as { elements?: Array<{ content?: string }> } | undefined;
    expect(noteBlock?.elements?.[0]?.content ?? '').toContain('直接在当前会话回复内容继续。');
  });

  test('sendMessage falls back to text when card rendering request fails', async () => {
    const fetchMock = mock(async (input: string | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes('/auth/v3/tenant_access_token/internal')) {
        return new Response(
          JSON.stringify({ code: 0, tenant_access_token: 'tenant-token', expire: 7200 })
        );
      }
      const body = JSON.parse(String(init?.body)) as { msg_type?: string };
      if (body.msg_type === 'interactive') {
        return new Response(JSON.stringify({ code: 99991663, msg: 'invalid card' }));
      }
      return new Response(
        JSON.stringify({
          code: 0,
          msg: 'ok',
          data: { message_id: 'om_text_fallback', chat_id: 'oc_123' },
        })
      );
    }) as typeof fetch;
    globalThis.fetch = fetchMock;
    const adapter = new FeishuAdapter('app-id', 'app-secret');

    await adapter.sendMessage('chat:oc_123', 'Starting workflow: `story-brainstorm-design`', {
      category: 'workflow_dispatch_status',
      workflowDispatch: {
        workerConversationId: 'worker-1',
        workflowName: 'story-brainstorm-design',
        runId: 'run_dispatch_1',
      },
    });

    expect(fetchMock.mock.calls).toHaveLength(4);
    const fallbackBody = JSON.parse(String(fetchMock.mock.calls[3]?.[1]?.body)) as {
      msg_type: string;
      content: string;
    };
    expect(fallbackBody.msg_type).toBe('text');
    expect(JSON.parse(fallbackBody.content)).toEqual({
      text: 'Starting workflow: `story-brainstorm-design`',
    });
  });

  test('sendMessage renders markdown-heavy assistant replies as interactive cards', async () => {
    const fetchMock = globalThis.fetch as ReturnType<typeof mock>;
    const adapter = new FeishuAdapter('app-id', 'app-secret');

    await adapter.sendMessage(
      'chat:oc_123',
      'Boss:\n## 当前理解\n- 方案 A\n- 方案 B\n\n## 下一步\n- 回复 `1`'
    );

    const body = JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body)) as {
      msg_type: string;
      content: string;
    };
    expect(body.msg_type).toBe('interactive');
    const card = JSON.parse(body.content) as {
      header?: { title?: { content?: string } };
      elements?: Array<{ text?: { content?: string } }>;
    };
    expect(card.header?.title?.content).toBe('Assistant reply');
    expect(card.elements?.[0]?.text?.content).toContain('**当前理解**');
    expect(card.elements?.[0]?.text?.content).toContain('• 方案 A');
    expect(card.elements?.[0]?.text?.content).toContain('回复 1');
    expect(card.elements?.[0]?.text?.content).not.toContain('## ');
    expect(card.elements?.[0]?.text?.content).not.toContain('`1`');
  });

  test('receive event invokes handler with normalized text', async () => {
    const adapter = new FeishuAdapter('app-id', 'app-secret');
    const received: string[] = [];

    adapter.onMessage(async ctx => {
      received.push(`${ctx.conversationId}::${ctx.message}`);
    });

    await adapter.start();
    await registeredHandlers['im.message.receive_v1']?.({
      sender: { sender_id: { open_id: 'ou_123' }, sender_type: 'user' },
      message: {
        message_id: 'om_123',
        chat_id: 'oc_123',
        chat_type: 'p2p',
        message_type: 'text',
        content: JSON.stringify({ text: '<at user_id="ou_bot">Archon</at> hello there' }),
      },
    });

    expect(received).toEqual(['chat:oc_123::hello there']);
    expect(getOrCreateConversationMock).toHaveBeenCalledWith('feishu', 'chat:oc_123');
    expect(addMessageMock).toHaveBeenCalledWith('conv-db-1', 'user', 'hello there');
  });

  test('receive event strips leading @mention before slash commands', async () => {
    const adapter = new FeishuAdapter('app-id', 'app-secret');
    const received: string[] = [];

    adapter.onMessage(async ctx => {
      received.push(ctx.message);
    });

    await adapter.start();
    await registeredHandlers['im.message.receive_v1']?.({
      sender: { sender_id: { open_id: 'ou_123' }, sender_type: 'user' },
      message: {
        message_id: 'om_cmd_1',
        chat_id: 'oc_123',
        chat_type: 'p2p',
        message_type: 'text',
        content: JSON.stringify({
          text: '@AI 工作流助手 /repo alsritter/jinxiaoai-root-project-dir',
        }),
      },
    });

    expect(received).toEqual(['/repo alsritter/jinxiaoai-root-project-dir']);
  });

  test('uses root_id as the stable topic key for group subtopics', async () => {
    const adapter = new FeishuAdapter('app-id', 'app-secret');
    const received: string[] = [];

    adapter.onMessage(async ctx => {
      received.push(ctx.conversationId);
    });

    await adapter.start();
    await registeredHandlers['im.message.receive_v1']?.({
      sender: { sender_id: { open_id: 'ou_123' }, sender_type: 'user' },
      message: {
        message_id: 'om_123',
        root_id: 'om_root_1',
        parent_id: 'om_parent_1',
        thread_id: 'omt_thread_1',
        chat_id: 'oc_group_1',
        chat_type: 'group',
        message_type: 'text',
        content: JSON.stringify({ text: 'first reply' }),
      },
    });
    await registeredHandlers['im.message.receive_v1']?.({
      sender: { sender_id: { open_id: 'ou_123' }, sender_type: 'user' },
      message: {
        message_id: 'om_456',
        root_id: 'om_root_1',
        parent_id: 'om_parent_2',
        thread_id: 'omt_thread_1',
        chat_id: 'oc_group_1',
        chat_type: 'group',
        message_type: 'text',
        content: JSON.stringify({ text: 'second reply' }),
      },
    });

    expect(received).toEqual([
      'chat:oc_group_1:thread:om_root_1',
      'chat:oc_group_1:thread:om_root_1',
    ]);
  });

  test('uses root_id as synthetic thread id for topic-style group replies without thread_id', async () => {
    const adapter = new FeishuAdapter('app-id', 'app-secret');
    const received: string[] = [];

    adapter.onMessage(async ctx => {
      received.push(ctx.conversationId);
    });

    await adapter.start();
    await registeredHandlers['im.message.receive_v1']?.({
      sender: { sender_id: { open_id: 'ou_123' }, sender_type: 'user' },
      message: {
        message_id: 'om_901',
        root_id: 'om_topic_root_1',
        parent_id: 'om_topic_parent_1',
        chat_id: 'oc_group_topic_1',
        chat_type: 'group',
        message_type: 'text',
        content: JSON.stringify({ text: 'topic style reply' }),
      },
    });

    expect(received).toEqual(['chat:oc_group_topic_1:thread:om_topic_root_1']);
  });

  test('replies inside stored thread target while keeping stable conversation id', async () => {
    const fetchMock = globalThis.fetch as ReturnType<typeof mock>;
    const adapter = new FeishuAdapter('app-id', 'app-secret');

    adapter.onMessage(async ctx => {
      await adapter.sendMessage(ctx.conversationId, 'thread follow-up');
    });

    await adapter.start();
    await registeredHandlers['im.message.receive_v1']?.({
      sender: { sender_id: { open_id: 'ou_123' }, sender_type: 'user' },
      message: {
        message_id: 'om_789',
        root_id: 'om_root_9',
        thread_id: 'omt_thread_9',
        chat_id: 'oc_group_9',
        chat_type: 'group',
        message_type: 'text',
        content: JSON.stringify({ text: 'reply in thread' }),
      },
    });

    const sendCalls = fetchMock.mock.calls
      .map(call => String(call[0]))
      .filter(url => url.includes('/open-apis/im/v1/messages/om_root_9/reply'));
    expect(sendCalls).toEqual(['https://open.feishu.cn/open-apis/im/v1/messages/om_root_9/reply']);
    const replyBody = JSON.parse(
      String(
        fetchMock.mock.calls.find(call =>
          String(call[0]).includes('/open-apis/im/v1/messages/om_root_9/reply')
        )?.[1]?.body
      )
    ) as { reply_in_thread?: boolean };
    expect(replyBody.reply_in_thread).toBe(true);
    expect(addMessageMock).toHaveBeenCalledWith(
      'conv-db-1',
      'assistant',
      'thread follow-up',
      undefined
    );
  });

  test('replies in thread when group reply only provides root_id', async () => {
    const fetchMock = globalThis.fetch as ReturnType<typeof mock>;
    const adapter = new FeishuAdapter('app-id', 'app-secret');

    adapter.onMessage(async ctx => {
      await adapter.sendMessage(ctx.conversationId, 'topic follow-up');
    });

    await adapter.start();
    await registeredHandlers['im.message.receive_v1']?.({
      sender: { sender_id: { open_id: 'ou_123' }, sender_type: 'user' },
      message: {
        message_id: 'om_topic_2',
        root_id: 'om_topic_root_2',
        parent_id: 'om_topic_parent_2',
        chat_id: 'oc_group_topic_2',
        chat_type: 'group',
        message_type: 'text',
        content: JSON.stringify({ text: 'topic reply no thread id' }),
      },
    });

    const replyCall = fetchMock.mock.calls.find(call =>
      String(call[0]).includes('/open-apis/im/v1/messages/om_topic_root_2/reply')
    );
    expect(replyCall?.[0]).toBe(
      'https://open.feishu.cn/open-apis/im/v1/messages/om_topic_root_2/reply'
    );
    const replyBody = JSON.parse(String(replyCall?.[1]?.body)) as { reply_in_thread?: boolean };
    expect(replyBody.reply_in_thread).toBe(true);
  });

  test('ensureThread creates a stable topic conversation from a top-level group message', async () => {
    const adapter = new FeishuAdapter('app-id', 'app-secret');

    const threadedConversationId = await adapter.ensureThread(
      'chat:oc_group_topic_3:reply:om_topic_cmd_1',
      {
        conversationId: 'chat:oc_group_topic_3:reply:om_topic_cmd_1',
        message: '/topic run story-brainstorm-design 开始方案头脑风暴',
        chatId: 'oc_group_topic_3',
        messageId: 'om_topic_cmd_1',
        replyToMessageId: 'om_topic_cmd_1',
        chatType: 'group',
      }
    );

    expect(threadedConversationId).toBe('chat:oc_group_topic_3:thread:om_topic_cmd_1');
  });

  test('sendMessage replies into ensured topic threads', async () => {
    const fetchMock = globalThis.fetch as ReturnType<typeof mock>;
    const adapter = new FeishuAdapter('app-id', 'app-secret');

    const threadedConversationId = await adapter.ensureThread(
      'chat:oc_group_topic_4:reply:om_topic_cmd_4',
      {
        conversationId: 'chat:oc_group_topic_4:reply:om_topic_cmd_4',
        message: '/topic run story-brainstorm-design 开始方案头脑风暴',
        chatId: 'oc_group_topic_4',
        messageId: 'om_topic_cmd_4',
        replyToMessageId: 'om_topic_cmd_4',
        chatType: 'group',
      }
    );

    await adapter.sendMessage(threadedConversationId, 'topic root message');

    const replyCall = fetchMock.mock.calls.find(call =>
      String(call[0]).includes('/open-apis/im/v1/messages/om_topic_cmd_4/reply')
    );
    expect(replyCall?.[0]).toBe(
      'https://open.feishu.cn/open-apis/im/v1/messages/om_topic_cmd_4/reply'
    );
    const replyBody = JSON.parse(String(replyCall?.[1]?.body)) as { reply_in_thread?: boolean };
    expect(replyBody.reply_in_thread).toBe(true);
  });

  test('ignores unauthorized users when whitelist is configured', async () => {
    const adapter = new FeishuAdapter('app-id', 'app-secret', 'batch', {
      allowedOpenIds: 'ou_allowed',
    });
    let invoked = false;
    adapter.onMessage(async () => {
      invoked = true;
    });

    await adapter.start();
    await registeredHandlers['im.message.receive_v1']?.({
      sender: { sender_id: { open_id: 'ou_blocked' }, sender_type: 'user' },
      message: {
        message_id: 'om_123',
        chat_id: 'oc_123',
        chat_type: 'p2p',
        message_type: 'text',
        content: JSON.stringify({ text: 'hello' }),
      },
    });

    expect(invoked).toBe(false);
  });

  test('routes workflow follow-up cards under the stored workflow root message', async () => {
    const fetchMock = globalThis.fetch as ReturnType<typeof mock>;
    fetchMock.mockImplementation(async (input: string | URL) => {
      const url = String(input);
      if (url.includes('/auth/v3/tenant_access_token/internal')) {
        return new Response(
          JSON.stringify({ code: 0, tenant_access_token: 'tenant-token', expire: 7200 })
        );
      }
      if (url.endsWith('/open-apis/im/v1/messages?receive_id_type=chat_id')) {
        return new Response(
          JSON.stringify({
            code: 0,
            msg: 'ok',
            data: { message_id: 'om_root_card', chat_id: 'oc_123' },
          })
        );
      }
      if (url.includes('/open-apis/im/v1/messages/om_root_card/reply')) {
        return new Response(
          JSON.stringify({
            code: 0,
            msg: 'ok',
            data: { message_id: 'om_child_card', chat_id: 'oc_123' },
          })
        );
      }
      return new Response(JSON.stringify({ code: 0, msg: 'ok' }));
    });

    const adapter = new FeishuAdapter('app-id', 'app-secret');

    await adapter.sendMessage(
      'chat:oc_123:thread:omt_thread_1',
      '🚀 **Starting workflow**: `story-brainstorm-design`',
      {
        category: 'workflow_status',
        workflowRun: {
          workflowName: 'story-brainstorm-design',
          runId: 'run_root_1',
        },
      }
    );

    await adapter.sendMessage(
      'chat:oc_123:thread:omt_thread_1',
      '⏸ **Approval required**: 请选择需求\n\nRun ID: `run_root_1`\n直接在当前会话回复内容继续，或输入 `/workflow reject run_root_1` 取消。',
      {
        category: 'workflow_approval',
      }
    );

    expect(fetchMock.mock.calls[1]?.[0]).toBe(
      'https://open.feishu.cn/open-apis/im/v1/messages?receive_id_type=chat_id'
    );
    expect(fetchMock.mock.calls[2]?.[0]).toBe(
      'https://open.feishu.cn/open-apis/im/v1/messages/om_root_card/reply'
    );
    const replyBody = JSON.parse(String(fetchMock.mock.calls[2]?.[1]?.body)) as {
      reply_in_thread?: boolean;
    };
    expect(replyBody.reply_in_thread).toBe(true);
  });

  test('stop closes websocket client', () => {
    const adapter = new FeishuAdapter('app-id', 'app-secret');
    adapter.stop();
    expect(wsCloseMock).toHaveBeenCalledWith({ force: true });
  });

  test('card.action.trigger routes button actions to registered handler and returns updated card', async () => {
    const adapter = new FeishuAdapter('app-id', 'app-secret');
    adapter.onCardAction(async ({ action, runId }) => ({
      title: 'Updated',
      template: action === 'workflow_approve' ? 'green' : 'red',
      body: `Run: ${runId}`,
    }));

    await adapter.start();
    const result = await registeredHandlers['card.action.trigger']?.({
      open_id: 'ou_123',
      token: 'token',
      tenant_key: 'tenant',
      open_message_id: 'om_123',
      action: {
        tag: 'button',
        value: {
          action: 'workflow_approve',
          run_id: 'run_123',
        },
      },
    });

    expect(result).toMatchObject({
      header: {
        title: {
          content: 'Updated',
        },
        template: 'green',
      },
    });
  });

  test('restores global fetch after tests', () => {
    globalThis.fetch = originalFetch;
    expect(globalThis.fetch).toBe(originalFetch);
    globalThis.fetch = originalFetch;
  });
});
