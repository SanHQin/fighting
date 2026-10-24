import 'dotenv/config'
import { defineConfig, env } from 'prisma/config'

/**
 * Prisma 7 起 schema.prisma 里不再写 datasource url，统一挪到这里。
 * `env()` 在变量缺失时会直接报错，比默认成空串好 —— 早失败早发现。
 */
export default defineConfig({
  schema: 'prisma/schema.prisma',
  datasource: {
    url: env('DATABASE_URL'),
  },
  migrations: {
    path: 'prisma/migrations',
  },
})
