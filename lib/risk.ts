/**
 * 规则优先的风险分类（FR-04）。
 * 不依赖模型，可审计、可解释；高风险议题默认不提供营销借势内容。
 */

export type RiskLevel = "low" | "medium" | "high" | "blocked";

export type RiskHit = {
  level: RiskLevel;
  rule: string;
  matched: string;
};

type RiskRule = {
  level: RiskLevel;
  rule: string;
  keywords: string[];
};

/**
 * 默认风险词表。命中规则：
 * - blocked 直接阻断生成（不回收危险细节，仅记录类别）；
 * - high 不提供营销借势内容，只允许“待核实”分析或放弃；
 * - medium 需要人工核验后谨慎跟进。
 */
const DEFAULT_RULES: RiskRule[] = [
  {
    level: "blocked",
    rule: "涉及未成年人",
    keywords: [
      "未成年", "儿童", "幼儿园", "小学生", "中学生", "校园", "校服",
      "留守儿童", "青少年", "婴幼", "童工",
    ],
  },
  {
    level: "blocked",
    rule: "灾害与事故",
    keywords: [
      "地震", "台风", "洪水", "泥石流", "爆炸", "火灾", "坍塌", "车祸",
      "交通事故", "伤亡", "遇难", "中毒", "坠楼", "溺水", "矿难",
    ],
  },
  {
    level: "high",
    rule: "医疗与健康",
    keywords: [
      "疫情", "疫苗", "病毒", "传染", "感染", "疾病", "治疗", "药效",
      "保健功效", "治愈率", "医院", "死亡病例",
    ],
  },
  {
    level: "high",
    rule: "金融风险",
    keywords: [
      "暴跌", "爆雷", "非法集资", "跑路", "诈骗", "股价", "退市",
      "涨跌停", "P2P", "杠杆爆仓",
    ],
  },
  {
    level: "high",
    rule: "法律与监管",
    keywords: [
      "诉讼", "立案", "处罚", "罚款", "吊销", "查封", "监管", "调查",
      "判决", "违法", "传唤",
    ],
  },
  {
    level: "high",
    rule: "政治与公共事件",
    keywords: [
      "政府", "官员", "选举", "游行", "抗议", "政策调整", "政变",
      "外交", "军事",
    ],
  },
  {
    level: "high",
    rule: "隐私泄露",
    keywords: [
      "隐私", "泄露", "偷拍", "人肉", "个人信息", "数据泄露", "爬取",
      "开盒", "定位曝光",
    ],
  },
  {
    level: "medium",
    rule: "争议性议题",
    keywords: [
      "争议", "质疑", "维权", "投诉", "曝光", "谣言", "真假", "翻车",
      "割韭菜", "踩坑",
    ],
  },
];

/**
 * 对热点标题与摘要做规则风险分类。
 * 返回最高风险等级及全部命中原因；未命中任何规则返回 low。
 */
export function classifyRisk(title: string, summary: string): { level: RiskLevel; hits: RiskHit[] } {
  const text = `${title}\n${summary}`.toLowerCase();
  const hits: RiskHit[] = [];

  for (const rule of DEFAULT_RULES) {
    const matched = rule.keywords.find((keyword) => text.includes(keyword.toLowerCase()));
    if (matched) {
      hits.push({ level: rule.level, rule: rule.rule, matched });
    }
  }

  const level: RiskLevel = hits.some((hit) => hit.level === "blocked")
    ? "blocked"
    : hits.some((hit) => hit.level === "high")
      ? "high"
      : hits.some((hit) => hit.level === "medium")
        ? "medium"
        : "low";

  return { level, hits };
}

/** 风险等级 → 内容安全维度得分（供评分使用）。 */
export function safetyScore(level: RiskLevel): number {
  switch (level) {
    case "low":
      return 92;
    case "medium":
      return 55;
    case "high":
      return 20;
    case "blocked":
      return 5;
  }
}

/** 可生成内容的风险门槛：仅 low/medium 允许生成。 */
export function canGenerate(level: RiskLevel): boolean {
  return level === "low" || level === "medium";
}
