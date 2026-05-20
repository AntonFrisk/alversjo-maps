// Extension for each map file as committed in the repo
// Update this map if files are renamed or re-formatted.
const MAP_EXT = { map1: 'json', map2: 'json', map3: 'json' };

function mapRepoPath(mapName) {
  const ext = MAP_EXT[mapName] ?? 'json';
  return `webapp/public/data/${mapName}.${ext}`;
}

function apiBase() {
  return `https://api.github.com/repos/${process.env.GITHUB_OWNER}/${process.env.GITHUB_REPO}`;
}

function ghHeaders() {
  return {
    Authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  };
}

export async function listCommits(mapName, limit = 20) {
  const path = mapRepoPath(mapName);
  const res = await fetch(
    `${apiBase()}/commits?path=${encodeURIComponent(path)}&per_page=${limit}`,
    { headers: ghHeaders(), next: { revalidate: 30 } }
  );
  if (!res.ok) throw new Error(`GitHub commits API error: ${res.status}`);
  const data = await res.json();
  return data.map((c) => ({
    sha: c.sha,
    shortSha: c.sha.slice(0, 7),
    message: c.commit.message.split('\n')[0],
    author: c.commit.author.name,
    date: c.commit.author.date,
  }));
}

export async function getFileAtRef(mapName, ref) {
  const path = mapRepoPath(mapName);
  const res = await fetch(
    `${apiBase()}/contents/${encodeURIComponent(path)}?ref=${encodeURIComponent(ref)}`,
    { headers: ghHeaders(), cache: 'no-store' }
  );
  if (!res.ok) throw new Error(`GitHub contents API error: ${res.status}`);
  const data = await res.json();
  const text = Buffer.from(data.content.replace(/\n/g, ''), 'base64').toString('utf-8');
  return { geojson: JSON.parse(text), blobSha: data.sha };
}

export async function commitFile(mapName, geojson, message, authorName) {
  const { blobSha } = await getFileAtRef(mapName, 'HEAD');
  const path = mapRepoPath(mapName);
  const content = Buffer.from(JSON.stringify(geojson, null, 4)).toString('base64');
  const res = await fetch(`${apiBase()}/contents/${encodeURIComponent(path)}`, {
    method: 'PUT',
    headers: { ...ghHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message,
      content,
      sha: blobSha,
      committer: {
        name: authorName || 'Map Editor',
        email: 'map-editor@alversjo.app',
      },
    }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(`GitHub commit error ${res.status}: ${err.message ?? 'unknown'}`);
  }
  const data = await res.json();
  return { sha: data.commit.sha, shortSha: data.commit.sha.slice(0, 7) };
}
