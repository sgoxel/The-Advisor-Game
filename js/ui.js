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

    dom.dialogText = document.getElementById("dialogText");
    dom.languageSelect = document.getElementById("languageSelect");

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

  function openMainMenu() {
    if (!State.dom.mainMenuDropdown) return;
    State.dom.mainMenuDropdown.classList.remove("hidden");
    if (State.dom.mainMenuBtn) State.dom.mainMenuBtn.setAttribute("aria-expanded", "true");
  }

  function closeMainMenu() {
    if (!State.dom.mainMenuDropdown) return;
    State.dom.mainMenuDropdown.classList.add("hidden");
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
  function updateDialogText(text) { State.dom.dialogText.textContent = text; }
  function applyCurrentLanguageToUI() { I18n.applyTranslations(); updateParamUI(); renderLogs(); }

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

  function updateResponsiveLayout() {
    const app = document.getElementById("app");
    if (!app) return;
    const isCompact = window.innerWidth <= 960;
    const orientation = window.innerWidth > window.innerHeight ? "landscape" : "portrait";
    app.dataset.viewport = isCompact ? "compact" : "desktop";
    app.dataset.orientation = orientation;
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
  }

  function bindResponsivePanels() {
    document.querySelectorAll(".mobile-tab-btn[data-panel-target]").forEach((btn) => {
      btn.addEventListener("click", () => setActiveMobilePanel(btn.dataset.panelTarget));
    });
    updateResponsiveLayout();
  }

  function bindUIEvents(onApplySettings, onLanguageChange) {
    const dom = State.dom;
    dom.mainMenuBtn.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      toggleMainMenu();
    });
    dom.menuGithubBtn.addEventListener("click", () => {
      window.open("https://github.com/sgoxel/The-Advisor-Game", "_blank", "noopener,noreferrer");
      closeMainMenu();
    });
    dom.menuSaveBtn.addEventListener("click", () => closeMainMenu());
    dom.menuLoadBtn.addEventListener("click", () => closeMainMenu());
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
    setActiveMobilePanel
  };
})();
