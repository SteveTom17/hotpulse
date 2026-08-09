import { and, desc, eq } from "drizzle-orm";
import { getDb } from "../../../../../../../db";
import {
  brandProfiles,
  contentPackages,
  packageRevisions,
  trendSources,
  trends,
} from "../../../../../../../db/schema";
import { guardWorkspace } from "../../../../../../../lib/api-helpers";
import { writeAudit } from "../../../../../../../lib/audit";
import { consumeCredits } from "../../../../../../../lib/billing";
import { fail, json } from "../../../../../../../lib/http";
import { DEMO_ENGINE_NAME } from "../../../../../../../lib/model/demo";
import type { GeneratedContent } from "../../../../../../../lib/model/safety";

/**
 * POST /api/workspaces/[id]/content-packages/[packageId]/export：合规导出（FR-06/FR-07）。
 * 仅审批通过的内容包可导出；生成 manifest.json（来源、事实、AI 标识、审批记录、
 * 版本历史、风险状态），导出后状态置为 exported，写入审计并扣除 1 导出额度。
 */

function safeParse(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string; packageId: string }> },
) {
  const { id, packageId } = await context.params;
  const guard = await guardWorkspace(request, id, "export");
  if (guard.error) return guard.error;

  const db = getDb();
  const row = await db
    .select({
      id: contentPackages.id,
      trendId: contentPackages.trendId,
      brandProfileId: contentPackages.brandProfileId,
      status: contentPackages.status,
      contentJson: contentPackages.contentJson,
      modelName: contentPackages.modelName,
      aiLabelStatus: contentPackages.aiLabelStatus,
      versionHash: contentPackages.versionHash,
      approvedBy: contentPackages.approvedBy,
      approvedAt: contentPackages.approvedAt,
      createdBy: contentPackages.createdBy,
      createdAt: contentPackages.createdAt,
      trendTitle: trends.title,
      trendSummary: trends.summary,
      trendRisk: trends.risk,
      trendCategory: trends.category,
      trendRiskReasonsJson: trends.riskReasonsJson,
    })
    .from(contentPackages)
    .innerJoin(trends, eq(contentPackages.trendId, trends.id))
    .where(and(eq(contentPackages.workspaceId, id), eq(contentPackages.id, packageId)))
    .get();
  if (!row) return fail(404, "NOT_FOUND", "内容包不存在。");
  if (row.status !== "approved") {
    return fail(409, "CONFLICT", "仅审批通过的内容包可导出（FR-07 验收标准 1）。");
  }

  const [sources, revisions, profile] = await Promise.all([
    db
      .select({
        provider: trendSources.provider,
        sourceUrl: trendSources.sourceUrl,
        licenseStatus: trendSources.licenseStatus,
        collectedAt: trendSources.collectedAt,
      })
      .from(trendSources)
      .where(eq(trendSources.trendId, row.trendId))
      .all(),
    db
      .select({
        version: packageRevisions.version,
        editedBy: packageRevisions.editedBy,
        note: packageRevisions.note,
        createdAt: packageRevisions.createdAt,
      })
      .from(packageRevisions)
      .where(eq(packageRevisions.contentPackageId, packageId))
      .orderBy(desc(packageRevisions.version))
      .all(),
    row.brandProfileId
      ? db
          .select({ verifiedFactsJson: brandProfiles.verifiedFactsJson, name: brandProfiles.name })
          .from(brandProfiles)
          .where(eq(brandProfiles.id, row.brandProfileId))
          .get()
      : Promise.resolve(null),
  ]);

  // 导出消耗 1 额度（计费闭环）；额度不足时仍提示先开通
  const credit = await consumeCredits(db, id, "export", 1, {
    packageId,
    trendId: row.trendId,
  });
  if (!credit.ok) {
    return fail(402, credit.code === "QUOTA_EXCEEDED" ? "QUOTA_EXCEEDED" : "FORBIDDEN", credit.message, {
      planStatus: credit.status,
    });
  }

  const content = JSON.parse(row.contentJson) as GeneratedContent;
  const facts: string[] = profile ? (safeParse(profile.verifiedFactsJson) as string[]) : [];
  const demoEngine = row.modelName === DEMO_ENGINE_NAME;
  const now = new Date().toISOString();

  const manifest = {
    manifestVersion: 1,
    packageId: row.id,
    exportedAt: now,
    exportedBy: guard.session.userId,
    contentPackage: {
      trendId: row.trendId,
      trendTitle: row.trendTitle,
      trendSummary: row.trendSummary,
      risk: { level: row.trendRisk, reasons: safeParse(row.trendRiskReasonsJson) },
      status: "exported",
      modelName: row.modelName,
      versionHash: row.versionHash,
      approvedBy: row.approvedBy,
      approvedAt: row.approvedAt,
      createdBy: row.createdBy,
      createdAt: row.createdAt,
    },
    content,
    sources,
    facts,
    aiLabel: {
      status: row.aiLabelStatus,
      demoEngine,
      statement: demoEngine
        ? "本内容由演示生成引擎产出，仅用于流程演示，不得对外发布。"
        : "AI 草案：发布前请核验来源、事实与 AI 标识；导出后不得剥离本标识。",
    },
    revisions,
    notice: "本导出包仅供人工复核后使用，系统不会自动发布任何平台帖子。",
  };

  await db
    .update(contentPackages)
    .set({ status: "exported", updatedAt: now })
    .where(eq(contentPackages.id, packageId));

  await writeAudit({
    workspaceId: id,
    contentPackageId: packageId,
    actorUserId: guard.session.userId,
    action: "content.exported",
    detail: {
      versionHash: row.versionHash,
      manifestVersion: 1,
      sourceCount: sources.length,
      factCount: facts.length,
      demoEngine,
      creditsRemaining: credit.remaining,
    },
  });

  return json({
    manifest,
    exportedAt: now,
    credits: { remaining: credit.remaining, total: credit.total },
    notice: "导出成功：请保留 manifest.json 与 AI 标识，按平台要求标注后发布。",
  });
}
