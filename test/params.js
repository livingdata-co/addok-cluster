import test from 'ava'
import {isFirstCharValid, isNullOrUndefined, validateQ, validateLimit, validateAutocomplete, validateLonLat, validateFilters, validateParams} from '../lib/params.js'

test('isFirstCharValid', t => {
  t.false(isFirstCharValid('---'))
  t.true(isFirstCharValid('A--'))
  t.true(isFirstCharValid('1--'))
  t.true(isFirstCharValid('é--'))
  t.true(isFirstCharValid('É--'))
})

test('isNullOrUndefined', t => {
  t.true(isNullOrUndefined(null))
  t.true(isNullOrUndefined(undefined))
  t.false(isNullOrUndefined(0))
  t.false(isNullOrUndefined('a'))
  t.false(isNullOrUndefined([]))
})

test('validateQ', t => {
  t.is(validateQ('foo'), 'foo')
  t.is(validateQ(' foo'), 'foo')

  t.throws(() => validateQ(null))
  t.throws(() => validateQ(1))
  t.throws(() => validateQ(''))
  t.throws(() => validateQ('a'))
  t.throws(() => validateQ('aa'))
  t.throws(() => validateQ('-aaa'))
})

test('validateLimit', t => {
  t.is(validateLimit(1), 1)
  t.is(validateLimit(5), 5)
  t.is(validateLimit(100), 100)

  t.throws(() => validateLimit(0))
  t.throws(() => validateLimit(-1))
  t.throws(() => validateLimit(101))
  t.throws(() => validateLimit(0.5))
  t.throws(() => validateLimit('12'))
  t.throws(() => validateLimit(Number.NaN))
})

test('validateAutocomplete', t => {
  t.is(validateAutocomplete(true), true)
  t.is(validateAutocomplete(false), false)

  t.throws(() => validateAutocomplete(1))
  t.throws(() => validateAutocomplete('false'))
  t.throws(() => validateAutocomplete())
})

test('validateLonLat', t => {
  t.deepEqual(validateLonLat(1, 1), [1, 1])
  t.deepEqual(validateLonLat(10.5, 10), [10.5, 10])

  t.throws(() => validateLonLat(1, null))
  t.throws(() => validateLonLat(null, 1))
  t.throws(() => validateLonLat('12', '11'))
  t.throws(() => validateLonLat(192, 6.4))
  t.throws(() => validateLonLat(6.5, -95))
})

test('validateFilters', t => {
  t.deepEqual(validateFilters({}), {})
  t.deepEqual(validateFilters({foo: 'bar'}), {foo: 'bar'})

  t.throws(() => validateFilters('a'))
})

test('validateParams / all params', t => {
  t.deepEqual(validateParams({
    foo: 'bar',
    filters: {foo: 'baz'},
    limit: 10,
    autocomplete: true,
    lon: 6.5,
    lat: 60,
    q: 'foobar'
  }), {
    filters: {foo: 'baz'},
    limit: 10,
    autocomplete: true,
    lon: 6.5,
    lat: 60,
    q: 'foobar'
  })
})

test('validateParams / invalid param', t => {
  t.throws(() => validateParams({limit: 0}))
})

test('validateParams / no params', t => {
  t.deepEqual(validateParams({}), {})
})

test('validateParams / required params', t => {
  t.throws(() => validateParams({limit: 3}, ['q']))
})
