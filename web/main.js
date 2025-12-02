// import * as THREE from "https://unpkg.com/three@0.97.0/build/three.module.js";
// import { OrbitControls } from "https://unpkg.com/three@0.97.0/examples/js/controls/OrbitControls.js";
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';


const DATA_BASE_URL = "../data"; // relative to /web/

let renderer, scene, camera, controls;
//let terrainMesh = null;

let meta = null;
let currentLOD = "low"; // "low" or "high"

// Store current height data & dimensions for the active LOD
let currentHeightData = null;
let currentWidth = 0;
let currentHeight = 0;

// Texture for Sri Lanka map overlay
let terrainTexture = null;

// Base vertical scale (world units per meter)
// 🔹 Now set dynamically: start as 1.0, overridden by auto scaling
let BASE_HEIGHT_SCALE = 1.0;
// Current exaggeration multiplier (controlled by slider)
let baseHeightScaleInitialized = false; // for auto visual scaling
let elevationExaggeration = 0.6;

// 🔹 Overlay controls
let overlayEnabled = true;
let overlayOpacity = 1.0; // 0..1

// Store plane dimensions (so we can map world x/z -> lon/lat)
let planeWidth = 0;
let planeHeight = 0;

// Raycasting for mouse position
const raycaster = new THREE.Raycaster();
const mouse = new THREE.Vector2();

let markerGroup = null; // a group to hold all markers

let labelsEnabled = true;

let heatmapStep1 = 0.01;
let heatmapStep2 = 0.05;
let heatmapStep3 = 0.33;
let heatmapStep4 = 0.66;

// Camera height thresholds (world units) to switch LOD
const HIGH_RES_THRESHOLD = 110000; // below this, use high-res
const LOW_RES_THRESHOLD = 130000;  // above this, use low-res

init();

