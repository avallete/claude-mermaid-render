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
// Run through svgo's API (the global package beside its launcher) rather than
// its CLI, which takes no inline config: convertShapeToPath must stay off, as
// Mermaid fills shapes through CSS such as `.node rect`, and a rect turned into
// a path loses its fill and draws black.
// merman's resvg-safe text labels repeat every default in each label's style
// and keep invisible stand-in boxes; slimTextLabels drops them (~30% smaller).
// Optional: without a global svgo, or if it fails, the raw SVG is kept.
const SVGO = `
const fs = require('fs'), path = require('path')
const root = path.join(path.dirname(process.argv[1]), '..')
const lib = ['dist/svgo-node.cjs', 'lib/svgo-node.js'].map(f => path.join(root, f)).find(f => fs.existsSync(f))
const { optimize } = require(lib)
const DEFAULTS = /^(opacity:1|fill-opacity:1|stroke:none|display:inline|visibility:inherit|clip-path:none|mask:none|filter:none|transform:none|font-weight:normal|font-style:normal|white-space:pre|text-anchor:middle|dominant-baseline:central|alignment-baseline:central|line-height:[\\d.]+px)$/
const slimText = { name: 'slimTextLabels', fn: () => ({ element: { enter: (node, parent) => {
  for (const k of Object.keys(node.attributes)) if (k.startsWith('data-merman') || k === 'xml:space') delete node.attributes[k]
  if (node.attributes.class === 'merman-foreignobject-fallback-text') delete node.attributes.class
  const style = node.attributes.style
  if (style == null) return
  const kept = style.split(';').map(d => d.trim()).filter(d => d && !DEFAULTS.test(d.replace(/\\s+/g, '')))
  if (kept.length) node.attributes.style = kept.join(';'); else delete node.attributes.style
  if (node.name === 'rect' && /opacity:\\s*0(;|$)/.test(style) && /fill:\\s*none/.test(style)) parent.children = parent.children.filter(c => c !== node)
} } }) }
process.stdout.write(optimize(fs.readFileSync(0, 'utf8'), {
  multipass: true,
  floatPrecision: 1,
  plugins: [slimText, { name: 'preset-default', params: { overrides: { convertShapeToPath: false } } }],
}).data)
`

async function optimize($: EngineInterface, found: Found, svg: string) {
  if (!found.node || !found.svgo) return svg
  try {
    const out = await $.process.run(
      [found.node, '-e', SVGO, found.svgo],
      { cwd: CWD, stdin: svg, timeoutMs: 30_000 },
    )
    const small = out.stdout.slice(out.stdout.indexOf('<svg'))
    return out.exitCode === 0 && small.startsWith('<svg') ? small : svg
  } catch {
    return svg
  }
}

// Mermaid's root is width="100%" with a CSS max-width, which leaves the Svg
// element no size of its own; it is drawn small. Size it from the viewBox,
// scaled down to fit the transcript column. Desktop drops HTML labels
// (foreignObject) from a sized Svg, so those diagrams keep the default; merman
// is run with resvg-safe, which writes plain SVG text.
const MAX_WIDTH = 720
export function size(svg: string): { width?: number; height?: number } {
  if (svg.includes('<foreignObject')) return {}
  const root = svg.slice(0, svg.indexOf('>') + 1)
  const box = root.match(/viewBox="[-\d.]+[ ,]+[-\d.]+[ ,]+([\d.]+)[ ,]+([\d.]+)"/)
  const w = Number(box?.[1]), h = Number(box?.[2])
  if (!(w > 0 && h > 0)) return {}
  const k = Math.min(1, MAX_WIDTH / w)
  return { width: Math.round(w * k), height: Math.round(h * k) }
}

