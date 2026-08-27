import assert from 'node:assert/strict';
import test from 'node:test';

import { TelegramAIBot } from '../src/services/telegram-bot.js';

test('group administrators persist a private rich welcome message for each new member', async () => {
  const meta = new Map();
  const replies = [];
  const calls = [];
  const fakeBot = {
    config: { enableRichMessages: true },
    db: {
      getMeta(key) { return meta.get(key) || ''; },
      setMeta(key, value) { meta.set(key, value); }
    },
    botUserId: '999',
    botUsername: 'example_bot',
    canManageGroupSettings: async () => true,
    getWelcomeSettings: TelegramAIBot.prototype.getWelcomeSettings,
    renderWelcomeText: TelegramAIBot.prototype.renderWelcomeText,
    getLocale: () => 'zh',
    t: (_locale, key) => key,
    getWelcomePermission: async () => true,
    logger: { warn() {} },
    formatLogError: (error) => ({ message: error.message })
  };
  const commandContext = {
    chat: { id: -100, type: 'supergroup', title: '测试群' },
    from: { id: 7 },
    message: { text: '/welcome set 欢迎 {name} 加入 {chat}' },
    reply: async (text) => replies.push(text)
  };
  await TelegramAIBot.prototype.handleWelcomeCommand.call(fakeBot, commandContext);
  assert.match(replies[0], /已保存/);
  assert.match(meta.get('telegram:welcome:-100'), /欢迎/);

  const joinContext = {
    chat: { id: -100, type: 'supergroup', title: '测试群' },
    message: { new_chat_members: [{ id: 42, first_name: 'Alice', is_bot: false }] },
    telegram: { async callApi(method, payload) { calls.push({ method, payload }); return { message_id: 1 }; } }
  };
  const handled = await TelegramAIBot.prototype.handleWelcomeMembers.call(fakeBot, joinContext);
  assert.equal(handled, true);
  assert.equal(calls[0].method, 'sendRichMessage');
  assert.equal(calls[0].payload.ephemeral_message_parameters.receiver_user_id, 42);
  assert.match(calls[0].payload.rich_message.html, /Alice/);
  assert.match(calls[0].payload.rich_message.html, /测试群/);
  assert.match(calls[0].payload.rich_message.html, /type="url"/);
  assert.match(calls[0].payload.rich_message.html, /billing:store/);
});

test('terminal Agent tasks deliver an ephemeral embedded report document in groups', async () => {
  const apiCalls = [];
  const documents = [];
  const fakeBot = {
    config: { enableRichMessages: true },
    buildAgentReport: TelegramAIBot.prototype.buildAgentReport,
    db: {
      listAgentTaskEvents() { return [{ type: 'succeeded', payload: { ok: true }, createdAt: '2026-08-27T00:00:00Z' }]; },
      listProviderUsageCosts() { return [{ costUsd: 0.25, billedCredits: 30 }]; }
    },
    bot: {
      telegram: {
        async sendDocument(chatId, document, extra) {
          documents.push({ chatId, document, extra });
          return { ephemeral_message_id: 'ephemeral-1', document: { file_id: 'telegram-file-1' } };
        },
        async callApi(method, payload) {
          apiCalls.push({ method, payload });
          return { message_id: 88 };
        }
      }
    },
    logger: { warn() {} },
    formatLogError: (error) => ({ message: error.message })
  };
  const task = {
    id: '12345678-1234-4123-8123-123456789abc',
    chatId: '-100',
    userId: '42',
    repository: 'owner/repo',
    branch: 'ai/task',
    status: 'succeeded',
    prompt: 'Fix it',
    result: { text: 'Pull request created.' }
  };

  await TelegramAIBot.prototype.sendAgentReportDocument.call(fakeBot, task);
  assert.equal(documents[0].extra.ephemeral_message_parameters.receiver_user_id, 42);
  assert.match(documents[0].document.source.toString('utf8'), /Cost \(USD\): 0\.250000/);
  assert.equal(apiCalls[0].method, 'sendRichMessage');
  assert.equal(apiCalls[0].payload.ephemeral_message_parameters.receiver_user_id, 42);
  assert.deepEqual(apiCalls[0].payload.rich_message.media, [
    { id: 'agent_report', media: { type: 'document', media: 'telegram-file-1' } }
  ]);
  assert.match(apiCalls[0].payload.rich_message.html, /tg:\/\/document\?id=agent_report/);
  assert.equal(apiCalls[1].method, 'deleteEphemeralMessage');
});
