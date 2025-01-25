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
		id: crypto.randomUUID(),
		metadata: {
			string: 'string',
			number: 1,
			boolean: true,
			null: null,
			undefined: undefined
		},
		namespace: 'spec',
		requestBody: null,
		requestHeaders: {},
		requestMethod: 'GET',
		requestUrl: 'https://httpbin.org/anything',
		responseBody: '',
		responseHeaders: {},
		responseOk: true,
		responseStatus: 200,
		retryCount: 0,
		retryLimit: 3,
		status: 'SUCCESS',
		ttl: Math.floor(Date.now() / 1000) + 3600,
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

		vi.mocked(global.fetch).mockClear();
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
				// @ts-expect-error
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
				// @ts-expect-error
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
				// @ts-expect-error
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
				// @ts-expect-error
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
				// @ts-expect-error
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
				// @ts-expect-error
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
				// @ts-expect-error
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

				// @ts-expect-error
				const log = await webhooks.putLog(
					createTestLog({
						metadata:
							i % 2 === 0
								? {
										string: 'string',
										number: 1,
										boolean: true,
										null: null,
										undefined: undefined
									}
								: {},
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
				attributeNames: { '#namespace': 'namespace' },
				attributeValues: { ':namespace': 'spec' },
				filterExpression: '',
				index: 'namespace-createdAt',
				limit: 100,
				queryExpression: '#namespace = :namespace',
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
				attributeNames: { '#namespace': 'namespace' },
				attributeValues: { ':namespace': 'spec' },
				filterExpression: '',
				index: 'namespace-createdAt',
				limit: 2,
				queryExpression: '#namespace = :namespace',
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
				attributeNames: { '#namespace': 'namespace' },
				attributeValues: { ':namespace': 'spec' },
				filterExpression: '',
				index: 'namespace-createdAt',
				limit: 2,
				queryExpression: '#namespace = :namespace',
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
				attributeNames: { '#namespace': 'namespace' },
				attributeValues: { ':namespace': 'spec' },
				filterExpression: '',
				index: 'namespace-createdAt',
				limit: 100,
				queryExpression: '#namespace = :namespace',
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
					'#__createdAt': '__createdAt',
					'#namespace': 'namespace'
				},
				attributeValues: {
					':from': '2023-01-01T00:00:00Z',
					':namespace': 'spec',
					':to': '2023-01-02T00:00:00Z'
				},
				filterExpression: '',
				index: 'namespace-createdAt',
				limit: 100,
				queryExpression: '#namespace = :namespace AND #__createdAt BETWEEN :from AND :to',
				scanIndexForward: true,
				startKey: null
			});

			expect(res).toEqual({
				count: 0,
				items: [],
				lastEvaluatedKey: null
			});
		});

		it('should fetch by [namespace, metadata]', async () => {
			const res = await webhooks.fetchLogs({
				metadata: {
					string: 'string',
					number: 1,
					boolean: true,
					null: null,
					undefined: undefined
				},
				namespace: 'spec'
			});

			expect(webhooks.db.logs.query).toHaveBeenCalledWith({
				attributeNames: {
					'#boolean': 'boolean',
					'#metadata': 'metadata',
					'#namespace': 'namespace',
					'#number': 'number',
					'#null': 'null',
					'#string': 'string'
				},
				attributeValues: {
					':boolean': true,
					':namespace': 'spec',
					':number': 1,
					':null': null,
					':string': 'string'
				},
				filterExpression: [
					'#metadata.#string = :string',
					'#metadata.#number = :number',
					'#metadata.#boolean = :boolean',
					'#metadata.#null = :null'
				].join(' AND '),
				index: 'namespace-createdAt',
				limit: 100,
				queryExpression: '#namespace = :namespace',
				scanIndexForward: true,
				startKey: null
			});

			expect(res).toEqual({
				count: 2,
				items: _.filter(logs, log => {
					return log.metadata.string === 'string';
				}),
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
					'#namespace': 'namespace',
					'#status': 'status'
				},
				attributeValues: {
					':namespace': 'spec',
					':status': 'SUCCESS'
				},
				filterExpression: '#status = :status',
				index: 'namespace-createdAt',
				limit: 100,
				queryExpression: '#namespace = :namespace',
				scanIndexForward: true,
				startKey: null
			});

			expect(res).toEqual({
				count: 2,
				items: _.filter(logs, { status: 'SUCCESS' }),
				lastEvaluatedKey: null
			});
		});

		it('should fetch by [namespace, metadata, status, from, to]', async () => {
			const res = await webhooks.fetchLogs({
				from: '2023-01-01T00:00:00Z',
				metadata: {
					string: 'string',
					number: 1,
					boolean: true,
					null: null,
					undefined: undefined
				},
				namespace: 'spec',
				status: 'SUCCESS',
				to: '2023-01-02T00:00:00Z'
			});

			expect(webhooks.db.logs.query).toHaveBeenCalledWith({
				attributeNames: {
					'#__createdAt': '__createdAt',
					'#boolean': 'boolean',
					'#metadata': 'metadata',
					'#namespace': 'namespace',
					'#number': 'number',
					'#null': 'null',
					'#string': 'string',
					'#status': 'status'
				},
				attributeValues: {
					':boolean': true,
					':from': '2023-01-01T00:00:00Z',
					':namespace': 'spec',
					':number': 1,
					':null': null,
					':status': 'SUCCESS',
					':string': 'string',
					':to': '2023-01-02T00:00:00Z'
				},
				filterExpression: [
					'#metadata.#string = :string',
					'#metadata.#number = :number',
					'#metadata.#boolean = :boolean',
					'#metadata.#null = :null',
					'#status = :status'
				].join(' AND '),
				index: 'namespace-createdAt',
				limit: 100,
				queryExpression: '#namespace = :namespace AND #__createdAt BETWEEN :from AND :to',
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
			// @ts-expect-error
			const res = await webhooks.putLog({
				id: '123',
				namespace: 'spec',
				requestBody: null,
				requestHeaders: {},
				requestMethod: 'GET',
				requestUrl: 'https://httpbin.org/anything',
				responseBody: '',
				responseHeaders: {},
				responseOk: true,
				responseStatus: 200,
				retryCount: 0,
				retryLimit: 3,
				status: 'SUCCESS',
				ttl: 0
			});

			expect(res).toEqual({
				__createdAt: expect.any(String),
				__updatedAt: expect.any(String),
				id: '123',
				metadata: {},
				namespace: 'spec',
				requestBody: null,
				requestHeaders: {},
				requestMethod: 'GET',
				requestUrl: 'https://httpbin.org/anything',
				responseBody: '',
				responseHeaders: {},
				responseOk: true,
				responseStatus: 200,
				retryCount: 0,
				retryLimit: 3,
				status: 'SUCCESS',
				ttl: 0
			});
		});
	});

	describe('trigger', () => {
		beforeEach(() => {
			// @ts-expect-error
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
				// @ts-expect-error
				expect(webhooks.putLog).not.toHaveBeenCalled();
				expect((err as HttpError).toJson()).toEqual({
					context: [
						{
							code: 'invalid_type',
							expected: 'string',
							received: 'undefined',
							path: ['requestUrl'],
							message: 'Required'
						}
					],
					message: 'Validation Error',
					stack: [],
					status: 400
				});
			}
		});

		it('should trigger', async () => {
			const res = await webhooks.trigger({
				metadata: {
					string: 'string',
					number: 1,
					boolean: true,
					null: null,
					undefined: undefined
				},
				namespace: 'spec',
				requestBody: { test: true },
				requestHeaders: {
					'content-type': 'application/json'
				},
				requestMethod: 'POST',
				requestUrl: 'https://httpbin.org/anything'
			});

			expect(global.fetch).toHaveBeenCalledWith('https://httpbin.org/anything', {
				body: JSON.stringify({ test: true }),
				headers: new Headers({
					'content-type': 'application/json'
				}),
				method: 'POST'
			});

			// @ts-expect-error
			expect(webhooks.putLog).toHaveBeenCalledWith({
				id: expect.any(String),
				metadata: {
					string: 'string',
					number: 1,
					boolean: true,
					null: null
				},
				namespace: 'spec',
				requestBody: { test: true },
				requestHeaders: { 'content-type': 'application/json' },
				requestMethod: 'POST',
				requestUrl: 'https://httpbin.org/anything',
				responseBody:
					'{"success":true,"url":"https://httpbin.org/anything","options":{"body":"{\\"test\\":true}","method":"POST","headers":{}}}',
				responseHeaders: { 'content-type': 'application/json' },
				responseOk: true,
				responseStatus: 200,
				retryCount: 0,
				retryLimit: 3,
				status: 'SUCCESS',
				ttl: expect.any(Number)
			});

			expect(res).toEqual({
				__createdAt: expect.any(String),
				__updatedAt: expect.any(String),
				id: expect.any(String),
				metadata: {
					string: 'string',
					number: 1,
					boolean: true,
					null: null
				},
				namespace: 'spec',
				requestBody: { test: true },
				requestHeaders: { 'content-type': 'application/json' },
				requestMethod: 'POST',
				requestUrl: 'https://httpbin.org/anything',
				responseBody:
					'{"success":true,"url":"https://httpbin.org/anything","options":{"body":"{\\"test\\":true}","method":"POST","headers":{}}}',
				responseHeaders: { 'content-type': 'application/json' },
				responseOk: true,
				responseStatus: 200,
				retryCount: 0,
				retryLimit: 3,
				status: 'SUCCESS',
				ttl: expect.any(Number)
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
				namespace: 'spec',
				requestBody: { test: true },
				requestUrl: 'https://httpbin.org/anything'
			});

			// expect(global.fetch).toHaveBeenCalledTimes(4);
			// @ts-expect-error
			expect(webhooks.putLog).toHaveBeenCalledTimes(4);

			expect(res).toEqual({
				__createdAt: expect.any(String),
				__updatedAt: expect.any(String),
				id: expect.any(String),
				metadata: {},
				namespace: 'spec',
				requestBody: { test: true },
				requestHeaders: null,
				requestMethod: 'GET',
				requestUrl: 'https://httpbin.org/anything?test=true',
				responseBody: '{}',
				responseHeaders: { 'content-type': 'application/json' },
				responseOk: false,
				responseStatus: 500,
				retryCount: 3,
				retryLimit: 3,
				status: 'FAIL',
				ttl: expect.any(Number)
			});
		});

		it('should handle exceptions', async () => {
			vi.spyOn(global, 'fetch').mockRejectedValue(new Error('FAIL to fetch'));

			const res = await webhooks.trigger({
				namespace: 'spec',
				requestUrl: 'https://invalid-url.com',
				retryLimit: 2
			});

			// @ts-expect-error
			expect(webhooks.putLog).toHaveBeenCalledWith({
				id: expect.any(String),
				namespace: 'spec',
				requestBody: null,
				requestHeaders: null,
				requestMethod: 'GET',
				requestUrl: 'https://invalid-url.com',
				responseBody: '{"context":null,"message":"FAIL to fetch","stack":[],"status":500}',
				responseHeaders: {},
				responseOk: false,
				responseStatus: 500,
				retryCount: 0,
				retryLimit: 2,
				status: 'FAIL',
				ttl: expect.any(Number)
			});

			expect(res).toEqual({
				__createdAt: expect.any(String),
				__updatedAt: expect.any(String),
				id: expect.any(String),
				metadata: {},
				namespace: 'spec',
				requestBody: null,
				requestHeaders: null,
				requestMethod: 'GET',
				requestUrl: 'https://invalid-url.com',
				responseBody: '{"context":null,"message":"FAIL to fetch","stack":[],"status":500}',
				responseHeaders: {},
				responseOk: false,
				responseStatus: 500,
				retryCount: 0,
				retryLimit: 2,
				status: 'FAIL',
				ttl: expect.any(Number)
			});
		});
	});

	describe('uuid', () => {
		it('should generate a uuid', () => {
			// @ts-expect-error
			const res = webhooks.uuid();
			expect(res).toEqual(expect.any(String));
		});
	});
});
