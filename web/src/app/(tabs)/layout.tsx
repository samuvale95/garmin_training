import { TabBar } from "@/components/TabBar";
import { SwipeableTabContainer } from "@/components/SwipeableTabContainer";
import { HistorySync } from "@/components/HistorySync";

export default function TabsLayout({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", minHeight: "100dvh" }}>
      <div style={{ flex: 1, display: "flex", flexDirection: "column" }}>
        {/* Swiping between Oggi, Settimana and Corpo navigates smoothly with tactile spring animation */}
        <SwipeableTabContainer>{children}</SwipeableTabContainer>
      </div>
      <TabBar />
      <HistorySync />
    </div>
  );
}
