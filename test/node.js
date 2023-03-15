import {EventEmitter} from 'node:events'
import {setTimeout} from 'node:timers/promises'
import test from 'ava'
import {createNode, expandParametersWithDefaults} from '../lib/node.js'

test('createNode / startup successful', async t => {
  const pyshell = new EventEmitter()
  pyshell.send = async () => {
    await setTimeout(100)
    pyshell.emit('message', 'PONG!')
  }

  const node = await createNode('foo', {
    redisConfig: {},
    createPyShellInstance() {
      return pyshell
    }
  })

  t.is(node.status, 'idle')
  t.true(node.isIdle)
})

test('createNode / startup failed - timeout', async t => {
  const pyshell = new EventEmitter()
  pyshell.send = async () => {
    await setTimeout(1000)
    pyshell.emit('message', 'PONG!')
  }

  await t.throwsAsync(
    () => createNode('foo', {
      startupTimeout: 500,
      redisConfig: {},
      createPyShellInstance() {
        return pyshell
      }
    }),
    {message: 'Addok node failed to start: timeout'}
  )
})

test('createNode / request successful', async t => {
  const pyshell = new EventEmitter()
  pyshell.send = async message => {
    if (message === 'PING?') {
      await setTimeout(100)
      pyshell.emit('message', 'PONG!')
      return
    }

    if (message.startsWith('{')) {
      await setTimeout(100)
      const parsedMessage = JSON.parse(message)
      pyshell.emit('message', JSON.stringify({
        reqId: parsedMessage.reqId,
        results: [{foo: 'bar'}]
      }))
    }
  }

  const node = await createNode('foo', {
    redisConfig: {},
    createPyShellInstance() {
      return pyshell
    }
  })

  const resultPromise = node.execRequest({operation: 'geocode', params: {}})

  t.is(node.status, 'processing')
  t.false(node.isIdle)

  const result = await resultPromise

  t.is(node.status, 'idle')
  t.true(node.isIdle)

  t.deepEqual(result, [{foo: 'bar'}])
})

test('createNode / request timeout', async t => {
  const pyshell = new EventEmitter()

  pyshell.send = async message => {
    if (message === 'PING?') {
      await setTimeout(100)
      pyshell.emit('message', 'PONG!')
      return
    }

    if (message.startsWith('{')) {
      await setTimeout(1000)
      const parsedMessage = JSON.parse(message)
      pyshell.emit('message', JSON.stringify({
        reqId: parsedMessage.reqId,
        results: [{foo: 'bar'}]
      }))
    }
  }

  pyshell.end = () => {
    pyshell.terminated = true
  }

  const node = await createNode('foo', {
    requestTimeout: 500,
    redisConfig: {},
    createPyShellInstance() {
      return pyshell
    }
  })

  const resultPromise = node.execRequest({operation: 'geocode', params: {}})

  t.is(node.status, 'processing')
  t.false(node.isIdle)

  await t.throwsAsync(() => resultPromise, {message: 'Addok node terminated: stalled'})

  t.is(node.status, 'closed')
  t.false(node.isIdle)
})

test('expandParametersWithDefaults', t => {
  t.deepEqual(expandParametersWithDefaults({}), {
    q: null,
    limit: 5,
    filters: {},
    lon: null,
    lat: null,
    autocomplete: false
  })

  t.deepEqual(expandParametersWithDefaults({
    q: 'toto',
    limit: 1,
    filters: {foo: 'bar'},
    lon: 180,
    lat: 90,
    autocomplete: true,
    foo: 'bar'
  }), {
    q: 'toto',
    limit: 1,
    filters: {foo: 'bar'},
    lon: 180,
    lat: 90,
    autocomplete: true,
    foo: 'bar'
  })
})