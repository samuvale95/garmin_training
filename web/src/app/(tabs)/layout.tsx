import { TabBar } from "@/components/TabBar";
import { Workspace } from "@/components/Workspace";
import { HistorySync } from "@/components/HistorySync";

export default function TabsLayout({ children }: { children: React.ReactNode }) {
  return (
    <Workspace navigation={<TabBar />}>
      {children}
      <HistorySync />
    </Workspace>
  );
}
