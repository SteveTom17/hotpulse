"use client";

import { useState } from "react";
import { api, ApiError } from "./api";
import type { Session, WorkspaceSummary } from "./types";

/**
 * 工作区引导：第一个工作区创建（创建者即管理员）。
 * 创建后自动初始化品牌资料占位与 30 天免费试用订阅。
 */

const INDUSTRIES = [
  { value: "local_food", label: "本地生活 / 餐饮" },
  { value: "beauty", label: "美妆个护" },
  { value: "retail", label: "零售电商" },
  { value: "travel", label: "旅行消费" },
  { value: "other", label: "其他行业" },
];

export function WorkspaceSetup({
  session,
  onCreated,
}: {
  session: Session;
  onCreated: (workspace: WorkspaceSummary) => void;
}) {
  const [name, setName] = useState("");
  const [brandName, setBrandName] = useState("");
  const [industry, setIndustry] = useState("local_food");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  async function create() {
    if (!name.trim() || !brandName.trim()) return;
    setSubmitting(true);
    setError("");
    try {
      const result = await api.post<{ workspace: WorkspaceSummary }>("/api/workspaces", {
        name: name.trim(),
        brandName: brandName.trim(),
        industry,
      });
      onCreated({ ...result.workspace, role: "admin" });
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "创建失败，请稍后重试。");
      setSubmitting(false);
    }
  }

  return (
    <div className="gate-shell">
      <header className="gate-header">
        <div className="brand-lockup">
          <span className="brand-mark" aria-hidden="true">HP</span>
          <span><strong>HotPulse</strong><small>安全借势工作台</small></span>
        </div>
        <div className="gate-user">
          <span className="avatar" aria-hidden="true">{session.name.slice(0, 1)}</span>
          <div><strong>{session.name}</strong><small>{session.isDemo ? "演示账号" : session.email}</small></div>
        </div>
      </header>
      <main id="main-content" className="gate-main">
        <p className="eyebrow">开始之前</p>
        <h1>创建你的第一个工作区</h1>
        <p className="gate-copy">
          工作区是团队协作与数据隔离的单位：热点、品牌资料、内容包与审计日志只在工作区内可见。
          创建者自动成为管理员。
        </p>

        <div className="form-card">
          <label className="field">
            <span>工作区名称 <em>*</em></span>
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="例如：山见咖啡运营组"
              maxLength={60}
            />
          </label>
          <label className="field">
            <span>品牌名称 <em>*</em></span>
            <input
              value={brandName}
              onChange={(event) => setBrandName(event.target.value)}
              placeholder="用于内容生成与品牌资料"
              maxLength={60}
            />
          </label>
          <label className="field">
            <span>所属行业</span>
            <select value={industry} onChange={(event) => setIndustry(event.target.value)}>
              {INDUSTRIES.map((item) => (
                <option key={item.value} value={item.value}>{item.label}</option>
              ))}
            </select>
          </label>

          {error && <div className="error-banner" role="alert">{error}</div>}

          <button
            type="button"
            className="button primary full"
            disabled={!name.trim() || !brandName.trim() || submitting}
            onClick={create}
          >
            {submitting ? "正在创建…" : "创建并进入工作区"}
          </button>
          <p className="gate-note">
            新工作区赠送 30 天免费试用（30 个内容额度）。所有结果都必须人工确认后才能导出。
          </p>
        </div>
      </main>
    </div>
  );
}
