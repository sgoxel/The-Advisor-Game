/* ROAD_PATCH_V2: diagonal connectivity + color fix */
window.Game = window.Game || {};

(function () {
  const State = window.Game.State;
  const I18n = window.Game.I18n;

  function cacheDom() {
    const dom = State.dom;

    dom.canvas = document.getElementById("gameCanvas");
    dom.gl = dom.canvas.getContext("webgl", { antialias: true, alpha: false });
    if (!dom.gl) throw new Error(I18n.t("webgl.notSupported"));

    dom.minimap = document.getElementById("minimap");
    dom.miniCtx = dom.minimap.getContext("2d");

    dom.settingsModal = document.getElementById("settingsModal");
    dom.mainMenuBtn = document.getElementById("mainMenuBtn");
    dom.mainMenuDropdown = document.getElementById("mainMenuDropdown");
    dom.menuGithubBtn = document.getElementById("menuGithubBtn");
    dom.menuSaveBtn = document.getElementById("menuSaveBtn");
    dom.menuLoadBtn = document.getElementById("menuLoadBtn");
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
      addLog("Save action selected. Function not implemented yet.");
      closeMainMenu();
    });
    dom.menuLoadBtn.addEventListener("click", () => {
      addLog("Load action selected. Function not implemented yet.");
      closeMainMenu();
    });

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
