---
title: Feishu
description: Connect Archon to Feishu/Lark using long connection (WebSocket) mode and IM send APIs.
category: adapters
area: adapters
audience: [user, operator]
status: current
sidebar:
  order: 4
---

Connect Archon to Feishu so you can trigger and continue AI conversations from Feishu chats over long connection (WebSocket), including interactive message-card actions.

## Prerequisites

- Archon server running with outbound network access
- A Feishu or Lark custom app with bot capability enabled

## Create a Feishu App

1. Create a custom app in the Feishu Open Platform
2. Enable the bot capability
3. In event subscription, choose long connection (WebSocket) mode
4. Add the message receive event (`im.message.receive_v1`)
## Set Environment Variables

```ini
FEISHU_APP_ID=cli_xxx
FEISHU_APP_SECRET=xxxx
FEISHU_VERIFICATION_TOKEN=optional-verification-token
FEISHU_ENCRYPT_KEY=optional-encrypt-key
FEISHU_DOMAIN=feishu
```

Use `FEISHU_DOMAIN=lark` for international Lark tenants.

## Configure User Whitelist (Optional)

To restrict the bot to specific users:

```ini
FEISHU_ALLOWED_OPEN_IDS=ou_xxx,ou_yyy
```

When set, only listed sender `open_id` values can interact with the bot. When empty or unset, the bot responds to all users.

## Configure Streaming Mode (Optional)

```ini
FEISHU_STREAMING_MODE=batch  # batch (default) | stream
```

## Notes

- Current support focuses on text messages.
- Feishu is wired through the same platform adapter interface as Telegram and Slack.
- Archon receives messages and card actions via long connection and replies via the IM send/reply APIs.
- Workflow approval cards can include `Approve` / `Reject` buttons without requiring a separate public callback URL.
- Group messages are replied to by message reply API; direct chats reuse the chat conversation directly.

## Further Reading

- [Configuration](/getting-started/configuration/)
