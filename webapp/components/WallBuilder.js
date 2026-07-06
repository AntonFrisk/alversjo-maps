'use client';

import { useRef, useEffect, useState, useCallback } from 'react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { CENTER, ZOOM, LOCAL_SATELLITE_STYLE, pixelsForMeters } from '@/lib/map-style';

const CAMPS_SOURCE = 'sound-camps';
const OTHER_SOURCE = 'other-camps';
const WALLS_SOURCE = 'walls';
const DRAW_SOURCE = 'wall-draw';
const NODE_SOURCE = 'wall-nodes';

const WALL_WIDTH_M = 1.2; // hay-bale wall thickness
const WALL_COLOR = '#d9c58c'; // yellow-beige hay bale
const LAT = CENTER[1];

const EMPTY = { type: 'FeatureCollection', features: [] };

// A single static zoom-interpolated expression that renders WALL_WIDTH_M meters
// of ground width in pixels at any zoom (pixels ∝ 2^zoom → exact with exponential base 2).
function wallWidthExpr() {
  return [
    'interpolate', ['exponential', 2], ['zoom'],
    13, pixelsForMeters(WALL_WIDTH_M, LAT, 13),
    19, pixelsForMeters(WALL_WIDTH_M, LAT, 19),
  ];
}

function ShareIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="18" cy="5" r="3" />
      <circle cx="6" cy="12" r="3" />
      <circle cx="18" cy="19" r="3" />
      <line x1="8.59" y1="13.51" x2="15.42" y2="17.49" />
      <line x1="15.41" y1="6.51" x2="8.59" y2="10.49" />
    </svg>
  );
}

function coordsText(feature) {
  const name = feature.properties?.name || 'wall';
  const coords = feature.geometry?.coordinates || [];
  const lines = coords.map(([lng, lat], i) => `P${i + 1}\t${lat.toFixed(6)}\t${lng.toFixed(6)}`);
  return [`Wall: ${name}`, 'Point\tLatitude\tLongitude', ...lines].join('\n');
}

// Drop trailing/consecutive points that land within ~8px of each other (double-click artifacts).
function dedupeByPixels(map, coords) {
  const out = [];
  for (const c of coords) {
    if (out.length) {
      const a = map.project(out[out.length - 1]);
      const b = map.project(c);
      if (Math.hypot(a.x - b.x, a.y - b.y) < 8) continue;
    }
    out.push(c);
  }
  return out;
}

