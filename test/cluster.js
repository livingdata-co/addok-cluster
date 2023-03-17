import {cpus} from 'node:os'
import test from 'ava'
import {getNumNodes} from '../lib/cluster.js'

test('getNumNodes', t => {
  t.is(getNumNodes({}), cpus().length)
  t.is(getNumNodes({ADDOK_CLUSTER_NUM_NODES: '10'}), 10)
  t.throws(() => getNumNodes({ADDOK_CLUSTER_NUM_NODES: 'foo'}), {message: 'ADDOK_CLUSTER_NUM_NODES must be an integer between 1 and 64'})
  t.throws(() => getNumNodes({ADDOK_CLUSTER_NUM_NODES: '0'}), {message: 'ADDOK_CLUSTER_NUM_NODES must be an integer between 1 and 64'})
  t.throws(() => getNumNodes({ADDOK_CLUSTER_NUM_NODES: '100'}), {message: 'ADDOK_CLUSTER_NUM_NODES must be an integer between 1 and 64'})
})
