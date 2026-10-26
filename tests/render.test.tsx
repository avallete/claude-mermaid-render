import { expect, test } from 'claude-code/testing'

const TEXT = 'Here is the flow:\n\n```mermaid\ngraph TD\n  A-->B\n```\n\nDone.'

const MSG = (surface: 'desktop' | 'terminal') => ({
  plugin: 'mermaid-render',
  surface,
  component: 'AssistantMessage',
  props: { text: TEXT, isFirstOfReply: true },
} as const)

test('desktop draws the diagram once mmdc answers', async ($, on) => {
  let calls = 0
  on('process.run', (_, e) => {
    calls += 1
    expect(e.init?.stdin).toBe('graph TD\n  A-->B')
    return {
      value: {
        exitCode: 0,
        stdout: '<svg xmlns="http://www.w3.org/2000/svg"><rect width="10" height="10"/></svg>',
        stderr: '',
        isStdoutTruncated: false,
        isStderrTruncated: false,
      },
    }
  })

  const ui = await $.ui.mount(MSG('desktop'))
  expect(await ui.find({ type: 'Svg' })).toBeDefined()
  expect(await ui.find({ type: 'Markdown', text: /Here is the flow/ })).toBeDefined()
  expect(calls).toBe(1)
  await ui.unmount()
})

test('a failed render keeps the code block and says why', async ($, on) => {
  on('process.run', () => ({
    value: { exitCode: 1, stdout: '', stderr: 'Parse error on line 2', isStdoutTruncated: false, isStderrTruncated: false },
  }))
  const ui = await $.ui.mount(MSG('desktop'))
  expect(await ui.find({ type: 'Svg' })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /Parse error/ })).toBeDefined()
  await ui.unmount()
})

test('the terminal is left to the engine', async ($, on) => {
  let calls = 0
  on('process.run', () => { calls += 1; return { value: { exitCode: 0, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } } })
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>engine</Text>
  })
  const ui = await $.ui.mount(MSG('terminal'))
  expect(calls).toBe(0)
  expect(await ui.find({ type: 'Text', text: 'engine' })).toBeDefined()
  await ui.unmount()
})
