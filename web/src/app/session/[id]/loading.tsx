import { DetailScaffold } from "@/components/DetailScaffold";
import { SkeletonDetailBody } from "@/components/skeletons";

/** Shown while this route's code is still arriving (before any of its data fetching
 * begins). Without it, Next renders nothing for that window -- which on the detail
 * screens meant an empty near-black viewport. */
export default function Loading() {
  return (
    <DetailScaffold backHref="/week">
      <SkeletonDetailBody />
    </DetailScaffold>
  );
}
