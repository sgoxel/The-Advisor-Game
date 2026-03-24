/*
  FILE PURPOSE:
  Render and interact with the isometric minimap.

  DEPENDENCIES:
  - state.js
  - renderer.js

  PUBLIC API:
  - Game.Minimap.resizeMinimap
  - Game.Minimap.renderMinimap
  - Game.Minimap.bindMinimapEvents

  IMPORTANT RULES:
  - This file renders the minimap and handles minimap clicks.
*/

window.Game = window.Game || {};

(function () {
  const State = window.Game.State;
  const Renderer = window.Game.Renderer;
  const UI = window.Game.UI;

  function resizeMinimap() {
    const dom = State.dom;
    const dpr = window.devicePixelRatio || 1;

    dom.minimap.width = Math.round(dom.minimap.clientWidth * dpr);
    dom.minimap.height = Math.round(dom.minimap.clientHeight * dpr);
    dom.miniCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function computeMiniTileWidth(width, height, cols, rows) {
    const padding = 16;
    const maxByWidth = ((width - padding) * 2) / (cols + rows);
    const maxByHeight = ((height - padding) * 4) / (cols + rows + 2);
    return Math.max(3, Math.min(maxByWidth, maxByHeight));
  }

  function getMinimapLayout() {
    const world = State.world;
    const dom = State.dom;
    const width = dom.minimap.clientWidth;
    const height = dom.minimap.clientHeight;
    const miniTileWidth = computeMiniTileWidth(width, height, world.cols, world.rows);
    const miniTileHeight = miniTileWidth / 2;
    const totalHeight = (world.cols + world.rows) * miniTileHeight / 2 + miniTileHeight;

    return {
      width,
      height,
      miniTileWidth,
      miniTileHeight,
      originX: width / 2,
      originY: Math.max(8, (height - totalHeight) / 2)
    };
  }

  function pointInDiamond(px, py, cx, cy, tileWidth, tileHeight) {
    const dx = Math.abs(px - cx) / (tileWidth / 2);
    const dy = Math.abs(py - (cy + tileHeight / 2)) / (tileHeight / 2);
    return dx + dy <= 1;
  }

  function screenToGridOnMinimap(x, y, layout) {
    const world = State.world;
    const a = (x - layout.originX) / (layout.miniTileWidth / 2);
    const b = (y - layout.originY) / (layout.miniTileHeight / 2);

    const approxCol = Math.round((a + b) / 2);
    const approxRow = Math.round((b - a) / 2);

    const rowStart = Math.max(0, approxRow - 2);
    const rowEnd = Math.min(world.rows - 1, approxRow + 2);
    const colStart = Math.max(0, approxCol - 2);
    const colEnd = Math.min(world.cols - 1, approxCol + 2);

    for (let row = rowStart; row <= rowEnd; row++) {
      for (let col = colStart; col <= colEnd; col++) {
        const pos = Renderer.gridToScreen(row, col, layout.originX, layout.originY, layout.miniTileWidth, layout.miniTileHeight);
        if (pointInDiamond(x, y, pos.x, pos.y, layout.miniTileWidth, layout.miniTileHeight)) {
          return { row, col };
        }
      }
    }

    if (approxRow >= 0 && approxRow < world.rows && approxCol >= 0 && approxCol < world.cols) {
      return { row: approxRow, col: approxCol };
    }

    return null;
  }

  function screenToWorldGrid(x, y) {
    const world = State.world;
    const camera = State.camera;
    const zoom = camera.zoom || 1;
    const tw = world.tileWidth * zoom;
    const th = world.tileHeight * zoom;
    const a = (x - camera.x) / (tw / 2);
    const b = (y - camera.y) / (th / 2);

    return {
      row: (b - a) / 2,
      col: (a + b) / 2
    };
  }

  function clampGridPoint(point) {
    const world = State.world;
    return {
      row: Math.max(0, Math.min(world.rows - 1, point.row)),
      col: Math.max(0, Math.min(world.cols - 1, point.col))
    };
  }

  function drawViewportFrame(layout) {
    const dom = State.dom;
    const canvas = State.dom.canvas;
    const corners = [
      screenToWorldGrid(0, 0),
      screenToWorldGrid(canvas.clientWidth, 0),
      screenToWorldGrid(canvas.clientWidth, canvas.clientHeight),
      screenToWorldGrid(0, canvas.clientHeight)
    ].map(clampGridPoint).map((p) => ({
      x: Renderer.gridToScreen(p.row, p.col, layout.originX, layout.originY, layout.miniTileWidth, layout.miniTileHeight).x,
      y: Renderer.gridToScreen(p.row, p.col, layout.originX, layout.originY, layout.miniTileWidth, layout.miniTileHeight).y + layout.miniTileHeight / 2
    }));

    const xs = corners.map((p) => p.x);
    const ys = corners.map((p) => p.y);
    const left = Math.min.apply(null, xs);
    const right = Math.max.apply(null, xs);
    const top = Math.min.apply(null, ys);
    const bottom = Math.max.apply(null, ys);

    dom.miniCtx.save();
    dom.miniCtx.strokeStyle = "#ff4d4f";
    dom.miniCtx.lineWidth = 2;
    dom.miniCtx.fillStyle = "rgba(255, 77, 79, 0.10)";
    dom.miniCtx.strokeRect(left, top, Math.max(8, right - left), Math.max(8, bottom - top));
    dom.miniCtx.fillRect(left, top, Math.max(8, right - left), Math.max(8, bottom - top));
    dom.miniCtx.restore();
  }

  function renderMinimap() {
    const dom = State.dom;
    const world = State.world;
    if (!dom.minimap || !dom.miniCtx || !world.terrain.length) return;

    const layout = getMinimapLayout();
    dom.miniCtx.clearRect(0, 0, layout.width, layout.height);

    for (let row = 0; row < world.rows; row++) {
      for (let col = 0; col < world.cols; col++) {
        const tile = world.terrain[row][col];
        const pos = Renderer.gridToScreen(row, col, layout.originX, layout.originY, layout.miniTileWidth, layout.miniTileHeight);

        Renderer.drawTile(
          dom.miniCtx,
          pos.x,
          pos.y,
          layout.miniTileWidth,
          layout.miniTileHeight,
          Renderer.terrainColor(tile)
        );
      }
    }

    drawViewportFrame(layout);

    const playerPos = Renderer.gridToScreen(
      world.player.row,
      world.player.col,
      layout.originX,
      layout.originY,
      layout.miniTileWidth,
      layout.miniTileHeight
    );

    dom.miniCtx.beginPath();
    dom.miniCtx.arc(
      playerPos.x,
      playerPos.y + layout.miniTileHeight / 2,
      Math.max(2, layout.miniTileHeight / 2),
      0,
      Math.PI * 2
    );
    dom.miniCtx.fillStyle = "#f4f7fb";
    dom.miniCtx.fill();
    dom.miniCtx.strokeStyle = "#11151c";
    dom.miniCtx.lineWidth = 1;
    dom.miniCtx.stroke();
  }

  function bindMinimapEvents() {
    const dom = State.dom;
    dom.minimap.addEventListener("click", (event) => {
      const rect = dom.minimap.getBoundingClientRect();
      const x = event.clientX - rect.left;
      const y = event.clientY - rect.top;
      const layout = getMinimapLayout();
      const picked = screenToGridOnMinimap(x, y, layout);

      if (!picked) return;

      Renderer.centerCameraOnTile(picked.row, picked.col);
      State.world.selected = picked;
      UI.addLog(`Minimap tıklandı: satır=${picked.row}, sütun=${picked.col}. Kamera ilgili noktaya ortalandı.`);
    });
  }

  window.Game.Minimap = {
    resizeMinimap,
    renderMinimap,
    bindMinimapEvents
  };
})();
