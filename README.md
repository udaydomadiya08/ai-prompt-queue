# Universal AI Prompt Queue

A Manifest V3 Chrome Extension to **queue, schedule, edit, and sequentially run prompts** across **ChatGPT, Claude, DeepSeek, Gemini, Perplexity, Grok**, and **any custom or self-hosted AI web app** — with **unlimited independent queues** so you can run N parallel AI workflows at once.

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

- **Unlimited Independent Queues (N Workflows)**: Click **+ New Queue** to create as many queues as you want, rename them inline (`✎` or double-click), and delete them anytime. Run ChatGPT, Claude, DeepSeek, Gemini, and local models all in parallel without colliding.
- **Universal Pin Tab**: Click **📌 Pin Tab** on *any* `http://` or `https://` AI web app — including local/self-hosted UIs — to bind that queue to its own tab and grant per-origin permission on demand.
- **Sequential Flow**: Automatically sends the next queued prompt as soon as the AI finishes streaming its response, with a configurable post-reply **Wait (s)** buffer per queue.
- **Scheduled Prompts**: Pick a local date & time on any prompt to trigger it automatically via `chrome.alarms` — even when the popup is closed.
- **Full Queue Management**: Add (`Enter` to add, `Shift+Enter` for newline), edit/replace text or schedule, move prompts between any queues, reorder (`↑` / `↓`), trigger immediately (`Send Now`), or delete items.
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

- **Multi-AI Parallel Workflow**: Create a queue for each AI you want to run (e.g., click **+ New Queue** → rename to `ChatGPT`, `Claude`, `DeepSeek`), open each AI in its own tab, and click **📌 Pin Tab** on each queue. All queues run independently in parallel.
- **Custom / Self-Hosted AI**: Open your custom AI URL (e.g., `http://localhost:3000` for OpenWebUI) and click **📌 Pin Tab**. Chrome will ask once for permission on that origin, and the extension will immediately connect.
- **Manual Override**: If an AI pauses for confirmation or you want to skip ahead early, click **⏭ Done / Next** in the popup or **Next** on the floating on-page pill.
- **Already-Open Tabs**: If you installed or reloaded the extension while an AI tab was already open, refresh that tab once if the prompt fails to inject.

## 24/7 Cloud Runner (Runs When Your Laptop Is Off)

Want your prompt queues to run **even when your laptop is powered off**? This repo includes a zero-dependency **GitHub Actions Cloud Runner** (`cloud/runner.mjs`) that executes every 15 minutes (or on manual trigger), calls your AI APIs, saves Markdown outputs to `cloud/outputs/`, and sends responses directly to **Telegram, Discord, or Slack**.

### Setup in 3 Steps

1. **Add Secrets in GitHub** (`Settings` → `Secrets and variables` → `Actions` → `New repository secret`):
   - **AI API Keys** (add whichever providers you use):
     - `OPENAI_API_KEY` (ChatGPT / OpenAI)
     - `ANTHROPIC_API_KEY` (Claude)
     - `DEEPSEEK_API_KEY` (DeepSeek)
     - `GEMINI_API_KEY` (Google Gemini)
     - `OPENROUTER_API_KEY` (OpenRouter)
     - `CUSTOM_API_KEY` (any OpenAI-compatible `baseUrl`)
   - **Notifications** (add one or more):
     - **Telegram**: `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID`
     - **Discord**: `DISCORD_WEBHOOK_URL`
     - **Slack**: `SLACK_WEBHOOK_URL`
2. **Edit `cloud/queues.json`**:
   - Add as many queues as you want, set `"enabled": true`, choose `"provider"` (`openai`, `anthropic`, `deepseek`, `gemini`, `openrouter`, or `custom`), and add your prompts (optionally with an ISO `"scheduledAt"` timestamp and `"chainContext": true` to pass previous replies into the next prompt).
3. **Run**:
   - GitHub Actions runs automatically every 15 minutes via `.github/workflows/cloud-queue.yml`, or trigger it anytime from the **Actions** tab → **Cloud AI Prompt Queue** → **Run workflow**.

## Project Structure

```text
├── manifest.json                  # Manifest V3 config, permissions, and AI host matches
├── background.js                  # Service worker: N queues, alarms, tab routing & migration
├── content.js                     # Site adapters + generic DOM engine & floating status pill
├── popup.html                     # Popup & Side Panel UI markup
├── popup.js                       # Popup controller & optional host permission flow
├── popup.css                      # Dark-mode styling for popup & side panel
├── cloud/
│   ├── queues.json                # Cloud queues config (N workflows, schedules, providers)
│   └── runner.mjs                 # Zero-dependency Node 20+ cloud runner & webhook notifier
├── .github/workflows/
│   └── cloud-queue.yml            # GitHub Actions 24/7 cron + manual workflow
├── icons/                         # Extension icons (16, 48, 128 px)
├── LICENSE                        # MIT License
└── README.md
```

## License

[MIT](LICENSE)
