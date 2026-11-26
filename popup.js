// Universal AI Prompt Queue - Popup & Side Panel Controller

let appState = null;
let editingItemId = null;
let isRenamingQueue = false;
let toastTimer = null;

const el = {
  queueTabs: document.getElementById('queueTabs'),
  btnAddQueue: document.getElementById('btnAddQueue'),
  btnToggleRun: document.getElementById('btnToggleRun'),
  btnBindTab: document.getElementById('btnBindTab'),
  btnForceNext: document.getElementById('btnForceNext'),
  chkSequential: document.getElementById('chkSequential'),
  chkAutoRemove: document.getElementById('chkAutoRemove'),
  numSettleDelay: document.getElementById('numSettleDelay'),
  composerBox: document.getElementById('composerBox'),
  editBanner: document.getElementById('editBanner'),
  selMoveQueue: document.getElementById('selMoveQueue'),
  btnCancelEdit: document.getElementById('btnCancelEdit'),
  txtPrompt: document.getElementById('txtPrompt'),
  dtSchedule: document.getElementById('dtSchedule'),
  btnClearSchedule: document.getElementById('btnClearSchedule'),
  btnSubmitPrompt: document.getElementById('btnSubmitPrompt'),
  statusToast: document.getElementById('statusToast'),
  queueTitle: document.getElementById('queueTitle'),
  inpRenameQueue: document.getElementById('inpRenameQueue'),
  btnRenameQueue: document.getElementById('btnRenameQueue'),
  btnDeleteQueue: document.getElementById('btnDeleteQueue'),
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

function activeQueue() {
  if (!appState || !appState.queues || appState.queues.length === 0) return null;
  return appState.queues.find((q) => q.id === appState.activeQueueId) || appState.queues[0];
}

function activeQueueId() {
  const q = activeQueue();
  return q ? q.id : null;
}

function cancelEdit() {
  editingItemId = null;
  el.composerBox.classList.remove('editing');
  el.editBanner.classList.add('hidden');
  el.btnSubmitPrompt.textContent = '+ Add Prompt';
  el.txtPrompt.value = '';
  el.dtSchedule.value = '';
}

function populateMoveSelect(selectedQueueId) {
  el.selMoveQueue.innerHTML = '';
  if (!appState) return;
  for (const q of appState.queues) {
    const opt = document.createElement('option');
    opt.value = q.id;
    opt.textContent = q.name;
    if (q.id === selectedQueueId) opt.selected = true;
    el.selMoveQueue.appendChild(opt);
  }
}

function startEdit(item) {
  editingItemId = item.id;
  el.composerBox.classList.add('editing');
  el.editBanner.classList.remove('hidden');
  populateMoveSelect(activeQueueId());
  el.btnSubmitPrompt.textContent = 'Save / Replace';
  el.txtPrompt.value = item.text;
  el.dtSchedule.value = toDatetimeLocalValue(item.scheduledAt);
  el.txtPrompt.focus();
}

function startRenameQueue() {
  const q = activeQueue();
  if (!q) return;
  isRenamingQueue = true;
  el.queueTitle.classList.add('hidden');
  el.btnRenameQueue.classList.add('hidden');
  el.inpRenameQueue.classList.remove('hidden');
  el.inpRenameQueue.value = q.name;
  el.inpRenameQueue.focus();
  el.inpRenameQueue.select();
}

async function finishRenameQueue(save = true) {
  if (!isRenamingQueue) return;
  isRenamingQueue = false;
  const newName = el.inpRenameQueue.value.trim();
  el.inpRenameQueue.classList.add('hidden');
  el.queueTitle.classList.remove('hidden');
  el.btnRenameQueue.classList.remove('hidden');
  if (save && newName) {
    await sendBg({ type: 'RENAME_QUEUE', queueId: activeQueueId(), name: newName });
  }
}

function renderQueueTabs(currentQ) {
  el.queueTabs.innerHTML = '';
  for (const q of appState.queues) {
    const btn = document.createElement('button');
    btn.className = `queue-tab${q.id === currentQ.id ? ' active' : ''}`;
    btn.setAttribute('role', 'tab');
    btn.title = q.boundTabLabel ? `${q.name} (Pinned: ${q.boundTabLabel})` : q.name;

    const dot = document.createElement('span');
    dot.className = `tab-dot${q.isRunning ? ' tab-run-pulse' : ''}`;
    dot.style.background = q.color || '#38bdf8';
    dot.style.color = q.color || '#38bdf8';

    const nameSpan = document.createElement('span');
    nameSpan.textContent = q.name;

    const pendingCount = q.items.filter((i) => i.status !== 'completed').length;
    const badge = document.createElement('span');
    badge.className = 'badge';
    badge.textContent = String(pendingCount);

    btn.append(dot, nameSpan, badge);
    btn.addEventListener('click', () => switchQueue(q.id));
    btn.addEventListener('dblclick', () => {
      if (q.id === activeQueueId()) startRenameQueue();
    });

    el.queueTabs.appendChild(btn);
  }
}

function render() {
  const q = activeQueue();
  if (!q) return;

  document.documentElement.style.setProperty('--accent', q.color || '#38bdf8');
  renderQueueTabs(q);

  if (!isRenamingQueue) {
    el.queueTitle.textContent = q.boundTabLabel ? `${q.name} (${q.boundTabLabel})` : q.name;
  }

  el.btnDeleteQueue.classList.toggle('hidden', appState.queues.length <= 1);

  if (q.isRunning) {
    el.btnToggleRun.textContent = '⏸ Pause Queue';
    el.btnToggleRun.classList.add('running');
  } else {
    el.btnToggleRun.textContent = '▶ Start Queue';
    el.btnToggleRun.classList.remove('running');
  }

  if (q.boundTabId) {
    el.btnBindTab.textContent = `📌 ${q.boundTabLabel || 'Tab Pinned'}`;
    el.btnBindTab.classList.add('pinned');
  } else {
    el.btnBindTab.textContent = '📌 Pin Tab';
    el.btnBindTab.classList.remove('pinned');
  }

  el.btnForceNext.classList.toggle('hidden', !q.activeItemId);

  el.chkSequential.checked = Boolean(q.sequential);
  el.chkAutoRemove.checked = Boolean(q.autoRemoveCompleted);
  el.numSettleDelay.value = String(q.settleDelaySec || 3);

  const hasCompleted = q.items.some((i) => i.status === 'completed');
  el.btnClearCompleted.classList.toggle('hidden', !hasCompleted);

  el.queueList.innerHTML = '';
  if (q.items.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'empty-state';
    empty.textContent = `No prompts in "${q.name}" yet. Add one above!`;
    el.queueList.appendChild(empty);
    return;
  }

  q.items.forEach((item, index) => {
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
      actions.appendChild(
        makeMiniBtn('↑', 'Move up', async () => {
          await sendBg({ type: 'REORDER_PROMPT', queueId: q.id, itemId: item.id, direction: 'up' });
        })
      );
    }

    if (index < q.items.length - 1) {
      actions.appendChild(
        makeMiniBtn('↓', 'Move down', async () => {
          await sendBg({ type: 'REORDER_PROMPT', queueId: q.id, itemId: item.id, direction: 'down' });
        })
      );
    }

    if (item.status !== 'running') {
      actions.appendChild(
        makeMiniBtn(item.status === 'completed' ? 'Re-run' : 'Send Now', 'Send immediately', async () => {
          const res = await sendBg({ type: 'SEND_NOW', queueId: q.id, itemId: item.id });
          if (!res.ok) showToast(res.reason || res.error || 'Could not send prompt', true);
        })
      );
    }

    actions.appendChild(makeMiniBtn('Edit', 'Edit or move prompt', () => startEdit(item)));

    actions.appendChild(
      makeMiniBtn('✕', 'Delete prompt', async () => {
        if (editingItemId === item.id) cancelEdit();
        await sendBg({ type: 'DELETE_PROMPT', queueId: q.id, itemId: item.id });
      }, 'danger')
    );

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

async function switchQueue(queueId) {
  if (queueId === activeQueueId()) return;
  cancelEdit();
  await finishRenameQueue(false);
  await sendBg({ type: 'SET_ACTIVE_QUEUE', queueId });
}

el.btnAddQueue.addEventListener('click', async () => {
  cancelEdit();
  await finishRenameQueue(false);
  const res = await sendBg({ type: 'CREATE_QUEUE' });
  if (res && res.ok) {
    showToast(`Created "${res.queue.name}". Click ✎ to rename it.`);
  }
});

el.btnRenameQueue.addEventListener('click', startRenameQueue);
el.inpRenameQueue.addEventListener('blur', () => finishRenameQueue(true));
el.inpRenameQueue.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    finishRenameQueue(true);
  } else if (e.key === 'Escape') {
    e.preventDefault();
    finishRenameQueue(false);
  }
});

