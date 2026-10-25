import { householdFor } from "./households";
import type { CallCard, CallTask, ChatMessage, House, InboundReport, Incident, Place } from "./types";

/**
 * The registrar's book as a file: everything the lead needs after the emergency.
 * One .zip: log.json, the call recordings under audio/, and a readable transcript per call.
 * Tomorrow: the same shape comes from a Convex query over one run, with Twilio recordings.
 */
type Snapshot = {
  place: Place;
  houses: House[];
  calls: CallCard[];
  inbound: InboundReport | null;
  inboundLog: InboundReport[];
  incident: Incident;
  chat: ChatMessage[];
  tasks: CallTask[];
  started: boolean;
  running: boolean;
  recordingFor: (callId: string) => Blob | null;
};

export async function downloadLog(snapshot: Snapshot) {
  const exportedAt = new Date();
  const encode = (text: string) => new TextEncoder().encode(text);
  const audio = new Map<string, string>();
  const files: { name: string; data: Uint8Array }[] = [];
  for (const call of snapshot.calls) {
    const blob = snapshot.recordingFor(call.id);
    if (!blob) continue;
    const name = `audio/${safe(call.id)}.${extension(blob.type)}`;
    audio.set(call.id, name);
    files.push({ name, data: new Uint8Array(await blob.arrayBuffer()) });
  }
  for (const call of snapshot.calls) {
    files.push({ name: `transcripts/${safe(call.id)}.txt`, data: encode(transcriptText(call, audio.get(call.id))) });
  }
  const log = buildLog(snapshot, exportedAt, audio);
  files.unshift({ name: "log.json", data: encode(JSON.stringify(log, null, 2)) });
  const blob = new Blob([zip(files)], { type: "application/zip" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  const pad = (value: number) => String(value).padStart(2, "0");
  const stamp = `${exportedAt.getFullYear()}-${pad(exportedAt.getMonth() + 1)}-${pad(exportedAt.getDate())}-${pad(exportedAt.getHours())}${pad(exportedAt.getMinutes())}`;
  link.href = url;
  link.download = `rideout-log-${snapshot.place.name.toLowerCase()}-${stamp}.zip`;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function buildLog({ place, houses, calls, inbound, inboundLog, incident, chat, tasks, started, running }: Snapshot, exportedAt: Date, audio: Map<string, string>) {
  const iso = (ms: number | null) => (ms ? new Date(ms).toISOString() : null);
  const callsFor = (id: number) => calls.filter((call) => call.householdId === id);

  const events = [
    ...calls.flatMap((call) => [
      { at: call.startedAt, kind: "call_dialed", name: call.name, householdId: call.householdId ?? null, taskId: call.taskId ?? null },
      ...(call.answeredAt ? [{ at: call.answeredAt, kind: "call_answered", name: call.name, householdId: call.householdId ?? null }] : []),
      ...(call.escalation ? [{ at: call.escalation.at, kind: "call_handed_to_person", name: call.name, householdId: call.householdId ?? null }] : []),
      ...(call.endedAt ? [{ at: call.endedAt, kind: `call_${call.phase}`, name: call.name, householdId: call.householdId ?? null }] : []),
    ]),
    ...chat.map((message) => ({ at: message.at, kind: `chat_${message.from}`, text: message.text })),
    ...incident.sightings.map((sighting) => ({ at: sighting.at, kind: sighting.safe ? "child_reported_safe" : "sighting", name: sighting.reporter, text: sighting.text })),
    ...(incident.foundAt ? [{ at: incident.foundAt, kind: "child_marked_found" }] : []),
  ]
    .sort((a, b) => a.at - b.at)
    .map((event) => ({ ...event, at: iso(event.at) }));

  return {
    exportedAt: exportedAt.toISOString(),
    place,
    run: { started, running },
    incident: {
      kind: incident.kind,
      startedAt: iso(incident.startedAt),
      child: incident.child,
      foundAt: iso(incident.foundAt),
      sightings: incident.sightings.map((sighting) => ({ ...sighting, at: iso(sighting.at) })),
    },
    summary: {
      registered: houses.length,
      out: houses.filter((house) => house.status === "out").length,
      withoutRide: houses.filter((house) => house.status === "needs_ride" || house.status === "no_ride").length,
      noAnswer: houses.filter((house) => house.status === "unknown").length,
      notOffered: houses.filter((house) => house.status === "blocked").length,
      callsPlaced: calls.length,
      alertCalls: calls.filter((call) => call.purpose === "alert").length,
      voicemails: calls.filter((call) => call.voicemail).length,
      sightings: incident.sightings.length,
      handedToPerson: calls.filter((call) => call.escalation).length,
      takenByLead: calls.filter((call) => call.handledBy === "operator").length,
      canceledByLead: calls.filter((call) => call.phase === "canceled").length,
      recordings: audio.size,
      leadRequests: tasks.length,
    },
    households: houses.map((house) => {
      const home = householdFor(house.id, house.name);
      return {
        householdId: house.id,
        owner: home.owner,
        address: home.address,
        people: home.people,
        vehicles: home.vehicles,
        needs: home.needs ?? null,
        finalStatus: house.status,
        note: house.note,
        location: { lng: house.lng, lat: house.lat },
        calls: callsFor(house.id).map((call) => call.id),
      };
    }),
    calls: calls.map((call) => ({
      id: call.id,
      householdId: call.householdId ?? null,
      name: call.name,
      requestedBy: call.id.startsWith("lead-") ? "lead_direct" : call.taskId ? "lead_via_facilitator" : call.purpose === "alert" ? "missing_child_alert" : "drill",
      voicemail: Boolean(call.voicemail),
      taskId: call.taskId ?? null,
      handledBy: call.handledBy ?? "agent",
      outcome: call.phase,
      dialedAt: iso(call.startedAt),
      answeredAt: iso(call.answeredAt),
      endedAt: iso(call.endedAt),
      escalation: call.escalation ? { reason: call.escalation.reason, at: iso(call.escalation.at) } : null,
      audioFile: audio.get(call.id) ?? null,
      audioDurationMs: call.recording?.durationMs ?? null,
      transcriptFile: `transcripts/${safe(call.id)}.txt`,
      transcript: call.transcript,
      segments: (call.segments ?? []).map((part) => ({
        at: iso(part.at),
        offsetMs: part.at - call.startedAt,
        speaker: part.speaker,
        text: part.text,
      })),
    })),
    inboundReports: (inboundLog.length ? inboundLog : inbound ? [inbound] : []).map((report) => ({
      from: report.from,
      at: iso(report.at ?? null),
      transcript: report.transcript,
      summary: report.summary ?? null,
      state: report.phase,
    })),
    leadRequests: tasks.map((task) => ({
      id: task.id,
      request: task.request,
      state: task.state,
      createdAt: iso(task.createdAt),
      finishedAt: iso(task.finishedAt),
      targets: task.targets,
      summary: task.summary,
    })),
    facilitatorChat: chat.map((message) => ({ at: iso(message.at), from: message.from, text: message.text })),
    timeline: events,
  };
}

function transcriptText(call: CallCard, audioFile: string | undefined) {
  const stamp = (ms: number) => {
    const total = Math.max(0, Math.round((ms - call.startedAt) / 1000));
    return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
  };
  const who = (speaker: string) => (speaker === "operator" ? "Lead" : speaker === "resident" ? call.name : "System");
  const head = [
    `Call ${call.id} with ${call.name}`,
    `Dialed ${new Date(call.startedAt).toLocaleString()}`,
    `Outcome: ${call.phase}${call.handledBy === "operator" ? " (handled by the lead)" : ""}`,
    audioFile
      ? `Audio: ${audioFile}`
      : call.handledBy === "operator"
        ? "Audio: none (the microphone was not allowed)"
        : "Audio: none (AI-voiced demo call; Twilio records these in production)",
    "",
  ];
  const body = call.segments?.length
    ? call.segments.map((part) => `[${stamp(part.at)}] ${who(part.speaker)}: ${part.text}`)
    : [call.transcript || "(nothing said)"];
  return [...head, ...body, ""].join("\n");
}

function safe(value: string) {
  return value.replace(/[^a-z0-9-]+/gi, "-");
}

function extension(mime: string) {
  if (mime.includes("ogg")) return "ogg";
  if (mime.includes("mp4") || mime.includes("aac")) return "m4a";
  if (mime.includes("wav")) return "wav";
  return "webm";
}

// A minimal ZIP writer (stored, no compression): audio is already compressed and the JSON is small.
function zip(files: { name: string; data: Uint8Array }[]) {
  const encoder = new TextEncoder();
  const now = new Date();
  const dosTime = (now.getHours() << 11) | (now.getMinutes() << 5) | Math.floor(now.getSeconds() / 2);
  const dosDate = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();
  const parts: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  for (const file of files) {
    const name = encoder.encode(file.name);
    const crc = crc32(file.data);
    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true);
    local.setUint16(4, 20, true);
    local.setUint16(6, 0x0800, true);
    local.setUint16(10, dosTime, true);
    local.setUint16(12, dosDate, true);
    local.setUint32(14, crc, true);
    local.setUint32(18, file.data.length, true);
    local.setUint32(22, file.data.length, true);
    local.setUint16(26, name.length, true);
    parts.push(new Uint8Array(local.buffer), name, file.data);
    const entry = new DataView(new ArrayBuffer(46));
    entry.setUint32(0, 0x02014b50, true);
    entry.setUint16(4, 20, true);
    entry.setUint16(6, 20, true);
    entry.setUint16(8, 0x0800, true);
    entry.setUint16(12, dosTime, true);
    entry.setUint16(14, dosDate, true);
    entry.setUint32(16, crc, true);
    entry.setUint32(20, file.data.length, true);
    entry.setUint32(24, file.data.length, true);
    entry.setUint16(28, name.length, true);
    entry.setUint32(42, offset, true);
    central.push(new Uint8Array(entry.buffer), name);
    offset += 30 + name.length + file.data.length;
  }
  const size = central.reduce((sum, part) => sum + part.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, files.length, true);
  end.setUint16(10, files.length, true);
  end.setUint32(12, size, true);
  end.setUint32(16, offset, true);
  return new Blob([...parts, ...central, new Uint8Array(end.buffer)] as BlobPart[]);
}

let crcTable: Uint32Array | null = null;

function crc32(data: Uint8Array) {
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n += 1) {
      let c = n;
      for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[n] = c >>> 0;
    }
  }
  let crc = 0xffffffff;
  for (let i = 0; i < data.length; i += 1) crc = crcTable[(crc ^ data[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}
