# Sealert design

## Connected product

The product restores the original `UpdatedUI` screens, styles, menus, map controls,
forms, call details, export and offline scenario interactions. Do not replace or
simplify these screens while connecting backend features.

`src/updated-ui-api.ts` translates the original UI actions into generic investigation
commands with command IDs and input revisions. Saved organizer notes and coordinator
decisions feed the original conversation component. Registration uses the operator
API. Live map coordinates and graph relationships come from stored profiles;
unrecorded household facts are not populated with demo residents or vehicles.

The original scenario forms are presentation inputs, translated into free-text
context. They do not introduce scenario-specific backend state. The original
helper-acceptance/check-in displays still require their corresponding records;
information collection does not manufacture rescue assignments or safety states.
Generic scope, consent, association and pause controls remain in the backend console.
See `README.md` for the exact connection boundaries and local checkpoint.

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

- Top: the word Sealert, and pills for Checks, Map, Routes, Fire. No logo mark.
- Left: two huge metrics, then the check list
- Right: the match
- Bottom: the live log
