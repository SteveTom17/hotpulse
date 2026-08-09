/**
 * 定时任务（FR-02）：按 Cron 遍历所有已启用的 HTTP API 连接器执行同步。
 * 每个连接器独立执行，单个失败不影响其余；结果写入连接器状态与用量记录。
 */
import { env } from "cloudflare:workers";
import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import * as schema from "../db/schema";
import { connectors } from "../db/schema";
import { syncConnector } from "../lib/connectors/sync";
import type { SyncResult } from "../lib/connectors/types";

export type ScheduledSyncReport = {
  total: number;
  results: SyncResult[];
};

/** 执行一次全量连接器同步；返回汇总报告（用于日志与监控）。 */
export async function runScheduledSync(): Promise<ScheduledSyncReport> {
  if (!env.DB) {
    throw new Error("D1 binding `DB` is unavailable in scheduled handler.");
  }
  const db = drizzle(env.DB, { schema });

  const rows = await db
    .select({ id: connectors.id })
    .from(connectors)
    .where(and(eq(connectors.enabled, true), eq(connectors.kind, "http_api")))
    .all();

  const results: SyncResult[] = [];
  for (const row of rows) {
    try {
      results.push(await syncConnector(row.id, { db }));
    } catch (error) {
      // syncConnector 内部已兜底；此处仅防御性隔离意外异常
      results.push({
        connectorId: row.id,
        status: "error",
        imported: 0,
        skippedRows: 0,
        message: error instanceof Error ? error.message : "未知错误",
      });
    }
  }

  return { total: rows.length, results };
}
