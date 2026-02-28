'use client';

import { useRef, useEffect, useState, useCallback } from 'react';
import * as maptilersdk from '@maptiler/sdk';
import '@maptiler/sdk/dist/maptiler-sdk.css';

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

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// Sound class color map
const SOUND_CLASS_COLORS = {
  A: '#cc1b15',
  B: '#cc4515',
  C: '#f1ae29',
  D: '#ffcc01',
  E: '#3cc954',
};

// Sound class number color map (0=quiet/green → 10=loud/deep red)
const SOUND_NUM_COLORS = [
  '#3cc954', // 0
  '#6dbf47', // 1
  '#9eb53a', // 2
  '#cfab2d', // 3
  '#f1ae29', // 4
  '#e89422', // 5
  '#cc4515', // 6
  '#cc1b15', // 7
  '#b5140f', // 8
  '#9e100c', // 9
  '#870d09', // 10
];

function getNumColor(num) {
  const i = Math.max(0, Math.min(10, Math.round(num)));
  return SOUND_NUM_COLORS[i] || '#888';
}

function buildPopupHTML(props) {
  const parts = [];

  // Title
  const title = props.title || '';
  if (title) {
    const pointNum = props['point-num'];
    const prefix = pointNum != null ? `${pointNum}: ` : '';
    parts.push(`<div class="popup-title">${escapeHtml(prefix + title)}</div>`);
  }

  // Sound class row: colored letter badge + colored number badge
  const soundClass = props['sound-class'];
  const soundClassNum = props['sound-class-num'];
  if (soundClass || soundClassNum != null) {
    const color = SOUND_CLASS_COLORS[soundClass] || '#888';
    let row = '<div class="popup-sound-class">';
    row += '<span class="popup-label">Sound class:</span> ';
    if (soundClass) {
      row += `<span class="popup-badge" style="background:${color}">${escapeHtml(soundClass)}</span> `;
    }
    if (soundClassNum != null) {
      const numColor = getNumColor(soundClassNum);
      row += `<span class="popup-badge" style="background:${numColor}">${soundClassNum}</span>`;
    }
    row += '</div>';
    parts.push(row);
  }

  // Sound direction: arrow + comment
  const azimuth = props['sound-direction-azimuth'];
  const dirComment = props['sound-direction-comment'];
  if (azimuth != null || dirComment) {
    let row = '<div class="popup-direction">';
    row += '<span class="popup-label">Direction:</span> ';
    if (azimuth != null) {
      row += `<span class="popup-arrow" style="--az:${azimuth}deg">↑</span> `;
    }
    if (dirComment) {
      row += `<span class="popup-dir-text">${escapeHtml(dirComment)}</span>`;
    }
    row += '</div>';
    parts.push(row);
  }

  // Description
  const description = props.description || '';
  if (description) {
    parts.push(`<div class="popup-description">${escapeHtml(description)}</div>`);
  }

  // Camp history
  const camps = [];
  ['2025', '2024', '2023'].forEach((year) => {
    const val = props[`camp-in-${year}`];
    if (val && val !== '-' && val !== 'none') {
      camps.push(`<div class="popup-camp-row"><span class="popup-camp-year">${year}:</span> ${escapeHtml(val)}</div>`);
    }
  });
  if (camps.length) {
    parts.push(`<div class="popup-camps">${camps.join('')}</div>`);
  }

  // Upgrade actions
  const upgrade = props['upgrade-actions'];
  if (upgrade) {
    parts.push(`<div class="popup-upgrade"><span class="popup-label">Upgrade:</span> ${escapeHtml(upgrade)}</div>`);
  }

  return parts.join('');
}

