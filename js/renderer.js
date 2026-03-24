/*
  FILE PURPOSE:
  Render the main isometric game world with WebGL.

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

  IMPORTANT RULES:
  - Main game area uses WebGL.
  - Minimap still uses Canvas 2D and may call drawTile().
  - Picking stays in CPU-side JS logic.
*/

window.Game = window.Game || {};

(function () {
  const State = window.Game.State;
  const Utils = window.Game.Utils;

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

  function centerCameraOnTile(row, col) {
    const dom = State.dom;
    const world = State.world;
    const camera = State.camera;

    if (!dom.canvas) return;

    const zoom = camera.zoom || 1;
    const tileWidth = world.tileWidth * zoom;
    const tileHeight = world.tileHeight * zoom;
    const canvasWidth = dom.canvas.clientWidth;
    const canvasHeight = dom.canvas.clientHeight;

    camera.x = canvasWidth / 2 - (col - row) * tileWidth / 2;
    camera.y = canvasHeight / 2 - (col + row) * tileHeight / 2 - tileHeight / 2;
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
  }

  function gridToScreen(row, col, offsetX, offsetY, tileWidth, tileHeight) {
    const world = State.world;
    const camera = State.camera;

    const xBase = offsetX !== undefined ? offsetX : camera.x;
    const yBase = offsetY !== undefined ? offsetY : camera.y;
    const zoom = camera.zoom || 1;
    const tw = tileWidth || world.tileWidth * zoom;
    const th = tileHeight || world.tileHeight * zoom;

    return {
      x: (col - row) * tw / 2 + xBase,
      y: (col + row) * th / 2 + yBase
    };
  }

  function pointInDiamond(px, py, cx, cy, tileWidth, tileHeight) {
    const world = State.world;
    const camera = State.camera;
    const zoom = camera.zoom || 1;
    const tw = tileWidth || world.tileWidth * zoom;
    const th = tileHeight || world.tileHeight * zoom;

    const dx = Math.abs(px - cx) / (tw / 2);
    const dy = Math.abs(py - (cy + th / 2)) / (th / 2);
    return dx + dy <= 1;
  }

  function pickTile(x, y) {
    const world = State.world;

    for (let row = world.rows - 1; row >= 0; row--) {
      for (let col = world.cols - 1; col >= 0; col--) {
        const pos = gridToScreen(row, col);
        if (pointInDiamond(x, y, pos.x, pos.y)) {
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

  function getDiamondVertices(pos, tileWidth, tileHeight) {
    const top = [pos.x, pos.y];
    const right = [pos.x + tileWidth / 2, pos.y + tileHeight / 2];
    const bottom = [pos.x, pos.y + tileHeight];
    const left = [pos.x - tileWidth / 2, pos.y + tileHeight / 2];

    return {
      triangles: [
        top[0], top[1], right[0], right[1], bottom[0], bottom[1],
        top[0], top[1], bottom[0], bottom[1], left[0], left[1]
      ],
      outline: [
        top[0], top[1], right[0], right[1], bottom[0], bottom[1], left[0], left[1]
      ]
    };
  }

  function drawTileWebGL(gl, pos, color, tileWidth, tileHeight, highlight) {
    const vertices = getDiamondVertices(pos, tileWidth, tileHeight);
    drawTriangles(gl, vertices.triangles, hexToNormalizedRgba(color, 1));

    const outlineColor = highlight
      ? [250 / 255, 227 / 255, 140 / 255, 1]
      : [17 / 255, 21 / 255, 28 / 255, 0.55];

    drawLineLoop(gl, vertices.outline, outlineColor);
  }

  function drawSelectionMarker(gl, pos, tileWidth, tileHeight) {
    const markerWidth = tileWidth * 0.36;
    const markerHeight = tileHeight * 0.56;
    const centerX = pos.x;
    const centerY = pos.y + tileHeight * 0.5;

    const vertices = [
      centerX, centerY - markerHeight / 2,
      centerX + markerWidth / 2, centerY,
      centerX, centerY + markerHeight / 2,
      centerX - markerWidth / 2, centerY
    ];

    drawLineLoop(gl, vertices, [0.97, 0.87, 0.48, 1]);
  }

  function drawPlayer(gl, pos, tileWidth, tileHeight) {
    const bodyWidth = tileWidth * 0.18;
    const bodyHeight = tileHeight * 0.62;
    const centerX = pos.x;
    const centerY = pos.y + tileHeight * 0.33;

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

    const headRadius = Math.max(5, tileHeight * 0.11);
    const headCenterX = centerX;
    const headCenterY = centerY - bodyHeight / 2 - headRadius * 0.2;
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

  function renderWorld() {
    const dom = State.dom;
    const world = State.world;
    const camera = State.camera;
    const render = State.render;
    const gl = dom.gl;
    const zoom = camera.zoom || 1;
    const tileWidth = world.tileWidth * zoom;
    const tileHeight = world.tileHeight * zoom;

    if (!gl || !render.program || !world.terrain.length) return;

    gl.clearColor(render.clearColor[0], render.clearColor[1], render.clearColor[2], render.clearColor[3]);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.useProgram(render.program);
    gl.uniform2f(render.resolutionLocation, dom.canvas.clientWidth, dom.canvas.clientHeight);

    for (let row = 0; row < world.rows; row++) {
      for (let col = 0; col < world.cols; col++) {
        const tile = world.terrain[row][col];
        const pos = gridToScreen(row, col);
        const isHovered = world.hover && world.hover.row === row && world.hover.col === col;
        const isSelected = world.selected && world.selected.row === row && world.selected.col === col;
        drawTileWebGL(gl, pos, terrainColor(tile), tileWidth, tileHeight, isHovered || isSelected);

        if (isSelected) {
          drawSelectionMarker(gl, pos, tileWidth, tileHeight);
        }

        if (world.player && world.player.row === row && world.player.col === col) {
          drawPlayer(gl, pos, tileWidth, tileHeight);
        }
      }
    }
  }

  function drawTile(ctx, x, y, tileWidth, tileHeight, color) {
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + tileWidth / 2, y + tileHeight / 2);
    ctx.lineTo(x, y + tileHeight);
    ctx.lineTo(x - tileWidth / 2, y + tileHeight / 2);
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
    terrainColor
  };
})();