// Desktop draws no zoom of its own for a plugin's Svg, and a Link opens only
// https. The page that pans and zooms is written into the session folder,
// which a relative Markdown link opens in Desktop's side panel (as source
// first: the panel's View mode runs it), and into a temp folder for the
// default browser. Prints the file written; "open" also opens it.
const VIEWER = `
const fs = require('fs'), os = require('os'), path = require('path'), crypto = require('crypto')
const { spawn } = require('child_process')
const [target, mode] = process.argv.slice(1)
const svg = fs.readFileSync(0, 'utf8')
const dir = target || path.join(os.tmpdir(), 'mermaid-render')
fs.mkdirSync(dir, { recursive: true })
const ignore = path.join(dir, '.gitignore')
if (!fs.existsSync(ignore)) fs.writeFileSync(ignore, '*\\n')
const file = path.join(dir, crypto.createHash('sha1').update(svg).digest('hex').slice(0, 16) + '.html')
fs.writeFileSync(file, \`<!doctype html><meta charset="utf-8"><title>Mermaid diagram</title>
<style>html,body{margin:0;height:100%;overflow:hidden;user-select:none;background:#fff;font:13px system-ui,sans-serif}
#c{position:absolute;left:0;top:0;transform-origin:0 0;cursor:grab}#c.drag{cursor:grabbing}
#h{position:fixed;right:12px;bottom:12px;color:#666;background:#fffd;padding:4px 8px;border-radius:6px;border:1px solid #ddd}</style>
<div id="c">\${svg}</div><div id="h">scroll or pinch to zoom · drag to pan · double-click to fit</div>
<script>
const c = document.getElementById('c'), s = c.querySelector('svg'), vb = s.viewBox.baseVal
s.setAttribute('width', vb.width); s.setAttribute('height', vb.height); s.style.maxWidth = 'none'
let k = 1, x = 0, y = 0
const draw = () => { c.style.transform = 'translate(' + x + 'px,' + y + 'px) scale(' + k + ')' }
const fit = () => { k = Math.min(innerWidth / vb.width, innerHeight / vb.height) * 0.95; x = (innerWidth - vb.width * k) / 2; y = (innerHeight - vb.height * k) / 2; draw() }
const zoom = (f, px, py) => { const n = Math.min(40, Math.max(0.05, k * f)); x = px - (px - x) * n / k; y = py - (py - y) * n / k; k = n; draw() }
addEventListener('wheel', e => { e.preventDefault(); zoom(Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0015)), e.clientX, e.clientY) }, { passive: false })
let p = null
c.addEventListener('pointerdown', e => { p = [e.clientX - x, e.clientY - y]; c.classList.add('drag'); c.setPointerCapture(e.pointerId) })
c.addEventListener('pointermove', e => { if (p) { x = e.clientX - p[0]; y = e.clientY - p[1]; draw() } })
c.addEventListener('pointerup', () => { p = null; c.classList.remove('drag') })
addEventListener('dblclick', fit); addEventListener('resize', fit)
addEventListener('keydown', e => { if (e.key === '+' || e.key === '=') zoom(1.25, innerWidth / 2, innerHeight / 2); if (e.key === '-') zoom(0.8, innerWidth / 2, innerHeight / 2); if (e.key === '0') fit() })
fit()
</script>\`)
process.stdout.write(file)
if (mode === 'open') {
  const [cmd, ...args] = process.platform === 'darwin' ? ['open', file]
    : process.platform === 'win32' ? ['cmd.exe', '/d', '/c', 'start', '""', file] : ['xdg-open', file]
  spawn(cmd, args, { detached: true, stdio: 'ignore' }).unref()
}
`

async function openFull($: EngineInterface, cfg: Config, svg: string) {
  const found = await (cfg.found ??= locate($))
  if (!found.node) return
  await $.process.run([found.node, '-e', VIEWER, '', 'open'], { cwd: CWD, stdin: svg, timeoutMs: 15_000 })
}

const PAGES = '.mermaid-render'

// Returns the page's path relative to the session folder, for a Markdown link.
async function writePage($: EngineInterface, found: Found, svg: string) {
  if (!found.node) return undefined
  try {
    const cwd = await $.session.cwd()
    const sep = cwd.includes('\\') && !cwd.includes('/') ? '\\' : '/'
    const out = await $.process.run([found.node, '-e', VIEWER, cwd + sep + PAGES], { cwd: CWD, stdin: svg, timeoutMs: 15_000 })
    const name = out.stdout.trim().split(/[\\/]/).pop()
    return out.exitCode === 0 && name ? `${PAGES}/${name}` : undefined
  } catch {
    return undefined
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
      : found.merman ? [found.merman, 'mmdc', '--svg-pipeline', 'resvg-safe', ...(found.fonts ?? []).flatMap(f => ['--font-file', f])]
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
      result = svg.length > 131_072 ? { error: 'diagram too large to draw inline' }
        : { svg, page: await writePage($, found, svg) }
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

    const { Box, Button, Markdown, Svg, Text } = $.ui.resolve(e)
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
            <Box key={`d${i}`} flexDirection="column" alignItems="center">
              <Svg
                source={done.svg}
                {...size(done.svg)}
                alt={`Mermaid diagram:\n${part.source}`}
                isInteractive
              />
              <Box key={`a${i}`} flexDirection="row" gap={2}>
                {done.page && <Markdown key={`p${i}`} dimColor text={`[Open full size](${done.page}) (switch the panel to View)`} />}
                <Button key={`open${i}`} label="Open in browser" plain dimColor onPress={() => openFull($, cfg, done.svg)} />
              </Box>
            </Box>
          )
        })}
      </Box>
    )
  })
}
