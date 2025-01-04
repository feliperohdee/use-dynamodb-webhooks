import _ from 'lodash';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import HttpError from 'use-http-error';
import qs from 'use-qs';

import Webhooks, { logShape } from './index';
import { afterEach } from 'node:test';

HttpError.includeStack = false;

// @ts-expect-error
global.fetch = vi.fn(async (url, options) => {
	if (url === 'https://httpbin.org/anything') {
		return {
			headers: new Headers({
				'content-type': 'application/json'
			}),
			ok: true,
			status: 200,
			text: async () => {
				return JSON.stringify({
					success: true,
					url,
					options
				});
			}
		};
	}

	return {
		headers: new Headers({
			'content-type': 'application/json'
		}),
		ok: false,
		status: 404,
		text: async () => {
			return JSON.stringify({
				error: 'Not Found'
			});
		}
	};
});

const createTestLog = (options?: Partial<Webhooks.Log>): Webhooks.Log => {
	return logShape({
		body: null,
		headers: {},
		id: crypto.randomUUID(),
		method: 'GET',
		namespace: 'spec',
		response: {
			body: '',
			headers: {},
			ok: true,
			status: 200
		},
		retries: {
			count: 0,
			max: 3
		},
		status: 'SUCCESS',
		ttl: Math.floor(Date.now() / 1000) + 3600,
		url: 'https://httpbin.org/anything',
		...options
	});
};

