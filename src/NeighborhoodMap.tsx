import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { DRACOLoader } from "three/addons/loaders/DRACOLoader.js";
import { TilesRenderer } from "3d-tiles-renderer/three";
import { GoogleCloudAuthPlugin } from "3d-tiles-renderer/core/plugins";
import { GLTFExtensionsPlugin, ReorientationPlugin, TileCompressionPlugin, TilesFadePlugin } from "3d-tiles-renderer/three/plugins";
import buildingData from "./data/buildings.json";
import landuseData from "./data/landuse.json";
import streetData from "./data/streets.json";
import { householdFor } from "./households";
import type { House, Place, Sighting } from "./types";

type Tip = {
  x: number;
  y: number;
  kicker: string;
  owner: string;
  number: number;
  street: string;
  people: number | string;
  vehicles: string[];
  needs?: string;
  note: string;
};
type Ring = number[][];
type Street = { name: string; kind: string; line: number[][] };
type StreetPiece = { name: string; kind: string; points: { x: number; z: number }[] };
type StreetLabel = { node: HTMLSpanElement; a: THREE.Vector3; b: THREE.Vector3; width: number };
type BuildingFeature = {
  id?: number;
  properties?: { area?: number };
  geometry: { coordinates: Ring[] };
};

type Props = {
  liveData?: boolean;
  place: Place;
  houses: House[];
  onSelect: (id: number) => void;
  angle?: "side" | "aerial";
  simple?: boolean;
  showFire?: boolean;
  sightings?: Sighting[];
};

const STATUS: Record<House["status"], string> = {
  waiting: "Queued",
  out: "Out",
  needs_ride: "Needs a ride",
  unknown: "No answer",
  no_ride: "No ride",
  blocked: "Not offered",
};

const PIN_STATUS = new Set<House["status"]>(["needs_ride", "no_ride", "unknown", "blocked"]);

// With a Google Maps Platform key (Map Tiles API enabled) the block renders as Google's
// photorealistic 3D mesh. Without one it falls back to OSM footprints lifted from the Esri photo.
const GOOGLE_KEY = import.meta.env.VITE_GOOGLE_MAPS_KEY as string | undefined;
const OPEN_CREDIT = "Rockridge. Satellite © Esri, Maxar. Buildings © OpenStreetMap.";
const SIMPLE_CREDIT = "Map data © OpenStreetMap contributors.";
// The simple map borrows the Apple Maps 3D palette: pale ground, gray-blue streets, matte white
// blocks, soft green parks with low-poly trees.
const PAPER = 0xf3f3f0;
const STREET = 0xd4d9df;
const BLOCK = 0xececee;
const BLOCK_HOVER = 0xcfe1ff;
const PARK = 0xcdecb4;
const FIELD = 0xc2e6a6;
const WOOD = 0xb6df9a;
const WATER = 0x8fd1f4;
const LEAF = [0x74c25c, 0x63b14f, 0x86cc6a];
const TRUNK = 0xa48b74;
// How far above the horizon the simple map's camera looks down, about 52 degrees.
const MAP_TILT = 0.9;
const STREET_WIDTH: Record<string, number> = { motorway: 20, trunk: 18, primary: 15, secondary: 13, tertiary: 11 };
const LABEL_KINDS = new Set(["motorway", "trunk", "primary", "secondary", "tertiary", "residential", "unclassified"]);
const UNREACHED = 0xd61f1f;
const UNREACHED_STATUS = new Set<House["status"]>(["unknown"]);
const HAZE = 0x3a302a;
// Common East Bay house paints: cream, warm gray, sage, beige, pale blue, white, tan, olive gray.
const SIDING = [0xe9e2d3, 0xd8d3c8, 0xc9d1c4, 0xe8d9bf, 0xcdd6dd, 0xf2efe9, 0xbfae98, 0xa9b4a5];
const HOVER_GLOW = 0xffb347;
const HOVER_LIFT = 2.2;

