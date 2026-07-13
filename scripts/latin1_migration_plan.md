# prod 数据库 LATIN1 → UTF8 迁移方案（路径A：dump/restore 换库）

> **状态：已于 2026-07-13 执行完成，prod 库现 spribe_utf8，旧库 spribe 保留回滚至 2026-07-15。**
> （2026-07-13 SSH 只读核验：app LIVE 库 = spribe_utf8/UTF8；旧库 spribe/LATIN1 42MB 保留。）
> 文档 newly-authored（2026-07-13 本会话重构，非历史文件恢复）；本地预演见 §6 + scripts/。
> §1 / §4 由 Ray 亲自在 prod 执行。

## 0. 背景与目标

- prod 库 `server_encoding = LATIN1`，存不了中文。历史上被迫：SQL 注释改英文（`67022f6`）、
  skin 存英文代号前端映射中文（`cffc470`）。这些都是绕行，不是修复。
- 目标：把 prod 库整体换成 **UTF8**，让中文可直接入库，删掉上述绕行。
- 手段：**路径A = 逻辑 dump → 建新 UTF8 库 → restore → 切库**。不用 `ALTER DATABASE ... ENCODING`（不支持在线改编码），也不做原地 `pg_upgrade`（与编码无关）。
- 前提假设（§1 必须验证）：prod 现有数据是**干净 LATIN1/ASCII**，不是"客户端按 LATIN1 塞进去的 UTF-8 双编码脏字节"。
  若 §1 的 0xa0-0xff 扫描发现双编码，naive `LATIN1→UTF8` 会转出乱码，本方案作废，改走逐列 `convert_from` 修复。

## 1. §1 — prod 基线画像（纯只读，Ray 亲自跑，Claude 只写不跑）

> prod PG 是 **5433 共享实例**，多库同居。所有命令 **必带 `-h localhost` 走 TCP**（不走 peer / 不走默认 socket）。
> 下面命令零写入，可反复跑。把输出贴回来再决定是否放行迁移。

```bash
# 约定：先设连接（密码纯字母数字，见 §5 坑）
export PGHOST=localhost PGPORT=5433 PGUSER=spribe_user
export PGPASSWORD='<prod_pw>'         # 纯字母数字，无需转义
DB=spribe

# 1.1 目标库大小（换算停机窗口 & 磁盘占用）
psql -d "$DB" -c "SELECT pg_size_pretty(pg_database_size('$DB'));"

# 1.2 表行数 top10（迁完逐表比对的基线；用统计估算，快）
psql -d "$DB" -c "
  SELECT schemaname, relname, n_live_tup
  FROM pg_stat_user_tables ORDER BY n_live_tup DESC LIMIT 10;"

# 1.3 确认 server_encoding 确实是 LATIN1（方案成立的前提）
psql -d "$DB" -c "SHOW server_encoding;"
psql -d "$DB" -c "
  SELECT datname, pg_encoding_to_char(encoding) enc, datcollate, datctype
  FROM pg_database WHERE datname='$DB';"

# 1.4 脏字节【快速抽查】：文本列有无 0xa0-0xff 高位字节（权威判定见 1.7 全库扫描）
#     对每张表的文本列抽扫。示例扫 tenants.name / issues 正文，按实际文本列补全：
psql -d "$DB" -c "
  SELECT 'tenants.name' col, count(*) hits
  FROM tenants WHERE name ~ '[\x80-\xff]'
  UNION ALL SELECT 'issues.title', count(*) FROM issues WHERE title ~ '[\x80-\xff]';"
#   若 hits>0：抽几行 SELECT convert_to(name,'LATIN1') 看字节，人工判定是否双编码 UTF-8。

# 1.5 5433 实例上【全部库】列表（共享实例，先列全防误伤：确认只动目标库）
psql -d postgres -c "
  SELECT datname, pg_encoding_to_char(encoding) enc,
         pg_size_pretty(pg_database_size(datname)) size
  FROM pg_database WHERE datistemplate=false ORDER BY pg_database_size(datname) DESC;"

# 1.6 磁盘余量（40G 盘要同时容纳：旧库 + 新库 + dump 文件 ≈ 旧库大小×2.5，留足）
df -h /var/lib/postgresql /tmp .

# 1.7 权威脏字节扫描（判定 §0 前提的【主】依据；1.4 只是快速抽查）：
#     只读逻辑快照，app 不用停；这条的 time 耗时就是停机窗口估算的主料（≈ 迁移 A1 的 pg_dump）。
time pg_dump -h localhost -p 5433 -U "$PGUSER" -Fp -f /tmp/spribe_preflight.sql spribe
LC_ALL=C grep -acP '[\x80-\xff]' /tmp/spribe_preflight.sql   # 期望 0：全 ASCII，最优路径

# 1.8 目标角色是否有 CREATEDB（决定 §2 A2 走本角色建库 or sudo -u postgres 兜底）：
psql -d "$DB" -c "SELECT rolname, rolcreatedb FROM pg_roles WHERE rolname='spribe_user';"

# 1.9 pm2 现状留底（切库/回滚都要 delete+start 重建，先存好 script/cwd/args）：
pm2 describe spribe-api        # 全输出留底：interpreter/script/cwd/args/env，重建照抄
```

