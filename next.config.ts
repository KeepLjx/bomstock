import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // 允许开发环境下的跨域请求
  allowedDevOrigins:[
    "localhost",
    "10.10.35.43",
  ],
  // 允许上传较大的 Excel 文件（库存表等可能较大）
  experimental: {
    serverActions: {
      bodySizeLimit: "60mb",
    },
  },
};

export default nextConfig;
