-- 补齐字段注释（v0.10.0）
-- 与 tools/ddl.sql 的 COMMENT 同源；幂等：只 MODIFY COLUMN，不改类型与数据。

SET NAMES utf8mb4;

ALTER TABLE `users`
  MODIFY COLUMN `uid` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '账号主键。BIGINT UNSIGNED 自增，不用 UUID：InnoDB 聚簇索引下随机主键会让插入随机写盘',
  MODIFY COLUMN `nickname` VARCHAR(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_as_cs NOT NULL COMMENT '昵称。唯一性由应用层保证（大小写敏感的 utf8mb4_0900_as_cs，Li 与 li 是两个昵称）',
  MODIFY COLUMN `email` VARCHAR(190) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_as_cs NULL COMMENT '邮箱。注册时转小写归一化；游客为 NULL。唯一索引允许 NULL 重复',
  MODIFY COLUMN `password_hash` VARCHAR(255) NULL COMMENT 'argon2id 哈希串（含参数与盐）。游客为 NULL —— 用 NULL 而不是空串，才能用 IS NULL 统计真实注册数',
  MODIFY COLUMN `is_guest` TINYINT(1) NOT NULL DEFAULT 1 COMMENT '是否游客：1 游客 / 0 注册。游客可打 AI 与本地，不能排位，30 天未登录清理',
  MODIFY COLUMN `email_verified_at` DATETIME(3) NULL COMMENT '邮箱验证时间。v1 不做验证流程，字段先留着，加验证时不用改表',
  MODIFY COLUMN `rating` INT NOT NULL DEFAULT 1000 COMMENT 'Elo 评分，初始 1000。公开分，用于段位与排行榜',
  MODIFY COLUMN `rating_dev` INT NOT NULL DEFAULT 300 COMMENT '评分不确定度（Glicko 的 RD），初始 300。越大表示分越不可信，用于匹配与段位显示',
  MODIFY COLUMN `wins` INT NOT NULL DEFAULT 0 COMMENT '累计胜场。冗余计数，查排行榜时避免扫 match_players',
  MODIFY COLUMN `losses` INT NOT NULL DEFAULT 0 COMMENT '累计负场',
  MODIFY COLUMN `avatar_hue` INT NOT NULL DEFAULT 210 COMMENT '头像色相 0-359。不存图片，用色相加昵称首字生成头像，省一份存储与 CDN',
  MODIFY COLUMN `banned_until` DATETIME(3) NULL COMMENT '封禁到期时间。NULL 表示未封禁；9999-12-31 表示永久封禁',
  MODIFY COLUMN `ban_reason` VARCHAR(255) NULL COMMENT '封禁理由。后台必填 —— 三个月后没人记得为什么封的',
  MODIFY COLUMN `last_login_at` DATETIME(3) NULL COMMENT '最近登录时间。用于 30 天游客清理与活跃用户统计',
  MODIFY COLUMN `role` TINYINT NOT NULL DEFAULT 0 COMMENT '后台角色：0 玩家 / 1 审核员 / 2 管理员。不进 JWT、每次查库 —— 撤销权限不该有 15 分钟真空期',
  MODIFY COLUMN `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) COMMENT '注册时间（UTC）。毫秒精度，展示时按浏览器时区换算',
  MODIFY COLUMN `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) COMMENT '行更新时间（UTC）。应用层维护，不依赖 ON UPDATE，便于回滚时保留原值';

