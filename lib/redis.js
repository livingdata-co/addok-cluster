import process from 'node:process'
import path from 'node:path'
import {mkdir, rm} from 'node:fs/promises'
import {execa} from 'execa'
import {customAlphabet} from 'nanoid'
import Redis from 'ioredis'

const nanoid = customAlphabet('1234567890abcdef')

const PIDS_PATH = path.resolve('.', 'pids')

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
  let addokRedisUrlList

  if (addokRedisUrl) {
    addokRedisUrlList = Array.isArray(addokRedisUrl) ? addokRedisUrl : [addokRedisUrl]
  } else if (process.env.ADDOK_REDIS_URL) {
    addokRedisUrlList = process.env.ADDOK_REDIS_URL.split(',')
  } else {
    addokRedisUrlList = ['redis://localhost:6379']
  }

  return addokRedisUrlList.map(url => redisUrlToConfig(url))
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

export async function createInstance(basePath, options = {}) {
  basePath = path.resolve(basePath)
  const instanceId = `${process.pid}-${nanoid(4)}`

  await mkdir(PIDS_PATH, {recursive: true})
  const redisSocketPath = path.join(PIDS_PATH, `redis-${instanceId}.sock`)

  await mkdir(basePath, {recursive: true})

  if (options.dropExistingDump) {
    await rm(path.join(basePath, 'dump.rdb'), {force: true})
  }

  const instance = execa('redis-server', [
    '--port',
    '0',
    '--save',
    '""',
    '--unixsocket',
    redisSocketPath,
    '--dir',
    basePath
  ])

  instance.stdout.pipe(process.stdout)
  instance.stderr.pipe(process.stdout)

  await new Promise(resolve => {
    function onData(data) {
      if (data.toString().includes('ready to accept connections')) {
        resolve()
      }
    }

    instance.stdout.on('data', onData)
  })

  return {
    async close(options = {}) {
      if (options.save) {
        const client = new Redis(`unix:${redisSocketPath}`)
        await client.save()
        await client.quit()
      }

      instance.kill()
    },
    socketPath: redisSocketPath
  }
}
