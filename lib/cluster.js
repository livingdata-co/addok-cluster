import {cpus} from 'node:os'
import {createNode} from './node.js'

const numberCpus = cpus().length

export async function createCluster(options = {}) {
  const numberNodes = options.numberNodes || numberCpus

  let _nodes = null
  let _idleNodes = []
  const _queue = []

  async function prepareNodes() {
    const promises = []

    for (let i = 0; i < numberNodes; i++) {
      promises.push(createNode(options))
    }

    _nodes = await Promise.all(promises)
    _idleNodes = _nodes
  }

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
    }
  }
}
