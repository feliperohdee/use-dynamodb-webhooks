# use-dynamodb-webhooks

A TypeScript library for executing webhooks with Amazon DynamoDB-based logging. It provides a robust, scalable system for storing webhook execution logs while offering built-in retry mechanisms, monitoring, and error handling.

[![TypeScript](https://img.shields.io/badge/-TypeScript-3178C6?style=flat-square&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Vitest](https://img.shields.io/badge/-Vitest-729B1B?style=flat-square&logo=vitest&logoColor=white)](https://vitest.dev/)
[![MIT License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

## ✨ Features

- 💾 **DynamoDB Logging**: Uses DynamoDB for persistent storage of webhook execution logs and monitoring
- 🔄 **Robust Error Handling**: Built-in retry mechanism with configurable retry counts
- 📦 **Flexible Request Formats**: Supports multiple content types including JSON, form-urlencoded, and multipart/form-data
- 📂 **Namespace Organization**: Group webhooks by namespaces for better organization
- 📊 **Monitoring & Logging**: Comprehensive logging system with query capabilities
- ⏱️ **TTL Support**: Automatic cleanup of old webhook logs using DynamoDB TTL
- 🏷️ **Metadata Support**: Add custom metadata to webhook logs for enhanced tracking and filtering

## Installation

```bash
npm install use-dynamodb-webhooks
# or
yarn add use-dynamodb-webhooks
```

## Quick Start

### Initialize the Client

```typescript
import Webhooks from 'use-dynamodb-webhooks';

const webhooks = new Webhooks({
	accessKeyId: process.env.AWS_ACCESS_KEY_ID,
	secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
	region: process.env.AWS_REGION,
	tableName: 'YOUR_TABLE_NAME',
	ttlInSeconds: 86400, // 24 hours (Default: 7776000 [90 days])
	createTable: true // Optional: automatically create DynamoDB table
});
```

### Trigger a Webhook

```typescript
// GET request with query parameters and metadata
await webhooks.trigger({
	namespace: 'users',
	requestUrl: 'https://api.example.com/search',
	requestMethod: 'GET',
	requestBody: {
		query: 'john',
		status: 'active',
		limit: 10
	},
	metadata: {
		userId: '123',
		source: 'search_api'
	}
});

// Basic POST webhook trigger with metadata
await webhooks.trigger({
	namespace: 'orders',
	requestUrl: 'https://api.example.com/webhook',
	requestMethod: 'POST',
	requestBody: {
		orderId: '123',
		status: 'completed'
	},
	requestHeaders: {
		Authorization: 'Bearer your-token'
	},
	metadata: {
		orderId: '123',
		processType: 'order_completion'
	},
	retryLimit: 3 // Optional: default is 3, max is 10
});

// With form-urlencoded data
await webhooks.trigger({
	namespace: 'users',
	requestUrl: 'https://api.example.com/webhook',
	requestMethod: 'POST',
	requestBody: { userId: '123', action: 'signup' },
	requestHeaders: {
		'Content-Type': 'application/x-www-form-urlencoded'
	}
});

// With multipart/form-data
await webhooks.trigger({
	namespace: 'uploads',
	requestUrl: 'https://api.example.com/upload',
	requestMethod: 'POST',
	requestBody: {
		userId: '123',
		fileType: 'profile',
		fileData: 'base64encodeddata...'
	},
	requestHeaders: {
		'Content-Type': 'multipart/form-data'
	}
});
```

### Query Webhook Logs

```typescript
// Fetch all logs for a namespace
const logs = await webhooks.fetchLogs({
	namespace: 'orders'
});

// Fetch logs with filters and metadata
const filteredLogs = await webhooks.fetchLogs({
	namespace: 'orders',
	status: 'SUCCESS',
	from: '2024-01-01T00:00:00Z',
	to: '2024-01-31T23:59:59Z',
	metadata: {
		orderId: '123',
		processType: 'order_completion'
	},
	limit: 100
});
```

## API Reference

### Constructor Options

```typescript
type ConstructorOptions = {
	accessKeyId: string;
	secretAccessKey: string;
	region: string;
	tableName: string;
	ttlInSeconds: number; // Default: 7776000 (90 days)
	createTable?: boolean;
};
```

### Trigger Options

```typescript
type TriggerInput = {
	namespace: string;
	requestUrl: string;
	requestMethod?: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'HEAD';
	requestBody?: Record<string, any>;
	requestHeaders?: Record<string, string>;
	metadata?: Record<string, any>;
	retryLimit?: number; // Default: 3, Max: 10
};
```

### Fetch Logs Options

```typescript
type FetchLogsInput = {
	namespace: string;
	status?: 'SUCCESS' | 'FAIL';
	from?: string;
	to?: string;
	metadata?: Record<string, any>;
	limit?: number;
	desc?: boolean;
	startKey?: Record<string, any>;
};
```

### Webhook Log Structure

```typescript
type WebhookLog = {
	id: string;
	namespace: string;
	metadata: Record<string, any>;
	request: {
		body: Record<string, any> | null;
		headers: Record<string, string> | null;
		method: string;
		url: string;
	};
	response: {
		body: string;
		headers: Record<string, string>;
		ok: boolean;
		status: number;
	};
	retryCount: number;
	retryLimit: number;
	status: 'SUCCESS' | 'FAIL';
	ttl: number;
	__createdAt: string;
	__updatedAt: string;
};
```

## Request Body Handling

The library automatically handles different content types:

- **JSON**: Default content type
- **application/x-www-form-urlencoded**: Automatically encodes body as URL parameters
- **multipart/form-data**: Converts body to FormData
- **GET requests**: Automatically adds body parameters to URL query string

## Error Handling

- Automatic retry mechanism with configurable retry count
- Built-in exponential backoff strategy:
  - Initial delay: 500ms
  - Increments by 500ms for each retry (500ms, 1000ms, 1500ms, etc.)
  - Maximum delay cap of 3000ms
  - Example: For 3 retries, delays would be: 500ms → 1000ms → 1500ms
- Detailed error logging with response status and body
- Validation errors for invalid input parameters

## Best Practices

1. **Namespace Organization**: Use meaningful namespaces to group related webhooks
2. **Error Handling**: Configure appropriate retry counts based on webhook importance
3. **Monitoring**: Regularly check webhook logs for failures
4. **TTL Configuration**: Set appropriate TTL values to manage log storage
5. **Content Types**: Use appropriate content types based on webhook endpoint requirements
6. **Security**: Always use HTTPS endpoints and secure authentication headers
7. **Metadata Usage**: Add relevant metadata to facilitate tracking and filtering

## Development

```bash
# Required environment variables
export AWS_ACCESS_KEY='YOUR_ACCESS_KEY'
export AWS_SECRET_KEY='YOUR_SECRET_KEY'
export AWS_REGION='YOUR_REGION'

# Run tests
yarn test
```

## License

MIT © [Felipe Rohde](mailto:feliperohdee@gmail.com)

## 👨‍💻 Author

**Felipe Rohde**

- Github: [@feliperohdee](https://github.com/feliperohdee)
- Email: feliperohdee@gmail.com
