import { useState } from "react";
import type { AssistanceState } from "../server/shared/assistance";
import { districtLedger, EVAC_STATUSES, STATUS_LABEL, UNASSIGNED, type DistrictTally, type EvacStatus, type EvidenceTier, type Ledger, type PersonStatus } from "../server/shared/districts";
import type { Check, Claim, CoreBrief, DistrictReport } from "../server/shared/trust-check";
import type { CoordinatorAction } from "./updated-ui-api";
import { CallTranscript } from "./CallTranscript";

const TIER: Record<EvidenceTier, string> = { two_party: "Both people confirmed", single_report: "One person's report", none: "No report" };
const OPEN: EvacStatus[] = ["unknown", "unreachable", "needs_help"];
const ago = (at: number | null, now: number) => at === null ? "never heard from" : now - at < 60_000 ? "heard just now" : "last heard " + Math.round((now - at) / 60_000) + " min ago";

function Verdict({ check, quiet }: { check?: Check; quiet?: boolean }) {
  if (!check) return null;
  if (check.ok) return quiet ? null : <span className="trust-verdict ok" title="Every number and citation matches saved records">✓ Matches records</span>;
  return <span className="trust-verdict bad" title={check.problems.join("\n")}>⚠ Not supported by records</span>;
}
function Problems({ check }: { check?: Check }) {
  return check && !check.ok ? <ul className="trust-problems">{check.problems.map(p => <li key={p}>{p}</li>)}</ul> : null;
}
function Statement({ text, check }: { text: string; check?: Check }) {
  return <><p className={"trust-statement" + (check && !check.ok ? " failed" : "")}>{text} <Verdict check={check} quiet /></p><Problems check={check} /></>;
}
function Bar({ tally }: { tally: DistrictTally }) {
  return <div className="trust-bar" role="img" aria-label={EVAC_STATUSES.map(s => tally.by_status[s].length + " " + STATUS_LABEL[s]).join(", ")}>
    {EVAC_STATUSES.map(s => tally.by_status[s].length ? <span key={s} className={"seg " + s} style={{ flexGrow: tally.by_status[s].length }} title={tally.by_status[s].length + " " + STATUS_LABEL[s]} /> : null)}
  </div>;
}

/** Records behind a person's status, down to the call. Simulated people have reports but no recorded call. */
function Evidence({ session, person }: { session: AssistanceState; person: PersonStatus }) {
  const [call, setCall] = useState<number | null>(null);
  const simulated = session.people.find(p => p.profile_id === person.profile_id)?.mode === "simulated";
  return <div className="trust-evidence">
    {person.evidence_ids.length === 0 && <p className="assistance-note">No saved report supports a status for {person.name}.</p>}
    {person.evidence_ids.map(id => {
      const finding = session.findings.find(f => f.id === id), arrangement = session.arrangements.find(a => a.id === id);
      const name = (pid: number) => session.people.find(p => p.profile_id === pid)?.name ?? "Unknown person";
      if (arrangement) return <blockquote key={id}><b>Ride arrangement</b><p>{name(arrangement.helper_id)} → {name(arrangement.recipient_id)} · {arrangement.status.replace("_", " ")}</p><small>{id}</small></blockquote>;
      if (!finding) return <blockquote key={id}><b>Missing record</b><small>{id}</small></blockquote>;
      return <blockquote key={id}>
        <b>{name(finding.profile_id)}</b><p>{finding.text || "No account text was saved."}</p>
        <small>{new Date(finding.at).toLocaleTimeString()} · {simulated ? "Simulated report" : "Phone report"} · {id}</small>
        {!simulated && <button type="button" className="trust-link" onClick={() => setCall(call === finding.attempt_id ? null : finding.attempt_id)}>{call === finding.attempt_id ? "Hide conversation" : "Read the conversation"}</button>}
        {call === finding.attempt_id && <CallTranscript attemptId={finding.attempt_id} name={name(finding.profile_id)} ended />}
      </blockquote>;
    })}
  </div>;
}
function PersonRow({ session, person, now }: { session: AssistanceState; person: PersonStatus; now: number }) {
  return <details className="trust-person">
    <summary><b>{person.name}</b><span className={"trust-status " + person.status}>{STATUS_LABEL[person.status]}</span><small>{TIER[person.tier]} · {ago(person.last_heard_at, now)}{person.stale ? " · stale" : ""}</small></summary>
    <Evidence session={session} person={person} />
  </details>;
}
function ClaimRow({ session, ledger, claim, check, now }: { session: AssistanceState; ledger: Ledger; claim: Claim; check?: Check; now: number }) {
  const people = claim.profile_ids.map(id => ledger.people.find(p => p.profile_id === id)).filter((p): p is PersonStatus => Boolean(p));
  return <li className={check && !check.ok ? "failed" : ""}>
    <Statement text={claim.text} check={check} />
    {check?.ok && <Verdict check={check} />}
    {people.map(p => <PersonRow key={p.profile_id} session={session} person={p} now={now} />)}
  </li>;
}

