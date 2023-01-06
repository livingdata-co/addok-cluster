import process from 'node:process'

import test from 'ava'
import {redisUrlToConfig, computeAddokRedisConfigs, createRedisRoundRobin} from '../lib/redis.js'

test('redisUrlToConfig', t => {
  t.deepEqual(redisUrlToConfig('redis://foo:12345'), {host: 'foo', port: '12345'})
  t.deepEqual(redisUrlToConfig('redis://localhost'), {host: 'localhost', port: '6379'})
  t.throws(() => redisUrlToConfig('http://foo'))
})

test('computeAddokRedisConfigs / env var', t => {
  process.env.ADDOK_REDIS_URL = 'redis://localhost:6379,redis://localhost:6380'
  t.deepEqual(computeAddokRedisConfigs(), [
    {host: 'localhost', port: '6379'},
    {host: 'localhost', port: '6380'}
  ])
})

test('computeAddokRedisConfigs / param', t => {
  delete process.env.ADDOK_REDIS_URL

  t.deepEqual(computeAddokRedisConfigs(['redis://foo:6379', 'redis://bar:6380']), [
    {host: 'foo', port: '6379'},
    {host: 'bar', port: '6380'}
  ])
})

test('computeAddokRedisConfigs / default', t => {
  delete process.env.ADDOK_REDIS_URL

  t.deepEqual(computeAddokRedisConfigs(), [
    {host: 'localhost', port: '6379'}
  ])
})

test('createRedisRoundRobin', t => {
  const redisConfigs = [
    {host: 'foo', port: '6379'},
    {host: 'bar', port: '6380'}
  ]

  const rr = createRedisRoundRobin(redisConfigs)
  t.deepEqual(rr.getConfig(), {host: 'foo', port: '6379'})
  t.deepEqual(rr.getConfig(), {host: 'bar', port: '6380'})
  t.deepEqual(rr.getConfig(), {host: 'foo', port: '6379'})
})
