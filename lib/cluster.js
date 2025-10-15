import {cpus} from 'node:os'
import process from 'node:process'

import {remove, times} from 'lodash-es'
import createError from 'http-errors'
import {createNode as nativeCreateNode} from './node.js'
import {createQueue} from './queue.js'
import {validateParams} from './params.js'
import {computeAddokRedisConfigs, createRedisRoundRobin, startRedisServer} from './redis.js'

export async function createCluster(options = {}) {
  const numNodes = options.numNodes || getNumNodes(process.env)
  const createNode = options.createNode || nativeCreateNode
  const maxConsecutiveFailedStartup = options.maxConsecutiveFailedStartup || 50
  const {onTerminate} = options

  const addokRedisUrl = options.addokRedisUrl || process.env.ADDOK_REDIS_URL
  const redisDataDir = options.redisDataDir || process.env.ADDOK_REDIS_DATA_DIR
  const redisStartupTimeout = options.redisStartupTimeout
     || (process.env.ADDOK_REDIS_STARTUP_TIMEOUT
       ? Number.parseInt(process.env.ADDOK_REDIS_STARTUP_TIMEOUT, 10)
       : undefined)

  if (addokRedisUrl && redisDataDir) {
    throw new Error('addokRedisUrl and redisDataDir are mutually exclusive')
  }

  const addokRedisConfigs = redisDataDir
    ? await startRedisServer(redisDataDir, redisStartupTimeout)
    : computeAddokRedisConfigs(addokRedisUrl)

  const redisRoundRobin = createRedisRoundRobin(addokRedisConfigs)
  const queue = createQueue()

  /* Nodes management */

  let nextNodeId = 1
  let consecutiveFailure = 0

  const _startingNodes = []
  const _activeNodes = []
  const _idleNodes = []

  let _terminated = false

  async function prepareNodes() {
    await Promise.all(
      times(numNodes, () => startNewNode())
    )

    if (_activeNodes.length < numNodes) {
      throw new Error('Unable to start all required nodes')
    }
  }

  async function terminateCluster(reason, throwIfAlreadyTerminated = false) {
    if (_terminated) {
      if (throwIfAlreadyTerminated) {
        throw new Error('Cluster already terminated')
      }

      return
    }

    _terminated = true
    await killNodes(reason)

    if (onTerminate) {
      onTerminate(reason)
    }
  }

  async function killNodes(reason) {
    await Promise.all(_activeNodes.map(node => node.kill(reason)))

    if (_startingNodes.length > 0) {
      await setTimeout(5000)
      await Promise.all(_activeNodes.map(node => node.kill(reason)))
    }
  }

  function startNewNode() {
    if (_terminated) {
      return
    }

    if (consecutiveFailure >= maxConsecutiveFailedStartup) {
      terminateCluster('Too many consecutive failures').catch(error => {
        if (process.env.NODE_ENV !== 'test') {
          console.error('Error during cluster termination:', error)
        }
      })
      return
    }

    const nodeId = nextNodeId++

    const nodePromise = createNode(nodeId, {
      ...options,
      redisConfig: redisRoundRobin.getConfig(),
      onClose() {
        remove(_activeNodes, n => n.nodeId === nodeId)
        remove(_idleNodes, n => n.nodeId === nodeId)
        setImmediate(() => startNewNode())
      }
    })

    _startingNodes.push(nodePromise)

    return nodePromise.then(node => {
      consecutiveFailure = 0
      remove(_startingNodes, nodePromise)
      _activeNodes.push(node)
      _idleNodes.push(node)
      executeNext() // Execute next request immediately (useful when recovering from a failure)
      return node
    }).catch(error => {
      if (process.env.NODE_ENV !== 'test') {
        console.error(error)
      }

      consecutiveFailure++
      remove(_startingNodes, nodePromise)
      return startNewNode()
    })
  }

  function executeNext() {
    if (_idleNodes[0]) {
      const nextRequest = queue.getNext()

      if (!nextRequest) {
        return
      }

      const {resolve, reject, request, signal} = nextRequest
      const node = _idleNodes.shift()

      if (signal && signal.aborted) {
        reject(new Error('Aborted'))

        if (node.status === 'idle') {
          _idleNodes.push(node)
        }

        executeNext()
        return
      }

      node.execRequest(request)
        .then(result => resolve(result))
        .catch(error => {
          if (error.message.includes('Addok node terminated: stalled')) {
            return reject(createError(504, 'The request is taking too long to complete'))
          }

          reject(error)
        })
        .finally(() => {
          if (node.status === 'idle') {
            _idleNodes.push(node)
          }

          executeNext()
        })
    }
  }

  async function addRequest(operation, params, options) {
    if (_terminated) {
      throw new Error('Cluster terminated')
    }

    return new Promise((resolve, reject) => {
      queue.add({
        request: {operation, params},
        resolve,
        reject,
        priority: options.priority,
        signal: options.signal
      })

      executeNext()
    })
  }

  await prepareNodes()

  return {
    async geocode(params, options = {}) {
      return addRequest('geocode', validateParams(params, ['q']), options)
    },

    async reverse(params, options = {}) {
      return addRequest('reverse', validateParams(params, ['lon', 'lat']), options)
    },

    end() {
      return terminateCluster('cluster stopped', true)
    },

    numNodes,

    get idleNodesCount() {
      return _idleNodes.length
    },

    get activeNodesCount() {
      return _activeNodes.length
    },

    get terminated() {
      return _terminated
    },

    inspect() {
      return {
        idleNodes: _idleNodes.map(node => node.nodeId),
        activeNodes: _activeNodes.map(node => node.nodeId),
        startingNodes: _startingNodes.map(node => node.nodeId),
        queue: queue.inspect()
      }
    }
  }
}

export function getNumNodes(env) {
  if (env.ADDOK_CLUSTER_NUM_NODES) {
    const num = Number.parseInt(env.ADDOK_CLUSTER_NUM_NODES, 10)

    if (Number.isNaN(num) || num <= 0 || num >= 64) {
      throw new Error('ADDOK_CLUSTER_NUM_NODES must be an integer between 1 and 64')
    }

    return num
  }

  return cpus().length
}
