'use client';

import dynamic from 'next/dynamic';
import { useParams } from 'next/navigation';

const MapViewer = dynamic(() => import('@/components/MapViewer'), {
  ssr: false,
  loading: () => <div className="map-loading">Loading map…</div>,
});

const LAYERS = ['map1', 'map2', 'map3', 'map4', 'map5', 'map6'];

export default function MapPage() {
  const { mapId } = useParams();
  const defaultLayer = LAYERS.includes(mapId) ? mapId : LAYERS[0];
  return <MapViewer layers={LAYERS} defaultLayer={defaultLayer} />;
}