ALTER TABLE `user_sessions`
  MODIFY COLUMN `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '会话主键。一条 refresh 令牌一行',
  MODIFY COLUMN `user_id` BIGINT UNSIGNED NOT NULL COMMENT '所属账号。故意不建外键：外键会在大批量清理会话时锁表，改用 idx_sessions_user 兜底',
  MODIFY COLUMN `refresh_token_hash` CHAR(64) NOT NULL COMMENT 'refresh 令牌的 sha256（hex, 64 字符）。库里永不存原文 —— 库被拖走也无法冒充登录',
  MODIFY COLUMN `user_agent` VARCHAR(255) NULL COMMENT '签发时的 UA，截断 255。用于自查登录设备与异常登录提示',
  MODIFY COLUMN `ip` VARCHAR(45) NULL COMMENT '签发时的 IP，IPv6 最长 45 字符。仅用于审计与限流关联，不做地理位置',
  MODIFY COLUMN `expires_at` DATETIME(3) NOT NULL COMMENT '过期时间（UTC，7 天）。过期后即使未吊销也不可用',
  MODIFY COLUMN `revoked_at` DATETIME(3) NULL COMMENT '吊销时间（UTC）。NULL 表示有效。非 NULL 仍被使用则判定令牌泄露，整账号下线',
  MODIFY COLUMN `last_used_at` DATETIME(3) NULL COMMENT '最近一次 refresh 时间。配合宽限期识别多标签页并发刷新',
  MODIFY COLUMN `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) COMMENT '签发时间（UTC）。轮换时用它判断是否由这条会话派生出更新的会话';

ALTER TABLE `matches`
  MODIFY COLUMN `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '对局主键',
  MODIFY COLUMN `public_id` CHAR(12) NOT NULL COMMENT '对外 12 位随机串。API 与回放链接只用它，避免暴露自增 id 被枚举',
  MODIFY COLUMN `stage_id` VARCHAR(32) NOT NULL COMMENT '场地 id（dying_beacon / gearworks / ember_field / sky_bridge）。存字符串而不是外键，场地是代码里的数据',
  MODIFY COLUMN `mode` TINYINT NOT NULL DEFAULT 0 COMMENT '模式：0 本地双人 / 1 人机 / 2 在线。TINYINT 不用 ENUM —— ENUM 加值要 DDL 且排序按定义序',
  MODIFY COLUMN `winner_slot` TINYINT NULL COMMENT '胜者槽位 0/1。平局或中断为 NULL',
  MODIFY COLUMN `round_count` TINYINT NOT NULL DEFAULT 1 COMMENT '实际进行的回合数。3 命制下每次全员落命算一回合',
  MODIFY COLUMN `duration_ms` INT UNSIGNED NOT NULL DEFAULT 0 COMMENT '对局时长（毫秒）。UINT 够 49 天，不必 BIGINT',
  MODIFY COLUMN `ruleset_hash` CHAR(16) NOT NULL COMMENT '规则哈希。同 hash 才能重演回放 —— 角色数值一改，老回放就不可信',
  MODIFY COLUMN `started_at` DATETIME(3) NOT NULL COMMENT '开始时间（UTC）',
  MODIFY COLUMN `ended_at` DATETIME(3) NULL COMMENT '结束时间（UTC）。中断的对局为 NULL，用来区分没打完与打完了',
  MODIFY COLUMN `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) COMMENT '落库时间（UTC）。列表默认按它倒序';

ALTER TABLE `match_players`
  MODIFY COLUMN `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '主键',
  MODIFY COLUMN `match_id` BIGINT UNSIGNED NOT NULL COMMENT '所属对局',
  MODIFY COLUMN `slot` TINYINT NOT NULL COMMENT '槽位 0/1（对应 P1/P2）。与 match_id 组成唯一键',
  MODIFY COLUMN `uid` BIGINT UNSIGNED NOT NULL COMMENT '账号。游客也会占一行，便于统计该游客的对局',
  MODIFY COLUMN `char_id` VARCHAR(16) NOT NULL COMMENT '角色 id（li / aoi / ken）。存字符串便于人读，代价是改名要洗数据',
  MODIFY COLUMN `stocks_left` TINYINT NOT NULL DEFAULT 0 COMMENT '结束时剩余命数。0 表示被打空',
  MODIFY COLUMN `damage_dealt` INT UNSIGNED NOT NULL DEFAULT 0 COMMENT '本局造成的总伤害（百分比累加）。用于结算页与角色平衡统计',
  MODIFY COLUMN `max_combo` TINYINT NOT NULL DEFAULT 0 COMMENT '本局最高连击段数',
  MODIFY COLUMN `knockdowns` TINYINT NOT NULL DEFAULT 0 COMMENT '被击倒次数。反映抗压能力，也是角色调参依据',
  MODIFY COLUMN `rating_before` INT NULL COMMENT '结算前评分。存快照而不是回算 —— Elo/Glicko 参数一改，历史就算不回去了',
  MODIFY COLUMN `rating_after` INT NULL COMMENT '结算后评分。差值即结算页上显示的加减分',
  MODIFY COLUMN `input_hash` CHAR(16) NULL COMMENT '本局输入流哈希。与对端不一致说明有人篡改输入，用于反作弊',
  MODIFY COLUMN `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) COMMENT '落库时间（UTC）';

