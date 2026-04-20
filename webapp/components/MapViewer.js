'use client';

import { useRef, useEffect, useState, useCallback, useMemo } from 'react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { useSession, signIn } from 'next-auth/react';
import { deriveFromNum, SOUND_NUM_COLORS, SOUND_CLASS_COLORS, SOUND_LETTER_COLORS } from '@/lib/sound-class';
import AuthButton from '@/components/AuthButton';
import MapInfoCard from '@/components/MapInfoCard';
import EditPanel from '@/components/EditPanel';
import ImportDialog from '@/components/ImportDialog';

const SOURCE_ID = 'geojson-data';
const DRAW_SOURCE_ID = 'draw-preview';
const NODE_SOURCE_ID = 'node-edit';
const LAYER_IDS = {
  polygonFill: 'layer-polygon-fill',
  polygonOutline: 'layer-polygon-outline',
  line: 'layer-line',
  point: 'layer-point',
  pointArrow: 'layer-point-arrow',
};
const LAYER_IDS_AZ = {
  circle: 'layer-azimuth-circle',
  sector: 'layer-azimuth-sector',
  polyCircle: 'layer-azimuth-poly-circle',
  polySector: 'layer-azimuth-poly-sector',
  polygonArrow: 'layer-azimuth-polygon-arrow',
};
const AZIMUTH_SECTORS_SOURCE_ID = 'azimuth-sectors';
const AZIMUTH_SECTOR_RADIUS_M =20; // base radius at ZOOM level; scaled by zoom → constant ~22 px on screen
const INTERACTIVE_LAYERS = [LAYER_IDS.pointArrow, LAYER_IDS.point, LAYER_IDS.polygonFill, LAYER_IDS.line];

const CENTER = [14.923, 57.620]; // Alversjö
const ZOOM = 15.5;
const SMART_IMPORT_FIELDS = {
  names:       ['title', 'point-num'],
  soundClass:  ['sound-class', 'sound-class-num'],
  otherFields: ['description', 'sound-direction-azimuth', 'sound-direction-azimuth-from', 'sound-direction-azimuth-to',
                'sound-direction-comment', 'camp-in-2025', 'camp-in-2024', 'camp-in-2023', 'upgrade-actions'],
};
const NAME_MATCH_TOLERANCE = 0.00012;
const NAME_MATCH_CONFIDENCE = 0.72;
const EPSILON = 1e-9;

const LOCAL_SATELLITE_STYLE = {
  version: 8,
  glyphs: 'https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf',
  sources: {
    satellite: {
      type: 'raster',
      tiles: ['/tiles/satellite/{z}/{x}/{y}.jpg'],
      tileSize: 256,
      minzoom: 13,
      maxzoom: 17,
    },
  },
  layers: [{ id: 'satellite-layer', type: 'raster', source: 'satellite', paint: { 'raster-saturation': -1 } }],
};

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function destPoint(lng, lat, bearingDeg, meters) {
  const R = 6378137;
  const br = (bearingDeg * Math.PI) / 180;
  const lat1 = (lat * Math.PI) / 180;
  const dR = meters / R;
  const lat2 = Math.asin(Math.sin(lat1) * Math.cos(dR) + Math.cos(lat1) * Math.sin(dR) * Math.cos(br));
  const lng2 = (lng * Math.PI) / 180 + Math.atan2(
    Math.sin(br) * Math.sin(dR) * Math.cos(lat1),
    Math.cos(dR) - Math.sin(lat1) * Math.sin(lat2),
  );
  return [(lng2 * 180) / Math.PI, (lat2 * 180) / Math.PI];
}

function norm360(x) {
  return ((x % 360) + 360) % 360;
}

function sweepClockwise(fromDeg, toDeg) {
  let s = norm360(toDeg - fromDeg);
  if (s === 0) s = 360;
  return s;
}

function ringCentroid(ring) {
  const n = ring.length;
  if (n < 1) return null;
  const closed = n > 1 && ring[0][0] === ring[n - 1][0] && ring[0][1] === ring[n - 1][1];
  const open = closed ? ring.slice(0, -1) : ring;
  if (!open.length) return null;
  let sx = 0; let sy = 0;
  open.forEach(([x, y]) => { sx += x; sy += y; });
  return [sx / open.length, sy / open.length];
}

function featureAzimuthOrigin(feature) {
  const g = feature?.geometry;
  if (g?.type === 'Point') return g.coordinates;
  if (g?.type === 'Polygon' && g.coordinates?.[0]) return ringCentroid(g.coordinates[0]);
  return null;
}

function featureAccentColor(props) {
  return props['marker-color'] || props.fill || '#cc1b15';
}

function buildCirclePoly(origin, radiusM) {
  const [lng, lat] = origin;
  const ring = [];
  for (let i = 0; i < 32; i += 1) ring.push(destPoint(lng, lat, (i / 32) * 360, radiusM));
  ring.push(ring[0]);
  return ring;
}

function buildSectorPoly(origin, radiusM, fromDeg, toDeg) {
  const [lng, lat] = origin;
  const sweep = sweepClockwise(fromDeg, toDeg);
  const steps = 16;
  const ring = [[lng, lat]];
  for (let i = 0; i <= steps; i += 1) {
    ring.push(destPoint(lng, lat, norm360(fromDeg + (sweep * i) / steps), radiusM));
  }
  ring.push([lng, lat]);
  return ring;
}

function azimuthRadiusForZoom(zoom) {
  return AZIMUTH_SECTOR_RADIUS_M * Math.pow(1.1, ZOOM - zoom);
}

function buildAzimuthSectorFeatures(geojson, radiusM = AZIMUTH_SECTOR_RADIUS_M) {
  if (!geojson?.features?.length) return [];
  const out = [];
  for (const f of geojson.features) {
    const p = f.properties || {};
    const isPolygon = f.geometry?.type === 'Polygon';
    const origin = featureAzimuthOrigin(f);
    if (!origin) continue;
    const fill = featureAccentColor(p);
    const r = isPolygon ? radiusM * 0.7 : radiusM;

    // Centroid point for polygon arrows — ensures arrow uses same origin as sector circle
    if (isPolygon) {
      const azRaw = p['sound-direction-azimuth'];
      if (azRaw !== null && azRaw !== undefined && azRaw !== '') {
        out.push({
          type: 'Feature',
          properties: { azimuth: Number(azRaw), fill, _kind: 'centroid' },
          geometry: { type: 'Point', coordinates: origin },
        });
      }
    }

    const rawFrom = p['sound-direction-azimuth-from'];
    const rawTo = p['sound-direction-azimuth-to'];
    if (rawFrom === null || rawFrom === undefined || rawFrom === '') continue;
    if (rawTo === null || rawTo === undefined || rawTo === '') continue;
    const fromNum = Number(rawFrom);
    const toNum = Number(rawTo);
    if (!Number.isFinite(fromNum) || !Number.isFinite(toNum)) continue;
    const srcGeom = isPolygon ? 'polygon' : 'point';
    out.push({
      type: 'Feature',
      properties: { fill, _kind: 'circle', _srcGeom: srcGeom },
      geometry: { type: 'Polygon', coordinates: [buildCirclePoly(origin, r)] },
    });
    out.push({
      type: 'Feature',
      properties: { fill, _kind: 'sector', _srcGeom: srcGeom },
      geometry: { type: 'Polygon', coordinates: [buildSectorPoly(origin, r, fromNum, toNum)] },
    });
  }
  return out;
}

function syncMainAndSectors(map, geojson) {
  if (!map?.getSource(SOURCE_ID)) return;
  map.getSource(SOURCE_ID).setData(geojson);
  const radiusM = azimuthRadiusForZoom(map.getZoom());
  map.getSource(AZIMUTH_SECTORS_SOURCE_ID)?.setData({ type: 'FeatureCollection', features: buildAzimuthSectorFeatures(geojson, radiusM) });
}

function getNumColor(num) {
  return SOUND_NUM_COLORS[Math.max(0, Math.min(10, Math.round(num)))] || '#888';
}

function getOpenRing(feature) {
  const ring = feature?.geometry?.type === 'Polygon' ? feature.geometry.coordinates?.[0] : null;
  if (!ring || ring.length < 4) return null;
  return ring.slice(0, -1);
}

function bestNodeIndexMatchScore(targetRing, sourceRing, tolerance = NAME_MATCH_TOLERANCE) {
  if (!targetRing || !sourceRing) return 0;
  const compareLen = Math.min(targetRing.length, sourceRing.length);
  if (compareLen < 3) return 0;
  let best = 0;
  for (let shift = 0; shift < sourceRing.length; shift += 1) {
    let hits = 0;
    for (let i = 0; i < compareLen; i += 1) {
      const t = targetRing[i];
      const s = sourceRing[(i + shift) % sourceRing.length];
      if (Math.hypot(t[0] - s[0], t[1] - s[1]) <= tolerance) hits += 1;
    }
    const score = (hits / compareLen) * (compareLen / Math.max(targetRing.length, sourceRing.length));
    if (score > best) best = score;
  }
  return best;
}

function segmentIntersection(a, b, c, d) {
  const bax = b[0] - a[0];
  const bay = b[1] - a[1];
  const dcx = d[0] - c[0];
  const dcy = d[1] - c[1];
  const den = bax * dcy - bay * dcx;
  if (Math.abs(den) < EPSILON) return null;
  const acx = c[0] - a[0];
  const acy = c[1] - a[1];
  const t = (acx * dcy - acy * dcx) / den;
  const u = (acx * bay - acy * bax) / den;
  if (t < 0 || t > 1 || u < 0 || u > 1) return null;
  return { point: [a[0] + t * bax, a[1] + t * bay], t, u };
}

function polygonAreaAbs(closedRing) {
  let area = 0;
  for (let i = 0; i < closedRing.length - 1; i += 1) {
    const [x1, y1] = closedRing[i];
    const [x2, y2] = closedRing[i + 1];
    area += x1 * y2 - x2 * y1;
  }
  return Math.abs(area / 2);
}

