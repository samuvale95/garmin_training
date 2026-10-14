import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Passo",
    short_name: "Passo",
    description: "Il piano scritto una volta sola.",
    // A stable identity, so a later change of start_url doesn't make the installed app
    // a different app (and lose its notification permission).
    id: "/",
    start_url: "/",
    scope: "/",
    display: "standalone",
    display_override: ["standalone"],
    orientation: "portrait",
    background_color: "#ffffff",
    theme_color: "#ffffff",
    lang: "it",
    dir: "ltr",
    categories: ["health", "fitness", "sports"],
    // Long-press on the home-screen icon (Android, and iOS 17+ for installed apps).
    shortcuts: [
      { name: "Oggi", url: "/today", icons: [{ src: "/icon-192.png", sizes: "192x192" }] },
      { name: "Cosa mangiare", short_name: "Nutrizione", url: "/nutrition", icons: [{ src: "/icon-192.png", sizes: "192x192" }] },
      { name: "Settimana", url: "/week", icons: [{ src: "/icon-192.png", sizes: "192x192" }] },
    ],
    icons: [
      {
        src: "/icon-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icon-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icon-512-maskable.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
