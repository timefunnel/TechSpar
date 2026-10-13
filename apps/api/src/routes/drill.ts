import { createRoute, type OpenAPIHono } from '@hono/zod-openapi'
import { z } from 'zod'
import { DrillActionSchema, DrillFinishSchema, DrillQueueSchema, DrillSessionSchema, DrillStartSchema, ResumeDrillSourceSchema, ResumeDrillPlanSchema, ResumeDrillPlansSchema, ResumeDrillConfirmSchema, ResumeDrillStartSchema } from '@techspar/contracts'
import type { DrillUseCases, TokenService } from '@techspar/core'
import { authenticatedContext } from '../http/context.ts'
import { validateResponse } from '../http/response.ts'

export function registerDrillRoutes(app: OpenAPIHono, deps: { drill: DrillUseCases; tokens: TokenService }): void {
  const params = z.object({ session_id: z.string().min(1) })
  const response = { 200: { content: { 'application/json': { schema: DrillSessionSchema } }, description: 'Server-owned guided learning state' } }
  const planResponse = { 200: { content: { 'application/json': { schema: ResumeDrillPlanSchema } }, description: 'Source-bound resume learning outline' } }
  app.openapi(createRoute({ method: 'get', path: '/api/drill/resume/plans', responses: { 200: { content: { 'application/json': { schema: ResumeDrillPlansSchema } }, description: 'Latest 20 account-owned resume outlines' } } }), async c =>
    c.json(validateResponse(ResumeDrillPlansSchema, await deps.drill.resumePlans(await authenticatedContext(c, deps.tokens)), 'GET /api/drill/resume/plans', c.get('requestId'))))
  app.openapi(createRoute({ method: 'post', path: '/api/drill/resume/preview', request: { body: { content: { 'application/json': { schema: ResumeDrillSourceSchema } } } }, responses: planResponse }), async c =>
    c.json(validateResponse(ResumeDrillPlanSchema, await deps.drill.previewResume(await authenticatedContext(c, deps.tokens), c.req.valid('json')), 'POST /api/drill/resume/preview', c.get('requestId'))))
  app.openapi(createRoute({ method: 'get', path: '/api/drill/resume/plan/{session_id}', request: { params }, responses: planResponse }), async c =>
    c.json(validateResponse(ResumeDrillPlanSchema, await deps.drill.resumePlan(await authenticatedContext(c, deps.tokens), c.req.valid('param').session_id), 'GET /api/drill/resume/plan', c.get('requestId'))))
  app.openapi(createRoute({ method: 'post', path: '/api/drill/resume/plan/{session_id}/confirm', request: { params, body: { content: { 'application/json': { schema: ResumeDrillConfirmSchema } } } }, responses: planResponse }), async c =>
    c.json(validateResponse(ResumeDrillPlanSchema, await deps.drill.confirmResume(await authenticatedContext(c, deps.tokens), c.req.valid('param').session_id, c.req.valid('json')), 'POST /api/drill/resume/plan/confirm', c.get('requestId'))))
  app.openapi(createRoute({ method: 'post', path: '/api/drill/resume/start', request: { body: { content: { 'application/json': { schema: ResumeDrillStartSchema } } } }, responses: response }), async c =>
    c.json(validateResponse(DrillSessionSchema, await deps.drill.startResume(await authenticatedContext(c, deps.tokens), c.req.valid('json')), 'POST /api/drill/resume/start', c.get('requestId'))))
  app.openapi(createRoute({ method: 'get', path: '/api/drill/queue', request: { query: z.object({ topic: z.string().max(200).optional() }) }, responses: { 200: { content: { 'application/json': { schema: DrillQueueSchema } }, description: 'Wrong answers and canonical profile review schedule' } } }), async c =>
    c.json(validateResponse(DrillQueueSchema, await deps.drill.queue(await authenticatedContext(c, deps.tokens), c.req.valid('query').topic), 'GET /api/drill/queue', c.get('requestId'))))
  app.openapi(createRoute({ method: 'post', path: '/api/drill/start', request: { body: { content: { 'application/json': { schema: DrillStartSchema } } } }, responses: response }), async c =>
    c.json(validateResponse(DrillSessionSchema, await deps.drill.start(await authenticatedContext(c, deps.tokens), c.req.valid('json')), 'POST /api/drill/start', c.get('requestId'))))
  app.openapi(createRoute({ method: 'get', path: '/api/drill/session/{session_id}', request: { params }, responses: response }), async c =>
    c.json(validateResponse(DrillSessionSchema, await deps.drill.session(await authenticatedContext(c, deps.tokens), c.req.valid('param').session_id), 'GET /api/drill/session/{session_id}', c.get('requestId'))))
  app.openapi(createRoute({ method: 'post', path: '/api/drill/session/{session_id}/action', request: { params, body: { content: { 'application/json': { schema: DrillActionSchema } } } }, responses: response }), async c =>
    c.json(validateResponse(DrillSessionSchema, await deps.drill.act(await authenticatedContext(c, deps.tokens), c.req.valid('param').session_id, c.req.valid('json')), 'POST /api/drill/session/{session_id}/action', c.get('requestId'))))
  app.openapi(createRoute({ method: 'post', path: '/api/drill/session/{session_id}/finish', request: { params, body: { content: { 'application/json': { schema: DrillFinishSchema } } } }, responses: response }), async c =>
    c.json(validateResponse(DrillSessionSchema, await deps.drill.finish(await authenticatedContext(c, deps.tokens), c.req.valid('param').session_id, c.req.valid('json').revision), 'POST /api/drill/session/{session_id}/finish', c.get('requestId'))))
}
