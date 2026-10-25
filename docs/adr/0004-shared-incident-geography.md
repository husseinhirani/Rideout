# Shared incident geography and dynamic matching

Status: accepted, 2026-10-25. Extends ADR0003.

The map and coordinator resolve the same case-specific scenario locations. Directory
coordinates remain directory data and are never substituted for current participant
locations. A seeded starting marker is explicitly unconfirmed. A voice agent must ask
whether it is correct before reporting that location. A correction to unknown removes
the marker instead of restoring the seed.

The drill's distinct starting points come from centroids of actual building footprints
in the bundled OpenStreetMap-derived `src/data/buildings.json`. Each point records its
source feature. Assigning a test participant to one of these coordinates is a simulation,
not a claim about a real resident, occupancy, address or current whereabouts. Default
roster slots contain positions only, never needs, helper roles or predetermined matches.
The private roster configuration may explicitly choose another supplied `location_id`.

Reported locations, needs, vehicle capacity and willingness determine eligible edges.
The matching calculation maximizes the number of recipients served, then minimizes the
sum of Haversine straight-line distances over the eligible assignments. Each helper has
one concurrent pickup, matching the existing reservation rule. The planning model gathers
missing facts, explains the calculated recommendations and proposes them; reducers reject
proposals outside the current recommended assignment. Approved arrangements remain fixed
unless their own eligibility/terms change. Unapproved proposals are reconsidered when new
facts arrive. Names and phone numbers are not inputs to the geographic objective.

The first comparison waits for outstanding information tasks and relevant missing facts.
Blocked questions and unreachable participants remain human-review work rather than
indefinitely stopping the rest of the group. A model cannot combine fresh information
questions with premature geographic proposals in the same committed plan.

Real geometry does not establish safe roads. Parent-zone access and the explicitly
supplied scenario route graph gate eligibility; they remain labeled drill assumptions.
Distance labels and connectors are geographic separation, not driving routes or ETAs.
A live operation would require current location confirmation, authoritative incident
access and road-routing data; these inputs are not fabricated for the demo.

The UI renders the bundled street/building geometry, marker source/confirmation state,
unknown-location list, and actual proposal/arrangement connectors from the same session.
It does not draw hypothetical matches as confirmed assignments.
