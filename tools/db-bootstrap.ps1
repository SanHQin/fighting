# 一次性初始化数据库：建库、建账号、跑首次 migration
#
# 用法（在项目根目录，普通 PowerShell 窗口里，不要在受限沙箱里跑）：
#   powershell -ExecutionPolicy Bypass -File tools\db-bootstrap.ps1
#
# 需要 MySQL root 密码（会提示输入，不会写进任何文件）。
# 如果 root 密码已经写在环境变量 MYSQL_PWD 里，就不会再提示。

param(
  [string]$RootUser = 'root',
  [string]$MySqlBin = 'C:\Program Files\MySQL\MySQL Server 8.0\bin'
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

$mysqlExe = Join-Path $MySqlBin 'mysql.exe'
if (-not (Test-Path $mysqlExe)) {
  Write-Host "找不到 mysql.exe：$mysqlExe" -ForegroundColor Red
  Write-Host "用 -MySqlBin 指定 MySQL 的 bin 目录，例如：" -ForegroundColor Yellow
  Write-Host '  powershell -File tools\db-bootstrap.ps1 -MySqlBin "C:\Program Files\MySQL\MySQL Server 8.4\bin"'
  exit 1
}

Write-Host "== 1/3 检查 MySQL 服务" -ForegroundColor Cyan
$svc = Get-Service -Name 'MySQL80' -ErrorAction SilentlyContinue
if ($svc) {
  if ($svc.Status -ne 'Running') {
    Write-Host "MySQL80 没在运行，尝试启动（需要管理员）..." -ForegroundColor Yellow
    Start-Service MySQL80
  }
  Write-Host "  MySQL80 = $((Get-Service MySQL80).Status)"
} else {
  Write-Host "  未找到 MySQL80 服务，假设 MySQL 已在别处运行。" -ForegroundColor Yellow
}

Write-Host "== 2/3 建库与账号" -ForegroundColor Cyan
$sqlFile = Join-Path $PSScriptRoot 'init-db.sql'

if ($env:MYSQL_PWD) {
  & $mysqlExe -u $RootUser -h 127.0.0.1 --default-character-set=utf8mb4 -e "source $($sqlFile -replace '\\','/')"
} else {
  & $mysqlExe -u $RootUser -h 127.0.0.1 --default-character-set=utf8mb4 -e "source $($sqlFile -replace '\\','/')"
}

if ($LASTEXITCODE -ne 0) {
  Write-Host "建库失败。检查 root 密码是否正确。" -ForegroundColor Red
  exit $LASTEXITCODE
}
Write-Host "  已创建 database 'fighting' 与 user 'fighting'" -ForegroundColor Green

Write-Host "== 3/3 首次 migration" -ForegroundColor Cyan
Push-Location (Join-Path $root 'packages\server')
try {
  pnpm exec prisma migrate dev --name init
  if ($LASTEXITCODE -ne 0) {
    Write-Host "migration 失败。若卡在 shadow database，确认 init-db.sql 里的授权已执行。" -ForegroundColor Red
    exit $LASTEXITCODE
  }
} finally {
  Pop-Location
}

Write-Host ""
Write-Host "完成。接着跑：" -ForegroundColor Green
Write-Host "  后端  pnpm dev:server     → http://127.0.0.1:3001/api/health"
Write-Host "  前端  cd packages\client; node ..\..\tools\dev.cjs --port 5173"
