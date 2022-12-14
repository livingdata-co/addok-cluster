import {cpus} from 'node:os'
import process from 'node:process'

import {remove, times} from 'lodash-es'
import createError from 'http-errors'
import {createNode} from './node.js'
import {createQueue} from './queue.js'
import {validateParams} from './params.js'
import {computeAddokRedisConfigs, createRedisRoundRobin} from './redis.js'

export async function createCluster(options = {}) {
  const numNodes = options.numNodes || getNumNodes()
  const addokRedisConfigs = computeAddokRedisConfigs(options.addokRedisUrl)
  const redisRoundRobin = createRedisRoundRobin(addokRedisConfigs)
  const queue = createQueue()

  /* Nodes management */

  let killNodesCalled = false
  let nextNodeId = 1
  let consecutiveFailure = 0
  const _startingNodes = []
  const _activeNodes = []
  const _idleNodes = []

  async function prepareNodes() {
    await Promise.all(
      times(numNodes, () => startNewNode())
    )
  }

  function killNodes(reason) {
    if (killNodesCalled) {
      return
    }

    killNodesCalled = true

    for (const node of _activeNodes) {
      node.kill(reason)
    }

    if (_startingNodes.length > 0) {
      setTimeout(() => killNodes(reason), 5000)
      return
    }

    if (options.onFailure) {
      options.onFailure()
    }
  }

  function startNewNode() {
    if (killNodesCalled) {
      return
    }

    if (consecutiveFailure >= 50) {
      killNodes('Too many consecutive failure')
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

    nodePromise.then(node => {
      consecutiveFailure = 0
      remove(_startingNodes, nodePromise)
      _activeNodes.push(node)
      _idleNodes.push(node)
    }).catch(error => {
      console.error(error)
      consecutiveFailure++
      remove(_startingNodes, nodePromise)
      startNewNode()
    })

    return nodePromise
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

        if (node.isIdle) {
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
          if (node.isIdle) {
            _idleNodes.push(node)
          }

          executeNext()
        })
    }
  }

  async function addRequest(operation, params, options) {
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
    geocode(params, options = {}) {
      return addRequest('geocode', validateParams(params, ['q']), options)
    },

    reverse(params, options = {}) {
      return addRequest('reverse', validateParams(params, ['lon', 'lat']), options)
    },

    end() {
      killNodes('cluster stopped')
    },

    get numNodes() {
      return numNodes
    }
  }
}

function getNumNodes() {
  if (process.env.ADDOK_CLUSTER_NUM_NODES) {
    return Number.parseInt(process.env.ADDOK_CLUSTER_NUM_NODES, 10)
  }

  return cpus().length
}
