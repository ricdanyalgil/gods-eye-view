import * as Cesium from 'cesium';
import { StyleManager } from './ui.js';
import { flyToAustin } from './camera.js';
import { DataLayerManager } from './data/manager.js';
import flightsLayer from './data/flights.js';
import militaryFlightsLayer from './data/militaryFlights.js';
import earthquakesLayer from './data/earthquakes.js';
import satellitesLayer from './data/satellites.js';
import rocketLaunchesLayer from './data/rocketLaunches.js';
import trafficLayer from './data/traffic.js';
import cctvLayer from './data/cctv.js';
import radioLayer from './data/radio.js';
import bikeshareLayer from './data/bikeshare.js';
import aisLiveVesselsLayer from './data/aisLiveVessels.js';
import militaryInstallationsLayer from './data/militaryInstallations.js';
import militaryAwarenessLayer from './data/militaryAwareness.js';
import localDataLayers from './data/localLayers.js';
import { LAYER_STATE_REGISTRY } from './data/layerState.js';
import { registerDataCredits } from './data/dataCredits.js';
import { SceneDirector } from './scenes/director.js';
import { initGevVoiceCommands } from './voice/gevRealtime.js';
import { MapStackController } from './mapStackController.js';
import { initAnnotations } from './annotations/index.js';
import { initLogoGaze } from './logoGaze.js';
import { initCockpitCloudEffects } from './cockpitCloudEffects.js';
import {
  installRenderGovernor,
  getRenderGovernorDiagnostics,
  governorRequestRender,
  holdContinuousRender,
  releaseContinuousRender,
} from './renderGovernor.js';
import { installScopeMask, setScopeMaskEnabled } from './scopeMask.js';
import { initFirstRunExperience } from './firstRunExperience.js';
import { initKeySetup } from './keySetup.js';
import { loadPhotorealisticTileset } from './mapStartup.js';

initLogoGaze();

/**
 * Extract a human-readable error message from any thrown value.
 * Handles Error objects, strings, and plain objects with message/error fields.
 * @param {*} error — caught exception value
 * @returns {string} best-effort error description
 */
function describeError(error) {
  if (!error) return 'Unknown initialization error';
  if (error instanceof Error) {
    if (error.message && error.message.trim()) return error.message.trim();
    return error.name || 'Initialization error';
  }
  if (typeof error === 'string' && error.trim()) return error.trim();
  if (typeof error === 'object') {
    const maybeMessage = String(error.message || error.error || '').trim();
    if (maybeMessage) return maybeMessage;
    try {
      const serialized = JSON.stringify(error);
      if (serialized && serialized !== '{}') return serialized;
    } catch {
      // ignore serialization error
    }
  }
  return String(error);
}

/**
 * GOD'S EYE VIEW — Main Entry Point
 * Initializes CesiumJS with Google Photorealistic 3D Tiles,
 * style system, intelligence HUD, location presets, and share links.
 */
