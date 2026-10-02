import { TabBar } from "@/components/TabBar";
import { TabsPager } from "@/components/TabsPager";
import { HistorySync } from "@/components/HistorySync";

export default function TabsLayout({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", minHeight: "100dvh" }}>
      <div style={{ flex: 1, display: "flex", flexDirection: "column" }}>
        {/* Continuous 3-panel horizontal track with 1:1 tactile swipe between Oggi, Settimana and Corpo */}
        <TabsPager>{children}</TabsPager>
      </div>
      <TabBar />
      <HistorySync />
    </div>
  );
}
