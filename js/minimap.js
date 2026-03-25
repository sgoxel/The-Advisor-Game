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

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function getMinimapLayout() {
    const world = State.world;
    const dom = State.dom;
    const width = dom.minimap.clientWidth;
    const height = dom.minimap.clientHeight;
    const padding = Math.max(8, Math.min(16, Math.floor(Math.min(width, height) * 0.08)));
    const tileSize = Math.max(2, Math.min((width - padding * 2) / Math.max(1, world.cols), (height - padding * 2) / Math.max(1, world.rows)));
    const mapWidth = world.cols * tileSize;
    const mapHeight = world.rows * tileSize;
    const originX = (width - mapWidth) / 2;
    const originY = (height - mapHeight) / 2;
    return {
      width,
      height,
      originX,
      originY,
      miniTileWidth: tileSize,
      miniTileHeight: tileSize,
      mapWidth,
      mapHeight
    };
  }

  function gridToMinimap(row, col, layout) {
    return {
      x: layout.originX + (col + 0.5) * layout.miniTileWidth,
      y: layout.originY + (row + 0.5) * layout.miniTileHeight
    };
  }

  function worldToMinimap(worldX, worldZ, layout) {
    const tileWidth = State.world.tileWidth || 1;
    const tileHeight = tileWidth;
    const col = worldX / tileWidth - 0.5;
    const row = worldZ / tileHeight - 0.5;
    return {
      x: layout.originX + (col + 0.5) * layout.miniTileWidth,
      y: layout.originY + (row + 0.5) * layout.miniTileHeight
    };
  }

  function screenToGridOnMinimap(x, y, layout) {
    const col = Math.floor((x - layout.originX) / layout.miniTileWidth);
    const row = Math.floor((y - layout.originY) / layout.miniTileHeight);
    if (row < 0 || col < 0 || row >= State.world.rows || col >= State.world.cols) return null;
    return { row, col };
  }

  function drawViewportFrame(layout) {
    const ctx = State.dom.miniCtx;
    const canvas = State.dom.canvas;
    const worldCorners = [
      Renderer.screenToGridFloat(0, 0),
      Renderer.screenToGridFloat(canvas.clientWidth, 0),
      Renderer.screenToGridFloat(canvas.clientWidth, canvas.clientHeight),
      Renderer.screenToGridFloat(0, canvas.clientHeight)
    ];

    const corners = worldCorners.map((p) => {
      const clampedRow = clamp(p.row, 0, State.world.rows - 1);
      const clampedCol = clamp(p.col, 0, State.world.cols - 1);
      return {
        x: layout.originX + (clampedCol + 0.5) * layout.miniTileWidth,
        y: layout.originY + (clampedRow + 0.5) * layout.miniTileHeight
      };
    });

    ctx.save();
    ctx.strokeStyle = '#ff4d4f';
    ctx.lineWidth = 2;
    ctx.fillStyle = 'rgba(255, 77, 79, 0.10)';
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
    const ctx = dom.miniCtx;
    ctx.clearRect(0, 0, layout.width, layout.height);

    for (let row = 0; row < world.rows; row++) {
      for (let col = 0; col < world.cols; col++) {
        const x = layout.originX + col * layout.miniTileWidth;
        const y = layout.originY + row * layout.miniTileHeight;
        ctx.fillStyle = Renderer.terrainColor(world.terrain[row][col]);
        ctx.fillRect(x, y, layout.miniTileWidth + 0.5, layout.miniTileHeight + 0.5);
      }
    }

    drawViewportFrame(layout);

    const playerPos = gridToMinimap(world.player.row, world.player.col, layout);
    ctx.beginPath();
    ctx.arc(playerPos.x, playerPos.y, Math.max(2, layout.miniTileWidth * 0.35), 0, Math.PI * 2);
    ctx.fillStyle = '#f4f7fb';
    ctx.fill();
    ctx.strokeStyle = '#11151c';
    ctx.lineWidth = 1;
    ctx.stroke();

    State.render.needsMinimapRedraw = false;
  }

  function bindMinimapEvents() {
    const dom = State.dom;
    dom.minimap.addEventListener('click', (event) => {
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
