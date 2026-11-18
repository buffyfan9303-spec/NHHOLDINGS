import type { NextConfig } from "next";
const config: NextConfig = {
  serverExternalPackages: ["@electric-sql/pglite", "pg", "exceljs"],
  poweredByHeader: false,
  outputFileTracingIncludes: {'/*':['./db/supabase-ca.crt','./src/server/dashboard.html','./src/server/personal.html']},
  async redirects() {
    // 정확히 /one만 대시보드로 보낸다. /one/*는 public/one 정적 자산이라 건드리지 않는다.
    return [{ source: "/one", destination: "/dashboard", permanent: true }];
  },
  async headers() {
    return [{ source: "/:path*", headers: [
      {key:"X-Content-Type-Options",value:"nosniff"},
      {key:"Referrer-Policy",value:"strict-origin-when-cross-origin"},
      {key:"X-Frame-Options",value:"DENY"},
      {key:"Permissions-Policy",value:"camera=(), microphone=(), geolocation=()"}
    ]}, {
      source: "/dashboard",
      headers: [{key:"Permissions-Policy",value:"camera=(), microphone=(self), geolocation=()"}]
    }, {
      source: "/one/operator-sw.js",
      headers: [
        {key:"Service-Worker-Allowed",value:"/dashboard"},
        {key:"Cache-Control",value:"no-cache"}
      ]
    }];
  }
};
export default config;
