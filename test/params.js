import test from 'ava'
import {
  isFirstCharValid,
  isNullOrUndefined,
  validateQ,
  validateLimit,
  validateAutocomplete,
  validateLonLat,
  formatFilterValue,
  validateFilters,
  validateParams
} from '../lib/params.js'

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

  t.throws(() => validateQ(null), {message: 'q must be a string'})
  t.throws(() => validateQ(1), {message: 'q must be a string'})
  t.throws(() => validateQ(''), {message: 'q must contain between 3 and 200 chars and start with a number or a letter'})
  t.throws(() => validateQ('a'), {message: 'q must contain between 3 and 200 chars and start with a number or a letter'})
  t.throws(() => validateQ('aa'), {message: 'q must contain between 3 and 200 chars and start with a number or a letter'})
  t.throws(() => validateQ('-aaa'), {message: 'q must contain between 3 and 200 chars and start with a number or a letter'})
})

test('validateLimit', t => {
  t.is(validateLimit(1), 1)
  t.is(validateLimit(5), 5)
  t.is(validateLimit(100), 100)

  t.throws(() => validateLimit(0), {message: 'limit must be an integer between 1 and 100'})
  t.throws(() => validateLimit(-1), {message: 'limit must be an integer between 1 and 100'})
  t.throws(() => validateLimit(101), {message: 'limit must be an integer between 1 and 100'})
  t.throws(() => validateLimit(0.5), {message: 'limit must be an integer between 1 and 100'})
  t.throws(() => validateLimit('12'), {message: 'limit must be an integer between 1 and 100'})
  t.throws(() => validateLimit(Number.NaN), {message: 'limit must be an integer between 1 and 100'})
})

test('validateAutocomplete', t => {
  t.is(validateAutocomplete(true), true)
  t.is(validateAutocomplete(false), false)

  t.throws(() => validateAutocomplete(1), {message: 'autocomplete must be a boolean value'})
  t.throws(() => validateAutocomplete('false'), {message: 'autocomplete must be a boolean value'})
  t.throws(() => validateAutocomplete(), {message: 'autocomplete must be a boolean value'})
})

test('validateLonLat', t => {
  t.deepEqual(validateLonLat(1, 1), [1, 1])
  t.deepEqual(validateLonLat(10.5, 10), [10.5, 10])
  t.deepEqual(validateLonLat(0, 10.5), [0, 10.5])

  t.throws(() => validateLonLat(1, undefined), {message: 'lon/lat must be present together if defined'})
  t.throws(() => validateLonLat(undefined, 1), {message: 'lon/lat must be present together if defined'})
  t.throws(() => validateLonLat('12', '11'), {message: 'lon/lat must be float numbers'})
  t.throws(() => validateLonLat(192, 6.4), {message: 'lon/lat must be valid WGS-84 coordinates'})
  t.throws(() => validateLonLat(6.5, -95), {message: 'lon/lat must be valid WGS-84 coordinates'})
})

test('validateFilters', t => {
  t.deepEqual(validateFilters({}), {})
  t.deepEqual(validateFilters({foo: 'bar'}), {foo: 'bar'})
  t.deepEqual(validateFilters({foo: 'bar', cat: ''}), {foo: 'bar'})

  t.throws(() => validateFilters('a'), {message: 'filters are not valid'})
})

test('formatFilterValue', t => {
  // String values (backward compatibility)
  t.is(formatFilterValue('bar'), 'bar')
  t.is(formatFilterValue('75001'), '75001')

  // Array values (new feature)
  t.is(formatFilterValue(['bar', 'baz']), 'bar+baz')
  t.is(formatFilterValue(['75001', '75002', '75003']), '75001+75002+75003')
  t.is(formatFilterValue(['single']), 'single')

  // Empty array
  t.is(formatFilterValue([]), '')

  // Invalid values
  t.throws(() => formatFilterValue(123), {message: 'filter values must be strings or arrays of strings'})
  t.throws(() => formatFilterValue(['valid', 123]), {message: 'filter values must be strings or arrays of strings'})
  t.throws(() => formatFilterValue({foo: 'bar'}), {message: 'filter values must be strings or arrays of strings'})
})

test('validateFilters with array values', t => {
  // Single string values (backward compatibility)
  t.deepEqual(validateFilters({postcode: '75001'}), {postcode: '75001'})

  // Array values
  t.deepEqual(validateFilters({postcode: ['75001', '75002']}), {postcode: '75001+75002'})
  t.deepEqual(validateFilters({
    postcode: ['75001', '75002'],
    citycode: '75056'
  }), {
    postcode: '75001+75002',
    citycode: '75056'
  })

  // Mixed values
  t.deepEqual(validateFilters({
    type: 'street',
    postcode: ['75001', '75002', '75003']
  }), {
    type: 'street',
    postcode: '75001+75002+75003'
  })

  // Invalid filter values
  t.throws(() => validateFilters({postcode: 123}), {message: 'filter values must be strings or arrays of strings'})
  t.throws(() => validateFilters({postcode: ['valid', 123]}), {message: 'filter values must be strings or arrays of strings'})
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

test('validateParams / filters with array values', t => {
  t.deepEqual(validateParams({
    q: 'rue de la paix',
    filters: {
      postcode: ['75001', '75002'],
      type: 'street'
    }
  }), {
    q: 'rue de la paix',
    filters: {
      postcode: '75001+75002',
      type: 'street'
    }
  })
})

test('validateParams / invalid param', t => {
  t.throws(() => validateParams({limit: 0}), {message: 'limit must be an integer between 1 and 100'})
})

test('validateParams / no params', t => {
  t.deepEqual(validateParams({}), {})
})

test('validateParams / required params', t => {
  t.throws(() => validateParams({limit: 3}, ['q']), {message: 'q is a required parameter'})
})
