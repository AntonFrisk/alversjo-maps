'use client';
import { useState, useEffect } from 'react';

function formatDate(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleDateString('sv-SE', { year: 'numeric', month: 'short', day: 'numeric' });
}

export default function MapInfoCard({ mapName, mapsConfig, viewingRef, onLoadRef, onBackToLatest }) {
  const [commits, setCommits] = useState(null);
  const [showHistory, setShowHistory] = useState(false);
  const [loading, setLoading] = useState(false);

  // Reset when switching maps
  useEffect(() => {
    setCommits(null);
    setShowHistory(false);
  }, [mapName]);

  async function toggleHistory() {
    if (showHistory) { setShowHistory(false); return; }
    if (commits) { setShowHistory(true); return; }
    setLoading(true);
    try {
      const res = await fetch(`/api/github/commits?map=${mapName}`);
      const data = await res.json();
      setCommits(Array.isArray(data) ? data : []);
      setShowHistory(true);
    } catch {
      setCommits([]);
    } finally {
      setLoading(false);
    }
  }

  const config = mapsConfig?.[mapName];
  if (!config) return null;

  const latest = commits?.[0];

  return (
    <div className="map-info-card">
      <div className="map-info-name">{config.name}</div>
      <div className="map-info-desc">{config.description}</div>

      <div className="map-info-footer">
        {viewingRef ? (
          <div className="map-info-historical">
            <span className="map-info-viewing-badge">Historical version</span>
            <button className="map-info-back-btn" onClick={onBackToLatest}>
              ← Back to latest
            </button>
          </div>
        ) : (
          <button className="map-info-version-btn" onClick={toggleHistory} disabled={loading}>
            {loading
              ? 'Loading…'
              : latest
              ? `v ${latest.shortSha} · ${formatDate(latest.date)}`
              : 'Version history'}
          </button>
        )}
      </div>

      {showHistory && commits?.length > 0 && (
        <div className="map-version-list">
          {commits.map((c) => (
            <button
              key={c.sha}
              className={`map-version-item ${c.sha === viewingRef ? 'is-active' : ''}`}
              onClick={() => { onLoadRef(c.sha); setShowHistory(false); }}
            >
              <span className="map-version-sha">{c.shortSha}</span>
              <span className="map-version-msg">{c.message}</span>
              <span className="map-version-date">{formatDate(c.date)}</span>
            </button>
          ))}
        </div>
      )}

      {showHistory && commits?.length === 0 && (
        <div className="map-version-empty">No version history available.</div>
      )}
    </div>
  );
}