export function NeighborhoodMap({ place, houses, onSelect, angle = "side", simple = false, showFire = true, sightings = [], liveData = false }: Props) {
  const container = useRef<HTMLDivElement>(null);
  const housesRef = useRef(houses);
  const liveRef = useRef(liveData);
  liveRef.current = liveData;
  const sightingsRef = useRef(sightings);
  const fireRef = useRef<THREE.Mesh | null>(null);
  sightingsRef.current = sightings;
  const angleRef = useRef(angle);
  const simpleRef = useRef(simple);
  const nudge = useRef<((polar: number, radius: number) => void) | null>(null);
  const northRef = useRef<(() => void) | null>(null);
  const compassRef = useRef<HTMLButtonElement>(null);
  housesRef.current = houses;
  angleRef.current = angle;
  simpleRef.current = simple;

  useEffect(() => {
    nudge.current?.(angle === "aerial" ? 1.42 : 0.5, angle === "aerial" ? 340 : 280);
  }, [angle]);
  useEffect(() => {
    if (fireRef.current) fireRef.current.visible = showFire;
  }, [showFire]);
  useEffect(() => {
    setCredit(simple ? SIMPLE_CREDIT : GOOGLE_KEY ? "Google" : OPEN_CREDIT);
  }, [simple]);
  const showFireRef = useRef(showFire);
  showFireRef.current = showFire;
  const [tip, setTip] = useState<Tip | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [credit, setCredit] = useState(GOOGLE_KEY ? "Google" : OPEN_CREDIT);

  useEffect(() => {
    const node = container.current;
    if (!node) return;

    const features = (buildingData.features as BuildingFeature[]).filter((feature) => {
      const ring = feature.geometry.coordinates[0];
      if (!ring?.length) return false;
      const lat = ring.reduce((sum, point) => sum + point[1], 0) / ring.length;
      return lat > 37.84545;
    });

    let south = 90;
    let north = -90;
    let west = 180;
    let east = -180;
    for (const feature of features) {
      for (const [lng, lat] of feature.geometry.coordinates[0]) {
        south = Math.min(south, lat);
        north = Math.max(north, lat);
        west = Math.min(west, lng);
        east = Math.max(east, lng);
      }
    }
    const midLng = (west + east) / 2;
    const midLat = (south + north) / 2;
    const sharpLng = Math.max((east - west) * 0.95, 0.0022);
    const sharpLat = Math.max((north - south) * 1.15, 0.0016);
    west = midLng - sharpLng;
    east = midLng + sharpLng;
    south = midLat - sharpLat;
    north = midLat + sharpLat;
    const wideWest = midLng - 0.016;
    const wideEast = midLng + 0.016;
    const wideSouth = midLat - 0.012;
    const wideNorth = midLat + 0.012;

    const centerLng = midLng;
    const centerLat = midLat;
    const metersLng = 111320 * Math.cos((centerLat * Math.PI) / 180);
    const metersLat = 110540;
    const minX = (west - centerLng) * metersLng;
    const maxX = (east - centerLng) * metersLng;
    const minZ = (centerLat - north) * metersLat;
    const maxZ = (centerLat - south) * metersLat;
    const wideMinX = (wideWest - centerLng) * metersLng;
    const wideMaxX = (wideEast - centerLng) * metersLng;
    const wideMinZ = (centerLat - wideNorth) * metersLat;
    const wideMaxZ = (centerLat - wideSouth) * metersLat;

    const toWorld = (lng: number, lat: number) => ({
      x: (lng - centerLng) * metersLng,
      z: (centerLat - lat) * metersLat,
    });

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(node.clientWidth, node.clientHeight);
    renderer.setClearColor(0x14110f);
    node.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(38, node.clientWidth / Math.max(node.clientHeight, 1), 0.5, 4000);
    const mapCam = new THREE.PerspectiveCamera(35, node.clientWidth / Math.max(node.clientHeight, 1), 1, 6000);
    const blockSpan = Math.max(maxX - minX, maxZ - minZ);
    // The simple map's view: the ground point it looks at and how far the camera sits from it.
    // heading turns the map: 0 faces north, positive turns the view clockwise.
    const mapView = { x: 0, z: 0, span: blockSpan, heading: 0 };
    // Set by the compass: the map eases back to north over the next frames.
    let toNorth = false;
    const area = { minX: -blockSpan, maxX: blockSpan, minZ: -blockSpan, maxZ: blockSpan };
    const target = new THREE.Vector3(0, 0, 0);
    const view = { azimuth: 0.28, polar: 0.5, radius: 280 };
    const viewCamera = () => (simpleRef.current ? mapCam : camera);
    const mapFog = new THREE.Fog(PAPER, 600, 1600);

    let lerpUntil = 0;
    let goalPolar = view.polar;
    let goalRadius = view.radius;
    nudge.current = (polar, radius) => {
      goalPolar = polar;
      goalRadius = radius;
      lerpUntil = performance.now() + 900;
    };

    const placeMap = () => {
      const width = Math.max(node.clientWidth, 1);
      const height = Math.max(node.clientHeight, 1);
      // The simple map stays on the neighborhood: zoom out stops once all of it is in view,
      // and the point it looks at cannot leave it.
      const reach = Math.max(area.maxX - area.minX, area.maxZ - area.minZ);
      mapView.span = Math.min(Math.max(mapView.span, 70), reach * 1.3);
      mapView.x = Math.min(Math.max(mapView.x, area.minX), area.maxX);
      mapView.z = Math.min(Math.max(mapView.z, area.minZ), area.maxZ);
      mapCam.aspect = width / height;
      mapCam.updateProjectionMatrix();
      // Looking down like a phone map tilted into 3D; the heading swings the camera around the spot it looks at.
      const back = mapView.span * Math.cos(MAP_TILT);
      mapCam.position.set(mapView.x + back * Math.sin(mapView.heading), mapView.span * Math.sin(MAP_TILT), mapView.z + back * Math.cos(mapView.heading));
      mapCam.lookAt(mapView.x, 0, mapView.z);
      mapCam.updateMatrixWorld();
      // The far edge fades into the ground, so the neighborhood ends softly.
      mapFog.near = mapView.span * 1.15;
      mapFog.far = mapView.span * 2.6;
    };

    const placeCamera = () => {
      if (simpleRef.current) {
        placeMap();
        return;
      }
      const aerial = angleRef.current === "aerial";
      const pitch = Math.min(Math.max(view.polar, aerial ? 1.15 : 0.38), aerial ? 1.52 : 0.95);
      view.polar = pitch;
      view.radius = Math.min(Math.max(view.radius, 70), 760);
      const span = Math.max(maxX - minX, maxZ - minZ);
      target.x = Math.min(Math.max(target.x, -span * 0.28), span * 0.28);
      target.z = Math.min(Math.max(target.z, -span * 0.28), span * 0.28);
      camera.position.set(
        target.x + view.radius * Math.sin(view.azimuth) * Math.cos(pitch),
        view.radius * Math.sin(pitch),
        target.z + view.radius * Math.cos(view.azimuth) * Math.cos(pitch),
      );
      camera.lookAt(target);
    };
    placeCamera();

    // Smoke haze hides the edge of the photo and sits the block in the fire's light.
    const haze = new THREE.Fog(HAZE, 700, 1900);
    scene.fog = haze;
    renderer.setClearColor(HAZE);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    const hemi = new THREE.HemisphereLight(0xdde6f2, 0x5a4a3c, 1.5);
    scene.add(hemi);
    // Late-afternoon sun from the west, so shadows fall east where the default camera can see them.
    const sun = new THREE.DirectionalLight(0xffdcb4, 3.2);
    const span = Math.max(maxX - minX, maxZ - minZ);
    sun.position.set(-0.8 * span, 0.62 * span, 0.18 * span);
    sun.castShadow = true;
    sun.shadow.mapSize.set(4096, 4096);
    sun.shadow.camera.left = -span * 0.75;
    sun.shadow.camera.right = span * 0.75;
    sun.shadow.camera.top = span * 0.75;
    sun.shadow.camera.bottom = -span * 0.75;
    sun.shadow.camera.far = span * 3;
    sun.shadow.camera.updateProjectionMatrix();
    sun.shadow.bias = -0.0004;
    sun.shadow.normalBias = 0.4;
    scene.add(sun, sun.target);

    const photoUv = (x: number, z: number) => [(x - minX) / (maxX - minX), 1 - (z - minZ) / (maxZ - minZ)];
    const roofMaterial = new THREE.MeshLambertMaterial({ color: 0x8a8076, side: THREE.DoubleSide });
    const wallMaterial = new THREE.MeshLambertMaterial({ map: facadeTexture(), vertexColors: true });
    const capMaterial = new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false });
    // The hovered house swaps to warmer copies of its materials and grows an outline.
    const wallHot = wallMaterial.clone();
    wallHot.emissive.set(0x5a3510);
    const roofHot = roofMaterial.clone();
    roofHot.emissive.set(0x5a3510);
    const hullMaterial = new THREE.MeshBasicMaterial({ color: HOVER_GLOW, side: THREE.BackSide });
    const edgeMaterial = new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.85 });
    const wideGroundMat = new THREE.MeshLambertMaterial({ color: 0x5b5249 });
    // The sharp photo sits a hair above the wide one so the block's streets stay crisp.
    const sharpGroundMat = new THREE.MeshLambertMaterial({
      color: 0x5b5249,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    });

    const photoreal = GOOGLE_KEY ? createPhotoreal(GOOGLE_KEY, centerLat, centerLng) : null;
    const paper = groundPlane(wideMinX, wideMaxX, wideMinZ, wideMaxZ, flatLayer(PAPER));
    paper.receiveShadow = false;
    paper.visible = false;
    scene.add(paper);
    // A soft, shadowless sun for the simple map: tops of blocks catch it, walls fall a shade darker.
    const mapSun = new THREE.DirectionalLight(0xffffff, 1.7);
    mapSun.position.set(-0.45, 1, 0.55);
    mapSun.visible = false;
    scene.add(mapSun);
    let wideGround: THREE.Mesh | null = null;
    let sharpGround: THREE.Mesh | null = null;
    if (photoreal) {
      photoreal.tiles.setCamera(camera);
      photoreal.tiles.setResolutionFromRenderer(camera, renderer);
      photoreal.tiles.addEventListener("tiles-load-end", () => settleOnGround(photoreal, minX, maxX, minZ, maxZ));
      photoreal.tiles.addEventListener("load-error", () => {
        if (!cancelled) setProblem("Google 3D tiles did not load. Check the key has the Map Tiles API enabled.");
      });
      scene.add(photoreal.holder);
    } else {
      wideGround = groundPlane(wideMinX, wideMaxX, wideMinZ, wideMaxZ, wideGroundMat);
      sharpGround = groundPlane(minX, maxX, minZ, maxZ, sharpGroundMat);
      scene.add(wideGround, sharpGround);
    }

    const simpleGroup = new THREE.Group();
    const simpleMeshes: THREE.Mesh[] = [];
    simpleGroup.visible = false;
    scene.add(simpleGroup);
    const labelLayer = document.createElement("div");
    labelLayer.className = "street-labels";
    node.appendChild(labelLayer);

    const meshes: THREE.Mesh[] = [];
    const byId = new Map<number, THREE.Mesh[]>();
    const footprints: { id: number; ring: { x: number; z: number }[] }[] = [];
    for (const feature of features) {
      const ring = feature.geometry.coordinates[0];
      const unique = ring[0][0] === ring[ring.length - 1][0] && ring[0][1] === ring[ring.length - 1][1] ? ring.slice(0, -1) : ring;
      if (unique.length < 3) continue;
      const shape = new THREE.Shape();
      unique.forEach(([lng, lat], index) => {
        const x = (lng - centerLng) * metersLng;
        const northing = (lat - centerLat) * metersLat;
        if (index === 0) shape.moveTo(x, northing);
        else shape.lineTo(x, northing);
      });
      const id = feature.id ?? 0;
      footprints.push({ id, ring: unique.map(([lng, lat]) => toWorld(lng, lat)) });
      // Rockridge is mostly one- and two-story houses, so size the walls off the real footprint.
      const ring2d = footprints[footprints.length - 1].ring;
      const floorArea = Math.abs(ring2d.reduce((sum, a, i) => {
        const b = ring2d[(i + 1) % ring2d.length];
        return sum + a.x * b.z - b.x * a.z;
      }, 0)) / 2;
      const height = floorArea < 45 ? 3 : floorArea < 260 ? 5 + (Math.abs(id) % 3) * 0.8 : 7 + (Math.abs(id) % 3) * 1.2;
      try {
        // The simple map's houses are plain matte blocks, lit so roofs read lighter than walls.
        const block = new THREE.Mesh(liftedBlock(shape, height), new THREE.MeshLambertMaterial({ color: BLOCK }));
        block.userData = { id };
        simpleGroup.add(block);
        simpleMeshes.push(block);
      } catch {
        // A broken ring still stays out of the simple map.
      }
      if (photoreal) continue;
      let geometry: THREE.ExtrudeGeometry;
      try {
        geometry = new THREE.ExtrudeGeometry(shape, { depth: height, bevelEnabled: false });
      } catch {
        continue;
      }
      const position = geometry.attributes.position;
      for (let i = 0; i < position.count; i += 1) {
        const x = position.getX(i);
        const northing = position.getY(i);
        const h = position.getZ(i);
        position.setXYZ(i, x, h + 0.15, -northing);
      }
      geometry.computeVertexNormals();
      // Siding takes a house color; the facade texture's UVs come out of ExtrudeGeometry in meters.
      const paint = new THREE.Color(SIDING[Math.abs(id) % SIDING.length]);
      const colors = new Float32Array(position.count * 3);
      for (let i = 0; i < position.count; i += 1) paint.toArray(colors, i * 3);
      geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
      const mesh = new THREE.Mesh(geometry, [capMaterial, wallMaterial]);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.userData = { id, base: mesh.material, hot: [capMaterial, wallHot] };
      scene.add(mesh);
      meshes.push(mesh);

      const eave = height + 0.15;
      let roofGeo = hipRoof(footprints[footprints.length - 1].ring, eave);
      if (!roofGeo) {
        roofGeo = new THREE.ShapeGeometry(shape);
        const flat = roofGeo.attributes.position;
        for (let i = 0; i < flat.count; i += 1) flat.setXYZ(i, flat.getX(i), eave + 0.13, -flat.getY(i));
        roofGeo.computeVertexNormals();
      }
      const roofPos = roofGeo.attributes.position;
      const uvs = new Float32Array(roofPos.count * 2);
      for (let i = 0; i < roofPos.count; i += 1) uvs.set(photoUv(roofPos.getX(i), roofPos.getZ(i)), i * 2);
      roofGeo.setAttribute("uv", new THREE.BufferAttribute(uvs, 2));
      const roof = new THREE.Mesh(roofGeo, roofMaterial);
      roof.castShadow = true;
      roof.receiveShadow = true;
      roof.userData = { id, base: roofMaterial, hot: roofHot };
      scene.add(roof);
      meshes.push(roof);
      byId.set(id, [mesh, roof]);
    }

    const grid = streetAngle(footprints);
    simpleGroup.rotation.y = -grid;
    simpleGroup.updateMatrixWorld(true);
    const fitted = new THREE.Box3();
    for (const block of simpleMeshes) fitted.expandByObject(block);
    if (!fitted.isEmpty()) {
      mapView.x = (fitted.min.x + fitted.max.x) / 2;
      mapView.z = (fitted.min.z + fitted.max.z) / 2;
      const margin = 35;
      area.minX = fitted.min.x - margin;
      area.maxX = fitted.max.x + margin;
      area.minZ = fitted.min.z - margin;
      area.maxZ = fitted.max.z + margin;
      mapView.span = Math.max(area.maxX - area.minX, area.maxZ - area.minZ) * 0.9;
    }
    // Streets run on past the neighborhood into the fog; only the ones inside it get names.
    const turn = (lng: number, lat: number) => {
      const point = toWorld(lng, lat);
      const turned = new THREE.Vector3(point.x, 0, point.z).applyMatrix4(simpleGroup.matrixWorld);
      return { x: turned.x, z: turned.z };
    };
    const fade = 280;
    const roads = clipStreets(streetData.streets as Street[], turn, { minX: area.minX - fade, maxX: area.maxX + fade, minZ: area.minZ - fade, maxZ: area.maxZ + fade });
    const streetMesh = new THREE.Mesh(streetRibbons(roads), flatLayer(STREET));
    streetMesh.renderOrder = 3;
    streetMesh.visible = false;
    scene.add(streetMesh);
    const labels = streetLabels(clipStreets(streetData.streets as Street[], turn, area), labelLayer);

    // Parks, fields and water lie flat under the streets; trees stand in parks and woods.
    const land = landuseData as { areas: { kind: string; ring: number[][] }[]; trees: number[][] };
    const green: { kind: string; ring: { x: number; z: number }[] }[] = [];
    for (const patch of land.areas) {
      const ring = patch.ring.map(([lng, lat]) => toWorld(lng, lat));
      const geometry = flatPolygon(ring, 0.05);
      if (!geometry) continue;
      const color = patch.kind === "water" ? WATER : patch.kind === "wood" ? WOOD : patch.kind === "field" ? FIELD : PARK;
      const mesh = new THREE.Mesh(geometry, flatLayer(color));
      mesh.renderOrder = patch.kind === "water" ? 2 : 1;
      simpleGroup.add(mesh);
      green.push({ kind: patch.kind, ring });
    }
    const treeSpots = plantTrees(
      land.trees.map(([lng, lat]) => toWorld(lng, lat)),
      green.filter((patch) => patch.kind === "park" || patch.kind === "wood"),
      footprints.map((footprint) => footprint.ring),
    );
    simpleGroup.add(...treeMeshes(treeSpots));

    const cutLng = west + (east - west) * 0.72;
    const firePoints = [
      toWorld(cutLng, south + (north - south) * 0.08),
      toWorld(east - (east - west) * 0.06, south + (north - south) * 0.08),
      toWorld(east - (east - west) * 0.06, north - (north - south) * 0.08),
      toWorld(cutLng, north - (north - south) * 0.08),
    ];
    const fireGeo = new THREE.BufferGeometry();
    fireGeo.setAttribute(
      "position",
      new THREE.Float32BufferAttribute(firePoints.flatMap((point) => [point.x, 2.2, point.z]), 3),
    );
    fireGeo.setIndex([0, 1, 2, 0, 2, 3]);
    fireGeo.computeVertexNormals();
    const fireMesh = new THREE.Mesh(
      fireGeo,
      new THREE.MeshBasicMaterial({
        color: 0xff5a1f,
        transparent: true,
        opacity: 0.16,
        depthWrite: false,
        // Real terrain rises above the flat overlay, so draw it on top of the mesh.
        depthTest: !photoreal,
        side: THREE.DoubleSide,
      }),
    );
    fireMesh.visible = showFireRef.current;
    fireRef.current = fireMesh;
    scene.add(fireMesh);

    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    let frame = 0;
    let cancelled = false;
    let dragging = false;
    let moved = 0;
    let lastX = 0;
    let lastY = 0;

    const resize = () => {
      const width = node.clientWidth;
      const height = node.clientHeight;
      if (!width || !height) return;
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      renderer.setSize(width, height);
      placeCamera();
      photoreal?.tiles.setResolutionFromRenderer(camera, renderer);
    };
    const observer = new ResizeObserver(resize);
    observer.observe(node);

    const pickAt = (event: PointerEvent) => {
      const rect = node.getBoundingClientRect();
      pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(pointer, viewCamera());
      if (simpleRef.current) {
        const hit = raycaster.intersectObjects(simpleMeshes, false)[0];
        return hit ? (hit.object.userData.id as number) : null;
      }
      if (!photoreal) {
        const hit = raycaster.intersectObjects(meshes, false)[0];
        return hit ? (hit.object.userData.id as number) : null;
      }
      // The Google mesh is one surface, so map the hit point back to the OSM footprint under it.
      const hit = raycaster.intersectObject(photoreal.tiles.group, true)[0];
      if (!hit) return null;
      return footprints.find((footprint) => insideRing(hit.point.x, hit.point.z, footprint.ring))?.id ?? null;
    };

    let hoverId: number | null = null;
    let beacon: THREE.Group | null = null;

    const outline = (mesh: THREE.Mesh) => {
      const existing = mesh.userData.outline as THREE.Group | undefined;
      if (existing) return existing;
      // Inverted hull: a slightly larger back-face copy reads as a rim around the silhouette.
      mesh.geometry.computeBoundingBox();
      const center = mesh.geometry.boundingBox?.getCenter(new THREE.Vector3()) ?? new THREE.Vector3();
      const hull = new THREE.Mesh(mesh.geometry, hullMaterial);
      hull.scale.setScalar(1.12);
      hull.position.copy(center).multiplyScalar(-0.12);
      const group = new THREE.Group();
      group.add(hull, new THREE.LineSegments(new THREE.EdgesGeometry(mesh.geometry, 25), edgeMaterial));
      mesh.add(group);
      mesh.userData.outline = group;
      return group;
    };

    const setHover = (id: number | null) => {
      if (id === hoverId) return;
      for (const mesh of hoverId === null ? [] : byId.get(hoverId) ?? []) {
        mesh.material = mesh.userData.base;
        outline(mesh).visible = false;
      }
      if (beacon) {
        scene.remove(beacon);
        beacon.traverse((child) => (child as THREE.Mesh).geometry?.dispose());
        beacon = null;
      }
      hoverId = id;
      renderer.domElement.style.cursor = id === null ? "" : "pointer";
      if (id === null) return;
      if (simpleRef.current) return;
      if (photoreal) {
        const footprint = footprints.find((item) => item.id === id);
        if (footprint) {
          beacon = footprintBeacon(footprint.ring);
          scene.add(beacon);
        }
        return;
      }
      for (const mesh of byId.get(id) ?? []) {
        mesh.material = mesh.userData.hot;
        outline(mesh).visible = true;
      }
    };

    const hoverAt = (event: PointerEvent) => {
      const rect = node.getBoundingClientRect();
      const id = pickAt(event);
      setHover(id);
      if (id === null) {
        setTip(null);
        return;
      }
      const house = housesRef.current.find((item) => item.id === id);
      const home = liveRef.current ? { owner: house?.name ?? "Not recorded", number: id, address: "Stored map feature", people: "—", vehicles: ["Not recorded"], needs: undefined } : householdFor(id, house?.name);
      const x = Math.min(Math.max(12, event.clientX - rect.left + 16), rect.width - 312);
      const y = Math.min(Math.max(12, event.clientY - rect.top + 16), rect.height - 250);
      setTip({
        x,
        y,
        kicker: house ? STATUS[house.status] : "Not registered",
        owner: home.owner,
        number: home.number,
        street: home.address.replace(/^\d+\s*/, ""),
        people: home.people,
        vehicles: home.vehicles,
        needs: home.needs,
        note: house ? house.note : liveRef.current ? "No resident or safety report is associated with this building." : "Not on the ride check-in list.",
      });
    };
    const onPointerLeave = () => {
      if (dragging) return;
      setHover(null);
      setTip(null);
    };

    // Where a screen point lands on the ground in the simple map, so a drag can pin it under the pointer.
    const ground = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    const groundAt = (clientX: number, clientY: number) => {
      const rect = node.getBoundingClientRect();
      pointer.x = ((clientX - rect.left) / rect.width) * 2 - 1;
      pointer.y = -((clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(pointer, mapCam);
      return raycaster.ray.intersectPlane(ground, new THREE.Vector3());
    };
    let anchor: THREE.Vector3 | null = null;
    // Right-drag or Shift+drag turns the simple map instead of sliding it.
    let turning = false;

    const onPointerDown = (event: PointerEvent) => {
      dragging = true;
      moved = 0;
      lastX = event.clientX;
      lastY = event.clientY;
      turning = simpleRef.current && (event.button === 2 || event.shiftKey);
      anchor = simpleRef.current && !turning ? groundAt(event.clientX, event.clientY) : null;
      if (turning) toNorth = false;
      renderer.domElement.setPointerCapture(event.pointerId);
    };
    const onContextMenu = (event: MouseEvent) => {
      if (simpleRef.current) event.preventDefault();
    };
    northRef.current = () => {
      // Unwind to the nearest north, so the map turns back the short way.
      mapView.heading = Math.atan2(Math.sin(mapView.heading), Math.cos(mapView.heading));
      toNorth = true;
    };
    const onPointerMove = (event: PointerEvent) => {
      if (dragging) {
        const dx = event.clientX - lastX;
        const dy = event.clientY - lastY;
        moved += Math.abs(dx) + Math.abs(dy);
        lastX = event.clientX;
        lastY = event.clientY;
        if (simpleRef.current && turning) {
          mapView.heading += dx * 0.006;
          placeMap();
          return;
        }
        if (simpleRef.current) {
          // Slide the camera so the ground point grabbed at pointerdown stays under the pointer.
          const under = groundAt(event.clientX, event.clientY);
          if (anchor && under) {
            mapView.x += anchor.x - under.x;
            mapView.z += anchor.z - under.z;
            placeMap();
          }
          return;
        }
        view.azimuth -= dx * 0.005;
        view.polar += dy * 0.003;
        placeCamera();
        return;
      }
      hoverAt(event);
    };
    const onPointerUp = (event: PointerEvent) => {
      dragging = false;
      if (moved > 6 || turning) return;
      hoverAt(event);
      const id = pickAt(event);
      if (id && housesRef.current.some((house) => house.id === id)) onSelect(id);
    };
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      if (simpleRef.current) {
        // Zoom about the cursor: the spot under it stays put.
        const before = groundAt(event.clientX, event.clientY);
        mapView.span *= event.deltaY > 0 ? 1.08 : 0.92;
        placeMap();
        const after = groundAt(event.clientX, event.clientY);
        if (before && after) {
          mapView.x += before.x - after.x;
          mapView.z += before.z - after.z;
          placeMap();
        }
        return;
      }
      view.radius *= event.deltaY > 0 ? 1.08 : 0.92;
      placeCamera();
    };

    renderer.domElement.addEventListener("pointerdown", onPointerDown);
    renderer.domElement.addEventListener("pointermove", onPointerMove);
    renderer.domElement.addEventListener("pointerup", onPointerUp);
    renderer.domElement.addEventListener("wheel", onWheel, { passive: false });
    renderer.domElement.addEventListener("pointerleave", onPointerLeave);
    renderer.domElement.addEventListener("contextmenu", onContextMenu);

    let shownSimple: boolean | null = null;
    const paintSimple = () => {
      const missed = new Set(housesRef.current.filter((house) => UNREACHED_STATUS.has(house.status)).map((house) => house.id));
      for (const block of simpleMeshes) {
        const material = block.material as THREE.MeshLambertMaterial;
        const id = block.userData.id as number;
        material.color.set(missed.has(id) ? UNREACHED : id === hoverId ? BLOCK_HOVER : BLOCK);
      }
    };
    // Each street name sits on its longest stretch, upright, and only where that stretch fits it.
    const placeLabels = () => {
      const width = node.clientWidth;
      const height = node.clientHeight;
      const a = new THREE.Vector3();
      const b = new THREE.Vector3();
      for (const label of labels) {
        a.copy(label.a).project(mapCam);
        b.copy(label.b).project(mapCam);
        // A street behind the camera projects backwards, so leave its name off.
        if (a.z > 1 || b.z > 1) {
          label.node.style.visibility = "hidden";
          continue;
        }
        const ax = (a.x * 0.5 + 0.5) * width;
        const ay = (-a.y * 0.5 + 0.5) * height;
        const bx = (b.x * 0.5 + 0.5) * width;
        const by = (-b.y * 0.5 + 0.5) * height;
        const mx = (ax + bx) / 2;
        const my = (ay + by) / 2;
        if (!label.width) label.width = label.node.offsetWidth;
        const fits = Math.hypot(bx - ax, by - ay) > label.width + 24;
        const onScreen = mx > 0 && mx < width && my > 0 && my < height;
        label.node.style.visibility = fits && onScreen ? "visible" : "hidden";
        if (!fits || !onScreen) continue;
        let degrees = (Math.atan2(by - ay, bx - ax) * 180) / Math.PI;
        if (degrees > 90) degrees -= 180;
        if (degrees < -90) degrees += 180;
        label.node.style.transform = `translate(${mx}px, ${my}px) translate(-50%, -50%) rotate(${degrees}deg)`;
      }
    };
    const syncSimple = () => {
      const on = simpleRef.current;
      if (on === shownSimple) return;
      shownSimple = on;
      if (photoreal) photoreal.holder.visible = !on;
      if (wideGround) wideGround.visible = !on;
      if (sharpGround) sharpGround.visible = !on;
      for (const mesh of meshes) {
        mesh.visible = !on;
        if (on) mesh.position.y = 0;
      }
      simpleGroup.visible = on;
      streetMesh.visible = on;
      labelLayer.style.display = on ? "" : "none";
      paper.visible = on;
      if (fireRef.current && on) fireRef.current.visible = false;
      if (fireRef.current && !on) fireRef.current.visible = showFireRef.current;
      sun.visible = !on;
      mapSun.visible = on;
      hemi.color.set(on ? 0xffffff : 0xdde6f2);
      hemi.groundColor.set(on ? 0xb4bcc6 : 0x5a4a3c);
      hemi.intensity = on ? 1.7 : 1.5;
      scene.fog = on ? mapFog : haze;
      renderer.setClearColor(on ? PAPER : HAZE);
      placeCamera();
      if (on) {
        setHover(null);
        setTip(null);
      }
    };

    const animate = () => {
      frame = window.requestAnimationFrame(animate);
      syncSimple();
      if (simpleRef.current) {
        if (toNorth) {
          mapView.heading *= 0.8;
          if (Math.abs(mapView.heading) < 0.001) {
            mapView.heading = 0;
            toNorth = false;
          }
          placeMap();
        }
        compassRef.current?.style.setProperty("--heading", `${mapView.heading}rad`);
        paintSimple();
        placeLabels();
      }
      if (!simpleRef.current && performance.now() < lerpUntil) {
        view.polar += (goalPolar - view.polar) * 0.16;
        view.radius += (goalRadius - view.radius) * 0.16;
        placeCamera();
      }
      if (!simpleRef.current) {
        for (const mesh of meshes) {
          const goal = mesh.userData.id === hoverId ? HOVER_LIFT : 0;
          const gap = goal - mesh.position.y;
          mesh.position.y = Math.abs(gap) < 0.01 ? goal : mesh.position.y + gap * 0.22;
        }
      }
      const width = node.clientWidth;
      const height = node.clientHeight;
      for (const house of housesRef.current) {
        const pin = document.getElementById(`pin-${house.id}`);
        if (!pin) continue;
        if (!liveRef.current && (simpleRef.current || !PIN_STATUS.has(house.status))) {
          pin.style.visibility = "hidden";
          continue;
        }
        const spot = toWorld(house.lng, house.lat);
        const projected = new THREE.Vector3(spot.x, 14, spot.z).project(viewCamera());
        const sx = (projected.x * 0.5 + 0.5) * width;
        const sy = (-projected.y * 0.5 + 0.5) * height;
        const visible = projected.z < 1 && sx > -20 && sx < width + 20 && sy > -20 && sy < height + 20;
        pin.style.visibility = visible ? "visible" : "hidden";
        pin.style.left = `${sx}px`;
        pin.style.top = `${sy}px`;
      }
      for (const sighting of sightingsRef.current) {
        const pin = document.getElementById(sighting.id);
        if (!pin) continue;
        const spot = toWorld(sighting.lng, sighting.lat);
        if (simpleRef.current) {
          pin.style.visibility = "hidden";
          continue;
        }
        const projected = new THREE.Vector3(spot.x, 12, spot.z).project(viewCamera());
        const sx = (projected.x * 0.5 + 0.5) * width;
        const sy = (-projected.y * 0.5 + 0.5) * height;
        const visible = projected.z < 1 && sx > -20 && sx < width + 20 && sy > -20 && sy < height + 20;
        pin.style.visibility = visible ? "visible" : "hidden";
        pin.style.left = `${sx}px`;
        pin.style.top = `${sy}px`;
      }
      if (photoreal && !simpleRef.current) {
        camera.updateMatrixWorld();
        photoreal.tiles.update();
      }
      renderer.render(scene, viewCamera());
    };
    animate();

    const creditTimer = photoreal
      ? window.setInterval(() => {
          const sources = photoreal.tiles
            .getAttributions()
            .filter((item) => item.type === "string" && item.value)
            .map((item) => String(item.value));
          if (!simpleRef.current) setCredit(["Google", ...sources].join(" · "));
        }, 2000)
      : 0;

    const loadPhoto = async () => {
      const [sharpCanvas, wideCanvas] = await Promise.all([
        stitchAerial(west, south, east, north, 19),
        stitchAerial(wideWest, wideSouth, wideEast, wideNorth, 17),
      ]);
      if (cancelled) return;
      const sharpTexture = new THREE.CanvasTexture(sharpCanvas);
      const wideTexture = new THREE.CanvasTexture(wideCanvas);
      sharpTexture.colorSpace = THREE.SRGBColorSpace;
      wideTexture.colorSpace = THREE.SRGBColorSpace;
      sharpTexture.anisotropy = renderer.capabilities.getMaxAnisotropy();
      wideTexture.anisotropy = renderer.capabilities.getMaxAnisotropy();
      for (const [target, map] of [
        [roofMaterial, sharpTexture],
        [roofHot, sharpTexture],
        [sharpGroundMat, sharpTexture],
        [wideGroundMat, wideTexture],
      ] as const) {
        target.map = map;
        target.color.set(0xffffff);
        target.needsUpdate = true;
      }
    };
    if (!photoreal) {
      loadPhoto().catch((error: unknown) => {
        if (!cancelled) setProblem(error instanceof Error ? error.message : "The neighborhood photo did not load.");
      });
    }

    return () => {
      nudge.current = null;
      northRef.current = null;
      cancelled = true;
      window.cancelAnimationFrame(frame);
      window.clearInterval(creditTimer);
      photoreal?.tiles.dispose();
      observer.disconnect();
      renderer.domElement.removeEventListener("pointerdown", onPointerDown);
      renderer.domElement.removeEventListener("pointermove", onPointerMove);
      renderer.domElement.removeEventListener("pointerup", onPointerUp);
      renderer.domElement.removeEventListener("wheel", onWheel);
      renderer.domElement.removeEventListener("pointerleave", onPointerLeave);
      renderer.domElement.removeEventListener("contextmenu", onContextMenu);
      renderer.dispose();
      node.removeChild(renderer.domElement);
      node.removeChild(labelLayer);
    };
  }, [onSelect, place]);

  return (
    <div className={simple ? "scene simple" : "scene"}>
      <div ref={container} className="view-host" />
      {houses.map((house) => (
        <button
          key={house.id}
          id={`pin-${house.id}`}
          type="button"
          className={`pin pin-${house.status}`}
          style={{ visibility: "hidden" }}
          onClick={() => onSelect(house.id)}
        >
          {house.name}
        </button>
      ))}
      {sightings.map((sighting) => (
        <p key={sighting.id} id={sighting.id} className={sighting.safe ? "pin pin-sighting safe" : "pin pin-sighting"} style={{ visibility: "hidden" }}>
          {sighting.label ?? `${sighting.safe ? "Safe here" : "Seen here"} · ${new Date(sighting.at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`}
        </p>
      ))}
      {problem && !simple ? <p className="scene-problem">{problem}</p> : null}
      {tip ? (
        <aside className="hover-card" style={{ left: tip.x, top: tip.y }}>
          <p>{tip.kicker}</p>
          <strong>{tip.owner}</strong>
          <span className="hover-address">
            House #{tip.number} · {tip.street}
          </span>
          <dl>
            <div>
              <dt>People</dt>
              <dd>{tip.people}</dd>
            </div>
            <div>
              <dt>{tip.vehicles.length === 1 ? "Vehicle" : "Vehicles"}</dt>
              <dd>{tip.vehicles.length ? tip.vehicles.join(", ") : "None"}</dd>
            </div>
            {tip.needs ? (
              <div>
                <dt>Needs</dt>
                <dd>{tip.needs}</dd>
              </div>
            ) : null}
          </dl>
          <span>{tip.note}</span>
        </aside>
      ) : null}
      {simple ? (
        <button ref={compassRef} type="button" className="map-compass" onClick={() => northRef.current?.()} aria-label="Turn the map back to north" title="Reset to north · right-drag or Shift+drag to turn">
          <span className="dial">
            <b>N</b>
          </span>
        </button>
      ) : null}
      <p className="credits">{credit}</p>
    </div>
  );
}

