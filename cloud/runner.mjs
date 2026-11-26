#!/usr/bin/env node
// Universal AI Prompt Queue - Cloud Runner (Zero-dependency Node 20+)
// Runs N independent AI queues via official APIs (OpenAI, Claude, DeepSeek, Gemini,
// OpenRouter, or custom OpenAI-compatible endpoints) and sends results to
// Telegram, Discord, and/or Slack webhooks.

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const QUEUES_PATH = path.join(__dirname, 'queues.json');
const OUTPUTS_DIR = path.join(__dirname, 'outputs');

// --- Provider Adapters ---

async function callOpenAICompatible({ baseUrl, apiKey, model, messages }) {
  const res = await fetch(`${baseUrl.replace(/\/$/, '')}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify({ model, messages })
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data?.error?.message || `HTTP ${res.status}: ${JSON.stringify(data)}`);
  }
  return data?.choices?.[0]?.message?.content?.trim() || '(Empty response)';
}

async function callAnthropic({ apiKey, model, systemPrompt, messages }) {
  const body = {
    model: model || 'claude-3-7-sonnet-latest',
    max_tokens: 4096,
    messages
  };
  if (systemPrompt) body.system = systemPrompt;

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify(body)
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data?.error?.message || `HTTP ${res.status}: ${JSON.stringify(data)}`);
  }
  return (data?.content || []).map((c) => c.text || '').join('\n').trim() || '(Empty response)';
}

async function callGemini({ apiKey, model, systemPrompt, messages }) {
  const modelId = model || 'gemini-2.5-flash';
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(modelId)}:generateContent?key=${encodeURIComponent(apiKey)}`;

  const contents = messages.map((m) => ({
    role: m.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: m.content }]
  }));

  const body = { contents };
  if (systemPrompt) {
    body.systemInstruction = { parts: [{ text: systemPrompt }] };
  }

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data?.error?.message || `HTTP ${res.status}: ${JSON.stringify(data)}`);
  }
  return (
    data?.candidates?.[0]?.content?.parts?.map((p) => p.text || '').join('\n').trim() ||
    '(Empty response)'
  );
}

async function runPromptWithProvider(queue, history, promptText) {
  const provider = (queue.provider || 'openai').toLowerCase();
  const chatMessages = [...history, { role: 'user', content: promptText }];

  switch (provider) {
    case 'openai': {
      const apiKey = process.env.OPENAI_API_KEY;
      if (!apiKey) throw new Error('Missing OPENAI_API_KEY');
      const msgs = queue.systemPrompt
        ? [{ role: 'system', content: queue.systemPrompt }, ...chatMessages]
        : chatMessages;
      return callOpenAICompatible({
        baseUrl: queue.baseUrl || 'https://api.openai.com/v1',
        apiKey,
        model: queue.model || 'gpt-4o-mini',
        messages: msgs
      });
    }

    case 'deepseek': {
      const apiKey = process.env.DEEPSEEK_API_KEY;
      if (!apiKey) throw new Error('Missing DEEPSEEK_API_KEY');
      const msgs = queue.systemPrompt
        ? [{ role: 'system', content: queue.systemPrompt }, ...chatMessages]
        : chatMessages;
      return callOpenAICompatible({
        baseUrl: queue.baseUrl || 'https://api.deepseek.com/v1',
        apiKey,
        model: queue.model || 'deepseek-chat',
        messages: msgs
      });
    }

    case 'openrouter': {
      const apiKey = process.env.OPENROUTER_API_KEY;
      if (!apiKey) throw new Error('Missing OPENROUTER_API_KEY');
      const msgs = queue.systemPrompt
        ? [{ role: 'system', content: queue.systemPrompt }, ...chatMessages]
        : chatMessages;
      return callOpenAICompatible({
        baseUrl: queue.baseUrl || 'https://openrouter.ai/api/v1',
        apiKey,
        model: queue.model || 'openai/gpt-4o-mini',
        messages: msgs
      });
    }

    case 'custom': {
      const apiKey = process.env.CUSTOM_API_KEY || process.env.OPENAI_API_KEY || '';
      if (!queue.baseUrl) throw new Error('Custom provider requires baseUrl in queues.json');
      const msgs = queue.systemPrompt
        ? [{ role: 'system', content: queue.systemPrompt }, ...chatMessages]
        : chatMessages;
      return callOpenAICompatible({
        baseUrl: queue.baseUrl,
        apiKey,
        model: queue.model || 'default',
        messages: msgs
      });
    }

    case 'anthropic':
    case 'claude': {
      const apiKey = process.env.ANTHROPIC_API_KEY;
      if (!apiKey) throw new Error('Missing ANTHROPIC_API_KEY');
      return callAnthropic({
        apiKey,
        model: queue.model,
        systemPrompt: queue.systemPrompt,
        messages: chatMessages
      });
    }

    case 'gemini': {
      const apiKey = process.env.GEMINI_API_KEY;
      if (!apiKey) throw new Error('Missing GEMINI_API_KEY');
      return callGemini({
        apiKey,
        model: queue.model,
        systemPrompt: queue.systemPrompt,
        messages: chatMessages
      });
    }

    default:
      throw new Error(`Unsupported provider: ${queue.provider}`);
  }
}

