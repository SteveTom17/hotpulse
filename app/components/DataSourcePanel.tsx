"use client";

import { useCallback, useEffect, useState } from "react";
import { api, ApiError } from "./api";
import type { Connector } from "./types";

/**
 * 数据源管理（FR-02）：授权 HTTP API 连接器 + CSV 客户导入。
 * 凭据加密保存、指数退避、限流暂停；失败时界面显示“数据暂不可用”，不自动重试风暴。
 */

type ConnectorResult = { connectors: Connector[] };

export function DataSourcePanel({
  workspaceId,
  onToast,
}: {
  workspaceId: string;
  onToast: (message: string) => void;
}) {
  const [connectors, setConnectors] = useState<Connector[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({
    name: "",
    provider: "",
    licenseNote: "",
    url: "",
    headersJson: "",
    secretsJson: "",
    fieldMapJson: "",
    itemsPath: "",
    pageParam: "",
    pageSize: "20",
    maxPages: "1",
  });
  const [submitting, setSubmitting] = useState(false);
  const [runningId, setRunningId] = useState<string | null>(null);

  const [importing, setImporting] = useState(false);
  const [csvFile, setCsvFile] = useState<File | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const payload = await api.get<ConnectorResult>(`/api/workspaces/${workspaceId}/connectors`);
      setConnectors(payload.connectors);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "连接器加载失败。");
    } finally {
      setLoading(false);
    }
  }, [workspaceId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function createConnector() {
    let headers: Record<string, string> = {};
    let secrets: Record<string, string> = {};
    let fieldMap: Record<string, string> = {};
    try {
      headers = form.headersJson.trim() ? (JSON.parse(form.headersJson) as Record<string, string>) : {};
      secrets = form.secretsJson.trim() ? (JSON.parse(form.secretsJson) as Record<string, string>) : {};
      fieldMap = form.fieldMapJson.trim() ? (JSON.parse(form.fieldMapJson) as Record<string, string>) : {};
    } catch {
      setError("请求头 / 密钥 / 字段映射必须是合法的 JSON 对象。");
      return;
    }
    if (!fieldMap.title) {
      setError("字段映射必须包含 title（标题字段名），例如 {\"title\": \"name\"}。");
      return;
    }

    setSubmitting(true);
    setError("");
    try {
      const result = await api.post<{ notice: string }>(`/api/workspaces/${workspaceId}/connectors`, {
        name: form.name,
        kind: "http_api",
        provider: form.provider,
        licenseNote: form.licenseNote,
        config: {
          url: form.url,
          headers,
          secrets,
          itemsPath: form.itemsPath || undefined,
          fieldMap,
          pageParam: form.pageParam || undefined,
          pageSize: Number(form.pageSize),
          maxPages: Number(form.maxPages),
        },
      });
      onToast(result.notice);
      setShowForm(false);
      setForm({ name: "", provider: "", licenseNote: "", url: "", headersJson: "", secretsJson: "", fieldMapJson: "", itemsPath: "", pageParam: "", pageSize: "20", maxPages: "1" });
      void load();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "创建失败。");
    } finally {
      setSubmitting(false);
    }
  }

  async function runConnector(connectorId: string) {
    setRunningId(connectorId);
    setError("");
    try {
      const result = await api.post<{ notice: string }>(
        `/api/workspaces/${workspaceId}/connectors/${connectorId}`,
        {},
      );
      onToast(result.notice);
      void load();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "同步失败。");
      void load();
    } finally {
      setRunningId(null);
    }
  }

  async function importCsv() {
    if (!csvFile) return;
    setImporting(true);
    setError("");
    try {
      const formData = new FormData();
      formData.append("file", csvFile);
      const result = (await fetch(`/api/workspaces/${workspaceId}/trends/import`, {
        method: "POST",
        body: formData,
      }).then(async (response) => {
        const payload = (await response.json()) as { error?: string; notice?: string; imported?: number };
        if (!response.ok) throw new ApiError(response.status, "BAD_REQUEST", payload.error ?? "导入失败。", payload);
        return payload;
      })) as { notice: string; imported: number };
      onToast(`${result.notice}（导入 ${result.imported} 条，标记为“客户导入”）`);
      setCsvFile(null);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "导入失败，请检查 CSV 格式（UTF-8，含 title 列）。");
    } finally {
      setImporting(false);
    }
  }

  return (
    <section className="studio" aria-labelledby="datasource-title">
      <div className="section-heading">
        <div>
          <p className="eyebrow">只接入授权数据</p>
          <h2 id="datasource-title">数据源</h2>
        </div>
        <button className="button primary" type="button" onClick={() => setShowForm((v) => !v)}>
          {showForm ? "收起表单" : "新增授权 API 连接器"}
        </button>
      </div>

      <div className="compliance-note" role="note">
        平台只接入官方 API 或获得书面授权的供应商；系统不要求、不保存你的平台密码或 Cookie。
        连接器失败时按指数退避暂停，界面显示“数据暂不可用”，不会用爬虫绕过。
      </div>

      {error && <div className="error-banner" role="alert">{error}</div>}

      {showForm && (
        <div className="form-card">
          <h3>新增授权 HTTP API 连接器</h3>
          <div className="form-grid">
            <label className="field">
              <span>连接器名称 <em>*</em></span>
              <input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder="例如：官方热门榜单" maxLength={60} />
            </label>
            <label className="field">
              <span>供应商名称 <em>*</em></span>
              <input value={form.provider} onChange={(event) => setForm({ ...form, provider: event.target.value })} placeholder="例如：某平台官方开放平台" maxLength={80} />
            </label>
            <label className="field span-2">
              <span>授权说明（来源展示用）</span>
              <input value={form.licenseNote} onChange={(event) => setForm({ ...form, licenseNote: event.target.value })} placeholder="例如：已获书面授权，配额 1000 次/日" maxLength={500} />
            </label>
            <label className="field span-2">
              <span>请求地址 <em>*</em></span>
              <input value={form.url} onChange={(event) => setForm({ ...form, url: event.target.value })} placeholder="https://api.example.com/trends" />
            </label>
            <label className="field">
              <span>字段映射 <em>*</em>（JSON）</span>
              <textarea value={form.fieldMapJson} onChange={(event) => setForm({ ...form, fieldMapJson: event.target.value })} rows={3} placeholder='{"title": "name", "summary": "desc", "category": "type"}' />
            </label>
            <label className="field">
              <span>请求头（JSON，不含密钥）</span>
              <textarea value={form.headersJson} onChange={(event) => setForm({ ...form, headersJson: event.target.value })} rows={3} placeholder='{"Accept": "application/json"}' />
            </label>
            <label className="field">
              <span>密钥占位（JSON，加密保存）</span>
              <textarea value={form.secretsJson} onChange={(event) => setForm({ ...form, secretsJson: event.target.value })} rows={3} placeholder='{"secret": "Bearer xxx"}' />
            </label>
            <label className="field">
              <span>数据路径（可选，如 data.items）</span>
              <input value={form.itemsPath} onChange={(event) => setForm({ ...form, itemsPath: event.target.value })} placeholder="data.items" />
            </label>
            <label className="field">
              <span>分页参数名（可选）</span>
              <input value={form.pageParam} onChange={(event) => setForm({ ...form, pageParam: event.target.value })} placeholder="page" />
            </label>
            <label className="field">
              <span>每页条数</span>
              <input type="number" min={1} max={100} value={form.pageSize} onChange={(event) => setForm({ ...form, pageSize: event.target.value })} />
            </label>
            <label className="field">
              <span>最大页数</span>
              <input type="number" min={1} max={20} value={form.maxPages} onChange={(event) => setForm({ ...form, maxPages: event.target.value })} />
            </label>
          </div>
          <button className="button primary" type="button" disabled={submitting || !form.name || !form.provider || !form.url} onClick={() => void createConnector()}>
            {submitting ? "创建中…" : "创建连接器"}
          </button>
          <p className="gate-note">密钥使用 AES-256-GCM 加密存储；生产环境必须配置 CONNECTOR_SECRET_KEY。</p>
        </div>
      )}

      <div className="section-heading">
        <div><h3>已配置连接器（{connectors.length}）</h3></div>
      </div>

      {loading ? (
        <div className="empty-state"><strong>正在加载…</strong></div>
      ) : connectors.length === 0 ? (
        <div className="empty-state">
          <strong>还没有连接器</strong>
          <p>可创建授权 HTTP API 连接器，或使用下方 CSV 导入（标注“客户导入”）。</p>
        </div>
      ) : (
        <div className="connector-list">
          {connectors.map((connector) => (
            <article className="connector-card" key={connector.id}>
              <div>
                <strong>{connector.name}</strong>
                <small>{connector.provider} · {connector.kind === "http_api" ? "HTTP API" : "CSV 导入"} · {connector.enabled ? "已启用" : "已停用"}</small>
                {connector.licenseNote && <p>{connector.licenseNote}</p>}
              </div>
              <span className={`connector-status ${connector.status}`}>{statusLabel(connector.status)}</span>
              <div className="connector-meta">
                {connector.lastRunAt && <small>上次同步：{formatTime(connector.lastRunAt)}</small>}
                {connector.backoffUntil && <small className="attention">退避中，{formatTime(connector.backoffUntil)} 前不重试</small>}
                {connector.rateLimitResetAt && <small className="attention">限流暂停至 {formatTime(connector.rateLimitResetAt)}</small>}
                {connector.lastError && <small className="attention">最近错误：{connector.lastError.slice(0, 120)}</small>}
              </div>
              <button
                className="button secondary small"
                type="button"
                disabled={runningId === connector.id}
                onClick={() => void runConnector(connector.id)}
              >
                {runningId === connector.id ? "同步中…" : "立即同步"}
              </button>
            </article>
          ))}
        </div>
      )}

      <div className="section-heading">
        <div><h3>CSV 客户导入（标注“客户导入”）</h3></div>
      </div>
      <div className="form-card">
        <p className="gate-copy">
          适用于你已获授权的自有数据：CSV 需为 UTF-8 编码，包含 title 列（必填）与可选的 summary / category / heat 列；
          每行不得超过 2000 字符，单次最多 500 行。导入结果保留原始标题与来源标记，不覆盖已有热点。
        </p>
        <div className="import-row">
          <label className="field">
            <span className="sr-only">选择 CSV 文件</span>
            <input
              type="file"
              accept=".csv,text/csv"
              onChange={(event) => setCsvFile(event.target.files?.[0] ?? null)}
            />
          </label>
          <button className="button primary" type="button" disabled={!csvFile || importing} onClick={() => void importCsv()}>
            {importing ? "导入中…" : "导入 CSV"}
          </button>
        </div>
      </div>
    </section>
  );
}

function statusLabel(status: string): string {
  switch (status) {
    case "running":
      return "同步中";
    case "success":
      return "最近成功";
    case "error":
      return "最近失败";
    case "paused":
      return "已暂停（数据暂不可用）";
    default:
      return "待命";
  }
}

function formatTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });
}
