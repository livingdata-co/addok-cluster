import test from 'ava'
import {getLogger} from '../lib/logger.js'

test('getLogger', t => {
  t.is(getLogger(false), undefined)

  const log = () => {}
  const error = () => {}

  t.deepEqual(getLogger({log, error}), {log, error})
  t.deepEqual(getLogger(true), {log: console.log, error: console.error})

  t.throws(() => getLogger({foo: 'bar'}), {message: 'logger must be a boolean or an object with log and error methods'})
  t.throws(() => getLogger(0), {message: 'logger must be a boolean or an object with log and error methods'})
})
