-- 与 packages/server/prisma/schema.prisma 一一对应的 DDL
--
-- 为什么手写而不是 `prisma migrate dev`：
-- 当前开发机的受限沙箱禁止 Node 以管道 stdio 拉起子进程，
-- 而 Prisma 的 schema engine 正是这么调用的（spawn EPERM）。
-- 在有完整权限的终端里仍然推荐用 `pnpm db:migrate` 生成正式迁移历史；
-- 本文件是等价的建表脚本，用来把库一次性拉起来。
--
-- 改 schema.prisma 时**必须同步改这里**，否则两边会飘。

SET NAMES utf8mb4;

-- ------------------------------------------------ character_definitions
CREATE TABLE IF NOT EXISTS `character_definitions` (
  `id` VARCHAR(32) NOT NULL COMMENT '稳定角色 id（li / aoi / ken）',
  `version` INT NOT NULL DEFAULT 1 COMMENT '规则定义版本；规则变化必须递增',
  `definition` JSON NOT NULL COMMENT 'CharDef JSON，包含九方向招式覆盖与角色专属技能定义',
  `enabled` TINYINT(1) NOT NULL DEFAULT 1 COMMENT '是否在角色选择页开放',
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) COMMENT '行创建时间',
  `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) COMMENT '行更新时间',
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- ---------------------------------------------------------------- users
CREATE TABLE IF NOT EXISTS `users` (
  `uid` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '账号主键。BIGINT UNSIGNED 自增，不用 UUID：InnoDB 聚簇索引下随机主键会让插入随机写盘',
  `nickname` VARCHAR(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_as_cs NOT NULL COMMENT '昵称。唯一性由应用层保证（大小写敏感的 utf8mb4_0900_as_cs，Li 与 li 是两个昵称）',
  `email` VARCHAR(190) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_as_cs NULL COMMENT '邮箱。注册时转小写归一化；游客为 NULL。唯一索引允许 NULL 重复',
  `password_hash` VARCHAR(255) NULL COMMENT 'argon2id 哈希串（含参数与盐）。游客为 NULL —— 用 NULL 而不是空串，才能用 IS NULL 统计真实注册数',
  `is_guest` TINYINT(1) NOT NULL DEFAULT 1 COMMENT '是否游客：1 游客 / 0 注册。游客可打 AI 与本地，不能排位，30 天未登录清理',
  `email_verified_at` DATETIME(3) NULL COMMENT '邮箱验证时间。v1 不做验证流程，字段先留着，加验证时不用改表',
  `rating` INT NOT NULL DEFAULT 1000 COMMENT 'Elo 评分，初始 1000。公开分，用于段位与排行榜',
  `rating_dev` INT NOT NULL DEFAULT 300 COMMENT '评分不确定度（Glicko 的 RD），初始 300。越大表示分越不可信，用于匹配与段位显示',
  `wins` INT NOT NULL DEFAULT 0 COMMENT '累计胜场。冗余计数，查排行榜时避免扫 match_players',
  `losses` INT NOT NULL DEFAULT 0 COMMENT '累计负场',
  `avatar_hue` INT NOT NULL DEFAULT 210 COMMENT '头像色相 0-359。不存图片，用色相加昵称首字生成头像，省一份存储与 CDN',
  `banned_until` DATETIME(3) NULL COMMENT '封禁到期时间。NULL 表示未封禁；9999-12-31 表示永久封禁',
  `ban_reason` VARCHAR(255) NULL COMMENT '封禁理由。后台必填 —— 三个月后没人记得为什么封的',
  `last_login_at` DATETIME(3) NULL COMMENT '最近登录时间。用于 30 天游客清理与活跃用户统计',
  `role` TINYINT NOT NULL DEFAULT 0 COMMENT '后台角色：0 玩家 / 1 审核员 / 2 管理员。不进 JWT、每次查库 —— 撤销权限不该有 15 分钟真空期',
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) COMMENT '注册时间（UTC）。毫秒精度，展示时按浏览器时区换算',
  `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) COMMENT '行更新时间（UTC）。应用层维护，不依赖 ON UPDATE，便于回滚时保留原值',
  PRIMARY KEY (`uid`),
  UNIQUE KEY `uk_users_email` (`email`),
  KEY `idx_users_nickname` (`nickname`),
  KEY `idx_users_last_login` (`last_login_at`),
  KEY `idx_users_rating` (`rating`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- ------------------------------------------------------- user_sessions
CREATE TABLE IF NOT EXISTS `user_sessions` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '会话主键。一条 refresh 令牌一行',
  `user_id` BIGINT UNSIGNED NOT NULL COMMENT '所属账号。故意不建外键：外键会在大批量清理会话时锁表，改用 idx_sessions_user 兜底',
  `refresh_token_hash` CHAR(64) NOT NULL COMMENT 'refresh 令牌的 sha256（hex, 64 字符）。库里永不存原文 —— 库被拖走也无法冒充登录',
  `user_agent` VARCHAR(255) NULL COMMENT '签发时的 UA，截断 255。用于自查登录设备与异常登录提示',
  `ip` VARCHAR(45) NULL COMMENT '签发时的 IP，IPv6 最长 45 字符。仅用于审计与限流关联，不做地理位置',
  `expires_at` DATETIME(3) NOT NULL COMMENT '过期时间（UTC，7 天）。过期后即使未吊销也不可用',
  `revoked_at` DATETIME(3) NULL COMMENT '吊销时间（UTC）。NULL 表示有效。非 NULL 仍被使用则判定令牌泄露，整账号下线',
  `last_used_at` DATETIME(3) NULL COMMENT '最近一次 refresh 时间。配合宽限期识别多标签页并发刷新',
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) COMMENT '签发时间（UTC）。轮换时用它判断是否由这条会话派生出更新的会话',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_sessions_token` (`refresh_token_hash`),
  KEY `idx_sessions_user` (`user_id`, `revoked_at`),
  KEY `idx_sessions_expires` (`expires_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- -------------------------------------------------------------- matches
