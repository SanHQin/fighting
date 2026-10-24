import pathlib
import re

ROOT = pathlib.Path(r"D:\项目\game\fighting")

# 表 → 列 → 注释。这段是「数据库自带文档」的唯一来源：
# 以后加字段先在这里加一行，脚本会把 COMMENT 同时写进 ddl.sql 与迁移脚本。
# 注意：注释里不要出现 ASCII 单引号，否则 SQL 字符串要转义。
C = {
    "users": {
        "uid": "账号主键。BIGINT UNSIGNED 自增，不用 UUID：InnoDB 聚簇索引下随机主键会让插入随机写盘",
        "nickname": "昵称。唯一性由应用层保证（大小写敏感的 utf8mb4_0900_as_cs，Li 与 li 是两个昵称）",
        "email": "邮箱。注册时转小写归一化；游客为 NULL。唯一索引允许 NULL 重复",
        "password_hash": "argon2id 哈希串（含参数与盐）。游客为 NULL —— 用 NULL 而不是空串，才能用 IS NULL 统计真实注册数",
        "is_guest": "是否游客：1 游客 / 0 注册。游客可打 AI 与本地，不能排位，30 天未登录清理",
        "email_verified_at": "邮箱验证时间。v1 不做验证流程，字段先留着，加验证时不用改表",
        "rating": "Elo 评分，初始 1000。公开分，用于段位与排行榜",
        "rating_dev": "评分不确定度（Glicko 的 RD），初始 300。越大表示分越不可信，用于匹配与段位显示",
        "wins": "累计胜场。冗余计数，查排行榜时避免扫 match_players",
        "losses": "累计负场",
        "avatar_hue": "头像色相 0-359。不存图片，用色相加昵称首字生成头像，省一份存储与 CDN",
        "banned_until": "封禁到期时间。NULL 表示未封禁；9999-12-31 表示永久封禁",
        "ban_reason": "封禁理由。后台必填 —— 三个月后没人记得为什么封的",
        "last_login_at": "最近登录时间。用于 30 天游客清理与活跃用户统计",
        "role": "后台角色：0 玩家 / 1 审核员 / 2 管理员。不进 JWT、每次查库 —— 撤销权限不该有 15 分钟真空期",
        "created_at": "注册时间（UTC）。毫秒精度，展示时按浏览器时区换算",
        "updated_at": "行更新时间（UTC）。应用层维护，不依赖 ON UPDATE，便于回滚时保留原值",
    },
    "user_sessions": {
        "id": "会话主键。一条 refresh 令牌一行",
        "user_id": "所属账号。故意不建外键：外键会在大批量清理会话时锁表，改用 idx_sessions_user 兜底",
        "refresh_token_hash": "refresh 令牌的 sha256（hex, 64 字符）。库里永不存原文 —— 库被拖走也无法冒充登录",
        "user_agent": "签发时的 UA，截断 255。用于自查登录设备与异常登录提示",
        "ip": "签发时的 IP，IPv6 最长 45 字符。仅用于审计与限流关联，不做地理位置",
        "expires_at": "过期时间（UTC，7 天）。过期后即使未吊销也不可用",
        "revoked_at": "吊销时间（UTC）。NULL 表示有效。非 NULL 仍被使用则判定令牌泄露，整账号下线",
        "last_used_at": "最近一次 refresh 时间。配合宽限期识别多标签页并发刷新",
        "created_at": "签发时间（UTC）。轮换时用它判断是否由这条会话派生出更新的会话",
    },
    "matches": {
        "id": "对局主键",
        "public_id": "对外 12 位随机串。API 与回放链接只用它，避免暴露自增 id 被枚举",
        "stage_id": "场地 id（dying_beacon / gearworks / ember_field / sky_bridge）。存字符串而不是外键，场地是代码里的数据",
        "mode": "模式：0 本地双人 / 1 人机 / 2 在线。TINYINT 不用 ENUM —— ENUM 加值要 DDL 且排序按定义序",
        "winner_slot": "胜者槽位 0/1。平局或中断为 NULL",
        "round_count": "实际进行的回合数。3 命制下每次全员落命算一回合",
        "duration_ms": "对局时长（毫秒）。UINT 够 49 天，不必 BIGINT",
        "ruleset_hash": "规则哈希。同 hash 才能重演回放 —— 角色数值一改，老回放就不可信",
        "started_at": "开始时间（UTC）",
        "ended_at": "结束时间（UTC）。中断的对局为 NULL，用来区分没打完与打完了",
        "created_at": "落库时间（UTC）。列表默认按它倒序",
    },
    "match_players": {
        "id": "主键",
        "match_id": "所属对局",
        "slot": "槽位 0/1（对应 P1/P2）。与 match_id 组成唯一键",
        "uid": "账号。游客也会占一行，便于统计该游客的对局",
        "char_id": "角色 id（li / aoi / ken）。存字符串便于人读，代价是改名要洗数据",
        "stocks_left": "结束时剩余命数。0 表示被打空",
        "damage_dealt": "本局造成的总伤害（百分比累加）。用于结算页与角色平衡统计",
        "max_combo": "本局最高连击段数",
        "knockdowns": "被击倒次数。反映抗压能力，也是角色调参依据",
        "rating_before": "结算前评分。存快照而不是回算 —— Elo/Glicko 参数一改，历史就算不回去了",
        "rating_after": "结算后评分。差值即结算页上显示的加减分",
        "input_hash": "本局输入流哈希。与对端不一致说明有人篡改输入，用于反作弊",
        "created_at": "落库时间（UTC）",
    },
    "match_rounds": {
        "id": "主键",
        "match_id": "所属对局",
        "round_no": "回合序号，从 1 起。与 match_id 组成唯一键",
        "winner_slot": "该回合胜者槽位。平局为 NULL",
        "duration_ms": "该回合时长（毫秒）",
        "ended_at": "该回合结束时间（UTC）",
        "created_at": "落库时间（UTC）。回合明细通常与对局同批写入，这一列用于排查写入延迟",
    },
    "match_round_survivors": {
        "id": "主键",
        "round_id": "所属回合",
        "slot": "存活者槽位。只记该回合结束时还活着的人",
        "stocks_left": "该回合结束时剩余命数",
        "damage": "该回合结束时的伤害百分比。回合之间要清伤害，所以这里必须存快照",
    },
    "replays": {
        "match_id": "对局主键兼本表主键，一对一",
        "payload": "压缩后的输入流（gzip）。只存输入不存状态：3 分钟对局约 43KB，压后约 10KB；重演靠 battle-core 确定性",
        "size_bytes": "压缩前大小。用于观察回放膨胀，超过 200KB 要查是不是录了多余帧",
        "checksum": "终局校验和（hex, 16）。重演结果必须与它一致，否则说明内核版本不兼容",
        "created_at": "落库时间（UTC）",
    },
    "admin_audit_logs": {
        "id": "主键",
        "actor_uid": "操作人账号。故意不建外键：GM 账号被删后审计记录必须还在",
        "action": "动作码，如 user.ban / user.setRole。用字符串不用枚举，加动作不用改表",
        "target_type": "目标类型 user / match / stage 等。与 target_id 组成可点回的目标",
        "target_id": "目标 id（字符串，兼容自增 id 与 public_id）",
        "detail": "补充说明，截断 512。封禁理由、改名前后的昵称都放这里",
        "ip": "操作来源 IP。审计的价值一半在于谁、从哪",
        "created_at": "操作时间（UTC）。审计表只追加不修改",
    },
}