el.btnDeleteQueue.addEventListener('click', async () => {
  const q = activeQueue();
  if (!q || appState.queues.length <= 1) return;
  cancelEdit();
  await sendBg({ type: 'DELETE_QUEUE', queueId: q.id });
  showToast(`Deleted "${q.name}".`);
});

el.btnToggleRun.addEventListener('click', async () => {
  const q = activeQueue();
  if (!q) return;
  if (q.isRunning) {
    await sendBg({ type: 'PAUSE_QUEUE', queueId: q.id });
    showToast(`"${q.name}" paused.`);
  } else {
    const res = await sendBg({ type: 'START_QUEUE', queueId: q.id });
    if (!res.ok) {
      showToast(res.reason || res.error || 'Queue started (waiting for scheduled prompts).', !res.reason?.includes('No eligible'));
    } else {
      showToast(`"${q.name}" running on ${res.provider || 'AI tab'}!`);
    }
  }
});

el.btnBindTab.addEventListener('click', async () => {
  const q = activeQueue();
  if (!q) return;
  const isPinned = Boolean(q.boundTabId);

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

  const res = await sendBg({ type: 'BIND_CURRENT_TAB', queueId: q.id, unbind: isPinned });
  if (!res.ok) {
    showToast(res.error || 'Open an AI tab first to pin it.', true);
  } else {
    showToast(isPinned ? 'Unpinned tab.' : `Pinned ${res.label || 'tab'} to "${q.name}".`);
  }
});

