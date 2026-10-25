import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { TrustBrief } from "../src/TrustBrief";
import { districtLedger } from "../server/shared/districts";
import { checkBrief, checkDistrictReport, type CoreBrief, type DistrictReport } from "../server/shared/trust-check";
import { drill, T } from "../server/tests/district-fixtures";

describe("core agent briefing", () => {
  const session = drill(), ledger = districtLedger(session, T + 3000);
  const report: DistrictReport = { district_id: "west", based_on_revision: 12, summary: "Two arrived by ride; one is unaccounted for.", source: "model", questions: [], escalations: ["Ben Lewis has not been asked yet."],
    claims: [{ id: "c1", text: "2 reported arrived together.", status: "arrived", profile_ids: [1, 2], evidence_ids: ["arrangement:7:1"] }] };
  report.check = checkDistrictReport(session, ledger, report);
  const brief: CoreBrief = { based_on_revision: 12, created_at: T, source: "model", headline: "Everyone in West is out; 7 of 7 arrived.", disagreements: [], asks_for_human: ["Decide whether to call Iris Kim again."],
    district_lines: [{ district_id: "west", text: "Two arrived by ride.", claim_ids: ["c1"] }] };
  brief.check = checkBrief(session, ledger, { west: report }, brief);
  const html = (compact: boolean) => renderToStaticMarkup(<TrustBrief session={{ ...session, ledger, district_reports: { west: report }, briefs: [brief] }} now={T + 3000} compact={compact} unavailable={false} act={async () => true} />);

  it("shows code-computed counts and flags an inflated headline", () => {
    const full = html(false);
    expect(full).toContain("<b>3</b> unaccounted for");
    expect(full).toContain("trust-statement failed");
    expect(full).toContain("1 statement not supported");
    expect(full).toContain("Says 7 arrived; records show 2");
    expect(full).toContain("Declare West community pickup point clear");
    expect(full).toContain("Ben Lewis: situation unknown");
    expect(full).toContain("Decide whether to call Iris Kim again.");
  });
  it("keeps the compact tile to district bars", () => {
    const compact = html(true);
    expect(compact).toContain("1 unaccounted");
    expect(compact).not.toContain("Spot-check");
  });
});
