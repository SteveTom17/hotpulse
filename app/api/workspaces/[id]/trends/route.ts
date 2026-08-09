import { and, desc, eq, like, or } from "drizzle-orm";
import { getDb } from "../../../../../db";
import { trends } from "../../../../../db/schema";
import { guardWorkspace } from "../../../../../lib/api-helpers";
import { fail, json } from "../../../../../lib/http";

const RISK_VALUES = ["low", "medium", "high", "blocked"] as const;
const STATUS_VALUES = ["none", "watch", "ignore", "generate"] as const;

/**
 * GET /api/workspaces/[id]/trends：热点列表。
 * 支持筛选：risk、userStatus、category、q（标题/摘要关键词）、fresh（仅新鲜数据）。
 * 排序：建议跟进度降序，更新时间最新优先。
 */
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const guard = await guardWorkspace(request, id, "view");
  if (guard.error) return guard.error;

  const url = new URL(request.url);
  const risk = url.searchParams.get("risk");
  const userStatus = url.searchParams.get("userStatus");
  const category = url.searchParams.get("category");
  const query = (url.searchParams.get("q") ?? "").trim().slice(0, 100);
  const limit = Math.min(100, Math.max(1, Number(url.searchParams.get("limit") ?? 50)));

  const db = getDb();
  const conditions: ReturnType<typeof eq>[] = [eq(trends.workspaceId, id)];
  if (risk && (RISK_VALUES as readonly string[]).includes(risk)) {
    conditions.push(eq(trends.risk, risk as (typeof RISK_VALUES)[number]));
  }
  if (userStatus && (STATUS_VALUES as readonly string[]).includes(userStatus)) {
    conditions.push(eq(trends.userStatus, userStatus as (typeof STATUS_VALUES)[number]));
  }
  if (category) conditions.push(eq(trends.category, category));
  if (query) {
    conditions.push(
      or(like(trends.title, `%${query}%`), like(trends.summary, `%${query}%`))!,
    );
  }

  const rows = await db
    .select()
    .from(trends)
    .where(and(...conditions))
    .orderBy(desc(trends.score), desc(trends.collectedAt))
    .limit(limit)
    .all();

  return json({
    trends: rows.map((row) => ({
      id: row.id,
      title: row.title,
      summary: row.summary,
      category: row.category,
      risk: row.risk,
      riskReasons: JSON.parse(row.riskReasonsJson) as { level: string; rule: string; matched: string }[],
      score: row.score,
      scoreConfidence: row.scoreConfidence,
      breakdown: JSON.parse(row.scoreBreakdownJson) as { label: string; value: number }[],
      change: row.change,
      sourceCount: row.sourceCount,
      sourceStatus: row.sourceStatus,
      userStatus: row.userStatus,
      collectedAt: row.collectedAt,
      updatedAt: row.updatedAt,
    })),
  });
}

export async function POST() {
  return fail(405, "BAD_REQUEST", "该方法不受支持。");
}
