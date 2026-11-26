// Universal AI Prompt Queue - Popup & Side Panel Controller

let appState = null;
let editingItemId = null;
let toastTimer = null;

const el = {
  tabChat: document.getElementById('tabChat'),
  tabTask: document.getElementById('tabTask'),
  badgeChat: document.getElementById('badgeChat'),
  badgeTask: document.getElementById('badgeTask'),
  btnToggleRun: document.getElementById('btnToggleRun'),
  btnBindTab: document.getElementById('btnBindTab'),
  btnForceNext: document.getElementById('btnForceNext'),
  chkSequential: document.getElementById('chkSequential'),
  chkAutoRemove: document.getElementById('chkAutoRemove'),
  numSettleDelay: document.getElementById('numSettleDelay'),
  composerBox: document.getElementById('composerBox'),
  editBanner: document.getElementById('editBanner'),
  selMoveMode: document.getElementById('selMoveMode'),
  btnCancelEdit: document.getElementById('btnCancelEdit'),
  txtPrompt: document.getElementById('txtPrompt'),
  dtSchedule: document.getElementById('dtSchedule'),
  btnClearSchedule: document.getElementById('btnClearSchedule'),
  btnSubmitPrompt: document.getElementById('btnSubmitPrompt'),
  statusToast: document.getElementById('statusToast'),
  queueTitle: document.getElementById('queueTitle'),
  btnClearCompleted: document.getElementById('btnClearCompleted'),
  btnClearAll: document.getElementById('btnClearAll'),
  queueList: document.getElementById('queueList')
};

function sendBg(msg) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(msg, (res) => {
      if (chrome.runtime.lastError) {
        resolve({ ok: false, error: chrome.runtime.lastError.message });
      } else {
        resolve(res || { ok: false });
      }
    });
  });
}

function showToast(message, isError = false) {
  el.statusToast.textContent = message;
  el.statusToast.classList.toggle('error', isError);
  el.statusToast.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    el.statusToast.classList.add('hidden');
  }, 3500);
}

