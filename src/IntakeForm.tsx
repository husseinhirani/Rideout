import { useState } from "react";
import type { api, BackendState, IntakeQuestion, IntakeResult } from "./api";
import { eventKey } from "./backend";

type Draft = { name: string; description: string; location: string; time: string; reporterId: string; reporterName: string; relationship: string };

/**
 * The dispatcher's missing-child intake, sent to POST /intake. It goes through the
 * same intake service as an inbound call. The event key is fixed while the form is
 * open, so pressing Open case twice never opens two cases.
 */
export function IntakeForm({
  state,
  onSubmit,
  onClose,
}: {
  state: BackendState;
  onSubmit: (body: Parameters<typeof api.intake>[0]) => Promise<IntakeResult>;
  onClose: () => void;
}) {
  const helpers = new Set(state.demo_mode.helper_ids);
  const reporters = state.profiles.filter((profile) => profile.phone && !helpers.has(profile.id));
  const defaultReporter = reporters.find((profile) => profile.id === state.demo_mode.reporter_id) ?? reporters[0];
  const locations = state.locations ?? [];
  const [key] = useState(eventKey);
  const [draft, setDraft] = useState<Draft>({
    name: "",
    description: "",
    location: "",
    time: "",
    reporterId: defaultReporter ? String(defaultReporter.id) : "",
    reporterName: defaultReporter?.name.replace(/ \(.*\)$/, "") ?? "",
    relationship: "",
  });
  const [questions, setQuestions] = useState<IntakeQuestion[]>([]);
  const [problem, setProblem] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const field = (name: keyof Draft) => ({
    value: draft[name],
    onChange: (event: { target: { value: string } }) => setDraft((current) => ({ ...current, [name]: event.target.value })),
  });
  const asked = (prefix: string) => questions.find((question) => question.field === prefix)?.question;
  const coordinated = state.demo_mode.auto_coordinate && state.demo_mode.helper_ids.length === 2;

  return (
    <div className="modal-scrim" role="presentation" onClick={onClose}>
      <form
        className="glass incident-form"
        role="dialog"
        aria-label="Missing child intake"
        onClick={(event) => event.stopPropagation()}
        onSubmit={async (event) => {
          event.preventDefault();
          setSending(true);
          setProblem(null);
          try {
            const result = await onSubmit({
              event_key: key,
              reporter_profile_id: draft.reporterId ? Number(draft.reporterId) : null,
              child: { name: draft.name, description: draft.description, last_seen_location_id: draft.location, last_seen_time: draft.time },
              reporter: { name: draft.reporterName, relationship: draft.relationship },
            });
            if (result.status === "recorded") onClose();
            else setQuestions(result.questions);
          } catch (error) {
            setProblem(error instanceof Error ? error.message : "Intake was not recorded");
          } finally {
            setSending(false);
          }
        }}
      >
        <p className="kicker hot">Missing child · live case</p>
        <h3>Open a case from what the reporter told you</h3>
        <p className="form-lead">
          RideOut calls the two configured helpers and follows up when they accept. The reporter is self-reported, not verified. Only the original reporter can
          confirm a reunion.
        </p>
        {!coordinated ? <p className="form-lead warn wide">This backend is not running automatic coordination, so it cannot open an intake case.</p> : null}
        <label className="wide">
          Child's name
          <input {...field("name")} placeholder="Ava" />
          {asked("child.name") ? <small className="form-question">{asked("child.name")}</small> : null}
        </label>
        <label className="wide">
          Description and clothing
          <input {...field("description")} placeholder="Age 7, red jacket" />
          {asked("child.description") ? <small className="form-question">{asked("child.description")}</small> : null}
        </label>
        <label>
          Last seen at
          <select {...field("location")}>
            <option value="">Choose a demo point…</option>
            {locations.map((location) => (
              <option key={location.id} value={location.id}>
                {location.label}
              </option>
            ))}
          </select>
          {asked("child.last_seen_location_id") ? <small className="form-question">{asked("child.last_seen_location_id")}</small> : null}
        </label>
        <label>
          Around
          <input {...field("time")} placeholder="15:00" />
          {asked("child.last_seen_time") ? <small className="form-question">{asked("child.last_seen_time")}</small> : null}
        </label>
        <label className="wide">
          Reporter's phone profile
          <select {...field("reporterId")}>
            {reporters.length === 0 ? <option value="">No profile with a phone</option> : null}
            {reporters.map((profile) => (
              <option key={profile.id} value={profile.id}>
                {profile.name} · {profile.phone}
              </option>
            ))}
          </select>
        </label>
        <label>
          Reporter's name
          <input {...field("reporterName")} placeholder="Morgan" />
          {asked("reporter.name") ? <small className="form-question">{asked("reporter.name")}</small> : null}
        </label>
        <label>
          Relationship
          <input {...field("relationship")} placeholder="parent" />
          {asked("reporter.relationship") ? <small className="form-question">{asked("reporter.relationship")}</small> : null}
        </label>
        {questions.length ? <p className="form-lead warn wide">Ask the reporter the questions above, then open the case again.</p> : null}
        {problem ? <p className="form-lead warn wide">{problem}</p> : null}
        <div className="form-actions">
          <button type="button" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="go" disabled={sending || !coordinated}>
            {sending ? "Opening…" : "Open case"}
          </button>
        </div>
      </form>
    </div>
  );
}
