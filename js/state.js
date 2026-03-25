/*
  FILE PURPOSE:
  Hold shared mutable runtime state for the whole application.
*/

window.Game = window.Game || {};

(function () {
  const Config = window.Game.Config;

  window.Game.State = {
    world: {
      rows: Config.DEFAULT_ROWS,
      cols: Config.DEFAULT_COLS,
      tileWidth: Config.TILE_WIDTH,
      tileHeight: Config.TILE_HEIGHT,
      selected: null,
      hover: null,
      player: {
        row: Math.floor(Config.DEFAULT_ROWS / 2),
        col: Math.floor(Config.DEFAULT_COLS / 2),
        moving: false,
        startRow: Math.floor(Config.DEFAULT_ROWS / 2),
        startCol: Math.floor(Config.DEFAULT_COLS / 2),
        targetRow: Math.floor(Config.DEFAULT_ROWS / 2),
        targetCol: Math.floor(Config.DEFAULT_COLS / 2),
        moveStartTime: 0,
        moveDuration: 180,
        progress: 1,
        direction: 's',
        pathQueue: []
      },
      seed: Config.DEFAULT_SEED,
      terrain: [],
      params: null,
      previewPath: []
    },

    camera: {
      x: 0,
      y: 0,
      moveSpeed: Config.CAMERA_MOVE_SPEED,
      dragActive: false,
      lastX: 0,
      lastY: 0,
      movedWhileDragging: false,
      zoom: 1,
      minZoom: 0.6,
      maxZoom: 2.2,
      zoomStep: 0.1,
      followPlayer: true,
      pitchAngle: Config.DEFAULT_CAMERA_PITCH,
      depthStrength: Config.DEFAULT_DEPTH_STRENGTH
    },

    input: {
      keys: new Set(),
      lastTileClick: null,
      lastTileClickTime: 0,
      doubleClickThresholdMs: 500,
      mouseX: 0,
      mouseY: 0
    },

    dom: {
      canvas: null,
      gl: null,
      minimap: null,
      miniCtx: null,

      settingsModal: null,
      settingsBtn: null,
      applySettingsBtn: null,
      cancelSettingsBtn: null,

      logModal: null,
      logBtn: null,
      closeLogBtn: null,
      logText: null,

      seedInput: null,
      mapWidthInput: null,
      mapHeightInput: null,
      cameraPitchInput: null,
      depthStrengthInput: null,

      dialogText: null,
      languageSelect: null,

      top: {
        goldValue: null,
        healthText: null,
        staminaText: null,
        manaText: null,
        healthBar: null,
        staminaBar: null,
        manaBar: null
      },

      params: {}
    },


    visual: {
      noiseDensity: 6,
      noiseSize: 6,
      noiseOpacity: 0.72,
      colorVariance: 18,
      accentStrength: 35,
      transitionBlend: 45,
      saturation: 1.0,
      contrast: 1.0
    },

    render: {
      program: null,
      positionBuffer: null,
      colorLocation: null,
      positionLocation: null,
      resolutionLocation: null,
      clearColor: [18 / 255, 25 / 255, 32 / 255, 1],
      needsWorldRedraw: true,
      needsMinimapRedraw: true
    },

    log: {
      lines: [],
      maxLines: 500
    },

    i18n: {
      current: 'en',
      messages: {}
    }
  };
})();
