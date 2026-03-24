/*
  FILE PURPOSE:
  Hold shared mutable runtime state for the whole application.

  DEPENDENCIES:
  - config.js

  PUBLIC API:
  - Game.State

  IMPORTANT RULES:
  - This file should only store state.
  - Do not put rendering logic here.
  - Do not put DOM event bindings here.
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
        col: Math.floor(Config.DEFAULT_COLS / 2)
      },
      seed: Config.DEFAULT_SEED,
      terrain: [],
      params: null
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
      zoomStep: 0.1
    },

    input: {
      keys: new Set()
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

      dialogText: null,

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
    }
  };
})();
