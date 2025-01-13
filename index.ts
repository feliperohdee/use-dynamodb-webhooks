import _ from 'lodash';
import Dynamodb, { concatConditionExpression } from 'use-dynamodb';
import HttpError from 'use-http-error';
import qs from 'use-qs';
import z from 'zod';
import zDefault from 'zod-default-instance';

const request = z.object({
	body: z.record(z.any()).nullable(),
	headers: z.record(z.string()).nullable(),
	method: z.enum(['DELETE', 'GET', 'HEAD', 'POST', 'PUT']),
	url: z.string().url()
});

const response = z.object({
	body: z.string(),
	headers: z.record(z.string()),
	ok: z.boolean(),
	status: z.number()
});

const logStatus = z.enum(['FAIL', 'SUCCESS']);
const log = z.object({
	__createdAt: z
		.string()
		.datetime()
		.default(() => {
			return new Date().toISOString();
		}),
	__updatedAt: z
		.string()
		.datetime()
		.default(() => {
			return new Date().toISOString();
		}),
	id: z.string(),
	metadata: z.record(z.any()).default({}),
	namespace: z.string(),
	requestBody: request.shape.body,
	requestHeaders: request.shape.headers,
	requestMethod: request.shape.method,
	requestUrl: request.shape.url,
	responseBody: response.shape.body,
	responseHeaders: response.shape.headers,
	responseOk: response.shape.ok,
	responseStatus: response.shape.status,
	retryCount: z.number().default(0),
	retryLimit: z.number().default(3),
	status: logStatus,
	ttl: z.number()
});

const fetchLogsInput = z.object({
	desc: z.boolean().default(false),
	from: z.string().datetime({ offset: true }).optional(),
	limit: z.number().min(1).default(100),
	metadata: z.record(z.any()).default({}),
	namespace: z.string(),
	startKey: z.record(z.any()).nullable().default(null),
	status: logStatus.nullable().optional(),
	to: z.string().datetime({ offset: true }).optional()
});

const triggerInput = z.object({
	metadata: z.record(z.any()).default({}),
	namespace: z.string(),
	requestBody: z.record(z.any()).nullable().optional(),
	requestHeaders: z.record(z.string()).nullable().optional(),
	requestMethod: request.shape.method.default('GET'),
	requestUrl: request.shape.url,
	retryLimit: z.number().min(0).max(10).default(3)
});

const schema = {
	fetchLogsInput,
	log,
	logStatus,
	request,
	response,
	triggerInput
};

namespace Webhooks {
	export type ConstructorOptions = {
		accessKeyId: string;
		createTable?: boolean;
		region: string;
		secretAccessKey: string;
		tableName: string;
		ttlInSeconds?: number;
	};

	export type FetchLogsInput = z.input<typeof fetchLogsInput>;
	export type Log = z.infer<typeof log>;
	export type LogInput = z.input<typeof log>;
	export type LogStatus = z.infer<typeof logStatus>;
	export type Request = z.infer<typeof request>;
	export type Response = z.infer<typeof response>;
	export type TriggerInput = z.input<typeof triggerInput>;
}

const logShape = (input: Webhooks.LogInput): Webhooks.Log => {
	return zDefault(log, input);
};

class Webhooks {
	public static schema = schema;

	public db: { logs: Dynamodb<Webhooks.Log> };
	public ttlInSeconds: number;

	constructor(options: Webhooks.ConstructorOptions) {
		const logs = new Dynamodb<Webhooks.Log>({
			accessKeyId: options.accessKeyId,
			indexes: [
				{
					forceGlobal: true,
					name: 'namespace-createdAt',
					partition: 'namespace',
					sort: '__createdAt'
				}
			],
			region: options.region,
			schema: {
				partition: 'namespace',
				sort: 'id'
			},
			secretAccessKey: options.secretAccessKey,
			table: options.tableName
		});

		if (options.createTable) {
			(async () => {
				await logs.createTable();
			})();
		}

		this.db = { logs };
		this.ttlInSeconds = options.ttlInSeconds ?? 7776000; // 90 days = 90 * 24 * 60 * 60 seconds
	}

	async clearLogs(namespace: string): Promise<{ count: number }> {
		return this.db.logs.clear(namespace);
	}

	private createFetchRequest(request: Webhooks.Request): {
		body: BodyInit | null;
		headers: Headers;
		method: Webhooks.Request['method'];
		url: string;
	} {
		const url = new URL(request.url);
		const headers = new Headers(request.headers || {});

		if (request.method === 'POST' || request.method === 'PUT') {
			if (request.body && _.size(request.body)) {
				const contentType = headers.get('content-type');

				if (_.includes(contentType, 'application/x-www-form-urlencoded')) {
					return {
						body: qs.stringify(request.body, { addQueryPrefix: false }),
						headers,
						method: request.method,
						url: request.url
					};
				} else if (_.includes(contentType, 'multipart/form-data')) {
					const formdata = new FormData();

					_.forEach(request.body, (value, key) => {
						formdata.append(key, value);
					});

					return {
						body: formdata,
						headers,
						method: request.method,
						url: request.url
					};
				} else {
					return {
						body: JSON.stringify(request.body),
						headers,
						method: request.method,
						url: request.url
					};
				}
			}

			return {
				body: null,
				headers,
				method: request.method,
				url: request.url
			};
		}

		const queryString = qs.stringify({
			...Object.fromEntries(url.searchParams.entries()),
			...request.body
		});

		return {
			body: null,
			headers,
			method: request.method || 'GET',
			url: `${url.protocol}//${url.host}${url.pathname}${queryString}`
		};
	}

