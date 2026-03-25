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
    const isPortraitMobile = window.innerWidth <= 960 && window.innerHeight > window.innerWidth;
    const padding = isPortraitMobile
      ? Math.max(3, Math.min(8, Math.floor(Math.min(width, height) * 0.03)))
      : Math.max(10, Math.min(18, Math.floor(Math.min(width, height) * 0.06)));

    const maxTileFromWidth = Math.max(3, (width - padding * 2) / Math.max(1, world.cols));

    const probeMetrics = Renderer.getHexMetrics(10);
    const tileRatio = probeMetrics.tileHeight / probeMetrics.tileWidth;
    const maxTileFromHeight = Math.max(3, (height - padding * 2) / Math.max(1, world.rows * tileRatio));

    const fillFactor = isPortraitMobile ? 0.98 : 0.88;
    const miniTileWidth = Math.max(3, Math.min(12, Math.min(maxTileFromWidth, maxTileFromHeight) * fillFactor));
    const metrics = Renderer.getHexMetrics(miniTileWidth);

    const cornerCenters = [
      Renderer.gridToScreen(0, 0, 0, 0, metrics.tileWidth),
      Renderer.gridToScreen(0, world.cols - 1, 0, 0, metrics.tileWidth),
      Renderer.gridToScreen(world.rows - 1, 0, 0, 0, metrics.tileWidth),
      Renderer.gridToScreen(world.rows - 1, world.cols - 1, 0, 0, metrics.tileWidth)
    ];

    const minX = Math.min(...cornerCenters.map((p) => p.x - metrics.halfW));
    const maxX = Math.max(...cornerCenters.map((p) => p.x + metrics.halfW));
    const minY = Math.min(...cornerCenters.map((p) => p.y - metrics.halfH));
    const maxY = Math.max(...cornerCenters.map((p) => p.y + metrics.halfH));

    const worldPixelWidth = maxX - minX;
    const worldPixelHeight = maxY - minY;
    const originX = ((width - worldPixelWidth) / 2) - minX;
    const originY = ((height - worldPixelHeight) / 2) - minY;

    return {
      width,
      height,
      miniTileWidth: metrics.tileWidth,
      miniTileHeight: metrics.tileHeight,
      originX,
      originY,
      metrics
    };
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
      Renderer.centerCameraOnTile(picked.row, picked.col);
      Renderer.markDirty();
      UI.addLog(`Minimap tıklandı: satır=${picked.row}, sütun=${picked.col}. Kamera ilgili noktaya ortalandı.`);
    });
  }

  window.Game.Minimap = { resizeMinimap, renderMinimap, bindMinimapEvents };
})();
