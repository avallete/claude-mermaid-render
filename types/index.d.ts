export type Rendered = { svg: string; page?: string } | { error: string }

declare module 'claude-code' {
  interface PluginState {
    'mermaid-render': {
      diagrams: Record<string, Rendered>
      showing: Record<string, boolean>
      editing: Record<string, boolean>
      fixes: Record<string, string>
    }
  }
}