**放行门槛**：`server_encoding=LATIN1` 确认；**1.7 `grep` 计数 = 0**（或 1.4/1.7 命中已确认是干净 latin1、非双编码）；
`df` 剩余 ≥ `库大小×3`；1.5 确认目标库名唯一无歧义。任一不满足 → 停，先解决。

## 2. 路径A — 迁移执行序列

> 停机窗口内执行。逐条确认上一步 OK 再下一步。所有进 psql 的语句**纯 ASCII**（§5 坑）。

```bash
export PGHOST=localhost PGPORT=5433 PGUSER=spribe_user PGPASSWORD='<prod_pw>'
OLD=spribe                  # 旧 LATIN1 库
NEW=spribe_utf8             # 新 UTF8 库
DUMP=/tmp/migrate_spribe.dump.sql

# ── 补丁1：先停两条 cron（见 §3.1），确认无 reconcile 进程在跑 ──
# ── 停应用写入（pm2 stop 或维护页），确保 dump 期间无新写 ──

# A1. pg_dump 旧库（明文 SQL 格式，含 schema+数据）。记录耗时+大小。
time pg_dump -h localhost -p 5433 -U "$PGUSER" -Fp -f "$DUMP" "$OLD"
ls -lh "$DUMP"

# A2. 建新 UTF8 库（从 template0，显式 UTF8 + 一致 locale）
createdb -h localhost -p 5433 -U "$PGUSER" \
  --encoding=UTF8 --template=template0 --lc-collate=C --lc-ctype=C "$NEW"
#   分支：若 1.8 显示本角色【无】CREATEDB，改用 postgres 超管建库、属主给回 spribe_user：
sudo -u postgres createdb -p 5433 \
  --encoding=UTF8 --template=template0 --lc-collate=C --lc-ctype=C \
  -O spribe_user spribe_utf8

# A3. restore 进新库（dump 里带 SET client_encoding='LATIN1'，
#     服务器把 LATIN1 字节转成 UTF8 落地；干净 latin1/ASCII 转换无损）
time psql -h localhost -p 5433 -U "$PGUSER" -v ON_ERROR_STOP=1 -d "$NEW" -f "$DUMP"

# A4. 行数比对（全表逐表相等才算数）——用本仓库 rowcount_compare.sh
bash scripts/rowcount_compare.sh localhost 5433 "$PGUSER" "$OLD" "$NEW" spribe_dev
#     退出码 0 = 全表全等；非 0 = 有差异，立刻走 §4 回滚，不切库。

# A4.5 资金守恒双检：新库先 ANALYZE，再新旧库各查 wallets 行数 + 余额合计，两边必须全等。
psql -h localhost -p 5433 -U "$PGUSER" -d "$NEW" -c 'ANALYZE;'
psql -h localhost -p 5433 -U "$PGUSER" -d "$OLD" -c 'SELECT count(*), sum(balance) FROM wallets;'
psql -h localhost -p 5433 -U "$PGUSER" -d "$NEW" -c 'SELECT count(*), sum(balance) FROM wallets;'
#     count 与 sum(balance) 两边全等才过；不等 → §4 回滚，不切库。

# A5. 切 .env 的 DB_URL 指向新库（只改库名 OLD→NEW，其余不动）
#     旧库【保留】不删，作为回滚底牌。
#     手动编辑 server/.env，只改 DB_URL 里的库名段（不用 sed，防转义/误改密码/参数）：
#       nano server/.env    # 把 .../spribe?  改成  .../spribe_utf8?
grep DB_URL server/.env     # 确认：只库名段变了，用户名/密码/search_path 参数原样

# A6. 补丁2：PM2 必须 delete + start（禁 restart / --update-env），见 §3.2
pm2 delete spribe-api
pm2 start                                      # 照 §1.9 pm2 describe 留底的 script/cwd/args 原样重建（重新读取新 DB_URL）
pm2 save                                       # 固化进程表（照 1.9 留底的 script/cwd/args 重建）

# A7. 验证（切库后冒烟）：
#   - 应用起得来、/health 或 /player/me 通
#   - 中文探针：临时表 _mig_probe（建→插中文→读回→drop，不在业务表留痕）：
#       psql -h localhost -p 5433 -U "$PGUSER" -d "$NEW" -c \
#         "CREATE TEMP TABLE _mig_probe(s text); \
#          INSERT INTO _mig_probe VALUES ('迁移中文探针'); \
#          SELECT s, length(s), octet_length(s) FROM _mig_probe; \
#          DROP TABLE _mig_probe;"
#     读回逐字节相等即通（对照：同句插旧 LATIN1 库必失败——见 §3.3）
#   - 关键读路径（看板/对账只读）返回正常

# ── 补丁1恢复：验证通过后，恢复两条 cron（注意 RECON_CREDIT_BASELINE 引号转义，§3.1）──
```

