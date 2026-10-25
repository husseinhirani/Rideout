import { householdFor, householdIdsWhere, STREETS } from "./households";
import type { CallCard, House, HouseStatus, MissingChild, TaskTarget } from "./types";

/**
 * The facilitator desk with the lead in the loop.
 * The lead types a request; the facilitator turns it into a list of houses,
 * hands that job to the check-in caller, and writes the summary when the calls end.
 * Tomorrow: `plan` becomes a Claude call with tools over the Convex tables.
 */

export type Plan = { kind: "calls"; targets: TaskTarget[]; label: string } | { kind: "reply"; text: string };

export type CallScript = {
  answered: boolean;
  lines: string[];
  result?: { status: HouseStatus; note: string };
};

const CALL_WORDS = /\b(call|ring|phone|check|try|reach|dial|recall|contact)\b/;

export function plan(request: string, houses: House[]): Plan {
  const text = request.toLowerCase();
  const asksToCall = CALL_WORDS.test(text);
  if (!asksToCall && /\b(status|who|how many|summary|update)\b/.test(text)) {
    return { kind: "reply", text: statusReport(houses) };
  }

  const picked = new Map<number, TaskTarget>();
  const add = (id: number, name?: string) => {
    if (picked.has(id)) return;
    const home = householdFor(id, name);
    picked.set(id, { householdId: id, name: home.owner, address: home.address, registered: Boolean(name) });
  };
  const nameOf = (id: number) => houses.find((house) => house.id === id)?.name;
  const labels: string[] = [];

  const streets = STREETS.filter((street) => text.includes(street.split(" ")[0].toLowerCase()));
  const numbers = [...text.matchAll(/#?\b(\d{4})\b/g)].map((match) => Number(match[1]));

  for (const number of numbers) {
    const ids = householdIdsWhere(
      (home) => home.number === number && (streets.length === 0 || streets.some((street) => home.address.endsWith(street))),
    );
    if (ids.length === 0) return { kind: "reply", text: `I can't find house ${number}${streets.length ? ` on ${streets.join(" or ")}` : ""}.` };
    if (ids.length > 1) {
      const where = ids.map((id) => householdFor(id, nameOf(id)).address.replace(/^\d+\s*/, "")).join(", ");
      return { kind: "reply", text: `There is a ${number} on ${where}. Which street? For example "call ${number} ${where.split(", ")[0]}".` };
    }
    add(ids[0], nameOf(ids[0]));
    labels.push(`house ${number}`);
  }

  for (const street of numbers.length ? [] : streets) {
    const onStreet = houses.filter((house) => householdFor(house.id, house.name).address.endsWith(street));
    onStreet.forEach((house) => add(house.id, house.name));
    labels.push(`registered houses on ${street}`);
    if (onStreet.length === 0) return { kind: "reply", text: `No registered houses are on ${street}. Name a house number to call one that is not registered.` };
  }

  for (const house of houses) {
    const [first, last] = house.name.toLowerCase().split(" ");
    if (new RegExp(`\\b(${first}|${last})\\b`).test(text)) {
      add(house.id, house.name);
      labels.push(house.name);
    }
  }

  const group = (statuses: HouseStatus[], label: string) => {
    const hits = houses.filter((house) => statuses.includes(house.status));
    hits.forEach((house) => add(house.id, house.name));
    labels.push(label);
    return hits.length;
  };
  if (/(no answer|didn.?t answer|did not answer|missed|unknown|not answer)/.test(text)) {
    if (group(["unknown"], "everyone who did not answer") === 0) return { kind: "reply", text: "Nobody is marked no answer right now." };
  }
  if (/(needs? a ride|needs? rides|stuck|no ride|without a ride|can.?t leave|still waiting)/.test(text)) {
    if (group(["needs_ride", "no_ride"], "everyone still without a ride") === 0) return { kind: "reply", text: "Nobody is waiting for a ride right now." };
  }
  if (/\b(everyone|everybody|all|block|whole|every house|neighborhood)\b/.test(text) && picked.size === 0) {
    group(["waiting", "out", "needs_ride", "unknown", "no_ride", "blocked"], "every registered house on the block");
  }

  if (picked.size === 0) {
    return {
      kind: "reply",
      text: asksToCall
        ? "I could not tell which houses to call. Try a name (\"call Luis\"), a house number (\"call 5530 Manila\"), a street (\"call everyone on Manila Ave\"), or \"call who didn't answer\"."
        : "I can send the caller to any house. Try \"call Luis\", \"call 5530 Manila\", \"call everyone on Manila Ave\", or ask \"who still needs a ride?\"",
    };
  }
  return { kind: "calls", targets: [...picked.values()], label: labels.join(", ") };
}

/**
 * When the AI should stop and get a person: a judgment call, a medical need, or a resident
 * who is confused. Tomorrow this is a `transfer_to_operator(reason)` tool Claude can call mid-call.
 */
export function escalationReason(line: string): string | null {
  const text = line.toLowerCase();
  if (/(oxygen|hospice|chest pain|can.?t breathe|bleeding|insulin|fell down|unconscious)/.test(text)) return "Medical need. A person should decide.";
  if (/(i don.?t understand|who is this|what is this|hello\?|i can.?t hear)/.test(text)) return "The resident sounds confused.";
  if (/\?/.test(text) && /\b(should (i|we)|can someone|could someone|what do (i|we) do|what should|is it safe|go back)\b/.test(text)) {
    return `Asked something the AI should not decide: "${line}"`;
  }
  return null;
}

export function handoff(targets: TaskTarget[], label: string) {
  const list = targets.slice(0, 4).map((target) => `${target.name} (${target.address})`).join(", ");
  const more = targets.length > 4 ? ` and ${targets.length - 4} more` : "";
  return `On it. Passing ${label} to Amina: ${targets.length} ${targets.length === 1 ? "call" : "calls"}. ${list}${more}. I will report back when the calls end.`;
}

export function scriptFor(target: TaskTarget, houses: House[]): CallScript {
  const house = houses.find((item) => item.id === target.householdId);
  if (!house) {
    const answers = seed(target.householdId) % 10 < 7;
    const roll = seed(target.householdId) % 10;
    if (roll < 2) return { answered: false, lines: [] };
    if (roll === 2) return { answered: true, lines: ["Wait, who is this?", "I don't understand what you want."] };
    return { answered: true, lines: [roll % 2 ? "We got the alert." : "Yes, we heard.", "We are getting in the car now."] };
  }
  const helen = houses.find((item) => item.name === "Helen Cho");
  const helenMatched = helen?.note.includes("Daniel") ?? false;
  switch (house.name) {
    case "Helen Cho":
      return helenMatched
        ? { answered: true, lines: ["Daniel is here.", "We are leaving now."], result: { status: "out", note: "Left with Daniel Ruiz, gray Honda." } }
        : { answered: true, lines: ["I'm still here.", "I use a walker and I need a ride."], result: { status: "needs_ride", note: "Walker. Still waiting for a ride." } };
    case "Luis Ortega":
      return {
        answered: true,
        lines: ["I'm still here.", "I need a van that fits my wheelchair."],
        result: { status: house.status === "no_ride" ? "no_ride" : "needs_ride", note: "Wheelchair. Still needs a van that fits." },
      };
    case "Maya Chen":
      return {
        answered: true,
        lines: ["I still have the van.", "The road out crosses the fire, so I'm waiting."],
        result: { status: "blocked", note: "Van. Waiting. Route crosses the fire." },
      };
    case "Priya Shah":
      return house.status === "out"
        ? { answered: true, lines: ["We're already out."], result: { status: "out", note: house.note } }
        : { answered: true, lines: ["Sorry, I missed the first call.", "We're leaving now in the Prius."], result: { status: "out", note: "Answered on the second try. Leaving in the white Prius." } };
    case "Daniel Ruiz":
      return helenMatched
        ? { answered: true, lines: ["I have Helen with me.", "We're on the road."], result: { status: "out", note: "Gray Honda. Driving Helen Cho out." } }
        : { answered: true, lines: ["Leaving in the Honda.", "Two seats are open."], result: { status: "out", note: "Gray Honda. Two seats. Leaving now." } };
    default:
      return house.status === "out"
        ? { answered: true, lines: ["We're already out."], result: { status: "out", note: house.note } }
        : { answered: true, lines: ["Leaving now.", "The car is full."], result: { status: "out", note: "Leaving. Car is full." } };
  }
}

export function summarize(targets: TaskTarget[], calls: CallCard[], houses: House[]) {
  const lines = targets.map((target) => {
    const call = calls.find((item) => item.householdId === target.householdId);
    const house = houses.find((item) => item.id === target.householdId);
    if (!call || call.phase === "missed" || call.phase === "declined") return `• ${target.name}, ${target.address}: no answer.`;
    if (call.phase === "canceled") return `• ${target.name}, ${target.address}: you canceled the call.`;
    if (call.handledBy === "operator") return `• ${target.name}, ${target.address}: you took the call. ${house ? house.note : ""}`.trim();
    return `• ${target.name}, ${target.address}: ${house ? house.note : call.transcript}`;
  });
  const missed = calls.filter((call) => call.phase === "missed" || call.phase === "declined").length;
  const head = `Done. Amina called ${targets.length} ${targets.length === 1 ? "house" : "houses"}: ${targets.length - missed} answered, ${missed} no answer.`;
  const tail = missed ? "\nSay \"call who didn't answer\" to try them again." : "";
  return `${head}\n${lines.join("\n")}${tail}`;
}

function statusReport(houses: House[]) {
  const count = (statuses: HouseStatus[]) => houses.filter((house) => statuses.includes(house.status));
  const waiting = count(["needs_ride", "no_ride"]);
  const unknown = count(["unknown"]);
  const out = count(["out"]);
  const names = (list: House[]) => (list.length ? `: ${list.map((house) => house.name).join(", ")}` : "");
  return [
    `${out.length} of ${houses.length} registered houses are out.`,
    `${waiting.length} still need a ride${names(waiting)}.`,
    `${unknown.length} did not answer${names(unknown)}.`,
  ].join("\n");
}

function seed(value: number) {
  let x = Math.abs(value) | 0;
  x = Math.imul((x >>> 16) ^ x, 0x45d9f3b);
  return ((x >>> 16) ^ x) >>> 0;
}

// Missing child: what the caller reads to every home, and how people answer.
export const SAMPLE_CHILD: MissingChild = {
  name: "Leo Abe",
  age: "9",
  clothing: "a red hoodie and blue jeans",
  lastSeen: "a friend's house on Colby St, around 5:30 PM",
  callback: "(510) 555-0142",
};

export function alertMessage(child: MissingChild) {
  return `A child is missing in your neighborhood: ${child.name}, age ${child.age}, wearing ${child.clothing}. Last seen at ${child.lastSeen}. If you see ${child.name.split(" ")[0]}, call Sealert back at ${child.callback}.`;
}

const ALERT_REPLIES = [
  "Okay. I'll keep an eye out.",
  "Oh no. I'll check our yard and the garage.",
  "Got it. I'll tell my kids to look too.",
  "I'll walk down to College Avenue and look.",
  "Understood. I'll call back if I see him.",
];

// About one home in forty asks something the AI should hand to a person.
export function alertReply(id: number) {
  if (seed(id) % 40 === 0) return "Should I call the police too?";
  return ALERT_REPLIES[seed(id) % ALERT_REPLIES.length];
}

export function alertOutcome(id: number): "answered" | "voicemail" | "missed" {
  const roll = seed(id * 7 + 3) % 20;
  if (roll < 3) return "missed";
  if (roll < 7) return "voicemail";
  return "answered";
}
