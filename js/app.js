window.Game = window.Game || {};

(function () {
  const Config = window.Game.Config;
  const State = window.Game.State;
  const Utils = window.Game.Utils;
  const Terrain = window.Game.Terrain;
  const Renderer = window.Game.Renderer;
  const Minimap = window.Game.Minimap;
  const UI = window.Game.UI;
  const Input = window.Game.Input;
  const I18n = window.Game.I18n;

  function rebuildWorld(seed, cols, rows) {
    const world = State.world;

    world.seed = seed;
    world.cols = cols;
    world.rows = rows;
    world.selected = null;
    world.hover = null;
    world.player = {
      row: Math.floor(rows / 2),
      col: Math.floor(cols / 2),
      moving: false,
      startRow: Math.floor(rows / 2),
      startCol: Math.floor(cols / 2),
      targetRow: Math.floor(rows / 2),
      targetCol: Math.floor(cols / 2),
      moveStartTime: 0,
      moveDuration: 180,
      progress: 1,
      direction: 's',
      pathQueue: []
    };

    const generated = Terrain.generateWorld(seed, cols, rows);
    State.camera.zoom = Config.DEFAULT_START_ZOOM;
    State.camera.x = world.player.col;
    State.camera.y = world.player.row;

    world.terrain = generated.grid;
    world.params = generated.params;

    State.render.needsBackgroundRebuild = true;
    State.render.needsBackgroundUpload = true;
    State.render.backgroundTextureReady = false;
    UI.syncSettingsInputs();
    UI.updateParamUI();
    Renderer.fitCameraToWorld();
    Renderer.markDirty();
    UI.addLog(I18n.t("logs.worldRebuilt", { seed, cols, rows }));
  }

  function updateWorldSummary(seed, cols, rows) {
    UI.updateDialogText(
      I18n.t("dialog.worldSummary", {
        seed,
        cols,
        rows,
        hills: State.world.params.hillCount,
        streams: State.world.params.streamCount,
        roads: State.world.params.roadCount
      })
    );
  }

  function handleApplySettings() {
    const dom = State.dom;

    const seed = (dom.seedInput.value || "").trim() || Config.DEFAULT_SEED;
    const cols = Utils.clamp(Number(dom.mapWidthInput.value) || Config.DEFAULT_COLS, Config.MIN_MAP_SIZE, Config.MAX_MAP_SIZE);
    const rows = Utils.clamp(Number(dom.mapHeightInput.value) || Config.DEFAULT_ROWS, Config.MIN_MAP_SIZE, Config.MAX_MAP_SIZE);
    const pitchAngle = Utils.clamp(Number(dom.cameraPitchInput.value) || Config.DEFAULT_CAMERA_PITCH, Config.MIN_CAMERA_PITCH, Config.MAX_CAMERA_PITCH);
    const depthStrength = Utils.clamp(Number(dom.depthStrengthInput.value) || Config.DEFAULT_DEPTH_STRENGTH, Config.MIN_DEPTH_STRENGTH, Config.MAX_DEPTH_STRENGTH);
    const blendPixelSize = Utils.clamp(
      Number(dom.blendPixelSizeInput && dom.blendPixelSizeInput.value) || Config.DEFAULT_BLEND_PIXEL_SIZE,
      Config.MIN_BLEND_PIXEL_SIZE,
      Config.MAX_BLEND_PIXEL_SIZE
    );
    const blendStrength = Utils.clamp(
      Number(dom.blendStrengthInput && dom.blendStrengthInput.value) || Config.DEFAULT_BLEND_STRENGTH,
      Config.MIN_BLEND_STRENGTH,
      Config.MAX_BLEND_STRENGTH
    );
    const noiseGridDivisions = Utils.clamp(
      Number(dom.noiseGridDivisionsInput && dom.noiseGridDivisionsInput.value) || Config.DEFAULT_NOISE_GRID_DIVISIONS,
      Config.MIN_NOISE_GRID_DIVISIONS,
      Config.MAX_NOISE_GRID_DIVISIONS
    );
    const showGrid = !!(dom.showGridInput && dom.showGridInput.checked);
    const reliefEnabled = !!(dom.reliefEnabledInput && dom.reliefEnabledInput.checked);
    const sunAzimuth = Utils.clamp(
      Number(dom.sunAzimuthInput && dom.sunAzimuthInput.value) || Config.DEFAULT_SUN_AZIMUTH,
      Config.MIN_SUN_AZIMUTH,
      Config.MAX_SUN_AZIMUTH
    );
    const sunElevation = Utils.clamp(
      Number(dom.sunElevationInput && dom.sunElevationInput.value) || Config.DEFAULT_SUN_ELEVATION,
      Config.MIN_SUN_ELEVATION,
      Config.MAX_SUN_ELEVATION
    );
    const shadowStrength = Utils.clamp(
      Number(dom.shadowStrengthInput && dom.shadowStrengthInput.value) || Config.DEFAULT_SHADOW_STRENGTH,
      Config.MIN_SHADOW_STRENGTH,
      Config.MAX_SHADOW_STRENGTH
    );
    const highlightStrength = Utils.clamp(
      Number(dom.highlightStrengthInput && dom.highlightStrengthInput.value) || Config.DEFAULT_HIGHLIGHT_STRENGTH,
      Config.MIN_HIGHLIGHT_STRENGTH,
      Config.MAX_HIGHLIGHT_STRENGTH
    );
    const shadowLength = Utils.clamp(
      Number(dom.shadowLengthInput && dom.shadowLengthInput.value) || Config.DEFAULT_SHADOW_LENGTH,
      Config.MIN_SHADOW_LENGTH,
      Config.MAX_SHADOW_LENGTH
    );

    State.camera.pitchAngle = pitchAngle;
    State.camera.depthStrength = depthStrength;
    State.camera.blendPixelSize = blendPixelSize;
    State.camera.blendStrength = blendStrength;
    State.camera.noiseGridDivisions = noiseGridDivisions;
    State.camera.showGrid = showGrid;
    State.camera.reliefEnabled = reliefEnabled;
    State.camera.sunAzimuth = sunAzimuth;
    State.camera.sunElevation = sunElevation;
    State.camera.shadowStrength = shadowStrength;
    State.camera.highlightStrength = highlightStrength;
    State.camera.shadowLength = shadowLength;
    rebuildWorld(seed, cols, rows);
    UI.closeSettingsModal();
    UI.addLog(I18n.t("logs.settingsApplied", { seed, cols, rows }));
    updateWorldSummary(seed, cols, rows);
  }

  async function handleLanguageChange(lang) {
    await I18n.loadLanguage(lang);
    UI.applyCurrentLanguageToUI();
    updateWorldSummary(State.world.seed, State.world.cols, State.world.rows);
  }

  function resizeAll() {
    UI.updateResponsiveLayout();
    Renderer.resizeCanvas();
    Renderer.updateZoomLimits();
    Minimap.resizeMinimap();
    Renderer.markDirty();
  }

  function loop(timestamp) {
    Input.updateCameraFromKeyboard();
    Input.updatePlayerMovement(timestamp || performance.now());
    Renderer.updateCameraFollow();
    Renderer.renderWorld();
    Minimap.renderMinimap();
    requestAnimationFrame(loop);
  }

  function normalizeUrl(url) {
    if (!url) return I18n.t("logs.unknownSource");
    try {
      const parsed = new URL(url, window.location.href);
      const parts = parsed.pathname.split("/");
      return parts[parts.length - 1] || parsed.href;
    } catch (error) {
      return String(url);
    }
  }

  function formatStack(error) {
    if (!error || !error.stack) return I18n.t("logs.noStack");
    return error.stack;
  }

  function buildErrorDetails(message, source, lineno, colno, errorObj, extra) {
    const detailLines = [
      `${I18n.t("logs.message")}    : ${message || I18n.t("logs.unknown")}`,
      `${I18n.t("logs.file")}      : ${normalizeUrl(source)}`,
      `${I18n.t("logs.line")}      : ${lineno || 0}`,
      `${I18n.t("logs.column")}    : ${colno || 0}`
    ];

    if (extra) {
      detailLines.push(`${I18n.t("logs.extraInfo")} : ${extra}`);
    }

    if (errorObj && errorObj.name) {
      detailLines.push(`${I18n.t("logs.errorType")} : ${errorObj.name}`);
    }

    detailLines.push(`${I18n.t("logs.stack")}     :`);
    detailLines.push(formatStack(errorObj));

    return detailLines.join("\n");
  }

  function registerGlobalErrorHandlers() {
    const ignoreFileOriginWarning = (message) => {
      return typeof message === "string" && message.indexOf("Unsafe attempt to load URL file:///") !== -1;
    };

    window.onerror = function (message, source, lineno, colno, errorObj) {
      if (ignoreFileOriginWarning(message)) return true;
      UI.addLog(I18n.t("logs.runtimeError"), buildErrorDetails(message, source, lineno, colno, errorObj));
      return false;
    };

    window.addEventListener("error", (event) => {
      if (ignoreFileOriginWarning(event.message)) return;
      if (event.error || event.message) {
        UI.addLog(
          I18n.t("logs.globalError"),
          buildErrorDetails(event.message, event.filename, event.lineno, event.colno, event.error)
        );
        return;
      }

      const target = event.target;
      if (target && target !== window) {
        const source = target.src || target.href || target.currentSrc || I18n.t("logs.unknownSource");
        UI.addLog(
          I18n.t("logs.staticResourceFailed"),
          buildErrorDetails(
            I18n.t("logs.resourceLoadError"),
            source,
            0,
            0,
            null,
            `${I18n.t("logs.tag")}: <${String(target.tagName || "unknown").toLowerCase()}>`
          )
        );
      }
    }, true);

    window.addEventListener("unhandledrejection", (event) => {
      const reason = event.reason;
      const reasonMessage = reason && reason.message ? reason.message : String(reason);
      UI.addLog(
        I18n.t("logs.promiseRejection"),
        buildErrorDetails(reasonMessage, reason && reason.fileName, reason && reason.lineNumber, reason && reason.columnNumber, reason)
      );
    });
  }

  async function init() {
    try {
      await I18n.loadLanguage(I18n.getPreferredLanguage());
      UI.cacheDom();
      UI.bindUIEvents(handleApplySettings, handleLanguageChange);
      UI.bindChoiceButtons();
      Input.bindInputEvents();
      Minimap.bindMinimapEvents();
      registerGlobalErrorHandlers();
      UI.applyCurrentLanguageToUI();

      resizeAll();
      UI.addLog(I18n.t("logs.appStarted"));
      rebuildWorld(Config.DEFAULT_SEED, Config.DEFAULT_COLS, Config.DEFAULT_ROWS);
      updateWorldSummary(Config.DEFAULT_SEED, Config.DEFAULT_COLS, Config.DEFAULT_ROWS);

      window.addEventListener("resize", () => {
        resizeAll();
        UI.addLog(I18n.t("logs.windowResized"));
      });

      loop();
    } catch (error) {
      console.error(error);
      alert(error.message || String(error));
    }
  }

  window.addEventListener("DOMContentLoaded", init);
})();
