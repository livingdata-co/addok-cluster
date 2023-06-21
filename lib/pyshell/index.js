import {fileURLToPath} from 'node:url'
import {PythonShell} from 'python-shell'

const bridgePath = fileURLToPath(new URL('bridge.py', import.meta.url))

export default function createInstance(options = {}) {
  const {env, pythonPath} = options

  const pyshell = new PythonShell(bridgePath, {
    mode: 'text',
    pythonPath,
    env
  })

  return pyshell
}