async function init() {

  meta = await fetchJSON(`${DATA_BASE_URL}/meta.json`);

  console.log("Meta data:", meta);

  const container = document.getElementById("app");

  renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setSize(container.clientWidth, container.clientHeight);
  renderer.setPixelRatio(window.devicePixelRatio);
  container.appendChild(renderer.domElement);

  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x282828); // very dark 

  // Camera
  const aspect = container.clientWidth / container.clientHeight;
  camera = new THREE.PerspectiveCamera(45, aspect, 1, 1_000_000);
  camera.position.set(0, 200000, 200000); // move further back

  // Controls
  controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.5;
  controls.minDistance = 5;
  controls.maxDistance = 500000;
  controls.target.set(0, 0, 0);

  // Lights
  const hemiLight = new THREE.HemisphereLight(0xffffff, 0x444444, 1.0);
  hemiLight.position.set(0, 500000, 0);
  scene.add(hemiLight);

  const dirLight = new THREE.DirectionalLight(0xffffff, 1.0); // changed to 1.0
  // Move light above the scene instead of below
  dirLight.position.set(50_000, 120_000, 50_000);
  dirLight.castShadow = true;
  dirLight.shadow.mapSize.width = 4096;
  dirLight.shadow.mapSize.height = 4096;
  dirLight.shadow.camera.near = 1;
  dirLight.shadow.camera.far = 500_000;
  dirLight.shadow.camera.left = -200_000;
  dirLight.shadow.camera.right = 200_000;
  dirLight.shadow.camera.top = 200_000;
  dirLight.shadow.camera.bottom = -200_000;
  scene.add(dirLight);


  markerGroup = new THREE.Group();
  scene.add(markerGroup);


  // 5. Hook up elevation exaggeration slider
  const slider = document.getElementById("exaggerationSlider");
  const input = document.getElementById("exaggerationInput");

  if (slider && input) {
    // Initialize input from current value
    input.value = elevationExaggeration.toFixed(1);

    // Slider → input + exaggeration
    slider.addEventListener("input", () => {
      const val = parseFloat(slider.value);
      elevationExaggeration = val;
      input.value = val.toFixed(1);
      updateTerrainHeights();
    });

    // Input → slider + exaggeration
    input.addEventListener("change", () => {
      let val = parseFloat(input.value);

      if (Number.isNaN(val)) {
        val = elevationExaggeration; // revert to last good
      }

      // Clamp to allowed range
      const min = parseFloat(input.min || "0.2");
      const max = parseFloat(input.max || "5");
      if (val < min) val = min;
      if (val > max) val = max;

      elevationExaggeration = val;
      input.value = val.toFixed(1);
      slider.value = val.toString();
      updateTerrainHeights();
    });
  }

  const toggleLabels = document.getElementById("toggleLabels");
  if (toggleLabels) {
    toggleLabels.addEventListener("change", () => {
      labelsEnabled = toggleLabels.checked;
      updateLabelVisibility();
    });
  }

  const overlayToggle = document.getElementById("overlayToggle");
  if (overlayToggle) {
    overlayToggle.addEventListener("change", () => {
      overlayEnabled = overlayToggle.checked;
      updateOverlayMaterial();
    });
  }

  // 🔹 Overlay transparency slider
  const overlayAlphaSlider = document.getElementById("overlayAlphaSlider");
  const overlayAlphaValue = document.getElementById("overlayAlphaValue");
  if (overlayAlphaSlider && overlayAlphaValue) {
    overlayAlphaSlider.addEventListener("input", () => {
      overlayOpacity = parseFloat(overlayAlphaSlider.value);
      overlayAlphaValue.textContent = overlayOpacity.toFixed(2);
      updateOverlayMaterial();
    });
  }

  const heatmapStep1Input = document.getElementById("heatmapStep1");
  if (heatmapStep1Input) {
    heatmapStep1Input.addEventListener("change", () => {
      heatmapStep1 = parseFloat(heatmapStep1Input.value);
      updateTerrainHeights();
    });
  }
  const heatmapStep2Input = document.getElementById("heatmapStep2");
  if (heatmapStep2Input) {
    heatmapStep2Input.addEventListener("change", () => {
      heatmapStep2 = parseFloat(heatmapStep2Input.value);
      updateTerrainHeights();
    });
  }
  const heatmapStep3Input = document.getElementById("heatmapStep3");
  if (heatmapStep3Input) {
    heatmapStep3Input.addEventListener("change", () => {
      heatmapStep3 = parseFloat(heatmapStep3Input.value);
      updateTerrainHeights();
    });
  }
  const heatmapStep4Input = document.getElementById("heatmapStep4");
  if (heatmapStep4Input) {
    heatmapStep4Input.addEventListener("change", () => {
      heatmapStep4 = parseFloat(heatmapStep4Input.value);
      updateTerrainHeights();
    });
  }
  // 🔹 Load Sri Lanka map texture

  const texLoader = new THREE.TextureLoader();
  texLoader.load(
    `${DATA_BASE_URL}/srilanka_map.png`,
    (tex) => {
      terrainTexture = tex;
      terrainTexture.wrapS = THREE.ClampToEdgeWrapping;
      terrainTexture.wrapT = THREE.ClampToEdgeWrapping;
      terrainTexture.anisotropy = renderer.capabilities.getMaxAnisotropy();

      // If terrain already exists, apply the texture immediately
      // if (terrainMesh) {
      //   terrainMesh.material.map = terrainTexture;
      //   terrainMesh.material.needsUpdate = true;
      // }
      updateOverlayMaterial(); // if overlayMesh already exists, update
    },
    undefined,
    (err) => {
      console.warn("Failed to load srilanka_map.png:", err);
    }
  );

  // 6. Load initial low-res terrain
  await loadTerrain("low");

  markLocation(6.93, 79.84, { label: "Colombo", color: 0x00ff00, radius: 50 });
  markLocation(7.29, 80.63, { label: "Kandy", color: 0x0000ff });
  markLocation(6.807, 80.499, { label: "Sri Pada", color: 0xff0000, radius: 50 });
  markLocation(7, 80.77, { label: "Piduruthalagala", color: 0x00ff00, radius: 50 });
  markLocation(6.79877, 80.76633, { label: "Kirigalpotta", color: 0x00ff00, radius: 50 });

  window.addEventListener("resize", onWindowResize);
  window.addEventListener("mousemove", onMouseMove);

  updateTerrainHeights();
  updateLabelVisibility();

  animate();
}

