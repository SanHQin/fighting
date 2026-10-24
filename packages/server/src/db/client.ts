/**
 * Prisma 客户端。
 *
 * Prisma 7 起所有数据库都必须走 driver adapter，MySQL 用
 * `@prisma/adapter-mariadb`（底层 mariadb 驱动，兼容 MySQL 8 协议）。
 * 好处是连接池参数、超时都归我们显式控制，不再是 Prisma 的黑盒。
 */
import { PrismaMariaDb } from '@prisma/adapter-mariadb'
import { PrismaClient } from '../generated/prisma/index.js'
import { config } from '../config.ts'

/** 从 DATABASE_URL 里拆出连接参数 */
function poolOptions(url: string, connectionLimit: number) {
  const u = new URL(url)
  const dbName = u.pathname.replace(/^\//, '')
  if (!dbName) throw new Error('[db] DATABASE_URL 里没有数据库名')

  return {
    host: u.hostname,
    port: u.port ? Number(u.port) : 3306,
    user: decodeURIComponent(u.username),
    password: decodeURIComponent(u.password),
    database: dbName,
    connectionLimit,
    // MySQL 8 默认的 caching_sha2_password 在**非 TLS 连接**上做完整认证时，
    // 需要服务器把 RSA 公钥发过来加密密码；驱动默认拒绝接收，于是报
    //   "RSA public key is not available client side"
    // 表现是「有时候能连、有时候连不上」——因为服务端会缓存认证成功的结果，
    // 缓存命中的那次是 fast auth，不需要公钥。这种时有时无最难查。
    // 本地开发允许取公钥；生产环境要么开 TLS，要么把 cachingRsaPublicKey
    // 固定成服务器证书里的那把，不能留这个口子。
    allowPublicKeyRetrieval: true,
    // 本地开发把 acquire 放宽一点，避免 watch 重启时抢连接
    acquireTimeout: 10_000,
    // 让连接自己活过来，而不是等第一次请求才发现断线
    idleTimeout: 60,
  }
}

const adapter = new PrismaMariaDb(poolOptions(config.DATABASE_URL, config.DATABASE_POOL_SIZE))

export const prisma = new PrismaClient({
  adapter,
  log: config.isProd ? ['error'] : ['error', 'warn'],
})

/** 启动时探活，连不上就明确报错，而不是让第一个请求超时 */
export async function pingDb(): Promise<void> {
  await prisma.$queryRaw`SELECT 1`
}

export async function closeDb(): Promise<void> {
  await prisma.$disconnect()
}
