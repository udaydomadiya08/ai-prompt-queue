// Universal AI Prompt Queue - Background Service Worker (Manifest V3)
// Manages separate Chat Mode & Task Mode queues, chrome.alarms scheduling,
// sequential execution flow, and auto-removal of completed prompts across any AI web app.

const STORAGE_KEY = 'universalAiPromptQueueState_v1';
const LEGACY_STORAGE_KEY = 'geminiPromptQueueState_v1';

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

const DEFAULT_MODE_STATE = (mode) => ({
  mode,
  isRunning: false,
  sequential: true,
  autoRemoveCompleted: true,
  settleDelaySec: mode === 'task' ? 5 : 3,
  boundTabId: null,
  boundTabLabel: null,
  activeItemId: null,
  items: []
});

const DEFAULT_STATE = () => ({
  activeMode: 'chat',
  modes: {
    chat: DEFAULT_MODE_STATE('chat'),
    task: DEFAULT_MODE_STATE('task')
  }
});

// Simple mutex to prevent concurrent storage read/write races
let stateLock = Promise.resolve();
function withStateLock(fn) {
  const next = stateLock.then(fn, fn);
  stateLock = next.catch(() => {});
  return next;
}

async function loadState() {
  const res = await chrome.storage.local.get([STORAGE_KEY, LEGACY_STORAGE_KEY]);
  let raw = res[STORAGE_KEY];

  // Migrate from legacy Gemini-only storage key if present
  if ((!raw || !raw.modes) && res[LEGACY_STORAGE_KEY] && res[LEGACY_STORAGE_KEY].modes) {
    raw = res[LEGACY_STORAGE_KEY];
    await chrome.storage.local.set({ [STORAGE_KEY]: raw });
  }

  if (!raw || !raw.modes) {
    const fresh = DEFAULT_STATE();
    await chrome.storage.local.set({ [STORAGE_KEY]: fresh });
    return fresh;
  }

  // Ensure both modes exist with all defaults
  for (const m of ['chat', 'task']) {
    raw.modes[m] = Object.assign(DEFAULT_MODE_STATE(m), raw.modes[m] || {});
    if (!Array.isArray(raw.modes[m].items)) raw.modes[m].items = [];
  }
  if (raw.activeMode !== 'chat' && raw.activeMode !== 'task') {
    raw.activeMode = 'chat';
  }
  return raw;
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

  for (const mode of ['chat', 'task']) {
    for (const item of state.modes[mode].items) {
      if (item.status === 'pending' && item.scheduledAt) {
        const when = Number(item.scheduledAt);
        if (!Number.isNaN(when) && when > Date.now() - 60000) {
          const alarmName = `prompt::${mode}::${item.id}`;
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

async function resolveTargetTab(modeState) {
  // 1. Check boundTabId if set (supports ANY http/https tab)
  if (modeState.boundTabId) {
    try {
      const tab = await chrome.tabs.get(modeState.boundTabId);
      if (tab && isWebUrl(tab.url)) {
        return tab;
      }
    } catch {
      // Bound tab was closed
      modeState.boundTabId = null;
      modeState.boundTabLabel = null;
    }
  }

  // 2. Try currently active tab if it's a known AI platform
  const activeTabs = await chrome.tabs.query({ active: true, currentWindow: true });
  if (activeTabs[0] && isKnownAiUrl(activeTabs[0].url)) {
    return activeTabs[0];
  }

  // 3. Any open tab on a known AI platform
  const allTabs = await chrome.tabs.query({});
  const aiTab = allTabs.find((t) => isKnownAiUrl(t.url));
  if (aiTab) {
    return aiTab;
  }

  return null;
}

async function ensureContentScript(tabId) {
  try {
    const res = await chrome.tabs.sendMessage(tabId, { type: 'PING' });
    if (res && res.ok) return true;
  } catch {
    // Content script not yet injected (e.g. tab opened before extension installed, or custom AI host)
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
    const chatBound = state.modes.chat.boundTabId;
    const taskBound = state.modes.task.boundTabId;

    for (const tab of tabs) {
      if (!isKnownAiUrl(tab.url) && tab.id !== chatBound && tab.id !== taskBound) {
        continue;
      }
      const chatPending = state.modes.chat.items.filter((i) => i.status === 'pending' || i.status === 'running').length;
      const taskPending = state.modes.task.items.filter((i) => i.status === 'pending' || i.status === 'running').length;
      chrome.tabs.sendMessage(tab.id, {
        type: 'OVERLAY_STATUS',
        payload: {
          chat: {
            isRunning: state.modes.chat.isRunning,
            activeItemId: state.modes.chat.activeItemId,
            remaining: chatPending,
            boundTabId: chatBound
          },
          task: {
            isRunning: state.modes.task.isRunning,
            activeItemId: state.modes.task.activeItemId,
            remaining: taskPending,
            boundTabId: taskBound
          },
          tabId: tab.id
        }
      }).catch(() => {});
    }
  } catch {
    // Ignore tab query errors
  }
}

function getNextEligibleItem(modeState, specificItemId = null) {
  const now = Date.now();
  if (specificItemId) {
    return modeState.items.find((i) => i.id === specificItemId && i.status !== 'running') || null;
  }
  // Prefer any due scheduled item first, otherwise first unscheduled pending item
  const dueScheduled = modeState.items.find(
    (i) => i.status === 'pending' && i.scheduledAt && Number(i.scheduledAt) <= now + 1000
  );
  if (dueScheduled) return dueScheduled;

  if (!modeState.isRunning) return null;

  return modeState.items.find(
    (i) => i.status === 'pending' && (!i.scheduledAt || Number(i.scheduledAt) <= now + 1000)
  ) || null;
}

async function dispatchNextForMode(mode, specificItemId = null) {
  return withStateLock(async () => {
    const state = await loadState();
    const modeState = state.modes[mode];

    // Do not overlap if a prompt is already running in this mode
    if (modeState.activeItemId) {
      const stillRunning = modeState.items.find((i) => i.id === modeState.activeItemId && i.status === 'running');
      if (stillRunning) return { ok: false, reason: 'Already running a prompt in this mode' };
      modeState.activeItemId = null;
    }

    const item = getNextEligibleItem(modeState, specificItemId);
    if (!item) {
      const anyPending = modeState.items.some((i) => i.status === 'pending');
      if (!anyPending) {
        modeState.isRunning = false;
      }
      await saveState(state);
      return { ok: false, reason: 'No eligible prompt to send right now' };
    }

    const tab = await resolveTargetTab(modeState);
    if (!tab || !tab.id) {
      item.lastError = 'No AI tab found. Open ChatGPT, Claude, DeepSeek, Gemini, etc., or Pin any AI tab.';
      modeState.isRunning = false;
      await saveState(state);
      return { ok: false, reason: item.lastError };
    }

    // Mark item running
    item.status = 'running';
    item.startedAt = Date.now();
    item.lastError = null;
    modeState.activeItemId = item.id;
    await saveState(state);

    // Ensure content script is active on already-open or custom tabs
    await ensureContentScript(tab.id);

    // Send command to content script
    let sendRes = null;
    try {
      sendRes = await chrome.tabs.sendMessage(tab.id, {
        type: 'EXECUTE_PROMPT',
        mode,
        itemId: item.id,
        text: item.text,
        settleDelayMs: Math.max(1500, (modeState.settleDelaySec || 3) * 1000)
      });
    } catch {
      item.status = 'pending';
      item.lastError = `Refresh ${getProviderLabel(tab.url)} (or re-pin the tab) so the extension can connect.`;
      modeState.activeItemId = null;
      modeState.isRunning = false;
      await saveState(state);
      return { ok: false, reason: item.lastError };
    }

    if (!sendRes || !sendRes.ok) {
      item.status = 'pending';
      item.lastError = (sendRes && sendRes.error) || `Failed to inject prompt into ${getProviderLabel(tab.url)}.`;
      modeState.activeItemId = null;
      modeState.isRunning = false;
      await saveState(state);
      return { ok: false, reason: item.lastError };
    }

    return { ok: true, itemId: item.id, tabId: tab.id, provider: getProviderLabel(tab.url) };
  });
}

async function handlePromptCompleted(mode, itemId, success = true, errorMsg = null) {
  let shouldAdvance = false;

  await withStateLock(async () => {
    const state = await loadState();
    const modeState = state.modes[mode];
    if (!modeState) return;

    const idx = modeState.items.findIndex((i) => i.id === itemId);
    if (idx !== -1) {
      if (success) {
        if (modeState.autoRemoveCompleted) {
          modeState.items.splice(idx, 1);
        } else {
          modeState.items[idx].status = 'completed';
          modeState.items[idx].completedAt = Date.now();
          modeState.items[idx].lastError = null;
        }
      } else {
        modeState.items[idx].status = 'pending';
        modeState.items[idx].lastError = errorMsg || 'Interrupted before completion.';
        modeState.isRunning = false;
      }
    }

    if (modeState.activeItemId === itemId) {
      modeState.activeItemId = null;
    }

    // Decide whether to advance to the next prompt in sequential flow
    if (success) {
      const nextDue = getNextEligibleItem(modeState);
      if (nextDue && ((modeState.isRunning && modeState.sequential) || (nextDue.scheduledAt && Number(nextDue.scheduledAt) <= Date.now() + 1000))) {
        shouldAdvance = true;
      } else {
        const anyUnscheduledPending = modeState.items.some((i) => i.status === 'pending' && !i.scheduledAt);
        if (!anyUnscheduledPending) {
          modeState.isRunning = false;
        }
      }
    }

    await saveState(state);
  });

  if (shouldAdvance) {
    setTimeout(() => {
      dispatchNextForMode(mode);
    }, 1000);
  }
}

// Alarm listener for scheduled prompts
chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (!alarm.name.startsWith('prompt::')) return;
  const [, mode, itemId] = alarm.name.split('::');
  if (!mode || !itemId) return;

  const state = await loadState();
  const modeState = state.modes[mode];
  if (!modeState) return;

  const item = modeState.items.find((i) => i.id === itemId);
  if (!item || item.status !== 'pending') return;

  if (modeState.activeItemId) return;

  await dispatchNextForMode(mode, itemId);
});

// Clean up bound tab if closed
chrome.tabs.onRemoved.addListener(async (tabId) => {
  await withStateLock(async () => {
    const state = await loadState();
    let changed = false;
    for (const mode of ['chat', 'task']) {
      if (state.modes[mode].boundTabId === tabId) {
        state.modes[mode].boundTabId = null;
        state.modes[mode].boundTabLabel = null;
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

        case 'SET_ACTIVE_MODE': {
          await withStateLock(async () => {
            const state = await loadState();
            if (msg.mode === 'chat' || msg.mode === 'task') {
              state.activeMode = msg.mode;
              await saveState(state);
            }
          });
          sendResponse({ ok: true });
          return;
        }

        case 'ADD_PROMPT': {
          let newItem = null;
          await withStateLock(async () => {
            const state = await loadState();
            const modeState = state.modes[msg.mode];
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
            modeState.items.push(newItem);
            await saveState(state);
          });
          sendResponse({ ok: true, item: newItem });
          return;
        }

        case 'UPDATE_PROMPT': {
          await withStateLock(async () => {
            const state = await loadState();
            const modeState = state.modes[msg.mode];
            const idx = modeState.items.findIndex((i) => i.id === msg.itemId);
            if (idx === -1) return;

            const item = modeState.items[idx];
            if (typeof msg.text === 'string') item.text = msg.text.trim();
            if (msg.scheduledAt !== undefined) {
              item.scheduledAt = msg.scheduledAt ? Number(msg.scheduledAt) : null;
            }
            if (msg.resetStatus) {
              item.status = 'pending';
              item.lastError = null;
              item.completedAt = null;
            }

            if (msg.targetMode && msg.targetMode !== msg.mode && state.modes[msg.targetMode]) {
              modeState.items.splice(idx, 1);
              if (modeState.activeItemId === item.id) modeState.activeItemId = null;
              item.status = 'pending';
              state.modes[msg.targetMode].items.push(item);
            }

            await saveState(state);
          });
          sendResponse({ ok: true });
          return;
        }

        case 'DELETE_PROMPT': {
          await withStateLock(async () => {
            const state = await loadState();
            const modeState = state.modes[msg.mode];
            modeState.items = modeState.items.filter((i) => i.id !== msg.itemId);
            if (modeState.activeItemId === msg.itemId) {
              modeState.activeItemId = null;
            }
            await saveState(state);
          });
          sendResponse({ ok: true });
          return;
        }

        case 'REORDER_PROMPT': {
          await withStateLock(async () => {
            const state = await loadState();
            const items = state.modes[msg.mode].items;
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
            const modeState = state.modes[msg.mode];
            if (msg.completedOnly) {
              modeState.items = modeState.items.filter((i) => i.status !== 'completed');
            } else {
              modeState.items = [];
              modeState.activeItemId = null;
              modeState.isRunning = false;
            }
            await saveState(state);
          });
          sendResponse({ ok: true });
          return;
        }

        case 'UPDATE_SETTINGS': {
          await withStateLock(async () => {
            const state = await loadState();
            const modeState = state.modes[msg.mode];
            if (typeof msg.sequential === 'boolean') modeState.sequential = msg.sequential;
            if (typeof msg.autoRemoveCompleted === 'boolean') {
              modeState.autoRemoveCompleted = msg.autoRemoveCompleted;
            }
            if (typeof msg.settleDelaySec === 'number' && msg.settleDelaySec >= 1 && msg.settleDelaySec <= 60) {
              modeState.settleDelaySec = msg.settleDelaySec;
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
              state.modes[msg.mode].boundTabId = null;
              state.modes[msg.mode].boundTabLabel = null;
              await saveState(state);
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

          const label = getProviderLabel(current.url);
          await ensureContentScript(current.id);

          await withStateLock(async () => {
            const state = await loadState();
            state.modes[msg.mode].boundTabId = current.id;
            state.modes[msg.mode].boundTabLabel = label;
            await saveState(state);
          });
          sendResponse({ ok: true, tabId: current.id, label });
          return;
        }

        case 'START_QUEUE': {
          await withStateLock(async () => {
            const state = await loadState();
            state.modes[msg.mode].isRunning = true;
            await saveState(state);
          });
          const res = await dispatchNextForMode(msg.mode);
          sendResponse(res);
          return;
        }

        case 'PAUSE_QUEUE': {
          await withStateLock(async () => {
            const state = await loadState();
            state.modes[msg.mode].isRunning = false;
            await saveState(state);
          });
          sendResponse({ ok: true });
          return;
        }

        case 'SEND_NOW': {
          const res = await dispatchNextForMode(msg.mode, msg.itemId);
          sendResponse(res);
          return;
        }

        case 'FORCE_COMPLETE_ACTIVE': {
          const state = await loadState();
          const activeId = state.modes[msg.mode]?.activeItemId;
          if (activeId) {
            await handlePromptCompleted(msg.mode, activeId, true);
          }
          sendResponse({ ok: true });
          return;
        }

        case 'PROMPT_COMPLETED': {
          await handlePromptCompleted(msg.mode, msg.itemId, msg.success !== false, msg.error || null);
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

  return true; // Keep async message channel open
});

chrome.runtime.onInstalled.addListener(async () => {
  const state = await loadState();
  await syncAllAlarms(state);
});

chrome.runtime.onStartup.addListener(async () => {
  const state = await loadState();
  let changed = false;
  for (const mode of ['chat', 'task']) {
    if (state.modes[mode].activeItemId) {
      state.modes[mode].activeItemId = null;
      state.modes[mode].isRunning = false;
      for (const item of state.modes[mode].items) {
        if (item.status === 'running') item.status = 'pending';
      }
      changed = true;
    }
  }
  if (changed) await saveState(state);
  else await syncAllAlarms(state);
});
