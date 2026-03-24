/*
  FILE PURPOSE:
  Application bootstrap and main loop orchestration.

  DEPENDENCIES:
  - all previous files

  PUBLIC API:
  - none required, this is the startup file

  IMPORTANT RULES:
  - Keep startup flow readable.
  - Use this file to connect modules together.
*/

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

  function rebuildWorld(seed, cols, rows) {
    const world = State.world;

    world.seed = seed;
    world.cols = cols;
    world.rows = rows;
    world.selected = null;
    world.hover = null;
    world.player = {
      row: Math.floor(rows / 2),
      col: Math.floor(cols / 2)
    };

    const generated = Terrain.generateWorld(seed, cols, rows);
    world.terrain = generated.grid;
    world.params = generated.params;

    UI.syncSettingsInputs();
    UI.updateParamUI();
    Renderer.centerCamera();
    UI.addLog(`Dünya yeniden oluşturuldu. SEED=${seed}, boyut=${cols}x${rows}`);
  }

  function handleApplySettings() {
    const dom = State.dom;

    const seed = (dom.seedInput.value || "").trim() || Config.DEFAULT_SEED;
    const cols = Utils.clamp(Number(dom.mapWidthInput.value) || Config.DEFAULT_COLS, Config.MIN_MAP_SIZE, Config.MAX_MAP_SIZE);
    const rows = Utils.clamp(Number(dom.mapHeightInput.value) || Config.DEFAULT_ROWS, Config.MIN_MAP_SIZE, Config.MAX_MAP_SIZE);

    rebuildWorld(seed, cols, rows);
    UI.closeSettingsModal();
    UI.addLog(`Ayarlar uygulandı. Yeni SEED=${seed}, yeni boyut=${cols}x${rows}`);

    UI.updateDialogText(
      `Yeni dünya üretildi. SEED: ${seed} | Boyut: ${cols} x ${rows} | Tepe: ${State.world.params.hillCount} | Dere: ${State.world.params.streamCount} | Yol: ${State.world.params.roadCount}`
    );
  }

  function resizeAll() {
    Renderer.resizeCanvas();
    Minimap.resizeMinimap();
  }

  function loop() {
    Input.updateCameraFromKeyboard();
    Renderer.renderWorld();
    Minimap.renderMinimap();
    requestAnimationFrame(loop);
  }

  function normalizeUrl(url) {
    if (!url) return "(bilgi yok)";
    try {
      const parsed = new URL(url, window.location.href);
      const parts = parsed.pathname.split("/");
      return parts[parts.length - 1] || parsed.href;
    } catch (error) {
      return String(url);
    }
  }

  function formatStack(error) {
    if (!error || !error.stack) return "Stack bilgisi yok.";
    return error.stack;
  }

  function buildErrorDetails(message, source, lineno, colno, errorObj, extra) {
    const detailLines = [
      `Mesaj      : ${message || "Bilinmeyen hata"}`,
      `Dosya      : ${normalizeUrl(source)}`,
      `Satır      : ${lineno || 0}`,
      `Sütun      : ${colno || 0}`
    ];

    if (extra) {
      detailLines.push(`Ek Bilgi    : ${extra}`);
    }

    if (errorObj && errorObj.name) {
      detailLines.push(`Hata Tipi   : ${errorObj.name}`);
    }

    detailLines.push("Stack      :");
    detailLines.push(formatStack(errorObj));

    return detailLines.join("\n");
  }

  function registerGlobalErrorHandlers() {
    window.onerror = function (message, source, lineno, colno, errorObj) {
      UI.addLog("HATA: Çalışma zamanı hatası yakalandı.", buildErrorDetails(message, source, lineno, colno, errorObj));
      return false;
    };

    window.addEventListener("error", (event) => {
      if (event.error || event.message) {
        UI.addLog(
          "HATA: Global error event yakalandı.",
          buildErrorDetails(event.message, event.filename, event.lineno, event.colno, event.error)
        );
        return;
      }

      const target = event.target;
      if (target && target !== window) {
        const source = target.src || target.href || target.currentSrc || "(kaynak bilgisi yok)";
        UI.addLog(
          "HATA: Statik kaynak yüklenemedi.",
          buildErrorDetails("Kaynak yükleme hatası", source, 0, 0, null, `Etiket: <${String(target.tagName || "unknown").toLowerCase()}>`)
        );
      }
    }, true);

    window.addEventListener("unhandledrejection", (event) => {
      const reason = event.reason;
      const reasonMessage = reason && reason.message ? reason.message : String(reason);
      UI.addLog(
        "PROMISE HATASI: Yakalanmamış promise rejection.",
        buildErrorDetails(reasonMessage, reason && reason.fileName, reason && reason.lineNumber, reason && reason.columnNumber, reason)
      );
    });
  }

  function init() {
    UI.cacheDom();
    UI.bindUIEvents(handleApplySettings);
    UI.bindChoiceButtons();
    Input.bindInputEvents();
    Minimap.bindMinimapEvents();
    registerGlobalErrorHandlers();

    resizeAll();
    UI.addLog("Uygulama başlatıldı.");
    rebuildWorld(Config.DEFAULT_SEED, Config.DEFAULT_COLS, Config.DEFAULT_ROWS);

    window.addEventListener("resize", () => {
      resizeAll();
      UI.addLog("Pencere yeniden boyutlandırıldı.");
    });

    loop();
  }

  window.addEventListener("DOMContentLoaded", init);
})();
