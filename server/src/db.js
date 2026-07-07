// 数据库连接模块
// 说明：查询一律走参数化（$1、$2...占位符），禁止字符串拼接 SQL，防止 SQL 注入。
import 'dotenv/config';
import pg from 'pg';

const { Pool } = pg;

// 连接池：读取 .env 中的 DB_URL
export const pool = new Pool({
  connectionString: process.env.DB_URL,
});

/**
 * 参数化查询帮助函数
 * @param {string} text - 带 $1、$2... 占位符的 SQL 语句
 * @param {Array} params - 对应占位符的参数数组
 * @returns {Promise<import('pg').QueryResult>}
 */
export function query(text, params) {
  // 统一入口：所有业务代码都应通过这个函数访问数据库，
  // 而不是直接拼接字符串执行 SQL。
  return pool.query(text, params);
}

/**
 * 事务帮助函数
 * 用法：await withTransaction(async (client) => { ...在事务内用 client.query(...)... })
 * 内部流程：从连接池取一个专用连接 -> BEGIN -> 执行回调 -> COMMIT；
 * 回调抛出异常则 ROLLBACK 后把异常继续向外抛出；无论成功失败，最终都释放连接。
 * 涉及资金变动（下注/结算/分成）的业务必须通过这里获得的 client 在同一个事务内完成，
 * 不允许在事务外分别执行多条 SQL，避免中途失败导致数据不一致。
 * @param {(client: import('pg').PoolClient) => Promise<any>} fn
 * @returns {Promise<any>} - fn 的返回值
 */
export async function withTransaction(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