type Photoreal = { tiles: TilesRenderer; holder: THREE.Group };

function createPhotoreal(apiToken: string, lat: number, lng: number): Photoreal {
  const tiles = new TilesRenderer();
  const draco = new DRACOLoader().setDecoderPath("https://www.gstatic.com/draco/versioned/decoders/1.5.7/");
  tiles.registerPlugin(new GoogleCloudAuthPlugin({ apiToken, autoRefreshToken: true }));
  tiles.registerPlugin(new GLTFExtensionsPlugin({ dracoLoader: draco }));
  tiles.registerPlugin(new TileCompressionPlugin());
  tiles.registerPlugin(new TilesFadePlugin());
  tiles.registerPlugin(new ReorientationPlugin({ lat: (lat * Math.PI) / 180, lon: (lng * Math.PI) / 180 }));
  // The plugin puts north on +Z and west on +X; this scene uses south on +Z and east on +X.
  const holder = new THREE.Group();
  holder.rotation.y = Math.PI;
  holder.add(tiles.group);
  return { tiles, holder };
}

// Tiles are placed on the ellipsoid, so drop the mesh until the lowest street in view sits at y = 0.
function settleOnGround({ tiles, holder }: Photoreal, minX: number, maxX: number, minZ: number, maxZ: number) {
  holder.updateMatrixWorld(true);
  const ray = new THREE.Raycaster();
  const down = new THREE.Vector3(0, -1, 0);
  let lowest = Infinity;
  for (let i = 0; i <= 4; i += 1) {
    for (let j = 0; j <= 4; j += 1) {
      ray.set(new THREE.Vector3(minX + ((maxX - minX) * i) / 4, 5000, minZ + ((maxZ - minZ) * j) / 4), down);
      const hit = ray.intersectObject(tiles.group, true)[0];
      if (hit) lowest = Math.min(lowest, hit.point.y);
    }
  }
  if (Number.isFinite(lowest)) holder.position.y -= lowest;
}

