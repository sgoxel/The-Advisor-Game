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

  function getCanvasMousePosition(event) {
    const canvas = State.dom.canvas;
    const rect = canvas.getBoundingClientRect();

    return {
      x: event.clientX - rect.left,
      y: event.clientY - rect.top
    };
  }

  function bindInputEvents() {
    const dom = State.dom;
    const camera = State.camera;
    const input = State.input;
    const world = State.world;

    dom.canvas.addEventListener("mousemove", (event) => {
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

    dom.canvas.addEventListener("mousedown", (event) => {
      if (event.button !== 0) return;

      const pos = getCanvasMousePosition(event);
      camera.dragActive = true;
      camera.movedWhileDragging = false;
      camera.lastX = pos.x;
      camera.lastY = pos.y;
      dom.canvas.classList.add("dragging");
    });

    dom.canvas.addEventListener("wheel", (event) => {
      event.preventDefault();
      const oldZoom = camera.zoom;
      const direction = event.deltaY < 0 ? 1 : -1;
      const newZoom = Utils.clamp(
        Number((oldZoom + direction * camera.zoomStep).toFixed(2)),
        camera.minZoom,
        camera.maxZoom
      );

      if (newZoom !== oldZoom) {
        camera.zoom = newZoom;
        Renderer.centerCamera();
        Renderer.markDirty();
        UI.addLog(`Zoom değiştirildi: ${newZoom.toFixed(2)}x`);
      }
    }, { passive: false });

    window.addEventListener("mouseup", () => {
      camera.dragActive = false;
      dom.canvas.classList.remove("dragging");
    });

    dom.canvas.addEventListener("mouseleave", () => {
      camera.dragActive = false;
      dom.canvas.classList.remove("dragging");
      if (world.hover) {
        world.hover = null;
        Renderer.markDirty(true, false);
      }
    });

    dom.canvas.addEventListener("click", (event) => {
      if (camera.movedWhileDragging) {
        camera.movedWhileDragging = false;
        return;
      }

      const pos = getCanvasMousePosition(event);
      const picked = Renderer.pickTile(pos.x, pos.y);

      if (picked) {
        world.selected = picked;
        Renderer.markDirty(true, true);
        UI.addLog(`Tile seçildi: satır=${picked.row}, sütun=${picked.col}`);
      }
    });

    window.addEventListener("keydown", (event) => {
      if (!dom.settingsModal.classList.contains("hidden")) {
        if (event.key === "Escape") {
          UI.closeSettingsModal();
        }
        return;
      }

      if (!dom.logModal.classList.contains("hidden")) {
        if (event.key === "Escape") {
          UI.closeLogModal();
        }
        return;
      }

      input.keys.add(event.key.toLowerCase());
    });

    window.addEventListener("keyup", (event) => {
      input.keys.delete(event.key.toLowerCase());
    });
  }

  function updateCameraFromKeyboard() {
    const input = State.input;
    const camera = State.camera;
    let moved = false;

    if (input.keys.has("arrowup") || input.keys.has("w")) {
      camera.y += camera.moveSpeed;
      moved = true;
    }
    if (input.keys.has("arrowdown") || input.keys.has("s")) {
      camera.y -= camera.moveSpeed;
      moved = true;
    }
    if (input.keys.has("arrowleft") || input.keys.has("a")) {
      camera.x += camera.moveSpeed;
      moved = true;
    }
    if (input.keys.has("arrowright") || input.keys.has("d")) {
      camera.x -= camera.moveSpeed;
      moved = true;
    }

    if (moved) {
      Renderer.markDirty();
    }
  }

  window.Game.Input = {
    bindInputEvents,
    updateCameraFromKeyboard
  };
})();
