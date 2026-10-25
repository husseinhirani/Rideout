import { useState } from "react";
import type { MissingChild } from "./types";

/**
 * What the lead fills in before the caller reads the alert to every home.
 * Starts from the details a parent gave the call taker, when there are any.
 */
export function MissingChildForm({
  initial,
  homes,
  onStart,
  onClose,
}: {
  initial: MissingChild;
  homes: number;
  onStart: (child: MissingChild) => void;
  onClose: () => void;
}) {
  const [child, setChild] = useState(initial);
  const field = (key: keyof MissingChild) => ({
    value: child[key],
    onChange: (event: { target: { value: string } }) => setChild((current) => ({ ...current, [key]: event.target.value })),
  });
  const ready = child.name.trim() && child.clothing.trim() && child.callback.trim();
  const first = child.name.trim().split(" ")[0] || "the child";

  return (
    <div className="modal-scrim" role="presentation" onClick={onClose}>
      <form
        className="glass incident-form"
        role="dialog"
        aria-label="Missing child alert"
        onClick={(event) => event.stopPropagation()}
        onSubmit={(event) => {
          event.preventDefault();
          if (ready) onStart(child);
        }}
      >
        <p className="kicker hot">Missing child alert</p>
        <h3>Call every home on the block</h3>
        <p className="form-lead">
          The caller reads this to all {homes} homes. Anyone who sees {first} calls back, and each sighting is pinned on the map.
        </p>
        <label>
          Name
          <input {...field("name")} placeholder="Leo Abe" required />
        </label>
        <label>
          Age
          <input {...field("age")} placeholder="9" />
        </label>
        <label className="wide">
          Wearing
          <input {...field("clothing")} placeholder="a red hoodie and blue jeans" required />
        </label>
        <label className="wide">
          Last seen
          <input {...field("lastSeen")} placeholder="a friend's house on Colby St, around 5:30 PM" />
        </label>
        <label className="wide">
          Call-back number
          <input {...field("callback")} placeholder="(510) 555-0142" required />
        </label>
        <div className="form-actions">
          <button type="button" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="go" disabled={!ready}>
            Start calling {homes} homes
          </button>
        </div>
      </form>
    </div>
  );
}
