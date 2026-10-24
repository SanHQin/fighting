/**
 * 把某个账号提升为管理员（或降回玩家）。
 *
 *   node src/scripts/set-role.ts <uid|邮箱|昵称> <0|1|2>
 *
 * 为什么要有这个脚本：后台接口本身要求管理员权限，所以第一个管理员
 * 只能从命令行给。这是所有权限系统的鸡生蛋问题，别想着绕开它，
 * 老老实实留一个需要服务器权限才能执行的入口。
 */
import { prisma, closeDb } from '../db/client.ts'
import { ROLE, ROLE_LABEL } from '../services/admin.ts'

async function main(): Promise<void> {
  const [, , who, roleArg] = process.argv
  if (!who || roleArg === undefined) {
    console.error('用法: node src/scripts/set-role.ts <uid|邮箱|昵称> <0|1|2>')
    process.exit(1)
  }

  const role = Number(roleArg)
  if (![ROLE.PLAYER, ROLE.MODERATOR, ROLE.ADMIN].includes(role as never)) {
    console.error('角色只能是 0（玩家）/ 1（审核员）/ 2（管理员）')
    process.exit(1)
  }

  const found = /^\d+$/.test(who)
    ? await prisma.user.findUnique({ where: { uid: BigInt(who) }, select: { uid: true, nickname: true, role: true } })
    : await prisma.user.findFirst({
        where: { OR: [{ email: who }, { nickname: who }] },
        select: { uid: true, nickname: true, role: true },
      })

  if (!found) {
    console.error(`找不到账号: ${who}`)
    process.exit(1)
  }

  await prisma.user.update({ where: { uid: found.uid }, data: { role } })
  console.log(
    `已设置 ${found.nickname} (uid=${found.uid}) 的角色: ${ROLE_LABEL[found.role]} → ${ROLE_LABEL[role]}`,
  )
  await closeDb()
}

main().catch(async (e) => {
  console.error('执行失败:', e)
  await closeDb().catch(() => undefined)
  process.exit(1)
})
