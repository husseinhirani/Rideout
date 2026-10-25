import type { BackendState } from "./api";
import { briefOf, callsFor, caseStatus, coordinationOf, currentCase, intakeOf, notesFor } from "./live";

const clock = (ms: number) => new Date(ms).toLocaleTimeString([], { hour: "numeric", minute: "2-digit", second: "2-digit" });

/**
 * The case the backend is working, read straight from /state. Closing here is a
 * dispatcher action and never claims a reunion; only the original reporter's
 * confirmation (case_intakes.reunion_confirmed) shows as a reported reunion.
 */
export function CaseCard({
  state,
  chosenId,
  now,
  onChoose,
  onClose,
}: {
  state: BackendState;
  chosenId: number | null;
  now: number;
  onChoose: (caseId: number) => void;
  onClose: (caseId: number) => void;
}) {
  const row = currentCase(state, chosenId);
  if (!row) {
    return (
      <article className="glass case-card">
        <p className="kicker">No case yet</p>
        <p className="case-goal">Start → Missing child opens one from the dispatcher form. Inbound calls open one too.</p>
      </article>
    );
  }
  const intake = intakeOf(state, row.id);
  const status = caseStatus(row, intake);
  const brief = briefOf(row.brief);
  const coordination = coordinationOf(state, row.id, now);
  const calls = callsFor(state, row.id);
  const notes = notesFor(state, row.id);
  const child = state.profiles.find((profile) => profile.id === row.victim_profile_id);
  const place = state.locations?.find((location) => location.id === intake?.last_seen_location_id);

  return (
    <article className="glass case-card">
      <div className="case-head">
        <p className={`kicker ${status.tone === "open" ? "hot" : status.tone === "reunion" ? "found" : ""}`}>
          Case #{row.id} · {status.label}
        </p>
        {state.cases.length > 1 ? (
          <select value={row.id} onChange={(event) => onChoose(Number(event.target.value))} aria-label="Choose a case">
            {[...state.cases].sort((a, b) => b.id - a.id).map((item) => (
              <option key={item.id} value={item.id}>
                #{item.id} · {state.profiles.find((profile) => profile.id === item.victim_profile_id)?.name ?? "Unknown"} · {item.status}
              </option>
            ))}
          </select>
        ) : null}
      </div>
      <h3>{child?.name ?? "Unknown person"}</h3>
      <p className="case-goal">{row.goal}</p>
      {status.reunionAt ? <p className="case-note good">Reported at {new Date(status.reunionAt).toLocaleTimeString()}. Self-reported by the original reporter; RideOut did not verify it.</p> : null}

      {intake ? (
        <dl>
          <div>
            <dt>Description</dt>
            <dd>{intake.child_description}</dd>
          </div>
          <div>
            <dt>Last seen</dt>
            <dd>
              {place?.label ?? intake.last_seen_location_id}, {intake.last_seen_time}
            </dd>
          </div>
          <div>
            <dt>Reported by</dt>
            <dd>
              {intake.reporter_name} ({intake.reporter_relationship}) · self-reported
            </dd>
          </div>
        </dl>
      ) : null}

      {brief.summary ? <p className="case-brief">{brief.summary}</p> : null}

      <p className={`case-note${coordination.kind === "blocked" ? " warn" : coordination.kind === "pending" || coordination.kind === "retrying" ? " hot" : ""}`}>
        {coordination.text}
      </p>

      {calls.length ? (
        <div className="case-calls">
          <h4>Helpers asked</h4>
          {calls.map((call) => (
            <div key={call.attempt.id} className="case-call">
              <p>
                <b>{call.person?.name ?? "Unknown"}</b>
                <span className={`badge t-${call.transport ?? "legacy"}`}>{call.transportLabel}</span>
                <span className="badge">{call.reportLabel}</span>
              </p>
              <p className="case-ask">“{call.attempt.ask}”</p>
              {call.followUpAt !== null && !call.progress?.review_consumed ? (
                <p className="case-note">
                  Follow-up review at {clock(call.followUpAt)}
                  {call.followUpAt > now ? ` · in ${Math.ceil((call.followUpAt - now) / 1000)} s` : " · due"}. A due review does not guarantee another call.
                </p>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}

      {notes.length ? (
        <div className="case-calls">
          <h4>What we have heard</h4>
          {notes.slice(-5).map((view) => (
            <p key={view.note.id} className={`case-report ${view.kind}`}>
              <small>{view.label}</small>
              {view.note.text}
            </p>
          ))}
        </div>
      ) : null}

      {row.status !== "closed" ? (
        <div className="case-actions">
          <button type="button" className="mark-found" onClick={() => onClose(row.id)}>
            Close case manually
          </button>
          <small>Does not confirm reunion. Calls already active keep running.</small>
        </div>
      ) : null}
    </article>
  );
}
