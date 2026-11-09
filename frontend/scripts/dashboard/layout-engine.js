/**
 * CALEBSYS ERP — 12-COLUMN RESPONSIVE GRID & INTERACTION ENGINE
 * Archivo: frontend/scripts/dashboard/layout-engine.js
 * Soporta Drag & Drop, Redimensionamiento con límites min/max, Navegación por teclado,
 * Prevención de colisiones y Compactación vertical automática.
 */
(function () {
  'use strict';

  const GRID_COLS = 12;
  const ROW_UNIT_PX = 44;

  function getDesktopRect(instance) {
    const pos = instance?.positions?.desktop || instance?.grid?.desktop || { x: 0, y: 0, w: 3, h: 2 };
    return {
      x: Math.max(0, Math.min(GRID_COLS - 1, Number(pos.x || 0))),
      y: Math.max(0, Number(pos.y || 0)),
      w: Math.max(2, Math.min(GRID_COLS, Number(pos.w || 3))),
      h: Math.max(1, Math.min(12, Number(pos.h || 2))),
    };
  }

  function setDesktopRect(instance, rect) {
    if (!instance.positions) instance.positions = {};
    instance.positions.desktop = {
      x: Math.max(0, Math.min(GRID_COLS - 1, Number(rect.x || 0))),
      y: Math.max(0, Number(rect.y || 0)),
      w: Math.max(2, Math.min(GRID_COLS, Number(rect.w || 3))),
      h: Math.max(1, Math.min(12, Number(rect.h || 2))),
    };
    instance.positions.tablet = {
      x: instance.positions.desktop.x % 8,
      y: instance.positions.desktop.y,
      w: Math.min(8, instance.positions.desktop.w),
      h: instance.positions.desktop.h,
    };
    instance.positions.mobile = {
      x: 0,
      y: instance.positions.desktop.y,
      w: 1,
      h: instance.positions.desktop.h,
    };
  }

  function rectsOverlap(a, b) {
    return !(
      a.x + a.w <= b.x ||
      b.x + b.w <= a.x ||
      a.y + a.h <= b.y ||
      b.y + b.h <= a.y
    );
  }

  function resolveCollisionsAndCompact(widgets, movedInstanceId) {
    const visible = widgets.filter(w => w.visible !== false);
    visible.forEach(w => {
      const r = getDesktopRect(w);
      if (r.x + r.w > GRID_COLS) {
        r.x = Math.max(0, GRID_COLS - r.w);
      }
      setDesktopRect(w, r);
    });

    visible.sort((a, b) => {
      const ra = getDesktopRect(a);
      const rb = getDesktopRect(b);
      const idA = a.instanceId || a.instance_id;
      const idB = b.instanceId || b.instance_id;
      if (ra.y !== rb.y) return ra.y - rb.y;
      if (idA === movedInstanceId) return -1;
      if (idB === movedInstanceId) return 1;
      return ra.x - rb.x;
    });

    const placed = [];
    for (const w of visible) {
      const r = getDesktopRect(w);
      while (placed.some(p => rectsOverlap(r, getDesktopRect(p)))) {
        r.y += 1;
      }
      setDesktopRect(w, r);
      placed.push(w);
    }

    return widgets;
  }

  function applyWidgetGridStyles(el, instance) {
    const rect = getDesktopRect(instance);
    const viewportW = window.innerWidth || 1366;

    if (viewportW <= 680) {
      el.style.gridColumn = 'auto';
      el.style.gridRow = 'auto';
      return;
    }

    if (viewportW <= 960) {
      const w6 = Math.min(6, Math.max(3, Math.round(rect.w / 2)));
      el.style.gridColumn = `span ${w6}`;
      el.style.gridRow = `span ${rect.h}`;
      return;
    }

    if (viewportW <= 1280) {
      const w8 = Math.min(8, Math.max(4, Math.round((rect.w / 12) * 8)));
      el.style.gridColumn = `span ${w8}`;
      el.style.gridRow = `span ${rect.h}`;
      return;
    }

    el.style.gridColumn = `${rect.x + 1} / span ${rect.w}`;
    el.style.gridRow = `${rect.y + 1} / span ${rect.h}`;
  }

  function attachWidgetEditInteractions(widgetEl, instance, catalogMeta, callbacks) {
    const minW = Number(catalogMeta?.minSize?.w || catalogMeta?.min_w || 2);
    const maxW = Number(catalogMeta?.maxSize?.w || catalogMeta?.max_w || 12);
    const minH = Number(catalogMeta?.minSize?.h || catalogMeta?.min_h || 1);
    const maxH = Number(catalogMeta?.maxSize?.h || catalogMeta?.max_h || 8);
    const instId = instance.instanceId || instance.instance_id;

    widgetEl.setAttribute('tabindex', '0');
    widgetEl.addEventListener('keydown', (ev) => {
      if (!callbacks.isEditing() || instance.locked) return;
      if (['INPUT', 'SELECT', 'TEXTAREA', 'BUTTON'].includes(ev.target.tagName)) return;

      const r = getDesktopRect(instance);
      let changed = false;

      if (ev.shiftKey) {
        if (ev.key === 'ArrowRight') { r.w = Math.min(maxW, GRID_COLS - r.x, r.w + 1); changed = true; }
        if (ev.key === 'ArrowLeft') { r.w = Math.max(minW, r.w - 1); changed = true; }
        if (ev.key === 'ArrowDown') { r.h = Math.min(maxH, r.h + 1); changed = true; }
        if (ev.key === 'ArrowUp') { r.h = Math.max(minH, r.h - 1); changed = true; }
      } else {
        if (ev.key === 'ArrowRight') { r.x = Math.min(GRID_COLS - r.w, r.x + 1); changed = true; }
        if (ev.key === 'ArrowLeft') { r.x = Math.max(0, r.x - 1); changed = true; }
        if (ev.key === 'ArrowDown') { r.y = Math.max(0, r.y + 1); changed = true; }
        if (ev.key === 'ArrowUp') { r.y = Math.max(0, r.y - 1); changed = true; }
      }

      if (changed) {
        ev.preventDefault();
        setDesktopRect(instance, r);
        callbacks.onLayoutMutated(instId);
      }
    });

    const dragHandle = widgetEl.querySelector('.dash-widget-drag-handle') || widgetEl;
    dragHandle.addEventListener('pointerdown', (ev) => {
      if (!callbacks.isEditing() || instance.locked) return;
      if (ev.target.closest('button, select, input, .dash-widget-resize-handle')) return;

      ev.preventDefault();
      const gridEl = widgetEl.closest('.dash-grid');
      if (!gridEl) return;

      const gridBox = gridEl.getBoundingClientRect();
      const colW = gridBox.width / GRID_COLS;
      const startX = ev.clientX;
      const startY = ev.clientY;
      const startRect = getDesktopRect(instance);

      widgetEl.classList.add('is-dragging');

      function onPointerMove(moveEv) {
        const dxCols = Math.round((moveEv.clientX - startX) / colW);
        const dyRows = Math.round((moveEv.clientY - startY) / ROW_UNIT_PX);
        const nextX = Math.max(0, Math.min(GRID_COLS - startRect.w, startRect.x + dxCols));
        const nextY = Math.max(0, startRect.y + dyRows);

        setDesktopRect(instance, {
          x: nextX,
          y: nextY,
          w: startRect.w,
          h: startRect.h,
        });
        applyWidgetGridStyles(widgetEl, instance);
      }

      function onPointerUp() {
        widgetEl.classList.remove('is-dragging');
        window.removeEventListener('pointermove', onPointerMove);
        window.removeEventListener('pointerup', onPointerUp);
        callbacks.onLayoutMutated(instId);
      }

      window.addEventListener('pointermove', onPointerMove);
      window.addEventListener('pointerup', onPointerUp);
    });

    const resizeHandle = widgetEl.querySelector('.dash-widget-resize-handle');
    if (resizeHandle) {
      resizeHandle.addEventListener('pointerdown', (ev) => {
        if (!callbacks.isEditing() || instance.locked) return;
        ev.preventDefault();
        ev.stopPropagation();

        const gridEl = widgetEl.closest('.dash-grid');
        if (!gridEl) return;

        const gridBox = gridEl.getBoundingClientRect();
        const colW = gridBox.width / GRID_COLS;
        const startX = ev.clientX;
        const startY = ev.clientY;
        const startRect = getDesktopRect(instance);

        widgetEl.classList.add('is-dragging');

        function onResizeMove(moveEv) {
          const dw = Math.round((moveEv.clientX - startX) / colW);
          const dh = Math.round((moveEv.clientY - startY) / ROW_UNIT_PX);
          const nextW = Math.max(minW, Math.min(maxW, GRID_COLS - startRect.x, startRect.w + dw));
          const nextH = Math.max(minH, Math.min(maxH, startRect.h + dh));

          setDesktopRect(instance, {
            x: startRect.x,
            y: startRect.y,
            w: nextW,
            h: nextH,
          });
          applyWidgetGridStyles(widgetEl, instance);
        }

        function onResizeUp() {
          widgetEl.classList.remove('is-dragging');
          window.removeEventListener('pointermove', onResizeMove);
          window.removeEventListener('pointerup', onResizeUp);
          callbacks.onLayoutMutated(instId);
        }

        window.addEventListener('pointermove', onResizeMove);
        window.addEventListener('pointerup', onResizeUp);
      });
    }
  }

  window.CalebsysDashboardLayoutEngine = {
    GRID_COLS,
    getDesktopRect,
    setDesktopRect,
    resolveCollisionsAndCompact,
    applyWidgetGridStyles,
    attachWidgetEditInteractions,
  };
})();