export default function WallBuilder() {
  const mapContainer = useRef(null);
  const mapRef = useRef(null);
  const [mapReady, setMapReady] = useState(false);

  const [walls, setWalls] = useState(EMPTY);
  const wallsRef = useRef(EMPTY);

  const [buildMode, setBuildMode] = useState(false);
  const buildModeRef = useRef(false);
  const [drawing, setDrawing] = useState(false);
  const drawingRef = useRef(false);
  const drawNodesRef = useRef([]);
  const [drawCount, setDrawCount] = useState(0);

  const [selectedId, setSelectedId] = useState(null);
  const selectedIdRef = useRef(null);

  const [showAllCamps, setShowAllCamps] = useState(false);
  const otherCampsRef = useRef(EMPTY);
  const pinnedIdsRef = useRef([]);
  const [selectedCamp, setSelectedCamp] = useState(null); // pinned camp {id, name} for remove panel

  const [identityOpen, setIdentityOpen] = useState(false);
  const [builder, setBuilder] = useState('');
  const [camp, setCamp] = useState('');
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);
  const [shared, setShared] = useState(false);
  const [saving, setSaving] = useState(false);

  const deepLinkWallRef = useRef(null);
  const deepLinkDoneRef = useRef(false);

  const draggingRef = useRef(null); // { idx }
  const finishDrawRef = useRef(() => {});

  const selectedWall = walls.features.find((f) => f.id === selectedId) || null;

  // ---- data sync helpers ----
  // MapLibre drops non-numeric (UUID) feature ids, so mirror each id into properties
  // for click-selection and the selected-wall filter to work reliably.
  const setWallsData = useCallback((raw) => {
    const fc = {
      type: 'FeatureCollection',
      features: (raw.features || []).map((f) => ({ ...f, properties: { ...f.properties, id: f.id } })),
    };
    wallsRef.current = fc;
    setWalls(fc);
    mapRef.current?.getSource(WALLS_SOURCE)?.setData(fc);
  }, []);

  // Show a spinner cursor + saving pill while a Blob write is in flight.
  const setBusy = useCallback((on) => {
    setSaving(on);
    const c = mapRef.current?.getCanvas();
    if (c) c.style.cursor = on ? 'progress' : '';
  }, []);

  // ---- node-handle source (selected wall vertices + midpoints) ----
  const updateNodeSource = useCallback(() => {
    const map = mapRef.current;
    if (!map?.getSource(NODE_SOURCE)) return;
    const wall = wallsRef.current.features.find((f) => f.id === selectedIdRef.current);
    const features = [];
    if (wall && buildModeRef.current && !drawingRef.current) {
      const c = wall.geometry.coordinates;
      c.forEach((pt, i) => features.push({
        type: 'Feature', properties: { kind: 'node', idx: i },
        geometry: { type: 'Point', coordinates: pt },
      }));
      for (let i = 0; i < c.length - 1; i += 1) {
        features.push({
          type: 'Feature', properties: { kind: 'mid', afterIdx: i },
          geometry: { type: 'Point', coordinates: [(c[i][0] + c[i + 1][0]) / 2, (c[i][1] + c[i + 1][1]) / 2] },
        });
      }
    }
    map.getSource(NODE_SOURCE).setData({ type: 'FeatureCollection', features });
  }, []);

  // Select a wall and zoom the map to it (used by click + deep-link).
  const focusWall = useCallback((id) => {
    const wall = wallsRef.current.features.find((f) => f.id === id);
    if (!wall || !mapRef.current) return;
    setSelectedCamp(null);
    selectedIdRef.current = id;
    setSelectedId(id);
    mapRef.current.setFilter('walls-selected', ['==', ['get', 'id'], id]);
    updateNodeSource();
    const coords = wall.geometry.coordinates;
    const bounds = coords.reduce((b, c) => b.extend(c), new maplibregl.LngLatBounds(coords[0], coords[0]));
    mapRef.current.fitBounds(bounds, { padding: 140, maxZoom: 19, duration: 800 });
  }, [updateNodeSource]);

  const refreshWalls = useCallback(async () => {
    try {
      const res = await fetch('/api/walls', { cache: 'no-store' });
      const fc = await res.json();
      setWallsData(fc.features ? fc : EMPTY);
      // Honor a ?wall=<id> deep link once, after walls are loaded.
      if (!deepLinkDoneRef.current && deepLinkWallRef.current) {
        deepLinkDoneRef.current = true;
        focusWall(deepLinkWallRef.current);
      }
    } catch {
      /* ignore */
    }
  }, [setWallsData, focusWall]);

  // ---- other (non-sound) camps: browse + persistent pin ----
  const applyOtherCamps = useCallback(() => {
    const pinned = new Set(pinnedIdsRef.current.map(Number));
    const fc = {
      type: 'FeatureCollection',
      features: (otherCampsRef.current.features || []).map((f) => ({
        ...f, properties: { ...f.properties, pinned: pinned.has(Number(f.id)) },
      })),
    };
    mapRef.current?.getSource(OTHER_SOURCE)?.setData(fc);
  }, []);

  const refreshCamps = useCallback(async () => {
    try {
      const [other, vis] = await Promise.all([
        fetch('/api/other-camps', { cache: 'no-store' }).then((r) => r.json()),
        fetch('/api/visible-camps', { cache: 'no-store' }).then((r) => r.json()),
      ]);
      otherCampsRef.current = other.features ? other : EMPTY;
      pinnedIdsRef.current = vis.ids || [];
      applyOtherCamps();
    } catch { /* ignore */ }
  }, [applyOtherCamps]);

  const pinCamp = useCallback(async (id) => {
    if (!pinnedIdsRef.current.map(Number).includes(Number(id))) {
      pinnedIdsRef.current = [...pinnedIdsRef.current, Number(id)];
      applyOtherCamps();
    }
    try {
      setBusy(true);
      const r = await fetch('/api/visible-camps', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: Number(id) }),
      });
      const d = await r.json();
      if (d.ids) { pinnedIdsRef.current = d.ids; applyOtherCamps(); }
    } catch { /* ignore */ } finally { setBusy(false); }
  }, [applyOtherCamps, setBusy]);
  const pinCampRef = useRef(() => {});
  pinCampRef.current = pinCamp;

  const unpinCamp = useCallback(async (id) => {
    pinnedIdsRef.current = pinnedIdsRef.current.map(Number).filter((x) => x !== Number(id));
    applyOtherCamps();
    setSelectedCamp(null);
    try {
      setBusy(true);
      const r = await fetch(`/api/visible-camps?id=${encodeURIComponent(id)}`, { method: 'DELETE' });
      const d = await r.json();
      if (d.ids) { pinnedIdsRef.current = d.ids; applyOtherCamps(); }
    } catch { /* ignore */ } finally { setBusy(false); }
  }, [applyOtherCamps, setBusy]);

  const toggleShowAll = useCallback(() => {
    setShowAllCamps((v) => {
      const vis = v ? 'none' : 'visible';
      mapRef.current?.setLayoutProperty('other-browse-fill', 'visibility', vis);
      mapRef.current?.setLayoutProperty('other-browse-outline', 'visibility', vis);
      return !v;
    });
  }, []);

  // ---- draw preview ----
  const updateDrawPreview = useCallback((cursor) => {
    const map = mapRef.current;
    if (!map?.getSource(DRAW_SOURCE)) return;
    const nodes = drawNodesRef.current;
    const features = [];
    const lineCoords = cursor ? [...nodes, cursor] : nodes;
    if (lineCoords.length >= 2) {
      features.push({ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: lineCoords } });
    }
    nodes.forEach((pt) => features.push({ type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: pt } }));
    map.getSource(DRAW_SOURCE).setData({ type: 'FeatureCollection', features });
  }, []);

  // ---- initialize map once ----
  useEffect(() => {
    if (mapRef.current) return;
    const map = new maplibregl.Map({
      container: mapContainer.current,
      style: LOCAL_SATELLITE_STYLE,
      center: CENTER,
      zoom: ZOOM,
    });

    map.on('load', () => {
      // Other camps (non-sound): light-gray browse layer (toggled) + blue pinned layer.
      map.addSource(OTHER_SOURCE, { type: 'geojson', data: EMPTY });
      map.addLayer({ id: 'other-browse-fill', type: 'fill', source: OTHER_SOURCE,
        filter: ['!=', ['get', 'pinned'], true],
        layout: { visibility: 'none' },
        paint: { 'fill-color': '#9aa0a6', 'fill-opacity': 0.15 } });
      map.addLayer({ id: 'other-browse-outline', type: 'line', source: OTHER_SOURCE,
        filter: ['!=', ['get', 'pinned'], true],
        layout: { visibility: 'none' },
        paint: { 'line-color': '#9aa0a6', 'line-width': 1, 'line-opacity': 0.6 } });
      map.addLayer({ id: 'other-pinned-fill', type: 'fill', source: OTHER_SOURCE,
        filter: ['==', ['get', 'pinned'], true],
        paint: { 'fill-color': '#3ba0ff', 'fill-opacity': 0.15 } });
      map.addLayer({ id: 'other-pinned-outline', type: 'line', source: OTHER_SOURCE,
        filter: ['==', ['get', 'pinned'], true],
        paint: { 'line-color': '#3ba0ff', 'line-width': 1.5, 'line-opacity': 0.8 } });
      map.addLayer({ id: 'other-pinned-label', type: 'symbol', source: OTHER_SOURCE,
        filter: ['==', ['get', 'pinned'], true],
        layout: { 'text-field': ['get', 'name'], 'text-size': 12, 'text-allow-overlap': false },
        paint: { 'text-color': '#0a3a66', 'text-halo-color': '#fff', 'text-halo-width': 1.5 } });

      // Sound-camp context (read-only) — pink, always shown with names.
      map.addSource(CAMPS_SOURCE, { type: 'geojson', data: EMPTY });
      map.addLayer({ id: 'camps-fill', type: 'fill', source: CAMPS_SOURCE,
        paint: { 'fill-color': '#ff4da6', 'fill-opacity': 0.15 } });
      map.addLayer({ id: 'camps-outline', type: 'line', source: CAMPS_SOURCE,
        paint: { 'line-color': '#ff1f8f', 'line-width': 1.5, 'line-opacity': 0.8 } });
      map.addLayer({ id: 'camps-label', type: 'symbol', source: CAMPS_SOURCE,
        layout: { 'text-field': ['get', 'name'], 'text-size': 12, 'text-allow-overlap': false },
        paint: { 'text-color': '#8a1155', 'text-halo-color': '#fff', 'text-halo-width': 1.5 } });

      // Walls
      map.addSource(WALLS_SOURCE, { type: 'geojson', data: EMPTY });
      // Wide invisible hit target for easy clicking
      map.addLayer({ id: 'walls-hit', type: 'line', source: WALLS_SOURCE,
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': '#000', 'line-opacity': 0, 'line-width': 14 } });
      map.addLayer({ id: 'walls-line', type: 'line', source: WALLS_SOURCE,
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': WALL_COLOR, 'line-opacity': 0.6, 'line-width': wallWidthExpr() } });
      map.addLayer({ id: 'walls-selected', type: 'line', source: WALLS_SOURCE,
        filter: ['==', ['get', 'id'], '__none__'],
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': '#ff5a1f', 'line-opacity': 0.9, 'line-width': 2, 'line-dasharray': [2, 1.5] } });

      // Draw preview
      map.addSource(DRAW_SOURCE, { type: 'geojson', data: EMPTY });
      map.addLayer({ id: 'draw-line', type: 'line', source: DRAW_SOURCE,
        paint: { 'line-color': '#ff5a1f', 'line-width': 2, 'line-dasharray': [3, 2] } });
      map.addLayer({ id: 'draw-nodes', type: 'circle', source: DRAW_SOURCE,
        filter: ['==', '$type', 'Point'],
        paint: { 'circle-radius': 5, 'circle-color': '#fff', 'circle-stroke-width': 2, 'circle-stroke-color': '#ff5a1f' } });

      // Node handles (selected wall)
      map.addSource(NODE_SOURCE, { type: 'geojson', data: EMPTY });
      map.addLayer({ id: 'wall-node-mid', type: 'circle', source: NODE_SOURCE,
        filter: ['==', ['get', 'kind'], 'mid'],
        paint: { 'circle-radius': 4, 'circle-color': 'rgba(255,255,255,0.6)', 'circle-stroke-width': 1, 'circle-stroke-color': '#ff5a1f' } });
      map.addLayer({ id: 'wall-node', type: 'circle', source: NODE_SOURCE,
        filter: ['==', ['get', 'kind'], 'node'],
        paint: { 'circle-radius': 6, 'circle-color': '#fff', 'circle-stroke-width': 2, 'circle-stroke-color': '#ff5a1f' } });

      // ---- interactions ----
      // Add point while drawing
      map.on('click', (e) => {
        if (!drawingRef.current) return;
        drawNodesRef.current = [...drawNodesRef.current, [e.lngLat.lng, e.lngLat.lat]];
        setDrawCount(drawNodesRef.current.length);
        updateDrawPreview();
      });

      map.on('mousemove', (e) => {
        if (drawingRef.current && drawNodesRef.current.length) {
          updateDrawPreview([e.lngLat.lng, e.lngLat.lat]);
        }
      });

      // Double-click finishes the wall
      map.on('dblclick', (e) => {
        if (!drawingRef.current) return;
        e.preventDefault();
        drawNodesRef.current = [...drawNodesRef.current, [e.lngLat.lng, e.lngLat.lat]];
        finishDrawRef.current();
      });

      // Select existing wall
      map.on('click', 'walls-hit', (e) => {
        if (drawingRef.current) return;
        e.preventDefault();
        const id = e.features[0]?.properties?.id;
        if (id != null) {
          setSelectedCamp(null);
          selectedIdRef.current = String(id);
          setSelectedId(String(id));
          map.setFilter('walls-selected', ['==', ['get', 'id'], String(id)]);
          updateNodeSource();
        }
      });
      map.on('mouseenter', 'walls-hit', () => { if (!drawingRef.current) map.getCanvas().style.cursor = 'pointer'; });
      map.on('mouseleave', 'walls-hit', () => { if (!drawingRef.current) map.getCanvas().style.cursor = ''; });

      // Click a browse (unpinned) camp → pin it persistently for everyone.
      map.on('click', 'other-browse-fill', (e) => {
        if (drawingRef.current) return;
        const id = e.features[0]?.properties?.id;
        if (id != null) pinCampRef.current(Number(id));
      });
      map.on('mouseenter', 'other-browse-fill', () => { if (!drawingRef.current) map.getCanvas().style.cursor = 'pointer'; });
      map.on('mouseleave', 'other-browse-fill', () => { if (!drawingRef.current) map.getCanvas().style.cursor = ''; });

      // Click a pinned camp → open its panel (with a remove button).
      map.on('click', 'other-pinned-fill', (e) => {
        if (drawingRef.current) return;
        const p = e.features[0]?.properties;
        if (p?.id != null) {
          setSelectedCamp({ id: Number(p.id), name: p.name });
          selectedIdRef.current = null; setSelectedId(null);
          map.setFilter('walls-selected', ['==', ['get', 'id'], '__none__']);
        }
      });
      map.on('mouseenter', 'other-pinned-fill', () => { if (!drawingRef.current) map.getCanvas().style.cursor = 'pointer'; });
      map.on('mouseleave', 'other-pinned-fill', () => { if (!drawingRef.current) map.getCanvas().style.cursor = ''; });

      // Node interaction: Ctrl/Cmd+click deletes the vertex, otherwise drag to move.
      map.on('mousedown', 'wall-node', (e) => {
        if (!buildModeRef.current) return;
        e.preventDefault();
        const idx = e.features[0].properties.idx;
        if (e.originalEvent.ctrlKey || e.originalEvent.metaKey) {
          const wall = wallsRef.current.features.find((f) => f.id === selectedIdRef.current);
          if (!wall) return;
          if (wall.geometry.coordinates.length <= 2) { setError('A wall needs at least 2 points.'); return; }
          wall.geometry.coordinates.splice(idx, 1);
          mapRef.current.getSource(WALLS_SOURCE).setData(wallsRef.current);
          updateNodeSource();
          persistGeometry(wall.id, wall.geometry.coordinates);
          return;
        }
        draggingRef.current = { idx };
        map.dragPan.disable();
        map.getCanvas().style.cursor = 'grabbing';
      });
      map.on('mousemove', (e) => {
        const drag = draggingRef.current;
        if (!drag) return;
        const wall = wallsRef.current.features.find((f) => f.id === selectedIdRef.current);
        if (!wall) return;
        wall.geometry.coordinates[drag.idx] = [e.lngLat.lng, e.lngLat.lat];
        mapRef.current.getSource(WALLS_SOURCE).setData(wallsRef.current);
        updateNodeSource();
      });
      map.on('mouseup', () => {
        if (!draggingRef.current) return;
        draggingRef.current = null;
        map.dragPan.enable();
        map.getCanvas().style.cursor = '';
        const wall = wallsRef.current.features.find((f) => f.id === selectedIdRef.current);
        if (wall) persistGeometry(wall.id, wall.geometry.coordinates);
      });
      map.on('mouseenter', 'wall-node', () => { if (buildModeRef.current) map.getCanvas().style.cursor = 'grab'; });
      map.on('mouseleave', 'wall-node', () => { if (!draggingRef.current) map.getCanvas().style.cursor = ''; });

      // Insert midpoint
      map.on('click', 'wall-node-mid', (e) => {
        if (!buildModeRef.current) return;
        e.preventDefault();
        const afterIdx = e.features[0].properties.afterIdx;
        const wall = wallsRef.current.features.find((f) => f.id === selectedIdRef.current);
        if (!wall) return;
        wall.geometry.coordinates.splice(afterIdx + 1, 0, [e.lngLat.lng, e.lngLat.lat]);
        mapRef.current.getSource(WALLS_SOURCE).setData(wallsRef.current);
        updateNodeSource();
        persistGeometry(wall.id, wall.geometry.coordinates);
      });
      map.on('mouseenter', 'wall-node-mid', () => { if (buildModeRef.current) map.getCanvas().style.cursor = 'copy'; });
      map.on('mouseleave', 'wall-node-mid', () => { if (!draggingRef.current) map.getCanvas().style.cursor = ''; });

      mapRef.current = map;
      setMapReady(true);
    });

    return () => { map.remove(); mapRef.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Load data once map is ready
  useEffect(() => {
    if (!mapReady) return;
    refreshWalls();
    refreshCamps();
    fetch('/api/sound-camps', { cache: 'no-store' })
      .then((r) => r.json())
      .then((fc) => mapRef.current?.getSource(CAMPS_SOURCE)?.setData(fc.features ? fc : EMPTY))
      .catch(() => {});
  }, [mapReady, refreshWalls, refreshCamps]);

  // Restore identity + read ?wall=<id> deep link
  useEffect(() => {
    try {
      setBuilder(localStorage.getItem('wb-builder') || '');
      setCamp(localStorage.getItem('wb-camp') || '');
    } catch { /* ignore */ }
    const w = new URLSearchParams(window.location.search).get('wall');
    if (w) deepLinkWallRef.current = w;
  }, []);

  // ---- server mutations ----
  const persistGeometry = useCallback(async (id, coordinates) => {
    try {
      setBusy(true);
      await fetch('/api/walls', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, coordinates }),
      });
    } catch { /* ignore */ } finally { setBusy(false); }
  }, [setBusy]);

  // Edit a single vertex coordinate from the panel (paste-in friendly).
  const updateWallPoint = useCallback((id, idx, which, valueStr) => {
    const v = parseFloat(valueStr);
    if (!Number.isFinite(v)) return;
    const wall = wallsRef.current.features.find((f) => f.id === id);
    if (!wall) return;
    const coords = wall.geometry.coordinates.map((c) => [...c]);
    coords[idx][which === 'lng' ? 0 : 1] = v;
    setWallsData({
      type: 'FeatureCollection',
      features: wallsRef.current.features.map((f) => (f.id === id ? { ...f, geometry: { ...f.geometry, coordinates: coords } } : f)),
    });
    updateNodeSource();
    persistGeometry(id, coords);
  }, [setWallsData, updateNodeSource, persistGeometry]);

  const deleteWallPoint = useCallback((id, idx) => {
    const wall = wallsRef.current.features.find((f) => f.id === id);
    if (!wall || wall.geometry.coordinates.length <= 2) return;
    const coords = wall.geometry.coordinates.filter((_, i) => i !== idx);
    setWallsData({
      type: 'FeatureCollection',
      features: wallsRef.current.features.map((f) => (f.id === id ? { ...f, geometry: { ...f.geometry, coordinates: coords } } : f)),
    });
    updateNodeSource();
    persistGeometry(id, coords);
  }, [setWallsData, updateNodeSource, persistGeometry]);

  const finishDraw = useCallback(async () => {
    const map = mapRef.current;
    drawingRef.current = false;
    setDrawing(false);
    map.doubleClickZoom.enable();
    map.getCanvas().style.cursor = '';
    const coords = dedupeByPixels(map, drawNodesRef.current);
    drawNodesRef.current = [];
    setDrawCount(0);
    updateDrawPreview();
    if (coords.length < 2) return;

    // Optimistically render the wall immediately so there's no visible lag,
    // then reconcile with the server-assigned feature (id, default name).
    const tempId = crypto.randomUUID();
    const temp = {
      type: 'Feature', id: tempId,
      properties: { name: '…', builder, camp, notes: '', pending: true },
      geometry: { type: 'LineString', coordinates: coords },
    };
    setWallsData({ type: 'FeatureCollection', features: [...wallsRef.current.features, temp] });
    selectedIdRef.current = tempId;
    setSelectedId(tempId);
    map.setFilter('walls-selected', ['==', ['get', 'id'], tempId]);
    updateNodeSource();
    setBusy(true);
    try {
      const res = await fetch('/api/walls', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ builder, camp, coordinates: coords }),
      });
      if (!res.ok) throw new Error((await res.json()).error || 'save failed');
      const feature = await res.json();
      setWallsData({
        type: 'FeatureCollection',
        features: wallsRef.current.features.map((f) => (f.id === tempId ? feature : f)),
      });
      selectedIdRef.current = feature.id;
      setSelectedId(feature.id);
      map.setFilter('walls-selected', ['==', ['get', 'id'], feature.id]);
      updateNodeSource();
    } catch (err) {
      // Roll back the optimistic wall on failure.
      setWallsData({ type: 'FeatureCollection', features: wallsRef.current.features.filter((f) => f.id !== tempId) });
      selectedIdRef.current = null;
      setSelectedId(null);
      map.setFilter('walls-selected', ['==', ['get', 'id'], '__none__']);
      updateNodeSource();
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }, [builder, camp, setWallsData, setBusy, updateDrawPreview, updateNodeSource]);
  finishDrawRef.current = finishDraw;

  const updateWallProp = useCallback(async (id, patch) => {
    const fc = {
      type: 'FeatureCollection',
      features: wallsRef.current.features.map((f) =>
        f.id === id ? { ...f, properties: { ...f.properties, ...patch } } : f),
    };
    setWallsData(fc);
    try {
      await fetch('/api/walls', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, ...patch }),
      });
    } catch { /* ignore */ }
  }, [setWallsData]);

  const deleteWall = useCallback(async (id) => {
    const fc = { type: 'FeatureCollection', features: wallsRef.current.features.filter((f) => f.id !== id) };
    setWallsData(fc);
    selectedIdRef.current = null;
    setSelectedId(null);
    mapRef.current?.setFilter('walls-selected', ['==', ['get', 'id'], '__none__']);
    updateNodeSource();
    try {
      setBusy(true);
      await fetch(`/api/walls?id=${encodeURIComponent(id)}`, { method: 'DELETE' });
    } catch { /* ignore */ } finally { setBusy(false); }
  }, [setWallsData, setBusy, updateNodeSource]);

  // ---- UI actions ----
  const enterBuildMode = () => {
    setError('');
    if (builder.trim() && camp.trim()) {
      buildModeRef.current = true;
      setBuildMode(true);
    } else {
      setIdentityOpen(true);
    }
  };

  const confirmIdentity = () => {
    if (!builder.trim() || !camp.trim()) { setError('Please enter both your name and camp.'); return; }
    try {
      localStorage.setItem('wb-builder', builder.trim());
      localStorage.setItem('wb-camp', camp.trim());
    } catch { /* ignore */ }
    setIdentityOpen(false);
    setError('');
    buildModeRef.current = true;
    setBuildMode(true);
  };

  const exitBuildMode = () => {
    if (drawingRef.current) cancelDraw();
    buildModeRef.current = false;
    setBuildMode(false);
    updateNodeSource();
  };

  const startDraw = () => {
    setSelectedId(null); selectedIdRef.current = null;
    mapRef.current?.setFilter('walls-selected', ['==', ['get', 'id'], '__none__']);
    updateNodeSource();
    drawNodesRef.current = [];
    setDrawCount(0);
    drawingRef.current = true;
    setDrawing(true);
    mapRef.current.doubleClickZoom.disable();
    mapRef.current.getCanvas().style.cursor = 'crosshair';
  };

  const cancelDraw = () => {
    drawingRef.current = false;
    setDrawing(false);
    drawNodesRef.current = [];
    setDrawCount(0);
    updateDrawPreview();
    if (mapRef.current) {
      mapRef.current.doubleClickZoom.enable();
      mapRef.current.getCanvas().style.cursor = '';
    }
  };

  const copyCoords = () => {
    if (!selectedWall) return;
    navigator.clipboard.writeText(coordsText(selectedWall)).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };

  const shareWall = (id) => {
    const url = `${window.location.origin}${window.location.pathname}?wall=${encodeURIComponent(id)}`;
    navigator.clipboard.writeText(url).then(() => {
      setShared(true);
      setTimeout(() => setShared(false), 1800);
    });
  };

  // keep node handles in sync when selection/build mode changes
  useEffect(() => { updateNodeSource(); }, [selectedId, buildMode, walls, updateNodeSource]);

  return (
    <div style={{ position: 'relative', width: '100%', height: '100vh' }}>
      <style>{'@keyframes wb-spin{to{transform:rotate(360deg)}}'}</style>
      <div ref={mapContainer} style={{ width: '100%', height: '100%' }} />

      {/* Saving indicator */}
      {saving && (
        <div style={savingPill}>
          <span style={spinnerStyle} />
          Saving…
        </div>
      )}

      {/* Top-left controls */}
      <div style={panelStyle('top-left')}>
        <div style={{ fontWeight: 700, marginBottom: 6 }}>🧱 Wall Builder</div>
        {!buildMode ? (
          <button style={btnPrimary} onClick={enterBuildMode}>Edit</button>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <div style={{ fontSize: 12, color: '#555' }}>
              Building as <b>{builder}</b> ({camp})
              {!drawing && (
                <button style={{ ...btnGhost, padding: '0 0 0 6px', fontSize: 12 }}
                  onClick={() => { setError(''); setIdentityOpen(true); }}>change</button>
              )}
            </div>
            {drawing ? (
              <>
                <div style={{ fontSize: 12 }}>
                  Click to add points, double-click to finish. ({drawCount} point{drawCount === 1 ? '' : 's'})
                </div>
                <button style={btnSecondary} onClick={cancelDraw}>Cancel drawing</button>
              </>
            ) : (
              <button style={btnPrimary} onClick={startDraw}>+ New wall</button>
            )}
            <button style={btnGhost} onClick={exitBuildMode}>Done</button>
          </div>
        )}
        {error && <div style={{ color: '#c00', fontSize: 12, marginTop: 6 }}>{error}</div>}

        <div style={{ borderTop: '1px solid #eee', marginTop: 10, paddingTop: 8 }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, cursor: 'pointer' }}>
            <input type="checkbox" checked={showAllCamps} onChange={toggleShowAll} />
            Show all camps
          </label>
          {showAllCamps && (
            <div style={{ fontSize: 11, color: '#888', marginTop: 4 }}>
              Click a gray camp to pin it (show its name for everyone).
            </div>
          )}
        </div>
      </div>

      {/* Identity dialog */}
      {identityOpen && (
        <div style={overlayStyle}>
          <div style={dialogStyle}>
            <h3 style={{ margin: '0 0 4px' }}>Who are you?</h3>
            <p style={{ margin: '0 0 12px', fontSize: 13, color: '#555' }}>
              Enter your name and camp to start building walls. No account needed.
            </p>
            <label style={labelStyle}>Your name
              <input style={inputStyle} value={builder} onChange={(e) => setBuilder(e.target.value)} autoFocus />
            </label>
            <label style={labelStyle}>Camp
              <input style={inputStyle} value={camp} onChange={(e) => setCamp(e.target.value)} />
            </label>
            {error && <div style={{ color: '#c00', fontSize: 12, marginBottom: 8 }}>{error}</div>}
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button style={btnGhost} onClick={() => { setIdentityOpen(false); setError(''); }}>Cancel</button>
              <button style={btnPrimary} onClick={confirmIdentity}>OK</button>
            </div>
          </div>
        </div>
      )}

      {/* Pinned camp panel */}
      {selectedCamp && !selectedWall && (
        <div style={panelStyle('top-right')}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <b>Pinned camp</b>
            <button style={closeBtn} onClick={() => setSelectedCamp(null)}>×</button>
          </div>
          <div style={{ fontWeight: 600, marginTop: 6 }}>{selectedCamp.name || '(unnamed)'}</div>
          <div style={{ fontSize: 12, color: '#777', margin: '4px 0 10px' }}>
            Visible with its name to everyone.
          </div>
          <button style={{ ...btnSecondary, background: '#fce8e6', color: '#c5221f', borderColor: '#f5b5b0' }}
            onClick={() => unpinCamp(selectedCamp.id)}>Hide this camp</button>
        </div>
      )}

      {/* Selected wall panel */}
      {selectedWall && (
        <div style={panelStyle('top-right')}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <b>Wall details</b>
            <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <button style={{ ...closeBtn, color: '#1a73e8', fontSize: 13, display: 'flex', alignItems: 'center', gap: 4 }}
                title="Copy a link to this wall" onClick={() => shareWall(selectedWall.id)}>
                <ShareIcon />{shared ? 'Copied!' : 'Share'}
              </button>
              <button style={closeBtn} onClick={() => {
                setSelectedId(null); selectedIdRef.current = null;
                mapRef.current?.setFilter('walls-selected', ['==', ['get', 'id'], '__none__']);
                updateNodeSource();
              }}>×</button>
            </div>
          </div>

          {buildMode ? (
            <>
              <label style={labelStyle}>Name
                <input style={inputStyle} value={selectedWall.properties.name || ''}
                  onChange={(e) => updateWallProp(selectedWall.id, { name: e.target.value })} />
              </label>
              <label style={labelStyle}>Notes
                <textarea style={{ ...inputStyle, minHeight: 60, resize: 'vertical' }}
                  value={selectedWall.properties.notes || ''}
                  onChange={(e) => updateWallProp(selectedWall.id, { notes: e.target.value })} />
              </label>
            </>
          ) : (
            <>
              <div style={{ fontWeight: 600, marginTop: 6 }}>{selectedWall.properties.name}</div>
              {selectedWall.properties.notes && (
                <div style={{ fontSize: 13, color: '#444', whiteSpace: 'pre-wrap', marginTop: 4 }}>
                  {selectedWall.properties.notes}
                </div>
              )}
            </>
          )}

          <div style={{ fontSize: 12, color: '#777', margin: '8px 0 2px' }}>
            By {selectedWall.properties.builder || '—'} · {selectedWall.properties.camp || '—'}
          </div>

          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 8 }}>
            <b style={{ fontSize: 13 }}>Coordinates</b>
            <button style={btnSecondary} onClick={copyCoords}>{copied ? 'Copied!' : 'Copy'}</button>
          </div>

          {buildMode ? (
            <div style={{ maxHeight: 220, overflow: 'auto', marginTop: 4 }}>
              <div style={{ display: 'grid', gridTemplateColumns: '18px 1fr 1fr 18px', gap: 4, fontSize: 11, color: '#777', fontWeight: 600, padding: '0 0 2px' }}>
                <span>#</span><span>Latitude</span><span>Longitude</span><span />
              </div>
              {(selectedWall.geometry.coordinates || []).map(([lng, lat], i) => (
                <div key={`${selectedWall.id}-${i}-${lat}-${lng}`}
                  style={{ display: 'grid', gridTemplateColumns: '18px 1fr 1fr 18px', gap: 4, alignItems: 'center', marginBottom: 3 }}>
                  <span style={{ fontSize: 11, color: '#999' }}>{i + 1}</span>
                  <input style={coordInput} defaultValue={lat.toFixed(6)}
                    onKeyDown={(e) => { if (e.key === 'Enter') e.target.blur(); }}
                    onBlur={(e) => updateWallPoint(selectedWall.id, i, 'lat', e.target.value)} />
                  <input style={coordInput} defaultValue={lng.toFixed(6)}
                    onKeyDown={(e) => { if (e.key === 'Enter') e.target.blur(); }}
                    onBlur={(e) => updateWallPoint(selectedWall.id, i, 'lng', e.target.value)} />
                  <button title="Delete point" style={pointDelBtn}
                    disabled={(selectedWall.geometry.coordinates || []).length <= 2}
                    onClick={() => deleteWallPoint(selectedWall.id, i)}>×</button>
                </div>
              ))}
              <div style={{ fontSize: 11, color: '#999', marginTop: 2 }}>Tip: Ctrl/⌘-click a node on the map to delete it.</div>
            </div>
          ) : (
            <ol style={{ margin: '4px 0 0', paddingLeft: 20, fontSize: 12, fontFamily: 'monospace', maxHeight: 200, overflow: 'auto' }}>
              {(selectedWall.geometry.coordinates || []).map(([lng, lat], i) => (
                <li key={i}>{lat.toFixed(6)}, {lng.toFixed(6)}</li>
              ))}
            </ol>
          )}

          {buildMode && (
            <button style={{ ...btnSecondary, background: '#fce8e6', color: '#c5221f', borderColor: '#f5b5b0', marginTop: 10 }}
              onClick={() => deleteWall(selectedWall.id)}>Delete wall</button>
          )}
        </div>
      )}
    </div>
  );
}

