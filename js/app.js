/* ROAD_PATCH_V2: diagonal connectivity + color fix */
window.Game = window.Game || {};

(function () {
  const Config = window.Game.Config;
  const State = window.Game.State;
  const Utils = window.Game.Utils;
  const Terrain = window.Game.Terrain;
  const Renderer = window.Game.Renderer;
  const Minimap = window.Game.Minimap;
  const UI = window.Game.UI;
  const Input = window.Game.Input;
  const I18n = window.Game.I18n;

  function createDefaultPlayer(rows, cols) {
    return {
      row: Math.floor(rows / 2),
      col: Math.floor(cols / 2),
      moving: false,
      startRow: Math.floor(rows / 2),
      startCol: Math.floor(cols / 2),
      targetRow: Math.floor(rows / 2),
      targetCol: Math.floor(cols / 2),
      moveStartTime: 0,
      moveDuration: 180,
      progress: 1,
      direction: 's',
      pathQueue: []
    };
  }

  function normalizeImportedTile(tile) {
    const type = tile && typeof tile.type === "string" ? tile.type : "grass";
    const numericElevation = Number(tile && tile.elevation);
    return {
      type,
      elevation: Number.isFinite(numericElevation) ? numericElevation : 0,
      tags: new Set(Array.isArray(tile && tile.tags) ? tile.tags : [])
    };
  }

  function buildTerrainGridFromTiles(payload, cols, rows) {
    const tiles = Array.isArray(payload && payload.tiles) ? payload.tiles : [];
    const grid = Array.from({ length: rows }, () => Array.from({ length: cols }, () => normalizeImportedTile(null)));

    for (const tile of tiles) {
      const x = Number(tile && tile.x);
      const y = Number(tile && tile.y);
      if (!Number.isInteger(x) || !Number.isInteger(y)) continue;
      if (y < 0 || y >= rows || x < 0 || x >= cols) continue;
      grid[y][x] = normalizeImportedTile(tile);
    }

    return grid;
  }

  function loadImageElement(src) {
    return new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error(`Failed to load image: ${src}`));
      image.src = src;
    });
  }


  const PNG_SIGNATURE = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
  const PNG_EMBEDDED_DATA_KEY = "simsoft-map-data";
  const STEGO_MAGIC = "SMSD";

  function readUint32BigEndian(bytes, offset) {
    return ((bytes[offset] << 24) >>> 0) + ((bytes[offset + 1] << 16) >>> 0) + ((bytes[offset + 2] << 8) >>> 0) + (bytes[offset + 3] >>> 0);
  }

  function decodeLatin1(bytes) {
    let result = "";
    for (let index = 0; index < bytes.length; index++) {
      result += String.fromCharCode(bytes[index]);
    }
    return result;
  }

  function decodeUtf8(bytes) {
    if (!bytes || !bytes.length) return "";
    if (typeof TextDecoder === "function") {
      return new TextDecoder("utf-8").decode(bytes);
    }
    return decodeLatin1(bytes);
  }

  function extractStegoPayloadFromImageElement(image) {
    if (!image || !image.naturalWidth || !image.naturalHeight) return null;
    const canvas = document.createElement("canvas");
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return null;
    ctx.drawImage(image, 0, 0);
    const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data;

    let bitIndex = 0;
    const readByte = () => {
      let value = 0;
      for (let bit = 0; bit < 8; bit++) {
        const pixelOffset = Math.floor(bitIndex / 3) * 4;
        const channel = bitIndex % 3;
        if (pixelOffset + channel >= pixels.length) return null;
        value = (value << 1) | (pixels[pixelOffset + channel] & 1);
        bitIndex += 1;
      }
      return value;
    };

    const header = [];
    for (let i = 0; i < 12; i++) {
      const byte = readByte();
      if (byte === null) return null;
      header.push(byte);
    }

    const magic = String.fromCharCode(header[0], header[1], header[2], header[3]);
    if (magic !== STEGO_MAGIC) return null;

    const dataLength = ((header[8] << 24) >>> 0) + ((header[9] << 16) >>> 0) + ((header[10] << 8) >>> 0) + (header[11] >>> 0);
    if (!Number.isFinite(dataLength) || dataLength <= 0) return null;

    const payloadBytes = new Uint8Array(dataLength);
    for (let i = 0; i < dataLength; i++) {
      const byte = readByte();
      if (byte === null) return null;
      payloadBytes[i] = byte;
    }

    return JSON.parse(decodeUtf8(payloadBytes));
  }

  async function extractEmbeddedMapDataFromPngBlob(blob) {
    if (!blob || typeof blob.arrayBuffer !== "function") return null;

    try {
      const bytes = new Uint8Array(await blob.arrayBuffer());
      if (bytes.length < PNG_SIGNATURE.length) return null;
      for (let index = 0; index < PNG_SIGNATURE.length; index++) {
        if (bytes[index] !== PNG_SIGNATURE[index]) return null;
      }

      let offset = PNG_SIGNATURE.length;
      while (offset + 8 <= bytes.length) {
        const chunkLength = readUint32BigEndian(bytes, offset);
        offset += 4;
        const chunkType = decodeLatin1(bytes.subarray(offset, offset + 4));
        offset += 4;
        if (offset + chunkLength + 4 > bytes.length) break;
        const chunkData = bytes.subarray(offset, offset + chunkLength);
        offset += chunkLength;
        offset += 4;

        if (chunkType === "iTXt") {
          let cursor = 0;
          const keywordEnd = chunkData.indexOf(0, cursor);
          if (keywordEnd === -1) continue;
          const keyword = decodeLatin1(chunkData.subarray(0, keywordEnd));
          cursor = keywordEnd + 1;
          if (cursor + 2 > chunkData.length) continue;
          const compressionFlag = chunkData[cursor++];
          cursor += 1;
          const languageEnd = chunkData.indexOf(0, cursor);
          if (languageEnd === -1) continue;
          cursor = languageEnd + 1;
          const translatedEnd = chunkData.indexOf(0, cursor);
          if (translatedEnd === -1) continue;
          cursor = translatedEnd + 1;
          if (keyword !== PNG_EMBEDDED_DATA_KEY || compressionFlag !== 0) continue;
          const textValue = decodeUtf8(chunkData.subarray(cursor));
          return JSON.parse(textValue);
        }

        if (chunkType === "tEXt") {
          const keywordEnd = chunkData.indexOf(0);
          if (keywordEnd === -1) continue;
          const keyword = decodeLatin1(chunkData.subarray(0, keywordEnd));
          if (keyword !== PNG_EMBEDDED_DATA_KEY) continue;
          const textValue = decodeLatin1(chunkData.subarray(keywordEnd + 1));
          return JSON.parse(textValue);
        }
      }
    } catch (error) {
      UI.addLog("Embedded PNG map data could not be read.", error && error.message ? error.message : String(error));
    }

    return null;
  }

  async function extractMapDataFromImageSource(imageOrBlob) {
    if (!imageOrBlob) return null;
    try {
      if (imageOrBlob instanceof HTMLImageElement) {
        const stegoPayload = extractStegoPayloadFromImageElement(imageOrBlob);
        if (stegoPayload) return stegoPayload;
        return null;
      }
      if (typeof Blob !== "undefined" && imageOrBlob instanceof Blob) {
        const objectUrl = URL.createObjectURL(imageOrBlob);
        try {
          const image = await loadImageElement(objectUrl);
          const stegoPayload = extractStegoPayloadFromImageElement(image);
          if (stegoPayload) return stegoPayload;
        } finally {
          URL.revokeObjectURL(objectUrl);
        }
        return await extractEmbeddedMapDataFromPngBlob(imageOrBlob);
      }
    } catch (error) {
      UI.addLog("Embedded PNG map data could not be decoded.", error && error.message ? error.message : String(error));
    }
    return null;
  }


  const MAP_CACHE_DB_NAME = "simsoftMapCache";
  const MAP_CACHE_STORE_NAME = "maps";

  function supportsIndexedDb() {
    return typeof indexedDB !== "undefined";
  }

  function openMapCacheDb() {
    return new Promise((resolve, reject) => {
      if (!supportsIndexedDb()) {
        reject(new Error("IndexedDB is not available."));
        return;
      }
      const request = indexedDB.open(MAP_CACHE_DB_NAME, 1);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(MAP_CACHE_STORE_NAME)) {
          db.createObjectStore(MAP_CACHE_STORE_NAME, { keyPath: "seed" });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error("Could not open IndexedDB."));
    });
  }

  function readBlobAsDataUrl(blob) {
    return new Promise((resolve, reject) => {
      if (!blob) {
        reject(new Error("No blob was provided."));
        return;
      }
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ""));
      reader.onerror = () => reject(reader.error || new Error("Failed to read blob as data URL."));
      reader.readAsDataURL(blob);
    });
  }

  async function cacheImportedMap(seed, payload, pngSource, sourceLabel) {
    const safeSeed = String(seed || "").trim();
    if (!safeSeed || !payload || !supportsIndexedDb()) return;
    try {
      let imageDataUrl = "";
      if (typeof Blob !== "undefined" && pngSource instanceof Blob) {
        imageDataUrl = await readBlobAsDataUrl(pngSource);
      } else if (pngSource instanceof HTMLImageElement && pngSource.src) {
        imageDataUrl = String(pngSource.src);
      }
      if (!imageDataUrl) return;
      const db = await openMapCacheDb();
      await new Promise((resolve, reject) => {
        const tx = db.transaction(MAP_CACHE_STORE_NAME, "readwrite");
        const store = tx.objectStore(MAP_CACHE_STORE_NAME);
        store.put({
          seed: safeSeed,
          payload,
          imageDataUrl,
          sourceLabel: String(sourceLabel || "cache"),
          savedAt: Date.now()
        });
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error || new Error("Failed to write cache entry."));
        tx.onabort = () => reject(tx.error || new Error("Cache transaction was aborted."));
      });
      db.close();
    } catch (error) {
      // Caching is a best-effort local convenience feature.
    }
  }

  async function tryLoadSeedFilesFromCache(seed) {
    const safeSeed = String(seed || "").trim();
    if (!safeSeed || !supportsIndexedDb()) return null;
    try {
      const db = await openMapCacheDb();
      const record = await new Promise((resolve, reject) => {
        const tx = db.transaction(MAP_CACHE_STORE_NAME, "readonly");
        const store = tx.objectStore(MAP_CACHE_STORE_NAME);
        const request = store.get(safeSeed);
        request.onsuccess = () => resolve(request.result || null);
        request.onerror = () => reject(request.error || new Error("Failed to read cache entry."));
      });
      db.close();
      if (!record || !record.payload || !record.imageDataUrl) return null;
      const image = await loadImageElement(record.imageDataUrl);
      return {
        payload: record.payload,
        image,
        source: `local cache (${record.sourceLabel || "previously loaded map"})`,
        loadedFromEmbeddedPng: true,
        loadedFromCache: true
      };
    } catch (error) {
      return null;
    }
  }

  const localMapFileCache = {
    byRelativePath: new Map(),
    byName: new Map(),
    orderedFiles: [],
    sourceLabel: ""
  };

  function isFileProtocol() {
    return window.location && window.location.protocol === "file:";
  }

  function normalizeRelativePath(value) {
    return String(value || "").replace(/\\/g, "/").replace(/^\.\//, "").toLowerCase();
  }

  function buildCandidateRelativePaths(seed, extension) {
    const encodedSeed = encodeURIComponent(seed);
    return [
      `map/${seed}.${extension}`,
      `map/${encodedSeed}.${extension}`,
      `${seed}.${extension}`,
      `${encodedSeed}.${extension}`
    ].map(normalizeRelativePath);
  }

  function getSeedFileFromCache(seed, extension) {
    const candidates = buildCandidateRelativePaths(seed, extension);
    for (const candidate of candidates) {
      if (localMapFileCache.byRelativePath.has(candidate)) {
        return localMapFileCache.byRelativePath.get(candidate);
      }
    }
    const directName = `${seed}.${extension}`.toLowerCase();
    const encodedName = `${encodeURIComponent(seed)}.${extension}`.toLowerCase();
    return localMapFileCache.byName.get(directName) || localMapFileCache.byName.get(encodedName) || null;
  }

  async function tryLoadSeedFilesFromSelectedFolder(seed) {
    const safeSeed = (seed || "").trim();
    if (!safeSeed || !localMapFileCache.byName.size) return null;

    const txtFile = getSeedFileFromCache(safeSeed, "txt");
    const pngFile = getSeedFileFromCache(safeSeed, "png");
    if (!pngFile) return null;

    return await loadMapPairFromFiles(safeSeed, txtFile, pngFile, localMapFileCache.sourceLabel || "selected folder");
  }

  function stripExtension(fileName) {
    return String(fileName || "").replace(/\.[^.]+$/, "");
  }

  function getFirstMapPairFromSelectedFolder() {
    if (!localMapFileCache.orderedFiles.length) return null;

    for (const file of localMapFileCache.orderedFiles) {
      const fileName = String(file && file.name ? file.name : "");
      if (!/\.png$/i.test(fileName)) continue;

      const baseName = stripExtension(fileName);
      const txtFile = localMapFileCache.byName.get(`${baseName.toLowerCase()}.txt`) || null;

      return {
        seed: baseName,
        pngFile: file,
        txtFile
      };
    }

    return null;
  }

  async function loadMapPairFromFiles(seed, txtFile, pngFile, sourceLabel) {
    if (!pngFile) return null;

    try {
      const objectUrl = URL.createObjectURL(pngFile);
      try {
        const image = await loadImageElement(objectUrl);
        let payload = null;
        if (txtFile) {
          payload = JSON.parse(await txtFile.text());
        }
        if (!payload) {
          payload = await extractMapDataFromImageSource(image);
        }
        if (!payload) {
          UI.addLog(`Stored map data could not be found for ${seed}.`, "Provide either a matching .txt file or a .png file with embedded steganographic JSON map data.");
          return null;
        }
        await cacheImportedMap(seed, payload, pngFile, sourceLabel || localMapFileCache.sourceLabel || "selected folder");
        return {
          seed,
          payload,
          image,
          source: sourceLabel || localMapFileCache.sourceLabel || "selected folder",
          loadedFromEmbeddedPng: !txtFile
        };
      } finally {
        URL.revokeObjectURL(objectUrl);
      }
    } catch (error) {
      UI.addLog(`Stored map files could not be read for ${seed}.`, error && error.message ? error.message : String(error));
      return null;
    }
  }

  async function registerLocalMapFiles(fileList) {
    localMapFileCache.byRelativePath.clear();
    localMapFileCache.byName.clear();
    localMapFileCache.orderedFiles = [];
    localMapFileCache.sourceLabel = "";

    const files = Array.from(fileList || []);
    if (!files.length) {
      UI.addLog("No local folder was selected for map loading.");
      return false;
    }

    const rootFolderName = String(files[0].webkitRelativePath || "").split("/")[0] || "selected folder";
    localMapFileCache.sourceLabel = rootFolderName;

    for (const file of files) {
      const relativePath = normalizeRelativePath((file && file.webkitRelativePath) || (file && file.name) || "");
      const fileName = String(file && file.name ? file.name : "").toLowerCase();
      if (relativePath) localMapFileCache.byRelativePath.set(relativePath, file);
      if (fileName) localMapFileCache.byName.set(fileName, file);
      localMapFileCache.orderedFiles.push(file);
    }

    UI.addLog(`Local map folder indexed.`, `${files.length} files scanned from ${rootFolderName}.`);

    const firstPair = getFirstMapPairFromSelectedFolder();
    if (!firstPair) {
      UI.addLog("No loadable map pair was found in the selected folder.", "Expected at least one .png file. The app can load a matching .txt file or embedded JSON metadata stored inside the PNG.");
      return false;
    }

    const world = State.world || {};
    const cols = world.cols || Config.DEFAULT_COLS;
    const rows = world.rows || Config.DEFAULT_ROWS;
    const imported = await loadMapPairFromFiles(firstPair.seed, firstPair.txtFile, firstPair.pngFile, localMapFileCache.sourceLabel || "selected folder");
    if (imported && imported.payload && imported.image) {
      applyImportedWorld(imported.seed, cols, rows, imported.payload, imported.image, imported.source);
      return true;
    }

    UI.addLog("Stored map files found in the selected folder could not be loaded.", `First detected map file: ${firstPair.seed}.png.`);
    return false;
  }

  function promptLocalMapFolderSelection() {
    const folderInput = State.dom && State.dom.localMapFolderInput;
    if (!folderInput) {
      UI.addLog("Local folder picker is not available in this build.");
      return;
    }
    folderInput.value = "";
    folderInput.click();
  }

  async function tryLoadSeedFiles(seed) {
    const safeSeed = (seed || "").trim();
    if (!safeSeed) return null;

    const basePath = `map/${encodeURIComponent(safeSeed)}`;
    const txtUrl = `${basePath}.txt`;
    const pngUrl = `${basePath}.png`;

    try {
      if (isFileProtocol()) {
        let image = null;
        let payload = null;
        try {
          image = await loadImageElement(pngUrl);
          payload = await extractMapDataFromImageSource(image);
        } catch (error) {
          payload = null;
        }
        if (payload && image) {
          return {
            payload,
            image,
            source: "map folder (steganographic PNG)",
            loadedFromEmbeddedPng: true
          };
        }
        const cached = await tryLoadSeedFilesFromCache(safeSeed);
        if (cached) {
          UI.addLog(`Loaded cached map for ${safeSeed}.`, "Direct startup decoding from file:// was blocked by browser canvas security, so the app used the last locally cached copy of this map.");
          return cached;
        }
        return await tryLoadSeedFilesFromSelectedFolder(safeSeed);
      }

      const pngResponse = await fetch(pngUrl, { cache: "no-store" });
      if (!pngResponse.ok) return await tryLoadSeedFilesFromSelectedFolder(safeSeed);

      const imageBlob = await pngResponse.blob();
      const objectUrl = URL.createObjectURL(imageBlob);
      try {
        const image = await loadImageElement(objectUrl);
        let payload = null;
        let loadedFromEmbeddedPng = false;

        try {
          const txtResponse = await fetch(txtUrl, { cache: "no-store" });
          if (txtResponse.ok) {
            payload = JSON.parse(await txtResponse.text());
          }
        } catch (error) {
          // Intentionally fall back to PNG-embedded data below.
        }

        if (!payload) {
          payload = await extractMapDataFromImageSource(imageBlob);
          loadedFromEmbeddedPng = !!payload;
        }

        if (!payload) return await tryLoadSeedFilesFromSelectedFolder(safeSeed);

        await cacheImportedMap(safeSeed, payload, imageBlob, loadedFromEmbeddedPng ? "map folder (embedded PNG data)" : "map folder");
        return {
          payload,
          image,
          source: loadedFromEmbeddedPng ? "map folder (embedded PNG data)" : "map folder",
          loadedFromEmbeddedPng
        };
      } finally {
        URL.revokeObjectURL(objectUrl);
      }
    } catch (error) {
      const message = error && error.message ? error.message : String(error);
      if (isFileProtocol()) {
        const cached = await tryLoadSeedFilesFromCache(safeSeed);
        if (cached) {
          UI.addLog(`Loaded cached map for ${safeSeed}.`, "Direct startup decoding from file:// was blocked by browser canvas security, so the app used the last locally cached copy of this map.");
          return cached;
        }
      }
      if (isFileProtocol() && localMapFileCache.byName.size === 0) {
        UI.addLog(
          `Stored map files could not be loaded directly for seed ${safeSeed}.`,
          `Direct file loading from file:// remains limited by the browser because drawing a local PNG to canvas taints the canvas, which blocks steganographic decoding. The app can still auto-load this map on startup after you load it once from Main Menu > Choose Files, because a local cached copy will be stored for later sessions. A local web server also avoids this browser restriction.`
        );
      } else {
        UI.addLog(`Stored map files could not be loaded for seed ${safeSeed}.`, message);
      }
      return await tryLoadSeedFilesFromSelectedFolder(safeSeed);
    }
  }

  function applyImportedWorld(seed, cols, rows, payload, image, sourceLabel) {
    const world = State.world;
    const camera = State.camera;
    const render = State.render;
    const importedMap = payload && payload.map ? payload.map : {};
    const importedCamera = payload && payload.camera ? payload.camera : {};
    const importedPlayer = payload && payload.player ? payload.player : {};
    const resolvedCols = Math.max(1, Number(importedMap.cols) || cols);
    const resolvedRows = Math.max(1, Number(importedMap.rows) || rows);
    const fallbackPlayer = createDefaultPlayer(resolvedRows, resolvedCols);

    world.seed = seed;
    world.cols = resolvedCols;
    world.rows = resolvedRows;
    world.tileWidth = Number(importedMap.tileWidth) || world.tileWidth || Config.TILE_WIDTH;
    world.tileHeight = Number(importedMap.tileHeight) || world.tileHeight || Config.TILE_HEIGHT;
    world.selected = null;
    world.hover = null;
    world.previewPath = [];
    world.terrain = buildTerrainGridFromTiles(payload, resolvedCols, resolvedRows);
    world.params = payload && payload.params ? payload.params : {
      hillCount: 0,
      streamCount: 0,
      roadCount: 0,
      hasLake: false,
      hasForest: false,
      hasSettlement: false,
      actualHillCoverage: 0,
      actualForestCoverage: 0,
      actualSettlementCoverage: 0,
      actualGrassCoverage: 0,
      actualDirtCoverage: 0,
      actualWaterCoverage: 0,
      actualStoneCoverage: 0
    };
    world.player = {
      ...fallbackPlayer,
      row: Number.isInteger(importedPlayer.row) ? importedPlayer.row : fallbackPlayer.row,
      col: Number.isInteger(importedPlayer.col) ? importedPlayer.col : fallbackPlayer.col,
      startRow: Number.isInteger(importedPlayer.row) ? importedPlayer.row : fallbackPlayer.startRow,
      startCol: Number.isInteger(importedPlayer.col) ? importedPlayer.col : fallbackPlayer.startCol,
      targetRow: Number.isInteger(importedPlayer.row) ? importedPlayer.row : fallbackPlayer.targetRow,
      targetCol: Number.isInteger(importedPlayer.col) ? importedPlayer.col : fallbackPlayer.targetCol,
      direction: importedPlayer.direction || fallbackPlayer.direction,
      moving: false,
      progress: 1,
      pathQueue: []
    };

    if (Number.isFinite(Number(importedCamera.pitchAngle))) camera.pitchAngle = Number(importedCamera.pitchAngle);
    if (Number.isFinite(Number(importedCamera.depthStrength))) camera.depthStrength = Number(importedCamera.depthStrength);
    if (Number.isFinite(Number(importedCamera.blendPixelSize))) camera.blendPixelSize = Number(importedCamera.blendPixelSize);
    if (Number.isFinite(Number(importedCamera.blendStrength))) camera.blendStrength = Number(importedCamera.blendStrength);
    if (Number.isFinite(Number(importedCamera.noiseGridDivisions))) camera.noiseGridDivisions = Number(importedCamera.noiseGridDivisions);
    if (typeof importedCamera.showGrid === "boolean") camera.showGrid = importedCamera.showGrid;
    if (typeof importedCamera.reliefEnabled === "boolean") camera.reliefEnabled = importedCamera.reliefEnabled;
    if (Number.isFinite(Number(importedCamera.sunAzimuth))) camera.sunAzimuth = Number(importedCamera.sunAzimuth);
    if (Number.isFinite(Number(importedCamera.sunElevation))) camera.sunElevation = Number(importedCamera.sunElevation);
    if (Number.isFinite(Number(importedCamera.shadowStrength))) camera.shadowStrength = Number(importedCamera.shadowStrength);
    if (Number.isFinite(Number(importedCamera.highlightStrength))) camera.highlightStrength = Number(importedCamera.highlightStrength);
    if (Number.isFinite(Number(importedCamera.shadowLength))) camera.shadowLength = Number(importedCamera.shadowLength);
    camera.zoom = Number.isFinite(Number(importedCamera.zoom)) ? Number(importedCamera.zoom) : Config.DEFAULT_START_ZOOM;
    camera.x = world.player.col;
    camera.y = world.player.row;

    const sourceWidth = image.naturalWidth || image.width;
    const sourceHeight = image.naturalHeight || image.height;
    const backgroundCanvas = document.createElement("canvas");
    backgroundCanvas.width = sourceHeight;
    backgroundCanvas.height = sourceWidth;

    const backgroundCtx = backgroundCanvas.getContext("2d", { alpha: false });
    backgroundCtx.translate(0, backgroundCanvas.height);
    backgroundCtx.rotate(-Math.PI / 2);
    backgroundCtx.drawImage(image, 0, 0);

    render.worldBackgroundCanvas = backgroundCanvas;
    render.needsBackgroundRebuild = false;
    render.needsBackgroundUpload = true;
    render.backgroundTextureReady = false;

    UI.syncSettingsInputs();
    UI.updateParamUI();
    Renderer.fitCameraToWorld();
    Renderer.markDirty();
    const sourceText = sourceLabel ? `Source: ${sourceLabel}.` : "";
    UI.addLog(`Stored map files loaded for seed ${seed}.`, `${sourceText} Loaded map image and map data for ${seed}.`.trim());
  }

  function applyGeneratedWorld(seed, cols, rows) {
    const world = State.world;
    world.seed = seed;
    world.cols = cols;
    world.rows = rows;
    world.selected = null;
    world.hover = null;
    world.previewPath = [];
    world.player = createDefaultPlayer(rows, cols);

    const generated = Terrain.generateWorld(seed, cols, rows);
    if (generated && generated.playerStart) {
      world.player.row = generated.playerStart.row;
      world.player.col = generated.playerStart.col;
      world.player.startRow = generated.playerStart.row;
      world.player.startCol = generated.playerStart.col;
      world.player.targetRow = generated.playerStart.row;
      world.player.targetCol = generated.playerStart.col;
    }
    State.camera.zoom = Config.DEFAULT_START_ZOOM;
    State.camera.x = world.player.col;
    State.camera.y = world.player.row;

    world.terrain = generated.grid;
    world.params = generated.params;

    State.render.needsBackgroundRebuild = true;
    State.render.needsBackgroundUpload = true;
    State.render.backgroundTextureReady = false;
    UI.syncSettingsInputs();
    UI.updateParamUI();
    Renderer.fitCameraToWorld();
    Renderer.markDirty();
    UI.addLog(I18n.t("logs.worldRebuilt", { seed, cols, rows }));
  }

  async function rebuildWorld(seed, cols, rows) {
    const imported = await tryLoadSeedFiles(seed);
    if (imported && imported.payload && imported.image) {
      applyImportedWorld(seed, cols, rows, imported.payload, imported.image, imported.source);
      return;
    }
    applyGeneratedWorld(seed, cols, rows);
  }

  function updateWorldSummary(seed, cols, rows) {
    UI.updateDialogText(
      I18n.t("dialog.worldSummary", {
        seed,
        cols,
        rows,
        hills: State.world.params.hillCount,
        streams: State.world.params.streamCount,
        roads: State.world.params.roadCount
      })
    );
  }

  async function handleApplySettings() {
    const dom = State.dom;

    const seed = (dom.seedInput.value || "").trim() || Config.DEFAULT_SEED;
    const cols = Utils.clamp(Number(dom.mapWidthInput.value) || Config.DEFAULT_COLS, Config.MIN_MAP_SIZE, Config.MAX_MAP_SIZE);
    const rows = Utils.clamp(Number(dom.mapHeightInput.value) || Config.DEFAULT_ROWS, Config.MIN_MAP_SIZE, Config.MAX_MAP_SIZE);
    const pitchAngle = Utils.clamp(Number(dom.cameraPitchInput.value) || Config.DEFAULT_CAMERA_PITCH, Config.MIN_CAMERA_PITCH, Config.MAX_CAMERA_PITCH);
    const depthStrength = Utils.clamp(Number(dom.depthStrengthInput.value) || Config.DEFAULT_DEPTH_STRENGTH, Config.MIN_DEPTH_STRENGTH, Config.MAX_DEPTH_STRENGTH);
    const blendPixelSize = Utils.clamp(
      Number(dom.blendPixelSizeInput && dom.blendPixelSizeInput.value) || Config.DEFAULT_BLEND_PIXEL_SIZE,
      Config.MIN_BLEND_PIXEL_SIZE,
      Config.MAX_BLEND_PIXEL_SIZE
    );
    const blendStrength = Utils.clamp(
      Number(dom.blendStrengthInput && dom.blendStrengthInput.value) || Config.DEFAULT_BLEND_STRENGTH,
      Config.MIN_BLEND_STRENGTH,
      Config.MAX_BLEND_STRENGTH
    );
    const noiseGridDivisions = Utils.clamp(
      Number(dom.noiseGridDivisionsInput && dom.noiseGridDivisionsInput.value) || Config.DEFAULT_NOISE_GRID_DIVISIONS,
      Config.MIN_NOISE_GRID_DIVISIONS,
      Config.MAX_NOISE_GRID_DIVISIONS
    );
    const showGrid = !!(dom.showGridInput && dom.showGridInput.checked);
    const reliefEnabled = !!(dom.reliefEnabledInput && dom.reliefEnabledInput.checked);
    const sunAzimuth = Utils.clamp(
      Number(dom.sunAzimuthInput && dom.sunAzimuthInput.value) || Config.DEFAULT_SUN_AZIMUTH,
      Config.MIN_SUN_AZIMUTH,
      Config.MAX_SUN_AZIMUTH
    );
    const sunElevation = Utils.clamp(
      Number(dom.sunElevationInput && dom.sunElevationInput.value) || Config.DEFAULT_SUN_ELEVATION,
      Config.MIN_SUN_ELEVATION,
      Config.MAX_SUN_ELEVATION
    );
    const shadowStrength = Utils.clamp(
      Number(dom.shadowStrengthInput && dom.shadowStrengthInput.value) || Config.DEFAULT_SHADOW_STRENGTH,
      Config.MIN_SHADOW_STRENGTH,
      Config.MAX_SHADOW_STRENGTH
    );
    const highlightStrength = Utils.clamp(
      Number(dom.highlightStrengthInput && dom.highlightStrengthInput.value) || Config.DEFAULT_HIGHLIGHT_STRENGTH,
      Config.MIN_HIGHLIGHT_STRENGTH,
      Config.MAX_HIGHLIGHT_STRENGTH
    );
    const shadowLength = Utils.clamp(
      Number(dom.shadowLengthInput && dom.shadowLengthInput.value) || Config.DEFAULT_SHADOW_LENGTH,
      Config.MIN_SHADOW_LENGTH,
      Config.MAX_SHADOW_LENGTH
    );

    State.camera.pitchAngle = pitchAngle;
    State.camera.depthStrength = depthStrength;
    State.camera.blendPixelSize = blendPixelSize;
    State.camera.blendStrength = blendStrength;
    State.camera.noiseGridDivisions = noiseGridDivisions;
    State.camera.showGrid = showGrid;
    State.camera.reliefEnabled = reliefEnabled;
    State.camera.sunAzimuth = sunAzimuth;
    State.camera.sunElevation = sunElevation;
    State.camera.shadowStrength = shadowStrength;
    State.camera.highlightStrength = highlightStrength;
    State.camera.shadowLength = shadowLength;
    await rebuildWorld(seed, cols, rows);
    UI.closeSettingsModal();
    UI.addLog(I18n.t("logs.settingsApplied", { seed, cols, rows }));
    updateWorldSummary(seed, cols, rows);
  }

  async function handleLanguageChange(lang) {
    await I18n.loadLanguage(lang);
    UI.applyCurrentLanguageToUI();
    updateWorldSummary(State.world.seed, State.world.cols, State.world.rows);
  }

  function resizeAll() {
    UI.updateResponsiveLayout();
    Renderer.resizeCanvas();
    Renderer.updateZoomLimits();
    Minimap.resizeMinimap();
    Renderer.markDirty();
  }

  function loop(timestamp) {
    Input.updateCameraFromKeyboard();
    Input.updatePlayerMovement(timestamp || performance.now());
    Renderer.updateCameraFollow();
    Renderer.renderWorld();
    Minimap.renderMinimap();
    requestAnimationFrame(loop);
  }

  function normalizeUrl(url) {
    if (!url) return I18n.t("logs.unknownSource");
    try {
      const parsed = new URL(url, window.location.href);
      const parts = parsed.pathname.split("/");
      return parts[parts.length - 1] || parsed.href;
    } catch (error) {
      return String(url);
    }
  }

  function formatStack(error) {
    if (!error || !error.stack) return I18n.t("logs.noStack");
    return error.stack;
  }

  function buildErrorDetails(message, source, lineno, colno, errorObj, extra) {
    const detailLines = [
      `${I18n.t("logs.message")}    : ${message || I18n.t("logs.unknown")}`,
      `${I18n.t("logs.file")}      : ${normalizeUrl(source)}`,
      `${I18n.t("logs.line")}      : ${lineno || 0}`,
      `${I18n.t("logs.column")}    : ${colno || 0}`
    ];

    if (extra) {
      detailLines.push(`${I18n.t("logs.extraInfo")} : ${extra}`);
    }

    if (errorObj && errorObj.name) {
      detailLines.push(`${I18n.t("logs.errorType")} : ${errorObj.name}`);
    }

    detailLines.push(`${I18n.t("logs.stack")}     :`);
    detailLines.push(formatStack(errorObj));

    return detailLines.join("\n");
  }

  function registerGlobalErrorHandlers() {
    const ignoreFileOriginWarning = (message) => {
      return typeof message === "string" && message.indexOf("Unsafe attempt to load URL file:///") !== -1;
    };

    window.onerror = function (message, source, lineno, colno, errorObj) {
      if (ignoreFileOriginWarning(message)) return true;
      UI.addLog(I18n.t("logs.runtimeError"), buildErrorDetails(message, source, lineno, colno, errorObj));
      return false;
    };

    window.addEventListener("error", (event) => {
      if (ignoreFileOriginWarning(event.message)) return;
      if (event.error || event.message) {
        UI.addLog(
          I18n.t("logs.globalError"),
          buildErrorDetails(event.message, event.filename, event.lineno, event.colno, event.error)
        );
        return;
      }

      const target = event.target;
      if (target && target !== window) {
        const source = target.src || target.href || target.currentSrc || I18n.t("logs.unknownSource");
        UI.addLog(
          I18n.t("logs.staticResourceFailed"),
          buildErrorDetails(
            I18n.t("logs.resourceLoadError"),
            source,
            0,
            0,
            null,
            `${I18n.t("logs.tag")}: <${String(target.tagName || "unknown").toLowerCase()}>`
          )
        );
      }
    }, true);

    window.addEventListener("unhandledrejection", (event) => {
      const reason = event.reason;
      const reasonMessage = reason && reason.message ? reason.message : String(reason);
      UI.addLog(
        I18n.t("logs.promiseRejection"),
        buildErrorDetails(reasonMessage, reason && reason.fileName, reason && reason.lineNumber, reason && reason.columnNumber, reason)
      );
    });
  }

  async function init() {
    try {
      await I18n.loadLanguage(I18n.getPreferredLanguage());
      UI.cacheDom();
      UI.bindUIEvents(handleApplySettings, handleLanguageChange);
      UI.bindChoiceButtons();
      Input.bindInputEvents();
      Minimap.bindMinimapEvents();
      registerGlobalErrorHandlers();
      UI.applyCurrentLanguageToUI();

      resizeAll();
      UI.addLog(I18n.t("logs.appStarted"));
      await rebuildWorld(Config.DEFAULT_SEED, Config.DEFAULT_COLS, Config.DEFAULT_ROWS);
      updateWorldSummary(Config.DEFAULT_SEED, Config.DEFAULT_COLS, Config.DEFAULT_ROWS);

      window.addEventListener("resize", () => {
        resizeAll();
        UI.addLog(I18n.t("logs.windowResized"));
      });

      loop();
    } catch (error) {
      console.error(error);
      alert(error.message || String(error));
    }
  }

  window.Game.App = {
    registerLocalMapFiles,
    promptLocalMapFolderSelection
  };

  window.addEventListener("DOMContentLoaded", init);
})();
