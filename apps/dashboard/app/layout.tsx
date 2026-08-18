import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "智慧风电数字孪生可视化大屏",
  description: "区域、风场与单机三级智慧风电数字孪生可视化系统。",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
