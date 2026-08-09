/** 数据连接器公共类型（FR-02）。 */

export type ConnectorKind = "http_api" | "csv";

/** 授权 HTTP API 连接器配置（secrets 部分加密存储）。 */
export type HttpApiConfig = {
  /** 请求地址；GET 分页时自动追加页码参数。 */
  url: string;
  method?: "GET" | "POST";
  /** 静态请求头；值可包含 {secretName} 占位符，由加密的 secrets 替换。 */
  headers?: Record<string, string>;
  /** 加密保存的敏感字段（如 apiKey）。 */
  secrets?: Record<string, string>;
  /** POST 请求体模板（JSON 可序列化值）。 */
  body?: unknown;
  /** 响应中列表所在 JSON 路径（点分），如 "data.list"；缺省取整个响应。 */
  itemsPath?: string;
  /** 字段映射：外部字段名 → 内部字段。 */
  fieldMap: {
    title: string;
    summary?: string;
    category?: string;
    sourceUrl?: string;
    heat?: string;
    change?: string;
    collectedAt?: string;
  };
  /** 分页参数名（GET 查询参数）。 */
  pageParam?: string;
  pageSize?: number;
  maxPages?: number;
};

/** 标准化后的单条热点信号。 */
export type TrendRaw = {
  title: string;
  summary?: string;
  category?: string;
  sourceUrl: string;
  /** ISO 8601 采集时间；缺省取当前时间。 */
  collectedAt?: string;
  /** 原始热度数值（可选）。 */
  heat?: number;
  /** 24 小时增速百分比（可选，负数表示下降）。 */
  change?: number;
  /** 原始记录，保留用于追溯。 */
  raw?: Record<string, unknown>;
};

export class ConnectorError extends Error {
  kind: "http" | "rate_limited" | "parse" | "auth" | "config";
  retryable: boolean;
  /** 限流重置时间（ISO），rate_limited 时提供。 */
  resetAt?: string;

  constructor(
    kind: ConnectorError["kind"],
    message: string,
    options: { retryable?: boolean; resetAt?: string; status?: number } = {},
  ) {
    super(message);
    this.name = "ConnectorError";
    this.kind = kind;
    this.retryable = options.retryable ?? (kind !== "auth" && kind !== "config");
    if (options.resetAt) this.resetAt = options.resetAt;
  }
}

/** 连接器执行结果。 */
export type SyncResult = {
  connectorId: string;
  status: "ok" | "degraded" | "error" | "skipped" | "disabled";
  imported: number;
  skippedRows: number;
  message: string;
  resetAt?: string;
};

/** 按 HTTP 状态码构造连接器错误。 */
export function errorFromStatus(status: number, body: string): ConnectorError {
  if (status === 401 || status === 403) {
    return new ConnectorError("auth", `授权失败（HTTP ${status}）：${body.slice(0, 200)}`);
  }
  if (status === 429) {
    const retryAfter = /retry-after:\s*(\d+)/i.exec(body);
    const resetAt = retryAfter
      ? new Date(Date.now() + Number(retryAfter[1]) * 1000).toISOString()
      : undefined;
    return new ConnectorError("rate_limited", "触达数据源限流，已暂停重试。", { resetAt });
  }
  return new ConnectorError("http", `数据源请求失败（HTTP ${status}）`, {
    retryable: status >= 500 || status === 408,
  });
}
