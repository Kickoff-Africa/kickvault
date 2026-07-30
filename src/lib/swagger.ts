import { type Express } from 'express';
import swaggerUi from 'swagger-ui-express';

const spec = {
  openapi: '3.0.3',
  info: {
    title: 'Kick Vault API',
    version: '1.0.0',
    description:
      'Secure encrypted credential and asset management API. Every secret is encrypted at rest with AES-256-GCM and every access is audit-logged.',
  },
  servers: [{ url: '/api', description: 'API base' }],
  components: {
    securitySchemes: {
      bearerAuth: {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
      },
    },
    schemas: {
      Error: {
        type: 'object',
        properties: {
          error: { type: 'string', example: 'Not found' },
        },
      },
      Role: {
        type: 'string',
        enum: ['SUPER_ADMIN', 'MANAGER', 'MEMBER', 'VIEWER'],
      },
      PermissionLevel: {
        type: 'string',
        enum: ['VIEW', 'EDIT', 'MANAGE'],
      },
      User: {
        type: 'object',
        properties: {
          id: { type: 'string', example: 'cuid123' },
          email: { type: 'string', format: 'email', example: 'user@example.com' },
          name: { type: 'string', example: 'Jane Smith' },
          role: { $ref: '#/components/schemas/Role' },
          isActive: { type: 'boolean', example: true },
          mustChangePassword: { type: 'boolean', example: false },
          lastLoginAt: { type: 'string', format: 'date-time', nullable: true },
          createdAt: { type: 'string', format: 'date-time' },
          updatedAt: { type: 'string', format: 'date-time' },
        },
      },
      Credential: {
        type: 'object',
        properties: {
          id: { type: 'string', example: 'cuid456' },
          friendlyName: { type: 'string', example: 'Production Database' },
          systemHost: { type: 'string', nullable: true, example: 'db.example.com' },
          username: { type: 'string', nullable: true, example: 'admin' },
          expiresAt: { type: 'string', format: 'date-time', nullable: true },
          createdById: { type: 'string' },
          createdAt: { type: 'string', format: 'date-time' },
          updatedAt: { type: 'string', format: 'date-time' },
        },
      },
      AccessEntry: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          userId: { type: 'string' },
          permission: { $ref: '#/components/schemas/PermissionLevel' },
          grantedAt: { type: 'string', format: 'date-time' },
          user: {
            type: 'object',
            properties: {
              id: { type: 'string' },
              email: { type: 'string', format: 'email' },
              name: { type: 'string' },
            },
          },
        },
      },
      Tokens: {
        type: 'object',
        properties: {
          accessToken: { type: 'string' },
          refreshToken: { type: 'string' },
          mustChangePassword: { type: 'boolean' },
        },
      },
    },
    responses: {
      Unauthorized: {
        description: 'Missing or invalid token',
        content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
      },
      Forbidden: {
        description: 'Insufficient role or permission',
        content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
      },
      NotFound: {
        description: 'Resource not found',
        content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
      },
      Conflict: {
        description: 'Conflict',
        content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
      },
      BadRequest: {
        description: 'Validation error',
        content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
      },
    },
  },
  security: [{ bearerAuth: [] }],
  tags: [
    { name: 'Health', description: 'Liveness and readiness probes' },
    { name: 'Auth', description: 'Authentication and session management' },
    { name: 'Users', description: 'User management and RBAC' },
    { name: 'Credentials', description: 'Encrypted credential vault' },
    { name: 'Credential Access', description: 'Per-credential ACL management' },
    { name: 'Asset Access', description: 'Per-asset ACL management' },
  ],
  paths: {
    // ── Health ────────────────────────────────────────────────────────────────
    '/health': {
      get: {
        tags: ['Health'],
        summary: 'Liveness check',
        security: [],
        responses: {
          200: {
            description: 'Server is running',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    status: { type: 'string', example: 'ok' },
                    uptime: { type: 'number', example: 123.45 },
                  },
                },
              },
            },
          },
        },
      },
    },
    '/health/ready': {
      get: {
        tags: ['Health'],
        summary: 'Readiness check (DB connectivity)',
        security: [],
        responses: {
          200: { description: 'Database connected' },
          503: { description: 'Database unreachable' },
        },
      },
    },

    // ── Auth ──────────────────────────────────────────────────────────────────
    '/auth/login': {
      post: {
        tags: ['Auth'],
        summary: 'Log in and receive tokens',
        security: [],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['email', 'password'],
                properties: {
                  email: { type: 'string', format: 'email', example: 'admin@example.com' },
                  password: { type: 'string', example: 'my-secure-password' },
                },
              },
            },
          },
        },
        responses: {
          200: {
            description: 'Login successful',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/Tokens' } } },
          },
          400: { $ref: '#/components/responses/BadRequest' },
          401: { description: 'Invalid credentials or account locked' },
        },
      },
    },
    '/auth/logout': {
      post: {
        tags: ['Auth'],
        summary: 'Invalidate all active sessions',
        responses: {
          200: {
            description: 'Logged out',
            content: {
              'application/json': {
                schema: { type: 'object', properties: { message: { type: 'string' } } },
              },
            },
          },
          401: { $ref: '#/components/responses/Unauthorized' },
        },
      },
    },
    '/auth/refresh': {
      post: {
        tags: ['Auth'],
        summary: 'Exchange a refresh token for new tokens',
        security: [],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['refreshToken'],
                properties: { refreshToken: { type: 'string' } },
              },
            },
          },
        },
        responses: {
          200: {
            description: 'New tokens issued',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/Tokens' } } },
          },
          401: { $ref: '#/components/responses/Unauthorized' },
        },
      },
    },
    '/auth/forgot-password': {
      post: {
        tags: ['Auth'],
        summary: 'Request a password reset email',
        security: [],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['email'],
                properties: { email: { type: 'string', format: 'email' } },
              },
            },
          },
        },
        responses: {
          200: { description: 'Reset email sent (response is identical whether email exists or not)' },
        },
      },
    },
    '/auth/reset-password': {
      post: {
        tags: ['Auth'],
        summary: 'Reset password using a token from the reset email',
        security: [],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['token', 'password'],
                properties: {
                  token: { type: 'string' },
                  password: { type: 'string', minLength: 12, example: 'NewP@ssword123' },
                },
              },
            },
          },
        },
        responses: {
          200: { description: 'Password reset — log in with new password' },
          400: { $ref: '#/components/responses/BadRequest' },
          401: { description: 'Invalid or expired token' },
        },
      },
    },

    // ── Users ─────────────────────────────────────────────────────────────────
    '/users/invite': {
      post: {
        tags: ['Users'],
        summary: 'Invite a new user (SUPER_ADMIN only)',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['email', 'name', 'role'],
                properties: {
                  email: { type: 'string', format: 'email' },
                  name: { type: 'string', minLength: 1, maxLength: 100 },
                  role: { $ref: '#/components/schemas/Role' },
                },
              },
            },
          },
        },
        responses: {
          201: {
            description: 'User invited',
            content: {
              'application/json': {
                schema: { type: 'object', properties: { user: { $ref: '#/components/schemas/User' } } },
              },
            },
          },
          400: { $ref: '#/components/responses/BadRequest' },
          401: { $ref: '#/components/responses/Unauthorized' },
          403: { $ref: '#/components/responses/Forbidden' },
          409: { $ref: '#/components/responses/Conflict' },
        },
      },
    },
    '/users': {
      get: {
        tags: ['Users'],
        summary: 'List all users (MANAGER+)',
        parameters: [
          { in: 'query', name: 'page', schema: { type: 'integer', default: 1 } },
          { in: 'query', name: 'limit', schema: { type: 'integer', default: 20, minimum: 1, maximum: 100 } },
        ],
        responses: {
          200: {
            description: 'Paginated user list',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    users: { type: 'array', items: { $ref: '#/components/schemas/User' } },
                    total: { type: 'integer' },
                    page: { type: 'integer' },
                    limit: { type: 'integer' },
                  },
                },
              },
            },
          },
          401: { $ref: '#/components/responses/Unauthorized' },
          403: { $ref: '#/components/responses/Forbidden' },
        },
      },
    },
    '/users/me/password': {
      post: {
        tags: ['Users'],
        summary: 'Change your own password',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['currentPassword', 'newPassword'],
                properties: {
                  currentPassword: { type: 'string' },
                  newPassword: { type: 'string', minLength: 12 },
                },
              },
            },
          },
        },
        responses: {
          200: { description: 'Password changed' },
          400: { $ref: '#/components/responses/BadRequest' },
          401: { $ref: '#/components/responses/Unauthorized' },
        },
      },
    },
    '/users/{id}': {
      get: {
        tags: ['Users'],
        summary: 'Get user by ID (MANAGER+)',
        parameters: [{ in: 'path', name: 'id', required: true, schema: { type: 'string' } }],
        responses: {
          200: {
            description: 'User found',
            content: {
              'application/json': {
                schema: { type: 'object', properties: { user: { $ref: '#/components/schemas/User' } } },
              },
            },
          },
          401: { $ref: '#/components/responses/Unauthorized' },
          403: { $ref: '#/components/responses/Forbidden' },
          404: { $ref: '#/components/responses/NotFound' },
        },
      },
      patch: {
        tags: ['Users'],
        summary: 'Update user name or role',
        parameters: [{ in: 'path', name: 'id', required: true, schema: { type: 'string' } }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  name: { type: 'string', minLength: 1, maxLength: 100 },
                  role: { $ref: '#/components/schemas/Role' },
                },
              },
            },
          },
        },
        responses: {
          200: {
            description: 'User updated',
            content: {
              'application/json': {
                schema: { type: 'object', properties: { user: { $ref: '#/components/schemas/User' } } },
              },
            },
          },
          400: { $ref: '#/components/responses/BadRequest' },
          401: { $ref: '#/components/responses/Unauthorized' },
          403: { $ref: '#/components/responses/Forbidden' },
          404: { $ref: '#/components/responses/NotFound' },
        },
      },
    },
    '/users/{id}/deactivate': {
      post: {
        tags: ['Users'],
        summary: 'Deactivate a user and revoke all sessions (SUPER_ADMIN only)',
        parameters: [{ in: 'path', name: 'id', required: true, schema: { type: 'string' } }],
        responses: {
          200: {
            description: 'User deactivated',
            content: {
              'application/json': {
                schema: { type: 'object', properties: { user: { $ref: '#/components/schemas/User' } } },
              },
            },
          },
          401: { $ref: '#/components/responses/Unauthorized' },
          403: { $ref: '#/components/responses/Forbidden' },
          404: { $ref: '#/components/responses/NotFound' },
        },
      },
    },
    '/users/{id}/resend-invite': {
      post: {
        tags: ['Users'],
        summary: 'Resend invite email (SUPER_ADMIN only)',
        parameters: [{ in: 'path', name: 'id', required: true, schema: { type: 'string' } }],
        responses: {
          200: { description: 'Invite resent' },
          401: { $ref: '#/components/responses/Unauthorized' },
          403: { $ref: '#/components/responses/Forbidden' },
          404: { $ref: '#/components/responses/NotFound' },
        },
      },
    },

    // ── Credentials ───────────────────────────────────────────────────────────
    '/credentials': {
      post: {
        tags: ['Credentials'],
        summary: 'Create a credential — secret encrypted at rest',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['friendlyName', 'secret'],
                properties: {
                  friendlyName: { type: 'string', minLength: 1, maxLength: 255, example: 'Production DB' },
                  systemHost: { type: 'string', maxLength: 255, example: 'db.prod.example.com' },
                  username: { type: 'string', maxLength: 255, example: 'dbadmin' },
                  secret: { type: 'string', minLength: 1, example: 'super-secret-password' },
                  expiresAt: { type: 'string', format: 'date-time', example: '2027-01-01T00:00:00Z' },
                },
              },
            },
          },
        },
        responses: {
          201: {
            description: 'Credential created — secret field is never returned',
            content: {
              'application/json': {
                schema: { type: 'object', properties: { credential: { $ref: '#/components/schemas/Credential' } } },
              },
            },
          },
          400: { $ref: '#/components/responses/BadRequest' },
          401: { $ref: '#/components/responses/Unauthorized' },
        },
      },
      get: {
        tags: ['Credentials'],
        summary: 'List credentials accessible to the caller',
        description: 'SUPER_ADMIN and MANAGER see all credentials. Other roles see only credentials they have been granted access to.',
        responses: {
          200: {
            description: 'Credential list (secret field never included)',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    credentials: { type: 'array', items: { $ref: '#/components/schemas/Credential' } },
                  },
                },
              },
            },
          },
          401: { $ref: '#/components/responses/Unauthorized' },
        },
      },
    },
    '/credentials/{id}': {
      get: {
        tags: ['Credentials'],
        summary: 'Get a single credential (VIEW permission required)',
        parameters: [{ in: 'path', name: 'id', required: true, schema: { type: 'string' } }],
        responses: {
          200: {
            description: 'Credential (secret field never included)',
            content: {
              'application/json': {
                schema: { type: 'object', properties: { credential: { $ref: '#/components/schemas/Credential' } } },
              },
            },
          },
          401: { $ref: '#/components/responses/Unauthorized' },
          403: { $ref: '#/components/responses/Forbidden' },
          404: { $ref: '#/components/responses/NotFound' },
        },
      },
      patch: {
        tags: ['Credentials'],
        summary: 'Update a credential (EDIT permission required)',
        parameters: [{ in: 'path', name: 'id', required: true, schema: { type: 'string' } }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                description: 'At least one field required. Providing `secret` re-encrypts it.',
                properties: {
                  friendlyName: { type: 'string', minLength: 1, maxLength: 255 },
                  systemHost: { type: 'string', nullable: true },
                  username: { type: 'string', nullable: true },
                  secret: { type: 'string', minLength: 1 },
                  expiresAt: { type: 'string', format: 'date-time', nullable: true },
                },
              },
            },
          },
        },
        responses: {
          200: {
            description: 'Credential updated',
            content: {
              'application/json': {
                schema: { type: 'object', properties: { credential: { $ref: '#/components/schemas/Credential' } } },
              },
            },
          },
          400: { $ref: '#/components/responses/BadRequest' },
          401: { $ref: '#/components/responses/Unauthorized' },
          403: { $ref: '#/components/responses/Forbidden' },
          404: { $ref: '#/components/responses/NotFound' },
        },
      },
      delete: {
        tags: ['Credentials'],
        summary: 'Soft-delete a credential (MANAGE permission required)',
        parameters: [{ in: 'path', name: 'id', required: true, schema: { type: 'string' } }],
        responses: {
          204: { description: 'Deleted' },
          401: { $ref: '#/components/responses/Unauthorized' },
          403: { $ref: '#/components/responses/Forbidden' },
          404: { $ref: '#/components/responses/NotFound' },
        },
      },
    },
    '/credentials/{id}/reveal': {
      post: {
        tags: ['Credentials'],
        summary: 'Reveal the plaintext secret (VIEW permission, rate-limited 10/min/user, audit-logged)',
        parameters: [{ in: 'path', name: 'id', required: true, schema: { type: 'string' } }],
        responses: {
          200: {
            description: 'Plaintext secret',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: { secret: { type: 'string', example: 'super-secret-password' } },
                },
              },
            },
          },
          401: { $ref: '#/components/responses/Unauthorized' },
          403: { $ref: '#/components/responses/Forbidden' },
          404: { $ref: '#/components/responses/NotFound' },
          429: { description: 'Rate limit exceeded — 10 reveals per minute per user' },
        },
      },
    },

    // ── Credential Access ─────────────────────────────────────────────────────
    '/credentials/{credentialId}/access': {
      post: {
        tags: ['Credential Access'],
        summary: 'Grant a user access to a credential (MANAGER+)',
        parameters: [{ in: 'path', name: 'credentialId', required: true, schema: { type: 'string' } }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['userId'],
                properties: {
                  userId: { type: 'string' },
                  permission: { $ref: '#/components/schemas/PermissionLevel' },
                },
              },
            },
          },
        },
        responses: {
          201: {
            description: 'Access granted (upsert — updates permission if entry already exists)',
            content: {
              'application/json': {
                schema: { type: 'object', properties: { access: { $ref: '#/components/schemas/AccessEntry' } } },
              },
            },
          },
          401: { $ref: '#/components/responses/Unauthorized' },
          403: { $ref: '#/components/responses/Forbidden' },
          404: { $ref: '#/components/responses/NotFound' },
        },
      },
      get: {
        tags: ['Credential Access'],
        summary: 'List all users with access to a credential (MANAGER+)',
        parameters: [{ in: 'path', name: 'credentialId', required: true, schema: { type: 'string' } }],
        responses: {
          200: {
            description: 'Access list',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: { access: { type: 'array', items: { $ref: '#/components/schemas/AccessEntry' } } },
                },
              },
            },
          },
          401: { $ref: '#/components/responses/Unauthorized' },
          403: { $ref: '#/components/responses/Forbidden' },
          404: { $ref: '#/components/responses/NotFound' },
        },
      },
    },
    '/credentials/{credentialId}/access/{userId}': {
      delete: {
        tags: ['Credential Access'],
        summary: 'Revoke a user\'s access to a credential (MANAGER+)',
        parameters: [
          { in: 'path', name: 'credentialId', required: true, schema: { type: 'string' } },
          { in: 'path', name: 'userId', required: true, schema: { type: 'string' } },
        ],
        responses: {
          204: { description: 'Access revoked' },
          401: { $ref: '#/components/responses/Unauthorized' },
          403: { $ref: '#/components/responses/Forbidden' },
          404: { $ref: '#/components/responses/NotFound' },
        },
      },
    },

    // ── Asset Access ──────────────────────────────────────────────────────────
    '/assets/{assetId}/access': {
      post: {
        tags: ['Asset Access'],
        summary: 'Grant a user access to an asset (MANAGER+)',
        parameters: [{ in: 'path', name: 'assetId', required: true, schema: { type: 'string' } }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['userId'],
                properties: {
                  userId: { type: 'string' },
                  permission: { $ref: '#/components/schemas/PermissionLevel' },
                },
              },
            },
          },
        },
        responses: {
          201: {
            description: 'Access granted',
            content: {
              'application/json': {
                schema: { type: 'object', properties: { access: { $ref: '#/components/schemas/AccessEntry' } } },
              },
            },
          },
          401: { $ref: '#/components/responses/Unauthorized' },
          403: { $ref: '#/components/responses/Forbidden' },
          404: { $ref: '#/components/responses/NotFound' },
        },
      },
      get: {
        tags: ['Asset Access'],
        summary: 'List all users with access to an asset (MANAGER+)',
        parameters: [{ in: 'path', name: 'assetId', required: true, schema: { type: 'string' } }],
        responses: {
          200: {
            description: 'Access list',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: { access: { type: 'array', items: { $ref: '#/components/schemas/AccessEntry' } } },
                },
              },
            },
          },
          401: { $ref: '#/components/responses/Unauthorized' },
          403: { $ref: '#/components/responses/Forbidden' },
          404: { $ref: '#/components/responses/NotFound' },
        },
      },
    },
    '/assets/{assetId}/access/{userId}': {
      delete: {
        tags: ['Asset Access'],
        summary: 'Revoke a user\'s access to an asset (MANAGER+)',
        parameters: [
          { in: 'path', name: 'assetId', required: true, schema: { type: 'string' } },
          { in: 'path', name: 'userId', required: true, schema: { type: 'string' } },
        ],
        responses: {
          204: { description: 'Access revoked' },
          401: { $ref: '#/components/responses/Unauthorized' },
          403: { $ref: '#/components/responses/Forbidden' },
          404: { $ref: '#/components/responses/NotFound' },
        },
      },
    },
  },
};

export function registerSwagger(app: Express): void {
  app.use('/docs', swaggerUi.serve, swaggerUi.setup(spec));
  // Also expose the raw spec as JSON for tooling
  app.get('/docs.json', (_req, res) => res.json(spec));
}
