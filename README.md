# Belmont Tools

**Give AI agents real tools. Keep control of your machine.**

Belmont Tools is a desktop workspace (Electron) for running AI agents against your
own files, on your own computer. Eight model providers, MCP servers, per-project
folders, and a permission gate in front of anything destructive.

It does not hide the agent loop from you — it gives you a place to watch it and
stop it.

---

## Download

| | |
|---|---|
| **[Download the latest release](https://github.com/aguzakky22-droid/Belmont-agent-harness/releases/latest)** | Installer (`Setup`) or portable `.exe` |

**Requirements**

- Windows 10 or 11, 64-bit
- An API key from at least one provider — or a Claude Code subscription, which
  needs no key
- **Node.js**, only if you want MCP servers over stdio. Those are launched with
  your system's `npx`, and Node is not bundled with the installer. MCP servers
  reached over HTTP need nothing extra.

Settings and history live in `%APPDATA%/belmont-tools/`, so installing over an
older version keeps everything.

---

## What it is

A control layer between you and the models you already pay for. Belmont Tools is
not a model and does not replace Claude, GPT, Gemini, or DeepSeek — it connects
them to your files and tools, and makes you the one who approves the dangerous
parts.

**Where your data actually goes.** Your projects, history, and keys stay on your
disk. But the conversation itself — including the contents of any file the agent
reads — is sent to whichever provider you selected. That is a cloud API call.
The only genuinely local option is pointing a custom endpoint at Ollama or
LM Studio.

---

## Running from source

```powershell
npm install     # once
npm start
```

`npm run dev` opens with DevTools.

There is no bundler. Edit the HTML/CSS/JS, save, press `Ctrl+R`. Changes under
`src/main/` need a full restart instead.

### First run

1. Open **Settings**
2. Pick a provider
3. Paste an API key, if that provider needs one
4. Choose a working folder

The interface ships in English and Indonesian — Settings → Appearance.

---

## AI providers

Listed in the order they appear in the dropdown.

| Provider | Default model | Authentication |
|---|---|---|
| **ONToken.id** | `claude-opus-5` | API key, app.ontoken.id — **one key, every model** |
| **Claude Code (subscription)** | follows the CLI default | Claude Code login — **no API key** |
| Claude (Anthropic) | `claude-opus-5` | API key, console.anthropic.com |
| OpenAI (ChatGPT) | `gpt-5.6-sol` | API key, platform.openai.com |
| Gemini (Google) | `gemini-3.8-flash` | API key, aistudio.google.com |
| DeepSeek | `deepseek-v4-pro` | API key, platform.deepseek.com |
| Kimi (Moonshot) | `kimi-k3` | API key, platform.kimi.ai |
| GLM (Zhipu / Z.ai) | `glm-5.3` | API key, z.ai |
| Custom endpoint | whatever you configure | Optional — local servers need none |

Everything except Claude Code speaks the OpenAI wire format.

**ONToken** is a gateway: one key reaches models from several vendors at once
(Claude, GPT, Gemini, GLM, DeepSeek), which is why it sits at the top.

**Gemini** goes through Google's own OpenAI-compatibility layer, which is still in
beta. It silently ignores parameters it does not recognise rather than rejecting
them — so the effort setting may have no effect, with no error to tell you.

### Model lists

The lists above are only a **fallback** shown before you enter a key, and they go
stale. Enter an API key, then press **Reload** next to the Model dropdown: the app
pulls the real list from that provider's `/models` endpoint and caches it. That
response is the source of truth.

### Claude Max subscription vs API key

These are billed differently. **A Max subscription cannot be used to call the
Messages API directly** — there is no public OAuth for that, and API keys are
billed separately through API credits.

The provider that uses the subscription is **Claude Code**. It runs the
[Claude Agent SDK](https://code.claude.com/docs/en/agent-sdk), which picks up your
existing Claude Code login, so it has no API key field at all. If you have never
logged in, run `claude` in a terminal once.

It is the one provider that **drives its own loop**:

- The tools it uses are Claude Code's own (`Read`, `Write`, `Edit`, `Bash`,
  `Glob`, `Grep`, `WebSearch`, `WebFetch`) — **not** the ones in `tools.js`.
- What we still control: `cwd` is pinned to the project folder, and every
  potentially destructive tool still goes through this app's confirmation dialog
  (`canUseTool`). Read-only tools pass through without asking.
- `settingSources: []` — your personal Claude Code settings and agents are
  deliberately not picked up, so the app behaves the same on any machine.
- History is managed by Claude Code itself; we store its `resumeId` in the project
  file so the next turn continues the same session, and mirror the text and tool
  usage into our own history for display.

You can switch providers at any time from the dropdown in the header — the
conversation comes with you, because history is stored in a neutral format rather
than any one vendor's.

### Custom endpoints and local servers

Any OpenAI-compatible endpoint can be added under Settings → Provider. The base
URL stops at `/v1`; the app appends `/chat/completions` and `/models` itself.

**Local servers need no API key** — leave the field empty:

| Server | Base URL |
|---|---|
| Ollama | `http://localhost:11434/v1` |
| LM Studio | `http://localhost:1234/v1` |

The `Authorization` header is omitted entirely when the key is blank, because
sending an empty bearer token makes some servers answer 401 rather than ignore it.

### Adding a provider

DeepSeek, Kimi, GLM, ONToken, OpenAI, and Gemini all come from the same factory.
To add another, add one block to `src/main/providers/index.js`:

```js
const providerBaru = makeOpenAICompatProvider({
  id: 'its-id',
  label: 'Display Name',
  baseURL: 'https://api.example.com/v1',
  models: ['model-a', 'model-b'],
});
```

then add it to the `BUILTIN` object in the same file. Its position in that object
is its position in the dropdown — the UI does not re-sort. Nothing else needs
touching: the dropdown, the settings page, and the API key field fill themselves
in.

If the API has a shape of its own, copy `src/main/providers/anthropic.js`: a
single object with a `run()` method.

---

## Agent tools

Every tool runs on your computer (the Electron main process), not on the model's
server — so the same tool set applies to every provider.

| Tool | Confirms? | Purpose |
|---|---|---|
| `list_dir` | – | List a folder's contents |
| `read_file` | – | Read a text file |
| `write_file` | yes | Create / overwrite a file |
| `edit_file` | yes | Replace a piece of text in a file |
| `run_shell` | yes | Run a command (PowerShell on Windows) |
| `web_search` | – | Search the web |
| `web_fetch` | – | Fetch a web page as text |

**Safeguard:** all built-in file operations are confined to the project folder —
paths that escape it (`..`, absolute paths) are rejected.

**A note on `web_search`:** with no API key, search falls back to scraping
DuckDuckGo — free but fragile (the format can change at any time, and some networks
block it). For reliable results, set a **Tavily API key** in Settings. If a search
fails, the agent gets a clear error and usually falls back to `web_fetch`.

---

## MCP servers

Tools from [MCP](https://modelcontextprotocol.io) servers appear in the agent's
tool list alongside the built-in ones. Configure them under Settings → MCP servers.

**Two transports**, chosen from the shape of the command field:

| You enter | Transport |
|---|---|
| A command, e.g. `npx` | stdio — the server runs as a child process |
| An `https://…` URL | Streamable HTTP — a remote server |

**Paste JSON.** Copy a config block from any MCP server's documentation as-is and
press Import. The `mcpServers` shape, the `servers` shape, an unwrapped map, and a
single bare server object are all accepted. A server whose name you already have is
updated rather than duplicated.

```json
{
  "mcpServers": {
    "stitch": {
      "url": "https://stitch.googleapis.com/mcp",
      "headers": { "X-Goog-Api-Key": "YOUR-KEY" }
    }
  }
}
```

Claude Code takes a separate path: because it runs its own tool loop, the server
*list* is handed to the Agent SDK, which connects to them itself. Tool names there
are `mcp__<server>__<tool>` (the SDK's convention) instead of our
`mcp_<server>_<tool>`.

---

## Permissions and safety

> Belmont Tools lets an AI agent read files, write files, run shell commands, and
> reach external services on your computer. These are real actions with real
> consequences, and an agent can be wrong.

### Permission modes

Buttons below the chat box, applying to every provider:

| Mode | Behaviour |
|---|---|
| **Supervised** | Ask before running commands and changing files |
| **Auto-accept edits** | File changes are approved automatically; shell commands still ask |
| **Full access** | Run everything without asking — except MCP tools |

The **"Always allow this tool"** button in the confirmation dialog persists across
turns and across restarts, stored per project in `approvedTools`. It applies to the
Claude Code provider too.

### Two hard rules

**MCP tools always ask before running — even in Full access mode**, unless you have
marked one "always allow". An MCP server is *another program on your computer*: the
project folder boundary does not apply to it, and a filesystem server can reach
anything its own permissions allow. When you import a JSON block containing a
`command` (rather than a `url`), the app shows you exactly what will be executed
and asks first.

**Built-in file tools cannot leave the project folder.** `..` and absolute paths
are rejected, so an agent working on one project cannot touch the one next door.

### What this is not

These controls are a **safety gate, not a sandbox**. Nothing here is virtualised or
isolated at the OS level — `run_shell` starts a real PowerShell process with your
own user's permissions. What protects you is that you are asked first. If you press
approve without reading, nothing else stops it.

Reasonable habits:

- Keep credentials out of folders you point agents at
- Read the command in the dialog before approving, especially in an unfamiliar project
- Only install MCP servers you trust
- Use a separate project folder for sensitive work
- Never assume a command is safe just because an AI wrote it

---

## Working with the agent

### Questions from the agent

The **Claude Code** provider has an `AskUserQuestion` tool — the agent uses it when
a decision is genuinely yours ("library A or B?"). The question appears as a card
inside the chat: each option becomes a button, plus an **"Or write your own
answer…"** field for when the right answer isn't listed.

The agent really does **stop and wait**. If you press **Skip**, it is told
explicitly that you did not answer and is asked to raise it again as plain text —
not to decide for itself.

The card survives switching projects: it is redrawn when you come back, and the
sidebar marks that project with an orange dot. If Telegram is on, you get a
notification that a question is waiting.

### Sending a message while the agent works

The message **queues**, and the agent keeps going. Its row appears above the input
box with two buttons:

| Button | What happens |
|---|---|
| **Send now** | Slipped into the work in progress. The agent is **not** stopped — it reads the message at the next step boundary and adjusts course. |
| `×` | Cancel that message before it is sent. |

Left alone, a queued message goes out by itself as the next turn once the current
one finishes. Your chat bubble is only drawn when the agent actually reads it, so
the conversation order stays honest.

Pressing **Stop** ends the current turn **and** clears the queue — otherwise Stop
would immediately start the next turn.

This works for every provider by two routes: Claude Code receives it in its session
input queue; other providers have it inserted into history at a step boundary — the
only safe point, because slipping it into the middle of a `tool_use`/`tool_result`
pair makes the API reject the history.

### Scrolling while the agent writes

The chat only follows along while you are actually at the bottom. The moment you
scroll up to read, it stops dragging you. A **"↓ To latest message"** button appears
above the input box to get back; sending a message also returns you to the bottom.

### Attachments

Three ways: the 🖼 button, drag-and-drop, or **paste directly (`Ctrl+V`)** —
including screenshots that were never saved to disk. Pasted images are written to a
temp file first, because the Claude Code provider takes a *path* and reads the file
itself rather than base64. Pasted files older than 7 days are cleaned up at startup.

Images (`png/jpg/gif/webp`, max 4 MB) are sent to the model as real images; text
files have their contents inlined (max 100k characters). Binary files that aren't
images are rejected with a clear message rather than sent as garbage. For Claude
Code, the file path is passed through so it can read it with the `Read` tool.

### Context indicator

After each turn the header shows `Context N% left`. Click it for the breakdown:
`Used / total`, `Fresh`, `Cache read`, `Cache write`, `Output` — the real numbers
from the `usage` the provider returned.

### Clickable options

If the agent's answer contains `- [] …` lines (or an `<options>…</options>` block),
those lines are rendered as buttons: **click = sent immediately**. Every option and
every answer also gets a **Copy** button.

---

## Projects

The left panel lists every project, newest first: title, working folder name, and
age (`new`, `12m`, `3h`, `2d`, then a date).

**Each project is pinned to one folder.** Pressing `+` opens a "choose folder"
dialog first — cancelling means no project is created. While that project is open,
the agent can only read and write inside that folder.

| Action | How |
|---|---|
| New project | `+` button → choose folder |
| Open | Click its row |
| Rename | Double-click the title, type, Enter (Esc cancels) |
| Change folder | Click the folder path in the header |
| Delete | Hover the row → `×` button (asks first) |
| Hide the panel | Chevron `⌄`; bring it back with `☰` in the header |

### Several projects can run at once

Each project has its own agent. Switching projects does **not** stop a running turn
— the project you left keeps working in the background, and the small dot next to
its name pulses while it does.

- **A background project's chat is not drawn as it goes.** Progress is saved at
  every step, so when you come back the history is complete up to the last one. If
  you arrive mid-message, the view is rebuilt once that message finishes — no answer
  is ever left cut in half.
- **Tool permission dialogs queue per project.** A request from a background project
  does not hijack your screen — the sidebar dot turns orange, and the dialog appears
  when you open that project. Its agent waits there. Over Telegram, the request
  still reaches you immediately, with the project name in front.
- **An idle project's Claude Code session is closed when you leave it**, so every
  project you have ever opened doesn't hold a CLI subprocess forever. Projects that
  are working are left alone.
- **Unsent typing sticks to its project.** Drafts and chosen attachments are saved
  when you switch, then come back as they were. (Held in memory, so lost if the app
  is closed or `Ctrl+R`'d.)
- **Telegram still targets the project on screen.** `/proyek <n>` moves that focus;
  `/status` says how many other projects are working.

Titles fill themselves in from your first message. History is stored as one JSON
file per project in `%APPDATA%/belmont-tools/sessions/`, in a neutral block format —
so old projects still open after you have changed providers.

The folder in Settings is only the starting point for the dialog when creating a new
project, not the folder the agent uses. Panel width is set by `--sidebar-width` in
`theme.css`.

---

## Telegram bridge

Optional. Lets you watch and reply to agents from your phone. Set a bot token and
chat ID under Settings → Telegram; the chat ID doubles as an allow-list, so only
that chat is served.

| Command | Purpose |
|---|---|
| `/proyek` | List and switch projects |
| `/status` | Active project, model, context left |
| `/ringkas` | Summarise to shrink the context |
| `/stop` | Stop the current turn |
| `/bantuan` | Show the commands |

---

## Customization

`src/renderer/theme.css` — every colour, radius, font, and the chat width live here
as CSS variables. Change a value, save, `Ctrl+R`. There is a light theme at the
bottom of the file that you can uncomment.

`src/renderer/app.css` — structure and layout, for when you want to change more
than colours.

The **Open theme.css** button on the Settings page reveals the file in Explorer.

---

## Project structure

```
src/
  main/
    main.js              window + IPC bridge
    preload.js           the narrow API the UI sees
    config.js            settings (userData/settings.json)
    sessions.js          save/load conversations (userData/sessions/)
    agent.js             the agent loop: model -> tool -> model
    tools.js             every tool's implementation
    mcp.js               MCP client (stdio + Streamable HTTP)
    telegram.js          Telegram API calls
    bridge.js            Telegram long-poll bridge
    claude-auth.js       Claude Code login without a terminal
    i18n.js              main-process strings
    providers/
      index.js           the provider registry (BUILTIN)
      claude-code.js     Claude Agent SDK (subscription, own loop)
      anthropic.js       Claude via API key
      openai-compat.js   factory for every OpenAI-compatible provider
  renderer/
    index.html
    theme.css            <- change the look here
    app.css
    renderer.js
    i18n.js              interface strings (English + Indonesian)
```

Settings and API keys are stored in `%APPDATA%/belmont-tools/settings.json`
**in plain text** — treat it as a secret file.

---

## License

MIT — see [LICENSE](LICENSE). Copyright (c) 2026 Agus Zaky.

You may use, modify, and redistribute this, including commercially. The only
condition is that the copyright notice and the license text travel with any copy or
substantial portion of the code.

The software comes with no warranty. It runs shell commands and edits files on your
machine on an agent's initiative — you are responsible for what it does there.
