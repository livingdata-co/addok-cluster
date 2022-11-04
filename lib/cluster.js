import {cpus} from 'node:os'
import {remove, times} from 'lodash-es'
import {createNode} from './node.js'

const numberCpus = cpus().length

export async function createCluster(options = {}) {
  const numberNodes = options.numberNodes || numberCpus

  /* Nodes management */

  let killNodesCalled = false
  let nextNodeId = 1
  let consecutiveFailure = 0
  const _startingNodes = []
  const _activeNodes = []
  const _idleNodes = []

  async function prepareNodes() {
    await Promise.all(
      times(numberNodes, () => startNewNode())
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
      onExit() {
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

  const _queue = []

  function executeNext() {
    if (_queue[0] && _idleNodes[0]) {
      const {resolve, reject, request} = _queue.shift()
      const node = _idleNodes.shift()

      node.execRequest(request)
        .then(result => resolve(result))
        .catch(error => reject(error))
        .finally(() => {
          _idleNodes.push(node)
          executeNext()
        })
    }
  }

  async function addRequest(operation, params) {
    return new Promise((resolve, reject) => {
      _queue.push({
        addTime: new Date(),
        request: {operation, params},
        resolve,
        reject
      })

      executeNext()
    })
  }

  await prepareNodes()

  return {
    geocode(params) {
      return addRequest('geocode', params)
    },

    reverse(params) {
      return addRequest('reverse', params)
    },

    end() {
      killNodes('end called')
    }
  }
}
