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
    logger: false,
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
      logger: false,
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
    logger: false,
    redisConfig: {},
    createPyShellInstance() {
      return pyshell
    }
  })

  const resultPromise = node.execRequest({operation: 'geocode', params: {}})

  t.is(node.status, 'processing')
  t.false(node.isIdle)

  await t.throwsAsync(
    () => node.execRequest({operation: 'geocode', params: {}}),
    {message: 'Cannot accept a new request at the moment: processing'}
  )

  const result = await resultPromise

  t.is(node.status, 'idle')
  t.true(node.isIdle)

  t.deepEqual(result, [{foo: 'bar'}])
})

test('createNode / request failed', async t => {
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
        error: 'Operation failed'
      }))
    }
  }

  const node = await createNode('foo', {
    logger: false,
    redisConfig: {},
    createPyShellInstance() {
      return pyshell
    }
  })

  const resultPromise = node.execRequest({operation: 'geocode', params: {}})

  t.is(node.status, 'processing')
  t.false(node.isIdle)

  await t.throwsAsync(() => resultPromise, {message: 'Operation failed'})

  t.is(node.status, 'idle')
  t.true(node.isIdle)
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

  pyshell.end = async () => {
    await setTimeout(1000)
    pyshell.terminated = true
    pyshell.emit('close')
  }

  const node = await createNode('foo', {
    logger: false,
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

  t.true(node.cleanupCalled)
  t.is(node.cleanupReason, 'stalled')
  t.is(node.status, 'closed')
  t.false(node.isIdle)
})

test('createNode / explicit kill', async t => {
  const pyshell = new EventEmitter()
  pyshell.send = async () => {
    await setTimeout(100)
    pyshell.emit('message', 'PONG!')
  }

  let endCalled = false

  pyshell.end = async () => {
    endCalled = true
    await setTimeout(200)
    pyshell.terminated = true
    pyshell.emit('close')
  }

  let killCalled = false

  pyshell.kill = async () => {
    killCalled = true
    await setTimeout(200)
    pyshell.terminated = true
    pyshell.emit('close')
  }

  let onCloseCalled = false

  const node = await createNode('foo', {
    logger: false,
    killTimeout: 1000,
    redisConfig: {},
    createPyShellInstance() {
      return pyshell
    },
    onClose() {
      onCloseCalled = true
    }
  })

  t.is(node.status, 'idle')
  t.true(node.isIdle)

  await node.kill('test')

  t.true(onCloseCalled)

  t.true(endCalled)
  t.false(killCalled)

  t.is(node.status, 'closed')
  t.true(node.killCalled)
  t.true(node.cleanupCalled)
  t.is(node.cleanupReason, 'test')
  t.is(node.killReason, 'test')

  t.throws(() => node.kill(), {message: 'Kill action has already been called on this node'})
})

test('createNode / explicit kill + SIGKILL', async t => {
  const pyshell = new EventEmitter()
  pyshell.send = async () => {
    await setTimeout(100)
    pyshell.emit('message', 'PONG!')
  }

  let endCalled = false

  pyshell.end = async () => {
    endCalled = true
    await setTimeout(500)
    pyshell.terminated = true
    pyshell.emit('close')
  }

  let killCalled = false

  pyshell.kill = async () => {
    killCalled = true
    await setTimeout(100)
    pyshell.terminated = true
    pyshell.emit('close')
  }

  const node = await createNode('foo', {
    logger: false,
    killTimeout: 200,
    redisConfig: {},
    createPyShellInstance() {
      return pyshell
    }
  })

  t.is(node.status, 'idle')
  t.true(node.isIdle)

  await node.kill('test')

  t.true(endCalled)
  t.true(killCalled)

  t.is(node.status, 'closed')
  t.true(node.killCalled)
  t.true(node.cleanupCalled)
  t.is(node.cleanupReason, 'test')
  t.is(node.killReason, 'test')
})

test('createNode / pythonError', async t => {
  const pyshell = new EventEmitter()

  pyshell.send = async () => {
    await setTimeout(100)
    pyshell.emit('message', 'PONG!')
  }

  pyshell.end = () => {
    pyshell.terminated = true
    pyshell.emit('close')
  }

  const errors = []
  const logs = []

  const node = await createNode('foo', {
    logger: {
      log(message) {
        logs.push(message)
      },
      error(message) {
        errors.push(message)
      }
    },
    redisConfig: {},
    createPyShellInstance() {
      return pyshell
    }
  })

  t.is(node.status, 'idle')
  t.true(node.isIdle)

  pyshell.emit('pythonError', new Error('Unexpected Python error'))

  t.true(node.cleanupCalled)
  t.is(node.cleanupReason, 'pythonError')
  t.deepEqual(errors, ['Unexpected Python error'])
})

test('createNode / error', async t => {
  const pyshell = new EventEmitter()

  pyshell.send = async () => {
    await setTimeout(100)
    pyshell.emit('message', 'PONG!')
  }

  pyshell.end = () => {
    pyshell.terminated = true
    pyshell.emit('close')
  }

  const errors = []
  const logs = []

  const node = await createNode('foo', {
    logger: {
      log(message) {
        logs.push(message)
      },
      error(message) {
        errors.push(message)
      }
    },
    redisConfig: {},
    createPyShellInstance() {
      return pyshell
    }
  })

  t.is(node.status, 'idle')
  t.true(node.isIdle)

  pyshell.emit('error', new Error('Unexpected error'))

  t.true(node.cleanupCalled)
  t.is(node.cleanupReason, 'error')
  t.deepEqual(errors, ['Unexpected error'])

  await node.kill() // Will do nothing
  t.false(node.killCalled)
})

test('createNode / collect logs', async t => {
  const pyshell = new EventEmitter()

  pyshell.send = async () => {
    await setTimeout(100)
    pyshell.emit('message', 'PONG!')
  }

  pyshell.end = () => {
    pyshell.terminated = true
    pyshell.emit('close')
  }

  const logs = []
  const errors = []

  const node = await createNode('foo', {
    logger: {
      log(message) {
        logs.push(message)
      },
      error(message) {
        errors.push(message)
      }
    },
    redisConfig: {},
    createPyShellInstance() {
      return pyshell
    }
  })

  t.is(node.status, 'idle')
  t.true(node.isIdle)

  pyshell.emit('stderr', 'random stderr entry')
  pyshell.emit('message', '{"reqId": "foo", "results": []}')
  t.deepEqual(errors, ['random stderr entry', 'Received an unknown result from Addok node'])

  pyshell.emit('message', 'random stdout entry')
  t.deepEqual(logs, ['random stdout entry'])

  await node.kill()

  pyshell.emit('message', 'one more entry entry', 'Received an unknown result from Addok node')
  t.deepEqual(logs, ['random stdout entry'])
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