function splitPolygonByLine(closedRing, cutA, cutB) {
  if (!closedRing || closedRing.length < 4) return null;
  const open = closedRing.slice(0, -1);
  if (open.length < 3) return null;

  const hits = [];
  for (let i = 0; i < open.length; i += 1) {
    const edgeStart = open[i];
    const edgeEnd = open[(i + 1) % open.length];
    const hit = segmentIntersection(edgeStart, edgeEnd, cutA, cutB);
    if (!hit) continue;
    if (hit.t <= EPSILON || hit.t >= 1 - EPSILON) continue;
    if (hits.some((h) => Math.hypot(h.point[0] - hit.point[0], h.point[1] - hit.point[1]) < 1e-7)) continue;
    hits.push({ ...hit, edgeIdx: i, id: `cut${hits.length}` });
  }
  if (hits.length !== 2) return null;

  const ordered = [];
  for (let i = 0; i < open.length; i += 1) {
    ordered.push({ coord: open[i], id: null });
    hits
      .filter((h) => h.edgeIdx === i)
      .sort((a, b) => a.t - b.t)
      .forEach((h) => ordered.push({ coord: h.point, id: h.id }));
  }
  const coords = ordered.map((p) => p.coord);
  const idxA = ordered.findIndex((p) => p.id === 'cut0');
  const idxB = ordered.findIndex((p) => p.id === 'cut1');
  if (idxA < 0 || idxB < 0 || idxA === idxB) return null;

  const walk = (from, to) => {
    const out = [coords[from]];
    let i = from;
    while (i !== to) {
      i = (i + 1) % coords.length;
      out.push(coords[i]);
    }
    out.push(coords[from]);
    return out;
  };
  const part1 = walk(idxA, idxB);
  const part2 = walk(idxB, idxA);
  if (part1.length < 4 || part2.length < 4) return null;
  if (polygonAreaAbs(part1) < 1e-12 || polygonAreaAbs(part2) < 1e-12) return null;
  return [part1, part2];
}

function buildPopupHTML(props, soundMode = null) {
  const parts = [];

  const title = props.title || '';
  if (title) {
    const pointNum = props['point-num'];
    const prefix = pointNum != null ? `${pointNum}: ` : '';
    parts.push(`<div class="popup-title">${escapeHtml(prefix + title)}</div>`);
  }

  const soundClass = props['sound-class'];
  const soundClassNum = props['sound-class-num'];
  const showLetter = soundMode !== 'num' && soundClass;
  const showNum = soundMode !== 'letter' && soundClassNum != null;
  if (showLetter || showNum) {
    const letterColors = soundMode === 'letter' ? SOUND_LETTER_COLORS : SOUND_CLASS_COLORS;
    const color = letterColors[soundClass] || '#888';
    let row = '<div class="popup-sound-class">';
    row += '<span class="popup-label">Sound class:</span> ';
    if (showLetter) row += `<span class="popup-badge" style="background:${color}">${escapeHtml(soundClass)}</span> `;
    if (showNum) {
      row += `<span class="popup-badge" style="background:${getNumColor(soundClassNum)}">${soundClassNum}</span>`;
    }
    row += '</div>';
    parts.push(row);
  }

  const azimuthRaw = props['sound-direction-azimuth'];
  const dirComment = props['sound-direction-comment'];
  const hasAzimuth = azimuthRaw !== null && azimuthRaw !== undefined && azimuthRaw !== '';
  const azimuth = hasAzimuth ? Number(azimuthRaw) : null;
  const rf = props['sound-direction-azimuth-from'];
  const rt = props['sound-direction-azimuth-to'];
  const hasRange = rf !== null && rf !== undefined && rf !== '' && rt !== null && rt !== undefined && rt !== '';
  const fromDeg = hasRange ? Number(rf) : null;
  const toDeg = hasRange ? Number(rt) : null;
  const rangeOk = hasRange && Number.isFinite(fromDeg) && Number.isFinite(toDeg);
  if (hasAzimuth || rangeOk || dirComment) {
    let row = '<div class="popup-direction">';
    row += '<span class="popup-label">Direction:</span> ';
    if (hasAzimuth) {
      row += `<span class="popup-arrow" style="--az:${azimuth}deg">↑</span> `;
      row += `<span class="popup-dir-text popup-dir-deg">${azimuth}°</span> `;
    }
    if (rangeOk) row += `<span class="popup-dir-text popup-dir-deg">[${fromDeg}° → ${toDeg}°]</span>`;
    row += '</div>';
    if (dirComment) row += `<div class="popup-dir-comment">${escapeHtml(dirComment)}</div>`;
    parts.push(row);
  }

  if (props.description) {
    parts.push(`<div class="popup-description">${escapeHtml(props.description)}</div>`);
  }

  const camps = [];
  ['2025', '2024', '2023'].forEach((year) => {
    const val = props[`camp-in-${year}`];
    if (val && val !== '-' && val !== 'none') {
      camps.push(`<div class="popup-camp-row"><span class="popup-camp-year">${year}:</span> ${escapeHtml(val)}</div>`);
    }
  });
  if (camps.length) parts.push(`<div class="popup-camps">${camps.join('')}</div>`);

  if (props['upgrade-actions']) {
    parts.push(`<div class="popup-upgrade"><span class="popup-label">Upgrade:</span> ${escapeHtml(props['upgrade-actions'])}</div>`);
  }

  return parts.join('');
}

