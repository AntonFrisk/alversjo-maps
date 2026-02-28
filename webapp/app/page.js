'use client';

import dynamic from 'next/dynamic';

const MapViewer = dynamic(() => import('@/components/MapViewer'), {
  ssr: false,
  loading: () => <div className="map-loading">Loading map…</div>,
});

const LAYERS = ['map1', 'map2', 'map3'];

export default function Home() {
  return <MapViewer layers={LAYERS} />;
}