## 3. 三条补丁（上次审核不放行才加，一条不能少）

### 3.1 停 cron ×2（迁前停、迁后恢复）

- 迁移前停掉两条对账 cron，避免它们在换库过程中读到半迁移状态或连错库：
  - `04:00` → `reconcile_balances.mjs`
  - `04:10` → `reconcile_credit.mjs`
- 操作：注释掉 crontab 两行（或 systemd timer `disable`），并确认当前没有 reconcile 进程在跑
  （`pgrep -af reconcile`）。
- 迁完验证通过后恢复。**恢复 `reconcile_credit` 时，`RECON_CREDIT_BASELINE` 是 JSON
  （形如 `{"1":"2751.00","6":"10100.00"}`，内含双引号），恢复到 crontab 行前 `export` 或
  systemd `Environment=` 时，双引号的转义/引号包裹别弄丢**——弄丢会导致 `JSON.parse` 失败
  （脚本会抛 `RECON_CREDIT_BASELINE 不是合法 JSON`）或基线丢失被当 0。
  - crontab 写法：整体用单引号包裹，内部双引号原样：
    `RECON_CREDIT_BASELINE='{"1":"2751.00","6":"10100.00"}'`
  - 恢复后立刻手跑一次 `node server/scripts/reconcile_credit.mjs` 确认基线读对、对账过。

### 3.2 切 DB_URL 后 PM2 必 delete+start（禁 restart / --update-env）

- 改完 `.env` 的 `DB_URL` 后，**不要** `pm2 restart` 也**不要** `pm2 restart --update-env`：
  这类会复用旧进程/旧环境缓存，可能仍连旧库，形成"看着重启了其实连错库"的隐坑。
- 正确：`pm2 delete spribe-api` 彻底销毁，再 `pm2 start`（重新读 `.env` 与环境）。
- 起来后立即验证进程实际连的库：应用日志或 `SELECT current_database()` 冒烟。

