"use client";

import Link from "next/link";
import type { CSSProperties, ReactNode } from "react";
import { ContextLink } from "@/components/ContextLink";
import { ChevronRight } from "@/components/Icons";
import { classifySession, sessionDurationMinutes, toDateKey, type DisplaySession } from "@/lib/sessionVisuals";

/** Small building blocks of the Passo system. Styling lives in globals.css; these only
 * fix the markup so every screen says "section", "row" or "notice" the same way. */

export type Tone = "ok" | "warn" | "danger" | "info" | "accent" | "neutral" | "ink";

export function Section({ title, action, children, id, className }: { title?: ReactNode; action?: ReactNode; children: ReactNode; id?: string; className?: string }) {
  return (
    <section className={["section", className].filter(Boolean).join(" ")} aria-labelledby={id && title ? `${id}-title` : undefined}>
      {(title || action) && (
        <div className="section-head">
          {title && <h2 className="section-title" id={id ? `${id}-title` : undefined}>{title}</h2>}
          {action}
        </div>
      )}
      {children}
    </section>
  );
}

export function SectionLink({ href, children, track, from }: { href: string; children: ReactNode; track: string; from?: string }) {
  const content = <>{children}<ChevronRight size={14} aria-hidden="true" /></>;
  return from ? (
    <ContextLink href={href} from={from} className="section-link" data-track={track}>{content}</ContextLink>
  ) : (
    <Link href={href} className="section-link" data-track={track}>{content}</Link>
  );
}

export function Badge({ tone = "neutral", children }: { tone?: Tone; children: ReactNode }) {
  return <span className="badge" data-tone={tone}>{children}</span>;
}

export function Notice({ tone = "info", title, children, action, role = "status" }: { tone?: Exclude<Tone, "accent" | "ink">; title?: ReactNode; children?: ReactNode; action?: ReactNode; role?: "status" | "alert" }) {
  return (
    <div className="notice" data-tone={tone} role={role}>
      <div style={{ flex: 1, minWidth: 0 }}>
        {title && <strong>{title}</strong>}
        {children && <p>{children}</p>}
        {action && <div className="actions" style={{ marginTop: 10 }}>{action}</div>}
      </div>
    </div>
  );
}

export function EmptyState({ title, children, actions }: { title: ReactNode; children?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="empty">
      <h2>{title}</h2>
      {children && <p>{children}</p>}
      {actions && <div className="actions">{actions}</div>}
    </div>
  );
}

export function Stat({ value, unit, label, note }: { value: ReactNode; unit?: string; label: ReactNode; note?: ReactNode }) {
  return (
    <div className="stat">
      <span className="stat-value">{value}{unit && <small>{unit}</small>}</span>
      <span className="stat-label">{label}</span>
      {note && <span className="stat-note">{note}</span>}
    </div>
  );
}

/** A tappable list row. `from` keeps the way back when the target is a detail. */
export function RowLink({ href, from, title, meta, lead, end, track, style }: { href: string; from?: string; title: ReactNode; meta?: ReactNode; lead?: ReactNode; end?: ReactNode; track: string; style?: CSSProperties }) {
  const inner = (
    <>
      {lead}
      <span className="row-main">
        <span className="row-title">{title}</span>
        {meta && <span className="row-meta">{meta}</span>}
      </span>
      <span className="row-end">{end}<ChevronRight size={16} aria-hidden="true" /></span>
    </>
  );
  return from ? (
    <ContextLink href={href} from={from} className="row" data-track={track} style={style}>{inner}</ContextLink>
  ) : (
    <Link href={href} className="row" data-track={track} style={style}>{inner}</Link>
  );
}

export function DateLead({ date }: { date: string }) {
  const d = new Date(`${date}T12:00:00`);
  return (
    <span className="row-date" aria-hidden="true">
      <span>{d.toLocaleDateString("it-IT", { weekday: "short" }).replace(".", "")}</span>
      <b>{d.getDate()}</b>
    </span>
  );
}

export function SportMark({ session }: { session: DisplaySession | null }) {
  return <span className="sport-mark" aria-hidden="true" style={{ "--sport": classifySession(session).accent } as CSSProperties} />;
}

/** The week as the brand mark draws it: one bar per session, its height the planned
 * duration, its color the sport. Rest days stay a low neutral stub. Each day is a link
 * (or a button) to that day, so the strip is a navigator, not a decoration. */
export function WeekRhythm({
  days,
  sessions,
  todayKey,
  selectedKey,
  doneKeys,
  hrefFor,
  onSelect,
  label,
}: {
  days: Date[];
  sessions: DisplaySession[];
  todayKey: string;
  selectedKey?: string | null;
  doneKeys?: Set<string>;
  hrefFor?: (key: string) => string;
  onSelect?: (key: string) => void;
  label: string;
}) {
  // A session whose steps can't be measured counts as half an hour: the bar should
  // still say "something is planned" rather than vanish.
  const minutesOf = (s: DisplaySession) => {
    const minutes = sessionDurationMinutes(s);
    return Number.isFinite(minutes) && minutes > 0 ? minutes : 30;
  };
  const maxMinutes = Math.max(60, ...sessions.map(minutesOf));
  return (
    <div className="rhythm" role="list" aria-label={label}>
      {days.map((day) => {
        const key = toDateKey(day);
        const daySessions = sessions.filter((s) => s.date === key);
        const isToday = key === todayKey;
        const names = daySessions.map((s) => s.title).join(", ");
        const weekday = day.toLocaleDateString("it-IT", { weekday: "long" });
        const description = `${weekday} ${day.getDate()}: ${daySessions.length ? names : "riposo"}${doneKeys?.has(key) ? ", svolto" : ""}`;
        const bars = (
          <span className="rhythm-bars" aria-hidden="true">
            {daySessions.length === 0 ? (
              <span className="rhythm-bar" data-state="rest" style={{ height: 4 }} />
            ) : (
              daySessions.map((s, i) => {
                const height = Math.max(10, Math.round((minutesOf(s) / maxMinutes) * 56));
                const state = doneKeys?.has(key) ? "done" : key < todayKey ? "past" : "planned";
                return <span key={i} className="rhythm-bar" data-state={state} style={{ height, "--sport": classifySession(s).accent } as CSSProperties} />;
              })
            )}
          </span>
        );
        const text = (
          <span className="rhythm-label" aria-hidden="true">
            <span>{day.toLocaleDateString("it-IT", { weekday: "short" }).replace(".", "")}</span>
            <b>{day.getDate()}</b>
          </span>
        );
        const common = { className: "rhythm-day", "data-today": isToday || undefined, "aria-label": description } as const;
        return (
          <span role="listitem" key={key} style={{ minWidth: 0 }}>
            {onSelect ? (
              <button type="button" {...common} aria-pressed={selectedKey === key} onClick={() => onSelect(key)} data-track="rhythm.day">{bars}{text}</button>
            ) : hrefFor ? (
              <Link {...common} href={hrefFor(key)} aria-current={selectedKey === key ? "date" : undefined} data-track="rhythm.day">{bars}{text}</Link>
            ) : (
              <span {...common}>{bars}{text}</span>
            )}
          </span>
        );
      })}
    </div>
  );
}
