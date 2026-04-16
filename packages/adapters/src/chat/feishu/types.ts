export interface FeishuMessageContext {
  conversationId: string;
  message: string;
  chatId: string;
  messageId: string;
  replyToMessageId?: string;
  openId?: string;
  chatType?: string;
}