function District({ session, ledger, tally, line, lineCheck, report, now, unavailable, act }: {
  session: AssistanceState; ledger: Ledger; tally: DistrictTally; line?: string; lineCheck?: Check; report?: DistrictReport; now: number;
  unavailable: boolean; act: (key: string, action: CoordinatorAction) => Promise<boolean>;
}) {
  const [acknowledged, setAcknowledged] = useState<number[]>([]);
  const members = ledger.people.filter(p => p.district_id === tally.district.id);
  const open = members.filter(p => OPEN.includes(p.status));
  const cleared = session.cleared_districts?.find(c => c.district_id === tally.district.id);
  const ready = open.every(p => acknowledged.includes(p.profile_id));
  return <details className="trust-district">
    <summary>
      <div className="trust-district-head"><b>{tally.district.label}</b>{tally.district.access === "specialist" && <small>Specialist only</small>}{cleared && <small className="cleared">Declared clear by you</small>}</div>
      <Bar tally={tally} />
      <div className="trust-district-counts">
        <span>{tally.total} people</span><span>{tally.by_status.arrived.length} reported arrived</span>
        <span className={tally.unaccounted ? "unaccounted" : ""}>{tally.unaccounted} unaccounted for</span>
        {tally.stale > 0 && <span className="unaccounted">{tally.stale} stale</span>}<span>{ago(tally.last_heard_at, now)}</span>
      </div>
      {line && <Statement text={"Core agent: " + line} check={lineCheck} />}
    </summary>
    <div className="trust-district-body">
      <p className="assistance-note">Evidence strength: {(Object.keys(TIER) as EvidenceTier[]).map(t => TIER[t] + " " + tally.by_tier[t]).join(" · ")}</p>
      {report ? <section>
        <h4>District agent report {report.source === "ledger" ? <small>Records only: the agent was unavailable</small> : <Verdict check={report.check?.summary} />}</h4>
        <Statement text={report.summary} check={report.check?.summary} />
        <ul className="trust-claims">{report.claims.map(c => <ClaimRow key={c.id} session={session} ledger={ledger} claim={c} check={report.check?.claims[c.id]} now={now} />)}</ul>
        {report.escalations.length > 0 && <><h4>Escalated to the core agent</h4><ul className="trust-list">{report.escalations.map(e => <li key={e}>{e}</li>)}</ul></>}
      </section> : <p className="assistance-note">No district agent report yet.</p>}
      <h4>Everyone in this district</h4>
      {members.map(p => <PersonRow key={p.profile_id} session={session} person={p} now={now} />)}
      {tally.district.id !== UNASSIGNED && <section className="trust-clear">
        <h4>Declare this district clear</h4>
        {cleared && <p className="assistance-note">You declared it clear at {new Date(cleared.at).toLocaleTimeString()}{cleared.revision < session.revision ? ". New reports have arrived since then." : "."}</p>}
        {open.length ? <><p className="assistance-note">Only you can declare it clear. These people are not accounted for or still need a ride. Acknowledge each one to proceed.</p>
          {open.map(p => <label key={p.profile_id} className="trust-ack"><input type="checkbox" checked={acknowledged.includes(p.profile_id)} onChange={e => setAcknowledged(a => e.target.checked ? [...a, p.profile_id] : a.filter(id => id !== p.profile_id))} />{p.name}: {STATUS_LABEL[p.status]}</label>)}</>
          : <p className="assistance-note">Everyone here has a reported status. Declaring it clear records your decision; it does not verify safety.</p>}
        <div className="call-actions"><button type="button" disabled={unavailable || !ready} onClick={() => void act("clear-" + tally.district.id, { action: "declare_clear", district_id: tally.district.id, acknowledged }).then(ok => { if (ok) setAcknowledged([]); })}>Declare {tally.district.label} clear</button></div>
      </section>}
    </div>
  </details>;
}

