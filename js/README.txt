# README – WebGL / HTML5 Tile-Based Map Generator Application

// THIS README FILE MUST BE UPDATED IF ANY CHANGES ARE APPLIED BY AI TOOLS.

## 1. Overview

This application is a WebGL + HTML5-based tile map generator designed for procedural terrain generation.

- Fully client-side (no backend)
- Lightweight architecture
- Deterministic behavior support (via seed if implemented)

Primary goal:
Enable safe, controlled updates by AI tools.

---

## 2. Core Functional Capabilities

### Map Generation
- Grid-based system
- Default tile: grass
- Other tiles: settlement, forest, lake, dirt

### Rules
- Settlement size: 5x5 to 8x8
- Non-grass tiles must be clustered
- Grass = base layer

---

## 3. Generation Pipeline (STRICT ORDER)

1. Initialize map with grass
2. Generate clusters (forest, lake, dirt)
3. Generate settlements (last)

AI MUST NOT change this order.

---

## 4. Tile Priority Rules

Priority (high → low):
1. Settlement
2. Lake
3. Forest
4. Dirt
5. Grass

Higher priority tiles overwrite lower ones.

---

## 5. Coordinate System

- Origin: (0,0) top-left
- X → right
- Y → down

---

## 6. Tile Model

{
  type: "grass" | "forest" | "lake" | "settlement" | "dirt",
  x: number,
  y: number
}

---

## 7. Function Contracts

generateMap():
- Must follow pipeline order

generateSettlements():
- Must create 5x5–8x8 rectangles
- Must not overlap or exceed bounds

generateClusters():
- Must create connected tiles
- No isolated tiles allowed

---

## 8. Edge Case Rules

- No out-of-bound placement
- No overlapping settlements
- Clusters must stay within bounds

---

## 9. Rendering Rules

- Renderer is READ-ONLY
- Must not modify tile data

---

## 10. Export Rules

- Export only canvas (no UI)
- Format: PNG

---

## 11. Randomization

- If randomness is used:
  - Seed-based approach recommended
  - AI must preserve randomness behavior

---

## 12. Performance

- Avoid unnecessary loops
- Prefer preallocated arrays
- Minimize redraws

---

## 13. AI Update Rules

AI MUST:
- Make minimal changes
- Preserve architecture
- Avoid refactoring unless required

AI MUST NOT:
- Change tile types
- Change grid structure
- Move logic between layers
- Introduce backend or async complexity

---

## 14. Naming Conventions

- camelCase → functions
- UPPER_CASE → constants
- lowercase → tile types

---

## 15. AI Change Log

Every update must append:

Date:
Modified files:
Description:
Reason:

---

## 16. Summary

- Grid-based procedural generator
- WebGL rendering
- PNG export
- Fully client-side

AI must prioritize:
- Stability
- Predictability
- Minimal impact changes

Date: 2026-03-27
Modified files: js/ui.js, js/terrain.js
Description: Export now downloads the full generated map image from the world background canvas instead of only the visible viewport; settlement rectangles are explicitly clamped to 5x5–8x8 for both generated and fallback placement.
Reason: Meet the full-map PNG export requirement while preserving rendering performance and guarantee settlement size bounds in all placement paths.


Date: 2026-03-27
Modified files: js/ui.js, js/terrain.js
Description: PNG export now rotates the full-map image 90 degrees clockwise before download; world generation now enforces a blocked-terrain coverage floor of 30% while keeping clustered obstacle placement and without exceeding the intended 60% ceiling.
Reason: Meet the export orientation requirement and prevent sparse maps that look overly empty in generated results.


Date: 2026-03-28
Modified files: index.html, js/ui.js, js/state.js, locales/en.json, locales/tr.json, js/README.txt
Description: Added an Export Map Data button under the main menu that downloads a TXT file containing JSON-formatted map data, current world metadata, camera settings, flattened tile records, and an embedded PNG data URL for later re-import.
Reason: Support single-file export of map image and tile information with minimal UI and logic changes while preserving the existing application behavior.


Date: 2026-03-28
Modified files: js/app.js, js/README.txt
Description: Added automatic seed-based map import. When matching /map/<SEED>.txt and /map/<SEED>.png files both exist, the app loads those files instead of generating a new map, restoring tile data from JSON and using the PNG as the background map image.
Reason: Enable deterministic reuse of previously exported map assets with minimal impact on the existing generation flow.


Update v98.1
- Added a local-folder loading fallback for file:// usage.
- When the browser blocks fetch access to map/*.txt under file://, use Main Menu > Load and select the app folder or the map folder once.
- After folder selection, the app searches for SEED-matching .txt and .png files and loads them instead of generating a new map.
- Standard automatic loading from /map still works normally when the app is served through http:// or https://.


Update v100:
- Fixed persistent visible native file picker issue by adding a global .hidden CSS rule.
- Forced #localMapFolderInput to remain out of layout with display:none, zero size, opacity 0, and no pointer events.
- Added hidden, aria-hidden, and tabindex=-1 attributes to the local folder input element.
- Main Menu button types remain correct; the issue was not caused by button type.

- Imported stored PNG map images are rotated 90 degrees counter-clockwise in the gameplay background so they align with the minimap orientation.


Update v102b
Modified files: js/app.js, js/README.txt
Description: Manual map loading now ignores the current SEED when files are selected through Main Menu > Load. The app loads the first .png file in the selected folder that has a matching .txt file with the same base filename, then updates the active SEED to that filename. Automatic SEED-based loading from /map/<SEED>.png and /map/<SEED>.txt remains unchanged for direct startup loading.


Version: v104
Date: 2026-03-28
Description: PNG export now embeds the full map JSON payload directly inside the exported PNG as PNG metadata. Map loading now supports PNG-only imports by reading embedded JSON when no matching TXT file is present, for both manual folder loading and normal map-folder loading.
Reason: Allow single-file map portability so users can distribute and reload only one PNG file instead of a PNG and TXT pair.


2026-03-28
Modified files: js/ui.js, js/app.js
Description: Replaced PNG metadata embedding with steganographic PNG export/import. Exported PNG files now hide the map JSON inside pixel LSB data, allowing PNG-only loading under file:// by decoding the image through an off-screen canvas. Manual and automatic loading continue to support legacy .txt sidecar files and earlier metadata-based PNG files as fallbacks.


2026-03-28 cache fallback update
- Added IndexedDB-based local cache for successfully imported map PNG+JSON payloads.
- Under file:// startup, when browser canvas security blocks steganographic decoding of map/<SEED>.png, the app now falls back to the last cached copy of that seed if it was loaded manually before.
- Added clearer log text explaining that direct startup decoding from local disk is blocked by browser security and that one successful manual load seeds the cache for later sessions.
