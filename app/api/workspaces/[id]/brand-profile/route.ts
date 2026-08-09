import { eq } from "drizzle-orm";
import { getDb } from "../../../../../db";
import { brandProfiles, type BrandProfile } from "../../../../../db/schema";
import { guardWorkspace, readJson } from "../../../../../lib/api-helpers";
import { writeAudit } from "../../../../../lib/audit";
import { fail, json } from "../../../../../lib/http";

/**
 * 品牌资料（FR-01）：行业、目标客群、语气、禁用话题与可核验事实。
 * 生成内容时只能引用本工作区已确认的事实；没有资料时前端展示占位与“待确认”。
 */

const MAX_FACT_LENGTH = 200;
const MAX_TOPIC_LENGTH = 50;

export type BrandProfileView = {
  id: string;
  name: string;
  audience: string;
  tone: string;
  bannedTopics: string[];
  verifiedFacts: string[];
  version: number;
};

function cleanList(value: unknown, maxItemLength: number): string[] {
  if (!Array.isArray(value)) return [];
  return [
    ...new Set(
      value
        .map((item) => (typeof item === "string" ? item.trim().slice(0, maxItemLength) : ""))
        .filter(Boolean),
    ),
  ].slice(0, 50);
}

export function toBrandProfileView(row: {
  id: string;
  name: string;
  audience: string;
  tone: string;
  bannedTopicsJson: string;
  verifiedFactsJson: string;
  version: number;
}): BrandProfileView {
  return {
    id: row.id,
    name: row.name,
    audience: row.audience,
    tone: row.tone,
    bannedTopics: JSON.parse(row.bannedTopicsJson) as string[],
    verifiedFacts: JSON.parse(row.verifiedFactsJson) as string[],
    version: row.version,
  };
}

/** GET /api/workspaces/[id]/brand-profile：读取品牌资料。 */
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const guard = await guardWorkspace(request, id, "view");
  if (guard.error) return guard.error;

  const db = getDb();
  const profile = await db
    .select()
    .from(brandProfiles)
    .where(eq(brandProfiles.workspaceId, id))
    .get();

  return json({ brandProfile: profile ? toBrandProfileView(profile) : null });
}

/** PUT /api/workspaces/[id]/brand-profile：创建或更新品牌资料（可编辑角色），每次保存提升版本号。 */
export async function PUT(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const guard = await guardWorkspace(request, id, "edit");
  if (guard.error) return guard.error;

  const body = await readJson<{
    name?: string;
    audience?: string;
    tone?: string;
    bannedTopics?: unknown;
    verifiedFacts?: unknown;
  }>(request);
  if (body instanceof Response) return body;

  const name = (body.name ?? "").trim().slice(0, 60);
  if (!name) return fail(400, "BAD_REQUEST", "品牌名称必填。");

  const db = getDb();
  const existing = await db
    .select()
    .from(brandProfiles)
    .where(eq(brandProfiles.workspaceId, id))
    .get();

  const now = new Date().toISOString();
  const next = {
    name,
    audience: (body.audience ?? "").trim().slice(0, 500),
    tone: (body.tone ?? "").trim().slice(0, 200),
    bannedTopicsJson: JSON.stringify(cleanList(body.bannedTopics, MAX_TOPIC_LENGTH)),
    verifiedFactsJson: JSON.stringify(cleanList(body.verifiedFacts, MAX_FACT_LENGTH)),
    updatedAt: now,
  };

  let saved: BrandProfile;
  if (existing) {
    saved = { ...existing, ...next, version: existing.version + 1 };
    await db
      .update(brandProfiles)
      .set({ ...next, version: existing.version + 1 })
      .where(eq(brandProfiles.id, existing.id));
  } else {
    saved = {
      id: crypto.randomUUID(),
      workspaceId: id,
      ...next,
      version: 1,
    };
    await db.insert(brandProfiles).values(saved);
  }

  await writeAudit({
    workspaceId: id,
    actorUserId: guard.session.userId,
    action: "brand_profile.updated",
    detail: { version: saved.version, name },
  });

  return json({
    brandProfile: toBrandProfileView(saved),
    notice: "品牌资料已保存；只有列出的“已确认事实”会被生成引擎引用。",
  });
}
