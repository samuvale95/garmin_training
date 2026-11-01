import { HistorySync } from "@/components/HistorySync";

/** The frame (navigation, profile) lives in AppShell so it also surrounds details. */
export default function TabsLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      {children}
      <HistorySync />
    </>
  );
}
