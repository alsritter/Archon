/**
 * Feishu/Lark chat adapter using official long-connection (WebSocket) mode.
 * Receives events through WSClient and sends replies via IM APIs.
 */
import {
  conversationDb,
  messageDb,
  type IPlatformAdapter,
  type MessageMetadata,
} from '@archon/core';
import { createLogger } from '@archon/paths';
import {
  Domain,
  EventDispatcher,
  LoggerLevel,
  type InteractiveCardActionEvent,
  WSClient,
} from '@larksuiteoapi/node-sdk';
import { splitIntoParagraphChunks } from '../../utils/message-splitting';
import { isOpenIdAuthorized, parseAllowedOpenIds } from './auth';
import type { FeishuMessageContext } from './types';

/** Lazy-initialized logger (deferred so test mocks can intercept createLogger) */
let cachedLog: ReturnType<typeof createLogger> | undefined;
function getLog(): ReturnType<typeof createLogger> {
  if (!cachedLog) cachedLog = createLogger('adapter.feishu');
  return cachedLog;
}

const FEISHU_BASE_URL = 'https://open.feishu.cn';
const LARK_BASE_URL = 'https://open.larksuite.com';
const MAX_TEXT_CHUNK_LENGTH = 4000;
const TOKEN_REFRESH_SKEW_MS = 60_000;
const MAX_CARD_MARKDOWN_LENGTH = 12_000;

interface FeishuTokenState {
  token: string;
  expiresAt: number;
}

type FeishuDomain = 'feishu' | 'lark';
type FeishuProgressState = 'received' | 'running' | 'done' | 'failed';

function toSdkDomain(domain: FeishuDomain): Domain {
  return domain === 'lark' ? Domain.Lark : Domain.Feishu;
}

interface FeishuAdapterOptions {
  verificationToken?: string;
  encryptKey?: string;
  allowedOpenIds?: string;
  domain?: FeishuDomain;
  baseUrl?: string;
}

interface ReceiveMessageEvent {
  sender: {
    sender_id?: {
      open_id?: string;
      union_id?: string;
      user_id?: string;
    };
    sender_type: string;
  };
  message: {
    message_id: string;
    root_id?: string;
    parent_id?: string;
    thread_id?: string;
    chat_id: string;
    chat_type: string;
    message_type: string;
    content: string;
    mentions?: {
      key: string;
      id: {
        union_id?: string;
        user_id?: string;
        open_id?: string;
      };
      name: string;
    }[];
  };
}

function getBaseUrl(domain: FeishuDomain, override?: string): string {
  if (override) return override.replace(/\/+$/, '');
  return domain === 'lark' ? LARK_BASE_URL : FEISHU_BASE_URL;
}

function stripFeishuMentions(text: string): string {
  return text
    .replace(/<at\b[^>]*>.*?<\/at>/g, ' ')
    .split('\n')
    .map(line => line.replace(/[ \t]+/g, ' ').trim())
    .filter(Boolean)
    .join('\n');
}

function normalizeFeishuCommandText(text: string): string {
  const trimmed = text.trim();
  if (trimmed.startsWith('/')) {
    return trimmed;
  }

  const slashIndex = trimmed.indexOf('/');
  if (slashIndex <= 0) {
    return trimmed;
  }

  const prefix = trimmed.slice(0, slashIndex).trim();
  if (prefix.startsWith('@') && !prefix.includes('\n')) {
    return trimmed.slice(slashIndex).trim();
  }

  return trimmed;
}

