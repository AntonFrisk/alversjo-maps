// Shared MapLibre base-map constants for Alversjö maps.
// Mirrors the values used in components/MapViewer.js so the Wall Builder
// renders on the exact same satellite basemap, center, and zoom.

export const CENTER = [14.923, 57.620]; // Alversjö
export const ZOOM = 15.5;

export const LOCAL_SATELLITE_STYLE = {
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

// Meters of ground covered by one screen pixel at a given latitude/zoom (MapLibre 512px tiling).
export function metersPerPixel(lat, zoom) {
  return (40075016.686 * Math.cos((lat * Math.PI) / 180)) / Math.pow(2, zoom + 9);
}

// Pixel line-width that renders a fixed real-world width (meters) at a given zoom.
export function pixelsForMeters(meters, lat, zoom) {
  return meters / metersPerPixel(lat, zoom);
}