async function init() {
  const loadingScreen = document.getElementById('loading-screen');
  const loaderStatus = loadingScreen.querySelector('.loader-status');

  try {
    loaderStatus.textContent = 'Configuring viewer...';

    // A direct Google key provides Google 3D plus GEV place search. Cesium ion
    // can host the same 3D tiles and also powers Bing/world-terrain stacks.
    const cesiumToken = import.meta.env.CESIUM_ION_TOKEN;
    const googleApiKey = import.meta.env.GOOGLE_MAPS_API_KEY;
    if (googleApiKey) window.__GOOGLE_MAPS_API_KEY__ = googleApiKey;

    // Create the Cesium viewer with minimal chrome
    const viewer = new Cesium.Viewer('cesiumContainer', {
      timeline: false,
      animation: false,
      baseLayerPicker: false,
      geocoder: false,
      homeButton: false,
      sceneModePicker: false,
      navigationHelpButton: false,
      fullscreenButton: false,
      vrButton: false,
      selectionIndicator: false,
      infoBox: false,
      baseLayer: false,
      // Visible attribution container — Google Maps / 3D Tiles credits are
      // required by Google's Terms of Service, so they must be shown (styled
      // subtly via #cesium-credits). The credit line stays visible in
      // clean-view AND recording modes too (ToS requires attribution while the
      // content is displayed — those are the exact modes used to record
      // demos), including the "Data attribution" link that opens the per-layer
      // license popover.
      creditContainer: (() => {
        const el = document.createElement('div');
        el.id = 'cesium-credits';
        document.body.appendChild(el);
        return el;
      })(),
      msaaSamples: 4,
      contextOptions: {
        webgl: {
          preserveDrawingBuffer: true,
        },
      },
    });

    // Cap the default render loop at 60 fps. Cesium's loop otherwise runs at
    // the display's refresh rate — 120 Hz on ProMotion panels — doubling GPU
    // and CPU burn for zero visual benefit in a map app whose animation
    // cadences (poll interpolation, trail fades, style crossfades) are all
    // designed against wall-clock time, not frame count. Measured on the
    // 2026-08-05 perf investigation as a strict halving of idle burn on
    // 120 Hz hardware; a no-op on 60 Hz displays. (perf item 2)
    viewer.targetFrameRate = 60;

    // Register per-layer data attribution into the "Data attribution" popover.
    // Required by each source's license (ODbL, CC BY-NC-SA, NASA FIRMS, etc.);
    // strings are verbatim from DATA_SOURCES.md. Static + always-present in the
    // expandable bottom-left credit lightbox (showOnScreen=false), so they never
    // clutter the on-globe line. See docs/pre-ship-audit-2026-07-01.md H11.
    registerDataCredits(viewer);

    // Hide Cesium's default globe — Google Photorealistic 3D Tiles provide their own
    // globe at all LODs (street level → orbital). The default globe's 2D imagery
    // clips through 3D tile buildings at close range.
    viewer.scene.globe.show = false;

    // Keep a sky behind Google 3D Tiles, but soften Cesium's high-intensity
    // default atmosphere. With the globe hidden its bright limb otherwise
    // reads as a hard cyan seam where distant photoreal tiles meet the sky.
    viewer.scene.skyAtmosphere.show = true;
    viewer.scene.skyAtmosphere.atmosphereLightIntensity = 18;
    viewer.scene.skyAtmosphere.saturationShift = -0.12;
    viewer.scene.skyAtmosphere.brightnessShift = -0.08;

    loaderStatus.textContent = googleApiKey || cesiumToken
      ? 'Loading Google 3D Tiles...'
      : 'Loading the keyless globe...';
    const photoreal = await loadPhotorealisticTileset(Cesium, {
      googleApiKey,
      cesiumToken,
    });
    const tileset = photoreal.tileset;
    if (tileset) {
      viewer.scene.primitives.add(tileset);
      // NOTE: Cesium World Terrain intentionally disabled — conflicts with Google 3D Tiles at high zoom.
      // Google Photorealistic 3D Tiles provide their own terrain/elevation.
      viewer.scene.globe.show = false;
      console.info(`[Init] Google 3D Tiles loaded via ${photoreal.route}.`);
    } else {
      if (photoreal.errors.length) {
        const tileError = photoreal.errors.at(-1);
        console.warn('[Init] Google 3D Tiles unavailable, using the keyless globe:', tileError);
        const tileErrorDetail = describeError(tileError);
        loaderStatus.textContent = `Google 3D Tiles unavailable (${tileErrorDetail}). Loading the keyless globe...`;
      }
      viewer.scene.globe.show = true;
    }

    loaderStatus.textContent = 'Initializing systems...';

    const mapStackController = new MapStackController(viewer, {
      googleTileset: tileset,
      cesiumToken,
      initialStack: tileset ? 'photoreal' : 'esri-imagery',
      // Task 5 (height-datum fix): rebroadcast stack changes as a window
      // CustomEvent so data layers (CCTV per-regime ground resolution) can
      // react without coupling MapStackController to layer modules. Fires on
      // 'switching'/'ready'/'error'; listeners derive the surface regime from
      // live scene state, so intermediate emissions are harmless.
      onChange: (state) => {
        window.dispatchEvent(new CustomEvent('gev:map-stack-changed', { detail: state }));
      },
      onError: (message) => console.warn('[MapStack]', message),
    });
    await mapStackController.setStack(tileset ? 'photoreal' : 'esri-imagery', { silent: true });

    // Initialize the style manager (post-processing, HUD, locations, share links)
    const styleManager = new StyleManager(viewer, { mapStackController });
    // The previous multi-canvas weather compositor remains disabled. Cockpit
    // clouds use a separate, capped low-resolution GPU pass that never attaches
    // Cesium fog or post-process stages and is fully stopped in map mode.
    const weatherEffects = null;
    const cockpitCloudEffects = initCockpitCloudEffects(viewer);

    // If no share link state, do default fly-to Austin
    if (!styleManager.hasShareState) {
      loaderStatus.textContent = 'Flying to Austin, TX...';
      flyToAustin(viewer);
    } else {
      loaderStatus.textContent = 'Restoring shared view...';
    }

    // Initialize data layer manager
    const dataManager = new DataLayerManager(viewer, {
      allowQaRegistration: import.meta.env.DEV,
    });
    dataManager.register(flightsLayer);
    dataManager.register(militaryFlightsLayer);
    dataManager.register(earthquakesLayer);
    dataManager.register(satellitesLayer);
    dataManager.register(rocketLaunchesLayer);
    rocketLaunchesLayer.attachDataManager(dataManager);
    dataManager.register(trafficLayer);
    dataManager.register(cctvLayer);
    dataManager.register(radioLayer);
    dataManager.register(bikeshareLayer);
    dataManager.register(aisLiveVesselsLayer);
    dataManager.register(militaryInstallationsLayer);
    dataManager.register(militaryAwarenessLayer);
    militaryAwarenessLayer.attachDataManager(dataManager);
    for (const layer of localDataLayers) {
      dataManager.register(layer);
    }
    // Restoration starts only after the complete production registry is sealed.
    dataManager.finalizeRegistrations(LAYER_STATE_REGISTRY);
    if (import.meta.env.DEV) {
      window.__gevQaRegisterLayer = (targetManager, layerModule) => {
        if (targetManager !== dataManager) throw new Error('QA layer manager mismatch');
        return dataManager.registerForQa(layerModule);
      };
      window.__gevQaUnregisterLayer = (targetManager, layerId) => {
        if (targetManager !== dataManager) throw new Error('QA layer manager mismatch');
        return dataManager.unregisterForQa(layerId);
      };
    }
    dataManager.buildTogglePanel(document.getElementById('data-toggles'));
    styleManager.attachDataManager(dataManager);

    // Initialize deterministic scene playback for social clip capture
    const sceneDirector = new SceneDirector(viewer, styleManager, dataManager);

    // Initialize the voice "whiteboard" annotation engine (world-space renderer)
    const annotations = initAnnotations({ viewer, tileset });

    // Keep startup chrome truthful: a share is not restored until camera,
    // visual/map/panel lanes, and every requested layer have terminated.
    void Promise.all([
      styleManager.initialRestorePromise,
      new Promise((resolve) => setTimeout(resolve, 1000)),
    ]).finally(() => {
      loadingScreen.classList.add('hidden');
      // Reveal only after the loading cover has yielded. transitionend can be
      // absent under reduced motion, so a bounded fallback makes this reliable.
      let firstRunRevealed = false;
      const revealFirstRun = () => {
        if (firstRunRevealed) return;
        firstRunRevealed = true;
        // dataManager is passed explicitly: the globe missions enable bundled
        // keyless layers through it, and reaching for styleManager._dataManager
        // would make a private field part of this feature's contract.
        initFirstRunExperience({ styleManager, dataManager });
      };
      loadingScreen.addEventListener('transitionend', revealFirstRun, { once: true });
      setTimeout(revealFirstRun, 900);
    });

    // Provider Settings (the POWER UP chip + dialog). Fire-and-forget: the
    // module removes its own surface when the dev-server endpoint is absent
    // (prod builds, non-local visitors), so this costs prod exactly nothing.
    void initKeySetup();

    // Expose for debugging
    // Idle render governor: flips the scene into requestRenderMode whenever
    // nothing animates per frame. Installed AFTER every module above has had
    // its chance to register pre-install holds. (perf wave 2)
    installRenderGovernor(viewer);

    // The explicit scope mask replaces the emergent six-pass artifact —
    // see src/scopeMask.js. Installed before the UI so the DISPLAY-rail
    // toggle finds it live.
    installScopeMask(viewer);

    // The follow camera recomputes the tracked target's dead-reckon position
    // every frame — tracking anything is a per-frame animation. (perf wave 2)
    viewer.trackedEntityChanged.addEventListener(() => {
      if (viewer.trackedEntity) holdContinuousRender('tracked-entity');
      else releaseContinuousRender('tracked-entity');
    });

    // Hidden-state suspension (perf wave 2): when the window/tab is hidden,
    // stop the default render loop outright — a hidden canvas repaints for
    // nobody, and browser rAF throttling still lets throttled frames burn
    // GPU. Holder/data state is untouched, so return is seamless: restore
    // the loop, refresh the one DOM surface we gated, render a frame.
    const syncVisibilitySuspension = () => {
      const hidden = document.hidden;
      viewer.useDefaultRenderLoop = !hidden;
      cockpitCloudEffects?.setSuspended?.(hidden);
      if (!hidden) {
        if (dataManager._panelRefreshPendingOnVisible) {
          dataManager._panelRefreshPendingOnVisible = false;
          dataManager._refreshTogglePanel();
        }
        governorRequestRender('visibility-restore');
      }
    };
    document.addEventListener('visibilitychange', syncVisibilitySuspension);
    // Apply the CURRENT state too — bootstrap can complete while the tab is
    // already hidden, and waiting for the next transition would leave the
    // loop burning behind a hidden tab. (perf wave 2 fix)
    syncVisibilitySuspension();

    window.__godsEyeView = {
      viewer,
      styleManager,
      tileset,
      dataManager,
      sceneDirector,
      mapStackController,
      annotations,
      weatherEffects,
      cockpitCloudEffects,
      getRenderGovernorDiagnostics,
      requestRender: governorRequestRender,
    };
    window.__godsEyeView.voiceCommands = initGevVoiceCommands({ viewer, styleManager, dataManager, sceneDirector, annotations });

    const missionControls = document.getElementById('mission-map-controls');
    const missionFocusButton = missionControls?.querySelector('[data-mission-focus]');
    let missionStopEntities = [];
    let missionRouteCoordinates = [];
    const setMissionFocusMode = (enabled) => {
      document.body.classList.toggle('the-o-route-focus', enabled);
      missionFocusButton?.setAttribute('aria-pressed', String(enabled));
      missionFocusButton?.setAttribute('aria-label', enabled ? 'Restore map interface' : 'Minimise map interface');
    };
    const fitMissionRoute = () => {
      const positions = missionRouteCoordinates.map((point) =>
        Cesium.Cartesian3.fromDegrees(point.longitude, point.latitude)
      );
      if (positions.length < 2) return;
      const sphere = Cesium.BoundingSphere.fromPoints(positions);
      viewer.camera.flyToBoundingSphere(sphere, {
        duration: 0.85,
        offset: new Cesium.HeadingPitchRange(0, -0.82, Math.max(7000, sphere.radius * 4.2)),
      });
    };
    missionControls?.querySelectorAll('[data-mission-zoom]').forEach((button) => {
      button.addEventListener('click', () => {
        const height = Math.max(200, Number(viewer.camera.positionCartographic?.height) || 2000);
        const amount = Math.max(120, height * 0.38);
        if (button.dataset.missionZoom === 'in') viewer.camera.moveForward(amount);
        else viewer.camera.moveBackward(amount);
        governorRequestRender('mission-route-zoom');
      });
    });
    missionControls?.querySelector('[data-mission-fit]')?.addEventListener('click', fitMissionRoute);
    missionFocusButton?.addEventListener('click', () => setMissionFocusMode(!document.body.classList.contains('the-o-route-focus')));

    // Annotation callouts are screen-space artwork. Back them with generously
    // sized, nearly transparent Cesium points so clicking a visible mission
    // stop focuses the camera on that exact arrival, hotel or destination.
    const missionPickHandler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);
    missionPickHandler.setInputAction((click) => {
      const picked = viewer.scene.pick(click.position);
      const point = picked?.id?.theOMissionStop;
      if (!point) return;
      viewer.camera.flyTo({
        destination: Cesium.Cartesian3.fromDegrees(point.longitude, point.latitude, 2200),
        orientation: { heading: 0, pitch: Cesium.Math.toRadians(-48), roll: 0 },
        duration: 0.8,
      });
    }, Cesium.ScreenSpaceEventType.LEFT_CLICK);

    // The trusted parent console (The O) can operate the embedded camera
    // without reaching through the cross-origin iframe boundary. Framing is
    // already restricted by GEV_FRAME_ANCESTORS; source validation below makes
    // sure only the actual parent window can issue a camera command.
    window.addEventListener('message', (event) => {
      if (event.source !== window.parent) return;
      if (event.data?.type === 'the-o-eye:annotate-route') {
        const focusLocked = event.data?.focusMode === 'locked';
        const points = (Array.isArray(event.data?.points) ? event.data.points : [])
          .map((point) => {
            const target = String(typeof point === 'object' ? point?.target : point || '').trim().slice(0, 200);
            if (!target) return null;
            return {
              target,
              label: String(typeof point === 'object' ? point?.label || target : target).trim().slice(0, 120),
              kind: String(typeof point === 'object' ? point?.kind || 'stop' : 'stop').trim().slice(0, 24),
              latitude: Number.isFinite(Number(typeof point === 'object' ? point?.latitude : null)) ? Number(point.latitude) : undefined,
              longitude: Number.isFinite(Number(typeof point === 'object' ? point?.longitude : null)) ? Number(point.longitude) : undefined,
            };
          })
          .filter(Boolean)
          .slice(0, 6)
          ;
        if (points.length < 2) return;
        window.__gevVoiceCommands?.setMissionContext?.({
          label: event.data?.label,
          points,
          mode: event.data?.mode,
        }, {
          broadcast: event.data?._missionContextRestore !== true,
          notifyHandler: false,
        });
        const drawMissionRoute = async () => {
          let cctvEnabled = false;
          let trafficEnabled = false;
          const routeText = points.map(({ target }) => target.toLowerCase()).join(' ');
          const publicCameraCoverage = [
            'austin', 'london', 'los angeles', 'san diego', 'san francisco',
            'sacramento', 'oakland', 'chula vista', 'california',
          ].some((location) => routeText.includes(location));
          if (event.data?.enableCameras === true && publicCameraCoverage) {
            dataManager.setLayerParams('cctv', {
              coverageMode: 'on',
              autoHop: false,
              showProjection: true,
            }, { origin: 'programmatic' });
            cctvEnabled = await dataManager.setEnabled('cctv', true, { origin: 'programmatic' });
          } else if (event.data?.enableCameras === true) {
            await dataManager.setEnabled('cctv', false, { origin: 'programmatic' });
          }
          if (event.data?.enableTraffic === true) {
            try {
              const trafficStatus = await fetch('/api/tomtom/status').then((response) => response.ok ? response.json() : null);
              if (trafficStatus?.hasKey) {
                trafficEnabled = await dataManager.setEnabled('traffic', true, { origin: 'programmatic' });
              } else {
                await dataManager.setEnabled('traffic', false, { origin: 'programmatic' });
              }
            } catch {
              await dataManager.setEnabled('traffic', false, { origin: 'programmatic' });
            }
          }
          const result = await annotations.annotate([{
            type: 'route',
            label: String(event.data?.label || 'ILLUSTRATIVE PUBLIC ROUTE').slice(0, 120),
            points: points.map(({ target, latitude, longitude }) => ({ target, latitude, longitude })),
            mode: ['walking', 'cycling', 'driving'].includes(event.data?.mode) ? event.data.mode : 'driving',
            color: 'warning',
          }, ...points.map((point, index) => ({
            type: 'pin',
            target: point.target,
            latitude: point.latitude,
            longitude: point.longitude,
            label: point.label,
            color: point.kind === 'risk' ? 'red' : index === 0 ? 'cyan' : index === points.length - 1 ? 'amber' : 'warning',
          }))], { clearPrevious: true, persist: true, flyTo: true });
          missionStopEntities.forEach((entity) => viewer.entities.remove(entity));
          missionStopEntities = points
            .map((point, index) => {
              const resolved = result?.results?.[index + 1];
              const latitude = Number.isFinite(point.latitude) ? point.latitude : Number(resolved?.latitude);
              const longitude = Number.isFinite(point.longitude) ? point.longitude : Number(resolved?.longitude);
              if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
              const exactPoint = { ...point, latitude, longitude };
              const entity = viewer.entities.add({
                position: Cesium.Cartesian3.fromDegrees(longitude, latitude),
                point: {
                  pixelSize: 46,
                  color: Cesium.Color.WHITE.withAlpha(0.01),
                  outlineColor: Cesium.Color.WHITE.withAlpha(0.01),
                  outlineWidth: 1,
                  disableDepthTestDistance: Number.POSITIVE_INFINITY,
                },
              });
              entity.theOMissionStop = exactPoint;
              return entity;
            })
            .filter(Boolean);
          missionRouteCoordinates = missionStopEntities.map((entity) => entity.theOMissionStop);
          if (missionControls) missionControls.hidden = false;
          if (missionFocusButton) missionFocusButton.hidden = focusLocked;
          if (focusLocked) setScopeMaskEnabled(false);
          if (focusLocked || window.self !== window.top) setMissionFocusMode(true);
          window.setTimeout(fitMissionRoute, 120);
          const routeResult = result?.results?.[0];
          event.source?.postMessage?.({
            type: 'the-o-eye:route-state',
            result: { ...result, ok: routeResult?.ok === true },
            cctvEnabled,
            trafficEnabled,
          }, event.origin);
        };
        drawMissionRoute().catch(() => {
          event.source?.postMessage?.({
            type: 'the-o-eye:route-state',
            result: { ok: false },
            cctvEnabled: false,
          }, event.origin);
        });
        return;
      }
      if (event.data?.type === 'the-o-eye:speak-briefing') {
        const briefing = String(event.data?.text || '').trim().slice(0, 7000);
        const controller = window.__gevVoiceCommands;
        if (!briefing || !controller) return;
        const speak = async () => {
          if (!controller.isActive?.()) await controller.start({ pushToTalk: false });
          controller.sendTextCommand(`Read the following operational briefing aloud in English. Preserve the meaning, do not call tools, do not add facts, and do not execute map actions. Briefing:\n${briefing}`);
          event.source?.postMessage?.({ type: 'the-o-eye:voice-state', ok: true }, event.origin);
        };
        speak().catch((error) => {
          event.source?.postMessage?.({ type: 'the-o-eye:voice-state', ok: false, error: String(error?.message || error) }, event.origin);
        });
        return;
      }
      if (event.data?.type !== 'the-o-eye:camera-zoom') return;
      const cartographic = viewer.camera.positionCartographic;
      if (!cartographic) return;

      const currentAltitude = Math.max(1, Number(cartographic.height) || 1);
      const action = String(event.data?.action || '');
      const requestedAltitude = Number(event.data?.altitude);
      const targetAltitude = Math.max(100, Math.min(22_000_000,
        action === 'reset' && Number.isFinite(requestedAltitude)
          ? requestedAltitude
          : action === 'in'
            ? currentAltitude / 1.8
            : action === 'out'
              ? currentAltitude * 1.8
              : currentAltitude
      ));

      viewer.camera.cancelFlight();
      const distance = Math.abs(currentAltitude - targetAltitude);
      if (targetAltitude < currentAltitude) viewer.camera.zoomIn(distance);
      else if (targetAltitude > currentAltitude) viewer.camera.zoomOut(distance);
      governorRequestRender('parent-camera-zoom');
      window.setTimeout(() => {
        event.source?.postMessage?.({
          type: 'the-o-eye:camera-state',
          altitude: Math.round(viewer.camera.positionCartographic?.height || targetAltitude),
        }, event.origin);
      }, 80);
    });
    if (window.parent === window) {
      window.__gevVoiceCommands?.setMissionContextHandler?.((context) => {
        window.postMessage({
          type: 'the-o-eye:annotate-route',
          _missionContextRestore: true,
          label: context.missionLabel,
          points: context.stops.map((stop) => ({
            target: stop.target,
            label: stop.role,
            kind: 'stop',
            latitude: stop.latitude,
            longitude: stop.longitude,
          })),
          mode: context.routeMode,
          enableCameras: true,
          enableTraffic: true,
          focusMode: 'locked',
        }, window.location.origin);
      });
    }
    if (window.parent !== window) {
      window.parent.postMessage({ type: 'the-o-eye:ready' }, '*');
    }

  } catch (error) {
    console.error("God's Eye View initialization failed:", error);
    loaderStatus.textContent = `Error: ${describeError(error)}`;
    loaderStatus.style.color = '#ff4444';
  }
}

init();
