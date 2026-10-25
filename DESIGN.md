# RideOut design

## Connected product

The live dashboard uses generic investigations and the current operator API.
The UpdatedUI layout keeps the call chart, Matches card and Neighbors chart
on the left, with the coordinator history and composer on the right. Sidebar
previews lead to evidence, organizer controls, incoming reports, the directory
and phone intake. Organizer messages submit directly through the existing
idempotent command API. Saved organizer notes and accepted decisions populate
the conversation history. Missing ride/safety classifications, ride matches and
connected-call duration display as unavailable, never as inferred counts. The teammate's map components are reused.
Scenario-specific stories are available only through explicit offline selection.
Live disconnect retains real state; stored directory coordinates never become
fictional household facts. See `README.md` for local startup and the first UI check.

The map restores UpdatedUI's Side/Aerial/Nodes controls, Simple toggle, statistics,
case and profile panels, hover cards and Start menu. Live building hover shows
geometry only unless actual profile data is associated; Nodes uses stored contact
relationships. The explicit offline story retains its scenario forms, map stats,
export, call controls and takeover panel.

The visual notes below describe the original map/dashboard direction.

Source: the Droneview AI dashboard. The 3D neighborhood is the canvas. Every fact sits in a black, rounded, slightly blurred card on top of it. Type is large enough to read across a table.

## Canvas

- The camera stays on one Rockridge block. The surrounding streets stay in frame as the same clear satellite photo.
- The surface is a real satellite photograph (Esri World Imagery). Each building on the block is that photo lifted to roof height. Google Street View and Google’s photo mesh need a Maps key, which this demo does not have.
- Hovering a house opens its name, status, and need.

## Type

Plus Jakarta Sans.

| Role | Size | Weight |
|---|---|---|
| Metric | 56px | 600 |
| Card title | 22px | 600 |
| Person name | 18px | 600 |
| Body and notes | 16px | 500 |
| Labels | 16px | 500 |
| Nothing smaller than 15px | | |

Labels are sentence case. Numbers use tight tracking.

## Cards

- Fill `rgba(10, 10, 12, 0.78)`
- Blur 18px
- Radius 22px
- Border `1px solid rgba(255, 255, 255, 0.12)`
- Inner rows radius 16px, slightly lighter black
- Accent orange `#ff7a2f` for the live state, the drill button, and warnings
- Text `#ffffff`, secondary `rgba(255, 255, 255, 0.72)`

## Layout

Cards float. They do not split the screen into a rigid app frame.

- Top: the word RideOut, and pills for Checks, Map, Routes, Fire. No logo mark.
- Left: two huge metrics, then the check list
- Right: the match
- Bottom: the live log
