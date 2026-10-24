-- 增量迁移：v0.8 后台账号体系
-- 对已经建过表的库跑一次即可；重复执行是安全的。
SET NAMES utf8mb4;

-- 1) users 增加 role
SET @has_col := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users' AND COLUMN_NAME = 'role'
);
SET @sql := IF(@has_col = 0,
  'ALTER TABLE `users` ADD COLUMN `role` TINYINT NOT NULL DEFAULT 0 AFTER `last_login_at`',
  'DO 0');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- 2) 操作审计表
CREATE TABLE IF NOT EXISTS `admin_audit_logs` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `actor_uid` BIGINT UNSIGNED NOT NULL,
  `action` VARCHAR(48) NOT NULL,
  `target_type` VARCHAR(24) NOT NULL,
  `target_id` VARCHAR(64) NOT NULL,
  `detail` VARCHAR(512) NULL,
  `ip` VARCHAR(45) NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  KEY `idx_audit_actor` (`actor_uid`, `created_at`),
  KEY `idx_audit_target` (`target_type`, `target_id`),
  KEY `idx_audit_created` (`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
