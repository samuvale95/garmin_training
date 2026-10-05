"use client";

import { useState } from "react";
import { dis } from "@/lib/disabled";
import { PageHeader } from "@/components/PageHeader";
import { Skeleton } from "@/components/motion/primitives";
import { ApiError } from "@/lib/apiClient";
import { useSession } from "@/lib/auth";
import {
  useAddAdmin,
  useAdmins,
  useRemoveAdmin,
  useAgentProposals,
  useAgentRuns,
  useAgentsOverview,
  useDecideProposal,
  useIsAdmin,
  useRunAgent,
  useUpdateAgentSettings,
  type AgentProposal,
  type AgentRun,
  type ProposalStatus,
} from "@/lib/agents";
import { useScreenReady } from "@/lib/useScreenReady";

/** Screen "Agenti" (admin only): the switch, the budget, the proposal queue and the run
 * history. Agents only ever propose; every change goes through a decision here. */
export default function AgentsAdminPage() {
  const { data: me, isPending } = useIsAdmin();
  useScreenReady(!isPending);

  return (
    <div style={{ padding: "24px 22px 40px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <PageHeader backHref="/settings" />
        <span style={{ fontSize: 13, color: "var(--inchiostro-50)" }}>impostazioni</span>
      </div>
      <h1 style={{ font: "600 30px/1.06 var(--font-sans)", letterSpacing: "-.03em", margin: "16px 0 16px" }}>Agenti</h1>
      {isPending ? (
        <Skeleton height={160} radius={27} />
      ) : !me?.is_admin ? (
        <p className="font-serif-italic" style={{ fontSize: 14.5, color: "var(--inchiostro-70)" }}>
          Questa pagina è solo per chi amministra l&apos;app.
        </p>
      ) : (
        <>
          <ControlCard />
          <Proposals />
          <Runs />
          <Admins />
        </>
      )}
    </div>
  );
}

const card: React.CSSProperties = {
  background: "var(--crema-card)",
  border: "1px solid var(--border-airbnb)",
  borderRadius: 20,
  padding: 18,
  marginTop: 12,
  boxShadow: "var(--shadow-airbnb-subtle)",
};
const label: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 700,
  letterSpacing: ".06em",
  textTransform: "uppercase",
  color: "var(--inchiostro-50)",
};
const pill = (active: boolean): React.CSSProperties => ({
  border: "1px solid var(--border-airbnb)",
  borderRadius: "var(--radius-pill)",
  padding: "8px 14px",
  fontSize: 13,
  fontWeight: 600,
  background: active ? "var(--inchiostro)" : "transparent",
  color: active ? "var(--crema)" : "var(--inchiostro)",
  cursor: "pointer",
});

const usd = (value: number) => `${value.toFixed(2)} $`;

function ControlCard() {
  const { data, isPending } = useAgentsOverview();
  const update = useUpdateAgentSettings();
  const run = useRunAgent();
  if (isPending || !data) return <Skeleton height={140} radius={20} />;
  const { settings, agents } = data;
  const off = settings.hard_disabled || !settings.enabled;

  return (
    <div style={card} data-track="agents.control" data-interactive="false">
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
        <div>
          <p style={{ fontWeight: 600, margin: 0 }}>{off ? "Agenti spenti" : "Agenti attivi"}</p>
          <p style={{ fontSize: 12.5, color: "var(--inchiostro-50)", margin: "4px 0 0" }}>
            {settings.hard_disabled ? "Bloccati dal server (AGENTS_DISABLED)" : "Lo scheduler li fa girare solo se attivi"}
          </p>
        </div>
        <button
          type="button"
          data-track="agents.toggle"
          className="tap-target"
          {...dis(settings.hard_disabled || update.isPending, settings.hard_disabled ? "bloccato_dal_server" : "in_caricamento")}
          onClick={() => update.mutate({ enabled: !settings.enabled })}
          style={pill(settings.enabled)}
        >
          {settings.enabled ? "Spegni" : "Accendi"}
        </button>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginTop: 16 }}>
        <BudgetBox title="Oggi" spent={settings.spent_today_usd} cap={settings.daily_budget_usd} />
        <BudgetBox title="Questo mese" spent={settings.spent_month_usd} cap={settings.monthly_budget_usd} />
      </div>

      <div style={{ marginTop: 18 }}>
        <span style={label}>Agenti</span>
        {agents.map((agent) => (
          <div key={agent.name} style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 0", borderBottom: "1px solid var(--border-airbnb)" }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <p style={{ fontWeight: 600, fontSize: 14, margin: 0 }}>{agent.name}</p>
              <p style={{ fontSize: 12.5, color: "var(--inchiostro-50)", margin: "2px 0 0" }}>
                {agent.description} · {agent.schedule === "daily" ? "ogni giorno" : "ogni settimana"} · max {agent.max_steps} passi,{" "}
                {usd(agent.max_cost_per_run_usd)} a giro
              </p>
              <p style={{ fontSize: 12, color: "var(--inchiostro-35)", margin: "2px 0 0" }}>
                Ultimo giro riuscito: {agent.last_success ? formatWhen(agent.last_success) : "mai"}
              </p>
            </div>
            <button
              type="button"
              data-track="agents.run-now"
              className="tap-target"
              {...dis(off || run.isPending, off ? "agenti_spenti" : "in_caricamento")}
              onClick={() => run.mutate(agent.name)}
              style={{ ...pill(false), opacity: off ? 0.45 : 1 }}
            >
              Esegui ora
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

function BudgetBox({ title, spent, cap }: { title: string; spent: number; cap: number }) {
  const share = cap > 0 ? Math.min(1, spent / cap) : 1;
  return (
    <div style={{ background: "var(--sabbia)", borderRadius: 14, padding: 12 }}>
      <span style={label}>{title}</span>
      <p className="font-mono" style={{ fontSize: 15, margin: "6px 0 8px" }}>
        {usd(spent)} / {usd(cap)}
      </p>
      <div style={{ height: 4, borderRadius: 2, background: "var(--sabbia-bordo)" }}>
        <div style={{ width: `${share * 100}%`, height: 4, borderRadius: 2, background: share >= 1 ? "var(--corallo)" : "var(--inchiostro)" }} />
      </div>
    </div>
  );
}

const FILTERS: (ProposalStatus | "tutte")[] = ["nuova", "approvata", "realizzata", "scartata", "tutte"];
const CATEGORY_LABEL = { ui_config: "Config UI", code: "Codice", training_algorithm: "Algoritmo allenamento" } as const;

function Proposals() {
  const [filter, setFilter] = useState<ProposalStatus | "tutte">("nuova");
  const { data, isPending } = useAgentProposals(filter);

  return (
    <div style={{ marginTop: 26 }}>
      <span style={label}>Proposte</span>
      <div style={{ display: "flex", gap: 6, overflowX: "auto", margin: "10px 0 2px" }}>
        {FILTERS.map((f) => (
          <button key={f} type="button" data-track={`agents.filter-${f}`} className="tap-target" onClick={() => setFilter(f)} style={pill(f === filter)}>
            {f}
          </button>
        ))}
      </div>
      {isPending ? (
        <Skeleton height={100} radius={20} />
      ) : !data?.length ? (
        <p className="font-serif-italic" style={{ fontSize: 14, color: "var(--inchiostro-50)", margin: "12px 0 0" }}>
          Nessuna proposta {filter === "tutte" ? "" : `in stato “${filter}”`}.
        </p>
      ) : (
        data.map((proposal) => <ProposalCard key={proposal.id} proposal={proposal} />)
      )}
    </div>
  );
}

function ProposalCard({ proposal }: { proposal: AgentProposal }) {
  const decide = useDecideProposal();
  const [showEvidence, setShowEvidence] = useState(false);
  const busy = decide.isPending;
  const act = (status: ProposalStatus) => decide.mutate({ id: proposal.id, status });

  return (
    <div style={card} data-track="agents.proposal" data-interactive="false">
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", fontSize: 11.5, fontWeight: 600 }}>
        <Tag>{proposal.severity}</Tag>
        <Tag>{CATEGORY_LABEL[proposal.category]}</Tag>
        <Tag>confidenza {Math.round(proposal.confidence * 100)}%</Tag>
        <Tag>{proposal.agent}</Tag>
      </div>
      <p style={{ fontWeight: 600, fontSize: 15.5, margin: "10px 0 0" }}>{proposal.title}</p>
      <p style={{ fontSize: 14, color: "var(--inchiostro-70)", margin: "6px 0 0", lineHeight: 1.4 }}>{proposal.problem}</p>
      <p style={{ fontSize: 14, margin: "8px 0 0", lineHeight: 1.4 }}>
        <b>Proposta:</b> {proposal.proposal}
      </p>
      {(proposal.impact || proposal.effort) && (
        <p style={{ fontSize: 12.5, color: "var(--inchiostro-50)", margin: "6px 0 0" }}>
          Impatto {proposal.impact ?? "?"} · sforzo {proposal.effort ?? "?"}
        </p>
      )}
      {proposal.category === "training_algorithm" && (
        <p style={{ fontSize: 12.5, color: "var(--corallo-testo)", margin: "6px 0 0" }}>Tocca la salute dell&apos;atleta: va rivista a mano.</p>
      )}
      <button
        type="button"
        data-track="agents.proposal-evidence"
        onClick={() => setShowEvidence((v) => !v)}
        style={{ background: "none", border: "none", padding: 0, marginTop: 8, fontSize: 13, fontWeight: 600, color: "var(--inchiostro-50)", cursor: "pointer" }}
      >
        {showEvidence ? "Nascondi evidenze" : "Mostra evidenze"}
      </button>
      {showEvidence && <Json value={proposal.evidence} />}

      <div style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap" }}>
        {proposal.status === "nuova" && (
          <>
            <button type="button" data-track="agents.proposal-approve" className="tap-target" {...dis(busy, "in_caricamento")} onClick={() => act("approvata")} style={pill(true)}>
              Approva
            </button>
            <button type="button" data-track="agents.proposal-discard" className="tap-target" {...dis(busy, "in_caricamento")} onClick={() => act("scartata")} style={pill(false)}>
              Scarta
            </button>
          </>
        )}
        {proposal.status === "approvata" && (
          <button type="button" data-track="agents.proposal-done" className="tap-target" {...dis(busy, "in_caricamento")} onClick={() => act("realizzata")} style={pill(true)}>
            Segna realizzata
          </button>
        )}
        {proposal.status !== "nuova" && (
          <span style={{ fontSize: 12.5, color: "var(--inchiostro-50)", alignSelf: "center" }}>
            {proposal.status}
            {proposal.decided_at ? ` · ${formatWhen(proposal.decided_at)}` : ""}
          </span>
        )}
      </div>
    </div>
  );
}

const STATUS_LABEL: Record<string, string> = {
  running: "in corso",
  ok: "ok",
  failed: "fallito",
  aborted_steps: "fermato: troppi passi",
  aborted_budget: "fermato: budget",
  skipped_disabled: "saltato: spenti",
  skipped_budget: "saltato: budget",
  skipped_running: "saltato: già in corso",
};

function Runs() {
  const { data, isPending } = useAgentRuns();
  return (
    <div style={{ marginTop: 26 }}>
      <span style={label}>Esecuzioni</span>
      {isPending ? (
        <Skeleton height={100} radius={20} />
      ) : !data?.length ? (
        <p className="font-serif-italic" style={{ fontSize: 14, color: "var(--inchiostro-50)", margin: "10px 0 0" }}>
          Nessuna esecuzione ancora.
        </p>
      ) : (
        data.map((run) => <RunRow key={run.id} run={run} />)
      )}
    </div>
  );
}

function RunRow({ run }: { run: AgentRun }) {
  const [open, setOpen] = useState(false);
  const seconds = run.finished_at ? Math.max(0, Math.round((Date.parse(run.finished_at) - Date.parse(run.started_at)) / 1000)) : null;
  const bad = run.status === "failed" || run.status.startsWith("aborted");
  return (
    <div style={{ ...card, padding: 14 }}>
      <button
        type="button"
        data-track="agents.run-row"
        onClick={() => setOpen((v) => !v)}
        style={{ display: "flex", width: "100%", gap: 10, alignItems: "center", background: "none", border: "none", padding: 0, textAlign: "left", cursor: "pointer", color: "inherit" }}
      >
        <span style={{ flex: 1, minWidth: 0 }}>
          <span style={{ fontWeight: 600, fontSize: 14, display: "block" }}>
            {run.agent} <span style={{ fontWeight: 400, color: "var(--inchiostro-50)" }}>· {run.trigger}</span>
          </span>
          <span style={{ fontSize: 12.5, color: bad ? "var(--corallo-testo)" : "var(--inchiostro-50)" }}>
            {STATUS_LABEL[run.status] ?? run.status} · {formatWhen(run.started_at)}
          </span>
        </span>
        <span className="font-mono" style={{ fontSize: 12, color: "var(--inchiostro-50)", textAlign: "right", whiteSpace: "nowrap" }}>
          {usd(run.cost_usd)}
          <br />
          {run.steps} passi{seconds !== null ? ` · ${seconds}s` : ""}
        </span>
      </button>
      {open && (
        <div style={{ marginTop: 10 }}>
          {run.error && <p style={{ fontSize: 13, color: "var(--corallo-testo)", margin: "0 0 8px" }}>{run.error}</p>}
          <p style={{ fontSize: 12.5, color: "var(--inchiostro-50)", margin: 0 }}>
            {run.llm_calls} chiamate al modello · {run.output.anomalies?.length ?? 0} anomalie · {run.output.proposals?.length ?? 0} proposte
          </p>
          <Json value={run.output} />
        </div>
      )}
    </div>
  );
}

function Admins() {
  const { data, isPending } = useAdmins();
  const add = useAddAdmin();
  const remove = useRemoveAdmin();
  const { session } = useSession();
  const myEmail = session?.user?.email?.toLowerCase();
  const [email, setEmail] = useState("");
  const [confirming, setConfirming] = useState<string | null>(null);
  const valid = /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim());
  const error = add.error ?? remove.error;

  function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!valid) return;
    add.mutate(email.trim(), { onSuccess: () => setEmail("") });
  }

  return (
    <div style={{ marginTop: 26 }}>
      <span style={label}>Amministratori</span>
      <div style={card} data-track="agents.admins" data-interactive="false">
        <p style={{ fontSize: 13, color: "var(--inchiostro-50)", margin: "0 0 12px", lineHeight: 1.4 }}>
          Chi è qui vede questa pagina e decide sulle proposte. Basta l&apos;email del suo account: vale dal primo accesso.
        </p>
        <form onSubmit={submit} style={{ display: "flex", gap: 8 }}>
          <input
            type="email"
            inputMode="email"
            autoComplete="off"
            placeholder="nome@esempio.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            data-track="agents.admin-email"
            style={{ flex: 1, minWidth: 0, border: "1px solid var(--border-airbnb)", borderRadius: 12, padding: "10px 12px", fontSize: 16, background: "transparent", color: "inherit" }}
          />
          <button
            type="submit"
            data-track="agents.admin-add"
            className="tap-target"
            {...dis(!valid || add.isPending, add.isPending ? "in_caricamento" : "email_non_valida")}
            style={{ ...pill(true), opacity: valid ? 1 : 0.45 }}
          >
            Aggiungi
          </button>
        </form>
        {error && (
          <p style={{ fontSize: 13, color: "var(--corallo-testo)", margin: "8px 0 0" }}>
            {error instanceof ApiError ? error.message : "Non è andata, riprova."}
          </p>
        )}

        {isPending ? (
          <Skeleton height={60} radius={12} />
        ) : (
          <div style={{ marginTop: 12 }}>
            {data && data.bootstrap_count > 0 && (
              <p style={{ fontSize: 12.5, color: "var(--inchiostro-35)", margin: "0 0 6px" }}>
                {data.bootstrap_count === 1 ? "1 amministratore fisso" : `${data.bootstrap_count} amministratori fissi`} dal server, non
                rimovibili da qui.
              </p>
            )}
            {data?.admins.map((admin) => {
              const isMe = admin.email === myEmail;
              const asking = confirming === admin.email;
              return (
                <div key={admin.email} style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 0", borderTop: "1px solid var(--border-airbnb)" }}>
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <span style={{ fontSize: 14, fontWeight: 600, display: "block", overflow: "hidden", textOverflow: "ellipsis" }}>
                      {admin.email}
                      {isMe ? " (tu)" : ""}
                    </span>
                    <span style={{ fontSize: 12, color: "var(--inchiostro-50)" }}>
                      aggiunto {formatWhen(admin.added_at)}
                      {admin.added_by ? ` da ${admin.added_by}` : ""}
                    </span>
                  </span>
                  {!isMe && (
                    <button
                      type="button"
                      data-track={asking ? "agents.admin-remove-confirm" : "agents.admin-remove"}
                      className="tap-target"
                      {...dis(remove.isPending, "in_caricamento")}
                      onClick={() => {
                        if (!asking) return setConfirming(admin.email);
                        remove.mutate(admin.email, { onSettled: () => setConfirming(null) });
                      }}
                      style={{ ...pill(false), color: asking ? "var(--corallo-testo)" : "var(--inchiostro)" }}
                    >
                      {asking ? "Conferma" : "Rimuovi"}
                    </button>
                  )}
                </div>
              );
            })}
            {data && data.admins.length === 0 && (
              <p className="font-serif-italic" style={{ fontSize: 14, color: "var(--inchiostro-50)", margin: 0 }}>
                Nessun altro amministratore.
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function Tag({ children }: { children: React.ReactNode }) {
  return <span style={{ background: "var(--sabbia)", borderRadius: 8, padding: "3px 8px" }}>{children}</span>;
}

function Json({ value }: { value: unknown }) {
  return (
    <pre
      className="font-mono"
      style={{ fontSize: 11.5, background: "var(--sabbia)", borderRadius: 12, padding: 10, margin: "8px 0 0", overflowX: "auto", maxHeight: 280, whiteSpace: "pre-wrap", wordBreak: "break-word" }}
    >
      {JSON.stringify(value, null, 2)}
    </pre>
  );
}

function formatWhen(iso: string): string {
  return new Date(iso).toLocaleString("it-IT", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}
