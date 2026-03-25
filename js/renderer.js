/*
  FILE PURPOSE:
  Render the rectangular (top-down) game world with WebGL.
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
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(`Shader compile error: ${gl.getShaderInfoLog(shader)}`);
    return shader;
  }

  function createProgram(gl, vs, fs) {
    const program = gl.createProgram();
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(`Program link error: ${gl.getProgramInfoLog(program)}`);
    return program;
  }

  function initializeWebGLResources() {
    const gl = State.dom.gl;
    const render = State.render;
    if (render.program) return;

    const vs = createShader(gl, gl.VERTEX_SHADER, VERTEX_SHADER_SOURCE);
    const fs = createShader(gl, gl.FRAGMENT_SHADER, FRAGMENT_SHADER_SOURCE);
    const program = createProgram(gl, vs, fs);

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
    const tileHeight = tileWidth;
    return { tileWidth, tileHeight, halfW: tileWidth / 2, halfH: tileHeight / 2, ratio: 1 };
  }

  function gridToScreen(row, col, offsetX, offsetY, tileWidth) {
    const metrics = getIsoMetrics(tileWidth);
    const localX = col * metrics.tileWidth;
    const localY = row * metrics.tileHeight;
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
    const col = lx / metrics.tileWidth;
    const row = ly / metrics.tileHeight;
    return { row, col };
  }

  function pointInTile(px, py, cx, cy, tileWidth) {
    const metrics = getIsoMetrics(tileWidth);
    return Math.abs(px - cx) <= metrics.halfW && Math.abs(py - cy) <= metrics.halfH;
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
    return { x: start.x + (end.x - start.x) * t, y: start.y + (end.y - start.y) * t };
  }

  function centerCameraOnTile(row, col) { const pos = gridToScreen(row, col, 0, 0); centerCameraOnWorld(pos.x, pos.y); }
  function centerCamera() { const p = getPlayerWorldPosition(); centerCameraOnWorld(p.x, p.y); }
  function calculateFitZoom(paddingRatio) {
    const canvas = State.dom.canvas;
    const world = State.world;
    if (!canvas || !canvas.clientWidth || !canvas.clientHeight || !world.rows || !world.cols) return 1;

    const padding = Math.max(24, Math.min(canvas.clientWidth, canvas.clientHeight) * (paddingRatio || 0.08));
    const availableWidth = Math.max(1, canvas.clientWidth - padding * 2);
    const availableHeight = Math.max(1, canvas.clientHeight - padding * 2);

    const widthZoom = availableWidth / Math.max(1, world.cols * world.tileWidth);
    const heightZoom = availableHeight / Math.max(1, world.rows * world.tileWidth);
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
  function updateCameraFollow() { if (State.camera.followPlayer && State.world.player && State.world.player.moving) centerCamera(); }

  function resizeCanvas() {
    const dom = State.dom;
    const gl = dom.gl;
    const dpr = window.devicePixelRatio || 1;
    const displayWidth = Math.round(dom.canvas.clientWidth * dpr);
    const displayHeight = Math.round(dom.canvas.clientHeight * dpr);
    if (dom.canvas.width !== displayWidth || dom.canvas.height !== displayHeight) {
      dom.canvas.width = displayWidth;
      dom.canvas.height = displayHeight;
    }
    initializeWebGLResources();
    gl.viewport(0, 0, dom.canvas.width, dom.canvas.height);
    updateZoomLimits();
    centerCamera();
    markDirty();
  }

  function pickTile(x, y) {
    const world = State.world;
    const guess = screenToGridFloat(x, y);
    const baseRow = Math.round(guess.row);
    const baseCol = Math.round(guess.col);
    for (let row = Math.max(0, baseRow - 2); row <= Math.min(world.rows - 1, baseRow + 2); row++) {
      for (let col = Math.max(0, baseCol - 2); col <= Math.min(world.cols - 1, baseCol + 2); col++) {
        const pos = gridToScreen(row, col);
        if (pointInDiamond(x, y, pos.x, pos.y)) return { row, col };
      }
    }
    return null;
  }

  function terrainColor(tile) {
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

  function hexToNormalizedRgba(hex, alpha) {
    const cleaned = hex.replace('#', '');
    const value = parseInt(cleaned, 16);
    return [((value >> 16) & 255) / 255, ((value >> 8) & 255) / 255, (value & 255) / 255, alpha !== undefined ? alpha : 1];
  }

  function setCustomColor(gl, rgba) { gl.uniform4f(State.render.colorLocation, rgba[0], rgba[1], rgba[2], rgba[3]); }
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

  function drawEllipse(gl, cx, cy, radiusX, radiusY, rgba, segments) {
    const count = Math.max(12, segments || 24);
    const vertices = [];
    for (let i = 0; i < count; i++) {
      const a0 = (i / count) * Math.PI * 2;
      const a1 = ((i + 1) / count) * Math.PI * 2;
      vertices.push(cx, cy, cx + Math.cos(a0) * radiusX, cy + Math.sin(a0) * radiusY, cx + Math.cos(a1) * radiusX, cy + Math.sin(a1) * radiusY);
    }
    drawTriangles(gl, vertices, rgba);
  }

  function drawCapsule(gl, x1, y1, x2, y2, radius, rgba) {
    const dx = x2 - x1, dy = y2 - y1, length = Math.hypot(dx, dy);
    if (length < 0.0001) { drawEllipse(gl, x1, y1, radius, radius, rgba, 20); return; }
    const nx = -dy / length, ny = dx / length;
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

  function getTileOutlineVertices(cx, cy, tileWidth, tileHeight) {
    const halfW = tileWidth / 2;
    const halfH = tileHeight / 2;
    return [cx - halfW, cy - halfH, cx + halfW, cy - halfH, cx + halfW, cy + halfH, cx - halfW, cy + halfH];
  }

  function getTileTriangleVertices(cx, cy, tileWidth, tileHeight) {
    const outline = getTileOutlineVertices(cx, cy, tileWidth, tileHeight);
    return {
      triangles: [
        outline[0], outline[1], outline[2], outline[3], outline[4], outline[5],
        outline[0], outline[1], outline[4], outline[5], outline[6], outline[7]
      ],
      outline
    };
  }

  function drawTileWebGL(gl, pos, color, tileWidth, tileHeight, highlight) {
    const vertices = getTileTriangleVertices(pos.x, pos.y, tileWidth, tileHeight);
    drawTriangles(gl, vertices.triangles, hexToNormalizedRgba(color, 1));
    drawLineLoop(gl, vertices.outline, highlight ? [0.97, 0.87, 0.48, 1] : [0.21, 0.34, 0.22, 0.45]);
  }

  function drawSelectionMarker(gl, pos, tileWidth, tileHeight) {
    drawLineLoop(gl, getTileOutlineVertices(pos.x, pos.y, tileWidth * 0.62, tileHeight * 0.62), [0.97, 0.87, 0.48, 1]);
  }

  function drawArrowMarker(gl, fromPos, toPos, tileWidth, tileHeight) {
    const dx = toPos.x - fromPos.x;
    const dy = toPos.y - fromPos.y;
    const length = Math.hypot(dx, dy) || 1;
    const ux = dx / length, uy = dy / length;
    const px = -uy, py = ux;
    const bodyLength = tileHeight * 0.95;
    const headLength = tileHeight * 0.55;
    const bodyHalf = tileHeight * 0.14;
    const headHalf = tileHeight * 0.28;
    const sx = fromPos.x, sy = fromPos.y;
    const bx = sx + ux * bodyLength, by = sy + uy * bodyLength;
    const hx = bx + ux * headLength, hy = by + uy * headLength;

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
      drawArrowMarker(gl, gridToScreen(path[i].row, path[i].col), gridToScreen(path[i + 1].row, path[i + 1].col), metrics.tileWidth, metrics.tileHeight);
    }
  }

  function drawPlayer(gl, pos, tileWidth, tileHeight) {
    const centerX = pos.x, groundY = pos.y, unit = tileHeight * 0.36;
    const white = [0.93, 0.94, 0.96, 1], mid = [0.82, 0.84, 0.88, 1], dark = [0.58, 0.61, 0.68, 1], shadow = [0.16, 0.24, 0.16, 0.18], softShade = [0.74, 0.76, 0.82, 0.32], outline = [0.34, 0.36, 0.42, 0.50];
    drawEllipse(gl, centerX + unit * 0.5, groundY + unit * 0.2, unit * 1.7, unit * 0.58, shadow, 32);
    const pelvisY = groundY - unit * 2.2, waistY = pelvisY - unit * 0.16, abdomenY = pelvisY - unit * 0.68, chestY = pelvisY - unit * 1.34, shoulderY = pelvisY - unit * 1.65, neckY = pelvisY - unit * 1.98, headY = pelvisY - unit * 2.64;
    const leftHipX = centerX - unit * 0.36, rightHipX = centerX + unit * 0.36, kneeY = groundY - unit * 1.08, ankleY = groundY - unit * 0.16, leftKneeX = centerX - unit * 0.42, rightKneeX = centerX + unit * 0.42, leftAnkleX = centerX - unit * 0.32, rightAnkleX = centerX + unit * 0.32;
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
    const leftShoulderX = centerX - unit * 0.88, rightShoulderX = centerX + unit * 0.88, elbowY = pelvisY - unit * 0.78, wristY = groundY - unit * 1.24, leftElbowX = centerX - unit * 0.90, rightElbowX = centerX + unit * 0.90, leftWristX = centerX - unit * 0.84, rightWristX = centerX + unit * 0.84;
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
    drawLineLoop(gl, [centerX - unit * 0.28, headY - unit * 0.46, centerX + unit * 0.10, headY - unit * 0.54, centerX + unit * 0.40, headY - unit * 0.06, centerX + unit * 0.16, headY + unit * 0.46, centerX - unit * 0.22, headY + unit * 0.44, centerX - unit * 0.42, headY - unit * 0.06], outline);
  }

  function renderWorld(force) {
    const dom = State.dom, world = State.world, render = State.render, gl = dom.gl, metrics = getIsoMetrics();
    if (!gl || !render.program || !world.terrain.length) return;
    if (!force && !render.needsWorldRedraw) return;

    gl.clearColor(render.clearColor[0], render.clearColor[1], render.clearColor[2], render.clearColor[3]);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.useProgram(render.program);
    gl.uniform2f(render.resolutionLocation, dom.canvas.clientWidth, dom.canvas.clientHeight);

    for (let row = 0; row < world.rows; row++) {
      for (let col = 0; col < world.cols; col++) {
        const pos = gridToScreen(row, col);
        if (pos.x < -metrics.tileWidth || pos.x > dom.canvas.clientWidth + metrics.tileWidth || pos.y < -metrics.tileHeight || pos.y > dom.canvas.clientHeight + metrics.tileHeight) continue;
        const tile = world.terrain[row][col];
        const isHovered = world.hover && world.hover.row === row && world.hover.col === col;
        const isSelected = world.selected && world.selected.row === row && world.selected.col === col;
        drawTileWebGL(gl, pos, terrainColor(tile), metrics.tileWidth, metrics.tileHeight, isHovered || isSelected);
        if (isSelected) drawSelectionMarker(gl, pos, metrics.tileWidth, metrics.tileHeight);
      }
    }

    if (world.previewPath && world.previewPath.length > 1) drawPreviewRoute(gl, world.previewPath, metrics);
    if (world.player) {
      const playerPos = getPlayerWorldPosition();
      drawPlayer(gl, { x: playerPos.x + State.camera.x, y: playerPos.y + State.camera.y }, metrics.tileWidth, metrics.tileHeight);
    }

    render.needsWorldRedraw = false;
  }

  function drawTile(ctx, x, y, tileWidth, tileHeight, color) {
    const vertices = getTileOutlineVertices(x, y, tileWidth, tileHeight);
    ctx.beginPath();
    ctx.moveTo(vertices[0], vertices[1]);
    for (let i = 2; i < vertices.length; i += 2) ctx.lineTo(vertices[i], vertices[i + 1]);
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
    pointInHex: pointInTile,
    pointInDiamond: pointInTile,
    updateCameraFollow,
    calculateFitZoom,
    updateZoomLimits,
    fitCameraToWorld
  };
})();
