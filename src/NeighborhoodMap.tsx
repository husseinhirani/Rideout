import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import buildingData from "./data/buildings.json";
import type { House, Place } from "./types";

type Tip = { x: number; y: number; kicker: string; title: string; detail: string };
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

export function NeighborhoodMap({ place, houses, onSelect, angle = "side" }: Props) {
  const container = useRef<HTMLDivElement>(null);
  const housesRef = useRef(houses);
  const angleRef = useRef(angle);
  const nudge = useRef<((polar: number, radius: number) => void) | null>(null);
  housesRef.current = houses;
  angleRef.current = angle;

  useEffect(() => {
    nudge.current?.(angle === "aerial" ? 1.42 : 0.5, angle === "aerial" ? 340 : 280);
  }, [angle]);
  const [tip, setTip] = useState<Tip | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

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

    const roofMaterial = new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide });
    const material = new THREE.ShaderMaterial({
      uniforms: {
        photo: { value: null },
        uMin: { value: new THREE.Vector2(minX, minZ) },
        uSize: { value: new THREE.Vector2(maxX - minX, maxZ - minZ) },
      },
      vertexShader: `
        attribute float roofness;
        attribute vec3 tint;
        varying vec3 vWorld;
        varying vec3 vNormalW;
        varying float vRoof;
        varying vec3 vTint;
        void main() {
          vec4 world = modelMatrix * vec4(position, 1.0);
          vWorld = world.xyz;
          vNormalW = normalize(mat3(modelMatrix) * normal);
          vRoof = roofness;
          vTint = tint;
          gl_Position = projectionMatrix * viewMatrix * world;
        }
      `,
      fragmentShader: `
        precision highp float;
        uniform sampler2D photo;
        uniform vec2 uMin;
        uniform vec2 uSize;
        varying vec3 vWorld;
        varying vec3 vNormalW;
        varying float vRoof;
        varying vec3 vTint;
        void main() {
          vec2 uv = vec2(
            (vWorld.x - uMin.x) / uSize.x,
            1.0 - (vWorld.z - uMin.y) / uSize.y
          );
          vec3 tex = texture2D(photo, clamp(uv, 0.0, 1.0)).rgb;
          vec3 n = normalize(vNormalW);
          float lambert = 0.72 + 0.28 * max(dot(n, normalize(vec3(-0.35, 0.9, 0.22))), 0.0);
          vec3 base = mix(vTint, tex, vRoof);
          gl_FragColor = vec4(base * lambert, 1.0);
        }
      `,
      side: THREE.DoubleSide,
    });

    const ground = new THREE.BufferGeometry();
    ground.setAttribute(
      "position",
      new THREE.Float32BufferAttribute(
        [wideMinX, 0, wideMinZ, wideMaxX, 0, wideMinZ, wideMaxX, 0, wideMaxZ, wideMinX, 0, wideMaxZ],
        3,
      ),
    );
    ground.setIndex([0, 2, 1, 0, 3, 2]);
    ground.computeVertexNormals();
    const groundMat = new THREE.ShaderMaterial({
      uniforms: {
        wideTex: { value: null },
        wideMin: { value: new THREE.Vector2(wideMinX, wideMinZ) },
        wideSize: { value: new THREE.Vector2(wideMaxX - wideMinX, wideMaxZ - wideMinZ) },
      },
      vertexShader: `
        varying vec3 vWorld;
        void main() {
          vec4 world = modelMatrix * vec4(position, 1.0);
          vWorld = world.xyz;
          gl_Position = projectionMatrix * viewMatrix * world;
        }
      `,
      fragmentShader: `
        precision highp float;
        uniform sampler2D wideTex;
        uniform vec2 wideMin;
        uniform vec2 wideSize;
        varying vec3 vWorld;
        void main() {
          vec2 uv = vec2((vWorld.x - wideMin.x) / wideSize.x, 1.0 - (vWorld.z - wideMin.y) / wideSize.y);
          gl_FragColor = vec4(texture2D(wideTex, clamp(uv, 0.0, 1.0)).rgb, 1.0);
        }
      `,
    });
    scene.add(new THREE.Mesh(ground, groundMat));

    const meshes: THREE.Mesh[] = [];
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
      const area = feature.properties?.area ?? 0;
      const id = feature.id ?? 0;
      const height = area < 1.2e-8 ? 3.2 : 6.2 + (Math.abs(id) % 5) * 1.2;
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
      const roofness = new Float32Array(position.count);
      const tint = new Float32Array(position.count * 3);
      for (let i = 0; i < position.count; i += 1) {
        roofness[i] = 0;
        tint[i * 3] = 0.45;
        tint[i * 3 + 1] = 0.42;
        tint[i * 3 + 2] = 0.38;
      }
      geometry.setAttribute("roofness", new THREE.BufferAttribute(roofness, 1));
      geometry.setAttribute("tint", new THREE.BufferAttribute(tint, 3));
      let sampleX = 0;
      let sampleZ = 0;
      unique.forEach(([lng, lat]) => {
        sampleX += (lng - centerLng) * metersLng;
        sampleZ += (centerLat - lat) * metersLat;
      });
      const mesh = new THREE.Mesh(geometry, [
        new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false }),
        material,
      ]);
      mesh.userData = { id, sampleX: sampleX / unique.length, sampleZ: sampleZ / unique.length };
      scene.add(mesh);
      meshes.push(mesh);

      const roofGeo = new THREE.ShapeGeometry(shape);
      const roofPos = roofGeo.attributes.position;
      for (let i = 0; i < roofPos.count; i += 1) {
        roofPos.setXYZ(i, roofPos.getX(i), height + 0.28, -roofPos.getY(i));
      }
      roofGeo.computeVertexNormals();
      const uvs = new Float32Array(roofPos.count * 2);
      for (let i = 0; i < roofPos.count; i += 1) {
        uvs[i * 2] = (roofPos.getX(i) - minX) / (maxX - minX);
        uvs[i * 2 + 1] = 1 - (roofPos.getZ(i) - minZ) / (maxZ - minZ);
      }
      roofGeo.setAttribute("uv", new THREE.BufferAttribute(uvs, 2));
      const roof = new THREE.Mesh(roofGeo, roofMaterial);
      roof.userData = { id };
      scene.add(roof);
      meshes.push(roof);
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
    scene.add(
      new THREE.Mesh(
        fireGeo,
        new THREE.MeshBasicMaterial({ color: 0xff5a1f, transparent: true, opacity: 0.16, depthWrite: false, side: THREE.DoubleSide }),
      ),
    );

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
    };
    const observer = new ResizeObserver(resize);
    observer.observe(node);

    const hoverAt = (event: PointerEvent) => {
      const rect = node.getBoundingClientRect();
      pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(pointer, camera);
      const hit = raycaster.intersectObjects(meshes, false)[0];
      if (!hit) {
        setTip(null);
        return;
      }
      const id = hit.object.userData.id as number;
      const house = housesRef.current.find((item) => item.id === id);
      const x = Math.min(Math.max(12, event.clientX - rect.left + 16), rect.width - 292);
      const y = Math.min(Math.max(12, event.clientY - rect.top + 16), rect.height - 128);
      setTip(
        house
          ? { x, y, kicker: STATUS[house.status], title: house.name, detail: house.note }
          : { x, y, kicker: "Not on the list", title: "No check-in", detail: "This home is not registered for a ride." },
      );
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
      const rect = node.getBoundingClientRect();
      pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(pointer, camera);
      const hit = raycaster.intersectObjects(meshes, false)[0];
      const id = hit?.object.userData.id as number | undefined;
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

    const animate = () => {
      frame = window.requestAnimationFrame(animate);
      if (performance.now() < lerpUntil) {
        view.polar += (goalPolar - view.polar) * 0.16;
        view.radius += (goalRadius - view.radius) * 0.16;
        placeCamera();
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
      renderer.render(scene, camera);
    };
    animate();

    const loadPhoto = async () => {
      const [sharpCanvas, wideCanvas] = await Promise.all([
        stitchAerial(west, south, east, north, 19),
        stitchAerial(wideWest, wideSouth, wideEast, wideNorth, 17),
      ]);
      if (cancelled) return;
      const sharpTexture = new THREE.CanvasTexture(sharpCanvas);
      const wideTexture = new THREE.CanvasTexture(wideCanvas);
      sharpTexture.colorSpace = THREE.LinearSRGBColorSpace;
      wideTexture.colorSpace = THREE.LinearSRGBColorSpace;
      sharpTexture.anisotropy = renderer.capabilities.getMaxAnisotropy();
      wideTexture.anisotropy = renderer.capabilities.getMaxAnisotropy();
      material.uniforms.photo.value = sharpTexture;
      groundMat.uniforms.wideTex.value = wideTexture;
      roofMaterial.map = sharpTexture;
      roofMaterial.needsUpdate = true;
      try {
        paintWalls(meshes, sharpCanvas, minX, minZ, maxX - minX, maxZ - minZ);
      } catch {
        // Walls keep a warm gray if the photo canvas cannot be read back.
      }
    };
    loadPhoto().catch((error: unknown) => {
      if (!cancelled) setProblem(error instanceof Error ? error.message : "The neighborhood photo did not load.");
    });

    return () => {
      nudge.current = null;
      cancelled = true;
      window.cancelAnimationFrame(frame);
      observer.disconnect();
      renderer.domElement.removeEventListener("pointerdown", onPointerDown);
      renderer.domElement.removeEventListener("pointermove", onPointerMove);
      renderer.domElement.removeEventListener("pointerup", onPointerUp);
      renderer.domElement.removeEventListener("wheel", onWheel);
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
      {problem ? <p className="scene-problem">{problem}</p> : null}
      {tip ? (
        <aside className="hover-card" style={{ left: tip.x, top: tip.y }}>
          <p>{tip.kicker}</p>
          <strong>{tip.title}</strong>
          <span>{tip.detail}</span>
        </aside>
      ) : null}
      <p className="credits">Rockridge. Satellite © Esri, Maxar. Buildings © OpenStreetMap.</p>
    </div>
  );
}

function paintWalls(meshes: THREE.Mesh[], canvas: HTMLCanvasElement, minX: number, minZ: number, sizeX: number, sizeZ: number) {
  const context = canvas.getContext("2d");
  if (!context) return;
  for (const mesh of meshes) {
    const sampleX = mesh.userData.sampleX as number | undefined;
    const sampleZ = mesh.userData.sampleZ as number | undefined;
    const roofness = mesh.geometry.attributes.roofness;
    const tint = mesh.geometry.attributes.tint;
    if (sampleX === undefined || sampleZ === undefined || !roofness || !tint) continue;
    const uvX = (sampleX - minX) / sizeX;
    const uvY = 1 - (sampleZ - minZ) / sizeZ;
    const px = Math.min(canvas.width - 1, Math.max(0, Math.round(uvX * (canvas.width - 1))));
    const py = Math.min(canvas.height - 1, Math.max(0, Math.round((1 - uvY) * (canvas.height - 1))));
    const pixel = context.getImageData(px, py, 1, 1).data;
    for (let i = 0; i < roofness.count; i += 1) {
      if (roofness.getX(i) > 0.5) continue;
      tint.setXYZ(i, (pixel[0] / 255) * 0.78, (pixel[1] / 255) * 0.78, (pixel[2] / 255) * 0.78);
    }
    tint.needsUpdate = true;
  }
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
