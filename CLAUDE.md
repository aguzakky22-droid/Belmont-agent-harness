# Belmont Tools

An Electron desktop app for running AI agents. Supports Claude Code
(subscription), ONToken.id, Claude (Anthropic API), OpenAI, Gemini, DeepSeek,
Kimi, and GLM.

## Hard rules

### Never run the app

**No `npm start`, no `npm run dev`, no `electron .`.**

The user is chatting with an agent inside this very app — including a session
that may be live while you work. Launching the app kills that session and the
conversation stops mid-sentence.

Verify with `node --check <file>` and by reading the code. No exceptions, not
even "just for a second to make sure".

### Ask before building the `.exe`

After changing code, **do not build straight away**. Report how many files
changed and ask whether to rebuild — the user decides.

Reason: `npm run build` takes several minutes and produces ~149 MB every time,
while the `.exe` is usually only needed once a few fixes have accumulated and it
is time to move them to another PC.

`npm run build` itself is safe to run — electron-builder only packages, it does
not launch the app. It produces two files in `dist/`:

- `Belmont Tools Setup <version>.exe` — NSIS installer
- `Belmont Tools <version> portable.exe` — portable

To inspect what actually ends up inside a build without producing an installer,
use `npx electron-builder --win --dir` and look under
`dist/win-unpacked/resources/app/`. Much faster, and it skips NSIS entirely.

#### The first build often fails — just retry, don't go hunting

Happened on 0.4.1 and 0.4.2 with exactly the same error:

```
⨯ makensis.exe process failed ERR_ELECTRON_BUILDER_CANNOT_EXECUTE
Error output:
Can't open output file
Error - aborting creation process
```

The `.7z` stage completes (~149 MB) and only the final NSIS step fails to write
the Setup. Most plausible cause: antivirus holding a lock on the freshly written
`.exe`. **Not** the app being open — a live Electron process does not block this
step.

What works, two times out of two:

```powershell
Get-ChildItem dist -File -Filter "*<version>*" | Remove-Item -Force
Remove-Item "dist\__uninstaller-nsis-belmont-tools.exe" -Force -ErrorAction SilentlyContinue
Get-ChildItem dist -File -Filter "*.7z" | Remove-Item -Force
npm run build
```

Half-written leftovers have to go first; retrying without cleaning is not
enough. Treat the first failure as routine.

The same flakiness shows up on `git push` and `gh` commands
(`Could not resolve host`, `error connecting to api.github.com`) on a perfectly
healthy network — all of them passed on retry. Wrap network commands in a retry
rather than diagnosing configuration.

## Things worth knowing

### User data lives outside the project folder

```
C:\Users\<name>\AppData\Roaming\belmont-tools\
   ├─ sessions\<id>.json   chat history (neutral block format, not a provider's)
   └─ settings.json        API keys, model, theme, windowBounds
```

The folder is named `belmont-tools` (from `name` in package.json), **not**
`Belmont Tools` — `productName` sits inside the `build` block, which only
electron-builder reads, never Electron. So `npm start`, the portable build, and
the installed build all share one folder.

Overwriting the code or reinstalling the app does not wipe this data.

### What a code change requires

| Changed | How it reloads |
|---|---|
| `src/renderer/**` | `Ctrl+R` in the app |
| `src/main/**` (including `preload.js`) | the app must be closed and reopened **by the user** |

There is no bundler — files are loaded as they are.

`preload.js` is the trap that catches people most often: it does **not** reload
with `Ctrl+R`. If a new feature adds a bridge there, say that a full restart is
required, and guard it in the renderer:

```js
if (!window.api.newFunction) { /* show "restart first", don't hang */ }
```

Without that, an `await` on a function that does not exist yet never settles and
the UI sits there with no visible cause.

### Claude Code needs no separate install

`@anthropic-ai/claude-agent-sdk` brings its own binary as a per-platform
optionalDependency:

