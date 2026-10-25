import { useMemo, useState } from "react";
import type { BackendState } from "./api";
import { householdFor } from "./households";

type Spot = { id: number; lng: number; lat: number };

/**
 * Registers a neighbor in the backend (POST /profiles). The home is picked from
 * the block's footprints so the new profile lands on the map. A phone left
 * empty means RideOut never calls them.
 */
export function RegisterForm({
  state,
  spots,
  onRegister,
  onClose,
}: {
  state: BackendState;
  spots: Spot[];
  onRegister: (body: { name: string; phone: string; lat: number; lng: number; contact_profile_ids: number[] }) => Promise<unknown>;
  onClose: () => void;
}) {
  const homes = useMemo(
    () => spots.map((spot) => ({ ...spot, address: householdFor(spot.id).address })).sort((a, b) => a.address.localeCompare(b.address, undefined, { numeric: true })),
    [spots],
  );
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [home, setHome] = useState("");
  const [contacts, setContacts] = useState<number[]>([]);
  const [problem, setProblem] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const spot = homes.find((item) => String(item.id) === home);
  const known = state.profiles.filter((profile) => profile.phone);

  return (
    <div className="modal-scrim" role="presentation" onClick={onClose}>
      <form
        className="glass incident-form"
        role="dialog"
        aria-label="Register a neighbor"
        onClick={(event) => event.stopPropagation()}
        onSubmit={async (event) => {
          event.preventDefault();
          if (!spot) return;
          setSending(true);
          setProblem(null);
          try {
            await onRegister({ name, phone, lat: spot.lat, lng: spot.lng, contact_profile_ids: contacts });
            onClose();
          } catch (error) {
            setProblem(error instanceof Error ? error.message : "Not registered");
          } finally {
            setSending(false);
          }
        }}
      >
        <p className="kicker">Registration</p>
        <h3>Register a neighbor</h3>
        <p className="form-lead">Registered neighbors get a check-in call when an incident covers their home, and can be asked to help.</p>
        <label className="wide">
          Name
          <input value={name} onChange={(event) => setName(event.target.value)} placeholder="Helen Cho" required />
        </label>
        <label className="wide">
          Phone
          <input value={phone} onChange={(event) => setPhone(event.target.value)} placeholder="+14155550123 · empty means never called" />
        </label>
        <label className="wide">
          Home
          <select value={home} onChange={(event) => setHome(event.target.value)} required>
            <option value="">Choose a house on the block…</option>
            {homes.map((item) => (
              <option key={item.id} value={item.id}>
                {item.address}
              </option>
            ))}
          </select>
        </label>
        {known.length ? (
          <label className="wide">
            Contacts who know them
            <select
              multiple
              value={contacts.map(String)}
              onChange={(event) => setContacts([...event.target.selectedOptions].map((option) => Number(option.value)))}
            >
              {known.map((profile) => (
                <option key={profile.id} value={profile.id}>
                  {profile.name}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        {problem ? <p className="form-lead warn wide">{problem}</p> : null}
        <div className="form-actions">
          <button type="button" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="go" disabled={sending || !name.trim() || !spot}>
            {sending ? "Saving…" : "Register"}
          </button>
        </div>
      </form>
    </div>
  );
}
