import { and, desc, eq } from "drizzle-orm";
import { getDb } from "../../../../../../db";
import {
  contentPackages,
  packageRevisions,
  trendSources,
  trends,
} from "../../../../../../db/schema";
import { guardWorkspace, readJson } from "../../../../../../lib/api-helpers";
import { writeAudit } from "../../../../../../lib/audit";
import { hashContent, type GeneratedContent } from "../../../../../../lib/model/safety";
import { fail, json } from "../../../../../../lib/http";

/**
 * GET /api/workspaces/[id]/content-packages/[packageId]：内容包详情 + 版本历史。
 * PATCH /api/workspaces/[id]/content-packages/[packageId]：编辑内容或恢复历史版本（保存为新版本）。
 */

function parseContent(raw: string): GeneratedContent {
  const parsed = JSON.parse(raw) as GeneratedContent;
  return {
    hooks: Array.isArray(parsed.hooks) ? parsed.hooks : [],
    script: typeof parsed.script === "string" ? parsed.script : "",
    caption: typeof parsed.caption === "string" ? parsed.caption : "",
    visual: typeof parsed.visual === "string" ? parsed.visual : "",
  };
}

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string; packageId: string }> },
) {
  const { id, packageId } = await context.params;
  const guard = await guardWorkspace(request, id, "view");
  if (guard.error) return guard.error;

  const db = getDb();
  const pkg = await db
    .select({
      id: contentPackages.id,
      trendId: contentPackages.trendId,
      trendTitle: trends.title,
      trendSummary: trends.summary,
      trendRisk: trends.risk,
      status: contentPackages.status,
      contentJson: contentPackages.contentJson,
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
    .where(and(eq(contentPackages.workspaceId, id), eq(contentPackages.id, packageId)))
    .get();
  if (!pkg) return fail(404, "NOT_FOUND", "内容包不存在。");

  const [revisions, sources] = await Promise.all([
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
    db
      .select({
        provider: trendSources.provider,
        sourceUrl: trendSources.sourceUrl,
        licenseStatus: trendSources.licenseStatus,
        collectedAt: trendSources.collectedAt,
      })
      .from(trendSources)
      .where(eq(trendSources.trendId, pkg.trendId))
      .all(),
  ]);

  const content = parseContent(pkg.contentJson);
  const placeholders = (content.script + content.caption + content.visual + content.hooks.join(""))
    .match(/\[待确认[^\]]*\]/g)
    ?.filter((value, index, all) => all.indexOf(value) === index) ?? [];

  return json({
    package: {
      id: pkg.id,
      trendId: pkg.trendId,
      trend: { title: pkg.trendTitle, summary: pkg.trendSummary, risk: pkg.trendRisk },
      status: pkg.status,
      content,
      modelName: pkg.modelName,
      aiLabelStatus: pkg.aiLabelStatus,
      versionHash: pkg.versionHash,
      placeholders,
      approvedBy: pkg.approvedBy,
      approvedAt: pkg.approvedAt,
      createdBy: pkg.createdBy,
      createdAt: pkg.createdAt,
      updatedAt: pkg.updatedAt,
    },
    sources,
    revisions,
  });
}

/** PATCH：编辑内容（保存新版本）或恢复历史版本。已审批/已导出的内容包不允许直接编辑。 */
export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string; packageId: string }> },
) {
  const { id, packageId } = await context.params;
  const guard = await guardWorkspace(request, id, "edit");
  if (guard.error) return guard.error;

  const body = await readJson<{
    content?: GeneratedContent;
    note?: string;
    restoreVersion?: number;
  }>(request);
  if (body instanceof Response) return body;

  const db = getDb();
  const pkg = await db
    .select()
    .from(contentPackages)
    .where(and(eq(contentPackages.workspaceId, id), eq(contentPackages.id, packageId)))
    .get();
  if (!pkg) return fail(404, "NOT_FOUND", "内容包不存在。");

  if (pkg.status === "approved" || pkg.status === "exported") {
    return fail(409, "CONFLICT", "已审批或已导出的内容包不可直接编辑；如需修改请新建生成。");
  }

  let nextContent: GeneratedContent;
  let note = body.note?.trim().slice(0, 200) ?? "";

  if (body.restoreVersion !== undefined) {
    const revision = await db
      .select()
      .from(packageRevisions)
      .where(
        and(
          eq(packageRevisions.contentPackageId, packageId),
          eq(packageRevisions.version, body.restoreVersion),
        ),
      )
      .get();
    if (!revision) return fail(404, "NOT_FOUND", "历史版本不存在。");
    nextContent = parseContent(revision.contentJson);
    note = note || `恢复自版本 ${revision.version}`;
  } else if (body.content) {
    nextContent = body.content;
    note = note || "人工编辑";
  } else {
    return fail(400, "BAD_REQUEST", "缺少内容或版本号。");
  }

  const latest = await db
    .select({ version: packageRevisions.version })
    .from(packageRevisions)
    .where(eq(packageRevisions.contentPackageId, packageId))
    .orderBy(desc(packageRevisions.version))
    .limit(1)
    .get();

  const nextVersion = (latest?.version ?? 0) + 1;
  const versionHash = await hashContent(nextContent);
  const now = new Date().toISOString();

  await db.insert(packageRevisions).values({
    id: crypto.randomUUID(),
    contentPackageId: packageId,
    version: nextVersion,
    contentJson: JSON.stringify(nextContent),
    editedBy: guard.session.userId,
    note,
    createdAt: now,
  });

  await db
    .update(contentPackages)
    .set({
      contentJson: JSON.stringify(nextContent),
      versionHash,
      status: "draft",
      aiLabelStatus: "required",
      approvedBy: null,
      approvedAt: null,
      updatedAt: now,
    })
    .where(eq(contentPackages.id, packageId));

  await writeAudit({
    workspaceId: id,
    contentPackageId: packageId,
    actorUserId: guard.session.userId,
    action: body.restoreVersion !== undefined ? "content.version_restored" : "content.edited",
    detail: { version: nextVersion, note, restoredFrom: body.restoreVersion ?? null },
  });

  return json({
    package: { id: packageId, status: "draft", version: nextVersion, versionHash },
    notice: "已保存为新版本，审批状态已重置；需重新审批后才能导出。",
  });
}
