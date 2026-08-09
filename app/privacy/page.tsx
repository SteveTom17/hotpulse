import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "隐私政策",
  description: "HotPulse 热点内容作战台隐私政策。",
};

export default function PrivacyPage() {
  return (
    <main className="legal-page">
      <Link className="back-link" href="/">← 返回首页</Link>
      <h1>HotPulse 隐私政策</h1>
      <p className="legal-version">版本：2026-08-09-v1 · 生效日期：2026 年 8 月 9 日</p>

      <section>
        <h2>1. 我们收集什么</h2>
        <p>我们仅收集达成产品目的所需的数据，包括：</p>
        <ul>
          <li><strong>身份信息</strong>：来自组织身份系统（Cloudflare Access）的用户标识、邮箱与显示名称，用于授权与审计留痕；</li>
          <li><strong>工作区数据</strong>：你创建的工作区、品牌资料、热点与来源、生成的内容草案、审批记录与审计日志；</li>
          <li><strong>用量数据</strong>：内容生成、导出与连接器同步等动作的类型、数量与时间；</li>
          <li><strong>连接器配置</strong>：授权接口的地址、请求头与加密保存的密钥（AES-256-GCM 加密，不明文存储）。</li>
        </ul>
        <p>我们不收集：平台账号密码、Cookie 或访问令牌明文；未经你授权的第三方个人信息。</p>
      </section>

      <section>
        <h2>2. 我们如何使用</h2>
        <ul>
          <li>提供服务：热点研判、内容生成、审批导出、审计与计费；</li>
          <li>保证安全：身份识别、权限控制、风险阻断与滥用防护；</li>
          <li>改进服务：在去标识化后的聚合层面分析使用情况。</li>
        </ul>
        <p>我们不会出售你的个人数据，不会用于与你无关的广告定向。</p>
      </section>

      <section>
        <h2>3. 数据存储与安全</h2>
        <p>
          数据存储于 Cloudflare D1 数据库（Worker 环境）。凭据与密钥加密保存；所有访问通过
          组织身份校验并按工作区角色授权。我们按最小权限原则配置管理员，任何审计动作可追溯。
        </p>
      </section>

      <section>
        <h2>4. 数据保留与删除</h2>
        <p>
          只要工作区有效，核心业务数据（热点、内容包、审计）按运营需要保留。你可以：
        </p>
        <ul>
          <li>导出你的数据：通过“账户”设置提交数据导出请求；</li>
          <li>删除你的数据：在“账户”设置中申请删除账户及关联工作区数据；</li>
          <li>撤销连接器：随时停用或删除授权连接器及其加密凭据。</li>
        </ul>
      </section>

      <section>
        <h2>5. 租户隔离</h2>
        <p>
          客户数据按工作区（租户）隔离，成员只可访问其被授权的工作区。热点、品牌资料、
          内容包与审计日志不会跨工作区展示。
        </p>
      </section>

      <section>
        <h2>6. AI 内容标识</h2>
        <p>
          生成内容全部标记为“AI 草案”，并在导出包（manifest.json）中保留 AI 标识说明与版本信息；
          你对外发布时应按适用平台规则标注 AI 生成或辅助创作。
        </p>
      </section>

      <section>
        <h2>7. 第三方服务</h2>
        <p>
          我们可能调用经评估的第三方模型或数据服务（如 DeepSeek 模型网关、授权数据供应商）。
          调用仅传输完成任务所需的最小字段（如热点摘要与品牌事实），并遵循其数据处理条款。
          第三方故障时我们提供降级提示，不擅自以其他方式替代数据来源。
        </p>
      </section>

      <section>
        <h2>8. 未成年人</h2>
        <p>本服务面向商业运营人员，不面向未成年人；我们不会有意收集未成年人个人信息。</p>
      </section>

      <section>
        <h2>9. 政策更新与联系我们</h2>
        <p>
          政策更新时，我们会要求你确认最新版本。对本政策有疑问，可通过产品内“支持”入口或
          公开支持邮箱联系我们；你有权要求查阅、更正、导出与删除你的数据。
        </p>
      </section>
    </main>
  );
}
