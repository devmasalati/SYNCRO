/**
 * API Infrastructure - Main Export
 * Centralized exports for all API utilities
 */

// Types
export * from './types'

// Error Handling
export * from './errors'

// Authentication & Authorization
export * from './auth'

// Validation
export * from './validation'

// Rate Limiting
export * from './rate-limit'

// Environment
export * from './env'

// Idempotency
export * from './idempotency'

/**
 * Helper to create a complete API route handler with all middleware
 */
import { NextResponse, type NextRequest } from 'next/server'
import { withErrorHandling, createSuccessResponse } from './errors'
import { requireAuth, requireRole, createRequestContext, type UserRole } from './auth'
import { type RequestContext, type ApiResponse } from './types'
import { isMaintenanceMode } from './env'
import { ApiErrors } from './errors'
import { idempotencyService } from './idempotency'

type RouteHandler = (
  request: NextRequest,
  context: RequestContext,
  user?: Awaited<ReturnType<typeof requireAuth>>
) => Promise<NextResponse<ApiResponse>>

type RouteOptions = {
  requireAuth?: boolean
  requireRole?: UserRole[]
  rateLimit?: (request: NextRequest) => void
  skipMaintenanceCheck?: boolean
  idempotent?: boolean
}

export function createApiRoute(
  handler: RouteHandler,
  options: RouteOptions = {}
) {
  return withErrorHandling(async (request: NextRequest) => {
    if (!options.skipMaintenanceCheck && isMaintenanceMode()) {
      throw ApiErrors.serviceUnavailable('Service is currently under maintenance')
    }

    if (options.rateLimit) {
      options.rateLimit(request)
    }

    const context = createRequestContext(request)

    let user: Awaited<ReturnType<typeof requireAuth>> | undefined
    if (options.requireAuth) {
      user = await requireAuth(request)
      context.userId = user.id
      context.userEmail = user.email

      if (options.requireRole) {
        await requireRole(request, options.requireRole)
      }
    }

    // Check for idempotency if enabled
    let idempotencyKey: string | null = null
    let requestHash = ''
    if (options.idempotent) {
      if (!user) {
        throw ApiErrors.unauthorized('Authentication required for idempotent requests')
      }

      let body: any = null
      if (request.method === 'POST' || request.method === 'PUT' || request.method === 'PATCH') {
        try {
          body = await request.clone().json()
        } catch {
          // No JSON body
        }
      }

      requestHash = idempotencyService.hashRequest(body)
      const clientKey = request.headers.get('idempotency-key')
      idempotencyKey = clientKey || `server:${user.id}:${request.nextUrl.pathname}:${requestHash}`

      const { isDuplicate, cachedResponse } = await idempotencyService.checkIdempotency(
        idempotencyKey,
        user.id,
        requestHash
      )

      if (isDuplicate && cachedResponse) {
        const response = NextResponse.json(cachedResponse.body, {
          status: cachedResponse.status,
        })
        response.headers.set('X-Idempotency-Hit', 'true')
        response.headers.set('X-Idempotency-Key', idempotencyKey)
        return response as unknown as NextResponse<ApiResponse>
      }
    }

    const response = await handler(request, context, user) as unknown as NextResponse<ApiResponse>

    // Store response for idempotency if successful (2xx status codes)
    if (options.idempotent && user && idempotencyKey && response.status >= 200 && response.status < 300) {
      let responseBody: any = null
      try {
        responseBody = await response.clone().json()
      } catch {
        // Not a JSON response or body read error
      }

      if (responseBody) {
        await idempotencyService.storeResponse(
          idempotencyKey,
          user.id,
          requestHash,
          response.status,
          responseBody
        )
      }
    }

    if (idempotencyKey) {
      response.headers.set('X-Idempotency-Key', idempotencyKey)
    }

    return response
  }, crypto.randomUUID())
}


