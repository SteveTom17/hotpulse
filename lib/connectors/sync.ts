import { eq, and, sql } from "drizzle-orm";
import type { DrizzleD1Database } from "drizzle-orm/d1";
import { connectors, trendSources, trends, usageRecords } from "../../db/schema";
import * as schema from "../../db/schema";
import { decryptJson } from "../crypto";
import { classifyRisk } from "../risk";
import { industryRelevance, scoreTrend } from "../scoring";
import { fetchHttpApiTrends } from "./http-api";
import { ConnectorError, type HttpApiConfig, type SyncResult, type TrendRaw } from "./types";

/**
 * 趋势同步（FR-02/FR-03）：
 * 拉取 → 标准化 → 语义去重 → 风险分类 → 评分 → 持久化（保留全部来源）。
 * 失败处理：记录原因、指数退避、限流暂停；绝不静默绕过数据源。
 */

const BACKOFF_BASE_MS = 5 * 60 * 1000; // 5 分钟
const BACKOFF_MAX_MS = 24 * 60 * 60 * 1000; // 24 小时

/** 标题归一化，用于 24 小时窗口内的同源/跨源去重。 */
export function normalizeTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/[\s，。！？、：；,.!?;:·_—（）()【】"'“”‘’#[\]-]+/g, "")
    .slice(0, 40);
}

type SyncDeps = {
  db: DrizzleD1Database<typeof schema>;
  now?: Date;
};

/** 执行单个连接器的同步；结果写入连接器状态与审计。 */
export async function syncConnector(
  connectorId: string,
  deps: SyncDeps,
): Promise<SyncResult> {
  const { db } = deps;
  const now = deps.now ?? new Date();

  const connector = await db
    .select()
    .from(connectors)
    .where(eq(connectors.id, connectorId))
    .get();
  if (!connector) {
    return { connectorId, status: "error", imported: 0, skippedRows: 0, message: "连接器不存在。" };
  }
  if (!connector.enabled) {
    return { connectorId, status: "disabled", imported: 0, skippedRows: 0, message: "连接器已停用。" };
  }
  if (connector.backoffUntil && new Date(connector.backoffUntil).getTime() > now.getTime()) {
    return {
      connectorId,
      status: "skipped",
      imported: 0,
      skippedRows: 0,
      message: `退避中，下次尝试于 ${connector.backoffUntil}。`,
    };
  }
  if (connector.rateLimitResetAt && new Date(connector.rateLimitResetAt).getTime() > now.getTime()) {
    return {
      connectorId,
      status: "skipped",
      imported: 0,
      skippedRows: 0,
      message: `数据源限流中，将于 ${connector.rateLimitResetAt} 恢复。`,
      resetAt: connector.rateLimitResetAt,
    };
  }

  await db
    .update(connectors)
    .set({ status: "syncing", updatedAt: now.toISOString() })
    .where(eq(connectors.id, connectorId));

  let rawItems: TrendRaw[];
  try {
    if (connector.kind === "http_api") {
      const config = (await decryptJson<HttpApiConfig>(connector.configJson)) ?? {
        url: "",
        fieldMap: { title: "" },
      };
      rawItems = await fetchHttpApiTrends(config);
    } else {
      return {
        connectorId,
        status: "error",
        imported: 0,
        skippedRows: 0,
        message: "该连接器类型不支持定时同步（CSV 导入由管理员手动完成）。",
      };
    }
  } catch (error) {
    const message = error instanceof ConnectorError ? error.message : "未知错误";
    const retryable = !(error instanceof ConnectorError) || error.retryable;
    const failureCount = connector.failureCount + 1;
    const backoffUntil = retryable
      ? new Date(now.getTime() + Math.min(BACKOFF_BASE_MS * 2 ** (failureCount - 1), BACKOFF_MAX_MS)).toISOString()
      : null;

    await db
      .update(connectors)
      .set({
        status: "error",
        lastError: message,
        failureCount,
        backoffUntil: backoffUntil ?? connector.backoffUntil,
        rateLimitResetAt:
          error instanceof ConnectorError && error.resetAt
            ? error.resetAt
            : connector.rateLimitResetAt,
        lastRunAt: now.toISOString(),
        updatedAt: now.toISOString(),
      })
      .where(eq(connectors.id, connectorId));

    return {
      connectorId,
      status: "error",
      imported: 0,
      skippedRows: 0,
      message,
      resetAt: error instanceof ConnectorError ? error.resetAt : undefined,
    };
  }

  const { imported, skipped } = await upsertTrends(db, connector.workspaceId, {
    provider: connector.name,
    licenseStatus: "authorized",
    sourceUrlBase: connector.id,
    items: rawItems,
    now,
  });

  await db
    .update(connectors)
    .set({
      status: imported > 0 || rawItems.length > 0 ? "ok" : "degraded",
      lastError: imported === 0 && rawItems.length > 0 ? "数据已存在或无法入库" : null,
      failureCount: 0,
      backoffUntil: null,
      lastRunAt: now.toISOString(),
      updatedAt: now.toISOString(),
    })
    .where(eq(connectors.id, connectorId));

  try {
    await db.insert(usageRecords).values({
      id: crypto.randomUUID(),
      workspaceId: connector.workspaceId,
      kind: "connector_run",
      quantity: 1,
      metaJson: JSON.stringify({ connectorId, imported, skipped }),
    });
  } catch {
    // 用量记录失败不影响同步结果
  }

  return {
    connectorId,
    status: imported > 0 || rawItems.length > 0 ? "ok" : "degraded",
    imported,
    skippedRows: skipped,
    message:
      imported === 0 && rawItems.length > 0
        ? "拉取成功，但全部为已存在信号（已去重）。"
        : `同步完成：新增 ${imported} 条，跳过 ${skipped} 条。`,
  };
}

