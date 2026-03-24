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

  function addHills(grid, params, seed) {
    const world = State.world;

    for (let i = 0; i < params.hillCount; i++) {
      const rng = RNG.createSeededRandom(`${seed}|hill|${i}`);
      const centerRow = Math.floor(rng() * world.rows * 0.8 + world.rows * 0.1);
      const centerCol = Math.floor(rng() * world.cols * 0.8 + world.cols * 0.1);
      const baseRadius = 2 + rng() * Math.max(2, Math.min(world.rows, world.cols) * 0.12);

      markCircle(grid, centerRow, centerCol, baseRadius, (tile, row, col, dist) => {
        const normalized = 1 - dist / baseRadius;
        if (normalized <= 0) return;

        tile.elevation = Math.max(tile.elevation, normalized * (1.5 + rng() * 1.4));
        tile.tags.add("hill");
      });
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
          grid[row][col].type = "water";
          grid[row][col].tags.add("lake");
          grid[row][col].elevation = 0;
          grid[row][col].tags.delete("hill");
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
        tile.type = "water";
        tile.tags.add("stream");
        tile.elevation = 0;
        tile.tags.delete("hill");

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
          if (grid[row][col].type !== "water") {
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
          if (grid[row][col].type !== "water") {
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
    const world = State.world;
    if (!params.hasForest) return;

    const targetTiles = Math.floor(world.rows * world.cols * params.forestCoverage / 100);
    const clusterCount = Math.max(1, Math.round(params.forestCoverage / 10));
    let assigned = 0;

    for (let i = 0; i < clusterCount; i++) {
      const rng = RNG.createSeededRandom(`${seed}|forest|${i}`);
      const centerRow = Math.floor(rng() * world.rows * 0.8 + world.rows * 0.1);
      const centerCol = Math.floor(rng() * world.cols * 0.8 + world.cols * 0.1);
      const radius = 2 + rng() * Math.max(2, Math.min(world.rows, world.cols) * 0.15);

      markCircle(grid, centerRow, centerCol, radius, (tile, row, col, dist) => {
        if (assigned >= targetTiles) return;
        if (tile.type === "water" || tile.type === "road") return;

        const local = RNG.hashNoise(seed, row, col, `forestDensity${i}`);
        if (local > dist / Math.max(radius, 0.001)) {
          tile.type = tile.tags.has("hill") ? "forestHill" : "forest";
          tile.tags.add("forest");
          assigned++;
        }
      });
    }
  }

  function addSettlement(grid, params, seed) {
    const world = State.world;
    if (!params.hasSettlement) return;

    const rng = RNG.createSeededRandom(`${seed}|settlement`);
    let centerRow = Math.floor(rng() * world.rows * 0.6 + world.rows * 0.2);
    let centerCol = Math.floor(rng() * world.cols * 0.6 + world.cols * 0.2);
    const radius = 2 + rng() * Math.max(2, Math.min(world.rows, world.cols) * 0.08);

    for (let search = 0; search < 20; search++) {
      if (grid[centerRow][centerCol].type !== "water") break;
      centerRow = Math.floor(rng() * world.rows * 0.6 + world.rows * 0.2);
      centerCol = Math.floor(rng() * world.cols * 0.6 + world.cols * 0.2);
    }

    markCircle(grid, centerRow, centerCol, radius, (tile) => {
      if (tile.type === "water") return;

      tile.type = "settlement";
      tile.tags.add("settlement");
      tile.elevation = 0;
    });
  }

  function addBaseSurface(grid, params, seed) {
    const world = State.world;
    const totalTiles = world.rows * world.cols;
    const targetDirt = Math.floor(totalTiles * params.targetDirtCoverage / 100);
    let dirtAssigned = 0;

    for (let row = 0; row < world.rows; row++) {
      for (let col = 0; col < world.cols; col++) {
        const tile = grid[row][col];

        if (tile.type === "water" || tile.type === "road" || tile.type === "settlement") {
          continue;
        }

        const n = RNG.hashNoise(seed, row, col, "baseSurface");

        if (dirtAssigned < targetDirt && n > 0.82 && !tile.tags.has("forest")) {
          tile.type = tile.tags.has("hill") ? "dirtHill" : "dirt";
          dirtAssigned++;
        } else if (tile.tags.has("hill")) {
          tile.type = n > 0.5 ? "hillGrass" : "hillStone";
        } else {
          tile.type = n > 0.52 ? "grass2" : "grass";
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

        if (tile.type === "grass" || tile.type === "grass2") counts.grass++;
        if (tile.type === "dirt" || tile.type === "dirtHill") counts.dirt++;
        if (tile.type === "water") counts.water++;
        if (tile.type === "stone" || tile.type === "hillStone") counts.stone++;
        if (tile.tags.has("hill")) counts.hill++;
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