import type { Metadata } from "next";
import { headers } from "next/headers";
import "./globals.css";

export async function generateMetadata(): Promise<Metadata> {
  const requestHeaders = await headers();
  const host = requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host");
  const protocol = requestHeaders.get("x-forwarded-proto") ?? "http";
  const origin = host ? `${protocol}://${host}` : "http://localhost:3001";
  const previewImage = new URL("/og.png", origin).toString();

  return {
    title: {
      default: "HotPulse｜安全借势内容作战台",
      template: "%s｜HotPulse",
    },
    description:
      "面向本地生活品牌的热点研判、内容草案、人工审批与合规导出工作台。",
    openGraph: {
      title: "HotPulse｜值得跟进的，不只是热度。",
      description: "有来源、有风控、需审批的热点内容作战台。",
      type: "website",
      images: [{ url: previewImage, width: 1745, height: 909, alt: "HotPulse 安全借势内容作战台" }],
    },
    twitter: {
      card: "summary_large_image",
      title: "HotPulse｜值得跟进的，不只是热度。",
      description: "有来源、有风控、需审批的热点内容作战台。",
      images: [previewImage],
    },
  };
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