// New terrain & overlay mesh objects (instead of single terrainMesh)
let baseTerrainMesh = null;
let overlayMesh = null;

function updateLabelVisibility() {
  if (!markerGroup) return;

  markerGroup.children.forEach(marker => {
    // A marker with label has a sprite child
    marker.children.forEach(child => {
      if (child.isSprite) {
        child.visible = labelsEnabled;
      }
      marker.visible = labelsEnabled;
    });
  });
}


// using the new baseTerrainMesh variable in loadTerrain
async function loadTerrain(lod) {
  if (!meta) return;

  // Avoid reloading same LOD if already active
  if (lod === currentLOD && baseTerrainMesh && overlayMesh) return;

  const lodInfo = meta[lod];
  const width = lodInfo.width;
  const height = lodInfo.height;
  const file = lodInfo.file;

  console.log(`Loading ${lod} LOD: ${width} x ${height}`);

  // Load height data as Float32
  const heightData = await fetchBinaryFloat32(
    `${DATA_BASE_URL}/${file}`,
    width * height
  );

  // Store for exaggeration updates
  currentHeightData = heightData;
  currentWidth = width;
  currentHeight = height;

  // Remove old meshes
  if (baseTerrainMesh) {
    scene.remove(baseTerrainMesh);
    baseTerrainMesh.geometry.dispose();
    baseTerrainMesh.material.dispose();
    baseTerrainMesh = null;
  }
  if (overlayMesh) {
    scene.remove(overlayMesh);
    // overlayMesh.geometry is shared, so don't dispose geometry twice
    overlayMesh.material.dispose();
    overlayMesh = null;
  }

  // Map longitude and latitude span to a plane
  const lonSpan = meta.lon_max - meta.lon_min;
  const latSpan = meta.lat_max - meta.lat_min;

  // Choose a world scale so the mesh fits nicely
  const XY_SCALE = 100000 / Math.max(lonSpan, latSpan);

  const planeWidthLocal = lonSpan * XY_SCALE;
  const planeHeightLocal = (latSpan * XY_SCALE);

  // Save for lat/lon mapping
  planeWidth = planeWidthLocal;
  planeHeight = planeHeightLocal;

  // 🔹 Auto “looks good” scaling: compute base height scale once
  if (!baseHeightScaleInitialized) {
    BASE_HEIGHT_SCALE = computeBaseHeightScaleFromMeta();
    baseHeightScaleInitialized = true;
    console.log('Auto base height scale:', BASE_HEIGHT_SCALE);
  }

  const segmentsX = width - 1;
  const segmentsY = height - 1;

  // PlaneGeometry is initially in X-Y plane with normal +Z
  const geometry = new THREE.PlaneGeometry(
    planeWidthLocal,
    planeHeightLocal,
    segmentsX,
    segmentsY
  );

  // Rotate so it's in X-Z plane with Y as "up"
  geometry.rotateX(-Math.PI / 2);

  // 🔹 Base DEM material (solid, shaded)
  // const baseMaterial = new THREE.MeshStandardMaterial({
  //   color: 0x88aa88,
  //   wireframe: false,
  //   flatShading: false,
  //   // roughness: 0.9,
  //   // metalness: 0.0
  // });
  const baseMaterial = new THREE.MeshStandardMaterial({
    color: 0xffffff,      // base color; vertex colors will override
    vertexColors: true,   // 🔹 enable per-vertex colors
    wireframe: false,
    flatShading: false,
  });


  baseTerrainMesh = new THREE.Mesh(geometry, baseMaterial);
  baseTerrainMesh.castShadow = false;
  baseTerrainMesh.receiveShadow = true;
  baseTerrainMesh.position.set(0, 0, 0);
  scene.add(baseTerrainMesh);

  // 🔹 Overlay material (PNG map, transparent, drawn on top)
  const overlayMaterial = new THREE.MeshBasicMaterial({
    map: terrainTexture || null,
    transparent: true,
    opacity: overlayEnabled ? overlayOpacity : 0.0,
    depthWrite: false,
  });

  overlayMesh = new THREE.Mesh(geometry, overlayMaterial);
  overlayMesh.position.set(0, 0, 0);
  overlayMesh.renderOrder = 1; // ensure drawn after base mesh
  overlayMesh.visible = overlayEnabled;
  scene.add(overlayMesh);

  // Apply heights to shared geometry
  updateTerrainHeights();

  currentLOD = lod;
}

