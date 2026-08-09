import { safetyScore, type RiskLevel } from "./risk";

/**
 * 建议跟进度评分（FR-03）。
 * score = 增速 × 0.35 + 跨源信号 × 0.25 + 行业相关性 × 0.25 + 内容安全 × 0.15。
 * 分数是可解释的决策辅助，不是事实结论；低置信/数据过期时降低置信度。
 */

export type ScoreBreakdownItem = { label: string; value: number };

export type ScoreResult = {
  score: number;
  confidence: "high" | "medium" | "low";
  breakdown: ScoreBreakdownItem[];
};

export type ScoreInput = {
  /** 24 小时增速百分比（可负）。 */
  change: number;
  /** 不同来源数量。 */
  sourceCount: number;
  /** 行业相关性 0–100（调用方结合品牌行业计算）。 */
  industryScore: number;
  risk: RiskLevel;
  /** 数据是否超出配置新鲜度（如 24 小时未更新）。 */
  stale?: boolean;
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.round(value)));
}

/** 增速 → 0–100：增速 200% 封顶满分。 */
export function growthScore(change: number): number {
  return clamp((change / 2) * 10, 0, 100);
}

/** 跨源信号 → 0–100：3 个及以上来源满分。 */
export function crossSourceScore(sourceCount: number): number {
  return clamp(sourceCount * 33, 0, 100);
}

export function scoreTrend(input: ScoreInput): ScoreResult {
  const growth = growthScore(input.change);
  const cross = crossSourceScore(input.sourceCount);
  const industry = clamp(input.industryScore, 0, 100);
  const safety = safetyScore(input.risk);

  const score = Math.round(growth * 0.35 + cross * 0.25 + industry * 0.25 + safety * 0.15);

  let confidence: ScoreResult["confidence"] = "medium";
  if (input.sourceCount >= 3 && !input.stale) confidence = "high";
  else if (input.sourceCount < 2 || input.stale) confidence = "low";

  return {
    score,
    confidence,
    breakdown: [
      { label: "增长速度", value: growth },
      { label: "跨源信号", value: cross },
      { label: "行业相关", value: industry },
      { label: "内容安全", value: safety },
    ],
  };
}

/**
 * 行业相关性打分：用品牌行业关键词在标题/摘要中的命中比例估算 0–100。
 * 简单可解释，不调用模型；返回 0–100。
 */
export function industryRelevance(title: string, summary: string, industryKeywords: string[]): number {
  if (industryKeywords.length === 0) return 50;
  const text = `${title} ${summary}`.toLowerCase();
  const hits = industryKeywords.filter((keyword) => text.includes(keyword.toLowerCase())).length;
  if (hits === 0) return 30;
  return Math.min(100, 40 + hits * 30);
}
