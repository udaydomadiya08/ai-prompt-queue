// Universal AI Prompt Queue - Background Service Worker (Manifest V3)
// Manages N independent AI queues/workflows, chrome.alarms scheduling,
// sequential execution flow, and auto-removal of completed prompts across any AI web app.

const STORAGE_KEY = 'universalAiPromptQueueState_v2';
const LEGACY_V1_KEY = 'universalAiPromptQueueState_v1';
const LEGACY_GEMINI_KEY = 'geminiPromptQueueState_v1';

const QUEUE_COLORS = [
  '#38bdf8', // Sky
  '#a78bfa', // Violet
  '#34d399', // Emerald
  '#fbbf24', // Amber
  '#f472b6', // Pink
  '#fb923c', // Orange
  '#2dd4bf', // Teal
  '#818cf8'  // Indigo
];

const KNOWN_AI_HOSTS = [
  'chatgpt.com',
  'chat.openai.com',
  'claude.ai',
  'chat.deepseek.com',
  'gemini.google.com',
  'aistudio.google.com',
  'www.perplexity.ai',
  'perplexity.ai',
  'grok.com',
  'chat.mistral.ai',
  'poe.com',
  'chat.qwen.ai',
  'chat.qwenlm.ai',
  'kimi.moonshot.cn',
  'www.kimi.com',
  'copilot.microsoft.com'
];

const PROVIDER_LABELS = [
  { match: (u) => u.hostname.includes('chatgpt.com') || u.hostname.includes('chat.openai.com'), label: 'ChatGPT' },
  { match: (u) => u.hostname.includes('claude.ai'), label: 'Claude' },
  { match: (u) => u.hostname.includes('deepseek.com'), label: 'DeepSeek' },
  { match: (u) => u.hostname.includes('gemini.google.com'), label: 'Gemini' },
  { match: (u) => u.hostname.includes('aistudio.google.com'), label: 'AI Studio' },
  { match: (u) => u.hostname.includes('perplexity.ai'), label: 'Perplexity' },
  { match: (u) => u.hostname.includes('grok.com') || (u.hostname.endsWith('x.com') && u.pathname.startsWith('/i/grok')), label: 'Grok' },
  { match: (u) => u.hostname.includes('mistral.ai'), label: 'Mistral' },
  { match: (u) => u.hostname.includes('poe.com'), label: 'Poe' },
  { match: (u) => u.hostname.includes('qwen'), label: 'Qwen' },
  { match: (u) => u.hostname.includes('kimi'), label: 'Kimi' },
  { match: (u) => u.hostname.includes('copilot.microsoft.com'), label: 'Copilot' },
  { match: (u) => u.hostname.includes('huggingface.co') && u.pathname.startsWith('/chat'), label: 'HuggingChat' }
];

function isWebUrl(urlStr) {
  if (!urlStr) return false;
  try {
    const u = new URL(urlStr);
    return u.protocol === 'https:' || u.protocol === 'http:';
  } catch {
    return false;
  }
}

function isKnownAiUrl(urlStr) {
  if (!isWebUrl(urlStr)) return false;
  try {
    const u = new URL(urlStr);
    const host = u.hostname.toLowerCase();
    if (host === 'x.com' || host === 'www.x.com') {
      return u.pathname.startsWith('/i/grok');
    }
    if (host === 'huggingface.co') {
      return u.pathname.startsWith('/chat');
    }
    return KNOWN_AI_HOSTS.some((h) => host === h || host.endsWith('.' + h));
  } catch {
    return false;
  }
}

function getProviderLabel(urlStr) {
  try {
    const u = new URL(urlStr);
    for (const p of PROVIDER_LABELS) {
      if (p.match(u)) return p.label;
    }
    return u.hostname.replace(/^www\./, '');
  } catch {
    return 'AI Tab';
  }
}