function streetAngle(footprints: { ring: { x: number; z: number }[] }[]) {
  const bins = new Map<number, number>();
  for (const footprint of footprints) {
    const ring = footprint.ring;
    for (let i = 0; i < ring.length; i += 1) {
      const a = ring[i];
      const b = ring[(i + 1) % ring.length];
      const dx = b.x - a.x;
      const dz = b.z - a.z;
      const length = Math.hypot(dx, dz);
      if (length < 3) continue;
      let angle = Math.atan2(dz, dx);
      angle = ((angle % Math.PI) + Math.PI) % Math.PI;
      if (angle > Math.PI / 2) angle -= Math.PI / 2;
      const bucket = Math.round(angle / (Math.PI / 36));
      bins.set(bucket, (bins.get(bucket) ?? 0) + length);
    }
  }
  let best = 0;
  let weight = 0;
  for (const [bucket, length] of bins) {
    if (length > weight) {
      weight = length;
      best = bucket;
    }
  }
  return best * (Math.PI / 36);
}

// A footprint pushed up into a plain block, in the scene's frame (east +x, south +z, up +y).
function liftedBlock(shape: THREE.Shape, height: number) {
  const geometry = new THREE.ExtrudeGeometry(shape, { depth: height, bevelEnabled: false });
  const position = geometry.attributes.position;
  for (let i = 0; i < position.count; i += 1) {
    position.setXYZ(i, position.getX(i), position.getZ(i), -position.getY(i));
  }
  geometry.computeVertexNormals();
  return geometry;
}

