# Universal AI Prompt Queue

A Manifest V3 Chrome Extension to **queue, schedule, edit, and sequentially run prompts** across **ChatGPT, Claude, DeepSeek, Gemini, Perplexity, Grok**, and **any custom or self-hosted AI web app** — with dual independent queues (**Chat Mode** & **Task Mode**).

![Manifest V3](https://img.shields.io/badge/Manifest-V3-blue)
![Chrome Extension](https://img.shields.io/badge/Chrome-Extension-4285F4)
![License: MIT](https://img.shields.io/badge/License-MIT-green)

## Supported AI Platforms

Works out of the box on:

| Platform | URL |
| :--- | :--- |
| **ChatGPT** | `chatgpt.com`, `chat.openai.com` |
| **Claude** | `claude.ai` |
| **DeepSeek** | `chat.deepseek.com` |
| **Gemini** | `gemini.google.com` |
| **Google AI Studio** | `aistudio.google.com` |
| **Perplexity** | `perplexity.ai` |
| **Grok** | `grok.com`, `x.com/i/grok` |
| **Mistral Le Chat** | `chat.mistral.ai` |
| **Poe** | `poe.com` |
| **Qwen Chat** | `chat.qwen.ai`, `chat.qwenlm.ai` |
| **Kimi** | `kimi.moonshot.cn`, `kimi.com` |
| **Microsoft Copilot** | `copilot.microsoft.com` |
| **HuggingChat** | `huggingface.co/chat` |
| **Any Custom / Self-Hosted AI** | OpenWebUI, LibreChat, T3 Chat, `localhost`, etc. (via **Pin Tab**) |

## Features

- **Dual Independent Queues (Chat Mode & Task Mode)**: Run two separate queues in parallel. Use **Pin Tab** to bind Chat Mode to one AI tab (e.g., ChatGPT) and Task Mode to another (e.g., Claude or DeepSeek) so they never collide.
- **Universal Pin Tab**: Click **📌 Pin Tab** on *any* `http://` or `https://` AI web app — including local/self-hosted UIs — to grant per-origin permission and inject the queue runner on demand.
- **Sequential Flow**: Automatically sends the next queued prompt as soon as the AI finishes streaming its response, with a configurable post-reply **Wait (s)** buffer (`3s` default for Chat Mode, `5s` default for Task Mode).
- **Scheduled Prompts**: Pick a local date & time on any prompt to trigger it automatically via `chrome.alarms` — even when the popup is closed.
- **Full Queue Management**: Add (`Ctrl+Enter` / `Cmd+Enter`), edit/replace text or schedule, move prompts between Chat and Task modes, reorder (`↑` / `↓`), trigger immediately (`Send Now`), or delete items.
- **Auto-Remove Completed Prompts**: Enabled by default so finished prompts are cleared automatically (toggle off to keep completed items marked as `Done`).
- **Popup + Side Panel + Floating Pill**: Click the extension icon for the popup, right-click the icon → **Open side panel** to dock it beside your AI chat, and use the floating on-page pill to pause or manually advance (`Next`).

## Installation (Developer Mode)

1. Clone this repository or download the ZIP and extract it:
   ```bash
   git clone https://github.com/udaydomadiya08/ai-prompt-queue.git
   ```
2. Open Chrome and navigate to `chrome://extensions/`.
3. Enable **Developer mode** (top-right toggle).
4. Click **Load unpacked** and select the project folder (the folder containing `manifest.json`).
5. Pin **Universal AI Prompt Queue** to your Chrome toolbar and open any supported AI chat tab.

## Quick Usage Tips

- **Multi-AI Parallel Workflow**: Open ChatGPT in one tab and click **📌 Pin Tab** under **Chat Mode**. Open Claude or DeepSeek in a second tab and click **📌 Pin Tab** under **Task Mode**. Both queues will run independently on their respective tabs.
- **Custom / Self-Hosted AI**: Open your custom AI URL (e.g., `http://localhost:3000` for OpenWebUI) and click **📌 Pin Tab**. Chrome will ask once for permission on that origin, and the extension will immediately connect.
- **Manual Override**: If an AI pauses for confirmation or you want to skip ahead early, click **⏭ Done / Next** in the popup or **Next** on the floating on-page pill.
- **Already-Open Tabs**: If you installed or reloaded the extension while an AI tab was already open, refresh that tab once if the prompt fails to inject.

## Project Structure

```text
├── manifest.json   # Manifest V3 config, permissions, and AI host matches
├── background.js   # Service worker: queue state, alarms, tab routing & migration
├── content.js      # Site adapters + generic DOM engine & floating status pill
├── popup.html      # Popup & Side Panel UI markup
├── popup.js        # Popup controller & optional host permission flow
├── popup.css       # Dark-mode styling for popup & side panel
├── icons/          # Extension icons (16, 48, 128 px)
├── LICENSE         # MIT License
└── README.md
```

## License

[MIT](LICENSE)