```
node_modules/@anthropic-ai/claude-agent-sdk-win32-x64/claude.exe   ~207 MB
```

`claude` is **not on PATH** on this machine, and does not need to be. Login
credentials live in `~/.claude/.credentials.json`, written by that binary.

That binary **is** bundled into the installer. The 149 MB installer already
contains it — NSIS compresses it well, so the packaged size does not reflect the
207 MB on disk. Before assuming otherwise, verify with `--dir` and a *recursive*
search for `claude.exe`: in a build it lands under the nested
`claude-agent-sdk/node_modules/@anthropic-ai/...` path, not the hoisted one that
`node_modules` uses. Checking only the hoisted path reports a false absence.

`kandidatExe()` in `src/main/claude-auth.js` searches beyond the bundle as well —
`~/.local/bin` and every `PATH` entry — so a separately installed Claude Code is
found too. That is a fallback, not the primary path.

Useful command: `claude auth status` returns clean JSON in ~0.3 s.

### i18n: two separate dictionaries

| File | For | Contents |
|---|---|---|
| `src/renderer/i18n.js` | the interface | global `t()` + `terapkanBahasa()` |
| `src/main/i18n.js` | the main process | `t()` that reads `config.load().language` on every call |

In HTML use `data-i18n`, `data-i18n-html`, `data-i18n-title`, `data-i18n-ph`.

**What must NOT be translated:** tool descriptions, tool results, and the system
prompt scaffolding in `agent.js`. Those are part of the prompt, not the
interface — translating them through a UI setting changes what the model reads
and invalidates the prompt cache. The reasoning is written at the head of
`src/main/i18n.js`.

**Text written to disk does not follow the language setting.** Session titles got
caught by this once: the literal string ("Percakapan baru") was written into the
session file at creation, making it permanently immune to the language setting.
The pattern now is to store an **empty string** as the "not filled in yet"
marker and translate at render time — `judulSesi()` exists in `sessions.js` (for
Telegram) and in `renderer.js` (for the window). Both hold a `JUDUL_BAWAAN_LAMA`
list so old sessions are rescued too; if one changes, change both.

When adding default text that gets persisted, ask first: will this still be
correct after the user switches language?

### MCP servers are third-party code

`src/main/mcp.js` runs MCP servers as child processes and offers their tools to
the model alongside the built-in ones. Two things must hold:

- **`safePath()` does not apply to them.** The working-folder sandbox belongs to
  `tools.js`; an MCP server is a different program with its own permissions.
  That is why every MCP tool is forced to `needsApproval: true` in `mcp.tool()` —
  do not relax this, not even for the `acceptEdits` permission mode.
- **`mcp.siapkan()` must not throw.** A dead server only means its tools are
  absent; the agent's turn still has to run with the built-in tools.

Two transports, chosen from the shape of `command`: an `https://…` URL means
Streamable HTTP, anything else is stdio. An HTTP server may answer the same
request with `application/json` **or** `text/event-stream`, so both have to be
handled — see `dariSse()`.

On Windows, stdio servers are spawned with `shell: true` because `npx` is really
`npx.cmd`, and since Node 18.20/20.12 a `.cmd` file cannot be spawned directly
(CVE-2024-27980). The consequence is that arguments must be quoted by hand —
Node only joins argv with spaces when `shell: true`. See `kutip()`.

The `claude-code` provider is `selfDriving` and never goes through
`executeTool()`, so it does **not** use our MCP client. The server list is handed
to the Agent SDK through the `mcpServers` option (`mcp.untukAgentSdk()`) and the
SDK connects to them itself. Consequences:

- **The same server can be alive twice** — one instance owned by `mcp.js` (for
  the other providers), one owned by the SDK. Deliberate; their lifecycles
  differ.
- **Tool names are `mcp__<server>__<tool>`** (double underscore, the SDK's
  convention), not our `mcp_<server>_<tool>`. The two never meet in one
  conversation.
