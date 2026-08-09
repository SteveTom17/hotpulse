import type { RiskLevel } from "../risk";
import type { BrandContext } from "./prompts";
import type { GeneratedContent } from "./safety";

/**
 * 内置演示生成引擎（保留 0.1.0 能力）。
 * 仅当未配置正式模型且允许演示生成时使用；所有产物必须显著标注
 * “演示引擎”，导出清单与界面提示不得剥离。
 */

export type DemoGenerateInput = {
  title: string;
  summary: string;
  risk: RiskLevel;
  brand: BrandContext;
};

export function generateDemoContent(input: DemoGenerateInput): GeneratedContent {
  const brand = input.brand.name || "你的品牌";
  const offer =
    input.brand.verifiedFacts[0] ?? "[待确认：填写真实商品或活动信息]";

  const hooks = [
    `别急着追「${input.title}」，先看看它和你的顾客有什么关系`,
    `${brand}把这个热点，做成了一份不打扰的到店灵感`,
    `今天的城市生活关键词：${input.title}`,
  ];

  const script = [
    `【0–3 秒｜开场】镜头从街角或门店外景切入，字幕：「${input.title}，你刷到了吗？」`,
    `【4–12 秒｜关联】用真实生活场景解释热点：${input.summary}`,
    `【13–28 秒｜品牌价值】自然带出 ${brand} 的体验，不模仿原梗、不冒充当事人。`,
    `【29–42 秒｜事实信息】展示：${offer}。价格、库存、时间和功效发布前必须核验。`,
    "【43–50 秒｜收尾】邀请用户分享自己的城市体验；不诱导刷评，不制造虚假稀缺。",
  ].join("\n\n");

  const caption = `${input.title}带来的，不只是热度，也是一次重新观察日常的机会。\n\n${brand}准备了 ${offer}，欢迎把你的真实体验留在评论区。\n\n#本地生活 #城市灵感 #AI辅助创作`;

  const visual =
    "使用原创门店实拍或已获授权素材：首帧呈现城市街景与一句核心钩子；中段用三张卡片展示场景、体验和已核验信息；末帧保留“AI辅助创作”提示。不得使用真人仿声、盗用表情包或未经授权的影视片段。";

  return { hooks, script, caption, visual };
}

export const DEMO_ENGINE_NAME = "hotpulse-safe-demo-v1";
