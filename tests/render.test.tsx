import { expect, test } from 'claude-code/testing'

import { size } from '../hooks/register'

const TEXT = 'Here is the flow:\n\n```mermaid\ngraph TD\n  A-->B\n```\n\nDone.'

const RAW = '<svg xmlns="http://www.w3.org/2000/svg"><rect width="10.123456789" height="10"/></svg>'

const ok = (stdout: string) => ({
  value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false },
})

const MSG = (surface: 'desktop' | 'terminal') => ({
  plugin: 'mermaid-render',
  surface,
  component: 'AssistantMessage',
  props: { text: TEXT, isFirstOfReply: true },
} as const)

test('desktop draws the diagram once mmdc answers', async ($, on) => {
  let calls = 0
  on('process.run', (_, e) => {
    if (e.argv[1] === '-e') return ok('{"node":"/bin/node","mmdc":"/g/cli.js"}')
    calls += 1
    expect(e.argv.slice(0, 2)).toEqual(['/bin/node', '/g/cli.js'])
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

test('merman-cli on PATH is preferred over mmdc', async ($, on) => {
  const argvs: string[][] = []
  on('process.run', (_, e) => {
    if (e.argv[1] === '-e') return ok('{"node":"/bin/node","merman":"/g/merman-cli","fonts":["/f/trebuc.ttf"],"mmdc":"/g/cli.js"}')
    argvs.push(e.argv)
    return ok(RAW)
  })
  const ui = await $.ui.mount(MSG('desktop'))
  expect(await ui.find({ type: 'Svg' })).toBeDefined()
  expect(argvs[0]?.slice(0, 5)).toEqual(['/g/merman-cli', 'mmdc', '--font-file', '/f/trebuc.ttf', '-i'])
  await ui.unmount()
})

test('a global svgo shrinks the diagram', async ($, on) => {
  on('process.run', (_, e) => {
    if (e.argv[1] === '-e') return ok('{"node":"/bin/node","mmdc":"/g/cli.js","svgo":"/g/svgo.js"}')
    if (e.argv[1] === '/g/svgo.js') {
      expect(e.argv).toContain('--precision')
      expect(e.init?.stdin).toBe(RAW)
      return ok('<svg>small</svg>')
    }
    return ok(RAW)
  })
  const ui = await $.ui.mount(MSG('desktop'))
  expect((await ui.find({ type: 'Svg' }))?.props.source).toBe('<svg>small</svg>')
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

test('the diagram is sized from its viewBox, capped to the column', () => {
  expect(size('<svg width="100%" style="max-width: 207px" viewBox="4 4 207.4 384"><g/></svg>')).toEqual({ width: 207, height: 384 })
  expect(size('<svg viewBox="0 0 1440 200"><g/></svg>')).toEqual({ width: 720, height: 100 })
  expect(size('<svg><g/></svg>')).toEqual({})
})
