import process from 'node:process'
import {fileURLToPath} from 'node:url'

import {PythonShell} from 'python-shell'
import {uniqueId} from 'lodash-es'

const bridgePath = fileURLToPath(new URL('bridge.py', import.meta.url))

export function createNode(options = {}) {
  const pythonPath = options.pythonPath || process.env.PYTHON_PATH
  const addokConfigModule = options.addokConfigModule || process.env.ADDOK_CONFIG_MODULE

  let _status = 'starting'
  let _context = null

  /* Startup */

  let startupContext = {
    resolve: null,
    reject: null,
    timeout: null,
    resultObject: null
  }

  function onStartupSuccess() {
    clearTimeout(startupContext.timeout)
    _status = 'idle'
    startupContext.resolve(startupContext.resultObject)
    startupContext = null
  }

  function onStartupFailure(error) {
    _status = 'error'
    startupContext.reject(error)
    startupContext = null
  }

  const pyshell = new PythonShell(bridgePath, {
    mode: 'text',
    pythonPath,
    env: {
      ...process.env,
      ADDOK_CONFIG_MODULE: addokConfigModule
    }
  })

  pyshell.on('message', message => {
    if (message === 'PONG!' && _status === 'starting') {
      onStartupSuccess()
      return
    }

    if (!message.startsWith('{')) {
      console.log(message)
      return
    }

    const {reqId, results, error} = JSON.parse(message)
    const {resolve, reject} = _context

    if (!_context || _context.reqId !== reqId) {
      console.error('Received an unknown result from a node')
      return
    }

    _status = 'idle'
    _context = null

    if (results) {
      resolve(results)
    } else {
      reject(new Error(error))
    }
  })

  startupContext.resultObject = {
    get status() {
      return _status
    },

    async execRequest(request) {
      if (_status !== 'idle') {
        throw new Error(`Cannot accept a new request at the moment: ${_status}`)
      }

      return new Promise((resolve, reject) => {
        // eslint-disable-next-line unicorn/prevent-abbreviations
        const reqId = uniqueId('req-')
        _context = {reqId, request, resolve, reject}
        _status = 'processing'

        pyshell.send(JSON.stringify({
          reqId,
          operation: request.operation,
          params: expandParametersWithDefaults(request.params)
        }))
      })
    },

    kill(reason) {
      if (_status === 'killed') {
        throw new Error('Already killed')
      }

      if (_status === 'processing') {
        _context.reject(new Error('Killed: ' + reason))
        _context = null
      }

      _status = 'killed'
      pyshell.kill('SIGKILL')
    }
  }

  startupContext.timeout = setTimeout(() => {
    onStartupFailure(new Error('Addok node failed to start: timeout'))
  }, 5000)

  return new Promise((resolve, reject) => {
    startupContext.resolve = resolve
    startupContext.resolve = reject
    pyshell.send('PING?')
  })
}

export function expandParametersWithDefaults(parameters = {}) {
  return {
    q: null,
    limit: 5,
    filters: {},
    lon: null,
    lat: null,
    autocomplete: null,
    ...parameters
  }
}
