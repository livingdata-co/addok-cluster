import process from 'node:process'

export function redisUrlToConfig(redisUrl) {
  const {protocol, hostname, port} = new URL(redisUrl)

  if (protocol !== 'redis:') {
    throw new Error('Not supported connection string: ' + redisUrl)
  }

  return {host: hostname, port: port || '6379'}
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
