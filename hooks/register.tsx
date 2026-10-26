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

type Config = {
  command: string[]
  theme: string
  puppeteerConfig: string
  pending: Set<string>
}

async function render($: EngineInterface, cfg: Config, key: string, source: string) {
  const { command, theme, puppeteerConfig, pending } = cfg
  if (pending.has(key)) return
  pending.add(key)
  let result: Rendered
  try {
    const argv = [
      ...command,
      '-i', '-', '-o', '-', '-e', 'svg',
      '-t', theme, '-b', 'transparent',
      ...(puppeteerConfig ? ['-p', puppeteerConfig] : []),
    ]
    const out = await $.process.run(argv, { stdin: source, timeoutMs: 120_000 })
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
  const command = String(
    options.command || 'npx -y -p @mermaid-js/mermaid-cli@11 mmdc',
  )
    .split(/\s+/)
    .filter(Boolean)
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
