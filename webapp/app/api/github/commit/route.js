import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { commitFile } from '@/lib/github';

export async function POST(request) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.githubLogin) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }
  if (!session.user.isEditor) {
    return NextResponse.json({ error: 'Not authorized as editor' }, { status: 403 });
  }
  try {
    const { map, geojson, message } = await request.json();
    if (!map || !geojson) return NextResponse.json({ error: 'map and geojson are required' }, { status: 400 });
    const result = await commitFile(
      map,
      geojson,
      message?.trim() || `Edit ${map}`,
      session.user.name || session.user.githubLogin
    );
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
