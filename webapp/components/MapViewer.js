'use client';

import { useRef, useEffect, useState, useCallback, useMemo } from 'react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { useSession, signIn } from 'next-auth/react';
import { SOUND_NUM_COLORS, SOUND_CLASS_COLORS } from '@/lib/sound-class';
import AuthButton from '@/components/AuthButton';
import MapInfoCard from '@/components/MapInfoCard';
import EditPanel from '@/components/EditPanel';

const SOURCE_ID = 'geojson-data';
const LAYER_IDS = {
  polygonFill: 'layer-polygon-fill',
  polygonOutline: 'layer-polygon-outline',
  line: 'layer-line',
  point: 'layer-point',
  pointArrow: 'layer-point-arrow',
};
const INTERACTIVE_LAYERS = [LAYER_IDS.pointArrow, LAYER_IDS.point, LAYER_IDS.polygonFill, LAYER_IDS.line];

const CENTER = [14.923, 57.620]; // Alversjö
const ZOOM = 15.5;

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
  layers: [{ id: 'satellite-layer', type: 'raster', source: 'satellite' }],
};

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function getNumColor(num) {
  return SOUND_NUM_COLORS[Math.max(0, Math.min(10, Math.round(num)))] || '#888';
}

function buildPopupHTML(props) {
  const parts = [];

  const title = props.title || '';
  if (title) {
    const pointNum = props['point-num'];
    const prefix = pointNum != null ? `${pointNum}: ` : '';
    parts.push(`<div class="popup-title">${escapeHtml(prefix + title)}</div>`);
  }

  const soundClass = props['sound-class'];
  const soundClassNum = props['sound-class-num'];
  if (soundClass || soundClassNum != null) {
    const color = SOUND_CLASS_COLORS[soundClass] || '#888';
    let row = '<div class="popup-sound-class">';
    row += '<span class="popup-label">Sound class:</span> ';
    if (soundClass) row += `<span class="popup-badge" style="background:${color}">${escapeHtml(soundClass)}</span> `;
    if (soundClassNum != null) {
      row += `<span class="popup-badge" style="background:${getNumColor(soundClassNum)}">${soundClassNum}</span>`;
    }
    row += '</div>';
    parts.push(row);
  }

  const azimuthRaw = props['sound-direction-azimuth'];
  const dirComment = props['sound-direction-comment'];
  const hasAzimuth = azimuthRaw !== null && azimuthRaw !== undefined && azimuthRaw !== '';
  const azimuth = hasAzimuth ? Number(azimuthRaw) : null;
  if (hasAzimuth || dirComment) {
    let row = '<div class="popup-direction">';
    row += '<span class="popup-label">Direction:</span> ';
    if (hasAzimuth) {
      row += `<span class="popup-arrow" style="--az:${azimuth}deg">↑</span> `;
      row += `<span class="popup-dir-text popup-dir-deg">${azimuth}°</span> `;
    }
    if (dirComment) row += `<span class="popup-dir-text">${escapeHtml(dirComment)}</span>`;
    row += '</div>';
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

export default function MapViewer({ layers }) {
  const mapContainer = useRef(null);
  const mapRef = useRef(null);
  const originalGeoJSONRef = useRef(null);
  const editedGeoJSONRef = useRef(null);

  const [mapReady, setMapReady] = useState(false);
  const [activeLayer, setActiveLayer] = useState(layers[0]);
  const [mapsConfig, setMapsConfig] = useState(null);

  // Edit mode state
  const [editMode, setEditMode] = useState(false);
  const [editedGeoJSON, setEditedGeoJSON] = useState(null);
  const [selectedFeatureId, setSelectedFeatureId] = useState(null);
  const [dirtyFeatureIds, setDirtyFeatureIds] = useState(new Set());
  const [viewingRef, setViewingRef] = useState(null);

  // Commit bar state
  const [showCommitInput, setShowCommitInput] = useState(false);
  const [commitMsg, setCommitMsg] = useState('');
  const [commitLoading, setCommitLoading] = useState(false);

  // Auth panel state
  const [showAuthPanel, setShowAuthPanel] = useState(false);

  // Hamburger menu state
  const [menuOpen, setMenuOpen] = useState(false);

  // Pattern (B&W) mode — null = off, 'dots' | 'grid' | 'stripes'
  const [patternType, setPatternType] = useState(null);
  const patternTypeRef = useRef(null);

  // Feature type visibility
  const [showPolygons, setShowPolygons] = useState(true);
  const [showPoints, setShowPoints] = useState(true);
  const showPolygonsRef = useRef(true);
  const showPointsRef = useRef(true);

  const { data: session } = useSession();
  const dirty = dirtyFeatureIds.size > 0;

  const selectedFeature = useMemo(() => {
    if (!selectedFeatureId || !editedGeoJSON) return null;
    return editedGeoJSON.features.find((f) => f.id === selectedFeatureId) ?? null;
  }, [selectedFeatureId, editedGeoJSON]);

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

      mapRef.current = map;
      setMapReady(true);
    });

    map.on('click', (e) => {
      const features = map.queryRenderedFeatures(e.point, {
        layers: INTERACTIVE_LAYERS.filter((id) => map.getLayer(id)),
      });
      if (!features.length) return;

      const feat = features[0];

      // In edit mode: open EditPanel for the clicked feature (no popup)
      // Use ref here — editMode is captured at mount time (stale closure), editModeRef.current is always fresh
      if (editModeRef.current) {
        // feat.id is the numeric array index assigned by generateId:true on the source.
        // Use it to look up the feature's real UUID from our in-memory GeoJSON.
        const base = editedGeoJSONRef.current || originalGeoJSONRef.current;
        const match = base?.features[feat.id];
        if (match) setSelectedFeatureId(match.id ?? feat.id);
        return;
      }

      // In view mode: show popup
      const props = feat.properties || {};
      const html = buildPopupHTML(props);
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

    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // editMode changes after map init — update click handler via closure-captured ref
  const editModeRef = useRef(false);
  useEffect(() => { editModeRef.current = editMode; }, [editMode]);

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
  }, [showPolygons, showPoints, mapReady]);

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

    Object.values(LAYER_IDS).forEach((id) => { if (map.getLayer(id)) map.removeLayer(id); });
    if (map.getSource(SOURCE_ID)) map.removeSource(SOURCE_ID);

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

      map.addLayer({
        id: LAYER_IDS.polygonFill, type: 'fill', source: SOURCE_ID,
        filter: ['==', '$type', 'Polygon'],
        paint: { 'fill-color': ['coalesce', ['get', 'fill'], '#3cc954'], 'fill-opacity': 0.35 },
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
          'circle-radius': 14,
          'circle-color': ['coalesce', ['get', 'marker-color'], '#cc1b15'],
          'circle-stroke-width': 2,
          'circle-stroke-color': '#ffffff',
        },
      });
      map.addLayer({
        id: LAYER_IDS.pointArrow, type: 'symbol', source: SOURCE_ID,
        filter: ['has', 'sound-direction-azimuth'],
        layout: {
          'text-field': '^',
          'text-size': 14,
          'text-rotate': ['get', 'sound-direction-azimuth'],
          'text-rotation-alignment': 'map',
          'text-allow-overlap': true,
          'text-ignore-placement': true,
          'text-font': ['Open Sans bold'],
        },
        paint: { 'text-color': '#ffffff' },
      });
      // Re-apply visibility (layers were just recreated)
      if (!showPolygonsRef.current) {
        map.setLayoutProperty(LAYER_IDS.polygonFill, 'visibility', 'none');
        map.setLayoutProperty(LAYER_IDS.polygonOutline, 'visibility', 'none');
      }
      if (!showPointsRef.current) {
        map.setLayoutProperty(LAYER_IDS.point, 'visibility', 'none');
        map.setLayoutProperty(LAYER_IDS.pointArrow, 'visibility', 'none');
      }
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
      return;
    }
    const clone = JSON.parse(JSON.stringify(originalGeoJSONRef.current));
    editedGeoJSONRef.current = clone;
    setEditedGeoJSON(clone);
    setEditMode(true);
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
    mapRef.current?.getSource(SOURCE_ID)?.setData(updated);
    setDirtyFeatureIds((prev) => new Set([...prev, featureId]));
  }

  function handleDiscard() {
    if (!window.confirm('Discard all unsaved changes?')) return;
    const original = originalGeoJSONRef.current;
    editedGeoJSONRef.current = null;
    setEditedGeoJSON(null);
    setDirtyFeatureIds(new Set());
    setSelectedFeatureId(null);
    setShowCommitInput(false);
    mapRef.current?.getSource(SOURCE_ID)?.setData(original);
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
              <option key={name} value={name}>{name.replace('map', 'Map ')}</option>
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
          </div>

          <div className="menu-pattern-row">
            <span className="menu-visibility-label">B&W</span>
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

          <div className="menu-auth-row">
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
          {mapsConfig && (
            <MapInfoCard
              mapName={activeLayer}
              mapsConfig={mapsConfig}
              viewingRef={viewingRef}
              onLoadRef={(ref) => { setViewingRef(ref); setMenuOpen(false); }}
              onBackToLatest={() => { setViewingRef(null); }}
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
        />
      )}

      {/* Edit mode hint (when in edit mode but no feature selected) */}
      {editMode && !selectedFeature && (
        <div className="edit-hint">Click a zone or point to edit it</div>
      )}

      {/* Commit / discard bar */}
      {dirty && (
        <div className="commit-bar">
          <span className="commit-count">
            {dirtyFeatureIds.size} feature{dirtyFeatureIds.size !== 1 ? 's' : ''} edited
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
    </div>
  );
}
