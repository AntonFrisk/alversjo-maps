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
};
const INTERACTIVE_LAYERS = [LAYER_IDS.point, LAYER_IDS.polygonFill, LAYER_IDS.line];

const CENTER = [14.923, 57.620]; // Alversjö
const ZOOM = 15.5;

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
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
      const title = props.title || '';
      const description = props.description || '';
      if (!title && !description) return;

      let html = '';
      if (title) html += `<div class="popup-title">${escapeHtml(title)}</div>`;
      if (description) html += `<div class="popup-description">${escapeHtml(description)}</div>`;

      const coords =
        feat.geometry.type === 'Point'
          ? feat.geometry.coordinates.slice()
          : [e.lngLat.lng, e.lngLat.lat];

      new maptilersdk.Popup({ offset: 12, maxWidth: '320px' })
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

        // Points
        map.addLayer({
          id: LAYER_IDS.point,
          type: 'circle',
          source: SOURCE_ID,
          filter: ['==', '$type', 'Point'],
          paint: {
            'circle-radius': 8,
            'circle-color': ['coalesce', ['get', 'marker-color'], '#cc1b15'],
            'circle-stroke-width': 2,
            'circle-stroke-color': '#ffffff',
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
