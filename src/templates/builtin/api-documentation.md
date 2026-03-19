---
name: API Documentation
description: Generate comprehensive API documentation with endpoints, schemas, examples, and authentication details.
category: documentation
agents: [any]
panels: 1
---
Analyze the codebase and generate comprehensive API documentation for all exposed endpoints and interfaces.

Start by identifying the API framework in use (Express, Fastify, Hono, NestJS, etc.) and locate all route definitions, controllers, and middleware. Determine the base URL structure and any API versioning scheme.

For each endpoint, document the following in a consistent format:

1. **HTTP Method and Path** - The full route including any path parameters (e.g., `GET /api/v1/users/:id`).
2. **Description** - A clear, concise explanation of what the endpoint does and when to use it.
3. **Authentication** - What authentication is required (API key, Bearer token, OAuth, none). Note any role or permission requirements.
4. **Request Parameters** - Path parameters, query parameters, and headers. For each: name, type, required/optional, default value, constraints (min/max, regex, enum values).
5. **Request Body Schema** - Full JSON schema with field types, nested objects, arrays, required fields, and validation rules. Show the TypeScript/interface type if available.
6. **Response Schema** - Document each possible HTTP status code. For success responses, show the full response body structure. For error responses, show the error format.
7. **Error Codes** - List all possible error codes with their meanings and suggested client-side handling.
8. **Example Request** - A complete curl command that can be copied and run directly. Include headers, authentication, and a realistic request body.
9. **Example Response** - The expected JSON response for the example request, properly formatted.

Group endpoints by resource or domain (e.g., Users, Orders, Auth). Within each group, order by CRUD operations: list, get, create, update, delete.

Document any shared patterns: pagination format, filtering syntax, sorting parameters, rate limiting headers, and common error response structure.

If there are WebSocket endpoints, document the connection URL, authentication handshake, message formats for both client-to-server and server-to-client, and reconnection behavior.

Include a quick-start section at the top showing how to authenticate and make a first successful API call.

Flag any undocumented endpoints, inconsistent patterns, or missing error handling you discover during analysis.
