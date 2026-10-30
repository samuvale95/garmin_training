"use client";
import { Suspense, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useScreenReady } from "@/lib/useScreenReady";
function ImportRedirect(){const router=useRouter();useScreenReady(true);useEffect(()=>{router.replace("/week/programs/new?source=import");},[router]);return <p className="ux-muted">Apro la bozza di importazione…</p>;}
export default function ImportPlanPage(){return <Suspense><ImportRedirect/></Suspense>;}
