import {cpus} from 'node:os'
import {createNode} from './node.js'

const numberCpus = cpus().length

export async function createCluster(options = {}) {
  let _nodes = null
  let _idleNodes = []
  const _queue = []

  async function prepareNodes(numberNodes) {
    const promises = []

    for (let i = 0; i < numberNodes; i++) {
      promises.push(createNode())
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

  await prepareNodes(options.numberNodes || numberCpus)

  return {
    async dispatch({q, limit}) {
      return new Promise((resolve, reject) => {
        _queue.push({
          addTime: new Date(),
          request: {operation: 'geocode', params: {q, limit}},
          resolve,
          reject
        })

        executeNext()
      })
    }
  }
}