el.btnForceNext.addEventListener('click', async () => {
  await sendBg({ type: 'FORCE_COMPLETE_ACTIVE', queueId: activeQueueId() });
});

el.chkSequential.addEventListener('change', async () => {
  await sendBg({ type: 'UPDATE_SETTINGS', queueId: activeQueueId(), sequential: el.chkSequential.checked });
});

el.chkAutoRemove.addEventListener('change', async () => {
  await sendBg({ type: 'UPDATE_SETTINGS', queueId: activeQueueId(), autoRemoveCompleted: el.chkAutoRemove.checked });
});

el.numSettleDelay.addEventListener('change', async () => {
  const val = Math.max(1, Math.min(60, Number(el.numSettleDelay.value) || 3));
  el.numSettleDelay.value = String(val);
  await sendBg({ type: 'UPDATE_SETTINGS', queueId: activeQueueId(), settleDelaySec: val });
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

  const qId = activeQueueId();

  if (editingItemId) {
    const targetQueueId = el.selMoveQueue.value;
    await sendBg({
      type: 'UPDATE_PROMPT',
      queueId: qId,
      itemId: editingItemId,
      text,
      scheduledAt,
      targetQueueId,
      resetStatus: true
    });
    cancelEdit();
    showToast('Prompt updated.');
  } else {
    await sendBg({
      type: 'ADD_PROMPT',
      queueId: qId,
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
  if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
    e.preventDefault();
    submitComposer();
  }
});

el.btnClearCompleted.addEventListener('click', async () => {
  await sendBg({ type: 'CLEAR_QUEUE', queueId: activeQueueId(), completedOnly: true });
});

el.btnClearAll.addEventListener('click', async () => {
  const q = activeQueue();
  if (!q || q.items.length === 0) return;
  cancelEdit();
  await sendBg({ type: 'CLEAR_QUEUE', queueId: q.id, completedOnly: false });
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