// 🔹 Auto “looks good” vertical scaling, based on horiz size & elevation range
function computeBaseHeightScaleFromMeta() {
  if (!meta || planeWidth === 0 || planeHeight === 0) return 1.0;

  const elevRange = meta.max_elev - meta.min_elev || 1;
  const horizSize = Math.max(planeWidth, planeHeight) || 1;

  // reliefRatio controls how "spiky" the terrain looks:
  // lower = more exaggerated, higher = flatter
  const reliefRatio = 40; // tweak to taste

  return (horizSize / reliefRatio) / elevRange;
}

function updateTerrainHeights() {
  if (!baseTerrainMesh || !currentHeightData || !meta) return;

  const geometry = baseTerrainMesh.geometry; // shared with overlayMesh
  const positionAttr = geometry.attributes.position;

  const elevRange = meta.max_elev - meta.min_elev || 1;
  const scale = BASE_HEIGHT_SCALE * elevationExaggeration;

  const width = currentWidth;

  // 🔹 Prepare / get color attribute (3 floats per vertex: r,g,b)
  let colorAttr = geometry.getAttribute("color");
  if (!colorAttr || colorAttr.count !== positionAttr.count) {
    const colors = new Float32Array(positionAttr.count * 3);
    colorAttr = new THREE.BufferAttribute(colors, 3);
    geometry.setAttribute("color", colorAttr);
  }

  for (let i = 0; i < positionAttr.count; i++) {
    const ix = i % width;
    const iy = Math.floor(i / width);

    const hVal = currentHeightData[iy * width + ix];

    // Height in world units
    const heightWorld = (hVal - meta.min_elev) * scale;
    positionAttr.setY(i, heightWorld);

    // 🔹 Normalized elevation [0,1]
    const t = (hVal - meta.min_elev) / elevRange;

    // 🔹 Heatmap color for this elevation
    const { r, g, b } = elevationToHeatColor(hVal, t);
    colorAttr.setX(i, r);
    colorAttr.setY(i, g);
    colorAttr.setZ(i, b);
  }

  positionAttr.needsUpdate = true;
  colorAttr.needsUpdate = true;

  geometry.computeVertexNormals();
}


function elevationToHeatColor(hVal, t) {


  // clamp just in case
  t = Math.max(0, Math.min(1, t));
  let r, g, b;

  //hval 0=0.013682564503518374
  const step1 = heatmapStep1;
  const step2 = heatmapStep2;
  const step3 = heatmapStep3;
  const step4 = heatmapStep4;
  // console.info("zero:", (0 - meta.min_elev) / (meta.max_elev-meta.min_elev));

  if (t < step1) {
    // black → blue
    const k = t / step1;
    r = 0;
    g = 0;
    b = k;
  } else if (t < step2) {
    // blue → green
    const k = (t - step1) / (step2 - step1);
    r = 0;
    g = k;
    b = 1.0 - k;
  } else if (t < step3) {
    // green -> yellow
    const k = (t - step2) / (step3 - step2);
    r = k;
    g = 1.0;
    b = 0;
  } else if (t < step4) {
    // yellow → red
    const k = (t - step3) / (step4 - step3);
    r = 1.0;
    g = 1.0 - k;
    b = 0.0;
  } else {
    // red -> purple
    const k = (t - step4) / (1.0 - step4);
    r = 1.0;
    g = k / 2;
    b = k;
  }

  return { r, g, b };
}


