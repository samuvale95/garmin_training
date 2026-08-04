import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  // Consente al dev server di rispondere alle richieste provenienti da
  // dispositivi sulla stessa rete locale (es. telefono via QR code).
  allowedDevOrigins: ["192.168.*.*", "10.*.*.*", "172.16.*.*"],
};

export default nextConfig;
