import type { Metadata } from "next";
import { AppClient } from "./components/AppClient";

export const metadata: Metadata = {
  title: "热点作战台",
  description: "发现与品牌相关的热点，生成可核查、需审批的内容草案。",
};

export default function Home() {
  return <AppClient />;
}
