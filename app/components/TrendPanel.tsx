"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { api, ApiError, RISK_LABELS } from "./api";
import type { TabKey } from "./WorkspaceApp";
import type { GeneratePayload, Trend, TrendDetailPayload, TrendUserStatus } from "./types";

/**
 * 机会雷达（FR-02/FR-03）：热点列表 + 研判详情 + 来源证据 + 生成内容包。
 * 数据来自授权连接器与客户导入；来源与采集时间逐条展示，不标注“已验证”之外的结论。
 */

type Filter = "all" | "low" | "medium" | "high" | "blocked";

const STATUS_ACTIONS: { value: TrendUserStatus; label: string }[] = [
  { value: "watch", label: "观察" },
  { value: "ignore", label: "忽略" },
  { value: "generate", label: "跟进生成" },
];

const SOURCE_STATUS_LABELS: Record<string, string> = {
  authorized: "授权接口",
  customer_import: "客户导入",
  demo: "模拟数据",
  unavailable: "数据暂不可用",
};

export function TrendPanel({
  workspaceId,
  canEdit,
  onNavigate,
  onToast,
}: {
  workspaceId: string;
  canEdit: boolean;
  onNavigate: (tab: TabKey) => void;
  onToast: (message: string) => void;
}) {
  const [trends, setTrends] = useState<Trend[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<TrendDetailPayload | null>(null);
  const [generating, setGenerating] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const payload = await api.get<{ trends: Trend[] }>(`/api/workspaces/${workspaceId}/trends?limit=100`);
      setTrends(payload.trends);
      setSelectedId((current) => current ?? payload.trends[0]?.id ?? null);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "热点加载失败。");
    } finally {
      setLoading(false);
    }
  }, [workspaceId]);

  useEffect(() => {
    void load();
  }, [load]);

  const loadDetail = useCallback(
    async (trendId: string) => {
      try {
        const payload = await api.get<TrendDetailPayload>(
          `/api/workspaces/${workspaceId}/trends/${trendId}`,
        );
        setDetail(payload);
      } catch {
        setDetail(null);
      }
    },
    [workspaceId],
  );

  useEffect(() => {
    if (selectedId) void loadDetail(selectedId);
  }, [selectedId, loadDetail]);

  const visibleTrends = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return trends.filter((trend) => {
      const matchesFilter = filter === "all" || trend.risk === filter;
      const matchesQuery =
        !normalized ||
        trend.title.toLowerCase().includes(normalized) ||
        trend.summary.toLowerCase().includes(normalized) ||
        trend.category.toLowerCase().includes(normalized);
      return matchesFilter && matchesQuery;
    });
  }, [trends, filter, query]);

  const selected = detail?.trend ?? trends.find((trend) => trend.id === selectedId) ?? null;
  const canGenerate = selected !== null && (selected.risk === "low" || selected.risk === "medium");

  async function setUserStatus(trendId: string, userStatus: TrendUserStatus) {
    if (!canEdit) return;
    try {
      await api.patch(`/api/workspaces/${workspaceId}/trends/${trendId}`, { userStatus });
      setTrends((current) =>
        current.map((trend) => (trend.id === trendId ? { ...trend, userStatus } : trend)),
      );
      setDetail((current) => (current?.trend.id === trendId ? { ...current, trend: { ...current.trend, userStatus } } : current));
    } catch (caught) {
      onToast(caught instanceof ApiError ? caught.message : "状态更新失败。");
    }
  }

  async function generate() {
    if (!selected || !canGenerate) return;
    setGenerating(true);
    setError("");
    try {
      const result = await api.post<GeneratePayload>(`/api/workspaces/${workspaceId}/generate`, {
        trendId: selected.id,
      });
      onToast(
        `内容包已生成（${result.credits.remaining}/${result.credits.total} 额度剩余）${result.contentPackage.demoEngine ? "，当前为演示引擎" : ""}。`,
      );
      onNavigate("studio");
    } catch (caught) {
      if (caught instanceof ApiError && caught.code === "QUOTA_EXCEEDED") {
        setError(`${caught.message} 请前往“计费与用量”联系开通。`);
      } else {
        setError(caught instanceof ApiError ? caught.message : "生成失败，请稍后重试。");
      }
    } finally {
      setGenerating(false);
    }
  }

  return (
    <section className="workspace-grid" aria-labelledby="opportunities-title">
      <div className="trend-panel">
        <div className="section-heading">
          <div>
            <p className="eyebrow">机会雷达</p>
            <h2 id="opportunities-title">今日热点</h2>
          </div>
          {trends.some((trend) => trend.sourceStatus === "demo") && (
            <span className="demo-pill">含模拟数据</span>
          )}
        </div>

        <div className="search-row">
          <label>
            <span className="sr-only">搜索热点</span>
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="搜索热点、摘要或行业"
            />
          </label>
        </div>

        <div className="filter-row" aria-label="按风险筛选">
          {(["all", "low", "medium", "high"] as Filter[]).map((item) => (
            <button
              key={item}
              type="button"
              className={filter === item ? "active" : ""}
              onClick={() => setFilter(item)}
              aria-pressed={filter === item}
            >
              {item === "all" ? "全部" : RISK_LABELS[item]}
            </button>
          ))}
        </div>

        {error && <div className="error-banner" role="alert">{error}</div>}

        {loading ? (
          <div className="empty-state"><strong>正在加载热点…</strong></div>
        ) : (
          <div className="trend-list">
            {visibleTrends.map((trend) => (
              <button
                key={trend.id}
                type="button"
                className={`trend-card ${selectedId === trend.id ? "selected" : ""}`}
                aria-pressed={selectedId === trend.id}
                onClick={() => setSelectedId(trend.id)}
              >
                <span className="score-ring" aria-label={`建议跟进度 ${trend.score} 分`}>{trend.score}</span>
                <span className="trend-copy">
                  <span className="trend-meta">
                    <span className={`risk-tag ${trend.risk}`}>{RISK_LABELS[trend.risk]}</span>
                    <span>{trend.category}</span>
                    <span>{formatTime(trend.collectedAt)}</span>
                  </span>
                  <strong>{trend.title}</strong>
                  <span className="trend-summary">{trend.summary}</span>
                  <span className="trend-signals">
                    <span className="positive">增长 {trend.change}%</span>
                    <span>{trend.sourceCount} 个来源</span>
                    <span>{SOURCE_STATUS_LABELS[trend.sourceStatus] ?? trend.sourceStatus}</span>
                  </span>
                </span>
              </button>
            ))}
            {visibleTrends.length === 0 && (
              <div className="empty-state">
                <strong>没有匹配的热点</strong>
                <p>换一个关键词或放宽风险筛选；也可以到“数据源”导入或连接授权数据。</p>
              </div>
            )}
          </div>
        )}
      </div>

      <aside className="detail-panel" aria-label="热点研判详情">
        {!selected ? (
          <div className="empty-state"><strong>选择一个热点查看研判详情</strong></div>
        ) : (
          <>
            <div className="detail-header">
              <span className={`risk-tag ${selected.risk}`}>{RISK_LABELS[selected.risk]}</span>
              <span className="demo-pill">更新于 {formatTime(selected.updatedAt)}</span>
            </div>
            <h2>{selected.title}</h2>
            <p className="detail-summary">{selected.summary}</p>

            {selected.riskReasons.length > 0 && (
              <div className={`recommendation ${selected.risk}`}>
                <strong>风险提示（{selected.risk === "blocked" ? "禁止跟进" : "需人工核验"}）</strong>
                <ul className="risk-reason-list">
                  {selected.riskReasons.map((reason, index) => (
                    <li key={index}>{reason.rule}：{reason.matched}</li>
                  ))}
                </ul>
              </div>
            )}

            <section className="score-section" aria-labelledby="score-title">
              <div className="subheading">
                <h3 id="score-title">建议跟进度</h3>
                <strong>{selected.score}<small>/100</small></strong>
              </div>
              <div className="score-bars">
                {selected.breakdown.map((item) => (
                  <div className="score-row" key={item.label}>
                    <span>{item.label}</span>
                    <div className="bar-track" aria-hidden="true">
                      <span style={{ width: `${item.value}%` }} />
                    </div>
                    <strong>{item.value}</strong>
                  </div>
                ))}
              </div>
              <p className="method-note">
                评分由增速、跨源信号、行业相关性和内容安全共同计算（置信度：{confidenceLabel(selected.scoreConfidence)}）；
                这是决策辅助，不是事实结论。
              </p>
            </section>

            <section className="source-section" aria-labelledby="source-title">
              <div className="subheading">
                <h3 id="source-title">来源证据</h3>
                <span>{detail?.sources.length ?? selected.sourceCount} 条</span>
              </div>
              <ul>
                {(detail?.sources ?? []).map((source) => (
                  <li key={source.id}>
                    <span className="source-initial" aria-hidden="true">{source.provider.slice(0, 1)}</span>
                    <span>
                      <strong>{source.provider}</strong>
                      <small>{licenseLabel(source.licenseStatus)} · {formatTime(source.collectedAt)}</small>
                    </span>
                    {source.sourceUrl && <a href={source.sourceUrl} target="_blank" rel="noreferrer">打开</a>}
                  </li>
                ))}
              </ul>
            </section>

            <div className="status-row" aria-label="跟进状态">
              {STATUS_ACTIONS.map((action) => (
                <button
                  key={action.value}
                  type="button"
                  className={`button ${selected.userStatus === action.value ? "primary" : "secondary"} small`}
                  disabled={!canEdit}
                  onClick={() => void setUserStatus(selected.id, action.value)}
                >
                  {selected.userStatus === action.value ? `已${action.label}` : action.label}
                </button>
              ))}
            </div>

            <div className="detail-actions">
              <button
                className="button primary full"
                type="button"
                disabled={!canGenerate || generating || !canEdit}
                onClick={() => void generate()}
              >
                {generating ? "正在生成…" : canGenerate ? "生成安全内容包" : "该议题禁止借势"}
              </button>
            </div>
            {!canGenerate && (
              <p className="blocked-note" role="status">
                {selected.risk === "blocked"
                  ? "系统判定为禁止跟进类别，已拒绝生成营销内容（FR-04）。"
                  : "该议题风险较高，不生成营销借势文案；请改为事实核验或放弃跟进。"}
              </p>
            )}
          </>
        )}
      </aside>
    </section>
  );
}

function formatTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const diff = Date.now() - date.getTime();
  if (diff < 60 * 1000) return "刚刚";
  if (diff < 60 * 60 * 1000) return `${Math.floor(diff / 60000)} 分钟前`;
  if (diff < 24 * 60 * 60 * 1000) return `${Math.floor(diff / 3600000)} 小时前`;
  return date.toLocaleString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

function licenseLabel(status: string): string {
  switch (status) {
    case "authorized":
      return "授权接口";
    case "customer_import":
      return "客户导入";
    default:
      return "模拟数据";
  }
}

function confidenceLabel(confidence: "low" | "medium" | "high"): string {
  return confidence === "high" ? "高" : confidence === "medium" ? "中" : "低（数据不足）";
}