CREATE TABLE IF NOT EXISTS `matches` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '对局主键',
  `public_id` CHAR(12) NOT NULL COMMENT '对外 12 位随机串。API 与回放链接只用它，避免暴露自增 id 被枚举',
  `stage_id` VARCHAR(32) NOT NULL COMMENT '场地 id（dying_beacon / gearworks / ember_field / sky_bridge）。存字符串而不是外键，场地是代码里的数据',
  `mode` TINYINT NOT NULL DEFAULT 0 COMMENT '模式：0 本地双人 / 1 人机 / 2 在线。TINYINT 不用 ENUM —— ENUM 加值要 DDL 且排序按定义序',
  `winner_slot` TINYINT NULL COMMENT '胜者槽位 0/1。平局或中断为 NULL',
  `round_count` TINYINT NOT NULL DEFAULT 1 COMMENT '实际进行的回合数。3 命制下每次全员落命算一回合',
  `duration_ms` INT UNSIGNED NOT NULL DEFAULT 0 COMMENT '对局时长（毫秒）。UINT 够 49 天，不必 BIGINT',
  `ruleset_hash` CHAR(16) NOT NULL COMMENT '规则哈希。同 hash 才能重演回放 —— 角色数值一改，老回放就不可信',
  `started_at` DATETIME(3) NOT NULL COMMENT '开始时间（UTC）',
  `ended_at` DATETIME(3) NULL COMMENT '结束时间（UTC）。中断的对局为 NULL，用来区分没打完与打完了',
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) COMMENT '落库时间（UTC）。列表默认按它倒序',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_matches_public` (`public_id`),
  KEY `idx_matches_created` (`created_at`),
  KEY `idx_matches_stage` (`stage_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- -------------------------------------------------------- match_players
