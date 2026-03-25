/*
  FILE PURPOSE:
  Render the standard rectangular game world with WebGL.
*/

window.Game = window.Game || {};

(function () {
  const State = window.Game.State;
  const Config = window.Game.Config;

  const COLOR_VERTEX_SHADER_SOURCE = `
    attribute vec2 a_position;
    uniform vec2 u_resolution;
    void main() {
      vec2 zeroToOne = a_position / u_resolution;
      vec2 zeroToTwo = zeroToOne * 2.0;
      vec2 clipSpace = zeroToTwo - 1.0;
      gl_Position = vec4(clipSpace * vec2(1.0, -1.0), 0.0, 1.0);
    }
  `;

  const COLOR_FRAGMENT_SHADER_SOURCE = `
    precision mediump float;
    uniform vec4 u_color;
    void main() { gl_FragColor = u_color; }
  `;

  const TEXTURE_VERTEX_SHADER_SOURCE = `
    attribute vec2 a_position;
    attribute vec2 a_texCoord;
    uniform vec2 u_resolution;
    varying vec2 v_texCoord;
    void main() {
      vec2 zeroToOne = a_position / u_resolution;
      vec2 zeroToTwo = zeroToOne * 2.0;
      vec2 clipSpace = zeroToTwo - 1.0;
      gl_Position = vec4(clipSpace * vec2(1.0, -1.0), 0.0, 1.0);
      v_texCoord = a_texCoord;
    }
  `;

  const TEXTURE_FRAGMENT_SHADER_SOURCE = `
    precision mediump float;
    uniform sampler2D u_texture;
    varying vec2 v_texCoord;
    void main() {
      gl_FragColor = texture2D(u_texture, v_texCoord);
    }
  `;

  function markDirty(worldDirty, minimapDirty) {
    if (worldDirty !== false) {
      State.render.needsWorldRedraw = true;
      State.render.needsBackgroundRebuild = true;
      State.render.needsBackgroundUpload = true;
    }
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
    if (render.colorProgram && render.textureProgram) return;

    const colorVs = createShader(gl, gl.VERTEX_SHADER, COLOR_VERTEX_SHADER_SOURCE);
    const colorFs = createShader(gl, gl.FRAGMENT_SHADER, COLOR_FRAGMENT_SHADER_SOURCE);
    const colorProgram = createProgram(gl, colorVs, colorFs);

    render.colorProgram = colorProgram;
    render.positionBuffer = gl.createBuffer();
    render.colorPositionLocation = gl.getAttribLocation(colorProgram, 'a_position');
    render.colorResolutionLocation = gl.getUniformLocation(colorProgram, 'u_resolution');
    render.colorLocation = gl.getUniformLocation(colorProgram, 'u_color');

    const textureVs = createShader(gl, gl.VERTEX_SHADER, TEXTURE_VERTEX_SHADER_SOURCE);
    const textureFs = createShader(gl, gl.FRAGMENT_SHADER, TEXTURE_FRAGMENT_SHADER_SOURCE);
    const textureProgram = createProgram(gl, textureVs, textureFs);

    render.textureProgram = textureProgram;
    render.texturePositionBuffer = gl.createBuffer();
    render.textureCoordBuffer = gl.createBuffer();
    render.texturePositionLocation = gl.getAttribLocation(textureProgram, 'a_position');
    render.textureCoordLocation = gl.getAttribLocation(textureProgram, 'a_texCoord');
    render.textureResolutionLocation = gl.getUniformLocation(textureProgram, 'u_resolution');
    render.textureSamplerLocation = gl.getUniformLocation(textureProgram, 'u_texture');
    render.backgroundTexture = gl.createTexture();

    gl.bindTexture(gl.TEXTURE_2D, render.backgroundTexture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);

    gl.disable(gl.DEPTH_TEST);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
  }

  function getGridMetrics(scaleWidth) {
    const camera = State.camera;
    const zoom = camera.zoom || 1;
    const tileWidth = scaleWidth || State.world.tileWidth * zoom;
    const tileHeight = tileWidth;
    return { tileWidth, tileHeight, halfW: tileWidth / 2, halfH: tileHeight / 2, ratio: 1 };
  }

  function gridToScreen(row, col, offsetX, offsetY, tileWidth) {
    const metrics = getGridMetrics(tileWidth);
    const localX = col * metrics.tileWidth + metrics.halfW;
    const localY = row * metrics.tileHeight + metrics.halfH;
    const xBase = offsetX !== undefined ? offsetX : State.camera.x;
    const yBase = offsetY !== undefined ? offsetY : State.camera.y;
    return { x: xBase + localX, y: yBase + localY };
  }

  function screenToGridFloat(x, y, offsetX, offsetY, tileWidth) {
    const metrics = getGridMetrics(tileWidth);
    const xBase = offsetX !== undefined ? offsetX : State.camera.x;
    const yBase = offsetY !== undefined ? offsetY : State.camera.y;
    const lx = x - xBase;
    const ly = y - yBase;
    const col = (lx / metrics.tileWidth) - 0.5;
    const row = (ly / metrics.tileHeight) - 0.5;
    return { row, col };
  }

  function pointInRect(px, py, cx, cy, tileWidth) {
    const metrics = getGridMetrics(tileWidth);
    return Math.abs(px - cx) <= metrics.halfW && Math.abs(py - cy) <= metrics.halfH;
  }

  function centerCameraOnWorld(x, y) {
    const canvas = State.dom.canvas;
    const nextX = canvas.clientWidth / 2 - x;
    const nextY = canvas.clientHeight / 2 - y;
    if (Math.abs(State.camera.x - nextX) > 0.01 || Math.abs(State.camera.y - nextY) > 0.01) {
      State.camera.x = nextX;
      State.camera.y = nextY;
      State.render.needsWorldRedraw = true;
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

  function updateCameraFollow() {
    if (State.camera.followPlayer && State.world.player && State.world.player.moving) centerCamera();
  }

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
    State.render.needsWorldRedraw = true;
  }

  function pickTile(x, y) {
    const world = State.world;
    const guess = screenToGridFloat(x, y);
    const baseRow = Math.round(guess.row);
    const baseCol = Math.round(guess.col);
    for (let row = Math.max(0, baseRow - 2); row <= Math.min(world.rows - 1, baseRow + 2); row++) {
      for (let col = Math.max(0, baseCol - 2); col <= Math.min(world.cols - 1, baseCol + 2); col++) {
        const pos = gridToScreen(row, col);
        if (pointInRect(x, y, pos.x, pos.y)) return { row, col };
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

  function setCustomColor(gl, rgba) {
    gl.uniform4f(State.render.colorLocation, rgba[0], rgba[1], rgba[2], rgba[3]);
  }

  function useColorProgram(gl) {
    const render = State.render;
    gl.useProgram(render.colorProgram);
    gl.uniform2f(render.colorResolutionLocation, State.dom.canvas.clientWidth, State.dom.canvas.clientHeight);
    gl.bindBuffer(gl.ARRAY_BUFFER, render.positionBuffer);
    gl.enableVertexAttribArray(render.colorPositionLocation);
    gl.vertexAttribPointer(render.colorPositionLocation, 2, gl.FLOAT, false, 0, 0);
  }

  function drawTriangles(gl, vertices, rgba) {
    useColorProgram(gl);
    gl.bindBuffer(gl.ARRAY_BUFFER, State.render.positionBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(vertices), gl.STREAM_DRAW);
    setCustomColor(gl, rgba);
    gl.drawArrays(gl.TRIANGLES, 0, vertices.length / 2);
  }

  function drawLineLoop(gl, vertices, rgba) {
    useColorProgram(gl);
    gl.bindBuffer(gl.ARRAY_BUFFER, State.render.positionBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(vertices), gl.STREAM_DRAW);
    setCustomColor(gl, rgba);
    gl.drawArrays(gl.LINE_LOOP, 0, vertices.length / 2);
  }

  function drawLines(gl, vertices, rgba) {
    if (!vertices || !vertices.length) return;
    useColorProgram(gl);
    gl.bindBuffer(gl.ARRAY_BUFFER, State.render.positionBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(vertices), gl.STREAM_DRAW);
    setCustomColor(gl, rgba);
    gl.drawArrays(gl.LINES, 0, vertices.length / 2);
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

  function getRectOutlineVertices(cx, cy, tileWidth, tileHeight) {
    const halfW = tileWidth / 2;
    const halfH = tileHeight / 2;
    return [
      cx - halfW, cy - halfH,
      cx + halfW, cy - halfH,
      cx + halfW, cy + halfH,
      cx - halfW, cy + halfH
    ];
  }

  function drawSelectionMarker(gl, pos, tileWidth, tileHeight) {
    drawLineLoop(gl, getRectOutlineVertices(pos.x, pos.y, tileWidth * 0.62, tileHeight * 0.62), [0.97, 0.87, 0.48, 1]);
  }

  function drawHoverMarker(gl, pos, tileWidth, tileHeight) {
    drawLineLoop(gl, getRectOutlineVertices(pos.x, pos.y, tileWidth * 0.92, tileHeight * 0.92), [0.97, 0.87, 0.48, 0.65]);
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

  function getBackgroundResolution(cols, rows) {
    const maxSize = 4096;
    const safeCols = Math.max(1, cols || 1);
    const safeRows = Math.max(1, rows || 1);
    const pxPerCell = Math.max(1, Math.floor(Math.min(maxSize / safeCols, maxSize / safeRows, 64)));
    return {
      width: Math.max(1, Math.min(maxSize, safeCols * pxPerCell)),
      height: Math.max(1, Math.min(maxSize, safeRows * pxPerCell))
    };
  }

  function rebuildBackgroundCanvas() {
    const world = State.world;
    const render = State.render;
    if (!world || !world.terrain || !world.terrain.length) return;

    const resolution = getBackgroundResolution(world.cols, world.rows);
    const canvas = document.createElement('canvas');
    canvas.width = resolution.width;
    canvas.height = resolution.height;

    const ctx = canvas.getContext('2d', { alpha: false });
    const cellWidth = canvas.width / Math.max(1, world.cols);
    const cellHeight = canvas.height / Math.max(1, world.rows);

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    for (let row = 0; row < world.rows; row++) {
      for (let col = 0; col < world.cols; col++) {
        ctx.fillStyle = terrainColor(world.terrain[row][col]);
        ctx.fillRect(
          Math.floor(col * cellWidth),
          Math.floor(row * cellHeight),
          Math.ceil(cellWidth) + 1,
          Math.ceil(cellHeight) + 1
        );
      }
    }

    render.worldBackgroundCanvas = canvas;
    render.needsBackgroundRebuild = false;
    render.needsBackgroundUpload = true;
  }

  function ensureBackgroundTexture(gl) {
    const render = State.render;
    if (render.needsBackgroundRebuild || !render.worldBackgroundCanvas) rebuildBackgroundCanvas();
    if (!render.worldBackgroundCanvas) return false;
    if (!render.needsBackgroundUpload && render.backgroundTextureReady) return true;

    gl.bindTexture(gl.TEXTURE_2D, render.backgroundTexture);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, render.worldBackgroundCanvas);

    render.needsBackgroundUpload = false;
    render.backgroundTextureReady = true;
    return true;
  }

  function drawBackgroundQuad(gl, metrics) {
    if (!ensureBackgroundTexture(gl)) return;

    const render = State.render;
    const world = State.world;
    const left = State.camera.x;
    const top = State.camera.y;
    const right = left + world.cols * metrics.tileWidth;
    const bottom = top + world.rows * metrics.tileHeight;

    const positions = [
      left, top,
      right, top,
      left, bottom,
      left, bottom,
      right, top,
      right, bottom
    ];

    const texCoords = [
      0, 1,
      1, 1,
      0, 0,
      0, 0,
      1, 1,
      1, 0
    ];

    gl.useProgram(render.textureProgram);
    gl.uniform2f(render.textureResolutionLocation, State.dom.canvas.clientWidth, State.dom.canvas.clientHeight);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, render.backgroundTexture);
    gl.uniform1i(render.textureSamplerLocation, 0);

    gl.bindBuffer(gl.ARRAY_BUFFER, render.texturePositionBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(positions), gl.STREAM_DRAW);
    gl.enableVertexAttribArray(render.texturePositionLocation);
    gl.vertexAttribPointer(render.texturePositionLocation, 2, gl.FLOAT, false, 0, 0);

    gl.bindBuffer(gl.ARRAY_BUFFER, render.textureCoordBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(texCoords), gl.STREAM_DRAW);
    gl.enableVertexAttribArray(render.textureCoordLocation);
    gl.vertexAttribPointer(render.textureCoordLocation, 2, gl.FLOAT, false, 0, 0);

    gl.drawArrays(gl.TRIANGLES, 0, 6);
  }

  function drawGridOverlay(gl, metrics) {
    const world = State.world;
    const width = world.cols * metrics.tileWidth;
    const height = world.rows * metrics.tileHeight;
    const left = State.camera.x;
    const top = State.camera.y;
    const lineVertices = [];

    for (let col = 0; col <= world.cols; col++) {
      const x = left + col * metrics.tileWidth;
      lineVertices.push(x, top, x, top + height);
    }

    for (let row = 0; row <= world.rows; row++) {
      const y = top + row * metrics.tileHeight;
      lineVertices.push(left, y, left + width, y);
    }

    drawLines(gl, lineVertices, [0.12, 0.17, 0.21, 0.55]);
  }

  function renderWorld(force) {
    const dom = State.dom;
    const world = State.world;
    const render = State.render;
    const gl = dom.gl;
    const metrics = getGridMetrics();
    if (!gl || (!render.colorProgram && !render.textureProgram) || !world.terrain.length) return;
    if (!force && !render.needsWorldRedraw) return;

    gl.clearColor(render.clearColor[0], render.clearColor[1], render.clearColor[2], render.clearColor[3]);
    gl.clear(gl.COLOR_BUFFER_BIT);

    drawBackgroundQuad(gl, metrics);
    drawGridOverlay(gl, metrics);

    if (world.hover) {
      const hoverPos = gridToScreen(world.hover.row, world.hover.col);
      drawHoverMarker(gl, hoverPos, metrics.tileWidth, metrics.tileHeight);
    }

    if (world.selected) {
      const selectedPos = gridToScreen(world.selected.row, world.selected.col);
      drawSelectionMarker(gl, selectedPos, metrics.tileWidth, metrics.tileHeight);
    }

    if (world.previewPath && world.previewPath.length > 1) drawPreviewRoute(gl, world.previewPath, metrics);

    if (world.player) {
      const playerPos = getPlayerWorldPosition();
      drawPlayer(gl, { x: playerPos.x + State.camera.x, y: playerPos.y + State.camera.y }, metrics.tileWidth, metrics.tileHeight);
    }

    render.needsWorldRedraw = false;
  }

  function drawTile(ctx, x, y, tileWidth, tileHeight, color) {
    const vertices = getRectOutlineVertices(x, y, tileWidth, tileHeight);
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
    getHexMetrics: getGridMetrics,
    getGridMetrics,
    pointInHex: pointInRect,
    pointInDiamond: pointInRect,
    pointInRect,
    updateCameraFollow,
    calculateFitZoom,
    updateZoomLimits,
    fitCameraToWorld
  };
})();
