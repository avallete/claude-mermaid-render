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

// Finds merman-cli (a native binary) and global npm packages by their launcher
// on PATH, and prints `node`'s own path plus each package's script, so they
// start without a shell: npm's `.cmd` launchers on Windows and version-manager
// shims can't.
const LOCATE = `
const fs = require('fs'), path = require('path')
const win = process.platform === 'win32'
const find = (name, script) => {
  const tail = path.join('node_modules', ...script)
  for (const dir of (process.env.PATH || '').split(path.delimiter)) {
    if (!dir) continue
    for (const bin of win ? [name + '.cmd', name] : [name]) {
      const file = path.join(dir, bin)
      if (!fs.existsSync(file)) continue
      const real = fs.realpathSync(file)
      const hit = real.endsWith(script[script.length - 1]) ? real
        : [path.join(dir, tail), path.join(dir, '..', 'lib', tail)].find(f => fs.existsSync(f))
      if (hit) return hit
    }
  }
}
const findBin = name => {
  for (const dir of (process.env.PATH || '').split(path.delimiter)) {
    const file = dir && path.join(dir, win ? name + '.exe' : name)
    if (file && fs.existsSync(file)) return file
  }
}
// Mermaid styles labels in Trebuchet MS. merman-cli's built-in metrics measure
// it ~10% narrow, so browsers clip labels; the real font files fix the widths.
const fontDirs = win ? [path.join(process.env.WINDIR || 'C:' + path.sep + 'Windows', 'Fonts')]
  : ['/System/Library/Fonts/Supplemental', '/Library/Fonts', '/usr/share/fonts/truetype/msttcorefonts']
const fonts = fontDirs.flatMap(dir => ['Trebuchet MS.ttf', 'Trebuchet MS Bold.ttf', 'trebuc.ttf', 'trebucbd.ttf']
  .map(f => path.join(dir, f))).filter(f => fs.existsSync(f))
process.stdout.write(JSON.stringify({
  node: process.execPath,
  merman: findBin('merman-cli'),
  fonts,
  mmdc: find('mmdc', ['@mermaid-js', 'mermaid-cli', 'src', 'cli.js']),
  svgo: find('svgo', ['svgo', 'bin', 'svgo.js']),
}))
`

type Found = { node?: string; merman?: string; fonts?: string[]; mmdc?: string; svgo?: string }

// Commands run from the filesystem root, not the session's folder: Windows looks
// up a bare `node`/`npx` in the working directory first, so a cloned repo could
// plant one, and version managers would pick the project's pinned Node.
const CWD = '/'

async function locate($: EngineInterface): Promise<Found> {
  try {
    const out = await $.process.run(['node', '-e', LOCATE], { cwd: CWD, timeoutMs: 15_000 })
    if (out.exitCode === 0 && out.stdout.startsWith('{')) return JSON.parse(out.stdout)
  } catch {}
  return {}
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

// Mermaid writes coordinates to ~15 decimals and strokes every outline twice;
// svgo at one decimal cuts a typical flowchart ~4x with no visible change.
// Optional: without a global svgo, or if it fails, the raw SVG is kept.
async function optimize($: EngineInterface, found: Found, svg: string) {
  if (!found.node || !found.svgo) return svg
  try {
    const out = await $.process.run(
      [found.node, found.svgo, '-i', '-', '-o', '-', '--precision', '1', '--multipass'],
      { cwd: CWD, stdin: svg, timeoutMs: 30_000 },
    )
    const small = out.stdout.slice(out.stdout.indexOf('<svg'))
    return out.exitCode === 0 && small.startsWith('<svg') ? small : svg
  } catch {
    return svg
  }
}

const NPX = ['npx', '-y', '-p', '@mermaid-js/mermaid-cli@11', 'mmdc']

type Config = {
  custom: string[]
  found: Promise<Found> | undefined
  theme: string
  puppeteerConfig: string
  pending: Set<string>
}

async function render($: EngineInterface, cfg: Config, key: string, source: string) {
  const { custom, theme, puppeteerConfig, pending } = cfg
  if (pending.has(key)) return
  pending.add(key)
  let result: Rendered
  try {
    const found = await (cfg.found ??= locate($))
    // merman-cli renders natively in ~10 ms and takes mmdc's flags; mmdc
    // starts a headless Chromium for every diagram.
    const command = custom.length ? custom
      : found.merman ? [found.merman, 'mmdc', ...(found.fonts ?? []).flatMap(f => ['--font-file', f])]
      : found.node && found.mmdc ? [found.node, found.mmdc] : NPX
    const argv = [
      ...command,
      '-i', '-', '-o', '-', '-e', 'svg',
      '-t', theme, '-b', 'transparent',
      ...(puppeteerConfig ? ['-p', puppeteerConfig] : []),
    ]
    const out = await run($, argv, source)
    const raw = out.stdout.slice(out.stdout.indexOf('<svg'))
    if (out.exitCode !== 0 || !raw.startsWith('<svg')) {
      result = { error: (out.stderr || out.stdout).trim().split('\n').slice(-3).join('\n') || `exit ${out.exitCode}` }
    } else {
      const svg = await optimize($, found, raw)
      result = svg.length > 131_072 ? { error: 'diagram too large to draw inline' } : { svg }
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
  const puppeteerConfig = String(options.puppeteerConfig ?? '')
  const cfg: Config = { custom: words, found: undefined, theme, puppeteerConfig, pending: new Set() }

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
