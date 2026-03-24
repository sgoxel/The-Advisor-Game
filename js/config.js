/*
  FILE PURPOSE:
  Central place for application constants and limits.

  DEPENDENCIES:
  - none

  PUBLIC API:
  - Game.Config

  IMPORTANT RULES:
  - Do not put runtime mutable state here.
  - Do not put DOM access here.
*/

window.Game = window.Game || {};

window.Game.Config = {
  DEFAULT_SEED: "ISOMETRIK_HARITA_24032026",
  DEFAULT_COLS: 80,
  DEFAULT_ROWS: 80,

  MIN_MAP_SIZE: 12,
  MAX_MAP_SIZE: 80,

  TILE_WIDTH: 76,
  TILE_HEIGHT: 38,

  CAMERA_MOVE_SPEED: 18
};