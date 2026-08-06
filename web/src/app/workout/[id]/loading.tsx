import { DetailScaffold } from "@/components/DetailScaffold";
import { SkeletonDetailBody } from "@/components/skeletons";

/** See `session/[id]/loading.tsx` -- same reason, the live-Garmin twin of that route. */
export default function Loading() {
  return (
    <DetailScaffold backHref="/week">
      <SkeletonDetailBody />
    </DetailScaffold>
  );
}
