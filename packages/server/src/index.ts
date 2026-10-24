/**
 * 进程入口。
 *
 * 启动顺序刻意是"先连库再监听端口"：健康检查一上来就能反映真实状态，
 * 而不是先对外接流量、再发现连不上数据库。
 */
import { config } from './config.ts'
import { buildApp } from './http/app.ts'
import { pingDb, closeDb } from './db/client.ts'

async function main(): Promise<void> {
  const app = await buildApp()

  try {
    await pingDb()
    app.log.info('数据库连接正常')
  } catch (e) {
    app.log.error({ err: e }, '数据库连接失败 —— 检查 .env 里的 DATABASE_URL 与 MySQL 服务')
    process.exitCode = 1
    await app.close().catch(() => undefined)
    return
  }

  try {
    await app.listen({ port: config.PORT, host: config.HOST })
    app.log.info(`后端就绪 http://${config.HOST}:${config.PORT}`)
    app.log.info(`WebSocket  ws://${config.HOST}:${config.PORT}/ws`)
  } catch (e) {
    app.log.error({ err: e }, '监听端口失败')
    process.exitCode = 1
    return
  }

  const shutdown = async (signal: string): Promise<void> => {
    app.log.info(`收到 ${signal}，开始关闭`)
    try {
      await app.close()
      await closeDb()
    } finally {
      process.exit(0)
    }
  }

  process.on('SIGINT', () => void shutdown('SIGINT'))
  process.on('SIGTERM', () => void shutdown('SIGTERM'))
  // 未捕获异常不要静默吞掉：打出来再退，否则线上表现是"进程莫名消失"
  process.on('unhandledRejection', (reason) => {
    app.log.error({ err: reason }, 'unhandledRejection')
  })
  process.on('uncaughtException', (e) => {
    app.log.fatal({ err: e }, 'uncaughtException')
    process.exit(1)
  })
}

void main()
