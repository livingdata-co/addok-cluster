import process from 'node:process'
import createDebug from 'debug'
import createInstance from './pyshell/index.js'
import {getLogger} from './logger.js'

export function createNode(nodeId, options = {}) {
  const {redisConfig} = options
  const pythonPath = options.pythonPath || process.env.PYTHON_PATH
  const addokConfigModule = options.addokConfigModule || process.env.ADDOK_CONFIG_MODULE
  const createPyShellInstance = options.createPyShellInstance || createInstance

  const logger = getLogger(options.logger)

  const startupTimeout = options.startupTimeout || 5000
  const requestTimeout = options.requestTimeout || 2000
  const killTimeout = options.killTimeout || 2000

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

  let _cleanupCalled = false
  let _cleanupReason = null
  let _cleanupPromise = null

  function cleanup(reason) {
    if (_cleanupCalled) {
      return _cleanupPromise
    }

    debug(`cleanup called: ${reason}`)

    _cleanupCalled = true
    _cleanupReason = reason

    _cleanupPromise = doCleanup()

    return _cleanupPromise
  }

  async function doCleanup() {
    if (_status === 'processing') {
      const errorMessage = `Addok node terminated: ${_cleanupReason}`
      requestReject(new Error(errorMessage), false)
    }

    setStatusClosed(true)

    if (!pyshell.terminated) {
      // The node has some time to close carefully or to be killed
      return new Promise(resolve => {
        const killTimeoutHandle = setTimeout(() => {
          if (!pyshell.terminated) {
            pyshell.kill('SIGKILL')
          }
        }, killTimeout)

        pyshell.on('close', () => {
          clearTimeout(killTimeoutHandle)
          resolve()
        })

        pyshell.end()
      })
    }
  }

  /* Kill */

  let _killCalled = false
  let _killReason = null

  function kill(reason = 'killed') {
    if (_killCalled) {
      const error = new Error('Kill action has already been called on this node')
      error.nodeId = nodeId
      throw error
    }

    if (_cleanupCalled) {
      return _cleanupPromise
    }

    debug('kill called with reason: ' + reason)

    _killCalled = true
    _killReason = reason

    return cleanup(reason)
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

  const pyshell = createPyShellInstance({
    pythonPath,
    env: {
      ...process.env,
      ADDOK_CONFIG_MODULE: addokConfigModule,
      REDIS_HOST: redisConfig.host,
      REDIS_PORT: redisConfig.port,
      REDIS_SOCKET: redisConfig.socketPath
    }
  })

  pyshell.on('message', message => {
    if (_cleanupCalled) {
      return
    }

    if (message === 'PONG!' && _status === 'starting') {
      onStartupSuccess()
      return
    }

    if (!message.startsWith('{')) {
      if (logger) {
        logger.log(message)
      }

      return
    }

    const {reqId, results, error} = JSON.parse(message)

    if (!requestContext || !requestContext.reqId || requestContext.reqId !== reqId) {
      if (logger) {
        logger.error('Received an unknown result from Addok node')
      }

      return
    }

    if (results) {
      requestResolve(results)
    } else {
      requestReject(new Error(error), true)
    }
  })

  pyshell.on('stderr', stderr => {
    if (logger) {
      logger.error(stderr)
    }
  })

  pyshell.on('close', () => {
    cleanup('close')
  })

  pyshell.on('error', error => {
    if (logger) {
      logger.error(error.message)
    }

    cleanup('error')
  })

  pyshell.on('pythonError', error => {
    if (logger) {
      logger.error(error.message)
    }

    cleanup('pythonError')
  })

  startupContext.resultObject = {
    nodeId,

    get status() {
      return _status
    },

    get killCalled() {
      return _killCalled
    },

    get killReason() {
      return _killReason
    },

    get cleanupCalled() {
      return _cleanupCalled
    },

    get cleanupReason() {
      return _cleanupReason
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
        }, requestTimeout)

        _status = 'processing'

        pyshell.send(JSON.stringify({
          reqId,
          operation: request.operation,
          params: expandParametersWithDefaults(request.params)
        }))
      })
    },

    kill
  }

  startupContext.timeout = setTimeout(() => {
    onStartupFailure(new Error('Addok node failed to start: timeout'))
  }, startupTimeout)

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