function makeQueueId() {
  return `q_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

function createQueueObject(name = 'Queue 1', colorIndex = 0, overrides = {}) {
  return {
    id: overrides.id || makeQueueId(),
    name: String(name || 'Queue').trim() || 'Queue',
    color: overrides.color || QUEUE_COLORS[colorIndex % QUEUE_COLORS.length],
    isRunning: Boolean(overrides.isRunning),
    sequential: overrides.sequential !== undefined ? Boolean(overrides.sequential) : true,
    autoRemoveCompleted: overrides.autoRemoveCompleted !== undefined ? Boolean(overrides.autoRemoveCompleted) : true,
    settleDelaySec: typeof overrides.settleDelaySec === 'number' ? overrides.settleDelaySec : 3,
    boundTabId: overrides.boundTabId || null,
    boundTabLabel: overrides.boundTabLabel || null,
    boundTabTitle: overrides.boundTabTitle || null,
    activeItemId: overrides.activeItemId || null,
    items: Array.isArray(overrides.items) ? overrides.items : []
  };
}

function DEFAULT_STATE() {
  const first = createQueueObject('Queue 1', 0);
  return {
    activeQueueId: first.id,
    queues: [first]
  };
}

// Simple mutex to prevent concurrent storage read/write races
let stateLock = Promise.resolve();
function withStateLock(fn) {
  const next = stateLock.then(fn, fn);
  stateLock = next.catch(() => {});
  return next;
}

function migrateLegacyModes(legacy) {
  const queues = [];
  const chat = legacy.modes?.chat;
  const task = legacy.modes?.task;

  if (chat) {
    queues.push(
      createQueueObject(chat.boundTabLabel || 'Queue 1', 0, {
        isRunning: chat.isRunning,
        sequential: chat.sequential,
        autoRemoveCompleted: chat.autoRemoveCompleted,
        settleDelaySec: chat.settleDelaySec,
        boundTabId: chat.boundTabId,
        boundTabLabel: chat.boundTabLabel,
        activeItemId: chat.activeItemId,
        items: chat.items
      })
    );
  }
  if (task && ((task.items && task.items.length > 0) || task.boundTabId)) {
    queues.push(
      createQueueObject(task.boundTabLabel || 'Queue 2', 1, {
        isRunning: task.isRunning,
        sequential: task.sequential,
        autoRemoveCompleted: task.autoRemoveCompleted,
        settleDelaySec: task.settleDelaySec,
        boundTabId: task.boundTabId,
        boundTabLabel: task.boundTabLabel,
        activeItemId: task.activeItemId,
        items: task.items
      })
    );
  }
  if (queues.length === 0) {
    queues.push(createQueueObject('Queue 1', 0));
  }
  return {
    activeQueueId: queues[0].id,
    queues
  };
}

async function loadState() {
  const res = await chrome.storage.local.get([STORAGE_KEY, LEGACY_V1_KEY, LEGACY_GEMINI_KEY]);
  let raw = res[STORAGE_KEY];

  if (!raw || !Array.isArray(raw.queues)) {
    const legacy = res[LEGACY_V1_KEY] || res[LEGACY_GEMINI_KEY];
    if (legacy && legacy.modes) {
      raw = migrateLegacyModes(legacy);
      await chrome.storage.local.set({ [STORAGE_KEY]: raw });
    } else {
      raw = DEFAULT_STATE();
      await chrome.storage.local.set({ [STORAGE_KEY]: raw });
    }
  }

  if (raw.queues.length === 0) {
    raw.queues.push(createQueueObject('Queue 1', 0));
  }

  raw.queues = raw.queues.map((q, idx) => createQueueObject(q.name || `Queue ${idx + 1}`, idx, q));

  if (!raw.queues.some((q) => q.id === raw.activeQueueId)) {
    raw.activeQueueId = raw.queues[0].id;
  }

  return raw;
}

function findQueue(state, queueId) {
  return state.queues.find((q) => q.id === queueId) || null;
}

async function saveState(state) {
  await chrome.storage.local.set({ [STORAGE_KEY]: state });
  await syncAllAlarms(state);
  broadcastState(state);
  pushOverlayStatusToTabs(state);
}

function broadcastState(state) {
  chrome.runtime.sendMessage({ type: 'STATE_UPDATED', state }).catch(() => {
    // Popup/side panel might not be open; ignore
  });
}

async function syncAllAlarms(state) {
  const existingAlarms = await chrome.alarms.getAll();
  const desiredAlarms = new Map();

  for (const queue of state.queues) {
    for (const item of queue.items) {
      if (item.status === 'pending' && item.scheduledAt) {
        const when = Number(item.scheduledAt);
        if (!Number.isNaN(when) && when > Date.now() - 60000) {
          const alarmName = `prompt::${queue.id}::${item.id}`;
          desiredAlarms.set(alarmName, Math.max(Date.now() + 500, when));
        }
      }
    }
  }

  for (const alarm of existingAlarms) {
    if (alarm.name.startsWith('prompt::') && !desiredAlarms.has(alarm.name)) {
      await chrome.alarms.clear(alarm.name);
    }
  }

  for (const [name, when] of desiredAlarms.entries()) {
    await chrome.alarms.create(name, { when });
  }
}

function pinQueueToTab(queue, tab) {
  queue.boundTabId = tab.id;
  queue.boundTabLabel = getProviderLabel(tab.url);
  queue.boundTabTitle = (tab.title || '').trim() || null;
}

async function resolveTargetTab(state, queue) {
  // 1. Check boundTabId if set (supports ANY http/https tab)
  if (queue.boundTabId) {
    try {
      const tab = await chrome.tabs.get(queue.boundTabId);
      if (tab && isWebUrl(tab.url)) {
        queue.boundTabTitle = (tab.title || '').trim() || queue.boundTabTitle;
        return tab;
      }
    } catch {
      queue.boundTabId = null;
      queue.boundTabLabel = null;
      queue.boundTabTitle = null;
    }
  }

  const usedTabIds = new Set(
    state.queues.filter((q) => q.id !== queue.id && q.boundTabId).map((q) => q.boundTabId)
  );

  // 2. Try currently active tab if it's a known AI platform (auto-pin it!)
  const activeTabs = await chrome.tabs.query({ active: true, currentWindow: true });
  if (activeTabs[0] && isKnownAiUrl(activeTabs[0].url)) {
    pinQueueToTab(queue, activeTabs[0]);
    return activeTabs[0];
  }

  // 3. Any open AI tab not already pinned to another queue, then any open AI tab
  const allTabs = await chrome.tabs.query({});
  const freeAiTab = allTabs.find((t) => isKnownAiUrl(t.url) && !usedTabIds.has(t.id));
  const aiTab = freeAiTab || allTabs.find((t) => isKnownAiUrl(t.url));
  if (aiTab) {
    pinQueueToTab(queue, aiTab);
    return aiTab;
  }

  return null;
}

async function ensureContentScript(tabId) {
  try {
    const res = await chrome.tabs.sendMessage(tabId, { type: 'PING' });
    if (res && res.ok) return true;
  } catch {
    try {
      await chrome.scripting.executeScript({
        target: { tabId },
        files: ['content.js']
      });
      await new Promise((r) => setTimeout(r, 400));
      const res = await chrome.tabs.sendMessage(tabId, { type: 'PING' });
      return Boolean(res && res.ok);
    } catch {
      return false;
    }
  }
  return false;
}

async function pushOverlayStatusToTabs(state) {
  try {
    const tabs = await chrome.tabs.query({});
    const boundIds = new Set(state.queues.map((q) => q.boundTabId).filter(Boolean));

    const queueSummaries = state.queues.map((q) => ({
      id: q.id,
      name: q.name,
      color: q.color,
      isRunning: q.isRunning,
      activeItemId: q.activeItemId,
      remaining: q.items.filter((i) => i.status === 'pending' || i.status === 'running').length,
      boundTabId: q.boundTabId
    }));

    for (const tab of tabs) {
      if (!isKnownAiUrl(tab.url) && !boundIds.has(tab.id)) {
        continue;
      }
      chrome.tabs.sendMessage(tab.id, {
        type: 'OVERLAY_STATUS',
        payload: {
          queues: queueSummaries,
          tabId: tab.id
        }
      }).catch(() => {});
    }
  } catch {
    // Ignore tab query errors
  }
}

function getNextEligibleItem(queue, specificItemId = null) {
  const now = Date.now();
  if (specificItemId) {
    return queue.items.find((i) => i.id === specificItemId && i.status !== 'running') || null;
  }
  const dueScheduled = queue.items.find(
    (i) => i.status === 'pending' && i.scheduledAt && Number(i.scheduledAt) <= now + 1000
  );
  if (dueScheduled) return dueScheduled;

  if (!queue.isRunning) return null;

  return queue.items.find(
    (i) => i.status === 'pending' && (!i.scheduledAt || Number(i.scheduledAt) <= now + 1000)
  ) || null;
}

async function dispatchNextForQueue(queueId, specificItemId = null) {
  return withStateLock(async () => {
    const state = await loadState();
    const queue = findQueue(state, queueId);
    if (!queue) return { ok: false, reason: 'Queue not found' };

    if (queue.activeItemId) {
      const stillRunning = queue.items.find((i) => i.id === queue.activeItemId && i.status === 'running');
      if (stillRunning) return { ok: false, reason: 'Already running a prompt in this queue' };
      queue.activeItemId = null;
    }

    const item = getNextEligibleItem(queue, specificItemId);
    if (!item) {
      const anyPending = queue.items.some((i) => i.status === 'pending');
      if (!anyPending) {
        queue.isRunning = false;
      }
      await saveState(state);
      return { ok: false, reason: 'No eligible prompt to send right now' };
    }

    const tab = await resolveTargetTab(state, queue);
    if (!tab || !tab.id) {
      item.lastError = 'No AI tab found. Open ChatGPT, Claude, DeepSeek, Gemini, etc., or Pin any AI tab.';
      queue.isRunning = false;
      await saveState(state);
      return { ok: false, reason: item.lastError };
    }

    item.status = 'running';
    item.startedAt = Date.now();
    item.lastError = null;
    queue.activeItemId = item.id;
    await saveState(state);

    await ensureContentScript(tab.id);

    let sendRes = null;
    try {
      sendRes = await chrome.tabs.sendMessage(tab.id, {
        type: 'EXECUTE_PROMPT',
        queueId: queue.id,
        itemId: item.id,
        text: item.text,
        settleDelayMs: Math.max(1500, (queue.settleDelaySec || 3) * 1000)
      });
    } catch {
      item.status = 'pending';
      item.lastError = `Refresh ${getProviderLabel(tab.url)} (or re-pin the tab) so the extension can connect.`;
      queue.activeItemId = null;
      queue.isRunning = false;
      await saveState(state);
      return { ok: false, reason: item.lastError };
    }

    if (!sendRes || !sendRes.ok) {
      item.status = 'pending';
      item.lastError = (sendRes && sendRes.error) || `Failed to inject prompt into ${getProviderLabel(tab.url)}.`;
      queue.activeItemId = null;
      queue.isRunning = false;
      await saveState(state);
      return { ok: false, reason: item.lastError };
    }

    return { ok: true, itemId: item.id, tabId: tab.id, provider: getProviderLabel(tab.url) };
  });
}

async function handlePromptCompleted(queueId, itemId, success = true, errorMsg = null) {
  let shouldAdvance = false;

  await withStateLock(async () => {
    const state = await loadState();
    const queue = findQueue(state, queueId);
    if (!queue) return;

    const idx = queue.items.findIndex((i) => i.id === itemId);
    if (idx !== -1) {
      if (success) {
        if (queue.autoRemoveCompleted) {
          queue.items.splice(idx, 1);
        } else {
          queue.items[idx].status = 'completed';
          queue.items[idx].completedAt = Date.now();
          queue.items[idx].lastError = null;
        }
      } else {
        queue.items[idx].status = 'pending';
        queue.items[idx].lastError = errorMsg || 'Interrupted before completion.';
        queue.isRunning = false;
      }
    }

    if (queue.activeItemId === itemId) {
      queue.activeItemId = null;
    }

    if (success) {
      const nextDue = getNextEligibleItem(queue);
      if (nextDue && ((queue.isRunning && queue.sequential) || (nextDue.scheduledAt && Number(nextDue.scheduledAt) <= Date.now() + 1000))) {
        shouldAdvance = true;
      } else {
        const anyUnscheduledPending = queue.items.some((i) => i.status === 'pending' && !i.scheduledAt);
        if (!anyUnscheduledPending) {
          queue.isRunning = false;
        }
      }
    }

    await saveState(state);
  });

  if (shouldAdvance) {
    setTimeout(() => {
      dispatchNextForQueue(queueId);
    }, 1000);
  }
}

// Alarm listener for scheduled prompts
chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (!alarm.name.startsWith('prompt::')) return;
  const [, queueId, itemId] = alarm.name.split('::');
  if (!queueId || !itemId) return;

  const state = await loadState();
  const queue = findQueue(state, queueId);
  if (!queue) return;

  const item = queue.items.find((i) => i.id === itemId);
  if (!item || item.status !== 'pending') return;

  if (queue.activeItemId) return;

  await dispatchNextForQueue(queueId, itemId);
});

// Clean up bound tab if closed
chrome.tabs.onRemoved.addListener(async (tabId) => {
  await withStateLock(async () => {
    const state = await loadState();
    let changed = false;
    for (const queue of state.queues) {
      if (queue.boundTabId === tabId) {
        queue.boundTabId = null;
        queue.boundTabLabel = null;
        queue.boundTabTitle = null;
        changed = true;
      }
    }
    if (changed) await saveState(state);
  });
});

// Message router for popup, side panel, and content scripts
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    try {
      switch (msg.type) {
        case 'GET_STATE': {
          const state = await loadState();
          sendResponse({ ok: true, state });
          return;
        }

        case 'SET_ACTIVE_QUEUE': {
          await withStateLock(async () => {
            const state = await loadState();
            if (findQueue(state, msg.queueId)) {
              state.activeQueueId = msg.queueId;
              await saveState(state);
            }
          });
          sendResponse({ ok: true });
          return;
        }

        case 'CREATE_QUEUE': {
          let created = null;
          const activeTabs = await chrome.tabs.query({ active: true, currentWindow: true });
          const activeTab = activeTabs[0];

          await withStateLock(async () => {
            const state = await loadState();
            const nextNum = state.queues.length + 1;
            const name = (msg.name || '').trim() || `Queue ${nextNum}`;
            created = createQueueObject(name, state.queues.length);

            // Auto-pin to the active AI tab if it isn't already pinned to another queue
            if (activeTab && isKnownAiUrl(activeTab.url)) {
              const alreadyPinned = state.queues.some((q) => q.boundTabId === activeTab.id);
              if (!alreadyPinned) {
                pinQueueToTab(created, activeTab);
              }
            }

            state.queues.push(created);
            state.activeQueueId = created.id;
            await saveState(state);
          });
          sendResponse({ ok: true, queue: created });
          return;
        }

        case 'RENAME_QUEUE': {
          await withStateLock(async () => {
            const state = await loadState();
            const queue = findQueue(state, msg.queueId);
            const cleanName = (msg.name || '').trim();
            if (queue && cleanName) {
              queue.name = cleanName.slice(0, 32);
              await saveState(state);
            }
          });
          sendResponse({ ok: true });
          return;
        }

        case 'DELETE_QUEUE': {
          await withStateLock(async () => {
            const state = await loadState();
            const idx = state.queues.findIndex((q) => q.id === msg.queueId);
            if (idx === -1) return;
            state.queues.splice(idx, 1);
            if (state.queues.length === 0) {
              const fallback = createQueueObject('Queue 1', 0);
              state.queues.push(fallback);
            }
            if (state.activeQueueId === msg.queueId || !findQueue(state, state.activeQueueId)) {
              const nextIdx = Math.min(idx, state.queues.length - 1);
              state.activeQueueId = state.queues[nextIdx].id;
            }
            await saveState(state);
          });
          sendResponse({ ok: true });
          return;
        }

        case 'ADD_PROMPT': {
          let newItem = null;
          await withStateLock(async () => {
            const state = await loadState();
            const queue = findQueue(state, msg.queueId);
            if (!queue) return;
            newItem = {
              id: `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
              text: (msg.text || '').trim(),
              scheduledAt: msg.scheduledAt ? Number(msg.scheduledAt) : null,
              status: 'pending',
              createdAt: Date.now(),
              startedAt: null,
              completedAt: null,
              lastError: null
            };
            queue.items.push(newItem);
            await saveState(state);
          });
          sendResponse({ ok: true, item: newItem });
          return;
        }

        case 'UPDATE_PROMPT': {
          await withStateLock(async () => {
            const state = await loadState();
            const queue = findQueue(state, msg.queueId);
            if (!queue) return;
            const idx = queue.items.findIndex((i) => i.id === msg.itemId);
            if (idx === -1) return;

            const item = queue.items[idx];
            if (typeof msg.text === 'string') item.text = msg.text.trim();
            if (msg.scheduledAt !== undefined) {
              item.scheduledAt = msg.scheduledAt ? Number(msg.scheduledAt) : null;
            }
            if (msg.resetStatus) {
              item.status = 'pending';
              item.lastError = null;
              item.completedAt = null;
            }

            if (msg.targetQueueId && msg.targetQueueId !== msg.queueId) {
              const targetQueue = findQueue(state, msg.targetQueueId);
              if (targetQueue) {
                queue.items.splice(idx, 1);
                if (queue.activeItemId === item.id) queue.activeItemId = null;
                item.status = 'pending';
                targetQueue.items.push(item);
              }
            }

            await saveState(state);
          });
          sendResponse({ ok: true });
          return;
        }

        case 'DELETE_PROMPT': {
          await withStateLock(async () => {
            const state = await loadState();
            const queue = findQueue(state, msg.queueId);
            if (!queue) return;
            queue.items = queue.items.filter((i) => i.id !== msg.itemId);
            if (queue.activeItemId === msg.itemId) {
              queue.activeItemId = null;
            }
            await saveState(state);
          });
          sendResponse({ ok: true });
          return;
        }

        case 'REORDER_PROMPT': {
          await withStateLock(async () => {
            const state = await loadState();
            const queue = findQueue(state, msg.queueId);
            if (!queue) return;
            const items = queue.items;
            const idx = items.findIndex((i) => i.id === msg.itemId);
            if (idx === -1) return;
            const targetIdx = msg.direction === 'up' ? idx - 1 : idx + 1;
            if (targetIdx < 0 || targetIdx >= items.length) return;
            const [moved] = items.splice(idx, 1);
            items.splice(targetIdx, 0, moved);
            await saveState(state);
          });
          sendResponse({ ok: true });
          return;
        }

        case 'CLEAR_QUEUE': {
          await withStateLock(async () => {
            const state = await loadState();
            const queue = findQueue(state, msg.queueId);
            if (!queue) return;
            if (msg.completedOnly) {
              queue.items = queue.items.filter((i) => i.status !== 'completed');
            } else {
              queue.items = [];
              queue.activeItemId = null;
              queue.isRunning = false;
            }
            await saveState(state);
          });
          sendResponse({ ok: true });
          return;
        }

        case 'UPDATE_SETTINGS': {
          await withStateLock(async () => {
            const state = await loadState();
            const queue = findQueue(state, msg.queueId);
            if (!queue) return;
            if (typeof msg.sequential === 'boolean') queue.sequential = msg.sequential;
            if (typeof msg.autoRemoveCompleted === 'boolean') {
              queue.autoRemoveCompleted = msg.autoRemoveCompleted;
            }
            if (typeof msg.settleDelaySec === 'number' && msg.settleDelaySec >= 1 && msg.settleDelaySec <= 60) {
              queue.settleDelaySec = msg.settleDelaySec;
            }
            await saveState(state);
          });
          sendResponse({ ok: true });
          return;
        }

        case 'BIND_CURRENT_TAB': {
          if (msg.unbind) {
            await withStateLock(async () => {
              const state = await loadState();
              const queue = findQueue(state, msg.queueId);
              if (queue) {
                queue.boundTabId = null;
                queue.boundTabLabel = null;
                queue.boundTabTitle = null;
                await saveState(state);
              }
            });
            sendResponse({ ok: true, tabId: null, label: null });
            return;
          }

          const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
          const current = tabs[0];
          if (!current || !isWebUrl(current.url)) {
            sendResponse({ ok: false, error: 'Active tab must be an http:// or https:// web page.' });
            return;
          }

          await ensureContentScript(current.id);

          await withStateLock(async () => {
            const state = await loadState();
            const queue = findQueue(state, msg.queueId);
            if (queue) {
              pinQueueToTab(queue, current);
              await saveState(state);
            }
          });
          sendResponse({ ok: true, tabId: current.id, label: getProviderLabel(current.url) });
          return;
        }

        case 'START_QUEUE': {
          await withStateLock(async () => {
            const state = await loadState();
            const queue = findQueue(state, msg.queueId);
            if (queue) {
              queue.isRunning = true;
              await saveState(state);
            }
          });
          const res = await dispatchNextForQueue(msg.queueId);
          sendResponse(res);
          return;
        }

        case 'PAUSE_QUEUE': {
          await withStateLock(async () => {
            const state = await loadState();
            const queue = findQueue(state, msg.queueId);
            if (queue) {
              queue.isRunning = false;
              await saveState(state);
            }
          });
          sendResponse({ ok: true });
          return;
        }

        case 'SEND_NOW': {
          const res = await dispatchNextForQueue(msg.queueId, msg.itemId);
          sendResponse(res);
          return;
        }

        case 'FORCE_COMPLETE_ACTIVE': {
          const state = await loadState();
          const queue = findQueue(state, msg.queueId);
          if (queue && queue.activeItemId) {
            await handlePromptCompleted(queue.id, queue.activeItemId, true);
          }
          sendResponse({ ok: true });
          return;
        }

        case 'PROMPT_COMPLETED': {
          await handlePromptCompleted(msg.queueId, msg.itemId, msg.success !== false, msg.error || null);
          sendResponse({ ok: true });
          return;
        }

        default:
          sendResponse({ ok: false, error: 'Unknown message type' });
      }
    } catch (err) {
      sendResponse({ ok: false, error: String(err && err.message ? err.message : err) });
    }
  })();

  return true;
});

chrome.runtime.onInstalled.addListener(async () => {
  const state = await loadState();
  await syncAllAlarms(state);
});

chrome.runtime.onStartup.addListener(async () => {
  const state = await loadState();
  let changed = false;
  for (const queue of state.queues) {
    if (queue.activeItemId) {
      queue.activeItemId = null;
      queue.isRunning = false;
      for (const item of queue.items) {
        if (item.status === 'running') item.status = 'pending';
      }
      changed = true;
    }
  }
  if (changed) await saveState(state);
  else await syncAllAlarms(state);
});