// --- Webhook Notifications (Telegram, Discord, Slack) ---

function chunkText(text, maxLen) {
  if (text.length <= maxLen) return [text];
  const chunks = [];
  let remaining = text;
  while (remaining.length > 0) {
    if (remaining.length <= maxLen) {
      chunks.push(remaining);
      break;
    }
    let splitAt = remaining.lastIndexOf('\n', maxLen);
    if (splitAt < maxLen * 0.5) splitAt = maxLen;
    chunks.push(remaining.slice(0, splitAt));
    remaining = remaining.slice(splitAt).trimStart();
  }
  return chunks;
}

async function notifyWebhooks({ queueName, provider, model, promptText, replyText, error }) {
  const header = error
    ? `❌ [${queueName}] (${provider}/${model}) Failed`
    : `🤖 [${queueName}] (${provider}/${model})`;
  const body = error
    ? `Prompt: ${promptText}\n\nError: ${error}`
    : `Prompt: ${promptText}\n\n${replyText}`;
  const fullMessage = `${header}\n\n${body}`;

  // 1. Telegram
  if (process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID) {
    const tgUrl = `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`;
    for (const chunk of chunkText(fullMessage, 3900)) {
      await fetch(tgUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: process.env.TELEGRAM_CHAT_ID,
          text: chunk
        })
      }).catch((e) => console.error('Telegram notify failed:', e.message));
    }
  }

  // 2. Discord
  if (process.env.DISCORD_WEBHOOK_URL) {
    for (const chunk of chunkText(fullMessage, 1900)) {
      await fetch(process.env.DISCORD_WEBHOOK_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: chunk })
      }).catch((e) => console.error('Discord notify failed:', e.message));
    }
  }

  // 3. Slack
  if (process.env.SLACK_WEBHOOK_URL) {
    for (const chunk of chunkText(fullMessage, 3500)) {
      await fetch(process.env.SLACK_WEBHOOK_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: chunk })
      }).catch((e) => console.error('Slack notify failed:', e.message));
    }
  }
}

// --- Main Runner ---

async function main() {
  const raw = await fs.readFile(QUEUES_PATH, 'utf8');
  const config = JSON.parse(raw);
  const now = Date.now();
  let mutated = false;

  await fs.mkdir(OUTPUTS_DIR, { recursive: true });

  for (const queue of config.queues || []) {
    if (!queue.enabled) {
      console.log(`Skipping disabled queue: ${queue.name}`);
      continue;
    }

    const history = [];
    const remainingPrompts = [];

    for (const item of queue.prompts || []) {
      const isDue = !item.scheduledAt || new Date(item.scheduledAt).getTime() <= now;
      if (item.status !== 'pending' || !isDue) {
        remainingPrompts.push(item);
        continue;
      }

      console.log(`Running [${queue.name}] prompt ${item.id}...`);
      try {
        const reply = await runPromptWithProvider(queue, queue.chainContext ? history : [], item.text);

        if (queue.chainContext) {
          history.push({ role: 'user', content: item.text });
          history.push({ role: 'assistant', content: reply });
        }

        const stamp = new Date().toISOString().replace(/[:.]/g, '-');
        const outFile = path.join(OUTPUTS_DIR, `${queue.id}_${item.id}_${stamp}.md`);
        await fs.writeFile(
          outFile,
          `# ${queue.name} (${queue.provider}/${queue.model})\n\n## Prompt\n${item.text}\n\n## Response\n${reply}\n`,
          'utf8'
        );

        await notifyWebhooks({
          queueName: queue.name,
          provider: queue.provider,
          model: queue.model,
          promptText: item.text,
          replyText: reply
        });

        mutated = true;
        if (!queue.autoRemoveCompleted) {
          remainingPrompts.push({
            ...item,
            status: 'completed',
            completedAt: new Date().toISOString(),
            lastError: null
          });
        }
      } catch (err) {
        console.error(`Error in [${queue.name}] prompt ${item.id}:`, err.message);
        await notifyWebhooks({
          queueName: queue.name,
          provider: queue.provider,
          model: queue.model,
          promptText: item.text,
          error: err.message
        });
        mutated = true;
        remainingPrompts.push({
          ...item,
          lastError: err.message
        });
      }
    }

    queue.prompts = remainingPrompts;
  }

  if (mutated) {
    await fs.writeFile(QUEUES_PATH, JSON.stringify(config, null, 2) + '\n', 'utf8');
    console.log('Updated cloud/queues.json.');
  } else {
    console.log('No due pending prompts in enabled queues.');
  }
}

main().catch((err) => {
  console.error('Fatal runner error:', err);
  process.exit(1);
});
