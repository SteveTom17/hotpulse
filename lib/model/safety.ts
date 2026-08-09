/**
 * 模型输出安全校验（FR-05）。
 * 校验结构完整性、长度边界与明显的禁止表达；不通过则整体拒绝，
 * 不回显危险细节。
 */

export type GeneratedContent = {
  hooks: string[];
  script: string;
  caption: string;
  visual: string;
};

/** 绝对化/虚假承诺用语（命中即要求修正，不直接判死，便于重生成）。 */
const FORBIDDEN_PHRASES = [
  "包治",
  "100%有效",
  "立刻见效",
  "最好吃的",
  "全市第一",
  "全网首发",
  "绝无仅有",
  "永久有效",
];

const MAX_LENGTH = 2000;

export type SafetyCheckResult = {
  ok: boolean;
  errors: string[];
};

export function validateGeneratedContent(value: unknown): SafetyCheckResult {
  const errors: string[] = [];
  const content = value as Partial<GeneratedContent>;

  if (!Array.isArray(content.hooks) || content.hooks.length !== 3) {
    errors.push("标题钩子必须是 3 个版本。");
  } else {
    for (const hook of content.hooks) {
      if (typeof hook !== "string" || hook.trim().length === 0) {
        errors.push("标题钩子存在空值。");
        break;
      }
    }
  }

  for (const field of ["script", "caption", "visual"] as const) {
    const text = content[field];
    if (typeof text !== "string" || text.trim().length === 0) {
      errors.push(`${field} 为空。`);
    } else if (text.length > MAX_LENGTH) {
      errors.push(`${field} 超出长度限制。`);
    }
  }

  if (errors.length > 0) return { ok: false, errors };

  const allText = [
    ...((content.hooks as string[]) ?? []),
    content.script ?? "",
    content.caption ?? "",
    content.visual ?? "",
  ].join("\n");

  const hit = FORBIDDEN_PHRASES.find((phrase) => allText.includes(phrase));
  if (hit) {
    errors.push(`输出包含禁止表达「${hit}」，请重新生成并改为有依据的描述。`);
  }

  return { ok: errors.length === 0, errors };
}

/**
 * 提取事实引用占位符清单，供审批清单展示（FR-05 验收标准 2）。
 */
export function extractPlaceholders(content: GeneratedContent): string[] {
  const allText = [content.script, content.caption, content.visual, ...content.hooks].join("\n");
  const matches = allText.match(/\[待确认[^\]]*\]/g) ?? [];
  return [...new Set(matches)];
}

/** 计算内容包版本哈希（内容 + 标识状态，用于审批留痕）。 */
export async function hashContent(content: GeneratedContent): Promise<string> {
  const data = new TextEncoder().encode(JSON.stringify(content));
  const digest = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("")
    .slice(0, 16);
}
