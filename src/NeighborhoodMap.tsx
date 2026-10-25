import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { DRACOLoader } from "three/addons/loaders/DRACOLoader.js";
import { TilesRenderer } from "3d-tiles-renderer/three";
import { GoogleCloudAuthPlugin } from "3d-tiles-renderer/core/plugins";
import { GLTFExtensionsPlugin, ReorientationPlugin, TileCompressionPlugin, TilesFadePlugin } from "3d-tiles-renderer/three/plugins";
import buildingData from "./data/buildings.json";
import { householdFor } from "./households";
import type { House, Place, Sighting } from "./types";

type Tip = {
  x: number;
  y: number;
  kicker: string;
  owner: string;
  number: number;
  street: string;
  people: number;
  vehicles: string[];
  needs?: string;
  note: string;
};
type Ring = number[][];
type BuildingFeature = {
  id?: number;
  properties?: { area?: number };
  geometry: { coordinates: Ring[] };
};

type Props = {
  place: Place;
  houses: House[];
  onSelect: (id: number) => void;
  angle?: "side" | "aerial";
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
const HAZE = 0x3a302a;
// Common East Bay house paints: cream, warm gray, sage, beige, pale blue, white, tan, olive gray.
const SIDING = [0xe9e2d3, 0xd8d3c8, 0xc9d1c4, 0xe8d9bf, 0xcdd6dd, 0xf2efe9, 0xbfae98, 0xa9b4a5];
const HOVER_GLOW = 0xffb347;
const HOVER_LIFT = 2.2;

export function NeighborhoodMap({ place, houses, onSelect, angle = "side", showFire = true, sightings = [] }: Props) {
  const container = useRef<HTMLDivElement>(null);
  const housesRef = useRef(houses);
  const sightingsRef = useRef(sightings);
  const fireRef = useRef<THREE.Mesh | null>(null);
  sightingsRef.current = sightings;
  const angleRef = useRef(angle);
  const nudge = useRef<((polar: number, radius: number) => void) | null>(null);
  housesRef.current = houses;
  angleRef.current = angle;

  useEffect(() => {
    nudge.current?.(angle === "aerial" ? 1.42 : 0.5, angle === "aerial" ? 340 : 280);
  }, [angle]);
  useEffect(() => {
    if (fireRef.current) fireRef.current.visible = showFire;
  }, [showFire]);
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
    const target = new THREE.Vector3(0, 0, 0);
    const view = { azimuth: 0.28, polar: 0.5, radius: 280 };

    let lerpUntil = 0;
    let goalPolar = view.polar;
    let goalRadius = view.radius;
    nudge.current = (polar, radius) => {
      goalPolar = polar;
      goalRadius = radius;
      lerpUntil = performance.now() + 900;
    };

    const placeCamera = () => {
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
    scene.fog = new THREE.Fog(HAZE, 700, 1900);
    renderer.setClearColor(HAZE);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    scene.add(new THREE.HemisphereLight(0xdde6f2, 0x5a4a3c, 1.5));
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
    if (photoreal) {
      photoreal.tiles.setCamera(camera);
      photoreal.tiles.setResolutionFromRenderer(camera, renderer);
      photoreal.tiles.addEventListener("tiles-load-end", () => settleOnGround(photoreal, minX, maxX, minZ, maxZ));
      photoreal.tiles.addEventListener("load-error", () => {
        if (!cancelled) setProblem("Google 3D tiles did not load. Check the key has the Map Tiles API enabled.");
      });
      scene.add(photoreal.holder);
    } else {
      scene.add(groundPlane(wideMinX, wideMaxX, wideMinZ, wideMaxZ, wideGroundMat));
      scene.add(groundPlane(minX, maxX, minZ, maxZ, sharpGroundMat));
    }

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
      if (photoreal) continue;
      // Rockridge is mostly one- and two-story houses, so size the walls off the real footprint.
      const ring2d = footprints[footprints.length - 1].ring;
      const floorArea = Math.abs(ring2d.reduce((sum, a, i) => {
        const b = ring2d[(i + 1) % ring2d.length];
        return sum + a.x * b.z - b.x * a.z;
      }, 0)) / 2;
      const height = floorArea < 45 ? 3 : floorArea < 260 ? 5 + (Math.abs(id) % 3) * 0.8 : 7 + (Math.abs(id) % 3) * 1.2;
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
      photoreal?.tiles.setResolutionFromRenderer(camera, renderer);
    };
    const observer = new ResizeObserver(resize);
    observer.observe(node);

    const pickAt = (event: PointerEvent) => {
      const rect = node.getBoundingClientRect();
      pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(pointer, camera);
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
      const home = householdFor(id, house?.name);
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
        note: house ? house.note : "Not on the ride check-in list.",
      });
    };
    const onPointerLeave = () => {
      if (dragging) return;
      setHover(null);
      setTip(null);
    };

    const onPointerDown = (event: PointerEvent) => {
      dragging = true;
      moved = 0;
      lastX = event.clientX;
      lastY = event.clientY;
      renderer.domElement.setPointerCapture(event.pointerId);
    };
    const onPointerMove = (event: PointerEvent) => {
      if (dragging) {
        const dx = event.clientX - lastX;
        const dy = event.clientY - lastY;
        moved += Math.abs(dx) + Math.abs(dy);
        lastX = event.clientX;
        lastY = event.clientY;
        view.azimuth -= dx * 0.005;
        view.polar += dy * 0.003;
        placeCamera();
        return;
      }
      hoverAt(event);
    };
    const onPointerUp = (event: PointerEvent) => {
      dragging = false;
      if (moved > 6) return;
      hoverAt(event);
      const id = pickAt(event);
      if (id && housesRef.current.some((house) => house.id === id)) onSelect(id);
    };
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      view.radius *= event.deltaY > 0 ? 1.08 : 0.92;
      placeCamera();
    };

    renderer.domElement.addEventListener("pointerdown", onPointerDown);
    renderer.domElement.addEventListener("pointermove", onPointerMove);
    renderer.domElement.addEventListener("pointerup", onPointerUp);
    renderer.domElement.addEventListener("wheel", onWheel, { passive: false });
    renderer.domElement.addEventListener("pointerleave", onPointerLeave);

    const animate = () => {
      frame = window.requestAnimationFrame(animate);
      if (performance.now() < lerpUntil) {
        view.polar += (goalPolar - view.polar) * 0.16;
        view.radius += (goalRadius - view.radius) * 0.16;
        placeCamera();
      }
      for (const mesh of meshes) {
        const goal = mesh.userData.id === hoverId ? HOVER_LIFT : 0;
        const gap = goal - mesh.position.y;
        mesh.position.y = Math.abs(gap) < 0.01 ? goal : mesh.position.y + gap * 0.22;
      }
      const width = node.clientWidth;
      const height = node.clientHeight;
      for (const house of housesRef.current) {
        const pin = document.getElementById(`pin-${house.id}`);
        if (!pin) continue;
        if (!PIN_STATUS.has(house.status)) {
          pin.style.visibility = "hidden";
          continue;
        }
        const spot = toWorld(house.lng, house.lat);
        const projected = new THREE.Vector3(spot.x, 14, spot.z).project(camera);
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
        const projected = new THREE.Vector3(spot.x, 12, spot.z).project(camera);
        const sx = (projected.x * 0.5 + 0.5) * width;
        const sy = (-projected.y * 0.5 + 0.5) * height;
        const visible = projected.z < 1 && sx > -20 && sx < width + 20 && sy > -20 && sy < height + 20;
        pin.style.visibility = visible ? "visible" : "hidden";
        pin.style.left = `${sx}px`;
        pin.style.top = `${sy}px`;
      }
      if (photoreal) {
        camera.updateMatrixWorld();
        photoreal.tiles.update();
      }
      renderer.render(scene, camera);
    };
    animate();

    const creditTimer = photoreal
      ? window.setInterval(() => {
          const sources = photoreal.tiles
            .getAttributions()
            .filter((item) => item.type === "string" && item.value)
            .map((item) => String(item.value));
          setCredit(["Google", ...sources].join(" · "));
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
      renderer.dispose();
      node.removeChild(renderer.domElement);
    };
  }, [onSelect, place]);

  return (
    <div className="scene">
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
      {problem ? <p className="scene-problem">{problem}</p> : null}
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
