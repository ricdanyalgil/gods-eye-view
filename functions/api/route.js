const ROUTE_MAX_LEG_KM = 1200;
const ROUTE_MAX_TOTAL_KM = 2400;
const ROUTE_MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const CACHE_TTL_MS = 10 * 60 * 1000;
const routeCache = new Map();

function json(payload, status = 200, headers = {}) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      ...headers,
    },
  });
}

function failure(error, status = 200, headers = {}) {
  return json({ ok: false, error }, status, headers);
}

function haversineKm([lon1, lat1], [lon2, lat2]) {
  const radians = value => (value * Math.PI) / 180;
  const dLat = radians(lat2 - lat1);
  const dLon = radians(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(radians(lat1)) * Math.cos(radians(lat2)) * Math.sin(dLon / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.min(1, Math.sqrt(a)));
}

function normalizeProfile(value) {
  const raw = String(value || 'foot').toLowerCase();
  if (raw === 'car' || raw === 'driving') return 'car';
  if (raw === 'bike' || raw === 'cycling' || raw === 'bicycle') return 'bike';
  if (raw === 'foot' || raw === 'walking' || raw === 'walk') return 'foot';
  return null;
}

function parseCoordinates(value) {
  const pairs = String(value || '').split(';').map(item => item.trim()).filter(Boolean);
  if (pairs.length < 2 || pairs.length > 12) return { error: 'need 2-12 coordinates' };
  const points = [];
  for (const pair of pairs) {
    const parts = pair.split(',');
    if (parts.length !== 2) return { error: 'invalid coordinate' };
    const lon = Number(parts[0]);
    const lat = Number(parts[1]);
    if (!Number.isFinite(lon) || !Number.isFinite(lat) || Math.abs(lat) > 90 || Math.abs(lon) > 180) {
      return { error: 'invalid coordinate' };
    }
    points.push([lon, lat]);
  }

  let totalKm = 0;
  for (let index = 1; index < points.length; index += 1) {
    const legKm = haversineKm(points[index - 1], points[index]);
    if (legKm > ROUTE_MAX_LEG_KM) return { error: 'route leg too long' };
    totalKm += legKm;
  }
  if (totalKm > ROUTE_MAX_TOTAL_KM) return { error: 'route too long' };
  return { points, encoded: points.map(([lon, lat]) => `${lon},${lat}`).join(';') };
}

async function readCapped(response) {
  const declared = Number(response.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > ROUTE_MAX_RESPONSE_BYTES) throw new Error('route response too large');
  const text = await response.text();
  if (new TextEncoder().encode(text).byteLength > ROUTE_MAX_RESPONSE_BYTES) throw new Error('route response too large');
  return text;
}

async function routeRequest({ request }) {
  const url = new URL(request.url);
  const profile = normalizeProfile(url.searchParams.get('profile'));
  if (!profile) return failure('invalid profile');
  const parsed = parseCoordinates(url.searchParams.get('coords'));
  if (parsed.error) return failure(parsed.error);

  const cacheKey = `${profile}|${parsed.encoded}`;
  const cached = routeCache.get(cacheKey);
  if (cached && Date.now() - cached.cachedAt < CACHE_TTL_MS) {
    return json(cached.payload, 200, { 'X-GEV-Route-Cache': 'HIT' });
  }

  const osrmProfile = profile === 'car' ? 'driving' : profile;
  const upstreamUrl = `https://routing.openstreetmap.de/routed-${profile}/route/v1/${osrmProfile}/${parsed.encoded}?overview=full&geometries=geojson&alternatives=false&steps=false`;

  try {
    const upstream = await fetch(upstreamUrl, {
      headers: { 'User-Agent': 'The-O-Eye/1.0 (route intelligence demo)' },
      signal: AbortSignal.timeout(12000),
    });
    if (!upstream.ok || !(upstream.headers.get('content-type') || '').includes('json')) {
      return failure('no route found');
    }
    const data = JSON.parse(await readCapped(upstream));
    const route = data?.routes?.[0];
    if (data?.code !== 'Ok' || !Array.isArray(route?.geometry?.coordinates) || route.geometry.coordinates.length < 2) {
      return failure('no route found');
    }
    const payload = {
      ok: true,
      profile,
      distanceM: Math.round(route.distance),
      durationS: Math.round(route.duration),
      geometry: route.geometry.coordinates,
    };
    routeCache.set(cacheKey, { payload, cachedAt: Date.now() });
    if (routeCache.size > 200) routeCache.delete(routeCache.keys().next().value);
    return json(payload, 200, { 'X-GEV-Route-Cache': 'MISS' });
  } catch {
    return failure('route proxy error');
  }
}

export function onRequest(context) {
  if (context.request.method !== 'GET') {
    return failure('Method not allowed', 405, { Allow: 'GET' });
  }
  return routeRequest(context);
}
