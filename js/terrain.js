/* ROAD_PATCH_V3: constrained world generation + connected settlements */
window.Game = window.Game || {};

(function () {
  const State = window.Game.State;
  const Utils = window.Game.Utils;
  const RNG = window.Game.RNG;
  const Topology = window.Game.Topology;

  function emptyTile() {
    return {
      type: "grass",
      tags: new Set(),
      elevation: 0
    };
  }

  function inBounds(row, col) {
    const world = State.world;
    return row >= 0 && row < world.rows && col >= 0 && col < world.cols;
  }

  function makeMask(rows, cols, initialValue) {
    return Array.from({ length: rows }, () => Array.from({ length: cols }, () => !!initialValue));
  }

  function tileAt(grid, row, col) {
    return inBounds(row, col) ? grid[row][col] : null;
  }

  function isReserved(reserved, row, col) {
    return !!(reserved[row] && reserved[row][col]);
  }

  function reserveTile(reserved, row, col) {
    if (reserved[row]) reserved[row][col] = true;
  }

  function stampRoadTile(grid, reserved, row, col) {
    const tile = tileAt(grid, row, col);
    if (!tile) return false;
    tile.type = "road";
    tile.elevation = 0;
    tile.tags.delete("blocked");
    tile.tags.delete("forest");
    tile.tags.delete("mountain");
    tile.tags.delete("mountainCore");
    tile.tags.delete("stream");
    tile.tags.delete("lake");
    tile.tags.add("road");
    reserveTile(reserved, row, col);
    return true;
  }

  function stampSettlementTile(grid, reserved, row, col, settlementId) {
    const tile = tileAt(grid, row, col);
    if (!tile) return false;
    tile.type = "settlement";
    tile.elevation = 0;
    tile.tags.delete("blocked");
    tile.tags.delete("forest");
    tile.tags.delete("mountain");
    tile.tags.delete("mountainCore");
    tile.tags.delete("stream");
    tile.tags.delete("lake");
    tile.tags.add("settlement");
    tile.tags.add(`settlement-${settlementId}`);
    reserveTile(reserved, row, col);
    return true;
  }

  function paintForestTile(grid, row, col) {
    const tile = tileAt(grid, row, col);
    if (!tile) return false;
    tile.type = "forest";
    tile.elevation = 0;
    tile.tags.add("forest");
    tile.tags.add("blocked");
    return true;
  }

  function paintMountainTile(grid, row, col, elevation) {
    const tile = tileAt(grid, row, col);
    if (!tile) return false;
    tile.type = "mountain";
    tile.elevation = Math.max(tile.elevation || 0, elevation || 2.8);
    tile.tags.add("mountain");
    tile.tags.add("mountainCore");
    tile.tags.add("blocked");
    return true;
  }

  function paintLakeTile(grid, row, col) {
    const tile = tileAt(grid, row, col);
    if (!tile) return false;
    tile.type = "lake";
    tile.elevation = 0;
    tile.tags.add("lake");
    tile.tags.add("blocked");
    tile.tags.delete("mountain");
    tile.tags.delete("mountainCore");
    tile.tags.delete("forest");
    return true;
  }

  function paintRiverTile(grid, row, col) {
    const tile = tileAt(grid, row, col);
    if (!tile) return false;
    tile.type = "river";
    tile.elevation = 0;
    tile.tags.add("stream");
    tile.tags.add("blocked");
    tile.tags.delete("mountain");
    tile.tags.delete("mountainCore");
    tile.tags.delete("forest");
    return true;
  }

  function tileIsBlocking(tile) {
    if (!tile) return true;
    if (tile.type === "mountain" || tile.type === "lake" || tile.type === "river" || tile.type === "forest") return true;
    return !!(tile.tags && tile.tags.has("blocked"));
  }

  function markRectangle(grid, reserved, top, left, height, width, settlementId) {
    for (let row = top; row < top + height; row++) {
      for (let col = left; col < left + width; col++) {
        stampSettlementTile(grid, reserved, row, col, settlementId);
      }
    }
  }

  function areaCenter(area) {
    return {
      row: area.top + (area.height - 1) / 2,
      col: area.left + (area.width - 1) / 2
    };
  }

  function rectsAreTooClose(a, b, padding) {
    return !(
      a.left + a.width + padding <= b.left ||
      b.left + b.width + padding <= a.left ||
      a.top + a.height + padding <= b.top ||
      b.top + b.height + padding <= a.top
    );
  }

  function chooseSettlementCount(seed) {
    return RNG.pickWeighted(seed, "settlementAreas", [2, 3, 4, 5, 6, 7, 8, 9, 10], [0.10, 0.17, 0.18, 0.16, 0.13, 0.10, 0.07, 0.05, 0.04]);
  }

  function createSettlements(grid, reserved, seed) {
    const world = State.world;
    const rng = RNG.createSeededRandom(`${seed}|settlements`);
    const targetCount = chooseSettlementCount(seed);
    const settlements = [];
    const minSettlementSize = 5;
    const maxSettlementSize = 8;
    const margin = 4;
    const spacing = Math.max(5, Math.round(Math.min(world.rows, world.cols) * 0.10));

    function clampSettlementArea(area) {
      const width = Utils.clamp(area.width, minSettlementSize, maxSettlementSize);
      const height = Utils.clamp(area.height, minSettlementSize, maxSettlementSize);
      return {
        id: area.id,
        width,
        height,
        top: Utils.clamp(area.top, 0, Math.max(0, world.rows - height)),
        left: Utils.clamp(area.left, 0, Math.max(0, world.cols - width))
      };
    }

    let attempts = 0;
    while (settlements.length < targetCount && attempts < 700) {
      attempts += 1;
      const width = minSettlementSize + Math.floor(rng() * (maxSettlementSize - minSettlementSize + 1));
      const height = minSettlementSize + Math.floor(rng() * (maxSettlementSize - minSettlementSize + 1));
      const top = Math.floor(rng() * Math.max(1, world.rows - height - margin * 2)) + margin;
      const left = Math.floor(rng() * Math.max(1, world.cols - width - margin * 2)) + margin;
      const candidate = clampSettlementArea({ id: settlements.length + 1, top, left, width, height });

      if (settlements.some((existing) => rectsAreTooClose(existing, candidate, spacing))) continue;

      markRectangle(grid, reserved, candidate.top, candidate.left, candidate.height, candidate.width, candidate.id);
      settlements.push(candidate);
    }

    if (settlements.length < 2) {
      const fallbackA = clampSettlementArea({ id: 1, top: 4, left: 4, width: 5, height: 5 });
      const fallbackB = clampSettlementArea({ id: 2, top: Math.max(4, world.rows - 9), left: Math.max(4, world.cols - 9), width: 5, height: 5 });
      for (const area of [fallbackA, fallbackB]) {
        if (!settlements.some((s) => s.id === area.id)) {
          markRectangle(grid, reserved, area.top, area.left, area.height, area.width, area.id);
          settlements.push(area);
        }
      }
    }

    settlements.forEach((area) => {
      const center = areaCenter(area);
      area.centerRow = center.row;
      area.centerCol = center.col;
    });

    return settlements.slice(0, Math.max(2, Math.min(10, settlements.length)));
  }

  function getSettlementRoadStart(area) {
    const bottom = area.top + area.height - 1;
    const col = area.left + Math.floor(area.width / 2);
    const row = bottom + 1;
    if (inBounds(row, col)) {
      return { row, col, adjacentRow: bottom, adjacentCol: col };
    }
    const fallbackRow = Math.max(0, bottom);
    return { row: fallbackRow, col, adjacentRow: bottom, adjacentCol: col };
  }

  function findRoadPath(grid, reserved, startRow, startCol, endRow, endCol, seedSalt, avoidKeys) {
    if (!inBounds(startRow, startCol) || !inBounds(endRow, endCol)) return null;

    const rows = State.world.rows;
    const cols = State.world.cols;
    const total = rows * cols;
    const gScore = new Float64Array(total);
    const visited = new Uint8Array(total);
    const parent = new Int32Array(total);
    for (let i = 0; i < total; i++) {
      gScore[i] = Number.POSITIVE_INFINITY;
      parent[i] = -1;
    }

    const startIndex = startRow * cols + startCol;
    const endIndex = endRow * cols + endCol;
    const open = [startIndex];
    gScore[startIndex] = 0;

    function cellIndex(row, col) {
      return row * cols + col;
    }

    function heuristic(row, col) {
      return Math.abs(row - endRow) + Math.abs(col - endCol);
    }

    function traversalCost(row, col) {
      if (row === endRow && col === endCol) return 1;
      if (avoidKeys && avoidKeys.has(`${row},${col}`) && !(row === startRow && col === startCol)) return Number.POSITIVE_INFINITY;
      const tile = tileAt(grid, row, col);
      if (!tile) return Number.POSITIVE_INFINITY;
      if (tile.type === "settlement") return Number.POSITIVE_INFINITY;
      if (isReserved(reserved, row, col) && tile.type !== "road") return Number.POSITIVE_INFINITY;
      let cost = 1;
      if (tile.type === "road") cost = 0.35;
      else if (tile.type === "grass") cost = 1;
      else if (tile.type === "dirt") cost = 1.05;
      else if (tileIsBlocking(tile)) cost = 3.6;
      cost += RNG.hashNoise(seedSalt, row, col, "roadPathJitter") * 0.04;
      return cost;
    }

    while (open.length) {
      let bestOpenIndex = 0;
      let bestScore = Number.POSITIVE_INFINITY;
      for (let i = 0; i < open.length; i++) {
        const index = open[i];
        if (visited[index]) continue;
        const row = Math.floor(index / cols);
        const col = index % cols;
        const score = gScore[index] + heuristic(row, col);
        if (score < bestScore) {
          bestScore = score;
          bestOpenIndex = i;
        }
      }

      const currentIndex = open.splice(bestOpenIndex, 1)[0];
      if (visited[currentIndex]) continue;
      if (currentIndex === endIndex) break;
      visited[currentIndex] = 1;

      const currentRow = Math.floor(currentIndex / cols);
      const currentCol = currentIndex % cols;
      const neighbors = [
        [currentRow - 1, currentCol, 1.0],
        [currentRow + 1, currentCol, 1.0],
        [currentRow, currentCol - 1, 1.0],
        [currentRow, currentCol + 1, 1.0],
        [currentRow - 1, currentCol - 1, 1.41421356237],
        [currentRow - 1, currentCol + 1, 1.41421356237],
        [currentRow + 1, currentCol - 1, 1.41421356237],
        [currentRow + 1, currentCol + 1, 1.41421356237]
      ];

      for (const [nextRow, nextCol, distanceCost] of neighbors) {
        if (!inBounds(nextRow, nextCol)) continue;
        const nextIndex = cellIndex(nextRow, nextCol);
        if (visited[nextIndex]) continue;
        const isDiagonal = nextRow !== currentRow && nextCol !== currentCol;
        if (isDiagonal) {
          const sideA = traversalCost(currentRow, nextCol);
          const sideB = traversalCost(nextRow, currentCol);
          if (!Number.isFinite(sideA) && !Number.isFinite(sideB)) continue;
        }
        const stepCost = traversalCost(nextRow, nextCol);
        if (!Number.isFinite(stepCost)) continue;
        const tentative = gScore[currentIndex] + stepCost * distanceCost;
        if (tentative < gScore[nextIndex]) {
          gScore[nextIndex] = tentative;
          parent[nextIndex] = currentIndex;
          open.push(nextIndex);
        }
      }
    }

    if (!Number.isFinite(gScore[endIndex])) return null;

    const path = [];
    let cursor = endIndex;
    while (cursor !== -1) {
      path.push({ row: Math.floor(cursor / cols), col: cursor % cols });
      if (cursor === startIndex) break;
      cursor = parent[cursor];
    }

    return path.reverse();
  }

  function stampRoadPath(grid, reserved, path) {
    if (!Array.isArray(path)) return;
    for (const cell of path) {
      stampRoadTile(grid, reserved, cell.row, cell.col);
    }
  }


  function findNearestJunctionCell(grid, reserved, targetRow, targetCol, forbiddenKeys) {
    const world = State.world;
    const maxRadius = Math.max(world.rows, world.cols);
    for (let radius = 0; radius <= maxRadius; radius++) {
      for (let row = Math.max(0, Math.floor(targetRow - radius)); row <= Math.min(world.rows - 1, Math.ceil(targetRow + radius)); row++) {
        for (let col = Math.max(0, Math.floor(targetCol - radius)); col <= Math.min(world.cols - 1, Math.ceil(targetCol + radius)); col++) {
          if (Math.max(Math.abs(row - targetRow), Math.abs(col - targetCol)) !== radius) continue;
          const key = `${row},${col}`;
          if (forbiddenKeys && forbiddenKeys.has(key)) continue;
          const tile = tileAt(grid, row, col);
          if (!tile) continue;
          if (tile.type === "settlement") continue;
          if (isReserved(reserved, row, col)) continue;
          return { row, col };
        }
      }
    }
    return null;
  }

  function stampLineRoad(grid, reserved, startRow, startCol, endRow, endCol) {
    let row = startRow;
    let col = startCol;
    stampRoadTile(grid, reserved, row, col);

    while (row !== endRow || col !== endCol) {
      if (row !== endRow) {
        row += row < endRow ? 1 : -1;
        stampRoadTile(grid, reserved, row, col);
      }
      if (col !== endCol) {
        col += col < endCol ? 1 : -1;
        stampRoadTile(grid, reserved, row, col);
      }
    }
  }

  function connectSettlements(grid, reserved, settlements, seed) {
    const gates = settlements.map((settlement) => ({
      settlementId: settlement.id,
      ...getSettlementRoadStart(settlement)
    }));

    if (!gates.length) return [];

    const centroid = gates.reduce((acc, gate) => {
      acc.row += gate.row;
      acc.col += gate.col;
      return acc;
    }, { row: 0, col: 0 });
    centroid.row /= gates.length;
    centroid.col /= gates.length;

    const sortedByCentroid = gates.slice().sort((a, b) => {
      const da = Math.hypot(a.row - centroid.row, a.col - centroid.col);
      const db = Math.hypot(b.row - centroid.row, b.col - centroid.col);
      return da - db;
    });

    const gateKeys = new Set(gates.map((gate) => `${gate.row},${gate.col}`));
    const protectedGateKeys = new Set();
    for (const gate of gates) {
      protectedGateKeys.add(`${gate.row},${gate.col}`);
      if (inBounds(gate.row, gate.col - 1)) protectedGateKeys.add(`${gate.row},${gate.col - 1}`);
      if (inBounds(gate.row, gate.col + 1)) protectedGateKeys.add(`${gate.row},${gate.col + 1}`);
    }
    const forbiddenKeys = new Set(gateKeys);
    const primaryJunction = findNearestJunctionCell(grid, reserved, centroid.row, centroid.col, forbiddenKeys) || { row: sortedByCentroid[0].row, col: sortedByCentroid[0].col };
    const junctions = [primaryJunction];
    const addSecondaryJunction = gates.length >= 5;
    if (addSecondaryJunction) {
      const farGate = sortedByCentroid[sortedByCentroid.length - 1];
      const secondaryTargetRow = (centroid.row + farGate.row) / 2;
      const secondaryTargetCol = (centroid.col + farGate.col) / 2;
      const secondaryJunction = findNearestJunctionCell(grid, reserved, secondaryTargetRow, secondaryTargetCol, new Set([...forbiddenKeys, `${primaryJunction.row},${primaryJunction.col}`]));
      if (secondaryJunction && (secondaryJunction.row !== primaryJunction.row || secondaryJunction.col !== primaryJunction.col)) {
        junctions.push(secondaryJunction);
      }
    }

    const connectionCounts = new Map(gates.map((gate) => [gate.settlementId, 0]));
    const roadEntrances = [];

    for (const gate of gates) {
      const stemRow = gate.row;
      const stemCol = gate.col;
      stampRoadTile(grid, reserved, gate.row, gate.col);

      const primaryJunction = junctions.slice().sort((a, b) => Math.hypot(a.row - stemRow, a.col - stemCol) - Math.hypot(b.row - stemRow, b.col - stemCol))[0];
      const avoidKeys = new Set(protectedGateKeys);
      const primaryPath = findRoadPath(grid, reserved, stemRow, stemCol, primaryJunction.row, primaryJunction.col, `${seed}|road|${gate.settlementId}|primary`, avoidKeys);
      if (primaryPath && primaryPath.length) {
        stampRoadPath(grid, reserved, primaryPath);
        connectionCounts.set(gate.settlementId, 1);
        roadEntrances.push({ settlementId: gate.settlementId, row: gate.row, col: gate.col, adjacentRow: gate.adjacentRow, adjacentCol: gate.adjacentCol, stemRow, stemCol });
      }
    }

    if (junctions.length > 1) {
      const a = junctions[0];
      const b = junctions[1];
      const trunkPath = findRoadPath(grid, reserved, a.row, a.col, b.row, b.col, `${seed}|road|junctions`, protectedGateKeys);
      if (trunkPath && trunkPath.length) {
        stampRoadPath(grid, reserved, trunkPath);
      }
    }

    const secondaryCandidates = gates
      .filter((gate) => connectionCounts.get(gate.settlementId) === 1)
      .map((gate) => ({
        gate,
        score: Math.abs(gate.col - centroid.col) + Math.abs(gate.row - centroid.row) + RNG.hashNoise(seed, gate.row, gate.col, "secondaryRoadChance")
      }))
      .sort((a, b) => b.score - a.score);

    const extraLinks = junctions.length > 1 ? Math.min(junctions.length, Math.max(1, Math.floor(gates.length / 4))) : 0;
    for (let i = 0; i < extraLinks && i < secondaryCandidates.length; i++) {
      const gate = secondaryCandidates[i].gate;
      if (connectionCounts.get(gate.settlementId) >= 2) continue;
      const stemRow = gate.row;
      const stemCol = gate.col;
      const alternativeJunction = junctions
        .filter((junction) => junction.row !== stemRow || junction.col !== stemCol)
        .sort((a, b) => Math.hypot(a.row - stemRow, a.col - stemCol) - Math.hypot(b.row - stemRow, b.col - stemCol))[0];
      if (!alternativeJunction) continue;
      const avoidKeys = new Set(protectedGateKeys);
      const secondaryPath = findRoadPath(grid, reserved, stemRow, stemCol, alternativeJunction.row, alternativeJunction.col, `${seed}|road|${gate.settlementId}|secondary`, avoidKeys);
      if (!secondaryPath || !secondaryPath.length) continue;
      stampRoadPath(grid, reserved, secondaryPath);
      connectionCounts.set(gate.settlementId, connectionCounts.get(gate.settlementId) + 1);
    }

    return roadEntrances;
  }

  function scoreFreeCells(seed, reserved) {
    const world = State.world;
    const cells = [];
    for (let row = 0; row < world.rows; row++) {
      for (let col = 0; col < world.cols; col++) {
        if (isReserved(reserved, row, col)) continue;
        cells.push({
          row,
          col,
          value: RNG.hashNoise(seed, row, col, "freeCellScore")
        });
      }
    }
    cells.sort((a, b) => b.value - a.value);
    return cells;
  }

  function applyCircularBlob(grid, reserved, centerRow, centerCol, radius, painter) {
    let changed = 0;
    for (let row = Math.floor(centerRow - radius); row <= Math.ceil(centerRow + radius); row++) {
      for (let col = Math.floor(centerCol - radius); col <= Math.ceil(centerCol + radius); col++) {
        if (!inBounds(row, col) || isReserved(reserved, row, col)) continue;
        const dist = Math.hypot(row - centerRow, col - centerCol);
        if (dist > radius) continue;
        const tile = tileAt(grid, row, col);
        if (!tile || tileIsBlocking(tile)) continue;
        if (painter(grid, row, col, dist)) changed += 1;
      }
    }
    return changed;
  }

  function createClusterAnchors(seed, reserved, count, padding) {
    const rankedCells = scoreFreeCells(`${seed}|clusterAnchors`, reserved);
    const anchors = [];
    const minDistance = Math.max(4, padding || 0);

    for (const cell of rankedCells) {
      if (anchors.length >= count) break;
      const tooClose = anchors.some((anchor) => Math.hypot(anchor.row - cell.row, anchor.col - cell.col) < minDistance);
      if (tooClose) continue;
      anchors.push(cell);
    }

    return anchors;
  }

  function fillClusteredAreas(grid, reserved, seed, targetCount, options) {
    if (targetCount <= 0) return 0;
    const world = State.world;
    const rng = RNG.createSeededRandom(`${seed}|${options.clusterKey}`);
    const anchors = createClusterAnchors(`${seed}|${options.clusterKey}`, reserved, options.clusterCount || 3, options.spacing || 6);
    let changed = 0;
    let attempts = 0;

    while (anchors.length && changed < targetCount && attempts < (options.maxAttempts || 220)) {
      attempts += 1;
      const anchor = anchors[attempts % anchors.length];
      const wobbleRow = (rng() - 0.5) * (options.wobble || 4);
      const wobbleCol = (rng() - 0.5) * (options.wobble || 4);
      const centerRow = Utils.clamp(anchor.row + wobbleRow, 1, world.rows - 2);
      const centerCol = Utils.clamp(anchor.col + wobbleCol, 1, world.cols - 2);
      const radius = options.minRadius + rng() * (options.maxRadius - options.minRadius);

      changed += applyCircularBlob(grid, reserved, centerRow, centerCol, radius, options.painter);
    }

    return changed;
  }

  function addLakes(grid, reserved, seed, targetCount) {
    return fillClusteredAreas(grid, reserved, seed, targetCount, {
      clusterKey: "lakes",
      clusterCount: 1,
      spacing: Math.max(8, Math.round(Math.min(State.world.rows, State.world.cols) * 0.12)),
      wobble: 3,
      minRadius: 2.2,
      maxRadius: Math.max(3.4, Math.min(State.world.rows, State.world.cols) * 0.075),
      maxAttempts: 120,
      painter: (localGrid, row, col) => paintLakeTile(localGrid, row, col)
    });
  }

  function addMountains(grid, reserved, seed, targetCount) {
    return fillClusteredAreas(grid, reserved, seed, targetCount, {
      clusterKey: "mountains",
      clusterCount: 2,
      spacing: Math.max(7, Math.round(Math.min(State.world.rows, State.world.cols) * 0.10)),
      wobble: 5,
      minRadius: 2.1,
      maxRadius: Math.max(3.2, Math.min(State.world.rows, State.world.cols) * 0.07),
      maxAttempts: 160,
      painter: (localGrid, row, col, dist) => {
        const normalized = Math.max(0, 1 - dist / Math.max(1, 3.2));
        return paintMountainTile(localGrid, row, col, 2.2 + normalized * 1.6);
      }
    });
  }

  function addRivers(grid, reserved, seed, targetCount) {
    const world = State.world;
    const rng = RNG.createSeededRandom(`${seed}|rivers`);
    let blocked = 0;
    const desiredStreams = targetCount > 0 ? Math.max(1, Math.min(2, Math.round(targetCount / Math.max(8, Math.min(world.rows, world.cols) * 0.8)))) : 0;

    for (let streamIndex = 0; streamIndex < desiredStreams; streamIndex++) {
      let row = Math.floor(rng() * world.rows);
      let col = rng() > 0.5 ? 0 : world.cols - 1;
      const length = Math.max(world.rows, world.cols);
      for (let step = 0; step < length && blocked < targetCount; step++) {
        if (!inBounds(row, col)) break;
        if (!isReserved(reserved, row, col)) {
          const tile = tileAt(grid, row, col);
          if (tile && !tileIsBlocking(tile)) {
            if (paintRiverTile(grid, row, col)) blocked += 1;
          }
        }
        if (rng() > 0.55) {
          row += rng() > 0.5 ? 1 : -1;
        } else {
          col += col === 0 ? 1 : -1;
        }
        row = Utils.clamp(row, 0, world.rows - 1);
        col = Utils.clamp(col, 0, world.cols - 1);
      }
    }

    return blocked;
  }

  function addForests(grid, reserved, seed, targetCount) {
    return fillClusteredAreas(grid, reserved, seed, targetCount, {
      clusterKey: "forests",
      clusterCount: Math.max(2, Math.min(5, Math.round(Math.min(State.world.rows, State.world.cols) / 18))),
      spacing: Math.max(6, Math.round(Math.min(State.world.rows, State.world.cols) * 0.08)),
      wobble: 6,
      minRadius: 2.0,
      maxRadius: Math.max(3.0, Math.min(State.world.rows, State.world.cols) * 0.065),
      maxAttempts: 260,
      painter: (localGrid, row, col) => paintForestTile(localGrid, row, col)
    });
  }

  function countBlockingTiles(grid) {
    let blocked = 0;
    for (let row = 0; row < grid.length; row++) {
      for (let col = 0; col < grid[row].length; col++) {
        if (tileIsBlocking(grid[row][col])) blocked += 1;
      }
    }
    return blocked;
  }

  function countBlockingNeighbors(grid, row, col) {
    let count = 0;
    for (let rowOffset = -1; rowOffset <= 1; rowOffset++) {
      for (let colOffset = -1; colOffset <= 1; colOffset++) {
        if (rowOffset === 0 && colOffset === 0) continue;
        const neighbor = tileAt(grid, row + rowOffset, col + colOffset);
        if (tileIsBlocking(neighbor)) count += 1;
      }
    }
    return count;
  }

  function addFallbackBlockingTiles(grid, reserved, seed, targetCount) {
    if (targetCount <= 0) return 0;

    const candidates = [];
    for (let row = 0; row < grid.length; row++) {
      for (let col = 0; col < grid[row].length; col++) {
        if (isReserved(reserved, row, col)) continue;
        const tile = tileAt(grid, row, col);
        if (!tile || tileIsBlocking(tile)) continue;
        const neighborCount = countBlockingNeighbors(grid, row, col);
        const noise = RNG.hashNoise(seed, row, col, "blockingFallback");
        candidates.push({
          row,
          col,
          neighborCount,
          score: neighborCount * 10 + noise
        });
      }
    }

    candidates.sort((a, b) => {
      if (b.neighborCount !== a.neighborCount) return b.neighborCount - a.neighborCount;
      return b.score - a.score;
    });

    let changed = 0;
    for (const cell of candidates) {
      if (changed >= targetCount) break;
      const tile = tileAt(grid, cell.row, cell.col);
      if (!tile || tileIsBlocking(tile)) continue;
      const currentNeighbors = countBlockingNeighbors(grid, cell.row, cell.col);
      if (changed > 0 && currentNeighbors === 0) continue;
      if (paintForestTile(grid, cell.row, cell.col)) changed += 1;
    }

    return changed;
  }

  function ensureBlockedCoverage(grid, reserved, seed, minPercent, maxPercent) {
    const total = Math.max(1, grid.length * (grid[0] ? grid[0].length : 0));
    const minBlockedCount = Math.ceil(total * minPercent / 100);
    const maxBlockedCount = Math.floor(total * maxPercent / 100);
    let blockedCount = countBlockingTiles(grid);

    if (blockedCount >= minBlockedCount) {
      return blockedCount;
    }

    let remaining = Math.max(0, Math.min(maxBlockedCount, total) - blockedCount);
    if (remaining <= 0) {
      return blockedCount;
    }

    const clusteredTarget = Math.min(remaining, minBlockedCount - blockedCount);
    if (clusteredTarget > 0) {
      blockedCount += addForests(grid, reserved, `${seed}|blockedCoverageBoost`, clusteredTarget);
      remaining = Math.max(0, Math.min(maxBlockedCount, total) - blockedCount);
    }

    if (blockedCount < minBlockedCount && remaining > 0) {
      blockedCount += addFallbackBlockingTiles(grid, reserved, `${seed}|blockedCoverageFallback`, Math.min(remaining, minBlockedCount - blockedCount));
    }

    return blockedCount;
  }

  function addBaseSurface(grid, params, seed) {
    const world = State.world;
    const dirtRatio = Utils.clamp((params.targetDirtCoverage || 30) / 100, 0.30, 0.70);
    const dirtSeed = `${seed}|dirtClusters`;

    for (let row = 0; row < world.rows; row++) {
      for (let col = 0; col < world.cols; col++) {
        const tile = grid[row][col];
        if (tile.type === "road" || tile.type === "settlement") continue;
        if (tile.type === "forest" || tile.type === "mountain" || tile.type === "lake" || tile.type === "river") continue;
        tile.type = "grass";
      }
    }

    const availableCells = [];
    for (let row = 0; row < world.rows; row++) {
      for (let col = 0; col < world.cols; col++) {
        const tile = grid[row][col];
        if (!tile || tile.type !== "grass") continue;
        availableCells.push({ row, col });
      }
    }

    const targetDirt = Math.max(0, Math.min(availableCells.length, Math.round(availableCells.length * dirtRatio)));
    if (targetDirt <= 0) return;

    const dirtReserved = makeMask(world.rows, world.cols, false);
    for (let row = 0; row < world.rows; row++) {
      for (let col = 0; col < world.cols; col++) {
        const tile = grid[row][col];
        if (!tile || tile.type !== "grass") dirtReserved[row][col] = true;
      }
    }

    let dirtCount = fillClusteredAreas(grid, dirtReserved, dirtSeed, targetDirt, {
      clusterKey: "dirt",
      clusterCount: Math.max(4, Math.min(10, Math.round(Math.min(world.rows, world.cols) / 12))),
      spacing: Math.max(5, Math.round(Math.min(world.rows, world.cols) * 0.06)),
      wobble: 6,
      minRadius: 2.4,
      maxRadius: Math.max(4.5, Math.min(world.rows, world.cols) * 0.10),
      maxAttempts: 360,
      painter: (localGrid, row, col) => {
        const tile = tileAt(localGrid, row, col);
        if (!tile || tile.type !== "grass") return false;
        tile.type = "dirt";
        dirtReserved[row][col] = true;
        return true;
      }
    });

    if (dirtCount < targetDirt) {
      const fillerCandidates = [];
      for (let row = 0; row < world.rows; row++) {
        for (let col = 0; col < world.cols; col++) {
          const tile = grid[row][col];
          if (!tile || tile.type !== "grass") continue;
          let adjacentDirt = 0;
          for (let rowOffset = -1; rowOffset <= 1; rowOffset++) {
            for (let colOffset = -1; colOffset <= 1; colOffset++) {
              if (rowOffset === 0 && colOffset === 0) continue;
              const neighbor = tileAt(grid, row + rowOffset, col + colOffset);
              if (neighbor && neighbor.type === "dirt") adjacentDirt += 1;
            }
          }
          if (adjacentDirt <= 0) continue;
          fillerCandidates.push({
            row,
            col,
            score: adjacentDirt * 10 + RNG.hashNoise(dirtSeed, row, col, "dirtFill")
          });
        }
      }

      fillerCandidates.sort((a, b) => b.score - a.score);
      for (const candidate of fillerCandidates) {
        if (dirtCount >= targetDirt) break;
        const tile = grid[candidate.row][candidate.col];
        if (!tile || tile.type !== "grass") continue;
        tile.type = "dirt";
        dirtCount += 1;
      }
    }

    if (dirtCount < targetDirt) {
      const finalCandidates = [];
      for (let row = 0; row < world.rows; row++) {
        for (let col = 0; col < world.cols; col++) {
          const tile = grid[row][col];
          if (!tile || tile.type !== "grass") continue;
          const noise = RNG.hashNoise(dirtSeed, row, col, "dirtFinalFill");
          finalCandidates.push({ row, col, score: noise });
        }
      }
      finalCandidates.sort((a, b) => b.score - a.score);
      for (const candidate of finalCandidates) {
        if (dirtCount >= targetDirt) break;
        const tile = grid[candidate.row][candidate.col];
        if (!tile || tile.type !== "grass") continue;
        tile.type = "dirt";
        dirtCount += 1;
      }
    }
  }

  function finalizeStats(grid, params, settlements) {
    const world = State.world;
    const counts = {
      grass: 0,
      dirt: 0,
      water: 0,
      stone: 0,
      hill: 0,
      forest: 0,
      settlement: 0,
      road: 0,
      blocked: 0,
      playable: 0
    };

    for (let row = 0; row < world.rows; row++) {
      for (let col = 0; col < world.cols; col++) {
        const tile = grid[row][col];
        if (tile.type === "grass") counts.grass += 1;
        if (tile.type === "dirt") counts.dirt += 1;
        if (tile.type === "road") counts.road += 1;
        if (tile.type === "settlement") counts.settlement += 1;
        if (tile.type === "lake" || tile.type === "river") counts.water += 1;
        if (tile.type === "mountain") counts.stone += 1;
        if (tile.type === "forest") counts.forest += 1;
        if (tile.tags.has("mountain")) counts.hill += 1;
        if (tileIsBlocking(tile)) counts.blocked += 1;
        else counts.playable += 1;
      }
    }

    const total = world.rows * world.cols;
    params.actualGrassCoverage = Utils.percent(counts.grass, total);
    params.actualDirtCoverage = Utils.percent(counts.dirt, total);
    params.actualWaterCoverage = Utils.percent(counts.water, total);
    params.actualStoneCoverage = Utils.percent(counts.stone, total);
    params.actualHillCoverage = Utils.percent(counts.hill, total);
    params.actualForestCoverage = Utils.percent(counts.forest, total);
    params.actualSettlementCoverage = Utils.percent(counts.settlement, total);
    params.actualRoadCoverage = Utils.percent(counts.road, total);
    params.actualBlockedCoverage = Utils.percent(counts.blocked, total);
    params.actualPlayableCoverage = Utils.percent(counts.playable, total);
    params.settlementAreaCount = settlements.length;
  }

  function generateConstrainedWorld(seed, cols, rows) {
    const world = State.world;
    world.cols = cols;
    world.rows = rows;

    const params = Topology.generateTopologyParams(seed, cols, rows);
    const grid = Array.from({ length: rows }, () => Array.from({ length: cols }, emptyTile));
    const reserved = makeMask(rows, cols, false);
    const settlements = createSettlements(grid, reserved, seed);
    const roadEntrances = connectSettlements(grid, reserved, settlements, seed);

    const total = rows * cols;
    const blockerTargetPct = 30 + Math.floor(RNG.chanceFromSeed(seed, "blockedCoverage") * 31);
    const blockerTargetCount = Math.max(0, Math.min(total - roadEntrances.length - settlements.length, Math.floor(total * blockerTargetPct / 100)));

    const waterTarget = Math.floor(blockerTargetCount * (0.10 + RNG.chanceFromSeed(seed, "waterShare") * 0.16));
    const mountainTarget = Math.floor(blockerTargetCount * (0.14 + RNG.chanceFromSeed(seed, "mountainShare") * 0.18));
    const riverTarget = Math.floor(blockerTargetCount * (0.03 + RNG.chanceFromSeed(seed, "riverShare") * 0.07));
    let blockedCount = 0;

    blockedCount += addLakes(grid, reserved, seed, waterTarget);
    blockedCount += addMountains(grid, reserved, seed, mountainTarget);
    blockedCount += addRivers(grid, reserved, seed, riverTarget);
    blockedCount += addForests(grid, reserved, seed, Math.max(0, blockerTargetCount - blockedCount));
    blockedCount = ensureBlockedCoverage(grid, reserved, seed, 30, 60);

    addBaseSurface(grid, params, seed);

    const playerStart = roadEntrances[0]
      ? { row: roadEntrances[0].row, col: roadEntrances[0].col }
      : { row: Math.floor(rows / 2), col: Math.floor(cols / 2) };

    params.hasLake = grid.some((rowTiles) => rowTiles.some((tile) => tile.type === "lake")) ? 1 : 0;
    params.streamCount = grid.reduce((count, rowTiles) => count + (rowTiles.some((tile) => tile.type === "river") ? 1 : 0), 0) > 0 ? 1 : 0;
    params.hillCount = settlements.length > 0 ? Math.max(1, Math.round(mountainTarget / Math.max(1, Math.min(rows, cols)))) : 0;
    params.roadCount = 1;
    params.hasForest = grid.some((rowTiles) => rowTiles.some((tile) => tile.type === "forest")) ? 1 : 0;
    params.hasSettlement = 1;
    finalizeStats(grid, params, settlements);

    return {
      grid,
      params,
      playerStart
    };
  }

  window.Game.Terrain = {
    generateWorld(seed, cols, rows) {
      return generateConstrainedWorld(seed, cols, rows);
    }
  };
})();
