import { SkeletonDayCards } from "@/components/skeletons";

/** Shown while a tab's route code is still arriving. Deliberately generic -- the three
 * tabs are all a title plus a stack of cards, so one shape covers them without claiming
 * anything about which tab is about to appear. */
export default function Loading() {
  return (
    <div style={{ padding: "22px 20px 12px" }}>
      <SkeletonDayCards count={5} />
    </div>
  );
}
