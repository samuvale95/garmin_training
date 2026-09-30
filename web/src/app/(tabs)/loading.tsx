import { SkeletonDayCards } from "@/components/skeletons";
import { ClayLoader } from "@/components/motion/ClayLoader";

/** Shown while a tab's route code is still arriving. Includes 3D clay loader and skeleton cards. */
export default function Loading() {
  return (
    <div style={{ padding: "22px 20px 12px", display: "flex", flexDirection: "column", gap: 16 }}>
      <ClayLoader label="Carico i tuoi dati..." size={48} />
      <SkeletonDayCards count={4} />
    </div>
  );
}
