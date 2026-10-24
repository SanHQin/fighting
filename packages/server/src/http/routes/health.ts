/**
 * 健康检查。运维和 CI 用，也用来给前端一个"后端在不在"的探测点。
 */
import type { FastifyInstance } from 'fastify'
import { prisma } from '../../db/client.ts'
import { config } from '../../config.ts'
import { CHARS } from '../../content/characters.ts'

const startedAt = Date.now()

export async function healthRoutes(app: FastifyInstance): Promise<void> {
  app.get('/characters', async (_req, reply) => {
    try {
      const rows = await prisma.characterDefinition.findMany({ where: { enabled: true } })
      const definitions = rows.map((row) => row.definition as unknown as (typeof CHARS)[number])
      if (definitions.length === 0) throw new Error('character catalog empty')
      for (const definition of definitions) {
        if (!definition.id || !Number.isInteger(definition.numId) || !Array.isArray(definition.specials)) {
          throw new Error(`invalid character definition: ${definition.id ?? 'unknown'}`)
        }
        for (const move of Object.values(definition.moves ?? {})) {
          for (const [key, value] of Object.entries(move ?? {})) {
            if (key === 'name' ? typeof value !== 'string' || !value.trim() : key === 'boxBack' ? typeof value !== 'boolean' : typeof value !== 'number' || !Number.isFinite(value)) {
              throw new Error(`invalid move field: ${definition.id}.${key}`)
            }
          }
        }
      }
      return { ok: true, data: { version: 1, characters: definitions } }
    } catch {
      reply.header('cache-control', 'public, max-age=60, stale-while-revalidate=300')
      return { ok: true, data: { version: 1, characters: CHARS, source: 'fallback' } }
    }
  })

  app.get('/health', async () => ({
    ok: true,
    data: {
      status: 'up',
      env: config.NODE_ENV,
      uptimeSec: Math.floor((Date.now() - startedAt) / 1000),
      version: '0.1.0',
    },
  }))

  /** 带数据库探活。探不通返回 503，方便负载均衡摘节点 */
  app.get('/health/deep', async (_req, reply) => {
    const t0 = Date.now()
    try {
      await prisma.$queryRaw`SELECT 1`
      return {
        ok: true,
        data: { db: 'up', dbLatencyMs: Date.now() - t0, uptimeSec: Math.floor((Date.now() - startedAt) / 1000) },
      }
    } catch (e) {
      reply.code(503)
      return {
        ok: false,
        error: { code: 'DB_DOWN', message: e instanceof Error ? e.message : '数据库不可用' },
      }
    }
  })
}
