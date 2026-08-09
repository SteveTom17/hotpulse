import { and, desc, eq } from "drizzle-orm";
import { getDb } from "../../../../../db";
import { contentPackages, trends } from "../../../../../db/schema";
import { guardWorkspace } from "../../../../../lib/api-helpers";
import { fail, json } from "../../../../../lib/http";

/**
 * GET /api/workspaces/[id]/content-packages：内容包列表（可按状态筛选）。
 * POST 已由 /generate 承接（生成即入库），此处不提供直接创建。
 */

const STATUS_VALUES = ["draft", "approved", "exported", "rejected"] as const;

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const guard = await guardWorkspace(request, id, "view");
  if (guard.error) return guard.error;

  const url = new URL(request.url);
  const status = url.searchParams.get("status");
  const limit = Math.min(100, Math.max(1, Number(url.searchParams.get("limit") ?? 50)));

  const db = getDb();
  const conditions = [eq(contentPackages.workspaceId, id)];
  if (status && (STATUS_VALUES as readonly string[]).includes(status)) {
    conditions.push(eq(contentPackages.status, status as (typeof STATUS_VALUES)[number]));
  }

  const rows = await db
    .select({
      id: contentPackages.id,
      trendId: contentPackages.trendId,
      trendTitle: trends.title,
      trendRisk: trends.risk,
      status: contentPackages.status,
      modelName: contentPackages.modelName,
      aiLabelStatus: contentPackages.aiLabelStatus,
      versionHash: contentPackages.versionHash,
      approvedBy: contentPackages.approvedBy,
      approvedAt: contentPackages.approvedAt,
      createdBy: contentPackages.createdBy,
      createdAt: contentPackages.createdAt,
      updatedAt: contentPackages.updatedAt,
    })
    .from(contentPackages)
    .innerJoin(trends, eq(contentPackages.trendId, trends.id))
    .where(and(...conditions))
    .orderBy(desc(contentPackages.updatedAt))
    .limit(limit)
    .all();

  return json({ packages: rows });
}

export async function POST() {
  return fail(405, "BAD_REQUEST", "内容包通过「生成」接口创建。");
}