	async fetchLogs(input: Webhooks.FetchLogsInput): Promise<Dynamodb.MultiResponse<Webhooks.Log, false>> {
		const args = await fetchLogsInput.parseAsync(input);

		let queryOptions: Dynamodb.QueryOptions<Webhooks.Log> = {
			attributeNames: { '#namespace': 'namespace' },
			attributeValues: { ':namespace': args.namespace },
			filterExpression: '',
			index: 'namespace-createdAt',
			limit: args.limit,
			queryExpression: '#namespace = :namespace',
			scanIndexForward: args.desc ? false : true,
			startKey: args.startKey
		};

		if (args.from && args.to) {
			queryOptions.attributeNames = {
				...queryOptions.attributeNames,
				'#__createdAt': '__createdAt'
			};

			queryOptions.attributeValues = {
				...queryOptions.attributeValues,
				':from': args.from,
				':to': args.to
			};

			queryOptions.queryExpression = concatConditionExpression(queryOptions.queryExpression!, '#__createdAt BETWEEN :from AND :to');
		}

		if (_.size(args.metadata)) {
			let metadataFilter: string[] = [];

			queryOptions.attributeNames = {
				...queryOptions.attributeNames,
				'#metadata': 'metadata'
			};

			_.forEach(args.metadata, (value, key) => {
				queryOptions.attributeNames = {
					...queryOptions.attributeNames,
					[`#${key}`]: key
				};

				queryOptions.attributeValues = {
					...queryOptions.attributeValues,
					[`:${key}`]: value
				};

				metadataFilter = [...metadataFilter, `#metadata.#${key} = :${key}`];
			});

			queryOptions.filterExpression = concatConditionExpression(queryOptions.filterExpression!, metadataFilter.join(' AND '));
		}

		if (args.status) {
			queryOptions.attributeNames = {
				...queryOptions.attributeNames,
				'#status': 'status'
			};

			queryOptions.attributeValues = {
				...queryOptions.attributeValues,
				':status': args.status
			};

			queryOptions.filterExpression = concatConditionExpression(queryOptions.filterExpression!, '#status = :status');
		}

		const res = await this.db.logs.query(queryOptions);

		return {
			...res,
			items: _.map(res.items, logShape)
		};
	}

	private async putLog(input: Webhooks.LogInput): Promise<Webhooks.Log> {
		const args = await log.parseAsync(input);

		return logShape(await this.db.logs.put(args));
	}

	async trigger(input: Webhooks.TriggerInput, retries: number = 0): Promise<Webhooks.Log> {
		try {
			const args = await triggerInput.parseAsync(input);

			try {
				const { body, headers, method, url } = this.createFetchRequest({
					body: args.requestBody || null,
					headers: args.requestHeaders || null,
					method: args.requestMethod || 'GET',
					url: args.requestUrl
				});

				const response = await fetch(
					url,
					body && (method === 'POST' || method === 'PUT')
						? {
								body,
								method,
								headers
							}
						: {
								method,
								headers
							}
				);

				const res = await this.putLog({
					id: this.uuid(),
					metadata: args.metadata,
					namespace: args.namespace,
					requestBody: args.requestBody || null,
					requestHeaders: args.requestHeaders || null,
					requestMethod: method,
					requestUrl: url,
					responseBody: await response.text(),
					responseHeaders: Object.fromEntries(response.headers.entries()),
					responseOk: response.ok,
					responseStatus: response.status,
					retryCount: retries,
					retryLimit: args.retryLimit || 3,
					status: response.ok ? 'SUCCESS' : 'FAIL',
					ttl: Math.floor(_.now() / 1000 + this.ttlInSeconds)
				});

				if (!response.ok) {
					retries += 1;

					if (retries <= (args.retryLimit || 3)) {
						await new Promise(resolve => {
							setTimeout(resolve, Math.min(500 * retries, 3000));
						});

						return this.trigger(args, retries);
					}
				}

				return res;
			} catch (err) {
				return this.putLog({
					id: this.uuid(),
					namespace: args.namespace,
					requestBody: args.requestBody || null,
					requestHeaders: args.requestHeaders || null,
					requestMethod: args.requestMethod || 'GET',
					requestUrl: args.requestUrl,
					responseBody: JSON.stringify(HttpError.wrap(err as Error).toJson()),
					responseHeaders: {},
					responseOk: false,
					responseStatus: 500,
					retryCount: 0,
					retryLimit: args.retryLimit || 3,
					status: 'FAIL',
					ttl: Math.floor(_.now() / 1000 + this.ttlInSeconds)
				});
			}
		} catch (err) {
			if (err instanceof z.ZodError) {
				throw new HttpError(400, 'Validation Error', {
					context: err.errors
				});
			}

			throw err;
		}
	}

	private uuid(): string {
		return crypto.randomUUID();
	}
}

export { logShape };
export default Webhooks;
