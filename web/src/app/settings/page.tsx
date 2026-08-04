"use client";

import { useRouter } from "next/navigation";
import { BrandMark } from "@/components/motion/BrandMark";
import { PageHeader } from "@/components/PageHeader";
import { StatusDot } from "@/components/motion/primitives";
import { useGarminStatus } from "@/lib/queries";
import { usePassoStore } from "@/lib/store";
import { downloadPlanYaml } from "@/lib/planYaml";

export default function SettingsPage() {
  const router = useRouter();
  const { data: garminStatus } = useGarminStatus();
  const plan = usePassoStore((s) => s.plan);
  const prefs = usePassoStore((s) => s.prefs);
  const setPref = usePassoStore((s) => s.setPref);
  const clearPlan = usePassoStore((s) => s.clearPlan);

  return (
    <div style={{ padding: "24px 22px 40px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <PageHeader />
        <BrandMark height={22} />
      </div>
      <h1 style={{ font: "600 28px/1.06 var(--font-outfit)", letterSpacing: "-.03em", margin: "18px 0 16px" }}>Impostazioni</h1>

      <Card>
        <p style={{ fontWeight: 600, margin: "0 0 4px" }}>Connessioni</p>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 10 }}>
          <StatusDot kind={garminStatus?.connected ? "active" : "error"} />
          <span style={{ fontSize: 14, flex: 1 }}>Garmin</span>
          <span style={{ fontSize: 12, color: "var(--inchiostro-50)" }}>
            {garminStatus?.connected ? "sessione attiva" : "non collegato"}
          </span>
        </div>
        {!garminStatus?.connected && (
          <button
            type="button"
            onClick={() => router.push("/connect-garmin")}
            className="tap-target"
            style={{ marginTop: 10, background: "none", border: "none", color: "var(--rosso-avviso)", fontSize: 13, fontWeight: 600, cursor: "pointer", padding: 0 }}
          >
            Collega ora
          </button>
        )}
      </Card>

      <Card>
        <p style={{ fontWeight: 600, margin: "0 0 4px" }}>Preferenze</p>
        <Toggle label="Avvisami se il corpo non regge" checked={prefs.avvisamiSeIlCorpoNonRegge} onChange={(v) => setPref("avvisamiSeIlCorpoNonRegge", v)} />
        <Toggle label="Chiedi prima di cancellare" checked={prefs.chiediPrimaDiCancellare} onChange={(v) => setPref("chiediPrimaDiCancellare", v)} />
        <Toggle label="Meno movimento" checked={prefs.menoMovimento} onChange={(v) => setPref("menoMovimento", v)} />
      </Card>

      <div style={{ background: "var(--azzurro)", color: "var(--azzurro-testo)", borderRadius: "var(--radius-card)", padding: 18, marginTop: 12 }}>
        <p style={{ fontWeight: 600, margin: "0 0 8px" }}>Il file resta la verità</p>
        <button
          type="button"
          disabled={!plan}
          onClick={() => plan && downloadPlanYaml(plan.sessions, plan.filename ?? "piano.yaml")}
          className="tap-target"
          style={{
            background: "var(--azzurro-testo)",
            color: "var(--crema)",
            border: "none",
            borderRadius: "var(--radius-pill)",
            padding: "10px 18px",
            fontSize: 13,
            fontWeight: 600,
            cursor: plan ? "pointer" : "default",
            opacity: plan ? 1 : 0.5,
          }}
        >
          Scarica il YAML
        </button>
      </div>

      <button
        type="button"
        onClick={() => {
          clearPlan();
          router.push("/");
        }}
        className="tap-target"
        style={{ display: "block", width: "100%", background: "none", border: "none", color: "var(--rosso-forte)", fontSize: 14, fontWeight: 600, marginTop: 24, cursor: "pointer" }}
      >
        Esci da Passo
      </button>
    </div>
  );
}

function Card({ children }: { children: React.ReactNode }) {
  return <div style={{ background: "var(--crema-card)", borderRadius: "var(--radius-card)", padding: 16, marginTop: 12 }}>{children}</div>;
}

function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 0", cursor: "pointer" }}>
      <span style={{ fontSize: 14 }}>{label}</span>
      <span
        onClick={() => onChange(!checked)}
        style={{
          width: 44,
          height: 26,
          borderRadius: 100,
          background: checked ? "var(--inchiostro)" : "var(--sabbia-bordo)",
          position: "relative",
          transition: "background 180ms var(--ease)",
          flex: "none",
        }}
      >
        <span
          className={checked ? "anim-dot-pulse" : undefined}
          style={{
            position: "absolute",
            top: 3,
            left: checked ? 21 : 3,
            width: 20,
            height: 20,
            borderRadius: "50%",
            background: "var(--crema)",
            transition: "left 180ms var(--ease)",
          }}
        />
      </span>
    </label>
  );
}