function updateOverlayMaterial() {
  if (!overlayMesh) return;
  const mat = overlayMesh.material;

  overlayMesh.visible = overlayEnabled;

  mat.transparent = true;
  mat.opacity = overlayEnabled ? overlayOpacity : 0.0;

  // keep the texture as-is; we’re not changing mat.map here
  mat.needsUpdate = true;
}

function computeZoomLevel() {
  // Estimate zoom level from camera distance relative to terrain size

  const lonSpan = meta.lon_max - meta.lon_min;
  const latSpan = meta.lat_max - meta.lat_min;

  // Approximate width in world unit
  const XY_SCALE = 100000 / Math.max(lonSpan, latSpan);
  const terrainWidth = lonSpan * XY_SCALE;

  // Distance from camera to the terrain center
  const dist = camera.position.distanceTo(controls.target);

  // Compute zoom-like number (calibrated by hand)
  const normalized = terrainWidth / dist;

  // Use log₂ to get something like a map zoom index
  let zoom = Math.log2(normalized * 4); // tweak *4 for good visual range

  // Clamp to a reasonable range
  zoom = Math.max(1, Math.min(20, zoom));

  return zoom.toFixed(2);
}

function animate() {
  requestAnimationFrame(animate);

  controls.update();

  // LOD switching based on camera distance to target
  const camDistance = camera.position.distanceTo(controls.target);
  if (camDistance < HIGH_RES_THRESHOLD && currentLOD !== "high") {
    loadTerrain("high");
  } else if (camDistance > LOW_RES_THRESHOLD && currentLOD !== "low") {
    loadTerrain("low");
  }

  // 🔹 Update zoom label
  const zoomLabel = document.getElementById("zoomLevel");
  if (zoomLabel) zoomLabel.textContent = computeZoomLevel();

  const camDistLabel = document.getElementById("camDistanceLabel");
  if (camDistLabel)
    camDistLabel.textContent = camera.position.distanceTo(controls.target).toFixed(5);


  renderer.render(scene, camera);
}

function onWindowResize() {
  const container = document.getElementById("app");
  const width = container.clientWidth;
  const height = container.clientHeight;

  camera.aspect = width / height;
  camera.updateProjectionMatrix();

  renderer.setSize(width, height);
}

async function fetchJSON(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to load ${url}: ${res.statusText}`);
  return res.json();
}

async function fetchBinaryFloat32(url, expectedLength) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to load ${url}: ${res.statusText}`);
  const buf = await res.arrayBuffer();
  const arr = new Float32Array(buf);
  if (arr.length !== expectedLength) {
    console.warn(
      `Expected ${expectedLength} float32s from ${url}, got ${arr.length}`
    );
  }
  return arr;
}

// ======================
// lat/lon on mouse hover
// ======================

function onMouseMove(event) {
  if (!renderer || !camera || !baseTerrainMesh || !meta) return;

  const rect = renderer.domElement.getBoundingClientRect();

  // Normalize mouse position to NDC (-1..1)
  mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
  mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

  raycaster.setFromCamera(mouse, camera);

  const intersects = raycaster.intersectObject(baseTerrainMesh);
  const label = document.getElementById("latLonLabel");

  if (!label) return;

  if (intersects.length === 0) {
    label.textContent = "Lat: -, Lon: -";
    return;
  }

  const point = intersects[0].point; // world coordinates

  const lonLat = worldToLonLat(point.x, point.z);
  if (!lonLat) {
    label.textContent = "Lat: -, Lon: -";
    return;
  }

  const { lon, lat } = lonLat;
  label.textContent = `Lat: ${lat.toFixed(5)}, Lon: ${lon.toFixed(5)}`;


  // const eleLabel = document.getElementById("elevLabel");
  // const pointHeight = currentHeightData[point.x, point.z];
  // eleLabel.textContent = pointHeight;
  // console.info("point: ", point);
  // console.info("pointH: ", pointHeight);

}

