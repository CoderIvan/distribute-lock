/* eslint-env mocha */
const { expect } = require('chai') // eslint-disable-line import/no-extraneous-dependencies
const redis = require('redis')
const bluebird = require('bluebird')

bluebird.promisifyAll(redis)

const LockManager = require('../')

describe('一般测试', () => {
	let lockManager
	let redisClient

	async function checkEmpty() {
		const keys = await redisClient.keysAsync('*')
		if (keys && keys.length > 0) {
			throw new Error('db in redis is not empty')
		}
	}

	before(async () => {
		if (!redisClient) {
			redisClient = redis.createClient()
		}
		await checkEmpty()
		lockManager = new LockManager()
	})

	beforeEach(() => redisClient.flushdbAsync())

	afterEach(() => redisClient.flushdbAsync())

	after(async () => {
		await checkEmpty()
		if (redisClient) {
			redisClient.end(false)
		}
		await lockManager.close()
	})

	it('redis client 正常创建与关闭', async () => {})

	it('基本获取锁操作', async () => {
		const result = await lockManager.getLock('Test')
		expect(result).equal(true)
	})

	it('2个操作同时获取锁操作，前一个成功，后一个失败', async () => {
		const success = await lockManager.getLock('Test')
		expect(success).equal(true)
		const fail = await lockManager.getLock('Test')
		expect(fail).equal(false)
	})

	it('正常获取锁然后释放锁', async () => {
		const getLock = await lockManager.getLock('Test', '1')
		expect(getLock).equal(true)
		const deleteLock = await lockManager.deleteLock('Test', '1')
		expect(deleteLock).equal(true)
	})

	it('2个操作同时获取锁操作，前者成功，后者失败，前者放锁后，后者再获取锁成功', async () => {
		const success = await lockManager.getLock('Test', '1')
		expect(success).equal(true)
		const fail = await lockManager.getLock('Test', '2')
		expect(fail).equal(false)
		const deleteLock = await lockManager.deleteLock('Test', '1')
		expect(deleteLock).equal(true)
		const secondGetLock = await lockManager.getLock('Test', '2')
		expect(secondGetLock).equal(true)
	})

	it('2个操作同时获取锁操作，前者成功，后者失败，后者不能解锁前者', async () => {
		const success = await lockManager.getLock('Test', '1')
		expect(success).equal(true)
		const fail = await lockManager.getLock('Test', '2')
		expect(fail).equal(false)
		const deleteLock = await lockManager.deleteLock('Test', '2')
		expect(deleteLock).equal(false)
		const getAgain = await lockManager.getLock('Test', '2')
		expect(getAgain).equal(false)
	})

	it('uuid是32位字符串', async () => {
		const uuid = LockManager.getUUID()
		expect(uuid).lengthOf(32)
	})

	describe('sync', () => {
		it('正常运行', async () => {
			const expectedMessage = 'Hello World'
			const { getLockSuccess, result } = await lockManager.sync('Test', async () => expectedMessage, { expireTime: 1000 })
			expect(getLockSuccess).equal(true)
			expect(result).equal(expectedMessage)
		})

		function setPromiseTimeout(ms) {
			return new Promise((resolve) => {
				setTimeout(() => {
					resolve()
				}, ms)
			})
		}

		it('并发时只有一个被执行', async () => {
			let i = 0
			const results = await Promise.all([
				lockManager.sync('Test', async () => {
					i += 1
					await setPromiseTimeout(200)
					return 'Hello World'
				}, { expireTime: 1000, refreshingTime: 800 }),
				lockManager.sync('Test', async () => {
					i += 1
					await setPromiseTimeout(200)
					return 'Hello World'
				}, { expireTime: 1000, refreshingTime: 800 }),
			])
			expect(results[0].getLockSuccess).equal(true)
			expect(results[0].result).equal('Hello World')
			expect(results[1].getLockSuccess).equal(false)
			expect(i).equal(1)
		})

		it('当执行时间比ExpireTime长时，不能出现并发情况', async () => {
			let i = 0
			const results = await Promise.all([
				lockManager.sync('Test', async () => {
					i += 1
					await setPromiseTimeout(200)
					return 'Hello World'
				}, { expireTime: 100, refreshingTime: 80 }),
				((async () => {
					await setPromiseTimeout(150)
					return lockManager.sync('Test', async () => {
						i += 1
						await setPromiseTimeout(200)
						return 'Hello World'
					}, { expireTime: 100, refreshingTime: 80 })
				})()),
			])
			expect(results[0].getLockSuccess).equal(true)
			expect(results[0].result).equal('Hello World')
			expect(results[1].getLockSuccess).equal(false)
			expect(i).equal(1)
		})

		it('当执行时间比ExpireTime长时，其它进程不能获取锁', async () => {
			const resultPromise = lockManager.sync('Test', async () => {
				await setPromiseTimeout(1500)
				return 'Hello World'
			}, { expireTime: 100, refreshingTime: 20 })

			const results = []
			const intervalId = setInterval(async () => {
				const r = await lockManager.sync('Test', async () => 'Hello World', { expireTime: 1000, refreshingTime: 800 })
				results.push(r)
			}, 100)
			const { getLockSuccess, result } = await resultPromise
			expect(getLockSuccess).equal(true)
			expect(result).equal('Hello World')
			clearInterval(intervalId)
			results.forEach((r) => {
				expect(r.getLockSuccess).equal(false)
			})
		})
	})
})
