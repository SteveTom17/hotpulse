import type { RiskLevel } from "../risk";
import type { ChatMessage } from "./gateway";

/**
 * 内容包生成的结构化提示词（FR-05）。
 * 只允许引用输入中提供的品牌事实；缺失事实一律使用 [待确认]，禁止模型自行虚构。
 */

export type BrandContext = {
  name: string;
  industry?: string;
  audience?: string;
  tone?: string;
  bannedTopics: string[];
  verifiedFacts: string[];
};

export type GenerateInput = {
  title: string;
  summary: string;
  category: string;
  risk: RiskLevel;
  riskReasons: string[];
  brand: BrandContext;
};

export function buildGenerateMessages(input: GenerateInput): ChatMessage[] {
  const factsBlock =
    input.brand.verifiedFacts.length > 0
      ? input.brand.verifiedFacts.map((fact) => `- ${fact}`).join("\n")
      : "（当前工作区尚未确认任何商品/门店事实）";

  const bannedBlock =
    input.brand.bannedTopics.length > 0
      ? input.brand.bannedTopics.join("、")
      : "（无）";

  const system = [
    "你是「HotPulse 热点内容作战台」的内容顾问，为本地生活/餐饮品牌撰写可编辑、可核查、需人工审批后发布的内容草案。",
    "",
    "硬性约束：",
    "1. 输出必须是 JSON 对象，结构：{\"hooks\":[\"3个字符串\"],\"script\":\"字符串\",\"caption\":\"字符串\",\"visual\":\"字符串\"}。",
    "2. hooks：3 个标题/钩子版本，每个不超过 22 字。",
    "3. script：30–60 秒短视频脚本，按【0–3 秒】【4–12 秒】【13–28 秒】【29–42 秒】【43–50 秒】分镜，总字数 220–320 字。",
    "4. caption：图文/带货文案，100–200 字，含 2–4 个话题标签，并以「AI 辅助创作」作为末尾标签。",
    "5. visual：表情包/视觉创意说明，说明构图与画面，不生成侵权素材。",
    "6. 所有具体事实（价格、库存、活动时间、功效、资质、奖项、评价）只能引用下方「已确认品牌事实」；没有依据的必须写 [待确认]，不得编造。",
    "7. 不得仿冒真实人物、机构或品牌的官方口吻；不得搬运他人作品；不得使用真人仿声或未授权肖像。",
    "8. 不得使用绝对化用语（如“最好”“第一”“100%”“包治”），不得制造虚假稀缺或诱导刷评。",
    "9. 高风险议题（灾害、事故、未成年人、隐私、医疗、金融、法律、政治等）不得把悲剧或争议转化为营销机会。",
    "",
    "品牌背景：",
    `- 品牌名称：${input.brand.name}`,
    `- 行业：${input.brand.industry ?? "本地生活/餐饮"}`,
    `- 目标客群：${input.brand.audience || "未提供（可写通用表达）"}`,
    `- 语气：${input.brand.tone || "克制、真诚、清晰"}`,
    `- 禁用话题：${bannedBlock}`,
    "",
    "已确认品牌事实（只能引用这些）：",
    factsBlock,
  ].join("\n");

  const user = [
    "请基于以下热点生成一份内容包草案。",
    "",
    `热点标题：${input.title}`,
    `热点摘要：${input.summary}`,
    `分类：${input.category || "未分类"}`,
    `风险等级：${input.risk}（命中规则：${input.riskReasons.join("、") || "无"}）`,
    "",
    "要求：草案必须与热点相关且不夸大；明显超出品牌事实的表达一律以 [待确认] 占位；输出严格按约定 JSON 结构。",
  ].join("\n");

  return [
    { role: "system", content: system },
    { role: "user", content: user },
  ];
}
