/*
  FILE PURPOSE:
  Handle mouse and keyboard input for camera, tile picking, and zoom.
*/

window.Game = window.Game || {};

(function () {
  const State = window.Game.State;
  const Renderer = window.Game.Renderer;
  const UI = window.Game.UI;
  const Utils = window.Game.Utils;

  function getHexNeighbors(row, col) {
    const odd = row & 1;
    return [
      { row, col: col - 1 },
      { row, col: col + 1 },
      { row: row - 1, col: col + (odd ? 0 : -1) },
      { row: row - 1, col: col + (odd ? 1 : 0) },
      { row: row + 1, col: col + (odd ? 0 : -1) },
      { row: row + 1, col: col + (odd ? 1 : 0) }
    ];
  }

  function isInsideWorld(row, col) {
    return row >= 0 && row < State.world.rows && col >= 0 && col < State.world.cols;
  }

  function getTile(row, col) {
    if (!isInsideWorld(row, col)) return null;
    return State.world.terrain[row] ? State.world.terrain[row][col] : null;
  }

  function isBlockedTile(row, col) {
    const tile = getTile(row, col);
    if (!tile) return true;
    if (tile.type === 'water' || tile.type === 'forest' || tile.type === 'forestHill' || tile.type === 'hillStone') return true;
    if (tile.blocked === true || tile.obstacle === true) return true;
    if (tile.tags && (tile.tags.has('obstacle') || tile.tags.has('blocked'))) return true;
    return false;
  }

  function stepCost(row, col, mode) {
    const tile = getTile(row, col);
    if (!tile) return Infinity;
    if (isBlockedTile(row, col)) return Infinity;

    const onRoad = tile.type === 'road' || (tile.tags && tile.tags.has('road'));
    const onSettlement = tile.type === 'settlement';
    const onHill = tile.type === 'hillGrass' || tile.type === 'dirtHill';

    if (mode === 'roadPreferred') {
      if (onRoad) return 0.65;
      if (onSettlement) return 1.1;
      if (onHill) return 2.4;
      return 1.9;
    }

    if (onRoad) return 0.85;
    if (onSettlement) return 1.0;
    if (onHill) return 1.8;
    return 1.0;
  }

  function heuristic(row, col, targetRow, targetCol) {
    return Math.abs(targetRow - row) + Math.abs(targetCol - col);
  }

  function reconstructPath(parent, startKey, targetKey) {
    if (!parent.has(targetKey) && startKey !== targetKey) return [];
    const path = [];
    let cursor = targetKey;
    while (cursor) {
      const [row, col] = cursor.split(',').map(Number);
      path.push({ row, col });
      if (cursor === startKey) break;
      cursor = parent.get(cursor);
    }
    path.reverse();
    return path;
  }

  function findPathWithMode(startRow, startCol, targetRow, targetCol, mode) {
    if (!isInsideWorld(targetRow, targetCol) || isBlockedTile(targetRow, targetCol)) return [];
    const startKey = `${startRow},${startCol}`;
    const targetKey = `${targetRow},${targetCol}`;
    if (startKey === targetKey) return [{ row: startRow, col: startCol }];

    const open = [{ row: startRow, col: startCol, key: startKey, priority: 0 }];
    const parent = new Map();
    const gScore = new Map([[startKey, 0]]);
    const closed = new Set();

    while (open.length) {
      open.sort((a, b) => a.priority - b.priority);
      const current = open.shift();
      if (!current) break;
      if (closed.has(current.key)) continue;
      if (current.key === targetKey) {
        return reconstructPath(parent, startKey, targetKey);
      }
      closed.add(current.key);

      const neighbors = getHexNeighbors(current.row, current.col);
      for (const next of neighbors) {
        if (!isInsideWorld(next.row, next.col) || isBlockedTile(next.row, next.col)) continue;
        const nextKey = `${next.row},${next.col}`;
        const tentative = (gScore.get(current.key) || 0) + stepCost(next.row, next.col, mode);
        if (tentative >= (gScore.get(nextKey) ?? Infinity)) continue;
        parent.set(nextKey, current.key);
        gScore.set(nextKey, tentative);
        open.push({
          row: next.row,
          col: next.col,
          key: nextKey,
          priority: tentative + heuristic(next.row, next.col, targetRow, targetCol)
        });
      }
    }

    return [];
  }

  function chooseBestPath(targetRow, targetCol) {
    const world = State.world;
    const player = world.player;
    const startRow = player.moving ? player.targetRow : player.row;
    const startCol = player.moving ? player.targetCol : player.col;

    const directPath = findPathWithMode(startRow, startCol, targetRow, targetCol, 'direct');
    const roadPath = findPathWithMode(startRow, startCol, targetRow, targetCol, 'roadPreferred');

    if (!roadPath.length) return directPath;
    if (!directPath.length) return roadPath;

    const directSteps = Math.max(0, directPath.length - 1);
    const roadSteps = Math.max(0, roadPath.length - 1);

    if (roadSteps <= Math.ceil(directSteps * 1.5)) {
      const roadTileCount = roadPath.reduce((count, node) => {
        const tile = getTile(node.row, node.col);
        return count + ((tile && (tile.type === 'road' || (tile.tags && tile.tags.has('road')))) ? 1 : 0);
      }, 0);
      if (roadTileCount >= 2) return roadPath;
    }

    return directPath;
  }

  function buildPathToTarget(targetRow, targetCol) {
    return chooseBestPath(targetRow, targetCol);
  }

  function getCanvasMousePosition(event) {
    const canvas = State.dom.canvas;
    const rect = canvas.getBoundingClientRect();

    return {
      x: event.clientX - rect.left,
      y: event.clientY - rect.top
    };
  }

  function startMoveAlongPath(path) {
    const player = State.world.player;
    if (!path || path.length < 2) return false;
    player.pathQueue = path.slice(1);
    player.moving = false;
    player.progress = 1;
    player.startRow = player.row;
    player.startCol = player.col;
    advanceToNextQueuedStep(performance.now());
    return true;
  }

  function advanceToNextQueuedStep(now) {
    const player = State.world.player;
    if (!player.pathQueue || !player.pathQueue.length) {
      player.moving = false;
      player.progress = 1;
      Renderer.centerCamera();
      return false;
    }

    const next = player.pathQueue.shift();
    player.startRow = player.row;
    player.startCol = player.col;
    player.targetRow = next.row;
    player.targetCol = next.col;
    player.moveStartTime = now;
    player.progress = 0;
    player.moving = true;
    return true;
  }

  function bindInputEvents() {
    const dom = State.dom;
    const camera = State.camera;
    const input = State.input;
    const world = State.world;

    dom.canvas.addEventListener('mousemove', (event) => {
      const pos = getCanvasMousePosition(event);

      if (camera.dragActive) {
        const dx = pos.x - camera.lastX;
        const dy = pos.y - camera.lastY;

        if (Math.abs(dx) > 1 || Math.abs(dy) > 1) {
          camera.movedWhileDragging = true;
        }

        camera.x += dx;
        camera.y += dy;
        camera.lastX = pos.x;
        camera.lastY = pos.y;
        Renderer.markDirty();
      }

      const picked = Renderer.pickTile(pos.x, pos.y);
      if ((picked && (!world.hover || world.hover.row !== picked.row || world.hover.col !== picked.col)) || (!picked && world.hover)) {
        world.hover = picked;
        Renderer.markDirty(true, false);
      }
    });

    dom.canvas.addEventListener('mousedown', (event) => {
      if (event.button !== 0) return;
      const pos = getCanvasMousePosition(event);
      camera.dragActive = true;
      camera.movedWhileDragging = false;
      camera.lastX = pos.x;
      camera.lastY = pos.y;
      dom.canvas.classList.add('dragging');
    });

    dom.canvas.addEventListener('wheel', (event) => {
      event.preventDefault();
      const oldZoom = camera.zoom;
      const direction = event.deltaY < 0 ? 1 : -1;
      const newZoom = Utils.clamp(Number((oldZoom + direction * camera.zoomStep).toFixed(2)), camera.minZoom, camera.maxZoom);
      if (newZoom !== oldZoom) {
        camera.zoom = newZoom;
        Renderer.markDirty();
        UI.addLog(`Zoom değiştirildi: ${newZoom.toFixed(2)}x`);
      }
    }, { passive: false });

    window.addEventListener('mouseup', () => {
      camera.dragActive = false;
      dom.canvas.classList.remove('dragging');
    });

    dom.canvas.addEventListener('mouseleave', () => {
      camera.dragActive = false;
      dom.canvas.classList.remove('dragging');
      if (world.hover) {
        world.hover = null;
        Renderer.markDirty(true, false);
      }
    });

    dom.canvas.addEventListener('click', (event) => {
      if (camera.movedWhileDragging) {
        camera.movedWhileDragging = false;
        return;
      }

      const pos = getCanvasMousePosition(event);
      const picked = Renderer.pickTile(pos.x, pos.y);
      if (!picked) return;

      const now = performance.now();
      const sameTile = input.lastTileClick && input.lastTileClick.row === picked.row && input.lastTileClick.col === picked.col;
      const withinThreshold = sameTile && (now - input.lastTileClickTime) <= input.doubleClickThresholdMs;

      world.selected = picked;
      world.previewPath = buildPathToTarget(picked.row, picked.col);
      Renderer.markDirty(true, true);

      if (withinThreshold && world.previewPath.length > 1) {
        startMoveAlongPath(world.previewPath);
        UI.addLog(`Çift tık ile hareket başlatıldı: satır=${picked.row}, sütun=${picked.col}`);
        input.lastTileClick = null;
        input.lastTileClickTime = 0;
      } else {
        UI.addLog(`Tile seçildi: satır=${picked.row}, sütun=${picked.col}`);
        input.lastTileClick = picked;
        input.lastTileClickTime = now;
      }
    });

    window.addEventListener('keydown', (event) => {
      if (!dom.settingsModal.classList.contains('hidden')) {
        if (event.key === 'Escape') UI.closeSettingsModal();
        return;
      }
      if (!dom.logModal.classList.contains('hidden')) {
        if (event.key === 'Escape') UI.closeLogModal();
        return;
      }
      const key = event.key.toLowerCase();
      if (['w','a','s','d'].includes(key)) event.preventDefault();
      input.keys.add(key);
    });

    window.addEventListener('keyup', (event) => {
      input.keys.delete(event.key.toLowerCase());
    });
  }

  function updateCameraFromKeyboard() {
    const input = State.input;
    const camera = State.camera;
    let moved = false;

    if (input.keys.has('w') || input.keys.has('arrowup')) { camera.y += camera.moveSpeed; moved = true; }
    if (input.keys.has('s') || input.keys.has('arrowdown')) { camera.y -= camera.moveSpeed; moved = true; }
    if (input.keys.has('a') || input.keys.has('arrowleft')) { camera.x += camera.moveSpeed; moved = true; }
    if (input.keys.has('d') || input.keys.has('arrowright')) { camera.x -= camera.moveSpeed; moved = true; }

    if (moved) Renderer.markDirty();
  }

  function updatePlayerMovement(now) {
    const player = State.world.player;
    if (!player) return;
    if (!player.moving) return;

    const duration = Math.max(1, player.moveDuration || 180);
    player.progress = Math.min(1, (now - player.moveStartTime) / duration);

    if (player.progress >= 1) {
      player.row = player.targetRow;
      player.col = player.targetCol;
      player.moving = false;
      player.startRow = player.row;
      player.startCol = player.col;
      player.progress = 1;
      if (!advanceToNextQueuedStep(now)) {
        Renderer.centerCamera();
      }
    }

    Renderer.markDirty();
  }
  window.Game.Input = {
    bindInputEvents,
    updateCameraFromKeyboard,
    updatePlayerMovement,
    buildPathToTarget,
    startMoveAlongPath,
    isBlockedTile
  };
})();
