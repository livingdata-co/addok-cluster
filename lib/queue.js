export function createQueue() {
  const _queue = {
    low: [],
    medium: [],
    high: []
  }

  return {
    getNext() {
      return _queue.high.shift() || _queue.medium.shift() || _queue.low.shift()
    },

    add(request) {
      const priority = request.priority || 'medium'

      if (!['high', 'medium', 'low'].includes(priority)) {
        throw new Error('Unknown priority: ' + priority)
      }

      _queue[priority].push({...request, addTime: new Date()})
    }
  }
}
