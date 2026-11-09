(function () {
  'use strict';

  // ── Click delegation (data-click) ────────────────────────────────────────────
  document.addEventListener('click', function (e) {
    var el = e.target.closest('[data-click]');
    if (!el) return;

    if (el.dataset.clickSelfTarget === 'true' && e.target !== el) return;

    var fn   = el.dataset.click;
    var arg  = 'clickArg'  in el.dataset ? el.dataset.clickArg  : undefined;
    var arg2 = 'clickArg2' in el.dataset ? el.dataset.clickArg2 : undefined;
    var arg3 = 'clickArg3' in el.dataset ? el.dataset.clickArg3 : undefined;

    if (el.dataset.clickArgType === 'boolean') arg = (arg === 'true');
    else if (el.dataset.clickArgType === 'number') arg = parseFloat(arg);

    var f = window[fn];
    if (typeof f !== 'function') return;

    if (el.dataset.clickEvent === 'true') {
      f(e);
    } else if (el.dataset.clickSelf === 'true' && arg !== undefined && arg2 !== undefined) {
      f(el, arg, arg2);
    } else if (el.dataset.clickSelf === 'true' && arg !== undefined) {
      f(el, arg);
    } else if (el.dataset.clickSelf === 'true') {
      f(el);
    } else if (arg !== undefined && arg2 !== undefined && arg3 !== undefined) {
      f(arg, arg2, arg3);
    } else if (arg !== undefined && arg2 !== undefined) {
      f(arg, arg2);
    } else if (arg !== undefined) {
      f(arg);
    } else {
      f();
    }
  });

  // ── Submit delegation (data-submit) ──────────────────────────────────────────
  document.addEventListener('submit', function (e) {
    var el = e.target.closest('[data-submit]');
    if (!el) return;
    var fn = el.dataset.submit;
    var f  = window[fn];
    if (typeof f === 'function') f(e);
  });

  // ── Input delegation (data-input) ────────────────────────────────────────────
  document.addEventListener('input', function (e) {
    var el = e.target.closest('[data-input]');
    if (!el) return;
    var fn = el.dataset.input;
    if (fn === 'toUpperCase') {
      e.target.value = e.target.value.toUpperCase();
      return;
    }
    var f = window[fn];
    if (typeof f === 'function') f(e.target.value);
  });

  // ── Keyup delegation (data-keyup) ────────────────────────────────────────────
  document.addEventListener('keyup', function (e) {
    var el = e.target.closest('[data-keyup]');
    if (!el) return;
    var fn = el.dataset.keyup;
    var f  = window[fn];
    if (typeof f === 'function') f(e.target.value);
  });

  // ── Keydown delegation (data-keydown) ────────────────────────────────────────
  document.addEventListener('keydown', function (e) {
    var el = e.target.closest('[data-keydown]');
    if (!el) return;
    if (el.dataset.keydownKey && e.key !== el.dataset.keydownKey) return;
    if (el.dataset.keydownPrevent === 'true') e.preventDefault();
    var fn  = el.dataset.keydown;
    var arg = 'clickArg' in el.dataset ? el.dataset.clickArg : undefined;
    var f   = window[fn];
    if (typeof f !== 'function') return;
    if (arg !== undefined) f(arg);
    else f(e);
  });

  // ── Change delegation (data-change) ──────────────────────────────────────────
  document.addEventListener('change', function (e) {
    var el = e.target.closest('[data-change]');
    if (!el) return;
    var fn = el.dataset.change;
    var f  = window[fn];
    if (typeof f === 'function') f(e);
  });

  // ── Wrapper: safe call (typeof guard) ────────────────────────────────────────
  window.__safe = function (fnName) {
    if (typeof window[fnName] === 'function') window[fnName]();
  };

  // ── Wrappers: navigation ──────────────────────────────────────────────────────
  window.__navHash = function (hash) { window.location.hash = hash; };
  window.__navHref = function (href)  { window.location.href  = href; };
  window.__print   = function ()       { window.print(); };

  // ── Wrappers: POS / index.html ────────────────────────────────────────────────
  window.__confirmLogout = function () {
    if (confirm('¿Cerrar sesión?')) logout();
  };
  window.__offlineQueueSync = function () {
    if (typeof offlineQueueSync === 'function') offlineQueueSync();
  };
  window.__openReloj = function () {
    if (window.CalebsysReloj) window.CalebsysReloj.open();
  };
  window.__clickConstanciaFile = function () {
    var el = document.getElementById('nc-constancia-file');
    if (el) el.click();
  };
  window.__focusEmailInput = function () {
    var el = document.getElementById('nc-email-input');
    if (el) el.focus();
  };
  window.__openModalPaquete = function () {
    var el = document.getElementById('modal-paquete');
    if (el) el.classList.remove('hidden');
  };
  window.__closeModalPaquete = function () {
    var el = document.getElementById('modal-paquete');
    if (el) el.classList.add('hidden');
  };
  window.__closeCatalogModule = function () {
    var el = document.getElementById('modulo-catalogo');
    if (el) el.classList.add('hidden');
    window.catalogoAbierto = false;
  };
  window.__openWhatsApp = function () { return openWhatsApp(); };
  window.__redirectToPos = function () {
    sessionStorage.setItem('calebsys_from_os', '1');
    window.location.href = '/';
  };
  window.__loadViewQuotesTimeout = function () { setTimeout(loadViewQuotes, 50); };
  window.__showOpcionesToast     = function () {
    if (typeof showToast === 'function') showToast('Opciones', 'info');
  };
  window.__submitNewClientViewFull = function (e) {
    if (typeof submitNewClientView === 'function') submitNewClientView(e, true);
  };

  // ── Wrappers: admin pages ─────────────────────────────────────────────────────
  window.__closeModalCajaLoad = function () {
    if (typeof closeModalCaja === 'function') closeModalCaja('modal-resultado-corte');
    if (typeof cajaLoad === 'function') cajaLoad();
  };
  window.__ocCerrarNavCompras = function () {
    if (typeof ocCerrarDetalle === 'function') ocCerrarDetalle();
    if (window.navigateTo) navigateTo('compras-recepciones');
  };

  // ── Wrappers: registry-based for contractor/project JSON args ─────────────────
  window.__editContractorById = function (id) {
    var c = window._contractorsReg && window._contractorsReg[id];
    if (c && typeof editContractor === 'function') editContractor(c);
  };
  window.__editProjectById = function (id) {
    var p = window._projectsReg && window._projectsReg[id];
    if (p && typeof editProject === 'function') editProject(p);
  };

})();