### 3.3 预演硬指标（本地预演 + prod 迁移都按这套报）

1. **逐表行数全等**：`rowcount_compare.sh` 对旧/新库每张表 `count(*)` 全相等（退出码 0）。
2. **新库中文 INSERT + SELECT 读回**：新 UTF8 库插入一行含中文，读回逐字节相等。
   （对照：同一句中文插旧 LATIN1 库必失败——证明迁移的必要性。）
3. **每步耗时 + dump 文件大小**：A1/A3 各自 `time`，`ls -lh` dump；
   按 prod 库大小 / 预演库大小的倍率**换算 prod 停机窗口估算**。
4. **任何报错原文照贴**，不转述、不吞。

## 4. 回滚预案

**必须回滚的信号（任一命中即回滚，不犹豫）：**
- A4 行数比对非全等（任一表 count 不符）。
- A3 restore 报错中断（`ON_ERROR_STOP=1` 已保证一报即停）。
- A7 冒烟失败：应用起不来 / 关键路径 500 / 中文读回不符 / 连的还是旧库。
- 新库出现双编码乱码（§1.4 前提没验准）。

**回滚步骤（旧库全程保留，未删，是干净底牌）：**
```bash
# R1. .env 的 DB_URL 改回旧库名 NEW→OLD（手动编辑，不用 sed）
#       nano server/.env    # 把 .../spribe_utf8?  改回  .../spribe?
grep DB_URL server/.env     # 确认库名段改回，用户名/密码/参数原样

# R2. PM2 同样 delete+start（不 restart），回到连旧库
pm2 delete spribe-api && pm2 start    # 照 §1.9 pm2 describe 留底的 script/cwd/args 原样重建
pm2 save                                          # 固化回滚后的进程表

# R3. 恢复两条 cron（RECON_CREDIT_BASELINE 转义见 §3.1）
# R4. 冒烟：应用通、对账通。确认后可择日重排迁移。
# R5. 失败的新库 NEW 可留待排查或 dropdb 清理（不影响旧库）。
```
- 回滚只动 `.env` + 进程 + cron，**不碰旧库数据**，秒级恢复。

## 5. 已知坑（写进正文，执行时对照）

- **DB_URL 密码纯字母数字**：避免 `@ : / ? # % &` 等在 URL/shell 里要转义的字符，
  从源头绕开 `sed`/URL 解析出错。改库名的 `sed` 只动库名段。
- **进 pg 的 SQL 一律纯 ASCII**：任何在 prod（LATIN1）上执行的 `psql -c`/`.sql`
  不得含中文（含注释）——否则 client(UTF8)→server(LATIN1) 转换报
  `character ... has no equivalent in encoding "LATIN1"`（正是 `67022f6` 踩过的）。
  迁到 UTF8 后此限制解除，但迁移窗口内旧库仍在，保持纯 ASCII。
- **prod psql 必带 `-h localhost` 走 TCP**：5433 是共享实例，走 TCP 显式指定端口/库，
  不依赖 peer 认证与默认 socket，防连错实例/库。

## 6. 预演与 prod 的差异（诚实声明）

- 本地预演用**一次性私有 PG 集群**（`initdb` 进 scratchpad，本机超管，端口 59432），
  不动本机 5432 正式集群、更不碰 prod 5433/199 机器。
- 预演数据 = `server/sql/*.sql`（11 个：001-008,010-012，无 009）顺序灌 + `seed_demo.mjs`，
  全部为 ASCII 数据（中文只在 SQL 注释里，`--` 注释不入库），属"干净 ASCII"最优路径。
  额外注入一个 latin1 高位字节探针（é=0xe9），证明真 latin1→utf8 转换无损，而不只是 ASCII 直通。
- prod 停机窗口 = 预演 A1+A3 总耗时 × (prod 库大小 / 预演库大小) + 冗余。以 §1.1 实测大小换算。
