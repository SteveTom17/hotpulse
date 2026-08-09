import { and, desc, eq } from "drizzle-orm";
import { getDb } from "../../../../../../db";
import { trendSources, trends } from "../../../../../../db/schema";
import { guardWorkspace, readJson } from "../../../../../../lib/api-helpers";
import { writeAudit } from "../../../../../../lib/audit";
import { fail, json } from "../../../../../../lib/http";

const STATUS_VALUES = ["none", "watch", "ignore", "generate"] as const;

/** GET /api/workspaces/[id]/trends/[trendId]：热点详情 + 全部来源。 */
export async function GET(
  request: Request,
  context: { params: Promise<{ id: string; trendId: string }> },
) {
  const { id, trendId } = await context.params;
  const guard = await guardWorkspace(request, id, "view");
  if (guard.error) return guard.error;

  const db = getDb();
  const trend = await db
    .select()
    .from(trends)
    .where(and(eq(trends.workspaceId, id), eq(trends.id, trendId)))
    .get();
  if (!trend) return fail(404, "NOT_FOUND", "热点不存在。");

  const sources = await db
    .select()
    .from(trendSources)
    .where(eq(trendSources.trendId, trendId))
    .orderBy(desc(trendSources.collectedAt))
    .all();

  return json({
    trend: {
      id: trend.id,
      title: trend.title,
      summary: trend.summary,
      category: trend.category,
      risk: trend.risk,
      riskReasons: JSON.parse(trend.riskReasonsJson) as { level: string; rule: string; matched: string }[],
      score: trend.score,
      scoreConfidence: trend.scoreConfidence,
      breakdown: JSON.parse(trend.scoreBreakdownJson) as { label: string; value: number }[],
      change: trend.change,
      sourceCount: trend.sourceCount,
      sourceStatus: trend.sourceStatus,
      userStatus: trend.userStatus,
      collectedAt: trend.collectedAt,
      updatedAt: trend.updatedAt,
    },
    sources: sources.map((source) => ({
      id: source.id,
      provider: source.provider,
      sourceUrl: source.sourceUrl,
      licenseStatus: source.licenseStatus,
      collectedAt: source.collectedAt,
    })),
  });
}

/** PATCH /api/workspaces/[id]/trends/[trendId]：标记忽略/观察/生成（FR-03 验收标准 2）。 */
export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string; trendId: string }> },
) {
  const { id, trendId } = await context.params;
  const guard = await guardWorkspace(request, id, "edit");
  if (guard.error) return guard.error;

  const body = await readJson<{ userStatus?: string }>(request);
  if (body instanceof Response) return body;

  const userStatus = body.userStatus;
  if (!userStatus || !(STATUS_VALUES as readonly string[]).includes(userStatus)) {
    return fail(400, "BAD_REQUEST", "状态无效。");
  }

  const db = getDb();
  const trend = await db
    .select()
    .from(trends)
    .where(and(eq(trends.workspaceId, id), eq(trends.id, trendId)))
    .get();
  if (!trend) return fail(404, "NOT_FOUND", "热点不存在。");

  await db
    .update(trends)
    .set({ userStatus: userStatus as (typeof STATUS_VALUES)[number] })
    .where(eq(trends.id, trendId));

  await writeAudit({
    workspaceId: id,
    actorUserId: guard.session.userId,
    action: "trend.status_changed",
    detail: { trendId, from: trend.userStatus, to: userStatus },
  });

  return json({ trendId, userStatus });
}