CREATE TABLE IF NOT EXISTS `match_players` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '主键',
  `match_id` BIGINT UNSIGNED NOT NULL COMMENT '所属对局',
  `uid` BIGINT UNSIGNED NOT NULL COMMENT '账号。游客也会占一行，便于统计该游客的对局',
  `slot` TINYINT NOT NULL COMMENT '槽位 0/1（对应 P1/P2）。与 match_id 组成唯一键',
  `char_id` VARCHAR(16) NOT NULL COMMENT '角色 id（li / aoi / ken）。存字符串便于人读，代价是改名要洗数据',
  `stocks_left` TINYINT NOT NULL DEFAULT 0 COMMENT '结束时剩余命数。0 表示被打空',
  `damage_dealt` INT UNSIGNED NOT NULL DEFAULT 0 COMMENT '本局造成的总伤害（百分比累加）。用于结算页与角色平衡统计',
  `max_combo` TINYINT NOT NULL DEFAULT 0 COMMENT '本局最高连击段数',
  `knockdowns` TINYINT NOT NULL DEFAULT 0 COMMENT '被击倒次数。反映抗压能力，也是角色调参依据',
  `rating_before` INT NULL COMMENT '结算前评分。存快照而不是回算 —— Elo/Glicko 参数一改，历史就算不回去了',
  `rating_after` INT NULL COMMENT '结算后评分。差值即结算页上显示的加减分',
  `input_hash` CHAR(16) NULL COMMENT '本局输入流哈希。与对端不一致说明有人篡改输入，用于反作弊',
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) COMMENT '落库时间（UTC）',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_players_match_slot` (`match_id`, `slot`),
  KEY `idx_players_uid` (`uid`, `created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- --------------------------------------------------------- match_rounds
CREATE TABLE IF NOT EXISTS `match_rounds` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '主键',
  `match_id` BIGINT UNSIGNED NOT NULL COMMENT '所属对局',
  `round_no` TINYINT NOT NULL COMMENT '回合序号，从 1 起。与 match_id 组成唯一键',
  `winner_slot` TINYINT NULL COMMENT '该回合胜者槽位。平局为 NULL',
  `duration_ms` INT UNSIGNED NOT NULL DEFAULT 0 COMMENT '该回合时长（毫秒）',
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) COMMENT '落库时间（UTC）。回合明细通常与对局同批写入，这一列用于排查写入延迟',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_rounds_match_no` (`match_id`, `round_no`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- ----------------------------------------------- match_round_survivors
CREATE TABLE IF NOT EXISTS `match_round_survivors` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '主键',
  `round_id` BIGINT UNSIGNED NOT NULL COMMENT '所属回合',
  `slot` TINYINT NOT NULL COMMENT '存活者槽位。只记该回合结束时还活着的人',
  `stocks_left` TINYINT NOT NULL COMMENT '该回合结束时剩余命数',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_survivors_round_slot` (`round_id`, `slot`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- -------------------------------------------------------------- replays
CREATE TABLE IF NOT EXISTS `replays` (
  `match_id` BIGINT UNSIGNED NOT NULL COMMENT '对局主键兼本表主键，一对一',
  `payload` LONGBLOB NOT NULL COMMENT '压缩后的输入流（gzip）。只存输入不存状态：3 分钟对局约 43KB，压后约 10KB；重演靠 battle-core 确定性',
  `size_bytes` INT UNSIGNED NOT NULL COMMENT '压缩前大小。用于观察回放膨胀，超过 200KB 要查是不是录了多余帧',
  `checksum` CHAR(16) NOT NULL COMMENT '终局校验和（hex, 16）。重演结果必须与它一致，否则说明内核版本不兼容',
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) COMMENT '落库时间（UTC）',
  PRIMARY KEY (`match_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- ------------------------------------------------------- admin_audit_logs
CREATE TABLE IF NOT EXISTS `admin_audit_logs` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '主键',
  `actor_uid` BIGINT UNSIGNED NOT NULL COMMENT '操作人账号。故意不建外键：GM 账号被删后审计记录必须还在',
  `action` VARCHAR(48) NOT NULL COMMENT '动作码，如 user.ban / user.setRole。用字符串不用枚举，加动作不用改表',
  `target_type` VARCHAR(24) NOT NULL COMMENT '目标类型 user / match / stage 等。与 target_id 组成可点回的目标',
  `target_id` VARCHAR(64) NOT NULL COMMENT '目标 id（字符串，兼容自增 id 与 public_id）',
  `detail` VARCHAR(512) NULL COMMENT '补充说明，截断 512。封禁理由、改名前后的昵称都放这里',
  `ip` VARCHAR(45) NULL COMMENT '操作来源 IP。审计的价值一半在于谁、从哪',
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) COMMENT '操作时间（UTC）。审计表只追加不修改',
  PRIMARY KEY (`id`),
  KEY `idx_audit_actor` (`actor_uid`, `created_at`),
  KEY `idx_audit_target` (`target_type`, `target_id`),
  KEY `idx_audit_created` (`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
