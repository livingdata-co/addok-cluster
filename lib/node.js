import process from 'node:process'
import createDebug from 'debug'
import createInstance from './pyshell/index.js'

export function getLogger(logger) {
  if (logger === undefined || logger === true) {
    return {
      log: console.log,
      error: console.error
    }
  }

  if (typeof logger === 'object' && logger.log && logger.error) {
    return logger
  }

  if (logger === false) {
    return
  }

  throw new Error('logger must be a boolean or an object with log and error methods')
}

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

  let _killCalled = false
  let _killReason = null

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
      const killTimeoutHandle = setTimeout(() => {
        if (!pyshell.terminated) {
          pyshell.kill('SIGKILL')
        }
      }, killTimeout)

      pyshell.on('close', () => {
        clearTimeout(killTimeoutHandle)
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

  const pyshell = createPyShellInstance({
    pythonPath,
    env: {
      ...process.env,
      ADDOK_CONFIG_MODULE: addokConfigModule,
      REDIS_HOST: redisConfig.host,
      REDIS_PORT: redisConfig.port
    }
  })

  pyshell.on('message', message => {
    if (cleanupCalled) {
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
      logger.error(error)
    }

    cleanup('error')
  })

  pyshell.on('pythonError', error => {
    if (logger) {
      logger.error(error)
    }

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

    get killCalled() {
      return _killCalled
    },

    get killReason() {
      return _killReason
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

    kill(reason = 'killed') {
      if (_killCalled) {
        const error = new Error('Kill action has already been called on this node')
        error.nodeId = nodeId
        throw error
      }

      debug('kill called with reason: ' + reason)

      _killCalled = true
      _killReason = reason

      cleanup(reason)
    }
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