export default function MapViewer({ layers, defaultLayer }) {
  const mapContainer = useRef(null);
  const mapRef = useRef(null);
  const originalGeoJSONRef = useRef(null);
  const editedGeoJSONRef = useRef(null);

  const [mapReady, setMapReady] = useState(false);
  const [activeLayer, setActiveLayer] = useState(defaultLayer || layers[0]);
  const [mapsConfig, setMapsConfig] = useState(null);

  // Edit mode state
  const [editMode, setEditMode] = useState(false);
  const [editedGeoJSON, setEditedGeoJSON] = useState(null);
  const [selectedFeatureId, setSelectedFeatureId] = useState(null);
  const [dirtyFeatureIds, setDirtyFeatureIds] = useState(new Set());
  const [viewingRef, setViewingRef] = useState(null);

  // Draw polygon state
  const [drawingPolygon, setDrawingPolygon] = useState(false);
  const [drawNodes, setDrawNodes] = useState([]); // [[lng,lat], ...]
  const drawNodesRef = useRef([]);
  const drawingPolygonRef = useRef(false);
  const snapTargetRef = useRef(null); // snapped coord [lng,lat] or null
  const [snapDistance, setSnapDistance] = useState(12); // pixels
  const snapDistanceRef = useRef(12);

  // Place point state
  const [placingPoint, setPlacingPoint] = useState(false);
  const placingPointRef = useRef(false);
  const [slicingPolygon, setSlicingPolygon] = useState(false);
  const slicingPolygonRef = useRef(false);
  const [sliceNodes, setSliceNodes] = useState([]);
  const sliceNodesRef = useRef([]);

  // Node editing state
  const draggingNodeIdxRef = useRef(null); // index into ring[0] being dragged
  const draggingPolygonIdRef = useRef(null); // feature id of polygon being node-edited

  // Point dragging state
  const draggingPointIdRef = useRef(null); // feature id of point being dragged

  // Commit bar state
  const [showCommitInput, setShowCommitInput] = useState(false);
  const [commitMsg, setCommitMsg] = useState('');
  const [commitLoading, setCommitLoading] = useState(false);

  // Auth panel state
  const [showAuthPanel, setShowAuthPanel] = useState(false);

  // Hamburger menu state
  const [menuOpen, setMenuOpen] = useState(false);
  const [showImportDialog, setShowImportDialog] = useState(false);

  // Pattern (B&W) mode — null = off, 'dots' | 'grid' | 'stripes'
  const [patternType, setPatternType] = useState(null);
  const patternTypeRef = useRef(null);
  const [bwOpen, setBwOpen] = useState(false);
  const [advOpen, setAdvOpen] = useState(false);

  // Grayscale satellite background
  const [grayscale, setGrayscale] = useState(true);

  // Elevation overlay
  const [elevationOpacity, setElevationOpacity] = useState(0);

  // Schedule panel
  const [showSchedule, setShowSchedule] = useState(false);
  const [scheduleLightbox, setScheduleLightbox] = useState(false);

  // Help / tutorial
  const [showHelp, setShowHelp] = useState(false);

  // First-visit welcome tooltip
  const [showWelcome, setShowWelcome] = useState(false);
  useEffect(() => {
    if (!localStorage.getItem('soundmaps-welcomed')) setShowWelcome(true);
  }, []);
  const dismissWelcome = () => {
    setShowWelcome(false);
    localStorage.setItem('soundmaps-welcomed', '1');
  };

  // Feature type visibility
  const [showPolygons, setShowPolygons] = useState(true);
  const [showPoints, setShowPoints] = useState(true);
  const showPolygonsRef = useRef(true);
  const showPointsRef = useRef(true);
  const [showPolygonSectors, setShowPolygonSectors] = useState(false);
  const showPolygonSectorsRef = useRef(false);

  // Global polygon border width
  const [globalLineWidth, setGlobalLineWidth] = useState(1);
  const globalLineWidthRef = useRef(1);

  const [pendingRevert, setPendingRevert] = useState(false);

  const { data: session } = useSession();
  const dirty = dirtyFeatureIds.size > 0 || pendingRevert;

  // soundMode: 'num' = only show number, 'letter' = only show letter, undefined = show both
  const soundMode = mapsConfig?.[activeLayer]?.soundMode || null;
  const soundModeRef = useRef(null);
  useEffect(() => { soundModeRef.current = soundMode; }, [soundMode]);

  const selectedFeature = useMemo(() => {
    if (!selectedFeatureId || !editedGeoJSON) return null;
    return editedGeoJSON.features.find((f) => f.id === selectedFeatureId) ?? null;
  }, [selectedFeatureId, editedGeoJSON]);
  const selectedFeatureIdRef = useRef(null);

  // Fetch maps config once
  useEffect(() => {
    fetch('/data/maps-config.json')
      .then((r) => r.json())
      .then(setMapsConfig)
      .catch(() => {});
  }, []);

  // Warn before navigating away with unsaved changes
  useEffect(() => {
    if (!dirty) return;
    const handler = (e) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [dirty]);

  // Initialize map once
  useEffect(() => {
    if (mapRef.current) return;

    const map = new maplibregl.Map({
      container: mapContainer.current,
      style: LOCAL_SATELLITE_STYLE,
      center: CENTER,
      zoom: ZOOM,
    });

    map.on('load', () => {
      const addPattern = (name, sz, draw) => {
        const canvas = document.createElement('canvas');
        canvas.width = sz; canvas.height = sz;
        const ctx = canvas.getContext('2d');
        ctx.clearRect(0, 0, sz, sz);
        draw(ctx, sz);
        const { data } = ctx.getImageData(0, 0, sz, sz);
        map.addImage(name, { width: sz, height: sz, data });
      };

      // Dots: tile = sp×sp, single dot at center → seamless
      [
        { r: 1.5, sp: 12 },
        { r: 1.5, sp: 9 },
        { r: 2.0, sp: 7 },
        { r: 2.0, sp: 5 },
        { r: 2.5, sp: 4 },
      ].forEach(({ r, sp }, i) => addPattern(`dots-${i}`, sp, (ctx, sz) => {
        ctx.fillStyle = '#000';
        ctx.beginPath(); ctx.arc(sz / 2, sz / 2, r, 0, Math.PI * 2); ctx.fill();
      }));

      // Grid: tile = sp×sp, lines along top and left edges → seamless grid
      [14, 10, 7, 5, 3].forEach((sp, i) => addPattern(`grid-${i}`, sp, (ctx, sz) => {
        ctx.strokeStyle = '#000';
        ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(sz, 0); ctx.stroke(); // top
        ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(0, sz); ctx.stroke(); // left
      }));

      // Diagonal stripes: tile = sp×sp, line from bottom-left to top-right → seamless 45°
      [14, 10, 7, 5, 3].forEach((sp, i) => addPattern(`stripes-${i}`, sp, (ctx, sz) => {
        ctx.strokeStyle = '#000';
        ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(0, sz); ctx.lineTo(sz, 0); ctx.stroke();
      }));

      // Elevation overlay (below all data/draw layers)
      map.addSource('elevation', {
        type: 'image',
        url: '/elevation/elevation_map_alversjo.png',
        coordinates: [
          [14.913661, 57.638955], // TL
          [14.938783, 57.638970], // TR
          [14.938825, 57.613818], // BR
          [14.913721, 57.613803], // BL
        ],
      });
      map.addLayer({ id: 'elevation-layer', type: 'raster', source: 'elevation',
        paint: { 'raster-opacity': 0 } });

      // Draw-preview source + layers (empty initially)
      map.addSource(DRAW_SOURCE_ID, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
      map.addLayer({ id: 'draw-fill', type: 'fill', source: DRAW_SOURCE_ID,
        paint: { 'fill-color': '#fff', 'fill-opacity': 0.15 } });
      map.addLayer({ id: 'draw-outline', type: 'line', source: DRAW_SOURCE_ID,
        paint: { 'line-color': '#fff', 'line-width': 2, 'line-dasharray': [4, 3] } });
      // Regular nodes
      map.addLayer({ id: 'draw-nodes', type: 'circle', source: DRAW_SOURCE_ID,
        filter: ['all', ['==', '$type', 'Point'], ['!=', ['get', 'snap'], true]],
        paint: { 'circle-radius': 5, 'circle-color': '#fff', 'circle-stroke-width': 2, 'circle-stroke-color': '#333' } });
      // Snap indicator: cyan ring
      map.addLayer({ id: 'draw-snap', type: 'circle', source: DRAW_SOURCE_ID,
        filter: ['all', ['==', '$type', 'Point'], ['==', ['get', 'snap'], true]],
        paint: { 'circle-radius': 9, 'circle-color': 'rgba(0,220,255,0.25)', 'circle-stroke-width': 2, 'circle-stroke-color': '#00dcff' } });

      // Node-edit source (layers added in loadGeoJSON to stay on top)
      map.addSource(NODE_SOURCE_ID, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });

      // Drag handling for node editing
      map.on('mousedown', 'node-handles', (e) => {
        if (!editModeRef.current) return;
        e.preventDefault();
        const nodeIdx = e.features[0]?.properties?.nodeIdx;
        if (nodeIdx == null) return;
        draggingNodeIdxRef.current = nodeIdx;
        draggingPolygonIdRef.current = e.features[0]?.properties?.polygonId;
        map.dragPan.disable();
        map.getCanvas().style.cursor = 'grabbing';
      });

      map.on('mouseup', () => {
        if (draggingNodeIdxRef.current == null) return;
        draggingNodeIdxRef.current = null;
        draggingPolygonIdRef.current = null;
        map.dragPan.enable();
        map.getCanvas().style.cursor = '';
      });

      map.on('mouseenter', 'node-handles', () => { map.getCanvas().style.cursor = 'grab'; });
      map.on('mouseleave', 'node-handles', () => { map.getCanvas().style.cursor = ''; });

      map.on('mouseenter', 'node-midpoints', () => { map.getCanvas().style.cursor = 'copy'; });
      map.on('mouseleave', 'node-midpoints', () => { map.getCanvas().style.cursor = ''; });

      map.on('click', 'node-midpoints', (e) => {
        if (!editModeRef.current) return;
        e.preventDefault();
        const props = e.features[0]?.properties;
        if (props?.afterIdx == null) return;
        insertMidpointRef.current(props.polygonId, props.afterIdx, [e.lngLat.lng, e.lngLat.lat]);
      });

      // Point dragging: mousedown on point layer starts drag
      map.on('mousedown', LAYER_IDS.point, (e) => {
        if (!editModeRef.current) return;
        const feat = e.features[0];
        if (!feat || feat.geometry?.type !== 'Point') return;
        const base = editedGeoJSONRef.current || originalGeoJSONRef.current;
        const match = base?.features[feat.id];
        if (!match || match.geometry?.type !== 'Point') return;
        e.preventDefault();
        draggingPointIdRef.current = match.id;
        map.dragPan.disable();
        map.getCanvas().style.cursor = 'grabbing';
      });

      map.on('mouseup', () => {
        if (draggingPointIdRef.current != null) {
          draggingPointIdRef.current = null;
          map.dragPan.enable();
          map.getCanvas().style.cursor = '';
        }
      });

      mapRef.current = map;
      setMapReady(true);
    });

    map.on('zoomend', () => {
      const src = map.getSource(AZIMUTH_SECTORS_SOURCE_ID);
      if (!src) return;
      const geojson = editedGeoJSONRef.current || originalGeoJSONRef.current;
      if (!geojson) return;
      const radiusM = azimuthRadiusForZoom(map.getZoom());
      src.setData({ type: 'FeatureCollection', features: buildAzimuthSectorFeatures(geojson, radiusM) });
    });

    map.on('mousemove', (e) => {
      // Node drag
      if (draggingNodeIdxRef.current != null) {
        const snap = findSnapTarget(map, e.lngLat, e.originalEvent.shiftKey, draggingPolygonIdRef.current);
        const coord = (!e.originalEvent.shiftKey && snap) ? snap : [e.lngLat.lng, e.lngLat.lat];
        moveNodeRef.current(draggingPolygonIdRef.current, draggingNodeIdxRef.current, coord, snap);
        return;
      }
      // Point drag
      if (draggingPointIdRef.current != null) {
        movePointRef.current(draggingPointIdRef.current, [e.lngLat.lng, e.lngLat.lat]);
        return;
      }
      if (slicingPolygonRef.current && sliceNodesRef.current.length === 1) {
        updateSlicePreview(map, sliceNodesRef.current, [e.lngLat.lng, e.lngLat.lat]);
        return;
      }
      // Draw preview
      if (!drawingPolygonRef.current) return;
      const snap = findSnapTarget(map, e.lngLat, e.originalEvent.shiftKey);
      snapTargetRef.current = snap;
      updateDrawPreview(map, drawNodesRef.current, snap);
    });

    map.on('click', (e) => {
      // Place point mode: single click to create a new point
      if (slicingPolygonRef.current) {
        const coord = [e.lngLat.lng, e.lngLat.lat];
        const nodes = sliceNodesRef.current;
        if (!nodes.length) {
          const next = [coord];
          sliceNodesRef.current = next;
          setSliceNodes(next);
          updateSlicePreview(map, next);
          return;
        }
        slicePolygonRef.current(nodes[0], coord);
        sliceNodesRef.current = [];
        setSliceNodes([]);
        setSlicingPolygon(false);
        clearDrawPreview(map);
        return;
      }

      if (placingPointRef.current) {
        const coord = [e.lngLat.lng, e.lngLat.lat];
        placePointRef.current(coord);
        return;
      }

      // Draw mode: add node or close polygon
      if (drawingPolygonRef.current) {
        const nodes = drawNodesRef.current;
        const snap = snapTargetRef.current;
        const coord = (!e.originalEvent.shiftKey && snap) ? snap : [e.lngLat.lng, e.lngLat.lat];

        // Check if clicking near first node to close (need ≥3 nodes already)
        if (nodes.length >= 3) {
          const first = map.project(nodes[0]);
          const click = map.project(coord);
          const dx = first.x - click.x, dy = first.y - click.y;
          if (Math.sqrt(dx * dx + dy * dy) < 12) {
            finishPolygonRef.current();
            return;
          }
        }

        const next = [...nodes, coord];
        drawNodesRef.current = next;
        setDrawNodes(next);
        updateDrawPreview(map, next, snap);
        return;
      }

      const features = map.queryRenderedFeatures(e.point, {
        layers: INTERACTIVE_LAYERS.filter((id) => map.getLayer(id)),
      });
      if (!features.length) return;

      const feat = features[0];

      if (editModeRef.current) {
        const base = editedGeoJSONRef.current || originalGeoJSONRef.current;
        const match = base?.features[feat.id];
        if (match) setSelectedFeatureId(match.id ?? feat.id);
        return;
      }

      // View mode: popup
      const props = feat.properties || {};
      const html = buildPopupHTML(props, soundModeRef.current);
      if (!html) return;

      const coords =
        feat.geometry.type === 'Point'
          ? feat.geometry.coordinates.slice()
          : [e.lngLat.lng, e.lngLat.lat];

      new maplibregl.Popup({ offset: 12, maxWidth: '360px' })
        .setLngLat(coords)
        .setHTML(html)
        .addTo(map);
    });

    INTERACTIVE_LAYERS.forEach((layerId) => {
      map.on('mouseenter', layerId, () => { map.getCanvas().style.cursor = 'pointer'; });
      map.on('mouseleave', layerId, () => { map.getCanvas().style.cursor = ''; });
    });

    const handleKeyDown = (e) => {
      if (e.key !== 'Backspace') return;
      if (!slicingPolygonRef.current || sliceNodesRef.current.length !== 1) return;
      e.preventDefault();
      sliceNodesRef.current = [];
      setSliceNodes([]);
      map.getSource(DRAW_SOURCE_ID)?.setData({ type: 'FeatureCollection', features: [] });
    };
    document.addEventListener('keydown', handleKeyDown);

    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      map.remove();
      mapRef.current = null;
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // editMode changes after map init — update click handler via closure-captured ref
  const editModeRef = useRef(false);
  useEffect(() => { editModeRef.current = editMode; }, [editMode]);

  // Keep draw refs in sync
  useEffect(() => { drawingPolygonRef.current = drawingPolygon; }, [drawingPolygon]);
  useEffect(() => { placingPointRef.current = placingPoint; }, [placingPoint]);
  useEffect(() => { slicingPolygonRef.current = slicingPolygon; }, [slicingPolygon]);
  useEffect(() => { drawNodesRef.current = drawNodes; }, [drawNodes]);
  useEffect(() => { sliceNodesRef.current = sliceNodes; }, [sliceNodes]);
  useEffect(() => { selectedFeatureIdRef.current = selectedFeatureId; }, [selectedFeatureId]);
  useEffect(() => { snapDistanceRef.current = snapDistance; }, [snapDistance]);

  // Cursor: crosshair while drawing/placing
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    map.getCanvas().style.cursor = (drawingPolygon || placingPoint || slicingPolygon) ? 'crosshair' : '';
  }, [drawingPolygon, placingPoint, slicingPolygon]);

  useEffect(() => {
    if (!slicingPolygon) return;
    if (selectedFeature?.geometry?.type === 'Polygon') return;
    setSlicingPolygon(false);
    setSliceNodes([]);
    sliceNodesRef.current = [];
    clearDrawPreview(mapRef.current);
  }, [selectedFeature, slicingPolygon]);

  // Collect polygon node coordinates, optionally excluding one polygon by id
  function getAllPolygonNodes(excludePolygonId = null) {
    const base = editedGeoJSONRef.current || originalGeoJSONRef.current;
    if (!base) return [];
    const coords = [];
    for (const f of base.features) {
      if (f.geometry?.type !== 'Polygon') continue;
      if (f.id === excludePolygonId) continue;
      for (const ring of f.geometry.coordinates)
        for (const c of ring) coords.push(c);
    }
    return coords;
  }

  // Find nearest polygon node within snapDistance pixels; returns [lng,lat] or null
  function findSnapTarget(map, lngLat, shiftKey, excludePolygonId = null) {
    if (shiftKey) return null;
    const threshold = snapDistanceRef.current;
    const click = map.project(lngLat);
    let best = null, bestDist = Infinity;
    for (const c of getAllPolygonNodes(excludePolygonId)) {
      const p = map.project(c);
      const d = Math.hypot(p.x - click.x, p.y - click.y);
      if (d < threshold && d < bestDist) { bestDist = d; best = c; }
    }
    return best;
  }

  function updateDrawPreview(map, nodes, snapCoord = null) {
    if (!map.getSource(DRAW_SOURCE_ID)) return;
    const features = [];
    if (nodes.length >= 2) {
      features.push({ type: 'Feature', geometry: { type: 'LineString', coordinates: [...nodes, nodes[0]] } });
    }
    nodes.forEach((c) => features.push({ type: 'Feature', geometry: { type: 'Point', coordinates: c } }));
    // Snap indicator: larger highlighted node
    if (snapCoord) {
      features.push({
        type: 'Feature',
        properties: { snap: true },
        geometry: { type: 'Point', coordinates: snapCoord },
      });
    }
    map.getSource(DRAW_SOURCE_ID).setData({ type: 'FeatureCollection', features });
  }

  function updateSlicePreview(map, nodes, hoverCoord = null) {
    if (!map.getSource(DRAW_SOURCE_ID)) return;
    const features = nodes.map((coord) => ({ type: 'Feature', geometry: { type: 'Point', coordinates: coord } }));
    if (nodes.length === 1 && hoverCoord) {
      features.push({ type: 'Feature', geometry: { type: 'LineString', coordinates: [nodes[0], hoverCoord] } });
    }
    map.getSource(DRAW_SOURCE_ID).setData({ type: 'FeatureCollection', features });
  }

  function clearDrawPreview(map) {
    map?.getSource(DRAW_SOURCE_ID)?.setData({ type: 'FeatureCollection', features: [] });
  }

  // Stable ref so the map click handler can call finishPolygon without a stale closure
  const finishPolygonRef = useRef(null);
  finishPolygonRef.current = function finishPolygon() {
    const nodes = drawNodesRef.current;
    if (nodes.length < 3) return;
    const map = mapRef.current;

    const newFeature = {
      type: 'Feature',
      id: crypto.randomUUID(),
      properties: {},
      geometry: { type: 'Polygon', coordinates: [[...nodes, nodes[0]]] },
    };

    const base = editedGeoJSONRef.current || originalGeoJSONRef.current;
    const updated = { ...base, features: [...base.features, newFeature] };
    editedGeoJSONRef.current = updated;
    setEditedGeoJSON(updated);
    syncMainAndSectors(map, updated);
    setDirtyFeatureIds((prev) => new Set([...prev, newFeature.id]));

    // Clear draw state
    drawNodesRef.current = [];
    setDrawNodes([]);
    setDrawingPolygon(false);
    clearDrawPreview(map);
  };

  // Place a new point feature at the given coordinate
  const placePointRef = useRef(null);
  placePointRef.current = function placePoint(coord) {
    const map = mapRef.current;
    const newFeature = {
      type: 'Feature',
      id: crypto.randomUUID(),
      properties: {},
      geometry: { type: 'Point', coordinates: coord },
    };
    const base = editedGeoJSONRef.current || originalGeoJSONRef.current;
    const updated = { ...base, features: [...base.features, newFeature] };
    editedGeoJSONRef.current = updated;
    setEditedGeoJSON(updated);
    syncMainAndSectors(map, updated);
    setDirtyFeatureIds((prev) => new Set([...prev, newFeature.id]));
    setPlacingPoint(false);
  };

  // Move an existing point feature to a new coordinate
  const movePointRef = useRef(null);
  movePointRef.current = function movePoint(pointId, coord) {
    const map = mapRef.current;
    const base = editedGeoJSONRef.current || originalGeoJSONRef.current;
    const feat = base.features.find((f) => f.id === pointId);
    if (!feat || feat.geometry?.type !== 'Point') return;
    const updatedFeat = { ...feat, geometry: { ...feat.geometry, coordinates: coord } };
    const updated = { ...base, features: base.features.map((f) => f.id === pointId ? updatedFeat : f) };
    editedGeoJSONRef.current = updated;
    syncMainAndSectors(map, updated);
    setEditedGeoJSON(updated);
    setDirtyFeatureIds((prev) => new Set([...prev, pointId]));
  };

  function startPlacingPoint() {
    setSlicingPolygon(false);
    sliceNodesRef.current = [];
    setSliceNodes([]);
    clearDrawPreview(mapRef.current);
    setSelectedFeatureId(null);
    setPlacingPoint(true);
  }

  function cancelPlacingPoint() {
    setPlacingPoint(false);
  }

  function startDrawing() {
    setSlicingPolygon(false);
    sliceNodesRef.current = [];
    setSliceNodes([]);
    setSelectedFeatureId(null);
    drawNodesRef.current = [];
    setDrawNodes([]);
    clearDrawPreview(mapRef.current);
    setDrawingPolygon(true);
  }

  function cancelDrawing() {
    drawNodesRef.current = [];
    setDrawNodes([]);
    setDrawingPolygon(false);
    clearDrawPreview(mapRef.current);
  }

  function startSlicePolygon() {
    if (!selectedFeature || selectedFeature.geometry?.type !== 'Polygon') return;
    setDrawingPolygon(false);
    setPlacingPoint(false);
    drawNodesRef.current = [];
    setDrawNodes([]);
    sliceNodesRef.current = [];
    setSliceNodes([]);
    clearDrawPreview(mapRef.current);
    setSlicingPolygon(true);
  }

  function cancelSlicePolygon() {
    sliceNodesRef.current = [];
    setSliceNodes([]);
    setSlicingPolygon(false);
    clearDrawPreview(mapRef.current);
  }

  function handleFeatureDelete(featureId) {
    if (!window.confirm('Delete this feature? This cannot be undone until discarded.')) return;
    const base = editedGeoJSONRef.current || originalGeoJSONRef.current;
    const updated = { ...base, features: base.features.filter((f) => f.id !== featureId) };
    editedGeoJSONRef.current = updated;
    setEditedGeoJSON(updated);
    syncMainAndSectors(mapRef.current, updated);
    setDirtyFeatureIds((prev) => { const s = new Set(prev); s.add(featureId); return s; });
    setSelectedFeatureId(null);
  }

  // --- Node editing helpers ---

  function nodeSourceData(feature, snapCoord = null, hideMidpoints = false) {
    if (!feature || feature.geometry?.type !== 'Polygon') return { type: 'FeatureCollection', features: [] };
    const ring = feature.geometry.coordinates[0];
    // Exclude the closing duplicate coord
    const open = ring.slice(0, -1);
    const features = open.map((c, i) => ({
      type: 'Feature',
      id: i,
      properties: { nodeIdx: i, polygonId: feature.id },
      geometry: { type: 'Point', coordinates: c },
    }));
    // Midpoint handles between each pair of adjacent nodes
    if (!hideMidpoints) {
      open.forEach((c, i) => {
        const next = open[(i + 1) % open.length];
        features.push({
          type: 'Feature',
          properties: { midpoint: true, afterIdx: i, polygonId: feature.id },
          geometry: { type: 'Point', coordinates: [(c[0] + next[0]) / 2, (c[1] + next[1]) / 2] },
        });
      });
    }
    if (snapCoord) features.push({
      type: 'Feature',
      properties: { snap: true },
      geometry: { type: 'Point', coordinates: snapCoord },
    });
    return { type: 'FeatureCollection', features };
  }

  // Sync grayscale to satellite layer
  useEffect(() => {
    const map = mapRef.current;
    if (!map?.getLayer('satellite-layer')) return;
    map.setPaintProperty('satellite-layer', 'raster-saturation', grayscale ? -1 : 0);
  }, [grayscale, mapReady]);

  // Sync elevation layer opacity
  useEffect(() => {
    const map = mapRef.current;
    if (!map?.getLayer('elevation-layer')) return;
    map.setPaintProperty('elevation-layer', 'raster-opacity', elevationOpacity);
  }, [elevationOpacity, mapReady]);

  // Sync node handles whenever the selected feature changes
  useEffect(() => {
    const map = mapRef.current;
    if (!map?.getSource(NODE_SOURCE_ID)) return;
    map.getSource(NODE_SOURCE_ID).setData(nodeSourceData(selectedFeature));
  }, [selectedFeature]); // eslint-disable-line react-hooks/exhaustive-deps

  // Stable ref so the mousemove handler (stale closure) can call it
  const moveNodeRef = useRef(null);
  moveNodeRef.current = function moveNode(polygonId, nodeIdx, coord, snapCoord) {
    const map = mapRef.current;
    const base = editedGeoJSONRef.current || originalGeoJSONRef.current;
    const feat = base.features.find((f) => f.id === polygonId);
    if (!feat || feat.geometry?.type !== 'Polygon') return;

    const ring = feat.geometry.coordinates[0].slice(0, -1);
    ring[nodeIdx] = coord;
    const newRing = [...ring, ring[0]]; // re-close
    const updatedFeat = { ...feat, geometry: { ...feat.geometry, coordinates: [newRing] } };
    const updated = { ...base, features: base.features.map((f) => f.id === polygonId ? updatedFeat : f) };

    editedGeoJSONRef.current = updated;
    syncMainAndSectors(map, updated);
    // Update node handles live (without going through React state for perf); hide midpoints while dragging
    map.getSource(NODE_SOURCE_ID)?.setData(nodeSourceData(updatedFeat, snapCoord, true));
    // Commit to React state (debounced via the mouseup)
    setEditedGeoJSON(updated);
    setDirtyFeatureIds((prev) => new Set([...prev, polygonId]));
  };

  // Insert a new node after afterIdx in the polygon ring
  const insertMidpointRef = useRef(null);
  insertMidpointRef.current = function insertMidpoint(polygonId, afterIdx, coord) {
    const map = mapRef.current;
    const base = editedGeoJSONRef.current || originalGeoJSONRef.current;
    const feat = base.features.find((f) => f.id === polygonId);
    if (!feat || feat.geometry?.type !== 'Polygon') return;
    const open = feat.geometry.coordinates[0].slice(0, -1);
    open.splice(afterIdx + 1, 0, coord);
    const updatedFeat = { ...feat, geometry: { ...feat.geometry, coordinates: [[...open, open[0]]] } };
    const updated = { ...base, features: base.features.map((f) => f.id === polygonId ? updatedFeat : f) };
    editedGeoJSONRef.current = updated;
    setEditedGeoJSON(updated);
    syncMainAndSectors(map, updated);
    map.getSource(NODE_SOURCE_ID)?.setData(nodeSourceData(updatedFeat));
    setDirtyFeatureIds((prev) => new Set([...prev, polygonId]));
  };

  const slicePolygonRef = useRef(null);
  slicePolygonRef.current = function slicePolygon(cutA, cutB) {
    const base = editedGeoJSONRef.current || originalGeoJSONRef.current;
    const featureId = selectedFeatureIdRef.current;
    const feature = base?.features.find((f) => f.id === featureId);
    if (!feature || feature.geometry?.type !== 'Polygon') return;
    const parts = splitPolygonByLine(feature.geometry.coordinates[0], cutA, cutB);
    if (!parts) {
      alert('Slice failed: draw a line that crosses the polygon twice (not through a corner).');
      return;
    }
    const [ring1, ring2] = parts;
    const props = { ...(feature.properties || {}) };
    const title = props.title;
    const props1 = title ? { ...props, title: `${title} p1` } : { ...props };
    const props2 = title ? { ...props, title: `${title} p2` } : { ...props };
    const feature1 = { ...feature, id: crypto.randomUUID(), properties: props1, geometry: { ...feature.geometry, coordinates: [ring1] } };
    const feature2 = { ...feature, id: crypto.randomUUID(), properties: props2, geometry: { ...feature.geometry, coordinates: [ring2] } };
    const updated = {
      ...base,
      features: base.features.flatMap((f) => (f.id === featureId ? [feature1, feature2] : [f])),
    };
    editedGeoJSONRef.current = updated;
    setEditedGeoJSON(updated);
    syncMainAndSectors(mapRef.current, updated);
    setDirtyFeatureIds((prev) => new Set([...prev, featureId, feature1.id, feature2.id]));
    setSelectedFeatureId(feature1.id);
  };

  // Build a data-driven fill-pattern expression for the given prefix ('dots'|'grid'|'stripes')
  function patternExpr(prefix) {
    // sound-class-num 0–10 → bucket 0–4
    return ['case',
      ['has', 'sound-class-num'],
      ['concat', `${prefix}-`, ['to-string', ['min', 4, ['floor', ['/', ['coalesce', ['get', 'sound-class-num'], 5], 2.1]]]]],
      `${prefix}-2`,
    ];
  }

  function applyPatternToMap(map, type) {
    if (!map.getLayer(LAYER_IDS.polygonFill)) return;
    if (type) {
      map.setPaintProperty(LAYER_IDS.polygonFill, 'fill-pattern', patternExpr(type));
      map.setPaintProperty(LAYER_IDS.polygonFill, 'fill-opacity', 1);
      map.setPaintProperty(LAYER_IDS.polygonOutline, 'line-color', '#000');
      map.setPaintProperty(LAYER_IDS.polygonOutline, 'line-opacity', 0.6);
    } else {
      map.setPaintProperty(LAYER_IDS.polygonFill, 'fill-pattern', null);
      map.setPaintProperty(LAYER_IDS.polygonFill, 'fill-color', ['coalesce', ['get', 'fill'], '#3cc954']);
      map.setPaintProperty(LAYER_IDS.polygonFill, 'fill-opacity', 0.35);
      map.setPaintProperty(LAYER_IDS.polygonOutline, 'line-color', ['coalesce', ['get', 'fill'], '#3cc954']);
      map.setPaintProperty(LAYER_IDS.polygonOutline, 'line-opacity', 0.7);
    }
  }

  // Apply / remove pattern mode on polygon fill layer
  useEffect(() => {
    patternTypeRef.current = patternType;
    const map = mapRef.current;
    if (map) applyPatternToMap(map, patternType);
  }, [patternType, mapReady]); // eslint-disable-line react-hooks/exhaustive-deps

  // Sync polygon/point visibility to map layers
  useEffect(() => {
    showPolygonsRef.current = showPolygons;
    showPointsRef.current = showPoints;
    const map = mapRef.current;
    if (!map) return;
    const polyVis = showPolygons ? 'visible' : 'none';
    const pointVis = showPoints ? 'visible' : 'none';
    [LAYER_IDS.polygonFill, LAYER_IDS.polygonOutline].forEach((id) => {
      if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', polyVis);
    });
    [LAYER_IDS.point, LAYER_IDS.pointArrow].forEach((id) => {
      if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', pointVis);
    });
    [LAYER_IDS_AZ.circle, LAYER_IDS_AZ.sector].forEach((id) => {
      if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', pointVis);
    });
    const polySectorVis = showPolygons && showPolygonSectorsRef.current ? 'visible' : 'none';
    [LAYER_IDS_AZ.polyCircle, LAYER_IDS_AZ.polySector].forEach((id) => {
      if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', polySectorVis);
    });
    if (map.getLayer(LAYER_IDS_AZ.polygonArrow)) map.setLayoutProperty(LAYER_IDS_AZ.polygonArrow, 'visibility', polyVis);
  }, [showPolygons, showPoints, mapReady]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    showPolygonSectorsRef.current = showPolygonSectors;
    const map = mapRef.current;
    if (!map) return;
    const vis = showPolygonsRef.current && showPolygonSectors ? 'visible' : 'none';
    [LAYER_IDS_AZ.polyCircle, LAYER_IDS_AZ.polySector].forEach((id) => {
      if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', vis);
    });
  }, [showPolygonSectors, mapReady]);

  // Sync global line width to polygon outline layer
  useEffect(() => {
    globalLineWidthRef.current = globalLineWidth;
    const map = mapRef.current;
    if (!map?.getLayer(LAYER_IDS.polygonOutline)) return;
    map.setPaintProperty(LAYER_IDS.polygonOutline, 'line-width', globalLineWidth);
  }, [globalLineWidth, mapReady]);

  const loadGeoJSON = useCallback(async (name, ref = null) => {
    const map = mapRef.current;
    if (!map) return;

    // Reset edit state on every load
    setEditMode(false);
    setSelectedFeatureId(null);
    setDirtyFeatureIds(new Set());
    setEditedGeoJSON(null);
    editedGeoJSONRef.current = null;
    setShowCommitInput(false);
    setCommitMsg('');
    setShowImportDialog(false);
    setSlicingPolygon(false);
    setSliceNodes([]);
    sliceNodesRef.current = [];

    map.getSource(NODE_SOURCE_ID)?.setData({ type: 'FeatureCollection', features: [] });
    Object.values(LAYER_IDS).forEach((id) => { if (map.getLayer(id)) map.removeLayer(id); });
    Object.values(LAYER_IDS_AZ).forEach((id) => { if (map.getLayer(id)) map.removeLayer(id); });
    if (map.getSource(SOURCE_ID)) map.removeSource(SOURCE_ID);
    if (map.getSource(AZIMUTH_SECTORS_SOURCE_ID)) map.removeSource(AZIMUTH_SECTORS_SOURCE_ID);

    try {
      let geojson;
      if (ref) {
        const res = await fetch(`/api/github/file?map=${name}&ref=${encodeURIComponent(ref)}`);
        if (!res.ok) throw new Error(`Failed to load version ${ref}`);
        geojson = await res.json();
      } else {
        let res = await fetch(`/data/${name}.json`);
        if (!res.ok) res = await fetch(`/data/${name}.geojson`);
        if (!res.ok) throw new Error(`Could not load ${name}`);
        geojson = await res.json();
      }

      originalGeoJSONRef.current = geojson;
      // generateId: true assigns sequential numeric IDs (0, 1, 2…) matching the features array index.
      // This is the reliable way to identify clicked features since MapLibre doesn't support UUID string IDs.
      map.addSource(SOURCE_ID, { type: 'geojson', data: geojson, generateId: true });
      map.addSource(AZIMUTH_SECTORS_SOURCE_ID, {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: buildAzimuthSectorFeatures(geojson, azimuthRadiusForZoom(map.getZoom())) },
      });

      map.addLayer({
        id: LAYER_IDS.polygonFill, type: 'fill', source: SOURCE_ID,
        filter: ['==', '$type', 'Polygon'],
        paint: { 'fill-color': ['coalesce', ['get', 'fill'], '#3cc954'], 'fill-opacity': 0.35 },
      });
      map.addLayer({
        id: LAYER_IDS_AZ.circle, type: 'fill', source: AZIMUTH_SECTORS_SOURCE_ID,
        filter: ['all', ['==', ['get', '_kind'], 'circle'], ['==', ['get', '_srcGeom'], 'point']],
        paint: { 'fill-color': ['get', 'fill'], 'fill-opacity': 0.28 },
      });
      map.addLayer({
        id: LAYER_IDS_AZ.sector, type: 'fill', source: AZIMUTH_SECTORS_SOURCE_ID,
        filter: ['all', ['==', ['get', '_kind'], 'sector'], ['==', ['get', '_srcGeom'], 'point']],
        paint: { 'fill-color': ['get', 'fill'], 'fill-opacity': 0.72 },
      });
      map.addLayer({
        id: LAYER_IDS_AZ.polyCircle, type: 'fill', source: AZIMUTH_SECTORS_SOURCE_ID,
        filter: ['all', ['==', ['get', '_kind'], 'circle'], ['==', ['get', '_srcGeom'], 'polygon']],
        paint: { 'fill-color': ['get', 'fill'], 'fill-opacity': 0.28 },
      });
      map.addLayer({
        id: LAYER_IDS_AZ.polySector, type: 'fill', source: AZIMUTH_SECTORS_SOURCE_ID,
        filter: ['all', ['==', ['get', '_kind'], 'sector'], ['==', ['get', '_srcGeom'], 'polygon']],
        paint: { 'fill-color': ['get', 'fill'], 'fill-opacity': 0.72 },
      });
      map.addLayer({
        id: LAYER_IDS.polygonOutline, type: 'line', source: SOURCE_ID,
        filter: ['==', '$type', 'Polygon'],
        paint: {
          'line-color': ['coalesce', ['get', 'fill'], '#3cc954'],
          'line-width': ['coalesce', ['get', 'stroke-width'], 1],
          'line-opacity': 0.7,
        },
      });
      map.addLayer({
        id: LAYER_IDS.line, type: 'line', source: SOURCE_ID,
        filter: ['==', '$type', 'LineString'],
        paint: {
          'line-color': ['coalesce', ['get', 'stroke'], '#3cc954'],
          'line-width': ['coalesce', ['get', 'stroke-width'], 2],
          'line-opacity': 0.85,
        },
      });
      map.addLayer({
        id: LAYER_IDS.point, type: 'circle', source: SOURCE_ID,
        filter: ['==', '$type', 'Point'],
        paint: {
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 13, 6, 15.5, 14, 18, 16],
          'circle-color': ['coalesce', ['get', 'marker-color'], '#cc1b15'],
          'circle-stroke-width': ['interpolate', ['linear'], ['zoom'], 13, 1, 15.5, 2, 18, 3],
          'circle-stroke-color': '#ffffff',
        },
      });
      map.addLayer({
        id: LAYER_IDS.pointArrow, type: 'symbol', source: SOURCE_ID,
        filter: ['all', ['==', '$type', 'Point'], ['has', 'sound-direction-azimuth']],
        layout: {
          'text-field': '^',
          'text-size': ['interpolate', ['linear'], ['zoom'], 13, 6, 15.5, 14, 18, 18],
          'text-rotate': ['get', 'sound-direction-azimuth'],
          'text-rotation-alignment': 'map',
          'text-allow-overlap': true,
          'text-ignore-placement': true,
          'text-font': ['Open Sans bold'],
        },
        paint: { 'text-color': '#ffffff' },
      });
      map.addLayer({
        id: LAYER_IDS_AZ.polygonArrow, type: 'symbol', source: AZIMUTH_SECTORS_SOURCE_ID,
        filter: ['==', ['get', '_kind'], 'centroid'],
        layout: {
          'text-field': '^',
          'text-size': ['interpolate', ['linear'], ['zoom'], 13, 6, 15.5, 14, 18, 18],
          'text-rotate': ['get', 'azimuth'],
          'text-rotation-alignment': 'map',
          'text-allow-overlap': true,
          'text-ignore-placement': true,
          'text-font': ['Open Sans bold'],
        },
        paint: { 'text-color': '#ffffff' },
      });
      // Node-edit layers — must be added last so they render above polygon fill/outline
      if (map.getLayer('node-handles')) map.removeLayer('node-handles');
      if (map.getLayer('node-midpoints')) map.removeLayer('node-midpoints');
      if (map.getLayer('node-snap')) map.removeLayer('node-snap');
      map.addLayer({ id: 'node-handles', type: 'circle', source: NODE_SOURCE_ID,
        filter: ['all', ['!=', ['get', 'snap'], true], ['!=', ['get', 'midpoint'], true]],
        paint: { 'circle-radius': 6, 'circle-color': '#fff', 'circle-stroke-width': 2, 'circle-stroke-color': '#333' } });
      map.addLayer({ id: 'node-midpoints', type: 'circle', source: NODE_SOURCE_ID,
        filter: ['==', ['get', 'midpoint'], true],
        paint: { 'circle-radius': 4, 'circle-color': 'rgba(255,255,255,0.4)', 'circle-stroke-width': 1.5, 'circle-stroke-color': 'rgba(255,255,255,0.9)' } });
      map.addLayer({ id: 'node-snap', type: 'circle', source: NODE_SOURCE_ID,
        filter: ['==', ['get', 'snap'], true],
        paint: { 'circle-radius': 11, 'circle-color': 'rgba(0,220,255,0.2)', 'circle-stroke-width': 2, 'circle-stroke-color': '#00dcff' } });

      // Re-apply global line width (layers were just recreated)
      map.setPaintProperty(LAYER_IDS.polygonOutline, 'line-width', globalLineWidthRef.current);
      // Re-apply visibility (layers were just recreated)
      if (!showPolygonsRef.current) {
        map.setLayoutProperty(LAYER_IDS.polygonFill, 'visibility', 'none');
        map.setLayoutProperty(LAYER_IDS.polygonOutline, 'visibility', 'none');
      }
      if (!showPointsRef.current) {
        map.setLayoutProperty(LAYER_IDS.point, 'visibility', 'none');
        map.setLayoutProperty(LAYER_IDS.pointArrow, 'visibility', 'none');
      }
      const ptVis2 = showPointsRef.current ? 'visible' : 'none';
      if (map.getLayer(LAYER_IDS_AZ.circle)) map.setLayoutProperty(LAYER_IDS_AZ.circle, 'visibility', ptVis2);
      if (map.getLayer(LAYER_IDS_AZ.sector)) map.setLayoutProperty(LAYER_IDS_AZ.sector, 'visibility', ptVis2);
      const polySectorVis = showPolygonsRef.current && showPolygonSectorsRef.current ? 'visible' : 'none';
      if (map.getLayer(LAYER_IDS_AZ.polyCircle)) map.setLayoutProperty(LAYER_IDS_AZ.polyCircle, 'visibility', polySectorVis);
      if (map.getLayer(LAYER_IDS_AZ.polySector)) map.setLayoutProperty(LAYER_IDS_AZ.polySector, 'visibility', polySectorVis);
      if (map.getLayer(LAYER_IDS_AZ.polygonArrow)) map.setLayoutProperty(LAYER_IDS_AZ.polygonArrow, 'visibility', showPolygonsRef.current ? 'visible' : 'none');
      // Re-apply pattern mode if active (layers were just recreated)
      if (patternTypeRef.current) applyPatternToMap(map, patternTypeRef.current);
    } catch (err) {
      console.error(`Failed to load ${name}:`, err);
    }
  }, []);

  useEffect(() => {
    if (mapReady) loadGeoJSON(activeLayer, viewingRef);
  }, [mapReady, activeLayer, viewingRef, loadGeoJSON]);

  // --- Edit mode helpers ---

  function handleEditClick() {
    if (!session) { setShowAuthPanel(true); return; }
    if (!session.user?.isEditor) { setShowAuthPanel(true); return; }
    if (editMode) {
      if (dirty) {
        alert('Please commit or discard your changes before exiting edit mode.');
        return;
      }
      setEditMode(false);
      setSelectedFeatureId(null);
      setShowImportDialog(false);
      return;
    }
    const clone = JSON.parse(JSON.stringify(originalGeoJSONRef.current));
    // Ensure every feature has a stable UUID so node-edit and selection can find them by id
    clone.features = clone.features.map((f) => f.id ? f : { ...f, id: crypto.randomUUID() });
    editedGeoJSONRef.current = clone;
    setEditedGeoJSON(clone);
    setEditMode(true);
  }

  function syncFeatureColors() {
    const base = editedGeoJSONRef.current;
    if (!base) return;
    const changedIds = [];
    const updated = {
      ...base,
      features: base.features.map((feature) => {
        const props = feature.properties || {};
        let color = null;
        if (soundMode === 'letter') {
          color = props['sound-class'] ? (SOUND_LETTER_COLORS[props['sound-class']] || null) : null;
        } else if (props['sound-class-num'] !== undefined && props['sound-class-num'] !== null && props['sound-class-num'] !== '') {
          color = deriveFromNum(Number(props['sound-class-num'])).featureColor;
        } else if (props['sound-class']) {
          color = SOUND_LETTER_COLORS[props['sound-class']] || null;
        }
        if (!color) return feature;
        if (props.fill === color && props['marker-color'] === color) return feature;
        changedIds.push(feature.id);
        return { ...feature, properties: { ...props, fill: color, 'marker-color': color } };
      }),
    };
    if (!changedIds.length) {
      alert('No color updates were needed.');
      return;
    }
    editedGeoJSONRef.current = updated;
    setEditedGeoJSON(updated);
    syncMainAndSectors(mapRef.current, updated);
    setDirtyFeatureIds((prev) => new Set([...prev, ...changedIds]));
    alert(`Synced colors for ${changedIds.length} feature${changedIds.length === 1 ? '' : 's'}.`);
  }

  async function executeImport(sourceMapName, mode, smartFields) {
    const base = editedGeoJSONRef.current;
    if (!base) return;
    try {
      let res = await fetch(`/data/${sourceMapName}.json`);
      if (!res.ok) res = await fetch(`/data/${sourceMapName}.geojson`);
      if (!res.ok) throw new Error(`Could not load ${sourceMapName}`);
      const sourceGeoJSON = await res.json();

      let updated, dirtyIds;

      if (mode === 'replace-points' || mode === 'replace-polygons') {
        const geomType = mode === 'replace-points' ? 'Point' : 'Polygon';
        const kept = base.features.filter((f) => f.geometry?.type !== geomType);
        const removedIds = base.features.filter((f) => f.geometry?.type === geomType).map((f) => f.id);
        const incoming = sourceGeoJSON.features
          .filter((f) => f.geometry?.type === geomType)
          .map((f) => ({ ...f, id: crypto.randomUUID() }));
        updated = { ...base, features: [...kept, ...incoming] };
        dirtyIds = [...removedIds, ...incoming.map((f) => f.id)];
      } else {
        const fieldsToImport = [...smartFields].flatMap((g) => SMART_IMPORT_FIELDS[g] || []);
        const targets = base.features.filter((f) => f.geometry?.type === 'Polygon');
        const sources = sourceGeoJSON.features.filter((f) => f.geometry?.type === 'Polygon');
        if (!targets.length || !sources.length) {
          alert('No polygons found to match.');
          return;
        }

        const candidates = [];
        targets.forEach((target, ti) => {
          const targetRing = getOpenRing(target);
          if (!targetRing) return;
          sources.forEach((source, si) => {
            const score = bestNodeIndexMatchScore(targetRing, getOpenRing(source));
            if (score >= NAME_MATCH_CONFIDENCE) candidates.push({ ti, si, score });
          });
        });
        candidates.sort((a, b) => b.score - a.score);

        const usedT = new Set(), usedS = new Set(), pairs = [];
        candidates.forEach((c) => {
          if (usedT.has(c.ti) || usedS.has(c.si)) return;
          usedT.add(c.ti); usedS.add(c.si);
          pairs.push(c);
        });

        const updates = new Map();
        pairs.forEach(({ ti, si }) => {
          const target = targets[ti];
          const sourceProps = sources[si].properties || {};
          const next = { ...(target.properties || {}) };
          let changed = false;
          fieldsToImport.forEach((key) => {
            if (!Object.prototype.hasOwnProperty.call(sourceProps, key)) return;
            const val = sourceProps[key];
            if (val === undefined || val === null || val === '') {
              if (Object.prototype.hasOwnProperty.call(next, key)) { delete next[key]; changed = true; }
              return;
            }
            if (next[key] !== val) { next[key] = val; changed = true; }
          });
          if (changed) updates.set(target.id, next);
        });

        if (!updates.size) {
          alert(`Matched ${pairs.length} polygons — no field changes needed.`);
          setShowImportDialog(false);
          return;
        }
        updated = {
          ...base,
          features: base.features.map((f) => (updates.has(f.id) ? { ...f, properties: updates.get(f.id) } : f)),
        };
        dirtyIds = [...updates.keys()];
        const skipped = targets.length - pairs.length;
        alert(`Smart import from ${sourceMapName}: matched ${pairs.length}, updated ${updates.size}, skipped ${skipped}.`);
      }

      editedGeoJSONRef.current = updated;
      setEditedGeoJSON(updated);
      syncMainAndSectors(mapRef.current, updated);
      setDirtyFeatureIds((prev) => new Set([...prev, ...dirtyIds]));
      setShowImportDialog(false);
    } catch (err) {
      alert(`Import failed: ${err.message}`);
    }
  }

  function handleFeatureUpdate(featureId, newProps) {
    const base = editedGeoJSONRef.current || originalGeoJSONRef.current;
    const updated = {
      ...base,
      features: base.features.map((f) =>
        f.id === featureId ? { ...f, properties: newProps } : f
      ),
    };
    editedGeoJSONRef.current = updated;
    setEditedGeoJSON(updated);
    syncMainAndSectors(mapRef.current, updated);
    setDirtyFeatureIds((prev) => new Set([...prev, featureId]));
  }

  function handleDiscard() {
    if (!window.confirm('Discard all unsaved changes?')) return;
    const original = originalGeoJSONRef.current;
    editedGeoJSONRef.current = null;
    setEditedGeoJSON(null);
    setDirtyFeatureIds(new Set());
    setPendingRevert(false);
    setSelectedFeatureId(null);
    setSlicingPolygon(false);
    setSliceNodes([]);
    sliceNodesRef.current = [];
    setShowCommitInput(false);
    clearDrawPreview(mapRef.current);
    syncMainAndSectors(mapRef.current, original);
  }

  function handleRevert() {
    if (!originalGeoJSONRef.current || !viewingRef) return;
    editedGeoJSONRef.current = originalGeoJSONRef.current;
    setEditedGeoJSON(originalGeoJSONRef.current);
    setPendingRevert(true);
    setCommitMsg(`revert to: ${viewingRef.slice(0, 7)}`);
    setShowCommitInput(true);
  }

  async function handleCommit() {
    const geojsonToCommit = editedGeoJSONRef.current || originalGeoJSONRef.current;
    const message = commitMsg.trim() || `Edit ${activeLayer}`;
    setCommitLoading(true);
    try {
      const res = await fetch('/api/github/commit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ map: activeLayer, geojson: geojsonToCommit, message }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Commit failed');
      }
      originalGeoJSONRef.current = geojsonToCommit;
      editedGeoJSONRef.current = null;
      setEditedGeoJSON(null);
      setDirtyFeatureIds(new Set());
      setEditMode(false);
      setSelectedFeatureId(null);
      setShowCommitInput(false);
      setCommitMsg('');
      if (pendingRevert) { setPendingRevert(false); setViewingRef(null); }
    } catch (err) {
      alert(`Failed to commit: ${err.message}`);
    } finally {
      setCommitLoading(false);
    }
  }

  function handleLayerChange(e) {
    if (dirty) {
      alert('You have unsaved changes. Please commit or discard before switching maps.');
      return;
    }
    setActiveLayer(e.target.value);
    setViewingRef(null);
    window.history.pushState(null, '', `/${e.target.value}`);
  }

  return (
    <div className="map-wrap">
      <div ref={mapContainer} className="map-container" />
      {!mapReady && <div className="map-loading">Loading map…</div>}

      {/* Top-right controls */}
      <div className="map-controls">
        <div className={`layer-switcher ${editMode ? 'edit-mode-active' : ''}`}>
          <label htmlFor="layer-select">Layer</label>
          <select
            id="layer-select"
            value={activeLayer}
            onChange={handleLayerChange}
            title={dirty ? 'Commit or discard changes before switching layers' : undefined}
          >
            {layers.map((name) => (
              <option key={name} value={name}>{mapsConfig?.[name]?.shortName || name.replace('map', 'Map ')}</option>
            ))}
          </select>
        </div>

        <button
          className={`hamburger-btn ${menuOpen ? 'is-open' : ''}`}
          onClick={() => setMenuOpen((o) => !o)}
          aria-label="Menu"
        >
          <span /><span /><span />
        </button>
      </div>

      {/* Schedule panel */}
      {showSchedule && (
        <div className="schedule-panel">
          <img
            src="/schedule/sound-schedule-v2.png"
            alt="Sound schedule"
            className="schedule-img"
            onClick={() => setScheduleLightbox(true)}
            title="Click to enlarge"
          />
        </div>
      )}

      {/* Schedule lightbox */}
      {scheduleLightbox && (
        <div className="schedule-lightbox" onClick={() => setScheduleLightbox(false)}>
          <img src="/schedule/sound-schedule-v2.png" alt="Sound schedule" className="schedule-lightbox-img" />
        </div>
      )}

      {/* First-visit welcome tooltip */}
      {showWelcome && (
        <div className="welcome-tooltip" onClick={dismissWelcome} role="button" aria-label="Dismiss welcome">
          <div className="welcome-arrow-right" />
          <div className="welcome-title">Welcome to Sound maps</div>
          <div className="welcome-hint">Have a look at these three map proposals — switch using the dropdown →</div>
          <ul className="welcome-proposals">
            <li><span className="welcome-proposal-num">#1</span> Quiet North &amp; Dirty South</li>
            <li><span className="welcome-proposal-num">#2</span> Day Land &amp; Night Land</li>
            <li><span className="welcome-proposal-num">#3</span> Double Night Lands</li>
          </ul>
          <div className="welcome-dismiss">Tap anywhere to dismiss</div>
        </div>
      )}

      {/* Hamburger menu dropdown */}
      {menuOpen && (
        <div className="hamburger-menu">
          <div className="menu-visibility-row">
            <span className="menu-visibility-label">Show</span>
            <button
              className={`visibility-toggle-btn ${showPolygons ? 'is-on' : ''}`}
              onClick={() => setShowPolygons((v) => !v)}
              title={showPolygons ? 'Hide polygons' : 'Show polygons'}
            >
              ▭ Polygons
            </button>
            <button
              className={`visibility-toggle-btn ${showPoints ? 'is-on' : ''}`}
              onClick={() => setShowPoints((v) => !v)}
              title={showPoints ? 'Hide points' : 'Show points'}
            >
              ● Points
            </button>
            <button
              className={`visibility-toggle-btn ${showPolygonSectors ? 'is-on' : ''}`}
              onClick={() => setShowPolygonSectors((v) => !v)}
              title={showPolygonSectors ? 'Hide polygon sectors' : 'Show polygon sectors'}
            >
              ◔ Poly sectors
            </button>
            <button
              className={`visibility-toggle-btn ${showSchedule ? 'is-on' : ''}`}
              onClick={() => setShowSchedule((v) => !v)}
              title="Show sound schedule"
            >
              Schedule
            </button>
          </div>

          <div className="menu-visibility-row" style={{ flexDirection: 'column', alignItems: 'stretch', gap: '8px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <span className="menu-visibility-label">Map</span>
              <button
                className={`visibility-toggle-btn ${grayscale ? 'is-on' : ''}`}
                onClick={() => setGrayscale((v) => !v)}
                title={grayscale ? 'Color satellite' : 'Grayscale satellite'}
              >
                Grayscale
              </button>
            </div>
            <div className="menu-global-row">
              <label className="menu-global-label">
                Elevation overlay<span className="menu-global-value">{Math.round(elevationOpacity * 100)}%</span>
              </label>
              <input
                type="range" min={0} max={1} step={0.05}
                value={elevationOpacity}
                onChange={(e) => setElevationOpacity(Number(e.target.value))}
                className="menu-global-slider"
              />
            </div>
          </div>

          <div className="menu-bw-accordion">
            <div className="menu-bw-header" onClick={() => setAdvOpen((v) => !v)}>
              <span className="menu-visibility-label">Advanced options</span>
              {patternType && <span className="visibility-toggle-btn is-on" style={{ pointerEvents: 'none', padding: '2px 8px', fontSize: '11px' }}>{patternType}</span>}
              {editMode && <span className="visibility-toggle-btn is-on" style={{ pointerEvents: 'none', padding: '2px 8px', fontSize: '11px' }}>editing</span>}
              <span className={`menu-bw-chevron ${advOpen ? 'is-open' : ''}`}>▼</span>
            </div>
            {advOpen && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', padding: '2px 12px 12px' }}>
                <div>
                  <div className="menu-visibility-label" style={{ marginBottom: '6px' }}>B&W patterns</div>
                  <div className="menu-bw-body" style={{ padding: 0 }}>
                    {[
                      { type: 'dots',    label: '· Dots' },
                      { type: 'grid',    label: '# Grid' },
                      { type: 'stripes', label: '/ Stripes' },
                    ].map(({ type, label }) => (
                      <button
                        key={type}
                        className={`visibility-toggle-btn ${patternType === type ? 'is-on' : ''}`}
                        onClick={() => setPatternType((v) => v === type ? null : type)}
                        title={patternType === type ? 'Turn off B&W mode' : `B&W: ${label}`}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                  {!viewingRef && (
                    <button
                      className={`edit-toggle-btn ${editMode ? 'is-editing' : ''}`}
                      onClick={handleEditClick}
                      title={editMode ? 'Exit edit mode' : 'Edit this map'}
                    >
                      {editMode ? '✎ Editing' : '✎ Edit'}
                    </button>
                  )}
                  <AuthButton />
                </div>
                {editMode && session?.user?.isEditor && (
                  <div className="menu-global-settings" style={{ margin: 0 }}>
                    <div className="menu-global-title">Global settings</div>
                    <div className="menu-global-row">
                      <label className="menu-global-label" htmlFor="line-width-input">
                        Border width
                        <span className="menu-global-value">{globalLineWidth}px</span>
                      </label>
                      <input
                        id="line-width-input"
                        type="range" min={0} max={8} step={0.5}
                        value={globalLineWidth}
                        onChange={(e) => setGlobalLineWidth(Number(e.target.value))}
                        className="menu-global-slider"
                      />
                    </div>
                    <div className="menu-global-row">
                      <label className="menu-global-label" htmlFor="snap-dist-input">
                        Snap distance
                        <span className="menu-global-value">{snapDistance}px</span>
                      </label>
                      <input
                        id="snap-dist-input"
                        type="range" min={4} max={40} step={1}
                        value={snapDistance}
                        onChange={(e) => setSnapDistance(Number(e.target.value))}
                        className="menu-global-slider"
                      />
                    </div>
                    <div className="menu-global-divider" />
                    <button className="menu-map-edits-btn" onClick={syncFeatureColors}>
                      Sync colors from sound class
                    </button>
                    <button className="menu-map-edits-btn" onClick={() => setShowImportDialog(true)}>
                      Import from map…
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
          {mapsConfig && (
            <MapInfoCard
              mapName={activeLayer}
              mapsConfig={mapsConfig}
              viewingRef={viewingRef}
              onLoadRef={(ref) => { setViewingRef(ref); setMenuOpen(false); }}
              onBackToLatest={() => { setViewingRef(null); }}
              onRevert={handleRevert}
              isEditor={!!session?.user?.isEditor}
            />
          )}
        </div>
      )}

      {/* Auth / access panel */}
      {showAuthPanel && (
        <div className="auth-panel-overlay" onClick={(e) => { if (e.target === e.currentTarget) setShowAuthPanel(false); }}>
          <div className="auth-panel-card">
            <button className="auth-panel-close" onClick={() => setShowAuthPanel(false)}>×</button>
            {!session ? (
              <>
                <h3 className="auth-panel-title">Sign in to edit</h3>
                <p className="auth-panel-text">You need a GitHub account to edit the map.</p>
                <button className="auth-panel-signin-btn" onClick={() => signIn('github')}>
                  Sign in with GitHub
                </button>
                <p className="auth-panel-help">
                  To request editor access, contact <strong>Frisky</strong> on the Borderland Discord in{' '}
                  <code>#sound</code>.
                </p>
              </>
            ) : (
              <>
                <h3 className="auth-panel-title">Editor access required</h3>
                <p className="auth-panel-text">
                  You are signed in as <strong>{session.user.name}</strong> but do not have editor access.
                </p>
                <p className="auth-panel-help">
                  Contact <strong>Frisky</strong> on the Borderland Discord in <code>#sound</code> to be
                  added as an editor.
                </p>
              </>
            )}
          </div>
        </div>
      )}

      {/* Edit panel */}
      {editMode && selectedFeature && (
        <EditPanel
          feature={selectedFeature}
          onUpdate={handleFeatureUpdate}
          onClose={() => setSelectedFeatureId(null)}
          onDelete={handleFeatureDelete}
          soundMode={soundMode}
          onSlice={selectedFeature.geometry?.type === 'Polygon' ? startSlicePolygon : null}
        />
      )}

      {/* Edit mode toolbar */}
      {editMode && !selectedFeature && !drawingPolygon && !placingPoint && !slicingPolygon && (
        <div className="edit-hint">
          Click a zone or point to edit it
          <button className="draw-polygon-btn" onClick={startDrawing}>+ Draw polygon</button>
          <button className="draw-polygon-btn" onClick={startPlacingPoint}>+ Place point</button>
        </div>
      )}
      {editMode && slicingPolygon && (
        <div className="edit-hint drawing-active">
          {sliceNodes.length ? 'Click second point to slice — Backspace to clear' : 'Click first point for slice line'}
          <button className="draw-cancel-btn" onClick={cancelSlicePolygon}>Cancel</button>
        </div>
      )}
      {editMode && drawingPolygon && (
        <div className="edit-hint drawing-active">
          {drawNodes.length < 3
            ? `Click to place node ${drawNodes.length + 1} (need 3+)`
            : `${drawNodes.length} nodes — click first node to close`}
          <button className="draw-cancel-btn" onClick={cancelDrawing}>Cancel</button>
        </div>
      )}
      {editMode && placingPoint && (
        <div className="edit-hint drawing-active">
          Click on the map to place a point
          <button className="draw-cancel-btn" onClick={cancelPlacingPoint}>Cancel</button>
        </div>
      )}

      {/* Commit / discard bar */}
      {dirty && (
        <div className="commit-bar">
          <span className="commit-count">
            {pendingRevert ? 'Revert staged' : `${dirtyFeatureIds.size} feature${dirtyFeatureIds.size !== 1 ? 's' : ''} edited`}
          </span>

          {showCommitInput ? (
            <>
              <input
                type="text"
                className="commit-msg-input"
                value={commitMsg}
                onChange={(e) => setCommitMsg(e.target.value)}
                placeholder={`Edit ${activeLayer}`}
                onKeyDown={(e) => { if (e.key === 'Enter') handleCommit(); }}
                autoFocus
              />
              <button className="commit-btn" onClick={handleCommit} disabled={commitLoading}>
                {commitLoading ? 'Committing…' : 'Commit'}
              </button>
              <button className="commit-cancel-btn" onClick={() => setShowCommitInput(false)}>
                Cancel
              </button>
            </>
          ) : (
            <button
              className="commit-btn"
              onClick={() => { setCommitMsg(`Edit ${activeLayer}`); setShowCommitInput(true); }}
            >
              Commit changes
            </button>
          )}

          <button className="discard-btn" onClick={handleDiscard}>Discard</button>
        </div>
      )}

      {showImportDialog && (
        <ImportDialog
          layers={layers}
          mapsConfig={mapsConfig}
          activeLayer={activeLayer}
          onConfirm={executeImport}
          onClose={() => setShowImportDialog(false)}
        />
      )}

      {/* Help button */}
      <button
        className="help-btn"
        onClick={() => setShowHelp(true)}
        title="How to use this map"
        aria-label="Help"
      >?</button>

      {/* Help / tutorial modal */}
      {showHelp && (
        <div className="help-overlay" onClick={() => setShowHelp(false)}>
          <div className="help-modal" onClick={(e) => e.stopPropagation()}>
            <div className="help-header">
              <span className="help-title">How to use this map</span>
              <button className="help-close" onClick={() => setShowHelp(false)}>✕</button>
            </div>

            <div className="help-sections">
              <div className="help-section">
                <div className="help-section-icon">🗺️</div>
                <div>
                  <div className="help-section-title">Navigate</div>
                  <div className="help-section-body">Drag to pan around the map. Scroll or pinch to zoom in and out.</div>
                </div>
              </div>

              <div className="help-section">
                <div className="help-section-icon">🔀</div>
                <div>
                  <div className="help-section-title">Switch maps</div>
                  <div className="help-section-body">Use the <strong>Layer</strong> dropdown in the top-right corner to switch between the three zone proposals and other maps.</div>
                </div>
              </div>

              <div className="help-section">
                <div className="help-section-icon">☰</div>
                <div>
                  <div className="help-section-title">Menu</div>
                  <div className="help-section-body">Open the menu with the <strong>≡</strong> button (top-right, next to the dropdown) to access all display options below.</div>
                </div>
              </div>

              <div className="help-section">
                <div className="help-section-icon">👁️</div>
                <div>
                  <div className="help-section-title">Show / hide layers</div>
                  <div className="help-section-body">Under <strong>Show</strong> in the menu, toggle <em>Polygons</em> (coloured zones) and <em>Points</em> (camps and markers) on or off.</div>
                </div>
              </div>

              <div className="help-section">
                <div className="help-section-icon">📅</div>
                <div>
                  <div className="help-section-title">Sound schedule</div>
                  <div className="help-section-body">Click <strong>Schedule</strong> under <em>Show</em> to open the colour legend and dB schedule. Click the image to view it full size.</div>
                </div>
              </div>

              <div className="help-section">
                <div className="help-section-icon">⛰️</div>
                <div>
                  <div className="help-section-title">Elevation overlay</div>
                  <div className="help-section-body">Under <strong>Map</strong> in the menu, drag the <em>Elevation overlay</em> slider to fade a terrain map on top of the satellite image.</div>
                </div>
              </div>

              <div className="help-section">
                <div className="help-section-icon">🎨</div>
                <div>
                  <div className="help-section-title">Grayscale satellite</div>
                  <div className="help-section-body">Toggle <strong>Grayscale</strong> under <em>Map</em> to switch the satellite background between colour and greyscale.</div>
                </div>
              </div>
            </div>

            <div className="help-footer">Click outside or ✕ to close</div>
          </div>
        </div>
      )}
    </div>
  );
}