function toDatetimeLocalValue(timestampMs) {
  if (!timestampMs) return '';
  const d = new Date(Number(timestampMs));
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function formatSchedule(timestampMs) {
  if (!timestampMs) return '';
  const d = new Date(Number(timestampMs));
  return d.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
}

function activeMode() {
  return appState ? appState.activeMode : 'chat';
}

function currentModeState() {
  return appState.modes[activeMode()];
}

function cancelEdit() {
  editingItemId = null;
  el.composerBox.classList.remove('editing');
  el.editBanner.classList.add('hidden');
  el.btnSubmitPrompt.textContent = '+ Add Prompt';
  el.txtPrompt.value = '';
  el.dtSchedule.value = '';
}

function startEdit(item) {
  editingItemId = item.id;
  el.composerBox.classList.add('editing');
  el.editBanner.classList.remove('hidden');
  el.selMoveMode.value = activeMode();
  el.btnSubmitPrompt.textContent = 'Save / Replace';
  el.txtPrompt.value = item.text;
  el.dtSchedule.value = toDatetimeLocalValue(item.scheduledAt);
  el.txtPrompt.focus();
}

function render() {
  if (!appState) return;
  const mode = activeMode();
  const ms = currentModeState();

  document.body.classList.toggle('mode-task', mode === 'task');
  el.tabChat.classList.toggle('active', mode === 'chat');
  el.tabTask.classList.toggle('active', mode === 'task');

  const chatCount = appState.modes.chat.items.filter((i) => i.status !== 'completed').length;
  const taskCount = appState.modes.task.items.filter((i) => i.status !== 'completed').length;
  el.badgeChat.textContent = String(chatCount);
  el.badgeTask.textContent = String(taskCount);

  el.queueTitle.textContent = mode === 'task' ? 'Task Mode Queue' : 'Chat Mode Queue';

  // Run / Pause button
  if (ms.isRunning) {
    el.btnToggleRun.textContent = '⏸ Pause Queue';
    el.btnToggleRun.classList.add('running');
  } else {
    el.btnToggleRun.textContent = '▶ Start Queue';
    el.btnToggleRun.classList.remove('running');
  }

  // Pin Tab button
  if (ms.boundTabId) {
    el.btnBindTab.textContent = `📌 ${ms.boundTabLabel || 'Tab Pinned'}`;
    el.btnBindTab.classList.add('pinned');
  } else {
    el.btnBindTab.textContent = '📌 Pin Tab';
    el.btnBindTab.classList.remove('pinned');
  }

  // Manual Next button when a prompt is currently running
  el.btnForceNext.classList.toggle('hidden', !ms.activeItemId);

  // Settings
  el.chkSequential.checked = Boolean(ms.sequential);
  el.chkAutoRemove.checked = Boolean(ms.autoRemoveCompleted);
  el.numSettleDelay.value = String(ms.settleDelaySec || (mode === 'task' ? 5 : 3));

  // Clear Done visibility
  const hasCompleted = ms.items.some((i) => i.status === 'completed');
  el.btnClearCompleted.classList.toggle('hidden', !hasCompleted);

  // Queue list
  el.queueList.innerHTML = '';
  if (ms.items.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'empty-state';
    empty.textContent = `No prompts in ${mode === 'task' ? 'Task' : 'Chat'} Mode yet. Add one above!`;
    el.queueList.appendChild(empty);
    return;
  }

  ms.items.forEach((item, index) => {
    const card = document.createElement('div');
    card.className = `card ${item.status}`;

    const top = document.createElement('div');
    top.className = 'card-top';

    const meta = document.createElement('div');
    meta.className = 'card-meta';

    const num = document.createElement('span');
    num.className = 'order-num';
    num.textContent = `#${index + 1}`;
    meta.appendChild(num);

    const statusPill = document.createElement('span');
    statusPill.className = `pill ${item.status}`;
    if (item.status === 'running') statusPill.textContent = 'Running...';
    else if (item.status === 'completed') statusPill.textContent = 'Done';
    else statusPill.textContent = 'Queued';
    meta.appendChild(statusPill);

    if (item.scheduledAt && item.status !== 'completed') {
      const schedPill = document.createElement('span');
      schedPill.className = 'pill scheduled';
      schedPill.textContent = `⏰ ${formatSchedule(item.scheduledAt)}`;
      meta.appendChild(schedPill);
    }

    top.appendChild(meta);

    const textDiv = document.createElement('div');
    textDiv.className = 'card-text';
    textDiv.textContent = item.text;

    card.appendChild(top);
    card.appendChild(textDiv);

    if (item.lastError) {
      const errDiv = document.createElement('div');
      errDiv.className = 'card-error';
      errDiv.textContent = `⚠ ${item.lastError}`;
      card.appendChild(errDiv);
    }

    const actions = document.createElement('div');
    actions.className = 'card-actions';

    if (index > 0) {
      const upBtn = makeMiniBtn('↑', 'Move up', async () => {
        await sendBg({ type: 'REORDER_PROMPT', mode, itemId: item.id, direction: 'up' });
      });
      actions.appendChild(upBtn);
    }

    if (index < ms.items.length - 1) {
      const downBtn = makeMiniBtn('↓', 'Move down', async () => {
        await sendBg({ type: 'REORDER_PROMPT', mode, itemId: item.id, direction: 'down' });
      });
      actions.appendChild(downBtn);
    }

    if (item.status !== 'running') {
      const sendBtn = makeMiniBtn(item.status === 'completed' ? 'Re-run' : 'Send Now', 'Send immediately', async () => {
        const res = await sendBg({ type: 'SEND_NOW', mode, itemId: item.id });
        if (!res.ok) showToast(res.reason || res.error || 'Could not send prompt', true);
      });
      actions.appendChild(sendBtn);
    }

    const editBtn = makeMiniBtn('Edit', 'Edit or replace prompt', () => startEdit(item));
    actions.appendChild(editBtn);

    const delBtn = makeMiniBtn('✕', 'Delete prompt', async () => {
      if (editingItemId === item.id) cancelEdit();
      await sendBg({ type: 'DELETE_PROMPT', mode, itemId: item.id });
    }, 'danger');
    actions.appendChild(delBtn);

    card.appendChild(actions);
    el.queueList.appendChild(card);
  });
}

function makeMiniBtn(label, title, onClick, extraClass = '') {
  const btn = document.createElement('button');
  btn.className = `mini-btn ${extraClass}`.trim();
  btn.textContent = label;
  btn.title = title;
  btn.addEventListener('click', onClick);
  return btn;
}

// --- Event Listeners ---

async function switchMode(mode) {
  cancelEdit();
  await sendBg({ type: 'SET_ACTIVE_MODE', mode });
}

el.tabChat.addEventListener('click', () => switchMode('chat'));
el.tabTask.addEventListener('click', () => switchMode('task'));

el.btnToggleRun.addEventListener('click', async () => {
  const mode = activeMode();
  const ms = currentModeState();
  if (ms.isRunning) {
    await sendBg({ type: 'PAUSE_QUEUE', mode });
    showToast(`${mode === 'task' ? 'Task' : 'Chat'} queue paused.`);
  } else {
    const res = await sendBg({ type: 'START_QUEUE', mode });
    if (!res.ok) {
      showToast(res.reason || res.error || 'Queue started (waiting for scheduled prompts).', !res.reason?.includes('No eligible'));
    } else {
      showToast(`${mode === 'task' ? 'Task' : 'Chat'} queue running!`);
    }
  }
});

el.btnBindTab.addEventListener('click', async () => {
  const mode = activeMode();
  const isPinned = Boolean(currentModeState().boundTabId);

  if (!isPinned) {
    try {
      const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (activeTab && activeTab.url && /^https?:\/\//i.test(activeTab.url)) {
        const originPattern = `${new URL(activeTab.url).origin}/*`;
        const hasPerm = await chrome.permissions.contains({ origins: [originPattern] });
        if (!hasPerm) {
          const granted = await chrome.permissions.request({ origins: [originPattern] });
          if (!granted) {
            showToast('Site permission is required to pin this custom AI tab.', true);
            return;
          }
        }
      }
    } catch {
      // Fallback to background validation
    }
  }

  const res = await sendBg({ type: 'BIND_CURRENT_TAB', mode, unbind: isPinned });
  if (!res.ok) {
    showToast(res.error || 'Open an AI tab first to pin it.', true);
  } else {
    showToast(
      isPinned
        ? 'Unpinned tab.'
        : `Pinned ${res.label || 'tab'} to ${mode === 'task' ? 'Task' : 'Chat'} Mode.`
    );
  }
});

el.btnForceNext.addEventListener('click', async () => {
  await sendBg({ type: 'FORCE_COMPLETE_ACTIVE', mode: activeMode() });
});

el.chkSequential.addEventListener('change', async () => {
  await sendBg({ type: 'UPDATE_SETTINGS', mode: activeMode(), sequential: el.chkSequential.checked });
});

el.chkAutoRemove.addEventListener('change', async () => {
  await sendBg({ type: 'UPDATE_SETTINGS', mode: activeMode(), autoRemoveCompleted: el.chkAutoRemove.checked });
});

el.numSettleDelay.addEventListener('change', async () => {
  const val = Math.max(1, Math.min(60, Number(el.numSettleDelay.value) || 3));
  el.numSettleDelay.value = String(val);
  await sendBg({ type: 'UPDATE_SETTINGS', mode: activeMode(), settleDelaySec: val });
});

el.btnClearSchedule.addEventListener('click', () => {
  el.dtSchedule.value = '';
});

el.btnCancelEdit.addEventListener('click', cancelEdit);

async function submitComposer() {
  const text = el.txtPrompt.value.trim();
  if (!text) {
    showToast('Please enter a prompt first.', true);
    return;
  }

  let scheduledAt = null;
  if (el.dtSchedule.value) {
    const parsed = new Date(el.dtSchedule.value).getTime();
    if (!Number.isNaN(parsed)) scheduledAt = parsed;
  }

  const mode = activeMode();

  if (editingItemId) {
    const targetMode = el.selMoveMode.value;
    await sendBg({
      type: 'UPDATE_PROMPT',
      mode,
      itemId: editingItemId,
      text,
      scheduledAt,
      targetMode,
      resetStatus: true
    });
    cancelEdit();
    showToast('Prompt updated.');
  } else {
    await sendBg({
      type: 'ADD_PROMPT',
      mode,
      text,
      scheduledAt
    });
    el.txtPrompt.value = '';
    el.dtSchedule.value = '';
    showToast(scheduledAt ? 'Prompt scheduled.' : 'Prompt added to queue.');
  }
}

el.btnSubmitPrompt.addEventListener('click', submitComposer);

el.txtPrompt.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
    e.preventDefault();
    submitComposer();
  }
});

el.btnClearCompleted.addEventListener('click', async () => {
  await sendBg({ type: 'CLEAR_QUEUE', mode: activeMode(), completedOnly: true });
});

el.btnClearAll.addEventListener('click', async () => {
  if (currentModeState().items.length === 0) return;
  cancelEdit();
  await sendBg({ type: 'CLEAR_QUEUE', mode: activeMode(), completedOnly: false });
  showToast('Queue cleared.');
});

// Listen for live state updates from background service worker
chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === 'STATE_UPDATED' && msg.state) {
    appState = msg.state;
    render();
  }
});

// Initial load
(async () => {
  const res = await sendBg({ type: 'GET_STATE' });
  if (res && res.ok) {
    appState = res.state;
    render();
  }
})();
