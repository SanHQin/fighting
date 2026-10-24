import { PrismaMariaDb } from '@prisma/adapter-mariadb'
import { PrismaClient } from '../packages/server/src/generated/prisma/index.js'
import { CHARS } from '../packages/server/src/content/characters.ts'

const databaseUrl = process.env.DATABASE_URL
if (!databaseUrl) throw new Error('DATABASE_URL is required; load packages/server/.env before running this script')

const url = new URL(databaseUrl)
const adapter = new PrismaMariaDb({
  host: url.hostname,
  port: Number(url.port || 3306),
  user: decodeURIComponent(url.username),
  password: decodeURIComponent(url.password),
  database: url.pathname.slice(1),
  connectionLimit: 2,
  allowPublicKeyRetrieval: true,
})
const prisma = new PrismaClient({ adapter })

try {
  for (const definition of CHARS) {
    await prisma.characterDefinition.upsert({
      where: { id: definition.id },
      create: { id: definition.id, version: 1, enabled: !definition.locked, definition },
      update: { version: 1, enabled: !definition.locked, definition },
    })
    console.log('seeded ' + definition.id + ' v1')
  }
} finally {
  await prisma.$disconnect()
}
