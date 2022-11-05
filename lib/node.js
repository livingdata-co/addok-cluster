import process from 'node:process'
import {fileURLToPath} from 'node:url'

import {PythonShell} from 'python-shell'
import createDebug from 'debug'

const bridgePath = fileURLToPath(new URL('bridge.py', import.meta.url))

export function createNode(nodeId, options = {}) {
  const pythonPath = options.pythonPath || process.env.PYTHON_PATH
  const addokConfigModule = options.addokConfigModule || process.env.ADDOK_CONFIG_MODULE
  const debug = createDebug(`addok-cluster:node-${nodeId}`)

  let _status = 'starting'

  /* Startup */

  let startupContext = {
    resolve: null,
    reject: null,
    timeout: null,
    resultObject: null
  }

  function onStartupSuccess() {
    debug('ready')

    clearTimeout(startupContext.timeout)
    _status = 'idle'
    startupContext.resolve(startupContext.resultObject)
    startupContext = null
  }

  function onStartupFailure(error) {
    debug('failed to start')

    clearTimeout(startupContext.timeout)
    setStatusClosed(false)
    startupContext.reject(error)
    startupContext = null
  }

  /* Cleanup */

  let cleanupCalled = false

  function cleanup(reason) {
    if (cleanupCalled) {
      return
    }

    debug(`cleanup called: ${reason}`)

    cleanupCalled = true

    if (_status === 'processing') {
      const errorMessage = reason ? `Addok node terminated: ${reason}` : 'Addok node terminated'
      requestReject(new Error(errorMessage), false)
    }

    setStatusClosed(true)

    if (!pyshell.terminated) {
      // The node has 2s to close carefully or it is killed
      const killTimeout = setTimeout(() => {
        if (!pyshell.terminated) {
          pyshell.kill('SIGKILL')
        }
      }, 2000)

      pyshell.on('close', () => {
        clearTimeout(killTimeout)
      })

      pyshell.end()
    }
  }

  /* Closed status handling */

  let onCloseCalled = false

  function setStatusClosed(notifyOnClose = true) {
    _status = 'closed'

    if (notifyOnClose && !onCloseCalled && options.onClose) {
      onCloseCalled = true
      options.onClose()
    }
  }

  /* Request context */

  let reqIdCounter = 0

  let requestContext = {
    reqId: null,
    request: null,
    resolve: null,
    reject: null
  }

  function requestResolve(result) {
    clearTimeout(requestContext.timeout)
    _status = 'idle'
    requestContext.resolve(result)
    requestContext = {}
  }

  function requestReject(error, keepRunning = true) {
    clearTimeout(requestContext.timeout)

    if (keepRunning) {
      _status = 'idle'
    } else {
      cleanup('request fatal error')
    }

    requestContext.reject(error)
    requestContext = {}
  }

  debug('starting inter-process channel')

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

    if (!requestContext || !requestContext.reqId || requestContext.reqId !== reqId) {
      console.error('Received an unknown result from Addok node')
      return
    }

    if (results) {
      requestResolve(results)
    } else {
      requestReject(new Error(error), true)
    }
  })

  pyshell.on('stderr', stderr => {
    console.error(stderr)
  })

  pyshell.on('close', () => {
    cleanup('close')
  })

  pyshell.on('error', error => {
    console.error(error)
    cleanup('error')
  })

  pyshell.on('pythonError', error => {
    console.error(error)
    cleanup('pythonError')
  })

  startupContext.resultObject = {
    nodeId,

    get status() {
      return _status
    },

    get isIdle() {
      return _status === 'idle'
    },

    async execRequest(request) {
      if (_status !== 'idle') {
        throw new Error(`Cannot accept a new request at the moment: ${_status}`)
      }

      return new Promise((resolve, reject) => {
        const reqId = ++reqIdCounter

        requestContext = {
          reqId,
          request,
          resolve,
          reject
        }

        requestContext.timeout = setTimeout(() => {
          debug('request timeout')
          cleanup('stalled')
        }, 2000)

        _status = 'processing'

        pyshell.send(JSON.stringify({
          reqId,
          operation: request.operation,
          params: expandParametersWithDefaults(request.params)
        }))
      })
    },

    kill(reason = 'killed') {
      debug('kill called with reason: ' + reason)
      cleanup(reason)
    }
  }

  startupContext.timeout = setTimeout(() => {
    onStartupFailure(new Error('Addok node failed to start: timeout'))
  }, 5000)

  return new Promise((resolve, reject) => {
    startupContext.resolve = resolve
    startupContext.reject = reject
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
    autocomplete: false,
    ...parameters
  }
}
