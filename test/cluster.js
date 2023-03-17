import {cpus} from 'node:os'
import {setTimeout} from 'node:timers/promises'
import test from 'ava'
import {getNumNodes, createCluster} from '../lib/cluster.js'

test('getNumNodes', t => {
  t.is(getNumNodes({}), cpus().length)
  t.is(getNumNodes({ADDOK_CLUSTER_NUM_NODES: '10'}), 10)
  t.throws(() => getNumNodes({ADDOK_CLUSTER_NUM_NODES: 'foo'}), {message: 'ADDOK_CLUSTER_NUM_NODES must be an integer between 1 and 64'})
  t.throws(() => getNumNodes({ADDOK_CLUSTER_NUM_NODES: '0'}), {message: 'ADDOK_CLUSTER_NUM_NODES must be an integer between 1 and 64'})
  t.throws(() => getNumNodes({ADDOK_CLUSTER_NUM_NODES: '100'}), {message: 'ADDOK_CLUSTER_NUM_NODES must be an integer between 1 and 64'})
})

async function createWorkingNode(nodeId) {
  return {
    nodeId,
    status: 'idle',
    async execRequest({operation, params}) {
      await setTimeout(50)
      return [{id: 'foo', operation, params}, {id: 'bar', operation, params}]
    }
  }
}

test('createCluster / single node', async t => {
  const cluster = await createCluster({numNodes: 1, createNode: createWorkingNode})
  t.is(cluster.idleNodesCount, 1)
  t.is(cluster.activeNodesCount, 1)
})

test('createCluster / multiple nodes', async t => {
  const cluster = await createCluster({numNodes: 2, createNode: createWorkingNode})
  t.is(cluster.idleNodesCount, 2)
  t.is(cluster.activeNodesCount, 2)
})

test('createCluster / retry on starting node', async t => {
  let createNodeCalled = 0

  async function createNode(nodeId) {
    createNodeCalled++

    if (nodeId === 1) {
      throw new Error('Unable to start node')
    }

    return {
      nodeId,
      status: 'idle'
    }
  }

  const cluster = await createCluster({numNodes: 1, createNode})
  t.is(cluster.idleNodesCount, 1)
  t.is(cluster.activeNodesCount, 1)
  t.is(createNodeCalled, 2)
})

test('createCluster / retry on starting node / never start', async t => {
  let createNodeCalled = 0

  async function createNode() {
    createNodeCalled++
    throw new Error('Unable to start node')
  }

  await t.throwsAsync(
    () => createCluster({numNodes: 1, createNode, maxConsecutiveFailedStartup: 10}),
    {message: 'Unable to start all required nodes'}
  )

  t.is(createNodeCalled, 10)
})

test('createCluster / exec request', async t => {
  const cluster = await createCluster({numNodes: 1, createNode: createWorkingNode})
  t.is(cluster.idleNodesCount, 1)
  t.is(cluster.activeNodesCount, 1)

  const results = await cluster.geocode({q: 'foo'})
  t.deepEqual(results, [
    {id: 'foo', operation: 'geocode', params: {q: 'foo'}},
    {id: 'bar', operation: 'geocode', params: {q: 'foo'}}
  ])
})

test('createCluster / recreate dead nodes', async t => {
  let createNodeCalled = 0
  let firstOnClose = null

  async function createNode(nodeId, {onClose}) {
    createNodeCalled++

    if (nodeId === 1) {
      firstOnClose = onClose
    }

    return {
      nodeId,
      status: 'idle'
    }
  }

  const cluster = await createCluster({numNodes: 1, createNode})
  t.is(cluster.idleNodesCount, 1)
  t.is(cluster.activeNodesCount, 1)
  t.is(createNodeCalled, 1)

  firstOnClose()

  t.is(cluster.idleNodesCount, 0)
  t.is(cluster.activeNodesCount, 0)
  t.is(createNodeCalled, 1)

  await setTimeout(50)

  t.is(cluster.idleNodesCount, 1)
  t.is(cluster.activeNodesCount, 1)
  t.is(createNodeCalled, 2)
})
