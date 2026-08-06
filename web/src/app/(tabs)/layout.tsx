import { TabBar } from "@/components/TabBar";
import { TabContentTransition } from "@/components/motion/RouteTransition";

export default function TabsLayout({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", minHeight: "100dvh" }}>
      <div style={{ flex: 1 }}>
        {/* Only the page body animates on a tab switch -- the TabBar sits outside so it
            stays put and keeps its pill morph (RouteTransition's `routeKey` note). */}
        <TabContentTransition>{children}</TabContentTransition>
      </div>
      <TabBar />
    </div>
  );
}