export default function MapViewer({ layers }) {
  const mapContainer = useRef(null);
  const mapRef = useRef(null);
  const [mapReady, setMapReady] = useState(false);
  const [activeLayer, setActiveLayer] = useState(layers[0]);

  // Initialize map once
  useEffect(() => {
    if (mapRef.current) return;

    maptilersdk.config.apiKey = process.env.NEXT_PUBLIC_MAPTILER_API_KEY;

    const map = new maptilersdk.Map({
      container: mapContainer.current,
      style: maptilersdk.MapStyle.SATELLITE,
      center: CENTER,
      zoom: ZOOM,
    });

    map.on('load', () => {
      mapRef.current = map;
      setMapReady(true);
    });

    // --- Popups ---
    map.on('click', (e) => {
      const features = map.queryRenderedFeatures(e.point, {
        layers: INTERACTIVE_LAYERS.filter((id) => map.getLayer(id)),
      });
      if (!features.length) return;

      const feat = features[0];
      const props = feat.properties || {};
      const html = buildPopupHTML(props);
      if (!html) return;

      const coords =
        feat.geometry.type === 'Point'
          ? feat.geometry.coordinates.slice()
          : [e.lngLat.lng, e.lngLat.lat];

      new maptilersdk.Popup({ offset: 12, maxWidth: '360px' })
        .setLngLat(coords)
        .setHTML(html)
        .addTo(map);
    });

    // Cursor
    INTERACTIVE_LAYERS.forEach((layerId) => {
      map.on('mouseenter', layerId, () => {
        map.getCanvas().style.cursor = 'pointer';
      });
      map.on('mouseleave', layerId, () => {
        map.getCanvas().style.cursor = '';
      });
    });

    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, []);

  // Load GeoJSON when layer changes
  const loadGeoJSON = useCallback(
    async (name) => {
      const map = mapRef.current;
      if (!map) return;

      // Clear old layers
      Object.values(LAYER_IDS).forEach((id) => {
        if (map.getLayer(id)) map.removeLayer(id);
      });
      if (map.getSource(SOURCE_ID)) map.removeSource(SOURCE_ID);

      try {
        // Try .json first, fall back to .geojson
        let res = await fetch(`/data/${name}.json`);
        if (!res.ok) {
          res = await fetch(`/data/${name}.geojson`);
          if (!res.ok) throw new Error(`Could not load ${name} (tried .json and .geojson): ${res.status}`);
        }
        const geojson = await res.json();

        map.addSource(SOURCE_ID, { type: 'geojson', data: geojson });

        // Polygon fill
        map.addLayer({
          id: LAYER_IDS.polygonFill,
          type: 'fill',
          source: SOURCE_ID,
          filter: ['==', '$type', 'Polygon'],
          paint: {
            'fill-color': ['coalesce', ['get', 'fill'], '#3cc954'],
            'fill-opacity': 0.35,
          },
        });

        // Polygon outline
        map.addLayer({
          id: LAYER_IDS.polygonOutline,
          type: 'line',
          source: SOURCE_ID,
          filter: ['==', '$type', 'Polygon'],
          paint: {
            'line-color': ['coalesce', ['get', 'fill'], '#3cc954'],
            'line-width': ['coalesce', ['get', 'stroke-width'], 1],
            'line-opacity': 0.7,
          },
        });

        // Lines
        map.addLayer({
          id: LAYER_IDS.line,
          type: 'line',
          source: SOURCE_ID,
          filter: ['==', '$type', 'LineString'],
          paint: {
            'line-color': ['coalesce', ['get', 'stroke'], '#3cc954'],
            'line-width': ['coalesce', ['get', 'stroke-width'], 2],
            'line-opacity': 0.85,
          },
        });

        // Points (circle background)
        map.addLayer({
          id: LAYER_IDS.point,
          type: 'circle',
          source: SOURCE_ID,
          filter: ['==', '$type', 'Point'],
          paint: {
            'circle-radius': 12,
            'circle-color': ['coalesce', ['get', 'marker-color'], '#cc1b15'],
            'circle-stroke-width': 2,
            'circle-stroke-color': '#ffffff',
          },
        });

        // Point direction arrows (symbol on top of circles)
        map.addLayer({
          id: LAYER_IDS.pointArrow,
          type: 'symbol',
          source: SOURCE_ID,
          filter: ['all',
            ['==', '$type', 'Point'],
            ['has', 'sound-direction-azimuth'],
          ],
          layout: {
            'text-field': '↑',
            'text-size': 16,
            'text-rotate': ['get', 'sound-direction-azimuth'],
            'text-rotation-alignment': 'map',
            'text-allow-overlap': true,
            'text-ignore-placement': true,
            // make text bold
            'text-font': ['Arial Bold'],
          },
          paint: {
            'text-color': '#ffffff',
          },
        });
      } catch (err) {
        console.error(`Failed to load ${name}.json:`, err);
      }
    },
    []
  );

  // Trigger load when map ready or layer changes
  useEffect(() => {
    if (mapReady) loadGeoJSON(activeLayer);
  }, [mapReady, activeLayer, loadGeoJSON]);

  return (
    <div className="map-wrap">
      <div ref={mapContainer} className="map-container" />

      {!mapReady && <div className="map-loading">Loading map…</div>}

      <div className="map-controls">
        <div className="layer-switcher">
          <label htmlFor="layer-select">Layer</label>
          <select
            id="layer-select"
            value={activeLayer}
            onChange={(e) => setActiveLayer(e.target.value)}
          >
            {layers.map((name) => (
              <option key={name} value={name}>
                {name.replace('map', 'Map ')}
              </option>
            ))}
          </select>
        </div>
      </div>
    </div>
  );
}