describe('/index', () => {
	let webhooks: Webhooks;

	beforeAll(() => {
		webhooks = new Webhooks({
			accessKeyId: process.env.AWS_ACCESS_KEY || '',
			createTable: true,
			region: process.env.AWS_REGION || '',
			secretAccessKey: process.env.AWS_SECRET_KEY || '',
			tableName: 'use-dynamodb-webhooks-spec',
			ttlInSeconds: 3600
		});
	});

	beforeEach(() => {
		webhooks = new Webhooks({
			accessKeyId: process.env.AWS_ACCESS_KEY || '',
			createTable: true,
			region: process.env.AWS_REGION || '',
			secretAccessKey: process.env.AWS_SECRET_KEY || '',
			tableName: 'use-dynamodb-webhooks-spec',
			ttlInSeconds: 3600
		});
	});

	afterAll(async () => {
		await webhooks.clearLogs('spec');
	});

	describe('clearLogs', () => {
		it('should clear logs for a namespace', async () => {
			await Promise.all(
				_.map([createTestLog(), createTestLog(), createTestLog()], log => {
					return webhooks.db.logs.put(log);
				})
			);

			const res = await webhooks.clearLogs('spec');
			expect(res.count).toEqual(3);

			const remaining = await webhooks.db.logs.query({
				item: { namespace: 'spec' }
			});
			expect(remaining.count).toEqual(0);
		});
	});

	describe('createFetchRequest', () => {
		describe('GET', () => {
			it('should returns adding qs', () => {
				const res = webhooks.createFetchRequest({
					body: { a: 1, b: 2 },
					headers: { a: '1' },
					method: 'GET',
					url: 'https://httpbin.org/anything'
				});

				expect(res.body).toBeNull();
				expect(Object.fromEntries(res.headers.entries())).toEqual({ a: '1' });
				expect(res.method).toEqual('GET');
				expect(res.url).toEqual('https://httpbin.org/anything?a=1&b=2');
			});

			it('should returns merging qs', () => {
				const res = webhooks.createFetchRequest({
					body: { a: 1, b: 2, c: 3 },
					headers: { a: '1' },
					method: 'GET',
					url: 'https://httpbin.org/anything?a=1&b=1'
				});

				expect(res.body).toBeNull();
				expect(Object.fromEntries(res.headers.entries())).toEqual({ a: '1' });
				expect(res.method).toEqual('GET');
				expect(res.url).toEqual('https://httpbin.org/anything?a=1&b=2&c=3');
			});

			it('should returns without qs', () => {
				const res = webhooks.createFetchRequest({
					body: null,
					headers: { a: '1' },
					method: 'GET',
					url: 'https://httpbin.org/anything'
				});

				expect(res.body).toBeNull();
				expect(Object.fromEntries(res.headers.entries())).toEqual({ a: '1' });
				expect(res.method).toEqual('GET');
				expect(res.url).toEqual('https://httpbin.org/anything');
			});
		});

		describe('POST', () => {
			it('should returns', () => {
				const res = webhooks.createFetchRequest({
					body: { a: 1, b: 2 },
					headers: { a: '1' },
					method: 'POST',
					url: 'https://httpbin.org/anything?a=1&b=2'
				});

				expect(res.body).toEqual(JSON.stringify({ a: 1, b: 2 }));
				expect(Object.fromEntries(res.headers.entries())).toEqual({ a: '1' });
				expect(res.method).toEqual('POST');
				expect(res.url).toEqual('https://httpbin.org/anything?a=1&b=2');
			});

			it('should returns with application/x-www-form-urlencoded', () => {
				const res = webhooks.createFetchRequest({
					body: { a: 1, b: 2 },
					headers: { 'content-type': 'application/x-www-form-urlencoded' },
					method: 'POST',
					url: 'https://httpbin.org/anything?a=1&b=2'
				});

				expect(res.body).toEqual(qs.stringify({ a: 1, b: 2 }, { addQueryPrefix: false }));
				expect(Object.fromEntries(res.headers.entries())).toEqual({ 'content-type': 'application/x-www-form-urlencoded' });
				expect(res.method).toEqual('POST');
				expect(res.url).toEqual('https://httpbin.org/anything?a=1&b=2');
			});

			it('should returns with multipart/form-data', () => {
				const res = webhooks.createFetchRequest({
					body: { a: 1, b: 2 },
					headers: { 'content-type': 'multipart/form-data' },
					method: 'POST',
					url: 'https://httpbin.org/anything?a=1&b=2'
				});

				const formData = new FormData();
				formData.append('a', '1');
				formData.append('b', '2');

				expect(res.body).toEqual(formData);
				expect(Object.fromEntries(res.headers.entries())).toEqual({ 'content-type': 'multipart/form-data' });
				expect(res.method).toEqual('POST');
				expect(res.url).toEqual('https://httpbin.org/anything?a=1&b=2');
			});

			it('should returns without body', () => {
				const res = webhooks.createFetchRequest({
					body: null,
					headers: { a: '1' },
					method: 'POST',
					url: 'https://httpbin.org/anything'
				});

				expect(res.body).toBeNull();
				expect(Object.fromEntries(res.headers.entries())).toEqual({ a: '1' });
				expect(res.method).toEqual('POST');
				expect(res.url).toEqual('https://httpbin.org/anything');
			});
		});
	});

	describe('fetchLogs', () => {
		let logs: Webhooks.Log[] = [];

		beforeAll(async () => {
			for (let i = 0; i < 3; i++) {
				// ensure logs are created in order
				await new Promise(resolve => {
					setTimeout(resolve, 10);
				});

				const log = await webhooks.putLog(
					createTestLog({
						status: i % 2 === 0 ? 'SUCCESS' : 'FAIL'
					})
				);
				logs = [...logs, log];
			}
		});

		beforeEach(() => {
			vi.spyOn(webhooks.db.logs, 'query');
		});

		afterAll(async () => {
			await webhooks.clearLogs('spec');
		});

		it('should fetch by [namespace]', async () => {
			const res = await webhooks.fetchLogs({
				namespace: 'spec'
			});

			expect(webhooks.db.logs.query).toHaveBeenCalledWith({
				attributeNames: {},
				attributeValues: {},
				filterExpression: '',
				index: 'namespace-createdAt',
				item: { namespace: 'spec' },
				limit: 100,
				queryExpression: '',
				scanIndexForward: true,
				startKey: null
			});

			expect(res).toEqual({
				count: 3,
				items: logs,
				lastEvaluatedKey: null
			});
		});

		it('should fetch by [namespace] with limit, startKey', async () => {
			const res = await webhooks.fetchLogs({
				limit: 2,
				namespace: 'spec'
			});

			expect(webhooks.db.logs.query).toHaveBeenCalledWith({
				attributeNames: {},
				attributeValues: {},
				filterExpression: '',
				index: 'namespace-createdAt',
				item: { namespace: 'spec' },
				limit: 2,
				queryExpression: '',
				scanIndexForward: true,
				startKey: null
			});

			expect(res).toEqual({
				count: 2,
				items: _.take(logs, 2),
				lastEvaluatedKey: _.pick(logs[1], ['__createdAt', 'id', 'namespace'])
			});

			const res2 = await webhooks.fetchLogs({
				limit: 2,
				namespace: 'spec',
				startKey: res.lastEvaluatedKey
			});

			expect(webhooks.db.logs.query).toHaveBeenCalledWith({
				attributeNames: {},
				attributeValues: {},
				filterExpression: '',
				index: 'namespace-createdAt',
				item: { namespace: 'spec' },
				limit: 2,
				queryExpression: '',
				scanIndexForward: true,
				startKey: res.lastEvaluatedKey
			});

			expect(res2).toEqual({
				count: 1,
				items: [logs[2]],
				lastEvaluatedKey: null
			});
		});

		it('should fetch by [namespace] desc', async () => {
			const res = await webhooks.fetchLogs({
				desc: true,
				namespace: 'spec'
			});

			expect(webhooks.db.logs.query).toHaveBeenCalledWith({
				attributeNames: {},
				attributeValues: {},
				filterExpression: '',
				index: 'namespace-createdAt',
				item: { namespace: 'spec' },
				limit: 100,
				queryExpression: '',
				scanIndexForward: false,
				startKey: null
			});

			expect(res).toEqual({
				count: 3,
				items: [...logs].reverse(),
				lastEvaluatedKey: null
			});
		});

		it('should fetch by [namespace, from, to]', async () => {
			const res = await webhooks.fetchLogs({
				namespace: 'spec',
				from: '2023-01-01T00:00:00Z',
				to: '2023-01-02T00:00:00Z'
			});

			expect(webhooks.db.logs.query).toHaveBeenCalledWith({
				attributeNames: {
					'#__createdAt': '__createdAt'
				},
				attributeValues: {
					':from': '2023-01-01T00:00:00Z',
					':to': '2023-01-02T00:00:00Z'
				},
				filterExpression: '',
				index: 'namespace-createdAt',
				item: { namespace: 'spec' },
				limit: 100,
				queryExpression: '#__createdAt BETWEEN :from AND :to',
				scanIndexForward: true,
				startKey: null
			});

			expect(res).toEqual({
				count: 0,
				items: [],
				lastEvaluatedKey: null
			});
		});

		it('should fetch by [namespace, status]', async () => {
			const res = await webhooks.fetchLogs({
				namespace: 'spec',
				status: 'SUCCESS'
			});

			expect(webhooks.db.logs.query).toHaveBeenCalledWith({
				attributeNames: {
					'#status': 'status'
				},
				attributeValues: {
					':status': 'SUCCESS'
				},
				filterExpression: '#status = :status',
				index: 'namespace-createdAt',
				item: { namespace: 'spec' },
				limit: 100,
				queryExpression: '',
				scanIndexForward: true,
				startKey: null
			});

			expect(res).toEqual({
				count: 2,
				items: _.filter(logs, { status: 'SUCCESS' }),
				lastEvaluatedKey: null
			});
		});

		it('should fetch by [namespace, status, from, to]', async () => {
			const res = await webhooks.fetchLogs({
				from: '2023-01-01T00:00:00Z',
				namespace: 'spec',
				status: 'SUCCESS',
				to: '2023-01-02T00:00:00Z'
			});

			expect(webhooks.db.logs.query).toHaveBeenCalledWith({
				attributeNames: {
					'#__createdAt': '__createdAt',
					'#status': 'status'
				},
				attributeValues: {
					':from': '2023-01-01T00:00:00Z',
					':status': 'SUCCESS',
					':to': '2023-01-02T00:00:00Z'
				},
				filterExpression: '#status = :status',
				index: 'namespace-createdAt',
				item: { namespace: 'spec' },
				limit: 100,
				queryExpression: '#__createdAt BETWEEN :from AND :to',
				scanIndexForward: true,
				startKey: null
			});

			expect(res).toEqual({
				count: 0,
				items: [],
				lastEvaluatedKey: null
			});
		});

		it('should fetch by [namespace, id]', async () => {
			const res = await webhooks.fetchLogs({
				id: logs[0].id.slice(0, 8),
				namespace: 'spec'
			});

			expect(webhooks.db.logs.query).toHaveBeenCalledWith({
				attributeNames: {},
				attributeValues: {},
				filterExpression: '',
				item: { namespace: 'spec', id: logs[0].id.slice(0, 8) },
				limit: 100,
				prefix: true,
				scanIndexForward: true,
				startKey: null
			});

			expect(res).toEqual({
				count: 1,
				items: [logs[0]],
				lastEvaluatedKey: null
			});
		});

		it('should fetch by [namespace, id] with idPrefix = false', async () => {
			const res = await webhooks.fetchLogs({
				id: logs[0].id.slice(0, 8),
				idPrefix: false,
				namespace: 'spec'
			});

			expect(webhooks.db.logs.query).toHaveBeenCalledWith({
				attributeNames: {},
				attributeValues: {},
				filterExpression: '',
				item: { namespace: 'spec', id: logs[0].id.slice(0, 8) },
				limit: 100,
				prefix: false,
				scanIndexForward: true,
				startKey: null
			});

			expect(res).toEqual({
				count: 0,
				items: [],
				lastEvaluatedKey: null
			});
		});

		it('should fetch by [namespace, id, from, to]', async () => {
			const res = await webhooks.fetchLogs({
				from: '2023-01-01T00:00:00Z',
				id: logs[0].id.slice(0, 8),
				namespace: 'spec',
				to: '2023-01-02T00:00:00Z'
			});

			expect(webhooks.db.logs.query).toHaveBeenCalledWith({
				attributeNames: {
					'#__createdAt': '__createdAt'
				},
				attributeValues: {
					':from': '2023-01-01T00:00:00Z',
					':to': '2023-01-02T00:00:00Z'
				},
				filterExpression: '#__createdAt BETWEEN :from AND :to',
				item: { namespace: 'spec', id: logs[0].id.slice(0, 8) },
				limit: 100,
				prefix: true,
				scanIndexForward: true,
				startKey: null
			});

			expect(res).toEqual({
				count: 0,
				items: [],
				lastEvaluatedKey: null
			});
		});

		it('should fetch by [namespace, id, status]', async () => {
			const res = await webhooks.fetchLogs({
				id: logs[0].id.slice(0, 8),
				namespace: 'spec',
				status: 'SUCCESS'
			});

			expect(webhooks.db.logs.query).toHaveBeenCalledWith({
				attributeNames: {
					'#status': 'status'
				},
				attributeValues: {
					':status': 'SUCCESS'
				},
				filterExpression: '#status = :status',
				item: { namespace: 'spec', id: logs[0].id.slice(0, 8) },
				limit: 100,
				prefix: true,
				scanIndexForward: true,
				startKey: null
			});

			expect(res).toEqual({
				count: 1,
				items: [logs[0]],
				lastEvaluatedKey: null
			});
		});

		it('should fetch by [namespace, id, status, from, to]', async () => {
			const res = await webhooks.fetchLogs({
				from: '2023-01-01T00:00:00Z',
				id: logs[0].id.slice(0, 8),
				namespace: 'spec',
				status: 'SUCCESS',
				to: '2023-01-02T00:00:00Z'
			});

			expect(webhooks.db.logs.query).toHaveBeenCalledWith({
				attributeNames: {
					'#__createdAt': '__createdAt',
					'#status': 'status'
				},
				attributeValues: {
					':from': '2023-01-01T00:00:00Z',
					':status': 'SUCCESS',
					':to': '2023-01-02T00:00:00Z'
				},
				filterExpression: '#__createdAt BETWEEN :from AND :to AND #status = :status',
				item: { namespace: 'spec', id: logs[0].id.slice(0, 8) },
				limit: 100,
				prefix: true,
				scanIndexForward: true,
				startKey: null
			});

			expect(res).toEqual({
				count: 0,
				items: [],
				lastEvaluatedKey: null
			});
		});
	});

	describe('putLog', () => {
		afterEach(async () => {
			await webhooks.clearLogs('spec');
		});

		it('should put', async () => {
			const res = await webhooks.putLog({
				body: null,
				headers: {},
				id: '123',
				method: 'GET',
				namespace: 'spec',
				response: {
					body: '',
					headers: {},
					ok: true,
					status: 200
				},
				retries: { count: 0, max: 3 },
				status: 'SUCCESS',
				ttl: 0,
				url: 'https://httpbin.org/anything'
			});

			expect(res).toEqual({
				__createdAt: expect.any(String),
				__updatedAt: expect.any(String),
				body: null,
				headers: {},
				id: '123',
				method: 'GET',
				namespace: 'spec',
				response: {
					body: '',
					headers: {},
					ok: true,
					status: 200
				},
				retries: { count: 0, max: 3 },
				status: 'SUCCESS',
				ttl: 0,
				url: 'https://httpbin.org/anything'
			});
		});
	});

	describe('trigger', () => {
		beforeEach(() => {
			vi.spyOn(webhooks, 'putLog');
		});

		afterAll(async () => {
			await webhooks.clearLogs('spec');
		});

		it('should validate args', async () => {
			const invalidInput = {
				namespace: 'spec'
			};

			try {
				await webhooks.trigger(invalidInput as any);

				throw new Error('Expected to throw');
			} catch (err) {
				expect(webhooks.putLog).not.toHaveBeenCalled();
				expect((err as HttpError).toJson()).toEqual({
					context: [
						{
							code: 'invalid_type',
							expected: 'string',
							received: 'undefined',
							path: ['url'],
							message: 'Required'
						}
					],
					message: 'Validation FAIL',
					stack: [],
					status: 400
				});
			}
		});

		it('should trigger', async () => {
			const res = await webhooks.trigger({
				body: { test: true },
				headers: {
					'content-type': 'application/json'
				},
				method: 'POST',
				namespace: 'spec',
				url: 'https://httpbin.org/anything'
			});

			expect(global.fetch).toHaveBeenCalledWith('https://httpbin.org/anything', {
				body: JSON.stringify({ test: true }),
				headers: new Headers({
					'content-type': 'application/json'
				}),
				method: 'POST'
			});

			expect(webhooks.putLog).toHaveBeenCalledWith({
				body: { test: true },
				headers: {
					'content-type': 'application/json'
				},
				id: expect.any(String),
				method: 'POST',
				namespace: 'spec',
				response: {
					body: '{"success":true,"url":"https://httpbin.org/anything","options":{"body":"{\\"test\\":true}","method":"POST","headers":{}}}',
					headers: {
						'content-type': 'application/json'
					},
					ok: true,
					status: 200
				},
				retries: {
					count: 0,
					max: 3
				},
				status: 'SUCCESS',
				ttl: expect.any(Number),
				url: 'https://httpbin.org/anything'
			});

			expect(res).toEqual({
				__createdAt: expect.any(String),
				__updatedAt: expect.any(String),
				body: { test: true },
				headers: {
					'content-type': 'application/json'
				},
				id: expect.any(String),
				method: 'POST',
				namespace: 'spec',
				response: {
					body: '{"success":true,"url":"https://httpbin.org/anything","options":{"body":"{\\"test\\":true}","method":"POST","headers":{}}}',
					headers: {
						'content-type': 'application/json'
					},
					ok: true,
					status: 200
				},
				retries: {
					count: 0,
					max: 3
				},
				status: 'SUCCESS',
				ttl: expect.any(Number),
				url: 'https://httpbin.org/anything'
			});
		});

		it('should retry', async () => {
			vi.spyOn(global, 'fetch').mockImplementation(async () => {
				return Response.json(
					{},
					{
						status: 500
					}
				);
			});

			const res = await webhooks.trigger({
				body: { test: true },
				namespace: 'spec',
				url: 'https://httpbin.org/anything'
			});

			expect(global.fetch).toHaveBeenCalledTimes(4);
			expect(webhooks.putLog).toHaveBeenCalledTimes(4);

			expect(res).toEqual({
				__createdAt: expect.any(String),
				__updatedAt: expect.any(String),
				body: { test: true },
				headers: null,
				id: expect.any(String),
				method: 'GET',
				namespace: 'spec',
				response: {
					body: '{}',
					headers: {
						'content-type': 'application/json'
					},
					ok: false,
					status: 500
				},
				retries: {
					count: 3,
					max: 3
				},
				status: 'FAIL',
				ttl: expect.any(Number),
				url: 'https://httpbin.org/anything?test=true'
			});
		});

		it('should handle exceptions', async () => {
			vi.spyOn(global, 'fetch').mockRejectedValue(new Error('FAIL to fetch'));

			const res = await webhooks.trigger({
				maxRetries: 2,
				namespace: 'spec',
				url: 'https://invalid-url.com'
			});

			expect(webhooks.putLog).toHaveBeenCalledWith({
				body: null,
				headers: null,
				id: expect.any(String),
				method: 'GET',
				namespace: 'spec',
				response: {
					body: '{"context":null,"message":"FAIL to fetch","stack":[],"status":500}',
					headers: {},
					ok: false,
					status: 500
				},
				retries: { count: 0, max: 2 },
				status: 'FAIL',
				ttl: expect.any(Number),
				url: 'https://invalid-url.com'
			});

			expect(res).toEqual({
				__createdAt: expect.any(String),
				__updatedAt: expect.any(String),
				body: null,
				headers: null,
				id: expect.any(String),
				method: 'GET',
				namespace: 'spec',
				response: {
					body: '{"context":null,"message":"FAIL to fetch","stack":[],"status":500}',
					headers: {},
					ok: false,
					status: 500
				},
				retries: { count: 0, max: 2 },
				status: 'FAIL',
				ttl: expect.any(Number),
				url: 'https://invalid-url.com'
			});
		});
	});

	describe('uuid', () => {
		it('should generate a uuid', () => {
			const res = webhooks.uuid();
			expect(res).toEqual(expect.any(String));
		});

		it('should generate a uuid with idPrefix', () => {
			const res = webhooks.uuid('123');
			expect(res).toMatch(/^123#.*$/);
		});
	});
});
