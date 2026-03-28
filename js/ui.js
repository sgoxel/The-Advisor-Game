/* ROAD_PATCH_V2: diagonal connectivity + color fix */
window.Game = window.Game || {};

(function () {
  const State = window.Game.State;

  function buildFullMapExportCanvas() {
    const world = State.world;
    const render = State.render;
    const renderer = window.Game && window.Game.Renderer;

    if (renderer && typeof renderer.renderWorld === "function") {
      renderer.renderWorld(true);
    }

    const sourceCanvas = render && render.worldBackgroundCanvas;
    if (!sourceCanvas) return null;

    const baseCanvas = document.createElement("canvas");
    baseCanvas.width = sourceCanvas.width;
    baseCanvas.height = sourceCanvas.height;

    const baseCtx = baseCanvas.getContext("2d", { alpha: false });
    baseCtx.drawImage(sourceCanvas, 0, 0);

    const cellWidth = baseCanvas.width / Math.max(1, world.cols || 1);
    const cellHeight = baseCanvas.height / Math.max(1, world.rows || 1);

    if (State.camera && State.camera.showGrid) {
      baseCtx.save();
      baseCtx.strokeStyle = "rgba(31, 43, 54, 0.45)";
      baseCtx.lineWidth = 1;
      baseCtx.beginPath();
      for (let col = 0; col <= world.cols; col++) {
        const x = Math.round(col * cellWidth) + 0.5;
        baseCtx.moveTo(x, 0);
        baseCtx.lineTo(x, baseCanvas.height);
      }
      for (let row = 0; row <= world.rows; row++) {
        const y = Math.round(row * cellHeight) + 0.5;
        baseCtx.moveTo(0, y);
        baseCtx.lineTo(baseCanvas.width, y);
      }
      baseCtx.stroke();
      baseCtx.restore();
    }

    const exportCanvas = document.createElement("canvas");
    exportCanvas.width = baseCanvas.height;
    exportCanvas.height = baseCanvas.width;

    const ctx = exportCanvas.getContext("2d", { alpha: false });
    ctx.translate(exportCanvas.width, 0);
    ctx.rotate(Math.PI / 2);
    ctx.drawImage(baseCanvas, 0, 0);

    return exportCanvas;
  }

  function buildSafeBaseFilename() {
    const timestamp = new Date().toISOString().replace(/[.:]/g, "-");
    const seed = (State.world && State.world.seed ? String(State.world.seed) : "map").replace(/[^a-z0-9_-]+/gi, "_");
    return `${seed || "map"}-${timestamp}`;
  }

  function triggerDownload(url, filename, logKey) {
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    if (typeof url === "string" && url.startsWith("blob:")) {
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    }
    addLog(I18n && I18n.t ? I18n.t(logKey || "logs.exportCompleted", { filename }) : `Export completed: ${filename}`);
  }


  const STEGO_MAGIC = "SMSD";
  const STEGO_VERSION = 1;

  function encodeUtf8(value) {
    if (typeof TextEncoder === "function") {
      return new TextEncoder().encode(String(value || ""));
    }
    const input = String(value || "");
    const bytes = new Uint8Array(input.length);
    for (let i = 0; i < input.length; i++) bytes[i] = input.charCodeAt(i) & 255;
    return bytes;
  }

  function buildStegoPayloadBytes(payload) {
    const jsonBytes = encodeUtf8(JSON.stringify(payload));
    const header = new Uint8Array(12);
    header[0] = STEGO_MAGIC.charCodeAt(0);
    header[1] = STEGO_MAGIC.charCodeAt(1);
    header[2] = STEGO_MAGIC.charCodeAt(2);
    header[3] = STEGO_MAGIC.charCodeAt(3);
    header[4] = (STEGO_VERSION >>> 24) & 255;
    header[5] = (STEGO_VERSION >>> 16) & 255;
    header[6] = (STEGO_VERSION >>> 8) & 255;
    header[7] = STEGO_VERSION & 255;
    const length = jsonBytes.length >>> 0;
    header[8] = (length >>> 24) & 255;
    header[9] = (length >>> 16) & 255;
    header[10] = (length >>> 8) & 255;
    header[11] = length & 255;

    const payloadBytes = new Uint8Array(header.length + jsonBytes.length);
    payloadBytes.set(header, 0);
    payloadBytes.set(jsonBytes, header.length);
    return payloadBytes;
  }

  function embedMapDataInCanvas(canvas, payload) {
    if (!canvas || !payload) return canvas;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) throw new Error("Canvas 2D context is not available.");

    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const pixels = imageData.data;
    const payloadBytes = buildStegoPayloadBytes(payload);
    const requiredBits = payloadBytes.length * 8;
    const capacityBits = Math.floor(pixels.length / 4) * 3;
    if (requiredBits > capacityBits) {
      throw new Error(`Map data is too large to embed in the PNG. Required ${requiredBits} bits, capacity ${capacityBits} bits.`);
    }

    let bitIndex = 0;
    for (let i = 0; i < pixels.length && bitIndex < requiredBits; i += 4) {
      for (let channel = 0; channel < 3 && bitIndex < requiredBits; channel++) {
        const byteIndex = bitIndex >> 3;
        const bitOffset = 7 - (bitIndex & 7);
        const bit = (payloadBytes[byteIndex] >> bitOffset) & 1;
        pixels[i + channel] = (pixels[i + channel] & 0xfe) | bit;
        bitIndex += 1;
      }
    }

    ctx.putImageData(imageData, 0, 0);
    return canvas;
  }

  function buildMapDataExportObject(options = {}) {
    const world = State.world || {};
    const camera = State.camera || {};
    const exportCanvas = buildFullMapExportCanvas();
    if (!exportCanvas) return null;

    const payload = {
      format: "simsoft-map-data",
      version: 2,
      exportedAt: new Date().toISOString(),
      seed: world.seed || "",
      map: {
        cols: world.cols || 0,
        rows: world.rows || 0,
        tileWidth: world.tileWidth || 0,
        tileHeight: world.tileHeight || 0
      },
      camera: {
        pitchAngle: camera.pitchAngle,
        depthStrength: camera.depthStrength,
        blendPixelSize: camera.blendPixelSize,
        blendStrength: camera.blendStrength,
        noiseGridDivisions: camera.noiseGridDivisions,
        showGrid: !!camera.showGrid,
        reliefEnabled: !!camera.reliefEnabled,
        sunAzimuth: camera.sunAzimuth,
        sunElevation: camera.sunElevation,
        shadowStrength: camera.shadowStrength,
        highlightStrength: camera.highlightStrength,
        shadowLength: camera.shadowLength,
        zoom: camera.zoom
      },
      player: world.player ? {
        row: world.player.row,
        col: world.player.col,
        direction: world.player.direction
      } : null,
      params: world.params || null,
      tiles: (world.terrain || []).flatMap((rowTiles, y) =>
        rowTiles.map((tile, x) => ({
          x,
          y,
          type: tile.type,
          elevation: Number(tile.elevation || 0),
          tags: tile.tags ? Array.from(tile.tags).sort() : []
        }))
      )
    };

    if (!options.excludeMapImage) {
      payload.mapImage = {
        mimeType: "image/png",
        width: exportCanvas.width,
        height: exportCanvas.height,
        dataUrl: exportCanvas.toDataURL("image/png")
      };
    }

    return payload;
  }

  function exportCurrentView() {
    const filename = `${buildSafeBaseFilename()}.png`;

    try {
      const exportCanvas = buildFullMapExportCanvas();
      if (!exportCanvas) {
        addLog(I18n && I18n.t ? I18n.t("logs.exportFailed") : "Export failed.", "Full map canvas not available.");
        return;
      }

      const payload = buildMapDataExportObject({ excludeMapImage: true });
      embedMapDataInCanvas(exportCanvas, payload);

      if (exportCanvas.toBlob) {
        exportCanvas.toBlob((blob) => {
          if (!blob) {
            addLog(I18n && I18n.t ? I18n.t("logs.exportFailed") : "Export failed.");
            return;
          }
          triggerDownload(URL.createObjectURL(blob), filename, "logs.exportCompleted");
        }, "image/png");
      } else {
        triggerDownload(exportCanvas.toDataURL("image/png"), filename, "logs.exportCompleted");
      }
    } catch (error) {
      addLog(I18n && I18n.t ? I18n.t("logs.exportFailed") : "Export failed.", error && error.message ? error.message : String(error));
    }
  }

  function exportMapData() {
    const filename = `${buildSafeBaseFilename()}-map-data.txt`;

    try {
      const payload = buildMapDataExportObject();
      if (!payload) {
        addLog(I18n && I18n.t ? I18n.t("logs.mapDataExportFailed") : "Map data export failed.", "Full map canvas not available.");
        return;
      }

      const jsonText = JSON.stringify(payload, null, 2);
      const blob = new Blob([jsonText], { type: "text/plain;charset=utf-8" });
      triggerDownload(URL.createObjectURL(blob), filename, "logs.mapDataExportCompleted");
    } catch (error) {
      addLog(
        I18n && I18n.t ? I18n.t("logs.mapDataExportFailed") : "Map data export failed.",
        error && error.message ? error.message : String(error)
      );
    }
  }
  const I18n = window.Game.I18n;

  function cacheDom() {
    const dom = State.dom;

    dom.canvas = document.getElementById("gameCanvas");
    dom.gl = dom.canvas.getContext("webgl", { antialias: true, alpha: false, preserveDrawingBuffer: true });
    if (!dom.gl) throw new Error(I18n.t("webgl.notSupported"));

    dom.minimap = document.getElementById("minimap");
    dom.miniCtx = dom.minimap.getContext("2d");

    dom.settingsModal = document.getElementById("settingsModal");
    dom.mainMenuBtn = document.getElementById("mainMenuBtn");
    dom.mainMenuDropdown = document.getElementById("mainMenuDropdown");
    dom.menuGithubBtn = document.getElementById("menuGithubBtn");
    dom.menuSaveBtn = document.getElementById("menuSaveBtn");
    dom.menuLoadBtn = document.getElementById("menuLoadBtn");
    dom.menuExportMapDataBtn = document.getElementById("menuExportMapDataBtn");
    dom.localMapFolderInput = document.getElementById("localMapFolderInput");
    dom.settingsBtn = document.getElementById("settingsBtn");
    dom.applySettingsBtn = document.getElementById("applySettingsBtn");
    dom.cancelSettingsBtn = document.getElementById("cancelSettingsBtn");

    dom.logModal = document.getElementById("logModal");
    dom.logBtn = document.getElementById("logBtn");
    dom.closeLogBtn = document.getElementById("closeLogBtn");
    dom.logText = document.getElementById("logText");

    dom.seedInput = document.getElementById("seedInput");
    dom.mapWidthInput = document.getElementById("mapWidthInput");
    dom.mapHeightInput = document.getElementById("mapHeightInput");
    dom.cameraPitchInput = document.getElementById("cameraPitchInput");
    dom.depthStrengthInput = document.getElementById("depthStrengthInput");
    dom.blendPixelSizeInput = document.getElementById("blendPixelSizeInput");
    dom.blendStrengthInput = document.getElementById("blendStrengthInput");
    dom.noiseGridDivisionsInput = document.getElementById("noiseGridDivisionsInput");
    dom.showGridInput = document.getElementById("showGridInput");
    dom.reliefEnabledInput = document.getElementById("reliefEnabledInput");
    dom.sunAzimuthInput = document.getElementById("sunAzimuthInput");
    dom.sunElevationInput = document.getElementById("sunElevationInput");
    dom.shadowStrengthInput = document.getElementById("shadowStrengthInput");
    dom.highlightStrengthInput = document.getElementById("highlightStrengthInput");
    dom.shadowLengthInput = document.getElementById("shadowLengthInput");

    dom.dialogText = document.getElementById("dialogText");
    dom.languageSelect = document.getElementById("languageSelect");
    dom.topLeftScroll = document.getElementById("topLeftScroll");
    dom.topMenuScrollLeft = document.getElementById("topMenuScrollLeft");
    dom.topMenuScrollRight = document.getElementById("topMenuScrollRight");
    dom.mobilePanelsToggle = document.getElementById("mobilePanelsToggle");
    dom.mobilePanelTabs = document.getElementById("mobilePanelTabs");

    dom.top.goldValue = document.getElementById("goldValue");
    dom.top.healthText = document.getElementById("healthText");
    dom.top.staminaText = document.getElementById("staminaText");
    dom.top.manaText = document.getElementById("manaText");
    dom.top.healthBar = document.getElementById("healthBar");
    dom.top.staminaBar = document.getElementById("staminaBar");
    dom.top.manaBar = document.getElementById("manaBar");

    dom.params.streams = document.getElementById("paramStreams");
    dom.params.lake = document.getElementById("paramLake");
    dom.params.hills = document.getElementById("paramHills");
    dom.params.hillArea = document.getElementById("paramHillArea");
    dom.params.roads = document.getElementById("paramRoads");
    dom.params.forest = document.getElementById("paramForest");
    dom.params.forestArea = document.getElementById("paramForestArea");
    dom.params.settlement = document.getElementById("paramSettlement");
    dom.params.grassArea = document.getElementById("paramGrassArea");
    dom.params.dirtArea = document.getElementById("paramDirtArea");
    dom.params.waterArea = document.getElementById("paramWaterArea");
    dom.params.stoneArea = document.getElementById("paramStoneArea");
  }

  function syncSettingsInputs() {
    const dom = State.dom;
    dom.seedInput.value = State.world.seed;
    dom.mapWidthInput.value = State.world.cols;
    dom.mapHeightInput.value = State.world.rows;
    dom.cameraPitchInput.value = State.camera.pitchAngle;
    dom.depthStrengthInput.value = State.camera.depthStrength;
    if (dom.blendPixelSizeInput) dom.blendPixelSizeInput.value = State.camera.blendPixelSize;
    if (dom.blendStrengthInput) dom.blendStrengthInput.value = State.camera.blendStrength;
    if (dom.noiseGridDivisionsInput) dom.noiseGridDivisionsInput.value = State.camera.noiseGridDivisions;
    if (dom.showGridInput) dom.showGridInput.checked = !!State.camera.showGrid;
    if (dom.reliefEnabledInput) dom.reliefEnabledInput.checked = !!State.camera.reliefEnabled;
    if (dom.sunAzimuthInput) dom.sunAzimuthInput.value = State.camera.sunAzimuth;
    if (dom.sunElevationInput) dom.sunElevationInput.value = State.camera.sunElevation;
    if (dom.shadowStrengthInput) dom.shadowStrengthInput.value = State.camera.shadowStrength;
    if (dom.highlightStrengthInput) dom.highlightStrengthInput.value = State.camera.highlightStrength;
    if (dom.shadowLengthInput) dom.shadowLengthInput.value = State.camera.shadowLength;
  }

  function percent(value) { return I18n.t("paramValues.percent", { value }); }
  function exists(flag) { return flag ? I18n.t("paramValues.exists") : I18n.t("paramValues.notExists"); }

  function updateParamUI() {
    const p = State.world.params;
    if (!p) return;
    const params = State.dom.params;
    params.streams.value = String(p.streamCount);
    params.lake.value = exists(p.hasLake);
    params.hills.value = String(p.hillCount);
    params.hillArea.value = percent(p.actualHillCoverage);
    params.roads.value = String(p.roadCount);
    params.forest.value = exists(p.hasForest);
    params.forestArea.value = percent(p.actualForestCoverage);
    params.settlement.value = p.hasSettlement ? percent(p.actualSettlementCoverage) : I18n.t("paramValues.notExists");
    params.grassArea.value = percent(p.actualGrassCoverage);
    params.dirtArea.value = percent(p.actualDirtCoverage);
    params.waterArea.value = percent(p.actualWaterCoverage);
    params.stoneArea.value = percent(p.actualStoneCoverage);
  }

  function formatTime() {
    const now = new Date();
    const locale = State.i18n.current === "tr" ? "tr-TR" : "en-GB";
    return now.toLocaleTimeString(locale, { hour12: false });
  }

  function stringifyDetails(details) {
    if (details === undefined || details === null || details === "") return "";
    if (typeof details === "string") return details;
    try { return JSON.stringify(details, null, 2); } catch { return String(details); }
  }

  function renderLogs() {
    if (!State.dom.logText) return;
    State.dom.logText.value = State.log.lines.join("\n\n");
    State.dom.logText.scrollTop = State.dom.logText.scrollHeight;
  }

  function addLog(message, details) {
    const detailText = stringifyDetails(details);
    const line = detailText ? `[${formatTime()}] ${message}\n${detailText}` : `[${formatTime()}] ${message}`;
    State.log.lines.push(line);
    if (State.log.lines.length > State.log.maxLines) State.log.lines.shift();
    renderLogs();
  }


  function isMenuOpen() {
    return State.dom.mainMenuDropdown && !State.dom.mainMenuDropdown.classList.contains("hidden");
  }

  function positionMainMenuDropdown() {
    const dropdown = State.dom.mainMenuDropdown;
    const button = State.dom.mainMenuBtn;
    if (!dropdown || !button) return;

    const compactPortrait = window.innerWidth <= 960 && window.innerHeight > window.innerWidth;
    if (!compactPortrait) {
      dropdown.classList.remove("dropdown-fixed");
      dropdown.style.top = "";
      dropdown.style.left = "";
      dropdown.style.width = "";
      dropdown.style.minWidth = "";
      return;
    }

    const rect = button.getBoundingClientRect();
    const viewportWidth = window.innerWidth;
    const preferredWidth = Math.max(rect.width, 180);
    const maxAllowedWidth = Math.max(180, viewportWidth - 16);
    const width = Math.min(preferredWidth, maxAllowedWidth);
    const left = Math.max(8, Math.min(rect.left, viewportWidth - width - 8));
    const top = Math.min(rect.bottom + 6, window.innerHeight - 8);

    dropdown.classList.add("dropdown-fixed");
    dropdown.style.left = `${Math.round(left)}px`;
    dropdown.style.top = `${Math.round(top)}px`;
    dropdown.style.width = `${Math.round(width)}px`;
    dropdown.style.minWidth = `${Math.round(width)}px`;
  }

  function openMainMenu() {
    if (!State.dom.mainMenuDropdown) return;
    positionMainMenuDropdown();
    State.dom.mainMenuDropdown.classList.remove("hidden");
    if (State.dom.mainMenuBtn) State.dom.mainMenuBtn.setAttribute("aria-expanded", "true");
  }

  function closeMainMenu() {
    if (!State.dom.mainMenuDropdown) return;
    State.dom.mainMenuDropdown.classList.add("hidden");
    State.dom.mainMenuDropdown.classList.remove("dropdown-fixed");
    State.dom.mainMenuDropdown.style.top = "";
    State.dom.mainMenuDropdown.style.left = "";
    State.dom.mainMenuDropdown.style.width = "";
    State.dom.mainMenuDropdown.style.minWidth = "";
    if (State.dom.mainMenuBtn) State.dom.mainMenuBtn.setAttribute("aria-expanded", "false");
  }

  function toggleMainMenu(forceState) {
    const shouldOpen = typeof forceState === "boolean" ? forceState : !isMenuOpen();
    if (shouldOpen) openMainMenu();
    else closeMainMenu();
  }

  function openSettingsModal() { syncSettingsInputs(); updateParamUI(); State.dom.settingsModal.classList.remove("hidden"); addLog(I18n.t("logs.settingsOpened")); }
  function closeSettingsModal() { State.dom.settingsModal.classList.add("hidden"); addLog(I18n.t("logs.settingsClosed")); }
  function openLogModal() { State.dom.logModal.classList.remove("hidden"); addLog(I18n.t("logs.logOpened")); }
  function closeLogModal() { State.dom.logModal.classList.add("hidden"); addLog(I18n.t("logs.logClosed")); }
  function updateDialogText(text) { State.dom.dialogText.textContent = text; syncDialogTextHeight(); }
  function applyCurrentLanguageToUI() { I18n.applyTranslations(); updateParamUI(); renderLogs(); syncDialogTextHeight(); updateMobilePanelsToggle(); }

  function bindChoiceButtons() {
    document.querySelectorAll(".choice-btn").forEach((btn, index) => {
      btn.addEventListener("click", () => {
        updateDialogText(I18n.t(btn.dataset.dialogKey));
        addLog(I18n.t("logs.dialogChoice", { choice: btn.textContent.trim() }));
        const top = State.dom.top;
        const stateChanges = [
          { gold: 12, health: 82, stamina: 64, mana: 54 },
          { gold: 5, health: 78, stamina: 70, mana: 49 },
          { gold: 3, health: 74, stamina: 60, mana: 58 },
          { gold: 0, health: 82, stamina: 75, mana: 57 }
        ][index];
        top.goldValue.textContent = Number(top.goldValue.textContent) + stateChanges.gold;
        top.healthText.textContent = stateChanges.health;
        top.staminaText.textContent = stateChanges.stamina;
        top.manaText.textContent = stateChanges.mana;
        top.healthBar.style.width = `${stateChanges.health}%`;
        top.staminaBar.style.width = `${stateChanges.stamina}%`;
        top.manaBar.style.width = `${stateChanges.mana}%`;
      });
    });
  }


  function updateTopMenuScrollButtons() {
    const scroller = State.dom.topLeftScroll;
    const left = State.dom.topMenuScrollLeft;
    const right = State.dom.topMenuScrollRight;
    if (!scroller || !left || !right) return;
    const compact = window.innerWidth <= 960;
    const hasOverflow = compact && scroller.scrollWidth > scroller.clientWidth + 8;
    left.classList.toggle("hidden", !hasOverflow || scroller.scrollLeft <= 6);
    right.classList.toggle("hidden", !hasOverflow || scroller.scrollLeft + scroller.clientWidth >= scroller.scrollWidth - 6);
  }

  function scrollTopMenu(direction) {
    const scroller = State.dom.topLeftScroll;
    if (!scroller) return;
    scroller.scrollBy({ left: direction * Math.max(120, scroller.clientWidth * 0.55), behavior: "smooth" });
    window.setTimeout(updateTopMenuScrollButtons, 220);
  }

  function bindTopMenuScroller() {
    const scroller = State.dom.topLeftScroll;
    if (!scroller) return;
    let dragging = false;
    let startX = 0;
    let startScroll = 0;

    const stopDragging = () => {
      dragging = false;
      scroller.classList.remove("dragging-scroll");
    };

    scroller.addEventListener("pointerdown", (event) => {
      if (window.innerWidth > 960) return;
      dragging = true;
      startX = event.clientX;
      startScroll = scroller.scrollLeft;
      scroller.classList.add("dragging-scroll");
    });

    scroller.addEventListener("pointermove", (event) => {
      if (!dragging) return;
      const delta = event.clientX - startX;
      scroller.scrollLeft = startScroll - delta;
      updateTopMenuScrollButtons();
    });

    scroller.addEventListener("pointerup", stopDragging);
    scroller.addEventListener("pointercancel", stopDragging);
    scroller.addEventListener("pointerleave", stopDragging);
    scroller.addEventListener("scroll", updateTopMenuScrollButtons, { passive: true });

    if (State.dom.topMenuScrollLeft) State.dom.topMenuScrollLeft.addEventListener("click", () => scrollTopMenu(-1));
    if (State.dom.topMenuScrollRight) State.dom.topMenuScrollRight.addEventListener("click", () => scrollTopMenu(1));

    window.addEventListener("resize", updateTopMenuScrollButtons);
    window.setTimeout(updateTopMenuScrollButtons, 0);
  }

  function scrollToMobilePanels() {
    const tabs = State.dom.mobilePanelTabs;
    if (!tabs) return;
    tabs.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function isCompactPortraitLayout() {
    return window.innerWidth <= 960 && window.innerHeight > window.innerWidth;
  }

  function syncDialogTextHeight() {
    const dialogText = State.dom.dialogText;
    if (!dialogText) return;

    if (!isCompactPortraitLayout()) {
      dialogText.style.height = "";
      dialogText.style.minHeight = "";
      return;
    }

    dialogText.style.height = "auto";
    dialogText.style.minHeight = "0px";
    const fullHeight = Math.ceil(dialogText.scrollHeight);
    dialogText.style.height = `${fullHeight}px`;
    dialogText.style.minHeight = `${fullHeight}px`;
  }

  function updateMobilePanelsToggle() {
    const toggle = State.dom.mobilePanelsToggle;
    const centerArea = document.getElementById("center-area");
    const tabs = State.dom.mobilePanelTabs;
    if (!toggle || !centerArea || !tabs) return;

    if (!isCompactPortraitLayout()) {
      toggle.textContent = "⌄";
      toggle.setAttribute("aria-label", "Open bottom panels");
      centerArea.classList.remove("panel-toggle-up");
      return;
    }

    const tabsRect = tabs.getBoundingClientRect();
    const hasScrolledDown = window.scrollY > 24;
    const tabsReachedViewport = tabsRect.top <= window.innerHeight - 120;
    const shouldPointUp = hasScrolledDown || tabsReachedViewport;
    toggle.textContent = shouldPointUp ? "⌃" : "⌄";
    toggle.setAttribute("aria-label", shouldPointUp ? "Scroll to top" : "Open bottom panels");
    centerArea.classList.toggle("panel-toggle-up", shouldPointUp);
  }

  function handleMobilePanelsToggle() {
    const shouldScrollUp = isCompactPortraitLayout() && window.scrollY > 24;
    if (shouldScrollUp) {
      window.scrollTo({ top: 0, behavior: "smooth" });
      return;
    }
    scrollToMobilePanels();
  }

  function updateResponsiveLayout() {
    const app = document.getElementById("app");
    if (!app) return;
    const isCompact = window.innerWidth <= 960;
    const orientation = window.innerWidth > window.innerHeight ? "landscape" : "portrait";
    app.dataset.viewport = isCompact ? "compact" : "desktop";
    app.dataset.orientation = orientation;
    app.dataset.mobilePanels = isCompact && orientation === "portrait" ? "below-fold" : "inline";
    updateTopMenuScrollButtons();
    syncDialogTextHeight();
    updateMobilePanelsToggle();
  }

  function setActiveMobilePanel(panelName) {
    const panels = document.querySelectorAll(".bottom-ribbon .panel[data-panel-name]");
    const tabs = document.querySelectorAll(".mobile-tab-btn[data-panel-target]");
    panels.forEach((panel) => panel.classList.toggle("active-panel", panel.dataset.panelName === panelName));
    tabs.forEach((tab) => tab.classList.toggle("active", tab.dataset.panelTarget === panelName));
    if (window.Game.Minimap && panelName === "minimap-panel") {
      window.Game.Minimap.resizeMinimap();
      window.Game.Minimap.renderMinimap();
    }
    window.setTimeout(syncDialogTextHeight, 0);
  }

  function bindResponsivePanels() {
    document.querySelectorAll(".mobile-tab-btn[data-panel-target]").forEach((btn) => {
      btn.addEventListener("click", () => setActiveMobilePanel(btn.dataset.panelTarget));
    });
    if (State.dom.mobilePanelsToggle) {
      State.dom.mobilePanelsToggle.addEventListener("click", handleMobilePanelsToggle);
    }
    window.addEventListener("scroll", updateMobilePanelsToggle, { passive: true });
    bindTopMenuScroller();
    updateResponsiveLayout();
    window.setTimeout(syncDialogTextHeight, 0);
  }

  function bindUIEvents(onApplySettings, onLanguageChange) {
    const dom = State.dom;
    const handleMainMenuToggle = (event) => {
      event.preventDefault();
      event.stopPropagation();
      toggleMainMenu();
    };
    dom.mainMenuBtn.addEventListener("click", handleMainMenuToggle);
    dom.mainMenuBtn.addEventListener("mousedown", (event) => event.stopPropagation());
    dom.mainMenuBtn.addEventListener("pointerdown", (event) => event.stopPropagation());
    dom.mainMenuBtn.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") handleMainMenuToggle(event);
    });
    dom.menuGithubBtn.addEventListener("click", () => {
      window.open("https://github.com/sgoxel/The-Advisor-Game", "_blank", "noopener,noreferrer");
      closeMainMenu();
    });
    dom.menuSaveBtn.addEventListener("click", () => {
      exportCurrentView();
      closeMainMenu();
    });
    dom.menuLoadBtn.addEventListener("click", () => {
      if (window.Game.App && typeof window.Game.App.promptLocalMapFolderSelection === "function") {
        window.Game.App.promptLocalMapFolderSelection();
      } else {
        addLog("Load action selected, but local folder loading is not ready.");
      }
      closeMainMenu();
    });
    if (dom.menuExportMapDataBtn) {
      dom.menuExportMapDataBtn.addEventListener("click", () => {
        exportMapData();
        closeMainMenu();
      });
    }

    const characterPanel = document.querySelector('.character-panel');
    const characterHeader = document.querySelector('.character-panel .panel-header');
    const recenterCharacter = (event) => {
      if (event) event.preventDefault();
      if (window.Game.Renderer) {
        window.Game.Renderer.centerCamera();
        window.Game.Renderer.markDirty();
      }
      addLog('Character panel selected. Camera centered on player.');
    };
    if (characterPanel) {
      characterPanel.style.cursor = 'pointer';
      characterPanel.addEventListener('click', recenterCharacter);
    }
    if (characterHeader) {
      characterHeader.addEventListener('click', (event) => {
        event.stopPropagation();
        recenterCharacter(event);
      });
    }
    document.addEventListener("click", (event) => {
      if (!dom.mainMenuDropdown || dom.mainMenuDropdown.classList.contains("hidden")) return;
      if (dom.mainMenuDropdown.contains(event.target) || dom.mainMenuBtn.contains(event.target)) return;
      closeMainMenu();
    });
    document.addEventListener("pointerdown", (event) => {
      if (!dom.mainMenuDropdown || dom.mainMenuDropdown.classList.contains("hidden")) return;
      if (dom.mainMenuDropdown.contains(event.target) || dom.mainMenuBtn.contains(event.target)) return;
      closeMainMenu();
    }, true);
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape") closeMainMenu();
    });
    window.addEventListener("resize", () => {
      if (isMenuOpen()) positionMainMenuDropdown();
    });
    window.addEventListener("orientationchange", () => {
      window.setTimeout(() => {
        if (isMenuOpen()) positionMainMenuDropdown();
      }, 30);
    });
    window.addEventListener("scroll", () => {
      if (isMenuOpen()) positionMainMenuDropdown();
    }, { passive: true });
    dom.settingsBtn.addEventListener("click", openSettingsModal);
    dom.cancelSettingsBtn.addEventListener("click", closeSettingsModal);
    dom.logBtn.addEventListener("click", openLogModal);
    dom.closeLogBtn.addEventListener("click", closeLogModal);
    dom.languageSelect.addEventListener("change", (event) => onLanguageChange(event.target.value));
    dom.settingsModal.addEventListener("click", (event) => { if (event.target === dom.settingsModal) closeSettingsModal(); });
    dom.logModal.addEventListener("click", (event) => { if (event.target === dom.logModal) closeLogModal(); });
    dom.applySettingsBtn.addEventListener("click", onApplySettings);
    if (dom.localMapFolderInput) {
      dom.localMapFolderInput.addEventListener("change", async (event) => {
        const files = event.target && event.target.files ? event.target.files : [];
        if (window.Game.App && typeof window.Game.App.registerLocalMapFiles === "function") {
          await window.Game.App.registerLocalMapFiles(files);
        }
      });
    }
    bindResponsivePanels();
  }

  window.Game.UI = {
    cacheDom,
    syncSettingsInputs,
    updateParamUI,
    openSettingsModal,
    closeSettingsModal,
    openLogModal,
    closeLogModal,
    addLog,
    bindUIEvents,
    updateDialogText,
    bindChoiceButtons,
    applyCurrentLanguageToUI,
    openMainMenu,
    closeMainMenu,
    toggleMainMenu,
    updateResponsiveLayout,
    setActiveMobilePanel,
    updateTopMenuScrollButtons,
    scrollToMobilePanels,
    syncDialogTextHeight,
    updateMobilePanelsToggle
  };
})();