// Ground layers (land, parks, streets) never write depth; renderOrder stacks them, and blocks and trees sit on top.
function flatLayer(color: number) {
  return new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide, depthWrite: false });
}

function flatPolygon(ring: { x: number; z: number }[], y: number) {
  const contour = ring.map((point) => new THREE.Vector2(point.x, point.z));
  const first = contour[0];
  const last = contour[contour.length - 1];
  if (contour.length > 1 && first.equals(last)) contour.pop();
  if (contour.length < 3) return null;
  const faces = THREE.ShapeUtils.triangulateShape(contour, []);
  if (!faces.length) return null;
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(contour.flatMap((point) => [point.x, y, point.y]), 3));
  geometry.setIndex(faces.flat());
  return geometry;
}

type TreeSpot = { x: number; z: number; size: number; tone: number };

// Mapped trees, plus a loose, repeatable scatter through parks and woods that keeps clear of houses.
function plantTrees(mapped: { x: number; z: number }[], patches: { kind: string; ring: { x: number; z: number }[] }[], houses: { x: number; z: number }[][]) {
  const noise = (seed: number) => {
    const value = Math.sin(seed * 12.9898) * 43758.5453;
    return value - Math.floor(value);
  };
  const clear = (x: number, z: number) => !houses.some((ring) => insideRing(x, z, ring));
  const spots: TreeSpot[] = mapped.map((point, index) => ({ ...point, size: 0.9 + noise(index) * 0.4, tone: index % LEAF.length }));
  patches.forEach((patch, patchIndex) => {
    const step = patch.kind === "wood" ? 9 : 15;
    const xs = patch.ring.map((point) => point.x);
    const zs = patch.ring.map((point) => point.z);
    for (let x = Math.min(...xs); x < Math.max(...xs); x += step) {
      for (let z = Math.min(...zs); z < Math.max(...zs); z += step) {
        const seed = patchIndex * 7919 + x * 3.1 + z * 1.7;
        const px = x + (noise(seed) - 0.5) * step * 0.8;
        const pz = z + (noise(seed + 1) - 0.5) * step * 0.8;
        if (noise(seed + 2) < 0.25 || !insideRing(px, pz, patch.ring) || !clear(px, pz)) continue;
        spots.push({ x: px, z: pz, size: 0.8 + noise(seed + 3) * 0.55, tone: Math.floor(noise(seed + 4) * LEAF.length) });
      }
    }
  });
  return spots.slice(0, 900);
}

