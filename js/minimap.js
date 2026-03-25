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

  function getMinimapLayout() {
    const world = State.world;
    const dom = State.dom;
    const width = dom.minimap.clientWidth;
    const height = dom.minimap.clientHeight;
    const padding = 12;
    const miniTileWidth = Math.max(4, Math.min(14, Math.min((width - padding * 2) / Math.max(4, world.cols + world.rows) * 2, (height - padding * 2) / Math.max(4, world.cols + world.rows) * 4)));
    const metrics = Renderer.getHexMetrics(miniTileWidth);
    return { width, height, miniTileWidth: metrics.tileWidth, miniTileHeight: metrics.tileHeight, originX: width / 2, originY: padding + metrics.halfH, metrics };
  }

  function screenToGridOnMinimap(x, y, layout) {
    const guess = Renderer.screenToGridFloat(x, y, layout.originX, layout.originY, layout.miniTileWidth);
    const baseRow = Math.round(guess.row);
    const baseCol = Math.round(guess.col);
    for (let row = Math.max(0, baseRow - 2); row <= Math.min(State.world.rows - 1, baseRow + 2); row++) {
      for (let col = Math.max(0, baseCol - 2); col <= Math.min(State.world.cols - 1, baseCol + 2); col++) {
        const pos = Renderer.gridToScreen(row, col, layout.originX, layout.originY, layout.miniTileWidth);
        if (Renderer.pointInHex(x, y, pos.x, pos.y, layout.miniTileWidth)) return { row, col };
      }
    }
    return null;
  }

  function drawViewportFrame(layout) {
    const ctx = State.dom.miniCtx;
    const canvas = State.dom.canvas;
    const corners = [
      Renderer.screenToGridFloat(0, 0),
      Renderer.screenToGridFloat(canvas.clientWidth, 0),
      Renderer.screenToGridFloat(canvas.clientWidth, canvas.clientHeight),
      Renderer.screenToGridFloat(0, canvas.clientHeight)
    ].map((p) => Renderer.gridToScreen(p.row, p.col, layout.originX, layout.originY, layout.miniTileWidth));

    ctx.save();
    ctx.strokeStyle = "#ff4d4f";
    ctx.lineWidth = 2;
    ctx.fillStyle = "rgba(255, 77, 79, 0.10)";
    ctx.beginPath();
    ctx.moveTo(corners[0].x, corners[0].y);
    for (let i = 1; i < corners.length; i++) ctx.lineTo(corners[i].x, corners[i].y);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }

  function renderMinimap(force) {
    const dom = State.dom;
    const world = State.world;
    if (!dom.minimap || !dom.miniCtx || !world.terrain.length) return;
    if (!force && !State.render.needsMinimapRedraw) return;

    const layout = getMinimapLayout();
    dom.miniCtx.clearRect(0, 0, layout.width, layout.height);

    for (let row = 0; row < world.rows; row++) {
      for (let col = 0; col < world.cols; col++) {
        const pos = Renderer.gridToScreen(row, col, layout.originX, layout.originY, layout.miniTileWidth);
        Renderer.drawTile(dom.miniCtx, pos.x, pos.y, layout.miniTileWidth, layout.miniTileHeight, Renderer.terrainColor(world.terrain[row][col]));
      }
    }

    drawViewportFrame(layout);

    const playerPos = Renderer.gridToScreen(world.player.row, world.player.col, layout.originX, layout.originY, layout.miniTileWidth);
    dom.miniCtx.beginPath();
    dom.miniCtx.arc(playerPos.x, playerPos.y, Math.max(2, layout.miniTileWidth * 0.12), 0, Math.PI * 2);
    dom.miniCtx.fillStyle = "#f4f7fb";
    dom.miniCtx.fill();
    dom.miniCtx.strokeStyle = "#11151c";
    dom.miniCtx.lineWidth = 1;
    dom.miniCtx.stroke();

    State.render.needsMinimapRedraw = false;
  }

  function bindMinimapEvents() {
    const dom = State.dom;
    dom.minimap.addEventListener("click", (event) => {
      const rect = dom.minimap.getBoundingClientRect();
      const x = event.clientX - rect.left;
      const y = event.clientY - rect.top;
      const picked = screenToGridOnMinimap(x, y, getMinimapLayout());
      if (!picked) return;
      State.world.selected = picked;
      State.world.previewPath = (window.Game.Input && window.Game.Input.buildPathToTarget)
        ? window.Game.Input.buildPathToTarget(picked.row, picked.col)
        : [];
      Renderer.centerCameraOnTile(picked.row, picked.col);
      Renderer.markDirty();
      UI.addLog(`Minimap tıklandı: satır=${picked.row}, sütun=${picked.col}. Kamera ilgili noktaya ortalandı.`);
    });
  }

  window.Game.Minimap = { resizeMinimap, renderMinimap, bindMinimapEvents };
})();
