import {cpus} from 'node:os'
import process from 'node:process'

import {remove, times} from 'lodash-es'
import createError from 'http-errors'
import {createNode as nativeCreateNode} from './node.js'
import {createQueue} from './queue.js'
import {validateParams} from './params.js'
import {computeAddokRedisConfigs, createRedisRoundRobin, createInstance} from './redis.js'

export async function createCluster(options = {}) {
  let redisRoundRobin
  let redisInstance

  const numNodes = options.numNodes || getNumNodes(process.env)
  const createNode = options.createNode || nativeCreateNode
  const maxConsecutiveFailedStartup = options.maxConsecutiveFailedStartup || 50
  const baseDataPath = options.addokRedisDataPath || process.env.ADDOK_REDIS_DATA_PATH

  if (baseDataPath) {
    redisInstance = await createInstance(baseDataPath, {dropExistingDump: false})
  } else {
    const addokRedisConfigs = computeAddokRedisConfigs(options.addokRedisUrl)
    redisRoundRobin = createRedisRoundRobin(addokRedisConfigs)
  }

  const queue = createQueue()

  /* Nodes management */

  let nextNodeId = 1
  let consecutiveFailure = 0

  const _startingNodes = []
  const _activeNodes = []
  const _idleNodes = []

  let _terminated = false

  async function prepareNodes() {
    if (redisInstance) {
      const startNodePromises = times(numNodes, () => startNewNode(redisInstance.socketPath))

      await Promise.all(startNodePromises)
    } else {
      await Promise.all(
        times(numNodes, () => startNewNode())
      )
    }

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
    return killNodes(reason)
  }

  async function killNodes(reason) {
    await Promise.all(_activeNodes.map(node => node.kill(reason)))

    if (_startingNodes.length > 0) {
      await setTimeout(5000)
      await Promise.all(_activeNodes.map(node => node.kill(reason)))
    }
  }

  function startNewNode(redisSocketPath) {
    if (_terminated) {
      return
    }

    if (consecutiveFailure >= maxConsecutiveFailedStartup) {
      terminateCluster('Too many consecutive failures')
      return
    }

    const nodeId = nextNodeId++

    const nodePromise = createNode(nodeId, {
      ...options,
      redisConfig: redisSocketPath ? {socketPath: redisSocketPath} : redisRoundRobin.getConfig(),
      onClose() {
        remove(_activeNodes, n => n.nodeId === nodeId)
        remove(_idleNodes, n => n.nodeId === nodeId)
        setImmediate(() => startNewNode(redisSocketPath))
      }
    })

    _startingNodes.push(nodePromise)

    return nodePromise.then(node => {
      consecutiveFailure = 0
      remove(_startingNodes, nodePromise)
      _activeNodes.push(node)
      _idleNodes.push(node)
      return node
    }).catch(error => {
      if (process.env.NODE_ENV !== 'test') {
        console.error(error)
      }

      consecutiveFailure++
      remove(_startingNodes, nodePromise)
      return startNewNode(redisSocketPath)
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
