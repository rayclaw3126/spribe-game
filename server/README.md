# spribe-server

spribe 游戏平台后端地基骨架。目前**只是骨架**：没有业务逻辑、没有登录/鉴权实现、不碰任何游戏代码，仅提供进程存活探针和数据库表结构定义，供后续开发在此基础上搭建业务功能。

## 目录结构

```
server/
├── .env.example        # 环境变量样例（DB_URL / JWT_SECRET / PORT / CORS_ORIGIN）
├── .gitignore           # 忽略 .env 与 node_modules
├── package.json         # 依赖声明（express / pg / jsonwebtoken / bcrypt / dotenv / cors）
├── README.md            # 本文件
├── sql/
│   └── 001_schema.sql   # v1 建表 SQL（10 张业务表）
└── src/
    ├── db.js            # Postgres 连接池 + 参数化查询帮助函数
    └── index.js         # express 入口，目前只有 /health 探针
```

## 快速开始

```bash
# 1. 复制环境变量样例并按需修改
cp .env.example .env

# 2. 安装依赖
npm install

# 3. 在 Postgres 中执行建表 SQL（需先创建好数据库，并把连接信息填入 .env 的 DB_URL）
psql "$DB_URL" -f sql/001_schema.sql

# 4. 启动服务
npm start

# 5. 验证存活探针
curl -s localhost:4000/health
# 期望输出：{"status":"ok"}
```

## 10 张表一句话简介

| 表名 | 简介 |
| --- | --- |
| `agents` | 代理商账号，支持自引用的树形层级结构（parent_id / path） |
| `players` | 玩家账号，归属某个代理商 |
| `wallets` | 玩家钱包余额（乐观锁 version） |
| `credit_lines` | 代理商信用额度（乐观锁 version） |
| `ledger` | 玩家资金流水账，`idempotency_key` 唯一索引防重复入账 |
| `credit_ledger` | 代理商之间的信用额度流水 |
| `commissions` | 佣金发放记录 |
| `commission_config` | 代理商佣金比例配置（输赢占比 / 流水占比） |
| `rounds` | 游戏局记录（下注金额、开奖结果、payout、随机种子等） |
| `bets` | 下注记录，`idempotency_key` 唯一索引防重复下注 |
| `audit_log` | 代理商操作审计日志 |

## 当前边界

- 目前只有一个可用接口：`GET /health`，返回 `{"status":"ok"}`，纯进程存活探针，**不查数据库**。
- 没有任何登录/鉴权实现（虽然依赖里已经声明了 `jsonwebtoken` 和 `bcrypt`，但尚未接入任何路由）。
- 没有任何业务逻辑（下注、结算、佣金计算、信用额度变更等均未实现）。
- `sql/001_schema.sql` 只建表结构，不含触发器、存储过程或初始数据。
- CORS 走白名单模式，来源列表从 `.env` 的 `CORS_ORIGIN`（逗号分隔）读取。
