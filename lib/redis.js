/* eslint unicorn/no-process-exit: off */
import process from 'node:process'
import path from 'node:path'
import {mkdir, rm} from 'node:fs/promises'
import {execa} from 'execa'
import {customAlphabet} from 'nanoid'
import Redis from 'ioredis'

export function redisUrlToConfig(redisUrl) {
  const {protocol, hostname, port, pathname} = new URL(redisUrl)

  if (protocol === 'redis:') {
    return {host: hostname, port: port || '6379'}
  }

  if (protocol === 'unix:') {
    return {socketPath: pathname}
  }

  throw new Error('Not supported connection string: ' + redisUrl)
}

export function computeAddokRedisConfigs(addokRedisUrl) {
  if (!addokRedisUrl) {
    return [redisUrlToConfig('redis://localhost:6379')]
  }

  if (Array.isArray(addokRedisUrl)) {
    return addokRedisUrl.map(url => redisUrlToConfig(url))
  }

  return addokRedisUrl.split(',').map(url => redisUrlToConfig(url))
}

export function createRedisRoundRobin(redisConfigs) {
  let cursor = 0
  return {
    getConfig() {
      const config = redisConfigs[cursor++]

      if (cursor === redisConfigs.length) {
        cursor = 0
      }

      return config
    }
  }
}

const nanoid = customAlphabet('1234567890abcdef')

const PIDS_PATH = path.resolve('.', 'pids')

export async function createInstance(basePath, options = {}) {
  basePath = path.resolve(basePath)
  const instanceId = `${process.pid}-${nanoid(4)}`

  await mkdir(PIDS_PATH, {recursive: true})
  const redisSocketPath = path.join(PIDS_PATH, `redis-${instanceId}.sock`)

  await mkdir(basePath, {recursive: true})

  if (options.dropExistingDump) {
    await rm(path.join(basePath, 'dump.rdb'), {force: true})
  }

  const instance = execa('redis-server', ['--port', '0', '--save', '""', '--unixsocket', redisSocketPath, '--dir', basePath])
  instance.stdout.pipe(process.stdout)
  instance.stderr.pipe(process.stdout)

  function onExit(code, signal) {
    console.log(`Redis instance ${instanceId} exited with code ${code} and signal ${signal}`)

    if (options.crashOnFailure) {
      console.error('Redis has crashed. Now exiting…')
      process.exit(1)
    }
  }

  // Waiting for redis-server availability
  await new Promise((resolve, reject) => {
    function onData(data) {
      if (data.toString().toLowerCase().includes('ready to accept connections')) {
        instance.stdout.off('data', onData)
        instance.on('exit', onExit)
        resolve()
      }
    }

    instance.stdout.on('data', onData)

    if (options.startupTimeout) {
      setTimeout(() => {
        instance.stdout.off('data', onData)
        reject(new Error('redis-server startup timeout'))
      }, options.startupTimeout)
    }
  })

  return {
    async close(options = {}) {
      if (options.save) {
        const client = new Redis(redisSocketPath)
        await client.save()
        await client.quit()
      }

      instance.off('exit', onExit)
      instance.kill()
    },

    socketPath: redisSocketPath
  }
}