// ---- inline styles ----
function panelStyle(pos) {
  const base = {
    position: 'absolute', zIndex: 5, background: '#fff', borderRadius: 8,
    padding: 12, boxShadow: '0 2px 12px rgba(0,0,0,0.2)', width: 260, maxWidth: '80vw',
    fontFamily: 'system-ui, sans-serif', fontSize: 14,
  };
  if (pos === 'top-left') return { ...base, top: 12, left: 12, width: 220 };
  return { ...base, top: 12, right: 12 };
}
const overlayStyle = {
  position: 'absolute', inset: 0, zIndex: 10, background: 'rgba(0,0,0,0.35)',
  display: 'flex', alignItems: 'center', justifyContent: 'center',
};
const dialogStyle = {
  background: '#fff', borderRadius: 10, padding: 20, width: 320, maxWidth: '90vw',
  fontFamily: 'system-ui, sans-serif', boxShadow: '0 8px 30px rgba(0,0,0,0.3)',
};
const labelStyle = { display: 'block', fontSize: 12, color: '#555', marginBottom: 8, fontWeight: 600 };
const inputStyle = {
  display: 'block', width: '100%', boxSizing: 'border-box', marginTop: 3, padding: '6px 8px',
  border: '1px solid #ccc', borderRadius: 6, fontSize: 14, fontWeight: 400,
};
const coordInput = {
  width: '100%', boxSizing: 'border-box', padding: '3px 5px', border: '1px solid #ccc',
  borderRadius: 4, fontSize: 12, fontFamily: 'monospace',
};
const pointDelBtn = {
  border: 'none', background: 'transparent', color: '#c5221f', cursor: 'pointer',
  fontSize: 16, lineHeight: 1, padding: 0,
};
const btnBase = { border: '1px solid transparent', borderRadius: 6, padding: '7px 12px', cursor: 'pointer', fontSize: 13, fontWeight: 600 };
const btnPrimary = { ...btnBase, background: '#1a73e8', color: '#fff' };
const btnSecondary = { ...btnBase, background: '#f1f3f4', color: '#202124', border: '1px solid #dadce0' };
const btnGhost = { ...btnBase, background: 'transparent', color: '#1a73e8' };
const closeBtn = { ...btnBase, background: 'transparent', color: '#666', fontSize: 20, padding: '0 6px', lineHeight: 1 };
const savingPill = {
  position: 'absolute', top: 12, left: '50%', transform: 'translateX(-50%)', zIndex: 11,
  background: 'rgba(0,0,0,0.8)', color: '#fff', padding: '6px 14px', borderRadius: 20,
  fontSize: 13, fontFamily: 'system-ui, sans-serif', display: 'flex', alignItems: 'center', gap: 8,
};
const spinnerStyle = {
  width: 14, height: 14, border: '2px solid rgba(255,255,255,0.4)', borderTopColor: '#fff',
  borderRadius: '50%', display: 'inline-block', animation: 'wb-spin 0.7s linear infinite',
};
