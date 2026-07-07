import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = {
  title: "BOM 库存匹配",
  description: "BOM 库存匹配与供料方式判定",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="zh-CN">
      <body className="bg-white text-[#202124] antialiased">{children}</body>
    </html>
  );
}
