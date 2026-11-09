/**
 * CALEBSYS ERP — DASHBOARD PRINCIPAL CONTROLLER & CUSTOMIZATION ENGINE
 * Archivo: frontend/scripts/dashboard/editor.js
 * Alineado con el contrato camelCase de backend/dashboard/router.py, schemas.py y providers.py.
 */
(function () {
  'use strict';

  const STATE = {
    context: null,
    catalog: [],
    catalogMap: {},
    categories: [],
    templates: [],
    layoutsList: [],
    activeLayoutRecord: null,
    workingPayload: null,
    savedPayloadSnapshot: null,
    widgetDataMap: {},
    isEditing: false,
    isPreviewing: false,
    undoStack: [],
    redoStack: [],
    editingInstanceId: null,
    searchDebounceTimer: null,
  };

  function getAuthHeaders() {
    const token = localStorage.getItem('calebsys_token') || sessionStorage.getItem('calebsys_token') || '';
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = `Bearer ${token}`;
    return headers;
  }

  async function apiFetch(url, options = {}) {
    if (window.AdminAPI && typeof window.AdminAPI.apiFetch === 'function' && (!options.method || options.method === 'GET')) {
      return await window.AdminAPI.apiFetch(url);
    }
    const resp = await fetch(url, {
      ...options,
      credentials: 'include',
      headers: { ...getAuthHeaders(), ...(options.headers || {}) },
    });
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok) {
      const msg = typeof data.detail === 'string' ? data.detail : (data.detail?.message || `Error HTTP ${resp.status}`);
      const err = new Error(msg);
      err.status = resp.status;
      err.body = data;
      throw err;
    }
    return data;
  }

  function deepClone(obj) {
    return JSON.parse(JSON.stringify(obj || {}));
  }

  function draftStorageKey() {
    const compId = STATE.context?.company?.id || 'EMP';
    const usrId = STATE.context?.user?.id || 'USR';
    const lid = STATE.activeLayoutRecord?.id || 'system_default';
    return `calebsys_dash_draft_${compId}_${usrId}_${lid}`;
  }

  function saveLocalDraft() {
    try {
      if (STATE.workingPayload) {
        localStorage.setItem(draftStorageKey(), JSON.stringify({
          ts: Date.now(),
          version: STATE.activeLayoutRecord?.version || 1,
          payload: STATE.workingPayload,
        }));
      }
    } catch (_) { /* ignore */ }
  }

  function clearLocalDraft() {
    try {
      localStorage.removeItem(draftStorageKey());
    } catch (_) { /* ignore */ }
  }

  function pushUndoState() {
    if (!STATE.workingPayload) return;
    STATE.undoStack.push(deepClone(STATE.workingPayload));
    if (STATE.undoStack.length > 35) STATE.undoStack.shift();
    STATE.redoStack = [];
    saveLocalDraft();
    updateEditToolbarState();
  }

  function showToast(msg, type = 'info') {
    if (typeof window.showToast === 'function') {
      window.showToast(msg, type);
      return;
    }
    let toast = document.getElementById('dash-floating-toast');
    if (!toast) {
      toast = document.createElement('div');
      toast.id = 'dash-floating-toast';
      toast.style.cssText = 'position:fixed;bottom:24px;left:50%;transform:translateX(-50%);z-index:3000;padding:10px 18px;border-radius:10px;font-size:13px;font-weight:700;color:#fff;box-shadow:0 10px 30px rgba(0,0,0,0.6);transition:opacity 0.25s;';
      document.body.appendChild(toast);
    }
    toast.style.background = type === 'error' ? '#dc2626' : type === 'success' ? '#059669' : '#2563eb';
    toast.textContent = msg;
    toast.style.opacity = '1';
    clearTimeout(toast._t);
    toast._t = setTimeout(() => { toast.style.opacity = '0'; }, 3200);
  }

  function getShellActiveTheme() {
    const htmlTheme = document.documentElement.getAttribute('data-theme');
    if (htmlTheme === 'light' || htmlTheme === 'dark') return htmlTheme;
    const saved = localStorage.getItem('calebsys_theme');
    return (saved === 'light' || saved === 'dark') ? saved : 'dark';
  }

  const DEFAULT_HERO_IMG_URL = '/assets/dashboard/hero-store.jpg?v=20261108';

  function getHeroImageStorageKey() {
    const compId = STATE.context?.company?.id || 'DEFAULT';
    return `calebsys_dash_hero_img_${compId}`;
  }

  function getHeroRawSourceStorageKey() {
    const compId = STATE.context?.company?.id || 'DEFAULT';
    return `calebsys_dash_hero_raw_${compId}`;
  }

  function getHeroTransformStorageKey() {
    const compId = STATE.context?.company?.id || 'DEFAULT';
    return `calebsys_dash_hero_transform_${compId}`;
  }

  function applyVisualThemeAndHeader() {
    const root = document.getElementById('calebsys-dashboard-root');
    if (!root || !STATE.workingPayload) return;

    const theme = STATE.workingPayload.theme || {};
    const shellTheme = getShellActiveTheme();
    const rawMode = theme.mode || shellTheme;
    const mode = (rawMode === 'dark' || rawMode === 'light') ? shellTheme : rawMode;
    const density = theme.density || 'comfortable';
    const heroStyle = theme.showHero === false ? 'hidden' : (theme.heroStyle || 'illustrated');

    root.setAttribute('data-dash-theme', mode);
    root.setAttribute('data-dash-density', density);

    const heroEl = document.getElementById('dash-hero-banner');
    if (heroEl) {
      heroEl.setAttribute('data-hero-mode', heroStyle);
    }

    const savedLocalHero = localStorage.getItem(getHeroImageStorageKey());
    const customHeroUrl = theme.heroImageUrl || savedLocalHero || null;
    const heroImgEl = document.getElementById('dash-hero-img-el');
    if (heroImgEl) {
      heroImgEl.src = customHeroUrl || DEFAULT_HERO_IMG_URL;
      if (customHeroUrl) {
        heroImgEl.setAttribute('data-custom-cropped', 'true');
      } else {
        heroImgEl.removeAttribute('data-custom-cropped');
      }
    }
    const resetHeroBtn = document.getElementById('dash-btn-reset-hero-img');
    if (resetHeroBtn) {
      resetHeroBtn.hidden = !customHeroUrl;
    }

    const themeSelect = document.getElementById('dash-edit-theme-select');
    if (themeSelect) themeSelect.value = mode;

    const densitySelect = document.getElementById('dash-edit-density-select');
    if (densitySelect) densitySelect.value = density;

    const heroSelect = document.getElementById('dash-edit-hero-select');
    if (heroSelect) heroSelect.value = heroStyle;
  }

  function renderHeaderContext() {
    const ctx = STATE.context;
    if (!ctx) return;

    const comp = ctx.company || {};
    const usr = ctx.user || {};

    const companyEl = document.getElementById('dash-ctx-company-name');
    if (companyEl) companyEl.textContent = comp.name || comp.id || 'Maderas y Materiales Magdaleno';

    const branchSubEl = document.getElementById('dash-ctx-branch-sub');
    if (branchSubEl) {
      const currentSuc = STATE.workingPayload?.globalFilters?.branchMode || comp.activeSucursalId || 'MATRIZ';
      branchSubEl.textContent = currentSuc === 'ALL'
        ? 'Consolidado · Todas las Sucursales'
        : `Sucursal activa · ${currentSuc}`;
    }

    const hour = new Date().getHours();
    const saludo = hour < 12 ? '¡Buenos días' : hour < 19 ? '¡Buenas tardes' : '¡Buenas noches';
    const rawName = (usr.displayName || usr.username || 'Antonio').split(' ')[0];
    const formattedName = rawName.charAt(0).toUpperCase() + rawName.slice(1).toLowerCase();

    const greetingEl = document.getElementById('dash-hero-greeting');
    if (greetingEl) {
      greetingEl.textContent = `${saludo}, ${formattedName}!`;
    }

    const dateLabelEl = document.getElementById('dash-hero-date-label');
    if (dateLabelEl) {
      const now = new Date();
      const opts = { day: 'numeric', month: 'long', year: 'numeric' };
      dateLabelEl.textContent = `Hoy, ${now.toLocaleDateString('es-MX', opts)}`;
    }

    const branchSelect = document.getElementById('dash-branch-filter-select');
    if (branchSelect) {
      const branches = Array.isArray(comp.authorizedBranches) ? comp.authorizedBranches : [];
      const currentVal = STATE.workingPayload?.globalFilters?.branchMode || (comp.canViewConsolidated ? 'ALL' : comp.activeSucursalId);
      let optsHtml = '';
      if (comp.canViewConsolidated) {
        optsHtml += `<option value="ALL">Todas las sucursales (Consolidado)</option>`;
      }
      branches.forEach(b => {
        const bId = b.id || b.name || 'MATRIZ';
        optsHtml += `<option value="${bId}">${b.name || bId}</option>`;
      });
      branchSelect.innerHTML = optsHtml;
      branchSelect.value = currentVal;
      branchSelect.disabled = !comp.canViewConsolidated && branches.length <= 1;
    }

    const layoutSelect = document.getElementById('dash-active-layout-select');
    if (layoutSelect) {
      const list = Array.isArray(STATE.layoutsList) ? STATE.layoutsList : [];
      let html = '';
      list.forEach(l => {
        const star = l.isDefault ? '★ ' : '';
        html += `<option value="${l.id}">${star}${l.name} (${l.scopeType})</option>`;
      });
      if (STATE.activeLayoutRecord && !list.some(l => l.id === STATE.activeLayoutRecord.id)) {
        html = `<option value="${STATE.activeLayoutRecord.id}">${STATE.activeLayoutRecord.name}</option>` + html;
      }
      layoutSelect.innerHTML = html;
      if (STATE.activeLayoutRecord?.id) {
        layoutSelect.value = String(STATE.activeLayoutRecord.id);
      }
    }

    const btnCustomize = document.getElementById('dash-btn-toggle-customize');
    if (btnCustomize) {
      const canEdit = Boolean(ctx.capabilities?.['dashboard.edit_self']);
      btnCustomize.hidden = !canEdit;
    }
  }

  function syncGlobalFilterBarUI() {
    const gf = STATE.workingPayload?.globalFilters || {};
    const period = gf.datePreset || 'today';

    document.querySelectorAll('.dash-period-btn').forEach(btn => {
      btn.classList.toggle('active', btn.getAttribute('data-period') === period);
    });

    const customWrap = document.getElementById('dash-custom-dates-wrap');
    if (customWrap) {
      customWrap.hidden = period !== 'custom';
    }

    const compareSelect = document.getElementById('dash-compare-filter-select');
    if (compareSelect && gf.comparison) {
      compareSelect.value = gf.comparison;
    }
  }

  function renderGrid() {
    const gridEl = document.getElementById('dash-widgets-grid');
    if (!gridEl || !STATE.workingPayload) return;

    applyVisualThemeAndHeader();
    syncGlobalFilterBarUI();

    const widgets = Array.isArray(STATE.workingPayload.widgets) ? STATE.workingPayload.widgets : [];
    window.CalebsysDashboardLayoutEngine.resolveCollisionsAndCompact(widgets);

    gridEl.innerHTML = '';

    const visibleWidgets = widgets.filter(w => w.visible !== false);
    if (visibleWidgets.length === 0) {
      gridEl.innerHTML = `
        <div class="dash-widget-state" style="grid-column: 1 / -1; min-height: 240px;">
          <i class="fa-solid fa-layer-group" style="font-size:32px;color:#60a5fa;"></i>
          <strong>No hay widgets visibles en este dashboard</strong>
          <span>Haz clic en "Personalizar dashboard" y luego en "+ Agregar módulo" o "Plantillas" para comenzar.</span>
        </div>
      `;
      return;
    }

    visibleWidgets.forEach(instance => {
      const wkey = instance.widgetKey || instance.widget_key;
      const instId = instance.instanceId || instance.instance_id;
      const meta = STATE.catalogMap[wkey] || {};
      const card = document.createElement('article');
      card.className = 'dash-widget';
      card.setAttribute('data-instance-id', instId);
      card.setAttribute('data-widget-key', wkey);
      card.setAttribute('data-variant', instance.settings?.variant || 'glass');
      card.setAttribute('data-accent', instance.settings?.accent || meta.accent || 'blue');
      if (instance.locked) card.classList.add('is-locked');

      window.CalebsysDashboardLayoutEngine.applyWidgetGridStyles(card, instance);

      const editBar = document.createElement('div');
      editBar.className = 'dash-widget-edit-bar';
      editBar.innerHTML = `
        <span class="dash-widget-drag-handle" title="Arrastra para mover este módulo (o usa flechas del teclado)">
          <i class="fa-solid fa-grip-vertical"></i>
          <span>${window.CalebsysDashboardRegistry.escapeHtml(instance.settings?.customTitle || meta.name || wkey)}</span>
          ${instance.locked ? '<i class="fa-solid fa-lock" style="color:#fbbf24;" title="Bloqueado"></i>' : ''}
        </span>
        <div class="dash-widget-edit-actions">
          <button type="button" class="dash-w-icon-btn" data-w-act="config" title="Configurar widget">
            <i class="fa-solid fa-sliders"></i>
          </button>
          ${meta.allowMultiple ? `
          <button type="button" class="dash-w-icon-btn" data-w-act="duplicate" title="Duplicar widget">
            <i class="fa-solid fa-clone"></i>
          </button>` : ''}
          <button type="button" class="dash-w-icon-btn" data-w-act="lock" title="${instance.locked ? 'Desbloquear posición' : 'Bloquear posición'}">
            <i class="fa-solid ${instance.locked ? 'fa-lock' : 'fa-lock-open'}"></i>
          </button>
          <button type="button" class="dash-w-icon-btn danger" data-w-act="remove" title="Quitar widget de mi vista">
            <i class="fa-solid fa-trash-can"></i>
          </button>
        </div>
      `;
      card.appendChild(editBar);

      const contentContainer = document.createElement('div');
      contentContainer.className = 'dash-widget-content';
      contentContainer.style.cssText = 'flex:1;display:flex;flex-direction:column;min-height:0;';
      card.appendChild(contentContainer);

      const resizeHandle = document.createElement('div');
      resizeHandle.className = 'dash-widget-resize-handle';
      resizeHandle.title = 'Arrastra para cambiar tamaño (Shift + Flechas)';
      resizeHandle.innerHTML = '<i class="fa-solid fa-up-right-and-down-left-from-center" style="transform:rotate(90deg);"></i>';
      card.appendChild(resizeHandle);

      renderSingleWidgetContent(contentContainer, instance);

      editBar.querySelectorAll('[data-w-act]').forEach(btn => {
        btn.addEventListener('click', (ev) => {
          ev.stopPropagation();
          const act = btn.getAttribute('data-w-act');
          handleWidgetEditAction(instId, act);
        });
      });

      window.CalebsysDashboardLayoutEngine.attachWidgetEditInteractions(card, instance, meta, {
        isEditing: () => STATE.isEditing && !STATE.isPreviewing,
        onLayoutMutated: (movedId) => {
          pushUndoState();
          window.CalebsysDashboardLayoutEngine.resolveCollisionsAndCompact(STATE.workingPayload.widgets, movedId);
          renderGrid();
        },
      });

      gridEl.appendChild(card);
    });
  }

  function renderSingleWidgetContent(container, instance) {
    const instId = instance.instanceId || instance.instance_id;
    const wkey = instance.widgetKey || instance.widget_key;
    const payload = STATE.widgetDataMap[instId];

    if (!payload) {
      container.innerHTML = `
        <div class="dash-widget-state">
          <div class="dash-skeleton-line" style="width:60%;"></div>
          <div class="dash-skeleton-line" style="width:85%;height:28px;"></div>
          <div class="dash-skeleton-line" style="width:45%;"></div>
        </div>
      `;
      return;
    }

    if (payload.status === 'forbidden') {
      container.innerHTML = `
        <div class="dash-widget-state">
          <i class="fa-solid fa-shield-halved" style="font-size:22px;color:#f59e0b;"></i>
          <span>${window.CalebsysDashboardRegistry.escapeHtml(payload.error || 'Acceso restringido por permisos')}</span>
        </div>
      `;
      return;
    }

    if (payload.status === 'error') {
      container.innerHTML = `
        <div class="dash-widget-state">
          <i class="fa-solid fa-triangle-exclamation" style="font-size:22px;color:#ef4444;"></i>
          <span>${window.CalebsysDashboardRegistry.escapeHtml(payload.error || 'Error al cargar widget')}</span>
        </div>
      `;
      return;
    }

    const reg = window.CalebsysDashboardRegistry.getRegisteredWidget(wkey);
    const renderFn = reg?.render || window.CalebsysDashboardRegistry.renderGenericCatalogWidget;

    renderFn(container, instance, payload, {
      catalogMap: STATE.catalogMap,
      isEditing: STATE.isEditing && !STATE.isPreviewing,
      onUpdateWidgetSetting: async (targetId, newSettings) => {
        const target = STATE.workingPayload.widgets.find(w => (w.instanceId || w.instance_id) === targetId);
        if (!target) return;
        target.settings = { ...(target.settings || {}), ...newSettings };
        await fetchSnapshotData();
        renderGrid();
      },
      onSelectBranchFilter: async (branchId) => {
        if (!STATE.workingPayload.globalFilters) STATE.workingPayload.globalFilters = {};
        STATE.workingPayload.globalFilters.branchMode = branchId;
        renderHeaderContext();
        await fetchSnapshotData();
        renderGrid();
      },
      onOpenAiModal: () => openAiCopilotModal(),
    });
  }

  async function fetchSnapshotData() {
    if (!STATE.workingPayload) return;
    const syncTextEl = document.getElementById('dash-sync-status-text');
    if (syncTextEl) syncTextEl.textContent = 'Sincronizando...';

    try {
      const visible = (STATE.workingPayload.widgets || []).filter(w => w.visible !== false);
      const reqBody = {
        dashboardKey: STATE.workingPayload.dashboardKey || 'erp_main',
        globalFilters: STATE.workingPayload.globalFilters || {},
        widgetRequests: visible.map(w => ({
          instanceId: w.instanceId || w.instance_id,
          widgetKey: w.widgetKey || w.widget_key,
          filters: w.filters || {},
          settings: w.settings || {},
        })),
      };

      const res = await apiFetch('/api/dashboard/snapshot', {
        method: 'POST',
        body: JSON.stringify(reqBody),
      });

      STATE.widgetDataMap = res.widgets || {};
      if (syncTextEl) {
        const now = new Date();
        syncTextEl.textContent = `Actualizado ${now.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' })}`;
      }
    } catch (err) {
      console.error('[Dashboard] Error en snapshot:', err);
      if (syncTextEl) syncTextEl.textContent = 'Error de conexión';
    }
  }

  function handleWidgetEditAction(instanceId, action) {
    const widgets = STATE.workingPayload?.widgets || [];
    const idx = widgets.findIndex(w => (w.instanceId || w.instance_id) === instanceId);
    if (idx === -1) return;
    const w = widgets[idx];
    const wkey = w.widgetKey || w.widget_key;

    if (action === 'remove') {
      if (w.locked) {
        showToast('Este widget está bloqueado. Desbloquéalo antes de eliminarlo.', 'error');
        return;
      }
      pushUndoState();
      widgets.splice(idx, 1);
      renderGrid();
      showToast('Módulo eliminado de la vista');
    } else if (action === 'lock') {
      pushUndoState();
      w.locked = !w.locked;
      renderGrid();
      showToast(w.locked ? 'Módulo bloqueado' : 'Módulo desbloqueado');
    } else if (action === 'duplicate') {
      pushUndoState();
      const copy = deepClone(w);
      copy.instanceId = `w_${wkey}_${Date.now().toString(36)}`;
      copy.locked = false;
      const rect = window.CalebsysDashboardLayoutEngine.getDesktopRect(copy);
      rect.y += rect.h;
      window.CalebsysDashboardLayoutEngine.setDesktopRect(copy, rect);
      widgets.push(copy);
      fetchSnapshotData().then(() => renderGrid());
      showToast('Módulo duplicado para comparación');
    } else if (action === 'config') {
      openWidgetConfigDrawer(instanceId);
    }
  }

  function setEditingMode(enabled) {
    STATE.isEditing = Boolean(enabled);
    STATE.isPreviewing = false;
    const root = document.getElementById('calebsys-dashboard-root');
    const toolbar = document.getElementById('dash-edit-toolbar');
    const btnToggle = document.getElementById('dash-btn-toggle-customize');

    if (STATE.isEditing) {
      STATE.savedPayloadSnapshot = deepClone(STATE.workingPayload);
      STATE.undoStack = [];
      STATE.redoStack = [];
    }

    if (root) root.classList.toggle('is-editing', STATE.isEditing);
    if (toolbar) toolbar.hidden = !STATE.isEditing;
    if (btnToggle) {
      btnToggle.innerHTML = STATE.isEditing
        ? '<i class="fa-solid fa-check"></i> Editando...'
        : '<i class="fa-solid fa-sliders"></i> Personalizar dashboard';
    }

    updateEditToolbarState();
    renderGrid();
  }

  function updateEditToolbarState() {
    const btnUndo = document.getElementById('dash-btn-undo');
    const btnRedo = document.getElementById('dash-btn-redo');
    if (btnUndo) btnUndo.disabled = STATE.undoStack.length === 0;
    if (btnRedo) btnRedo.disabled = STATE.redoStack.length === 0;
  }

  async function saveActiveLayoutChanges(forceOverwriteVersion = null) {
    if (!STATE.workingPayload) return;
    try {
      const rec = STATE.activeLayoutRecord;
      const expectedVersion = forceOverwriteVersion || rec?.version || 1;
      const targetId = rec?.id || 'system_default';

      const updated = await apiFetch(`/api/dashboard/layouts/${targetId}`, {
        method: 'PUT',
        body: JSON.stringify({
          version: expectedVersion,
          name: (STATE.workingPayload.name || rec?.name || 'MI DASHBOARD EJECUTIVO').toUpperCase(),
          layout: STATE.workingPayload,
        }),
      });

      STATE.activeLayoutRecord = updated;
      STATE.workingPayload = deepClone(updated.layout);
      clearLocalDraft();

      const layoutsRes = await apiFetch('/api/dashboard/layouts');
      STATE.layoutsList = layoutsRes.items || [];
      renderHeaderContext();
      setEditingMode(false);
      showToast('Configuración de dashboard guardada correctamente', 'success');
    } catch (err) {
      if (err.status === 409) {
        openVersionConflictModal(err.body?.detail || {});
      } else {
        showToast(err.message || 'Error al guardar el dashboard', 'error');
      }
    }
  }

  function openVersionConflictModal(detail) {
    const modal = document.getElementById('dash-modal-conflict');
    if (!modal) return;
    const msgEl = document.getElementById('dash-conflict-msg');
    if (msgEl) {
      msgEl.textContent = detail.message || 'El dashboard fue modificado en otra sesión. Elige cómo proceder:';
    }
    modal.hidden = false;
    modal._serverVersion = detail.serverVersion || detail.current_version || 1;
  }

  async function addWindowOptionToDashboard(opt, win) {
    if (!opt || !STATE.workingPayload) return;
    const escTitle = (opt.title || '').trim().toUpperCase();
    const wkey = opt.widgetKey || 'window_parameter_card';
    const meta = STATE.catalogMap[wkey] || STATE.catalogMap.window_parameter_card || {};

    let finalKey = wkey;
    if (!meta.allowMultiple && (STATE.workingPayload.widgets || []).some(x => (x.widgetKey || x.widget_key) === wkey)) {
      // Si el widget específico ya existe en el tablero y no permite duplicados directos, lo agregamos como tarjeta de parámetro universal
      finalKey = 'window_parameter_card';
    }
    const finalMeta = STATE.catalogMap[finalKey] || meta;

    pushUndoState();
    const maxY = (STATE.workingPayload.widgets || []).reduce((acc, item) => {
      const r = window.CalebsysDashboardLayoutEngine.getDesktopRect(item);
      return Math.max(acc, r.y + r.h);
    }, 0);

    const defW = finalMeta.defaultSize?.w || 3;
    const defH = finalMeta.defaultSize?.h || 3;
    const routePath = opt.routePath || win?.routePath || finalMeta.routePath || 'Principal > Dashboard';
    const routeUrl = opt.routeUrl || win?.routeUrl || finalMeta.routeUrl || '/admin#dashboard';
    const targetPage = opt.targetPage || win?.page || finalMeta.drilldownRoute || '';

    const newInst = {
      instanceId: `w_${finalKey}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 5)}`,
      widgetKey: finalKey,
      widgetVersion: finalMeta.version || 1,
      visible: true,
      locked: false,
      positions: {
        desktop: { x: 0, y: maxY, w: defW, h: defH },
        tablet: { x: 0, y: maxY, w: Math.min(8, defW), h: defH },
        mobile: { x: 0, y: maxY, w: 1, h: defH },
      },
      settings: {
        ...(finalMeta.settingsSchema || {}),
        customTitle: escTitle || null,
        paramId: opt.paramId || `${win?.windowId || 'productos'}.resumen`,
        paramDescription: (opt.description || '').toUpperCase() || null,
        sourceTable: opt.sourceTable || win?.sourceTable || '',
        routePath,
        routeUrl,
        targetPage,
        variant: 'glass',
        accent: opt.accent || win?.accent || finalMeta.accent || 'blue',
      },
      filters: {},
    };

    if (!Array.isArray(STATE.workingPayload.widgets)) STATE.workingPayload.widgets = [];
    STATE.workingPayload.widgets.push(newInst);

    const modal = document.getElementById('dash-modal-catalog');
    if (modal) modal.hidden = true;
    const searchDropdown = document.getElementById('dash-global-search-results');
    if (searchDropdown) searchDropdown.hidden = true;

    await fetchSnapshotData();
    renderGrid();

    if (!STATE.isEditing) {
      try {
        await saveActiveLayoutChanges();
      } catch (_) {}
    }
    showToast(`Parámetro "${escTitle || finalMeta.name}" (${routePath}) agregado al Dashboard`, 'success');
  }

  function populateCatalogWindowSelect() {
    const sel = document.getElementById('dash-catalog-window-select');
    if (!sel) return;
    const wins = Array.isArray(STATE.windowsDirectory) ? STATE.windowsDirectory : [];
    const currentVal = sel.value || 'ALL';
    let html = `<option value="ALL">📍 Todas las ventanas y rutas (${wins.length})</option>`;
    wins.forEach(w => {
      const escId = window.CalebsysDashboardRegistry.escapeHtml(w.windowId);
      const escRoute = window.CalebsysDashboardRegistry.escapeHtml(`${w.routePath} (${w.routeUrl})`);
      html += `<option value="${escId}">📍 ${escRoute}</option>`;
    });
    sel.innerHTML = html;
    sel.value = currentVal;
  }

  function openWidgetCatalogModal() {
    const modal = document.getElementById('dash-modal-catalog');
    if (!modal) return;
    if (!STATE.catalogMode) STATE.catalogMode = 'windows';
    populateCatalogWindowSelect();
    modal.hidden = false;
    const searchInp = document.getElementById('dash-catalog-search-input');
    renderCatalogItems(searchInp ? searchInp.value : '');
  }

  function renderCatalogItems(query) {
    const grid = document.getElementById('dash-catalog-items-grid');
    if (!grid) return;
    const esc = window.CalebsysDashboardRegistry.escapeHtml;
    const q = (query || '').trim().toLowerCase();
    const selectedWinId = document.getElementById('dash-catalog-window-select')?.value || 'ALL';
    const mode = STATE.catalogMode || 'windows';

    document.getElementById('dash-cat-mode-windows')?.classList.toggle('dash-btn-primary', mode === 'windows');
    document.getElementById('dash-cat-mode-widgets')?.classList.toggle('dash-btn-primary', mode === 'widgets');

    if (mode === 'windows') {
      const wins = Array.isArray(STATE.windowsDirectory) ? STATE.windowsDirectory : [];
      const filteredWins = [];

      wins.forEach(win => {
        if (selectedWinId !== 'ALL' && win.windowId !== selectedWinId) return;
        const winHaystack = `${win.windowName} ${win.routePath} ${win.routeUrl} ${win.section}`.toLowerCase();
        const opts = Array.isArray(win.options) ? win.options : [];
        const matchedOpts = !q
          ? opts
          : opts.filter(o => {
              const oh = `${o.title} ${o.description} ${o.paramId}`.toLowerCase();
              return winHaystack.includes(q) || oh.includes(q);
            });
        if (!q || winHaystack.includes(q) || matchedOpts.length > 0) {
          filteredWins.push({
            ...win,
            visibleOptions: matchedOpts.length > 0 ? matchedOpts : opts,
          });
        }
      });

      if (filteredWins.length === 0) {
        grid.innerHTML = `
          <div class="dash-widget-state" style="grid-column: 1 / -1; min-height: 180px;">
            <i class="fa-solid fa-magnifying-glass" style="font-size:24px;color:#60a5fa;"></i>
            <strong>No se encontraron ventanas ni parámetros con ese criterio</strong>
            <span>Prueba buscando por nombre de ventana, ruta (ej. /admin#inventario) o indicador.</span>
          </div>
        `;
        return;
      }

      grid.innerHTML = filteredWins.map(win => {
        const optsHtml = (win.visibleOptions || []).map((opt, idx) => `
          <div class="dash-window-opt-row">
            <div class="dash-window-opt-info">
              <div class="dash-window-opt-title">${esc(opt.title)}</div>
              <div class="dash-window-opt-desc">${esc(opt.description)}</div>
            </div>
            <button type="button" class="dash-btn dash-btn-primary" data-add-win-id="${esc(win.windowId)}" data-add-opt-idx="${idx}" style="height:28px;font-size:11.5px;flex-shrink:0;">
              <i class="fa-solid fa-plus"></i> Poner
            </button>
          </div>
        `).join('');

        return `
          <div class="dash-window-card">
            <div class="dash-window-card-head">
              <div>
                <div style="display:flex;align-items:center;gap:8px;">
                  <span class="dash-widget-title-icon"><i class="fa-solid ${esc(win.icon || 'fa-window-maximize')}"></i></span>
                  <strong style="font-size:14.5px;">${esc(win.windowName)}</strong>
                </div>
                <div class="dash-window-route-badge" title="Ruta donde se encuentra esta ventana">
                  <i class="fa-solid fa-location-dot"></i>
                  <span>Ruta: ${esc(win.routePath)} · <code>${esc(win.routeUrl)}</code></span>
                </div>
              </div>
              <button type="button" class="dash-btn" data-open-win-page="${esc(win.page || '')}" data-open-win-href="${esc(win.href || '')}" style="height:26px;font-size:11px;flex-shrink:0;" title="Ir directamente a esta ventana">
                <i class="fa-solid fa-arrow-up-right-from-square"></i> Ir
              </button>
            </div>
            <div style="font-size:11px;font-weight:700;color:var(--dash-text-muted);text-transform:uppercase;letter-spacing:0.4px;">
              Opciones y parámetros disponibles en esta ventana (${(win.visibleOptions || []).length}):
            </div>
            <div class="dash-window-opts-list">
              ${optsHtml}
            </div>
          </div>
        `;
      }).join('');

      grid.querySelectorAll('[data-open-win-page], [data-open-win-href]').forEach(btn => {
        btn.addEventListener('click', () => {
          const page = btn.getAttribute('data-open-win-page');
          const href = btn.getAttribute('data-open-win-href');
          document.getElementById('dash-modal-catalog').hidden = true;
          if (page && typeof window.navigateTo === 'function') {
            window.navigateTo(page);
          } else if (href) {
            window.location.href = href;
          }
        });
      });

      grid.querySelectorAll('[data-add-win-id]').forEach(btn => {
        btn.addEventListener('click', async () => {
          const wid = btn.getAttribute('data-add-win-id');
          const oidx = Number(btn.getAttribute('data-add-opt-idx') || 0);
          const winObj = filteredWins.find(w => w.windowId === wid);
          const optObj = winObj?.visibleOptions?.[oidx];
          if (winObj && optObj) {
            await addWindowOptionToDashboard(optObj, winObj);
          }
        });
      });
      return;
    }

    const filtered = STATE.catalog.filter(w => {
      if (!w.authorized) return false;
      if (selectedWinId !== 'ALL' && w.drilldownRoute !== selectedWinId) return false;
      if (!q) return true;
      return (w.name || '').toLowerCase().includes(q) ||
             (w.description || '').toLowerCase().includes(q) ||
             (w.routePath || '').toLowerCase().includes(q) ||
             (w.routeUrl || '').toLowerCase().includes(q) ||
             (w.category || '').toLowerCase().includes(q);
    });

    grid.innerHTML = filtered.map(w => {
      const defW = w.defaultSize?.w || 4;
      const defH = w.defaultSize?.h || 2;
      return `
        <div class="dash-catalog-item">
          <div>
            <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px;">
              <span class="dash-widget-title-icon"><i class="fa-solid ${esc(w.icon || 'fa-cube')}"></i></span>
              <strong style="font-size:14px;">${esc(w.name)}</strong>
            </div>
            <div class="dash-window-route-badge" style="margin-bottom:6px;">
              <i class="fa-solid fa-location-dot"></i>
              <span>${esc(w.routePath || 'Principal > Dashboard')} · <code>${esc(w.routeUrl || '/admin#dashboard')}</code></span>
            </div>
            <p style="font-size:12px;color:var(--dash-text-muted);margin:0;">${esc(w.description)}</p>
          </div>
          <div style="display:flex;align-items:center;justify-content:space-between;margin-top:6px;">
            <small style="color:var(--dash-text-muted);font-size:11px;">Tamaño: ${defW}x${defH}</small>
            <button type="button" class="dash-btn dash-btn-primary" data-add-widget-key="${esc(w.key)}" style="height:30px;font-size:12px;">
              <i class="fa-solid fa-plus"></i> Agregar
            </button>
          </div>
        </div>
      `;
    }).join('');

    grid.querySelectorAll('[data-add-widget-key]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const key = btn.getAttribute('data-add-widget-key');
        const meta = STATE.catalogMap[key];
        if (!meta) return;
        await addWindowOptionToDashboard({
          paramId: `${meta.drilldownRoute || 'dashboard'}.${key}`,
          title: meta.name,
          description: meta.description,
          widgetKey: key,
          routePath: meta.routePath,
          routeUrl: meta.routeUrl,
          targetPage: meta.drilldownRoute,
          accent: meta.accent,
        }, null);
      });
    });
  }

  function openWidgetConfigDrawer(instanceId) {
    const drawer = document.getElementById('dash-drawer-widget-config');
    if (!drawer) return;
    const w = (STATE.workingPayload?.widgets || []).find(item => (item.instanceId || item.instance_id) === instanceId);
    if (!w) return;

    STATE.editingInstanceId = instanceId;
    const wkey = w.widgetKey || w.widget_key;
    const meta = STATE.catalogMap[wkey] || {};
    const rect = window.CalebsysDashboardLayoutEngine.getDesktopRect(w);

    const paramSel = document.getElementById('dash-cfg-window-param-select');
    if (paramSel) {
      const esc = window.CalebsysDashboardRegistry.escapeHtml;
      const wins = Array.isArray(STATE.windowsDirectory) ? STATE.windowsDirectory : [];
      let html = `<option value="">-- Mantener configuración actual (${esc(meta.name || wkey)}) --</option>`;
      wins.forEach(win => {
        html += `<optgroup label="📍 ${esc(win.routePath)} (${esc(win.routeUrl)})">`;
        (win.options || []).forEach(opt => {
          const valKey = `${win.windowId}::${opt.paramId}`;
          const isSelected = w.settings?.paramId === opt.paramId;
          html += `<option value="${esc(valKey)}" ${isSelected ? 'selected' : ''}>${esc(opt.title)} — ${esc(opt.description)}</option>`;
        });
        html += `</optgroup>`;
      });
      paramSel.innerHTML = html;
    }

    document.getElementById('dash-cfg-title-input').value = (w.settings?.customTitle || meta.name || '').toUpperCase();
    document.getElementById('dash-cfg-variant-select').value = w.settings?.variant || 'glass';
    document.getElementById('dash-cfg-accent-select').value = w.settings?.accent || meta.accent || 'blue';
    document.getElementById('dash-cfg-period-select').value = w.filters?.datePreset || '';
    document.getElementById('dash-cfg-w-input').value = rect.w;
    document.getElementById('dash-cfg-h-input').value = rect.h;

    drawer.hidden = false;
  }

  function openTemplatesModal() {
    const modal = document.getElementById('dash-modal-templates');
    if (!modal) return;
    const grid = document.getElementById('dash-templates-grid');
    if (grid) {
      grid.innerHTML = STATE.templates.map(t => {
        const count = t.widgetCount || (t.layout?.widgets?.length || 0);
        return `
          <div class="dash-catalog-item">
            <div>
              <strong style="font-size:15px;display:block;margin-bottom:4px;">${window.CalebsysDashboardRegistry.escapeHtml(t.name)}</strong>
              <p style="font-size:12px;color:var(--dash-text-muted);margin:0;">${window.CalebsysDashboardRegistry.escapeHtml(t.description)}</p>
            </div>
            <div style="display:flex;align-items:center;justify-content:space-between;margin-top:8px;">
              <small style="color:#60a5fa;font-weight:600;">${count} módulos</small>
              <button type="button" class="dash-btn dash-btn-primary" data-apply-tpl="${window.CalebsysDashboardRegistry.escapeHtml(t.id)}" style="height:30px;font-size:12px;">
                Aplicar plantilla
              </button>
            </div>
          </div>
        `;
      }).join('');

      grid.querySelectorAll('[data-apply-tpl]').forEach(btn => {
        btn.addEventListener('click', async () => {
          const tplId = btn.getAttribute('data-apply-tpl');
          try {
            pushUndoState();
            const lid = STATE.activeLayoutRecord?.id || 'system_default';
            const res = await apiFetch(`/api/dashboard/layouts/${lid}/reset`, {
              method: 'POST',
              body: JSON.stringify({ templateId: tplId }),
            });
            STATE.activeLayoutRecord = res;
            STATE.workingPayload = deepClone(res.layout);
            modal.hidden = true;
            await fetchSnapshotData();
            renderGrid();
            showToast('Plantilla aplicada correctamente', 'success');
          } catch (err) {
            showToast(err.message || 'Error al aplicar plantilla', 'error');
          }
        });
      });
    }
    modal.hidden = false;
  }

  function openAiCopilotModal() {
    const modal = document.getElementById('dash-modal-ai-copilot');
    if (!modal) return;
    modal.hidden = false;
    const body = document.getElementById('dash-ai-copilot-body');
    if (!body) return;

    body.innerHTML = `<div class="dash-widget-state"><div class="dash-skeleton-line"></div><div class="dash-skeleton-line"></div></div>`;
    const gf = STATE.workingPayload?.globalFilters || {};
    const qs = new URLSearchParams({
      datePreset: gf.datePreset || 'today',
      branchMode: gf.branchMode || 'ALL',
    });

    apiFetch(`/api/dashboard/widgets/ai_executive_summary/data?${qs.toString()}`)
      .then(res => {
        const insights = res.data?.insights || [];
        body.innerHTML = `
          <div style="display:flex;flex-direction:column;gap:10px;">
            ${insights.map(ins => `
              <div class="dash-alert-row" style="padding:12px 14px;">
                <div class="dash-alert-left" style="white-space:normal;">
                  <span class="dash-alert-icon" style="background:rgba(139,92,246,0.22);color:#c084fc;"><i class="fa-solid ${window.CalebsysDashboardRegistry.escapeHtml(ins.icon || 'fa-wand-magic-sparkles')}"></i></span>
                  <span style="font-size:14px;">${window.CalebsysDashboardRegistry.escapeHtml(ins.text)}</span>
                </div>
                <button type="button" class="dash-btn dash-btn-primary" data-ai-nav="${window.CalebsysDashboardRegistry.escapeHtml(ins.route || 'reportes')}" style="height:30px;font-size:12px;">
                  Ver detalle
                </button>
              </div>
            `).join('')}
          </div>
        `;
        body.querySelectorAll('[data-ai-nav]').forEach(b => {
          b.addEventListener('click', () => {
            modal.hidden = true;
            const page = b.getAttribute('data-ai-nav');
            if (page && typeof window.navigateTo === 'function') window.navigateTo(page);
          });
        });
      })
      .catch(err => {
        body.innerHTML = `<div class="dash-widget-state">${window.CalebsysDashboardRegistry.escapeHtml(err.message)}</div>`;
      });
  }

  function bindStaticDashboardEvents() {
    const root = document.getElementById('calebsys-dashboard-root');
    if (!root || root._boundEvents) return;
    root._boundEvents = true;

    root.querySelectorAll('.dash-period-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const period = btn.getAttribute('data-period');
        if (!STATE.workingPayload.globalFilters) STATE.workingPayload.globalFilters = {};
        STATE.workingPayload.globalFilters.datePreset = period;
        syncGlobalFilterBarUI();
        if (period !== 'custom') {
          await fetchSnapshotData();
          renderGrid();
        }
      });
    });

    const btnApplyCustomDates = document.getElementById('dash-btn-apply-custom-dates');
    if (btnApplyCustomDates) {
      btnApplyCustomDates.addEventListener('click', async () => {
        const fromVal = document.getElementById('dash-date-from')?.value || null;
        const toVal = document.getElementById('dash-date-to')?.value || null;
        STATE.workingPayload.globalFilters.dateFrom = fromVal;
        STATE.workingPayload.globalFilters.dateTo = toVal;
        await fetchSnapshotData();
        renderGrid();
      });
    }

    const branchSelect = document.getElementById('dash-branch-filter-select');
    if (branchSelect) {
      branchSelect.addEventListener('change', async () => {
        if (!STATE.workingPayload.globalFilters) STATE.workingPayload.globalFilters = {};
        STATE.workingPayload.globalFilters.branchMode = branchSelect.value;
        renderHeaderContext();
        await fetchSnapshotData();
        renderGrid();
      });
    }

    const compareSelect = document.getElementById('dash-compare-filter-select');
    if (compareSelect) {
      compareSelect.addEventListener('change', async () => {
        if (!STATE.workingPayload.globalFilters) STATE.workingPayload.globalFilters = {};
        STATE.workingPayload.globalFilters.comparison = compareSelect.value;
        await fetchSnapshotData();
        renderGrid();
      });
    }

    const layoutSelect = document.getElementById('dash-active-layout-select');
    if (layoutSelect) {
      layoutSelect.addEventListener('change', async () => {
        const lid = layoutSelect.value;
        if (!lid) return;
        try {
          if (lid !== 'system_default') {
            await apiFetch(`/api/dashboard/layouts/${lid}/activate`, { method: 'POST' });
          }
          await initDashboardEngine();
          showToast('Dashboard activo cambiado', 'success');
        } catch (err) {
          showToast(err.message, 'error');
        }
      });
    }

    document.getElementById('dash-btn-refresh')?.addEventListener('click', async () => {
      await fetchSnapshotData();
      renderGrid();
      showToast('Datos actualizados en tiempo real', 'info');
    });

    const btnFitWin = document.getElementById('dash-btn-fit-window');
    if (btnFitWin) {
      const savedFit = localStorage.getItem('calebsys_dash_fit_window') || 'single';
      root.setAttribute('data-fit-window', savedFit);
      const updateFitLabel = (mode) => {
        const isExpanded = mode === 'expanded';
        btnFitWin.innerHTML = isExpanded
          ? '<i class="fa-solid fa-compress"></i> <span>Ajustar 1 Ventana</span>'
          : '<i class="fa-solid fa-expand"></i> <span>Expandir Vista</span>';
      };
      updateFitLabel(savedFit);

      btnFitWin.addEventListener('click', () => {
        const cur = root.getAttribute('data-fit-window') || 'single';
        const next = cur === 'expanded' ? 'single' : 'expanded';
        root.setAttribute('data-fit-window', next);
        localStorage.setItem('calebsys_dash_fit_window', next);
        updateFitLabel(next);
        showToast(next === 'single' ? 'Vista ajustada en una sola ventana' : 'Vista expandida activada para desplazamiento amplio');
      });
    }

    const getScrollContainer = () => document.getElementById('content-area') || document.querySelector('.content-area') || document.scrollingElement || document.documentElement;

    document.getElementById('dash-btn-scroll-up')?.addEventListener('click', () => {
      const scroller = getScrollContainer();
      if (!scroller) return;
      const step = Math.max(260, Math.round(scroller.clientHeight * 0.55));
      const nextTop = scroller.scrollTop <= step ? 0 : scroller.scrollTop - step;
      scroller.scrollTo({ top: nextTop, behavior: 'smooth' });
    });

    document.getElementById('dash-btn-scroll-down')?.addEventListener('click', () => {
      const scroller = getScrollContainer();
      if (!scroller) return;
      const step = Math.max(260, Math.round(scroller.clientHeight * 0.55));
      scroller.scrollBy({ top: step, behavior: 'smooth' });
    });

    const heroFileInput = document.getElementById('dash-hero-file-input');
    const btnChangeHeroImg = document.getElementById('dash-btn-change-hero-img');
    const btnResetHeroImg = document.getElementById('dash-btn-reset-hero-img');
    const cropperModal = document.getElementById('dash-modal-hero-cropper');
    const cropperCanvas = document.getElementById('dash-cropper-canvas');
    const cropperStage = document.getElementById('dash-cropper-stage');
    const zoomInput = document.getElementById('dash-cropper-zoom');
    const panXInput = document.getElementById('dash-cropper-pan-x');
    const panYInput = document.getElementById('dash-cropper-pan-y');
    const brightInput = document.getElementById('dash-cropper-brightness');

    const CROP = {
      img: null,
      zoom: 100,
      panX: 0,
      panY: 0,
      brightness: 100,
      fitMode: 'cover', // 'cover' | 'contain' | 'stretch'
      dragging: false,
      startX: 0,
      startY: 0,
      startPanX: 0,
      startPanY: 0,
    };

    function syncCropperControlsUI() {
      if (zoomInput) zoomInput.value = String(Math.round(CROP.zoom));
      if (panXInput) panXInput.value = String(Math.round(CROP.panX));
      if (panYInput) panYInput.value = String(Math.round(CROP.panY));
      if (brightInput) brightInput.value = String(Math.round(CROP.brightness));

      const zv = document.getElementById('dash-cropper-zoom-val');
      if (zv) zv.textContent = `${Math.round(CROP.zoom)}%`;
      const xv = document.getElementById('dash-cropper-pan-x-val');
      if (xv) xv.textContent = `${Math.round(CROP.panX)} px`;
      const yv = document.getElementById('dash-cropper-pan-y-val');
      if (yv) yv.textContent = `${Math.round(CROP.panY)} px`;
      const bv = document.getElementById('dash-cropper-brightness-val');
      if (bv) bv.textContent = `${Math.round(CROP.brightness)}%`;
    }

    function drawCropperToCanvas(targetCanvas, scaleMultiplier = 1) {
      if (!targetCanvas || !CROP.img) return;
      const ctx2d = targetCanvas.getContext('2d');
      const cw = targetCanvas.width;
      const ch = targetCanvas.height;

      ctx2d.save();
      ctx2d.fillStyle = getShellActiveTheme() === 'light' ? '#f8fafc' : '#071330';
      ctx2d.fillRect(0, 0, cw, ch);
      ctx2d.filter = `brightness(${CROP.brightness}%)`;

      const iw = CROP.img.naturalWidth || CROP.img.width || 1;
      const ih = CROP.img.naturalHeight || CROP.img.height || 1;
      const z = Math.max(0.1, CROP.zoom / 100);

      let drawW;
      let drawH;
      if (CROP.fitMode === 'stretch') {
        drawW = cw * z;
        drawH = ch * z;
      } else if (CROP.fitMode === 'contain') {
        const baseScale = Math.min(cw / iw, ch / ih);
        drawW = iw * baseScale * z;
        drawH = ih * baseScale * z;
      } else {
        const baseScale = Math.max(cw / iw, ch / ih);
        drawW = iw * baseScale * z;
        drawH = ih * baseScale * z;
      }

      const cx = (cw - drawW) / 2 + (CROP.panX * scaleMultiplier);
      const cy = (ch - drawH) / 2 + (CROP.panY * scaleMultiplier);

      ctx2d.drawImage(CROP.img, cx, cy, drawW, drawH);
      ctx2d.restore();
    }

    function syncStageDimensionsToRealBanner() {
      if (!cropperCanvas) return { w: 1320, h: 92 };
      const realVisual = document.getElementById('dash-hero-visual');
      const rect = realVisual ? realVisual.getBoundingClientRect() : null;
      const w = Math.max(480, Math.round(rect && rect.width > 100 ? rect.width : 1320));
      const h = Math.max(64, Math.round(rect && rect.height > 40 ? rect.height : 92));
      if (cropperCanvas.width !== w || cropperCanvas.height !== h) {
        cropperCanvas.width = w;
        cropperCanvas.height = h;
      }
      return { w, h };
    }

    function renderCropperStage() {
      syncCropperControlsUI();
      drawCropperToCanvas(cropperCanvas, 1);
    }

    function loadImageIntoCropper(srcUrl, opts = {}) {
      const img = new Image();
      img.onload = () => {
        const dims = syncStageDimensionsToRealBanner();
        CROP.img = img;
        CROP.rawSrc = srcUrl;
        if (opts.restoreTransform) {
          CROP.zoom = Number(opts.restoreTransform.zoom ?? 100);
          CROP.panX = Number(opts.restoreTransform.panX ?? 0);
          CROP.panY = Number(opts.restoreTransform.panY ?? 0);
          CROP.brightness = Number(opts.restoreTransform.brightness ?? 100);
          CROP.fitMode = opts.restoreTransform.fitMode || 'contain';
        } else {
          const iw = img.naturalWidth || img.width || 1;
          const ih = img.naturalHeight || img.height || 1;
          const bannerRatio = dims.w / Math.max(1, dims.h);
          const imgRatio = iw / Math.max(1, ih);
          // Si la imagen es un logotipo o formato no panorámico, mostrarla completa por defecto para no recortar letras
          CROP.fitMode = imgRatio < bannerRatio * 0.72 ? 'contain' : 'cover';
          CROP.zoom = 100;
          CROP.panX = 0;
          CROP.panY = 0;
          CROP.brightness = 100;
        }
        renderCropperStage();
      };
      img.src = srcUrl;
    }

    function openHeroCropperModal() {
      if (!cropperModal) return;
      const greetingNow = document.getElementById('dash-hero-greeting')?.textContent || '¡Buenas noches, Admin!';
      const sampleEl = document.getElementById('dash-cropper-greeting-sample');
      if (sampleEl) sampleEl.textContent = greetingNow;

      const dateNow = document.getElementById('dash-hero-date-label')?.textContent || 'Hoy';
      const dateSampleEl = document.getElementById('dash-cropper-date-sample');
      if (dateSampleEl) dateSampleEl.textContent = dateNow;

      cropperModal.hidden = false;
      syncStageDimensionsToRealBanner();

      const savedRaw = localStorage.getItem(getHeroRawSourceStorageKey());
      let savedTransform = null;
      try {
        const rawTf = localStorage.getItem(getHeroTransformStorageKey());
        if (rawTf) savedTransform = JSON.parse(rawTf);
      } catch (_) {}

      const currentSrc = savedRaw || document.getElementById('dash-hero-img-el')?.src || DEFAULT_HERO_IMG_URL;
      loadImageIntoCropper(currentSrc, { restoreTransform: savedTransform });
    }

    if (btnChangeHeroImg) {
      btnChangeHeroImg.addEventListener('click', () => {
        openHeroCropperModal();
      });
    }

    document.getElementById('dash-cropper-btn-browse')?.addEventListener('click', () => {
      if (heroFileInput) {
        heroFileInput.value = '';
        heroFileInput.click();
      }
    });

    document.getElementById('dash-cropper-btn-restore')?.addEventListener('click', () => {
      CROP.rawSrc = DEFAULT_HERO_IMG_URL;
      loadImageIntoCropper(DEFAULT_HERO_IMG_URL, {
        restoreTransform: { zoom: 100, panX: 0, panY: 0, brightness: 100, fitMode: 'cover' },
      });
      showToast('Imagen predeterminada cargada en el recuadro', 'info');
    });

    if (heroFileInput) {
      heroFileInput.addEventListener('change', (ev) => {
        const file = ev.target.files && ev.target.files[0];
        if (!file) return;
        if (!file.type.startsWith('image/')) {
          showToast('Selecciona un archivo de imagen válido (JPG, PNG o WebP)', 'error');
          return;
        }
        const reader = new FileReader();
        reader.onload = () => {
          if (cropperModal && cropperModal.hidden) {
            cropperModal.hidden = false;
          }
          loadImageIntoCropper(reader.result);
        };
        reader.readAsDataURL(file);
      });
    }

    if (cropperStage) {
      cropperStage.addEventListener('pointerdown', (ev) => {
        if (!CROP.img) return;
        CROP.dragging = true;
        CROP.startX = ev.clientX;
        CROP.startY = ev.clientY;
        CROP.startPanX = CROP.panX;
        CROP.startPanY = CROP.panY;
        try { cropperStage.setPointerCapture(ev.pointerId); } catch (_) {}
      });

      cropperStage.addEventListener('pointermove', (ev) => {
        if (!CROP.dragging) return;
        const rect = cropperStage.getBoundingClientRect();
        const ratioX = (cropperCanvas?.width || 960) / Math.max(1, rect.width);
        const ratioY = (cropperCanvas?.height || 174) / Math.max(1, rect.height);
        CROP.panX = Math.max(-700, Math.min(700, CROP.startPanX + (ev.clientX - CROP.startX) * ratioX));
        CROP.panY = Math.max(-500, Math.min(500, CROP.startPanY + (ev.clientY - CROP.startY) * ratioY));
        renderCropperStage();
      });

      const stopDrag = () => { CROP.dragging = false; };
      cropperStage.addEventListener('pointerup', stopDrag);
      cropperStage.addEventListener('pointercancel', stopDrag);

      cropperStage.addEventListener('wheel', (ev) => {
        if (!CROP.img) return;
        ev.preventDefault();
        const delta = ev.deltaY < 0 ? 6 : -6;
        CROP.zoom = Math.max(25, Math.min(350, CROP.zoom + delta));
        renderCropperStage();
      }, { passive: false });

      cropperStage.addEventListener('dragover', (ev) => {
        ev.preventDefault();
      });
      cropperStage.addEventListener('drop', (ev) => {
        ev.preventDefault();
        const file = ev.dataTransfer?.files && ev.dataTransfer.files[0];
        if (file && file.type.startsWith('image/')) {
          const reader = new FileReader();
          reader.onload = () => loadImageIntoCropper(reader.result);
          reader.readAsDataURL(file);
        }
      });
    }

    zoomInput?.addEventListener('input', () => {
      CROP.zoom = Number(zoomInput.value || 100);
      renderCropperStage();
    });
    document.getElementById('dash-cropper-zoom-out')?.addEventListener('click', () => {
      CROP.zoom = Math.max(25, CROP.zoom - 10);
      renderCropperStage();
    });
    document.getElementById('dash-cropper-zoom-in')?.addEventListener('click', () => {
      CROP.zoom = Math.min(350, CROP.zoom + 10);
      renderCropperStage();
    });

    panXInput?.addEventListener('input', () => {
      CROP.panX = Number(panXInput.value || 0);
      renderCropperStage();
    });
    panYInput?.addEventListener('input', () => {
      CROP.panY = Number(panYInput.value || 0);
      renderCropperStage();
    });
    brightInput?.addEventListener('input', () => {
      CROP.brightness = Number(brightInput.value || 100);
      renderCropperStage();
    });

    document.getElementById('dash-cropper-fit-cover')?.addEventListener('click', () => {
      CROP.fitMode = 'cover';
      CROP.zoom = 100;
      CROP.panX = 0;
      CROP.panY = 0;
      renderCropperStage();
    });
    document.getElementById('dash-cropper-fit-contain')?.addEventListener('click', () => {
      CROP.fitMode = 'contain';
      CROP.zoom = 100;
      CROP.panX = 0;
      CROP.panY = 0;
      renderCropperStage();
    });
    document.getElementById('dash-cropper-fit-stretch')?.addEventListener('click', () => {
      CROP.fitMode = 'stretch';
      CROP.zoom = 100;
      CROP.panX = 0;
      CROP.panY = 0;
      renderCropperStage();
    });
    document.getElementById('dash-cropper-btn-center')?.addEventListener('click', () => {
      CROP.panX = 0;
      CROP.panY = 0;
      renderCropperStage();
    });

    document.getElementById('dash-cropper-btn-save')?.addEventListener('click', async () => {
      if (!CROP.img || !cropperCanvas) return;
      const outCanvas = document.createElement('canvas');
      outCanvas.width = cropperCanvas.width;
      outCanvas.height = cropperCanvas.height;
      drawCropperToCanvas(outCanvas, 1);

      const dataUrl = outCanvas.toDataURL('image/jpeg', 0.92);
      try {
        localStorage.setItem(getHeroImageStorageKey(), dataUrl);
        if (CROP.rawSrc && CROP.rawSrc.length < 4_500_000) {
          localStorage.setItem(getHeroRawSourceStorageKey(), CROP.rawSrc);
        }
        localStorage.setItem(getHeroTransformStorageKey(), JSON.stringify({
          zoom: CROP.zoom,
          panX: CROP.panX,
          panY: CROP.panY,
          brightness: CROP.brightness,
          fitMode: CROP.fitMode,
        }));
      } catch (_) {}

      if (!STATE.workingPayload.theme) STATE.workingPayload.theme = {};
      STATE.workingPayload.theme.heroImageUrl = dataUrl;
      STATE.workingPayload.theme.heroStyle = 'illustrated';
      STATE.workingPayload.theme.showHero = true;
      applyVisualThemeAndHeader();

      if (cropperModal) cropperModal.hidden = true;

      if (!STATE.isEditing) {
        try {
          await saveActiveLayoutChanges();
        } catch (_) {}
      } else {
        pushUndoState();
      }
      showToast('Imagen del banner ajustada y guardada', 'success');
    });

    if (btnResetHeroImg) {
      btnResetHeroImg.addEventListener('click', async () => {
        try {
          localStorage.removeItem(getHeroImageStorageKey());
          localStorage.removeItem(getHeroRawSourceStorageKey());
          localStorage.removeItem(getHeroTransformStorageKey());
        } catch (_) {}
        if (STATE.workingPayload?.theme) {
          STATE.workingPayload.theme.heroImageUrl = null;
        }
        applyVisualThemeAndHeader();
        if (!STATE.isEditing) {
          try {
            await saveActiveLayoutChanges();
          } catch (_) {}
        }
        showToast('Imagen original del banner restaurada', 'info');
      });
    }

    document.getElementById('dash-btn-open-ai')?.addEventListener('click', () => openAiCopilotModal());
    document.getElementById('dash-btn-toggle-customize')?.addEventListener('click', () => setEditingMode(!STATE.isEditing));
    document.getElementById('dash-btn-add-widget')?.addEventListener('click', () => openWidgetCatalogModal());
    document.getElementById('dash-btn-open-templates')?.addEventListener('click', () => openTemplatesModal());

    document.getElementById('dash-btn-undo')?.addEventListener('click', () => {
      if (STATE.undoStack.length === 0) return;
      STATE.redoStack.push(deepClone(STATE.workingPayload));
      STATE.workingPayload = STATE.undoStack.pop();
      updateEditToolbarState();
      renderGrid();
    });

    document.getElementById('dash-btn-redo')?.addEventListener('click', () => {
      if (STATE.redoStack.length === 0) return;
      STATE.undoStack.push(deepClone(STATE.workingPayload));
      STATE.workingPayload = STATE.redoStack.pop();
      updateEditToolbarState();
      renderGrid();
    });

    document.getElementById('dash-btn-preview')?.addEventListener('click', (ev) => {
      STATE.isPreviewing = !STATE.isPreviewing;
      root.classList.toggle('is-editing', STATE.isEditing && !STATE.isPreviewing);
      ev.currentTarget.innerHTML = STATE.isPreviewing
        ? '<i class="fa-solid fa-pen-to-square"></i> Seguir editando'
        : '<i class="fa-solid fa-eye"></i> Vista previa';
      renderGrid();
    });

    document.getElementById('dash-edit-theme-select')?.addEventListener('change', (ev) => {
      pushUndoState();
      const val = ev.target.value;
      STATE.workingPayload.theme.mode = val;
      if (val === 'light' || val === 'dark') {
        document.documentElement.setAttribute('data-theme', val);
        localStorage.setItem('calebsys_theme', val);
      }
      applyVisualThemeAndHeader();
    });

    if (!window._calebsysDashThemeObserver) {
      window._calebsysDashThemeObserver = new MutationObserver(() => {
        if (!STATE.workingPayload) return;
        const shellMode = getShellActiveTheme();
        if (!STATE.workingPayload.theme) STATE.workingPayload.theme = {};
        STATE.workingPayload.theme.mode = shellMode;
        applyVisualThemeAndHeader();
      });
      window._calebsysDashThemeObserver.observe(document.documentElement, {
        attributes: true,
        attributeFilter: ['data-theme'],
      });
    }

    document.getElementById('dash-edit-density-select')?.addEventListener('change', (ev) => {
      pushUndoState();
      STATE.workingPayload.theme.density = ev.target.value;
      applyVisualThemeAndHeader();
    });

    document.getElementById('dash-edit-hero-select')?.addEventListener('change', (ev) => {
      pushUndoState();
      const val = ev.target.value;
      STATE.workingPayload.theme.showHero = val !== 'hidden';
      STATE.workingPayload.theme.heroStyle = val;
      applyVisualThemeAndHeader();
    });

    document.getElementById('dash-btn-cancel-edit')?.addEventListener('click', () => {
      if (STATE.savedPayloadSnapshot) {
        STATE.workingPayload = deepClone(STATE.savedPayloadSnapshot);
      }
      clearLocalDraft();
      setEditingMode(false);
      showToast('Cambios descartados');
    });

    document.getElementById('dash-btn-save-edit')?.addEventListener('click', () => {
      saveActiveLayoutChanges();
    });

    document.getElementById('dash-btn-export-json')?.addEventListener('click', async () => {
      const modal = document.getElementById('dash-modal-json');
      const ta = document.getElementById('dash-json-textarea');
      if (!modal || !ta) return;
      ta.value = JSON.stringify({
        system: 'CALEBSYS_ERP_DASHBOARD',
        schemaVersion: 1,
        layout: STATE.workingPayload,
      }, null, 2);
      modal.hidden = false;
    });

    document.getElementById('dash-btn-import-json-confirm')?.addEventListener('click', async () => {
      const ta = document.getElementById('dash-json-textarea');
      if (!ta) return;
      try {
        const parsed = JSON.parse(ta.value);
        const res = await apiFetch('/api/dashboard/layouts/import', {
          method: 'POST',
          body: JSON.stringify(parsed),
        });
        STATE.activeLayoutRecord = res;
        STATE.workingPayload = deepClone(res.layout);
        document.getElementById('dash-modal-json').hidden = true;
        await fetchSnapshotData();
        renderGrid();
        showToast('Configuración JSON importada y validada', 'success');
      } catch (err) {
        showToast(err.message || 'JSON inválido', 'error');
      }
    });

    document.getElementById('dash-cfg-window-param-select')?.addEventListener('change', (ev) => {
      const val = ev.target.value || '';
      if (!val.includes('::')) return;
      const [winId, paramId] = val.split('::');
      const winObj = (STATE.windowsDirectory || []).find(x => x.windowId === winId);
      const optObj = (winObj?.options || []).find(o => o.paramId === paramId);
      if (optObj) {
        const titleInp = document.getElementById('dash-cfg-title-input');
        if (titleInp) titleInp.value = (optObj.title || '').toUpperCase();
        const accSel = document.getElementById('dash-cfg-accent-select');
        if (accSel && optObj.accent) accSel.value = optObj.accent;
      }
    });

    document.getElementById('dash-btn-apply-widget-cfg')?.addEventListener('click', async () => {
      const w = (STATE.workingPayload?.widgets || []).find(item => (item.instanceId || item.instance_id) === STATE.editingInstanceId);
      if (!w) return;
      pushUndoState();
      if (!w.settings) w.settings = {};

      const paramSelVal = document.getElementById('dash-cfg-window-param-select')?.value || '';
      if (paramSelVal.includes('::')) {
        const [winId, paramId] = paramSelVal.split('::');
        const winObj = (STATE.windowsDirectory || []).find(x => x.windowId === winId);
        const optObj = (winObj?.options || []).find(o => o.paramId === paramId);
        if (optObj && winObj) {
          const targetWKey = optObj.widgetKey || 'window_parameter_card';
          const targetMeta = STATE.catalogMap[targetWKey] || {};
          const alreadyExistsOther = !targetMeta.allowMultiple && (STATE.workingPayload.widgets || []).some(
            x => (x.instanceId || x.instance_id) !== (w.instanceId || w.instance_id) && (x.widgetKey || x.widget_key) === targetWKey
          );
          w.widgetKey = alreadyExistsOther ? 'window_parameter_card' : targetWKey;
          w.settings.paramId = optObj.paramId;
          w.settings.routePath = optObj.routePath || winObj.routePath;
          w.settings.routeUrl = optObj.routeUrl || winObj.routeUrl;
          w.settings.targetPage = optObj.targetPage || winObj.page || '';
        }
      }

      const wkey = w.widgetKey || w.widget_key;
      const meta = STATE.catalogMap[wkey] || {};

      const rawTitle = (document.getElementById('dash-cfg-title-input')?.value || '').trim().toUpperCase();
      w.settings.customTitle = rawTitle || null;
      w.settings.variant = document.getElementById('dash-cfg-variant-select')?.value || 'glass';
      w.settings.accent = document.getElementById('dash-cfg-accent-select')?.value || 'blue';

      const perOverride = document.getElementById('dash-cfg-period-select')?.value || '';
      if (!w.filters) w.filters = {};
      if (perOverride) {
        w.filters.datePreset = perOverride;
      } else {
        delete w.filters.datePreset;
      }

      const rect = window.CalebsysDashboardLayoutEngine.getDesktopRect(w);
      const minW = meta.minSize?.w || 2;
      const maxW = meta.maxSize?.w || 12;
      const minH = meta.minSize?.h || 1;
      const maxH = meta.maxSize?.h || 8;
      const newW = Number(document.getElementById('dash-cfg-w-input')?.value || rect.w);
      const newH = Number(document.getElementById('dash-cfg-h-input')?.value || rect.h);
      rect.w = Math.max(minW, Math.min(maxW, newW));
      rect.h = Math.max(minH, Math.min(maxH, newH));
      window.CalebsysDashboardLayoutEngine.setDesktopRect(w, rect);

      document.getElementById('dash-drawer-widget-config').hidden = true;
      await fetchSnapshotData();
      renderGrid();
      showToast('Módulo actualizado');
    });

    root.querySelectorAll('[data-close-target]').forEach(btn => {
      btn.addEventListener('click', () => {
        const targetId = btn.getAttribute('data-close-target');
        const el = document.getElementById(targetId);
        if (el) el.hidden = true;
      });
    });

    const catSearch = document.getElementById('dash-catalog-search-input');
    if (catSearch) {
      catSearch.addEventListener('input', () => renderCatalogItems(catSearch.value));
    }

    const catWinSel = document.getElementById('dash-catalog-window-select');
    if (catWinSel) {
      catWinSel.addEventListener('change', () => renderCatalogItems(catSearch ? catSearch.value : ''));
    }

    document.getElementById('dash-cat-mode-windows')?.addEventListener('click', () => {
      STATE.catalogMode = 'windows';
      renderCatalogItems(catSearch ? catSearch.value : '');
    });

    document.getElementById('dash-cat-mode-widgets')?.addEventListener('click', () => {
      STATE.catalogMode = 'widgets';
      renderCatalogItems(catSearch ? catSearch.value : '');
    });

    const connPanel = document.getElementById('dash-new-module-connector-panel');
    document.getElementById('dash-btn-toggle-new-module-form')?.addEventListener('click', () => {
      if (connPanel) connPanel.hidden = !connPanel.hidden;
    });
    document.getElementById('dash-btn-close-new-module-form')?.addEventListener('click', () => {
      if (connPanel) connPanel.hidden = true;
    });

    ['dash-conn-win-name', 'dash-conn-route-path', 'dash-conn-param-title', 'dash-conn-param-desc'].forEach(id => {
      const inp = document.getElementById(id);
      if (inp) {
        inp.addEventListener('blur', () => {
          inp.value = (inp.value || '').toUpperCase();
        });
      }
    });

    document.getElementById('dash-btn-submit-new-module')?.addEventListener('click', async () => {
      const winName = (document.getElementById('dash-conn-win-name')?.value || '').trim().toUpperCase();
      const routePath = (document.getElementById('dash-conn-route-path')?.value || '').trim().toUpperCase();
      const routeUrl = (document.getElementById('dash-conn-route-url')?.value || '').trim();
      const paramTitle = (document.getElementById('dash-conn-param-title')?.value || '').trim().toUpperCase();
      const paramDesc = (document.getElementById('dash-conn-param-desc')?.value || '').trim().toUpperCase();
      const sourceTable = (document.getElementById('dash-conn-source-table')?.value || '').trim();
      const accent = document.getElementById('dash-conn-accent')?.value || 'orange';

      if (!winName) {
        showToast('Ingresa el nombre del módulo o ventana (ej. PRODUCCIÓN)', 'error');
        return;
      }

      try {
        const res = await apiFetch('/api/dashboard/modules/register', {
          method: 'POST',
          body: JSON.stringify({
            windowName: winName,
            routePath: routePath || `OPERACIONES > ${winName}`,
            routeUrl: routeUrl || `/admin#${winName.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
            paramTitle: paramTitle || `INDICADORES DE ${winName}`,
            paramDescription: paramDesc || `CONTROL Y ESTADO OPERATIVO DE ${winName}`,
            sourceTable,
            accent,
          }),
        });

        if (Array.isArray(res.windowsDirectory)) {
          STATE.windowsDirectory = res.windowsDirectory;
        }
        populateCatalogWindowSelect();
        renderCatalogItems(catSearch ? catSearch.value : '');

        if (connPanel) connPanel.hidden = true;
        if (res.createdOption && res.module) {
          await addWindowOptionToDashboard(res.createdOption, res.module);
        }
        showToast(`Módulo "${winName}" conectado y su widget fue agregado al Dashboard`, 'success');
      } catch (err) {
        showToast(err.message || 'No se pudo registrar el módulo', 'error');
      }
    });

    document.getElementById('dash-btn-conflict-reload')?.addEventListener('click', async () => {
      document.getElementById('dash-modal-conflict').hidden = true;
      clearLocalDraft();
      setEditingMode(false);
      await initDashboardEngine();
      showToast('Se recargó la versión más reciente del servidor');
    });

    document.getElementById('dash-btn-conflict-overwrite')?.addEventListener('click', async () => {
      const modal = document.getElementById('dash-modal-conflict');
      const ver = modal?._serverVersion || 1;
      modal.hidden = true;
      await saveActiveLayoutChanges(ver);
    });

    const searchInput = document.getElementById('dash-global-search-input');
    const searchDropdown = document.getElementById('dash-global-search-results');
    if (searchInput && searchDropdown) {
      const triggerSearchQuery = (rawQ) => {
        clearTimeout(STATE.searchDebounceTimer);
        const q = (rawQ || '').trim() || '*';
        STATE.searchDebounceTimer = setTimeout(async () => {
          try {
            const res = await apiFetch(`/api/dashboard/search?q=${encodeURIComponent(q)}`);
            renderGlobalSearchDropdown(searchDropdown, res.results || []);
          } catch (_) {
            searchDropdown.hidden = true;
          }
        }, 140);
      };

      searchInput.addEventListener('focus', () => {
        triggerSearchQuery(searchInput.value);
      });

      searchInput.addEventListener('input', () => {
        triggerSearchQuery(searchInput.value);
      });

      document.addEventListener('click', (ev) => {
        if (!ev.target.closest('.dash-search-box')) {
          searchDropdown.hidden = true;
        }
      });

      window.addEventListener('keydown', (ev) => {
        if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === 'k') {
          ev.preventDefault();
          searchInput.focus();
        }
      });
    }

    root.querySelectorAll('input[data-uppercase="true"]').forEach(inp => {
      inp.addEventListener('blur', () => {
        inp.value = (inp.value || '').toUpperCase();
      });
    });

    window.addEventListener('resize', () => {
      if (STATE.workingPayload) renderGrid();
    });
  }

  function renderGlobalSearchDropdown(dropdown, items) {
    const esc = window.CalebsysDashboardRegistry.escapeHtml;
    if (!Array.isArray(items) || items.length === 0) {
      dropdown.innerHTML = `<div style="padding:12px;text-align:center;color:var(--dash-text-muted);font-size:13px;">Sin resultados encontrados</div>`;
      dropdown.hidden = false;
      return;
    }

    dropdown.innerHTML = items.map((it, itemIdx) => {
      const opts = Array.isArray(it.options) ? it.options : [];
      const optsHtml = opts.length > 0
        ? `<div class="dash-search-opts-wrap">
             <span style="font-size:10.5px;color:var(--dash-text-muted);align-self:center;font-weight:700;">Opciones ahí:</span>
             ${opts.map((o, oIdx) => `
               <button type="button" class="dash-search-opt-btn" data-srch-item-idx="${itemIdx}" data-srch-opt-idx="${oIdx}" title="${esc(o.description || '')} · Clic para poner este parámetro en el Dashboard">
                 <i class="fa-solid fa-plus"></i> ${esc(o.title)}
               </button>
             `).join('')}
           </div>`
        : '';

      return `
        <div class="dash-search-item">
          <div class="dash-search-item-top" data-search-page="${esc(it.page || '')}" data-search-href="${esc(it.href || '')}">
            <div>
              <i class="fa-solid ${esc(it.icon || 'fa-magnifying-glass')}" style="color:#60a5fa;margin-right:7px;"></i>
              <strong>${esc(it.title)}</strong>
              ${it.subtitle ? `<div style="font-size:11px;color:#93c5fd;margin-left:22px;font-weight:600;">📍 ${esc(it.subtitle)}</div>` : ''}
            </div>
            <small>${esc(it.type || '')} ↗</small>
          </div>
          ${optsHtml}
        </div>
      `;
    }).join('');
    dropdown.hidden = false;

    dropdown.querySelectorAll('.dash-search-item-top').forEach(el => {
      el.addEventListener('click', () => {
        dropdown.hidden = true;
        const page = el.getAttribute('data-search-page');
        const href = el.getAttribute('data-search-href');
        if (page && typeof window.navigateTo === 'function') {
          window.navigateTo(page);
        } else if (href) {
          window.location.href = href;
        }
      });
    });

    dropdown.querySelectorAll('[data-srch-item-idx]').forEach(btn => {
      btn.addEventListener('click', async (ev) => {
        ev.stopPropagation();
        const iIdx = Number(btn.getAttribute('data-srch-item-idx') || 0);
        const oIdx = Number(btn.getAttribute('data-srch-opt-idx') || 0);
        const itemObj = items[iIdx];
        const optObj = itemObj?.options?.[oIdx];
        if (itemObj && optObj) {
          await addWindowOptionToDashboard(optObj, {
            windowId: itemObj.page || 'productos',
            routePath: itemObj.routePath || itemObj.title,
            routeUrl: itemObj.routeUrl || `/admin#${itemObj.page || 'dashboard'}`,
            page: itemObj.page || '',
          });
        }
      });
    });
  }

  async function initDashboardEngine() {
    const root = document.getElementById('calebsys-dashboard-root');
    if (!root) return;

    bindStaticDashboardEvents();

    try {
      const [ctx, catRes, activeRes, tplRes, layoutsRes] = await Promise.all([
        apiFetch('/api/dashboard/context'),
        apiFetch('/api/dashboard/widgets/catalog'),
        apiFetch('/api/dashboard/layouts/active'),
        apiFetch('/api/dashboard/templates'),
        apiFetch('/api/dashboard/layouts'),
      ]);

      STATE.context = ctx;
      STATE.catalog = catRes.widgets || [];
      STATE.categories = catRes.categories || [];
      STATE.windowsDirectory = catRes.windowsDirectory || [];
      STATE.catalogMap = {};
      STATE.catalog.forEach(w => { STATE.catalogMap[w.key] = w; });

      STATE.templates = tplRes.templates || [];
      STATE.layoutsList = layoutsRes.items || [];
      STATE.activeLayoutRecord = activeRes;
      STATE.workingPayload = deepClone(activeRes?.layout || {});

      renderHeaderContext();
      await fetchSnapshotData();
      renderGrid();
    } catch (err) {
      console.error('[CalebsysDashboard] Error al inicializar:', err);
      const gridEl = document.getElementById('dash-widgets-grid');
      if (gridEl) {
        gridEl.innerHTML = `
          <div class="dash-widget-state" style="grid-column: 1 / -1;">
            <i class="fa-solid fa-triangle-exclamation" style="font-size:28px;color:#ef4444;"></i>
            <strong>No se pudo cargar el Dashboard Principal</strong>
            <span>${window.CalebsysDashboardRegistry.escapeHtml(err.message || 'Verifica tu sesión o conexión al servidor.')}</span>
          </div>
        `;
      }
    }
  }

  window.CalebsysDashboardEngine = {
    init: initDashboardEngine,
    refresh: async () => {
      await fetchSnapshotData();
      renderGrid();
    },
    getState: () => STATE,
    registerNewModuleAndWidget: async (modulePayload) => {
      const res = await apiFetch('/api/dashboard/modules/register', {
        method: 'POST',
        body: JSON.stringify(modulePayload || {}),
      });
      if (Array.isArray(res.windowsDirectory)) {
        STATE.windowsDirectory = res.windowsDirectory;
      }
      populateCatalogWindowSelect();
      if (res.createdOption && res.module && modulePayload?.autoPlace !== false) {
        await addWindowOptionToDashboard(res.createdOption, res.module);
      }
      return res;
    },
  };
})();