// Low-poly cone trees, drawn as two instanced meshes so hundreds cost two draw calls.
function treeMeshes(spots: TreeSpot[]) {
  const crown = new THREE.ConeGeometry(2.4, 6.5, 7);
  crown.translate(0, 1.6 + 3.25, 0);
  const stem = new THREE.CylinderGeometry(0.3, 0.42, 1.8, 6);
  stem.translate(0, 0.9, 0);
  const leaves = new THREE.InstancedMesh(crown, new THREE.MeshLambertMaterial({ color: 0xffffff }), Math.max(spots.length, 1));
  const trunks = new THREE.InstancedMesh(stem, new THREE.MeshLambertMaterial({ color: TRUNK }), Math.max(spots.length, 1));
  const matrix = new THREE.Matrix4();
  const color = new THREE.Color();
  spots.forEach((spot, index) => {
    matrix.makeScale(spot.size, spot.size, spot.size).setPosition(spot.x, 0, spot.z);
    leaves.setMatrixAt(index, matrix);
    trunks.setMatrixAt(index, matrix);
    leaves.setColorAt(index, color.set(LEAF[spot.tone]));
  });
  leaves.count = spots.length;
  trunks.count = spots.length;
  return [leaves, trunks];
}

// Cuts each street to the box, segment by segment (Liang-Barsky); a street that leaves and re-enters becomes two pieces.
function clipStreets(streets: Street[], place: (lng: number, lat: number) => { x: number; z: number }, box: { minX: number; maxX: number; minZ: number; maxZ: number }) {
  const pieces: StreetPiece[] = [];
  for (const street of streets) {
    const points = street.line.map(([lng, lat]) => place(lng, lat));
    let piece: StreetPiece | null = null;
    for (let i = 0; i < points.length - 1; i += 1) {
      const a = points[i];
      const b = points[i + 1];
      const dx = b.x - a.x;
      const dz = b.z - a.z;
      let t0 = 0;
      let t1 = 1;
      const edges: [number, number][] = [[-dx, a.x - box.minX], [dx, box.maxX - a.x], [-dz, a.z - box.minZ], [dz, box.maxZ - a.z]];
      let outside = false;
      for (const [p, q] of edges) {
        if (p === 0) {
          if (q < 0) outside = true;
          continue;
        }
        const t = q / p;
        if (p < 0) t0 = Math.max(t0, t);
        else t1 = Math.min(t1, t);
      }
      if (outside || t0 > t1) {
        piece = null;
        continue;
      }
      const start = { x: a.x + dx * t0, z: a.z + dz * t0 };
      const end = { x: a.x + dx * t1, z: a.z + dz * t1 };
      if (!piece || t0 > 0) {
        piece = { name: street.name, kind: street.kind, points: [start] };
        pieces.push(piece);
      }
      piece.points.push(end);
      if (t1 < 1) piece = null;
    }
  }
  return pieces;
}

