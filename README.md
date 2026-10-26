# mermaid-render

A Claude Code mod that draws ```` ```mermaid ```` code blocks in Claude's replies as real diagrams in **Claude Code Desktop** (Code tab, local sessions).

While a diagram renders, the reply shows the original code block. If rendering fails, the code block stays and a short `mermaid: <error>` line appears under it. Other surfaces (CLI, VS Code, mobile) are left untouched. Diagrams are rendered locally; nothing is sent to an external service.

Limitation: only Claude's replies in the transcript are drawn. The desktop app's side-panel file viewer is not hookable by mods, so a `.md` file opened there still shows the code.

## Install

This repository is private: you need read access on GitHub and a git credential for github.com on your machine (an SSH key, or `gh auth login` then `gh auth setup-git`). The install never prompts for one.

### 1. Install the Mermaid CLI

```bash
npm i -g @mermaid-js/mermaid-cli
```

Check it renders (it downloads a headless Chromium on first install):

```bash
echo 'graph TD; A-->B' | mmdc -i - -o - -e svg | head -c 40
```

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

### 3. Point it at the renderer

Without configuration the mod runs `npx -y -p @mermaid-js/mermaid-cli@11 mmdc` for every diagram, which is slow. Set the **Renderer command** option (`/config` → mermaid-render, or `pluginConfigs` in `~/.claude/settings.json`) to an absolute command:

```json
"pluginConfigs": {
  "mermaid-render@claude-mermaid-render": {
    "options": {
      "command": "/opt/homebrew/bin/node /opt/homebrew/lib/node_modules/@mermaid-js/mermaid-cli/src/cli.js",
      "theme": "default"
    }
  }
}
```

Use absolute paths (`which node`, `npm root -g`). A bare `mmdc` starts Node through `#!/usr/bin/env node`; with a version manager (mise, asdf, nvm) on `PATH` its shim can pick a missing Node version for the session's folder and fail.

Options: `command`, `theme` (`default`, `dark`, `neutral`, `forest`), and `puppeteerConfig`, an optional file passed to `mmdc -p` (for example `{"args":["--no-sandbox"]}` on Linux as root).

### 4. Check

Start a new Desktop Code-tab session and ask: *"Reply with a mermaid flowchart of a login flow."* The code block turns into a diagram after a second or two.

## For agents installing this

1. Run `npm i -g @mermaid-js/mermaid-cli` and the check in step 1.
2. Run `claude plugin install mermaid-render --marketplace avallete/claude-mermaid-render`.
3. Resolve `$(which node)` and `$(npm root -g)/@mermaid-js/mermaid-cli/src/cli.js`, and write them as `"<node> <cli.js>"` into `pluginConfigs["mermaid-render@claude-mermaid-render"].options.command` in `~/.claude/settings.json`, merging with what is there.
4. Tell the user to start a new session.

If no diagram appears, run `claude --debug` and search the log for `mermaid-render`.

## Develop

```bash
claude plugin validate .
claude plugin test .
claude --plugin-dir .
```
