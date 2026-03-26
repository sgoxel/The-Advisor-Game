/*
  FILE PURPOSE:
  Convert topology decisions into actual map tiles.

  DEPENDENCIES:
  - state.js
  - utils.js
  - rng.js
  - topology.js

  PUBLIC API:
  - Game.Terrain.generateWorld

  IMPORTANT RULES:
  - This file should not draw anything.
  - This file should not read/write DOM.
*/

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

  function markCircle(grid, centerRow, centerCol, radius, callback) {
    for (let row = Math.floor(centerRow - radius); row <= Math.ceil(centerRow + radius); row++) {
      for (let col = Math.floor(centerCol - radius); col <= Math.ceil(centerCol + radius); col++) {
        if (!inBounds(row, col)) continue;

        const dist = Math.hypot(row - centerRow, col - centerCol);
        if (dist <= radius) {
          callback(grid[row][col], row, col, dist);
        }
      }
    }
  }

  function distanceToSegment(pointRow, pointCol, startRow, startCol, endRow, endCol) {
    const vx = endRow - startRow;
    const vy = endCol - startCol;
    const wx = pointRow - startRow;
    const wy = pointCol - startCol;
    const segmentLengthSq = vx * vx + vy * vy;

    if (segmentLengthSq === 0) {
      return Math.hypot(pointRow - startRow, pointCol - startCol);
    }

    const t = Utils.clamp((wx * vx + wy * vy) / segmentLengthSq, 0, 1);
    const projectionRow = startRow + vx * t;
    const projectionCol = startCol + vy * t;
    return Math.hypot(pointRow - projectionRow, pointCol - projectionCol);
  }

  function applyMountainStamp(grid, centerRow, centerCol, outerRadius, coreRadius, ridgeHeight, allowPassableEdge) {
    markCircle(grid, centerRow, centerCol, outerRadius, (tile, row, col, dist) => {
      const normalized = 1 - dist / outerRadius;
      if (normalized <= 0) return;

      tile.tags.add("mountain");
      tile.elevation = Math.max(tile.elevation, normalized * ridgeHeight);
      tile.type = "mountain";

      if (dist <= coreRadius) {
        tile.tags.add("blocked");
        tile.tags.add("mountainCore");
        tile.elevation = Math.max(tile.elevation, ridgeHeight * 1.05);
        return;
      }

      if (!allowPassableEdge) {
        tile.tags.add("blocked");
      }
    });
  }

  function addMountainLine(grid, seed, index, centerRow, centerCol, baseRadius) {
    const world = State.world;
    const rng = RNG.createSeededRandom(`${seed}|mountainLine|${index}`);
    const horizontal = rng() > 0.45;
    const segments = 2 + Math.floor(rng() * 2);
    const step = Math.max(4, Math.round(baseRadius * (1.6 + rng() * 0.8)));
    const direction = rng() > 0.5 ? 1 : -1;
    const thickness = Math.max(2.4, baseRadius * (0.82 + rng() * 0.18));
    const coreRadius = Math.max(1.6, thickness * 0.52);
    const ridgeHeight = 2.4 + rng() * 1.1;

    const anchors = [{ row: centerRow, col: centerCol }];
    for (let s = 1; s <= segments; s++) {
      const prev = anchors[anchors.length - 1];
      const nextRow = horizontal
        ? prev.row + Math.round((rng() - 0.5) * baseRadius * 0.9)
        : prev.row + direction * step + Math.round((rng() - 0.5) * baseRadius * 0.55);
      const nextCol = horizontal
        ? prev.col + direction * step + Math.round((rng() - 0.5) * baseRadius * 0.55)
        : prev.col + Math.round((rng() - 0.5) * baseRadius * 0.9);

      anchors.push({
        row: Utils.clamp(nextRow, 3, world.rows - 4),
        col: Utils.clamp(nextCol, 3, world.cols - 4)
      });
    }

    for (let i = 0; i < anchors.length - 1; i++) {
      const start = anchors[i];
      const end = anchors[i + 1];
      const minRow = Math.floor(Math.min(start.row, end.row) - thickness - 1);
      const maxRow = Math.ceil(Math.max(start.row, end.row) + thickness + 1);
      const minCol = Math.floor(Math.min(start.col, end.col) - thickness - 1);
      const maxCol = Math.ceil(Math.max(start.col, end.col) + thickness + 1);

      for (let row = minRow; row <= maxRow; row++) {
        for (let col = minCol; col <= maxCol; col++) {
          if (!inBounds(row, col)) continue;
          const dist = distanceToSegment(row, col, start.row, start.col, end.row, end.col);
          if (dist > thickness) continue;

          const normalized = 1 - dist / thickness;
          const tile = grid[row][col];
          tile.tags.add("mountain");
          tile.type = "mountain";
          tile.elevation = Math.max(tile.elevation, normalized * ridgeHeight);

          if (dist <= coreRadius) {
            tile.tags.add("blocked");
            tile.tags.add("mountainCore");
            tile.elevation = Math.max(tile.elevation, ridgeHeight * 1.08);
          }
        }
      }
    }
  }

  function addMountainCorner(grid, seed, index, centerRow, centerCol, baseRadius) {
    const world = State.world;
    const rng = RNG.createSeededRandom(`${seed}|mountainCorner|${index}`);
    const armA = Math.max(5, Math.round(baseRadius * (2.0 + rng() * 0.7)));
    const armB = Math.max(5, Math.round(baseRadius * (1.8 + rng() * 0.7)));
    const dirRow = rng() > 0.5 ? 1 : -1;
    const dirCol = rng() > 0.5 ? 1 : -1;
    const thickness = Math.max(2.6, baseRadius * (0.78 + rng() * 0.22));
    const coreRadius = Math.max(1.7, thickness * 0.55);
    const ridgeHeight = 2.5 + rng() * 1.2;

    const elbow = {
      row: Utils.clamp(centerRow, 3, world.rows - 4),
      col: Utils.clamp(centerCol, 3, world.cols - 4)
    };
    const arm1 = {
      row: Utils.clamp(elbow.row + dirRow * armA, 3, world.rows - 4),
      col: elbow.col + Math.round((rng() - 0.5) * baseRadius * 0.7)
    };
    const arm2 = {
      row: elbow.row + Math.round((rng() - 0.5) * baseRadius * 0.7),
      col: Utils.clamp(elbow.col + dirCol * armB, 3, world.cols - 4)
    };

    const anchors = [arm1, elbow, arm2];
    for (let i = 0; i < anchors.length - 1; i++) {
      const start = anchors[i];
      const end = anchors[i + 1];
      const minRow = Math.floor(Math.min(start.row, end.row) - thickness - 1);
      const maxRow = Math.ceil(Math.max(start.row, end.row) + thickness + 1);
      const minCol = Math.floor(Math.min(start.col, end.col) - thickness - 1);
      const maxCol = Math.ceil(Math.max(start.col, end.col) + thickness + 1);

      for (let row = minRow; row <= maxRow; row++) {
        for (let col = minCol; col <= maxCol; col++) {
          if (!inBounds(row, col)) continue;
          const dist = distanceToSegment(row, col, start.row, start.col, end.row, end.col);
          if (dist > thickness) continue;

          const normalized = 1 - dist / thickness;
          const tile = grid[row][col];
          tile.tags.add("mountain");
          tile.type = "mountain";
          tile.elevation = Math.max(tile.elevation, normalized * ridgeHeight);

          if (dist <= coreRadius) {
            tile.tags.add("blocked");
            tile.tags.add("mountainCore");
            tile.elevation = Math.max(tile.elevation, ridgeHeight * 1.08);
          }
        }
      }
    }

    applyMountainStamp(grid, elbow.row, elbow.col, thickness * 1.15, coreRadius * 1.15, ridgeHeight + 0.2, false);
  }

  function addMountainMass(grid, seed, index, centerRow, centerCol, baseRadius) {
    const rng = RNG.createSeededRandom(`${seed}|mountainMass|${index}`);
    const blobCount = 4 + Math.floor(rng() * 3);
    const ringRadius = Math.max(2.5, baseRadius * (0.9 + rng() * 0.35));
    const blobRadius = Math.max(2.6, baseRadius * (0.9 + rng() * 0.22));
    const coreRadius = Math.max(1.9, blobRadius * 0.62);
    const ridgeHeight = 2.7 + rng() * 1.1;

    applyMountainStamp(grid, centerRow, centerCol, blobRadius * 0.95, coreRadius * 0.85, ridgeHeight + 0.2, false);

    for (let i = 0; i < blobCount; i++) {
      const angle = (Math.PI * 2 * i) / blobCount + rng() * 0.4;
      const localRadius = ringRadius * (0.7 + rng() * 0.35);
      const blobRow = centerRow + Math.sin(angle) * localRadius;
      const blobCol = centerCol + Math.cos(angle) * localRadius;
      applyMountainStamp(grid, blobRow, blobCol, blobRadius, coreRadius, ridgeHeight, true);
    }
  }

  function addHills(grid, params, seed) {
    const world = State.world;

    for (let i = 0; i < params.hillCount; i++) {
      const rng = RNG.createSeededRandom(`${seed}|hill|${i}`);
      const centerRow = Math.floor(rng() * world.rows * 0.62 + world.rows * 0.19);
      const centerCol = Math.floor(rng() * world.cols * 0.62 + world.cols * 0.19);
      const baseRadius = 2.6 + rng() * Math.max(2.5, Math.min(world.rows, world.cols) * 0.07);
      const shape = RNG.pickWeighted(`${seed}|hillShape|${i}`, "shape", ["I", "L", "O"], [0.34, 0.30, 0.36]);

      if (shape === "I") {
        addMountainLine(grid, seed, i, centerRow, centerCol, baseRadius);
      } else if (shape === "L") {
        addMountainCorner(grid, seed, i, centerRow, centerCol, baseRadius);
      } else {
        addMountainMass(grid, seed, i, centerRow, centerCol, baseRadius);
      }
    }
  }

  function addLake(grid, params, seed) {
    const world = State.world;
    if (!params.hasLake) return;

    const rng = RNG.createSeededRandom(`${seed}|lake`);
    const centerRow = Math.floor(rng() * world.rows * 0.6 + world.rows * 0.2);
    const centerCol = Math.floor(rng() * world.cols * 0.6 + world.cols * 0.2);
    const radiusRow = 2 + rng() * Math.max(2, world.rows * 0.12);
    const radiusCol = 2 + rng() * Math.max(2, world.cols * 0.12);

    for (let row = 0; row < world.rows; row++) {
      for (let col = 0; col < world.cols; col++) {
        const dx = (col - centerCol) / radiusCol;
        const dy = (row - centerRow) / radiusRow;
        const value = dx * dx + dy * dy;

        if (value <= 1) {
          grid[row][col].type = "lake";
          grid[row][col].tags.add("lake");
          grid[row][col].elevation = 0;
          grid[row][col].tags.delete("mountain");
          grid[row][col].tags.delete("mountainCore");
          grid[row][col].tags.delete("blocked");
        }
      }
    }
  }

  function addStreams(grid, params, seed) {
    const world = State.world;

    for (let i = 0; i < params.streamCount; i++) {
      const rng = RNG.createSeededRandom(`${seed}|stream|${i}`);
      let row = Math.floor(rng() * world.rows);
      let col = rng() > 0.5 ? 0 : world.cols - 1;
      const length = Math.floor((world.rows + world.cols) * (0.7 + rng() * 0.35));

      for (let step = 0; step < length; step++) {
        if (!inBounds(row, col)) break;

        const tile = grid[row][col];
        tile.type = "river";
        tile.tags.add("stream");
        tile.elevation = 0;
        tile.tags.delete("mountain");
        tile.tags.delete("mountainCore");
        tile.tags.delete("blocked");

        if (rng() > 0.55) {
          row += rng() > 0.5 ? 1 : -1;
        } else {
          col += col === 0 ? 1 : -1;
        }

        row = Utils.clamp(row, 0, world.rows - 1);
        col = Utils.clamp(col, 0, world.cols - 1);
      }
    }
  }

  function addRoads(grid, params, seed) {
    const world = State.world;

    for (let i = 0; i < params.roadCount; i++) {
      const rng = RNG.createSeededRandom(`${seed}|road|${i}`);
      const horizontal = rng() > 0.5;

      if (horizontal) {
        let row = Math.floor(rng() * world.rows * 0.7 + world.rows * 0.15);

        for (let col = 0; col < world.cols; col++) {
          if (grid[row][col].type !== "lake" && grid[row][col].type !== "river" && !grid[row][col].tags.has("mountain")) {
            grid[row][col].type = "road";
            grid[row][col].tags.add("road");
            grid[row][col].elevation = 0;
          }

          if (rng() > 0.72) {
            row = Utils.clamp(row + (rng() > 0.5 ? 1 : -1), 0, world.rows - 1);
          }
        }
      } else {
        let col = Math.floor(rng() * world.cols * 0.7 + world.cols * 0.15);

        for (let row = 0; row < world.rows; row++) {
          if (grid[row][col].type !== "lake" && grid[row][col].type !== "river" && !grid[row][col].tags.has("mountain")) {
            grid[row][col].type = "road";
            grid[row][col].tags.add("road");
            grid[row][col].elevation = 0;
          }

          if (rng() > 0.72) {
            col = Utils.clamp(col + (rng() > 0.5 ? 1 : -1), 0, world.cols - 1);
          }
        }
      }
    }
  }

  function addForest(grid, params, seed) {
    return;
  }

  function addSettlement(grid, params, seed) {
    return;
  }

  function addBaseSurface(grid, params, seed) {
    const world = State.world;
    const totalTiles = world.rows * world.cols;
    const targetDirt = Math.floor(totalTiles * params.targetDirtCoverage / 100);
    let dirtAssigned = 0;

    for (let row = 0; row < world.rows; row++) {
      for (let col = 0; col < world.cols; col++) {
        const tile = grid[row][col];

        if (tile.type === "lake" || tile.type === "river" || tile.type === "road" || tile.tags.has("mountain")) {
          continue;
        }

        const n = RNG.hashNoise(seed, row, col, "baseSurface");
        if (dirtAssigned < targetDirt && n > 0.82) {
          tile.type = "dirt";
          dirtAssigned++;
        } else {
          tile.type = "grass";
        }
      }
    }
  }

  function finalizeStats(grid, params) {
    const world = State.world;
    const counts = {
      grass: 0,
      dirt: 0,
      water: 0,
      stone: 0,
      hill: 0,
      forest: 0,
      settlement: 0
    };

    for (let row = 0; row < world.rows; row++) {
      for (let col = 0; col < world.cols; col++) {
        const tile = grid[row][col];

        if (tile.type === "grass") counts.grass++;
        if (tile.type === "dirt") counts.dirt++;
        if (tile.type === "lake" || tile.type === "river") counts.water++;
        if (tile.type === "mountain") counts.stone++;
        if (tile.tags.has("mountain")) counts.hill++;
        if (tile.tags.has("forest")) counts.forest++;
        if (tile.tags.has("settlement")) counts.settlement++;
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
  }

  window.Game.Terrain = {
    generateWorld(seed, cols, rows) {
      const world = State.world;

      world.cols = cols;
      world.rows = rows;

      const params = Topology.generateTopologyParams(seed, cols, rows);
      const grid = Array.from({ length: rows }, () => Array.from({ length: cols }, emptyTile));

      addHills(grid, params, seed);
      addLake(grid, params, seed);
      addStreams(grid, params, seed);
      addRoads(grid, params, seed);
      addSettlement(grid, params, seed);
      addForest(grid, params, seed);
      addBaseSurface(grid, params, seed);
      finalizeStats(grid, params);

      return {
        grid,
        params
      };
    }
  };
})();