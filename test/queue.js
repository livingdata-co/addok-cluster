import test from 'ava'
import {createQueue} from '../lib/queue.js'

test('createQueue / unknown priority', t => {
  const q = createQueue()
  t.throws(() => q.add({priority: 'foo'}))
})

test('createQueue / full featured', t => {
  const q = createQueue()
  q.add({value: 50}) // Default to priority: medium
  q.add({value: 100, priority: 'high'})
  q.add({value: 51, priority: 'medium'})
  q.add({value: 52, priority: 'medium'})
  q.add({value: 1, priority: 'low'})
  q.add({value: 101, priority: 'high'})

  t.is(q.getNext().value, 100)
  t.is(q.getNext().value, 101)
  t.is(q.getNext().value, 50)
  t.is(q.getNext().value, 51)
  t.is(q.getNext().value, 52)
  t.is(q.getNext().value, 1)
  t.is(q.getNext(), undefined)
})
