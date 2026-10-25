import type { AssistancePlan, AssistanceState } from './assistance';
import { districtFigures, ledgerFigures, STATUS_LABEL, UNACCOUNTED, type DistrictTally, type EvacStatus, type Ledger } from './districts';
/** Agent statements are checked against the deterministic ledger and saved evidence.
 * A failed check is shown to the human, never silently dropped. */
export type Claim = { id: string; text: string; status: EvacStatus | null; profile_ids: number[]; evidence_ids: string[] };
export type Check = { ok: boolean; problems: string[] };
export type DistrictReport = {
  district_id: string; based_on_revision: number; summary: string; claims: Claim[];
  questions: AssistancePlan['questions']; escalations: string[];
  source: 'model' | 'ledger'; model?: string; request_id?: string; error?: string;
  check?: { summary: Check; claims: Record<string, Check> };
};
export type BriefLine = { district_id: string; text: string; claim_ids: string[] };
export type CoreBrief = {
  based_on_revision: number; headline: string; district_lines: BriefLine[]; disagreements: string[]; asks_for_human: string[];
  source: 'model' | 'ledger'; model?: string; request_id?: string; error?: string; created_at: number;
  check?: { headline: Check; lines: Check[] };
};

const WORDS = ['zero','one','two','three','four','five','six','seven','eight','nine','ten','eleven','twelve','thirteen','fourteen','fifteen','sixteen','seventeen','eighteen','nineteen','twenty'];
/** Counts written in a statement. Digits inside identifiers ("position 2", "drill-point-3") are labels, not counts. */
export function statedNumbers(text: string, ignore: string[] = []): number[] {
  let t = ' ' + text.toLowerCase() + ' ';
  for (const label of ignore) t = t.split(label.toLowerCase()).join(' ');
  t = t.replace(/\b(position|point|revision|rev|district|zone|call|attempt)\s+#?\d+/g,' ').replace(/[\w]+[-:]\d+[\w:-]*/g,' ').replace(/\d{1,2}:\d{2}/g,' ').replace(/\bno one\b/g,' ');
  const digits = [...t.matchAll(/\b\d+\b/g)].map(m => Number(m[0]));
  const words = [...t.matchAll(/\b[a-z]+\b/g)].map(m => WORDS.indexOf(m[0])).filter(n => n > 0);
  return [...digits,...words];
}
function figuresCheck(text: string, allowed: Set<number>, ignore: string[]): string[] {
  return [...new Set(statedNumbers(text,ignore).filter(n => !allowed.has(n)))].map(n => 'States ' + n + ', which no record supports');
}
/** A real figure in the wrong role ("7 of 7 arrived" when 7 is the head count) is still false. */
const PHRASES: { pattern: RegExp; role: string; allowed: (t: DistrictTally) => number[] }[] = [
  { pattern:/\b(\w+)\s+(?:of\s+\w+\s+)?(?:people\s+|residents\s+)?(?:have\s+|has\s+)?(?:reported\s+|confirmed\s+)?(?:arrived|reached the)/g, role:'arrived', allowed:t => [t.by_status.arrived.length] },
  { pattern:/\b(\w+)\s+(?:of\s+\w+\s+)?(?:people\s+|residents\s+)?(?:are\s+|is\s+|have\s+)?(?:evacuated|out|safe)\b/g, role:'out', allowed:t => [t.by_status.arrived.length, t.by_status.arrived.length + t.by_status.in_transit.length] },
  { pattern:/\b(\w+)\s+(?:of\s+\w+\s+)?(?:people\s+|residents\s+)?(?:are\s+|is\s+|remain\s+|still\s+)*(?:unaccounted|missing|not reached|unreachable)/g, role:'unaccounted for', allowed:t => [t.unaccounted, t.by_status.unknown.length, t.by_status.unreachable.length] },
  { pattern:/\b(\w+)\s+(?:people\s+|residents\s+)?(?:still\s+)?needs?\s+(?:a\s+)?(?:ride|transport|rides)/g, role:'needing a ride', allowed:t => [t.by_status.needs_help.length] },
];
function count(word: string): number | null {
  return /^\d+$/.test(word) ? Number(word) : WORDS.indexOf(word.toLowerCase()) >= 0 ? WORDS.indexOf(word.toLowerCase()) : null;
}
function roleCheck(text: string, tallies: DistrictTally[], extra: number[] = []): string[] {
  const problems: string[] = [];
  for (const { pattern, role, allowed } of PHRASES) for (const m of text.matchAll(pattern)) {
    const n = count(m[1]), ok = new Set([...tallies.flatMap(allowed), ...extra]);
    if (n !== null && !ok.has(n)) problems.push('Says ' + n + ' ' + role + '; records show ' + [...new Set(tallies.flatMap(allowed))].join(' or '));
  }
  return problems;
}
/** Incident-wide figures, shaped like a district tally so the same role checks apply. */
function incidentTally(l: Ledger): DistrictTally {
  const by_status = Object.fromEntries(Object.keys(l.districts[0]?.by_status ?? {}).map(st => [st, l.districts.flatMap(d => d.by_status[st as EvacStatus])])) as DistrictTally['by_status'];
  return { district:{ id:'incident', label:'incident', access:'unknown', location_ids:[] }, total:l.totals.people, by_status, by_tier:{ two_party:0, single_report:0, none:0 }, unaccounted:l.totals.unaccounted, stale:0, last_heard_at:null };
}
function labels(s: AssistanceState): string[] {
  return [...s.scenario.locations.map(l => l.label), s.scenario.title, ...s.people.map(p => p.name)];
}

export function checkClaim(s: AssistanceState, ledger: Ledger, districtId: string, claim: Claim): Check {
  const problems: string[] = [];
  const tally = ledger.districts.find(t => t.district.id === districtId);
  if (!tally) return { ok:false, problems:['Unknown district'] };
  const findings = new Map(s.findings.map(f => [f.id,f])), arrangements = new Map(s.arrangements.map(a => [a.id,a]));
  for (const id of claim.profile_ids) {
    const p = ledger.people.find(p => p.profile_id === id);
    if (!p) problems.push('Cites someone not in this incident (#' + id + ')');
    else if (p.district_id !== districtId) problems.push(p.name + ' is not in this district');
    else if (claim.status && p.status !== claim.status) problems.push('Records show ' + p.name + ' as ' + STATUS_LABEL[p.status] + ', not ' + STATUS_LABEL[claim.status]);
  }
  for (const id of claim.evidence_ids) {
    const f = findings.get(id), a = arrangements.get(id);
    if (!f && !a) problems.push('Cites evidence that does not exist (' + id + ')');
    else if (f && !claim.profile_ids.includes(f.profile_id)) problems.push('Cites a report from someone the claim is not about');
    else if (a && !claim.profile_ids.some(p => p === a.recipient_id || p === a.helper_id)) problems.push('Cites an arrangement the claim is not about');
  }
  // A positive status claim must rest on at least one of each person's supporting records.
  if (claim.status && !UNACCOUNTED.includes(claim.status)) for (const id of claim.profile_ids) {
    const p = ledger.people.find(p => p.profile_id === id);
    if (p && p.status === claim.status && p.evidence_ids.length && !p.evidence_ids.some(e => claim.evidence_ids.includes(e))) problems.push('No supporting report cited for ' + p.name);
  }
  if (claim.status && claim.profile_ids.length === 0) problems.push('A status claim must name the people it covers');
  problems.push(...figuresCheck(claim.text, new Set([...districtFigures(tally), claim.profile_ids.length]), labels(s)));
  problems.push(...roleCheck(claim.text, [tally], [claim.profile_ids.length]));
  return { ok:problems.length === 0, problems };
}

export function checkDistrictReport(s: AssistanceState, ledger: Ledger, report: DistrictReport): NonNullable<DistrictReport['check']> {
  const tally = ledger.districts.find(t => t.district.id === report.district_id);
  const summary: Check = tally ? { ok:true, problems:[...figuresCheck(report.summary, districtFigures(tally), labels(s)), ...roleCheck(report.summary, [tally])] } : { ok:false, problems:['Unknown district'] };
  // Saying "everyone is accounted for" while the ledger has unknowns is the failure we most need to catch.
  if (tally && tally.unaccounted > 0 && /\b(all|everyone|everybody)\b[^.]*\b(accounted|evacuated|out|safe|clear)\b/i.test(report.summary)) summary.problems.push('Implies everyone is accounted for, but ' + tally.unaccounted + ' are not');
  summary.ok = summary.problems.length === 0;
  const seen = new Set<string>(), claims: Record<string,Check> = {};
  for (const claim of report.claims) {
    const check = checkClaim(s,ledger,report.district_id,claim);
    if (seen.has(claim.id)) check.problems.push('Duplicate claim ID');
    seen.add(claim.id); check.ok = check.problems.length === 0; claims[claim.id] = check;
  }
  return { summary, claims };
}

export function checkBrief(s: AssistanceState, ledger: Ledger, reports: Record<string,DistrictReport>, brief: CoreBrief): NonNullable<CoreBrief['check']> {
  const headline: Check = { ok:true, problems:[...figuresCheck(brief.headline, ledgerFigures(ledger), labels(s)), ...roleCheck(brief.headline, [incidentTally(ledger), ...ledger.districts])] };
  if (ledger.totals.unaccounted > 0 && /\b(all|everyone|everybody)\b[^.]*\b(accounted|evacuated|out|safe|clear)\b/i.test(brief.headline)) headline.problems.push('Implies everyone is accounted for, but ' + ledger.totals.unaccounted + ' are not');
  headline.ok = headline.problems.length === 0;
  const lines = brief.district_lines.map(line => {
    const tally = ledger.districts.find(t => t.district.id === line.district_id), report = reports[line.district_id];
    if (!tally) return { ok:false, problems:['Unknown district'] };
    const problems = [...figuresCheck(line.text, districtFigures(tally), labels(s)), ...roleCheck(line.text, [tally])];
    if (tally.unaccounted > 0 && /\b(all|everyone|everybody)\b[^.]*\b(accounted|evacuated|out|safe|clear)\b/i.test(line.text)) problems.push('Implies everyone is accounted for, but ' + tally.unaccounted + ' are not');
    for (const id of line.claim_ids) {
      const claim = report?.claims.find(c => c.id === id);
      if (!claim) problems.push('Cites a district claim that does not exist (' + id + ')');
      else if (report.check && !report.check.claims[id]?.ok) problems.push('Relies on a district claim that failed its check: "' + claim.text + '"');
    }
    return { ok:problems.length === 0, problems };
  });
  return { headline, lines };
}

/** Deterministic report used when the model is unavailable. It only restates the ledger. */
export function ledgerReport(ledger: Ledger, districtId: string, error?: string): DistrictReport {
  const tally = ledger.districts.find(t => t.district.id === districtId)!;
  const claims: Claim[] = Object.entries(tally.by_status).filter(([,ids]) => ids.length).map(([status,ids]) => ({
    id: districtId + ':' + status, status: status as EvacStatus, profile_ids: ids,
    evidence_ids: ids.flatMap(id => ledger.people.find(p => p.profile_id === id)!.evidence_ids.slice(0,2)),
    text: ids.length + ' ' + STATUS_LABEL[status as EvacStatus] + ': ' + ids.map(id => ledger.people.find(p => p.profile_id === id)!.name).join(', '),
  }));
  return { district_id:districtId, based_on_revision:ledger.revision, summary: tally.total + ' people; ' + tally.unaccounted + ' unaccounted for.', claims, questions:[], escalations:[], source:'ledger', ...(error ? { error } : {}) };
}
export function ledgerBrief(ledger: Ledger, now: number, error?: string): CoreBrief {
  const t = ledger.totals;
  return { based_on_revision:ledger.revision, created_at:now, source:'ledger', ...(error ? { error } : {}),
    headline: t.arrived + ' of ' + t.people + ' reported arrived; ' + t.unaccounted + ' unaccounted for.',
    district_lines: ledger.districts.map(d => ({ district_id:d.district.id, claim_ids:[], text: d.total + ' people, ' + d.by_status.arrived.length + ' reported arrived, ' + d.unaccounted + ' unaccounted for.' })),
    disagreements: ledger.disagreements.map(d => d.text), asks_for_human:[] };
}