ALTER TABLE `match_rounds`
  MODIFY COLUMN `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '主键',
  MODIFY COLUMN `match_id` BIGINT UNSIGNED NOT NULL COMMENT '所属对局',
  MODIFY COLUMN `round_no` TINYINT NOT NULL COMMENT '回合序号，从 1 起。与 match_id 组成唯一键',
  MODIFY COLUMN `winner_slot` TINYINT NULL COMMENT '该回合胜者槽位。平局为 NULL',
  MODIFY COLUMN `duration_ms` INT UNSIGNED NOT NULL DEFAULT 0 COMMENT '该回合时长（毫秒）',
  MODIFY COLUMN `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) COMMENT '落库时间（UTC）。回合明细通常与对局同批写入，这一列用于排查写入延迟';

ALTER TABLE `match_round_survivors`
  MODIFY COLUMN `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '主键',
  MODIFY COLUMN `round_id` BIGINT UNSIGNED NOT NULL COMMENT '所属回合',
  MODIFY COLUMN `slot` TINYINT NOT NULL COMMENT '存活者槽位。只记该回合结束时还活着的人',
  MODIFY COLUMN `stocks_left` TINYINT NOT NULL COMMENT '该回合结束时剩余命数';

ALTER TABLE `replays`
  MODIFY COLUMN `match_id` BIGINT UNSIGNED NOT NULL COMMENT '对局主键兼本表主键，一对一',
  MODIFY COLUMN `payload` LONGBLOB NOT NULL COMMENT '压缩后的输入流（gzip）。只存输入不存状态：3 分钟对局约 43KB，压后约 10KB；重演靠 battle-core 确定性',
  MODIFY COLUMN `size_bytes` INT UNSIGNED NOT NULL COMMENT '压缩前大小。用于观察回放膨胀，超过 200KB 要查是不是录了多余帧',
  MODIFY COLUMN `checksum` CHAR(16) NOT NULL COMMENT '终局校验和（hex, 16）。重演结果必须与它一致，否则说明内核版本不兼容',
  MODIFY COLUMN `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) COMMENT '落库时间（UTC）';

ALTER TABLE `admin_audit_logs`
  MODIFY COLUMN `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '主键',
  MODIFY COLUMN `actor_uid` BIGINT UNSIGNED NOT NULL COMMENT '操作人账号。故意不建外键：GM 账号被删后审计记录必须还在',
  MODIFY COLUMN `action` VARCHAR(48) NOT NULL COMMENT '动作码，如 user.ban / user.setRole。用字符串不用枚举，加动作不用改表',
  MODIFY COLUMN `target_type` VARCHAR(24) NOT NULL COMMENT '目标类型 user / match / stage 等。与 target_id 组成可点回的目标',
  MODIFY COLUMN `target_id` VARCHAR(64) NOT NULL COMMENT '目标 id（字符串，兼容自增 id 与 public_id）',
  MODIFY COLUMN `detail` VARCHAR(512) NULL COMMENT '补充说明，截断 512。封禁理由、改名前后的昵称都放这里',
  MODIFY COLUMN `ip` VARCHAR(45) NULL COMMENT '操作来源 IP。审计的价值一半在于谁、从哪',
  MODIFY COLUMN `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) COMMENT '操作时间（UTC）。审计表只追加不修改';
