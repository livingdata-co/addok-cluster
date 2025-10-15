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

test('createCluster / exec geocode request', async t => {
  const cluster = await createCluster({numNodes: 1, createNode: createWorkingNode})
  t.is(cluster.idleNodesCount, 1)
  t.is(cluster.activeNodesCount, 1)

  const results = await cluster.geocode({q: 'foo'})
  t.deepEqual(results, [
    {id: 'foo', operation: 'geocode', params: {q: 'foo'}},
    {id: 'bar', operation: 'geocode', params: {q: 'foo'}}
  ])
})

test('createCluster / exec geocode request / missing required parameter', async t => {
  const cluster = await createCluster({numNodes: 1, createNode: createWorkingNode})
  t.is(cluster.idleNodesCount, 1)
  t.is(cluster.activeNodesCount, 1)

  await t.throwsAsync(() => cluster.geocode({}), {message: 'q is a required parameter'})
})

test('createCluster / exec reverse request', async t => {
  const cluster = await createCluster({numNodes: 1, createNode: createWorkingNode})
  t.is(cluster.idleNodesCount, 1)
  t.is(cluster.activeNodesCount, 1)

  const results = await cluster.reverse({lon: 0, lat: 0})
  t.deepEqual(results, [
    {id: 'foo', operation: 'reverse', params: {lon: 0, lat: 0}},
    {id: 'bar', operation: 'reverse', params: {lon: 0, lat: 0}}
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

test('createCluster / exec aborted request', async t => {
  const cluster = await createCluster({numNodes: 1, createNode: createWorkingNode})

  const ac = new AbortController()
  ac.abort()

  await t.throwsAsync(
    () => cluster.geocode({q: 'foo'}, {signal: ac.signal}),
    {message: 'Aborted'}
  )
})

test('createCluster / request with unknown priority', async t => {
  const cluster = await createCluster({numNodes: 1, createNode: createWorkingNode})

  await t.throwsAsync(
    () => cluster.geocode({q: 'foo'}, {priority: 'foo'}),
    {message: 'Unknown priority: foo'}
  )
})

test('createCluster / request timeout', async t => {
  async function createNode(nodeId) {
    return {
      nodeId,
      status: 'idle',
      async execRequest() {
        await setTimeout(50)
        throw new Error('Addok node terminated: stalled')
      }
    }
  }

  const cluster = await createCluster({numNodes: 1, createNode})

  const error = await t.throwsAsync(
    () => cluster.geocode({q: 'foo'}),
    {message: 'The request is taking too long to complete'}
  )

  t.is(error.statusCode, 504)
})

test('createCluster / request failure', async t => {
  async function createNode(nodeId) {
    return {
      nodeId,
      status: 'idle',
      async execRequest() {
        await setTimeout(50)
        throw new Error('Unexpected error')
      }
    }
  }

  const cluster = await createCluster({numNodes: 1, createNode})

  await t.throwsAsync(
    () => cluster.geocode({q: 'foo'}),
    {message: 'Unexpected error'}
  )
})

test('createCluster / terminated cluster', async t => {
  let status = 'idle'

  async function createNode(nodeId) {
    return {
      nodeId,
      status,
      async execRequest({operation, params}) {
        await setTimeout(50)
        return [{id: 'foo', operation, params}, {id: 'bar', operation, params}]
      },
      async kill() {
        status = 'closed'
      }
    }
  }

  const cluster = await createCluster({numNodes: 1, createNode})
  t.is(cluster.idleNodesCount, 1)
  t.is(cluster.activeNodesCount, 1)

  await cluster.end()
  t.true(cluster.terminated)

  await t.throwsAsync(
    () => cluster.geocode({q: 'foo'}),
    {message: 'Cluster terminated'}
  )

  await t.throwsAsync(
    () => cluster.end(),
    {message: 'Cluster already terminated'}
  )
})

test('createCluster / onTerminate hook on explicit end', async t => {
  let status = 'idle'
  let onTerminateCalled = false
  let terminateReason = null

  async function createNode(nodeId) {
    return {
      nodeId,
      status,
      async execRequest({operation, params}) {
        await setTimeout(50)
        return [{id: 'foo', operation, params}, {id: 'bar', operation, params}]
      },
      async kill() {
        status = 'closed'
      }
    }
  }

  const cluster = await createCluster({
    numNodes: 1,
    createNode,
    onTerminate(reason) {
      onTerminateCalled = true
      terminateReason = reason
    }
  })

  t.is(cluster.idleNodesCount, 1)
  t.is(cluster.activeNodesCount, 1)
  t.false(onTerminateCalled)

  await cluster.end()
  t.true(cluster.terminated)
  t.true(onTerminateCalled)
  t.is(terminateReason, 'cluster stopped')
})

test('createCluster / onTerminate hook on too many failures', async t => {
  let createNodeCalled = 0
  let onTerminateCalled = false
  let terminateReason = null

  async function createNode() {
    createNodeCalled++
    throw new Error('Unable to start node')
  }

  const cluster = createCluster({
    numNodes: 1,
    createNode,
    maxConsecutiveFailedStartup: 5,
    onTerminate(reason) {
      onTerminateCalled = true
      terminateReason = reason
    }
  })

  await t.throwsAsync(
    () => cluster,
    {message: 'Unable to start all required nodes'}
  )

  // Wait a bit to ensure onTerminate is called
  await setTimeout(50)

  t.is(createNodeCalled, 5)
  t.true(onTerminateCalled)
  t.is(terminateReason, 'Too many consecutive failures')
})

// We want to test that the cluster will continue to exec requests even when all nodes must be restarted
test('createCluster / retry on execRequest', async t => {
  let execRequestCalled = 0

  async function createNode(nodeId, {onClose}) {
    const node = {
      nodeId,
      status: 'idle'
    }

    node.execRequest = async () => {
      execRequestCalled++
      await setTimeout(50)

      if (node.status === 'idle') {
        node.status = 'closed'
        onClose()
        throw new Error('Unable to exec request')
      }

      throw new Error('Why are you calling me?')
    }

    await setTimeout(50)
    return node
  }

  const cluster = await createCluster({numNodes: 2, createNode})
  t.is(cluster.idleNodesCount, 2)

  await Promise.all([
    'foo',
    'bar',
    'baz',
    'qux',
    'quux',
    'corge',
    'grault',
    'garply',
    'waldo',
    'fred'
  ].map(async q => {
    await t.throwsAsync(
      async () => cluster.geocode({q}),
      {message: 'Unable to exec request'}
    )
  }))

  t.is(execRequestCalled, 10)
})
