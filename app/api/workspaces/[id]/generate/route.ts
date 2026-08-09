import { and, eq } from "drizzle-orm";
import { getDb } from "../../../../../db";
import {
  brandProfiles,
  contentPackages,
  packageRevisions,
  trends,
  workspaces,
} from "../../../../../db/schema";
import { guardWorkspace } from "../../../../../lib/api-helpers";
import { writeAudit } from "../../../../../lib/audit";
import { consumeCredits } from "../../../../../lib/billing";
import { generateDemoContent, DEMO_ENGINE_NAME } from "../../../../../lib/model/demo";
import { chatJson, ModelError } from "../../../../../lib/model/gateway";
import { buildGenerateMessages, type BrandContext } from "../../../../../lib/model/prompts";
import {
  extractPlaceholders,
  hashContent,
  validateGeneratedContent,
  type GeneratedContent,
} from "../../../../../lib/model/safety";
import { canGenerate } from "../../../../../lib/risk";
import { fail, json } from "../../../../../lib/http";
import { getEnv } from "../../../../../lib/env";

/**
 * POST /api/workspaces/[id]/generate：生成内容包（FR-05）。
 * 流程：风险门槛 → 额度检查 → 正式模型（DeepSeek）→ 输出安全校验 →
 * 保存内容包与版本历史 → 审计与用量。
 * 模型未配置或 GENERATION_ENGINE=demo 时降级为演示引擎（必须显著标注）。
 */

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const guard = await guardWorkspace(request, id, "edit");
  if (guard.error) return guard.error;

  let body: { trendId?: string; regenerateOf?: string };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return fail(400, "BAD_REQUEST", "请求内容不是有效的 JSON。");
  }
  if (!body.trendId) return fail(400, "BAD_REQUEST", "缺少热点 ID。");

  const db = getDb();
  const trend = await db
    .select()
    .from(trends)
    .where(and(eq(trends.workspaceId, id), eq(trends.id, body.trendId)))
    .get();
  if (!trend) return fail(404, "NOT_FOUND", "热点不存在。");

  // 风险门槛：blocked/high 一律拒绝（FR-04）
  if (!canGenerate(trend.risk)) {
    return fail(
      422,
      "RISK_BLOCKED",
      trend.risk === "blocked"
        ? "该议题属于禁止跟进类别，系统拒绝生成营销内容。"
        : "该议题风险较高，HotPulse 不生成营销借势文案；请改为事实核验、公益回应或放弃跟进。",
      { risk: trend.risk, reasons: JSON.parse(trend.riskReasonsJson) },
    );
  }

  let profile = await db
    .select()
    .from(brandProfiles)
    .where(eq(brandProfiles.workspaceId, id))
    .get();
  // 防御：旧工作区可能缺少品牌资料；自动补建默认资料，避免内容包外键失败
  if (!profile) {
    const workspace = await db
      .select({ name: workspaces.name })
      .from(workspaces)
      .where(eq(workspaces.id, id))
      .get();
    profile = {
      id: crypto.randomUUID(),
      workspaceId: id,
      name: workspace?.name ?? "你的品牌",
      audience: "",
      tone: "克制、真诚、清晰",
      bannedTopicsJson: "[]",
      verifiedFactsJson: "[]",
      version: 1,
      updatedAt: new Date().toISOString(),
    };
    await db.insert(brandProfiles).values(profile);
  }

  const brandContext: BrandContext = {
    name: profile?.name ?? "你的品牌",
    audience: profile?.audience ?? "",
    tone: profile?.tone ?? "克制、真诚、清晰",
    bannedTopics: profile ? (JSON.parse(profile.bannedTopicsJson) as string[]) : [],
    verifiedFacts: profile ? (JSON.parse(profile.verifiedFactsJson) as string[]) : [],
  };

  // 额度检查与扣减（生成消耗 1 额度）
  const credit = await consumeCredits(db, id, body.regenerateOf ? "regenerate" : "content_generation", 1, {
    trendId: trend.id,
  });
  if (!credit.ok) {
    return fail(402, credit.code === "QUOTA_EXCEEDED" ? "QUOTA_EXCEEDED" : "FORBIDDEN", credit.message, {
      planStatus: credit.status,
    });
  }

  const env = getEnv();
  const useDemoEngine = env.GENERATION_ENGINE === "demo" || !env.DEEPSEEK_API_KEY;
  let content: GeneratedContent;
  let engine: string;

  if (useDemoEngine) {
    content = generateDemoContent({
      title: trend.title,
      summary: trend.summary,
      risk: trend.risk,
      brand: brandContext,
    });
    engine = DEMO_ENGINE_NAME;
  } else {
    try {
      const messages = buildGenerateMessages({
        title: trend.title,
        summary: trend.summary,
        category: trend.category,
        risk: trend.risk,
        riskReasons: (JSON.parse(trend.riskReasonsJson) as { rule: string }[]).map((hit) => hit.rule),
        brand: brandContext,
      });
      const raw = await chatJson(messages, { temperature: 0.7 });
      const validation = validateGeneratedContent(raw);
      if (!validation.ok) {
        return fail(422, "BAD_REQUEST", `生成内容未通过安全校验：${validation.errors.join("；")}`, {
          engine: "model",
        });
      }
      content = raw as GeneratedContent;
      engine = `${env.DEEPSEEK_MODEL ?? "deepseek-chat"}@${new URL(env.DEEPSEEK_BASE_URL ?? "https://api.deepseek.com").hostname}`;
    } catch (error) {
      if (error instanceof ModelError) {
        return fail(
          error.retryable ? 503 : 422,
          error.kind === "quota" ? "QUOTA_EXCEEDED" : "SERVICE_UNAVAILABLE",
          error.message,
          { engine: "model", kind: error.kind },
        );
      }
      throw error;
    }
  }

  // 保存内容包 + 初始版本
  const versionHash = await hashContent(content);
  const packageId = crypto.randomUUID();
  const now = new Date().toISOString();
  const placeholders = extractPlaceholders(content);
  const modelName = useDemoEngine ? engine : env.DEEPSEEK_MODEL ?? "deepseek-chat";

  await db.insert(contentPackages).values({
    id: packageId,
    workspaceId: id,
    trendId: trend.id,
    brandProfileId: profile?.id ?? "",
    status: "draft",
    contentJson: JSON.stringify(content),
    modelName,
    aiLabelStatus: "required",
    versionHash,
    createdBy: guard.session.userId,
    createdAt: now,
    updatedAt: now,
  });

  await db.insert(packageRevisions).values({
    id: crypto.randomUUID(),
    contentPackageId: packageId,
    version: 1,
    contentJson: JSON.stringify(content),
    editedBy: guard.session.userId,
    note: "初始生成",
    createdAt: now,
  });

  await writeAudit({
    workspaceId: id,
    contentPackageId: packageId,
    actorUserId: guard.session.userId,
    action: "content.generated",
    detail: {
      trendId: trend.id,
      engine,
      demoEngine: useDemoEngine,
      placeholders,
      creditsRemaining: credit.ok ? credit.remaining : null,
    },
  });

  return json({
    contentPackage: {
      id: packageId,
      trendId: trend.id,
      status: "draft",
      content,
      modelName,
      aiLabelStatus: "required",
      version: 1,
      versionHash,
      placeholders,
      engine,
      demoEngine: useDemoEngine,
      disclaimer: useDemoEngine
        ? "当前为演示生成引擎（未配置正式模型）。产物仅供演示流程，不得对外发布；请先接入正式模型并完成评估。"
        : "AI 草案：发布前请核验来源、事实与 AI 标识。",
    },
    credits: { remaining: credit.ok ? credit.remaining : 0, total: credit.ok ? credit.total : 0 },
  });
}
