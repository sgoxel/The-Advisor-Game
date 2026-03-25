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



  function buildVisualPalette(tileType) {
    switch (tileType) {
      case "grass":
        return {
          base: [90, 154, 90],
          dominant: [[64, 118, 66], [84, 143, 80], [107, 171, 100], [128, 188, 116]],
          accents: [[132, 138, 118], [152, 145, 90], [131, 105, 72]],
          accentBias: 0.24
        };
      case "grass2":
        return {
          base: [104, 168, 103],
          dominant: [[77, 131, 76], [98, 159, 91], [118, 181, 109], [141, 197, 129]],
          accents: [[139, 141, 120], [164, 154, 94], [137, 112, 78]],
          accentBias: 0.22
        };
      case "hillGrass":
        return {
          base: [104, 145, 94],
          dominant: [[72, 110, 69], [93, 133, 84], [117, 157, 103], [136, 169, 114]],
          accents: [[128, 130, 115], [149, 138, 86], [120, 99, 74]],
          accentBias: 0.26
        };
      case "dirt":
      case "dirtHill":
        return {
          base: [155, 118, 79],
          dominant: [[118, 84, 54], [139, 101, 66], [163, 123, 79], [184, 146, 96]],
          accents: [[117, 120, 103], [148, 142, 93], [98, 89, 74]],
          accentBias: 0.18
        };
      case "road":
        return {
          base: [181, 151, 104],
          dominant: [[154, 129, 85], [176, 147, 101], [194, 166, 118], [137, 123, 98]],
          accents: [[121, 104, 76], [153, 147, 126], [114, 117, 121]],
          accentBias: 0.18
        };
      case "hillStone":
      case "stone":
        return {
          base: [144, 149, 156],
          dominant: [[111, 117, 127], [132, 139, 147], [150, 157, 164], [171, 177, 183]],
          accents: [[128, 123, 107], [117, 124, 98], [98, 102, 109]],
          accentBias: 0.12
        };
      case "forest":
      case "forestHill":
        return {
          base: [60, 112, 67],
          dominant: [[35, 72, 41], [47, 90, 52], [60, 108, 65], [80, 134, 82]],
          accents: [[94, 98, 83], [113, 103, 69], [89, 74, 54]],
          accentBias: 0.17
        };
      case "settlement":
        return {
          base: [183, 176, 162],
          dominant: [[149, 141, 127], [170, 162, 148], [188, 180, 166], [206, 199, 185]],
          accents: [[123, 126, 129], [146, 126, 95], [104, 104, 104]],
          accentBias: 0.14
        };
      case "water":
        return {
          base: [76, 122, 180],
          dominant: [[48, 92, 152], [67, 114, 172], [86, 136, 190], [104, 157, 208]],
          accents: [[78, 101, 133], [59, 73, 101], [112, 133, 155]],
          accentBias: 0.10
        };
      default:
        return {
          base: [90, 154, 90],
          dominant: [[64, 118, 66], [84, 143, 80], [107, 171, 100], [128, 188, 116]],
          accents: [[132, 138, 118], [152, 145, 90], [131, 105, 72]],
          accentBias: 0.22
        };
    }
  }

  function pickArrayColor(rng, colors) {
    return colors[Math.floor(rng() * colors.length)].slice();
  }

  function jitterColor(rgb, amount, rng, floorValue) {
    return rgb.map((channel) => {
      const shift = Math.round((rng() - 0.5) * amount * 2);
      return Utils.clamp(channel + shift, floorValue !== undefined ? floorValue : 0, 255);
    });
  }

  function mixColor(base, target, factor) {
    return [
      Math.round(base[0] + (target[0] - base[0]) * factor),
      Math.round(base[1] + (target[1] - base[1]) * factor),
      Math.round(base[2] + (target[2] - base[2]) * factor)
    ];
  }


  function adjustSaturationContrast(rgb, saturation, contrast) {
    const sat = saturation === undefined ? 1 : saturation;
    const con = contrast === undefined ? 1 : contrast;
    const r = rgb[0] / 255, g = rgb[1] / 255, b = rgb[2] / 255;
    const gray = r * 0.299 + g * 0.587 + b * 0.114;
    let rr = gray + (r - gray) * sat;
    let gg = gray + (g - gray) * sat;
    let bb = gray + (b - gray) * sat;
    rr = ((rr - 0.5) * con) + 0.5;
    gg = ((gg - 0.5) * con) + 0.5;
    bb = ((bb - 0.5) * con) + 0.5;
    return [
      Math.round(Utils.clamp(rr, 0, 1) * 255),
      Math.round(Utils.clamp(gg, 0, 1) * 255),
      Math.round(Utils.clamp(bb, 0, 1) * 255)
    ];
  }

  function cloneCells(cells) {
    return cells.map((c) => c ? c.slice() : c);
  }

  function getNeighborCellColor(neighbor, side, gx, gy, g) {
    if (!neighbor.visual || !neighbor.visual.cells || neighbor.visual.gridSize <= 1) {
      return (neighbor.visual && neighbor.visual.base) ? neighbor.visual.base.slice() : [128, 128, 128];
    }

    const ng = neighbor.visual.gridSize;
    const nx = Utils.clamp(Math.round((gx / Math.max(1, g - 1)) * Math.max(0, ng - 1)), 0, Math.max(0, ng - 1));
    const ny = Utils.clamp(Math.round((gy / Math.max(1, g - 1)) * Math.max(0, ng - 1)), 0, Math.max(0, ng - 1));

    let sx = nx;
    let sy = ny;

    if (side === 'top') sy = ng - 1;
    else if (side === 'bottom') sy = 0;
    else if (side === 'left') sx = ng - 1;
    else if (side === 'right') sx = 0;

    return neighbor.visual.cells[(sy * ng) + sx].slice();
  }

  function applyTransitionBlending(grid) {
    const world = State.world;
    const amountPct = Utils.clamp(State.visual.transitionBlend || 0, 0, 100);
    const amount = amountPct / 100;
    if (amount <= 0.0001) return;

    const dirs = [
      { dr: -1, dc: 0, side: 'top' },
      { dr: 1, dc: 0, side: 'bottom' },
      { dr: 0, dc: -1, side: 'left' },
      { dr: 0, dc: 1, side: 'right' }
    ];

    for (let row = 0; row < world.rows; row++) {
      for (let col = 0; col < world.cols; col++) {
        const tile = grid[row][col];
        if (!tile.visual || tile.visual.gridSize <= 1 || !tile.visual.cells) continue;

        const g = tile.visual.gridSize;
        const originalCells = tile.visual.cells;
        const newCells = cloneCells(originalCells);
        const band = Math.max(1, Math.ceil(g * amount));
        const blendScale = 0.2 + (amount * 1.1);

        for (let gy = 0; gy < g; gy++) {
          for (let gx = 0; gx < g; gx++) {
            const idx = gy * g + gx;
            const baseColor = originalCells[idx];
            let totalWeight = 0;
            let sumR = 0, sumG = 0, sumB = 0;

            for (const d of dirs) {
              const nr = row + d.dr;
              const nc = col + d.dc;
              if (!inBounds(nr, nc)) continue;

              const neighbor = grid[nr][nc];
              if (!neighbor.visual || neighbor.type === tile.type) continue;

              let dist = -1;
              if (d.side === 'top' && gy < band) dist = gy;
              else if (d.side === 'bottom' && gy >= g - band) dist = (g - 1) - gy;
              else if (d.side === 'left' && gx < band) dist = gx;
              else if (d.side === 'right' && gx >= g - band) dist = (g - 1) - gx;
              if (dist < 0) continue;

              const edgeRatio = 1 - (dist / Math.max(1, band));
              const smooth = edgeRatio * edgeRatio * (3 - 2 * edgeRatio);
              const weight = Utils.clamp(smooth * blendScale, 0, 1);
              if (weight <= 0.0001) continue;

              const neighborColor = getNeighborCellColor(neighbor, d.side, gx, gy, g);
              totalWeight += weight;
              sumR += neighborColor[0] * weight;
              sumG += neighborColor[1] * weight;
              sumB += neighborColor[2] * weight;
            }

            if (totalWeight > 0) {
              const cappedWeight = Utils.clamp(totalWeight, 0, 0.92);
              const neighborAvg = [
                Math.round(sumR / totalWeight),
                Math.round(sumG / totalWeight),
                Math.round(sumB / totalWeight)
              ];
              newCells[idx] = mixColor(baseColor, neighborAvg, cappedWeight);
            }
          }
        }

        tile.visual.cells = newCells;
      }
    }
  }

  function buildNoiseCells(tileType, palette, baseColor, rng, visual) {
    const gridSize = Math.max(1, Math.round(visual.noiseSize || 1));
    if (gridSize <= 1) return { gridSize: 1, cells: [] };

    const density = Math.max(1, Math.round(visual.noiseDensity || gridSize));
    const activeChance = Math.min(1, density / gridSize);
    const accentChance = Math.min(0.92, palette.accentBias + (visual.accentStrength / 100) * 0.42);
    const jitterAmount = 4 + visual.colorVariance;
    const blendStrength = Utils.clamp(visual.noiseOpacity, 0, 1);
    const cells = [];

    for (let gy = 0; gy < gridSize; gy++) {
      for (let gx = 0; gx < gridSize; gx++) {
        let color = baseColor.slice();
        if (rng() <= activeChance) {
          const source = rng() < accentChance ? palette.accents : palette.dominant;
          const target = jitterColor(pickArrayColor(rng, source), jitterAmount, rng, 24);
          color = mixColor(baseColor, target, blendStrength);
        }
        cells.push(color);
      }
    }

    return { gridSize, cells };
  }

  function assignTileVisuals(grid, seed) {
    const world = State.world;
    const visual = State.visual;

    for (let row = 0; row < world.rows; row++) {
      for (let col = 0; col < world.cols; col++) {
        const tile = grid[row][col];
        const rng = RNG.createSeededRandom(`${seed}|visual|${row}|${col}|${tile.type}`);
        const palette = buildVisualPalette(tile.type);
        let base = jitterColor(palette.base, Math.max(2, Math.round(visual.colorVariance * 0.35)), rng, 28);
        base = adjustSaturationContrast(base, visual.saturation, visual.contrast);
        const noise = buildNoiseCells(tile.type, palette, base, rng, visual);
        const cells = noise.cells.map((c) => adjustSaturationContrast(c, visual.saturation, visual.contrast));

        tile.visual = {
          base,
          gridSize: noise.gridSize,
          cells
        };
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
      assignTileVisuals(grid, seed);
      applyTransitionBlending(grid);
      finalizeStats(grid, params);

      return {
        grid,
        params
      };
    }
  };
})();