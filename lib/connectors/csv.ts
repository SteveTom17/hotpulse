import type { TrendRaw } from "./types";

/**
 * 客户导入 CSV 解析（FR-02 验收标准 3：没有授权连接器时允许管理员导入 CSV，
 * 且标注“客户导入”，不作为已验证授权数据）。
 *
 * 表头支持中英文列名（见 HEADER_ALIASES）；解析结果保留原始行用于追溯。
 */

const HEADER_ALIASES: Record<string, keyof TrendRaw> = {
  title: "title",
  标题: "title",
  topic: "title",
  话题: "title",
  summary: "summary",
  摘要: "summary",
  description: "summary",
  描述: "summary",
  category: "category",
  分类: "category",
  行业: "category",
  source_url: "sourceUrl",
  url: "sourceUrl",
  来源链接: "sourceUrl",
  链接: "sourceUrl",
  heat: "heat",
  热度: "heat",
  change: "change",
  增速: "change",
  collected_at: "collectedAt",
  采集时间: "collectedAt",
};

export type CsvParseResult = {
  rows: TrendRaw[];
  errors: string[];
};

/** RFC 4180 风格 CSV 解析（支持引号与换行）。 */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (inQuotes) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += char;
      }
    } else if (char === '"') {
      inQuotes = true;
    } else if (char === ",") {
      row.push(field);
      field = "";
    } else if (char === "\n" || char === "\r") {
      if (char === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      field = "";
      if (row.some((cell) => cell.trim() !== "")) rows.push(row);
      row = [];
    } else {
      field += char;
    }
  }
  row.push(field);
  if (row.some((cell) => cell.trim() !== "")) rows.push(row);
  return rows;
}

function toNumber(value: string): number | undefined {
  const parsed = Number(value.trim().replace(/[^\d.-]/g, ""));
  return Number.isNaN(parsed) ? undefined : parsed;
}

/** 解析 CSV 文本为 TrendRaw 列表；表头缺失或错误行的信息写入 errors。 */
export function parseTrendCsv(text: string, defaultSourceUrl = ""): CsvParseResult {
  const errors: string[] = [];
  const table = parseCsv(text);
  if (table.length === 0) {
    return { rows: [], errors: ["文件为空。"] };
  }

  const header = table[0].map((cell) => cell.trim().toLowerCase());
  const columns = header.map((name) => HEADER_ALIASES[name] ?? null);
  if (!columns.includes("title")) {
    return { rows: [], errors: ["缺少标题列（支持表头：标题/title）。"] };
  }

  const rows: TrendRaw[] = [];
  for (let line = 1; line < table.length; line++) {
    const cells = table[line];
    const record: Record<string, string> = {};
    columns.forEach((field, index) => {
      if (field) record[field] = (cells[index] ?? "").trim();
    });

    if (!record.title) {
      errors.push(`第 ${line + 1} 行缺少标题，已跳过。`);
      continue;
    }

    rows.push({
      title: record.title,
      summary: record.summary,
      category: record.category,
      sourceUrl: record.sourceUrl || defaultSourceUrl,
      heat: toNumber(record.heat ?? ""),
      change: toNumber(record.change ?? ""),
      collectedAt: record.collectedAt
        ? new Date(record.collectedAt.replace(/\s+/g, "T")).toISOString()
        : undefined,
      raw: record,
    });
  }

  return { rows, errors };
}