function extractFeishuRichText(rawValue: unknown): string {
  if (typeof rawValue === 'string') return rawValue;
  if (!rawValue || typeof rawValue !== 'object') return '';

  if (Array.isArray(rawValue)) {
    const parts = rawValue.map(item => extractFeishuRichText(item)).filter(Boolean);
    const delimiter = rawValue.every(item => Array.isArray(item)) ? '\n' : '';
    return parts.join(delimiter).trim();
  }

  const record = rawValue as Record<string, unknown>;
  if (record.tag === 'at') {
    return '';
  }
  if (typeof record.text === 'string') {
    return record.text;
  }

  if (record.post) {
    const postText = extractFeishuRichText(record.post);
    if (postText) return postText;
  }

  if (record.content) {
    const contentText = extractFeishuRichText(record.content);
    if (contentText) return contentText;
  }

  const nestedText = Object.values(record)
    .map(value => extractFeishuRichText(value))
    .filter(Boolean)
    .join('\n')
    .trim();

  return nestedText;
}

function parseTextContent(rawContent: string | undefined): string {
  if (!rawContent) return '';
  try {
    const parsed = JSON.parse(rawContent) as { text?: unknown };
    if (typeof parsed.text === 'string') {
      return normalizeFeishuCommandText(stripFeishuMentions(parsed.text));
    }
    const richText = extractFeishuRichText(parsed);
    if (richText) {
      return normalizeFeishuCommandText(stripFeishuMentions(richText));
    }
  } catch {
    return normalizeFeishuCommandText(stripFeishuMentions(rawContent));
  }
  return '';
}

function buildConversationId(
  chatType: string | undefined,
  chatId: string,
  messageId: string,
  threadId?: string
): string {
  if (chatType === 'p2p') {
    return `chat:${chatId}`;
  }
  if (threadId) {
    return `chat:${chatId}:thread:${threadId}`;
  }
  return `chat:${chatId}:reply:${messageId}`;
}

function parseConversationId(conversationId: string): {
  chatId: string;
  threadId?: string;
  replyToMessageId?: string;
} {
  if (conversationId.startsWith('chat:')) {
    const threadMarker = ':thread:';
    const replyMarker = ':reply:';
    const threadIndex = conversationId.indexOf(threadMarker);
    const replyIndex = conversationId.indexOf(replyMarker);
    if (threadIndex >= 0) {
      return {
        chatId: conversationId.slice(5, threadIndex),
        threadId: conversationId.slice(threadIndex + threadMarker.length),
      };
    }
    if (replyIndex >= 0) {
      return {
        chatId: conversationId.slice(5, replyIndex),
        replyToMessageId: conversationId.slice(replyIndex + replyMarker.length),
      };
    }
    return { chatId: conversationId.slice(5) };
  }

  return { chatId: conversationId };
}

function maskOpenId(openId: string | undefined): string {
  if (!openId) return 'unknown';
  return `${openId.slice(0, 4)}***`;
}

interface FeishuCardPayload {
  config?: {
    wide_screen_mode?: boolean;
    enable_forward?: boolean;
  };
  header?: {
    template?: 'blue' | 'wathet' | 'turquoise' | 'green' | 'yellow' | 'orange' | 'red' | 'grey';
    title?: {
      tag: 'plain_text';
      content: string;
    };
  };
  elements: Record<string, unknown>[];
}

interface FeishuSendResult {
  messageId?: string;
  chatId?: string;
}

interface FeishuConversationTarget {
  chatId: string;
  replyToMessageId?: string;
  threadId?: string;
}

interface WorkflowRootTarget extends FeishuConversationTarget {
  conversationId: string;
}

export interface FeishuCardActionContext {
  action: string;
  runId?: string;
  event: InteractiveCardActionEvent;
}

interface RenderedSystemCard {
  title: string;
  template: NonNullable<NonNullable<FeishuCardPayload['header']>['template']>;
  body: string;
  note?: string;
  actions?: {
    text: string;
    type?: 'default' | 'primary' | 'danger';
    value: Record<string, unknown>;
    confirm?: {
      title: string;
      text: string;
    };
  }[];
}

