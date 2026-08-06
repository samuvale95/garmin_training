import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  // Consente al dev server di rispondere alle richieste provenienti da
  // dispositivi sulla stessa rete locale (es. telefono via QR code).
  allowedDevOrigins: ["192.168.*.*", "10.*.*.*", "172.16.*.*"],

  experimental: {
    // Route transitions run through React's <ViewTransition> (see RouteTransition.tsx).
    // The browser snapshots the outgoing screen and animates the two snapshots on the
    // compositor, so the incoming page's mount cost -- every screen here is a client
    // component that reads the query cache and localStorage on mount -- happens *before*
    // the animation starts instead of stalling it halfway through.
    viewTransition: true,
  },
};

export default nextConfig;
