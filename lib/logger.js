export function getLogger(logger) {
  if (logger === undefined || logger === true) {
    return {
      log: console.log,
      error: console.error
    }
  }

  if (typeof logger === 'object' && logger.log && logger.error) {
    return logger
  }

  if (logger === false) {
    return
  }

  throw new Error('logger must be a boolean or an object with log and error methods')
}
