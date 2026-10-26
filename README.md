# mermaid-render

A Claude Code mod that draws ```` ```mermaid ```` code blocks in Claude's replies as real diagrams in **Claude Code Desktop** (Code tab, local sessions).

While a diagram renders, the reply shows the original code block. If rendering fails, the code block stays and a short `mermaid: <error>` line appears under it. Other surfaces (CLI, VS Code, mobile) are left untouched. Diagrams are rendered locally; nothing is sent to an external service.

Limitation: only Claude's replies in the transcript are drawn. The desktop app's side-panel file viewer is not hookable by mods, so a `.md` file opened there still shows the code.

## Install

This repository is private: you need read access on GitHub and a git credential for github.com on your machine (an SSH key, or `gh auth login` then `gh auth setup-git`). The install never prompts for one.

### 1. Install Node.js and the Mermaid CLI

The CLI needs Node.js 18 or newer and downloads its own headless Chromium on install.

#### macOS

```bash
brew install node
```

```bash
npm i -g @mermaid-js/mermaid-cli
```

```bash
echo 'graph TD; A-->B' | mmdc -i - -o - -e svg | head -c 40
```

#### Linux

Install Node.js 18+ from your distribution or [nodejs.org](https://nodejs.org), then:

```bash
npm i -g @mermaid-js/mermaid-cli
```

```bash
echo 'graph TD; A-->B' | mmdc -i - -o - -e svg | head -c 40
```

If Chromium fails to start, install its shared libraries (Debian/Ubuntu: `sudo apt-get install -y libnss3 libatk-bridge2.0-0 libgbm1 libxkbcommon0 libasound2`). As root or in a container, write `{"args":["--no-sandbox"]}` to a file such as `~/.config/mermaid-puppeteer.json` and set the mod's `puppeteerConfig` option to its path (step 3).

If `npm i -g` needs `sudo`, set a user prefix instead (`npm config set prefix ~/.local`, with `~/.local/bin` on `PATH`) so the mod can find `mmdc`.

#### Windows (PowerShell)

```powershell
winget install OpenJS.NodeJS.LTS
```

Open a new terminal so `node` and `npm` are on `PATH`, then:

```powershell
npm i -g @mermaid-js/mermaid-cli
```

```powershell
'graph TD; A-->B' | Set-Content $env:TEMP\m.mmd; mmdc -i $env:TEMP\m.mmd -o $env:TEMP\m.svg; Get-Content $env:TEMP\m.svg -TotalCount 1
```

If PowerShell refuses to run `mmdc.ps1` (execution policy), use `mmdc.cmd` in the check; the mod itself is not affected.

Every OS should print the start of an `<svg ...` element.

### 2. Install the mod

At the prompt of a terminal `claude` session:

```
/plugin install mermaid-render --marketplace avallete/claude-mermaid-render
```

Answer `y` to add the marketplace, then pick the **user** scope so it also loads in Claude Desktop's local Code-tab sessions.

From a shell:

```bash
claude plugin install mermaid-render --marketplace avallete/claude-mermaid-render
```

In the desktop app (where `/plugin` does not run): click **+** next to the prompt box, then **Plugins**, **Add marketplace** with `avallete/claude-mermaid-render`, then **Add plugin**.

### 3. Renderer (usually nothing to do)

Works on macOS, Linux and Windows. With the **Renderer command** option empty (the default), the mod looks for the `mmdc` installed in step 1 on `PATH` and runs its script with Node directly, with no shell, so npm's `.cmd` launchers on Windows and version-manager shims (mise, asdf, nvm) don't get in the way. If no global `mmdc` is found it falls back to `npx -y -p @mermaid-js/mermaid-cli@11 mmdc`, which is slow on every diagram.

To force a command, set `command` (`/config` → mermaid-render, or `pluginConfigs` in `~/.claude/settings.json`, `%USERPROFILE%\.claude\settings.json` on Windows). Quote paths with spaces. macOS/Linux:

```json
"pluginConfigs": {
  "mermaid-render@claude-mermaid-render": {
    "options": { "command": "/usr/local/bin/node /usr/local/lib/node_modules/@mermaid-js/mermaid-cli/src/cli.js" }
  }
}
```

Windows:

```json
"pluginConfigs": {
  "mermaid-render@claude-mermaid-render": {
    "options": { "command": "\"C:\\Program Files\\nodejs\\node.exe\" C:\\Users\\me\\AppData\\Roaming\\npm\\node_modules\\@mermaid-js\\mermaid-cli\\src\\cli.js" }
  }
}
```

Options: `command`, `theme` (`default`, `dark`, `neutral`, `forest`), and `puppeteerConfig`, an optional file passed to `mmdc -p`. On Linux as root, or in a container, Chromium needs a config such as `{"args":["--no-sandbox"]}`; on minimal Linux images install Chromium's shared libraries (see Puppeteer's troubleshooting guide).

### 4. Check

Start a new Desktop Code-tab session and ask: *"Reply with a mermaid flowchart of a login flow."* The code block turns into a diagram after a second or two.

## For agents installing this

1. Run `npm i -g @mermaid-js/mermaid-cli` and the check in step 1 (on Linux as root, write a Puppeteer config with `--no-sandbox` and set `puppeteerConfig` to its path).
2. Run `claude plugin install mermaid-render --marketplace avallete/claude-mermaid-render`, user scope.
3. Leave `command` empty unless the check in step 4 fails; then set it to `"<absolute node path>" "<npm root -g>/@mermaid-js/mermaid-cli/src/cli.js"` in `pluginConfigs["mermaid-render@claude-mermaid-render"].options` of `~/.claude/settings.json` (`%USERPROFILE%\.claude\settings.json` on Windows), merging with what is there.
4. Tell the user to start a new Desktop session and ask for a mermaid diagram.

If no diagram appears, run `claude --debug` and search the log for `mermaid-render`.

## Develop

```bash
claude plugin validate .
claude plugin test .
claude --plugin-dir .
```
