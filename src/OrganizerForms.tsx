import { useRef, useState, type ReactNode } from "react";
import { api, ApiError, informationCases, type BackendState, type ContactScope, type DirectoryResult, type InformationCase, type IncomingRequestRow } from "./api";
import { eventKey, type RunAction } from "./backend";

export function CommandForm({ run, prepare, children, label, disabled = false, onSaved, className = "", submitIcon }: {
  run: RunAction; prepare: (id: string) => () => Promise<unknown>; children?: ReactNode;
  label: string; disabled?: boolean; onSaved?: (value: unknown) => void; className?: string; submitIcon?: ReactNode;
}) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [retry, setRetry] = useState<(() => Promise<unknown>) | null>(null);
  const lock = useRef(false);
  const send = async (work: () => Promise<unknown>) => {
    if (disabled || lock.current) return;
    lock.current = true; setBusy(true); setMessage("");
    try {
      const result = await run(work);
      setRetry(null); setMessage("Saved."); onSaved?.(result);
    } catch (error) {
      const uncertain = !(error instanceof ApiError) || error.status >= 500;
      setRetry(uncertain ? () => work : null);
      setMessage((error instanceof Error ? error.message : "Request failed") + (uncertain ? " Retry the same request to confirm its result." : " Review the current state before submitting again."));
    } finally { lock.current = false; setBusy(false); }
  };
  return <form className={`organizer-form ${className}`} onSubmit={event => {
    event.preventDefault();
    if (disabled || lock.current || retry) return;
    try { void send(prepare(eventKey())); }
    catch (error) { setMessage(error instanceof Error ? error.message : "Check these fields."); }
  }}>
    <fieldset disabled={disabled || busy || !!retry}>{children}<button type="submit" aria-label={label}>{busy ? "Saving…" : submitIcon ?? label}</button></fieldset>
    {message && <p role="status" className="form-message">{message}</p>}
    {retry && <button type="button" disabled={disabled || busy} onClick={() => void send(retry)}>Retry same request</button>}
  </form>;
}

function json<T>(text: string): T { try { return JSON.parse(text) as T; } catch { throw new Error("Check the JSON format."); } }