// Every street as one flat white surface: a quad per segment and a disc at each joint so corners stay round.
function streetRibbons(streets: StreetPiece[]) {
  const positions: number[] = [];
  const y = 0.2;
  const sides = 10;
  for (const street of streets) {
    const half = (STREET_WIDTH[street.kind] ?? 9) / 2;
    const points = street.points;
    points.forEach((a, index) => {
      for (let i = 0; i < sides; i += 1) {
        const t0 = (i / sides) * Math.PI * 2;
        const t1 = ((i + 1) / sides) * Math.PI * 2;
        positions.push(a.x, y, a.z, a.x + Math.cos(t1) * half, y, a.z + Math.sin(t1) * half, a.x + Math.cos(t0) * half, y, a.z + Math.sin(t0) * half);
      }
      const b = points[index + 1];
      if (!b) return;
      const length = Math.hypot(b.x - a.x, b.z - a.z);
      if (length < 0.01) return;
      const nx = (-(b.z - a.z) / length) * half;
      const nz = ((b.x - a.x) / length) * half;
      positions.push(a.x + nx, y, a.z + nz, b.x + nx, y, b.z + nz, b.x - nx, y, b.z - nz);
      positions.push(a.x + nx, y, a.z + nz, b.x - nx, y, b.z - nz, a.x - nx, y, a.z - nz);
    });
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  return geometry;
}

function streetLabels(streets: StreetPiece[], layer: HTMLElement) {
  const longest = new Map<string, { a: { x: number; z: number }; b: { x: number; z: number }; length: number }>();
  for (const street of streets) {
    if (!street.name || !LABEL_KINDS.has(street.kind)) continue;
    const points = street.points;
    for (let i = 0; i < points.length - 1; i += 1) {
      const length = Math.hypot(points[i + 1].x - points[i].x, points[i + 1].z - points[i].z);
      if (length > (longest.get(street.name)?.length ?? 0)) longest.set(street.name, { a: points[i], b: points[i + 1], length });
    }
  }
  const labels: StreetLabel[] = [];
  for (const [name, segment] of longest) {
    const node = document.createElement("span");
    node.className = "street-label";
    node.textContent = shortStreet(name);
    node.style.visibility = "hidden";
    layer.appendChild(node);
    labels.push({ node, a: new THREE.Vector3(segment.a.x, 0.5, segment.a.z), b: new THREE.Vector3(segment.b.x, 0.5, segment.b.z), width: 0 });
  }
  return labels;
}

const STREET_SUFFIX: Record<string, string> = { Avenue: "Ave", Street: "St", Road: "Rd", Drive: "Dr", Place: "Pl", Terrace: "Ter", Boulevard: "Blvd", Court: "Ct", Lane: "Ln" };

function shortStreet(name: string) {
  return name.replace(/\b(Avenue|Street|Road|Drive|Place|Terrace|Boulevard|Court|Lane)$/, (word) => STREET_SUFFIX[word]);
}

function insideRing(x: number, z: number, ring: { x: number; z: number }[]) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const a = ring[i];
    const b = ring[j];
    if (a.z > z !== b.z > z && x < ((b.x - a.x) * (z - a.z)) / (b.z - a.z) + a.x) inside = !inside;
  }
  return inside;
}

