const bluebird = require('bluebird')
const redis = require('redis')
const uuidv4 = require('uuid/v4')

bluebird.promisifyAll(redis)

/**
 * TODO
 * 可使用Script Load进行脚本缓存，但不知道怎么写
 */
const luaScript = "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end"

class LockManager {
	constructor() {
		this.client = redis.createClient()
	}

	async getLock(namespace, value = 1, { expireTime = 3 * 1000 } = {}) {
		const isSuccess = await this.client.setAsync(namespace, value, 'PX', expireTime, 'NX')
		return isSuccess === 'OK'
	}

	async deleteLock(namespace, value) {
		const isSuccess = await this.client.evalAsync(luaScript, 1, namespace, value)
		return isSuccess === 1
	}

	static getUUID() {
		return uuidv4({}, Buffer.alloc(16)).toString('hex')
	}

	async sync(namespace, callback, { expireTime = 30 * 1000, refreshingTime = 20 * 1000 } = {}) {
		const uuid = LockManager.getUUID()

		const getLockSuccess = await this.getLock(namespace, uuid, { expireTime })
		if (getLockSuccess) {
			let intervalId
			try {
				intervalId = setInterval(() => {
					this.client.pexpireAsync(namespace, expireTime)
				}, refreshingTime)
				const result = await callback()
				return { getLockSuccess, result }
			} finally {
				await this.deleteLock(namespace, uuid)
				if (intervalId) {
					clearInterval(intervalId)
				}
			}
		}
		return { getLockSuccess }
	}

	async close() {
		this.client.end(true)
	}
}

module.exports = LockManager
