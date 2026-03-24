/*
  FILE PURPOSE:
  Render the main hex-based game world with WebGL.

  DEPENDENCIES:
  - state.js
  - utils.js

  PUBLIC API:
  - Game.Renderer.resizeCanvas
  - Game.Renderer.centerCamera
  - Game.Renderer.centerCameraOnTile
  - Game.Renderer.gridToScreen
  - Game.Renderer.pickTile
  - Game.Renderer.renderWorld
  - Game.Renderer.drawTile   (2D helper for minimap only)
  - Game.Renderer.terrainColor
  - Game.Renderer.markDirty

  IMPORTANT RULES:
  - Main game area uses WebGL.
  - Minimap uses Canvas 2D.
  - Grid topology is hexagonal (pointy-top, odd-r offset).
*/

window.Game = window.Game || {};

(function () {
  const State = window.Game.State;

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

    void main() {
      gl_FragColor = u_color;
    }
  `;

  function markDirty(worldDirty, minimapDirty) {
    if (worldDirty !== false) {
      State.render.needsWorldRedraw = true;
    }
    if (minimapDirty !== false) {
      State.render.needsMinimapRedraw = true;
    }
  }

  function createShader(gl, type, source) {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);

    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      const info = gl.getShaderInfoLog(shader);
      gl.deleteShader(shader);
      throw new Error(`Shader compile error: ${info}`);
    }

    return shader;
  }

  function createProgram(gl, vertexShader, fragmentShader) {
    const program = gl.createProgram();
    gl.attachShader(program, vertexShader);
    gl.attachShader(program, fragmentShader);
    gl.linkProgram(program);

    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      const info = gl.getProgramInfoLog(program);
      gl.deleteProgram(program);
      throw new Error(`Program link error: ${info}`);
    }

    return program;
  }

  function initializeWebGLResources() {
    const dom = State.dom;
    const render = State.render;
    const gl = dom.gl;

    if (render.program) return;

    const vertexShader = createShader(gl, gl.VERTEX_SHADER, VERTEX_SHADER_SOURCE);
    const fragmentShader = createShader(gl, gl.FRAGMENT_SHADER, FRAGMENT_SHADER_SOURCE);
    const program = createProgram(gl, vertexShader, fragmentShader);

    render.program = program;
    render.positionBuffer = gl.createBuffer();
    render.positionLocation = gl.getAttribLocation(program, "a_position");
    render.resolutionLocation = gl.getUniformLocation(program, "u_resolution");
    render.colorLocation = gl.getUniformLocation(program, "u_color");

    gl.useProgram(program);
    gl.bindBuffer(gl.ARRAY_BUFFER, render.positionBuffer);
    gl.enableVertexAttribArray(render.positionLocation);
    gl.vertexAttribPointer(render.positionLocation, 2, gl.FLOAT, false, 0, 0);

    gl.disable(gl.DEPTH_TEST);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
  }

  function getHexMetrics(scaleWidth) {
    const world = State.world;
    const zoom = State.camera.zoom || 1;
    const hexWidth = scaleWidth || world.tileWidth * zoom;
    const size = hexWidth / Math.sqrt(3);
    const hexHeight = size * 2;
    const rowStep = size * 1.5;

    return {
      size,
      hexWidth,
      hexHeight,
      rowStep
    };
  }

  function gridToScreen(row, col, offsetX, offsetY, hexWidth) {
    const camera = State.camera;
    const metrics = getHexMetrics(hexWidth);
    const xBase = offsetX !== undefined ? offsetX : camera.x;
    const yBase = offsetY !== undefined ? offsetY : camera.y;
    const rowOffset = (row & 1) ? metrics.hexWidth / 2 : 0;

    return {
      x: xBase + metrics.hexWidth / 2 + rowOffset + col * metrics.hexWidth,
      y: yBase + metrics.size + row * metrics.rowStep
    };
  }

  function pointInHex(px, py, cx, cy, hexWidth) {
    const metrics = getHexMetrics(hexWidth);
    const vertices = getHexOutlineVertices(cx, cy, metrics.hexWidth, metrics.hexHeight);

    let inside = false;
    for (let i = 0, j = vertices.length - 2; i < vertices.length; i += 2) {
      const xi = vertices[i];
      const yi = vertices[i + 1];
      const xj = vertices[j];
      const yj = vertices[j + 1];
      const intersect = ((yi > py) !== (yj > py)) &&
        (px < (xj - xi) * (py - yi) / ((yj - yi) || 0.000001) + xi);
      if (intersect) inside = !inside;
      j = i;
    }
    return inside;
  }

  function centerCameraOnWorld(x, y) {
    const dom = State.dom;
    if (!dom.canvas) return;
    const nextX = dom.canvas.clientWidth / 2 - x;
    const nextY = dom.canvas.clientHeight / 2 - y;
    if (Math.abs(State.camera.x - nextX) > 0.01 || Math.abs(State.camera.y - nextY) > 0.01) {
      State.camera.x = nextX;
      State.camera.y = nextY;
      markDirty();
    }
  }

  function getPlayerWorldPosition() {
    const player = State.world.player;
    if (!player) return { x: 0, y: 0 };

    if (!player.moving) {
      return gridToScreen(player.row, player.col, 0, 0);
    }

    const start = gridToScreen(player.startRow, player.startCol, 0, 0);
    const end = gridToScreen(player.targetRow, player.targetCol, 0, 0);
    const t = Math.max(0, Math.min(1, player.progress || 0));
    return {
      x: start.x + (end.x - start.x) * t,
      y: start.y + (end.y - start.y) * t
    };
  }

  function centerCameraOnTile(row, col) {
    const tile = gridToScreen(row, col, 0, 0);
    centerCameraOnWorld(tile.x, tile.y);
  }

  function centerCamera() {
    const playerPos = getPlayerWorldPosition();
    centerCameraOnWorld(playerPos.x, playerPos.y);
  }

  function updateCameraFollow() {
    const player = State.world.player;
    if (!State.camera.followPlayer || !player || !player.moving) return;
    const playerPos = getPlayerWorldPosition();
    centerCameraOnWorld(playerPos.x, playerPos.y);
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
    centerCamera();
    markDirty();
  }

  function pickTile(x, y) {
    const world = State.world;
    const metrics = getHexMetrics();
    const localY = y - State.camera.y - metrics.size;
    const approxRow = Math.round(localY / metrics.rowStep);
    const rowStart = Math.max(0, approxRow - 2);
    const rowEnd = Math.min(world.rows - 1, approxRow + 2);

    for (let row = rowStart; row <= rowEnd; row++) {
      const rowOffset = (row & 1) ? metrics.hexWidth / 2 : 0;
      const localX = x - State.camera.x - metrics.hexWidth / 2 - rowOffset;
      const approxCol = Math.round(localX / metrics.hexWidth);
      const colStart = Math.max(0, approxCol - 2);
      const colEnd = Math.min(world.cols - 1, approxCol + 2);

      for (let col = colStart; col <= colEnd; col++) {
        const center = gridToScreen(row, col);
        if (pointInHex(x, y, center.x, center.y)) {
          return { row, col };
        }
      }
    }

    return null;
  }

  function terrainColor(tile) {
    switch (tile.type) {
      case "grass": return "#5a9b5f";
      case "grass2": return "#6aaa6c";
      case "dirt": return "#a57b4e";
      case "dirtHill": return "#9a7348";
      case "stone": return "#8f949d";
      case "hillStone": return "#8a8e96";
      case "hillGrass": return "#6b965e";
      case "water": return "#4b79b4";
      case "road": return "#b99b68";
      case "forest": return "#3f7345";
      case "forestHill": return "#43684a";
      case "settlement": return "#b8b2a0";
      default: return "#5a9b5f";
    }
  }

  function hexToNormalizedRgba(hex, alpha) {
    const cleaned = hex.replace("#", "");
    const value = parseInt(cleaned, 16);
    const r = (value >> 16) & 255;
    const g = (value >> 8) & 255;
    const b = value & 255;
    return [r / 255, g / 255, b / 255, alpha !== undefined ? alpha : 1];
  }

  function setCustomColor(gl, rgba) {
    gl.uniform4f(State.render.colorLocation, rgba[0], rgba[1], rgba[2], rgba[3]);
  }

  function drawTriangles(gl, vertices, rgba) {
    const render = State.render;
    gl.bindBuffer(gl.ARRAY_BUFFER, render.positionBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(vertices), gl.STREAM_DRAW);
    setCustomColor(gl, rgba);
    gl.drawArrays(gl.TRIANGLES, 0, vertices.length / 2);
  }

  function drawLineLoop(gl, vertices, rgba) {
    const render = State.render;
    gl.bindBuffer(gl.ARRAY_BUFFER, render.positionBuffer);
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

    const bodyVertices = [
      x1 + nx * radius, y1 + ny * radius,
      x1 - nx * radius, y1 - ny * radius,
      x2 + nx * radius, y2 + ny * radius,

      x2 + nx * radius, y2 + ny * radius,
      x1 - nx * radius, y1 - ny * radius,
      x2 - nx * radius, y2 - ny * radius
    ];

    drawTriangles(gl, bodyVertices, rgba);
    drawEllipse(gl, x1, y1, radius, radius, rgba, 20);
    drawEllipse(gl, x2, y2, radius, radius, rgba, 20);
  }

  function getHexOutlineVertices(cx, cy, hexWidth, hexHeight) {
    const radiusY = hexHeight / 2;
    const radiusX = hexWidth / 2;
    return [
      cx, cy - radiusY,
      cx + radiusX, cy - radiusY / 2,
      cx + radiusX, cy + radiusY / 2,
      cx, cy + radiusY,
      cx - radiusX, cy + radiusY / 2,
      cx - radiusX, cy - radiusY / 2
    ];
  }

  function getHexTriangleVertices(cx, cy, hexWidth, hexHeight) {
    const outline = getHexOutlineVertices(cx, cy, hexWidth, hexHeight);
    const triangles = [];

    for (let i = 0; i < outline.length; i += 2) {
      const ni = (i + 2) % outline.length;
      triangles.push(
        cx, cy,
        outline[i], outline[i + 1],
        outline[ni], outline[ni + 1]
      );
    }

    return { triangles, outline };
  }

  function drawTileWebGL(gl, pos, color, hexWidth, hexHeight, highlight) {
    const vertices = getHexTriangleVertices(pos.x, pos.y, hexWidth, hexHeight);
    drawTriangles(gl, vertices.triangles, hexToNormalizedRgba(color, 1));

    const outlineColor = highlight
      ? [250 / 255, 227 / 255, 140 / 255, 1]
      : [17 / 255, 21 / 255, 28 / 255, 0.35];

    drawLineLoop(gl, vertices.outline, outlineColor);
  }

  function drawSelectionMarker(gl, pos, hexWidth, hexHeight) {
    const vertices = getHexOutlineVertices(pos.x, pos.y, hexWidth * 0.62, hexHeight * 0.62);
    drawLineLoop(gl, vertices, [0.97, 0.87, 0.48, 1]);
  }

  function drawArrowMarker(gl, fromPos, toPos, hexWidth, hexHeight) {
    const dx = toPos.x - fromPos.x;
    const dy = toPos.y - fromPos.y;
    const length = Math.hypot(dx, dy) || 1;
    const ux = dx / length;
    const uy = dy / length;
    const px = -uy;
    const py = ux;

    const bodyLength = hexHeight * 0.46;
    const headLength = hexHeight * 0.24;
    const bodyHalf = hexHeight * 0.085;
    const headHalf = hexHeight * 0.16;
    const startOffset = -hexHeight * 0.10;

    const sx = fromPos.x + ux * startOffset;
    const sy = fromPos.y + uy * startOffset;
    const bx = sx + ux * bodyLength;
    const by = sy + uy * bodyLength;
    const hx = bx + ux * headLength;
    const hy = by + uy * headLength;

    const bodyColor = [0.39, 0.07, 0.18, 0.72];
    const headColor = [0.57, 0.13, 0.27, 0.94];
    const accentColor = [0.67, 0.22, 0.35, 0.60];

    drawTriangles(gl, [
      sx + px * bodyHalf, sy + py * bodyHalf,
      sx - px * bodyHalf, sy - py * bodyHalf,
      bx + px * bodyHalf, by + py * bodyHalf,

      bx + px * bodyHalf, by + py * bodyHalf,
      sx - px * bodyHalf, sy - py * bodyHalf,
      bx - px * bodyHalf, by - py * bodyHalf
    ], bodyColor);

    drawTriangles(gl, [
      bx + px * headHalf, by + py * headHalf,
      bx - px * headHalf, by - py * headHalf,
      hx, hy
    ], headColor);

    drawTriangles(gl, [
      sx + px * bodyHalf * 0.45, sy + py * bodyHalf * 0.45,
      sx - px * bodyHalf * 0.45, sy - py * bodyHalf * 0.45,
      bx + px * bodyHalf * 0.45, by + py * bodyHalf * 0.45,

      bx + px * bodyHalf * 0.45, by + py * bodyHalf * 0.45,
      sx - px * bodyHalf * 0.45, sy - py * bodyHalf * 0.45,
      bx - px * bodyHalf * 0.45, by - py * bodyHalf * 0.45
    ], accentColor);
  }

  function drawPreviewRoute(gl, path, metrics) {
    if (!path || path.length < 2) return;
    for (let i = 0; i < path.length - 1; i++) {
      const current = gridToScreen(path[i].row, path[i].col);
      const next = gridToScreen(path[i + 1].row, path[i + 1].col);
      drawArrowMarker(gl, current, next, metrics.hexWidth, metrics.hexHeight);
    }
  }

  function drawPlayer(gl, pos, hexWidth, hexHeight) {
    const centerX = pos.x;
    // Feet contact point must match the tile center point.
    const groundY = pos.y;

    // Global scale reduced ~25% from the previous version.
    const unit = hexHeight * 0.145;
    const white = [0.93, 0.94, 0.96, 1];
    const mid = [0.82, 0.84, 0.88, 1];
    const dark = [0.58, 0.61, 0.68, 1];
    const shadow = [0.16, 0.24, 0.16, 0.18];
    const softShade = [0.74, 0.76, 0.82, 0.32];
    const outline = [0.34, 0.36, 0.42, 0.50];

    // 45-degree ground shadow, kept centered under the tile.
    drawEllipse(gl, centerX + unit * 0.50, groundY + unit * 0.18, unit * 1.65, unit * 0.56, shadow, 32);

    // Height balance: longer legs, shorter total character.
    const pelvisY = groundY - unit * 2.20;
    const waistY = pelvisY - unit * 0.16;
    const abdomenY = pelvisY - unit * 0.68;
    const chestY = pelvisY - unit * 1.34;
    const shoulderY = pelvisY - unit * 1.65;
    const neckY = pelvisY - unit * 1.98;
    const headY = pelvisY - unit * 2.64;

    // Legs ~50% longer and more vertical.
    const leftHipX = centerX - unit * 0.36;
    const rightHipX = centerX + unit * 0.36;
    const kneeY = groundY - unit * 1.08;
    const ankleY = groundY - unit * 0.16;
    const leftKneeX = centerX - unit * 0.42;
    const rightKneeX = centerX + unit * 0.42;
    const leftAnkleX = centerX - unit * 0.32;
    const rightAnkleX = centerX + unit * 0.32;

    drawCapsule(gl, leftHipX, pelvisY + unit * 0.10, leftKneeX, kneeY, unit * 0.25, white);
    drawCapsule(gl, rightHipX, pelvisY + unit * 0.10, rightKneeX, kneeY, unit * 0.25, white);
    drawCapsule(gl, leftKneeX, kneeY, leftAnkleX, ankleY, unit * 0.20, white);
    drawCapsule(gl, rightKneeX, kneeY, rightAnkleX, ankleY, unit * 0.20, white);

    drawEllipse(gl, leftAnkleX - unit * 0.02, groundY + unit * 0.03, unit * 0.30, unit * 0.15, mid, 22);
    drawEllipse(gl, rightAnkleX + unit * 0.02, groundY + unit * 0.03, unit * 0.30, unit * 0.15, mid, 22);

    // Pelvis and torso.
    drawEllipse(gl, centerX, pelvisY + unit * 0.12, unit * 0.72, unit * 0.32, white, 24);
    drawEllipse(gl, centerX, waistY, unit * 0.62, unit * 0.18, mid, 18);
    drawEllipse(gl, centerX, abdomenY, unit * 0.78, unit * 0.46, white, 26);
    drawEllipse(gl, centerX, chestY, unit * 0.98, unit * 0.78, white, 28);
    drawEllipse(gl, centerX, shoulderY - unit * 0.04, unit * 0.72, unit * 0.22, mid, 18);

    // Shoulder caps.
    drawEllipse(gl, centerX - unit * 0.80, shoulderY, unit * 0.30, unit * 0.24, white, 20);
    drawEllipse(gl, centerX + unit * 0.80, shoulderY, unit * 0.30, unit * 0.24, white, 20);

    // Arms shortened for more natural anatomy.
    const leftShoulderX = centerX - unit * 0.88;
    const rightShoulderX = centerX + unit * 0.88;
    const elbowY = pelvisY - unit * 0.78;
    const wristY = groundY - unit * 1.24;
    const leftElbowX = centerX - unit * 0.98;
    const rightElbowX = centerX + unit * 0.98;
    const leftWristX = centerX - unit * 0.94;
    const rightWristX = centerX + unit * 0.94;

    drawCapsule(gl, leftShoulderX, shoulderY + unit * 0.04, leftElbowX, elbowY, unit * 0.15, white);
    drawCapsule(gl, rightShoulderX, shoulderY + unit * 0.04, rightElbowX, elbowY, unit * 0.15, white);
    drawCapsule(gl, leftElbowX, elbowY, leftWristX, wristY, unit * 0.12, white);
    drawCapsule(gl, rightElbowX, elbowY, rightWristX, wristY, unit * 0.12, white);

    drawEllipse(gl, leftWristX, wristY + unit * 0.10, unit * 0.11, unit * 0.15, mid, 16);
    drawEllipse(gl, rightWristX, wristY + unit * 0.10, unit * 0.11, unit * 0.15, mid, 16);

    // Neck and head.
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

  function getVisibleBounds(canvasWidth, canvasHeight) {
    const world = State.world;
    const camera = State.camera;
    const metrics = getHexMetrics();
    const rowMin = Math.max(0, Math.floor((-camera.y - metrics.hexHeight) / metrics.rowStep) - 2);
    const rowMax = Math.min(world.rows - 1, Math.ceil((canvasHeight - camera.y + metrics.hexHeight) / metrics.rowStep) + 2);

    return { rowMin, rowMax };
  }

  function renderWorld(force) {
    const dom = State.dom;
    const world = State.world;
    const render = State.render;
    const gl = dom.gl;
    const metrics = getHexMetrics();

    if (!gl || !render.program || !world.terrain.length) return;
    if (!force && !render.needsWorldRedraw) return;

    gl.clearColor(render.clearColor[0], render.clearColor[1], render.clearColor[2], render.clearColor[3]);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.useProgram(render.program);
    gl.uniform2f(render.resolutionLocation, dom.canvas.clientWidth, dom.canvas.clientHeight);

    const bounds = getVisibleBounds(dom.canvas.clientWidth, dom.canvas.clientHeight);

    for (let row = bounds.rowMin; row <= bounds.rowMax; row++) {
      const rowOffset = (row & 1) ? metrics.hexWidth / 2 : 0;
      const colMin = Math.max(0, Math.floor((-State.camera.x - rowOffset - metrics.hexWidth) / metrics.hexWidth) - 2);
      const colMax = Math.min(world.cols - 1, Math.ceil((dom.canvas.clientWidth - State.camera.x - rowOffset + metrics.hexWidth) / metrics.hexWidth) + 2);

      for (let col = colMin; col <= colMax; col++) {
        const tile = world.terrain[row][col];
        const pos = gridToScreen(row, col);
        const isHovered = world.hover && world.hover.row === row && world.hover.col === col;
        const isSelected = world.selected && world.selected.row === row && world.selected.col === col;
        drawTileWebGL(gl, pos, terrainColor(tile), metrics.hexWidth, metrics.hexHeight, isHovered || isSelected);

        if (isSelected) {
          drawSelectionMarker(gl, pos, metrics.hexWidth, metrics.hexHeight);
        }
      }
    }

    if (world.previewPath && world.previewPath.length > 1) {
      drawPreviewRoute(gl, world.previewPath, metrics);
    }

    if (world.player) {
      const playerPos = getPlayerWorldPosition();
      drawPlayer(gl, { x: playerPos.x + State.camera.x, y: playerPos.y + State.camera.y }, metrics.hexWidth, metrics.hexHeight);
    }

    render.needsWorldRedraw = false;
  }

  function drawTile(ctx, x, y, hexWidth, hexHeight, color) {
    const vertices = getHexOutlineVertices(x, y, hexWidth, hexHeight);
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
    pickTile,
    renderWorld,
    drawTile,
    terrainColor,
    markDirty,
    getHexMetrics,
    pointInHex,
    getPlayerWorldPosition,
    centerCameraOnWorld,
    updateCameraFollow
  };
})();
