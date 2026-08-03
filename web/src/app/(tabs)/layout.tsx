import { TabBar } from "@/components/TabBar";

export default function TabsLayout({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", minHeight: "100dvh" }}>
      <div style={{ flex: 1 }}>{children}</div>
      <TabBar />
    </div>
  );
}