// A translucent column over a footprint, for the Google mesh where buildings cannot be lifted.
function footprintBeacon(ring: { x: number; z: number }[]) {
  const shape = new THREE.Shape(ring.map((point) => new THREE.Vector2(point.x, -point.z)));
  const geometry = new THREE.ExtrudeGeometry(shape, { depth: 14, bevelEnabled: false });
  geometry.rotateX(-Math.PI / 2);
  const fill = new THREE.Mesh(
    geometry,
    new THREE.MeshBasicMaterial({ color: HOVER_GLOW, transparent: true, opacity: 0.22, depthTest: false, depthWrite: false }),
  );
  const edges = new THREE.LineSegments(
    new THREE.EdgesGeometry(geometry, 25),
    new THREE.LineBasicMaterial({ color: 0xffffff, depthTest: false }),
  );
  fill.renderOrder = 10;
  edges.renderOrder = 11;
  const group = new THREE.Group();
  group.add(fill, edges);
  return group;
}

// A flat photo plane whose UVs line up with stitchAerial's crop of the same bounds.
function groundPlane(x0: number, x1: number, z0: number, z1: number, material: THREE.Material) {
  const geometry = new THREE.PlaneGeometry(x1 - x0, z1 - z0);
  geometry.rotateX(-Math.PI / 2);
  geometry.translate((x0 + x1) / 2, 0, (z0 + z1) / 2);
  const mesh = new THREE.Mesh(geometry, material);
  mesh.receiveShadow = true;
  return mesh;
}

// One 4.5 m wide, 2.8 m tall bay of painted lap siding with a framed double-hung window,
// tinted per house by vertex color. Canvas bottom is the floor line.
function facadeTexture() {
  const canvas = document.createElement("canvas");
  canvas.width = 384;
  canvas.height = 240;
  const context = canvas.getContext("2d");
  if (context) {
    context.fillStyle = "#fbf8f3";
    context.fillRect(0, 0, 384, 240);
    context.fillStyle = "#e2dcd2";
    for (let y = 0; y < 240; y += 12) context.fillRect(0, y, 384, 2);
    context.fillStyle = "#ffffff";
    context.fillRect(136, 44, 112, 140);
    const glass = context.createLinearGradient(146, 54, 238, 174);
    glass.addColorStop(0, "#7d8c96");
    glass.addColorStop(0.5, "#34404a");
    glass.addColorStop(1, "#222a31");
    context.fillStyle = glass;
    context.fillRect(146, 54, 92, 120);
    context.fillStyle = "#ffffff";
    context.fillRect(146, 110, 92, 7);
    context.fillStyle = "#d4cdc2";
    context.fillRect(130, 184, 124, 8);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(1 / 4.5, 1 / 2.8);
  texture.anisotropy = 8;
  return texture;
}

// Rectangular house footprints get a hip roof: four slopes up to a ridge along the long side.
// Anything else (L shapes, big commercial boxes) keeps a flat roof.
function hipRoof(corners: { x: number; z: number }[], eave: number) {
  if (corners.length !== 4) return null;
  const length = (a: { x: number; z: number }, b: { x: number; z: number }) => Math.hypot(b.x - a.x, b.z - a.z);
  const diagonalA = length(corners[0], corners[2]);
  const diagonalB = length(corners[1], corners[3]);
  if (Math.abs(diagonalA - diagonalB) > 0.12 * Math.max(diagonalA, diagonalB)) return null;
  const sideA = (length(corners[0], corners[1]) + length(corners[2], corners[3])) / 2;
  const sideB = (length(corners[1], corners[2]) + length(corners[3], corners[0])) / 2;
  const long = Math.max(sideA, sideB);
  const short = Math.min(sideA, sideB);
  if (short > 16 || long > 32) return null;
  const [from, to] = sideA >= sideB ? [corners[0], corners[1]] : [corners[1], corners[2]];
  const ux = (to.x - from.x) / length(from, to);
  const uz = (to.z - from.z) / length(from, to);
  const cx = corners.reduce((sum, point) => sum + point.x, 0) / 4;
  const cz = corners.reduce((sum, point) => sum + point.z, 0) / 4;
  const half = Math.max(long / 2 - short / 2, 0);
  const peak = eave + Math.min(short * 0.32, 3.2);
  const ridge = [
    { x: cx - ux * half, z: cz - uz * half },
    { x: cx + ux * half, z: cz + uz * half },
  ];
  const end = (point: { x: number; z: number }) => ((point.x - cx) * ux + (point.z - cz) * uz < 0 ? 0 : 1);
  const positions: number[] = [];
  const triangle = (a: { x: number; z: number }, ay: number, b: { x: number; z: number }, by: number, c: { x: number; z: number }, cy: number) =>
    positions.push(a.x, ay, a.z, b.x, by, b.z, c.x, cy, c.z);
  corners.forEach((a, index) => {
    const b = corners[(index + 1) % 4];
    const ra = end(a);
    const rb = end(b);
    triangle(a, eave, b, eave, ridge[rb], peak);
    if (ra !== rb) triangle(a, eave, ridge[rb], peak, ridge[ra], peak);
  });
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.computeVertexNormals();
  return geometry;
}

async function stitchAerial(west: number, south: number, east: number, north: number, zoom: number) {
  const n = 2 ** zoom;
  const globalX = (lng: number) => ((lng + 180) / 360) * n;
  const globalY = (lat: number) => {
    const rad = (lat * Math.PI) / 180;
    return ((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * n;
  };
  const x0 = Math.floor(globalX(west));
  const x1 = Math.floor(globalX(east));
  const y0 = Math.floor(globalY(north));
  const y1 = Math.floor(globalY(south));
  const tiles = document.createElement("canvas");
  tiles.width = (x1 - x0 + 1) * 256;
  tiles.height = (y1 - y0 + 1) * 256;
  const context = tiles.getContext("2d");
  if (!context) throw new Error("Could not prepare the neighborhood photo.");

  const jobs: Promise<void>[] = [];
  for (let x = x0; x <= x1; x += 1) {
    for (let y = y0; y <= y1; y += 1) {
      jobs.push(
        loadTile(x, y, zoom).then((image) => {
          context.drawImage(image, (x - x0) * 256, (y - y0) * 256);
        }),
      );
    }
  }
  await Promise.all(jobs);

  const left = (globalX(west) - x0) * 256;
  const top = (globalY(north) - y0) * 256;
  const right = (globalX(east) - x0) * 256;
  const bottom = (globalY(south) - y0) * 256;
  const crop = document.createElement("canvas");
  crop.width = Math.max(2, Math.round(right - left));
  crop.height = Math.max(2, Math.round(bottom - top));
  const cropContext = crop.getContext("2d");
  if (!cropContext) throw new Error("Could not crop the neighborhood photo.");
  cropContext.drawImage(tiles, left, top, crop.width, crop.height, 0, 0, crop.width, crop.height);
  return crop;
}

function loadTile(x: number, y: number, zoom: number) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.crossOrigin = "anonymous";
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("A photo tile failed to load."));
    image.src = `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${zoom}/${y}/${x}`;
  });
}
