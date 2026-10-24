// Regenerates src/data/routes.json from the public OSRM demo server: `node scripts/gen-routes.mjs`.
// Keep the resident/helper ids in sync with src/data/scenario.ts.
import fs from 'node:fs';
const residents = {
  margaret:[37.85927,-122.23780], rosa:[37.86138,-122.24587], harold:[37.86133,-122.24340],
  esther:[37.86803,-122.24311], james:[37.86116,-122.23847], linh:[37.85694,-122.24272], walter:[37.86637,-122.23264],
};
const helpers = {
  daniel:[37.85919,-122.23550], priya:[37.86336,-122.23537], tom:[37.85930,-122.23303],
  aisha:[37.85685,-122.23536], marcus:[37.85689,-122.23282], sofia:[37.85734,-122.23782],
};
const evac = [37.86970,-122.27280];
const sleep = ms => new Promise(r=>setTimeout(r,ms));
async function route(a,b){
  for (let i=0;i<5;i++){
    try{
      const r = await (await fetch(`https://router.project-osrm.org/route/v1/driving/${a[1]},${a[0]};${b[1]},${b[0]}?overview=full&geometries=geojson`)).json();
      if (r.code!=='Ok') throw new Error(r.code);
      const rt = r.routes[0];
      await sleep(250);
      return { durationS: Math.round(rt.duration), distanceM: Math.round(rt.distance),
        path: rt.geometry.coordinates.map(([x,y])=>[+y.toFixed(5),+x.toFixed(5)]) };
    }catch(e){ console.error('retry',e.message); await sleep(1500); }
  }
  throw new Error('fail');
}
const out = { evac, residents, helpers, direct:{}, toEvac:{}, toPickup:{} };
for (const [h,p] of Object.entries(helpers)) out.direct[h] = await route(p, evac);
for (const [r,p] of Object.entries(residents)) out.toEvac[r] = await route(p, evac);
for (const [h,hp] of Object.entries(helpers)) { out.toPickup[h]={}; for (const [r,rp] of Object.entries(residents)) out.toPickup[h][r] = await route(hp, rp); }
fs.writeFileSync(new URL('../src/data/routes.json', import.meta.url), JSON.stringify(out));
for (const h of Object.keys(helpers)) {
  const row = Object.keys(residents).map(r => {
    const d = out.toPickup[h][r].durationS + out.toEvac[r].durationS - out.direct[h].durationS;
    return `${r}:${(d/60).toFixed(1)}`;
  });
  console.log(h.padEnd(7), (out.direct[h].durationS/60).toFixed(1), row.join('  '));
}