function looksLikeRichTextMessage(message: string): boolean {
  return (
    /\*\*[^*]+\*\*/.test(message) ||
    /`[^`]+`/.test(message) ||
    /(^|\n)([-*]\s|\d+\.\s)/m.test(message) ||
    /^#{1,6}\s/m.test(message) ||
    message.includes('\n\n')
  );
}

function stripDecorators(text: string): string {
  return text.replace(/^[\p{Emoji_Presentation}\p{Extended_Pictographic}\uFE0F\s]+/gu, '').trim();
}

function normalizeCardMarkdown(text: string): string {
  return text
    .replace(/\r\n/g, '\n')
    .replace(/^>\s?/gm, '')
    .replace(/^#{1,6}\s+(.+)$/gm, '**$1**')
    .replace(/^(\s*)[-*]\s+/gm, '$1• ')
    .replace(/```([\s\S]*?)```/g, (_, code: string) => code.trim())
    .replace(/`([^`]+)`/g, '$1')
    .trim()
    .slice(0, MAX_CARD_MARKDOWN_LENGTH);
}

function extractInlineCodeValue(label: string, text: string): string | null {
  const match = new RegExp(`${label}:\\s*\\\`([^\\\`]+)\\\``).exec(text);
  return match?.[1] ?? null;
}

function inferApprovalInteractionMode(message: string): 'reply' | 'approve_reject' {
  if (
    message.includes('直接在当前会话回复内容继续') ||
    message.includes('回复内容继续') ||
    message.includes('回复“序号”') ||
    message.includes('回复"序号"') ||
    message.includes('回复“record_id”') ||
    message.includes('回复"record_id"')
  ) {
    return 'reply';
  }
  return 'approve_reject';
}

function buildSystemCardPayload(card: RenderedSystemCard): FeishuCardPayload {
  const elements: Record<string, unknown>[] = [
    {
      tag: 'div',
      text: {
        tag: 'lark_md',
        content: normalizeCardMarkdown(card.body),
      },
    },
  ];

  if (card.note) {
    elements.push({
      tag: 'note',
      elements: [
        {
          tag: 'plain_text',
          content: card.note,
        },
      ],
    });
  }

  if (card.actions && card.actions.length > 0) {
    elements.push({
      tag: 'action',
      layout: card.actions.length >= 3 ? 'trisection' : 'bisected',
      actions: card.actions.map(action => ({
        tag: 'button',
        text: {
          tag: 'plain_text',
          content: action.text,
        },
        type: action.type ?? 'default',
        value: action.value,
        ...(action.confirm
          ? {
              confirm: {
                title: { tag: 'plain_text', content: action.confirm.title },
                text: { tag: 'plain_text', content: action.confirm.text },
              },
            }
          : {}),
      })),
    });
  }

  return {
    config: {
      wide_screen_mode: true,
      enable_forward: true,
    },
    header: {
      template: card.template,
      title: {
        tag: 'plain_text',
        content: card.title,
      },
    },
    elements,
  };
}

function renderSystemCard(message: string, metadata?: MessageMetadata): RenderedSystemCard | null {
  if (metadata?.category === 'workflow_result') {
    return {
      title: metadata.workflowResult?.workflowName
        ? `Workflow result · ${metadata.workflowResult.workflowName}`
        : 'Workflow result',
      template: /failed/i.test(message) ? 'red' : 'green',
      body: message,
      note: metadata.workflowResult?.runId ? `Run ID: ${metadata.workflowResult.runId}` : undefined,
    };
  }

  if (metadata?.category === 'workflow_status') {
    return {
      title: metadata.nodeName
        ? metadata.nodeName
        : metadata.workflowRun?.workflowName
          ? `Workflow · ${metadata.workflowRun.workflowName}`
          : 'Workflow update',
      template: 'blue',
      body: message,
    };
  }

  if (metadata?.category === 'workflow_dispatch_status') {
    return {
      title: metadata.nodeName
        ? metadata.nodeName
        : metadata.workflowDispatch?.workflowName
          ? `Starting workflow · ${metadata.workflowDispatch.workflowName}`
          : 'Starting workflow',
      template: 'blue',
      body: message,
    };
  }

  if (metadata?.category === 'workflow_approval') {
    const runId = extractInlineCodeValue('Run ID', message);
    const interactionMode = inferApprovalInteractionMode(message);
    return {
      title: metadata.nodeName || 'Approval required',
      template: 'orange',
      body: message,
      note:
        interactionMode === 'reply'
          ? '直接在当前会话回复内容继续。'
          : runId
            ? `在当前会话输入 /workflow approve ${runId} 或 /workflow reject ${runId} <reason>`
            : '在当前会话输入 /workflow approve <run_id> 或 /workflow reject <run_id> <reason>',
      actions:
        interactionMode === 'approve_reject' && runId
          ? [
              {
                text: 'Approve',
                type: 'primary',
                value: { action: 'workflow_approve', run_id: runId },
                confirm: {
                  title: 'Approve workflow',
                  text: '确认批准当前暂停的 workflow 吗？',
                },
              },
              {
                text: 'Reject',
                type: 'danger',
                value: { action: 'workflow_reject', run_id: runId },
                confirm: {
                  title: 'Reject workflow',
                  text: '确认驳回当前暂停的 workflow 吗？',
                },
              },
            ]
          : undefined,
    };
  }

  if (message.startsWith('Usage:\n  /workflow') || message.includes('/workflow list')) {
    return {
      title: 'Workflow command help',
      template: 'grey',
      body: stripDecorators(message),
    };
  }

  return null;
}

export class FeishuAdapter implements IPlatformAdapter {
  private readonly appId: string;
  private readonly appSecret: string;
  private readonly streamingMode: 'stream' | 'batch';
  private readonly allowedOpenIds: string[];
  private readonly domain: FeishuDomain;
  private readonly baseUrl: string;
  private readonly wsClient: WSClient;
  private readonly eventDispatcher: EventDispatcher;
  private tokenState: FeishuTokenState | null = null;
  private readonly conversationDbIds = new Map<string, string>();
  private readonly progressReactions = new Map<string, { emojiType: string; reactionId: string }>();
  private readonly conversationTargets = new Map<string, FeishuConversationTarget>();
  private readonly workflowRootTargets = new Map<string, WorkflowRootTarget>();
  private messageHandler: ((ctx: FeishuMessageContext) => Promise<void>) | null = null;
  private cardActionHandlerFn:
    | ((ctx: FeishuCardActionContext) => Promise<RenderedSystemCard | null | undefined>)
    | null = null;

  constructor(
    appId: string,
    appSecret: string,
    mode: 'stream' | 'batch' = 'batch',
    options?: FeishuAdapterOptions
  ) {
    this.appId = appId;
    this.appSecret = appSecret;
    this.streamingMode = mode;
    this.allowedOpenIds = parseAllowedOpenIds(
      options?.allowedOpenIds ?? process.env.FEISHU_ALLOWED_OPEN_IDS
    );
    this.domain = options?.domain ?? 'feishu';
    this.baseUrl = getBaseUrl(this.domain, options?.baseUrl);

    this.eventDispatcher = new EventDispatcher({
      verificationToken: options?.verificationToken,
      encryptKey: options?.encryptKey,
      loggerLevel: LoggerLevel.error,
    });
    this.wsClient = new WSClient({
      appId: this.appId,
      appSecret: this.appSecret,
      domain: toSdkDomain(this.domain),
      loggerLevel: LoggerLevel.error,
      autoReconnect: true,
    });

    if (this.allowedOpenIds.length > 0) {
      getLog().info({ userCount: this.allowedOpenIds.length }, 'feishu.whitelist_enabled');
    } else {
      getLog().info('feishu.whitelist_disabled');
    }

    getLog().info({ mode, domain: this.domain }, 'feishu.adapter_initialized');
  }

  onMessage(handler: (ctx: FeishuMessageContext) => Promise<void>): void {
    this.messageHandler = handler;
  }

  onCardAction(
    handler: (ctx: FeishuCardActionContext) => Promise<RenderedSystemCard | null | undefined>
  ): void {
    this.cardActionHandlerFn = handler;
  }

  getStreamingMode(): 'stream' | 'batch' {
    return this.streamingMode;
  }

  getPlatformType(): string {
    return 'feishu';
  }

  async ensureThread(originalConversationId: string, messageContext?: unknown): Promise<string> {
    const context = messageContext as FeishuMessageContext | undefined;
    if (!context || context.chatType === 'p2p') {
      return originalConversationId;
    }

    const currentTarget = this.resolveConversationTarget(originalConversationId);
    if (currentTarget.threadId && originalConversationId.includes(':thread:')) {
      return originalConversationId;
    }

    const threadRootId = context.replyToMessageId ?? context.messageId;
    const threadedConversationId = buildConversationId(
      context.chatType,
      context.chatId,
      threadRootId,
      threadRootId
    );

    this.conversationTargets.set(threadedConversationId, {
      chatId: context.chatId,
      replyToMessageId: threadRootId,
      threadId: threadRootId,
    });

    return threadedConversationId;
  }

  async start(): Promise<void> {
    this.eventDispatcher.register({
      'im.message.receive_v1': async (data: ReceiveMessageEvent) => {
        await this.handleIncomingMessage(data);
      },
      'card.action.trigger': async (data: InteractiveCardActionEvent) => {
        return await this.handleCardActionEvent(data);
      },
    });

    await this.wsClient.start({ eventDispatcher: this.eventDispatcher });
    getLog().info('feishu.adapter_started');
  }

  stop(): void {
    this.wsClient.close({ force: true });
    getLog().info('feishu.adapter_stopped');
  }

  async sendMessage(
    conversationId: string,
    message: string,
    metadata?: MessageMetadata
  ): Promise<void> {
    const workflowRunId =
      this.getWorkflowRunId(metadata) ??
      (metadata?.category === 'workflow_approval'
        ? (extractInlineCodeValue('Run ID', message) ?? undefined)
        : undefined);
    const overrideTarget =
      workflowRunId && !this.shouldCreateWorkflowRoot(metadata)
        ? this.workflowRootTargets.get(workflowRunId)
        : undefined;

    const card = renderSystemCard(message, metadata);
    if (card) {
      try {
        const result = await this.sendInteractiveCard(conversationId, card, overrideTarget);
        this.maybeTrackWorkflowRoot(
          workflowRunId,
          conversationId,
          metadata,
          overrideTarget,
          result
        );
        await this.persistAssistantMessage(conversationId, message, metadata);
        return;
      } catch (error) {
        const err = error as Error;
        getLog().warn({ err, title: card.title }, 'feishu.card_send_failed_fallback_to_text');
      }
    }

    if (looksLikeRichTextMessage(message)) {
      try {
        const result = await this.sendInteractiveCard(
          conversationId,
          {
            title: metadata?.nodeName || 'Assistant reply',
            template: 'grey',
            body: stripDecorators(message),
          },
          overrideTarget
        );
        this.maybeTrackWorkflowRoot(
          workflowRunId,
          conversationId,
          metadata,
          overrideTarget,
          result
        );
        await this.persistAssistantMessage(conversationId, message, metadata);
        return;
      } catch (error) {
        const err = error as Error;
        getLog().warn({ err }, 'feishu.rich_text_card_send_failed_fallback_to_text');
      }
    }

    const result = await this.sendTextMessage(conversationId, message, overrideTarget);
    this.maybeTrackWorkflowRoot(workflowRunId, conversationId, metadata, overrideTarget, result);
    await this.persistAssistantMessage(conversationId, message, metadata);
  }

  async setMessageProgressState(messageId: string, state: FeishuProgressState): Promise<void> {
    const emojiType = this.toProgressEmoji(state);
    const existing = this.progressReactions.get(messageId);

    if (existing?.emojiType === emojiType) {
      return;
    }

    if (existing) {
      await this.deleteReaction(messageId, existing.reactionId).catch(error => {
        getLog().warn(
          { err: error, messageId, reactionId: existing.reactionId },
          'feishu.progress_reaction_remove_failed'
        );
      });
    }

    try {
      const reactionId = await this.createReaction(messageId, emojiType);
      this.progressReactions.set(messageId, { emojiType, reactionId });
    } catch (error) {
      getLog().warn(
        { err: error, messageId, emojiType, state },
        'feishu.progress_reaction_add_failed'
      );
    }
  }

  private async sendTextMessage(
    conversationId: string,
    message: string,
    overrideTarget?: FeishuConversationTarget
  ): Promise<FeishuSendResult | undefined> {
    const { chatId, replyToMessageId, threadId } =
      overrideTarget ?? this.resolveConversationTarget(conversationId);
    const chunks =
      message.length <= MAX_TEXT_CHUNK_LENGTH
        ? [message]
        : splitIntoParagraphChunks(message, MAX_TEXT_CHUNK_LENGTH);
    let result: FeishuSendResult | undefined;

    for (const chunk of chunks) {
      const content = JSON.stringify({ text: chunk });

      if (replyToMessageId) {
        result = await this.postApi(`/open-apis/im/v1/messages/${replyToMessageId}/reply`, {
          msg_type: 'text',
          content,
          reply_in_thread: Boolean(threadId),
        });
      } else {
        result = await this.postApi('/open-apis/im/v1/messages?receive_id_type=chat_id', {
          receive_id: chatId,
          msg_type: 'text',
          content,
        });
      }
    }

    return result;
  }

  private async sendInteractiveCard(
    conversationId: string,
    card: RenderedSystemCard,
    overrideTarget?: FeishuConversationTarget
  ): Promise<FeishuSendResult | undefined> {
    const { chatId, replyToMessageId, threadId } =
      overrideTarget ?? this.resolveConversationTarget(conversationId);
    const content = JSON.stringify(buildSystemCardPayload(card));

    if (replyToMessageId) {
      return await this.postApi(`/open-apis/im/v1/messages/${replyToMessageId}/reply`, {
        msg_type: 'interactive',
        content,
        reply_in_thread: Boolean(threadId),
      });
    }

    return await this.postApi('/open-apis/im/v1/messages?receive_id_type=chat_id', {
      receive_id: chatId,
      msg_type: 'interactive',
      content,
    });
  }

  private async handleCardActionEvent(
    event: InteractiveCardActionEvent
  ): Promise<FeishuCardPayload | undefined> {
    const action = typeof event.action?.value?.action === 'string' ? event.action.value.action : '';
    const runId =
      typeof event.action?.value?.run_id === 'string' ? event.action.value.run_id : undefined;

    if (!action || !this.cardActionHandlerFn) {
      return undefined;
    }

    const card = await this.cardActionHandlerFn({ action, runId, event });
    if (!card) {
      return undefined;
    }
    return buildSystemCardPayload(card);
  }

  private async handleIncomingMessage(data: ReceiveMessageEvent): Promise<void> {
    const message = data.message;
    if (message.message_type !== 'text' && message.message_type !== 'post') {
      getLog().info({ messageType: message.message_type }, 'feishu.unsupported_message_type');
      return;
    }

    const text = parseTextContent(message.content);
    if (!text) {
      getLog().warn(
        {
          messageType: message.message_type,
          contentPreview: message.content?.slice(0, 500),
        },
        'feishu.empty_text_message'
      );
      return;
    }

    const openId = data.sender?.sender_id?.open_id;
    if (!isOpenIdAuthorized(openId, this.allowedOpenIds)) {
      getLog().info({ maskedOpenId: maskOpenId(openId) }, 'feishu.unauthorized_message');
      return;
    }

    const syntheticThreadId =
      message.chat_type === 'group' ? (message.root_id ?? message.thread_id) : message.thread_id;
    const replyToMessageId = message.root_id || message.parent_id || message.message_id;
    const context: FeishuMessageContext = {
      conversationId: buildConversationId(
        message.chat_type,
        message.chat_id,
        replyToMessageId,
        syntheticThreadId
      ),
      message: text,
      chatId: message.chat_id,
      messageId: message.message_id,
      replyToMessageId,
      openId,
      chatType: message.chat_type,
    };

    this.conversationTargets.set(context.conversationId, {
      chatId: message.chat_id,
      replyToMessageId,
      threadId: syntheticThreadId,
    });

    try {
      const conversation = await conversationDb.getOrCreateConversation(
        this.getPlatformType(),
        context.conversationId
      );
      this.conversationDbIds.set(context.conversationId, conversation.id);
      await messageDb.addMessage(conversation.id, 'user', text);
    } catch (error) {
      getLog().error(
        { err: error, conversationId: context.conversationId },
        'feishu.user_message_persist_failed'
      );
    }

    if (this.messageHandler) {
      await this.messageHandler(context);
    }
  }

  private async persistAssistantMessage(
    conversationId: string,
    message: string,
    metadata?: MessageMetadata
  ): Promise<void> {
    try {
      const dbId = await this.resolveConversationDbId(conversationId);
      if (!dbId) {
        getLog().warn({ conversationId }, 'feishu.assistant_message_persist_no_conversation');
        return;
      }
      await messageDb.addMessage(dbId, 'assistant', message, this.toPersistedMetadata(metadata));
    } catch (error) {
      getLog().error({ err: error, conversationId }, 'feishu.assistant_message_persist_failed');
    }
  }

  private async resolveConversationDbId(conversationId: string): Promise<string | null> {
    const cached = this.conversationDbIds.get(conversationId);
    if (cached) return cached;

    const conversation = await conversationDb.findConversationByPlatformId(conversationId);
    if (!conversation) return null;

    this.conversationDbIds.set(conversationId, conversation.id);
    return conversation.id;
  }

  private toPersistedMetadata(metadata?: MessageMetadata): Record<string, unknown> | undefined {
    if (!metadata) return undefined;
    const persisted: Record<string, unknown> = {};
    if (metadata.workflowDispatch) persisted.workflowDispatch = metadata.workflowDispatch;
    if (metadata.workflowRun) persisted.workflowRun = metadata.workflowRun;
    if (metadata.workflowResult) persisted.workflowResult = metadata.workflowResult;
    return Object.keys(persisted).length > 0 ? persisted : undefined;
  }

  private getWorkflowRunId(metadata?: MessageMetadata): string | undefined {
    return (
      metadata?.workflowRun?.runId ??
      metadata?.workflowResult?.runId ??
      metadata?.workflowDispatch?.runId
    );
  }

  private shouldCreateWorkflowRoot(metadata?: MessageMetadata): boolean {
    if (!metadata) return false;
    if (metadata.category === 'workflow_dispatch_status') return true;
    if (metadata.category === 'workflow_status' && metadata.workflowRun) return true;
    return false;
  }

  private maybeTrackWorkflowRoot(
    workflowRunId: string | undefined,
    conversationId: string,
    metadata: MessageMetadata | undefined,
    existingTarget: WorkflowRootTarget | FeishuConversationTarget | undefined,
    result: FeishuSendResult | undefined
  ): void {
    if (
      !workflowRunId ||
      !this.shouldCreateWorkflowRoot(metadata) ||
      existingTarget ||
      !result?.messageId
    ) {
      return;
    }
    const target = this.resolveConversationTarget(conversationId);
    this.workflowRootTargets.set(workflowRunId, {
      conversationId,
      chatId: result.chatId ?? target.chatId,
      replyToMessageId: result.messageId,
      threadId: target.threadId,
    });
  }

  private resolveConversationTarget(conversationId: string): {
    chatId: string;
    replyToMessageId?: string;
    threadId?: string;
  } {
    return this.conversationTargets.get(conversationId) ?? parseConversationId(conversationId);
  }

  private toProgressEmoji(state: FeishuProgressState): string {
    switch (state) {
      case 'received':
        return 'OnIt';
      case 'running':
        return 'Typing';
      case 'done':
        return 'DONE';
      case 'failed':
        return 'CrossMark';
    }
  }

  private async createReaction(messageId: string, emojiType: string): Promise<string> {
    const token = await this.getTenantAccessToken();
    const response = await fetch(
      `${this.baseUrl}/open-apis/im/v1/messages/${messageId}/reactions`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json; charset=utf-8',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          reaction_type: {
            emoji_type: emojiType,
          },
        }),
      }
    );

    if (!response.ok) {
      throw new Error(`Feishu reaction create failed with HTTP ${String(response.status)}`);
    }

    const data = (await response.json()) as {
      code?: number;
      msg?: string;
      data?: { reaction_id?: string };
    };
    if (data.code !== 0 || !data.data?.reaction_id) {
      throw new Error(`Feishu reaction create failed: ${data.msg ?? 'unknown error'}`);
    }

    return data.data.reaction_id;
  }

  private async deleteReaction(messageId: string, reactionId: string): Promise<void> {
    const token = await this.getTenantAccessToken();
    const response = await fetch(
      `${this.baseUrl}/open-apis/im/v1/messages/${messageId}/reactions/${reactionId}`,
      {
        method: 'DELETE',
        headers: {
          Authorization: `Bearer ${token}`,
        },
      }
    );

    if (!response.ok) {
      throw new Error(`Feishu reaction delete failed with HTTP ${String(response.status)}`);
    }

    const data = (await response.json()) as { code?: number; msg?: string };
    if (data.code !== 0) {
      throw new Error(`Feishu reaction delete failed: ${data.msg ?? 'unknown error'}`);
    }
  }

  private async getTenantAccessToken(): Promise<string> {
    const now = Date.now();
    if (this.tokenState && this.tokenState.expiresAt - TOKEN_REFRESH_SKEW_MS > now) {
      return this.tokenState.token;
    }

    const response = await fetch(`${this.baseUrl}/open-apis/auth/v3/tenant_access_token/internal`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify({
        app_id: this.appId,
        app_secret: this.appSecret,
      }),
    });

    if (!response.ok) {
      throw new Error(`Feishu auth request failed with HTTP ${String(response.status)}`);
    }

    const data = (await response.json()) as {
      code?: number;
      msg?: string;
      tenant_access_token?: string;
      expire?: number;
    };
    if (data.code !== 0 || !data.tenant_access_token) {
      throw new Error(`Feishu auth failed: ${data.msg ?? 'unknown error'}`);
    }

    this.tokenState = {
      token: data.tenant_access_token,
      expiresAt: now + (data.expire ?? 7200) * 1000,
    };
    return data.tenant_access_token;
  }

  private async postApi(path: string, body: Record<string, unknown>): Promise<FeishuSendResult> {
    const token = await this.getTenantAccessToken();
    const response = await fetch(`${this.baseUrl}${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      throw new Error(`Feishu API request failed with HTTP ${String(response.status)}`);
    }

    const data = (await response.json()) as {
      code?: number;
      msg?: string;
      data?: { message_id?: string; chat_id?: string };
    };
    if (data.code !== 0) {
      throw new Error(`Feishu API request failed: ${data.msg ?? 'unknown error'}`);
    }
    return {
      messageId: data.data?.message_id,
      chatId: data.data?.chat_id,
    };
  }
}
