"use client";
import { Suspense, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useScreenReady } from "@/lib/useScreenReady";
function LegacyFuel() { const params = useSearchParams(); const router = useRouter(); useScreenReady(true); useEffect(() => { router.replace(`/nutrition${params.size ? `?${params}` : ""}`); }, [params, router]); return <p className="ux-muted">Apro Nutrizione…</p>; }
export default function FuelPage() { return <Suspense><LegacyFuel /></Suspense>; }
