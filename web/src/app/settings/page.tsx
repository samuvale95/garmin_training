"use client";

import { dis } from "@/lib/disabled";
import { useState } from "react";
import { useMounted } from "@/lib/hydration";
import { isTrackingEnabled, setTrackingEnabled } from "@/lib/tracker";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Avatar } from "@/components/Avatar";
import { RefreshButton } from "@/components/RefreshButton";
import { WorkspaceHeading } from "@/components/Workspace";
import { Badge, RowLink, Section } from "@/components/ui";
import { useAthleteLevel, useClearPlan, useDisconnectGarmin, useDisconnectStrava, useGarminDevice, useGarminStatus, usePlanQuery, useResetAllLocalData, useStravaStatus } from "@/lib/queries";
import { useAthleteIdentity } from "@/lib/identity";
import { useIsAdmin } from "@/lib/agents";
import { signOut } from "@/lib/auth";
import { usePassoStore } from "@/lib/store";
import { downloadEnrichedPlanYaml, downloadPlanYaml } from "@/lib/planYaml";
import { countdownLabel, goalTitle } from "@/lib/raceGoal";
import { minutesAgo } from "@/lib/format";
import { useScreenReady } from "@/lib/useScreenReady";

export default function SettingsPage() {
  // Every section renders from the first paint; the Garmin/Strava rows fill in place.
  useScreenReady(true);
  const router = useRouter();
  const { data: garminStatus } = useGarminStatus();
  const { data: device } = useGarminDevice(garminStatus?.connected ?? false);
  const disconnect = useDisconnectGarmin();
  const { data: stravaStatus } = useStravaStatus();
  const disconnectStrava = useDisconnectStrava();
  const { data: plan } = usePlanQuery();
  const { data: athleteLevel } = useAthleteLevel();
  const identity = useAthleteIdentity();
  const { data: isAdmin } = useIsAdmin();
  const prefs = usePassoStore((s) => s.prefs);
  const setPref = usePassoStore((s) => s.setPref);
  const profile = usePassoStore((s) => s.profile);
  const setProfile = usePassoStore((s) => s.setProfile);
  const clearPlan = useClearPlan();
  const resetAllLocalData = useResetAllLocalData();
  const [confirmReset, setConfirmReset] = useState(false);
  // Read after mount: localStorage is not there during the server render.
  const mounted = useMounted();
  const [trackingChoice, setTrackingChoice] = useState<boolean | null>(null);
  const tracking = trackingChoice ?? (mounted ? isTrackingEnabled() : true);
  function changeTracking(enabled: boolean) {
    setTrackingEnabled(enabled);
    setTrackingChoice(enabled);
  }

  function handleReset() {
    if (!confirmReset) {
      setConfirmReset(true);
      return;
    }
    resetAllLocalData();
    // A hard navigation, not router.push: guarantees every in-memory bit of app state
    // (Zustand's store included) reinitializes from scratch, not just the storage
    // that backs it -- the whole point of this button is "no doubt left anywhere".
    window.location.href = "/";
  }

  const garminLine = garminStatus?.connected
    ? garminStatus.session_expires_in_days != null
      ? `Collegato · accesso valido ancora ${garminStatus.session_expires_in_days} giorni`
      : "Collegato"
    : "Non collegato";

  return (
    <div className="page" data-width="reading">
      <WorkspaceHeading title="Profilo" description="Account, connessioni, parametri e preferenze." />

      <div className="stack-lg">
        <Section title="Account" id="profile-account">
          <div className="card" style={{ display: "flex", alignItems: "center", gap: 14 }}>
            <Avatar size={48} />
            <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 6 }}>
              {identity.source === "strava" || identity.source === "garmin" ? (
                <p style={{ margin: 0 }}>
                  <strong style={{ fontSize: "var(--text-lg)" }}>{identity.name}</strong>
                  <span className="muted" style={{ fontSize: "var(--text-sm)" }}> · nome da {identity.source === "strava" ? "Strava" : "Garmin"}</span>
                </p>
              ) : (
                <label className="field">
                  Nome
                  <input value={profile.name} onChange={(e) => setProfile({ ...profile, name: e.target.value })} placeholder="Il tuo nome" autoComplete="name" />
                </label>
              )}
              <label className="field">
                Email
                <input type="email" value={profile.email} onChange={(e) => setProfile({ ...profile, email: e.target.value })} placeholder="nome@esempio.it" autoComplete="email" />
              </label>
            </div>
          </div>
        </Section>

        <Section title="Connessioni" id="profile-connections">
          <ul className="list">
            <li>
              <div className="row">
                <span className="row-main">
                  <span className="row-title">Garmin Connect</span>
                  <span className="row-meta">
                    {garminLine}
                    {garminStatus?.connected && device?.device_name && ` · ${device.device_name}`}
                    {garminStatus?.connected && device?.last_synced_at && `, ultima acquisizione ${minutesAgo(device.last_synced_at)} min fa`}
                  </span>
                </span>
                <span className="row-end">
                  <Badge tone={garminStatus?.connected ? "ok" : "warn"}>{garminStatus?.connected ? "Attivo" : "Da collegare"}</Badge>
                  {garminStatus?.connected ? (
                    <button type="button" className="btn" data-size="sm" data-variant="quiet" data-track="settings.disconnect-mutate" onClick={() => disconnect.mutate(undefined, { onSuccess: () => router.push("/connect-garmin") })} {...dis(disconnect.isPending, "in_caricamento")}>
                      Scollega
                    </button>
                  ) : (
                    <Link className="btn" data-size="sm" href="/connect-garmin" data-track="settings.connect-garmin">Collega</Link>
                  )}
                </span>
              </div>
            </li>
            <li>
              <div className="row">
                <span className="row-main">
                  <span className="row-title">Strava</span>
                  <span className="row-meta">{stravaStatus?.connected ? "Collegato · attività e scarpe" : "Facoltativo · aggiunge attività e usura delle scarpe"}</span>
                </span>
                <span className="row-end">
                  <Badge tone={stravaStatus?.connected ? "ok" : "neutral"}>{stravaStatus?.connected ? "Attivo" : "Non collegato"}</Badge>
                  {stravaStatus?.connected ? (
                    <button type="button" className="btn" data-size="sm" data-variant="quiet" data-track="settings.disconnectstrava-mutate" onClick={() => disconnectStrava.mutate()} {...dis(disconnectStrava.isPending, "in_caricamento")}>
                      Scollega
                    </button>
                  ) : (
                    <Link className="btn" data-size="sm" href="/connect-strava" data-track="settings.connect-strava">Collega</Link>
                  )}
                </span>
              </div>
            </li>
            <li>
              <div className="row" style={{ flexWrap: "wrap" }}>
                <span className="row-main" style={{ minWidth: 200 }}>
                  <span className="row-title">Aggiorna dati</span>
                  <span className="row-meta">Acquisisce di nuovo attività e valori da Garmin e Strava. Non invia nulla all’orologio.</span>
                </span>
                <span className="row-end"><RefreshButton /></span>
              </div>
            </li>
          </ul>
        </Section>

        <Section title="Atleta e attrezzatura" id="profile-athlete">
          <ul className="list">
            <li><RowLink href="/settings/body" track="settings.settings-body" title="Il tuo corpo" meta="Peso, altezza ed età, usati per le indicazioni" /></li>
            <li><RowLink href="/settings/level" track="settings.settings-level" title="Livello" meta={athleteLevel ? `Livello ${athleteLevel.level}${athleteLevel.level_name ? ` · ${athleteLevel.level_name}` : ""}` : "Da abitudine ad atleta"} /></li>
            <li><RowLink href="/week/goals" track="settings.settings-goal" title="Obiettivi" meta={plan?.goal ? `${goalTitle(plan.goal)} · ${countdownLabel(plan.goal)}` : "Gara, prestazione, forza o costanza"} /></li>
            <li><RowLink href="/shoes?from=/settings" track="settings.shoes-from-settings" title="Scarpe" meta="Chilometri e usura, da Strava" /></li>
            {isAdmin?.is_admin && <li><RowLink href="/settings/agents" track="settings.settings-agents" title="Agenti" meta="Proposte, esecuzioni e budget" /></li>}
          </ul>
        </Section>

        <Section title="Preferenze" id="profile-prefs">
          <ul className="list">
            <li><Toggle label="Avvisami se il corpo non regge" hint="Un avviso accanto alla seduta quando i valori del mattino sono bassi." checked={prefs.avvisamiSeIlCorpoNonRegge} onChange={(v) => setPref("avvisamiSeIlCorpoNonRegge", v)} /></li>
            <li><Toggle label="Chiedi prima di cancellare" checked={prefs.chiediPrimaDiCancellare} onChange={(v) => setPref("chiediPrimaDiCancellare", v)} /></li>
            <li><Toggle label="Meno movimento" hint="Riduce animazioni e transizioni." checked={prefs.menoMovimento} onChange={(v) => setPref("menoMovimento", v)} /></li>
            <li><Toggle label="Aiutaci a migliorare l’app" hint="Registra dove tocchi e dove l’app è lenta o sbaglia, mai quello che scrivi." checked={tracking} onChange={changeTracking} /></li>
          </ul>
        </Section>

        <Section title="Il file del piano" id="profile-file">
          <div className="card">
            <p className="card-text" style={{ marginTop: 0 }}>Ogni modifica fatta nell’app viene scritta anche nel file, che puoi scaricare quando vuoi.</p>
            <div className="actions">
              <button type="button" className="btn" data-size="sm" data-track="settings.plan" {...dis(!plan, "dati_non_caricati")} onClick={() => plan && downloadPlanYaml(plan.sessions, plan.filename ?? "piano.yaml", plan.goal)}>
                Scarica {plan?.filename ?? "il file YAML"}
              </button>
              <button type="button" className="btn" data-size="sm" data-track="settings.plan-enriched" {...dis(!plan, "dati_non_caricati")} onClick={() => plan && downloadEnrichedPlanYaml()}>
                Scarica con storico e carichi
              </button>
              <Link className="btn" data-size="sm" href="/week/programs/new?source=import" data-track="settings.import-plan">
                {plan ? "Importa un nuovo file" : "Importa un file"}
              </Link>
            </div>
          </div>
        </Section>

        <Section title="Ripristino e uscita" id="profile-danger">
          <div className="card">
            <p className="card-title">Ripristina i dati su questo dispositivo</p>
            <p className="card-text">
              Cancella piano, preferenze e dati salvati sul dispositivo. Garmin e Strava non vengono toccati: dopo il ripristino l’app riparte dal calendario Garmin.
            </p>
            <div className="actions">
              <button type="button" className="btn" data-variant={confirmReset ? "accent" : "danger"} data-track="settings.handlereset" onClick={handleReset}>
                {confirmReset ? "Conferma: cancella tutto" : "Ripristina tutto"}
              </button>
              {confirmReset && (
                <button type="button" className="btn" data-variant="quiet" data-track="settings.setconfirmreset" onClick={() => setConfirmReset(false)}>Annulla</button>
              )}
            </div>
          </div>
          <button
            type="button"
            className="btn"
            data-variant="danger"
            data-block
            style={{ marginTop: 16 }}
            data-track="settings.async"
            onClick={async () => {
              clearPlan();
              await signOut();
              window.location.href = "/login";
            }}
          >
            Esci da Passo
          </button>
        </Section>
      </div>
    </div>
  );
}

function Toggle({ label, hint, checked, onChange }: { label: string; hint?: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="switch-row" data-track="settings.toggle">
      <span style={{ display: "flex", flexDirection: "column", gap: 2 }}>
        <span>{label}</span>
        {hint && <span className="muted" style={{ fontSize: "var(--text-sm)" }}>{hint}</span>}
      </span>
      <input type="checkbox" role="switch" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span className="switch" data-on={checked} aria-hidden="true" />
    </label>
  );
}
