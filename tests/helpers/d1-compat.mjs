/**
 * 测试用 D1 兼容适配器：基于 Node 内置 node:sqlite 的内存数据库，
 * 实现 drizzle-orm/d1 所需的 prepare/bind/all/get/run/exec/batch 接口，
 * 用于在本地运行 API 集成测试（无需真实 Cloudflare D1）。
 */
import { DatabaseSync } from "node:sqlite";

class D1Statement {
  constructor(stmt) {
    this.stmt = stmt;
    this.args = [];
  }

  bind(...args) {
    this.args = args;
    return this;
  }

  all() {
    return { results: this.stmt.all(...this.args), success: true };
  }

  get() {
    const row = this.stmt.get(...this.args);
    return { results: row ? [row] : [], success: true };
  }

  run() {
    const info = this.stmt.run(...this.args);
    return { success: true, meta: { changes: info.changes, last_row_id: info.lastInsertRowid } };
  }

  /** D1 raw() 语义：返回裸二维数组（drizzle values() 直接使用，不做解构）。 */
  raw() {
    const rows = this.stmt.all(...this.args);
    return rows.map((row) => Object.keys(row).map((key) => row[key]));
  }
}

/** 创建新的内存 D1 兼容客户端（每个测试独立，避免状态污染）。 */
export function createD1Compat() {
  const db = new DatabaseSync(":memory:");
  // 模拟 D1 默认行为：启用外键约束（捕获无效引用，如空字符串外键）
  db.exec("PRAGMA foreign_keys = ON");
  return {
    exec(sql) {
      db.exec(sql);
      return { success: true, meta: {} };
    },
    prepare(sql) {
      return new D1Statement(db.prepare(sql));
    },
    batch(statements) {
      return statements.map((statement) => statement.run());
    },
    dump() {
      return new ArrayBuffer(0);
    },
  };
}
