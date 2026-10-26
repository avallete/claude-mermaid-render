export type Rendered = { svg: string } | { error: string }

declare module 'claude-code' {
  interface PluginState {
    'mermaid-render': { diagrams: Record<string, Rendered> }
  }
}
