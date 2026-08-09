import { and, eq } from "drizzle-orm";
import { getDb } from "../../../../../../../db";
import { contentPackages, trends } from "../../../../../../../db/schema";
import { guardWorkspace, readJson } from "../../../../../../../lib/api-helpers";
import { writeAudit } from "../../../../../../../lib/audit";
import { fail, json } from "../../../../../../../lib/http";
import { extractPlaceholders, type GeneratedContent } from "../../../../../../../lib/model/safety";

/**
 * POST /api/workspaces/[id]/content-packages/[packageId]/approve：人工审批（FR-07）。
 * 审批要求：确认来源、事实与 AI 标识；可选把低/中风险调高（留下原因）。
 * 系统判定为 blocked 的热点不可审批通过。
 */

const RISK_VALUES = ["low", "medium", "high", "blocked"] as const;

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string; packageId: string }> },
) {
  const { id, packageId } = await context.params;
  const guard = await guardWorkspace(request, id, "approve");
  if (guard.error) return guard.error;

  const body = await readJson<{
    sourcesConfirmed?: boolean;
    factsConfirmed?: boolean;
    aiLabelConfirmed?: boolean;
    overrideRisk?: string;
    overrideReason?: string;
  }>(request);
  if (body instanceof Response) return body;

  const sourcesConfirmed = body.sourcesConfirmed === true;
  const factsConfirmed = body.factsConfirmed === true;
  const aiLabelConfirmed = body.aiLabelConfirmed === true;
  if (!sourcesConfirmed || !factsConfirmed || !aiLabelConfirmed) {
    return fail(400, "BAD_REQUEST", "审批必须同时确认：来源已核验、商品事实已确认、AI 标识已保留。");
  }

  const db = getDb();
  const pkg = await db
    .select()
    .from(contentPackages)
    .where(and(eq(contentPackages.workspaceId, id), eq(contentPackages.id, packageId)))
    .get();
  if (!pkg) return fail(404, "NOT_FOUND", "内容包不存在。");
  if (pkg.status === "approved" || pkg.status === "exported") {
    return fail(409, "CONFLICT", "该内容包已审批或已导出。");
  }
  if (pkg.status === "rejected") {
    return fail(409, "CONFLICT", "该内容包已被驳回，请修改后重新提交。");
  }

  const trend = await db
    .select({ risk: trends.risk, riskReasonsJson: trends.riskReasonsJson })
    .from(trends)
    .where(eq(trends.id, pkg.trendId))
    .get();
  if (!trend) return fail(404, "NOT_FOUND", "关联热点不存在。");
  if (trend.risk === "blocked") {
    return fail(422, "RISK_BLOCKED", "系统判定为禁止跟进的热点不可审批通过（FR-04 验收标准 3）。");
  }

  // 审批人可将低/中风险调高（仅上调，不可下调），并留下原因
  const rank: Record<(typeof RISK_VALUES)[number], number> = { low: 0, medium: 1, high: 2, blocked: 3 };
  const trendRisk = trend.risk as (typeof RISK_VALUES)[number];
  let effectiveRisk: (typeof RISK_VALUES)[number] = trendRisk;
  if (body.overrideRisk && (RISK_VALUES as readonly string[]).includes(body.overrideRisk)) {
    const requested = body.overrideRisk as (typeof RISK_VALUES)[number];
    if (rank[requested] > rank[trendRisk]) {
      effectiveRisk = requested;
    } else if (requested !== trendRisk) {
      return fail(400, "BAD_REQUEST", "只能将风险等级上调（审批人不可降低系统风险判定）。");
    }
  }

  const content = JSON.parse(pkg.contentJson) as GeneratedContent;
  const placeholders = extractPlaceholders(content);
  if (placeholders.length > 0 && !factsConfirmed) {
    return fail(400, "BAD_REQUEST", `文案包含未确认事实占位：${placeholders.join("、")}`);
  }

  const now = new Date().toISOString();
  const detail: Record<string, unknown> = {
    sourcesConfirmed,
    factsConfirmed,
    aiLabelConfirmed,
    risk: effectiveRisk,
    trendRisk: trendRisk,
  };
  if (effectiveRisk !== trendRisk) {
    const reason = (body.overrideReason ?? "").trim().slice(0, 300);
    if (!reason) return fail(400, "BAD_REQUEST", "上调风险等级时必须填写原因。");
    detail.overrideReason = reason;
    detail.riskOverridden = true;
  }

  await db
    .update(contentPackages)
    .set({
      status: "approved",
      approvedBy: guard.session.userId,
      approvedAt: now,
      updatedAt: now,
    })
    .where(eq(contentPackages.id, packageId));

  await writeAudit({
    workspaceId: id,
    contentPackageId: packageId,
    actorUserId: guard.session.userId,
    action: detail.riskOverridden ? "content.risk_overridden" : "content.approved",
    detail: { ...detail, versionHash: pkg.versionHash },
  });

  return json({
    package: { id: packageId, status: "approved", approvedBy: guard.session.userId, approvedAt: now },
    notice: "审批通过；现在可以导出合规交付包。",
  });
}
