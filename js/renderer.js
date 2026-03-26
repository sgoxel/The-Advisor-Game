/*
  FILE PURPOSE:
  Render the rectangular game world with WebGL using true 3D perspective projection.
*/

window.Game = window.Game || {};

(function () {
  const State = window.Game.State;
  const Config = window.Game.Config;

  const COLOR_VERTEX_SHADER_SOURCE = `
    attribute vec3 a_position;
    uniform mat4 u_matrix;
    void main() {
      gl_Position = u_matrix * vec4(a_position, 1.0);
    }
  `;

  const COLOR_FRAGMENT_SHADER_SOURCE = `
    precision mediump float;
    uniform vec4 u_color;
    void main() {
      gl_FragColor = u_color;
    }
  `;

  const TEXTURE_VERTEX_SHADER_SOURCE = `
    attribute vec3 a_position;
    attribute vec2 a_texCoord;
    uniform mat4 u_matrix;
    varying vec2 v_texCoord;
    void main() {
      gl_Position = u_matrix * vec4(a_position, 1.0);
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

  const EPSILON = 0.000001;
  const WORLD_SURFACE_Y = 0.0;
  const GRID_OVERLAY_Y = 0.25;
  const MARKER_Y = 1.15;
  const WORLD_ROTATION_DEGREES = 45;

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
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      throw new Error(`Shader compile error: ${gl.getShaderInfoLog(shader)}`);
    }
    return shader;
  }

  function createProgram(gl, vs, fs) {
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
    if (render.colorProgram && render.textureProgram) return;

    const colorVs = createShader(gl, gl.VERTEX_SHADER, COLOR_VERTEX_SHADER_SOURCE);
    const colorFs = createShader(gl, gl.FRAGMENT_SHADER, COLOR_FRAGMENT_SHADER_SOURCE);
    render.colorProgram = createProgram(gl, colorVs, colorFs);
    render.positionBuffer = gl.createBuffer();
    render.colorPositionLocation = gl.getAttribLocation(render.colorProgram, "a_position");
    render.colorMatrixLocation = gl.getUniformLocation(render.colorProgram, "u_matrix");
    render.colorLocation = gl.getUniformLocation(render.colorProgram, "u_color");

    const textureVs = createShader(gl, gl.VERTEX_SHADER, TEXTURE_VERTEX_SHADER_SOURCE);
    const textureFs = createShader(gl, gl.FRAGMENT_SHADER, TEXTURE_FRAGMENT_SHADER_SOURCE);
    render.textureProgram = createProgram(gl, textureVs, textureFs);
    render.texturePositionBuffer = gl.createBuffer();
    render.textureCoordBuffer = gl.createBuffer();
    render.texturePositionLocation = gl.getAttribLocation(render.textureProgram, "a_position");
    render.textureCoordLocation = gl.getAttribLocation(render.textureProgram, "a_texCoord");
    render.textureMatrixLocation = gl.getUniformLocation(render.textureProgram, "u_matrix");
    render.textureSamplerLocation = gl.getUniformLocation(render.textureProgram, "u_texture");
    render.backgroundTexture = gl.createTexture();

    gl.bindTexture(gl.TEXTURE_2D, render.backgroundTexture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);

    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);
  }

  function getGridMetrics(scaleWidth) {
    const tileWidth = scaleWidth || State.world.tileWidth;
    const tileHeight = tileWidth;
    return { tileWidth, tileHeight, halfW: tileWidth / 2, halfH: tileHeight / 2, ratio: 1 };
  }

  function degToRad(value) {
    return (value * Math.PI) / 180;
  }

  function clampPitch(value) {
    return Math.max(1, Math.min(89.999, value));
  }

  function vec3Subtract(a, b) {
    return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  }

  function vec3Add(a, b) {
    return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
  }

  function vec3Scale(v, s) {
    return [v[0] * s, v[1] * s, v[2] * s];
  }

  function vec3Dot(a, b) {
    return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  }

  function vec3Cross(a, b) {
    return [
      a[1] * b[2] - a[2] * b[1],
      a[2] * b[0] - a[0] * b[2],
      a[0] * b[1] - a[1] * b[0]
    ];
  }

  function vec3Length(v) {
    return Math.hypot(v[0], v[1], v[2]);
  }

  function vec3Normalize(v) {
    const len = vec3Length(v) || 1;
    return [v[0] / len, v[1] / len, v[2] / len];
  }

  function mat4Identity() {
    return new Float32Array([
      1, 0, 0, 0,
      0, 1, 0, 0,
      0, 0, 1, 0,
      0, 0, 0, 1
    ]);
  }

  function mat4Multiply(a, b) {
    const out = new Float32Array(16);
    for (let col = 0; col < 4; col++) {
      for (let row = 0; row < 4; row++) {
        out[col * 4 + row] =
          a[0 * 4 + row] * b[col * 4 + 0] +
          a[1 * 4 + row] * b[col * 4 + 1] +
          a[2 * 4 + row] * b[col * 4 + 2] +
          a[3 * 4 + row] * b[col * 4 + 3];
      }
    }
    return out;
  }

  function mat4Perspective(fovyRad, aspect, near, far) {
    const f = 1.0 / Math.tan(fovyRad / 2);
    const nf = 1 / (near - far);
    return new Float32Array([
      f / aspect, 0, 0, 0,
      0, f, 0, 0,
      0, 0, (far + near) * nf, -1,
      0, 0, (2 * far * near) * nf, 0
    ]);
  }

  function mat4LookAt(eye, target, up) {
    const zAxis = vec3Normalize(vec3Subtract(eye, target));
    const xAxis = vec3Normalize(vec3Cross(up, zAxis));
    const yAxis = vec3Cross(zAxis, xAxis);

    return new Float32Array([
      xAxis[0], yAxis[0], zAxis[0], 0,
      xAxis[1], yAxis[1], zAxis[1], 0,
      xAxis[2], yAxis[2], zAxis[2], 0,
      -vec3Dot(xAxis, eye), -vec3Dot(yAxis, eye), -vec3Dot(zAxis, eye), 1
    ]);
  }

  function mat4Invert(m) {
    const out = new Float32Array(16);
    const b00 = m[0] * m[5] - m[1] * m[4];
    const b01 = m[0] * m[6] - m[2] * m[4];
    const b02 = m[0] * m[7] - m[3] * m[4];
    const b03 = m[1] * m[6] - m[2] * m[5];
    const b04 = m[1] * m[7] - m[3] * m[5];
    const b05 = m[2] * m[7] - m[3] * m[6];
    const b06 = m[8] * m[13] - m[9] * m[12];
    const b07 = m[8] * m[14] - m[10] * m[12];
    const b08 = m[8] * m[15] - m[11] * m[12];
    const b09 = m[9] * m[14] - m[10] * m[13];
    const b10 = m[9] * m[15] - m[11] * m[13];
    const b11 = m[10] * m[15] - m[11] * m[14];

    let det = b00 * b11 - b01 * b10 + b02 * b09 + b03 * b08 - b04 * b07 + b05 * b06;
    if (!det) return null;
    det = 1.0 / det;

    out[0] = (m[5] * b11 - m[6] * b10 + m[7] * b09) * det;
    out[1] = (-m[1] * b11 + m[2] * b10 - m[3] * b09) * det;
    out[2] = (m[13] * b05 - m[14] * b04 + m[15] * b03) * det;
    out[3] = (-m[9] * b05 + m[10] * b04 - m[11] * b03) * det;
    out[4] = (-m[4] * b11 + m[6] * b08 - m[7] * b07) * det;
    out[5] = (m[0] * b11 - m[2] * b08 + m[3] * b07) * det;
    out[6] = (-m[12] * b05 + m[14] * b02 - m[15] * b01) * det;
    out[7] = (m[8] * b05 - m[10] * b02 + m[11] * b01) * det;
    out[8] = (m[4] * b10 - m[5] * b08 + m[7] * b06) * det;
    out[9] = (-m[0] * b10 + m[1] * b08 - m[3] * b06) * det;
    out[10] = (m[12] * b04 - m[13] * b02 + m[15] * b00) * det;
    out[11] = (-m[8] * b04 + m[9] * b02 - m[11] * b00) * det;
    out[12] = (-m[4] * b09 + m[5] * b07 - m[6] * b06) * det;
    out[13] = (m[0] * b09 - m[1] * b07 + m[2] * b06) * det;
    out[14] = (-m[12] * b03 + m[13] * b01 - m[14] * b00) * det;
    out[15] = (m[8] * b03 - m[9] * b01 + m[10] * b00) * det;
    return out;
  }

  function transformPoint(matrix, x, y, z, w) {
    const iw = w === undefined ? 1 : w;
    return [
      matrix[0] * x + matrix[4] * y + matrix[8] * z + matrix[12] * iw,
      matrix[1] * x + matrix[5] * y + matrix[9] * z + matrix[13] * iw,
      matrix[2] * x + matrix[6] * y + matrix[10] * z + matrix[14] * iw,
      matrix[3] * x + matrix[7] * y + matrix[11] * z + matrix[15] * iw
    ];
  }

  function getWorldSize(metrics) {
    return {
      width: State.world.cols * metrics.tileWidth,
      depth: State.world.rows * metrics.tileHeight
    };
  }


  function getWorldCenter(metrics) {
    const size = getWorldSize(metrics);
    return {
      x: size.width / 2,
      z: size.depth / 2
    };
  }

  function rotateAroundCenter(x, z, angleRad, center) {
    const dx = x - center.x;
    const dz = z - center.z;
    const cosA = Math.cos(angleRad);
    const sinA = Math.sin(angleRad);
    return {
      x: center.x + dx * cosA - dz * sinA,
      z: center.z + dx * sinA + dz * cosA
    };
  }

  function logicalToRenderXZ(x, z) {
    const metrics = getGridMetrics();
    return rotateAroundCenter(x, z, degToRad(WORLD_ROTATION_DEGREES), getWorldCenter(metrics));
  }

  function renderToLogicalXZ(x, z) {
    const metrics = getGridMetrics();
    return rotateAroundCenter(x, z, degToRad(-WORLD_ROTATION_DEGREES), getWorldCenter(metrics));
  }


  function convertRenderDeltaToCameraDelta(renderDx, renderDz) {
    const angleRad = degToRad(WORLD_ROTATION_DEGREES);
    const cosA = Math.cos(angleRad);
    const sinA = Math.sin(angleRad);

    const logicalDx = renderDx * cosA + renderDz * sinA;
    const logicalDz = -renderDx * sinA + renderDz * cosA;

    return {
      dx: -logicalDx,
      dy: -logicalDz
    };
  }

  function getCameraTarget(metrics) {
    const size = getWorldSize(metrics);
    return {
      x: size.width / 2 - State.camera.x,
      z: size.depth / 2 - State.camera.y
    };
  }

  function getCameraDistance(metrics, aspect, pitchRad) {
    const size = getWorldSize(metrics);
    const zoom = Math.max(State.camera.zoom || 1, 0.01);
    const depthStrength = Math.max(0.05, State.camera.depthStrength || 1);

    const fovY = degToRad(45);
    const fovX = 2 * Math.atan(Math.tan(fovY / 2) * Math.max(0.001, aspect));

    const fitWidthDistance = (size.width * 0.5) / Math.tan(fovX / 2);
    const projectedDepth = (size.depth * 0.5) * Math.max(0.2, Math.sin(pitchRad));
    const fitDepthDistance = projectedDepth / Math.tan(fovY / 2);

    const baseDistance = Math.max(fitWidthDistance, fitDepthDistance);
    const depthFactor = 0.72 + depthStrength * 0.08;

    return (baseDistance * depthFactor) / zoom;
  }

  function getProjectionData() {
    const canvas = State.dom.canvas;
    const metrics = getGridMetrics();
    const aspect = Math.max(0.001, canvas.clientWidth / Math.max(1, canvas.clientHeight));
    const pitchRad = degToRad(clampPitch(State.camera.pitchAngle || 90));
    const target = getCameraTarget(metrics);
    const renderTarget = logicalToRenderXZ(target.x, target.z);
    const distance = getCameraDistance(metrics, aspect, pitchRad);
    const eye = [
      renderTarget.x,
      Math.max(2, Math.sin(pitchRad) * distance),
      renderTarget.z + Math.max(2, Math.cos(pitchRad) * distance)
    ];
    const targetVec = [renderTarget.x, WORLD_SURFACE_Y, renderTarget.z];
    const up = [0, 1, 0];

    const size = getWorldSize(metrics);
    const far = Math.max(4000, distance + Math.max(size.width, size.depth) * 4);
    const projection = mat4Perspective(degToRad(45), aspect, 0.1, far);
    const view = mat4LookAt(eye, targetVec, up);
    const viewProjection = mat4Multiply(projection, view);
    const inverseViewProjection = mat4Invert(viewProjection) || mat4Identity();

    return {
      metrics,
      eye,
      target: targetVec,
      projection,
      view,
      viewProjection,
      inverseViewProjection,
      canvasWidth: canvas.clientWidth,
      canvasHeight: canvas.clientHeight
    };
  }

  function projectWorldToScreen(worldX, worldY, worldZ) {
    const pd = getProjectionData();
    const rotated = logicalToRenderXZ(worldX, worldZ);
    const clip = transformPoint(pd.viewProjection, rotated.x, worldY, rotated.z, 1);
    const invW = Math.abs(clip[3]) > EPSILON ? 1 / clip[3] : 1;
    const ndcX = clip[0] * invW;
    const ndcY = clip[1] * invW;
    return {
      x: ((ndcX + 1) * 0.5) * pd.canvasWidth,
      y: ((1 - ndcY) * 0.5) * pd.canvasHeight,
      visible: clip[3] > 0
    };
  }

  function screenToWorldOnGround(screenX, screenY) {
    const pd = getProjectionData();
    const ndcX = (screenX / Math.max(1, pd.canvasWidth)) * 2 - 1;
    const ndcY = 1 - (screenY / Math.max(1, pd.canvasHeight)) * 2;

    const nearPoint = transformPoint(pd.inverseViewProjection, ndcX, ndcY, -1, 1);
    const farPoint = transformPoint(pd.inverseViewProjection, ndcX, ndcY, 1, 1);

    const near = [nearPoint[0] / nearPoint[3], nearPoint[1] / nearPoint[3], nearPoint[2] / nearPoint[3]];
    const far = [farPoint[0] / farPoint[3], farPoint[1] / farPoint[3], farPoint[2] / farPoint[3]];
    const direction = vec3Subtract(far, near);

    if (Math.abs(direction[1]) < EPSILON) return null;
    const t = (WORLD_SURFACE_Y - near[1]) / direction[1];
    if (t < 0) return null;

    const renderHit = {
      x: near[0] + direction[0] * t,
      z: near[2] + direction[2] * t
    };
    return renderToLogicalXZ(renderHit.x, renderHit.z);
  }

  function gridToWorld(row, col, tileWidth) {
    const metrics = getGridMetrics(tileWidth);
    return {
      x: col * metrics.tileWidth + metrics.halfW,
      z: row * metrics.tileHeight + metrics.halfH
    };
  }

  function gridToScreen(row, col, offsetX, offsetY, tileWidth) {
    const world = gridToWorld(row, col, tileWidth);
    const projected = projectWorldToScreen(world.x, WORLD_SURFACE_Y, world.z);
    return {
      x: projected.x + (offsetX || 0),
      y: projected.y + (offsetY || 0)
    };
  }

  function screenToGridFloat(x, y) {
    const hit = screenToWorldOnGround(x, y);
    if (!hit) return { row: -1, col: -1 };
    const metrics = getGridMetrics();
    return {
      row: hit.z / metrics.tileHeight - 0.5,
      col: hit.x / metrics.tileWidth - 0.5
    };
  }

  function pointInRect(px, py, cx, cy, tileWidth) {
    const metrics = getGridMetrics(tileWidth);
    return Math.abs(px - cx) <= metrics.halfW && Math.abs(py - cy) <= metrics.halfH;
  }

  function centerCameraOnWorld(x, z) {
    const metrics = getGridMetrics();
    const size = getWorldSize(metrics);
    const nextX = size.width / 2 - x;
    const nextY = size.depth / 2 - z;
    if (Math.abs(State.camera.x - nextX) > 0.01 || Math.abs(State.camera.y - nextY) > 0.01) {
      State.camera.x = nextX;
      State.camera.y = nextY;
      State.render.needsWorldRedraw = true;
    }
  }

  function getPlayerWorldPosition() {
    const player = State.world.player;
    if (!player) return { x: 0, z: 0 };
    if (!player.moving) return gridToWorld(player.row, player.col, 0);

    const start = gridToWorld(player.startRow, player.startCol, 0);
    const end = gridToWorld(player.targetRow, player.targetCol, 0);
    const t = Math.max(0, Math.min(1, player.progress || 0));
    return {
      x: start.x + (end.x - start.x) * t,
      z: start.z + (end.z - start.z) * t
    };
  }

  function centerCameraOnTile(row, col) {
    const pos = gridToWorld(row, col, 0);
    centerCameraOnWorld(pos.x, pos.z);
  }

  function centerCamera() {
    const p = getPlayerWorldPosition();
    centerCameraOnWorld(p.x, p.z);
  }

  function calculateFitZoom() {
    return 1;
  }

  function updateZoomLimits() {
    const camera = State.camera;
    camera.minZoom = 2.00;
    if (camera.maxZoom <= camera.minZoom) {
      camera.maxZoom = Math.max(camera.minZoom + 0.5, 4.00);
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
    State.render.needsWorldRedraw = true;
  }

  function pickTile(x, y) {
    const world = State.world;
    const guess = screenToGridFloat(x, y);
    const row = Math.round(guess.row);
    const col = Math.round(guess.col);
    if (row < 0 || col < 0 || row >= world.rows || col >= world.cols) return null;
    return { row, col };
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
    return [
      ((value >> 16) & 255) / 255,
      ((value >> 8) & 255) / 255,
      (value & 255) / 255,
      alpha !== undefined ? alpha : 1
    ];
  }

  function setCustomColor(gl, rgba) {
    gl.uniform4f(State.render.colorLocation, rgba[0], rgba[1], rgba[2], rgba[3]);
  }

  function useColorProgram(gl) {
    const render = State.render;
    gl.useProgram(render.colorProgram);
    gl.uniformMatrix4fv(render.colorMatrixLocation, false, getProjectionData().viewProjection);
    gl.bindBuffer(gl.ARRAY_BUFFER, render.positionBuffer);
    gl.enableVertexAttribArray(render.colorPositionLocation);
    gl.vertexAttribPointer(render.colorPositionLocation, 3, gl.FLOAT, false, 0, 0);
  }

  function useTextureProgram(gl) {
    const render = State.render;
    gl.useProgram(render.textureProgram);
    gl.uniformMatrix4fv(render.textureMatrixLocation, false, getProjectionData().viewProjection);
    gl.bindBuffer(gl.ARRAY_BUFFER, render.texturePositionBuffer);
    gl.enableVertexAttribArray(render.texturePositionLocation);
    gl.vertexAttribPointer(render.texturePositionLocation, 3, gl.FLOAT, false, 0, 0);
  }

  function drawTriangles(gl, vertices, rgba) {
    useColorProgram(gl);
    gl.bindBuffer(gl.ARRAY_BUFFER, State.render.positionBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(vertices), gl.STREAM_DRAW);
    setCustomColor(gl, rgba);
    gl.drawArrays(gl.TRIANGLES, 0, vertices.length / 3);
  }

  function drawLineLoop(gl, vertices, rgba) {
    useColorProgram(gl);
    gl.bindBuffer(gl.ARRAY_BUFFER, State.render.positionBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(vertices), gl.STREAM_DRAW);
    setCustomColor(gl, rgba);
    gl.drawArrays(gl.LINE_LOOP, 0, vertices.length / 3);
  }

  function drawLines(gl, vertices, rgba) {
    if (!vertices || !vertices.length) return;
    useColorProgram(gl);
    gl.bindBuffer(gl.ARRAY_BUFFER, State.render.positionBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(vertices), gl.STREAM_DRAW);
    setCustomColor(gl, rgba);
    gl.drawArrays(gl.LINES, 0, vertices.length / 3);
  }

  function drawEllipse2D(gl, cx, cy, radiusX, radiusY, rgba, segments) {
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

    const triangles3D = [];
    for (let i = 0; i < vertices.length; i += 2) {
      triangles3D.push(vertices[i], vertices[i + 1], 0);
    }
    useColorProgramScreenSpace(gl);
    gl.bindBuffer(gl.ARRAY_BUFFER, State.render.positionBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(triangles3D), gl.STREAM_DRAW);
    setCustomColor(gl, rgba);
    gl.drawArrays(gl.TRIANGLES, 0, triangles3D.length / 3);
  }

  function useColorProgramScreenSpace(gl) {
    const render = State.render;
    gl.useProgram(render.colorProgram);
    gl.uniformMatrix4fv(render.colorMatrixLocation, false, getScreenSpaceMatrix());
    gl.bindBuffer(gl.ARRAY_BUFFER, render.positionBuffer);
    gl.enableVertexAttribArray(render.colorPositionLocation);
    gl.vertexAttribPointer(render.colorPositionLocation, 3, gl.FLOAT, false, 0, 0);
  }

  function getScreenSpaceMatrix() {
    const w = Math.max(1, State.dom.canvas.clientWidth);
    const h = Math.max(1, State.dom.canvas.clientHeight);
    return new Float32Array([
      2 / w, 0, 0, 0,
      0, -2 / h, 0, 0,
      0, 0, 1, 0,
      -1, 1, 0, 1
    ]);
  }

  function drawCapsule2D(gl, x1, y1, x2, y2, radius, rgba) {
    const dx = x2 - x1;
    const dy = y2 - y1;
    const length = Math.hypot(dx, dy);
    if (length < EPSILON) {
      drawEllipse2D(gl, x1, y1, radius, radius, rgba, 20);
      return;
    }

    const nx = -dy / length;
    const ny = dx / length;
    const vertices = [
      x1 + nx * radius, y1 + ny * radius, 0,
      x1 - nx * radius, y1 - ny * radius, 0,
      x2 + nx * radius, y2 + ny * radius, 0,
      x2 + nx * radius, y2 + ny * radius, 0,
      x1 - nx * radius, y1 - ny * radius, 0,
      x2 - nx * radius, y2 - ny * radius, 0
    ];
    useColorProgramScreenSpace(gl);
    gl.bindBuffer(gl.ARRAY_BUFFER, State.render.positionBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(vertices), gl.STREAM_DRAW);
    setCustomColor(gl, rgba);
    gl.drawArrays(gl.TRIANGLES, 0, vertices.length / 3);
    drawEllipse2D(gl, x1, y1, radius, radius, rgba, 20);
    drawEllipse2D(gl, x2, y2, radius, radius, rgba, 20);
  }

  function getRectOutlineVertices3D(centerX, centerZ, width, depth, y) {
    const halfW = width / 2;
    const halfD = depth / 2;
    const corners = [
      { x: centerX - halfW, z: centerZ - halfD },
      { x: centerX + halfW, z: centerZ - halfD },
      { x: centerX + halfW, z: centerZ + halfD },
      { x: centerX - halfW, z: centerZ + halfD }
    ].map((point) => logicalToRenderXZ(point.x, point.z));

    return [
      corners[0].x, y, corners[0].z,
      corners[1].x, y, corners[1].z,
      corners[2].x, y, corners[2].z,
      corners[3].x, y, corners[3].z
    ];
  }

  function drawSelectionMarker(gl, row, col, tileWidth, tileHeight) {
    const pos = gridToWorld(row, col, tileWidth);
    drawLineLoop(gl, getRectOutlineVertices3D(pos.x, pos.z, tileWidth * 0.62, tileHeight * 0.62, MARKER_Y), [0.97, 0.87, 0.48, 1]);
  }

  function drawHoverMarker(gl, row, col, tileWidth, tileHeight) {
    const pos = gridToWorld(row, col, tileWidth);
    drawLineLoop(gl, getRectOutlineVertices3D(pos.x, pos.z, tileWidth * 0.92, tileHeight * 0.92, MARKER_Y), [0.97, 0.87, 0.48, 0.65]);
  }

  function drawArrowMarker(gl, fromRow, fromCol, toRow, toCol, tileWidth, tileHeight) {
    const fromPos = gridToWorld(fromRow, fromCol, tileWidth);
    const toPos = gridToWorld(toRow, toCol, tileWidth);
    const dx = toPos.x - fromPos.x;
    const dz = toPos.z - fromPos.z;
    const length = Math.hypot(dx, dz) || 1;
    const ux = dx / length;
    const uz = dz / length;
    const px = -uz;
    const pz = ux;
    const bodyLength = tileHeight * 0.95;
    const headLength = tileHeight * 0.55;
    const bodyHalf = tileHeight * 0.14;
    const headHalf = tileHeight * 0.28;
    const sx = fromPos.x;
    const sz = fromPos.z;
    const bx = sx + ux * bodyLength;
    const bz = sz + uz * bodyLength;
    const hx = bx + ux * headLength;
    const hz = bz + uz * headLength;
    const y = MARKER_Y;

    const bodyPoints = [
      { x: sx + px * bodyHalf, z: sz + pz * bodyHalf },
      { x: sx - px * bodyHalf, z: sz - pz * bodyHalf },
      { x: bx + px * bodyHalf, z: bz + pz * bodyHalf },
      { x: bx + px * bodyHalf, z: bz + pz * bodyHalf },
      { x: sx - px * bodyHalf, z: sz - pz * bodyHalf },
      { x: bx - px * bodyHalf, z: bz - pz * bodyHalf }
    ].map((point) => logicalToRenderXZ(point.x, point.z));

    drawTriangles(gl, [
      bodyPoints[0].x, y, bodyPoints[0].z,
      bodyPoints[1].x, y, bodyPoints[1].z,
      bodyPoints[2].x, y, bodyPoints[2].z,
      bodyPoints[3].x, y, bodyPoints[3].z,
      bodyPoints[4].x, y, bodyPoints[4].z,
      bodyPoints[5].x, y, bodyPoints[5].z
    ], [0.39, 0.07, 0.18, 0.72]);

    const headPoints = [
      { x: bx + px * headHalf, z: bz + pz * headHalf },
      { x: bx - px * headHalf, z: bz - pz * headHalf },
      { x: hx, z: hz }
    ].map((point) => logicalToRenderXZ(point.x, point.z));

    drawTriangles(gl, [
      headPoints[0].x, y, headPoints[0].z,
      headPoints[1].x, y, headPoints[1].z,
      headPoints[2].x, y, headPoints[2].z
    ], [0.57, 0.13, 0.27, 0.94]);
  }

  function drawPreviewRoute(gl, path, metrics) {
    if (!path || path.length < 2) return;
    for (let i = 0; i < path.length - 1; i++) {
      drawArrowMarker(gl, path[i].row, path[i].col, path[i + 1].row, path[i + 1].col, metrics.tileWidth, metrics.tileHeight);
    }
  }


  function getProjectedTileScreenSize(worldPos, tileWidth, tileHeight) {
    const center = projectWorldToScreen(worldPos.x, WORLD_SURFACE_Y, worldPos.z);
    const east = projectWorldToScreen(worldPos.x + tileWidth, WORLD_SURFACE_Y, worldPos.z);
    const south = projectWorldToScreen(worldPos.x, WORLD_SURFACE_Y, worldPos.z + tileHeight);

    const dx = Math.hypot(east.x - center.x, east.y - center.y);
    const dz = Math.hypot(south.x - center.x, south.y - center.y);

    return Math.max(1, Math.min(dx, dz));
  }

  function drawPlayer(gl, worldPos, tileWidth, tileHeight) {
    const projected = projectWorldToScreen(worldPos.x, WORLD_SURFACE_Y, worldPos.z);
    const screenTileSize = getProjectedTileScreenSize(worldPos, tileWidth, tileHeight);
    const unit = Math.max(1.35, screenTileSize * 0.26);
    const centerX = projected.x;
    const groundY = projected.y;
    const white = [0.93, 0.94, 0.96, 1];
    const mid = [0.82, 0.84, 0.88, 1];
    const dark = [0.58, 0.61, 0.68, 1];
    const shadow = [0.16, 0.24, 0.16, 0.18];
    const softShade = [0.74, 0.76, 0.82, 0.32];
    const outline = [0.34, 0.36, 0.42, 0.50];

    drawEllipse2D(gl, centerX + unit * 0.5, groundY + unit * 0.2, unit * 1.7, unit * 0.58, shadow, 32);
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

    drawCapsule2D(gl, leftHipX, pelvisY + unit * 0.1, leftKneeX, kneeY, unit * 0.25, white);
    drawCapsule2D(gl, rightHipX, pelvisY + unit * 0.1, rightKneeX, kneeY, unit * 0.25, white);
    drawCapsule2D(gl, leftKneeX, kneeY, leftAnkleX, ankleY, unit * 0.2, white);
    drawCapsule2D(gl, rightKneeX, kneeY, rightAnkleX, ankleY, unit * 0.2, white);
    drawEllipse2D(gl, leftAnkleX, groundY + unit * 0.03, unit * 0.30, unit * 0.15, mid, 22);
    drawEllipse2D(gl, rightAnkleX, groundY + unit * 0.03, unit * 0.30, unit * 0.15, mid, 22);
    drawEllipse2D(gl, centerX, pelvisY + unit * 0.12, unit * 0.72, unit * 0.32, white, 24);
    drawEllipse2D(gl, centerX, waistY, unit * 0.62, unit * 0.18, mid, 18);
    drawEllipse2D(gl, centerX, abdomenY, unit * 0.78, unit * 0.46, white, 26);
    drawEllipse2D(gl, centerX, chestY, unit * 0.98, unit * 0.78, white, 28);
    drawEllipse2D(gl, centerX, shoulderY - unit * 0.04, unit * 0.72, unit * 0.22, mid, 18);
    drawEllipse2D(gl, centerX - unit * 0.80, shoulderY, unit * 0.30, unit * 0.24, white, 20);
    drawEllipse2D(gl, centerX + unit * 0.80, shoulderY, unit * 0.30, unit * 0.24, white, 20);
    const leftShoulderX = centerX - unit * 0.88;
    const rightShoulderX = centerX + unit * 0.88;
    const elbowY = pelvisY - unit * 0.78;
    const wristY = groundY - unit * 1.24;
    const leftElbowX = centerX - unit * 0.90;
    const rightElbowX = centerX + unit * 0.90;
    const leftWristX = centerX - unit * 0.84;
    const rightWristX = centerX + unit * 0.84;
    drawCapsule2D(gl, leftShoulderX, shoulderY + unit * 0.04, leftElbowX, elbowY, unit * 0.15, white);
    drawCapsule2D(gl, rightShoulderX, shoulderY + unit * 0.04, rightElbowX, elbowY, unit * 0.15, white);
    drawCapsule2D(gl, leftElbowX, elbowY, leftWristX, wristY, unit * 0.12, white);
    drawCapsule2D(gl, rightElbowX, elbowY, rightWristX, wristY, unit * 0.12, white);
    drawEllipse2D(gl, leftWristX, wristY + unit * 0.10, unit * 0.11, unit * 0.15, mid, 16);
    drawEllipse2D(gl, rightWristX, wristY + unit * 0.10, unit * 0.11, unit * 0.15, mid, 16);
    drawEllipse2D(gl, centerX, neckY, unit * 0.18, unit * 0.14, mid, 16);
    drawEllipse2D(gl, centerX, headY, unit * 0.42, unit * 0.58, white, 28);
    drawEllipse2D(gl, centerX + unit * 0.16, headY, unit * 0.10, unit * 0.40, dark, 16);
    drawEllipse2D(gl, centerX + unit * 0.18, chestY + unit * 0.06, unit * 0.16, unit * 0.72, softShade, 16);

    const outlineVertices = [
      centerX - unit * 0.28, headY - unit * 0.46, 0,
      centerX + unit * 0.10, headY - unit * 0.54, 0,
      centerX + unit * 0.40, headY - unit * 0.06, 0,
      centerX + unit * 0.16, headY + unit * 0.46, 0,
      centerX - unit * 0.22, headY + unit * 0.44, 0,
      centerX - unit * 0.42, headY - unit * 0.06, 0
    ];
    useColorProgramScreenSpace(gl);
    gl.bindBuffer(gl.ARRAY_BUFFER, State.render.positionBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(outlineVertices), gl.STREAM_DRAW);
    setCustomColor(gl, outline);
    gl.drawArrays(gl.LINE_LOOP, 0, outlineVertices.length / 3);
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
    const canvas = document.createElement("canvas");
    canvas.width = resolution.width;
    canvas.height = resolution.height;

    const ctx = canvas.getContext("2d", { alpha: false });
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
    const width = world.cols * metrics.tileWidth;
    const depth = world.rows * metrics.tileHeight;

    const c00 = logicalToRenderXZ(0, 0);
    const c10 = logicalToRenderXZ(width, 0);
    const c01 = logicalToRenderXZ(0, depth);
    const c11 = logicalToRenderXZ(width, depth);

    const positions = [
      c00.x, WORLD_SURFACE_Y, c00.z,
      c10.x, WORLD_SURFACE_Y, c10.z,
      c01.x, WORLD_SURFACE_Y, c01.z,
      c01.x, WORLD_SURFACE_Y, c01.z,
      c10.x, WORLD_SURFACE_Y, c10.z,
      c11.x, WORLD_SURFACE_Y, c11.z
    ];

    const texCoords = [
      0, 1,
      1, 1,
      0, 0,
      0, 0,
      1, 1,
      1, 0
    ];

    useTextureProgram(gl);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, render.backgroundTexture);
    gl.uniform1i(render.textureSamplerLocation, 0);

    gl.bindBuffer(gl.ARRAY_BUFFER, render.texturePositionBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(positions), gl.STREAM_DRAW);
    gl.enableVertexAttribArray(render.texturePositionLocation);
    gl.vertexAttribPointer(render.texturePositionLocation, 3, gl.FLOAT, false, 0, 0);

    gl.bindBuffer(gl.ARRAY_BUFFER, render.textureCoordBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(texCoords), gl.STREAM_DRAW);
    gl.enableVertexAttribArray(render.textureCoordLocation);
    gl.vertexAttribPointer(render.textureCoordLocation, 2, gl.FLOAT, false, 0, 0);

    gl.drawArrays(gl.TRIANGLES, 0, 6);
  }

  function drawGridOverlay(gl, metrics) {
    const world = State.world;
    const width = world.cols * metrics.tileWidth;
    const depth = world.rows * metrics.tileHeight;
    const lineVertices = [];

    for (let col = 0; col <= world.cols; col++) {
      const x = col * metrics.tileWidth;
      const start = logicalToRenderXZ(x, 0);
      const end = logicalToRenderXZ(x, depth);
      lineVertices.push(start.x, GRID_OVERLAY_Y, start.z, end.x, GRID_OVERLAY_Y, end.z);
    }

    for (let row = 0; row <= world.rows; row++) {
      const z = row * metrics.tileHeight;
      const start = logicalToRenderXZ(0, z);
      const end = logicalToRenderXZ(width, z);
      lineVertices.push(start.x, GRID_OVERLAY_Y, start.z, end.x, GRID_OVERLAY_Y, end.z);
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

    gl.viewport(0, 0, dom.canvas.width, dom.canvas.height);
    gl.clearColor(render.clearColor[0], render.clearColor[1], render.clearColor[2], render.clearColor[3]);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

    drawBackgroundQuad(gl, metrics);
    drawGridOverlay(gl, metrics);

    if (world.hover) drawHoverMarker(gl, world.hover.row, world.hover.col, metrics.tileWidth, metrics.tileHeight);
    if (world.selected) drawSelectionMarker(gl, world.selected.row, world.selected.col, metrics.tileWidth, metrics.tileHeight);
    if (world.previewPath && world.previewPath.length > 1) drawPreviewRoute(gl, world.previewPath, metrics);

    if (world.player) {
      const playerPos = getPlayerWorldPosition();
      drawPlayer(gl, playerPos, metrics.tileWidth, metrics.tileHeight);
    }

    render.needsWorldRedraw = false;
  }

  function drawTile(ctx, x, y, tileWidth, tileHeight, color) {
    ctx.fillStyle = color;
    ctx.fillRect(x - tileWidth / 2, y - tileHeight / 2, tileWidth, tileHeight);
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
    fitCameraToWorld,
    convertRenderDeltaToCameraDelta
  };
})();