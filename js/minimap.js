/*
  FILE PURPOSE:
  Render and interact with the hex minimap.
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
    Renderer.markDirty(false, true);
  }

  function computeMiniHexWidth(width, height, cols, rows) {
    const padding = 16;
    const byWidth = (width - padding * 2) / (cols + 1.5);
    const byHeight = (height - padding * 2) / (((rows - 1) * (1.5 / Math.sqrt(3))) + (2 / Math.sqrt(3)));
    return Math.max(4, Math.min(byWidth, byHeight));
  }

  function getMinimapLayout() {
    const world = State.world;
    const dom = State.dom;
    const width = dom.minimap.clientWidth;
    const height = dom.minimap.clientHeight;
    const miniHexWidth = computeMiniHexWidth(width, height, world.cols, world.rows);
    const miniMetrics = Renderer.getHexMetrics(miniHexWidth);
    const totalWidth = world.cols * miniMetrics.hexWidth + miniMetrics.hexWidth * 1.5;
    const totalHeight = (world.rows - 1) * miniMetrics.rowStep + miniMetrics.hexHeight;

    return {
      width,
      height,
      miniHexWidth: miniMetrics.hexWidth,
      miniHexHeight: miniMetrics.hexHeight,
      originX: (width - totalWidth) / 2,
      originY: (height - totalHeight) / 2,
      metrics: miniMetrics
    };
  }

  function screenToGridOnMinimap(x, y, layout) {
    const world = State.world;
    const approxRow = Math.round((y - layout.originY - layout.metrics.size) / layout.metrics.rowStep);
    const rowStart = Math.max(0, approxRow - 2);
    const rowEnd = Math.min(world.rows - 1, approxRow + 2);

    for (let row = rowStart; row <= rowEnd; row++) {
      const rowOffset = (row & 1) ? layout.metrics.hexWidth / 2 : 0;
      const approxCol = Math.round((x - layout.originX - layout.metrics.hexWidth / 2 - rowOffset) / layout.metrics.hexWidth);
      const colStart = Math.max(0, approxCol - 2);
      const colEnd = Math.min(world.cols - 1, approxCol + 2);

      for (let col = colStart; col <= colEnd; col++) {
        const pos = Renderer.gridToScreen(row, col, layout.originX, layout.originY, layout.miniHexWidth);
        if (Renderer.pointInHex(x, y, pos.x, pos.y, layout.miniHexWidth)) {
          return { row, col };
        }
      }
    }

    return null;
  }

  function drawViewportFrame(layout) {
    const dom = State.dom;
    const canvas = dom.canvas;
    const camera = State.camera;
    const mainMetrics = Renderer.getHexMetrics();

    const worldLeft = -camera.x;
    const worldTop = -camera.y;
    const worldRight = worldLeft + canvas.clientWidth;
    const worldBottom = worldTop + canvas.clientHeight;

    const scaleX = layout.miniHexWidth / mainMetrics.hexWidth;
    const scaleY = layout.metrics.rowStep / mainMetrics.rowStep;

    const left = layout.originX + worldLeft * scaleX;
    const top = layout.originY + worldTop * scaleY;
    const width = Math.max(8, (worldRight - worldLeft) * scaleX);
    const height = Math.max(8, (worldBottom - worldTop) * scaleY);

    dom.miniCtx.save();
    dom.miniCtx.strokeStyle = "#ff4d4f";
    dom.miniCtx.lineWidth = 2;
    dom.miniCtx.fillStyle = "rgba(255, 77, 79, 0.10)";
    dom.miniCtx.strokeRect(left, top, width, height);
    dom.miniCtx.fillRect(left, top, width, height);
    dom.miniCtx.restore();
  }

  function renderMinimap(force) {
    const dom = State.dom;
    const world = State.world;
    const render = State.render;
    if (!dom.minimap || !dom.miniCtx || !world.terrain.length) return;
    if (!force && !render.needsMinimapRedraw) return;

    const layout = getMinimapLayout();
    dom.miniCtx.clearRect(0, 0, layout.width, layout.height);

    for (let row = 0; row < world.rows; row++) {
      for (let col = 0; col < world.cols; col++) {
        const tile = world.terrain[row][col];
        const pos = Renderer.gridToScreen(row, col, layout.originX, layout.originY, layout.miniHexWidth);
        Renderer.drawTile(dom.miniCtx, pos.x, pos.y, layout.miniHexWidth, layout.miniHexHeight, Renderer.terrainColor(tile));
      }
    }

    drawViewportFrame(layout);

    const playerPos = Renderer.gridToScreen(world.player.row, world.player.col, layout.originX, layout.originY, layout.miniHexWidth);
    dom.miniCtx.beginPath();
    dom.miniCtx.arc(playerPos.x, playerPos.y, Math.max(2, layout.miniHexWidth * 0.12), 0, Math.PI * 2);
    dom.miniCtx.fillStyle = "#f4f7fb";
    dom.miniCtx.fill();
    dom.miniCtx.strokeStyle = "#11151c";
    dom.miniCtx.lineWidth = 1;
    dom.miniCtx.stroke();

    render.needsMinimapRedraw = false;
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
      Renderer.markDirty();
      UI.addLog(`Minimap tıklandı: satır=${picked.row}, sütun=${picked.col}. Kamera ilgili noktaya ortalandı.`);
    });
  }

  window.Game.Minimap = {
    resizeMinimap,
    renderMinimap,
    bindMinimapEvents
  };
})();
