import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Rendered } from '../types'

const diagrams = atom(
  { plugin: 'mermaid-render', key: 'diagrams' } as const,
  {} as Record<string, Rendered>,
)

type Part = { kind: 'text'; text: string } | { kind: 'mermaid'; source: string }

const FENCE = /^(```|~~~)[ \t]*mermaid[ \t]*\n([\s\S]*?)\n\1[ \t]*$/gm

// Splits markdown into plain runs and closed ```mermaid fences. An unclosed
// fence (still streaming) stays in the text and is drawn as code.
export function split(markdown: string): Part[] {
  const parts: Part[] = []
  let last = 0
  for (const m of markdown.matchAll(FENCE)) {
    const before = markdown.slice(last, m.index)
    if (before.trim()) parts.push({ kind: 'text', text: before })
    parts.push({ kind: 'mermaid', source: m[2] ?? '' })
    last = m.index + m[0].length
  }
  const rest = markdown.slice(last)
  if (rest.trim()) parts.push({ kind: 'text', text: rest })
  return parts
}

// Finds a global @mermaid-js/mermaid-cli by the `mmdc` launcher on PATH and
// prints `node`'s own path plus the CLI script, so the renderer starts without
// a shell: npm's `.cmd` launchers on Windows and version-manager shims can't.
const LOCATE = `
const fs = require('fs'), path = require('path')
const win = process.platform === 'win32'
const tail = path.join('node_modules', '@mermaid-js', 'mermaid-cli', 'src', 'cli.js')
for (const dir of (process.env.PATH || '').split(path.delimiter)) {
  if (!dir) continue
  for (const name of win ? ['mmdc.cmd', 'mmdc'] : ['mmdc']) {
    const bin = path.join(dir, name)
    if (!fs.existsSync(bin)) continue
    const real = fs.realpathSync(bin)
    const cli = real.endsWith('cli.js') ? real
      : [path.join(dir, tail), path.join(dir, '..', 'lib', tail)].find(f => fs.existsSync(f))
    if (cli) { process.stdout.write(JSON.stringify([process.execPath, cli])); process.exit(0) }
  }
}
`

// Commands run from the filesystem root, not the session's folder: Windows looks
// up a bare `node`/`npx` in the working directory first, so a cloned repo could
// plant one, and version managers would pick the project's pinned Node.
const CWD = '/'

async function locate($: EngineInterface): Promise<string[] | undefined> {
  try {
    const out = await $.process.run(['node', '-e', LOCATE], { cwd: CWD, timeoutMs: 15_000 })
    if (out.exitCode === 0 && out.stdout.startsWith('[')) return JSON.parse(out.stdout)
  } catch {}
  return undefined
}

// Without a shell Windows can't start `npx`/`mmdc` (they are `.cmd` files);
// cmd.exe can. On other systems cmd.exe doesn't exist and the first error stands.
async function run($: EngineInterface, argv: string[], stdin: string) {
  const init = { cwd: CWD, stdin, timeoutMs: 120_000 }
  try {
    return await $.process.run(argv, init)
  } catch (err) {
    try {
      return await $.process.run(['C:\\Windows\\System32\\cmd.exe', '/d', '/s', '/c', ...argv], init)
    } catch {
      throw err
    }
  }
}

const NPX = ['npx', '-y', '-p', '@mermaid-js/mermaid-cli@11', 'mmdc']

type Config = {
  command: Promise<string[]> | undefined
  theme: string
  puppeteerConfig: string
  pending: Set<string>
}

async function render($: EngineInterface, cfg: Config, key: string, source: string) {
  const { theme, puppeteerConfig, pending } = cfg
  if (pending.has(key)) return
  pending.add(key)
  let result: Rendered
  try {
    cfg.command ??= locate($).then(found => found ?? NPX)
    const argv = [
      ...(await cfg.command),
      '-i', '-', '-o', '-', '-e', 'svg',
      '-t', theme, '-b', 'transparent',
      ...(puppeteerConfig ? ['-p', puppeteerConfig] : []),
    ]
    const out = await run($, argv, source)
    const svg = out.stdout.slice(out.stdout.indexOf('<svg'))
    if (out.exitCode !== 0 || !svg.startsWith('<svg')) {
      result = { error: (out.stderr || out.stdout).trim().split('\n').slice(-3).join('\n') || `exit ${out.exitCode}` }
    } else if (svg.length > 131_072) {
      result = { error: 'diagram too large to draw inline' }
    } else {
      result = { svg }
    }
  } catch (err) {
    result = { error: err instanceof Error ? err.message : String(err) }
  }
  pending.delete(key)
  await update($, diagrams, all => ({ ...all, [key]: result }))
}

export const register: Register = (on, options) => {
  const theme = String(options.theme ?? 'default')
  const custom = String(options.command ?? '').trim()
  // Double quotes keep a path with spaces in one argument (C:\Program Files\...).
  const words = [...custom.matchAll(/"([^"]*)"|(\S+)/g)].map(m => m[1] ?? m[2] ?? '')
  const command = words.length ? Promise.resolve(words) : undefined
  const puppeteerConfig = String(options.puppeteerConfig ?? '')
  const cfg: Config = { command, theme, puppeteerConfig, pending: new Set() }

  on('ui.render', { component: 'AssistantMessage' }, async ($, e, next) => {
    if (e.surface !== 'desktop' || e.props.isSummary) return next(e)

    const parts = split(e.props.text)
    if (!parts.some(p => p.kind === 'mermaid')) return next(e)

    const { Box, Markdown, Svg, Text } = $.ui.resolve(e)
    const cache = await read($, diagrams)

    return (
      <Box flexDirection="column">
        {parts.map((part, i) => {
          if (part.kind === 'text') return <Markdown key={`t${i}`} text={part.text} />
          const fenced = '```mermaid\n' + part.source + '\n```'
          const key = `${theme}\n${part.source}`
          const done = cache[key]
          if (!done) {
            void render($, cfg, key, part.source)
            return <Markdown key={`m${i}`} text={fenced} />
          }
          if ('error' in done) {
            return (
              <Box key={`e${i}`} flexDirection="column">
                <Markdown key={`m${i}`} text={fenced} />
                <Text dimColor>mermaid: {done.error}</Text>
              </Box>
            )
          }
          return (
            <Svg
              source={done.svg}
              alt={`Mermaid diagram:\n${part.source}`}
              isInteractive
            />
          )
        })}
      </Box>
    )
  })
}
