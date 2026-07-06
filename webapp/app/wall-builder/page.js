'use client';

import dynamic from 'next/dynamic';

const WallBuilder = dynamic(() => import('@/components/WallBuilder'), {
  ssr: false,
  loading: () => <div className="map-loading">Loading wall builder…</div>,
});

export default function WallBuilderPage() {
  return <WallBuilder />;
}