# ── 1. ddl.sql：给每列加 COMMENT ─────────────────────────────
ddl_path = ROOT / "tools/ddl.sql"
lines = ddl_path.read_text(encoding="utf-8").split("\n")
cur = None
added = 0
for i, ln in enumerate(lines):
    m = re.match(r"^CREATE TABLE IF NOT EXISTS `(\w+)`", ln)
    if m:
        cur = m.group(1)
        continue
    m = re.match(r"^(  `(\w+)` .*?)(,\s*)$", ln)
    if m and cur and m.group(2) in C.get(cur, {}):
        col = m.group(2)
        if "COMMENT '" not in ln:
            lines[i] = m.group(1) + " COMMENT '" + C[cur][col] + "'" + m.group(3)
            added += 1
ddl_path.write_text("\n".join(lines), encoding="utf-8")
print("ddl.sql 加注释:", added)

# ── 2. 迁移脚本：给已在跑的库补注释（MODIFY COLUMN，不改数据） ──
type_map = {}
cur = None
for ln in lines:
    m = re.match(r"^CREATE TABLE IF NOT EXISTS `(\w+)`", ln)
    if m:
        cur = m.group(1)
        continue
    m = re.match(r"^  `(\w+)` (.+?) (NOT NULL|NULL)(.*?)$", ln)
    if m and cur:
        rest = re.sub(r" COMMENT '[^']*'", "", m.group(4))
        rest = re.sub(r",\s*$", "", rest).strip()
        type_map[(cur, m.group(1))] = (m.group(2), m.group(3), rest)

out = [
    "-- 补齐字段注释（v0.10.0）",
    "-- 与 tools/ddl.sql 的 COMMENT 同源；幂等：只 MODIFY COLUMN，不改类型与数据。",
    "",
    "SET NAMES utf8mb4;",
    "",
]
n = 0
for tbl, cols in C.items():
    stmts = []
    for col, cmt in cols.items():
        key = (tbl, col)
        if key not in type_map:
            continue
        typ, null, rest = type_map[key]
        tail = (" " + rest) if rest else ""
        stmts.append(f"  MODIFY COLUMN `{col}` {typ} {null}{tail} COMMENT '{cmt}'")
    if stmts:
        n += len(stmts)
        out.append(f"ALTER TABLE `{tbl}`")
        out.append(",\n".join(stmts) + ";")
        out.append("")
(ROOT / "tools/migrate-v10-comments.sql").write_text("\n".join(out), encoding="utf-8")
print("迁移 MODIFY 条数:", n)
