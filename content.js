// Universal AI Prompt Queue - Content Script
// Injects queued prompts into ChatGPT, Claude, DeepSeek, Gemini, Perplexity, Grok,
// Mistral, Poe, Qwen, Kimi, Copilot, HuggingChat, or any custom AI web app,
// watches for generation completion, and displays a lightweight status pill.

(() => {
  if (window.__universalAiPromptQueueLoaded) return;
  window.__universalAiPromptQueueLoaded = true;

  let activeWatch = null;

  // --- Site Adapters (specific selectors first, generic fallback for any AI) ---
  const ADAPTERS = [
    {
      name: 'ChatGPT',
      match: (h) => h.includes('chatgpt.com') || h.includes('chat.openai.com'),
      inputSelectors: [
        '#prompt-textarea',
        'div.ProseMirror[contenteditable="true"]',
        'textarea[data-id="root"]'
      ],
      sendSelectors: [
        'button[data-testid="send-button"]',
        'button[aria-label*="Send prompt" i]',
        'button[aria-label*="Send message" i]'
      ],
      stopSelectors: [
        'button[data-testid="stop-button"]',
        'button[aria-label*="Stop streaming" i]',
        'button[aria-label*="Stop generating" i]'
      ],
      busySelectors: ['[data-message-author-role="assistant"] [aria-busy="true"]'],
      responseSelectors: [
        '[data-message-author-role="assistant"]',
        'article[data-testid^="conversation-turn-"]'
      ]
    },
    {
      name: 'Claude',
      match: (h) => h.includes('claude.ai'),
      inputSelectors: [
        'div.ProseMirror[contenteditable="true"]',
        'div[contenteditable="true"][aria-label*="Write your prompt" i]',
        'fieldset div[contenteditable="true"]'
      ],
      sendSelectors: [
        'button[aria-label="Send message" i]',
        'button[aria-label*="Send" i]'
      ],
      stopSelectors: [
        'button[aria-label="Stop response" i]',
        'button[aria-label*="Stop" i]'
      ],
      busySelectors: ['[data-is-streaming="true"]'],
      responseSelectors: [
        '[data-is-streaming]',
        '.font-claude-response',
        '.font-claude-message',
        '[data-testid="chat-message-text"]'
      ]
    },
    {
      name: 'DeepSeek',
      match: (h) => h.includes('deepseek.com'),
      inputSelectors: [
        'textarea#chat-input',
        'textarea[placeholder*="DeepSeek" i]',
        'textarea[placeholder*="Message" i]'
      ],
      sendSelectors: [
        'div[role="button"][aria-disabled="false"]:not([aria-label*="Attach" i]):not([aria-label*="Search" i])',
        'button[aria-label*="Send" i]'
      ],
      stopSelectors: [
        'button[aria-label*="Stop" i]',
        'div[role="button"][aria-label*="Stop" i]'
      ],
      busySelectors: [],
      responseSelectors: ['.ds-markdown', '[class*="markdown"]']
    },
    {
      name: 'Gemini',
      match: (h) => h.includes('gemini.google.com'),
      inputSelectors: [
        'rich-textarea .ql-editor[contenteditable="true"]',
        'div.ql-editor[contenteditable="true"]',
        'div[contenteditable="true"][aria-label*="prompt" i]'
      ],
      sendSelectors: [
        'button.send-button',
        'button[data-test-id="send-button"]',
        'button[aria-label*="Send message" i]',
        'button[mattooltip*="Send" i]'
      ],
      stopSelectors: [
        'button[aria-label*="Stop" i]',
        'button.stop-button',
        'button[data-test-id="stop-button"]',
        'mat-icon[fonticon="stop"]'
      ],
      busySelectors: [
        'model-response [aria-busy="true"]',
        '.response-container [aria-busy="true"]',
        'mat-progress-bar[mode="indeterminate"]'
      ],
      responseSelectors: [
        'model-response',
        'message-content',
        '.model-response-text',
        '[data-test-id*="response"]'
      ]
    },
    {
      name: 'AI Studio',
      match: (h) => h.includes('aistudio.google.com'),
      inputSelectors: ['textarea[aria-label*="prompt" i]', 'textarea'],
      sendSelectors: ['button[aria-label*="Run" i]', 'button.run-button'],
      stopSelectors: ['button[aria-label*="Stop" i]'],
      busySelectors: ['mat-progress-bar[mode="indeterminate"]'],
      responseSelectors: ['.model-prompt-container', '.turn-content']
    },
    {
      name: 'Perplexity',
      match: (h) => h.includes('perplexity.ai'),
      inputSelectors: [
        'div[contenteditable="true"]#ask-input',
        'textarea[placeholder*="Ask" i]',
        'textarea'
      ],
      sendSelectors: ['button[aria-label="Submit" i]', 'button[aria-label*="Send" i]'],
      stopSelectors: ['[data-testid="stop-generating-button"]', 'button[aria-label*="Stop" i]'],
      busySelectors: [],
      responseSelectors: ['.prose', '[class*="prose"]', '[data-testid="answer"]']
    },
    {
      name: 'Grok',
      match: (h) => h.includes('grok.com') || h.endsWith('x.com'),
      inputSelectors: ['textarea', 'div[contenteditable="true"][role="textbox"]'],
      sendSelectors: ['button[aria-label*="Send" i]', 'button[type="submit"]'],
      stopSelectors: ['button[aria-label*="Stop" i]'],
      busySelectors: [],
      responseSelectors: ['.message-bubble', '[class*="markdown"]', '.prose']
    },
    {
      name: 'Mistral',
      match: (h) => h.includes('mistral.ai'),
      inputSelectors: ['textarea', 'div[contenteditable="true"]'],
      sendSelectors: ['button[type="submit"]', 'button[aria-label*="Send" i]'],
      stopSelectors: ['button[aria-label*="Stop" i]'],
      busySelectors: [],
      responseSelectors: ['.prose', '[class*="markdown"]']
    },
    {
      name: 'Poe',
      match: (h) => h.includes('poe.com'),
      inputSelectors: ['textarea[class*="TextArea"]', 'textarea'],
      sendSelectors: ['button[class*="SendButton"]', 'button[aria-label*="Send" i]'],
      stopSelectors: ['button[class*="StopButton"]', 'button[aria-label*="Stop" i]'],
      busySelectors: [],
      responseSelectors: ['[class*="Markdown"]', '[class*="Message_botMessage"]']
    },
    {
      name: 'Qwen',
      match: (h) => h.includes('qwen'),
      inputSelectors: ['textarea#chat-input', 'textarea'],
      sendSelectors: ['button#send-message-button', 'button[aria-label*="Send" i]', 'button[type="submit"]'],
      stopSelectors: ['button[aria-label*="Stop" i]'],
      busySelectors: [],
      responseSelectors: ['[class*="markdown"]', '.prose']
    },
    {
      name: 'Kimi',
      match: (h) => h.includes('kimi'),
      inputSelectors: ['div[contenteditable="true"]', 'textarea'],
      sendSelectors: ['button[aria-label*="Send" i]', 'div[class*="send"]'],
      stopSelectors: ['button[aria-label*="Stop" i]'],
      busySelectors: [],
      responseSelectors: ['[class*="markdown"]', '.prose']
    },
    {
      name: 'Copilot',
      match: (h) => h.includes('copilot.microsoft.com'),
      inputSelectors: ['textarea#userInput', 'textarea'],
      sendSelectors: ['button[aria-label*="Submit" i]', 'button[aria-label*="Send" i]'],
      stopSelectors: ['button[aria-label*="Stop" i]'],
      busySelectors: [],
      responseSelectors: ['[data-content="ai-message"]', '[class*="response"]']
    },
    {
      name: 'HuggingChat',
      match: (h) => h.includes('huggingface.co'),
      inputSelectors: ['textarea[placeholder*="Ask" i]', 'textarea'],
      sendSelectors: ['button[type="submit"]', 'button[aria-label*="Send" i]'],
      stopSelectors: ['button[aria-label*="Stop" i]'],
      busySelectors: [],
      responseSelectors: ['.prose', '[class*="markdown"]']
    }
  ];

  const GENERIC_INPUT_SELECTORS = [
    'div.ProseMirror[contenteditable="true"]',
    'div[contenteditable="true"][role="textbox"]',
    'div[contenteditable="true"][aria-label*="prompt" i]',
    'div[contenteditable="true"][aria-label*="message" i]',
    'div[contenteditable="true"][aria-label*="ask" i]',
    'textarea:not([disabled]):not([readonly])',
    'div[contenteditable="true"]'
  ];

  const GENERIC_SEND_SELECTORS = [
    'button[data-testid="send-button"]',
    'button[data-test-id="send-button"]',
    'button[aria-label*="Send" i]',
    'button[aria-label*="Submit" i]',
    'button[title*="Send" i]',
    'button[type="submit"]',
    '[role="button"][aria-label*="Send" i]'
  ];

  const GENERIC_STOP_SELECTORS = [
    'button[data-testid="stop-button"]',
    'button[data-test-id="stop-button"]',
    'button[aria-label*="Stop" i]',
    'button[aria-label*="Cancel" i]',
    'button[title*="Stop" i]',
    '[role="button"][aria-label*="Stop" i]'
  ];

  const GENERIC_BUSY_SELECTORS = [
    '[aria-busy="true"]',
    '[data-is-streaming="true"]',
    '[data-streaming="true"]'
  ];

  const GENERIC_RESPONSE_SELECTORS = [
    '[data-message-author-role="assistant"]',
    '[class*="assistant"]',
    '[class*="response"]',
    '[class*="markdown"]',
    '.prose',
    'article'
  ];

  function getAdapter() {
    const host = window.location.hostname.toLowerCase();
    const matched = ADAPTERS.find((a) => a.match(host));
    if (matched) return matched;
    return {
      name: host.replace(/^www\./, '') || 'AI',
      inputSelectors: [],
      sendSelectors: [],
      stopSelectors: [],
      busySelectors: [],
      responseSelectors: []
    };
  }

  function isVisible(el) {
    if (!el) return false;
    const style = window.getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') {
      return false;
    }
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  function isEnabled(el) {
    if (!el) return false;
    return !el.disabled && el.getAttribute('aria-disabled') !== 'true';
  }

  function findFirstVisible(selectors, requireEnabled = false) {
    for (const sel of selectors) {
      let matches;
      try {
        matches = document.querySelectorAll(sel);
      } catch {
        continue;
      }
      for (const el of matches) {
        if (isVisible(el) && (!requireEnabled || isEnabled(el))) {
          return el;
        }
      }
    }
    return null;
  }

  function findPromptInput() {
    const adapter = getAdapter();
    const specific = findFirstVisible(adapter.inputSelectors, true);
    if (specific) return specific;
    return findFirstVisible(GENERIC_INPUT_SELECTORS, true);
  }

  function findSendButton() {
    const adapter = getAdapter();
    const specific = findFirstVisible(adapter.sendSelectors, true);
    if (specific) return specific;
    return findFirstVisible(GENERIC_SEND_SELECTORS, true);
  }

  function isAiGenerating() {
    const adapter = getAdapter();
    if (findFirstVisible(adapter.stopSelectors, false)) return true;
    if (findFirstVisible(GENERIC_STOP_SELECTORS, false)) return true;
    if (findFirstVisible(adapter.busySelectors, false)) return true;
    if (findFirstVisible(GENERIC_BUSY_SELECTORS, false)) return true;
    return false;
  }

  function getResponseSnapshot() {
    const adapter = getAdapter();
    const selectors = adapter.responseSelectors.length > 0
      ? adapter.responseSelectors
      : GENERIC_RESPONSE_SELECTORS;

    let nodes = [];
    for (const sel of selectors) {
      try {
        const found = document.querySelectorAll(sel);
        if (found.length > 0) {
          nodes = found;
          break;
        }
      } catch {
        // Ignore invalid selector
      }
    }

    if (nodes.length > 0) {
      const lastText = (nodes[nodes.length - 1].innerText || '').trim();
      return { count: nodes.length, lastLen: lastText.length, tail: lastText.slice(-80) };
    }

    // Universal fallback: observe whole-page text length changes
    const bodyText = (document.body.innerText || '').trim();
    return { count: 0, lastLen: bodyText.length, tail: bodyText.slice(-80) };
  }

  async function setInputText(inputEl, text) {
    inputEl.focus();

    if (inputEl.tagName === 'TEXTAREA' || inputEl.tagName === 'INPUT') {
      const proto = inputEl.tagName === 'INPUT'
        ? window.HTMLInputElement.prototype
        : window.HTMLTextAreaElement.prototype;
      const nativeSetter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
      if (nativeSetter) nativeSetter.call(inputEl, text);
      else inputEl.value = text;
      inputEl.dispatchEvent(new Event('input', { bubbles: true }));
      inputEl.dispatchEvent(new Event('change', { bubbles: true }));
      return;
    }

    // Contenteditable (ProseMirror, Quill, Lexical, etc.)
    try {
      const selection = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(inputEl);
      selection.removeAllRanges();
      selection.addRange(range);
      document.execCommand('delete', false);
      const inserted = document.execCommand('insertText', false, text);
      if (!inserted || !(inputEl.innerText || '').trim()) {
        throw new Error('execCommand fallback');
      }
    } catch {
      inputEl.innerHTML = '';
      const lines = text.split('\n');
      for (const line of lines) {
        const p = document.createElement('p');
        p.textContent = line || '\u200B';
        inputEl.appendChild(p);
      }
      inputEl.dispatchEvent(
        new InputEvent('input', { bubbles: true, inputType: 'insertText', data: text })
      );
    }
  }

  function triggerSend(inputEl) {
    const sendBtn = findSendButton();
    if (sendBtn) {
      sendBtn.click();
      return true;
    }

    // AI Studio uses Ctrl/Cmd + Enter when Run button isn't matched
    const isAiStudio = window.location.hostname.includes('aistudio.google.com');
    const keyOpts = {
      key: 'Enter',
      code: 'Enter',
      keyCode: 13,
      which: 13,
      ctrlKey: isAiStudio,
      bubbles: true,
      cancelable: true
    };
    inputEl.dispatchEvent(new KeyboardEvent('keydown', keyOpts));
    inputEl.dispatchEvent(new KeyboardEvent('keypress', keyOpts));
    inputEl.dispatchEvent(new KeyboardEvent('keyup', keyOpts));
    return true;
  }

  function stopActiveWatch() {
    if (!activeWatch) return;
    if (activeWatch.observer) activeWatch.observer.disconnect();
    if (activeWatch.interval) clearInterval(activeWatch.interval);
    activeWatch = null;
  }

  async function executeAndWatch({ mode, itemId, text, settleDelayMs = 3000 }) {
    stopActiveWatch();

    const adapter = getAdapter();
    const inputEl = findPromptInput();
    if (!inputEl) {
      return {
        ok: false,
        error: `Prompt input not found on ${adapter.name}. Make sure the chat box is visible and you are signed in.`
      };
    }

    const beforeSnap = getResponseSnapshot();
    await setInputText(inputEl, text);

    // Give the web app a short moment to enable its Send button
    await new Promise((r) => setTimeout(r, 250));
    triggerSend(inputEl);

    const startTime = Date.now();
    let sawGenerationStart = false;
    let lastActivityTime = Date.now();
    let prevSnap = beforeSnap;

    const observer = new MutationObserver(() => {
      const snap = getResponseSnapshot();
      if (
        snap.count !== prevSnap.count ||
        snap.lastLen !== prevSnap.lastLen ||
        snap.tail !== prevSnap.tail
      ) {
        prevSnap = snap;
        sawGenerationStart = true;
        lastActivityTime = Date.now();
      }
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true,
      characterData: true
    });

    const interval = setInterval(() => {
      const now = Date.now();
      const generating = isAiGenerating();
      const snap = getResponseSnapshot();

      if (generating) {
        sawGenerationStart = true;
        lastActivityTime = now;
        return;
      }

      if (
        snap.count !== beforeSnap.count ||
        snap.lastLen !== beforeSnap.lastLen ||
        snap.tail !== beforeSnap.tail
      ) {
        sawGenerationStart = true;
      }

      const elapsed = now - startTime;
      const quietFor = now - lastActivityTime;

      if ((sawGenerationStart && quietFor >= settleDelayMs) || (!sawGenerationStart && elapsed >= 15000)) {
        stopActiveWatch();
        chrome.runtime.sendMessage({
          type: 'PROMPT_COMPLETED',
          mode,
          itemId,
          success: true
        }).catch(() => {});
      }
    }, 500);

    activeWatch = { mode, itemId, observer, interval };
    return { ok: true };
  }

  // --- Lightweight In-Page Status Pill ---
  const PILL_ID = 'uapq-status-pill';

  function updateOverlayPill(payload) {
    const activeModes = [];
    for (const m of ['chat', 'task']) {
      const info = payload[m];
      if (!info) continue;
      const matchesTab = !info.boundTabId || info.boundTabId === payload.tabId;
      if (matchesTab && (info.isRunning || info.activeItemId)) {
        activeModes.push({ mode: m, ...info });
      }
    }

    let pill = document.getElementById(PILL_ID);
    if (activeModes.length === 0) {
      if (pill) pill.remove();
      return;
    }

    if (!pill) {
      pill = document.createElement('div');
      pill.id = PILL_ID;
      Object.assign(pill.style, {
        position: 'fixed',
        bottom: '18px',
        right: '18px',
        zIndex: '2147483647',
        background: '#131620',
        color: '#f1f5f9',
        border: '1px solid #334155',
        borderRadius: '999px',
        padding: '8px 14px',
        fontFamily: 'system-ui, -apple-system, Segoe UI, Roboto, sans-serif',
        fontSize: '12px',
        fontWeight: '600',
        display: 'flex',
        alignItems: 'center',
        gap: '10px',
        boxShadow: '0 8px 24px rgba(0, 0, 0, 0.35)'
      });
      document.body.appendChild(pill);
    }

    const primary = activeModes[0];
    const adapter = getAdapter();
    const modeLabel = primary.mode === 'task' ? 'Task' : 'Chat';
    const dotColor = primary.mode === 'task' ? '#a78bfa' : '#38bdf8';

    pill.innerHTML = '';

    const dot = document.createElement('span');
    Object.assign(dot.style, {
      width: '8px',
      height: '8px',
      borderRadius: '50%',
      background: dotColor,
      display: 'inline-block'
    });

    const label = document.createElement('span');
    label.textContent = `${adapter.name} [${modeLabel}] • ${primary.remaining} left`;

    const nextBtn = document.createElement('button');
    nextBtn.textContent = 'Next';
    stylePillBtn(nextBtn, '#1e293b', '#e2e8f0');
    nextBtn.onclick = () => {
      stopActiveWatch();
      chrome.runtime.sendMessage({ type: 'FORCE_COMPLETE_ACTIVE', mode: primary.mode });
    };

    const pauseBtn = document.createElement('button');
    pauseBtn.textContent = 'Pause';
    stylePillBtn(pauseBtn, '#7f1d1d', '#fecaca');
    pauseBtn.onclick = () => {
      chrome.runtime.sendMessage({ type: 'PAUSE_QUEUE', mode: primary.mode });
    };

    pill.append(dot, label, nextBtn, pauseBtn);
  }

  function stylePillBtn(btn, bg, color) {
    Object.assign(btn.style, {
      background: bg,
      color,
      border: 'none',
      borderRadius: '999px',
      padding: '3px 9px',
      fontSize: '11px',
      fontWeight: '600',
      cursor: 'pointer'
    });
  }

  // --- Message Listener ---
  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg.type === 'PING') {
      sendResponse({ ok: true, adapter: getAdapter().name });
      return;
    }
    if (msg.type === 'EXECUTE_PROMPT') {
      executeAndWatch(msg).then(sendResponse);
      return true;
    }
    if (msg.type === 'OVERLAY_STATUS') {
      updateOverlayPill(msg.payload);
      sendResponse({ ok: true });
      return;
    }
  });
})();
