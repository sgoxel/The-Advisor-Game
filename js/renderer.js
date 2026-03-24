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

  function centerCameraOnTile(row, col) {
    const dom = State.dom;
    if (!dom.canvas) return;

    const metrics = getHexMetrics();
    const tile = gridToScreen(row, col, 0, 0);
    State.camera.x = dom.canvas.clientWidth / 2 - tile.x;
    State.camera.y = dom.canvas.clientHeight / 2 - tile.y;
    markDirty();
  }

  function centerCamera() {
    const player = State.world.player;
    if (!player) return;
    centerCameraOnTile(player.row, player.col);
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

  function drawPlayer(gl, pos, hexWidth, hexHeight) {
    const bodyWidth = hexWidth * 0.18;
    const bodyHeight = hexHeight * 0.36;
    const centerX = pos.x;
    const centerY = pos.y + hexHeight * 0.02;

    const body = [
      centerX - bodyWidth / 2, centerY - bodyHeight / 2,
      centerX + bodyWidth / 2, centerY - bodyHeight / 2,
      centerX + bodyWidth / 2, centerY + bodyHeight / 2,
      centerX - bodyWidth / 2, centerY + bodyHeight / 2
    ];

    const bodyTriangles = [
      body[0], body[1], body[2], body[3], body[4], body[5],
      body[0], body[1], body[4], body[5], body[6], body[7]
    ];

    drawTriangles(gl, bodyTriangles, [0.90, 0.26, 0.24, 1]);
    drawLineLoop(gl, body, [0.18, 0.08, 0.08, 1]);

    const headRadius = Math.max(5, hexHeight * 0.10);
    const headCenterX = centerX;
    const headCenterY = centerY - bodyHeight / 2 - headRadius * 0.25;
    const headVertices = [];
    const segments = 18;

    for (let i = 0; i < segments; i++) {
      const a1 = (i / segments) * Math.PI * 2;
      const a2 = ((i + 1) / segments) * Math.PI * 2;
      headVertices.push(
        headCenterX, headCenterY,
        headCenterX + Math.cos(a1) * headRadius, headCenterY + Math.sin(a1) * headRadius,
        headCenterX + Math.cos(a2) * headRadius, headCenterY + Math.sin(a2) * headRadius
      );
    }

    drawTriangles(gl, headVertices, [0.96, 0.83, 0.66, 1]);
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

        if (world.player && world.player.row === row && world.player.col === col) {
          drawPlayer(gl, pos, metrics.hexWidth, metrics.hexHeight);
        }
      }
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
    pointInHex
  };
})();
