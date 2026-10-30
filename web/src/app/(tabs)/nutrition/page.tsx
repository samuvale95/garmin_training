import { Suspense } from "react";
import { NutritionView } from "@/components/tabs-views/NutritionView";
import { Skeleton } from "@/components/motion/primitives";
export default function NutritionTabPage() { return <Suspense fallback={<Skeleton height={220} />}><NutritionView /></Suspense>; }