export function TrustBrief({ session, now, compact, unavailable, act }: {
  session: AssistanceState & { ledger?: Ledger }; now: number; compact: boolean; unavailable: boolean;
  act: (key: string, action: CoordinatorAction) => Promise<boolean>;
}) {
  const [index, setIndex] = useState<number | null>(null);
  const [sample, setSample] = useState<PersonStatus[]>([]);
  const ledger = session.ledger ?? districtLedger(session, now);
  const briefs = session.briefs ?? [];
  const brief: CoreBrief | undefined = briefs[index ?? briefs.length - 1];
  const failed = brief?.check ? [brief.check.headline, ...brief.check.lines].filter(c => !c.ok).length : 0;
  const lineFor = (id: string) => brief?.district_lines.findIndex(l => l.district_id === id) ?? -1;
  const counted = ledger.people.filter(p => !OPEN.includes(p.status));
  const spotCheck = () => setSample([...counted].sort(() => Math.random() - .5).slice(0, 3));
  const t = ledger.totals;

  return <section className={"trust-brief" + (compact ? " compact" : "")} aria-label="Core agent briefing">
    <header>
      <div><h3>Core agent briefing</h3><p>{brief ? (brief.source === "ledger" ? "Records only: the core agent was unavailable" : "From district agents") + " · based on update " + brief.based_on_revision + (brief.based_on_revision < session.revision ? " (newer reports since)" : "") : "Waiting for the first district reports"}</p></div>
      {brief?.check && (failed ? <span className="trust-verdict bad">⚠ {failed} statement{failed === 1 ? "" : "s"} not supported</span> : <span className="trust-verdict ok">✓ Every statement matches records</span>)}
    </header>
    {brief && <Statement text={brief.headline} check={brief.check?.headline} />}
    <div className="trust-totals" title="Counted by code from saved reports. No agent writes these numbers.">
      <span><b>{t.arrived}</b> reported arrived</span><span><b>{t.in_progress}</b> leaving or arranged</span>
      <span><b>{t.needs_help}</b> need a ride</span><span className={t.unaccounted ? "unaccounted" : ""}><b>{t.unaccounted}</b> unaccounted for</span>
    </div>
    <p className="assistance-note">Counts come from saved phone reports, not from agent text. Unknown is never counted as safe.</p>
    <div className="trust-districts">{ledger.districts.filter(d => d.total > 0).map(tally => {
      const i = lineFor(tally.district.id);
      return compact
        ? <div key={tally.district.id} className="trust-district compact"><div className="trust-district-head"><b>{tally.district.label}</b><span className={tally.unaccounted ? "unaccounted" : ""}>{tally.unaccounted} unaccounted</span></div><Bar tally={tally} /></div>
        : <District key={tally.district.id} session={session} ledger={ledger} tally={tally} line={i >= 0 ? brief!.district_lines[i].text : undefined} lineCheck={i >= 0 ? brief!.check?.lines[i] : undefined} report={session.district_reports?.[tally.district.id]} now={now} unavailable={unavailable} act={act} />;
    })}</div>
    {!compact && <>
      {(ledger.disagreements.length > 0 || (brief?.disagreements.length ?? 0) > 0) && <section className="trust-section"><h4>Disagreements</h4>
        <ul className="trust-list">{ledger.disagreements.map(d => <li key={d.id}>{d.text} <small>Records: {d.evidence_ids.join(", ")}</small></li>)}{brief?.disagreements.map(d => <li key={d}>{d} <small>Raised by the core agent</small></li>)}</ul>
      </section>}
      {(brief?.asks_for_human.length ?? 0) > 0 && <section className="trust-section"><h4>The core agent asks you</h4><ul className="trust-list">{brief!.asks_for_human.map(a => <li key={a}>{a}</li>)}</ul></section>}
      <section className="trust-section"><h4>Spot-check</h4>
        <p className="assistance-note">Pick three people counted as accounted for and read the records behind their status.</p>
        <div className="call-actions"><button type="button" disabled={!counted.length} onClick={spotCheck}>Check 3 at random</button></div>
        {sample.map(p => <PersonRow key={p.profile_id} session={session} person={ledger.people.find(x => x.profile_id === p.profile_id) ?? p} now={now} />)}
      </section>
      {briefs.length > 1 && <section className="trust-section"><h4>Earlier briefings</h4>
        <select value={index ?? briefs.length - 1} onChange={e => setIndex(Number(e.target.value) === briefs.length - 1 ? null : Number(e.target.value))}>
          {briefs.map((b, i) => <option key={i} value={i}>Update {b.based_on_revision} · {new Date(b.created_at).toLocaleTimeString()}{i === briefs.length - 1 ? " (latest)" : ""}</option>)}
        </select>
        {index !== null && <p className="assistance-note">Showing what the core agent said at that time. District rows always show current records.</p>}
      </section>}
    </>}
  </section>;
}