export function DirectoryPicker({ state, scope, onChange, disabled = false }: {
  state: BackendState; scope: ContactScope; onChange: (scope: ContactScope) => void; disabled?: boolean;
}) {
  const [lat, setLat] = useState(String(scope.radius?.lat ?? ""));
  const [lng, setLng] = useState(String(scope.radius?.lng ?? ""));
  const [radius, setRadius] = useState(String(scope.radius?.radius_m ?? ""));
  const [related, setRelated] = useState(String(scope.related_to_profile_id ?? ""));
  const [tags, setTags] = useState(scope.tags?.join(", ") ?? "");
  const [result, setResult] = useState<DirectoryResult | null>(null);
  const [searched, setSearched] = useState<ContactScope>({});
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const requestId = useRef(0);
  const filter = (): ContactScope => {
    const area = lat !== "" || lng !== "" || radius !== "";
    if (area && [lat, lng, radius].some(v => v === "" || !Number.isFinite(Number(v)))) throw new Error("Enter latitude, longitude and radius together.");
    return { ...(area ? { radius: { lat: Number(lat), lng: Number(lng), radius_m: Number(radius) } } : {}),
      ...(related ? { related_to_profile_id: Number(related) } : {}),
      ...(tags.trim() ? { tags: tags.split(",").map(t => t.trim()).filter(Boolean) } : {}) };
  };
  const search = async (more = false) => {
    const request = ++requestId.current;
    setError(""); setBusy(true);
    try {
      const query = more ? searched : filter();
      const next = await api.directory(query, more ? result?.next_after_id ?? 0 : 0);
      if (request !== requestId.current) return;
      setSearched(query);
      setResult(more ? { ...next, profiles: [...(result?.profiles ?? []), ...next.profiles] } : next);
    } catch (e) { setError(e instanceof Error ? e.message : "Search failed"); }
    finally { if (request === requestId.current) setBusy(false); }
  };
  const profiles = result?.profiles ?? state.profiles;
  return <div className="directory-picker">
    <p>Choose people, or authorize a directory filter. Searching never calls anyone.</p>
    <div className="form-row">
      <label>Latitude<input type="number" step="any" value={lat} onChange={e => setLat(e.target.value)} /></label>
      <label>Longitude<input type="number" step="any" value={lng} onChange={e => setLng(e.target.value)} /></label>
      <label>Radius (metres)<input type="number" min="0" value={radius} onChange={e => setRadius(e.target.value)} /></label>
    </div>
    <label>Contacts of<select value={related} onChange={e => setRelated(e.target.value)}><option value="">Anyone in directory</option>{state.profiles.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
    <label>Tags, separated by commas<input value={tags} onChange={e => setTags(e.target.value)} /></label>
    <div className="form-row"><button type="button" disabled={disabled || busy} onClick={() => void search()}>Find people</button>
      <button type="button" disabled={disabled || busy} onClick={() => { try { onChange(filter()); } catch (e) { setError((e as Error).message); } }}>Authorize this filter</button></div>
    {scope.profile_ids === undefined && <p className="form-message">Authorized filter: {JSON.stringify(scope)}. An empty filter permits the entire directory; consent still applies. <button type="button" onClick={() => onChange({ profile_ids: [] })}>Choose specific people instead</button></p>}
    {error && <p role="alert">{error}</p>}
    <div className="directory-list">{profiles.map(p => <label className="check-label" key={p.id}>
      <input type="checkbox" checked={scope.profile_ids?.includes(p.id) ?? false} disabled={disabled} onChange={e => onChange({ profile_ids: e.target.checked ? [...(scope.profile_ids ?? []), p.id] : (scope.profile_ids ?? []).filter(id => id !== p.id) })} />
      <span>{p.name} · phone ending {p.phone_last4 || "not recorded"}<small>{state.profile_settings?.find(s => s.profile_id === p.id)?.call_consent ? "Calls allowed" : "Consent not recorded"}</small></span>
    </label>)}</div>
    {scope.profile_ids && <p>{scope.profile_ids.length} selected{scope.profile_ids.length ? `: ${scope.profile_ids.map(id => state.profiles.find(p => p.id === id)?.name ?? `#${id}`).join(", ")}` : ""}</p>}
    {result?.next_after_id != null && <button type="button" disabled={disabled || busy} onClick={() => void search(true)}>More results</button>}
    <small>Directory coordinates are stored records, not current whereabouts.</small>
  </div>;
}

export function NewInvestigation({ state, run, disabled, onCreated }: { state: BackendState; run: RunAction; disabled: boolean; onCreated: (id: number) => void }) {
  const [text, setText] = useState(""); const [objective, setObjective] = useState("");
  const [scope, setScope] = useState<ContactScope>({ profile_ids: [] });
  const [consent, setConsent] = useState(false); const [automatic, setAutomatic] = useState(false);
  const [briefing, setBriefing] = useState("");
  return <CommandForm run={run} disabled={disabled} label="Open investigation" prepare={command_id => {
    if (!text.trim() || !objective.trim()) throw new Error("Describe the incident and what you need to find out.");
    const body = { command_id, text, objective, scope, coordination_enabled: automatic,
      preferences: consent ? (scope.profile_ids ?? []).map(profile_id => ({ profile_id, call_consent: true })) : [],
      disclosure_facts: briefing.trim() ? [{ id: "briefing", text: briefing.trim(), profile_ids: null }] : [] };
    return () => api.incident(body);
  }} onSaved={value => { const id = (value as { support_case_id?: number }).support_case_id; if (id) onCreated(id); }}>
    <label>What is happening?<textarea required value={text} onChange={e => setText(e.target.value)} placeholder="Describe the incident in your own words." /></label>
    <label>What do you need to find out?<textarea required value={objective} onChange={e => setObjective(e.target.value)} /></label>
    <DirectoryPicker state={state} scope={scope} onChange={setScope} disabled={disabled} />
    {!!scope.profile_ids?.length && <label className="check-label"><input type="checkbox" checked={consent} onChange={e => setConsent(e.target.checked)} />These selected people have agreed to receive calls</label>}
    <label>Information Tom may share<textarea value={briefing} onChange={e => setBriefing(e.target.value)} placeholder="Only information these contacts may hear." /></label>
    <label className="check-label"><input type="checkbox" checked={automatic} disabled={!state.adaptive_planning_available} onChange={e => setAutomatic(e.target.checked)} />Let Claude choose contacts and questions within this scope</label>
    <p>{automatic ? "Opening this investigation may start calls to eligible contacts." : "No calls start until you request one or enable automatic questions."}</p>
    {!state.adaptive_planning_available && <p>Automatic planning is disabled on this backend.</p>}
  </CommandForm>;
}

export function OrganizerInput({ row, run, disabled, initial = "" }: { row: InformationCase; run: RunAction; disabled: boolean; initial?: string }) {
  const [text, setText] = useState(initial);
  return <CommandForm run={run} disabled={disabled || row.status === "closed"} label="Save direction or correction" prepare={command_id => {
    const body = { command_id, expected_input_revision: row.input_revision, text };
    return () => api.caseInput(row.id, body);
  }} onSaved={() => setText("")}>
    <label>What should be investigated or corrected?<textarea required value={text} onChange={e => setText(e.target.value)} /></label>
    {row.policy.paused && <p>Saved input stays on this paused case. Resume when ready for reconsideration.</p>}
  </CommandForm>;
}

export function CaseSettings({ state, row, run, disabled }: { state: BackendState; row: InformationCase; run: RunAction; disabled: boolean }) {
  const planning = state.information_planning?.find(p => p.support_case_id === row.id);
  const [objective, setObjective] = useState(row.objective);
  const [scope, setScope] = useState(row.scope);
  const [automatic, setAutomatic] = useState(planning?.enabled ?? false);
  const [facts, setFacts] = useState(JSON.stringify(planning?.disclosure_facts ?? [], null, 2));
  const [policy, setPolicy] = useState(row.policy);
  const [revision] = useState(row.input_revision);
  return <>
    <CommandForm run={run} disabled={disabled || row.status === "closed"} label="Save settings" prepare={command_id => {
      const body = { command_id, expected_input_revision: revision, objective, scope, policy: { max_concurrent_calls: policy.max_concurrent_calls, max_calls_total: policy.max_calls_total, max_calls_per_destination: policy.max_calls_per_destination, min_repeat_ms: policy.min_repeat_ms }, coordination_enabled: automatic, disclosure_facts: json<NonNullable<typeof planning>["disclosure_facts"]>(facts) };
      return () => api.configure(row.id, body);
    }}>
      {revision !== row.input_revision && <p role="alert">New information arrived. Close and reopen settings to review the latest version before saving.</p>}
      <label>Objective<textarea required value={objective} onChange={e => setObjective(e.target.value)} /></label>
      <DirectoryPicker state={state} scope={scope} onChange={setScope} disabled={disabled} />
      <label className="check-label"><input type="checkbox" checked={automatic} disabled={!state.adaptive_planning_available && !automatic} onChange={e => setAutomatic(e.target.checked)} />Automatic questions within this scope</label>
      <label>Approved disclosure facts<textarea value={facts} onChange={e => setFacts(e.target.value)} rows={5} /></label>
      <small>Each fact has an id, text, and profile_ids (null means all permitted contacts). Incident details are not automatically approved for disclosure.</small>
      <div className="form-row">{([['max_concurrent_calls', 'Concurrent calls'], ['max_calls_total', 'Total call limit'], ['max_calls_per_destination', 'Calls per number'], ['min_repeat_ms', 'Repeat delay (ms)']] as const).map(([key, label]) => <label key={key}>{label}<input type="number" min={key === 'min_repeat_ms' ? 0 : 1} value={policy[key]} onChange={e => setPolicy({ ...policy, [key]: Number(e.target.value) })} /></label>)}</div>
      <p>Saving settings does not resume a paused investigation. Existing calls continue.</p>
    </CommandForm>
    <h3>Contact permissions</h3><p>These apply across investigations. Record consent only when the person agreed.</p>
    {state.profiles.map(p => {
      const allowed = state.profile_settings?.find(s => s.profile_id === p.id)?.call_consent ?? false;
      return <CommandForm key={p.id} run={run} disabled={disabled || row.status === "closed"} label={allowed ? `Stop calls to ${p.name}` : `Record ${p.name}'s consent`} prepare={command_id => {
        const body = { command_id, expected_input_revision: row.input_revision, preferences: [{ profile_id: p.id, call_consent: !allowed }] };
        return () => api.configure(row.id, body);
      }} />;
    })}
  </>;
}

export function ManualCall({ state, row, run, disabled }: { state: BackendState; row: InformationCase; run: RunAction; disabled: boolean }) {
  const [profile, setProfile] = useState(""); const [question, setQuestion] = useState(""); const [context, setContext] = useState("");
  const queued = state.attempt_progress.filter(a => a.support_case_id === row.id && a.transport === "queued");
  return <CommandForm run={run} disabled={disabled || row.policy.paused || row.status === "closed" || queued.length > 0} label="Call selected person" prepare={command_id => {
    const body = { command_id, expected_input_revision: row.input_revision, profile_id: Number(profile), question, context, queued: [] };
    return () => api.requestCall(row.id, body);
  }} onSaved={() => setQuestion("")}>
    <label>Person<select required value={profile} onChange={e => setProfile(e.target.value)}><option value="">Choose a person</option>{state.profiles.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
    <small>The backend checks this person's scope, consent and call limits before dialing.</small>
    <label>What should Tom ask?<textarea required value={question} onChange={e => setQuestion(e.target.value)} /></label>
    <label>Context this person may hear<textarea value={context} onChange={e => setContext(e.target.value)} /></label>
    {queued.length > 0 && <p>Existing queued work needs to start or be cancelled before requesting another manual call.</p>}
  </CommandForm>;
}

export function ReviewReport({ state, report, run, disabled }: { state: BackendState; report: IncomingRequestRow; run: RunAction; disabled: boolean }) {
  const [decision, setDecision] = useState<"attach" | "reject">("attach");
  const [caseId, setCaseId] = useState(""); const [reason, setReason] = useState("");
  return <CommandForm run={run} disabled={disabled} label={decision === "attach" ? "Attach original report" : "Reject report"} prepare={command_id => {
    const body = { command_id, expected_revision: report.revision, decision, reason, ...(decision === "attach" ? { support_case_id: Number(caseId) } : {}) };
    return () => api.review(report.id, body);
  }}>
    <label>Decision<select value={decision} onChange={e => setDecision(e.target.value as "attach" | "reject")}><option value="attach">Attach to an investigation</option><option value="reject">Reject</option></select></label>
    {decision === "attach" && <label>Investigation<select aria-label="Attach to investigation" required value={caseId} onChange={e => setCaseId(e.target.value)}><option value="">Choose the relevant investigation</option>{informationCases(state).filter(c => c.status !== "closed").map(c => <option key={c.id} value={c.id}>#{c.id} · {c.objective}</option>)}</select></label>}
    <label>Reason<textarea required value={reason} onChange={e => setReason(e.target.value)} /></label>
    <p>Attachment preserves an unverified account. It does not enroll the caller or permit calls. Paused cases stay paused.</p>
  </CommandForm>;
}

export function IntakeSettings({ state, run, disabled }: { state: BackendState; run: RunAction; disabled: boolean }) {
  const config = state.information_intake_configuration;
  const [enabled, setEnabled] = useState(config?.enabled ?? false);
  const [automatic, setAutomatic] = useState(config?.coordination_enabled ?? false);
  const [scope, setScope] = useState<ContactScope>(config?.default_scope ?? { profile_ids: [] });
  const [allowed, setAllowed] = useState(state.profile_settings?.filter(s => s.intake_allowed).map(s => s.profile_id) ?? []);
  const [facts, setFacts] = useState(JSON.stringify(config?.disclosure_facts ?? [], null, 2));
  const [revision] = useState(config?.revision ?? 0);
  if (!config) return <p>Phone intake configuration is unavailable.</p>;
  return <CommandForm run={run} disabled={disabled} label="Save phone intake settings" prepare={command_id => {
    const body = { command_id, expected_revision: revision, enabled, coordination_enabled: automatic, default_scope: scope, disclosure_facts: json(facts), preferences: state.profiles.map(p => ({ profile_id: p.id, intake_allowed: allowed.includes(p.id) })) };
    return () => api.intakeConfiguration(body);
  }}>
    {revision !== config.revision && <p>Configuration changed. Close and reopen this panel before saving again.</p>}
    <label className="check-label"><input type="checkbox" checked={enabled} onChange={e => setEnabled(e.target.checked)} />Allow permitted callers to open investigations by phone</label>
    {state.profiles.map(p => <label key={p.id} className="check-label"><input type="checkbox" checked={allowed.includes(p.id)} onChange={e => setAllowed(e.target.checked ? [...allowed, p.id] : allowed.filter(id => id !== p.id))} />Intake allowed · {p.name}</label>)}
    <p>Intake permission does not grant call consent or verify caller identity. Defaults apply only to newly created investigations.</p>
    <DirectoryPicker state={state} scope={scope} onChange={setScope} disabled={disabled} />
    <label className="check-label"><input type="checkbox" checked={automatic} disabled={!state.adaptive_planning_available && !automatic} onChange={e => setAutomatic(e.target.checked)} />Enable automatic questions for phone-created investigations</label>
    <p>When enabled, phone intake may initiate calls to eligible contacts.</p>
    <label>Approved disclosure facts<textarea rows={4} value={facts} onChange={e => setFacts(e.target.value)} /></label>
  </CommandForm>;
}
