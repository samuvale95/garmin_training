"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Avatar } from "@/components/Avatar";
import { BrandMark } from "@/components/motion/BrandMark";
import { PageHeader } from "@/components/PageHeader";
import { StatusDot } from "@/components/motion/primitives";
import { useDisconnectGarmin, useDisconnectStrava, useGarminDevice, useGarminStatus, useStravaStatus } from "@/lib/queries";
import { usePassoStore } from "@/lib/store";
import { downloadPlanYaml } from "@/lib/planYaml";
import { minutesAgo } from "@/lib/format";

export default function SettingsPage() {
  const router = useRouter();
  const { data: garminStatus } = useGarminStatus();
  const { data: device } = useGarminDevice(garminStatus?.connected ?? false);
  const disconnect = useDisconnectGarmin();
  const { data: stravaStatus } = useStravaStatus();
  const disconnectStrava = useDisconnectStrava();
  const plan = usePassoStore((s) => s.plan);
  const prefs = usePassoStore((s) => s.prefs);
  const setPref = usePassoStore((s) => s.setPref);
  const profile = usePassoStore((s) => s.profile);
  const setProfile = usePassoStore((s) => s.setProfile);
  const clearPlan = usePassoStore((s) => s.clearPlan);

  return (
    <div style={{ padding: "24px 22px 40px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <PageHeader />
        <BrandMark height={22} />
      </div>
      <h1 style={{ font: "600 28px/1.06 var(--font-outfit)", letterSpacing: "-.03em", margin: "18px 0 16px" }}>Il tuo profilo</h1>

      <Card>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <Avatar size={40} />
          <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 8 }}>
            <input
              value={profile.name}
              onChange={(e) => setProfile({ ...profile, name: e.target.value })}
              placeholder="Il tuo nome"
              style={{ border: "none", background: "none", fontSize: 15, fontWeight: 600, padding: 0, outline: "none" }}
            />
            <input
              value={profile.email}
              onChange={(e) => setProfile({ ...profile, email: e.target.value })}
              placeholder="la tua email"
              style={{ border: "none", background: "none", fontSize: 12, color: "var(--inchiostro-50)", padding: 0, outline: "none" }}
            />
          </div>
        </div>
      </Card>

      <Card>
        <p style={{ fontWeight: 600, margin: "0 0 4px" }}>Connessioni</p>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 10 }}>
          <StatusDot kind={garminStatus?.connected ? "active" : "error"} />
          <span style={{ fontSize: 14, flex: 1 }}>Garmin Connect</span>
          <span style={{ fontSize: 12, color: "var(--inchiostro-50)" }}>
            {garminStatus?.connected
              ? garminStatus.session_expires_in_days != null
                ? `collegato · sessione valida per ${garminStatus.session_expires_in_days} giorni`
                : "collegato"
              : "non collegato"}
          </span>
        </div>
        {garminStatus?.connected ? (
          <button
            type="button"
            onClick={() => disconnect.mutate(undefined, { onSuccess: () => router.push("/connect-garmin") })}
            disabled={disconnect.isPending}
            className="tap-target"
            style={{ marginTop: 10, background: "none", border: "none", color: "var(--rosso-avviso)", fontSize: 13, fontWeight: 600, cursor: "pointer", padding: 0 }}
          >
            scollega
          </button>
        ) : (
          <button
            type="button"
            onClick={() => router.push("/connect-garmin")}
            className="tap-target"
            style={{ marginTop: 10, background: "none", border: "none", color: "var(--rosso-avviso)", fontSize: 13, fontWeight: 600, cursor: "pointer", padding: 0 }}
          >
            Collega ora
          </button>
        )}
        {garminStatus?.connected && device?.device_name && (
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 14, paddingTop: 12, borderTop: "1px solid var(--sabbia-bordo)" }}>
            <span style={{ fontSize: 14, flex: 1 }}>Orologio</span>
            <span style={{ fontSize: 12, color: "var(--inchiostro-50)" }}>
              {device.device_name}
              {device.last_synced_at && ` · sync ${minutesAgo(device.last_synced_at)} min fa`}
            </span>
          </div>
        )}

        <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 14, paddingTop: 12, borderTop: "1px solid var(--sabbia-bordo)" }}>
          <StatusDot kind={stravaStatus?.connected ? "active" : "error"} />
          <span style={{ fontSize: 14, flex: 1 }}>Strava</span>
          <span style={{ fontSize: 12, color: "var(--inchiostro-50)" }}>{stravaStatus?.connected ? "collegato" : "non collegato"}</span>
        </div>
        {stravaStatus?.connected ? (
          <button
            type="button"
            onClick={() => disconnectStrava.mutate()}
            disabled={disconnectStrava.isPending}
            className="tap-target"
            style={{ marginTop: 10, background: "none", border: "none", color: "var(--rosso-avviso)", fontSize: 13, fontWeight: 600, cursor: "pointer", padding: 0 }}
          >
            scollega Strava
          </button>
        ) : (
          <button
            type="button"
            onClick={() => router.push("/connect-strava")}
            className="tap-target"
            style={{ marginTop: 10, background: "none", border: "none", color: "var(--rosso-avviso)", fontSize: 13, fontWeight: 600, cursor: "pointer", padding: 0 }}
          >
            collega
          </button>
        )}
      </Card>

      <Card>
        <Link href="/shoes?from=/settings" style={{ textDecoration: "none", color: "inherit", display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ flex: 1 }}>
            <span style={{ fontWeight: 600, fontSize: 14, display: "block" }}>Scarpe</span>
            <span style={{ fontSize: 12, color: "var(--inchiostro-50)" }}>usura, da Strava</span>
          </span>
          <span aria-hidden="true">›</span>
        </Link>
      </Card>

      <Card>
        <p style={{ fontWeight: 600, margin: "0 0 4px" }}>Preferenze</p>
        <Toggle label="Avvisami se il corpo non regge" checked={prefs.avvisamiSeIlCorpoNonRegge} onChange={(v) => setPref("avvisamiSeIlCorpoNonRegge", v)} />
        <Toggle label="Chiedi prima di cancellare" checked={prefs.chiediPrimaDiCancellare} onChange={(v) => setPref("chiediPrimaDiCancellare", v)} />
        <Toggle label="Meno movimento" checked={prefs.menoMovimento} onChange={(v) => setPref("menoMovimento", v)} />
      </Card>

      <div style={{ background: "var(--azzurro)", color: "var(--azzurro-testo)", borderRadius: "var(--radius-card)", padding: 18, marginTop: 12 }}>
        <p style={{ fontWeight: 600, margin: "0 0 8px" }}>Il file resta la verità</p>
        <p className="font-serif-italic" style={{ fontSize: 13, margin: "0 0 12px" }}>
          Ogni modifica fatta dall&apos;app te la riscrivo dentro, e puoi riscaricarlo quando vuoi.
        </p>
        <button
          type="button"
          disabled={!plan}
          onClick={() => plan && downloadPlanYaml(plan.sessions, plan.filename ?? "piano.yaml")}
          className="tap-target"
          style={{
            background: "none",
            color: "var(--azzurro-testo)",
            border: "none",
            fontSize: 13,
            fontWeight: 700,
            padding: 0,
            cursor: plan ? "pointer" : "default",
            opacity: plan ? 1 : 0.5,
          }}
        >
          Scarica {plan?.filename ?? "il YAML"}
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