- **Approval goes through `canUseTool`**, not `shouldAsk()`. Both places must
  enforce the same rule: MCP tools always ask, even in `full` permission mode,
  unless already marked "always allow". If one changes, change both.
- `settingSources` stays `[]`, so the server list comes ONLY from our config,
  never from the user's `~/.claude`.

### Short global names collide easily

Five collisions in a single day, every one of them a silent bug:

- `t` as a local variable shadowing the translation function → `t is not a
  function`. Already happened in `ringkasanBagian()`, `finishThinking()`,
  `bridge.start()`, and `laporkanGiliran()`. **Never name a variable `t`.**
- The CSS class `.group-head` was used by both the sidebar and the tool-card
  groups → tool group titles shrank and turned UPPERCASE. The sidebar now uses
  the `.folder-*` prefix.

Before using a short name, check whether it is already taken.

### Control characters are written as escapes, never literally

`markdownToHtml()` uses NUL to delimit code-block markers — the right choice,
since NUL cannot appear in a model's answer. But it was once written as a literal
NUL byte, and that made every command-line tool treat `renderer.js` as a **binary
file**: searching the largest file in this project stopped at `binary file
matches` instead of showing the line.

It is now written `\u0000`. The runtime value is identical. If another control
character is needed, write its escape — never the character itself.

### Never edit source files through PowerShell

`Set-Content`/`Out-File` in PowerShell 5.1 corrupt this project's encoding.

Why: source files here are UTF-8 **without BOM**, while `Get-Content` without
`-Encoding` reads them as Windows-1252. Every em dash (`—`) and ellipsis (`…`) in
a comment becomes `â€"`, and gets written back that way. It happened once: 35
corruptions in `main.js`, 91 in `renderer.js` — from a single innocuous-looking
`.Replace()`.

Use the **Edit** tool for every file change, even when that means several
separate calls. PowerShell is only for things that are not editing:
`node --check`, `npm run build`, `Get-ChildItem`, `Remove-Item`.

If it does get corrupted, the recovery is to read as UTF-8 and write back as 1252
bytes — that restores the original bytes.

```powershell
$s = [System.IO.File]::ReadAllText($full, [System.Text.Encoding]::UTF8)
[System.IO.File]::WriteAllBytes($full, [System.Text.Encoding]::GetEncoding(1252).GetBytes($s))
```

Detection is quick: search the file for `â€`.

Multi-line strings handed to native commands hit the same class of problem. For
commit messages, write the message to a temp file and use `git commit -F <file>`.
A PowerShell here-string chained after `;` gets torn into separate arguments
(`error: pathspec 'oleh' did not match any file(s)`).

### Environment

- PowerShell 5.1: `&&` and `||` do not exist. Use `;` or `if ($?) { }`.
- Git and the `gh` CLI are both installed and authenticated.
- The repository is public. Assume anything committed here is readable by
  anyone, including commit metadata.

## Language

The project's house style is deliberately split, because different text has
different readers.

| Text | Language |
|---|---|
| Code comments | **Indonesian** |
| Commit messages | **English** |
| README, LICENSE, release notes, repo description and topics | **English** |
| Replies to the user in chat | **Indonesian** |
| Text the **model** reads | **English** |

Code comments stay Indonesian: the maintainer is Indonesian, the existing
comments are good, and translating them risks damaging the explanations that
carry the most value. Comments explain **why**, not what the code already says.

Everything with a public audience is English, because the repository is public.
That includes commit messages — they sit on the front page next to an English
README, and they are the first thing a visitor reads.

Commits made before this rule are Indonesian and are being left alone.
Rewriting them would change every hash, and an open pull request is now based on
this history.

The model-facing exception covers `systemPrompt` in `config.js` and
`FORMAT_GUIDANCE`, `SUGGESTION_FORMAT`, and `COMPACT_REQUEST` in `agent.js`. The
default interface language is `en`; the user opts into Indonesian in Settings.
