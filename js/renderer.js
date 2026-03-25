/*
  FILE PURPOSE:
  Render the rotated-square (45°) game world with WebGL.
*/

window.Game = window.Game || {};

(function () {
  const State = window.Game.State;
  const Config = window.Game.Config;

  const VERTEX_SHADER_SOURCE = `
    attribute vec2 a_position;
    uniform vec2 u_resolution;
    void main() {
      vec2 zeroToOne = a_position / u_resolution;
      vec2 zeroToTwo = zeroToOne * 2.0;
      vec2 clipSpace = zeroToTwo - 1.0;
      gl_Position = vec4(clipSpace * vec2(1.0, -1.0), 0.0, 1.0);
    }
  `;

  const FRAGMENT_SHADER_SOURCE = `
    precision mediump float;
    uniform vec4 u_color;
    void main() { gl_FragColor = u_color; }
  `;

  function markDirty(worldDirty, minimapDirty) {
    if (worldDirty !== false) State.render.needsWorldRedraw = true;
    if (minimapDirty !== false) State.render.needsMinimapRedraw = true;
  }

  function createShader(gl, type, source) {
    const shader = gl.createShader(gl[type]);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      throw new Error(`Shader compile error: ${gl.getShaderInfoLog(shader)}`);
    }
    return shader;
  }

  function createProgram(gl, vertexSource, fragmentSource) {
    const vs = createShader(gl, 'VERTEX_SHADER', vertexSource);
    const fs = createShader(gl, 'FRAGMENT_SHADER', fragmentSource);
    const program = gl.createProgram();
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      throw new Error(`Program link error: ${gl.getProgramInfoLog(program)}`);
    }
    return program;
  }

  function initializeWebGLResources() {
    const gl = State.dom.gl;
    const render = State.render;
    if (!gl) return;
    if (render.program) return;

    const program = createProgram(gl, VERTEX_SHADER_SOURCE, FRAGMENT_SHADER_SOURCE);

    render.program = program;
    render.positionBuffer = gl.createBuffer();
    render.positionLocation = gl.getAttribLocation(program, 'a_position');
    render.resolutionLocation = gl.getUniformLocation(program, 'u_resolution');
    render.colorLocation = gl.getUniformLocation(program, 'u_color');

    gl.useProgram(program);
    gl.bindBuffer(gl.ARRAY_BUFFER, render.positionBuffer);
    gl.enableVertexAttribArray(render.positionLocation);
    gl.vertexAttribPointer(render.positionLocation, 2, gl.FLOAT, false, 0, 0);
    gl.disable(gl.DEPTH_TEST);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
  }

  function getIsoMetrics(scaleWidth) {
    const camera = State.camera;
    const zoom = camera.zoom || 1;
    const tileWidth = scaleWidth || State.world.tileWidth * zoom;
    const angleRad = (camera.pitchAngle || Config.DEFAULT_CAMERA_PITCH) * Math.PI / 180;
    const baseRatio = Math.sin(angleRad);
    const ratio = Math.max(0.38, Math.min(1.0, baseRatio * (camera.depthStrength || 1)));
    const tileHeight = tileWidth * ratio;
    return { tileWidth, tileHeight, halfW: tileWidth / 2, halfH: tileHeight / 2, ratio };
  }

  function gridToScreen(row, col, offsetX, offsetY, tileWidth) {
    const metrics = getIsoMetrics(tileWidth);
    const localX = (col - row) * metrics.halfW;
    const localY = (col + row) * metrics.halfH;
    const xBase = offsetX !== undefined ? offsetX : State.camera.x;
    const yBase = offsetY !== undefined ? offsetY : State.camera.y;
    return { x: xBase + localX, y: yBase + localY };
  }

  function screenToGridFloat(x, y, offsetX, offsetY, tileWidth) {
    const metrics = getIsoMetrics(tileWidth);
    const xBase = offsetX !== undefined ? offsetX : State.camera.x;
    const yBase = offsetY !== undefined ? offsetY : State.camera.y;
    const lx = x - xBase;
    const ly = y - yBase;
    const col = (lx / metrics.halfW + ly / metrics.halfH) / 2;
    const row = (ly / metrics.halfH - lx / metrics.halfW) / 2;
    return { row, col };
  }

  function pointInDiamond(px, py, cx, cy, tileWidth) {
    const metrics = getIsoMetrics(tileWidth);
    return (Math.abs(px - cx) / metrics.halfW) + (Math.abs(py - cy) / metrics.halfH) <= 1;
  }

  function centerCameraOnWorld(x, y) {
    const canvas = State.dom.canvas;
    const nextX = canvas.clientWidth / 2 - x;
    const nextY = canvas.clientHeight / 2 - y;
    if (Math.abs(State.camera.x - nextX) > 0.01 || Math.abs(State.camera.y - nextY) > 0.01) {
      State.camera.x = nextX;
      State.camera.y = nextY;
      markDirty();
    }
  }

  function getPlayerWorldPosition() {
    const player = State.world.player;
    if (!player) return { x: 0, y: 0 };
    if (!player.moving) return gridToScreen(player.row, player.col, 0, 0);

    const start = gridToScreen(player.startRow, player.startCol, 0, 0);
    const end = gridToScreen(player.targetRow, player.targetCol, 0, 0);
    const t = Math.max(0, Math.min(1, player.progress || 0));

    return {
      x: start.x + (end.x - start.x) * t,
      y: start.y + (end.y - start.y) * t
    };
  }

  function centerCameraOnTile(row, col) {
    const pos = gridToScreen(row, col, 0, 0);
    centerCameraOnWorld(pos.x, pos.y);
  }

  function centerCamera() {
    const p = getPlayerWorldPosition();
    centerCameraOnWorld(p.x, p.y);
  }

  function calculateFitZoom(paddingRatio) {
    const canvas = State.dom.canvas;
    const world = State.world;
    if (!canvas || !canvas.clientWidth || !canvas.clientHeight || !world.rows || !world.cols) return 1;

    const padding = Math.max(24, Math.min(canvas.clientWidth, canvas.clientHeight) * (paddingRatio || 0.08));
    const availableWidth = Math.max(1, canvas.clientWidth - padding * 2);
    const availableHeight = Math.max(1, canvas.clientHeight - padding * 2);

    const angleRad = (State.camera.pitchAngle || Config.DEFAULT_CAMERA_PITCH) * Math.PI / 180;
    const baseRatio = Math.sin(angleRad);
    const ratio = Math.max(0.38, Math.min(1.0, baseRatio * (State.camera.depthStrength || 1)));

    const widthZoom = availableWidth / Math.max(1, (world.cols + world.rows) * 0.5 * world.tileWidth);
    const heightZoom = availableHeight / Math.max(1, (world.cols + world.rows) * 0.5 * world.tileWidth * ratio);

    return Math.max(0.08, Math.min(widthZoom, heightZoom));
  }

  function updateZoomLimits() {
    const fitZoom = Number(calculateFitZoom(0.06).toFixed(3));
    const camera = State.camera;
    camera.minZoom = Math.min(1, fitZoom);
    if (camera.maxZoom <= camera.minZoom) {
      camera.maxZoom = Math.max(camera.minZoom + 0.5, 2.2);
    }
    if (camera.zoom < camera.minZoom) camera.zoom = camera.minZoom;
  }

  function fitCameraToWorld() {
    updateZoomLimits();
    State.camera.zoom = Math.max(State.camera.minZoom, Math.min(Config.DEFAULT_START_ZOOM || 0.8, State.camera.maxZoom));
    centerCamera();
    markDirty();
  }

  function updateCameraFollow() {
    if (State.camera.followPlayer && State.world.player && State.world.player.moving) {
      centerCamera();
    }
  }

  function resizeCanvas() {
    const dom = State.dom;
    const canvas = dom.canvas;
    if (!canvas) return;

    if (!dom.gl) {
      dom.gl = canvas.getContext('webgl', { antialias: true, alpha: true })
        || canvas.getContext('experimental-webgl', { antialias: true, alpha: true });
      if (!dom.gl) {
        throw new Error('WebGL context could not be created.');
      }
    }

    const gl = dom.gl;
    const dpr = window.devicePixelRatio || 1;
    const displayWidth = Math.round(canvas.clientWidth * dpr);
    const displayHeight = Math.round(canvas.clientHeight * dpr);

    if (canvas.width !== displayWidth || canvas.height !== displayHeight) {
      canvas.width = displayWidth;
      canvas.height = displayHeight;
    }

    initializeWebGLResources();
    gl.viewport(0, 0, canvas.width, canvas.height);
    updateZoomLimits();
    centerCamera();
    markDirty();
  }

  function terrainColor(tile) {
    if (tile && tile.visual && tile.visual.base) {
      const base = tile.visual.base;
      return `rgb(${base[0]}, ${base[1]}, ${base[2]})`;
    }

    switch (tile.type) {
      case 'grass': return '#5a9b5f';
      case 'grass2': return '#6aaa6c';
      case 'dirt': return '#a57b4e';
      case 'dirtHill': return '#9a7348';
      case 'stone': return '#8f949d';
      case 'hillStone': return '#8a8e96';
      case 'hillGrass': return '#6b965e';
      case 'water': return '#4b79b4';
      case 'road': return '#b99b68';
      case 'forest': return '#3f7345';
      case 'forestHill': return '#43684a';
      case 'settlement': return '#b8b2a0';
      default: return '#5a9b5f';
    }
  }

  function colorStringToRgba(color, alpha) {
    if (!color) return [0, 0, 0, alpha === undefined ? 1 : alpha];

    if (color.startsWith('#')) {
      const cleaned = color.replace('#', '');
      const value = parseInt(cleaned, 16);
      return [((value >> 16) & 255) / 255, ((value >> 8) & 255) / 255, (value & 255) / 255, alpha === undefined ? 1 : alpha];
    }

    const match = color.match(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/i);
    if (match) {
      return [Number(match[1]) / 255, Number(match[2]) / 255, Number(match[3]) / 255, alpha === undefined ? 1 : alpha];
    }

    return [0, 0, 0, alpha === undefined ? 1 : alpha];
  }

  function darkenRgb(rgb, factor) {
    return [
      Math.max(0, Math.round((rgb[0] || 0) * factor)),
      Math.max(0, Math.round((rgb[1] || 0) * factor)),
      Math.max(0, Math.round((rgb[2] || 0) * factor))
    ];
  }

  function rgbaFromRgb(rgb, alpha) {
    return [
      (rgb[0] || 0) / 255,
      (rgb[1] || 0) / 255,
      (rgb[2] || 0) / 255,
      alpha === undefined ? 1 : alpha
    ];
  }

  function setCustomColor(gl, rgba) {
    gl.uniform4f(State.render.colorLocation, rgba[0], rgba[1], rgba[2], rgba[3]);
  }

  function drawTriangles(gl, vertices, rgba) {
    gl.bindBuffer(gl.ARRAY_BUFFER, State.render.positionBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(vertices), gl.STREAM_DRAW);
    setCustomColor(gl, rgba);
    gl.drawArrays(gl.TRIANGLES, 0, vertices.length / 2);
  }

  function drawLineLoop(gl, vertices, rgba) {
    gl.bindBuffer(gl.ARRAY_BUFFER, State.render.positionBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(vertices), gl.STREAM_DRAW);
    setCustomColor(gl, rgba);
    gl.drawArrays(gl.LINE_LOOP, 0, vertices.length / 2);
  }

  function drawQuad(gl, a, b, c, d, rgba) {
    drawTriangles(gl, [
      a.x, a.y,
      b.x, b.y,
      c.x, c.y,
      a.x, a.y,
      c.x, c.y,
      d.x, d.y
    ], rgba);
  }

  function drawEllipse(gl, cx, cy, radiusX, radiusY, rgba, segments) {
    const count = Math.max(12, segments || 24);
    const vertices = [];
    for (let i = 0; i < count; i++) {
      const a0 = (i / count) * Math.PI * 2;
      const a1 = ((i + 1) / count) * Math.PI * 2;
      vertices.push(
        cx, cy,
        cx + Math.cos(a0) * radiusX, cy + Math.sin(a0) * radiusY,
        cx + Math.cos(a1) * radiusX, cy + Math.sin(a1) * radiusY
      );
    }
    drawTriangles(gl, vertices, rgba);
  }

  function drawCapsule(gl, x1, y1, x2, y2, radius, rgba) {
    const dx = x2 - x1;
    const dy = y2 - y1;
    const length = Math.hypot(dx, dy);
    if (length < 0.0001) {
      drawEllipse(gl, x1, y1, radius, radius, rgba, 20);
      return;
    }

    const nx = -dy / length;
    const ny = dx / length;

    drawTriangles(gl, [
      x1 + nx * radius, y1 + ny * radius,
      x1 - nx * radius, y1 - ny * radius,
      x2 + nx * radius, y2 + ny * radius,
      x2 + nx * radius, y2 + ny * radius,
      x1 - nx * radius, y1 - ny * radius,
      x2 - nx * radius, y2 - ny * radius
    ], rgba);

    drawEllipse(gl, x1, y1, radius, radius, rgba, 20);
    drawEllipse(gl, x2, y2, radius, radius, rgba, 20);
  }

  function getDiamondOutlineVertices(cx, cy, tileWidth, tileHeight) {
    const halfW = tileWidth / 2;
    const halfH = tileHeight / 2;
    return [cx, cy - halfH, cx + halfW, cy, cx, cy + halfH, cx - halfW, cy];
  }

  function getDiamondTriangleVertices(cx, cy, tileWidth, tileHeight) {
    const outline = getDiamondOutlineVertices(cx, cy, tileWidth, tileHeight);
    return {
      triangles: [
        cx, cy, outline[0], outline[1], outline[2], outline[3],
        cx, cy, outline[2], outline[3], outline[4], outline[5],
        cx, cy, outline[4], outline[5], outline[6], outline[7],
        cx, cy, outline[6], outline[7], outline[0], outline[1]
      ],
      outline
    };
  }

  function getTileBaseHeightSteps(tile) {
    if (!tile) return 0;

    switch (tile.type) {
      case 'water': return -1;
      case 'road': return 0;
      case 'settlement': return 1;
      case 'grass':
      case 'grass2':
      case 'dirt': return 1;
      case 'forest': return 2;
      case 'hillGrass':
      case 'dirtHill': return 3;
      case 'forestHill': return 4;
      case 'hillStone':
      case 'stone': return 5;
      default: return 1;
    }
  }

  function getTileHeightSteps(tile) {
    const base = getTileBaseHeightSteps(tile);
    const extra = Math.max(0, tile && tile.elevation ? tile.elevation : 0);

    if (tile && (tile.type === 'hillGrass'
      || tile.type === 'dirtHill'
      || tile.type === 'forestHill'
      || tile.type === 'hillStone'
      || (tile.tags && tile.tags.has('hill')))) {
      return Math.max(base, base + Math.round(extra * 1.4));
    }

    return base;
  }

  function getTileElevationPx(tile, tileHeight) {
    const steps = getTileHeightSteps(tile);
    return Math.round(steps * tileHeight * 0.22);
  }

  function getElevatedTilePosition(pos, tile, tileHeight) {
    return {
      x: pos.x,
      y: pos.y - getTileElevationPx(tile, tileHeight)
    };
  }

  function getNeighborTileHeightPx(row, col, dRow, dCol, tileHeight) {
    const nrow = row + dRow;
    const ncol = col + dCol;
    if (nrow < 0 || ncol < 0 || nrow >= State.world.rows || ncol >= State.world.cols) {
      return 0;
    }
    const tile = State.world.terrain[nrow] && State.world.terrain[nrow][ncol];
    return getTileElevationPx(tile, tileHeight);
  }

  function getVisibleSideDrops(row, col, tile, tileHeight) {
    const currentHeight = getTileElevationPx(tile, tileHeight);
    const leftNeighborHeight = getNeighborTileHeightPx(row, col, 1, 0, tileHeight);
    const rightNeighborHeight = getNeighborTileHeightPx(row, col, 0, 1, tileHeight);
    return {
      leftDrop: Math.max(0, currentHeight - leftNeighborHeight),
      rightDrop: Math.max(0, currentHeight - rightNeighborHeight)
    };
  }

  function lerpPoint(a, b, t) {
    return {
      x: a.x + (b.x - a.x) * t,
      y: a.y + (b.y - a.y) * t
    };
  }

  function sampleVisualColor(tile, u, v, fallbackRgb) {
    if (!tile || !tile.visual || !tile.visual.cells || !tile.visual.gridSize) return fallbackRgb;
    const size = tile.visual.gridSize;
    const gx = Math.max(0, Math.min(size - 1, Math.round(u * (size - 1))));
    const gy = Math.max(0, Math.min(size - 1, Math.round(v * (size - 1))));
    const idx = gy * size + gx;
    return tile.visual.cells[idx] || fallbackRgb;
  }

  function drawSlopeFace(gl, upperA, upperB, lowerB, lowerA, tile, side, baseRgb) {
    const slices = Math.max(5, Math.min(12, tile && tile.visual && tile.visual.gridSize ? tile.visual.gridSize : 8));
    for (let i = 0; i < slices; i++) {
      const t0 = i / slices;
      const t1 = (i + 1) / slices;
      const ua = lerpPoint(upperA, upperB, t0);
      const ub = lerpPoint(upperA, upperB, t1);
      const la = lerpPoint(lowerA, lowerB, t0);
      const lb = lerpPoint(lowerA, lowerB, t1);

      let rgb;
      if (side === 'left') {
        rgb = sampleVisualColor(tile, 0.18 + t0 * 0.22, 0.55 + t0 * 0.35, baseRgb);
      } else {
        rgb = sampleVisualColor(tile, 0.62 + t0 * 0.22, 0.55 + t0 * 0.35, baseRgb);
      }

      const shade = side === 'left'
        ? (0.88 - t0 * 0.20)
        : (0.80 - t0 * 0.22);
      const shaded = darkenRgb(rgb, shade);
      drawQuad(gl, ua, ub, lb, la, rgbaFromRgb(shaded, 1));
    }
  }

  function drawNoisePatches(gl, pos, tile, tileWidth, tileHeight) {
    if (!tile || !tile.visual || !tile.visual.cells || tile.visual.gridSize <= 1) return;

    const halfW = tileWidth / 2;
    const halfH = tileHeight / 2;
    const top = { x: pos.x, y: pos.y - halfH };
    const right = { x: pos.x + halfW, y: pos.y };
    const left = { x: pos.x - halfW, y: pos.y };
    const gridSize = tile.visual.gridSize;

    function mapPoint(u, v) {
      return {
        x: top.x + (right.x - top.x) * u + (left.x - top.x) * v,
        y: top.y + (right.y - top.y) * u + (left.y - top.y) * v
      };
    }

    for (let gy = 0; gy < gridSize; gy++) {
      for (let gx = 0; gx < gridSize; gx++) {
        const idx = gy * gridSize + gx;
        const rgb = tile.visual.cells[idx];
        if (!rgb) continue;

        const u0 = gx / gridSize;
        const v0 = gy / gridSize;
        const u1 = (gx + 1) / gridSize;
        const v1 = (gy + 1) / gridSize;
        const p00 = mapPoint(u0, v0);
        const p10 = mapPoint(u1, v0);
        const p11 = mapPoint(u1, v1);
        const p01 = mapPoint(u0, v1);

        drawTriangles(gl, [
          p00.x, p00.y,
          p10.x, p10.y,
          p11.x, p11.y,
          p00.x, p00.y,
          p11.x, p11.y,
          p01.x, p01.y
        ], [rgb[0] / 255, rgb[1] / 255, rgb[2] / 255, 1]);
      }
    }
  }

  function drawTileWebGL(gl, row, col, pos, color, tile, tileWidth, tileHeight, highlight) {
    const topPos = getElevatedTilePosition(pos, tile, tileHeight);
    const topOutline = getDiamondOutlineVertices(topPos.x, topPos.y, tileWidth, tileHeight);
    const topTriangles = getDiamondTriangleVertices(topPos.x, topPos.y, tileWidth, tileHeight);

    const baseRgb = (tile && tile.visual && tile.visual.base)
      ? tile.visual.base
      : (() => {
          const rgba = colorStringToRgba(color, 1);
          return [Math.round(rgba[0] * 255), Math.round(rgba[1] * 255), Math.round(rgba[2] * 255)];
        })();

    const drops = getVisibleSideDrops(row, col, tile, tileHeight);
    const L = { x: topOutline[6], y: topOutline[7] };
    const R = { x: topOutline[2], y: topOutline[3] };
    const B = { x: topOutline[4], y: topOutline[5] };

    if (drops.leftDrop > 0) {
      const lowerL = { x: L.x, y: L.y + drops.leftDrop };
      const lowerB = { x: B.x, y: B.y + drops.leftDrop };
      drawSlopeFace(gl, L, B, lowerB, lowerL, tile, 'left', baseRgb);
      drawLineLoop(gl, [L.x, L.y, B.x, B.y, lowerB.x, lowerB.y, lowerL.x, lowerL.y], [0.18, 0.22, 0.18, 0.18]);
    }

    if (drops.rightDrop > 0) {
      const lowerR = { x: R.x, y: R.y + drops.rightDrop };
      const lowerB = { x: B.x, y: B.y + drops.rightDrop };
      drawSlopeFace(gl, R, B, lowerB, lowerR, tile, 'right', baseRgb);
      drawLineLoop(gl, [R.x, R.y, B.x, B.y, lowerB.x, lowerB.y, lowerR.x, lowerR.y], [0.16, 0.18, 0.16, 0.16]);
    }

    drawTriangles(gl, topTriangles.triangles, colorStringToRgba(color, 1));
    drawNoisePatches(gl, topPos, tile, tileWidth, tileHeight);
    drawLineLoop(gl, topTriangles.outline, highlight ? [0.97, 0.87, 0.48, 1] : [0.21, 0.34, 0.22, 0.32]);
  }

  function drawSelectionMarker(gl, pos, tileWidth, tileHeight) {
    drawLineLoop(gl, getDiamondOutlineVertices(pos.x, pos.y, tileWidth * 0.62, tileHeight * 0.62), [0.97, 0.87, 0.48, 1]);
  }

  function drawArrowMarker(gl, fromPos, toPos, tileWidth, tileHeight) {
    const dx = toPos.x - fromPos.x;
    const dy = toPos.y - fromPos.y;
    const length = Math.hypot(dx, dy) || 1;
    const ux = dx / length;
    const uy = dy / length;
    const px = -uy;
    const py = ux;
    const bodyLength = tileHeight * 0.95;
    const headLength = tileHeight * 0.55;
    const bodyHalf = tileHeight * 0.14;
    const headHalf = tileHeight * 0.28;
    const sx = fromPos.x;
    const sy = fromPos.y;
    const bx = sx + ux * bodyLength;
    const by = sy + uy * bodyLength;
    const hx = bx + ux * headLength;
    const hy = by + uy * headLength;

    drawTriangles(gl, [
      sx + px * bodyHalf, sy + py * bodyHalf,
      sx - px * bodyHalf, sy - py * bodyHalf,
      bx + px * bodyHalf, by + py * bodyHalf,
      bx + px * bodyHalf, by + py * bodyHalf,
      sx - px * bodyHalf, sy - py * bodyHalf,
      bx - px * bodyHalf, by - py * bodyHalf
    ], [0.39, 0.07, 0.18, 0.72]);

    drawTriangles(gl, [
      bx + px * headHalf, by + py * headHalf,
      bx - px * headHalf, by - py * headHalf,
      hx, hy
    ], [0.57, 0.13, 0.27, 0.94]);
  }

  function drawPreviewRoute(gl, path, metrics) {
    if (!path || path.length < 2) return;
    for (let i = 0; i < path.length - 1; i++) {
      const fromTile = State.world.terrain[path[i].row] && State.world.terrain[path[i].row][path[i].col];
      const toTile = State.world.terrain[path[i + 1].row] && State.world.terrain[path[i + 1].row][path[i + 1].col];
      const fromPos = getElevatedTilePosition(gridToScreen(path[i].row, path[i].col), fromTile, metrics.tileHeight);
      const toPos = getElevatedTilePosition(gridToScreen(path[i + 1].row, path[i + 1].col), toTile, metrics.tileHeight);
      drawArrowMarker(gl, fromPos, toPos, metrics.tileWidth, metrics.tileHeight);
    }
  }

  function drawPlayer(gl, pos, tileWidth, tileHeight) {
    const centerX = pos.x;
    const groundY = pos.y;
    const unit = tileHeight * 0.36;
    const white = [0.93, 0.94, 0.96, 1];
    const mid = [0.82, 0.84, 0.88, 1];
    const dark = [0.58, 0.61, 0.68, 1];
    const shadow = [0.16, 0.24, 0.16, 0.18];
    const softShade = [0.74, 0.76, 0.82, 0.32];
    const outline = [0.34, 0.36, 0.42, 0.50];

    drawEllipse(gl, centerX + unit * 0.5, groundY + unit * 0.2, unit * 1.7, unit * 0.58, shadow, 32);

    const pelvisY = groundY - unit * 2.2;
    const waistY = pelvisY - unit * 0.16;
    const abdomenY = pelvisY - unit * 0.68;
    const chestY = pelvisY - unit * 1.34;
    const shoulderY = pelvisY - unit * 1.65;
    const neckY = pelvisY - unit * 1.98;
    const headY = pelvisY - unit * 2.64;

    const leftHipX = centerX - unit * 0.36;
    const rightHipX = centerX + unit * 0.36;
    const kneeY = groundY - unit * 1.08;
    const ankleY = groundY - unit * 0.16;
    const leftKneeX = centerX - unit * 0.42;
    const rightKneeX = centerX + unit * 0.42;
    const leftAnkleX = centerX - unit * 0.32;
    const rightAnkleX = centerX + unit * 0.32;

    drawCapsule(gl, leftHipX, pelvisY + unit * 0.1, leftKneeX, kneeY, unit * 0.25, white);
    drawCapsule(gl, rightHipX, pelvisY + unit * 0.1, rightKneeX, kneeY, unit * 0.25, white);
    drawCapsule(gl, leftKneeX, kneeY, leftAnkleX, ankleY, unit * 0.2, white);
    drawCapsule(gl, rightKneeX, kneeY, rightAnkleX, ankleY, unit * 0.2, white);
    drawEllipse(gl, leftAnkleX, groundY + unit * 0.03, unit * 0.30, unit * 0.15, mid, 22);
    drawEllipse(gl, rightAnkleX, groundY + unit * 0.03, unit * 0.30, unit * 0.15, mid, 22);
    drawEllipse(gl, centerX, pelvisY + unit * 0.12, unit * 0.72, unit * 0.32, white, 24);
    drawEllipse(gl, centerX, waistY, unit * 0.62, unit * 0.18, mid, 18);
    drawEllipse(gl, centerX, abdomenY, unit * 0.78, unit * 0.46, white, 26);
    drawEllipse(gl, centerX, chestY, unit * 0.98, unit * 0.78, white, 28);
    drawEllipse(gl, centerX, shoulderY - unit * 0.04, unit * 0.72, unit * 0.22, mid, 18);
    drawEllipse(gl, centerX - unit * 0.80, shoulderY, unit * 0.30, unit * 0.24, white, 20);
    drawEllipse(gl, centerX + unit * 0.80, shoulderY, unit * 0.30, unit * 0.24, white, 20);

    const leftShoulderX = centerX - unit * 0.88;
    const rightShoulderX = centerX + unit * 0.88;
    const elbowY = pelvisY - unit * 0.78;
    const wristY = groundY - unit * 1.24;
    const leftElbowX = centerX - unit * 0.90;
    const rightElbowX = centerX + unit * 0.90;
    const leftWristX = centerX - unit * 0.84;
    const rightWristX = centerX + unit * 0.84;

    drawCapsule(gl, leftShoulderX, shoulderY + unit * 0.04, leftElbowX, elbowY, unit * 0.15, white);
    drawCapsule(gl, rightShoulderX, shoulderY + unit * 0.04, rightElbowX, elbowY, unit * 0.15, white);
    drawCapsule(gl, leftElbowX, elbowY, leftWristX, wristY, unit * 0.12, white);
    drawCapsule(gl, rightElbowX, elbowY, rightWristX, wristY, unit * 0.12, white);
    drawEllipse(gl, leftWristX, wristY + unit * 0.10, unit * 0.11, unit * 0.15, mid, 16);
    drawEllipse(gl, rightWristX, wristY + unit * 0.10, unit * 0.11, unit * 0.15, mid, 16);
    drawEllipse(gl, centerX, neckY, unit * 0.18, unit * 0.14, mid, 16);
    drawEllipse(gl, centerX, headY, unit * 0.42, unit * 0.58, white, 28);
    drawEllipse(gl, centerX + unit * 0.16, headY, unit * 0.10, unit * 0.40, dark, 16);
    drawEllipse(gl, centerX + unit * 0.18, chestY + unit * 0.06, unit * 0.16, unit * 0.72, softShade, 16);
    drawLineLoop(gl, [
      centerX - unit * 0.28, headY - unit * 0.46,
      centerX + unit * 0.10, headY - unit * 0.54,
      centerX + unit * 0.40, headY - unit * 0.06,
      centerX + unit * 0.16, headY + unit * 0.46,
      centerX - unit * 0.22, headY + unit * 0.44,
      centerX - unit * 0.42, headY - unit * 0.06
    ], outline);
  }

  function pickTile(x, y) {
    const world = State.world;
    const guess = screenToGridFloat(x, y);
    const baseRow = Math.round(guess.row);
    const baseCol = Math.round(guess.col);

    for (let row = Math.max(0, baseRow - 2); row <= Math.min(world.rows - 1, baseRow + 2); row++) {
      for (let col = Math.max(0, baseCol - 2); col <= Math.min(world.cols - 1, baseCol + 2); col++) {
        const tile = world.terrain[row] && world.terrain[row][col];
        const pos = gridToScreen(row, col);
        const topPos = getElevatedTilePosition(pos, tile, getIsoMetrics().tileHeight);
        if (pointInDiamond(x, y, topPos.x, topPos.y)) return { row, col };
      }
    }

    return null;
  }

  function renderWorld(force) {
    const dom = State.dom;
    const world = State.world;
    const render = State.render;
    const gl = dom.gl;
    const metrics = getIsoMetrics();

    if (!gl || !render.program || !world.terrain.length) return;
    if (!force && !render.needsWorldRedraw) return;

    gl.clearColor(render.clearColor[0], render.clearColor[1], render.clearColor[2], render.clearColor[3]);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.useProgram(render.program);
    gl.uniform2f(render.resolutionLocation, dom.canvas.width, dom.canvas.height);

    for (let row = 0; row < world.rows; row++) {
      for (let col = 0; col < world.cols; col++) {
        const pos = gridToScreen(row, col);
        if (
          pos.x < -metrics.tileWidth || pos.x > dom.canvas.clientWidth + metrics.tileWidth ||
          pos.y < -metrics.tileHeight * 4 || pos.y > dom.canvas.clientHeight + metrics.tileHeight
        ) {
          continue;
        }

        const tile = world.terrain[row][col];
        const isHovered = world.hover && world.hover.row === row && world.hover.col === col;
        const isSelected = world.selected && world.selected.row === row && world.selected.col === col;
        drawTileWebGL(gl, row, col, pos, terrainColor(tile), tile, metrics.tileWidth, metrics.tileHeight, isHovered || isSelected);

        if (isSelected) {
          const topPos = getElevatedTilePosition(pos, tile, metrics.tileHeight);
          drawSelectionMarker(gl, topPos, metrics.tileWidth, metrics.tileHeight);
        }
      }
    }

    if (world.previewPath && world.previewPath.length > 1) {
      drawPreviewRoute(gl, world.previewPath, metrics);
    }

    if (world.player) {
      const playerPos = getPlayerWorldPosition();
      const playerTile = world.terrain[world.player.row] && world.terrain[world.player.row][world.player.col];
      const elevationPx = getTileElevationPx(playerTile, metrics.tileHeight);
      drawPlayer(gl, {
        x: playerPos.x + State.camera.x,
        y: playerPos.y + State.camera.y - elevationPx
      }, metrics.tileWidth, metrics.tileHeight);
    }

    render.needsWorldRedraw = false;
  }

  function drawTile(ctx, x, y, tileWidth, tileHeight, color) {
    const vertices = getDiamondOutlineVertices(x, y, tileWidth, tileHeight);
    ctx.beginPath();
    ctx.moveTo(vertices[0], vertices[1]);
    for (let i = 2; i < vertices.length; i += 2) {
      ctx.lineTo(vertices[i], vertices[i + 1]);
    }
    ctx.closePath();
    ctx.fillStyle = color;
    ctx.fill();
  }

  window.Game.Renderer = {
    resizeCanvas,
    centerCamera,
    centerCameraOnTile,
    gridToScreen,
    screenToGridFloat,
    pickTile,
    renderWorld,
    drawTile,
    terrainColor,
    markDirty,
    getHexMetrics: getIsoMetrics,
    getGridMetrics: getIsoMetrics,
    pointInHex: pointInDiamond,
    pointInDiamond,
    updateCameraFollow,
    calculateFitZoom,
    updateZoomLimits,
    fitCameraToWorld,
    getTileElevationPx,
    getElevatedTilePosition
  };
})();