function worldToLonLat(x, z) {
  if (!meta || planeWidth === 0 || planeHeight === 0) return null;

  const lonSpan = meta.lon_max - meta.lon_min;
  const latSpan = meta.lat_max - meta.lat_min;

  // Plane is centered at (0,0):
  // x ∈ [-planeWidth/2, +planeWidth/2]   -> lon ∈ [lon_min, lon_max]
  // z ∈ [-planeHeight/2, +planeHeight/2] -> lat ∈ [lat_max, lat_min] (because of rotateX(-π/2))

  // u: 0..1 west → east
  const u = (x + planeWidth / 2) / planeWidth;
  // v_raw: 0..1 south → north if z increased northward, BUT here it's flipped, so fix:
  const v_raw = (z + planeHeight / 2) / planeHeight;
  const v = 1 - v_raw; // 0 = south (lat_min), 1 = north (lat_max)

  const lon = meta.lon_min + u * lonSpan;
  const lat = meta.lat_min + v * latSpan;

  return { lon, lat };
}

function lonLatToWorld(lat, lon) {
  if (!meta || planeWidth === 0 || planeHeight === 0) return null;

  const lonSpan = meta.lon_max - meta.lon_min;
  const latSpan = meta.lat_max - meta.lat_min;

  // Normalize lon/lat to [0,1] within DEM bounds
  const u = (lon - meta.lon_min) / lonSpan; // 0..1 west→east
  const v = (lat - meta.lat_min) / latSpan; // 0..1 south→north

  // Map to plane coordinates (plane centered at 0,0)
  const x = u * planeWidth - planeWidth / 2;

  // Because of rotateX(-π/2), z increases southward, so invert v:
  const z = (1 - v) * planeHeight - planeHeight / 2;

  return { x, z };
}

function markLocation(lat, lon, options = {}) {
  if (!baseTerrainMesh || !meta) {
    console.warn("Terrain not ready yet; cannot place marker.");
    return null;
  }

  const worldPos = lonLatToWorld(lat, lon);
  if (!worldPos) {
    console.warn("Could not convert lon/lat to world coordinates.");
    return null;
  }

  const { x, z } = worldPos;

  // We need the Y (height) at that (x,z). Simplest: shoot a ray downwards.
  const ray = new THREE.Raycaster();
  const down = new THREE.Vector3(0, -1, 0);
  const origin = new THREE.Vector3(x, 1000000, z); // high above terrain

  ray.set(origin, down);
  const hits = ray.intersectObject(baseTerrainMesh);
  let y = 0;
  if (hits.length > 0) {
    y = hits[0].point.y;
  }

  const radius = options.radius ?? 50; // adjust to your world scale
  const color = options.color ?? 0xff0000;

  const geom = new THREE.SphereGeometry(radius, 16, 16);
  const mat = new THREE.MeshStandardMaterial({
    color,
    emissive: color,
    emissiveIntensity: 1.0,
  });

  const marker = new THREE.Mesh(geom, mat);
  marker.position.set(x, y + radius * 1.2, z); // slightly above ground

  marker.userData = {
    lat,
    lon,
    ...options,
  };

  markerGroup.add(marker);

  // Optional: simple text label using Sprite
  if (options.label) {
    const sprite = createTextSprite(options.label);
    sprite.position.set(0, radius * 1.5, 0);
    marker.add(sprite);
  }

  updateLabelVisibility();

  return marker;
}

function createTextSprite(text) {
  const fontSize = 60;
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");

  canvas.width = 512;
  canvas.height = 128;

  // ctx.clearRect(0, 0, canvas.width, canvas.height);
  // ctx.fillStyle = "rgba(0, 0, 0, 0.5)";
  // ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.font = `${fontSize}px sans-serif`;
  // ctx.fillStyle = "white";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, canvas.width / 2, canvas.height / 2);

  const texture = new THREE.CanvasTexture(canvas);
  texture.needsUpdate = true;

  const material = new THREE.SpriteMaterial({ map: texture, transparent: true });
  const sprite = new THREE.Sprite(material);
  sprite.scale.set(2000, 500, 1); // adjust to your world scale

  return sprite;
}



