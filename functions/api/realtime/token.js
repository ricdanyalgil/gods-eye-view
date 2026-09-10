const REALTIME_MODELS = Object.freeze({
  standard: 'gpt-realtime-2',
  mini: 'gpt-realtime-2.1-mini',
});

const BASE_INSTRUCTIONS = [
  'You are The O Eye Voice, a concise multilingual geospatial intelligence controller.',
  'Always reply in the language the user is speaking.',
  'Use the provided function tools to control or read the map; never invent a tool, result, route, incident, protest, camera, or live-data claim.',
  'A system item with type the_o_mission_context is the authoritative context for the active The O investigation. Resolve references such as the airport, hotel, venue, destination and route from its stops and roles.',
  'When asked about a route, sensitive point, exposed place, collected geolocated signal, alternate corridor or Plan A/B/C, call annotate_map in the same turn so the answer appears spatially.',
  'For a route segment, call annotate_map with type route and only the requested ordered stops. Use exact mission coordinates when supplied. Call fly_route only after a route exists.',
  'For route risks, cameras, protests, incidents, accidents, travel time, airports, driving or helicopter alternatives, use mission-context intelligence and map-tool results. Clearly distinguish confirmed evidence, uncorroborated public/social signals and unavailable live data.',
  'Preserve the current route unless the user explicitly asks to replace or clear it. Plans A, B and C must have distinct labels; activate an alternative only when asked or when a corroborated trigger applies.',
  'Use red only for high or critical evidence, amber for medium or uncorroborated signals, green for confirmed safe points and cyan for infrastructure.',
  'For questions about what is visible or selected, call get_entity_context before answering. For navigation, call fly_to_location. Keep spoken confirmations short and state only successful results.',
].join('\n');

const EMPTY_PARAMETERS = Object.freeze({
  type: 'object',
  additionalProperties: false,
  properties: {},
});

const TOOLS = [
  {
    type: 'function',
    name: 'annotate_map',
    description: 'Place pins, areas, arrows, labels, or a real route on the map. Use routes for ordered mission stops and risk annotations for spatial intelligence.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        annotations: {
          type: 'array',
          minItems: 1,
          maxItems: 24,
          items: {
            type: 'object',
            additionalProperties: false,
            properties: {
              type: { type: 'string', enum: ['pin', 'highlight', 'area', 'arrow', 'route', 'label'] },
              target: { type: 'string', maxLength: 200 },
              points: {
                type: 'array',
                minItems: 2,
                maxItems: 12,
                items: {
                  type: 'object',
                  additionalProperties: false,
                  properties: {
                    target: { type: 'string', maxLength: 200 },
                    latitude: { type: 'number', minimum: -90, maximum: 90 },
                    longitude: { type: 'number', minimum: -180, maximum: 180 },
                  },
                },
              },
              mode: { type: 'string', enum: ['walking', 'driving', 'cycling'] },
              latitude: { type: 'number', minimum: -90, maximum: 90 },
              longitude: { type: 'number', minimum: -180, maximum: 180 },
              toTarget: { type: 'string', maxLength: 200 },
              toLatitude: { type: 'number', minimum: -90, maximum: 90 },
              toLongitude: { type: 'number', minimum: -180, maximum: 180 },
              label: { type: 'string', maxLength: 120 },
              color: { type: 'string', enum: ['primary', 'amber', 'cyan', 'green', 'red'] },
              footprint: { type: 'boolean' },
              intent: { type: 'string', enum: ['the_thing', 'around_the_thing'] },
              entityKind: { type: 'string', enum: ['building', 'compound', 'district', 'street', 'point_feature'] },
            },
            required: ['type'],
          },
        },
        flyTo: { type: 'boolean' },
        persist: { type: 'boolean' },
      },
      required: ['annotations'],
    },
  },
  {
    type: 'function',
    name: 'fly_route',
    description: 'Fly the camera along an existing route annotation. Omit label to use the newest route.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        label: { type: 'string' },
        speed: { type: 'string', enum: ['slow', 'normal', 'fast'] },
      },
    },
  },
  {
    type: 'function',
    name: 'fly_to_location',
    description: 'Fly the camera to a named place or explicit WGS84 coordinate.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        locationId: { type: 'string', enum: ['austin', 'sf', 'nyc', 'tokyo', 'london', 'paris', 'dubai', 'dc'] },
        query: { type: 'string', maxLength: 200 },
        latitude: { type: 'number', minimum: -90, maximum: 90 },
        longitude: { type: 'number', minimum: -180, maximum: 180 },
        viewMode: { type: 'string', enum: ['close', 'overview'] },
        rangeM: { type: 'number', minimum: 100, maximum: 20000000 },
        waitForArrival: { type: 'boolean' },
      },
    },
  },
  {
    type: 'function',
    name: 'get_entity_context',
    description: 'Read the current basemap, selected entity and visible entity context.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        scope: { type: 'string', enum: ['auto', 'selected', 'in_view'] },
        layerId: { type: 'string' },
        limit: { type: 'number', minimum: 1, maximum: 12 },
      },
    },
  },
  {
    type: 'function',
    name: 'get_current_view_state',
    description: 'Read current camera, map stack, layers, HUD, detection and tracking state.',
    parameters: EMPTY_PARAMETERS,
  },
  {
    type: 'function',
    name: 'set_layer_visibility',
    description: 'Enable or disable a registered map data layer.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        layerId: { type: 'string', enum: ['flights', 'military', 'earthquakes', 'satellites', 'rocket-launches', 'traffic', 'cctv', 'radio', 'bikeshare', 'ais-live-vessels', 'local-datacenters', 'local-dams', 'telegeography-submarine-cables', 'local-firms'] },
        enabled: { type: 'boolean' },
      },
      required: ['layerId', 'enabled'],
    },
  },
  {
    type: 'function',
    name: 'control_cctv',
    description: 'Enable CCTV, select or focus a camera, and show coverage or viewshed when public camera data is available.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        action: { type: 'string', enum: ['enable', 'disable', 'select', 'next', 'prev', 'nearest', 'focus', 'coverage', 'viewshed', 'adjust', 'projection', 'autohop'] },
        cameraQuery: { type: 'string' },
        enabled: { type: 'boolean' },
      },
      required: ['action'],
    },
  },
  {
    type: 'function',
    name: 'set_map_stack',
    description: 'Switch the basemap stack.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: { stack: { type: 'string', enum: ['photoreal', 'bing-aerial', 'bing-labels', 'esri-imagery', 'osm'] } },
      required: ['stack'],
    },
  },
  {
    type: 'function',
    name: 'clear_annotations',
    description: 'Clear all annotations only when the user explicitly asks.',
    parameters: EMPTY_PARAMETERS,
  },
  {
    type: 'function',
    name: 'move_camera',
    description: 'Orbit, pan, tilt, rotate or stop camera motion.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        motion: { type: 'string', enum: ['orbit', 'pan', 'tilt', 'rotate', 'stop'] },
        direction: { type: 'string', enum: ['left', 'right', 'up', 'down'] },
        speed: { type: 'string', enum: ['slow', 'normal', 'fast'] },
        mode: { type: 'string', enum: ['once', 'continuous'] },
      },
      required: ['motion'],
    },
  },
];

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