export type UpsertInput = {
  provider: string;
  licenseStatus: "authorized" | "customer_import" | "demo";
  sourceUrlBase: string;
  items: TrendRaw[];
  now: Date;
};

/** 批量入库：24 小时窗口内按归一化标题归并，保留全部来源；返回入库/跳过计数。 */
export async function upsertTrends(
  db: DrizzleD1Database<typeof schema>,
  workspaceId: string,
  input: UpsertInput,
): Promise<{ imported: number; skipped: number }> {
  let imported = 0;
  let skipped = 0;
  const windowStart = new Date(input.now.getTime() - 24 * 60 * 60 * 1000).toISOString();
  const industryKeywords: string[] = []; // 行业相关性由品牌资料提供；此处用中性默认
  const collectedAt = input.now.toISOString();

  for (const item of input.items) {
    if (!item.title) {
      skipped++;
      continue;
    }
    const normalized = normalizeTitle(item.title);

    // 查重：最近 24 小时同工作区相同归一化标题（保留原始标题用于展示）
    const candidates = await db
      .select({ id: trends.id, title: trends.title })
      .from(trends)
      .where(
        and(
          eq(trends.workspaceId, workspaceId),
          sql`${trends.collectedAt} >= ${windowStart}`,
        ),
      )
      .all();
    const existing = candidates.find((candidate) => normalizeTitle(candidate.title) === normalized);

    if (existing) {
      // 追加来源（保留原始链接），重新计算跨源数与评分
      const trendRow = await db
        .select()
        .from(trends)
        .where(eq(trends.id, existing.id))
        .get();
      if (trendRow) {
        const sourceExists = await db
          .select({ id: trendSources.id })
          .from(trendSources)
          .where(
            and(
              eq(trendSources.trendId, trendRow.id),
              eq(trendSources.sourceUrl, item.sourceUrl),
            ),
          )
          .get();
        if (!sourceExists) {
          await db.insert(trendSources).values({
            id: crypto.randomUUID(),
            trendId: trendRow.id,
            provider: input.provider,
            sourceUrl: item.sourceUrl,
            licenseStatus: input.licenseStatus,
            collectedAt: item.collectedAt ?? collectedAt,
          });
        }
        const sourceCount = trendRow.sourceCount + (sourceExists ? 0 : 1);
        const scored = scoreTrend({
          change: item.change ?? trendRow.change ?? 0,
          sourceCount,
          industryScore: industryRelevance(trendRow.title, trendRow.summary, industryKeywords),
          risk: trendRow.risk,
        });
        await db
          .update(trends)
          .set({
            change: item.change ?? trendRow.change,
            sourceCount,
            score: scored.score,
            scoreConfidence: scored.confidence,
            scoreBreakdownJson: JSON.stringify(scored.breakdown),
            updatedAt: collectedAt,
          })
          .where(eq(trends.id, trendRow.id));
      }
      skipped++;
      continue;
    }

    const { level, hits } = classifyRisk(item.title, item.summary ?? "");
    const scored = scoreTrend({
      change: item.change ?? 0,
      sourceCount: 1,
      industryScore: industryRelevance(item.title, item.summary ?? "", industryKeywords),
      risk: level,
    });

    const trendId = crypto.randomUUID();
    await db.insert(trends).values({
      id: trendId,
      workspaceId,
      title: item.title,
      summary: item.summary ?? item.title,
      category: item.category ?? "",
      risk: level,
      riskReasonsJson: JSON.stringify(hits),
      score: scored.score,
      scoreConfidence: scored.confidence,
      scoreBreakdownJson: JSON.stringify(scored.breakdown),
      change: item.change ?? 0,
      sourceCount: 1,
      sourceStatus: input.licenseStatus,
      collectedAt: item.collectedAt ?? collectedAt,
      createdAt: collectedAt,
      updatedAt: collectedAt,
    });

    await db.insert(trendSources).values({
      id: crypto.randomUUID(),
      trendId,
      provider: input.provider,
      sourceUrl: item.sourceUrl,
      licenseStatus: input.licenseStatus,
      collectedAt: item.collectedAt ?? collectedAt,
    });

    imported++;
  }

  return { imported, skipped };
}
