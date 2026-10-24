-- 初始化残灯台开发数据库
-- 用法（在能连上 root 的终端里）：
--   mysql -u root -p < tools\init-db.sql
--
-- 说明：
--   1. 建一个专用账号 fighting，避免应用直接用 root
--   2. 排序规则 utf8mb4_0900_ai_ci；昵称字段在 schema.prisma 里单独用 _as_cs
--   3. 密码是本地开发用的明文，部署时务必换掉

CREATE DATABASE IF NOT EXISTS `fighting`
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_0900_ai_ci;

CREATE USER IF NOT EXISTS 'fighting'@'localhost' IDENTIFIED BY 'fighting_dev_2026';

-- Prisma 需要建表 / 改表 / 建索引，还要在 migrate dev 时创建影子库
GRANT ALL PRIVILEGES ON `fighting`.* TO 'fighting'@'localhost';
GRANT ALL PRIVILEGES ON `fighting_shadow`.* TO 'fighting'@'localhost';
GRANT CREATE, DROP ON *.* TO 'fighting'@'localhost';

FLUSH PRIVILEGES;

SELECT 'ok' AS result;