export async function onRequest({ request, env }) {
  if (request.method !== 'GET' && request.method !== 'POST') {
    return json({ error: 'Method not allowed' }, 405, { Allow: 'GET, POST' });
  }

  if (!env.OPENAI_API_KEY) {
    return json({ error: 'OPENAI_API_KEY is not configured' }, 503);
  }

  const requestedTier = new URL(request.url).searchParams.get('tier')?.trim().toLowerCase();
  const tier = Object.hasOwn(REALTIME_MODELS, requestedTier) ? requestedTier : 'standard';
  const model = tier === 'mini'
    ? env.OPENAI_REALTIME_MODEL_MINI || REALTIME_MODELS.mini
    : env.OPENAI_REALTIME_MODEL || REALTIME_MODELS.standard;

  const sessionConfig = {
    session: {
      type: 'realtime',
      model,
      reasoning: { effort: env.OPENAI_REALTIME_REASONING_EFFORT || 'low' },
      audio: {
        input: {
          noise_reduction: { type: 'near_field' },
          turn_detection: {
            type: 'semantic_vad',
            eagerness: 'low',
            create_response: true,
            interrupt_response: false,
          },
        },
        output: { voice: env.OPENAI_REALTIME_VOICE || 'marin' },
      },
      instructions: BASE_INSTRUCTIONS,
      tools: TOOLS,
      tool_choice: 'auto',
    },
  };

  try {
    const upstream = await fetch('https://api.openai.com/v1/realtime/client_secrets', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
        'OpenAI-Safety-Identifier': 'the-o-eye-cloud-demo',
      },
      body: JSON.stringify(sessionConfig),
    });
    const body = await upstream.text();
    return new Response(body, {
      status: upstream.status,
      headers: {
        'Content-Type': upstream.headers.get('content-type') || 'application/json; charset=utf-8',
        'Cache-Control': 'no-store',
        'X-GEV-Voice-Tier': tier,
        'X-GEV-Voice-Model': model,
        ...(requestedTier && requestedTier !== tier ? { 'X-GEV-Voice-Tier-Fallback': '1' } : {}),
      },
    });
  } catch (error) {
    return json({ error: error?.message || 'Failed to create Realtime token' }, 502);
  }
}
