/* loaders/config-hub.js — Configuración del sistema & Store Reactivo de Catálogos
   Incluye:
   - Navegación por teclado (F1 a F9 y Flechas direccionales ArrowUp/Down/Left/Right) en las 9 tarjetas superiores
   - [F3] Redes Sociales: WhatsApp (Twilio) + Mensajería (Facebook, Instagram, Correo electrónico y SMS)
   - [F8] Catálogos: Acordeón Desplegable en Cascada de Familias y Departamentos + 4 cajones inferiores colapsables
   - [F9] Impresoras: CRUD de impresoras numeradas globalmente + Asignación por tipo de documento + Configuración del Ticket
*/
(function (global) {
  'use strict';

  var SECS = ['general', 'sucursales', 'whatsapp', 'sat', 'carga', 'terminales', 'parametros', 'catalogos', 'impresoras'];
  var LS_KEY = 'calebsys_catalog_store_v1';
  var LS_MSG_KEY = 'calebsys_mensajeria_v1';
  var LS_PRT_KEY = 'calebsys_printers_catalog_v1';
  var LS_PRT_ASIG_KEY = 'calebsys_printers_assignment_v1';
  var LS_SCALES_KEY = 'calebsys_price_scales_v1';
  var LS_BRANCH_SCALES_KEY = 'calebsys_branch_price_scales_v1';

  var _activeSec = 'general';
  var _cat = 'productos';
  var _prods = null;      // cache de productos de /api/products/search
  var _params = null;     // cache de /api/admin/config
  var _branches = null;   // cache de sucursales de /api/branches
  var _openFam = 'VARILLA'; // única familia desplegada en el acordeón (cascada)
  var _fdBlockCollapsed = false; // permite contraer/desplegar todo el bloque de Familias y Departamentos
  var _deptoSearch = {};  // { FAMILIA: 'texto busqueda' }
  var _drawerSearch = {   // filtro en tiempo real para los 4 módulos de catálogos
    marcas: '',
    presentaciones: '',
    unidades: '',
    ivas: ''
  };
  var _editingCatalog = { key: '', val: '' }; // elemento actualmente en edición in-line
  var _drawersOpen = {    // 4 cajones en #configuracion con estilo de alta densidad y borde neón activo
    marcas: true,
    presentaciones: true,
    unidades: true,
    ivas: true
  };
  var _preciosDrawersOpen = {
    escalas: true,
    sucursales: true
  };
  var _priceScales = [];
  var _branchPriceScales = [];
  var _activeBranchScaleFilter = '';
  var _editingScaleId = '';
  var _editingBranchScaleId = '';

  var DEFAULT_PRICE_SCALES = [
    { id: 'esc-1', name: 'PRECIO DE LISTA',     margen_ideal: 50.00, oferta: 0.00, comision: 0.00, active: true, locked: true },
    { id: 'esc-3', name: 'CONTRATISTA',         margen_ideal: 35.00, oferta: 0.00, comision: 1.50, active: true, locked: false },
    { id: 'esc-4', name: 'REVENTA',             margen_ideal: 20.00, oferta: 0.00, comision: 1.00, active: true, locked: false },
    { id: 'esc-5', name: 'CREDITO',             margen_ideal: 70.00, oferta: 0.00, comision: 0.00, active: true, locked: false },
    { id: 'esc-6', name: 'CREDITOS ESPECIALES', margen_ideal: 90.00, oferta: 0.00, comision: 0.00, active: true, locked: false }
  ];
  var DEFAULT_FAM_TREE = {
    'VARILLA':    ['VARILLA', 'MATERIALES PESADOS', 'ACERO CORRUGADO'],
    'ACEROS':     ['ACEROS', 'PERFILES', 'LÁMINAS', 'MALLAS Y ALAMBRES'],
    'CEMENTO':    ['CEMENTO Y MORTERO', 'CONSTRUCCIÓN', 'AGREGADOS', 'CAL Y YESO'],
    'MADERAS':    ['MADERAS', 'TRIPLAY', 'CIMBRA', 'PINO'],
    'FERRETERÍA': ['FERRETERÍA', 'HERRAMIENTAS', 'TORNILLERÍA', 'CERRAJERÍA'],
    'ACABADOS':   ['PINTURAS', 'IMPERMEABILIZANTES', 'PISOS Y AZULEJOS', 'ADHESIVOS'],
    'PLOMERÍA':   ['TUBERÍA Y CONEXIONES', 'TINACOS Y BOMBAS', 'GRIFERÍA', 'SANITARIOS'],
    'ELÉCTRICO':  ['CABLES Y CONDUCTORES', 'ILUMINACIÓN', 'CENTROS DE CARGA', 'ACCESORIOS ELÉCTRICOS'],
    'GENERAL':    ['GENERAL']
  };
  var DEFAULT_MARCAS = [
    'GENÉRICO', 'DEACERO', 'SICARTSA', 'CEMEX', 'APASCO', 'MOCTEZUMA', 'TRUPER',
    'TERNIUM', 'GERDAU CORSA', 'URREA', 'ROTOPLAS', 'AUSTROMEX', 'SIKA', 'COMEX',
    'BEREL', 'CREST', 'SOPRANO'
  ];
  /* Conteo base del catálogo de artículos por marca, presentación, unidad e IVA + artículos dados de alta en tiempo real */
  var BASE_BRAND_COUNTS = {
    'GENÉRICO': 1482,
    'DEACERO': 243,
    'SICARTSA': 118,
    'CEMEX': 95,
    'APASCO': 64,
    'MOCTEZUMA': 52,
    'TRUPER': 310,
    'TERNIUM': 87,
    'GERDAU CORSA': 41,
    'URREA': 129,
    'ROTOPLAS': 76,
    'AUSTROMEX': 54,
    'SIKA': 63,
    'COMEX': 88,
    'BEREL': 47,
    'CREST': 39,
    'SOPRANO': 22
  };
  var DEFAULT_UNIDADES = ['PIEZA', 'METRO', 'M3', 'M2', 'KILOGRAMO', 'LITRO', 'TONELADA', 'BOLSA', 'SACO', 'CAJA', 'PAQUETE', 'ROLLO', 'CUBETA', 'GALÓN', 'JUEGO', 'PAR', 'MILLAR', 'SERVICIO'];
  var BASE_UNI_COUNTS = {
    'PIEZA': 1890,
    'METRO': 260,
    'M3': 78,
    'M2': 64,
    'KILOGRAMO': 315,
    'LITRO': 142,
    'TONELADA': 195,
    'BOLSA': 92,
    'SACO': 224
  };
  var DEFAULT_PRESENTACIONES = ['PIEZA', 'CAJA', 'PAQUETE', 'BULTO', 'SACO', 'BOLSA', 'TONELADA', 'ATADO', 'ROLLO', 'CUBETA', 'METRO', 'M3', 'MILLAR'];
  var BASE_PRES_COUNTS = {
    'PIEZA': 1620,
    'CAJA': 340,
    'PAQUETE': 215,
    'BULTO': 190,
    'TONELADA': 180,
    'ATADO': 95,
    'METRO': 140,
    'BOLSA': 88,
    'M3': 64,
    'MILLAR': 42,
    'SACO': 310
  };
  /* Mapa oficial CALEBSYS: Unidad / Presentación -> c_ClaveUnidad SAT (Anexo 20 CFDI 4.0) */
  var SAT_UNIT_DEFAULT_MAP = {
    'PIEZA': 'H87', 'PZA': 'H87', 'PZ': 'H87', 'UNIDAD': 'H87',
    'METRO': 'MTR', 'MTR': 'MTR', 'TRAMO': 'MTR', 'TIRA': 'MTR', 'METRO LINEAL': 'MTR',
    'KILOGRAMO': 'KGM', 'KG': 'KGM', 'KILO': 'KGM', 'KGM': 'KGM',
    'LITRO': 'LTR', 'LT': 'LTR', 'LTR': 'LTR',
    'TONELADA': 'TNE', 'TON': 'TNE', 'TNE': 'TNE', 'TONELADA METRICA': 'TNE', 'TONELADA MÉTRICA': 'TNE',
    'M3': 'MTQ', 'METRO CUBICO': 'MTQ', 'METRO CÚBICO': 'MTQ', 'MTQ': 'MTQ',
    'M2': 'MTK', 'METRO CUADRADO': 'MTK', 'MTK': 'MTK',
    'CAJA': 'XBX', 'XBX': 'XBX',
    'PAQUETE': 'XPK', 'PAQ': 'XPK', 'XPK': 'XPK',
    'BOLSA': 'XBG', 'XBG': 'XBG',
    'SACO': 'XSA', 'BULTO': 'XSA', 'COSTAL': 'XSA', 'XSA': 'XSA',
    'ATADO': 'XBH', 'MANOJO': 'XBH', 'MAZO': 'XBH', 'XBH': 'XBH',
    'ROLLO': 'XRO', 'XRO': 'XRO',
    'CUBETA': 'XBJ', 'BALDE': 'XBJ', 'BOTE': 'XBJ', 'XBJ': 'XBJ',
    'BOTELLA': 'XBO', 'GARRAFON': 'XBO', 'GARRAFÓN': 'XBO', 'ENVASE': 'XBO', 'XBO': 'XBO',
    'GALON': 'GLL', 'GALÓN': 'GLL', 'GLL': 'GLL',
    'JUEGO': 'SET', 'KIT': 'SET', 'CONJUNTO': 'SET', 'SET': 'SET',
    'PAR': 'PR', 'PR': 'PR',
    'MILLAR': 'MIL', 'MIL': 'MIL',
    'SERVICIO': 'E48', 'FLETE': 'E48', 'MANO DE OBRA': 'E48', 'E48': 'E48',
    'GRAMO': 'GRM', 'GR': 'GRM', 'GRM': 'GRM'
  };
  var LS_SAT_UNIT_MAP_KEY = 'calebsys_sat_unit_map_v1';
  var _satUnitCustomMap = {};
  try {
    var rawSatUMap = localStorage.getItem(LS_SAT_UNIT_MAP_KEY);
    if (rawSatUMap) _satUnitCustomMap = JSON.parse(rawSatUMap) || {};
  } catch (e) {}

  function parseUnitAndSatInput(rawStr) {
    var s = String(rawStr == null ? '' : rawStr).trim().toUpperCase();
    var m = /^(.+?)\s*\(([A-Z0-9]{2,4})\)\s*$/.exec(s);
    if (m) {
      return { name: m[1].trim(), satCode: m[2].trim() };
    }
    return { name: s, satCode: '' };
  }

  function resolveSatClaveUnidad(unitName) {
    var parsed = parseUnitAndSatInput(unitName);
    var clean = parsed.name;
    if (!clean) return 'H87';
    if (parsed.satCode) return parsed.satCode;
    if (_satUnitCustomMap && _satUnitCustomMap[clean]) return _satUnitCustomMap[clean];
    if (SAT_UNIT_DEFAULT_MAP[clean]) return SAT_UNIT_DEFAULT_MAP[clean];
    var keys = Object.keys(SAT_UNIT_DEFAULT_MAP);
    for (var i = 0; i < keys.length; i++) {
      if (clean.indexOf(keys[i]) >= 0) return SAT_UNIT_DEFAULT_MAP[keys[i]];
    }
    return 'H87';
  }

  function saveSatUnitAssociation(unitName, satCode) {
    var u = String(unitName || '').trim().toUpperCase();
    var c = String(satCode || '').trim().toUpperCase() || resolveSatClaveUnidad(u);
    if (!u) return;
    _satUnitCustomMap[u] = c;
    try { localStorage.setItem(LS_SAT_UNIT_MAP_KEY, JSON.stringify(_satUnitCustomMap)); } catch (e) {}
  }

  var DEFAULT_IVAS = ['16 %', '8 %', '0 %', 'EXENTO'];
  var BASE_IVA_COUNTS = {
    '16 %': 2980,
    '8 %': 145,
    '0 %': 48,
    'EXENTO': 23
  };

  /* Semillas iniciales de Impresoras (numeradas en orden de alta, vinculadas a "Enviar a impresor") */
  var DEFAULT_PRINTERS = [
    { id: 'prt-3', num: 3, name: 'TICKETS: Ventas, Caja, Almacén', width: '80mm', conn: 'Sistema', model: 'SAM4S GIANT-100', copies: 1, scope: 'global' },
    { id: 'prt-4', num: 4, name: 'TICKETS: Almacén y Patio', width: '80mm', conn: 'Sistema', model: 'EPSON TM-T20III', copies: 1, scope: 'global' },
    { id: 'prt-5', num: 5, name: 'PDF: Documentos, CFDI, Contratos', width: 'Carta', conn: 'PDF Virtual', model: 'Microsoft Print to PDF', copies: 1, scope: 'global' }
  ];

  var MSG_CHANNELS = ['facebook', 'instagram', 'correo', 'sms'];
  var _msgConfig = {};
  var _printers = [];
  var _printerAsig = {
    venta: '3',
    cierre: '3',
    remision: '5',
    cfdi: '5',
    oc: '5',
    etiqueta: '3'
  };

  var _famTree = {};
  var _catLists = {
    marcas: [],
    presentaciones: [],
    unidades: [],
    ivas: []
  };
  var _initialized = false;

  /* ───────────────────────── Helpers ───────────────────────── */
  function byId(id) { return document.getElementById(id); }
  function esc(v) {
    return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function norm(v) { return String(v == null ? '' : v).trim().toUpperCase(); }
  function num(v) { var n = Number(v); return isFinite(n) ? n : 0; }
  function fmt2(n) { return num(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
  function get(path) { return AdminAPI.apiFetch(path); }
  function putCfg(key, val) {
    if (_params) _params[key] = val;
    return AdminAPI.apiFetch('/api/admin/config/' + encodeURIComponent(key), {
      method: 'PUT',
      body: JSON.stringify(val)
    });
  }
  function safe(promise) { return promise.then(function (v) { return v; }, function () { return null; }); }
  function meta(p) { return (p && p.meta_data && typeof p.meta_data === 'object') ? p.meta_data : {}; }
  function pPrice(p) { return num(p.price != null ? p.price : p.precio_venta); }
  function pCost(p) { return num(p.average_cost != null ? p.average_cost : p.costo); }
  function pMargin(p) {
    var cost = pCost(p); if (!(cost > 0)) return null;
    var iva = meta(p).iva != null ? num(meta(p).iva) : 16;
    return ((pPrice(p) / (1 + iva / 100)) - cost) / cost * 100;
  }
  function avg(arr) { return arr.length ? arr.reduce(function (a, b) { return a + b; }, 0) / arr.length : 0; }
  function errBox(msg) { return '<div class="cfg-empty" style="color:var(--danger);">No se pudo cargar: ' + esc(msg) + '</div>'; }

  function uniqueUpper(arr) {
    var seen = {}, out = [];
    (arr || []).forEach(function (x) {
      var k = norm(x);
      if (k && !seen[k]) { seen[k] = true; out.push(k); }
    });
    return out;
  }

  function cfgToast(msg, isErr) {
    var old = byId('cfg-hub-toast'); if (old) old.remove();
    var t = document.createElement('div');
    t.id = 'cfg-hub-toast';
    t.innerHTML = '<i class="fa-solid ' + (isErr ? 'fa-triangle-exclamation' : 'fa-circle-check') + '" style="margin-right:7px;"></i>' + esc(msg);
    t.style.cssText = 'position:fixed;right:24px;bottom:24px;z-index:10050;padding:11px 18px;border-radius:10px;' +
      'font-size:12.5px;font-weight:600;color:#fff;box-shadow:0 10px 28px rgba(0,0,0,.4);max-width:460px;line-height:1.4;' +
      'background:' + (isErr ? 'var(--danger,#ef4444)' : 'var(--brand-500,#2563eb)') + ';';
    document.body.appendChild(t);
    setTimeout(function () { if (t.parentNode) t.remove(); }, 3400);
  }

  function showInlineBanner(elId, text, ok) {
    var m = byId(elId);
    if (!m) return;
    m.textContent = text;
    m.style.display = '';
    m.style.background = ok ? 'rgba(16,185,129,0.12)' : 'rgba(239,68,68,0.12)';
    m.style.color      = ok ? 'var(--success)'        : 'var(--danger)';
    m.style.border     = '1px solid ' + (ok ? 'rgba(16,185,129,0.3)' : 'rgba(239,68,68,0.3)');
    setTimeout(function () { m.style.display = 'none'; }, 4000);
  }

  /* ───────────────────────── Estilos Compartidos (Acordeón en Cascada + Cajones) ───────────────────────── */
  function ensureAccordionStyles() {
    var st = byId('calebsys-fd-accordion-styles');
    var isNew = !st;
    if (isNew) {
      st = document.createElement('style');
      st.id = 'calebsys-fd-accordion-styles';
    }
    st.textContent = [
      '.fd-wrap { background: var(--bg-card, #0f172a); border: 1px solid var(--border, #1e293b); border-radius: 14px; padding: 16px 18px; margin-bottom: 14px; transition: border-color .18s; }',
      '.fd-wrap.collapsed { padding: 12px 18px; border-color: rgba(6, 182, 212, .35); }',
      '.fd-header { display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 12px; padding-bottom: 14px; margin-bottom: 14px; border-bottom: 1px solid var(--border, #1e293b); }',
      '.fd-wrap.collapsed .fd-header { padding-bottom: 0; margin-bottom: 0; border-bottom: none; }',
      '.fd-wrap.collapsed .fd-acc-list { display: none; }',
      '.fd-header-left { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; cursor: pointer; user-select: none; padding: 5px 10px; margin: -5px -10px; border-radius: 9px; transition: background .15s; }',
      '.fd-header-left:hover { background: rgba(6, 182, 212, .1); }',
      '.fd-main-arrow { font-size: 11px; color: #06b6d4; width: 16px; display: inline-flex; align-items: center; justify-content: center; font-weight: 900; transition: transform .15s; }',
      '.fd-header-title { font-size: 14px; font-weight: 800; letter-spacing: .3px; text-transform: uppercase; color: var(--text-primary, #f8fafc); display: flex; align-items: center; gap: 8px; margin: 0; }',
      '.fd-header-title i { color: #06b6d4; font-size: 15px; }',
      '.fd-badge-pill { font-size: 11px; font-weight: 700; padding: 2px 9px; border-radius: 999px; background: rgba(6, 182, 212, .12); color: #06b6d4; border: 1px solid rgba(6, 182, 212, .3); }',
      '.fd-collapse-hint { font-size: 10.5px; font-weight: 600; color: var(--text-muted, #64748b); display: inline-flex; align-items: center; gap: 4px; }',
      '.fd-header-left:hover .fd-collapse-hint { color: #06b6d4; }',
      '.fd-header-right { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }',
      '.fd-inp { height: 34px; min-width: 240px; padding: 0 12px; font-size: 12.5px; font-weight: 600; color: var(--text-primary, #f8fafc); background: var(--bg-card-2, #1e293b); border: 1px solid var(--border, #334155); border-radius: 9px; outline: none; transition: border-color .15s, box-shadow .15s; }',
      '.fd-inp:focus { border-color: #06b6d4; box-shadow: 0 0 0 2px rgba(6, 182, 212, .2); }',
      '.fd-btn-add { height: 34px; padding: 0 13px; border-radius: 9px; border: 1px solid rgba(6, 182, 212, .45); background: linear-gradient(135deg, #0284c7, #06b6d4); color: #fff; font-size: 12px; font-weight: 700; cursor: pointer; display: inline-flex; align-items: center; gap: 6px; transition: filter .15s, transform .1s; }',
      '.fd-btn-add:hover { filter: brightness(1.08); transform: translateY(-1px); }',
      '.fd-kbd { font-size: 10px; font-weight: 800; padding: 1px 5px; border-radius: 4px; background: rgba(0,0,0,.25); color: #e0f2fe; font-family: monospace; }',
      '.fd-acc-list { display: flex; flex-direction: column; gap: 8px; }',
      '.fd-fam-card { border: 1px solid var(--border, #1e293b); border-radius: 11px; background: var(--bg-card-2, rgba(30, 41, 59, .45)); overflow: hidden; transition: border-color .18s, box-shadow .18s, background .18s; }',
      '.fd-fam-card:hover { border-color: rgba(59, 130, 246, .45); }',
      '.fd-fam-card.open { border: 1.5px solid #06b6d4; box-shadow: 0 0 0 1px rgba(6, 182, 212, .25), 0 8px 24px rgba(6, 182, 212, .12); background: var(--bg-card, #0f172a); }',
      '.fd-fam-bar { display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 10px 14px; cursor: pointer; user-select: none; }',
      '.fd-fam-card.open .fd-fam-bar { background: linear-gradient(90deg, rgba(6, 182, 212, .12), rgba(59, 130, 246, .04)); border-bottom: 1px solid rgba(6, 182, 212, .25); }',
      '.fd-fam-left { display: flex; align-items: center; gap: 10px; min-width: 0; flex: 1; }',
      '.fd-fam-arrow { width: 18px; font-size: 11px; color: var(--text-muted, #94a3b8); transition: color .15s; display: inline-flex; align-items: center; justify-content: center; }',
      '.fd-fam-card.open .fd-fam-arrow { color: #06b6d4; font-weight: 900; }',
      '.fd-fam-title { font-size: 13px; font-weight: 800; color: var(--text-primary, #f8fafc); letter-spacing: .3px; }',
      '.fd-fam-card.open .fd-fam-title { color: #06b6d4; }',
      '.fd-fam-count { font-size: 11.5px; font-weight: 600; color: var(--text-secondary, #94a3b8); }',
      '.fd-fam-art { font-size: 10.5px; font-weight: 700; padding: 1px 8px; border-radius: 999px; background: rgba(16, 185, 129, .14); color: #10b981; border: 1px solid rgba(16, 185, 129, .3); }',
      '.fd-fam-right { display: flex; align-items: center; gap: 6px; }',
      '.fd-fam-plus { width: 28px; height: 26px; border-radius: 7px; border: 1px solid rgba(6, 182, 212, .35); background: rgba(6, 182, 212, .12); color: #06b6d4; font-size: 12px; font-weight: 800; cursor: pointer; display: inline-flex; align-items: center; justify-content: center; transition: all .15s; }',
      '.fd-fam-plus:hover { background: #06b6d4; color: #fff; }',
      '.fd-fam-del { width: 28px; height: 26px; border-radius: 7px; border: 1px solid transparent; background: transparent; color: var(--text-muted, #64748b); font-size: 12px; cursor: pointer; display: inline-flex; align-items: center; justify-content: center; transition: all .15s; }',
      '.fd-fam-del:hover { background: rgba(239, 68, 68, .15); color: #ef4444; border-color: rgba(239, 68, 68, .3); }',
      '.fd-fam-del.locked { opacity: .55; cursor: not-allowed; }',
      '.fd-fam-body { display: none; padding: 12px 14px 14px; }',
      '.fd-fam-card.open .fd-fam-body { display: block; }',
      '.fd-depto-toolbar { display: flex; align-items: center; justify-content: space-between; gap: 10px; flex-wrap: wrap; margin-bottom: 10px; }',
      '.fd-search-wrap { position: relative; flex: 1; min-width: 210px; }',
      '.fd-search-wrap i { position: absolute; left: 11px; top: 50%; transform: translateY(-50%); font-size: 12px; color: var(--text-muted, #64748b); pointer-events: none; }',
      '.fd-search-inp { width: 100%; height: 32px; padding: 0 10px 0 32px; font-size: 12px; color: var(--text-primary, #f8fafc); background: var(--bg-card-2, #1e293b); border: 1px solid var(--border, #334155); border-radius: 8px; outline: none; }',
      '.fd-search-inp:focus { border-color: #06b6d4; }',
      '.fd-depto-add-wrap { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }',
      '.fd-depto-inp { height: 32px; min-width: 210px; padding: 0 10px; font-size: 12px; font-weight: 600; color: var(--text-primary, #f8fafc); background: var(--bg-card-2, #1e293b); border: 1px solid var(--border, #334155); border-radius: 8px; outline: none; }',
      '.fd-depto-inp:focus { border-color: #06b6d4; }',
      '.fd-depto-scroll { max-height: 280px; overflow-y: auto; border: 1px solid var(--border, #1e293b); border-radius: 9px; background: var(--bg-card-2, rgba(15, 23, 42, .5)); padding: 4px; }',
      '.fd-depto-scroll::-webkit-scrollbar { width: 7px; }',
      '.fd-depto-scroll::-webkit-scrollbar-track { background: rgba(15, 23, 42, .25); border-radius: 6px; }',
      '.fd-depto-scroll::-webkit-scrollbar-thumb { background: rgba(6, 182, 212, .45); border-radius: 6px; }',
      '.fd-depto-scroll::-webkit-scrollbar-thumb:hover { background: #06b6d4; }',
      '.fd-depto-row { display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 7px 10px; border-radius: 7px; font-size: 12.5px; transition: background .12s; }',
      '.fd-depto-row:hover { background: rgba(59, 130, 246, .09); }',
      '.fd-depto-row + .fd-depto-row { border-top: 1px solid rgba(148, 163, 184, .1); }',
      '.fd-depto-row-left { display: flex; align-items: center; gap: 9px; min-width: 0; }',
      '.fd-depto-num { font-size: 11px; font-weight: 700; font-family: monospace; color: var(--text-muted, #64748b); min-width: 24px; }',
      '.fd-depto-name { font-weight: 700; color: var(--text-primary, #f1f5f9); letter-spacing: .2px; }',
      '.fd-depto-row-right { display: flex; align-items: center; gap: 8px; flex-shrink: 0; }',
      '.fd-depto-art { font-size: 11px; font-weight: 600; padding: 2px 8px; border-radius: 999px; background: rgba(148, 163, 184, .12); color: var(--text-secondary, #94a3b8); }',
      '.fd-depto-art.has-art { background: rgba(16, 185, 129, .14); color: #10b981; border: 1px solid rgba(16, 185, 129, .3); font-weight: 700; }',
      '.fd-depto-del { width: 25px; height: 25px; border-radius: 6px; border: 1px solid transparent; background: transparent; color: var(--text-muted, #64748b); cursor: pointer; display: inline-flex; align-items: center; justify-content: center; font-size: 11.5px; opacity: .65; transition: all .15s; }',
      '.fd-depto-row:hover .fd-depto-del { opacity: 1; }',
      '.fd-depto-del:hover { background: rgba(239, 68, 68, .16); color: #ef4444; border-color: rgba(239, 68, 68, .3); }',
      '.fd-depto-del.locked { opacity: .45; cursor: not-allowed; }',
      '.fd-depto-del.locked:hover { background: rgba(245, 158, 11, .16); color: #f59e0b; border-color: rgba(245, 158, 11, .35); }',
      '.cfg-drawers-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; margin-top: 14px; margin-bottom: 14px; align-items: start; }',
      '.cfg-drawer { background: var(--bg-card, #0f172a); border: 1px solid var(--border, #1e293b); border-radius: 12px; overflow: hidden; transition: border-color .18s, box-shadow .18s; }',
      '.cfg-drawer.open { border: 1.5px solid #06b6d4; box-shadow: 0 0 0 1px rgba(6, 182, 212, .28), 0 8px 26px rgba(6, 182, 212, .14); }',
      '.cfg-drawer-head { display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 12px 15px; cursor: pointer; user-select: none; background: var(--bg-card, #0f172a); transition: background .15s; }',
      '.cfg-drawer.open .cfg-drawer-head { background: linear-gradient(90deg, rgba(6, 182, 212, .12), rgba(59, 130, 246, .04)); }',
      '.cfg-drawer-head:hover { background: var(--bg-card-2, #1e293b); }',
      '.cfg-drawer-title { display: flex; align-items: center; gap: 8px; font-size: 12.5px; font-weight: 800; letter-spacing: .4px; text-transform: uppercase; color: var(--text-primary, #f8fafc); }',
      '.cfg-drawer-title i { color: #06b6d4; }',
      '.cfg-marca-count-badge { font-size: 11.5px; font-weight: 800; padding: 1px 8px; border-radius: 999px; background: rgba(248, 250, 252, .1); color: #f8fafc; border: 1px solid rgba(248, 250, 252, .2); }',
      '.cfg-drawer-arrow { font-size: 11px; color: var(--text-muted, #94a3b8); transition: transform .15s, color .15s; }',
      '.cfg-drawer.open .cfg-drawer-arrow { color: #06b6d4; }',
      '.cfg-drawer-body { display: none; padding: 12px 15px 15px; border-top: 1px solid var(--border, #1e293b); }',
      '.cfg-drawer.open .cfg-drawer-body { display: block; }',
      '.cfg-marca-add-bar { display: flex; align-items: center; gap: 8px; margin-bottom: 10px; }',
      '.cfg-marca-inp { flex: 1; height: 34px; padding: 0 12px; font-size: 12.5px; font-weight: 600; color: var(--text-primary, #f8fafc); background: var(--bg-card-2, #1e293b); border: 1px solid var(--border, #334155); border-radius: 8px; outline: none; transition: border-color .15s, box-shadow .15s; }',
      '.cfg-marca-inp:focus { border-color: #06b6d4; box-shadow: 0 0 0 2px rgba(6, 182, 212, .22); }',
      '.cfg-marca-btn-add { height: 34px; padding: 0 14px; border-radius: 8px; border: 1px solid rgba(59, 130, 246, .55); background: linear-gradient(135deg, #2563eb, #0ea5e9); color: #fff; font-size: 12px; font-weight: 700; cursor: pointer; display: inline-flex; align-items: center; gap: 6px; white-space: nowrap; transition: filter .15s, transform .1s; }',
      '.cfg-marca-btn-add:hover { filter: brightness(1.1); transform: translateY(-1px); }',
      '.cfg-marca-scroll { max-height: 320px; overflow-y: auto; border: 1px solid var(--border, #1e293b); border-radius: 9px; background: var(--bg-card-2, rgba(15, 23, 42, .55)); }',
      '.cfg-marca-scroll::-webkit-scrollbar { width: 6px; }',
      '.cfg-marca-scroll::-webkit-scrollbar-track { background: rgba(15, 23, 42, .3); border-radius: 6px; }',
      '.cfg-marca-scroll::-webkit-scrollbar-thumb { background: rgba(6, 182, 212, .45); border-radius: 6px; }',
      '.cfg-marca-scroll::-webkit-scrollbar-thumb:hover { background: #06b6d4; }',
      '.cfg-marca-row { display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 7px 11px; background: rgba(15, 23, 42, .45); border-bottom: 1px solid rgba(148, 163, 184, .11); font-size: 12.5px; transition: background .14s; }',
      '.cfg-marca-row:last-child { border-bottom: none; }',
      '.cfg-marca-row:hover { background: rgba(59, 130, 246, .1); }',
      '.cfg-marca-row.highlight-dup { background: rgba(6, 182, 212, .24) !important; box-shadow: inset 3px 0 0 #06b6d4; }',
      '.cfg-marca-left { display: flex; align-items: baseline; gap: 7px; min-width: 0; flex: 1; flex-wrap: wrap; }',
      '.cfg-marca-name { font-weight: 700; color: var(--text-primary, #f8fafc); letter-spacing: .25px; text-transform: uppercase; }',
      '.cfg-marca-art { font-size: 11.5px; font-weight: 500; color: var(--text-secondary, #64748b); }',
      '.cfg-marca-art.has-art { color: #7dd3fc; opacity: .85; }',
      '.cfg-iva-def-badge { font-size: 10px; font-weight: 800; padding: 1px 7px; border-radius: 999px; background: rgba(16, 185, 129, .16); color: #10b981; border: 1px solid rgba(16, 185, 129, .35); text-transform: uppercase; letter-spacing: .3px; }',
      '.cfg-marca-actions { display: flex; align-items: center; gap: 5px; flex-shrink: 0; }',
      '.cfg-marca-btn { width: 26px; height: 26px; border-radius: 6px; border: 1px solid var(--border, #334155); background: var(--bg-card, #0f172a); color: var(--text-secondary, #94a3b8); font-size: 11.5px; cursor: pointer; display: inline-flex; align-items: center; justify-content: center; transition: all .14s; }',
      '.cfg-marca-btn.star-def { color: #94a3b8; }',
      '.cfg-marca-btn.star-def.active, .cfg-marca-btn.star-def:hover { border-color: #10b981; color: #10b981; background: rgba(16, 185, 129, .12); }',
      '.cfg-marca-btn.edit:hover { border-color: #38bdf8; color: #38bdf8; background: rgba(56, 189, 248, .12); }',
      '.cfg-marca-btn.del-active { border-color: rgba(239, 68, 68, .35); color: #ef4444; background: rgba(239, 68, 68, .1); }',
      '.cfg-marca-btn.del-active:hover { background: #ef4444; color: #fff; border-color: #ef4444; }',
      '.cfg-marca-btn.del-locked { opacity: .45; cursor: not-allowed; border-color: rgba(148, 163, 184, .2); color: var(--text-muted, #64748b); background: rgba(15, 23, 42, .4); }',
      '.cfg-marca-btn.del-locked:hover { border-color: rgba(245, 158, 11, .4); color: #f59e0b; opacity: .8; }',
      '.cfg-marca-edit-wrap { display: flex; align-items: center; gap: 6px; width: 100%; }',
      '.cfg-marca-edit-inp { flex: 1; height: 28px; padding: 0 9px; font-size: 12px; font-weight: 700; color: var(--text-primary, #f8fafc); background: var(--bg-card, #0f172a); border: 1px solid #06b6d4; border-radius: 6px; outline: none; text-transform: uppercase; }',
      '.cfg-marca-footer { margin-top: 8px; display: flex; align-items: center; justify-content: space-between; font-size: 11.5px; color: var(--text-muted, #64748b); padding: 0 2px; }',
      '@media (max-width: 900px) { .cfg-drawers-grid { grid-template-columns: 1fr; } }'
    ].join('\n');
    if (isNew) document.head.appendChild(st);
  }

  /* ───────────────────────── Single Source of Truth (Store Reactivo) ───────────────────────── */
  function readLocalCache() {
    try {
      var raw = localStorage.getItem(LS_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (e) { return null; }
  }

  function writeLocalCache() {
    try {
      localStorage.setItem(LS_KEY, JSON.stringify({
        familiasTree: _famTree,
        marcas: _catLists.marcas,
        presentaciones: _catLists.presentaciones,
        unidades: _catLists.unidades,
        ivas: _catLists.ivas,
        openFam: _openFam,
        ts: Date.now()
      }));
    } catch (e) {}
  }

  function loadProductList() {
    if (_prods) return Promise.resolve(_prods);
    return get('/api/products/search?limit=500').then(function (d) {
      _prods = Array.isArray(d) ? d : (d.items || d.products || d.data || []);
      return _prods;
    }).catch(function () {
      _prods = _prods || [];
      return _prods;
    });
  }

  function loadParams() {
    if (_params) return Promise.resolve(_params);
    return get('/api/admin/config').then(function (d) {
      _params = d || {};
      return _params;
    }).catch(function () {
      _params = _params || {};
      return _params;
    });
  }

  function loadBranches() {
    if (_branches && _branches.length) return Promise.resolve(_branches);
    return get('/api/branches').then(function (b) {
      if (Array.isArray(b) && b.length) {
        _branches = b.map(function (x) {
          return {
            id: String(x.id || x.code || norm(x.name) || 'MATRIZ'),
            name: norm(x.name || x.id || 'MATRIZ'),
            status: x.status || 'ACTIVE',
            is_main: !!x.is_main
          };
        });
      } else {
        _branches = [
          { id: 'MATRIZ', name: 'MATRIZ', status: 'ACTIVE', is_main: true },
          { id: 'SUC-MAG2', name: 'MADERAS Y MATERIALES MAGDALENO 2', status: 'ACTIVE', is_main: false }
        ];
      }
      return _branches;
    }).catch(function () {
      if (!_branches || !_branches.length) {
        _branches = [
          { id: 'MATRIZ', name: 'MATRIZ', status: 'ACTIVE', is_main: true },
          { id: 'SUC-MAG2', name: 'MADERAS Y MATERIALES MAGDALENO 2', status: 'ACTIVE', is_main: false }
        ];
      }
      return _branches;
    });
  }

  function ensureStoreLoaded() {
    ensureAccordionStyles();
    if (_initialized && Object.keys(_famTree).length > 0) {
      return Promise.all([loadProductList(), loadParams(), loadBranches()]).then(function (r) {
        initPriceScalesState(r[1] || _params || {}, r[2] || _branches || []);
        return getStoreSnapshot();
      });
    }
    return Promise.all([loadProductList(), loadParams(), loadBranches()]).then(function (r) {
      initCatalogState(r[0] || [], r[1] || {}, r[2] || []);
      return getStoreSnapshot();
    });
  }

  function getMainMatrizBranch(branchesArg) {
    var list = (branchesArg && branchesArg.length) ? branchesArg : ((_branches && _branches.length) ? _branches : [
      { id: 'MATRIZ', name: 'MATRIZ', status: 'ACTIVE', is_main: true }
    ]);
    var main = list.filter(function (b) {
      return !!(b && (b.is_main || norm(b.id) === 'MATRIZ' || norm(b.name) === 'MATRIZ'));
    })[0] || list[0] || { id: 'MATRIZ', name: 'MATRIZ', status: 'ACTIVE', is_main: true };
    var mId = String(main.id || 'MATRIZ').trim().toUpperCase();
    var mName = norm(main.name || mId || 'MATRIZ') || 'MATRIZ';
    return {
      id: mId,
      name: mName,
      is_main: true,
      displayLabel: (mName && mName !== 'MATRIZ') ? ('MATRIZ (' + mName + ')') : 'MATRIZ'
    };
  }
  global.getMainMatrizBranch = getMainMatrizBranch;

  function isMainMatrizBranchKey(val, branchesArg) {
    var v = norm(val || 'MATRIZ');
    if (!v || v === 'MATRIZ') return true;
    var main = getMainMatrizBranch(branchesArg);
    return v === norm(main.id) || v === norm(main.name);
  }
  global.isMainMatrizBranchKey = isMainMatrizBranchKey;

  function getSecondaryBranchesList(branchesArg) {
    var list = (branchesArg && branchesArg.length) ? branchesArg : ((_branches && _branches.length) ? _branches : [
      { id: 'MATRIZ', name: 'MADERAS Y MATERIALES MAGDALENO', status: 'ACTIVE', is_main: true },
      { id: 'SUC-MAG2', name: 'MADERAS Y MATERIALES MAGDALENO 2', status: 'ACTIVE', is_main: false }
    ]);
    return list.filter(function (b) {
      if (!b || b.status === 'INACTIVE') return false;
      return !b.is_main && !isMainMatrizBranchKey(b.id, list) && !isMainMatrizBranchKey(b.name, list);
    });
  }
  global.getSecondaryBranchesList = getSecondaryBranchesList;

  function initPriceScalesState(cfg, branches) {
    var savedScales = (cfg && Array.isArray(cfg['catalog.price_scales']) && cfg['catalog.price_scales'].length) ? cfg['catalog.price_scales'] : null;
    if (!savedScales) {
      try { savedScales = JSON.parse(localStorage.getItem(LS_SCALES_KEY) || 'null'); } catch (e) {}
    }
    if (Array.isArray(savedScales) && savedScales.length) {
      _priceScales = savedScales.map(function (s, idx) {
        var nm = norm(s.name || s.scale_name || ('ESCALA ' + (idx + 1)));
        return {
          id: s.id || ('esc-' + (idx + 1)),
          name: nm,
          margen_ideal: num(s.margen_ideal != null ? s.margen_ideal : 20),
          oferta: num(s.oferta != null ? s.oferta : 0),
          comision: num(s.comision != null ? s.comision : 0),
          active: s.active !== false,
          locked: nm === 'PRECIO DE LISTA' || !!s.locked
        };
      });
    } else {
      _priceScales = DEFAULT_PRICE_SCALES.map(function (s) { return Object.assign({}, s); });
      putCfg('catalog.price_scales', _priceScales).catch(function () {});
    }
    try { localStorage.setItem(LS_SCALES_KEY, JSON.stringify(_priceScales)); } catch (e) {}

    var savedBranchScales = (cfg && Array.isArray(cfg['catalog.branch_price_scales']) && cfg['catalog.branch_price_scales'].length) ? cfg['catalog.branch_price_scales'] : null;
    if (!savedBranchScales) {
      try { savedBranchScales = JSON.parse(localStorage.getItem(LS_BRANCH_SCALES_KEY) || 'null'); } catch (e) {}
    }
    var branchList = (branches && branches.length) ? branches : ((_branches && _branches.length) ? _branches : [
      { id: 'MATRIZ', name: 'MATRIZ', status: 'ACTIVE', is_main: true },
      { id: 'SUC-MAG2', name: 'MADERAS Y MATERIALES MAGDALENO 2', status: 'ACTIVE', is_main: false }
    ]);
    var secondaryBranches = getSecondaryBranchesList(branchList);

    var validScaleNamesMap = {};
    (_priceScales || []).forEach(function (sc, idx) {
      validScaleNamesMap[norm(sc.name || sc.scale_name)] = idx + 1;
    });

    if (Array.isArray(savedBranchScales) && savedBranchScales.length) {
      _branchPriceScales = savedBranchScales.filter(function (bs) {
        if (!bs || typeof bs !== 'object') return false;
        if (isMainMatrizBranchKey(bs.branch_id, branchList) || isMainMatrizBranchKey(bs.branch_name, branchList)) return false;
        var sNm = norm(bs.scale_name || '');
        if (!validScaleNamesMap[sNm]) return false;
        if (secondaryBranches.length > 0) {
          var bNm = norm(bs.branch_name || bs.branch_id);
          var bId = String(bs.branch_id || '').trim().toUpperCase();
          return secondaryBranches.some(function (sb) {
            return String(sb.id).trim().toUpperCase() === bId || norm(sb.name) === bNm;
          });
        }
        return true;
      }).map(function (bs, idx) {
        return {
          id: bs.id || ('besc-' + (idx + 1)),
          branch_id: String(bs.branch_id || ''),
          branch_name: norm(bs.branch_name || bs.branch_id || ''),
          scale_name: norm(bs.scale_name || 'PRECIO DE LISTA'),
          margen_ideal: num(bs.margen_ideal != null ? bs.margen_ideal : 25),
          sobreprecio_suc: num(bs.sobreprecio_suc != null ? bs.sobreprecio_suc : 0),
          comision: num(bs.comision != null ? bs.comision : 0),
          active: bs.active !== false
        };
      });
    } else {
      _branchPriceScales = [];
    }

    // Asegurar que cada sucursal secundaria registrada tenga las escalas generales activas por defecto
    var seq = _branchPriceScales.length + 1;
    var addedAnyBranchScale = false;
    secondaryBranches.forEach(function (br) {
      var bId = String(br.id || br.name);
      var bName = norm(br.name || br.id);
      var existingForBranch = _branchPriceScales.filter(function (bs) {
        return String(bs.branch_id).toUpperCase() === bId.toUpperCase() || norm(bs.branch_name) === bName;
      });
      var defaultExtraSuc = existingForBranch.length > 0 ? num(existingForBranch[0].sobreprecio_suc) : 0.00;
      (_priceScales || []).forEach(function (sc) {
        if (sc.active === false) return;
        var scName = norm(sc.name || sc.scale_name);
        var exists = existingForBranch.some(function (bs) {
          return norm(bs.scale_name) === scName;
        });
        if (!exists && scName) {
          _branchPriceScales.push({
            id: 'besc-' + (seq++),
            branch_id: bId,
            branch_name: bName,
            scale_name: scName,
            margen_ideal: num(sc.margen_ideal) - num(sc.oferta),
            sobreprecio_suc: defaultExtraSuc,
            comision: num(sc.comision),
            active: true
          });
          addedAnyBranchScale = true;
        }
      });
    });

    try { localStorage.setItem(LS_BRANCH_SCALES_KEY, JSON.stringify(_branchPriceScales)); } catch (e) {}
    if (addedAnyBranchScale || !savedBranchScales || (Array.isArray(savedBranchScales) && savedBranchScales.length !== _branchPriceScales.length)) {
      putCfg('catalog.branch_price_scales', _branchPriceScales).catch(function () {});
    }
  }

  function initCatalogState(items, cfg, branches) {
    var local = readLocalCache();
    var savedTree = (cfg && cfg['catalog.familias_deptos']) || (local && local.familiasTree);
    var tree = {};
    var needsSeedSave = false;

    if (savedTree && typeof savedTree === 'object' && !Array.isArray(savedTree) && Object.keys(savedTree).length > 0) {
      Object.keys(savedTree).forEach(function (f) {
        var fk = norm(f);
        if (fk) tree[fk] = uniqueUpper(Array.isArray(savedTree[f]) ? savedTree[f] : []);
      });
    } else {
      Object.keys(DEFAULT_FAM_TREE).forEach(function (f) {
        tree[norm(f)] = uniqueUpper(DEFAULT_FAM_TREE[f]);
      });
      needsSeedSave = true;
    }

    (items || []).forEach(function (p) {
      var f = norm(meta(p).familia);
      var d = norm(meta(p).departamento);
      if (f && !tree[f]) tree[f] = [];
      if (f && d && tree[f].indexOf(d) < 0) tree[f].push(d);
      else if (!f && d) {
        if (!tree['GENERAL']) tree['GENERAL'] = [];
        if (tree['GENERAL'].indexOf(d) < 0) tree['GENERAL'].push(d);
      }
    });

    _famTree = tree;
    var fams = Object.keys(_famTree);
    if (!_openFam || !_famTree[_openFam]) {
      _openFam = fams.length ? fams[0] : '';
    }

    var prodMarcas = (items || []).map(function (p) { return meta(p).marca || meta(p).brand; }).filter(Boolean);
    var prodUnidades = (items || []).map(function (p) { return p.unit || p.sale_unit; }).filter(Boolean);
    var prodPres = (items || []).map(function (p) { return p.purchase_unit; }).filter(Boolean);

    var savedMarcas = (cfg && Array.isArray(cfg['catalog.marcas']) && cfg['catalog.marcas'].length) ? cfg['catalog.marcas'] :
      (local && Array.isArray(local.marcas) && local.marcas.length ? local.marcas : DEFAULT_MARCAS);
    _catLists.marcas = uniqueUpper(DEFAULT_MARCAS.concat(savedMarcas).concat(prodMarcas));

    var savedUnidades = (cfg && Array.isArray(cfg['catalog.unidades']) && cfg['catalog.unidades'].length) ? cfg['catalog.unidades'] :
      (local && Array.isArray(local.unidades) && local.unidades.length ? local.unidades : DEFAULT_UNIDADES);
    _catLists.unidades = uniqueUpper(DEFAULT_UNIDADES.concat(savedUnidades).concat(prodUnidades));

    var savedPres = (cfg && Array.isArray(cfg['catalog.presentaciones']) && cfg['catalog.presentaciones'].length) ? cfg['catalog.presentaciones'] :
      (local && Array.isArray(local.presentaciones) && local.presentaciones.length ? local.presentaciones : DEFAULT_PRESENTACIONES);
    _catLists.presentaciones = uniqueUpper(DEFAULT_PRESENTACIONES.concat(savedPres).concat(prodPres));

    var savedIvas = (cfg && Array.isArray(cfg['catalog.ivas']) && cfg['catalog.ivas'].length) ? cfg['catalog.ivas'] :
      (local && Array.isArray(local.ivas) && local.ivas.length ? local.ivas : DEFAULT_IVAS);
    _catLists.ivas = uniqueUpper(DEFAULT_IVAS.concat(savedIvas));

    initMensajeriaState(cfg);
    initPrintersState(cfg);
    initPriceScalesState(cfg, branches);

    _initialized = true;
    broadcastCatalogUpdate();

    if (needsSeedSave) {
      persistFamiliasTree(true);
      putCfg('catalog.marcas', _catLists.marcas).catch(function () {});
      putCfg('catalog.unidades', _catLists.unidades).catch(function () {});
      putCfg('catalog.presentaciones', _catLists.presentaciones).catch(function () {});
      putCfg('catalog.ivas', _catLists.ivas).catch(function () {});
    }
  }

  function getStoreSnapshot() {
    var allDeptos = [];
    Object.keys(_famTree).forEach(function (f) {
      (_famTree[f] || []).forEach(function (d) {
        if (allDeptos.indexOf(d) < 0) allDeptos.push(d);
      });
    });
    var defIva = (_params && _params['params.iva_porcentaje'] != null) ? num(_params['params.iva_porcentaje']) : 16;
    var satMapCopy = Object.assign({}, SAT_UNIT_DEFAULT_MAP, _satUnitCustomMap || {});
    return {
      familiasTree: _famTree,
      familias: Object.keys(_famTree),
      departamentos: allDeptos,
      marcas: _catLists.marcas.slice(),
      unidades: _catLists.unidades.slice(),
      presentaciones: _catLists.presentaciones.slice(),
      satUnitMap: satMapCopy,
      resolveSatUnidad: resolveSatClaveUnidad,
      ivas: _catLists.ivas.slice(),
      defaultIva: defIva,
      openFam: _openFam,
      printers: _printers.slice(),
      priceScales: _priceScales.slice(),
      branchPriceScales: _branchPriceScales.slice(),
      branches: (_branches || []).slice()
    };
  }

  function broadcastCatalogUpdate() {
    var snap = getStoreSnapshot();
    global.__calebsysCatalogs = snap;
    writeLocalCache();
    try {
      global.dispatchEvent(new CustomEvent('calebsys:catalog-updated', { detail: snap }));
    } catch (e) {}
  }

  function persistFamiliasTree(silent) {
    broadcastCatalogUpdate();
    var snap = global.__calebsysCatalogs;
    return Promise.all([
      putCfg('catalog.familias_deptos', _famTree),
      putCfg('catalog.familias', snap.familias),
      putCfg('catalog.departamentos', snap.departamentos)
    ]).then(function () {
      refreshAllCatalogViews();
    }).catch(function (e) {
      refreshAllCatalogViews();
      if (!silent) cfgToast('Guardado local (error API: ' + e.message + ')', true);
    });
  }

  /* ───────────────────────── [F3] REDES SOCIALES: Mensajería (Facebook, Instagram, Correo, SMS) ───────────────────────── */
  function initMensajeriaState(cfg) {
    var saved = (cfg && cfg['integrations.mensajeria']) || null;
    if (!saved) {
      try { saved = JSON.parse(localStorage.getItem(LS_MSG_KEY) || 'null'); } catch (e) {}
    }
    _msgConfig = {};
    MSG_CHANNELS.forEach(function (ch) {
      var c = (saved && saved[ch]) || {};
      _msgConfig[ch] = {
        enabled: !!c.enabled,
        provider: c.provider || 'chatwoot',
        url: c.url || '',
        account_id: c.account_id || '',
        inbox_id: c.inbox_id || '',
        token: c.token || ''
      };
    });
    paintMensajeriaForm();
  }

  function paintChannelBadge(ch, enabled) {
    var b = byId('msg-badge-' + ch);
    if (!b) return;
    b.textContent = enabled ? 'habilitado' : 'deshabilitado';
    b.className = 'msg-ch-badge ' + (enabled ? 'on' : 'off');
  }

  function paintMensajeriaForm() {
    MSG_CHANNELS.forEach(function (ch) {
      var c = _msgConfig[ch] || {};
      var enEl = byId('msg-enabled-' + ch); if (enEl) enEl.value = c.enabled ? '1' : '0';
      var prEl = byId('msg-provider-' + ch); if (prEl) prEl.value = c.provider || 'chatwoot';
      var urEl = byId('msg-url-' + ch); if (urEl) urEl.value = c.url || '';
      var acEl = byId('msg-account-' + ch); if (acEl) acEl.value = c.account_id || '';
      var inEl = byId('msg-inbox-' + ch); if (inEl) inEl.value = c.inbox_id || '';
      var tkEl = byId('msg-token-' + ch);
      if (tkEl) {
        tkEl.value = '';
        tkEl.placeholder = c.token ? '•••••• (token guardado)' : 'Token de acceso';
      }
      paintChannelBadge(ch, !!c.enabled);
    });
  }

  global.onMsgChannelStatusChange = function (e) {
    var el = e && e.target;
    if (!el || !el.id) return;
    var ch = el.id.replace('msg-enabled-', '');
    paintChannelBadge(ch, el.value === '1');
  };

  function collectChannelFromForm(ch) {
    var prev = _msgConfig[ch] || {};
    var enEl = byId('msg-enabled-' + ch);
    var prEl = byId('msg-provider-' + ch);
    var urEl = byId('msg-url-' + ch);
    var acEl = byId('msg-account-' + ch);
    var inEl = byId('msg-inbox-' + ch);
    var tkEl = byId('msg-token-' + ch);
    var newTok = tkEl ? tkEl.value.trim() : '';
    return {
      enabled: enEl ? (enEl.value === '1') : !!prev.enabled,
      provider: prEl ? prEl.value : (prev.provider || 'chatwoot'),
      url: urEl ? urEl.value.trim() : (prev.url || ''),
      account_id: acEl ? acEl.value.trim() : (prev.account_id || ''),
      inbox_id: inEl ? inEl.value.trim() : (prev.inbox_id || ''),
      token: newTok || prev.token || ''
    };
  }

  global.probarCanalMensajeria = function (ch) {
    var data = collectChannelFromForm(ch);
    var resEl = byId('msg-test-' + ch);
    if (!resEl) return;
    if (!data.url || !data.account_id || !data.inbox_id || !data.token) {
      resEl.style.color = 'var(--warning)';
      resEl.innerHTML = '<i class="fa-solid fa-triangle-exclamation"></i> Completa URL, Id de cuenta, Id de bandeja y Token para probar.';
      return;
    }
    if (!/^https?:\/\//i.test(data.url)) {
      resEl.style.color = 'var(--danger)';
      resEl.innerHTML = '<i class="fa-solid fa-circle-xmark"></i> La URL del servicio debe iniciar con https:// o http://';
      return;
    }
    resEl.style.color = 'var(--text-secondary)';
    resEl.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i> Verificando conexión con ' + esc(data.provider === 'chatwoot' ? 'Chatwoot' : 'Servicio propio') + '...';
    setTimeout(function () {
      resEl.style.color = 'var(--success)';
      resEl.innerHTML = '<i class="fa-solid fa-circle-check"></i> Parámetros válidos (' + esc(data.url) + ' · Cuenta #' + esc(data.account_id) + ' · Bandeja #' + esc(data.inbox_id) + ').';
    }, 450);
  };

  global.guardarMensajeriaCanales = function () {
    MSG_CHANNELS.forEach(function (ch) {
      _msgConfig[ch] = collectChannelFromForm(ch);
    });
    try { localStorage.setItem(LS_MSG_KEY, JSON.stringify(_msgConfig)); } catch (e) {}
    paintMensajeriaForm();
    putCfg('integrations.mensajeria', _msgConfig).then(function () {
      showInlineBanner('msg-save-msg', 'Configuración de mensajería (Facebook, Instagram, Correo y SMS) guardada correctamente.', true);
      cfgToast('Mensajería guardada correctamente.');
      updateRedesCardSubtitle();
    }).catch(function (e) {
      showInlineBanner('msg-save-msg', 'Guardado local (' + e.message + ')', true);
      cfgToast('Mensajería guardada.');
      updateRedesCardSubtitle();
    });
  };

  function updateRedesCardSubtitle() {
    var activeCount = MSG_CHANNELS.filter(function (ch) { return _msgConfig[ch] && _msgConfig[ch].enabled; }).length;
    var waEnabled = (byId('wa-enabled') && byId('wa-enabled').value === '1');
    var total = activeCount + (waEnabled ? 1 : 0);
    if (total > 0) {
      setCard('whatsapp', total + (total === 1 ? ' canal activo' : ' canales activos') + ' · WhatsApp, FB, IG, Correo, SMS', 'ok');
    } else {
      setCard('whatsapp', 'WhatsApp, Facebook, Instagram, Correo y SMS', 'off');
    }
  }

  /* ───────────────────────── [F9] IMPRESORAS + ASIGNACIÓN POR DOCUMENTO ───────────────────────── */
  function initPrintersState(cfg) {
    var savedList = (cfg && cfg['printers.catalog']) || null;
    if (!Array.isArray(savedList) || !savedList.length) {
      try { savedList = JSON.parse(localStorage.getItem(LS_PRT_KEY) || 'null'); } catch (e) {}
    }
    if (Array.isArray(savedList) && savedList.length) {
      _printers = savedList.slice();
    } else {
      _printers = DEFAULT_PRINTERS.map(function (p) { return Object.assign({}, p); });
      try { localStorage.setItem(LS_PRT_KEY, JSON.stringify(_printers)); } catch (e) {}
      putCfg('printers.catalog', _printers).catch(function () {});
    }

    var savedAsig = null;
    try { savedAsig = JSON.parse(localStorage.getItem(LS_PRT_ASIG_KEY) || 'null'); } catch (e) {}
    if (!savedAsig && cfg && cfg['printers.assignment']) savedAsig = cfg['printers.assignment'];
    if (savedAsig && typeof savedAsig === 'object') {
      _printerAsig = Object.assign({}, _printerAsig, savedAsig);
    }

    renderPrintersSection();
  }

  function renderPrintersSection() {
    var listEl = byId('cfg-printers-list');
    if (listEl) {
      if (!_printers.length) {
        listEl.innerHTML = '<div class="cfg-empty" style="padding:14px;">No hay impresoras dadas de alta. Haz clic en «+ Agregar» para registrar la primera.</div>';
      } else {
        listEl.innerHTML = _printers.map(function (p) {
          var isPdf = (String(p.width || '').toLowerCase().indexOf('carta') >= 0 || String(p.conn || '').toLowerCase().indexOf('pdf') >= 0 || String(p.name || '').toUpperCase().indexOf('PDF') >= 0);
          var ico = isPdf ? 'fa-file-pdf' : 'fa-print';
          var copiesTxt = (p.copies || 1) + ' cop.';
          var metaTxt = esc(p.width || '80mm') + ' · ' + esc(p.conn || 'Sistema') + ' — ' + esc(p.model || 'Impresora') + ' · ' + esc(copiesTxt);
          return '<div class="prt-card" data-prt-id="' + esc(p.id) + '">' +
            '<div class="prt-card-left">' +
              '<div class="prt-ico-wrap"><i class="fa-solid ' + ico + '"></i></div>' +
              '<span class="prt-num-badge" title="Número de impresor en ficha de producto">#' + esc(p.num) + '</span>' +
              '<div class="prt-info">' +
                '<div class="prt-name-row">' +
                  '<span class="prt-name">' + esc(p.name) + '</span>' +
                  '<span class="prt-scope-badge">' + esc(p.scope || 'global') + '</span>' +
                '</div>' +
                '<div class="prt-meta">' + metaTxt + '</div>' +
              '</div>' +
            '</div>' +
            '<div class="prt-actions">' +
              '<button type="button" class="btn btn-secondary btn-sm" title="Editar impresora" data-click="editarImpresora" data-click-arg="' + esc(p.id) + '">✏️</button>' +
              '<button type="button" class="btn btn-secondary btn-sm" title="Eliminar impresora" data-click="eliminarImpresora" data-click-arg="' + esc(p.id) + '">🗑️</button>' +
            '</div>' +
          '</div>';
        }).join('');
      }
    }

    /* Poblar los 6 selectores de asignación por tipo de documento */
    var docFields = [
      { key: 'venta',    id: 'prt-asig-venta' },
      { key: 'cierre',   id: 'prt-asig-cierre' },
      { key: 'remision', id: 'prt-asig-remision' },
      { key: 'cfdi',     id: 'prt-asig-cfdi' },
      { key: 'oc',       id: 'prt-asig-oc' },
      { key: 'etiqueta', id: 'prt-asig-etiqueta' }
    ];
    var optsHtml = '<option value="">— Sin asignar —</option>' + _printers.map(function (p) {
      return '<option value="' + esc(String(p.num)) + '">#' + esc(p.num) + ' · ' + esc(p.name) + ' (' + esc(p.model) + ')</option>';
    }).join('');

    docFields.forEach(function (df) {
      var sel = byId(df.id);
      if (!sel) return;
      sel.innerHTML = optsHtml;
      var cur = String(_printerAsig[df.key] || '');
      var exists = _printers.some(function (p) { return String(p.num) === cur; });
      sel.value = exists ? cur : '';
    });

    setCard('impresoras', _printers.length + (_printers.length === 1 ? ' impresora · Tickets y documentos' : ' impresoras · Tickets y documentos'), _printers.length ? 'ok' : 'off');
  }

  global.abrirModalImpresora = function () {
    var modal = byId('modal-impresora');
    if (!modal) return;
    var title = byId('modal-prt-title');
    if (title) title.innerHTML = '<i class="fa-solid fa-print" style="color:var(--brand-400);margin-right:8px;"></i>Agregar Impresora';
    var editId = byId('prt-edit-id'); if (editId) editId.value = '';
    var nameEl = byId('prt-name'); if (nameEl) nameEl.value = '';
    var widthEl = byId('prt-width'); if (widthEl) widthEl.value = '80mm';
    var connEl = byId('prt-conn'); if (connEl) connEl.value = 'Sistema';
    var modEl = byId('prt-model'); if (modEl) modEl.value = '';
    var copEl = byId('prt-copies'); if (copEl) copEl.value = '1';
    var errEl = byId('prt-error'); if (errEl) errEl.style.display = 'none';
    modal.style.display = 'flex';
    setTimeout(function () { if (nameEl) nameEl.focus(); }, 30);
  };

  global.editarImpresora = function (id) {
    var p = _printers.filter(function (x) { return x.id === id; })[0];
    if (!p) return;
    var modal = byId('modal-impresora');
    if (!modal) return;
    var title = byId('modal-prt-title');
    if (title) title.innerHTML = '<i class="fa-solid fa-pen" style="color:var(--brand-400);margin-right:8px;"></i>Editar Impresora #' + esc(p.num);
    var editId = byId('prt-edit-id'); if (editId) editId.value = p.id;
    var nameEl = byId('prt-name'); if (nameEl) nameEl.value = p.name || '';
    var widthEl = byId('prt-width'); if (widthEl) widthEl.value = p.width || '80mm';
    var connEl = byId('prt-conn'); if (connEl) connEl.value = p.conn || 'Sistema';
    var modEl = byId('prt-model'); if (modEl) modEl.value = p.model || '';
    var copEl = byId('prt-copies'); if (copEl) copEl.value = p.copies || 1;
    var errEl = byId('prt-error'); if (errEl) errEl.style.display = 'none';
    modal.style.display = 'flex';
  };

  global.cerrarModalImpresora = function () {
    var modal = byId('modal-impresora');
    if (modal) modal.style.display = 'none';
  };

  global.guardarImpresoraModal = function () {
    var id = (byId('prt-edit-id') ? byId('prt-edit-id').value : '').trim();
    var name = (byId('prt-name') ? byId('prt-name').value : '').trim();
    var width = (byId('prt-width') ? byId('prt-width').value : '80mm');
    var conn = (byId('prt-conn') ? byId('prt-conn').value : 'Sistema');
    var model = (byId('prt-model') ? byId('prt-model').value : '').trim();
    var copies = Math.max(1, parseInt(byId('prt-copies') ? byId('prt-copies').value : '1', 10) || 1);
    var errEl = byId('prt-error');

    if (!name || !model) {
      if (errEl) {
        errEl.textContent = 'El Nombre/Propósito y el Modelo/Cola en Sistema son obligatorios.';
        errEl.style.display = 'block';
      }
      return;
    }

    if (id) {
      _printers.forEach(function (p) {
        if (p.id === id) {
          p.name = name;
          p.width = width;
          p.conn = conn;
          p.model = model;
          p.copies = copies;
        }
      });
    } else {
      var maxNum = _printers.reduce(function (m, x) { return Math.max(m, num(x.num)); }, 0);
      var nextNum = maxNum > 0 ? (maxNum + 1) : 1;
      _printers.push({
        id: 'prt-' + Date.now(),
        num: nextNum,
        name: name,
        width: width,
        conn: conn,
        model: model,
        copies: copies,
        scope: 'global'
      });
    }

    global.cerrarModalImpresora();
    persistPrinters();
    cfgToast(id ? 'Impresora actualizada correctamente.' : 'Impresora dada de alta correctamente.');
  };

  global.eliminarImpresora = function (id) {
    var p = _printers.filter(function (x) { return x.id === id; })[0];
    if (!p) return;
    _printers = _printers.filter(function (x) { return x.id !== id; });
    persistPrinters();
    cfgToast('Impresora #' + p.num + ' («' + p.name + '») eliminada.');
  };

  function persistPrinters() {
    try { localStorage.setItem(LS_PRT_KEY, JSON.stringify(_printers)); } catch (e) {}
    renderPrintersSection();
    broadcastCatalogUpdate();
    putCfg('printers.catalog', _printers).catch(function () {});
  }

  global.guardarAsignacionImpresoras = function () {
    _printerAsig = {
      venta:    byId('prt-asig-venta')    ? byId('prt-asig-venta').value    : '',
      cierre:   byId('prt-asig-cierre')   ? byId('prt-asig-cierre').value   : '',
      remision: byId('prt-asig-remision') ? byId('prt-asig-remision').value : '',
      cfdi:     byId('prt-asig-cfdi')     ? byId('prt-asig-cfdi').value     : '',
      oc:       byId('prt-asig-oc')       ? byId('prt-asig-oc').value       : '',
      etiqueta: byId('prt-asig-etiqueta') ? byId('prt-asig-etiqueta').value : ''
    };
    try { localStorage.setItem(LS_PRT_ASIG_KEY, JSON.stringify(_printerAsig)); } catch (e) {}
    putCfg('printers.assignment', _printerAsig).then(function () {
      showInlineBanner('prt-asig-msg', 'Asignación de impresoras por tipo de documento guardada en este equipo.', true);
      cfgToast('Asignación de impresoras guardada.');
    }).catch(function () {
      showInlineBanner('prt-asig-msg', 'Asignación de impresoras guardada en este equipo.', true);
      cfgToast('Asignación de impresoras guardada.');
    });
  };

  /* ───────────────────────── Conteo de Artículos y Regla de Integridad ───────────────────────── */
  function getDeptoArticleCount(fam, dep) {
    var fk = norm(fam), dk = norm(dep);
    var count = 0;
    (_prods || []).forEach(function (p) {
      var pf = norm(meta(p).familia);
      var pd = norm(meta(p).departamento);
      if (pd === dk && (!pf || pf === fk)) count++;
    });
    return count;
  }

  function getFamiliaArticleCount(fam) {
    var fk = norm(fam);
    var deptos = _famTree[fk] || [];
    var seenIds = {};
    var count = 0;
    (_prods || []).forEach(function (p, idx) {
      var pf = norm(meta(p).familia);
      var pd = norm(meta(p).departamento);
      var pid = p.id != null ? String(p.id) : ('idx_' + idx);
      if (pf === fk || (!pf && deptos.indexOf(pd) >= 0)) {
        if (!seenIds[pid]) { seenIds[pid] = true; count++; }
      }
    });
    return count;
  }

  /* ───────────────────────── Componente Reutilizable: Acordeón en Cascada Familias/Deptos ───────────────────────── */
  function buildFamiliasDeptosAccordionHtml(ctx) {
    var fams = Object.keys(_famTree);
    if (_openFam && !_famTree[_openFam]) {
      _openFam = fams.length ? fams[0] : '';
    }
    var totalDeptos = 0;
    fams.forEach(function (f) { totalDeptos += (_famTree[f] || []).length; });

    var cardsHtml = fams.length ? fams.map(function (fam) {
      var isOpen = (fam === _openFam);
      var deptos = _famTree[fam] || [];
      var famArtCount = getFamiliaArticleCount(fam);
      var q = norm(_deptoSearch[fam] || '');

      var indexedDeptos = deptos.map(function (d, i) { return { name: d, idx: i + 1 }; }).filter(function (item) {
        return !q || item.name.indexOf(q) >= 0;
      });

      var deptoRowsHtml = indexedDeptos.length ? indexedDeptos.map(function (item) {
        var d = item.name;
        var artCnt = getDeptoArticleCount(fam, d);
        var locked = artCnt > 0;
        var numStr = String(item.idx).padStart(2, '0') + '.';
        var delTitle = locked
          ? 'No se puede eliminar: tiene ' + artCnt + ' artículo(s) asignado(s)'
          : 'Eliminar departamento «' + d + '»';
        return '<div class="fd-depto-row" data-depto-name="' + esc(d) + '">' +
          '<div class="fd-depto-row-left">' +
            '<span class="fd-depto-num">' + numStr + '</span>' +
            '<span class="fd-depto-name">' + esc(d) + '</span>' +
          '</div>' +
          '<div class="fd-depto-row-right">' +
            '<span class="fd-depto-art' + (locked ? ' has-art' : '') + '">' +
              artCnt + (artCnt === 1 ? ' artículo' : ' artículos') +
            '</span>' +
            '<button type="button" class="fd-depto-del' + (locked ? ' locked' : '') + '" ' +
              'title="' + esc(delTitle) + '" ' +
              'data-click="fdDelDepto" data-click-arg="' + esc(fam) + '" data-click-arg2="' + esc(d) + '">' +
              '<i class="fa-solid ' + (locked ? 'fa-lock' : 'fa-trash-can') + '"></i>' +
            '</button>' +
          '</div>' +
        '</div>';
      }).join('') : (
        '<div class="cfg-empty" style="padding:14px 10px;text-align:center;">' +
          (q ? 'Ningún departamento en <b>' + esc(fam) + '</b> coincide con «' + esc(q) + '».'
             : 'La familia <b>' + esc(fam) + '</b> aún no tiene departamentos. Usa el campo superior para agregar.') +
        '</div>'
      );

      var famLocked = famArtCount > 0;
      var famDelTitle = famLocked
        ? 'No se puede eliminar la familia «' + fam + '» porque tiene ' + famArtCount + ' artículo(s) asignado(s)'
        : 'Eliminar familia «' + fam + '»';

      return '<div class="fd-fam-card' + (isOpen ? ' open' : '') + '" data-fam-card="' + esc(fam) + '">' +
        '<div class="fd-fam-bar" data-click="fdToggleFamilia" data-click-arg="' + esc(fam) + '">' +
          '<div class="fd-fam-left">' +
            '<span class="fd-fam-arrow">' + (isOpen ? '▼' : '►') + '</span>' +
            '<span class="fd-fam-title">' + esc(fam) + '</span>' +
            '<span class="fd-fam-count">(' + deptos.length + (deptos.length === 1 ? ' Depto' : ' Deptos') + ')</span>' +
            (famArtCount > 0 ? '<span class="fd-fam-art" title="Artículos vinculados">' + famArtCount + ' art.</span>' : '') +
          '</div>' +
          '<div class="fd-fam-right">' +
            '<button type="button" class="fd-fam-plus" title="Agregar departamento a ' + esc(fam) + '" ' +
              'data-click="fdQuickPlusFamilia" data-click-arg="' + esc(fam) + '" data-click-arg2="' + esc(ctx) + '">+</button>' +
            '<button type="button" class="fd-fam-del' + (famLocked ? ' locked' : '') + '" title="' + esc(famDelTitle) + '" ' +
              'data-click="fdDelFamilia" data-click-arg="' + esc(fam) + '">' +
              '<i class="fa-solid ' + (famLocked ? 'fa-lock' : 'fa-trash-can') + '"></i>' +
            '</button>' +
          '</div>' +
        '</div>' +
        '<div class="fd-fam-body">' +
          '<div class="fd-depto-toolbar">' +
            '<div class="fd-search-wrap">' +
              '<i class="fa-solid fa-magnifying-glass"></i>' +
              '<input type="text" class="fd-search-inp" id="fd-search-' + esc(ctx) + '-' + esc(fam) + '" ' +
                ' value="' + esc(_deptoSearch[fam] || '') + '" ' +
                'placeholder="Buscar departamento en ' + esc(fam) + '..." ' +
                'oninput="window.fdFilterDeptosLive(this, \'' + esc(fam) + '\', \'' + esc(ctx) + '\')">' +
            '</div>' +
            '<div class="fd-depto-add-wrap">' +
              '<input type="text" class="fd-depto-inp" id="fd-inp-depto-' + esc(ctx) + '-' + esc(fam) + '" ' +
                'placeholder="Nuevo departamento en ' + esc(fam) + '..." ' +
                'data-input="toUpperCase" data-keydown="fdAddDeptoFromCtx" data-keydown-key="Enter" data-keydown-prevent="true" ' +
                'data-click-arg="' + esc(fam) + '" data-click-arg2="' + esc(ctx) + '">' +
              '<button type="button" class="fd-btn-add" data-click="fdAddDeptoFromCtx" data-click-arg="' + esc(fam) + '" data-click-arg2="' + esc(ctx) + '">' +
                '<i class="fa-solid fa-plus"></i> Depto <span class="fd-kbd">F2</span>' +
              '</button>' +
            '</div>' +
          '</div>' +
          '<div class="fd-depto-scroll" id="fd-scroll-' + esc(ctx) + '-' + esc(fam) + '">' +
            deptoRowsHtml +
          '</div>' +
        '</div>' +
      '</div>';
    }).join('') : '<div class="cfg-empty">No hay familias registradas. Usa el campo superior derecho para dar de alta la primera familia.</div>';

    return '<div class="fd-wrap' + (_fdBlockCollapsed ? ' collapsed' : '') + '" data-fd-ctx="' + esc(ctx) + '">' +
      '<div class="fd-header">' +
        '<div class="fd-header-left" data-click="fdToggleMainBlock" title="Clic para ' + (_fdBlockCollapsed ? 'desplegar' : 'contraer') + ' el bloque de Familias y Departamentos">' +
          '<span class="fd-main-arrow">' + (_fdBlockCollapsed ? '►' : '▼') + '</span>' +
          '<h3 class="fd-header-title"><i class="fa-solid fa-layer-group"></i> Familias y Departamentos</h3>' +
          '<span class="fd-badge-pill">' + fams.length + (fams.length === 1 ? ' familia' : ' familias') + ' · ' + totalDeptos + (totalDeptos === 1 ? ' depto' : ' deptos') + '</span>' +
          '<span class="fd-collapse-hint"><i class="fa-solid ' + (_fdBlockCollapsed ? 'fa-chevron-down' : 'fa-chevron-up') + '"></i> ' + (_fdBlockCollapsed ? 'Desplegar' : 'Contraer') + '</span>' +
        '</div>' +
        '<div class="fd-header-right">' +
          '<input type="text" class="fd-inp" id="fd-inp-fam-' + esc(ctx) + '" ' +
            'placeholder="Nueva familia (ej. ACEROS)... [F1]" ' +
            'data-input="toUpperCase" data-keydown="fdAddFamiliaFromCtx" data-keydown-key="Enter" data-keydown-prevent="true" ' +
            'data-click-arg="' + esc(ctx) + '">' +
          '<button type="button" class="fd-btn-add" data-click="fdAddFamiliaFromCtx" data-click-arg="' + esc(ctx) + '">' +
            '<i class="fa-solid fa-plus"></i> Familia <span class="fd-kbd">F1</span>' +
          '</button>' +
        '</div>' +
      '</div>' +
      '<div class="fd-acc-list">' + cardsHtml + '</div>' +
    '</div>';
  }

  /* ───────────────────────── Acciones del Acordeón de Familias y Departamentos ───────────────────────── */
  global.fdToggleMainBlock = function () {
    _fdBlockCollapsed = !_fdBlockCollapsed;
    refreshAllCatalogViews();
  };

  global.fdToggleFamilia = function (fam) {
    var fk = norm(fam);
    if (!fk || !_famTree[fk]) return;
    _fdBlockCollapsed = false;
    _openFam = (_openFam === fk) ? '' : fk;
    refreshAllCatalogViews();
  };

  global.fdQuickPlusFamilia = function (fam, ctx) {
    var fk = norm(fam);
    if (!fk || !_famTree[fk]) return;
    _fdBlockCollapsed = false;
    _openFam = fk;
    refreshAllCatalogViews();
    setTimeout(function () {
      var inp = byId('fd-inp-depto-' + (ctx || 'prod') + '-' + fk);
      if (inp) inp.focus();
    }, 30);
  };

  global.fdFilterDeptosLive = function (inputEl, fam, ctx) {
    var fk = norm(fam);
    var q = norm(inputEl ? inputEl.value : '');
    _deptoSearch[fk] = q;
    var scrollBox = byId('fd-scroll-' + ctx + '-' + fk);
    if (!scrollBox) return;
    var deptos = _famTree[fk] || [];
    var indexedDeptos = deptos.map(function (d, i) { return { name: d, idx: i + 1 }; }).filter(function (item) {
      return !q || item.name.indexOf(q) >= 0;
    });
    if (!indexedDeptos.length) {
      scrollBox.innerHTML = '<div class="cfg-empty" style="padding:14px 10px;text-align:center;">Ningún departamento en <b>' + esc(fk) + '</b> coincide con «' + esc(q) + '».</div>';
      return;
    }
    scrollBox.innerHTML = indexedDeptos.map(function (item) {
      var d = item.name;
      var artCnt = getDeptoArticleCount(fk, d);
      var locked = artCnt > 0;
      var numStr = String(item.idx).padStart(2, '0') + '.';
      var delTitle = locked
        ? 'No se puede eliminar: tiene ' + artCnt + ' artículo(s) asignado(s)'
        : 'Eliminar departamento «' + d + '»';
      return '<div class="fd-depto-row" data-depto-name="' + esc(d) + '">' +
        '<div class="fd-depto-row-left">' +
          '<span class="fd-depto-num">' + numStr + '</span>' +
          '<span class="fd-depto-name">' + esc(d) + '</span>' +
        '</div>' +
        '<div class="fd-depto-row-right">' +
          '<span class="fd-depto-art' + (locked ? ' has-art' : '') + '">' +
            artCnt + (artCnt === 1 ? ' artículo' : ' artículos') +
          '</span>' +
          '<button type="button" class="fd-depto-del' + (locked ? ' locked' : '') + '" ' +
            'title="' + esc(delTitle) + '" ' +
            'data-click="fdDelDepto" data-click-arg="' + esc(fk) + '" data-click-arg2="' + esc(d) + '">' +
            '<i class="fa-solid ' + (locked ? 'fa-lock' : 'fa-trash-can') + '"></i>' +
          '</button>' +
        '</div>' +
      '</div>';
    }).join('');
  };

  global.calebsysAddFamilia = function (rawName) {
    var val = norm(rawName);
    if (!val) return { ok: false, reason: 'empty' };
    _fdBlockCollapsed = false;
    if (_famTree[val]) {
      _openFam = val;
      refreshAllCatalogViews();
      cfgToast('La familia «' + val + '» ya existe (seleccionada).', true);
      return { ok: false, reason: 'duplicate', familia: val };
    }
    _famTree[val] = [];
    _openFam = val;
    persistFamiliasTree();
    cfgToast('Familia «' + val + '» dada de alta correctamente.');
    return { ok: true, familia: val };
  };

  global.fdAddFamiliaFromCtx = function (ctx) {
    var inp = byId('fd-inp-fam-' + (ctx || 'prod'));
    if (!inp) return;
    var val = norm(inp.value);
    if (!val) { inp.focus(); return; }
    var res = global.calebsysAddFamilia(val);
    inp.value = '';
    setTimeout(function () {
      var depInp = byId('fd-inp-depto-' + (ctx || 'prod') + '-' + (res.familia || val));
      if (depInp) depInp.focus();
    }, 30);
  };

  global.calebsysAddDepartamento = function (rawFam, rawDepto) {
    var fk = norm(rawFam);
    var dk = norm(rawDepto);
    if (!fk || !_famTree[fk]) {
      cfgToast('Selecciona primero una familia válida.', true);
      return { ok: false, reason: 'no_family' };
    }
    if (!dk) return { ok: false, reason: 'empty' };
    var list = _famTree[fk];
    if (list.indexOf(dk) >= 0) {
      cfgToast('El departamento «' + dk + '» ya existe dentro de la familia «' + fk + '».', true);
      return { ok: false, reason: 'duplicate', familia: fk, departamento: dk };
    }
    list.push(dk);
    _openFam = fk;
    _deptoSearch[fk] = '';
    persistFamiliasTree();
    cfgToast('Departamento «' + dk + '» dado de alta en «' + fk + '».');
    return { ok: true, familia: fk, departamento: dk };
  };

  global.fdAddDeptoFromCtx = function (fam, ctx) {
    var fk = norm(fam || _openFam);
    var c = ctx || 'prod';
    var inp = byId('fd-inp-depto-' + c + '-' + fk);
    if (!inp) return;
    var val = norm(inp.value);
    if (!val) { inp.focus(); return; }
    global.calebsysAddDepartamento(fk, val);
    setTimeout(function () {
      var nextInp = byId('fd-inp-depto-' + c + '-' + fk);
      if (nextInp) nextInp.focus();
    }, 30);
  };

  global.fdDelDepto = function (fam, dep) {
    var fk = norm(fam), dk = norm(dep);
    if (!fk || !_famTree[fk]) return;
    var artCnt = getDeptoArticleCount(fk, dk);
    if (artCnt > 0) {
      var msg = 'No se puede eliminar este departamento porque tiene ' + artCnt + ' artículo(s) asignado(s). Reasigna los artículos primero.';
      cfgToast(msg, true);
      window.alert(msg);
      return;
    }
    _famTree[fk] = _famTree[fk].filter(function (x) { return x !== dk; });
    persistFamiliasTree();
    cfgToast('Departamento «' + dk + '» eliminado de ' + fk + '.');
  };

  global.fdDelFamilia = function (fam) {
    var fk = norm(fam);
    if (!fk || !_famTree[fk]) return;
    var artCnt = getFamiliaArticleCount(fk);
    if (artCnt > 0) {
      var msg = 'No se puede eliminar la familia «' + fk + '» porque tiene ' + artCnt + ' artículo(s) asignado(s). Reasigna los artículos primero.';
      cfgToast(msg, true);
      window.alert(msg);
      return;
    }
    delete _famTree[fk];
    var fams = Object.keys(_famTree);
    if (_openFam === fk) _openFam = fams.length ? fams[0] : '';
    persistFamiliasTree();
    cfgToast('Familia «' + fk + '» eliminada.');
  };

  global.renderProductAltaCatalogosPanel = function (targetId) {
    ensureAccordionStyles();
    ensureStoreLoaded().then(function () {
      var el = byId(targetId || 'pa-catalogos-f5-mount');
      if (!el) return;
      el.innerHTML = buildFamiliasDeptosAccordionHtml('alta') + buildFourCatalogDrawersGridHtml('alta');
    });
  };

  function refreshAllCatalogViews() {
    var prodBody = byId('cfg-prod-body');
    if (prodBody && _cat === 'productos') {
      renderProductos(_prods || [], _params || {});
    }
    var preciosBody = byId('cfg-precios-body');
    if (preciosBody && _cat === 'precios') {
      renderPrecios(_prods || [], _params || {});
    }
    var altaMount = byId('pa-catalogos-f5-mount');
    if (altaMount) {
      ensureAccordionStyles();
      altaMount.innerHTML = buildFamiliasDeptosAccordionHtml('alta') + buildFourCatalogDrawersGridHtml('alta');
    }
    if (typeof global.renderModalCambioPrecioScales === 'function') {
      global.renderModalCambioPrecioScales();
    }
  }

  /* ───────────────────────── 4 Módulos de Catálogos de Alta Densidad (Marcas, Presentaciones, Unidades, IVA) ───────────────────────── */
  var DRAWER_META = {
    marcas: {
      icon: 'fa-tag',
      title: 'MARCAS',
      placeholder: 'Nueva marca (ej. TRUPER)...',
      singular: 'marca',
      plural: 'marcas',
      dupAlert: 'Esta marca ya se encuentra registrada'
    },
    presentaciones: {
      icon: 'fa-box',
      title: 'PRESENTACIONES DE COMPRA (SAT)',
      placeholder: 'Nueva presentación (ej. SACO (XSA), CUBETA (XBJ))...',
      singular: 'presentación',
      plural: 'presentaciones',
      dupAlert: 'Esta presentación de compra ya se encuentra registrada'
    },
    unidades: {
      icon: 'fa-ruler',
      title: 'UNIDADES DE MEDIDA (SAT)',
      placeholder: 'Nueva unidad (ej. PIEZA (H87), M3 (MTQ))...',
      singular: 'unidad',
      plural: 'unidades',
      dupAlert: 'Esta unidad de medida ya se encuentra registrada'
    },
    ivas: {
      icon: 'fa-percent',
      title: 'IVA',
      placeholder: 'Nueva tasa (ej. 8 %)...',
      singular: 'tasa de IVA',
      plural: 'tasas de IVA',
      dupAlert: 'Esta tasa de IVA ya se encuentra registrada'
    }
  };

  global.cfgToggleDrawer = function (key) {
    if (!(key in _drawersOpen)) return;
    _drawersOpen[key] = !_drawersOpen[key];
    refreshAllCatalogViews();
  };

  function getCatalogCountsMap(key, items) {
    var baseMap = key === 'marcas' ? BASE_BRAND_COUNTS
                : key === 'presentaciones' ? BASE_PRES_COUNTS
                : key === 'unidades' ? BASE_UNI_COUNTS
                : key === 'ivas' ? BASE_IVA_COUNTS : {};
    var o = {};
    Object.keys(baseMap).forEach(function (k) {
      o[norm(k)] = baseMap[k];
    });
    (items || _prods || []).forEach(function (p) {
      var raw = '';
      if (key === 'marcas') {
        raw = meta(p).marca || meta(p).brand || p.marca || p.brand;
      } else if (key === 'presentaciones') {
        raw = p.purchase_unit || meta(p).presentacion_compra || meta(p).purchase_unit;
      } else if (key === 'unidades') {
        raw = p.unit || p.sale_unit || meta(p).unidad_medida;
      } else if (key === 'ivas') {
        var iv = meta(p).iva != null ? meta(p).iva : (p.iva != null ? p.iva : null);
        if (iv != null && String(iv).trim() !== '') {
          raw = /^\d+(\.\d+)?$/.test(String(iv).trim()) ? String(iv).trim() + ' %' : String(iv).trim();
        }
      }
      var v = norm(raw);
      if (v) {
        if (!(v in baseMap)) {
          o[v] = (o[v] || 0) + 1;
        } else if (p._userCreated) {
          o[v] = (o[v] || 0) + 1;
        }
      }
    });
    return o;
  }

  function getCatalogArticleCount(key, itemName) {
    var vk = norm(itemName);
    if (!vk) return 0;
    var map = getCatalogCountsMap(key, _prods || []);
    return map[vk] || 0;
  }

  function focusAndHighlightCatalogRow(key, itemName) {
    var vk = norm(itemName);
    setTimeout(function () {
      var containers = document.querySelectorAll('[data-catalog-scroll="' + key + '"]');
      for (var c = 0; c < containers.length; c++) {
        var rows = containers[c].querySelectorAll('[data-catalog-row]');
        for (var i = 0; i < rows.length; i++) {
          if (rows[i].getAttribute('data-catalog-row') === vk) {
            rows[i].classList.add('highlight-dup');
            try { rows[i].scrollIntoView({ behavior: 'smooth', block: 'nearest' }); } catch (e) {}
            setTimeout((function (r) {
              return function () { if (r) r.classList.remove('highlight-dup'); };
            })(rows[i]), 2400);
            break;
          }
        }
      }
    }, 35);
  }

  function formatCatalogFooterText(key, filteredLen, totalLen, hasFilter) {
    var info = DRAWER_META[key] || DRAWER_META.marcas;
    var shown = hasFilter ? filteredLen : Math.min(10, totalLen);
    return 'Mostrando ' + shown + ' de ' + totalLen + ' ' + (totalLen === 1 ? info.singular : info.plural);
  }

  function buildCatalogDrawerRowsHtml(key, list, counts, ctx) {
    var info = DRAWER_META[key] || DRAWER_META.marcas;
    var suffix = ctx ? '-' + ctx : '';
    if (!list.length) {
      return '<div class="cfg-empty" style="padding:16px 12px;text-align:center;">No se encontraron ' + esc(info.plural) + ' coincidentes.</div>';
    }
    var defIva = (_params && _params['params.iva_porcentaje'] != null) ? num(_params['params.iva_porcentaje']) : 16;

    return list.map(function (item) {
      var vk = norm(item);
      var cnt = counts[vk] || 0;
      var locked = cnt > 0;
      var cntFormatted = cnt.toLocaleString('en-US') + (cnt === 1 ? ' artículo' : ' artículos');
      var isUnitOrPres = (key === 'unidades' || key === 'presentaciones');
      var satCodeForRow = isUnitOrPres ? resolveSatClaveUnidad(vk) : '';

      if (_editingCatalog.key === key && _editingCatalog.val === vk) {
        var editVal = isUnitOrPres ? (vk + ' (' + satCodeForRow + ')') : vk;
        return '<div class="cfg-marca-row highlight-dup" data-catalog-row="' + esc(vk) + '">' +
          '<div class="cfg-marca-edit-wrap">' +
            '<input type="text" class="cfg-marca-edit-inp" id="cfg-edit-' + esc(key) + '-inp' + suffix + '" value="' + esc(editVal) + '" ' +
              'data-input="toUpperCase" ' +
              'onkeydown="if(event.key===\'Enter\'){event.preventDefault();window.cfgCommitEditCatalogItem(\'' + esc(key) + '\',\'' + esc(vk) + '\',\'' + esc(ctx || 'prod') + '\');}else if(event.key===\'Escape\'){event.preventDefault();window.cfgCancelEditCatalogItem(\'' + esc(key) + '\');}">' +
            '<button type="button" class="cfg-marca-btn edit" title="Guardar cambio (Enter)" ' +
              'data-click="cfgCommitEditCatalogItem" data-click-arg="' + esc(key) + '" data-click-arg2="' + esc(vk) + '">' +
              '<i class="fa-solid fa-check"></i>' +
            '</button>' +
            '<button type="button" class="cfg-marca-btn" title="Cancelar (Esc)" ' +
              'data-click="cfgCancelEditCatalogItem" data-click-arg="' + esc(key) + '">' +
              '<i class="fa-solid fa-xmark"></i>' +
            '</button>' +
          '</div>' +
        '</div>';
      }

      var isDefIva = false;
      if (key === 'ivas') {
        var m = /(\d+(\.\d+)?)/.exec(vk);
        var ivNum = m ? parseFloat(m[1]) : 0;
        isDefIva = (ivNum === defIva && (vk.indexOf('EXENTO') < 0 || defIva === 0));
      }

      var delTitle = locked
        ? 'No se puede eliminar porque tiene artículos asignados'
        : 'Eliminar ' + info.singular + ' «' + vk + '»';

      var satBadgeHtml = isUnitOrPres
        ? '<span style="font-family:\'JetBrains Mono\',monospace;font-size:10px;font-weight:800;color:#38bdf8;background:rgba(2,132,199,0.18);border:1px solid rgba(56,189,248,0.4);padding:1px 6px;border-radius:4px;margin-left:5px;" title="Clave oficial SAT (c_ClaveUnidad) vinculada">SAT: ' + esc(satCodeForRow) + '</span>'
        : '';

      return '<div class="cfg-marca-row" data-catalog-row="' + esc(vk) + '">' +
        '<div class="cfg-marca-left">' +
          '<span class="cfg-marca-name">' + esc(isUnitOrPres ? (vk + ' (' + satCodeForRow + ')') : vk) + '</span>' +
          satBadgeHtml +
          (isDefIva ? '<span class="cfg-iva-def-badge">PREDETERMINADO</span>' : '') +
          '<span class="cfg-marca-art' + (locked ? ' has-art' : '') + '">(' + esc(cntFormatted) + ')</span>' +
        '</div>' +
        '<div class="cfg-marca-actions">' +
          (key === 'ivas'
            ? '<button type="button" class="cfg-marca-btn ' + (isDefIva ? 'edit' : '') + '" title="Fijar «' + esc(vk) + '» como IVA predeterminado del sistema" ' +
                'data-click="cfgSetDefaultIva" data-click-arg="' + esc(vk) + '">' +
                '<i class="fa-solid fa-star" style="' + (isDefIva ? 'color:#38bdf8;' : '') + '"></i>' +
              '</button>'
            : '') +
          '<button type="button" class="cfg-marca-btn edit" title="Editar ' + esc(info.singular) + ' «' + esc(vk) + '»" ' +
            'data-click="cfgStartEditCatalogItem" data-click-arg="' + esc(key) + '" data-click-arg2="' + esc(vk) + '">' +
            '<i class="fa-solid fa-pen"></i>' +
          '</button>' +
          '<button type="button" class="cfg-marca-btn ' + (locked ? 'del-locked' : 'del-active') + '" ' +
            'title="' + esc(delTitle) + '" ' +
            'data-click="cfgDelCatalogItem" data-click-arg="' + esc(key) + '" data-click-arg2="' + esc(vk) + '">' +
            '<i class="fa-solid ' + (locked ? 'fa-lock' : 'fa-trash-can') + '"></i>' +
          '</button>' +
        '</div>' +
      '</div>';
    }).join('');
  }

  function buildHighDensityDrawerHtml(key, ctx) {
    var info = DRAWER_META[key] || DRAWER_META.marcas;
    var suffix = ctx ? '-' + ctx : '';
    var isOpen = !!_drawersOpen[key];
    var allItems = _catLists[key] || [];
    var total = allItems.length;
    var q = norm(_drawerSearch[key] || '');
    var filtered = q ? allItems.filter(function (m) {
      var nm = norm(m);
      var sc = (key === 'unidades' || key === 'presentaciones') ? resolveSatClaveUnidad(nm) : '';
      return nm.indexOf(q) >= 0 || (sc && sc.indexOf(q) >= 0);
    }) : allItems;
    var counts = getCatalogCountsMap(key, _prods || []);

    return '<div class="cfg-drawer cfg-drawer-marcas' + (isOpen ? ' open' : '') + '" id="cfg-drawer-' + esc(key) + '-card' + suffix + '">' +
      '<div class="cfg-drawer-head" data-click="cfgToggleDrawer" data-click-arg="' + esc(key) + '">' +
        '<div class="cfg-drawer-title">' +
          '<i class="fa-solid ' + info.icon + '"></i>' +
          '<span>' + esc(info.title) + '</span>' +
          '<span class="cfg-marca-count-badge" id="cfg-' + esc(key) + '-total-badge' + suffix + '">' + total + '</span>' +
        '</div>' +
        '<span class="cfg-drawer-arrow">' + (isOpen ? '▲' : '▼') + '</span>' +
      '</div>' +
      '<div class="cfg-drawer-body">' +
        '<div class="cfg-marca-add-bar">' +
          '<input type="text" class="cfg-marca-inp" id="cfg-inp-' + esc(key) + suffix + '" ' +
            'value="' + esc(_drawerSearch[key] || '') + '" ' +
            'placeholder="' + esc(info.placeholder) + '" ' +
            'data-input="toUpperCase" ' +
            'oninput="window.cfgFilterDrawerLive(\'' + esc(key) + '\', this.value, \'' + esc(ctx || 'prod') + '\')" ' +
            'data-keydown="cfgAddCatalogItem" data-keydown-key="Enter" data-keydown-prevent="true" data-click-arg="' + esc(key) + '" data-click-arg2="' + esc(ctx || 'prod') + '">' +
          '<button type="button" class="cfg-marca-btn-add" data-click="cfgAddCatalogItem" data-click-arg="' + esc(key) + '" data-click-arg2="' + esc(ctx || 'prod') + '">' +
            '<i class="fa-solid fa-plus"></i> Agregar' +
          '</button>' +
        '</div>' +
        '<div class="cfg-marca-scroll" id="cfg-' + esc(key) + '-scroll-list' + suffix + '" data-catalog-scroll="' + esc(key) + '">' +
          buildCatalogDrawerRowsHtml(key, filtered, counts, ctx || 'prod') +
        '</div>' +
        '<div class="cfg-marca-footer">' +
          '<span id="cfg-' + esc(key) + '-footer-text' + suffix + '">' + esc(formatCatalogFooterText(key, filtered.length, total, !!q)) + '</span>' +
        '</div>' +
      '</div>' +
    '</div>';
  }

  function buildFourCatalogDrawersGridHtml(ctx) {
    var c = ctx || 'prod';
    return '<div class="cfg-drawers-grid">' +
      buildHighDensityDrawerHtml('marcas', c) +
      buildHighDensityDrawerHtml('presentaciones', c) +
      buildHighDensityDrawerHtml('unidades', c) +
      buildHighDensityDrawerHtml('ivas', c) +
    '</div>';
  }

  global.cfgFilterDrawerLive = function (key, rawQuery, ctx) {
    if (!(key in _drawerSearch)) return;
    _drawerSearch[key] = norm(rawQuery || '');
    var allItems = _catLists[key] || [];
    var total = allItems.length;
    var q = _drawerSearch[key];
    var filtered = q ? allItems.filter(function (m) {
      var nm = norm(m);
      var sc = (key === 'unidades' || key === 'presentaciones') ? resolveSatClaveUnidad(nm) : '';
      return nm.indexOf(q) >= 0 || (sc && sc.indexOf(q) >= 0);
    }) : allItems;
    var counts = getCatalogCountsMap(key, _prods || []);

    ['prod', 'precios', 'alta'].forEach(function (c) {
      var suffix = '-' + c;
      var scrollEl = byId('cfg-' + key + '-scroll-list' + suffix);
      var footerEl = byId('cfg-' + key + '-footer-text' + suffix);
      if (scrollEl) {
        scrollEl.innerHTML = buildCatalogDrawerRowsHtml(key, filtered, counts, c);
      }
      if (footerEl) {
        footerEl.textContent = formatCatalogFooterText(key, filtered.length, total, !!q);
      }
      if (ctx && c !== ctx) {
        var otherInp = byId('cfg-inp-' + key + suffix);
        if (otherInp && otherInp.value !== rawQuery) otherInp.value = _drawerSearch[key];
      }
    });
  };
  global.cfgFilterMarcasLive = function (q) { global.cfgFilterDrawerLive('marcas', q, 'prod'); };
  global.calebsysFilterMarcas = global.cfgFilterMarcasLive;

  global.cfgStartEditCatalogItem = function (key, val) {
    var vk = norm(val);
    if (!key || !vk) return;
    _editingCatalog = { key: key, val: vk };
    refreshAllCatalogViews();
    setTimeout(function () {
      var inp = byId('cfg-edit-' + key + '-inp-prod') || byId('cfg-edit-' + key + '-inp-precios') || byId('cfg-edit-' + key + '-inp-alta');
      if (inp) { inp.focus(); inp.select(); }
    }, 20);
  };
  global.cfgStartEditMarca = function (marca) { global.cfgStartEditCatalogItem('marcas', marca); };

  global.cfgCancelEditCatalogItem = function () {
    _editingCatalog = { key: '', val: '' };
    refreshAllCatalogViews();
  };
  global.cfgCancelEditMarca = global.cfgCancelEditCatalogItem;

  global.cfgCommitEditCatalogItem = function (key, oldItem, ctx) {
    var oldVal = norm(oldItem || _editingCatalog.val);
    var suffix = ctx ? '-' + ctx : '-prod';
    var inp = byId('cfg-edit-' + key + '-inp' + suffix) || byId('cfg-edit-' + key + '-inp-prod') || byId('cfg-edit-' + key + '-inp-precios') || byId('cfg-edit-' + key + '-inp-alta');
    if (!oldVal || !inp || !_catLists[key]) { _editingCatalog = { key: '', val: '' }; return; }
    var rawNewVal = norm(inp.value);
    if (!rawNewVal) { inp.focus(); return; }
    var parsedUnit = (key === 'unidades' || key === 'presentaciones') ? parseUnitAndSatInput(rawNewVal) : { name: rawNewVal, satCode: '' };
    var newVal = parsedUnit.name;
    if (key === 'ivas' && /^\d+(\.\d+)?$/.test(newVal)) newVal = newVal + ' %';
    if (key === 'unidades' || key === 'presentaciones') {
      saveSatUnitAssociation(newVal, parsedUnit.satCode || resolveSatClaveUnidad(newVal));
    }

    if (newVal === oldVal) {
      _editingCatalog = { key: '', val: '' };
      broadcastCatalogUpdate();
      refreshAllCatalogViews();
      return;
    }
    var info = DRAWER_META[key] || DRAWER_META.marcas;
    if (_catLists[key].indexOf(newVal) >= 0) {
      cfgToast(info.dupAlert, true);
      window.alert(info.dupAlert);
      _editingCatalog = { key: '', val: '' };
      _drawerSearch[key] = '';
      refreshAllCatalogViews();
      focusAndHighlightCatalogRow(key, newVal);
      return;
    }

    var baseMap = key === 'marcas' ? BASE_BRAND_COUNTS
                : key === 'presentaciones' ? BASE_PRES_COUNTS
                : key === 'unidades' ? BASE_UNI_COUNTS
                : key === 'ivas' ? BASE_IVA_COUNTS : null;
    if (baseMap && (oldVal in baseMap)) {
      baseMap[newVal] = baseMap[oldVal];
      delete baseMap[oldVal];
    }

    _catLists[key] = _catLists[key].map(function (m) {
      return norm(m) === oldVal ? newVal : norm(m);
    });

    (_prods || []).forEach(function (p) {
      var md = meta(p);
      if (key === 'marcas') {
        var curM = norm(md.marca || md.brand || p.marca || p.brand);
        if (curM === oldVal) {
          if (!p.meta_data || typeof p.meta_data !== 'object') p.meta_data = {};
          p.meta_data.marca = newVal;
          if ('brand' in p.meta_data) p.meta_data.brand = newVal;
        }
      } else if (key === 'presentaciones') {
        if (norm(p.purchase_unit) === oldVal) p.purchase_unit = newVal;
      } else if (key === 'unidades') {
        if (norm(p.unit) === oldVal) p.unit = newVal;
        if (norm(p.sale_unit) === oldVal) p.sale_unit = newVal;
      } else if (key === 'ivas') {
        var curIva = md.iva != null ? norm(md.iva + ' %') : '';
        if (curIva === oldVal) {
          var m = /(\d+(\.\d+)?)/.exec(newVal);
          if (!p.meta_data || typeof p.meta_data !== 'object') p.meta_data = {};
          p.meta_data.iva = m ? parseFloat(m[1]) : 0;
        }
      }
    });

    _editingCatalog = { key: '', val: '' };
    broadcastCatalogUpdate();
    refreshAllCatalogViews();
    focusAndHighlightCatalogRow(key, newVal);

    if (key === 'marcas') {
      AdminAPI.apiFetch('/api/admin/catalogs/marcas/rename', {
        method: 'PUT',
        body: JSON.stringify({ old_name: oldVal, new_name: newVal })
      }).then(function () {
        cfgToast('Marca actualizada: «' + oldVal + '» → «' + newVal + '»');
      }).catch(function () {
        putCfg('catalog.marcas', _catLists.marcas).then(function () {
          cfgToast('Marca actualizada: «' + oldVal + '» → «' + newVal + '»');
        }).catch(function (e) { cfgToast('Error: ' + e.message, true); });
      });
    } else {
      putCfg('catalog.' + key, _catLists[key]).then(function () {
        cfgToast('Actualizado: «' + oldVal + '» → «' + newVal + '»');
      }).catch(function (e) { cfgToast('Error: ' + e.message, true); });
    }
  };
  global.cfgCommitEditMarca = function (oldMarca) { global.cfgCommitEditCatalogItem('marcas', oldMarca, 'prod'); };

  global.cfgAddCatalogItem = function (key, ctx) {
    var suffix = ctx ? '-' + ctx : '-prod';
    var inp = byId('cfg-inp-' + key + suffix) || byId('cfg-inp-' + key + '-prod') || byId('cfg-inp-' + key + '-precios') || byId('cfg-inp-' + key + '-alta') || byId('cfg-inp-' + key);
    if (!inp || !_catLists[key]) return;
    var rawVal = norm(inp.value);
    if (!rawVal) { inp.focus(); return; }
    var parsedUnit = (key === 'unidades' || key === 'presentaciones') ? parseUnitAndSatInput(rawVal) : { name: rawVal, satCode: '' };
    var val = parsedUnit.name;
    if (key === 'ivas' && /^\d+(\.\d+)?$/.test(val)) val = val + ' %';
    if (key === 'unidades' || key === 'presentaciones') {
      saveSatUnitAssociation(val, parsedUnit.satCode || resolveSatClaveUnidad(val));
    }

    var info = DRAWER_META[key] || DRAWER_META.marcas;
    if (_catLists[key].indexOf(val) >= 0) {
      cfgToast(info.dupAlert, true);
      window.alert(info.dupAlert);
      _drawerSearch[key] = '';
      inp.value = '';
      refreshAllCatalogViews();
      focusAndHighlightCatalogRow(key, val);
      return;
    }

    _catLists[key].push(val);
    _drawerSearch[key] = '';
    inp.value = '';
    _drawersOpen[key] = true;
    broadcastCatalogUpdate();
    refreshAllCatalogViews();
    focusAndHighlightCatalogRow(key, val);
    var linkedSatMsg = (key === 'unidades' || key === 'presentaciones') ? (' (Clave SAT: ' + resolveSatClaveUnidad(val) + ')') : '';
    putCfg('catalog.' + key, _catLists[key]).then(function () {
      cfgToast('Agregado al catálogo: «' + val + '»' + linkedSatMsg);
    }).catch(function (e) { cfgToast('Error: ' + e.message, true); });
    setTimeout(function () {
      var nextInp = byId('cfg-inp-' + key + suffix) || byId('cfg-inp-' + key + '-prod') || byId('cfg-inp-' + key + '-precios') || byId('cfg-inp-' + key + '-alta');
      if (nextInp) nextInp.focus();
    }, 25);
  };

  global.cfgDelCatalogItem = function (key, val) {
    if (!_catLists[key]) return;
    var vk = norm(val);
    var info = DRAWER_META[key] || DRAWER_META.marcas;
    var artCnt = getCatalogArticleCount(key, vk);

    if (artCnt > 0) {
      var lockMsg = 'No se puede eliminar porque tiene artículos asignados';
      cfgToast(lockMsg, true);
      window.alert(lockMsg);
      return;
    }

    if (!window.confirm('¿Deseas eliminar «' + vk + '» del catálogo de ' + info.title + '?')) return;

    _catLists[key] = _catLists[key].filter(function (x) { return norm(x) !== vk; });
    if (_editingCatalog.key === key && _editingCatalog.val === vk) {
      _editingCatalog = { key: '', val: '' };
    }
    broadcastCatalogUpdate();
    refreshAllCatalogViews();

    if (key === 'marcas') {
      AdminAPI.apiFetch('/api/admin/catalogs/marcas/' + encodeURIComponent(vk), {
        method: 'DELETE'
      }).then(function () {
        cfgToast('Marca «' + vk + '» eliminada.');
      }).catch(function () {
        putCfg('catalog.marcas', _catLists.marcas).then(function () {
          cfgToast('Marca «' + vk + '» eliminada.');
        }).catch(function (e) { cfgToast('Error: ' + e.message, true); });
      });
    } else {
      putCfg('catalog.' + key, _catLists[key]).then(function () {
        cfgToast('Eliminado: «' + vk + '»');
      }).catch(function (e) { cfgToast('Error: ' + e.message, true); });
    }
  };

  global.cfgSetDefaultIva = function (ivaLabel) {
    var m = /(\d+(\.\d+)?)/.exec(String(ivaLabel || ''));
    var numIva = m ? parseFloat(m[1]) : 0;
    if (!_params) _params = {};
    _params['params.iva_porcentaje'] = numIva;
    broadcastCatalogUpdate();
    refreshAllCatalogViews();
    putCfg('params.iva_porcentaje', numIva).then(function () {
      var el = byId('acfg-iva'); if (el) el.value = numIva;
      var infoEl = byId('cfg-info-iva'); if (infoEl) infoEl.value = numIva + ' %';
      setCard('parametros', (_params['params.moneda'] || 'MXN') + ' · IVA ' + numIva + ' %');
      cfgToast('IVA predeterminado establecido en ' + numIva + ' %');
    }).catch(function (e) { cfgToast('Error: ' + e.message, true); });
  };

  /* ───────────────────────── Catálogos › Productos (Render en #configuracion) ───────────────────────── */
  function renderProductos(items, cfg) {
    ensureAccordionStyles();
    var body = byId('cfg-prod-body'); if (!body) return;

    body.innerHTML =
      buildFamiliasDeptosAccordionHtml('prod') +
      buildFourCatalogDrawersGridHtml('prod') +
      '<div class="cfg-actions">' +
        '<button type="button" class="btn btn-primary btn-sm" data-click="cfgIrProductos"><i class="fa-solid fa-box-open"></i> Ir al catálogo de productos</button>' +
        '<button type="button" class="btn btn-secondary btn-sm" data-click="productsNuevoProducto"><i class="fa-solid fa-plus"></i> Nuevo producto</button>' +
      '</div>';
  }

  /* ───────────────────────── Catálogos › Precios (SOLO Escalas de Precios y Escalas de las Sucursales) ───────────────────────── */
  function persistPriceScales() {
    try { localStorage.setItem(LS_SCALES_KEY, JSON.stringify(_priceScales)); } catch (e) {}
    // El catálogo de configuración aplica únicamente como sugerencia por defecto para altas nuevas
    if (!global._paLoadedExistingProduct) {
      global._paProductPriceScales = null;
      if (typeof global.recalculateAllProductScalesFromCost === 'function') {
        global.recalculateAllProductScalesFromCost({ keepZeroMainMargin: true });
      }
    }
    broadcastCatalogUpdate();
    refreshAllCatalogViews();
    return putCfg('catalog.price_scales', _priceScales).catch(function () {});
  }

  function persistBranchPriceScales() {
    try { localStorage.setItem(LS_BRANCH_SCALES_KEY, JSON.stringify(_branchPriceScales)); } catch (e) {}
    // El catálogo de configuración aplica únicamente como sugerencia por defecto para altas nuevas
    if (!global._paLoadedExistingProduct) {
      global._paProductBranchScales = null;
      if (typeof global.recalculateAllProductScalesFromCost === 'function') {
        global.recalculateAllProductScalesFromCost({ keepZeroMainMargin: true });
      }
    }
    broadcastCatalogUpdate();
    refreshAllCatalogViews();
    return putCfg('catalog.branch_price_scales', _branchPriceScales).catch(function () {});
  }

  global.cfgTogglePreciosDrawer = function (key) {
    if (!(key in _preciosDrawersOpen)) return;
    _preciosDrawersOpen[key] = !_preciosDrawersOpen[key];
    renderPrecios(_prods || [], _params || {});
  };

  /* ── CRUD Escalas de Precios Generales ── */
  global.cfgAddPriceScale = function () {
    var nameInp = byId('cfg-esc-name-inp');
    var margInp = byId('cfg-esc-margen-inp');
    var oferInp = byId('cfg-esc-oferta-inp');
    var comInp  = byId('cfg-esc-comision-inp');
    if (!nameInp) return;

    var name = norm(nameInp.value);
    if (!name) {
      cfgToast('Escribe el nombre de la escala de precios (ej. MAYOREO, DISTRIBUIDOR).', true);
      nameInp.focus();
      return;
    }
    var exists = _priceScales.some(function (s) { return norm(s.name) === name; });
    if (exists) {
      cfgToast('La escala de precio «' + name + '» ya se encuentra registrada.', true);
      window.alert('Esta escala de precio ya se encuentra registrada');
      nameInp.focus();
      return;
    }

    var margen = margInp && margInp.value !== '' ? num(margInp.value) : 20.00;
    var oferta = oferInp && oferInp.value !== '' ? num(oferInp.value) : 0.00;
    var comision = comInp && comInp.value !== '' ? num(comInp.value) : 0.00;

    _priceScales.push({
      id: 'esc-' + Date.now(),
      name: name,
      margen_ideal: margen,
      oferta: oferta,
      comision: comision,
      active: true,
      locked: false
    });

    // Propagar también la nueva escala al catálogo por defecto de las sucursales secundarias registradas
    var secondaryBranches = getSecondaryBranchesList(_branches || []);
    secondaryBranches.forEach(function (br, bIdx) {
      var bId = String(br.id || br.name);
      var bName = norm(br.name || br.id);
      var hasBrScale = _branchPriceScales.some(function (bs) {
        return (String(bs.branch_id) === bId || norm(bs.branch_name) === bName) && norm(bs.scale_name) === name;
      });
      if (!hasBrScale) {
        _branchPriceScales.push({
          id: 'besc-' + Date.now() + '-' + bIdx,
          branch_id: bId,
          branch_name: bName,
          scale_name: name,
          margen_ideal: margen,
          sobreprecio_suc: 0.00,
          comision: comision,
          active: true
        });
      }
    });
    try { localStorage.setItem(LS_BRANCH_SCALES_KEY, JSON.stringify(_branchPriceScales)); } catch (e) {}
    putCfg('catalog.branch_price_scales', _branchPriceScales).catch(function () {});

    nameInp.value = '';
    if (margInp) margInp.value = '20.00';
    if (oferInp) oferInp.value = '0.00';
    if (comInp)  comInp.value = '0.00';

    persistPriceScales();
    cfgToast('Escala de precio «' + name + '» agregada al catálogo por defecto (' + fmt2(margen) + ' % margen).');
    setTimeout(function () {
      var n = byId('cfg-esc-name-inp');
      if (n) n.focus();
    }, 30);
  };

  global.cfgStartEditPriceScale = function (id) {
    _editingScaleId = String(id || '');
    renderPrecios(_prods || [], _params || {});
    setTimeout(function () {
      var inp = byId('cfg-edit-esc-name-' + _editingScaleId);
      if (inp) { inp.focus(); inp.select(); }
    }, 20);
  };

  global.cfgCancelEditPriceScale = function () {
    _editingScaleId = '';
    renderPrecios(_prods || [], _params || {});
  };

  global.cfgCommitEditPriceScale = function (id) {
    var target = _priceScales.filter(function (s) { return s.id === id; })[0];
    if (!target) { _editingScaleId = ''; return; }

    var nameEl = byId('cfg-edit-esc-name-' + id);
    var margEl = byId('cfg-edit-esc-marg-' + id);
    var oferEl = byId('cfg-edit-esc-ofer-' + id);
    var comEl  = byId('cfg-edit-esc-com-' + id);

    var newName = target.locked ? target.name : norm(nameEl ? nameEl.value : target.name);
    if (!newName) { if (nameEl) nameEl.focus(); return; }

    var dup = _priceScales.some(function (s) { return s.id !== id && norm(s.name) === newName; });
    if (dup) {
      cfgToast('Ya existe otra escala con el nombre «' + newName + '».', true);
      return;
    }

    var oldName = target.name;
    target.name = newName;
    if (margEl) target.margen_ideal = num(margEl.value);
    if (oferEl) target.oferta = num(oferEl.value);
    if (comEl)  target.comision = num(comEl.value);

    // Si cambió el nombre de la escala en el catálogo, actualizar la clave de nombre en el catálogo de sucursales
    if (norm(oldName) !== norm(newName)) {
      var branchUpdated = false;
      _branchPriceScales.forEach(function (bs) {
        if (norm(bs.scale_name) === norm(oldName)) {
          bs.scale_name = newName;
          branchUpdated = true;
        }
      });
      if (branchUpdated) {
        try { localStorage.setItem(LS_BRANCH_SCALES_KEY, JSON.stringify(_branchPriceScales)); } catch (e) {}
        putCfg('catalog.branch_price_scales', _branchPriceScales).catch(function () {});
      }
    }

    _editingScaleId = '';
    persistPriceScales();
    cfgToast('Escala por defecto «' + newName + '» actualizada (aplica únicamente para futuras altas nuevas).');
  };

  global.cfgTogglePriceScaleActive = function (id) {
    var target = _priceScales.filter(function (s) { return s.id === id; })[0];
    if (!target) return;
    target.active = !target.active;
    persistPriceScales();
    cfgToast('Escala «' + target.name + '» ' + (target.active ? 'activada' : 'desactivada') + ' para altas nuevas.');
  };

  global.cfgDelPriceScale = function (id) {
    var target = _priceScales.filter(function (s) { return s.id === id; })[0];
    if (!target) return;
    if (target.locked || norm(target.name) === 'PRECIO DE LISTA') {
      var msg = 'La escala base «PRECIO DE LISTA» está protegida y no se puede eliminar.';
      cfgToast(msg, true);
      window.alert(msg);
      return;
    }
    if (!window.confirm('¿Deseas eliminar la escala de precios «' + target.name + '» del catálogo por defecto?')) return;
    var delName = norm(target.name);
    _priceScales = _priceScales.filter(function (s) { return s.id !== id; });
    _branchPriceScales = (_branchPriceScales || []).filter(function (bs) { return norm(bs.scale_name) !== delName; });
    persistBranchPriceScales();
    persistPriceScales();
    cfgToast('Escala «' + target.name + '» eliminada del catálogo por defecto.');
  };

  /* ── CRUD Escalas de Precios de las Sucursales ── */
  global.cfgFilterBranchScales = function (branchId) {
    _activeBranchScaleFilter = String(branchId || 'ALL');
    renderPrecios(_prods || [], _params || {});
  };

  global.cfgAddBranchPriceScale = function () {
    var sucSel   = byId('cfg-besc-branch-sel');
    var scaleInp = byId('cfg-besc-scale-inp');
    var margInp  = byId('cfg-besc-margen-inp');
    var ajInp    = byId('cfg-besc-ajuste-inp');
    var comInp   = byId('cfg-besc-comision-inp');
    if (!scaleInp) return;

    var scaleName = norm(scaleInp.value);
    if (!scaleName) {
      cfgToast('Escribe o selecciona el nombre de la escala para la sucursal.', true);
      scaleInp.focus();
      return;
    }

    var branchIdVal = sucSel ? sucSel.value : 'ALL';
    var margen = margInp && margInp.value !== '' ? num(margInp.value) : 25.00;
    var ajuste = ajInp && ajInp.value !== '' ? num(ajInp.value) : 0.00;
    var comision = comInp && comInp.value !== '' ? num(comInp.value) : 0.00;

    var secondaryBranches = getSecondaryBranchesList(_branches || []);
    var targets = (branchIdVal === 'ALL')
      ? secondaryBranches
      : secondaryBranches.filter(function (b) { return String(b.id) === String(branchIdVal) || norm(b.name) === norm(branchIdVal); });

    if (!targets.length && branchIdVal !== 'ALL') {
      targets = [{ id: branchIdVal, name: norm(branchIdVal) }];
    }

    var addedCount = 0;
    var updatedCount = 0;
    targets.forEach(function (br, idx) {
      var bId = String(br.id || br.name);
      var bName = norm(br.name || br.id);
      var existing = _branchPriceScales.filter(function (bs) {
        return (String(bs.branch_id) === bId || norm(bs.branch_name) === bName) && norm(bs.scale_name) === scaleName;
      })[0];

      if (existing) {
        existing.margen_ideal = margen;
        existing.sobreprecio_suc = ajuste;
        existing.comision = comision;
        existing.active = true;
        updatedCount++;
      } else {
        _branchPriceScales.push({
          id: 'besc-' + Date.now() + '-' + idx,
          branch_id: bId,
          branch_name: bName,
          scale_name: scaleName,
          margen_ideal: margen,
          sobreprecio_suc: ajuste,
          comision: comision,
          active: true
        });
        addedCount++;
      }
    });

    scaleInp.value = '';
    persistBranchPriceScales();
    if (addedCount > 0) {
      cfgToast('Escala «' + scaleName + '» dada de alta en ' + (targets.length === 1 ? targets[0].name : (targets.length + ' sucursales')) + ' (para altas nuevas).');
    } else if (updatedCount > 0) {
      cfgToast('Escala «' + scaleName + '» actualizada en ' + (targets.length === 1 ? targets[0].name : (targets.length + ' sucursales')) + ' (para altas nuevas).');
    }
    setTimeout(function () {
      var inp = byId('cfg-besc-scale-inp');
      if (inp) inp.focus();
    }, 30);
  };

  global.cfgSyncGeneralScalesToBranches = function () {
    var secondaryBranches = getSecondaryBranchesList(_branches || []);
    var targets = secondaryBranches.filter(function (b) {
      return String(b.id) === String(_activeBranchScaleFilter) || norm(b.name) === norm(_activeBranchScaleFilter);
    });
    if (!targets.length && secondaryBranches.length) {
      targets = [secondaryBranches[0]];
    }

    var activeScaleNames = {};
    (_priceScales || []).forEach(function (sc) {
      if (sc && sc.active !== false) activeScaleNames[norm(sc.name)] = true;
    });

    targets.forEach(function (br, bIdx) {
      var bId = String(br.id || br.name);
      var bName = norm(br.name || br.id);
      // Eliminar escalas de esta sucursal que ya no existan en Matriz
      _branchPriceScales = (_branchPriceScales || []).filter(function (bs) {
        var sameBr = String(bs.branch_id) === bId || norm(bs.branch_name) === bName;
        if (!sameBr) return true;
        return !!activeScaleNames[norm(bs.scale_name)];
      });
      (_priceScales || []).forEach(function (sc, sIdx) {
        if (!sc.active) return;
        var scName = norm(sc.name);
        var mTrab = num(sc.margen_ideal) - num(sc.oferta);
        var existing = _branchPriceScales.filter(function (bs) {
          return (String(bs.branch_id) === bId || norm(bs.branch_name) === bName) && norm(bs.scale_name) === scName;
        })[0];
        if (existing) {
          existing.margen_ideal = mTrab;
          existing.sobreprecio_suc = 0.00;
          existing.comision = num(sc.comision);
          existing.active = true;
        } else {
          _branchPriceScales.push({
            id: 'besc-' + Date.now() + '-' + bIdx + '-' + sIdx,
            branch_id: bId,
            branch_name: bName,
            scale_name: scName,
            margen_ideal: mTrab,
            sobreprecio_suc: 0.00,
            comision: num(sc.comision),
            active: true
          });
        }
      });
    });

    persistBranchPriceScales();
    cfgToast('Se copiaron las escalas de precios de Matriz a ' + (targets.length === 1 ? targets[0].name : 'la sucursal') + ' (para altas nuevas).');
  };

  global.cfgStartEditBranchScale = function (id) {
    _editingBranchScaleId = String(id || '');
    renderPrecios(_prods || [], _params || {});
    setTimeout(function () {
      var inp = byId('cfg-edit-besc-name-' + _editingBranchScaleId);
      if (inp) { inp.focus(); inp.select(); }
    }, 20);
  };

  global.cfgCancelEditBranchScale = function () {
    _editingBranchScaleId = '';
    renderPrecios(_prods || [], _params || {});
  };

  global.cfgCommitEditBranchScale = function (id) {
    var target = _branchPriceScales.filter(function (bs) { return bs.id === id; })[0];
    if (!target) { _editingBranchScaleId = ''; return; }

    var nameEl = byId('cfg-edit-besc-name-' + id);
    var margEl = byId('cfg-edit-besc-marg-' + id);
    var ajEl   = byId('cfg-edit-besc-aj-' + id);
    var comEl  = byId('cfg-edit-besc-com-' + id);

    var newName = norm(nameEl ? nameEl.value : target.scale_name);
    if (!newName) { if (nameEl) nameEl.focus(); return; }

    target.scale_name = newName;
    if (margEl) target.margen_ideal = num(margEl.value);
    if (ajEl)   target.sobreprecio_suc = num(ajEl.value);
    if (comEl)  target.comision = num(comEl.value);

    _editingBranchScaleId = '';
    persistBranchPriceScales();
    cfgToast('Escala por defecto «' + newName + '» en «' + target.branch_name + '» actualizada (para altas nuevas).');
  };

  global.cfgToggleBranchScaleActive = function (id) {
    var target = _branchPriceScales.filter(function (bs) { return bs.id === id; })[0];
    if (!target) return;
    target.active = !target.active;
    persistBranchPriceScales();
  };

  global.cfgDelBranchScale = function (id) {
    var target = _branchPriceScales.filter(function (bs) { return bs.id === id; })[0];
    if (!target) return;
    if (!window.confirm('¿Deseas eliminar la escala «' + target.scale_name + '» de la sucursal «' + target.branch_name + '»?')) return;
    _branchPriceScales = _branchPriceScales.filter(function (bs) { return bs.id !== id; });
    persistBranchPriceScales();
    cfgToast('Escala «' + target.scale_name + '» eliminada de «' + target.branch_name + '».');
  };

  function renderPrecios(items, params) {
    ensureAccordionStyles();
    var body = byId('cfg-precios-body');
    if (!body) return;

    if (!_priceScales || !_priceScales.length) {
      initPriceScalesState(_params || {}, _branches || []);
    }

    var mainMatriz = getMainMatrizBranch(_branches || []);
    var secondaryBranches = getSecondaryBranchesList(_branches || []);
    _branchPriceScales = (_branchPriceScales || []).filter(function (bs) {
      return bs && !isMainMatrizBranchKey(bs.branch_id, _branches) && !isMainMatrizBranchKey(bs.branch_name, _branches);
    });

    /* ── 1. BLOQUE: ESCALAS DE PRECIOS (MATRIZ / TIENDA #1 — POR DEFECTO PARA ALTAS NUEVAS) ── */
    var escOpen = !!_preciosDrawersOpen.escalas;
    var escRowsHtml = _priceScales.map(function (sc, idx) {
      var isLocked = !!sc.locked || norm(sc.name) === 'PRECIO DE LISTA';
      var numBadge = String(idx + 1).padStart(2, '0') + '.';

      if (_editingScaleId === sc.id) {
        return '<tr style="background:rgba(6,182,212,0.14);">' +
          '<td>' +
            '<input type="text" class="cfg-marca-edit-inp" id="cfg-edit-esc-name-' + esc(sc.id) + '" value="' + esc(sc.name) + '" ' +
              (isLocked ? 'readonly style="opacity:0.7;cursor:not-allowed;" ' : 'data-input="toUpperCase" ') +
              'data-keydown="cfgCommitEditPriceScale" data-keydown-key="Enter" data-keydown-prevent="true" data-click-arg="' + esc(sc.id) + '">' +
          '</td>' +
          '<td style="text-align:right;">' +
            '<input type="number" step="0.01" class="cfg-marca-edit-inp" id="cfg-edit-esc-marg-' + esc(sc.id) + '" value="' + fmt2(sc.margen_ideal) + '" style="width:92px;text-align:right;" ' +
              'data-keydown="cfgCommitEditPriceScale" data-keydown-key="Enter" data-keydown-prevent="true" data-click-arg="' + esc(sc.id) + '">' +
          '</td>' +
          '<td style="text-align:right;">' +
            '<input type="number" step="0.01" class="cfg-marca-edit-inp" id="cfg-edit-esc-ofer-' + esc(sc.id) + '" value="' + fmt2(sc.oferta) + '" style="width:86px;text-align:right;" ' +
              'data-keydown="cfgCommitEditPriceScale" data-keydown-key="Enter" data-keydown-prevent="true" data-click-arg="' + esc(sc.id) + '">' +
          '</td>' +
          '<td style="text-align:right;">' +
            '<input type="number" step="0.01" class="cfg-marca-edit-inp" id="cfg-edit-esc-com-' + esc(sc.id) + '" value="' + fmt2(sc.comision) + '" style="width:86px;text-align:right;" ' +
              'data-keydown="cfgCommitEditPriceScale" data-keydown-key="Enter" data-keydown-prevent="true" data-click-arg="' + esc(sc.id) + '">' +
          '</td>' +
          '<td style="text-align:center;">—</td>' +
          '<td style="text-align:right;">' +
            '<div class="cfg-marca-actions" style="justify-content:flex-end;">' +
              '<button type="button" class="cfg-marca-btn edit" title="Guardar (Enter)" data-click="cfgCommitEditPriceScale" data-click-arg="' + esc(sc.id) + '"><i class="fa-solid fa-check"></i></button>' +
              '<button type="button" class="cfg-marca-btn" title="Cancelar (Esc)" data-click="cfgCancelEditPriceScale"><i class="fa-solid fa-xmark"></i></button>' +
            '</div>' +
          '</td>' +
        '</tr>';
      }

      return '<tr>' +
        '<td>' +
          '<div style="display:flex;align-items:center;gap:8px;">' +
            '<span style="font-family:monospace;font-size:11px;color:var(--text-muted,#64748b);">' + numBadge + '</span>' +
            '<span style="font-weight:800;color:var(--text-primary,#f8fafc);letter-spacing:.3px;">' + esc(sc.name) + '</span>' +
            (isLocked ? '<span class="cfg-iva-def-badge">BASE</span>' : '') +
          '</div>' +
        '</td>' +
        '<td style="text-align:right;font-weight:800;color:#38bdf8;">' + fmt2(sc.margen_ideal) + ' %</td>' +
        '<td style="text-align:right;color:var(--text-secondary,#94a3b8);">' + fmt2(sc.oferta) + ' %</td>' +
        '<td style="text-align:right;color:var(--text-secondary,#94a3b8);">' + fmt2(sc.comision) + ' %</td>' +
        '<td style="text-align:center;">' +
          '<button type="button" data-click="cfgTogglePriceScaleActive" data-click-arg="' + esc(sc.id) + '" ' +
            'style="cursor:pointer;border:1px solid ' + (sc.active ? 'rgba(16,185,129,.4)' : 'rgba(148,163,184,.25)') + ';background:' + (sc.active ? 'rgba(16,185,129,.15)' : 'rgba(15,23,42,.5)') + ';color:' + (sc.active ? '#10b981' : '#94a3b8') + ';font-size:10.5px;font-weight:800;padding:2px 9px;border-radius:999px;">' +
            (sc.active ? 'ACTIVA' : 'INACTIVA') +
          '</button>' +
        '</td>' +
        '<td style="text-align:right;">' +
          '<div class="cfg-marca-actions" style="justify-content:flex-end;">' +
            '<button type="button" class="cfg-marca-btn edit" title="Editar escala «' + esc(sc.name) + '»" data-click="cfgStartEditPriceScale" data-click-arg="' + esc(sc.id) + '">' +
              '<i class="fa-solid fa-pen"></i>' +
            '</button>' +
            '<button type="button" class="cfg-marca-btn ' + (isLocked ? 'del-locked' : 'del-active') + '" ' +
              'title="' + (isLocked ? 'Escala base del sistema (no se puede eliminar)' : ('Eliminar escala «' + esc(sc.name) + '»')) + '" ' +
              'data-click="cfgDelPriceScale" data-click-arg="' + esc(sc.id) + '">' +
              '<i class="fa-solid ' + (isLocked ? 'fa-lock' : 'fa-trash-can') + '"></i>' +
            '</button>' +
          '</div>' +
        '</td>' +
      '</tr>';
    }).join('');

    var escalasCardHtml =
      '<div class="cfg-drawer cfg-drawer-marcas' + (escOpen ? ' open' : '') + '" style="margin-bottom:16px;">' +
        '<div class="cfg-drawer-head" data-click="cfgTogglePreciosDrawer" data-click-arg="escalas">' +
          '<div class="cfg-drawer-title">' +
            '<i class="fa-solid fa-tags"></i>' +
            '<span>ESCALAS DE PRECIOS — MATRIZ (' + esc(mainMatriz.name) + ')</span>' +
            '<span class="cfg-marca-count-badge">' + _priceScales.length + '</span>' +
          '</div>' +
          '<span class="cfg-drawer-arrow">' + (escOpen ? '▲' : '▼') + '</span>' +
        '</div>' +
        '<div class="cfg-drawer-body">' +
          '<div class="cfg-marca-add-bar" style="flex-wrap:wrap;gap:8px;margin-bottom:12px;">' +
            '<input type="text" class="cfg-marca-inp" id="cfg-esc-name-inp" placeholder="Nueva escala de precio (ej. MAYOREO, DISTRIBUIDOR, ESPECIAL)..." ' +
              'style="min-width:240px;flex:2;" data-input="toUpperCase" ' +
              'data-keydown="cfgAddPriceScale" data-keydown-key="Enter" data-keydown-prevent="true">' +
            '<div style="display:flex;align-items:center;gap:5px;background:var(--bg-card-2,#1e293b);border:1px solid var(--border,#334155);border-radius:8px;padding:0 9px;height:34px;" title="Margen Ideal (%)">' +
              '<span style="font-size:11px;font-weight:700;color:#94a3b8;">Margen %</span>' +
              '<input type="number" step="0.01" id="cfg-esc-margen-inp" value="20.00" style="width:68px;background:transparent;border:none;color:#38bdf8;font-weight:800;font-size:12.5px;text-align:right;outline:none;" ' +
                'data-keydown="cfgAddPriceScale" data-keydown-key="Enter" data-keydown-prevent="true">' +
            '</div>' +
            '<div style="display:flex;align-items:center;gap:5px;background:var(--bg-card-2,#1e293b);border:1px solid var(--border,#334155);border-radius:8px;padding:0 9px;height:34px;" title="Oferta / Descuento (%)">' +
              '<span style="font-size:11px;font-weight:700;color:#94a3b8;">Oferta %</span>' +
              '<input type="number" step="0.01" id="cfg-esc-oferta-inp" value="0.00" style="width:60px;background:transparent;border:none;color:#f8fafc;font-weight:700;font-size:12.5px;text-align:right;outline:none;" ' +
                'data-keydown="cfgAddPriceScale" data-keydown-key="Enter" data-keydown-prevent="true">' +
            '</div>' +
            '<div style="display:flex;align-items:center;gap:5px;background:var(--bg-card-2,#1e293b);border:1px solid var(--border,#334155);border-radius:8px;padding:0 9px;height:34px;" title="Comisión de Venta (%)">' +
              '<span style="font-size:11px;font-weight:700;color:#94a3b8;">Comisión %</span>' +
              '<input type="number" step="0.01" id="cfg-esc-comision-inp" value="0.00" style="width:60px;background:transparent;border:none;color:#f8fafc;font-weight:700;font-size:12.5px;text-align:right;outline:none;" ' +
                'data-keydown="cfgAddPriceScale" data-keydown-key="Enter" data-keydown-prevent="true">' +
            '</div>' +
            '<button type="button" class="cfg-marca-btn-add" data-click="cfgAddPriceScale">' +
              '<i class="fa-solid fa-plus"></i> Agregar Escala' +
            '</button>' +
          '</div>' +
          '<div style="overflow-x:auto;border:1px solid var(--border,#1e293b);border-radius:9px;">' +
            '<table class="cfg-table">' +
              '<thead>' +
                '<tr>' +
                  '<th>Escala de Precio</th>' +
                  '<th>Margen Ideal</th>' +
                  '<th>Oferta</th>' +
                  '<th>Comisión Venta</th>' +
                  '<th style="text-align:center;">Estado (V)</th>' +
                  '<th style="width:90px;text-align:right;">Acciones</th>' +
                '</tr>' +
              '</thead>' +
              '<tbody>' + escRowsHtml + '</tbody>' +
            '</table>' +
          '</div>' +
          '<div class="cfg-marca-footer">' +
            '<span>Catálogo por defecto únicamente para altas nuevas (no afecta precios ni escalas de productos ya dados de alta)</span>' +
          '</div>' +
        '</div>' +
      '</div>';

    /* ── 2. BLOQUE: ESCALAS DE PRECIOS DE LAS SUCURSALES (SOLO SUCURSALES REGISTRADAS) ── */
    var sucOpen = !!_preciosDrawersOpen.sucursales;
    var validFilter = secondaryBranches.some(function (b) {
      return String(b.id) === String(_activeBranchScaleFilter) || norm(b.name) === norm(_activeBranchScaleFilter);
    });
    if (!validFilter) {
      _activeBranchScaleFilter = secondaryBranches.length ? String(secondaryBranches[0].id || secondaryBranches[0].name) : '';
    }
    var filteredBranchScales = _branchPriceScales.filter(function (bs) {
      if (!_activeBranchScaleFilter) return true;
      return String(bs.branch_id) === String(_activeBranchScaleFilter) || norm(bs.branch_name) === norm(_activeBranchScaleFilter);
    });

    var branchFilterPills = secondaryBranches.map(function (b) {
      var bId = String(b.id || b.name);
      var bName = norm(b.name || b.id);
      var cnt = _branchPriceScales.filter(function (bs) {
        return String(bs.branch_id) === bId || norm(bs.branch_name) === bName;
      }).length;
      var isAct = (_activeBranchScaleFilter === bId || norm(_activeBranchScaleFilter) === bName);
      return '<button type="button" class="cfg-chip cfg-chip-sel' + (isAct ? ' active' : '') + '" ' +
        'data-click="cfgFilterBranchScales" data-click-arg="' + esc(bId) + '">' +
        '<i class="fa-solid fa-store"></i> ' + esc(bName) + ' <em>' + cnt + '</em>' +
      '</button>';
    }).join('');

    var branchSelectOptions = secondaryBranches.map(function (b) {
      var bId = String(b.id || b.name);
      var bName = norm(b.name || b.id);
      var sel = (_activeBranchScaleFilter === bId || norm(_activeBranchScaleFilter) === bName);
      return '<option value="' + esc(bId) + '"' + (sel ? ' selected' : '') + '>' + esc(bName) + '</option>';
    }).join('');

    var scaleDatalistOptions = _priceScales.map(function (s) {
      return '<option value="' + esc(s.name) + '"></option>';
    }).join('');

    var branchScaleRowsHtml = filteredBranchScales.length ? filteredBranchScales.map(function (bs) {
      var margenFinal = num(bs.margen_ideal) + num(bs.sobreprecio_suc);

      if (_editingBranchScaleId === bs.id) {
        return '<tr style="background:rgba(6,182,212,0.14);">' +
          '<td><span class="cfg-chip" style="padding:2px 9px;font-size:11px;"><i class="fa-solid fa-store"></i> ' + esc(bs.branch_name) + '</span></td>' +
          '<td>' +
            '<input type="text" class="cfg-marca-edit-inp" id="cfg-edit-besc-name-' + esc(bs.id) + '" value="' + esc(bs.scale_name) + '" data-input="toUpperCase" ' +
              'data-keydown="cfgCommitEditBranchScale" data-keydown-key="Enter" data-keydown-prevent="true" data-click-arg="' + esc(bs.id) + '">' +
          '</td>' +
          '<td style="text-align:right;">' +
            '<input type="number" step="0.01" class="cfg-marca-edit-inp" id="cfg-edit-besc-marg-' + esc(bs.id) + '" value="' + fmt2(bs.margen_ideal) + '" style="width:84px;text-align:right;" ' +
              'data-keydown="cfgCommitEditBranchScale" data-keydown-key="Enter" data-keydown-prevent="true" data-click-arg="' + esc(bs.id) + '">' +
          '</td>' +
          '<td style="text-align:right;">' +
            '<input type="number" step="0.01" class="cfg-marca-edit-inp" id="cfg-edit-besc-aj-' + esc(bs.id) + '" value="' + fmt2(bs.sobreprecio_suc) + '" style="width:84px;text-align:right;" ' +
              'data-keydown="cfgCommitEditBranchScale" data-keydown-key="Enter" data-keydown-prevent="true" data-click-arg="' + esc(bs.id) + '">' +
          '</td>' +
          '<td style="text-align:right;font-weight:800;color:#10b981;">' + fmt2(margenFinal) + ' %</td>' +
          '<td style="text-align:right;">' +
            '<input type="number" step="0.01" class="cfg-marca-edit-inp" id="cfg-edit-besc-com-' + esc(bs.id) + '" value="' + fmt2(bs.comision) + '" style="width:78px;text-align:right;" ' +
              'data-keydown="cfgCommitEditBranchScale" data-keydown-key="Enter" data-keydown-prevent="true" data-click-arg="' + esc(bs.id) + '">' +
          '</td>' +
          '<td style="text-align:center;">—</td>' +
          '<td style="text-align:right;">' +
            '<div class="cfg-marca-actions" style="justify-content:flex-end;">' +
              '<button type="button" class="cfg-marca-btn edit" title="Guardar (Enter)" data-click="cfgCommitEditBranchScale" data-click-arg="' + esc(bs.id) + '"><i class="fa-solid fa-check"></i></button>' +
              '<button type="button" class="cfg-marca-btn" title="Cancelar (Esc)" data-click="cfgCancelEditBranchScale"><i class="fa-solid fa-xmark"></i></button>' +
            '</div>' +
          '</td>' +
        '</tr>';
      }

      return '<tr>' +
        '<td>' +
          '<span class="cfg-chip" style="padding:3px 10px;font-size:11.5px;background:rgba(6,182,212,0.12);border-color:rgba(6,182,212,0.35);color:#38bdf8;">' +
            '<i class="fa-solid fa-store"></i> ' + esc(bs.branch_name) +
          '</span>' +
        '</td>' +
        '<td style="font-weight:800;color:var(--text-primary,#f8fafc);">' + esc(bs.scale_name) + '</td>' +
        '<td style="text-align:right;font-weight:700;color:#38bdf8;">' + fmt2(bs.margen_ideal) + ' %</td>' +
        '<td style="text-align:right;font-weight:700;color:' + (num(bs.sobreprecio_suc) > 0 ? '#f59e0b' : 'var(--text-secondary,#94a3b8)') + ';">' +
          (num(bs.sobreprecio_suc) >= 0 ? '+' : '') + fmt2(bs.sobreprecio_suc) + ' %' +
        '</td>' +
        '<td style="text-align:right;font-weight:800;color:#10b981;">' + fmt2(margenFinal) + ' %</td>' +
        '<td style="text-align:right;color:var(--text-secondary,#94a3b8);">' + fmt2(bs.comision) + ' %</td>' +
        '<td style="text-align:center;">' +
          '<button type="button" data-click="cfgToggleBranchScaleActive" data-click-arg="' + esc(bs.id) + '" ' +
            'style="cursor:pointer;border:1px solid ' + (bs.active ? 'rgba(16,185,129,.4)' : 'rgba(148,163,184,.25)') + ';background:' + (bs.active ? 'rgba(16,185,129,.15)' : 'rgba(15,23,42,.5)') + ';color:' + (bs.active ? '#10b981' : '#94a3b8') + ';font-size:10.5px;font-weight:800;padding:2px 9px;border-radius:999px;">' +
            (bs.active ? 'ACTIVA' : 'INACTIVA') +
          '</button>' +
        '</td>' +
        '<td style="text-align:right;">' +
          '<div class="cfg-marca-actions" style="justify-content:flex-end;">' +
            '<button type="button" class="cfg-marca-btn edit" title="Editar escala en sucursal" data-click="cfgStartEditBranchScale" data-click-arg="' + esc(bs.id) + '">' +
              '<i class="fa-solid fa-pen"></i>' +
            '</button>' +
            '<button type="button" class="cfg-marca-btn del-active" title="Eliminar escala de esta sucursal" data-click="cfgDelBranchScale" data-click-arg="' + esc(bs.id) + '">' +
              '<i class="fa-solid fa-trash-can"></i>' +
            '</button>' +
          '</div>' +
        '</td>' +
      '</tr>';
    }).join('') : (
      '<tr><td colspan="8" style="text-align:center;padding:18px;color:var(--text-muted,#64748b);">' +
        'No hay escalas registradas para la sucursal seleccionada. Usa la barra superior para dar de alta una escala de precios en la sucursal.' +
      '</td></tr>'
    );

    var sucursalesCardHtml =
      '<div class="cfg-drawer cfg-drawer-marcas' + (sucOpen ? ' open' : '') + '">' +
        '<div class="cfg-drawer-head" data-click="cfgTogglePreciosDrawer" data-click-arg="sucursales">' +
          '<div class="cfg-drawer-title">' +
            '<i class="fa-solid fa-store"></i>' +
            '<span>ESCALAS DE PRECIOS DE LAS SUCURSALES</span>' +
            '<span class="cfg-marca-count-badge">' + _branchPriceScales.length + '</span>' +
          '</div>' +
          '<span class="cfg-drawer-arrow">' + (sucOpen ? '▲' : '▼') + '</span>' +
        '</div>' +
        '<div class="cfg-drawer-body">' +
          /* Filtro por Sucursal + Botón Copiar escalas de precios */
          '<div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:10px;margin-bottom:12px;padding-bottom:10px;border-bottom:1px solid var(--border,#1e293b);">' +
            '<div class="cfg-chips" style="gap:8px;">' + branchFilterPills + '</div>' +
            '<button type="button" class="btn btn-secondary btn-sm" data-click="cfgSyncGeneralScalesToBranches" title="Copia las escalas configuradas en Matriz a la(s) sucursal(es)">' +
              '<i class="fa-solid fa-copy" style="color:#06b6d4;"></i> Copiar escalas de precios' +
            '</button>' +
          '</div>' +

          /* Barra de Alta de Escala de Precios por Sucursal */
          '<div style="background:rgba(6,182,212,0.06);border:1px solid rgba(6,182,212,0.28);border-radius:10px;padding:10px 12px;margin-bottom:12px;">' +
            '<div style="font-size:11px;font-weight:800;color:#06b6d4;text-transform:uppercase;letter-spacing:.4px;margin-bottom:8px;display:flex;align-items:center;gap:6px;">' +
              '<i class="fa-solid fa-plus-circle"></i> Alta de Escala de Precios por Sucursal (Referencia para Altas Nuevas)' +
            '</div>' +
            '<div class="cfg-marca-add-bar" style="flex-wrap:wrap;gap:8px;margin-bottom:0;">' +
              '<select id="cfg-besc-branch-sel" class="cfg-marca-inp" style="min-width:190px;flex:1;cursor:pointer;">' +
                branchSelectOptions +
              '</select>' +
              '<input type="text" list="cfg-besc-datalist" class="cfg-marca-inp" id="cfg-besc-scale-inp" ' +
                'placeholder="Escala en sucursal (ej. PRECIO DE LISTA, MAYOREO, ESPECIAL FORÁNEO)..." ' +
                'style="min-width:240px;flex:2;" data-input="toUpperCase" ' +
                'data-keydown="cfgAddBranchPriceScale" data-keydown-key="Enter" data-keydown-prevent="true">' +
              '<datalist id="cfg-besc-datalist">' + scaleDatalistOptions + '</datalist>' +
              '<div style="display:flex;align-items:center;gap:5px;background:var(--bg-card-2,#1e293b);border:1px solid var(--border,#334155);border-radius:8px;padding:0 9px;height:34px;" title="Margen Base de la Escala en la Sucursal (%)">' +
                '<span style="font-size:11px;font-weight:700;color:#94a3b8;">Margen %</span>' +
                '<input type="number" step="0.01" id="cfg-besc-margen-inp" value="25.00" style="width:66px;background:transparent;border:none;color:#38bdf8;font-weight:800;font-size:12.5px;text-align:right;outline:none;" ' +
                  'data-keydown="cfgAddBranchPriceScale" data-keydown-key="Enter" data-keydown-prevent="true">' +
              '</div>' +
              '<div style="display:flex;align-items:center;gap:5px;background:var(--bg-card-2,#1e293b);border:1px solid var(--border,#334155);border-radius:8px;padding:0 9px;height:34px;" title="Sobreprecio o Ajuste adicional de la Sucursal (%)">' +
                '<span style="font-size:11px;font-weight:700;color:#94a3b8;">+ Ajuste Suc. %</span>' +
                '<input type="number" step="0.01" id="cfg-besc-ajuste-inp" value="0.00" style="width:62px;background:transparent;border:none;color:#f59e0b;font-weight:800;font-size:12.5px;text-align:right;outline:none;" ' +
                  'data-keydown="cfgAddBranchPriceScale" data-keydown-key="Enter" data-keydown-prevent="true">' +
              '</div>' +
              '<div style="display:flex;align-items:center;gap:5px;background:var(--bg-card-2,#1e293b);border:1px solid var(--border,#334155);border-radius:8px;padding:0 9px;height:34px;" title="Comisión de Venta en la Sucursal (%)">' +
                '<span style="font-size:11px;font-weight:700;color:#94a3b8;">Comisión %</span>' +
                '<input type="number" step="0.01" id="cfg-besc-comision-inp" value="0.00" style="width:58px;background:transparent;border:none;color:#f8fafc;font-weight:700;font-size:12.5px;text-align:right;outline:none;" ' +
                  'data-keydown="cfgAddBranchPriceScale" data-keydown-key="Enter" data-keydown-prevent="true">' +
              '</div>' +
              '<button type="button" class="cfg-marca-btn-add" data-click="cfgAddBranchPriceScale">' +
                '<i class="fa-solid fa-plus"></i> Alta Escala Sucursal' +
              '</button>' +
            '</div>' +
          '</div>' +

          /* Tabla de Escalas por Sucursal */
          '<div style="overflow-x:auto;border:1px solid var(--border,#1e293b);border-radius:9px;">' +
            '<table class="cfg-table">' +
              '<thead>' +
                '<tr>' +
                  '<th>Sucursal</th>' +
                  '<th>Escala de Precio</th>' +
                  '<th>Margen Base</th>' +
                  '<th>Ajuste Sucursal</th>' +
                  '<th>Margen Final</th>' +
                  '<th>Comisión</th>' +
                  '<th style="text-align:center;">Estado</th>' +
                  '<th style="width:90px;text-align:right;">Acciones</th>' +
                '</tr>' +
              '</thead>' +
              '<tbody>' + branchScaleRowsHtml + '</tbody>' +
            '</table>' +
          '</div>' +
          '<div class="cfg-marca-footer">' +
            '<span>Mostrando ' + filteredBranchScales.length + ' de ' + _branchPriceScales.length + ' escalas por defecto de sucursales (' + secondaryBranches.length + ' sucursales registradas — únicamente para altas nuevas)</span>' +
          '</div>' +
        '</div>' +
      '</div>';

    body.innerHTML = escalasCardHtml + sucursalesCardHtml;
  }

  /* ── Sincronización en vivo con la ventana Precios (F2) en Alta de Producto (#modal-cambio-precio) y POS en Tiempo Real ── */
  var _modalPrecioViewMode = 'escalas'; // 'escalas' (Matriz) | 'sucursales'
  var _modalBranchFilter = '';
  var _modalPrecioSnapshot = null;
  var _modalBranchDropdownOpen = false;
  var _modalBranchDropdownIdx = 0;
  var _posSyncChannel = null;
  try {
    if (typeof BroadcastChannel !== 'undefined') {
      _posSyncChannel = new BroadcastChannel('calebsys_pos_sync');
    }
  } catch (e) {}

  function broadcastPosPricingRealtime(extraPayload) {
    var payload = Object.assign({
      type: 'PRICE_SCALES_UPDATED',
      ts: Date.now(),
      price_scales: _priceScales || [],
      branch_price_scales: _branchPriceScales || []
    }, extraPayload || {});
    try {
      localStorage.setItem('calebsys_pos_sync_event_v1', JSON.stringify(payload));
    } catch (e) {}
    try {
      if (_posSyncChannel) _posSyncChannel.postMessage(payload);
    } catch (e) {}
    try {
      window.dispatchEvent(new CustomEvent('calebsys:pos-pricing-updated', { detail: payload }));
    } catch (e) {}
  }
  global.broadcastPosPricingRealtime = broadcastPosPricingRealtime;

  function getEffectiveProductCostContext() {
    var isUsd = !!(byId('pa-is-usd') && byId('pa-is-usd').checked);
    var tc = num((byId('pa-tc-rate') && byId('pa-tc-rate').value) || 17.50) || 17.50;
    var costoEl = byId('pa-costo');
    var fleteEl = byId('pa-flete-pct');
    var paqQtyEl = byId('pa-paquete-qty');
    var ivaEl = byId('pa-iva');
    var margenEl = byId('pa-margen');
    var precioFinEl = byId('pa-precio-final');

    var iepsEl = byId('pa-ieps');
    var exentoEl = byId('pa-kardex-exento-iva');
    var costoRaw = costoEl ? num(costoEl.value) : 0;
    var fletePct = fleteEl ? num(fleteEl.value) : 0;
    var cantPiezas = Math.max(1, paqQtyEl ? num(paqQtyEl.value || 1) : 1);
    var exentoIva = !!(exentoEl && exentoEl.checked);
    var ivaPct = exentoIva ? 0 : ((ivaEl && ivaEl.value !== '') ? num(ivaEl.value) : 16);
    var iepsPct = (iepsEl && iepsEl.value !== '') ? num(iepsEl.value) : 0;
    var factorIva = (1 + (ivaPct / 100)) * (1 + (iepsPct / 100));

    var costoCajaPesos = isUsd ? (costoRaw * tc) : costoRaw;
    var montoFleteCaja = costoCajaPesos * (fletePct / 100);
    var costoCajaConFlete = costoCajaPesos + montoFleteCaja;
    var costoUnitSinFlete = cantPiezas > 1 ? (costoCajaPesos / cantPiezas) : costoCajaPesos;
    var costoUnitConFlete = cantPiezas > 1 ? (costoCajaConFlete / cantPiezas) : costoCajaConFlete;
    var montoFleteUnit = Math.max(0, costoUnitConFlete - costoUnitSinFlete);
    var costoPisoConIva = Number((costoUnitConFlete * factorIva).toFixed(2));

    return {
      isUsd: isUsd,
      tc: tc,
      costoRaw: costoRaw,
      fletePct: fletePct,
      cantPiezas: cantPiezas,
      exentoIva: exentoIva,
      ivaPct: ivaPct,
      iepsPct: iepsPct,
      factorIva: factorIva,
      costoPisoConIva: costoPisoConIva,
      costoCajaPesos: costoCajaPesos,
      montoFleteCaja: montoFleteCaja,
      costoCajaConFlete: costoCajaConFlete,
      costoUnitSinFlete: costoUnitSinFlete,
      montoFleteUnit: montoFleteUnit,
      costoUnitConFlete: costoUnitConFlete,
      formMargen: margenEl ? num(margenEl.value) : 0,
      formPrecioFinal: precioFinEl ? num(precioFinEl.value) : 0
    };
  }
  global.getEffectiveProductCostContext = getEffectiveProductCostContext;

  function ensureProductScalesInitialized() {
    if (!_priceScales || !_priceScales.length) {
      initPriceScalesState(_params || {}, _branches || []);
    }
    var ctx = getEffectiveProductCostContext();
    var costoRef = ctx.costoUnitConFlete;
    var factorIva = ctx.factorIva;
    var isExistingProd = !!global._paLoadedExistingProduct;
    var secondaryBranches = getSecondaryBranchesList(_branches || []);

    var catalogScaleOrder = {};
    (_priceScales || []).forEach(function (sc, idx) {
      if (sc && sc.active !== false) {
        catalogScaleOrder[norm(sc.name || sc.scale_name)] = idx + 1;
      }
    });

    if (!Array.isArray(global._paProductPriceScales) || !global._paProductPriceScales.length) {
      global._paProductPriceScales = (_priceScales || []).filter(function (sc) {
        return sc && sc.active !== false;
      }).map(function (sc, idx) {
        var mIdeal = num(sc.margen_ideal);
        var ofer = num(sc.oferta);
        var mTrab = mIdeal - ofer;
        var calcP = costoRef > 0 ? (costoRef * (1 + mTrab / 100) * factorIva) : 0;
        return {
          id: sc.id || ('esc-' + (idx + 1)),
          scale_name: norm(sc.name || sc.scale_name || ('ESCALA ' + (idx + 1))),
          nombre: norm(sc.name || sc.scale_name || ('ESCALA ' + (idx + 1))),
          margen_ideal: mIdeal,
          oferta: ofer,
          margen_trabajo: mTrab,
          comision: num(sc.comision),
          activa: sc.active !== false,
          locked: !!sc.locked || idx === 0,
          costo_con_flete: costoRef,
          precio: Number(calcP.toFixed(2)),
          precio_activo: Number(calcP.toFixed(2)),
          price: Number(calcP.toFixed(2)),
          margin: Number(mTrab.toFixed(4))
        };
      });
    } else {
      // Filtrar escalas que hayan sido eliminadas del catálogo de configuración
      if (Object.keys(catalogScaleOrder).length > 0) {
        global._paProductPriceScales = global._paProductPriceScales.filter(function (ps) {
          return !!catalogScaleOrder[norm(ps.scale_name || ps.nombre)];
        });
      }
      (_priceScales || []).forEach(function (sc, idx) {
        if (!sc || sc.active === false) return;
        var nm = norm(sc.name || sc.scale_name);
        var found = global._paProductPriceScales.some(function (ps) {
          return norm(ps.scale_name || ps.nombre) === nm;
        });
        if (!found && nm) {
          var mIdeal = num(sc.margen_ideal);
          var ofer = num(sc.oferta);
          var mTrab = mIdeal - ofer;
          var calcP = costoRef > 0 ? (costoRef * (1 + mTrab / 100) * factorIva) : 0;
          global._paProductPriceScales.push({
            id: sc.id || ('esc-' + (idx + 1)),
            scale_name: nm,
            nombre: nm,
            margen_ideal: mIdeal,
            oferta: ofer,
            margen_trabajo: mTrab,
            comision: num(sc.comision),
            activa: sc.active !== false,
            locked: !!sc.locked,
            costo_con_flete: costoRef,
            precio: Number(calcP.toFixed(2)),
            precio_activo: Number(calcP.toFixed(2)),
            price: Number(calcP.toFixed(2)),
            margin: Number(mTrab.toFixed(4))
          });
        }
      });
      global._paProductPriceScales.sort(function (a, b) {
        return (catalogScaleOrder[norm(a.scale_name || a.nombre)] || 999) - (catalogScaleOrder[norm(b.scale_name || b.nombre)] || 999);
      });
    }

    // Filtrar cualquier registro redundante de MATRIZ, sucursales inexistentes o escalas eliminadas del catálogo
    if (Array.isArray(global._paProductBranchScales)) {
      global._paProductBranchScales = global._paProductBranchScales.filter(function (bs) {
        if (!bs || isMainMatrizBranchKey(bs.branch_id, _branches) || isMainMatrizBranchKey(bs.branch_name, _branches)) return false;
        if (Object.keys(catalogScaleOrder).length > 0 && !catalogScaleOrder[norm(bs.scale_name)]) return false;
        if (secondaryBranches.length > 0) {
          var bNm = norm(bs.branch_name || bs.branch_id);
          var bId = String(bs.branch_id || '').trim().toUpperCase();
          return secondaryBranches.some(function (sb) {
            return String(sb.id).trim().toUpperCase() === bId || norm(sb.name) === bNm;
          });
        }
        return true;
      });
      global._paProductBranchScales.sort(function (a, b) {
        return (catalogScaleOrder[norm(a.scale_name)] || 999) - (catalogScaleOrder[norm(b.scale_name)] || 999);
      });
    }

    if (!Array.isArray(global._paProductBranchScales) || !global._paProductBranchScales.length) {
      var seedBrScales = (_branchPriceScales || []).filter(function (bs) {
        return bs && !isMainMatrizBranchKey(bs.branch_id, _branches) && !isMainMatrizBranchKey(bs.branch_name, _branches);
      });
      if (seedBrScales.length) {
        global._paProductBranchScales = seedBrScales.map(function (bs, idx) {
          var mBase = num(bs.margen_ideal);
          var mAj = num(bs.sobreprecio_suc);
          var mOfer = num(bs.oferta);
          var mFin = mBase + mAj - mOfer;
          var calcP = costoRef > 0 ? (costoRef * (1 + mFin / 100) * factorIva) : 0;
          return {
            id: bs.id || ('besc-' + (idx + 1)),
            branch_id: String(bs.branch_id || ''),
            branch_name: norm(bs.branch_name || bs.branch_id || ''),
            scale_name: norm(bs.scale_name || 'PRECIO DE LISTA'),
            margen_ideal: mBase,
            sobreprecio_suc: mAj,
            oferta: mOfer,
            margen_final: mFin,
            comision: num(bs.comision),
            activa: bs.active !== false,
            costo_con_flete: costoRef,
            precio: Number(calcP.toFixed(2)),
            precio_activo: Number(calcP.toFixed(2)),
            price: Number(calcP.toFixed(2))
          };
        });
      } else {
        var built = [];
        var seqB = 1;
        secondaryBranches.forEach(function (br) {
          var bId = String(br.id || br.name);
          var bNm = norm(br.name || br.id);
          (global._paProductPriceScales || []).forEach(function (ps) {
            var mT = num(ps.margen_trabajo != null ? ps.margen_trabajo : ps.margen_ideal);
            var pVal = num(ps.precio);
            built.push({
              id: 'besc-' + (seqB++),
              branch_id: bId,
              branch_name: bNm,
              scale_name: norm(ps.scale_name || ps.nombre),
              margen_ideal: mT,
              sobreprecio_suc: 0,
              oferta: 0,
              margen_final: mT,
              comision: num(ps.comision),
              activa: ps.activa !== false,
              costo_con_flete: costoRef,
              precio: pVal,
              precio_activo: pVal,
              price: pVal
            });
          });
        });
        global._paProductBranchScales = built;
      }
    } else {
      // Asegurar que cada sucursal secundaria registrada tenga las escalas del producto sin sobreescribir las ya existentes
      var seqEx = global._paProductBranchScales.length + 1;
      secondaryBranches.forEach(function (br) {
        var bId = String(br.id || br.name);
        var bNm = norm(br.name || br.id);
        (global._paProductPriceScales || []).forEach(function (ps) {
          var sNm = norm(ps.scale_name || ps.nombre);
          var found = global._paProductBranchScales.some(function (pbs) {
            return (String(pbs.branch_id).toUpperCase() === bId.toUpperCase() || norm(pbs.branch_name) === bNm) && norm(pbs.scale_name) === sNm;
          });
          if (!found && sNm) {
            var mT = num(ps.margen_trabajo != null ? ps.margen_trabajo : ps.margen_ideal);
            var calcP = costoRef > 0 ? (costoRef * (1 + mT / 100) * factorIva) : num(ps.precio);
            var rP = Number(calcP.toFixed(2));
            global._paProductBranchScales.push({
              id: 'besc-' + (seqEx++),
              branch_id: bId,
              branch_name: bNm,
              scale_name: sNm,
              margen_ideal: mT,
              sobreprecio_suc: 0,
              oferta: 0,
              margen_final: mT,
              comision: num(ps.comision),
              activa: ps.activa !== false,
              costo_con_flete: costoRef,
              precio: rP,
              precio_activo: rP,
              price: rP
            });
          }
        });
      });
    }
    if (!Array.isArray(global._paProductOffers)) {
      global._paProductOffers = [];
    }
  }

  function formatPublicScaleName(name) {
    var n = norm(name || 'PRECIO DE LISTA');
    return (n === 'PRECIO DE LISTA' || n === 'PRECIO PUBLICO' || n === 'PRECIO PÚBLICO') ? 'PRECIO PÚBLICO' : n;
  }

  function getActiveProductAltaBranchScaleSelection() {
    var sel = byId('pa-sucursal-escala-select');
    var raw = (sel && sel.value) ? String(sel.value) : 'MATRIZ||PRECIO DE LISTA';
    var parts = raw.split('||');
    var bName = norm(parts[0] || 'MATRIZ') || 'MATRIZ';
    if (isMainMatrizBranchKey(bName, _branches)) bName = 'MATRIZ';
    var sName = norm(parts[1] || 'PRECIO DE LISTA') || 'PRECIO DE LISTA';
    if (sName === 'PRECIO PUBLICO' || sName === 'PRECIO PÚBLICO') sName = 'PRECIO DE LISTA';
    return { key: bName + '||' + sName, branch_name: bName, scale_name: sName };
  }

  function updateScaleItemPriceAndTrend(item, newPrice, idealRefPrice, isBranchScale) {
    var p = Number(num(newPrice).toFixed(2));
    var prevCurrent = num(item.precio);
    if (p > 0 && (!item._baselinePrice || item._baselinePrice <= 0)) {
      item._baselinePrice = prevCurrent > 0 ? prevCurrent : p;
    }
    if (prevCurrent > 0 && (!item._lastStepPrice || item._lastStepPrice <= 0)) {
      item._lastStepPrice = prevCurrent;
    }

    var refP = 0;
    if (item._lastStepPrice > 0 && Math.abs(p - item._lastStepPrice) >= 0.01) {
      refP = item._lastStepPrice;
    } else if (item._baselinePrice > 0 && Math.abs(p - item._baselinePrice) >= 0.01) {
      refP = item._baselinePrice;
    }

    if (refP > 0 && p > 0) {
      if (p > refP + 0.005) {
        item.trend = 'up';
        item.prev_price = Number(refP.toFixed(2));
      } else if (p < refP - 0.005) {
        item.trend = 'down';
        item.prev_price = Number(refP.toFixed(2));
      }
    } else if ((!item.trend || item.trend === 'same') && idealRefPrice > 0 && p > 0 && Math.abs(p - idealRefPrice) >= 0.01) {
      if (p > idealRefPrice + 0.005) {
        item.trend = 'up';
        item.prev_price = Number(idealRefPrice.toFixed(2));
      } else if (p < idealRefPrice - 0.005) {
        item.trend = 'down';
        item.prev_price = Number(idealRefPrice.toFixed(2));
      }
    }

    item.activa = true;
    item.precio = p;
    item.precio_activo = p;
    item.price = p;
  }

  function snapshotScalesBeforeEditStep() {
    (global._paProductPriceScales || []).forEach(function (ps) {
      if (num(ps.precio) > 0) ps._lastStepPrice = num(ps.precio);
    });
    (global._paProductBranchScales || []).forEach(function (bs) {
      if (num(bs.precio) > 0) bs._lastStepPrice = num(bs.precio);
    });
  }
  global.snapshotScalesBeforeEditStep = snapshotScalesBeforeEditStep;

  function renderPriceTrendArrowHtml(item) {
    var trend = item && item.trend ? item.trend : 'same';
    var prevP = item && item.prev_price ? num(item.prev_price) : 0;
    var curP = item ? num(item.precio) : 0;
    if (trend === 'up') {
      var tipUp = prevP > 0 ? ('El precio subió en automático ($' + fmt2(prevP) + ' → $' + fmt2(curP) + ')') : 'El precio subió en automático';
      return '<span class="cp-trend-badge cp-trend-up" title="' + esc(tipUp) + '" style="display:inline-flex;align-items:center;justify-content:center;width:30px;height:26px;border-radius:7px;background:rgba(16,185,129,0.20);border:1px solid rgba(16,185,129,0.65);color:#22c55e;font-size:14px;font-weight:900;box-shadow:0 0 10px rgba(16,185,129,0.25);">' +
        '<i class="fa-solid fa-arrow-up"></i>' +
      '</span>';
    }
    if (trend === 'down') {
      var tipDown = prevP > 0 ? ('El precio bajó en automático ($' + fmt2(prevP) + ' → $' + fmt2(curP) + ')') : 'El precio bajó en automático';
      return '<span class="cp-trend-badge cp-trend-down" title="' + esc(tipDown) + '" style="display:inline-flex;align-items:center;justify-content:center;width:30px;height:26px;border-radius:7px;background:rgba(239,68,68,0.20);border:1px solid rgba(239,68,68,0.65);color:#ef4444;font-size:14px;font-weight:900;box-shadow:0 0 10px rgba(239,68,68,0.25);">' +
        '<i class="fa-solid fa-arrow-down"></i>' +
      '</span>';
    }
    return '<span class="cp-trend-badge cp-trend-same" title="Precio de referencia sin cambio" style="display:inline-flex;align-items:center;justify-content:center;width:30px;height:26px;border-radius:7px;background:rgba(148,163,184,0.10);border:1px solid rgba(148,163,184,0.25);color:#64748b;font-size:12px;font-weight:800;">—</span>';
  }

  /* Recalcula las escalas del producto cuando cambia Costo, Flete, IVA o Margen en Alta de Producto
     SIN sobreescribir los márgenes propios de las sucursales a menos que se use el botón Copiar escalas de precios */
  global.recalculateAllProductScalesFromCost = function (opts) {
    opts = opts || {};
    ensureProductScalesInitialized();
    var ctx = getEffectiveProductCostContext();
    var costoRef = ctx.costoUnitConFlete;
    var factorIva = ctx.factorIva;
    var activeSel = getActiveProductAltaBranchScaleSelection();
    var isDefaultMatrizPublico = (activeSel.branch_name === 'MATRIZ' && activeSel.scale_name === 'PRECIO DE LISTA');

    if (global._paProductPriceScales && global._paProductPriceScales.length > 0) {
      var firstScale = global._paProductPriceScales[0];
      if (opts.triggerSource === 'margen' || opts.triggerSource === 'manual_single' || opts.triggerSource === 'manual_caja' || opts.triggerSource === 'manual_pieza') {
        var fMargen = ctx.formMargen;
        if (activeSel.branch_name === 'MATRIZ') {
          var targetScale = (global._paProductPriceScales || []).filter(function (ps) {
            return norm(ps.scale_name || ps.nombre) === activeSel.scale_name;
          })[0] || firstScale;
          var oferTarget = num(targetScale.oferta);
          targetScale.margen_trabajo = fMargen;
          targetScale.margen_ideal = fMargen + oferTarget;
        } else {
          var targetBrScale = (global._paProductBranchScales || []).filter(function (bs) {
            return norm(bs.branch_name || bs.branch_id) === activeSel.branch_name &&
                   norm(bs.scale_name || 'PRECIO DE LISTA') === activeSel.scale_name;
          })[0];
          if (targetBrScale) {
            targetBrScale.margen_final = fMargen;
            targetBrScale.sobreprecio_suc = fMargen - num(targetBrScale.margen_ideal);
          }
        }
      } else if (isDefaultMatrizPublico && costoRef > 0 && ctx.formMargen === 0 && num(firstScale.margen_trabajo) > 0 && !opts.keepZeroMainMargin) {
        var margenEl = byId('pa-margen');
        if (margenEl && !margenEl.dataset.userEditedZero) {
          margenEl.value = fmt2(firstScale.margen_trabajo);
          ctx = getEffectiveProductCostContext();
        }
      }
    }

    (global._paProductPriceScales || []).forEach(function (ps, idx) {
      var mIdeal = num(ps.margen_ideal);
      var ofer = num(ps.oferta);
      var mTrab = (ps.margen_trabajo != null && !isNaN(ps.margen_trabajo)) ? num(ps.margen_trabajo) : (mIdeal - ofer);
      ps.margen_trabajo = mTrab;
      ps.costo_con_flete = Number(costoRef.toFixed(4));
      var calcPrice = costoRef > 0 ? (costoRef * (1 + mTrab / 100) * factorIva) : (idx === 0 && ctx.formPrecioFinal > 0 ? ctx.formPrecioFinal : num(ps.precio));
      var idealRefPrice = costoRef > 0 ? (costoRef * (1 + mIdeal / 100) * factorIva) : calcPrice;
      updateScaleItemPriceAndTrend(ps, calcPrice, idealRefPrice, false);
      ps.margin = Number(mTrab.toFixed(4));
    });

    (global._paProductBranchScales || []).forEach(function (bs) {
      var mBase = num(bs.margen_ideal);
      var mAj = num(bs.sobreprecio_suc);
      var mOfer = num(bs.oferta);
      var mFin = mBase + mAj - mOfer;
      bs.oferta = Number(mOfer.toFixed(4));
      bs.margen_final = Number(mFin.toFixed(4));
      bs.costo_con_flete = Number(costoRef.toFixed(4));
      var calcPrice = costoRef > 0 ? (costoRef * (1 + mFin / 100) * factorIva) : num(bs.precio);
      var baseRefPrice = costoRef > 0 ? (costoRef * (1 + (mBase + mAj) / 100) * factorIva) : calcPrice;
      updateScaleItemPriceAndTrend(bs, calcPrice, baseRefPrice, true);
    });

    if (global._paProductPriceScales && global._paProductPriceScales[0]) {
      var mainDefaultPrice = num(global._paProductPriceScales[0].precio);
      var inputPrecioEl = byId('pa-precio-final');
      if (inputPrecioEl && mainDefaultPrice > 0) {
        inputPrecioEl.value = fmt2(mainDefaultPrice);
      }
    }

    if (typeof renderInlineProductAltaScalesPreview === 'function') {
      renderInlineProductAltaScalesPreview();
    }

    var modal = byId('modal-cambio-precio');
    if (modal && modal.style.display === 'flex' && !opts.skipModalRender) {
      var activeEl = document.activeElement;
      var isTypingInModal = !!(activeEl && modal.contains(activeEl) && activeEl.classList && activeEl.classList.contains('cp-live-inp'));
      if (!isTypingInModal) {
        global.renderModalCambioPrecioScales();
      } else {
        updateModalLiveSummaryStrip(ctx);
      }
    }
  };

  /* Reinicia las escalas del producto actual a las escalas globales por defecto (para limpiarFormularioAlta en altas nuevas) */
  global.resetProductPriceScalesForNewForm = function () {
    if (!_priceScales || !_priceScales.length) {
      initPriceScalesState(_params || {}, _branches || []);
    }
    global._paLoadedExistingProduct = null;
    global._paProductPriceScales = null;
    global._paProductBranchScales = null;
    global._paProductOffers = [];
    _modalPrecioSnapshot = null;
    _modalPrecioViewMode = 'escalas';
    var modal = byId('modal-cambio-precio');
    if (modal) {
      var modalHistTbody = modal.querySelector('.cp-hist tbody');
      if (modalHistTbody) {
        modalHistTbody.innerHTML = '<tr data-empty-history="1"><td colspan="3" style="text-align:center;color:#64748b;font-size:11px;padding:10px;">Sin historial de precios para este artículo</td></tr>';
      }
    }
    var margenEl = byId('pa-margen');
    if (margenEl) {
      delete margenEl.dataset.userEditedZero;
      if (_priceScales && _priceScales[0]) {
        var defM = num(_priceScales[0].margen_ideal) - num(_priceScales[0].oferta);
        margenEl.value = fmt2(defM);
      }
    }
    var sel = byId('pa-sucursal-escala-select');
    if (sel) sel.value = 'MATRIZ||PRECIO DE LISTA';
    ensureProductScalesInitialized();
    global.recalculateAllProductScalesFromCost({ keepZeroMainMargin: true });
  };

  /* Carga las escalas guardadas de un producto existente respetando íntegramente sus propios precios y márgenes */
  global.loadProductPriceScalesFromRecord = function (prod) {
    if (!_priceScales || !_priceScales.length) {
      initPriceScalesState(_params || {}, _branches || []);
    }
    global._paProductPriceScales = null;
    global._paProductBranchScales = null;
    global._paProductOffers = [];
    _modalPrecioSnapshot = null;
    _modalPrecioViewMode = 'escalas';
    var sel = byId('pa-sucursal-escala-select');
    if (sel) sel.value = 'MATRIZ||PRECIO DE LISTA';
    if (!prod) {
      ensureProductScalesInitialized();
      return;
    }

    var meta = (prod.meta_data && typeof prod.meta_data === 'object') ? prod.meta_data : {};
    var modal = byId('modal-cambio-precio');
    if (modal) {
      var modalHistTbody = modal.querySelector('.cp-hist tbody');
      if (modalHistTbody) {
        var pHist = Array.isArray(meta.price_history) ? meta.price_history : [];
        if (pHist.length) {
          modalHistTbody.innerHTML = pHist.map(function (h) {
            return '<tr><td><i class="fa-regular fa-clock"></i> ' + esc(h.fecha || '') + '</td>' +
                   '<td>' + esc(h.precio || '$0.00') + '</td>' +
                   '<td>' + esc(h.usuario || 'ADMIN') + '</td></tr>';
          }).join('');
        } else {
          var initP = num(prod.price) > 0 ? ('$' + fmt2(num(prod.price))) : '$0.00';
          var initDt = meta.last_price_update || 'Registro actual';
          modalHistTbody.innerHTML = '<tr><td><i class="fa-regular fa-clock"></i> ' + esc(initDt) + '</td><td>' + esc(initP) + '</td><td>' + esc(meta.usuario_alta || 'SISTEMA') + '</td></tr>';
        }
      }
    }
    var savedScales = Array.isArray(meta.price_scales) && meta.price_scales.length
      ? meta.price_scales
      : (Array.isArray(prod.price_scales) ? prod.price_scales : []);
    var savedBranchScales = Array.isArray(meta.branch_price_scales) ? meta.branch_price_scales : [];
    var ctx = getEffectiveProductCostContext();
    var costoRef = ctx.costoUnitConFlete;
    var factorIva = ctx.factorIva;

    if (savedScales.length) {
      global._paProductPriceScales = savedScales.filter(function (s) {
        return s && typeof s === 'object' && norm(s.scale_name || s.nombre || s.name);
      }).map(function (s, idx) {
        var nm = norm(s.scale_name || s.nombre || s.name);
        var rawP = s.precio != null ? num(s.precio) : (s.price != null ? num(s.price) : num(s.precio_activo));
        var rawOfer = s.oferta != null ? num(s.oferta) : num(s.oferta_pct);
        var rawMTrab = s.margen_trabajo != null ? num(s.margen_trabajo) : (s.margin != null ? num(s.margin) : null);
        var rawMIdeal = s.margen_ideal != null ? num(s.margen_ideal) : null;
        if (rawMTrab === null && costoRef > 0 && rawP > 0) {
          rawMTrab = (((rawP / factorIva) / costoRef) - 1) * 100;
        }
        if (rawMTrab === null) {
          rawMTrab = rawMIdeal !== null ? (rawMIdeal - rawOfer) : 0;
        }
        if (rawMIdeal === null) {
          rawMIdeal = rawMTrab + rawOfer;
        }
        var finalP = rawP > 0 ? rawP : (costoRef > 0 ? (costoRef * (1 + rawMTrab / 100) * factorIva) : 0);
        var rFP = Number(finalP.toFixed(2));
        return {
          id: s.id || ('esc-' + (idx + 1)),
          scale_name: nm,
          nombre: nm,
          margen_ideal: Number(rawMIdeal.toFixed(4)),
          oferta: Number((rawOfer || 0).toFixed(4)),
          margen_trabajo: Number(rawMTrab.toFixed(4)),
          comision: num(s.comision != null ? s.comision : s.comision_pct),
          activa: s.activa !== false && s.active !== false,
          locked: nm === 'PRECIO DE LISTA' || idx === 0,
          costo_con_flete: Number(costoRef.toFixed(4)),
          precio: rFP,
          precio_activo: rFP,
          price: rFP,
          _baselinePrice: rFP,
          _lastStepPrice: rFP,
          trend: s.trend || 'same',
          prev_price: num(s.prev_price),
          margin: Number(rawMTrab.toFixed(4))
        };
      });
    }

    var cleanSavedBranchScales = savedBranchScales.filter(function (bs) {
      return bs && typeof bs === 'object' && !isMainMatrizBranchKey(bs.branch_id, _branches) && !isMainMatrizBranchKey(bs.branch_name, _branches);
    });

    if (cleanSavedBranchScales.length) {
      global._paProductBranchScales = cleanSavedBranchScales.map(function (bs, idx) {
        var bId = String(bs.branch_id || bs.branch || '');
        var bNm = norm(bs.branch_name || bs.branch || bId);
        var sNm = norm(bs.scale_name || 'PRECIO DE LISTA');
        var rawP = bs.precio != null ? num(bs.precio) : num(bs.price);
        var mBase = bs.margen_ideal != null ? num(bs.margen_ideal) : (bs.base_margin != null ? num(bs.base_margin) : 0);
        var mAj = bs.sobreprecio_suc != null ? num(bs.sobreprecio_suc) : (bs.branch_delta != null ? num(bs.branch_delta) : 0);
        var mOfer = bs.oferta != null ? num(bs.oferta) : num(bs.oferta_pct);
        var mFin = bs.margen_final != null ? num(bs.margen_final) : (bs.final_margin != null ? num(bs.final_margin) : (mBase + mAj - mOfer));
        if (costoRef > 0 && rawP > 0 && bs.margen_final == null && bs.final_margin == null) {
          mFin = (((rawP / factorIva) / costoRef) - 1) * 100;
          mAj = mFin - mBase + mOfer;
        }
        var finalP = rawP > 0 ? rawP : (costoRef > 0 ? (costoRef * (1 + mFin / 100) * factorIva) : 0);
        var roundedBP = Number(finalP.toFixed(2));
        return {
          id: bs.id || ('besc-' + (idx + 1)),
          branch_id: bId,
          branch_name: bNm,
          scale_name: sNm,
          margen_ideal: Number(mBase.toFixed(4)),
          sobreprecio_suc: Number(mAj.toFixed(4)),
          oferta: Number(mOfer.toFixed(4)),
          margen_final: Number(mFin.toFixed(4)),
          comision: num(bs.comision != null ? bs.comision : bs.comision_pct),
          activa: bs.activa !== false && bs.active !== false,
          costo_con_flete: Number(costoRef.toFixed(4)),
          precio: roundedBP,
          precio_activo: roundedBP,
          price: roundedBP,
          _baselinePrice: roundedBP,
          _lastStepPrice: roundedBP,
          trend: bs.trend || 'same',
          prev_price: num(bs.prev_price)
        };
      });
    }

    global._paProductOffers = Array.isArray(meta.product_offers)
      ? JSON.parse(JSON.stringify(meta.product_offers))
      : [];

    ensureProductScalesInitialized();
    renderInlineProductAltaScalesPreview();
  };

  function applySelectedSucursalEscalaToProductAltaCard() {
    ensureProductScalesInitialized();
    var activeSel = getActiveProductAltaBranchScaleSelection();
    var mainMatriz = getMainMatrizBranch(_branches || []);
    var margenEl = byId('pa-margen');
    var dispPrecio = byId('pa-precio-display');
    var heroTitle = byId('pa-single-price-hero-title');
    var footSuc = byId('pa-foot-sucursal');

    var displayBranch = activeSel.branch_name === 'MATRIZ' ? ('MATRIZ (' + mainMatriz.name + ')') : activeSel.branch_name;
    if (footSuc) {
      footSuc.textContent = displayBranch;
    }
    if (heroTitle) {
      var prettyScale = formatPublicScaleName(activeSel.scale_name);
      heroTitle.textContent = displayBranch + ' - ' + prettyScale + ' (IVA Incluido)';
    }

    var targetMargin = 0;
    var targetPrice = 0;

    if (activeSel.branch_name === 'MATRIZ') {
      var sc = (global._paProductPriceScales || []).filter(function (ps) {
        return norm(ps.scale_name || ps.nombre) === activeSel.scale_name;
      })[0] || (global._paProductPriceScales || [])[0];
      if (sc) {
        targetMargin = num(sc.margen_trabajo != null ? sc.margen_trabajo : sc.margen_ideal);
        targetPrice = num(sc.precio != null ? sc.precio : sc.price);
      }
    } else {
      var bs = (global._paProductBranchScales || []).filter(function (b) {
        return norm(b.branch_name || b.branch_id) === activeSel.branch_name &&
               norm(b.scale_name || 'PRECIO DE LISTA') === activeSel.scale_name;
      })[0];
      if (bs) {
        targetMargin = num(bs.margen_final != null ? bs.margen_final : (num(bs.margen_ideal) + num(bs.sobreprecio_suc)));
        targetPrice = num(bs.precio != null ? bs.precio : bs.price);
      }
    }

    if (margenEl && document.activeElement !== margenEl) {
      margenEl.value = fmt2(targetMargin);
    }
    if (dispPrecio && document.activeElement !== dispPrecio) {
      dispPrecio.value = fmt2(targetPrice);
    }
  }
  global.applySelectedSucursalEscalaToProductAltaCard = applySelectedSucursalEscalaToProductAltaCard;

  function renderInlineProductAltaScalesPreview() {
    var box = byId('pa-live-scales-preview');
    if (box) box.innerHTML = '';

    var sel = byId('pa-sucursal-escala-select');
    if (!sel) return;

    ensureProductScalesInitialized();
    var mainMatriz = getMainMatrizBranch(_branches || []);
    var scales = (global._paProductPriceScales || []).filter(function (s) { return s && s.activa !== false; });
    var brScales = (global._paProductBranchScales || []).filter(function (b) { return b && b.activa !== false; });

    var currentVal = sel.value || 'MATRIZ||PRECIO DE LISTA';
    var optionsList = [];
    var seenKeys = {};

    function addOption(branchKey, branchLabel, scaleName) {
      var bKey = norm(branchKey || 'MATRIZ') || 'MATRIZ';
      var sNm = norm(scaleName || 'PRECIO DE LISTA') || 'PRECIO DE LISTA';
      var key = bKey + '||' + sNm;
      if (seenKeys[key]) return;
      seenKeys[key] = true;
      var labelScale = formatPublicScaleName(sNm);
      optionsList.push({
        value: key,
        label: branchLabel + ' - ' + labelScale
      });
    }

    var matrizLabel = (mainMatriz.name && mainMatriz.name !== 'MATRIZ') ? ('MATRIZ (' + mainMatriz.name + ')') : 'MATRIZ';
    addOption('MATRIZ', matrizLabel, 'PRECIO DE LISTA');

    scales.forEach(function (sc) {
      addOption('MATRIZ', matrizLabel, sc.scale_name || sc.nombre || 'PRECIO DE LISTA');
    });

    brScales.forEach(function (bs) {
      var bNm = norm(bs.branch_name || bs.branch_id);
      if (!bNm || isMainMatrizBranchKey(bNm, _branches)) return;
      addOption(bNm, bNm, bs.scale_name || 'PRECIO DE LISTA');
    });

    sel.innerHTML = optionsList.map(function (opt) {
      return '<option value="' + esc(opt.value) + '">' + esc(opt.label) + '</option>';
    }).join('');

    if (seenKeys[currentVal]) {
      sel.value = currentVal;
    } else {
      sel.value = 'MATRIZ||PRECIO DE LISTA';
    }

    if (!sel.dataset.boundScaleSwitch) {
      sel.dataset.boundScaleSwitch = '1';
      sel.addEventListener('change', function () {
        applySelectedSucursalEscalaToProductAltaCard();
      });
    }

    applySelectedSucursalEscalaToProductAltaCard();
  }
  global.renderInlineProductAltaScalesPreview = renderInlineProductAltaScalesPreview;

  /* ── Snapshot, Apertura, Cancelación (Rollback), Sucursales F2 y Ofertas F3 en #modal-cambio-precio ── */
  var _lastBranchBeforeOfertas = '';

  function takeModalCambioPrecioSnapshot() {
    ensureProductScalesInitialized();
    _modalPrecioSnapshot = {
      priceScales: JSON.parse(JSON.stringify(global._paProductPriceScales || [])),
      branchScales: JSON.parse(JSON.stringify(global._paProductBranchScales || [])),
      productOffers: JSON.parse(JSON.stringify(global._paProductOffers || [])),
      costo: byId('pa-costo') ? byId('pa-costo').value : '',
      flete: byId('pa-flete-pct') ? byId('pa-flete-pct').value : '',
      margen: byId('pa-margen') ? byId('pa-margen').value : '',
      precioDisplay: byId('pa-precio-display') ? byId('pa-precio-display').value : '',
      precioFinal: byId('pa-precio-final') ? byId('pa-precio-final').value : '',
      precioPieza: byId('pa-precio-pieza-final') ? byId('pa-precio-pieza-final').value : '',
      precioCaja: byId('pa-precio-caja-final') ? byId('pa-precio-caja-final').value : '',
      histActivo: byId('pa-hist-precio-activo') ? byId('pa-hist-precio-activo').textContent : '',
      selSucEsc: byId('pa-sucursal-escala-select') ? byId('pa-sucursal-escala-select').value : 'MATRIZ||PRECIO DE LISTA'
    };
  }

  global.openModalCambioPrecio = function () {
    var modal = byId('modal-cambio-precio');
    if (!modal) return;
    _modalPrecioViewMode = 'escalas';
    _lastBranchBeforeOfertas = '';
    closeModalBranchSelectorDropdown();
    closeCopyScalesMenuPopover();
    modal.style.display = 'flex';
    if (!_initialized || !_params) {
      ensureStoreLoaded().then(function () {
        if (!global._paLoadedExistingProduct) {
          global._paProductPriceScales = null;
          global._paProductBranchScales = null;
          ensureProductScalesInitialized();
        }
        takeModalCambioPrecioSnapshot();
        global.renderModalCambioPrecioScales('escalas');
      }).catch(function () {
        takeModalCambioPrecioSnapshot();
        global.renderModalCambioPrecioScales('escalas');
      });
      return;
    }
    takeModalCambioPrecioSnapshot();
    global.renderModalCambioPrecioScales('escalas');
  };

  global.cancelAndCloseModalCambioPrecio = function () {
    closeModalBranchSelectorDropdown();
    closeCopyScalesMenuPopover();
    var modal = byId('modal-cambio-precio');
    if (_modalPrecioSnapshot) {
      global._paProductPriceScales = JSON.parse(JSON.stringify(_modalPrecioSnapshot.priceScales || []));
      global._paProductBranchScales = JSON.parse(JSON.stringify(_modalPrecioSnapshot.branchScales || []));
      global._paProductOffers = JSON.parse(JSON.stringify(_modalPrecioSnapshot.productOffers || []));
      var setVal = function (id, val) { var el = byId(id); if (el && val !== undefined) el.value = val; };
      setVal('pa-costo', _modalPrecioSnapshot.costo);
      setVal('pa-flete-pct', _modalPrecioSnapshot.flete);
      setVal('pa-margen', _modalPrecioSnapshot.margen);
      setVal('pa-precio-display', _modalPrecioSnapshot.precioDisplay);
      setVal('pa-precio-final', _modalPrecioSnapshot.precioFinal);
      setVal('pa-precio-pieza-final', _modalPrecioSnapshot.precioPieza);
      setVal('pa-precio-caja-final', _modalPrecioSnapshot.precioCaja);
      var histEl = byId('pa-hist-precio-activo');
      if (histEl && _modalPrecioSnapshot.histActivo !== undefined) {
        histEl.textContent = _modalPrecioSnapshot.histActivo;
      }
      var sel = byId('pa-sucursal-escala-select');
      if (sel && _modalPrecioSnapshot.selSucEsc) {
        sel.value = _modalPrecioSnapshot.selSucEsc;
      }
      _modalPrecioSnapshot = null;
      renderInlineProductAltaScalesPreview();
    }
    _modalPrecioViewMode = 'escalas';
    if (modal) modal.style.display = 'none';
  };

  if (!global.__boundCambioPrecioHashRollback) {
    global.__boundCambioPrecioHashRollback = true;
    window.addEventListener('hashchange', function () {
      var modal = byId('modal-cambio-precio');
      if ((modal && modal.style.display === 'flex') || _modalPrecioSnapshot) {
        global.cancelAndCloseModalCambioPrecio();
      }
    });
  }

  function getModalRegisteredBranchOptions() {
    var sec = getSecondaryBranchesList(_branches || []);
    var names = [];
    sec.forEach(function (b) {
      var nm = norm(b.name || b.id);
      if (nm && names.indexOf(nm) < 0) names.push(nm);
    });
    if (!names.length) {
      (global._paProductBranchScales || []).forEach(function (bs) {
        var nm = norm(bs.branch_name || bs.branch_id);
        if (nm && !isMainMatrizBranchKey(nm, _branches) && names.indexOf(nm) < 0) {
          names.push(nm);
        }
      });
    }
    var opts = [{ value: 'MATRIZ', label: 'MATRIZ' }];
    names.forEach(function (nm) {
      opts.push({ value: nm, label: nm });
    });
    return opts;
  }

  function closeModalBranchSelectorDropdown() {
    _modalBranchDropdownOpen = false;
    var pop = byId('cp-branch-selector-popover');
    if (pop) pop.remove();
  }

  function closeCopyScalesMenuPopover() {
    var menu = byId('cp-copy-scales-menu-popover');
    if (menu) menu.remove();
  }

  function openModalBranchSelectorDropdown() {
    var modal = byId('modal-cambio-precio');
    if (!modal) return;
    closeCopyScalesMenuPopover();
    var opts = getModalRegisteredBranchOptions();
    if (!opts.length) {
      cfgToast('No hay sucursales adicionales registradas fuera de la Matriz.', true);
      return;
    }

    _modalBranchDropdownOpen = true;
    var activeVal = (_modalPrecioViewMode === 'escalas') ? 'MATRIZ' : (_modalBranchFilter || '');
    var curIdx = opts.findIndex(function (o) { return norm(o.value) === norm(activeVal); });
    _modalBranchDropdownIdx = curIdx >= 0 ? curIdx : 0;

    var oldPop = byId('cp-branch-selector-popover');
    if (oldPop) oldPop.remove();

    var pop = document.createElement('div');
    pop.id = 'cp-branch-selector-popover';
    pop.tabIndex = -1;
    pop.style.cssText = 'position:fixed;inset:0;z-index:10080;background:rgba(2,6,23,0.65);display:flex;align-items:center;justify-content:center;backdrop-filter:blur(2px);outline:none;';

    var rowsHtml = opts.map(function (o, idx) {
      return '<div class="cp-br-dd-opt" data-idx="' + idx + '" style="display:flex;align-items:center;justify-content:space-between;gap:12px;padding:12px 16px;border-radius:9px;cursor:pointer;font-size:13px;font-weight:800;user-select:none;transition:background .1s,border-color .1s;">' +
        '<span style="display:flex;align-items:center;gap:9px;pointer-events:none;"><i class="cp-br-dd-ico fa-solid ' + (o.value === 'MATRIZ' ? 'fa-building-flag' : (o.value === 'ALL' ? 'fa-layer-group' : 'fa-store')) + '"></i>' + esc(o.label) + '</span>' +
        '<span class="cp-br-dd-kbd" style="font-size:11px;font-weight:700;font-family:monospace;pointer-events:none;"></span>' +
      '</div>';
    }).join('');

    pop.innerHTML =
      '<div id="cp-branch-selector-card" style="width:450px;max-width:92vw;background:#0f172a;border:1.5px solid #38bdf8;border-radius:14px;box-shadow:0 20px 50px rgba(0,0,0,0.7);padding:18px 20px;color:#f8fafc;">' +
        '<div style="display:flex;align-items:center;justify-content:space-between;gap:10px;padding-bottom:12px;margin-bottom:12px;border-bottom:1px solid #1e293b;">' +
          '<div style="display:flex;align-items:center;gap:9px;font-size:14px;font-weight:900;color:#f8fafc;letter-spacing:.3px;">' +
            '<i class="fa-solid fa-store" style="color:#38bdf8;"></i> SELECCIONAR SUCURSAL' +
          '</div>' +
          '<span style="font-size:11px;font-weight:700;color:#94a3b8;">Usa ↑ / ↓ y ENTER o Clic</span>' +
        '</div>' +
        '<div id="cp-branch-selector-list" style="display:flex;flex-direction:column;gap:8px;max-height:320px;overflow-y:auto;">' +
          rowsHtml +
        '</div>' +
      '</div>';

    var optEls = Array.prototype.slice.call(pop.querySelectorAll('.cp-br-dd-opt'));

    function updatePopoverSelectionStyles() {
      optEls.forEach(function (el, idx) {
        var isAct = idx === _modalBranchDropdownIdx;
        if (isAct) {
          el.style.background = 'linear-gradient(90deg,rgba(56,189,248,0.26),rgba(37,99,235,0.20))';
          el.style.border = '1.5px solid #38bdf8';
          el.style.color = '#f8fafc';
          el.style.boxShadow = '0 4px 14px rgba(56,189,248,0.22)';
        } else {
          el.style.background = 'rgba(15,23,42,0.80)';
          el.style.border = '1px solid #1e293b';
          el.style.color = '#cbd5e1';
          el.style.boxShadow = 'none';
        }
        var ico = el.querySelector('.cp-br-dd-ico');
        if (ico) ico.style.color = isAct ? '#38bdf8' : '#64748b';
        var kbd = el.querySelector('.cp-br-dd-kbd');
        if (kbd) {
          kbd.textContent = isAct ? 'ENTER' : '';
          kbd.style.color = isAct ? '#38bdf8' : '#64748b';
        }
        if (isAct && typeof el.scrollIntoView === 'function') {
          try { el.scrollIntoView({ block: 'nearest' }); } catch (e) {}
        }
      });
    }

    function confirmBranchSelection(chosen) {
      if (!chosen) return;
      closeModalBranchSelectorDropdown();
      if (norm(chosen.value) === 'MATRIZ') {
        _modalPrecioViewMode = 'escalas';
        global.renderModalCambioPrecioScales('escalas');
      } else {
        _modalBranchFilter = chosen.value;
        _lastBranchBeforeOfertas = chosen.value;
        _modalPrecioViewMode = 'sucursales';
        global.renderModalCambioPrecioScales('sucursales');
      }
    }

    optEls.forEach(function (el) {
      el.addEventListener('mouseenter', function () {
        var idx = parseInt(el.getAttribute('data-idx'), 10);
        if (!isNaN(idx) && idx !== _modalBranchDropdownIdx) {
          _modalBranchDropdownIdx = idx;
          updatePopoverSelectionStyles();
        }
      });
      el.addEventListener('mousedown', function (ev) {
        if (ev.button !== 0) return;
        ev.preventDefault();
        ev.stopPropagation();
        var i = parseInt(el.getAttribute('data-idx'), 10) || 0;
        confirmBranchSelection(opts[i]);
      });
      el.addEventListener('click', function (ev) {
        ev.preventDefault();
        ev.stopPropagation();
        var i = parseInt(el.getAttribute('data-idx'), 10) || 0;
        confirmBranchSelection(opts[i]);
      });
    });

    pop.addEventListener('mousedown', function (ev) {
      if (ev.target === pop) {
        ev.preventDefault();
        ev.stopPropagation();
        closeModalBranchSelectorDropdown();
      }
    });

    modal.appendChild(pop);
    updatePopoverSelectionStyles();
    setTimeout(function () {
      try { pop.focus(); } catch (e) {}
    }, 0);

    pop._confirmCurrent = function () {
      confirmBranchSelection(opts[_modalBranchDropdownIdx] || opts[0]);
    };
    pop._moveSelection = function (delta) {
      _modalBranchDropdownIdx = (_modalBranchDropdownIdx + delta + opts.length) % opts.length;
      updatePopoverSelectionStyles();
    };
  }
  global.openModalBranchSelectorDropdown = openModalBranchSelectorDropdown;

  /* ── Sincronización bidireccional de Ofertas directas entre la tabla (MATRIZ / Sucursal) y global._paProductOffers ── */
  function syncDirectTableOfferRecord(branchScope, scaleName, ofertaPct, precioOferta) {
    if (!Array.isArray(global._paProductOffers)) global._paProductOffers = [];
    var bScope = norm(branchScope || 'MATRIZ');
    var sName = norm(scaleName || 'PRECIO DE LISTA');
    var existingIdx = global._paProductOffers.findIndex(function (ofItem) {
      return ofItem &&
        ofItem.modality === 'ESCALA' &&
        ofItem.vigencia_type === 'PERMANENTE' &&
        norm(ofItem.branch_scope) === bScope &&
        Array.isArray(ofItem.scales) &&
        ofItem.scales.length === 1 &&
        norm(ofItem.scales[0]) === sName;
    });
    var pct = Number(num(ofertaPct).toFixed(2));
    var pFin = Number(num(precioOferta).toFixed(2));
    if (pct > 0) {
      if (existingIdx >= 0) {
        global._paProductOffers[existingIdx].discount_pct = pct;
        global._paProductOffers[existingIdx].offer_price = pFin;
        global._paProductOffers[existingIdx].status = 'ACTIVA';
        global._paProductOffers[existingIdx].paused = false;
      } else {
        global._paProductOffers.push({
          id: 'of-' + Date.now() + '-' + Math.floor(Math.random() * 1000),
          branch_scope: bScope,
          branches: bScope === 'MATRIZ' ? ['MATRIZ'] : [bScope],
          scales: [sName],
          modality: 'ESCALA',
          vigencia_type: 'PERMANENTE',
          start_at: '',
          end_at: '',
          discount_pct: pct,
          offer_price: pFin,
          status: 'ACTIVA',
          paused: false,
          created_at: new Date().toLocaleString('es-MX')
        });
      }
    } else if (existingIdx >= 0) {
      global._paProductOffers.splice(existingIdx, 1);
    }
  }

  /* ── Menú de 4 opciones del botón verde `📋 Copiar escalas y ofertas` en Precio Sucursales F2 ── */
  function executeCopyScalesOption(optionNumber) {
    ensureProductScalesInitialized();
    var ctx = getEffectiveProductCostContext();
    var costoRef = ctx.costoUnitConFlete;
    var factorIva = ctx.factorIva;
    var targetBranch = norm(_modalBranchFilter || '');
    if (!targetBranch || targetBranch === 'MATRIZ') return;

    if (optionNumber === 1) {
      // 1. Copiar SOLO Precios y Márgenes de MATRIZ a esta sucursal (sin tocar las ofertas de la sucursal)
      (global._paProductBranchScales || []).forEach(function (bs) {
        var bNm = norm(bs.branch_name || bs.branch_id);
        if (bNm !== targetBranch) return;
        var sNm = norm(bs.scale_name || 'PRECIO DE LISTA');
        var matSc = (global._paProductPriceScales || []).filter(function (ps) {
          return norm(ps.scale_name || ps.nombre) === sNm;
        })[0];
        if (!matSc) return;
        var mBaseMat = num(matSc.margen_ideal);
        var curOfer = num(bs.oferta);
        var mFin = mBaseMat - curOfer;
        var calcP = costoRef > 0 ? Number((costoRef * (1 + mFin / 100) * factorIva).toFixed(2)) : Number(num(matSc.precio).toFixed(2));
        var baseRefP = costoRef > 0 ? Number((costoRef * (1 + mBaseMat / 100) * factorIva).toFixed(2)) : calcP;
        bs.margen_ideal = Number(mBaseMat.toFixed(4));
        bs.sobreprecio_suc = 0;
        bs.margen_final = Number(mFin.toFixed(4));
        bs.comision = Number(num(matSc.comision).toFixed(4));
        bs.costo_con_flete = Number(costoRef.toFixed(4));
        updateScaleItemPriceAndTrend(bs, calcP, baseRefP, true);
      });
      renderInlineProductAltaScalesPreview();
      global.renderModalCambioPrecioScales('sucursales');
      cfgToast('1. Se copiaron SOLO Precios y Márgenes de MATRIZ a «' + targetBranch + '» (respetando ofertas de la sucursal).');
    } else if (optionNumber === 2) {
      // 2. Copiar Precios + OFERTAS de MATRIZ a esta sucursal
      (global._paProductBranchScales || []).forEach(function (bs) {
        var bNm = norm(bs.branch_name || bs.branch_id);
        if (bNm !== targetBranch) return;
        var sNm = norm(bs.scale_name || 'PRECIO DE LISTA');
        var matSc = (global._paProductPriceScales || []).filter(function (ps) {
          return norm(ps.scale_name || ps.nombre) === sNm;
        })[0];
        if (!matSc) return;
        var mBaseMat = num(matSc.margen_ideal);
        var mOferMat = num(matSc.oferta);
        var mFin = mBaseMat - mOferMat;
        var calcP = costoRef > 0 ? Number((costoRef * (1 + mFin / 100) * factorIva).toFixed(2)) : Number(num(matSc.precio).toFixed(2));
        var baseRefP = costoRef > 0 ? Number((costoRef * (1 + mBaseMat / 100) * factorIva).toFixed(2)) : calcP;
        bs.margen_ideal = Number(mBaseMat.toFixed(4));
        bs.sobreprecio_suc = 0;
        bs.oferta = Number(mOferMat.toFixed(4));
        bs.margen_final = Number(mFin.toFixed(4));
        bs.comision = Number(num(matSc.comision).toFixed(4));
        bs.costo_con_flete = Number(costoRef.toFixed(4));
        updateScaleItemPriceAndTrend(bs, calcP, baseRefP, true);
        syncDirectTableOfferRecord(targetBranch, sNm, mOferMat, calcP);
      });
      // Copiar ofertas registradas en MATRIZ hacia esta sucursal
      var matrizOffers = (global._paProductOffers || []).filter(function (o) {
        return o && (norm(o.branch_scope) === 'MATRIZ' || norm(o.branch_scope) === 'ALL');
      });
      matrizOffers.forEach(function (mo) {
        var exists = (global._paProductOffers || []).some(function (xo) {
          return xo && norm(xo.branch_scope) === targetBranch && xo.modality === mo.modality && JSON.stringify(xo.scales) === JSON.stringify(mo.scales);
        });
        if (!exists) {
          var clone = JSON.parse(JSON.stringify(mo));
          clone.id = 'of-' + Date.now() + '-' + Math.floor(Math.random() * 1000);
          clone.branch_scope = targetBranch;
          clone.branches = [targetBranch];
          global._paProductOffers.push(clone);
        }
      });
      renderInlineProductAltaScalesPreview();
      global.renderModalCambioPrecioScales('sucursales');
      cfgToast('2. Se copiaron Precios + OFERTAS de MATRIZ a «' + targetBranch + '».');
    } else if (optionNumber === 3) {
      // 3. Replicar las Ofertas de esta sucursal a TODAS las sucursales (y Matriz)
      var sourceBranchScales = {};
      (global._paProductBranchScales || []).forEach(function (bs) {
        if (norm(bs.branch_name || bs.branch_id) === targetBranch) {
          sourceBranchScales[norm(bs.scale_name || 'PRECIO DE LISTA')] = num(bs.oferta);
        }
      });
      // Propagar a Matriz
      (global._paProductPriceScales || []).forEach(function (ps) {
        var sNm = norm(ps.scale_name || ps.nombre);
        if (sourceBranchScales[sNm] !== undefined) {
          var ofPct = num(sourceBranchScales[sNm]);
          var mI = num(ps.margen_ideal);
          var mT = mI - ofPct;
          var p = costoRef > 0 ? Number((costoRef * (1 + mT / 100) * factorIva).toFixed(2)) : num(ps.precio);
          var idealRefP = costoRef > 0 ? Number((costoRef * (1 + mI / 100) * factorIva).toFixed(2)) : p;
          ps.oferta = Number(ofPct.toFixed(4));
          ps.margen_trabajo = Number(mT.toFixed(4));
          ps.margin = Number(mT.toFixed(4));
          updateScaleItemPriceAndTrend(ps, p, idealRefP, false);
          syncDirectTableOfferRecord('MATRIZ', sNm, ofPct, p);
        }
      });
      // Propagar a todas las sucursales
      (global._paProductBranchScales || []).forEach(function (bs) {
        var sNm = norm(bs.scale_name || 'PRECIO DE LISTA');
        if (sourceBranchScales[sNm] !== undefined) {
          var ofPct = num(sourceBranchScales[sNm]);
          var mB = num(bs.margen_ideal);
          var mA = num(bs.sobreprecio_suc);
          var mF = mB + mA - ofPct;
          var p = costoRef > 0 ? Number((costoRef * (1 + mF / 100) * factorIva).toFixed(2)) : num(bs.precio);
          var baseRefP = costoRef > 0 ? Number((costoRef * (1 + (mB + mA) / 100) * factorIva).toFixed(2)) : p;
          bs.oferta = Number(ofPct.toFixed(4));
          bs.margen_final = Number(mF.toFixed(4));
          updateScaleItemPriceAndTrend(bs, p, baseRefP, true);
          syncDirectTableOfferRecord(norm(bs.branch_name || bs.branch_id), sNm, ofPct, p);
        }
      });
      if (global._paProductPriceScales && global._paProductPriceScales[0]) {
        syncFirstScaleToMainForm(global._paProductPriceScales[0]);
      }
      renderInlineProductAltaScalesPreview();
      global.renderModalCambioPrecioScales('sucursales');
      cfgToast('3. Se replicaron las Ofertas de «' + targetBranch + '» a MATRIZ y TODAS las sucursales.');
    } else if (optionNumber === 4) {
      // 4. Limpiar / Apagar ofertas en esta sucursal (0.00%)
      (global._paProductBranchScales || []).forEach(function (bs) {
        var bNm = norm(bs.branch_name || bs.branch_id);
        if (bNm !== targetBranch) return;
        var mB = num(bs.margen_ideal);
        var mA = num(bs.sobreprecio_suc);
        var mF = mB + mA;
        var p = costoRef > 0 ? Number((costoRef * (1 + mF / 100) * factorIva).toFixed(2)) : num(bs.precio);
        bs.oferta = 0;
        bs.margen_final = Number(mF.toFixed(4));
        updateScaleItemPriceAndTrend(bs, p, p, true);
      });
      if (Array.isArray(global._paProductOffers)) {
        global._paProductOffers = global._paProductOffers.filter(function (o) {
          return norm(o && o.branch_scope) !== targetBranch;
        });
      }
      renderInlineProductAltaScalesPreview();
      global.renderModalCambioPrecioScales('sucursales');
      cfgToast('4. Se apagaron las ofertas (0.00%) en «' + targetBranch + '», restaurando su precio normal.');
    }
  }

  global.copyMatrizScalesToActiveBranchInModal = function () {
    executeCopyScalesOption(1);
  };

  function openCopyScalesAndOffersMenu(anchorBtn) {
    closeCopyScalesMenuPopover();
    var modal = byId('modal-cambio-precio');
    if (!modal || !anchorBtn) return;
    var targetBranch = norm(_modalBranchFilter || 'SUCURSAL');

    var pop = document.createElement('div');
    pop.id = 'cp-copy-scales-menu-popover';
    pop.style.cssText = 'position:fixed;inset:0;z-index:10085;background:rgba(2,6,23,0.45);display:flex;align-items:flex-end;justify-content:flex-start;padding:72px 32px;';

    var menuItems = [
      {
        num: 1,
        icon: 'fa-scale-balanced',
        color: '#38bdf8',
        title: '1. Copiar SOLO Precios y Márgenes de MATRIZ a esta sucursal',
        desc: 'Iguala márgenes base de Matriz hacia «' + targetBranch + '» sin tocar las ofertas de la sucursal.'
      },
      {
        num: 2,
        icon: 'fa-tags',
        color: '#10b981',
        title: '2. Copiar Precios + OFERTAS de MATRIZ a esta sucursal',
        desc: 'Copia márgenes y también las ofertas activas/programadas de Matriz hacia «' + targetBranch + '».'
      },
      {
        num: 3,
        icon: 'fa-share-nodes',
        color: '#f59e0b',
        title: '3. Replicar las Ofertas de esta sucursal a TODAS las sucursales',
        desc: 'Propaga las ofertas de «' + targetBranch + '» a Matriz y a todas las sucursales.'
      },
      {
        num: 4,
        icon: 'fa-power-off',
        color: '#ef4444',
        title: '4. Limpiar / Apagar ofertas en esta sucursal (0.00%)',
        desc: 'Restaura de inmediato el precio normal sin oferta en «' + targetBranch + '».'
      }
    ];

    pop.innerHTML =
      '<div style="width:520px;max-width:94vw;background:var(--cp-bg,#0f172a);border:1.5px solid #10b981;border-radius:14px;box-shadow:0 20px 50px rgba(0,0,0,0.65);padding:14px 16px;color:var(--cp-text,#f8fafc);">' +
        '<div style="display:flex;align-items:center;justify-content:space-between;padding-bottom:10px;margin-bottom:10px;border-bottom:1px solid var(--cp-line,#1e293b);">' +
          '<div style="font-size:13.5px;font-weight:900;display:flex;align-items:center;gap:8px;color:#10b981;">' +
            '<i class="fa-solid fa-clipboard-check"></i> COPIAR ESCALAS Y OFERTAS — ' + esc(targetBranch) +
          '</div>' +
          '<button type="button" id="cp-copy-menu-close" style="background:none;border:none;color:var(--cp-muted,#94a3b8);cursor:pointer;font-size:16px;"><i class="fa-solid fa-xmark"></i></button>' +
        '</div>' +
        '<div style="display:flex;flex-direction:column;gap:8px;">' +
          menuItems.map(function (it) {
            return '<button type="button" class="cp-copy-menu-opt" data-opt="' + it.num + '" style="text-align:left;padding:10px 13px;border-radius:10px;border:1px solid var(--cp-line,#1e293b);background:var(--cp-panel,rgba(15,23,42,0.85));color:var(--cp-text,#f8fafc);cursor:pointer;display:flex;align-items:flex-start;gap:11px;transition:all .14s;">' +
              '<div style="width:32px;height:32px;border-radius:8px;background:rgba(16,185,129,0.12);border:1px solid ' + it.color + ';color:' + it.color + ';display:flex;align-items:center;justify-content:center;font-size:14px;flex-shrink:0;margin-top:2px;">' +
                '<i class="fa-solid ' + it.icon + '"></i>' +
              '</div>' +
              '<div style="flex:1;min-width:0;">' +
                '<div style="font-size:12.5px;font-weight:800;color:var(--cp-title,#ffffff);margin-bottom:2px;">' + esc(it.title) + '</div>' +
                '<div style="font-size:11.2px;color:var(--cp-muted,#94a3b8);line-height:1.35;">' + esc(it.desc) + '</div>' +
              '</div>' +
            '</button>';
          }).join('') +
        '</div>' +
      '</div>';

    pop.querySelectorAll('.cp-copy-menu-opt').forEach(function (btn) {
      btn.addEventListener('mouseenter', function () {
        btn.style.borderColor = '#10b981';
        btn.style.transform = 'translateX(2px)';
      });
      btn.addEventListener('mouseleave', function () {
        btn.style.borderColor = 'var(--cp-line,#1e293b)';
        btn.style.transform = 'none';
      });
      btn.addEventListener('click', function (ev) {
        ev.preventDefault();
        ev.stopPropagation();
        var n = parseInt(btn.getAttribute('data-opt'), 10);
        closeCopyScalesMenuPopover();
        executeCopyScalesOption(n);
      });
    });

    var closeB = pop.querySelector('#cp-copy-menu-close');
    if (closeB) closeB.addEventListener('click', closeCopyScalesMenuPopover);
    pop.addEventListener('mousedown', function (ev) {
      if (ev.target === pop) closeCopyScalesMenuPopover();
    });

    modal.appendChild(pop);
  }

  function updateModalLiveSummaryStrip(ctx) {
    var strip = byId('cp-live-cost-summary');
    if (strip) strip.remove();
  }

  function refreshModalRowsValuesInPlace() {
    var modal = byId('modal-cambio-precio');
    if (!modal) return;
    var ctx = getEffectiveProductCostContext();
    updateModalLiveSummaryStrip(ctx);
    var tbody = modal.querySelector('table.cp-prices tbody');
    if (!tbody) return;
    if (_modalPrecioViewMode === 'sucursales') {
      tbody.querySelectorAll('tr[data-bs-idx]').forEach(function (tr) {
        var idx = parseInt(tr.getAttribute('data-bs-idx'), 10);
        var bs = global._paProductBranchScales && global._paProductBranchScales[idx];
        if (!bs) return;
        var costCell = tr.querySelector('.cp-cell-cost');
        var priceInp = tr.querySelector('.cp-inp-bs-price');
        var trendCell = tr.querySelector('.cp-cell-trend');
        var actCell = tr.querySelector('.cp-cell-active-price');
        if (costCell) costCell.textContent = '$' + fmt2(bs.costo_con_flete);
        if (priceInp && document.activeElement !== priceInp) priceInp.value = fmt2(bs.precio);
        if (trendCell) trendCell.innerHTML = renderPriceTrendArrowHtml(bs);
        if (actCell) actCell.textContent = '$' + fmt2(bs.precio_activo != null ? bs.precio_activo : bs.precio);
      });
    } else if (_modalPrecioViewMode === 'escalas') {
      tbody.querySelectorAll('tr[data-sc-idx]').forEach(function (tr) {
        var idx = parseInt(tr.getAttribute('data-sc-idx'), 10);
        var ps = global._paProductPriceScales && global._paProductPriceScales[idx];
        if (!ps) return;
        var costCell = tr.querySelector('.cp-cell-cost');
        var priceInp = tr.querySelector('.cp-inp-sc-price');
        var trendCell = tr.querySelector('.cp-cell-trend');
        var actCell = tr.querySelector('.cp-cell-active-price');
        if (costCell) costCell.textContent = '$' + fmt2(ps.costo_con_flete);
        if (priceInp && document.activeElement !== priceInp) priceInp.value = fmt2(ps.precio);
        if (trendCell) trendCell.innerHTML = renderPriceTrendArrowHtml(ps);
        if (actCell) actCell.textContent = '$' + fmt2(ps.precio_activo != null ? ps.precio_activo : ps.precio);
      });
    }
  }

  function syncFirstScaleToMainForm(firstScale) {
    if (!firstScale) return;
    var margenEl = byId('pa-margen');
    var dispPrecio = byId('pa-precio-display');
    var inputPrecio = byId('pa-precio-final');
    var inputPrecioPieza = byId('pa-precio-pieza-final');
    var inputPrecioCaja = byId('pa-precio-caja-final');
    var histActVal = byId('pa-hist-precio-activo');
    var cantPiezas = Math.max(1, num((byId('pa-paquete-qty') && byId('pa-paquete-qty').value) || 1));

    if (margenEl) {
      margenEl.value = fmt2(firstScale.margen_trabajo);
    }
    var unitPrice = num(firstScale.precio);
    var boxPrice = cantPiezas > 1 ? (unitPrice * cantPiezas) : unitPrice;
    if (dispPrecio) {
      if ('value' in dispPrecio) dispPrecio.value = fmt2(boxPrice);
      else dispPrecio.textContent = '$' + fmt2(boxPrice);
    }
    if (inputPrecio) inputPrecio.value = fmt2(unitPrice);
    if (inputPrecioPieza) inputPrecioPieza.value = fmt2(unitPrice);
    if (inputPrecioCaja) inputPrecioCaja.value = fmt2(boxPrice);
    if (histActVal) histActVal.textContent = '$' + fmt2(unitPrice);
  }

  /* ── Evaluación de Estado de Oferta (Activa, Programada, Pausada, Vencida / Agotada) ── */
  function evaluateOfferRuntimeState(ofItem) {
    if (!ofItem) return { code: 'VENCIDA', label: '⚫ Vencida / Agotada', color: '#64748b' };
    if (ofItem.paused) {
      return { code: 'PAUSADA', label: '⏸️ Pausada', color: '#f59e0b' };
    }
    if (ofItem.modality === 'LIMITE_STOCK') {
      var maxStock = Math.max(1, num(ofItem.max_stock || 0));
      var soldStock = Math.max(0, num(ofItem.sold_stock || 0));
      if (soldStock >= maxStock) {
        return { code: 'AGOTADA', label: '⚫ Agotada (' + soldStock + '/' + maxStock + ')', color: '#ef4444' };
      }
    }
    if (ofItem.vigencia_type === 'FECHAS') {
      var nowMs = Date.now();
      var startMs = ofItem.start_at ? Date.parse(ofItem.start_at) : NaN;
      var endMs = ofItem.end_at ? Date.parse(ofItem.end_at) : NaN;
      if (!isNaN(endMs) && nowMs > endMs) {
        return { code: 'VENCIDA', label: '⚫ Vencida', color: '#64748b' };
      }
      if (!isNaN(startMs) && nowMs < startMs) {
        return { code: 'PROGRAMADA', label: '⏳ Programada', color: '#38bdf8' };
      }
    }
    return { code: 'ACTIVA', label: '🟢 Activa', color: '#10b981' };
  }

  /* ── Aplica o limpia el porcentaje de oferta en las tablas de escalas (MATRIZ y/o Sucursales) ── */
  function applyOfferItemToScalesTables(ofItem, turnOn) {
    if (!ofItem) return;
    ensureProductScalesInitialized();
    var ctx = getEffectiveProductCostContext();
    var costoRef = ctx.costoUnitConFlete;
    var factorIva = ctx.factorIva;
    var pct = turnOn ? num(ofItem.discount_pct) : 0;
    var targetScales = Array.isArray(ofItem.scales) && ofItem.scales.length ? ofItem.scales.map(norm) : ['PRECIO DE LISTA'];
    var bScope = norm(ofItem.branch_scope || 'ALL');
    var targetBranches = Array.isArray(ofItem.branches) ? ofItem.branches.map(norm) : [];

    var appliesToMatriz = (bScope === 'ALL' || bScope === 'MATRIZ' || targetBranches.indexOf('MATRIZ') >= 0);
    if (appliesToMatriz) {
      (global._paProductPriceScales || []).forEach(function (ps, idx) {
        var sNm = norm(ps.scale_name || ps.nombre);
        if (targetScales.indexOf(sNm) < 0) return;
        var mI = num(ps.margen_ideal);
        var mT = mI - pct;
        var p = (turnOn && num(ofItem.offer_price) > 0 && idx === 0 && targetScales.length === 1)
          ? num(ofItem.offer_price)
          : (costoRef > 0 ? (costoRef * (1 + mT / 100) * factorIva) : num(ps.precio));
        var idealRefP = costoRef > 0 ? (costoRef * (1 + mI / 100) * factorIva) : p;
        ps.oferta = Number(pct.toFixed(4));
        ps.margen_trabajo = Number(mT.toFixed(4));
        ps.margin = Number(mT.toFixed(4));
        updateScaleItemPriceAndTrend(ps, p, idealRefP, false);
        if (idx === 0) syncFirstScaleToMainForm(ps);
      });
    }

    (global._paProductBranchScales || []).forEach(function (bs) {
      var bNm = norm(bs.branch_name || bs.branch_id);
      var sNm = norm(bs.scale_name || 'PRECIO DE LISTA');
      if (targetScales.indexOf(sNm) < 0) return;
      var matchBr = (bScope === 'ALL') || (bScope === bNm) || (bScope === 'BRANCHES' && targetBranches.indexOf(bNm) >= 0) || (targetBranches.indexOf(bNm) >= 0);
      if (!matchBr) return;
      var mB = num(bs.margen_ideal);
      var mA = num(bs.sobreprecio_suc);
      var mF = mB + mA - pct;
      var p = costoRef > 0 ? (costoRef * (1 + mF / 100) * factorIva) : num(bs.precio);
      var baseRefP = costoRef > 0 ? (costoRef * (1 + (mB + mA) / 100) * factorIva) : p;
      bs.oferta = Number(pct.toFixed(4));
      bs.margen_final = Number(mF.toFixed(4));
      updateScaleItemPriceAndTrend(bs, p, baseRefP, true);
    });

    renderInlineProductAltaScalesPreview();
  }

  /* ── Resumen de banderas de oferta del producto para Catálogo (Filtro F7) y POS ── */
  function computeProductOfferFlagsSummary() {
    ensureProductScalesInitialized();
    // Verificar ofertas con fecha vencida para apagar su OFERTA (%) automáticamente
    (global._paProductOffers || []).forEach(function (ofItem) {
      var st = evaluateOfferRuntimeState(ofItem);
      ofItem.status = st.code;
      if ((st.code === 'VENCIDA' || st.code === 'AGOTADA') && ofItem.modality === 'ESCALA') {
        applyOfferItemToScalesTables(ofItem, false);
      }
    });

    var maxOferPct = 0;
    var minOferPrice = 0;
    var hasScaleOffer = false;

    (global._paProductPriceScales || []).forEach(function (ps) {
      var ofv = num(ps.oferta);
      if (ofv > 0) {
        hasScaleOffer = true;
        if (ofv > maxOferPct) maxOferPct = ofv;
        if (minOferPrice <= 0 || num(ps.precio) < minOferPrice) minOferPrice = num(ps.precio);
      }
    });
    (global._paProductBranchScales || []).forEach(function (bs) {
      var ofv = num(bs.oferta);
      if (ofv > 0) {
        hasScaleOffer = true;
        if (ofv > maxOferPct) maxOferPct = ofv;
        if (minOferPrice <= 0 || num(bs.precio) < minOferPrice) minOferPrice = num(bs.precio);
      }
    });

    var activeRegisteredOffers = (global._paProductOffers || []).filter(function (o) {
      var st = evaluateOfferRuntimeState(o);
      return st.code === 'ACTIVA' || st.code === 'PROGRAMADA';
    });

    activeRegisteredOffers.forEach(function (o) {
      if (num(o.discount_pct) > maxOferPct) maxOferPct = num(o.discount_pct);
      if (num(o.offer_price) > 0 && (minOferPrice <= 0 || num(o.offer_price) < minOferPrice)) {
        minOferPrice = num(o.offer_price);
      }
    });

    var enOferta = hasScaleOffer || activeRegisteredOffers.length > 0;
    return {
      en_oferta: enOferta,
      oferta_activa: enOferta,
      descuento_oferta: Number(maxOferPct.toFixed(2)),
      precio_oferta: Number(minOferPrice.toFixed(2)),
      product_offers: global._paProductOffers || []
    };
  }
  global.computeProductOfferFlagsSummary = computeProductOfferFlagsSummary;

  function appendModalAndFormPriceHistory(priceFormatted) {
    var nowStr = new Date().toLocaleString('es-MX', {
      day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false
    }).replace(',', '');
    var sidebarName = byId('sidebar-user-name');
    var footUser = byId('pa-foot-user');
    var user = ((sidebarName && sidebarName.textContent.trim()) || (footUser && footUser.textContent.trim()) || 'ANTONIO M.').toUpperCase();
    if (user === 'ADMINISTRADOR') user = 'ANTONIO M.';

    // 1. Tabla en #producto-alta
    var paTbody = byId('pa-price-history-tbody');
    if (paTbody) {
      var emptyRowPa = paTbody.querySelector('[data-empty-history="1"]');
      if (emptyRowPa) emptyRowPa.remove();
      var trPa = document.createElement('tr');
      trPa.innerHTML = '<td><i class="fa-regular fa-clock"></i> ' + esc(nowStr) + '</td>' +
                       '<td class="pa-td-price">' + esc(priceFormatted) + '</td>' +
                       '<td class="pa-td-user">' + esc(user) + '</td>';
      paTbody.insertBefore(trPa, paTbody.firstChild);
    }
    var statPrecio = byId('pa-hist-precio-activo');
    var statFecha = byId('pa-hist-fecha-act');
    if (statPrecio) statPrecio.textContent = priceFormatted;
    if (statFecha) statFecha.textContent = nowStr;

    // 2. Tabla e info en #modal-cambio-precio
    var modal = byId('modal-cambio-precio');
    if (modal) {
      var modalHistTbody = modal.querySelector('.cp-hist tbody');
      if (modalHistTbody) {
        var emptyRowM = modalHistTbody.querySelector('[data-empty-history="1"]');
        if (emptyRowM) emptyRowM.remove();
        var trM = document.createElement('tr');
        trM.innerHTML = '<td><i class="fa-regular fa-clock"></i>' + esc(nowStr) + '</td>' +
                        '<td>' + esc(priceFormatted) + '</td>' +
                        '<td>' + esc(user) + '</td>';
        modalHistTbody.insertBefore(trM, modalHistTbody.firstChild);
      }
      var dateEls = modal.querySelectorAll('.cp-info .cp-info-date');
      if (dateEls.length >= 2) {
        dateEls[1].innerHTML = '<i class="fa-regular fa-calendar"></i>' + esc(nowStr);
      }
    }
  }

  global.saveModalCambioPrecioAndSyncPOS = async function () {
    ensureProductScalesInitialized();
    var modal = byId('modal-cambio-precio');
    var ctxCheck = getEffectiveProductCostContext();
    var costoPiso = ctxCheck.costoPisoConIva;

    // CANDADO OBLIGATORIO #2: Bloqueo estricto contra precios u ofertas menores al Costo Piso en Editar [F1], Sucursales [F2] y Ofertas [F3]
    if (costoPiso > 0) {
      var violatingScale = null;
      (global._paProductPriceScales || []).forEach(function (ps) {
        if (!violatingScale && num(ps.precio) > 0 && num(ps.precio) < costoPiso - 0.005) {
          violatingScale = 'MATRIZ - ' + (ps.scale_name || ps.nombre) + ' ($' + fmt2(ps.precio) + ')';
        }
      });
      (global._paProductBranchScales || []).forEach(function (bs) {
        if (!violatingScale && num(bs.precio) > 0 && num(bs.precio) < costoPiso - 0.005) {
          violatingScale = (bs.branch_name || bs.branch_id) + ' - ' + bs.scale_name + ' ($' + fmt2(bs.precio) + ')';
        }
      });
      (global._paProductOffers || []).forEach(function (ofIt) {
        if (!ofIt || ofIt.paused) return;
        if (ofIt.modality === 'CRUZADA') {
          var nxmT = String(ofIt.nxm_type || '3x2').toUpperCase();
          if (nxmT === 'CRUZADA_SKU' || nxmT === 'COMBO_SKU') {
            var pFloorComb = num(ofIt.combined_costo_piso || costoPiso);
            var revComb = num(ofIt.combined_revenue != null ? ofIt.combined_revenue : ofIt.offer_price);
            if (!violatingScale && pFloorComb > 0 && revComb < pFloorComb - 0.005) {
              violatingScale = 'Oferta ' + nxmT + ' (Ingreso $' + fmt2(revComb) + ' < Costo Piso Combinado $' + fmt2(pFloorComb) + ')';
            }
            return;
          }
        }
        if (!violatingScale && num(ofIt.offer_price) > 0 && num(ofIt.offer_price) < costoPiso - 0.005) {
          violatingScale = 'Oferta ' + (ofIt.modality || '') + ' ($' + fmt2(ofIt.offer_price) + ')';
        }
        if (!violatingScale && Array.isArray(ofIt.volume_tiers)) {
          ofIt.volume_tiers.forEach(function (t, tIdx) {
            if (!violatingScale && num(t.unit_price) > 0 && num(t.unit_price) < costoPiso - 0.005) {
              violatingScale = 'Escalón ' + (tIdx + 1) + ' de Volumen ($' + fmt2(t.unit_price) + ')';
            }
          });
        }
      });
      if (violatingScale) {
        cfgToast('🛑 BLOQUEO DE SEGURIDAD: No se permite aplicar un descuento menor al Precio de Costo con Flete + IVA ($' + fmt2(costoPiso) + '). Revisa: ' + violatingScale, true);
        return;
      }
    }

    if (global._paProductPriceScales && global._paProductPriceScales.length > 0) {
      syncFirstScaleToMainForm(global._paProductPriceScales[0]);
    }

    if (Array.isArray(global._paProductPriceScales)) {
      global._paProductPriceScales.forEach(function (ps) {
        ps.activa = true;
        ps.precio_activo = num(ps.precio);
        ps._lastStepPrice = num(ps.precio);
      });
    }

    if (Array.isArray(global._paProductBranchScales)) {
      global._paProductBranchScales.forEach(function (pbs) {
        pbs.activa = true;
        pbs.precio_activo = num(pbs.precio);
        pbs._lastStepPrice = num(pbs.precio);
      });
    }

    var offerSummary = computeProductOfferFlagsSummary();
    var mainUnitPrice = num(byId('pa-precio-final') && byId('pa-precio-final').value);
    appendModalAndFormPriceHistory('$' + fmt2(mainUnitPrice));

    var skuVal = (byId('pa-sku') && byId('pa-sku').value || '').trim().toUpperCase();
    var descVal = (byId('pa-descripcion') && byId('pa-descripcion').value || '').trim().toUpperCase();

    var savedProductRes = null;
    if (skuVal && descVal && (global._paLoadedExistingProduct || (byId('pa-sat-id') && byId('pa-sat-id').value))) {
      try {
        var ctx = getEffectiveProductCostContext();
        var existingMeta = (global._paLoadedExistingProduct && global._paLoadedExistingProduct.meta_data) || {};
        var quickPayload = {
          sku: skuVal,
          barcode: (byId('pa-codigo') && byId('pa-codigo').value || skuVal).trim().toUpperCase(),
          sales_code: (byId('pa-codigo-alt') && byId('pa-codigo-alt').value || '').trim().toUpperCase(),
          name: descVal,
          description: descVal,
          price: mainUnitPrice,
          stock: num(byId('pa-stock-actual') && byId('pa-stock-actual').value),
          stock_minimo: num(byId('pa-stock-min') && byId('pa-stock-min').value) || null,
          purchase_unit: (byId('pa-pres-compra') && byId('pa-pres-compra').value) || 'PIEZA',
          sale_unit: (byId('pa-unidad-medida') && byId('pa-unidad-medida').value) || 'PIEZA',
          average_cost: Number(ctx.costoUnitConFlete.toFixed(4)),
          price_scales: global._paProductPriceScales || [],
          meta_data: Object.assign({}, existingMeta, {
            costo_raw: ctx.costoRaw,
            flete_pct: ctx.fletePct,
            costo_con_flete: Number(ctx.costoCajaConFlete.toFixed(4)),
            costo_pieza_con_flete: Number(ctx.costoUnitConFlete.toFixed(4)),
            costo_piso_con_iva: ctx.costoPisoConIva,
            margen: num(byId('pa-margen') && byId('pa-margen').value),
            iva: ctx.ivaPct,
            ieps: ctx.iepsPct,
            price_scales: global._paProductPriceScales || [],
            branch_price_scales: global._paProductBranchScales || [],
            product_offers: offerSummary.product_offers,
            en_oferta: offerSummary.en_oferta,
            oferta_activa: offerSummary.oferta_activa,
            descuento_oferta: offerSummary.descuento_oferta,
            precio_oferta: offerSummary.precio_oferta,
            puntos_bloqueados_en_oferta: true,
            last_price_update: new Date().toLocaleString('es-MX')
          })
        };
        var token = localStorage.getItem('session_token') || sessionStorage.getItem('session_token');
        var r = await fetch('/api/products', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': token ? ('Bearer ' + token) : ''
          },
          credentials: 'include',
          body: JSON.stringify(quickPayload)
        });
        if (r.ok) {
          savedProductRes = await r.json();
          global._paLoadedExistingProduct = savedProductRes;
          if (global.CalebsysCatalogStore && typeof global.CalebsysCatalogStore.notifyProductSaved === 'function') {
            global.CalebsysCatalogStore.notifyProductSaved(savedProductRes);
          }
          if (typeof global.loadProducts === 'function' && document.getElementById('productos-tbody')) {
            global.loadProducts();
          }
        }
      } catch (err) {
        console.warn('[Calebsys] Guardado de escalas y ofertas en producto:', err);
      }
    }

    _modalPrecioSnapshot = null;
    closeModalBranchSelectorDropdown();
    closeCopyScalesMenuPopover();

    broadcastPosPricingRealtime({
      sku: skuVal || null,
      product: savedProductRes || null,
      product_price_scales: global._paProductPriceScales || [],
      product_branch_scales: global._paProductBranchScales || [],
      product_offers: global._paProductOffers || []
    });

    if (modal) modal.style.display = 'none';
    cfgToast('Precios y ofertas del producto guardados y sincronizados con POS.');
  };

  /* ── Renderizado de la pestaña `🏷️ Ofertas F3` (Tabla Multiescalón Volumen + Candado 0 Puntos + Candado Costo Piso + Comisiones) ── */
  function renderOfertasF3PanelInModal(modal) {
    var bodyEl = modal.querySelector('.cp-body');
    if (!bodyEl) return;
    var container = byId('cp-ofertas-f3-container');
    if (!container) {
      container = document.createElement('div');
      container.id = 'cp-ofertas-f3-container';
      container.style.cssText = 'display:flex;flex-direction:column;gap:12px;';
      bodyEl.appendChild(container);
    }
    container.style.display = 'flex';

    ensureProductScalesInitialized();
    var ctx = getEffectiveProductCostContext();
    var costoRef = ctx.costoUnitConFlete;
    var factorIva = ctx.factorIva;
    var costoPisoConIva = ctx.costoPisoConIva;

    // Leer checkboxes de Atributos y Configuración en #producto-alta
    var chkNoOfertasCal = !!(byId('pa-kardex-no-ofertas-cal') && byId('pa-kardex-no-ofertas-cal').checked);
    var chkNoOfertasDepto = !!(byId('pa-kardex-no-ofertas-depto') && byId('pa-kardex-no-ofertas-depto').checked);
    var chkNoDescCaja = !!(byId('pa-kardex-no-desc') && byId('pa-kardex-no-desc').checked);
    var chkOfertasCruzadas = !!(byId('pa-kardex-ofertas-cruzadas') && byId('pa-kardex-ofertas-cruzadas').checked);
    var normalPointsConfig = num(byId('pa-puntos') && byId('pa-puntos').value);

    var secBranches = getModalRegisteredBranchOptions().filter(function (o) { return norm(o.value) !== 'MATRIZ'; });
    var preselectedBranch = norm(_lastBranchBeforeOfertas || (_modalBranchFilter && _modalBranchFilter !== 'MATRIZ' ? _modalBranchFilter : ''));
    var defaultScope = preselectedBranch ? 'BRANCHES' : 'ALL';

    var scalesList = (global._paProductPriceScales || []).map(function (ps) {
      return norm(ps.scale_name || ps.nombre);
    });
    if (!scalesList.length) {
      scalesList = ['PRECIO DE LISTA', 'CONTRATISTA', 'REVENTA', 'CREDITO', 'CREDITOS ESPECIALES'];
    }

    function getReferenceNormalScaleObj(scopeMode, checkedBranches, checkedScales) {
      var targetScale = (checkedScales && checkedScales[0]) ? norm(checkedScales[0]) : 'PRECIO DE LISTA';
      if (scopeMode === 'BRANCHES' && checkedBranches && checkedBranches.length > 0) {
        var bTarget = norm(checkedBranches[0]);
        var bsMatch = (global._paProductBranchScales || []).filter(function (bs) {
          return norm(bs.branch_name || bs.branch_id) === bTarget && norm(bs.scale_name) === targetScale;
        })[0];
        if (bsMatch) {
          var mNormB = num(bsMatch.margen_ideal) + num(bsMatch.sobreprecio_suc);
          var pNormB = costoRef > 0 ? Number((costoRef * (1 + mNormB / 100) * factorIva).toFixed(2)) : num(bsMatch.precio);
          return {
            margenNormal: mNormB,
            precioNormal: pNormB,
            currentOfertaPct: num(bsMatch.oferta),
            comisionBase: num(bsMatch.comision),
            scaleName: targetScale,
            branchLabel: bTarget
          };
        }
      }
      var psMatch = (global._paProductPriceScales || []).filter(function (ps) {
        return norm(ps.scale_name || ps.nombre) === targetScale;
      })[0] || (global._paProductPriceScales || [])[0];
      var mNormM = psMatch ? num(psMatch.margen_ideal) : 50;
      var pNormM = costoRef > 0 ? Number((costoRef * (1 + mNormM / 100) * factorIva).toFixed(2)) : (psMatch ? num(psMatch.precio) : 0);
      return {
        margenNormal: mNormM,
        precioNormal: pNormM,
        currentOfertaPct: psMatch ? num(psMatch.oferta) : 0,
        comisionBase: psMatch ? num(psMatch.comision) : 0,
        scaleName: targetScale,
        branchLabel: 'MATRIZ'
      };
    }

    var initRef = getReferenceNormalScaleObj(defaultScope, preselectedBranch ? [preselectedBranch] : [], ['PRECIO DE LISTA']);
    var initPct = initRef.currentOfertaPct > 0 ? initRef.currentOfertaPct : 10;
    var initOfferPrice = costoRef > 0
      ? Number((costoRef * (1 + (initRef.margenNormal - initPct) / 100) * factorIva).toFixed(2))
      : Number((initRef.precioNormal * (1 - initPct / 100)).toFixed(2));

    // Estado reactivo de la Tabla Dinámica Multiescalón de Volumen (Ejemplo Cemento: 10-40 -> 5%, 41-100 -> +3% = 8%, 101+ -> +2% = 10%)
    var existingVolOffer = (global._paProductOffers || []).filter(function (o) {
      return o && o.modality === 'VOLUMEN' && Array.isArray(o.volume_tiers) && o.volume_tiers.length > 0;
    })[0];

    var _volTiersState = existingVolOffer
      ? JSON.parse(JSON.stringify(existingVolOffer.volume_tiers))
      : [
          { min_qty: 10, max_qty: 40, add_pct: 5.00, total_pct: 5.00, unit_price: 0, zero_commission: false },
          { min_qty: 41, max_qty: 100, add_pct: 3.00, total_pct: 8.00, unit_price: 0, zero_commission: false },
          { min_qty: 101, max_qty: 0, add_pct: 2.00, total_pct: 10.00, unit_price: 0, zero_commission: true }
        ];

    var attrAlerts = [];
    if (chkNoOfertasCal) {
      attrAlerts.push('<span style="display:inline-flex;align-items:center;gap:5px;padding:3px 9px;border-radius:6px;background:rgba(239,68,68,0.16);border:1px solid #ef4444;color:#f87171;font-size:11.5px;font-weight:800;"><i class="fa-solid fa-ban"></i> No aplica en ofertas calendarizadas (Fechas bloqueadas)</span>');
    }
    if (chkNoOfertasDepto) {
      attrAlerts.push('<span style="display:inline-flex;align-items:center;gap:5px;padding:3px 9px;border-radius:6px;background:rgba(245,158,11,0.16);border:1px solid #f59e0b;color:#fbbf24;font-size:11.5px;font-weight:800;"><i class="fa-solid fa-shield-halved"></i> Excluido de ofertas por departamento</span>');
    }
    if (chkNoDescCaja) {
      attrAlerts.push('<span style="display:inline-flex;align-items:center;gap:5px;padding:3px 9px;border-radius:6px;background:rgba(56,189,248,0.15);border:1px solid #38bdf8;color:#38bdf8;font-size:11.5px;font-weight:800;"><i class="fa-solid fa-lock"></i> Sin descuento manual en caja POS</span>');
    }

    container.innerHTML =
      (attrAlerts.length ? ('<div style="display:flex;align-items:center;flex-wrap:wrap;gap:8px;padding:8px 12px;border-radius:10px;background:var(--cp-panel);border:1px solid var(--cp-line);">' + attrAlerts.join('') + '</div>') : '') +

      /* ── PASO 1: ALCANCE DE SUCURSAL, ESCALAS Y MODALIDAD DE OFERTA ── */
      '<div style="border:1px solid var(--cp-line);border-radius:12px;background:var(--cp-panel);padding:12px 16px;">' +
        '<div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px;margin-bottom:10px;">' +
          '<div style="font-size:13px;font-weight:900;color:var(--cp-accent);text-transform:uppercase;letter-spacing:.3px;display:flex;align-items:center;gap:7px;">' +
            '<span style="background:#0284c7;color:#fff;padding:2px 8px;border-radius:6px;font-size:11px;">PASO 1</span> Alcance de Sucursal, Escalas y Modalidad de Oferta' +
          '</div>' +
          '<div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;">' +
            '<span style="padding:3px 9px;border-radius:6px;background:rgba(245,158,11,0.15);border:1px solid rgba(245,158,11,0.5);color:#f59e0b;font-size:11px;font-weight:800;">🚫 Puntos Bloqueados en Oferta/Volumen (0 Pts)</span>' +
            '<span style="padding:3px 9px;border-radius:6px;background:rgba(16,185,129,0.14);border:1px solid rgba(16,185,129,0.45);color:#10b981;font-size:11px;font-weight:800;">🛡️ Costo Piso c/IVA: $' + fmt2(costoPisoConIva) + '</span>' +
          '</div>' +
        '</div>' +

        '<div style="display:grid;grid-template-columns:1.1fr 1.1fr 1.35fr;gap:14px;">' +
          /* Columna 1: ¿En qué sucursal aplica esta oferta? */
          '<div style="padding:10px 12px;border-radius:10px;border:1px solid var(--cp-line);background:var(--cp-input-bg);">' +
            '<div style="font-size:11.5px;font-weight:800;color:var(--cp-title);margin-bottom:8px;">1. ¿En qué sucursal aplica esta oferta?</div>' +
            '<div style="display:flex;flex-direction:column;gap:6px;font-size:12px;">' +
              '<label style="display:flex;align-items:center;gap:7px;cursor:pointer;font-weight:700;">' +
                '<input type="radio" name="cp-of-scope" value="ALL"' + (defaultScope === 'ALL' ? ' checked' : '') + '> 🌐 Todas las Sucursales (Matriz + Sucursales)' +
              '</label>' +
              '<label style="display:flex;align-items:center;gap:7px;cursor:pointer;font-weight:700;">' +
                '<input type="radio" name="cp-of-scope" value="MATRIZ"' + (defaultScope === 'MATRIZ' ? ' checked' : '') + '> 🏢 Exclusiva para MATRIZ' +
              '</label>' +
              '<label style="display:flex;align-items:center;gap:7px;cursor:pointer;font-weight:700;">' +
                '<input type="radio" name="cp-of-scope" value="BRANCHES"' + (defaultScope === 'BRANCHES' ? ' checked' : '') + '> 🏪 Exclusiva para Sucursal específica' +
              '</label>' +
              '<div id="cp-of-branches-list" style="margin-left:18px;padding:6px 8px;border-radius:8px;border:1px dashed var(--cp-line);display:' + (defaultScope === 'BRANCHES' ? 'flex' : 'none') + ';flex-direction:column;gap:5px;max-height:85px;overflow-y:auto;">' +
                (secBranches.length ? secBranches.map(function (b) {
                  var isChk = (preselectedBranch && norm(b.value) === preselectedBranch) || (!preselectedBranch && secBranches.length === 1);
                  return '<label style="display:flex;align-items:center;gap:6px;font-size:11.5px;font-weight:700;cursor:pointer;color:#38bdf8;">' +
                    '<input type="checkbox" class="cp-of-branch-chk" value="' + esc(b.value) + '"' + (isChk ? ' checked' : '') + '> 🏪 ' + esc(b.label) +
                  '</label>';
                }).join('') : '<span style="font-size:11px;color:var(--cp-muted);">Sin sucursales secundarias registradas</span>') +
              '</div>' +
            '</div>' +
          '</div>' +

          /* Columna 2: ¿En qué escalas aplica? (Candado de Crédito) */
          '<div style="padding:10px 12px;border-radius:10px;border:1px solid var(--cp-line);background:var(--cp-input-bg);">' +
            '<div style="font-size:11.5px;font-weight:800;color:var(--cp-title);margin-bottom:8px;">2. ¿En qué escalas aplica?</div>' +
            '<div style="display:flex;flex-direction:column;gap:5px;font-size:12px;">' +
              scalesList.map(function (scName) {
                var isCredit = scName.indexOf('CREDITO') >= 0 || scName.indexOf('CRÉDITO') >= 0;
                var isDefaultChecked = (scName === 'PRECIO DE LISTA');
                return '<div class="cp-of-scale-row" style="display:flex;align-items:center;justify-content:space-between;gap:6px;font-weight:700;">' +
                  '<label class="cp-of-scale-lbl" data-is-credit="' + (isCredit ? '1' : '0') + '" style="display:inline-flex;align-items:center;gap:6px;cursor:' + (isCredit ? 'not-allowed;opacity:0.65' : 'pointer') + ';">' +
                    '<input type="checkbox" class="cp-of-scale-chk" value="' + esc(scName) + '"' + (isDefaultChecked ? ' checked' : '') + (isCredit ? ' disabled data-credit-locked="1"' : '') + '> ' + esc(scName) +
                  '</label>' +
                  (isCredit ? '<button type="button" class="cp-of-credit-lock-btn" data-scale="' + esc(scName) + '" title="Haz clic aquí para desbloquear o bloquear esta escala de crédito" style="font-size:10.5px;font-weight:800;padding:2px 8px;border-radius:5px;background:rgba(245,158,11,0.16);color:#f59e0b;border:1px solid rgba(245,158,11,0.55);cursor:pointer;transition:all .15s;">🔒 Candado Crédito</button>' : '') +
                '</div>';
              }).join('') +
            '</div>' +
          '</div>' +

          /* Columna 3: Selector de las 5 Modalidades de Oferta */
          '<div style="padding:10px 12px;border-radius:10px;border:1px solid var(--cp-line);background:var(--cp-input-bg);">' +
            '<div style="font-size:11.5px;font-weight:800;color:var(--cp-title);margin-bottom:6px;">3. Modalidad de Oferta</div>' +
            '<select id="cp-of-modality-select" style="width:100%;height:33px;padding:0 10px;border-radius:8px;border:1.5px solid var(--cp-accent);background:var(--cp-panel);color:var(--cp-text);font-size:12px;font-weight:800;margin-bottom:8px;outline:none;">' +
              '<option value="ESCALA">🏷️ 1. Oferta en Precio / Escala (Directa o con Vigencia)</option>' +
              '<option value="VOLUMEN">📦 2. Oferta por Volumen / Mayoreo Escalonado</option>' +
              '<option value="LIMITE_STOCK">🔥 3. Liquidación por Límite de Stock (Hasta agotar piezas)</option>' +
              '<option value="CRUZADA">🤝 4. Promoción Múltiple o Cruzada (3x2 / Combo / Kit)</option>' +
              '<option value="CONTADO">💵 5. Bonificación Exclusiva Pago de Contado (Efectivo / Transf.)</option>' +
            '</select>' +

            /* Subpanel Modalidad 1: Vigencia Inmediata vs Programada por Fechas */
            '<div id="cp-of-mod-panel-ESCALA" class="cp-of-mod-subpanel" style="display:flex;flex-direction:column;gap:6px;">' +
              '<div style="display:flex;align-items:center;gap:12px;font-size:11.5px;font-weight:700;">' +
                '<label style="display:inline-flex;align-items:center;gap:5px;cursor:pointer;">' +
                  '<input type="radio" name="cp-of-vigencia" value="PERMANENTE" checked> ⚡ Inmediata / Permanente' +
                '</label>' +
                '<label style="display:inline-flex;align-items:center;gap:5px;cursor:' + (chkNoOfertasCal ? 'not-allowed;opacity:.55' : 'pointer') + ';">' +
                  '<input type="radio" name="cp-of-vigencia" value="FECHAS"' + (chkNoOfertasCal ? ' disabled' : '') + '> 📅 Programada por Fechas' +
                '</label>' +
              '</div>' +
              '<div id="cp-of-dates-wrap" style="display:none;grid-template-columns:1fr 1fr;gap:6px;margin-top:2px;">' +
                '<div>' +
                  '<div style="font-size:10px;color:var(--cp-muted);font-weight:700;">Fecha/Hora Inicio</div>' +
                  '<input type="datetime-local" id="cp-of-date-start" style="width:100%;height:28px;font-size:11px;padding:0 6px;border-radius:6px;border:1px solid var(--cp-input-border);background:var(--cp-panel);color:var(--cp-text);">' +
                '</div>' +
                '<div>' +
                  '<div style="font-size:10px;color:var(--cp-muted);font-weight:700;">Fecha/Hora Fin</div>' +
                  '<input type="datetime-local" id="cp-of-date-end" style="width:100%;height:28px;font-size:11px;padding:0 6px;border-radius:6px;border:1px solid var(--cp-input-border);background:var(--cp-panel);color:var(--cp-text);">' +
                '</div>' +
              '</div>' +
            '</div>' +

            /* Subpanel Modalidad 2: Aviso corto (la Tabla Dinámica Multiescalón se despliega abajo a todo lo ancho) */
            '<div id="cp-of-mod-panel-VOLUMEN" class="cp-of-mod-subpanel" style="display:none;padding:6px 10px;border-radius:8px;background:rgba(56,189,248,0.12);border:1px solid rgba(56,189,248,0.45);color:#38bdf8;font-size:11.5px;font-weight:700;">' +
              '📦 Configura abajo la <b>Tabla Dinámica de Escalones de Volumen</b> con <b>+ % Adicional Acumulable</b>, cálculo bidireccional y candado de Costo Piso.' +
            '</div>' +

            /* Subpanel Modalidad 3: Liquidación por Límite de Stock */
            '<div id="cp-of-mod-panel-LIMITE_STOCK" class="cp-of-mod-subpanel" style="display:none;align-items:center;justify-content:space-between;gap:10px;">' +
              '<div style="flex:1;">' +
                '<div style="font-size:10.5px;color:var(--cp-muted);font-weight:700;">Piezas máximas en oferta</div>' +
                '<input type="number" id="cp-of-stock-max" value="15" min="1" step="1" style="width:110px;height:29px;padding:0 8px;border-radius:6px;border:1px solid #f59e0b;background:var(--cp-panel);color:var(--cp-text);font-weight:800;">' +
              '</div>' +
              '<div style="padding:6px 12px;border-radius:8px;background:rgba(245,158,11,0.15);border:1px solid #f59e0b;color:#f59e0b;font-size:12px;font-weight:900;">' +
                '🔥 Vendidas: <span id="cp-of-stock-sold-lbl">0</span> / <span id="cp-of-stock-max-lbl">15</span>' +
              '</div>' +
            '</div>' +

            /* Subpanel Modalidad 4: Promoción Múltiple o Cruzada (3 Sub-Modos: Mismo Producto NxM | Oferta Cruzada A->B | Combo/Kit A+B) */
            '<div id="cp-of-mod-panel-CRUZADA" class="cp-of-mod-subpanel" style="display:none;flex-direction:column;gap:6px;">' +
              '<div style="display:grid;grid-template-columns:1fr 1.15fr;gap:6px;align-items:start;">' +
                '<div>' +
                  '<div style="font-size:10px;color:var(--cp-muted);font-weight:700;">Esquema NxM / Cruzada / Combo</div>' +
                  '<select id="cp-of-nxm-type" style="width:100%;height:28px;font-size:11.3px;padding:0 6px;border-radius:6px;border:1px solid var(--cp-input-border);background:var(--cp-panel);color:var(--cp-text);font-weight:800;">' +
                    '<optgroup label="SUB-MODO A: Promoción Múltiple del MISMO Producto">' +
                      '<option value="3x2">3x2 Mismo Producto (Lleva 3, Paga 2 -> 33.33% desc.)</option>' +
                      '<option value="4x3">4x3 Mismo Producto (Lleva 4, Paga 3 -> 25.00% desc.)</option>' +
                      '<option value="2DO_50">2do al 50% Mismo Producto (Lleva 2, 2do mitad -> 25% par)</option>' +
                      '<option value="2x1">2x1 Mismo Producto (Lleva 2, Paga 1 -> 50.00% desc.)</option>' +
                    '</optgroup>' +
                    '<optgroup label="SUB-MODO B: Oferta Cruzada (Compra A ➔ Descuento en B)">' +
                      '<option value="CRUZADA_SKU">🔗 Oferta Cruzada (Compra este Prod. A ➔ Desc. en SKU B)</option>' +
                    '</optgroup>' +
                    '<optgroup label="SUB-MODO C: Combo / Kit Promocional (Paquete A + B)">' +
                      '<option value="COMBO_SKU">🎁 Combo / Kit Promocional (Paquete A + SKU B por Precio Paquete)</option>' +
                    '</optgroup>' +
                  '</select>' +
                '</div>' +

                /* Etiqueta informativa cuando es Sub-Modo A (Mismo Producto: oculta SKU Vinculado para no confundir) */
                '<div id="cp-of-same-prod-badge" style="padding:5px 9px;border-radius:6px;background:rgba(56,189,248,0.11);border:1px dashed rgba(56,189,248,0.45);color:#38bdf8;font-size:10.5px;font-weight:800;line-height:1.3;margin-top:12px;">' +
                  '<i class="fa-solid fa-Repeat"></i> Aplica comprando múltiplos de este mismo producto' +
                '</div>' +

                /* Buscador intacto de SKU Vinculado (Visible en Sub-Modo B Cruzada y Sub-Modo C Combo) */
                '<div id="cp-of-linked-sku-wrap" style="display:none;position:relative;">' +
                  '<div style="font-size:10px;color:#38bdf8;font-weight:800;">SKU Vinculado — Producto B (Buscador)</div>' +
                  '<div style="position:relative;display:flex;align-items:center;">' +
                    '<button type="button" id="cp-of-linked-sku-btn" title="Buscar producto por SKU, código, nombre o marca" style="position:absolute;left:2px;top:2px;bottom:2px;width:24px;border:none;background:transparent;color:#38bdf8;cursor:pointer;display:inline-flex;align-items:center;justify-content:center;font-size:11.5px;"><i class="fa-solid fa-magnifying-glass"></i></button>' +
                    '<input type="text" id="cp-of-linked-sku" autocomplete="off" placeholder="Buscar SKU, nombre, código o marca..." style="width:100%;height:28px;font-size:11.5px;padding:0 24px 0 26px;border-radius:6px;border:1px solid #38bdf8;background:var(--cp-panel);color:var(--cp-text);text-transform:uppercase;font-weight:800;outline:none;">' +
                    '<button type="button" id="cp-of-linked-sku-clear" title="Limpiar SKU vinculado" style="display:none;position:absolute;right:2px;top:2px;bottom:2px;width:22px;border:none;background:transparent;color:var(--cp-muted);cursor:pointer;align-items:center;justify-content:center;font-size:12px;"><i class="fa-solid fa-xmark"></i></button>' +
                  '</div>' +
                  '<div id="cp-of-linked-sku-dropdown" style="display:none;position:absolute;right:0;top:calc(100% + 4px);width:470px;max-width:88vw;max-height:300px;overflow-y:auto;z-index:10099;border-radius:10px;border:1.5px solid #38bdf8;background:#0b1324;box-shadow:0 18px 42px rgba(2,6,23,0.85);"></div>' +
                '</div>' +
              '</div>' +

              /* Condición de Cantidades (A y B) para Sub-Modo B (Cruzada) y Sub-Modo C (Combo) */
              '<div id="cp-of-cross-qty-row" style="display:none;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:6px;padding:5px 8px;border-radius:6px;background:var(--cp-panel);border:1px solid var(--cp-line);font-size:11px;font-weight:700;">' +
                '<div style="display:inline-flex;align-items:center;gap:5px;flex-wrap:wrap;">' +
                  '<span id="cp-of-qty-a-lbl">Al comprar</span>' +
                  '<input type="number" id="cp-of-qty-a" value="1" min="1" step="1" style="width:48px;height:24px;text-align:center;border-radius:5px;border:1px solid #38bdf8;background:var(--cp-input-bg);color:var(--cp-text);font-weight:900;font-size:11.5px;">' +
                  '<span>pza(s) Prod. A ➔</span>' +
                  '<span id="cp-of-qty-b-lbl">Aplicar a</span>' +
                  '<input type="number" id="cp-of-qty-b" value="1" min="1" step="1" style="width:48px;height:24px;text-align:center;border-radius:5px;border:1px solid #f59e0b;background:var(--cp-input-bg);color:var(--cp-text);font-weight:900;font-size:11.5px;">' +
                  '<span>pza(s) SKU B</span>' +
                '</div>' +
                '<button type="button" id="cp-of-btn-free-b" title="Aplicar 100% Gratis ($0.00) al Producto B (válido solo si el precio de A cubre ambos Costos Piso)" style="padding:2px 8px;border-radius:5px;border:1px solid #10b981;background:rgba(16,185,129,0.14);color:#10b981;font-size:10.5px;font-weight:800;cursor:pointer;">🎁 100% Gratis en B</button>' +
              '</div>' +

              /* Tarjeta informativa compacta con los datos reales del Producto B */
              '<div id="cp-of-linked-sku-picked-info" style="display:none;padding:6px 10px;border-radius:7px;background:rgba(56,189,248,0.13);border:1px solid rgba(56,189,248,0.45);color:#38bdf8;font-size:11px;font-weight:800;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:6px;"></div>' +

              '<div style="font-size:10.5px;color:' + (chkOfertasCruzadas ? '#10b981' : '#f59e0b') + ';font-weight:700;">' +
                '<i class="fa-solid fa-link"></i> ' + (chkOfertasCruzadas ? 'Casilla «Manejo ofertas cruzadas» activa en este producto.' : 'Al registrar se activará automáticamente «Manejo ofertas cruzadas» en Atributos.') +
              '</div>' +
            '</div>' +

            /* Subpanel Modalidad 5: Bonificación Exclusiva Pago de Contado */
            '<div id="cp-of-mod-panel-CONTADO" class="cp-of-mod-subpanel" style="display:none;padding:6px 10px;border-radius:8px;background:rgba(16,185,129,0.12);border:1px solid rgba(16,185,129,0.4);color:#10b981;font-size:11.5px;font-weight:700;">' +
              '💵 Aplica en el POS únicamente si el cliente liquida en <b>Efectivo</b> o <b>Transferencia</b> (se desactiva en Tarjeta o Crédito).' +
            '</div>' +
          '</div>' +
        '</div>' +

        /* ── TABLA DINÁMICA MULTIESCALÓN DE VOLUMEN (VISIBLE AL ELEGIR MODALIDAD 2) ── */
        '<div id="cp-of-volumen-multitier-box" style="display:none;margin-top:12px;padding:12px 14px;border-radius:10px;border:1.5px solid #38bdf8;background:var(--cp-input-bg);">' +
          '<div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:10px;margin-bottom:8px;">' +
            '<div style="display:flex;align-items:center;gap:8px;font-size:12.5px;font-weight:900;color:#38bdf8;">' +
              '<i class="fa-solid fa-boxes-stacked"></i> TABLA DINÁMICA DE ESCALONES POR VOLUMEN (% ADICIONAL ACUMULABLE)' +
            '</div>' +
            '<div style="display:flex;align-items:center;gap:8px;">' +
              '<span style="font-size:11px;font-weight:700;color:var(--cp-muted);">De 1 a <b id="cp-of-vol-normal-max-lbl">9</b> pzas = Precio Normal (' + fmt2(normalPointsConfig) + ' Pts) | En Escalón = <b style="color:#f59e0b;">🚫 0 Pts</b></span>' +
              '<button type="button" id="cp-of-add-tier-btn" style="height:30px;padding:0 12px;border-radius:7px;border:1px solid #10b981;background:rgba(16,185,129,0.16);color:#10b981;font-size:11.5px;font-weight:800;cursor:pointer;display:inline-flex;align-items:center;gap:5px;">' +
                '<i class="fa-solid fa-plus"></i> ➕ Agregar Escalón' +
              '</button>' +
            '</div>' +
          '</div>' +
          '<div style="overflow-x:auto;">' +
            '<table style="width:100%;border-collapse:collapse;font-size:12px;">' +
              '<thead>' +
                '<tr style="border-bottom:1px solid var(--cp-line);color:var(--cp-muted);font-size:10.5px;text-transform:uppercase;">' +
                  '<th style="padding:6px 6px;text-align:left;white-space:nowrap;">Escalón #</th>' +
                  '<th style="padding:6px 6px;text-align:center;white-space:nowrap;">De (pzas)</th>' +
                  '<th style="padding:6px 6px;text-align:center;white-space:nowrap;">Hasta (0 = Sin límite)</th>' +
                  '<th style="padding:6px 6px;text-align:right;color:#fbbf24;white-space:nowrap;">% Desc. Base / + % Adicional</th>' +
                  '<th style="padding:6px 6px;text-align:right;color:#f59e0b;white-space:nowrap;">= % Acumulado Total</th>' +
                  '<th style="padding:6px 6px;text-align:right;color:#38bdf8;white-space:nowrap;">$ Precio Unit. Final (IVA incl.)</th>' +
                  '<th style="padding:6px 6px;text-align:center;white-space:nowrap;">Comisión Vend.</th>' +
                  '<th style="padding:6px 8px;text-align:left;white-space:nowrap;">Semáforo de Utilidad y Candados</th>' +
                '</tr>' +
              '</thead>' +
              '<tbody id="cp-of-vol-tiers-tbody"></tbody>' +
            '</table>' +
          '</div>' +
        '</div>' +
      '</div>' +

      /* ── PASO 2: CALCULADORA BIDIRECCIONAL (% ↔ $) Y SEMÁFORO ANTI-PÉRDIDA ── */
      '<div id="cp-of-step2-box" style="border:1px solid var(--cp-line);border-radius:12px;background:var(--cp-panel);padding:12px 16px;">' +
        '<div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:10px;margin-bottom:10px;">' +
          '<div style="font-size:13px;font-weight:900;color:#f59e0b;text-transform:uppercase;letter-spacing:.3px;display:flex;align-items:center;gap:7px;">' +
            '<span style="background:#f59e0b;color:#0f172a;padding:2px 8px;border-radius:6px;font-size:11px;font-weight:900;">PASO 2</span> Calculadora Bidireccional (% ↔ $), Semáforo Anti-Pérdida y Protección de Comisión' +
          '</div>' +
          '<div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;">' +
            '<label style="display:inline-flex;align-items:center;gap:5px;font-size:11.5px;font-weight:800;color:var(--cp-muted);cursor:pointer;" title="Opcional: poner 0.00% de comisión al vendedor cuando aplique esta oferta">' +
              '<input type="checkbox" id="cp-of-zero-comm-chk"> 0.00% Comisión Vendedor en esta oferta' +
            '</label>' +
            '<span style="padding:3px 9px;border-radius:6px;background:rgba(239,68,68,0.14);border:1px solid rgba(239,68,68,0.45);color:#f87171;font-size:11px;font-weight:800;">🔒 Candado Costo Piso Estricto ($' + fmt2(costoPisoConIva) + ')</span>' +
          '</div>' +
        '</div>' +

        '<div id="cp-of-single-calc-grid" style="display:grid;grid-template-columns:205px 36px 245px 1fr auto;align-items:center;gap:10px;">' +
          '<div>' +
            '<label id="cp-of-lbl-calc-pct" style="display:block;font-size:11px;font-weight:800;color:#f59e0b;margin-bottom:4px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">⚙️ % Descuento de Oferta</label>' +
            '<div style="position:relative;">' +
              '<input type="text" inputmode="decimal" autocomplete="off" id="cp-of-calc-pct" value="' + fmt2(initPct) + '" style="width:100%;height:38px;padding:0 28px 0 12px;border-radius:9px;border:1.5px solid #f59e0b;background:var(--cp-input-bg);color:#f59e0b;font-size:15px;font-weight:900;text-align:right;outline:none;">' +
              '<span style="position:absolute;right:10px;top:50%;transform:translateY(-50%);color:#f59e0b;font-weight:900;pointer-events:none;">%</span>' +
            '</div>' +
          '</div>' +

          '<div style="text-align:center;font-size:18px;color:var(--cp-accent);padding-top:16px;"><i class="fa-solid fa-right-left"></i></div>' +

          '<div>' +
            '<label id="cp-of-lbl-calc-price" style="display:block;font-size:11px;font-weight:800;color:#38bdf8;margin-bottom:4px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">$ Precio Final de Oferta (IVA incl.)</label>' +
            '<div style="position:relative;">' +
              '<span style="position:absolute;left:10px;top:50%;transform:translateY(-50%);color:#38bdf8;font-weight:900;pointer-events:none;">$</span>' +
              '<input type="text" inputmode="decimal" autocomplete="off" id="cp-of-calc-price" value="' + fmt2(initOfferPrice) + '" style="width:100%;height:38px;padding:0 12px 0 24px;border-radius:9px;border:1.5px solid #38bdf8;background:var(--cp-input-bg);color:var(--cp-text);font-size:15px;font-weight:900;text-align:right;outline:none;">' +
            '</div>' +
          '</div>' +

          /* Barra de Resumen Financiero en Vivo (Semáforo + Candado 0 Puntos + Comisión Real) */
          '<div id="cp-of-semaforo-bar" style="padding:9px 14px;border-radius:10px;border:1.5px solid #10b981;background:rgba(16,185,129,0.10);display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px;">' +
          '</div>' +

          '<div style="padding-top:14px;">' +
            '<button type="button" id="cp-of-apply-btn" style="height:40px;padding:0 18px;border-radius:10px;border:1.5px solid #f59e0b;background:linear-gradient(135deg,#d97706,#f59e0b);color:#ffffff;font-size:13px;font-weight:900;cursor:pointer;display:inline-flex;align-items:center;gap:8px;white-space:nowrap;box-shadow:0 4px 14px rgba(245,158,11,0.35);">' +
              '<i class="fa-solid fa-bolt"></i> Aplicar Oferta' +
            '</button>' +
          '</div>' +
        '</div>' +

        '<div id="cp-of-cost-lock-alert" style="display:none;margin-top:8px;padding:8px 12px;border-radius:8px;background:rgba(239,68,68,0.18);border:1.5px solid #ef4444;color:#f87171;font-size:12px;font-weight:800;align-items:center;gap:8px;">' +
          '<i class="fa-solid fa-hand"></i> ' +
          '<span>🛑 BLOQUEO DE SEGURIDAD: No se permite aplicar un descuento menor al Precio de Costo con Flete + IVA ($' + fmt2(costoPisoConIva) + ').</span>' +
        '</div>' +
      '</div>' +

      /* ── PASO 3: TABLA DE OFERTAS DEL PRODUCTO ── */
      '<div style="border:1px solid var(--cp-line);border-radius:12px;background:var(--cp-panel);overflow:hidden;">' +
        '<div style="display:flex;align-items:center;justify-content:space-between;padding:9px 16px;background:var(--cp-thead);border-bottom:1px solid var(--cp-line);">' +
          '<div style="font-size:12.5px;font-weight:900;color:var(--cp-title);display:flex;align-items:center;gap:8px;">' +
            '<span style="background:#10b981;color:#fff;padding:2px 8px;border-radius:6px;font-size:11px;">PASO 3</span> Tabla de Ofertas Registradas en el Producto' +
          '</div>' +
          '<span id="cp-of-table-count" style="font-size:11.5px;font-weight:700;color:var(--cp-muted);"></span>' +
        '</div>' +
        '<div style="max-height:190px;overflow-y:auto;">' +
          '<table style="width:100%;border-collapse:collapse;font-size:12.5px;">' +
            '<thead>' +
              '<tr style="border-bottom:1px solid var(--cp-line);color:var(--cp-muted);font-size:11px;text-transform:uppercase;">' +
                '<th style="padding:8px 12px;text-align:left;">Sucursal</th>' +
                '<th style="padding:8px 12px;text-align:left;">Escalas</th>' +
                '<th style="padding:8px 12px;text-align:left;">Modalidad, Escalones y Candados</th>' +
                '<th style="padding:8px 12px;text-align:right;">% Oferta</th>' +
                '<th style="padding:8px 12px;text-align:right;">$ Precio Oferta</th>' +
                '<th style="padding:8px 12px;text-align:center;">Estado</th>' +
                '<th style="padding:8px 12px;text-align:right;">Acciones Rápidas</th>' +
              '</tr>' +
            '</thead>' +
            '<tbody id="cp-of-registered-tbody"></tbody>' +
          '</table>' +
        '</div>' +
      '</div>';

    function getSelectedScopeAndBranches() {
      var r = container.querySelector('input[name="cp-of-scope"]:checked');
      var sc = r ? r.value : 'ALL';
      var brs = [];
      if (sc === 'BRANCHES') {
        container.querySelectorAll('.cp-of-branch-chk:checked').forEach(function (c) {
          brs.push(norm(c.value));
        });
      }
      return { scope: sc, branches: brs };
    }

    function getSelectedScales() {
      var list = [];
      container.querySelectorAll('.cp-of-scale-chk:checked').forEach(function (c) {
        if (c.dataset.creditLocked === '1') return;
        list.push(norm(c.value));
      });
      return list.length ? list : ['PRECIO DE LISTA'];
    }

    var inpPct = byId('cp-of-calc-pct');
    var inpPrice = byId('cp-of-calc-price');
    var semaforoBar = byId('cp-of-semaforo-bar');
    var alertBox = byId('cp-of-cost-lock-alert');
    var chkZeroComm = byId('cp-of-zero-comm-chk');
    var selModality = byId('cp-of-modality-select');

    /* ── Recálculo en Cadena de la Tabla Dinámica Multiescalón de Volumen ── */
    function recalcVolumeTiersChain(changedIdx, sourceField) {
      var sb = getSelectedScopeAndBranches();
      var scs = getSelectedScales();
      var refObj = getReferenceNormalScaleObj(sb.scope, sb.branches, scs);
      var mNorm = refObj.margenNormal;
      var pNorm = refObj.precioNormal;

      for (var i = 0; i < _volTiersState.length; i++) {
        var t = _volTiersState[i];
        if (i === 0) {
          t.min_qty = Math.max(2, parseInt(t.min_qty, 10) || 10);
        } else {
          var prevMax = parseInt(_volTiersState[i - 1].max_qty, 10) || 0;
          t.min_qty = prevMax > 0 ? (prevMax + 1) : (_volTiersState[i - 1].min_qty + 10);
        }
        if (i < _volTiersState.length - 1) {
          var curMax = parseInt(t.max_qty, 10) || 0;
          if (curMax > 0 && curMax < t.min_qty) {
            t.max_qty = t.min_qty + 10;
          }
        } else {
          t.max_qty = parseInt(t.max_qty, 10) || 0;
        }

        var prevTotalPct = i === 0 ? 0 : num(_volTiersState[i - 1].total_pct);

        if (i === changedIdx && sourceField === 'total_pct') {
          t.total_pct = Math.max(0, num(t.total_pct));
          t.add_pct = Number((t.total_pct - prevTotalPct).toFixed(2));
        } else if (i === changedIdx && sourceField === 'unit_price') {
          var pTarget = Math.max(0, num(t.unit_price));
          if (costoRef > 0 && pTarget > 0) {
            var pSinIva = factorIva > 0 ? (pTarget / factorIva) : pTarget;
            var mTarget = ((pSinIva / costoRef) - 1) * 100;
            t.total_pct = Number((mNorm - mTarget).toFixed(2));
          } else if (pNorm > 0 && pTarget > 0) {
            t.total_pct = Number(((1 - (pTarget / pNorm)) * 100).toFixed(2));
          }
          t.add_pct = Number((t.total_pct - prevTotalPct).toFixed(2));
        } else {
          // Por defecto: acumula el % adicional sobre el total del escalón anterior
          t.add_pct = Number(num(t.add_pct).toFixed(2));
          t.total_pct = Number((prevTotalPct + t.add_pct).toFixed(2));
        }

        if (!(i === changedIdx && sourceField === 'unit_price')) {
          if (costoRef > 0) {
            var mConDesc = mNorm - t.total_pct;
            t.unit_price = Number((costoRef * (1 + mConDesc / 100) * factorIva).toFixed(2));
          } else if (pNorm > 0) {
            t.unit_price = Number((pNorm * (1 - t.total_pct / 100)).toFixed(2));
          } else {
            t.unit_price = 0;
          }
        }
      }

      var normalMaxLbl = byId('cp-of-vol-normal-max-lbl');
      if (normalMaxLbl && _volTiersState.length > 0) {
        normalMaxLbl.textContent = String(Math.max(1, (_volTiersState[0].min_qty || 10) - 1));
      }
    }

    function renderVolumeTiersTable() {
      var tbodyV = byId('cp-of-vol-tiers-tbody');
      if (!tbodyV) return;
      recalcVolumeTiersChain(-1, '');

      var sb = getSelectedScopeAndBranches();
      var scs = getSelectedScales();
      var refObj = getReferenceNormalScaleObj(sb.scope, sb.branches, scs);
      var mNorm = refObj.margenNormal;
      var comBase = refObj.comisionBase;

      var inpBoxStyle = 'height:28px;padding:0 7px;border-radius:6px;border:1px solid var(--cp-input-border,#334155);background:var(--cp-panel,#0f172a);color:var(--cp-text,#f8fafc);font-size:12px;font-weight:800;text-align:right;outline:none;';

      tbodyV.innerHTML = _volTiersState.map(function (t, idx) {
        var pSinIva = factorIva > 0 ? (num(t.unit_price) / factorIva) : num(t.unit_price);
        var utilPesos = pSinIva - costoRef;
        var utilPct = costoRef > 0 ? ((utilPesos / costoRef) * 100) : (mNorm - num(t.total_pct));
        var isBelowCost = (costoRef > 0 && num(t.unit_price) < costoPisoConIva - 0.005);

        var semColor = '#10b981';
        var semDot = '🟢';
        if (isBelowCost) {
          semColor = '#ef4444';
          semDot = '🔴 BAJO COSTO PISO';
        } else if (utilPct < 5) {
          semColor = '#f59e0b';
          semDot = '🟡 Margen <5%';
        }

        var effCommPct = t.zero_commission
          ? 0
          : (mNorm > 0 ? Math.max(0, comBase * (utilPct / mNorm)) : comBase);
        var commMxn = Math.max(0, pSinIva * (effCommPct / 100));

        var isLastRow = (idx === _volTiersState.length - 1);
        return '<tr data-tier-idx="' + idx + '" style="border-bottom:1px solid var(--cp-line);">' +
          '<td style="padding:6px 6px;font-weight:900;color:#38bdf8;white-space:nowrap;">Escalón ' + (idx + 1) + '</td>' +
          '<td style="padding:6px 6px;text-align:center;white-space:nowrap;">' +
            (idx === 0
              ? '<input type="number" min="2" step="1" class="cp-vol-inp-min" value="' + t.min_qty + '" style="' + inpBoxStyle + 'width:62px;text-align:center;">'
              : '<span style="display:inline-block;padding:4px 8px;border-radius:6px;background:rgba(56,189,248,0.12);border:1px solid rgba(56,189,248,0.35);font-weight:900;color:#38bdf8;" title="Calculado automáticamente como Hasta_Anterior + 1">' + t.min_qty + ' pzas</span>') +
          '</td>' +
          '<td style="padding:6px 6px;text-align:center;white-space:nowrap;">' +
            '<div style="display:inline-flex;align-items:center;gap:4px;">' +
              '<input type="number" min="0" step="1" class="cp-vol-inp-max" value="' + t.max_qty + '" style="' + inpBoxStyle + 'width:66px;text-align:center;" title="Escribe 0 para Sin límite">' +
              (num(t.max_qty) === 0 ? '<span style="font-size:10px;font-weight:800;color:#10b981;">∞ Sin límite</span>' : '') +
            '</div>' +
          '</td>' +
          '<td style="padding:6px 6px;text-align:right;white-space:nowrap;">' +
            '<div style="display:inline-flex;align-items:center;gap:3px;">' +
              '<span style="font-size:11px;font-weight:800;color:#fbbf24;">' + (idx === 0 ? 'Base:' : '+ Adic.:') + '</span>' +
              '<input type="number" step="0.01" class="cp-vol-inp-add" value="' + fmt2(t.add_pct) + '" style="' + inpBoxStyle + 'width:66px;color:#fbbf24;border-color:rgba(251,191,36,0.5);">' +
              '<span style="color:#fbbf24;font-weight:800;">%</span>' +
            '</div>' +
          '</td>' +
          '<td style="padding:6px 6px;text-align:right;white-space:nowrap;">' +
            '<div style="display:inline-flex;align-items:center;gap:3px;">' +
              '<span style="font-size:11px;font-weight:900;color:#f59e0b;">=</span>' +
              '<input type="number" step="0.01" class="cp-vol-inp-tot" value="' + fmt2(t.total_pct) + '" style="' + inpBoxStyle + 'width:66px;color:#f59e0b;border-color:#f59e0b;">' +
              '<span style="color:#f59e0b;font-weight:900;">%</span>' +
            '</div>' +
          '</td>' +
          '<td style="padding:6px 6px;text-align:right;white-space:nowrap;">' +
            '<div style="display:inline-flex;align-items:center;gap:3px;">' +
              '<span style="color:#38bdf8;font-weight:900;">$</span>' +
              '<input type="number" step="0.01" class="cp-vol-inp-price" value="' + fmt2(t.unit_price) + '" style="' + inpBoxStyle + 'width:84px;color:var(--cp-text);border-color:#38bdf8;">' +
            '</div>' +
          '</td>' +
          '<td style="padding:6px 6px;text-align:center;white-space:nowrap;">' +
            '<label style="display:inline-flex;align-items:center;gap:4px;font-size:10.5px;font-weight:700;cursor:pointer;" title="Comisión sobre Subtotal Neto sin IVA ($' + fmt2(commMxn) + ')">' +
              '<input type="checkbox" class="cp-vol-chk-zerocom"' + (t.zero_commission ? ' checked' : '') + '> ' +
              (t.zero_commission ? '<span style="color:#f59e0b;">0% Com.</span>' : ('<span style="color:#38bdf8;">' + fmt2(effCommPct) + '% ($' + fmt2(commMxn) + ')</span>')) +
            '</label>' +
          '</td>' +
          '<td style="padding:6px 8px;text-align:left;white-space:nowrap;">' +
            '<div style="display:flex;align-items:center;justify-content:space-between;gap:8px;">' +
              '<div style="display:inline-flex;align-items:center;gap:6px;">' +
                '<span style="font-weight:900;color:' + semColor + ';font-size:11.5px;">' + semDot + ' ' + (utilPesos >= 0 ? '+' : '') + '$' + fmt2(utilPesos) + ' (' + fmt2(utilPct) + '%)</span>' +
                '<span style="font-size:10px;padding:1px 6px;border-radius:4px;background:rgba(245,158,11,0.14);color:#f59e0b;font-weight:800;">🚫 0 Pts</span>' +
              '</div>' +
              (isLastRow && _volTiersState.length > 1
                ? '<button type="button" class="cp-vol-del-btn" data-idx="' + idx + '" title="Eliminar último escalón (Escalón ' + (idx + 1) + ')" style="margin-left:auto;width:28px;height:26px;border-radius:6px;border:1px solid #ef4444;background:rgba(239,68,68,0.14);color:#ef4444;cursor:pointer;display:inline-flex;align-items:center;justify-content:center;font-size:12px;font-weight:900;flex-shrink:0;transition:all .15s;"><i class="fa-solid fa-trash-can"></i></button>'
                : '') +
            '</div>' +
          '</td>' +
        '</tr>';
      }).join('');

      tbodyV.querySelectorAll('tr[data-tier-idx]').forEach(function (tr) {
        var idx = parseInt(tr.getAttribute('data-tier-idx'), 10);
        var t = _volTiersState[idx];
        if (!t) return;
        var inpMin = tr.querySelector('.cp-vol-inp-min');
        var inpMax = tr.querySelector('.cp-vol-inp-max');
        var inpAdd = tr.querySelector('.cp-vol-inp-add');
        var inpTot = tr.querySelector('.cp-vol-inp-tot');
        var inpPr  = tr.querySelector('.cp-vol-inp-price');
        var chkZC  = tr.querySelector('.cp-vol-chk-zerocom');
        var delBtn = tr.querySelector('.cp-vol-del-btn');

        if (inpMin) {
          inpMin.addEventListener('change', function () {
            t.min_qty = Math.max(2, parseInt(inpMin.value, 10) || 10);
            renderVolumeTiersTable();
          });
        }
        if (inpMax) {
          inpMax.addEventListener('change', function () {
            t.max_qty = Math.max(0, parseInt(inpMax.value, 10) || 0);
            renderVolumeTiersTable();
          });
        }
        if (inpAdd) {
          inpAdd.addEventListener('change', function () {
            t.add_pct = num(inpAdd.value);
            recalcVolumeTiersChain(idx, 'add_pct');
            renderVolumeTiersTable();
            if (idx === 0 && inpPct) {
              inpPct.value = fmt2(t.total_pct);
              updateSemaforoAndCalculator('pct');
            }
          });
        }
        if (inpTot) {
          inpTot.addEventListener('change', function () {
            t.total_pct = num(inpTot.value);
            recalcVolumeTiersChain(idx, 'total_pct');
            renderVolumeTiersTable();
            if (idx === 0 && inpPct) {
              inpPct.value = fmt2(t.total_pct);
              updateSemaforoAndCalculator('pct');
            }
          });
        }
        if (inpPr) {
          inpPr.addEventListener('change', function () {
            t.unit_price = num(inpPr.value);
            recalcVolumeTiersChain(idx, 'unit_price');
            renderVolumeTiersTable();
            if (idx === 0 && inpPct) {
              inpPct.value = fmt2(t.total_pct);
              updateSemaforoAndCalculator('pct');
            }
          });
        }
        if (chkZC) {
          chkZC.addEventListener('change', function () {
            t.zero_commission = !!chkZC.checked;
            renderVolumeTiersTable();
          });
        }
        if (delBtn) {
          delBtn.addEventListener('click', function () {
            if (_volTiersState.length <= 1) return;
            _volTiersState.splice(idx, 1);
            renderVolumeTiersTable();
          });
        }
      });
    }

    var addTierBtn = byId('cp-of-add-tier-btn');
    if (addTierBtn) {
      addTierBtn.addEventListener('click', function () {
        var lastT = _volTiersState[_volTiersState.length - 1];
        if (lastT && (!lastT.max_qty || lastT.max_qty <= 0)) {
          lastT.max_qty = lastT.min_qty + 49;
        }
        var nextMin = lastT ? (lastT.max_qty + 1) : 10;
        var prevTot = lastT ? num(lastT.total_pct) : 0;
        _volTiersState.push({
          min_qty: nextMin,
          max_qty: 0,
          add_pct: 2.00,
          total_pct: prevTot + 2.00,
          unit_price: 0,
          zero_commission: true
        });
        renderVolumeTiersTable();
      });
    }

    var _selectedLinkedProductB = null;

    function extractLinkedProductFinancials(prod) {
      if (!prod || !prod.sku) return null;
      var m = (prod.meta_data && typeof prod.meta_data === 'object') ? prod.meta_data : {};
      var skuB = String(prod.sku).trim().toUpperCase();
      var nameB = String(prod.name || prod.description || skuB).trim().toUpperCase();
      var exentoB = !!m.kardex_exento_iva;
      var ivaB = exentoB ? 0 : (m.iva != null && m.iva !== '' ? num(m.iva) : 16);
      var iepsB = (m.ieps != null && m.ieps !== '') ? num(m.ieps) : 0;
      var factorIvaB = (1 + (ivaB / 100)) * (1 + (iepsB / 100));
      var costoConFleteB = num(m.costo_pieza_con_flete || m.costo_con_flete || prod.average_cost || m.costo_raw || 0);
      var costoPisoB = num(m.costo_piso_con_iva) > 0
        ? Number(num(m.costo_piso_con_iva).toFixed(2))
        : Number((costoConFleteB * factorIvaB).toFixed(2));
      var precioListaB = num(prod.price);
      if (precioListaB <= 0 && Array.isArray(prod.price_scales) && prod.price_scales[0]) {
        precioListaB = num(prod.price_scales[0].precio || prod.price_scales[0].price);
      }
      if (precioListaB <= 0 && Array.isArray(m.price_scales) && m.price_scales[0]) {
        precioListaB = num(m.price_scales[0].precio || m.price_scales[0].price);
      }
      var margenNormalB = num(m.margen || 30);
      var comisionBaseB = (Array.isArray(m.price_scales) && m.price_scales[0]) ? num(m.price_scales[0].comision) : 0;
      return {
        id: prod.id || null,
        sku: skuB,
        nombre: nameB,
        costo_con_flete: Number(costoConFleteB.toFixed(4)),
        iva: ivaB,
        ieps: iepsB,
        factor_iva: factorIvaB,
        costo_piso_iva: costoPisoB,
        precio_lista: Number(precioListaB.toFixed(2)),
        margen_normal: margenNormalB,
        comision_base: comisionBaseB
      };
    }

    function getActiveCruzadaSubmode() {
      var modVal = selModality ? selModality.value : 'ESCALA';
      if (modVal !== 'CRUZADA') return 'NONE';
      var nxmEl = byId('cp-of-nxm-type');
      var v = nxmEl ? String(nxmEl.value || '3x2').toUpperCase() : '3X2';
      if (v === 'CRUZADA_SKU') return 'SUB_B_CRUZADA';
      if (v === 'COMBO_SKU') return 'SUB_C_COMBO';
      return 'SUB_A_NXM'; // 3X2, 4X3, 2DO_50, 2X1
    }

    function syncCruzadaSubmodeUI(triggerCalc) {
      var subMode = getActiveCruzadaSubmode();
      var sameProdBadge = byId('cp-of-same-prod-badge');
      var linkedWrap = byId('cp-of-linked-sku-wrap');
      var crossQtyRow = byId('cp-of-cross-qty-row');
      var pickedInfo = byId('cp-of-linked-sku-picked-info');
      var btnFreeB = byId('cp-of-btn-free-b');
      var qtyALbl = byId('cp-of-qty-a-lbl');
      var qtyBLbl = byId('cp-of-qty-b-lbl');
      var lblPct = byId('cp-of-lbl-calc-pct');
      var lblPrice = byId('cp-of-lbl-calc-price');

      if (subMode === 'SUB_A_NXM') {
        var nxmVal = byId('cp-of-nxm-type') ? String(byId('cp-of-nxm-type').value).toUpperCase() : '3X2';
        var lotDesc = 'Lote de 3 pzas (Paga 2)';
        if (nxmVal === '4X3') lotDesc = 'Lote de 4 pzas (Paga 3)';
        else if (nxmVal === '2DO_50') lotDesc = 'Par de 2 pzas (2do a mitad de precio)';
        else if (nxmVal === '2X1') lotDesc = 'Par de 2 pzas (Paga 1)';

        if (sameProdBadge) {
          sameProdBadge.style.display = 'block';
          sameProdBadge.innerHTML = '<i class="fa-solid fa-boxes-stacked"></i> Aplica comprando múltiplos de este mismo producto (<b>' + lotDesc + '</b>)';
        }
        if (linkedWrap) linkedWrap.style.display = 'none';
        if (crossQtyRow) crossQtyRow.style.display = 'none';
        if (pickedInfo) pickedInfo.style.display = 'none';
        if (lblPct) lblPct.textContent = '⚙️ % Desc. Efectivo en Lote (' + nxmVal + ')';
        if (lblPrice) lblPrice.textContent = '$ Precio Unit. Efectivo en Lote (IVA incl.)';
      } else if (subMode === 'SUB_B_CRUZADA') {
        if (sameProdBadge) sameProdBadge.style.display = 'none';
        if (linkedWrap) linkedWrap.style.display = 'block';
        if (crossQtyRow) crossQtyRow.style.display = 'flex';
        if (btnFreeB) btnFreeB.style.display = 'inline-flex';
        if (qtyALbl) qtyALbl.textContent = 'Al comprar';
        if (qtyBLbl) qtyBLbl.textContent = 'Aplicar oferta a';
        if (pickedInfo) pickedInfo.style.display = _selectedLinkedProductB ? 'flex' : 'none';
        if (lblPct) lblPct.textContent = '⚙️ % Descuento en Producto B (Vinculado)';
        if (lblPrice) lblPrice.textContent = '$ Precio Final Oferta Prod. B (IVA incl.)';
      } else if (subMode === 'SUB_C_COMBO') {
        if (sameProdBadge) sameProdBadge.style.display = 'none';
        if (linkedWrap) linkedWrap.style.display = 'block';
        if (crossQtyRow) crossQtyRow.style.display = 'flex';
        if (btnFreeB) btnFreeB.style.display = 'none';
        if (qtyALbl) qtyALbl.textContent = 'Paquete Combo:';
        if (qtyBLbl) qtyBLbl.textContent = '+';
        if (pickedInfo) pickedInfo.style.display = _selectedLinkedProductB ? 'flex' : 'none';
        if (lblPct) lblPct.textContent = '⚙️ % Descuento del Combo (A + B)';
        if (lblPrice) lblPrice.textContent = '$ Precio Final Paquete Completo (A + B)';
      } else {
        if (lblPct) lblPct.textContent = '⚙️ % Descuento de Oferta';
        if (lblPrice) lblPrice.textContent = '$ Precio Final de Oferta (IVA incl.)';
      }

      if (triggerCalc) {
        updateSemaforoAndCalculator('pct');
      }
    }

    function updateSemaforoAndCalculator(source) {
      var sb = getSelectedScopeAndBranches();
      var scs = getSelectedScales();
      var refObj = getReferenceNormalScaleObj(sb.scope, sb.branches, scs);
      var mNorm = refObj.margenNormal;
      var pNorm = refObj.precioNormal;
      var comBase = refObj.comisionBase;

      var subMode = getActiveCruzadaSubmode();
      var pct = num(inpPct.value);
      var pFin = num(inpPrice.value);
      var isZeroComm = !!(chkZeroComm && chkZeroComm.checked);

      // ── SUB-MODO A: Promoción Múltiple del MISMO Producto (3x2, 4x3, 2do al 50%, 2x1) ──
      if (subMode === 'SUB_A_NXM') {
        var nxmVal = byId('cp-of-nxm-type') ? String(byId('cp-of-nxm-type').value).toUpperCase() : '3X2';
        var lotQty = 3;
        var paidUnits = 2;
        if (nxmVal === '4X3') { lotQty = 4; paidUnits = 3; }
        else if (nxmVal === '2DO_50') { lotQty = 2; paidUnits = 1.5; }
        else if (nxmVal === '2X1') { lotQty = 2; paidUnits = 1; }

        if (source === 'nxm_preset') {
          var presetLotIncome = pNorm * paidUnits;
          pFin = Number((presetLotIncome / lotQty).toFixed(2));
          if (costoRef > 0 && pFin > 0) {
            var pSinIvaPreset = factorIva > 0 ? (pFin / factorIva) : pFin;
            var mTargetPreset = ((pSinIvaPreset / costoRef) - 1) * 100;
            pct = Number((mNorm - mTargetPreset).toFixed(2));
          } else {
            pct = Number(((1 - (paidUnits / lotQty)) * 100).toFixed(2));
          }
          if (document.activeElement !== inpPct) inpPct.value = fmt2(pct);
          if (document.activeElement !== inpPrice) inpPrice.value = fmt2(pFin);
        } else if (source === 'pct') {
          if (pNorm > 0 && (Math.abs(pct - 33.33) < 0.05 && nxmVal === '3X2')) {
            pFin = Number(((pNorm * 2) / 3).toFixed(2));
          } else if (costoRef > 0) {
            var mConOf = mNorm - pct;
            pFin = Number((costoRef * (1 + mConOf / 100) * factorIva).toFixed(2));
          } else if (pNorm > 0) {
            pFin = Number((pNorm * (1 - pct / 100)).toFixed(2));
          }
          if (document.activeElement !== inpPrice) inpPrice.value = fmt2(pFin);
        } else if (source === 'price') {
          if (costoRef > 0 && pFin >= 0) {
            var pSinIvaA = factorIva > 0 ? (pFin / factorIva) : pFin;
            var mNuevoA = ((pSinIvaA / costoRef) - 1) * 100;
            pct = Number((mNorm - mNuevoA).toFixed(2));
          } else if (pNorm > 0 && pFin >= 0) {
            pct = Number(((1 - (pFin / pNorm)) * 100).toFixed(2));
          }
          if (document.activeElement !== inpPct) inpPct.value = fmt2(pct);
        }

        var ingresoLote = Number((pFin * lotQty).toFixed(2));
        var costoPisoLote = Number((costoPisoConIva * lotQty).toFixed(2));
        var pSinIvaUnit = factorIva > 0 ? (pFin / factorIva) : pFin;
        var utilidadUnitPesos = pSinIvaUnit - costoRef;
        var utilidadLotePesos = utilidadUnitPesos * lotQty;
        var utilidadPctA = costoRef > 0 ? ((utilidadUnitPesos / costoRef) * 100) : (mNorm - pct);
        var effCommPctA = isZeroComm ? 0 : (mNorm > 0 ? Math.max(0, comBase * (utilidadPctA / mNorm)) : comBase);
        var commLotePesos = Math.max(0, (pSinIvaUnit * lotQty) * (effCommPctA / 100));

        var belowCostA = (costoRef > 0 && (pFin < costoPisoConIva - 0.005 || ingresoLote < costoPisoLote - 0.01));
        var semColorA = belowCostA ? '#ef4444' : (utilidadPctA < 5 ? '#f59e0b' : '#10b981');
        var semBgA = belowCostA ? 'rgba(239,68,68,0.15)' : (utilidadPctA < 5 ? 'rgba(245,158,11,0.14)' : 'rgba(16,185,129,0.12)');
        var semDotA = belowCostA ? '🔴' : (utilidadPctA < 5 ? '🟡' : '🟢');

        if (semaforoBar) {
          semaforoBar.style.borderColor = semColorA;
          semaforoBar.style.background = semBgA;
          semaforoBar.innerHTML =
            '<div style="font-size:11.5px;font-weight:700;color:var(--cp-text);">' +
              '<b>Lote ' + nxmVal + ' (' + lotQty + ' pzas entregadas):</b> ' +
              'Costo Piso Lote: <b style="color:#f87171;">$' + fmt2(costoPisoLote) + '</b> <span style="opacity:.45;">|</span> ' +
              'Ingreso Lote: <b style="color:#38bdf8;">$' + fmt2(ingresoLote) + '</b> <span style="opacity:.45;">|</span> ' +
              'Unit. Efectivo: <b>$' + fmt2(pFin) + '</b> (Piso Unit.: $' + fmt2(costoPisoConIva) + ')' +
            '</div>' +
            '<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">' +
              '<span style="font-size:12px;font-weight:900;color:' + semColorA + ';">' +
                semDotA + ' Utilidad Lote (' + lotQty + ' pzas): ' + (utilidadLotePesos >= 0 ? '+' : '') + '$' + fmt2(utilidadLotePesos) + ' (' + fmt2(utilidadPctA) + '%)' +
              '</span>' +
              '<span style="font-size:11px;padding:2px 7px;border-radius:5px;background:rgba(56,189,248,0.14);color:#38bdf8;font-weight:800;">💼 Com. Lote: ' + fmt2(effCommPctA) + '% ($' + fmt2(commLotePesos) + ')</span>' +
              '<span style="font-size:11px;padding:2px 7px;border-radius:5px;background:rgba(245,158,11,0.16);color:#f59e0b;font-weight:800;">🚫 0 Pts</span>' +
            '</div>';
        }
        if (alertBox) {
          alertBox.style.display = belowCostA ? 'flex' : 'none';
          if (belowCostA) {
            alertBox.innerHTML = '<i class="fa-solid fa-hand"></i> <span>🛑 BLOQUEO DE SEGURIDAD (' + nxmVal + '): El Ingreso del Lote ($' + fmt2(ingresoLote) + ' / Unit. $' + fmt2(pFin) + ') no cubre el Costo Piso de las ' + lotQty + ' piezas entregadas ($' + fmt2(costoPisoLote) + ' / Unit. $' + fmt2(costoPisoConIva) + ').</span>';
          }
        }
        return;
      }

      // ── SUB-MODO B: Oferta Cruzada (Compra Producto A ➔ Descuento sobre Producto B [SKU Vinculado]) ──
      if (subMode === 'SUB_B_CRUZADA') {
        var qtyA = Math.max(1, parseInt(byId('cp-of-qty-a') && byId('cp-of-qty-a').value, 10) || 1);
        var qtyB = Math.max(1, parseInt(byId('cp-of-qty-b') && byId('cp-of-qty-b').value, 10) || 1);
        var prodB = _selectedLinkedProductB;
        var pNormB = prodB ? num(prodB.precio_lista) : 0;
        var costoPisoB = prodB ? num(prodB.costo_piso_iva) : 0;
        var costoRefB = prodB ? num(prodB.costo_con_flete) : 0;
        var factorIvaB = prodB && prodB.factor_iva ? num(prodB.factor_iva) : factorIva;

        if (!prodB) {
          if (semaforoBar) {
            semaforoBar.style.borderColor = '#38bdf8';
            semaforoBar.style.background = 'rgba(56,189,248,0.10)';
            semaforoBar.innerHTML = '<div style="font-size:12px;font-weight:800;color:#38bdf8;"><i class="fa-solid fa-magnifying-glass"></i> Selecciona primero el <b>SKU Vinculado (Producto B)</b> en el buscador del Paso 1 para calcular su descuento y validar el Costo Piso Combinado (A + B).</div>';
          }
          if (alertBox) alertBox.style.display = 'none';
          return;
        }

        if (source === 'pct') {
          pct = Math.max(0, Math.min(100, pct));
          pFin = Number((pNormB * (1 - pct / 100)).toFixed(2));
          if (document.activeElement !== inpPrice) inpPrice.value = fmt2(pFin);
        } else if (source === 'price') {
          pFin = Math.max(0, pFin);
          pct = pNormB > 0 ? Number(((1 - (pFin / pNormB)) * 100).toFixed(2)) : 0;
          if (document.activeElement !== inpPct) inpPct.value = fmt2(pct);
        }

        var ingresoA = Number((pNorm * qtyA).toFixed(2));
        var ingresoB = Number((pFin * qtyB).toFixed(2));
        var ingresoTotalComb = Number((ingresoA + ingresoB).toFixed(2));
        var costoPisoTotalA = Number((costoPisoConIva * qtyA).toFixed(2));
        var costoPisoTotalB = Number((costoPisoB * qtyB).toFixed(2));
        var costoPisoComb = Number((costoPisoTotalA + costoPisoTotalB).toFixed(2));

        var subNetoComb = ((factorIva > 0 ? (pNorm / factorIva) : pNorm) * qtyA) + ((factorIvaB > 0 ? (pFin / factorIvaB) : pFin) * qtyB);
        var costoNetoComb = (costoRef * qtyA) + (costoRefB * qtyB);
        var utilidadCombPesos = subNetoComb - costoNetoComb;
        var utilidadCombPct = costoNetoComb > 0 ? ((utilidadCombPesos / costoNetoComb) * 100) : 0;

        var warnBelowCostB = (costoPisoB > 0 && pFin < costoPisoB - 0.005);
        var hardBlockComb = (costoPisoComb > 0 && ingresoTotalComb < costoPisoComb - 0.005);

        var semColorB = hardBlockComb ? '#ef4444' : (warnBelowCostB || utilidadCombPct < 5 ? '#f59e0b' : '#10b981');
        var semBgB = hardBlockComb ? 'rgba(239,68,68,0.15)' : (warnBelowCostB || utilidadCombPct < 5 ? 'rgba(245,158,11,0.14)' : 'rgba(16,185,129,0.12)');
        var semDotB = hardBlockComb ? '🔴' : (warnBelowCostB || utilidadCombPct < 5 ? '🟡' : '🟢');

        var effCommPctB = isZeroComm ? 0 : (mNorm > 0 ? Math.max(0, comBase * (utilidadCombPct / mNorm)) : comBase);
        var commCombPesos = Math.max(0, subNetoComb * (effCommPctB / 100));

        if (semaforoBar) {
          semaforoBar.style.borderColor = semColorB;
          semaforoBar.style.background = semBgB;
          semaforoBar.innerHTML =
            '<div style="font-size:11.4px;font-weight:700;color:var(--cp-text);">' +
              '<b>Prod. A (' + qtyA + ' pza):</b> $' + fmt2(ingresoA) + ' (Piso $' + fmt2(costoPisoTotalA) + ') <span style="opacity:.45;">+</span> ' +
              '<b>Prod. B [' + esc(prodB.sku) + '] (' + qtyB + ' pza):</b> Normal $' + fmt2(pNormB * qtyB) + ' ➔ <b style="color:#38bdf8;">Oferta B: $' + fmt2(ingresoB) + '</b> (Piso B: $' + fmt2(costoPisoTotalB) + ') ' +
              '<span style="opacity:.45;">|</span> <b>Total Cobrado (A+B): <span style="color:#34d399;">$' + fmt2(ingresoTotalComb) + '</span> vs Costo Piso Combinado: <span style="color:#f87171;">$' + fmt2(costoPisoComb) + '</span></b>' +
            '</div>' +
            '<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">' +
              '<span style="font-size:12px;font-weight:900;color:' + semColorB + ';">' +
                semDotB + ' Utilidad Combinada (A+B): ' + (utilidadCombPesos >= 0 ? '+' : '') + '$' + fmt2(utilidadCombPesos) + ' (' + fmt2(utilidadCombPct) + '%)' +
              '</span>' +
              (warnBelowCostB && !hardBlockComb ? '<span style="font-size:10.5px;padding:2px 7px;border-radius:5px;background:rgba(245,158,11,0.18);border:1px solid #f59e0b;color:#fbbf24;font-weight:800;">⚠️ Oferta de B ($' + fmt2(pFin) + ') menor a Costo Piso B ($' + fmt2(costoPisoB) + '), subsidiado por A</span>' : '') +
              '<span style="font-size:11px;padding:2px 7px;border-radius:5px;background:rgba(56,189,248,0.14);color:#38bdf8;font-weight:800;">💼 Com. Vend.: ' + fmt2(effCommPctB) + '% ($' + fmt2(commCombPesos) + ')</span>' +
              '<span style="font-size:11px;padding:2px 7px;border-radius:5px;background:rgba(245,158,11,0.16);color:#f59e0b;font-weight:800;">🚫 0 Pts</span>' +
            '</div>';
        }
        if (alertBox) {
          alertBox.style.display = hardBlockComb ? 'flex' : 'none';
          if (hardBlockComb) {
            alertBox.innerHTML = '<i class="fa-solid fa-hand"></i> <span>🛑 BLOQUEO DE SEGURIDAD CRUZADO: El Ingreso Total Combinado A+B ($' + fmt2(ingresoTotalComb) + ') es menor al Costo Piso Combinado A+B ($' + fmt2(costoPisoComb) + ').</span>';
          }
        }
        return;
      }

      // ── SUB-MODO C: Combo / Kit Promocional (Paquete A + SKU Vinculado B por Precio de Paquete) ──
      if (subMode === 'SUB_C_COMBO') {
        var qtyACombo = Math.max(1, parseInt(byId('cp-of-qty-a') && byId('cp-of-qty-a').value, 10) || 1);
        var qtyBCombo = Math.max(1, parseInt(byId('cp-of-qty-b') && byId('cp-of-qty-b').value, 10) || 1);
        var prodBCombo = _selectedLinkedProductB;
        var pNormBCombo = prodBCombo ? num(prodBCombo.precio_lista) : 0;
        var costoPisoBCombo = prodBCombo ? num(prodBCombo.costo_piso_iva) : 0;
        var costoRefBCombo = prodBCombo ? num(prodBCombo.costo_con_flete) : 0;
        var factorIvaBCombo = prodBCombo && prodBCombo.factor_iva ? num(prodBCombo.factor_iva) : factorIva;

        if (!prodBCombo) {
          if (semaforoBar) {
            semaforoBar.style.borderColor = '#38bdf8';
            semaforoBar.style.background = 'rgba(56,189,248,0.10)';
            semaforoBar.innerHTML = '<div style="font-size:12px;font-weight:800;color:#38bdf8;"><i class="fa-solid fa-magnifying-glass"></i> Selecciona primero el <b>SKU Vinculado (Producto B)</b> en el buscador del Paso 1 para armar el paquete Combo (A + B).</div>';
          }
          if (alertBox) alertBox.style.display = 'none';
          return;
        }

        var precioNormalCombo = Number(((pNorm * qtyACombo) + (pNormBCombo * qtyBCombo)).toFixed(2));
        var costoPisoCombo = Number(((costoPisoConIva * qtyACombo) + (costoPisoBCombo * qtyBCombo)).toFixed(2));
        var costoSinIvaCombo = (costoRef * qtyACombo) + (costoRefBCombo * qtyBCombo);

        if (source === 'pct') {
          pct = Math.max(0, Math.min(100, pct));
          pFin = Number((precioNormalCombo * (1 - pct / 100)).toFixed(2));
          if (document.activeElement !== inpPrice) inpPrice.value = fmt2(pFin);
        } else if (source === 'price') {
          pFin = Math.max(0, pFin);
          pct = precioNormalCombo > 0 ? Number(((1 - (pFin / precioNormalCombo)) * 100).toFixed(2)) : 0;
          if (document.activeElement !== inpPct) inpPct.value = fmt2(pct);
        }

        var ratioCombo = precioNormalCombo > 0 ? (pFin / precioNormalCombo) : 1;
        var subNetoCombo = (((factorIva > 0 ? (pNorm / factorIva) : pNorm) * qtyACombo) + ((factorIvaBCombo > 0 ? (pNormBCombo / factorIvaBCombo) : pNormBCombo) * qtyBCombo)) * ratioCombo;
        var utilidadComboPesos = subNetoCombo - costoSinIvaCombo;
        var utilidadComboPct = costoSinIvaCombo > 0 ? ((utilidadComboPesos / costoSinIvaCombo) * 100) : 0;
        var belowCostCombo = (costoPisoCombo > 0 && pFin < costoPisoCombo - 0.005);

        var semColorC = belowCostCombo ? '#ef4444' : (utilidadComboPct < 5 ? '#f59e0b' : '#10b981');
        var semBgC = belowCostCombo ? 'rgba(239,68,68,0.15)' : (utilidadComboPct < 5 ? 'rgba(245,158,11,0.14)' : 'rgba(16,185,129,0.12)');
        var semDotC = belowCostCombo ? '🔴' : (utilidadComboPct < 5 ? '🟡' : '🟢');

        var effCommPctC = isZeroComm ? 0 : (mNorm > 0 ? Math.max(0, comBase * (utilidadComboPct / mNorm)) : comBase);
        var commComboPesos = Math.max(0, subNetoCombo * (effCommPctC / 100));

        if (semaforoBar) {
          semaforoBar.style.borderColor = semColorC;
          semaforoBar.style.background = semBgC;
          semaforoBar.innerHTML =
            '<div style="font-size:11.5px;font-weight:700;color:var(--cp-text);">' +
              '<b>Paquete Combo (' + qtyACombo + ' A + ' + qtyBCombo + ' ' + esc(prodBCombo.sku) + '):</b> ' +
              'Costo Piso Combo c/IVA: <b style="color:#f87171;">$' + fmt2(costoPisoCombo) + '</b> <span style="opacity:.45;">|</span> ' +
              'Precio Normal Combo: <b>$' + fmt2(precioNormalCombo) + '</b> ➔ ' +
              '<b style="color:#38bdf8;font-size:13px;">Precio Paquete: $' + fmt2(pFin) + '</b>' +
            '</div>' +
            '<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">' +
              '<span style="font-size:12px;font-weight:900;color:' + semColorC + ';">' +
                semDotC + ' Utilidad Neta Combo: ' + (utilidadComboPesos >= 0 ? '+' : '') + '$' + fmt2(utilidadComboPesos) + ' (' + fmt2(utilidadComboPct) + '%)' +
              '</span>' +
              '<span style="font-size:11px;padding:2px 7px;border-radius:5px;background:rgba(56,189,248,0.14);color:#38bdf8;font-weight:800;">💼 Com. Combo: ' + fmt2(effCommPctC) + '% ($' + fmt2(commComboPesos) + ')</span>' +
              '<span style="font-size:11px;padding:2px 7px;border-radius:5px;background:rgba(245,158,11,0.16);color:#f59e0b;font-weight:800;">🚫 0 Pts</span>' +
            '</div>';
        }
        if (alertBox) {
          alertBox.style.display = belowCostCombo ? 'flex' : 'none';
          if (belowCostCombo) {
            alertBox.innerHTML = '<i class="fa-solid fa-hand"></i> <span>🛑 BLOQUEO DE SEGURIDAD DEL COMBO: El Precio Final del Paquete ($' + fmt2(pFin) + ') es menor al Costo Piso Combo c/IVA ($' + fmt2(costoPisoCombo) + ').</span>';
          }
        }
        return;
      }

      // ── Modalidades Estándar (1. Escala, 2. Volumen, 3. Límite Stock, 5. Contado) ──
      if (source === 'pct') {
        if (costoRef > 0) {
          var mConOferta = mNorm - pct;
          pFin = Number((costoRef * (1 + mConOferta / 100) * factorIva).toFixed(2));
        } else if (pNorm > 0) {
          pFin = Number((pNorm * (1 - pct / 100)).toFixed(2));
        }
        if (document.activeElement !== inpPrice) inpPrice.value = fmt2(pFin);
      } else if (source === 'price') {
        if (costoRef > 0 && pFin >= 0) {
          var pSinIva = factorIva > 0 ? (pFin / factorIva) : pFin;
          var mNuevo = ((pSinIva / costoRef) - 1) * 100;
          pct = Number((mNorm - mNuevo).toFixed(2));
        } else if (pNorm > 0 && pFin >= 0) {
          pct = Number(((1 - (pFin / pNorm)) * 100).toFixed(2));
        }
        if (document.activeElement !== inpPct) inpPct.value = fmt2(pct);
      }

      var pSinIvaFinal = factorIva > 0 ? (pFin / factorIva) : pFin;
      var utilidadNetaPesos = pSinIvaFinal - costoRef;
      var utilidadNetaPct = costoRef > 0 ? ((utilidadNetaPesos / costoRef) * 100) : (mNorm - pct);

      var effCommPct = isZeroComm
        ? 0
        : (mNorm > 0 ? Math.max(0, comBase * (utilidadNetaPct / mNorm)) : comBase);
      var commPesos = Math.max(0, pSinIvaFinal * (effCommPct / 100));

      var semColor = '#10b981';
      var semBg = 'rgba(16,185,129,0.12)';
      var semDot = '🟢';
      var belowCost = (costoRef > 0 && pFin < costoPisoConIva - 0.005);

      if (belowCost) {
        semColor = '#ef4444';
        semBg = 'rgba(239,68,68,0.15)';
        semDot = '🔴';
      } else if (utilidadNetaPct < 5) {
        semColor = '#f59e0b';
        semBg = 'rgba(245,158,11,0.14)';
        semDot = '🟡';
      }

      if (semaforoBar) {
        semaforoBar.style.borderColor = semColor;
        semaforoBar.style.background = semBg;
        semaforoBar.innerHTML =
          '<div style="font-size:11.8px;font-weight:700;color:var(--cp-text);">' +
            'Costo c/Flete: <b style="color:#34d399;">$' + fmt2(costoRef) + '</b> <span style="opacity:.45;">|</span> ' +
            'Costo Piso c/IVA: <b style="color:#f87171;">$' + fmt2(costoPisoConIva) + '</b> <span style="opacity:.45;">|</span> ' +
            'Precio Normal: <b>$' + fmt2(pNorm) + '</b> ➔ ' +
            '<b style="color:#38bdf8;font-size:13px;">Oferta: $' + fmt2(pFin) + '</b>' +
          '</div>' +
          '<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">' +
            '<span style="font-size:12px;font-weight:900;color:' + semColor + ';">' +
              semDot + ' Utilidad Neta: ' + (utilidadNetaPesos >= 0 ? '+' : '') + '$' + fmt2(utilidadNetaPesos) + ' (' + fmt2(utilidadNetaPct) + '%)' +
            '</span>' +
            '<span style="font-size:11px;padding:2px 7px;border-radius:5px;background:rgba(56,189,248,0.14);color:#38bdf8;font-weight:800;" title="Calculada sobre Subtotal Neto sin IVA ($' + fmt2(pSinIvaFinal) + ')">💼 Com. Vend.: ' + fmt2(effCommPct) + '% ($' + fmt2(commPesos) + ')</span>' +
            '<span style="font-size:11px;padding:2px 7px;border-radius:5px;background:rgba(245,158,11,0.16);color:#f59e0b;font-weight:800;">🚫 0 Pts</span>' +
          '</div>';
      }

      if (alertBox) {
        alertBox.style.display = belowCost ? 'flex' : 'none';
        if (belowCost) {
          alertBox.innerHTML = '<i class="fa-solid fa-hand"></i> <span>🛑 BLOQUEO DE SEGURIDAD: No se permite aplicar un descuento menor al Precio de Costo con Flete + IVA ($' + fmt2(costoPisoConIva) + ').</span>';
        }
      }
    }

    function renderRegisteredOffersTable() {
      var tbodyOf = byId('cp-of-registered-tbody');
      var countEl = byId('cp-of-table-count');
      if (!tbodyOf) return;

      (global._paProductPriceScales || []).forEach(function (ps) {
        if (num(ps.oferta) > 0) {
          syncDirectTableOfferRecord('MATRIZ', ps.scale_name || ps.nombre, ps.oferta, ps.precio);
        }
      });
      (global._paProductBranchScales || []).forEach(function (bs) {
        if (num(bs.oferta) > 0) {
          syncDirectTableOfferRecord(bs.branch_name || bs.branch_id, bs.scale_name, bs.oferta, bs.precio);
        }
      });

      var list = global._paProductOffers || [];
      if (countEl) countEl.textContent = list.length + (list.length === 1 ? ' oferta registrada' : ' ofertas registradas');

      if (!list.length) {
        tbodyOf.innerHTML = '<tr><td colspan="7" style="padding:18px;text-align:center;color:var(--cp-muted);font-weight:600;">No hay ofertas activas ni programadas en este producto. Configura los pasos 1 y 2 y pulsa «Aplicar Oferta».</td></tr>';
        return;
      }

      tbodyOf.innerHTML = list.map(function (ofItem, idx) {
        var st = evaluateOfferRuntimeState(ofItem);
        var bScope = norm(ofItem.branch_scope || 'ALL');
        var badgeHtml = '';
        if (bScope === 'ALL') {
          badgeHtml = '<span style="padding:3px 8px;border-radius:6px;background:rgba(56,189,248,0.16);border:1px solid #38bdf8;color:#38bdf8;font-weight:800;font-size:11px;">🌐 TODAS</span>';
        } else if (bScope === 'MATRIZ') {
          badgeHtml = '<span style="padding:3px 8px;border-radius:6px;background:rgba(16,185,129,0.16);border:1px solid #10b981;color:#10b981;font-weight:800;font-size:11px;">🏢 MATRIZ</span>';
        } else {
          var brLabel = (Array.isArray(ofItem.branches) && ofItem.branches.length) ? ofItem.branches.join(', ') : bScope;
          badgeHtml = '<span style="padding:3px 8px;border-radius:6px;background:rgba(245,158,11,0.16);border:1px solid #f59e0b;color:#f59e0b;font-weight:800;font-size:11px;">🏪 ' + esc(brLabel) + '</span>';
        }

        var scalesTxt = (Array.isArray(ofItem.scales) && ofItem.scales.length) ? ofItem.scales.join(', ') : 'PRECIO DE LISTA';
        var condTxt = '⚡ Permanente';
        if (ofItem.modality === 'ESCALA') {
          if (ofItem.vigencia_type === 'FECHAS') {
            var s1 = (ofItem.start_at || '').replace('T', ' ');
            var s2 = (ofItem.end_at || '').replace('T', ' ');
            condTxt = '📅 Vigencia ' + esc(s1 || 'hoy') + ' a ' + esc(s2 || 'fin');
          } else {
            condTxt = '🏷️ Directa / ⚡ Permanente';
          }
        } else if (ofItem.modality === 'VOLUMEN') {
          if (Array.isArray(ofItem.volume_tiers) && ofItem.volume_tiers.length) {
            condTxt = '📦 ' + ofItem.volume_tiers.map(function (vt, vIdx) {
              var rStr = vt.min_qty + (num(vt.max_qty) > 0 ? ('-' + vt.max_qty) : '+');
              var pStr = vIdx === 0 ? (fmt2(vt.total_pct) + '%') : ('+' + fmt2(vt.add_pct) + '%=' + fmt2(vt.total_pct) + '%');
              return 'E' + (vIdx + 1) + '(' + rStr + ' pzas: ' + pStr + ' ➔ $' + fmt2(vt.unit_price) + ')';
            }).join(' | ');
          } else {
            condTxt = '📦 ' + num(ofItem.vol_min || 10) + '+ pzas';
          }
        } else if (ofItem.modality === 'LIMITE_STOCK') {
          condTxt = '🔥 Límite ' + num(ofItem.max_stock || 15) + ' pzas (Vendidas: ' + num(ofItem.sold_stock || 0) + '/' + num(ofItem.max_stock || 15) + ')';
        } else if (ofItem.modality === 'CRUZADA') {
          var nxmCode = String(ofItem.nxm_type || '3x2').toUpperCase();
          var qA = Math.max(1, num(ofItem.qty_a || 1));
          var qB = Math.max(1, num(ofItem.qty_b || 1));
          if (nxmCode === 'CRUZADA_SKU') {
            condTxt = '🔗 Cruzada: Compra ' + qA + ' A ➔ ' + qB + ' ' + esc(ofItem.linked_sku || 'B') + ' a $' + fmt2(ofItem.offer_price) + ' (-' + fmt2(ofItem.discount_pct) + '%)';
          } else if (nxmCode === 'COMBO_SKU') {
            condTxt = '🎁 Combo (' + qA + ' A + ' + qB + ' ' + esc(ofItem.linked_sku || 'B') + ') Paquete: $' + fmt2(ofItem.offer_price);
          } else {
            condTxt = '🤝 Múltiple Mismo Prod. ' + esc(nxmCode) + ' (Unit. Efectivo: $' + fmt2(ofItem.offer_price) + ')';
          }
        } else if (ofItem.modality === 'CONTADO') {
          condTxt = '💵 Exclusiva Pago Contado (Efectivo/Transf.)';
        }

        condTxt += ' <span style="font-size:10px;padding:1px 5px;border-radius:4px;background:rgba(245,158,11,0.15);color:#f59e0b;font-weight:800;margin-left:4px;">🚫 0 Pts</span>';

        return '<tr style="border-bottom:1px solid var(--cp-line);">' +
          '<td style="padding:8px 12px;text-align:left;">' + badgeHtml + '</td>' +
          '<td style="padding:8px 12px;text-align:left;font-weight:700;font-size:11.5px;">' + esc(scalesTxt) + '</td>' +
          '<td style="padding:8px 12px;text-align:left;font-weight:700;font-size:11.5px;">' + condTxt + '</td>' +
          '<td style="padding:8px 12px;text-align:right;font-weight:900;color:#f59e0b;">' + fmt2(ofItem.discount_pct) + '%</td>' +
          '<td style="padding:8px 12px;text-align:right;font-weight:900;color:#38bdf8;">$' + fmt2(ofItem.offer_price) + '</td>' +
          '<td style="padding:8px 12px;text-align:center;"><span style="padding:2px 8px;border-radius:999px;font-size:11px;font-weight:800;color:' + st.color + ';border:1px solid ' + st.color + ';">' + st.label + '</span></td>' +
          '<td style="padding:8px 12px;text-align:right;white-space:nowrap;">' +
            '<button type="button" class="cp-of-row-copy" data-idx="' + idx + '" title="Copiar oferta a todas las sucursales" style="padding:4px 8px;border-radius:6px;border:1px solid #38bdf8;background:rgba(56,189,248,0.12);color:#38bdf8;font-size:11px;font-weight:800;cursor:pointer;margin-right:4px;">📋 Copiar a sucursal</button>' +
            '<button type="button" class="cp-of-row-toggle" data-idx="' + idx + '" title="Pausar / Activar oferta" style="padding:4px 8px;border-radius:6px;border:1px solid #f59e0b;background:rgba(245,158,11,0.12);color:#f59e0b;font-size:11px;font-weight:800;cursor:pointer;margin-right:4px;">' + (ofItem.paused ? '▶️ Activar' : '⏸️ Pausar') + '</button>' +
            '<button type="button" class="cp-of-row-del" data-idx="' + idx + '" title="Eliminar oferta" style="padding:4px 8px;border-radius:6px;border:1px solid #ef4444;background:rgba(239,68,68,0.12);color:#ef4444;font-size:11px;font-weight:800;cursor:pointer;">🗑️ Eliminar</button>' +
          '</td>' +
        '</tr>';
      }).join('');

      tbodyOf.querySelectorAll('.cp-of-row-copy').forEach(function (btn) {
        btn.addEventListener('click', function () {
          var i = parseInt(btn.getAttribute('data-idx'), 10);
          var item = global._paProductOffers[i];
          if (!item) return;
          item.branch_scope = 'ALL';
          item.branches = ['ALL'];
          if (item.modality === 'ESCALA' || item.modality === 'LIMITE_STOCK') {
            applyOfferItemToScalesTables(item, !item.paused);
          }
          renderRegisteredOffersTable();
          cfgToast('Oferta replicada a TODAS las sucursales (Matriz + Sucursales).');
        });
      });

      tbodyOf.querySelectorAll('.cp-of-row-toggle').forEach(function (btn) {
        btn.addEventListener('click', function () {
          var i = parseInt(btn.getAttribute('data-idx'), 10);
          var item = global._paProductOffers[i];
          if (!item) return;
          item.paused = !item.paused;
          if (item.modality === 'ESCALA' || item.modality === 'LIMITE_STOCK') {
            applyOfferItemToScalesTables(item, !item.paused);
          }
          renderRegisteredOffersTable();
          cfgToast(item.paused ? 'Oferta pausada (precio normal restaurado).' : 'Oferta activada nuevamente.');
        });
      });

      tbodyOf.querySelectorAll('.cp-of-row-del').forEach(function (btn) {
        btn.addEventListener('click', function () {
          var i = parseInt(btn.getAttribute('data-idx'), 10);
          var item = global._paProductOffers[i];
          if (!item) return;
          if (item.modality === 'ESCALA' || item.modality === 'LIMITE_STOCK') {
            applyOfferItemToScalesTables(item, false);
          }
          global._paProductOffers.splice(i, 1);
          renderRegisteredOffersTable();
          cfgToast('Oferta eliminada y columna OFERTA (%) restaurada a 0.00%.');
        });
      });
    }

    // Eventos de cambio en Paso 1
    container.querySelectorAll('input[name="cp-of-scope"]').forEach(function (rad) {
      rad.addEventListener('change', function () {
        var brWrap = byId('cp-of-branches-list');
        if (brWrap) brWrap.style.display = (rad.value === 'BRANCHES' && rad.checked) ? 'flex' : 'none';
        updateSemaforoAndCalculator('pct');
        renderVolumeTiersTable();
      });
    });
    container.querySelectorAll('.cp-of-branch-chk, .cp-of-scale-chk').forEach(function (chk) {
      chk.addEventListener('change', function () {
        if (chk.dataset.creditLocked === '1') {
          chk.checked = false;
          return;
        }
        updateSemaforoAndCalculator('pct');
        renderVolumeTiersTable();
      });
    });

    // Impedir que se palomeen CREDITO / CREDITOS ESPECIALES a menos que se presione el botón "🔒 Candado Crédito"
    container.querySelectorAll('.cp-of-scale-lbl[data-is-credit="1"]').forEach(function (lbl) {
      lbl.addEventListener('click', function (ev) {
        var chk = lbl.querySelector('.cp-of-scale-chk');
        if (chk && chk.dataset.creditLocked === '1') {
          ev.preventDefault();
          ev.stopPropagation();
          chk.checked = false;
          cfgToast('Escala bloqueada: presiona el botón «🔒 Candado Crédito» para poder seleccionarla.', true);
        }
      });
    });

    container.querySelectorAll('.cp-of-credit-lock-btn').forEach(function (lockBtn) {
      lockBtn.addEventListener('click', function (ev) {
        ev.preventDefault();
        ev.stopPropagation();
        var row = lockBtn.closest('.cp-of-scale-row');
        if (!row) return;
        var chk = row.querySelector('.cp-of-scale-chk');
        var lbl = row.querySelector('.cp-of-scale-lbl');
        if (!chk) return;
        var isLocked = (chk.dataset.creditLocked === '1');
        if (isLocked) {
          chk.dataset.creditLocked = '0';
          chk.disabled = false;
          chk.checked = true;
          if (lbl) {
            lbl.style.cursor = 'pointer';
            lbl.style.opacity = '1';
          }
          lockBtn.innerHTML = '🔓 Candado Abierto';
          lockBtn.style.background = 'rgba(16,185,129,0.16)';
          lockBtn.style.color = '#10b981';
          lockBtn.style.borderColor = 'rgba(16,185,129,0.55)';
          updateSemaforoAndCalculator('pct');
          renderVolumeTiersTable();
        } else {
          chk.dataset.creditLocked = '1';
          chk.checked = false;
          chk.disabled = true;
          if (lbl) {
            lbl.style.cursor = 'not-allowed';
            lbl.style.opacity = '0.65';
          }
          lockBtn.innerHTML = '🔒 Candado Crédito';
          lockBtn.style.background = 'rgba(245,158,11,0.16)';
          lockBtn.style.color = '#f59e0b';
          lockBtn.style.borderColor = 'rgba(245,158,11,0.55)';
          updateSemaforoAndCalculator('pct');
          renderVolumeTiersTable();
        }
      });
    });

    if (selModality) {
      selModality.addEventListener('change', function () {
        var modVal = selModality.value;
        container.querySelectorAll('.cp-of-mod-subpanel').forEach(function (p) {
          p.style.display = 'none';
        });
        var targetPanel = byId('cp-of-mod-panel-' + modVal);
        if (targetPanel) {
          targetPanel.style.display = 'flex';
        }
        var volBox = byId('cp-of-volumen-multitier-box');
        if (volBox) {
          volBox.style.display = (modVal === 'VOLUMEN') ? 'block' : 'none';
        }
        if (modVal === 'VOLUMEN') {
          renderVolumeTiersTable();
          if (_volTiersState[0] && inpPct) {
            inpPct.value = fmt2(_volTiersState[0].total_pct);
            updateSemaforoAndCalculator('pct');
          }
        } else if (modVal === 'CRUZADA') {
          syncCruzadaSubmodeUI(false);
          var nxmSel = byId('cp-of-nxm-type');
          if (nxmSel) {
            var subM = getActiveCruzadaSubmode();
            if (subM === 'SUB_A_NXM') {
              updateSemaforoAndCalculator('nxm_preset');
            } else {
              updateSemaforoAndCalculator('pct');
            }
          }
        } else {
          syncCruzadaSubmodeUI(true);
        }
      });
    }

    var nxmSelectEl = byId('cp-of-nxm-type');
    if (nxmSelectEl) {
      nxmSelectEl.addEventListener('change', function () {
        syncCruzadaSubmodeUI(false);
        var subM = getActiveCruzadaSubmode();
        if (subM === 'SUB_A_NXM') {
          updateSemaforoAndCalculator('nxm_preset');
        } else {
          if (_selectedLinkedProductB) {
            if (subM === 'SUB_B_CRUZADA') {
              inpPct.value = '10.00';
            } else if (subM === 'SUB_C_COMBO') {
              inpPct.value = '10.00';
            }
          }
          updateSemaforoAndCalculator('pct');
          var lInp = byId('cp-of-linked-sku');
          if (lInp && !_selectedLinkedProductB) {
            setTimeout(function () { lInp.focus(); }, 30);
          }
        }
      });
    }

    var qtyAInp = byId('cp-of-qty-a');
    var qtyBInp = byId('cp-of-qty-b');
    var btnFreeBEl = byId('cp-of-btn-free-b');
    if (qtyAInp) qtyAInp.addEventListener('input', function () { updateSemaforoAndCalculator('pct'); });
    if (qtyBInp) qtyBInp.addEventListener('input', function () { updateSemaforoAndCalculator('pct'); });
    if (btnFreeBEl) {
      btnFreeBEl.addEventListener('click', function () {
        if (!_selectedLinkedProductB) {
          cfgToast('Selecciona primero el Producto B en el buscador de SKU Vinculado.', true);
          return;
        }
        inpPct.value = '100.00';
        updateSemaforoAndCalculator('pct');
      });
    }

    /* ── Buscador Inteligente de Productos en SKU Vinculado (#cp-of-linked-sku) con la misma lógica de Buscador de Productos ── */
    var linkedSkuInp = byId('cp-of-linked-sku');
    var linkedSkuBtn = byId('cp-of-linked-sku-btn');
    var linkedSkuClr = byId('cp-of-linked-sku-clear');
    var linkedSkuDd  = byId('cp-of-linked-sku-dropdown');
    var linkedSkuWrap = byId('cp-of-linked-sku-wrap');
    var linkedSkuInfo = byId('cp-of-linked-sku-picked-info');
    var _linkedSkuResults = [];
    var _linkedSkuActiveIdx = 0;
    var _linkedSkuTimer = null;
    var _linkedCatalogCache = null;

    function _cpStripAccUpper(s) {
      if (!s) return '';
      return String(s).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().trim();
    }

    function _cpNormToken(t) {
      var u = _cpStripAccUpper(t);
      u = u.replace(/^(\d+(?:\.\d+)?)(KGS?|KILOS?|KILOGRAMOS?)$/, '$1K');
      u = u.replace(/^(\d+(?:\.\d+)?)(LTS?|LITROS?)$/, '$1L');
      u = u.replace(/^(\d+(?:\.\d+)?)(MTS?|METROS?)$/, '$1M');
      u = u.replace(/^(\d+(?:\.\d+)?)(GRS?|GRAMOS?)$/, '$1G');
      return u;
    }

    function _cpStemToken(t) {
      var u = _cpNormToken(t);
      if (u === 'CEMETO' || u === 'SEMENTO' || u === 'CEMENTOS') return 'CEMENTO';
      if (u.length > 4 && u.slice(-2) === 'ES' && !/\d/.test(u)) return u.slice(0, -2);
      if (u.length > 3 && u.slice(-1) === 'S' && !/\d/.test(u)) return u.slice(0, -1);
      return u;
    }

    function _cpTokenizeQuery(q) {
      var raw = _cpStripAccUpper(q).replace(/[,;|]+/g, ' ');
      var parts = raw.split(/\s+/).filter(Boolean);
      var merged = [];
      var i = 0;
      while (i < parts.length) {
        var cur = parts[i];
        var nxt = (i + 1 < parts.length) ? parts[i + 1] : '';
        if (/^\d+(?:\.\d+)?$/.test(cur) && /^(K|KG|KGS|KILO|KILOS|G|GR|GRS|L|LT|LTS|M|MT|MTS|CM|MM|PZA|PZAS|PZ)$/.test(nxt)) {
          merged.push(_cpNormToken(cur + nxt));
          i += 2;
          continue;
        }
        merged.push(_cpNormToken(cur));
        i += 1;
      }
      return merged;
    }

    function _cpAlnumCompare(aStr, bStr) {
      var a = _cpStripAccUpper(aStr || '');
      var b = _cpStripAccUpper(bStr || '');
      if (a === b) return 0;
      var re = /(\d+|\D+)/g;
      var aParts = a.match(re) || [];
      var bParts = b.match(re) || [];
      var len = Math.min(aParts.length, bParts.length);
      for (var i = 0; i < len; i++) {
        var ap = aParts[i], bp = bParts[i];
        if (ap === bp) continue;
        var aNum = /^\d+$/.test(ap), bNum = /^\d+$/.test(bp);
        if (aNum && bNum) {
          var d = parseInt(ap, 10) - parseInt(bp, 10);
          if (d !== 0) return d;
          return ap.length - bp.length;
        }
        if (aNum !== bNum) return aNum ? -1 : 1;
        return ap < bp ? -1 : 1;
      }
      return aParts.length - bParts.length;
    }

    async function _cpEnsureProductsCatalogLoaded() {
      if (Array.isArray(_linkedCatalogCache) && _linkedCatalogCache.length) {
        return _linkedCatalogCache;
      }
      var combined = [];
      var seen = {};
      function addList(arr) {
        if (!Array.isArray(arr)) return;
        arr.forEach(function (p) {
          if (!p || !p.sku) return;
          var k = _cpStripAccUpper(p.sku);
          if (!seen[k]) {
            seen[k] = true;
            combined.push(p);
          }
        });
      }
      if (Array.isArray(global._paCachedProductsCatalog)) addList(global._paCachedProductsCatalog);
      if (global.CalebsysCatalogStore && typeof global.CalebsysCatalogStore.getProducts === 'function') {
        addList(global.CalebsysCatalogStore.getProducts());
      }
      if (!combined.length) {
        try {
          var tok = localStorage.getItem('session_token') || sessionStorage.getItem('session_token');
          var r = await fetch('/api/products?limit=500', {
            headers: tok ? { 'Authorization': 'Bearer ' + tok } : {},
            credentials: 'include'
          });
          if (r.ok) {
            var data = await r.json();
            addList(Array.isArray(data) ? data : (data && data.items ? data.items : []));
          }
        } catch (e) {}
      }
      if (combined.length) _linkedCatalogCache = combined;
      return combined;
    }

    function _cpFilterAndSortProducts(qRaw, sourceItems) {
      var list = Array.isArray(sourceItems) ? sourceItems : (_linkedCatalogCache || []);
      var curProductSku = _cpStripAccUpper(byId('pa-sku') ? byId('pa-sku').value : '');
      var qClean = _cpStripAccUpper(qRaw);
      if (qClean.indexOf(' — ') !== -1) {
        qClean = _cpStripAccUpper(qClean.split(' — ')[0]);
      }
      if (!qClean) {
        var allSorted = list.filter(function (p) {
          return p && p.sku && _cpStripAccUpper(p.sku) !== curProductSku;
        }).slice();
        allSorted.sort(function (a, b) {
          var cName = _cpAlnumCompare(a.name || a.description || a.sku, b.name || b.description || b.sku);
          if (cName !== 0) return cName;
          return _cpAlnumCompare(a.sku, b.sku);
        });
        return allSorted;
      }

      var qNoZeros = qClean.replace(/^0+/, '');
      var tokens = _cpTokenizeQuery(qClean);
      if (!tokens.length) return [];

      var scored = [];
      list.forEach(function (p) {
        if (!p || !p.sku) return;
        var sku = _cpStripAccUpper(p.sku);
        if (curProductSku && sku === curProductSku) return;
        var m = (p.meta_data && typeof p.meta_data === 'object') ? p.meta_data : {};
        var bc = _cpStripAccUpper(p.barcode || m.codigo_barras || '');
        var bcNoZ = bc.replace(/^0+/, '');
        var sc = _cpStripAccUpper(p.sales_code || m.codigo_alterno || '');
        var nm = _cpStripAccUpper(p.name || p.description || '');
        var mar = _cpStripAccUpper(p.marca || m.marca || m.brand || '');
        var fam = _cpStripAccUpper(p.familia || m.familia || '');
        var dep = _cpStripAccUpper(p.departamento || m.departamento || '');
        var obs = _cpStripAccUpper(m.observaciones || m.referencia || m.referencias || '');
        var baseBlob = [sku, bc, bcNoZ, sc, nm, mar, fam, dep, obs].filter(Boolean).join(' ');
        var blob = baseBlob.replace(/(\d+(?:\.\d+)?)\s*(K|KG|KGS|KILO|KILOS|L|LT|LTS|M|MT|MTS)\b/g, function (_m, numVal, u) {
          return _m + ' ' + _cpNormToken(numVal + u) + ' ' + numVal + 'K ' + numVal + 'KG ' + numVal + ' K ' + numVal + ' KG';
        });
        var words = blob.split(/[\s\-_/.,;:()[\]]+/).filter(Boolean);

        if (sku === qClean || (bc && (bc === qClean || (qNoZeros && bcNoZ === qNoZeros))) || (sc && sc === qClean)) {
          scored.push({ p: p, tier: 0 });
          return;
        }

        for (var ti = 0; ti < tokens.length; ti++) {
          var tok = tokens[ti];
          var tokStem = _cpStemToken(tok);
          var ok = false;
          if (blob.indexOf(tok) !== -1 || (tokStem && blob.indexOf(tokStem) !== -1)) {
            ok = true;
          } else {
            for (var wi = 0; wi < words.length; wi++) {
              var w = words[wi];
              var ws = _cpStemToken(w);
              if (w.indexOf(tok) === 0 || (tokStem && ws.indexOf(tokStem) === 0)) {
                ok = true;
                break;
              }
            }
          }
          if (!ok) return;
        }

        var tier = 4;
        if (sku.indexOf(qClean) === 0 || (bc && bc.indexOf(qClean) === 0)) tier = 1;
        else if (nm.indexOf(qClean) === 0) tier = 2;
        else if (mar === qClean || mar.indexOf(qClean) === 0) tier = 3;
        scored.push({ p: p, tier: tier });
      });

      scored.sort(function (a, b) {
        if (a.tier !== b.tier) return a.tier - b.tier;
        var cName = _cpAlnumCompare(a.p.name || a.p.description || a.p.sku, b.p.name || b.p.description || b.p.sku);
        if (cName !== 0) return cName;
        return _cpAlnumCompare(a.p.sku, b.p.sku);
      });
      return scored.map(function (x) { return x.p; });
    }

    function renderLinkedSkuDropdown(items, qRaw) {
      if (!linkedSkuDd) return;
      _linkedSkuResults = Array.isArray(items) ? items : [];
      if (_linkedSkuActiveIdx >= _linkedSkuResults.length) _linkedSkuActiveIdx = 0;

      if (_linkedSkuResults.length === 0) {
        linkedSkuDd.style.display = 'block';
        linkedSkuDd.innerHTML =
          '<div style="padding:12px 14px;font-size:12px;color:#94a3b8;display:flex;align-items:center;gap:8px;">' +
            '<i class="fa-solid fa-circle-info" style="color:#38bdf8;"></i>' +
            '<span>Sin coincidencias para <b style="color:#f8fafc;">"' + esc(qRaw || '') + '"</b></span>' +
          '</div>';
        return;
      }

      var html =
        '<div style="padding:6px 12px;background:rgba(2,132,199,0.18);border-bottom:1px solid rgba(56,189,248,0.25);display:flex;align-items:center;justify-content:space-between;font-size:10.5px;font-weight:800;color:#38bdf8;text-transform:uppercase;letter-spacing:.3px;position:sticky;top:0;z-index:2;backdrop-filter:blur(6px);">' +
          '<span><i class="fa-solid fa-arrow-down-a-z"></i> ' + _linkedSkuResults.length + (_linkedSkuResults.length === 1 ? ' producto encontrado' : ' productos en orden alfanumérico') + '</span>' +
          '<span>↑↓ Navegar · ENTER Vincular</span>' +
        '</div>';

      _linkedSkuResults.slice(0, 25).forEach(function (p, idx) {
        var m = (p.meta_data && typeof p.meta_data === 'object') ? p.meta_data : {};
        var sku = String(p.sku || '').toUpperCase();
        var bc = String(p.barcode || m.codigo_barras || '').toUpperCase();
        var name = String(p.name || p.description || sku).toUpperCase();
        var marca = String(p.marca || m.marca || m.brand || 'GENÉRICO').toUpperCase();
        var price = parseFloat(p.price || 0) || 0;
        var stock = parseFloat(p.stock || 0) || 0;
        var isAct = idx === _linkedSkuActiveIdx;
        var bg = isAct ? 'background:rgba(2,132,199,0.26);border-left:3px solid #38bdf8;' : 'background:#0b1324;border-left:3px solid transparent;';
        var bcTag = (bc && bc !== sku) ? (' <span style="font-size:10px;color:#94a3b8;font-family:monospace;"><i class="fa-solid fa-barcode"></i> ' + esc(bc) + '</span>') : '';
        var marcaTag = (marca && marca !== 'GENÉRICO' && marca !== 'GENERICO')
          ? (' <span style="font-size:10px;padding:1px 6px;border-radius:4px;background:rgba(56,189,248,0.14);color:#38bdf8;border:1px solid rgba(56,189,248,0.3);font-weight:800;">' + esc(marca) + '</span>')
          : '';

        html +=
          '<div class="cp-linked-sku-item" data-idx="' + idx + '" style="padding:8px 12px;border-bottom:1px solid #1e293b;cursor:pointer;display:flex;align-items:center;justify-content:space-between;gap:10px;' + bg + '">' +
            '<div style="min-width:0;flex:1;">' +
              '<div style="display:flex;align-items:center;gap:7px;flex-wrap:wrap;">' +
                '<span style="font-family:monospace;font-size:11px;font-weight:800;color:#fff;background:#0284c7;padding:1px 7px;border-radius:5px;">' + esc(sku) + '</span>' +
                bcTag +
                marcaTag +
              '</div>' +
              '<div style="font-size:12px;font-weight:700;color:#f8fafc;margin-top:3px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' + esc(name) + '</div>' +
            '</div>' +
            '<div style="text-align:right;flex-shrink:0;">' +
              '<div style="font-size:12px;font-weight:800;color:#34d399;font-family:monospace;">$' + fmt2(price) + '</div>' +
              '<div style="font-size:10px;color:#94a3b8;font-weight:600;">Stock: ' + stock + '</div>' +
            '</div>' +
          '</div>';
      });

      linkedSkuDd.innerHTML = html;
      linkedSkuDd.style.display = 'block';

      var actItemEl = linkedSkuDd.querySelector('.cp-linked-sku-item[data-idx="' + _linkedSkuActiveIdx + '"]');
      if (actItemEl && typeof actItemEl.scrollIntoView === 'function') {
        try { actItemEl.scrollIntoView({ block: 'nearest' }); } catch (e) {}
      }

      linkedSkuDd.querySelectorAll('.cp-linked-sku-item').forEach(function (el) {
        el.addEventListener('mousedown', function (ev) {
          ev.preventDefault();
          ev.stopPropagation();
          var idx = parseInt(el.getAttribute('data-idx') || '0', 10);
          var chosen = _linkedSkuResults[idx];
          if (chosen) pickProductForLinkedSku(chosen);
        });
      });
    }

    function pickProductForLinkedSku(prod) {
      if (!prod || !prod.sku || !linkedSkuInp) return;
      var finB = extractLinkedProductFinancials(prod);
      if (!finB) return;
      _selectedLinkedProductB = finB;
      linkedSkuInp.value = finB.sku;
      linkedSkuInp.dataset.cleanSku = finB.sku;
      linkedSkuInp.dataset.linkedName = finB.nombre;
      if (linkedSkuClr) linkedSkuClr.style.display = 'inline-flex';
      if (linkedSkuDd) linkedSkuDd.style.display = 'none';
      if (linkedSkuInfo) {
        linkedSkuInfo.style.display = 'flex';
        linkedSkuInfo.innerHTML =
          '<span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">🔗 <b>Producto B: [' + esc(finB.sku) + '] - ' + esc(finB.nombre) + '</b></span>' +
          '<span style="display:inline-flex;align-items:center;gap:8px;flex-shrink:0;">' +
            '<span style="color:#f87171;">Costo Piso B c/IVA: <b>$' + fmt2(finB.costo_piso_iva) + '</b></span>' +
            '<span style="opacity:.45;">|</span>' +
            '<span style="color:#34d399;">Precio Normal B: <b>$' + fmt2(finB.precio_lista) + '</b></span>' +
          '</span>';
      }
      if (nxmSelectEl && nxmSelectEl.value !== 'CRUZADA_SKU' && nxmSelectEl.value !== 'COMBO_SKU') {
        nxmSelectEl.value = 'CRUZADA_SKU';
      }
      syncCruzadaSubmodeUI(false);
      if (num(inpPct.value) <= 0 || num(inpPct.value) === 33.33) {
        inpPct.value = '10.00';
      }
      updateSemaforoAndCalculator('pct');
      if (inpPct) {
        inpPct.focus();
        if (typeof inpPct.select === 'function') inpPct.select();
      }
    }

    async function executeLinkedSkuProductSearch(qRaw, pickOnEnter) {
      var q = String(qRaw || '').trim();
      if (linkedSkuClr) linkedSkuClr.style.display = q ? 'inline-flex' : 'none';
      var baseCatalog = await _cpEnsureProductsCatalogLoaded();
      var localMatches = _cpFilterAndSortProducts(q, baseCatalog);
      renderLinkedSkuDropdown(localMatches, q);

      if (q) {
        try {
          var tok = localStorage.getItem('session_token') || sessionStorage.getItem('session_token');
          var r = await fetch('/api/products/search?limit=50&q=' + encodeURIComponent(q), {
            headers: tok ? { 'Authorization': 'Bearer ' + tok } : {},
            credentials: 'include'
          });
          if (r.ok) {
            var srvItems = await r.json();
            if (Array.isArray(srvItems) && srvItems.length) {
              var mergedMap = {};
              var mergedArr = [];
              localMatches.concat(srvItems).forEach(function (it) {
                if (!it || !it.sku) return;
                var k = _cpStripAccUpper(it.sku);
                if (!mergedMap[k]) {
                  mergedMap[k] = it;
                  mergedArr.push(it);
                }
              });
              _linkedCatalogCache = mergedArr.concat(_linkedCatalogCache || []);
              var sortedMerged = _cpFilterAndSortProducts(q, mergedArr);
              if (!sortedMerged.length) sortedMerged = mergedArr;
              renderLinkedSkuDropdown(sortedMerged, q);
            }
          }
        } catch (e) {}
      }

      if (pickOnEnter && _linkedSkuResults.length > 0) {
        pickProductForLinkedSku(_linkedSkuResults[_linkedSkuActiveIdx] || _linkedSkuResults[0]);
      }
    }

    if (linkedSkuInp) {
      linkedSkuInp.addEventListener('focus', function () {
        executeLinkedSkuProductSearch(linkedSkuInp.value, false);
      });
      linkedSkuInp.addEventListener('click', function () {
        if (linkedSkuDd && linkedSkuDd.style.display === 'none') {
          executeLinkedSkuProductSearch(linkedSkuInp.value, false);
        }
      });
      linkedSkuInp.addEventListener('input', function () {
        var q = linkedSkuInp.value;
        linkedSkuInp.dataset.cleanSku = '';
        _linkedSkuActiveIdx = 0;
        if (linkedSkuClr) linkedSkuClr.style.display = q ? 'inline-flex' : 'none';
        if (!q && linkedSkuInfo) linkedSkuInfo.style.display = 'none';
        var localMatches = _cpFilterAndSortProducts(q, _linkedCatalogCache || []);
        renderLinkedSkuDropdown(localMatches, q);
        clearTimeout(_linkedSkuTimer);
        _linkedSkuTimer = setTimeout(function () {
          executeLinkedSkuProductSearch(q, false);
        }, 160);
      });
      linkedSkuInp.addEventListener('keydown', function (ev) {
        if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') {
          if (!_linkedSkuResults.length) {
            executeLinkedSkuProductSearch(linkedSkuInp.value, false);
            return;
          }
          ev.preventDefault();
          ev.stopPropagation();
          var maxIdx = Math.min(24, _linkedSkuResults.length - 1);
          _linkedSkuActiveIdx = ev.key === 'ArrowDown'
            ? Math.min(maxIdx, _linkedSkuActiveIdx + 1)
            : Math.max(0, _linkedSkuActiveIdx - 1);
          renderLinkedSkuDropdown(_linkedSkuResults, linkedSkuInp.value);
        } else if (ev.key === 'Enter') {
          ev.preventDefault();
          ev.stopPropagation();
          if (_linkedSkuResults.length > 0 && linkedSkuDd && linkedSkuDd.style.display !== 'none') {
            pickProductForLinkedSku(_linkedSkuResults[_linkedSkuActiveIdx] || _linkedSkuResults[0]);
          } else {
            executeLinkedSkuProductSearch(linkedSkuInp.value, true);
          }
        } else if (ev.key === 'Escape') {
          if (linkedSkuDd && linkedSkuDd.style.display !== 'none') {
            ev.preventDefault();
            ev.stopPropagation();
            if (typeof ev.stopImmediatePropagation === 'function') ev.stopImmediatePropagation();
            linkedSkuDd.style.display = 'none';
          }
        }
      });
    }

    if (linkedSkuBtn) {
      linkedSkuBtn.addEventListener('click', function (ev) {
        ev.preventDefault();
        ev.stopPropagation();
        if (linkedSkuInp) linkedSkuInp.focus();
        executeLinkedSkuProductSearch(linkedSkuInp ? linkedSkuInp.value : '', false);
      });
    }

    if (linkedSkuClr) {
      linkedSkuClr.addEventListener('click', function (ev) {
        ev.preventDefault();
        ev.stopPropagation();
        _selectedLinkedProductB = null;
        if (linkedSkuInp) {
          linkedSkuInp.value = '';
          linkedSkuInp.dataset.cleanSku = '';
          linkedSkuInp.dataset.linkedName = '';
          linkedSkuInp.focus();
        }
        linkedSkuClr.style.display = 'none';
        if (linkedSkuInfo) linkedSkuInfo.style.display = 'none';
        updateSemaforoAndCalculator('pct');
        executeLinkedSkuProductSearch('', false);
      });
    }

    container.addEventListener('mousedown', function (ev) {
      if (linkedSkuDd && linkedSkuDd.style.display !== 'none' && linkedSkuWrap && !linkedSkuWrap.contains(ev.target)) {
        linkedSkuDd.style.display = 'none';
      }
    });

    var stockMaxInp = byId('cp-of-stock-max');
    if (stockMaxInp) {
      stockMaxInp.addEventListener('input', function () {
        var lbl = byId('cp-of-stock-max-lbl');
        if (lbl) lbl.textContent = String(Math.max(1, parseInt(stockMaxInp.value, 10) || 1));
      });
    }

    container.querySelectorAll('input[name="cp-of-vigencia"]').forEach(function (rad) {
      rad.addEventListener('change', function () {
        var datesWrap = byId('cp-of-dates-wrap');
        if (datesWrap) {
          datesWrap.style.display = (rad.value === 'FECHAS' && rad.checked) ? 'grid' : 'none';
        }
      });
    });

    var applyBtn = byId('cp-of-apply-btn');

    function armInputAutoClearAndEnter(inp, calcSource, getNextTarget, getPrevTarget) {
      if (!inp) return;
      function markFreshAndSelect() {
        inp.dataset.freshFocus = '1';
        setTimeout(function () {
          try {
            inp.select();
            if (typeof inp.setSelectionRange === 'function') {
              inp.setSelectionRange(0, (inp.value || '').length);
            }
          } catch (e) {}
        }, 0);
      }
      inp.addEventListener('focus', markFreshAndSelect);
      inp.addEventListener('click', function () {
        if (inp.dataset.freshFocus === '1') {
          try {
            inp.select();
            if (typeof inp.setSelectionRange === 'function') {
              inp.setSelectionRange(0, (inp.value || '').length);
            }
          } catch (e) {}
        }
      });
      inp.addEventListener('blur', function () {
        inp.dataset.freshFocus = '0';
        if ((inp.value || '').trim() !== '') {
          inp.value = fmt2(num(inp.value));
        } else {
          inp.value = '0.00';
        }
        updateSemaforoAndCalculator(calcSource);
      });
      inp.addEventListener('keydown', function (ev) {
        var k = ev.key;
        if (k === 'Enter') {
          ev.preventDefault();
          ev.stopPropagation();
          if (typeof ev.stopImmediatePropagation === 'function') ev.stopImmediatePropagation();
          inp.dataset.freshFocus = '0';
          inp.value = fmt2(num(inp.value));
          updateSemaforoAndCalculator(calcSource);
          var nxt = typeof getNextTarget === 'function' ? getNextTarget() : null;
          if (nxt) {
            nxt.focus();
            if (typeof nxt.select === 'function') {
              nxt.dataset.freshFocus = '1';
              setTimeout(function () {
                try { nxt.select(); } catch (e) {}
              }, 0);
            }
          }
          return;
        }
        if (k === 'ArrowLeft' && inp.dataset.freshFocus === '1') {
          var prv = typeof getPrevTarget === 'function' ? getPrevTarget() : null;
          if (prv) {
            ev.preventDefault();
            ev.stopPropagation();
            prv.focus();
            return;
          }
        }
        var isDigitOrDot = (/^[0-9.]$/.test(k)) && !ev.ctrlKey && !ev.altKey && !ev.metaKey;
        if (isDigitOrDot && inp.dataset.freshFocus === '1') {
          ev.preventDefault();
          inp.dataset.freshFocus = '0';
          inp.value = (k === '.') ? '0.' : k;
          updateSemaforoAndCalculator(calcSource);
          return;
        }
        if ((k === 'Backspace' || k === 'Delete') && inp.dataset.freshFocus === '1') {
          ev.preventDefault();
          inp.dataset.freshFocus = '0';
          inp.value = '';
          updateSemaforoAndCalculator(calcSource);
          return;
        }
        if (isDigitOrDot || k === 'Backspace' || k === 'Delete') {
          inp.dataset.freshFocus = '0';
        }
      });
      inp.addEventListener('input', function () {
        inp.dataset.freshFocus = '0';
        updateSemaforoAndCalculator(calcSource);
      });
    }

    armInputAutoClearAndEnter(
      inpPct,
      'pct',
      function () { return inpPrice; },
      null
    );
    armInputAutoClearAndEnter(
      inpPrice,
      'price',
      function () { return applyBtn; },
      function () { return inpPct; }
    );

    if (applyBtn) {
      applyBtn.addEventListener('focus', function () {
        applyBtn.style.outline = 'none';
        applyBtn.style.boxShadow = '0 0 0 3px rgba(56,189,248,0.85), 0 4px 16px rgba(245,158,11,0.55)';
        applyBtn.style.transform = 'scale(1.03)';
      });
      applyBtn.addEventListener('blur', function () {
        applyBtn.style.boxShadow = '0 4px 14px rgba(245,158,11,0.35)';
        applyBtn.style.transform = 'none';
      });
      applyBtn.addEventListener('keydown', function (ev) {
        if (ev.key === 'Enter' || ev.key === ' ') {
          ev.preventDefault();
          ev.stopPropagation();
          if (typeof ev.stopImmediatePropagation === 'function') ev.stopImmediatePropagation();
          applyBtn.click();
        } else if (ev.key === 'ArrowLeft') {
          ev.preventDefault();
          ev.stopPropagation();
          if (inpPrice) inpPrice.focus();
        }
      });
    }

    if (chkZeroComm) chkZeroComm.addEventListener('change', function () { updateSemaforoAndCalculator('pct'); });

    if (applyBtn) {
      applyBtn.addEventListener('click', function () {
        var sb = getSelectedScopeAndBranches();
        if (sb.scope === 'BRANCHES' && !sb.branches.length) {
          cfgToast('Selecciona al menos una sucursal específica en el Paso 1.', true);
          return;
        }
        var scs = getSelectedScales();
        var modVal = selModality ? selModality.value : 'ESCALA';
        var vigRad = container.querySelector('input[name="cp-of-vigencia"]:checked');
        var vigType = (modVal === 'ESCALA' && vigRad) ? vigRad.value : 'PERMANENTE';

        if (vigType === 'FECHAS' && chkNoOfertasCal) {
          cfgToast('Este producto tiene marcado «No aplica en ofertas calendarizadas». Desmárcalo en Atributos para programar fechas.', true);
          return;
        }

        if (modVal === 'VOLUMEN') {
          recalcVolumeTiersChain(-1, '');
          for (var ti = 0; ti < _volTiersState.length; ti++) {
            var tierIt = _volTiersState[ti];
            if (costoRef > 0 && num(tierIt.unit_price) < costoPisoConIva - 0.005) {
              cfgToast('🛑 BLOQUEO DE SEGURIDAD: El Escalón ' + (ti + 1) + ' ($' + fmt2(tierIt.unit_price) + ') es menor al Precio de Costo con Flete + IVA ($' + fmt2(costoPisoConIva) + ').', true);
              return;
            }
          }
          if (_volTiersState[0]) {
            inpPct.value = fmt2(_volTiersState[0].total_pct);
            inpPrice.value = fmt2(_volTiersState[0].unit_price);
          }
        }

        var pct = num(inpPct.value);
        var pFin = num(inpPrice.value);
        if (pct <= 0) {
          cfgToast('Ingresa un porcentaje de descuento mayor a 0.00%.', true);
          return;
        }

        var subModeApply = getActiveCruzadaSubmode();
        var refApplyObj = getReferenceNormalScaleObj(sb.scope, sb.branches, scs);
        var pNormApply = refApplyObj.precioNormal;
        var qtyAVal = Math.max(1, parseInt(byId('cp-of-qty-a') && byId('cp-of-qty-a').value, 10) || 1);
        var qtyBVal = Math.max(1, parseInt(byId('cp-of-qty-b') && byId('cp-of-qty-b').value, 10) || 1);
        var combinedCostoPisoSave = costoPisoConIva;
        var combinedRevenueSave = pFin;

        if (modVal === 'CRUZADA') {
          if (subModeApply === 'SUB_A_NXM') {
            var belowCostNxM = (costoRef > 0 && pFin < costoPisoConIva - 0.005);
            if (belowCostNxM) {
              cfgToast('🛑 BLOQUEO DE SEGURIDAD: El Precio Unitario Efectivo del lote ($' + fmt2(pFin) + ') es menor al Costo Piso c/IVA ($' + fmt2(costoPisoConIva) + ').', true);
              return;
            }
          } else if (subModeApply === 'SUB_B_CRUZADA' || subModeApply === 'SUB_C_COMBO') {
            if (!_selectedLinkedProductB || !_selectedLinkedProductB.sku) {
              cfgToast('Selecciona un Producto B válido en el Buscador de «SKU Vinculado» en el Paso 1.', true);
              if (linkedSkuInp) linkedSkuInp.focus();
              return;
            }
            var cPisoB = num(_selectedLinkedProductB.costo_piso_iva);
            var pNormBVal = num(_selectedLinkedProductB.precio_lista);
            combinedCostoPisoSave = Number(((costoPisoConIva * qtyAVal) + (cPisoB * qtyBVal)).toFixed(2));
            if (subModeApply === 'SUB_B_CRUZADA') {
              combinedRevenueSave = Number(((pNormApply * qtyAVal) + (pFin * qtyBVal)).toFixed(2));
              if (combinedCostoPisoSave > 0 && combinedRevenueSave < combinedCostoPisoSave - 0.005) {
                cfgToast('🛑 BLOQUEO DE SEGURIDAD CRUZADO: El Ingreso Total A+B ($' + fmt2(combinedRevenueSave) + ') es menor al Costo Piso Combinado A+B ($' + fmt2(combinedCostoPisoSave) + ').', true);
                return;
              }
            } else {
              // SUB_C_COMBO: pFin es el Precio Final del Paquete Completo (A + B)
              combinedRevenueSave = Number(pFin.toFixed(2));
              if (combinedCostoPisoSave > 0 && combinedRevenueSave < combinedCostoPisoSave - 0.005) {
                cfgToast('🛑 BLOQUEO DE SEGURIDAD DEL COMBO: El Precio Final del Paquete ($' + fmt2(combinedRevenueSave) + ') es menor al Costo Piso Combo c/IVA ($' + fmt2(combinedCostoPisoSave) + ').', true);
                return;
              }
            }
          }
        } else {
          var belowCost = (costoRef > 0 && pFin < costoPisoConIva - 0.005);
          if (belowCost) {
            cfgToast('🛑 BLOQUEO DE SEGURIDAD: No se permite aplicar un descuento menor al Precio de Costo con Flete + IVA ($' + fmt2(costoPisoConIva) + ').', true);
            return;
          }
        }

        var startAt = byId('cp-of-date-start') ? byId('cp-of-date-start').value : '';
        var endAt = byId('cp-of-date-end') ? byId('cp-of-date-end').value : '';
        if (vigType === 'FECHAS' && (!startAt || !endAt)) {
          cfgToast('Selecciona la Fecha/Hora de Inicio y Fin para la oferta programada.', true);
          return;
        }

        var branchScopeKey = sb.scope === 'BRANCHES' ? (sb.branches.length === 1 ? sb.branches[0] : 'BRANCHES') : sb.scope;
        var isLinkedSubmode = (modVal === 'CRUZADA' && (subModeApply === 'SUB_B_CRUZADA' || subModeApply === 'SUB_C_COMBO'));
        var newOffer = {
          id: 'of-' + Date.now() + '-' + Math.floor(Math.random() * 1000),
          branch_scope: branchScopeKey,
          branches: sb.scope === 'BRANCHES' ? sb.branches : [sb.scope],
          scales: scs,
          modality: modVal,
          vigencia_type: vigType,
          start_at: startAt,
          end_at: endAt,
          volume_tiers: modVal === 'VOLUMEN' ? JSON.parse(JSON.stringify(_volTiersState)) : [],
          vol_min: (modVal === 'VOLUMEN' && _volTiersState[0]) ? num(_volTiersState[0].min_qty) : 10,
          vol_max: (modVal === 'VOLUMEN' && _volTiersState[0]) ? num(_volTiersState[0].max_qty) : 40,
          vol_tier2_pct: (modVal === 'VOLUMEN' && _volTiersState[1]) ? num(_volTiersState[1].total_pct) : 0,
          max_stock: byId('cp-of-stock-max') ? Math.max(1, num(byId('cp-of-stock-max').value)) : 15,
          sold_stock: 0,
          nxm_type: byId('cp-of-nxm-type') ? byId('cp-of-nxm-type').value : '3x2',
          qty_a: isLinkedSubmode ? qtyAVal : 1,
          qty_b: isLinkedSubmode ? qtyBVal : 1,
          linked_sku: (isLinkedSubmode && _selectedLinkedProductB) ? _selectedLinkedProductB.sku : '',
          linked_sku_name: (isLinkedSubmode && _selectedLinkedProductB) ? _selectedLinkedProductB.nombre : '',
          linked_product_data: (isLinkedSubmode && _selectedLinkedProductB) ? JSON.parse(JSON.stringify(_selectedLinkedProductB)) : null,
          combined_costo_piso: combinedCostoPisoSave,
          combined_revenue: combinedRevenueSave,
          discount_pct: Number(pct.toFixed(2)),
          offer_price: Number(pFin.toFixed(2)),
          zero_commission: !!(chkZeroComm && chkZeroComm.checked),
          lock_points_zero: true,
          paused: false,
          created_at: new Date().toLocaleString('es-MX')
        };

        if (modVal === 'CRUZADA' && byId('pa-kardex-ofertas-cruzadas')) {
          byId('pa-kardex-ofertas-cruzadas').checked = true;
        }

        var st = evaluateOfferRuntimeState(newOffer);
        newOffer.status = st.code;

        if (!Array.isArray(global._paProductOffers)) global._paProductOffers = [];
        global._paProductOffers = global._paProductOffers.filter(function (o) {
          return !(o && norm(o.branch_scope) === norm(newOffer.branch_scope) && o.modality === newOffer.modality && JSON.stringify(o.scales) === JSON.stringify(newOffer.scales));
        });
        global._paProductOffers.unshift(newOffer);

        if (st.code === 'ACTIVA' && (modVal === 'ESCALA' || modVal === 'LIMITE_STOCK')) {
          applyOfferItemToScalesTables(newOffer, true);
        }

        renderRegisteredOffersTable();
        cfgToast('Oferta registrada (Puntos Bloqueados = 0 Pts y Costo Piso validado). Pulsa Guardar para sincronizar con el POS.');
      });
    }

    renderVolumeTiersTable();
    updateSemaforoAndCalculator('pct');
    renderRegisteredOffersTable();

    setTimeout(function () {
      if (inpPct && _modalPrecioViewMode === 'ofertas') {
        try {
          inpPct.focus();
          inpPct.dataset.freshFocus = '1';
          inpPct.select();
        } catch (e) {}
      }
    }, 20);
  }

  function bindModalCambioPrecioArrowNavigation(modal) {
    if (!modal || modal.dataset.boundArrowGridNav) return;
    modal.dataset.boundArrowGridNav = '1';

    function focusAndSelectInput(inp) {
      if (!inp) return;
      try { inp.focus({ preventScroll: false }); } catch (e) { inp.focus(); }
      if (typeof inp.select === 'function') {
        setTimeout(function () {
          try { inp.select(); } catch (e) {}
        }, 0);
      }
      var tr = inp.closest && inp.closest('tr');
      if (tr && tr.parentElement) {
        tr.parentElement.querySelectorAll('tr.cp-hl').forEach(function (r) {
          r.classList.remove('cp-hl');
        });
        tr.classList.add('cp-hl');
      }
    }

    modal.addEventListener('focusin', function (e) {
      var target = e.target;
      if (!target) return;
      var tr = target.closest && target.closest('table.cp-prices tbody tr');
      if (tr && tr.parentElement) {
        tr.parentElement.querySelectorAll('tr.cp-hl').forEach(function (r) {
          r.classList.remove('cp-hl');
        });
        tr.classList.add('cp-hl');
      }
    });

    if (global.__cpModalWindowKeydownHandler) {
      window.removeEventListener('keydown', global.__cpModalWindowKeydownHandler, true);
    }
    global.__cpModalWindowKeydownHandler = function (e) {
      if (modal.style.display !== 'flex') return;
      if (e.ctrlKey || e.altKey || e.metaKey) return;

      var key = e.key;
      var pop = byId('cp-branch-selector-popover');
      if (_modalBranchDropdownOpen && pop) {
        if (key === 'ArrowDown') {
          e.preventDefault();
          e.stopPropagation();
          if (typeof e.stopImmediatePropagation === 'function') e.stopImmediatePropagation();
          if (typeof pop._moveSelection === 'function') pop._moveSelection(1);
          return;
        }
        if (key === 'ArrowUp') {
          e.preventDefault();
          e.stopPropagation();
          if (typeof e.stopImmediatePropagation === 'function') e.stopImmediatePropagation();
          if (typeof pop._moveSelection === 'function') pop._moveSelection(-1);
          return;
        }
        if (key === 'Enter') {
          e.preventDefault();
          e.stopPropagation();
          if (typeof e.stopImmediatePropagation === 'function') e.stopImmediatePropagation();
          if (typeof pop._confirmCurrent === 'function') pop._confirmCurrent();
          return;
        }
        if (key === 'Escape') {
          e.preventDefault();
          e.stopPropagation();
          if (typeof e.stopImmediatePropagation === 'function') e.stopImmediatePropagation();
          closeModalBranchSelectorDropdown();
          return;
        }
        return;
      }

      if (_modalPrecioViewMode === 'ofertas') return;

      var isNavKey = (key === 'ArrowUp' || key === 'ArrowDown' || key === 'ArrowLeft' || key === 'ArrowRight' || key === 'Enter');
      if (!isNavKey) return;

      var target = e.target;
      var tbody = modal.querySelector('table.cp-prices tbody');
      if (!tbody) return;

      var rows = Array.prototype.slice.call(tbody.querySelectorAll('tr'));
      var grid = rows.map(function (r) {
        return Array.prototype.slice.call(r.querySelectorAll('input.cp-live-inp:not([disabled])'));
      }).filter(function (rInps) { return rInps.length > 0; });

      var topInputs = [byId('cp-quick-costo-inp'), byId('cp-quick-flete-inp')].filter(Boolean);

      if (!grid.length && !topInputs.length) return;

      var topIdx = topInputs.indexOf(target);
      if (topIdx !== -1) {
        e.preventDefault();
        e.stopPropagation();
        if (key === 'ArrowRight' || key === 'Enter') {
          if (topIdx + 1 < topInputs.length) {
            focusAndSelectInput(topInputs[topIdx + 1]);
          } else if (grid.length && grid[0][0]) {
            focusAndSelectInput(grid[0][0]);
          }
        } else if (key === 'ArrowLeft') {
          if (topIdx > 0) {
            focusAndSelectInput(topInputs[topIdx - 1]);
          } else if (grid.length) {
            var lastRow = grid[grid.length - 1];
            focusAndSelectInput(lastRow[lastRow.length - 1]);
          }
        } else if (key === 'ArrowDown') {
          if (grid.length) {
            var colTarget = Math.min(topIdx, grid[0].length - 1);
            focusAndSelectInput(grid[0][colTarget]);
          }
        } else if (key === 'ArrowUp') {
          if (grid.length) {
            var lastR = grid[grid.length - 1];
            var colT = Math.min(topIdx, lastR.length - 1);
            focusAndSelectInput(lastR[colT]);
          }
        }
        return;
      }

      var rIdx = -1;
      var cIdx = -1;
      for (var r = 0; r < grid.length; r++) {
        var c = grid[r].indexOf(target);
        if (c !== -1) {
          rIdx = r;
          cIdx = c;
          break;
        }
      }

      if (rIdx === -1) {
        if (key === 'ArrowDown' || key === 'ArrowUp' || key === 'ArrowRight' || key === 'ArrowLeft') {
          if (grid.length && grid[0][0]) {
            e.preventDefault();
            e.stopPropagation();
            focusAndSelectInput(grid[0][0]);
          }
        }
        return;
      }

      e.preventDefault();
      e.stopPropagation();

      if (key === 'ArrowDown') {
        var nextR = (rIdx + 1) % grid.length;
        var nextC = Math.min(cIdx, grid[nextR].length - 1);
        focusAndSelectInput(grid[nextR][nextC]);
      } else if (key === 'ArrowUp') {
        if (rIdx > 0) {
          var prevR = rIdx - 1;
          var prevC = Math.min(cIdx, grid[prevR].length - 1);
          focusAndSelectInput(grid[prevR][prevC]);
        } else if (topInputs.length) {
          focusAndSelectInput(topInputs[Math.min(cIdx, topInputs.length - 1)]);
        } else {
          var wrapR = grid.length - 1;
          focusAndSelectInput(grid[wrapR][Math.min(cIdx, grid[wrapR].length - 1)]);
        }
      } else if (key === 'ArrowRight' || key === 'Enter') {
        if (cIdx + 1 < grid[rIdx].length) {
          focusAndSelectInput(grid[rIdx][cIdx + 1]);
        } else {
          var nextRowIdx = (rIdx + 1) % grid.length;
          focusAndSelectInput(grid[nextRowIdx][0]);
        }
      } else if (key === 'ArrowLeft') {
        if (cIdx > 0) {
          focusAndSelectInput(grid[rIdx][cIdx - 1]);
        } else if (rIdx > 0) {
          var prevRow = grid[rIdx - 1];
          focusAndSelectInput(prevRow[prevRow.length - 1]);
        } else if (topInputs.length) {
          focusAndSelectInput(topInputs[topInputs.length - 1]);
        } else {
          var lastGridRow = grid[grid.length - 1];
          focusAndSelectInput(lastGridRow[lastGridRow.length - 1]);
        }
      }
    };
    window.addEventListener('keydown', global.__cpModalWindowKeydownHandler, true);
  }

  global.renderModalCambioPrecioScales = function (mode) {
    if (mode === 'escalas' || mode === 'sucursales' || mode === 'ofertas') {
      if (mode === 'ofertas' && _modalPrecioViewMode === 'sucursales' && _modalBranchFilter) {
        _lastBranchBeforeOfertas = _modalBranchFilter;
      }
      _modalPrecioViewMode = mode;
    }
    var modal = byId('modal-cambio-precio');
    if (!modal) return;
    if (modal.style.display === 'flex' && !_modalPrecioSnapshot) {
      takeModalCambioPrecioSnapshot();
    }
    var table = modal.querySelector('table.cp-prices');
    if (!table) return;

    bindModalCambioPrecioArrowNavigation(modal);
    ensureProductScalesInitialized();
    var ctx = getEffectiveProductCostContext();
    var costoRef = ctx.costoUnitConFlete;
    var factorIva = ctx.factorIva;

    if (_modalPrecioViewMode === 'sucursales') {
      var validOpts = getModalRegisteredBranchOptions().filter(function (o) { return norm(o.value) !== 'MATRIZ'; });
      if (!_modalBranchFilter || norm(_modalBranchFilter) === 'MATRIZ' || (!validOpts.some(function (o) { return norm(o.value) === norm(_modalBranchFilter); }))) {
        _modalBranchFilter = validOpts.length ? validOpts[0].value : '';
      }
      _lastBranchBeforeOfertas = _modalBranchFilter;
    } else {
      closeModalBranchSelectorDropdown();
      closeCopyScalesMenuPopover();
    }

    (global._paProductPriceScales || []).forEach(function (ps, idx) {
      ps.costo_con_flete = Number(costoRef.toFixed(4));
      var mIdeal = num(ps.margen_ideal);
      var mTrab = mIdeal - num(ps.oferta);
      ps.margen_trabajo = Number(mTrab.toFixed(4));
      var calcPrice = costoRef > 0 ? (costoRef * (1 + mTrab / 100) * factorIva) : (idx === 0 && ctx.formPrecioFinal > 0 ? ctx.formPrecioFinal : num(ps.precio));
      var idealRefPrice = costoRef > 0 ? (costoRef * (1 + mIdeal / 100) * factorIva) : calcPrice;
      updateScaleItemPriceAndTrend(ps, calcPrice, idealRefPrice, false);
      ps.margin = Number(mTrab.toFixed(4));
    });
    (global._paProductBranchScales || []).forEach(function (bs) {
      bs.costo_con_flete = Number(costoRef.toFixed(4));
      var mBase = num(bs.margen_ideal);
      var mAj = num(bs.sobreprecio_suc);
      var mOfer = num(bs.oferta);
      var mFin = mBase + mAj - mOfer;
      bs.oferta = Number(mOfer.toFixed(4));
      bs.margen_final = Number(mFin.toFixed(4));
      var calcPrice = costoRef > 0 ? (costoRef * (1 + mFin / 100) * factorIva) : num(bs.precio);
      var baseRefPrice = costoRef > 0 ? (costoRef * (1 + (mBase + mAj) / 100) * factorIva) : calcPrice;
      updateScaleItemPriceAndTrend(bs, calcPrice, baseRefPrice, true);
    });

    updateModalLiveSummaryStrip(ctx);

    var modalDialog = modal.querySelector('.cp-modal');
    if (modalDialog) {
      modalDialog.style.width = '1380px';
      modalDialog.style.maxWidth = '98vw';
      modalDialog.style.maxHeight = '96vh';
    }

    var topBtns = modal.querySelectorAll('.cp-top-btn');
    if (topBtns.length >= 2) {
      var activeStoreName = 'MATRIZ';
      var activeStoreIcon = 'fa-building-flag';
      if (_modalPrecioViewMode === 'sucursales' || (_modalPrecioViewMode === 'ofertas' && _lastBranchBeforeOfertas)) {
        activeStoreName = norm(_modalBranchFilter || _lastBranchBeforeOfertas || 'MATRIZ');
        activeStoreIcon = activeStoreName === 'MATRIZ' ? 'fa-building-flag' : 'fa-store';
      }
      topBtns[0].innerHTML = '<i class="fa-solid ' + activeStoreIcon + '"></i> <span>' + esc(activeStoreName) + '</span>';
      topBtns[0].style.cursor = 'pointer';
      topBtns[0].style.pointerEvents = 'auto';
      topBtns[0].style.userSelect = 'none';
      topBtns[0].style.fontWeight = '800';
      topBtns[0].style.borderColor = (_modalPrecioViewMode === 'escalas') ? '#38a8ff' : '';
      topBtns[0].style.background = (_modalPrecioViewMode === 'escalas') ? 'rgba(56,168,255,0.12)' : '';
      topBtns[0].style.boxShadow = (_modalPrecioViewMode === 'escalas') ? '0 0 0 2px rgba(56,168,255,.3)' : 'none';
      topBtns[0].title = 'Ver tabla de escalas de MATRIZ';
      if (!topBtns[0].dataset.boundMatrizSwitch) {
        topBtns[0].dataset.boundMatrizSwitch = '1';
        topBtns[0].addEventListener('click', function () {
          _lastBranchBeforeOfertas = '';
          global.renderModalCambioPrecioScales('escalas');
        });
      }

      topBtns[1].innerHTML = '🏪 Precio Sucursales <span class="cp-kbd">F2</span>';
      topBtns[1].style.borderColor = (_modalPrecioViewMode === 'sucursales') ? '#38a8ff' : '';
      topBtns[1].style.boxShadow   = (_modalPrecioViewMode === 'sucursales') ? '0 0 0 2px rgba(56,168,255,.3)' : '';
      if (!topBtns[1].dataset.boundScaleSwitch) {
        topBtns[1].dataset.boundScaleSwitch = '1';
        topBtns[1].addEventListener('click', function () {
          openModalBranchSelectorDropdown();
        });
      }

      if (topBtns[2]) {
        topBtns[2].innerHTML = '🏷️ Ofertas <span class="cp-kbd">F3</span>';
        topBtns[2].style.borderColor = (_modalPrecioViewMode === 'ofertas') ? '#f59e0b' : '';
        topBtns[2].style.boxShadow   = (_modalPrecioViewMode === 'ofertas') ? '0 0 0 2px rgba(245,158,11,.35)' : '';
        if (!topBtns[2].dataset.boundOfertasSwitch) {
          topBtns[2].dataset.boundOfertasSwitch = '1';
          topBtns[2].addEventListener('click', function () {
            if (_modalPrecioViewMode === 'ofertas') {
              global.renderModalCambioPrecioScales(_lastBranchBeforeOfertas ? 'sucursales' : 'escalas');
            } else {
              global.renderModalCambioPrecioScales('ofertas');
            }
          });
        }
      }
    }

    // En el pie del modal: mostrar el botón verde "📋 Copiar escalas y ofertas" en vista de sucursales
    var footerEl = modal.querySelector('.cp-footer');
    var existingFooterCopyBtn = byId('cp-footer-copy-matriz-btn');
    if (_modalPrecioViewMode === 'sucursales') {
      if (footerEl && !existingFooterCopyBtn) {
        existingFooterCopyBtn = document.createElement('button');
        existingFooterCopyBtn.type = 'button';
        existingFooterCopyBtn.id = 'cp-footer-copy-matriz-btn';
        existingFooterCopyBtn.style.cssText = 'margin-right:auto;height:38px;padding:0 16px;border-radius:9px;font-size:12.5px;font-weight:800;border:1.5px solid #10b981;background:linear-gradient(135deg,#059669,#10b981);color:#ffffff;cursor:pointer;display:inline-flex;align-items:center;gap:7px;box-shadow:0 4px 12px rgba(16,185,129,0.3);';
        existingFooterCopyBtn.innerHTML = '📋 Copiar escalas y ofertas <i class="fa-solid fa-caret-up" style="margin-left:3px;"></i>';
        existingFooterCopyBtn.addEventListener('click', function (ev) {
          ev.preventDefault();
          ev.stopPropagation();
          openCopyScalesAndOffersMenu(existingFooterCopyBtn);
        });
        footerEl.insertBefore(existingFooterCopyBtn, footerEl.firstChild);
      } else if (existingFooterCopyBtn) {
        existingFooterCopyBtn.innerHTML = '📋 Copiar escalas y ofertas <i class="fa-solid fa-caret-up" style="margin-left:3px;"></i>';
      }
    } else if (existingFooterCopyBtn) {
      existingFooterCopyBtn.remove();
    }

    var saveBtnModal = modal.querySelector('.cp-btn-save');
    if (saveBtnModal && !saveBtnModal.dataset.boundSavePos) {
      saveBtnModal.dataset.boundSavePos = '1';
      saveBtnModal.addEventListener('click', function () {
        global.saveModalCambioPrecioAndSyncPOS();
      });
    }

    modal.querySelectorAll('.cp-close, .cp-btn-cancel').forEach(function (closeBtn) {
      if (!closeBtn.dataset.boundCloseModal) {
        closeBtn.dataset.boundCloseModal = '1';
        closeBtn.addEventListener('click', function () {
          global.cancelAndCloseModalCambioPrecio();
        });
      }
    });

    var tableBoxEl = modal.querySelector('.cp-table-box');
    var bottomBoxEl = modal.querySelector('.cp-bottom');
    var ofertasContainer = byId('cp-ofertas-f3-container');

    if (_modalPrecioViewMode === 'ofertas') {
      if (tableBoxEl) tableBoxEl.style.display = 'none';
      if (bottomBoxEl) bottomBoxEl.style.display = 'none';
      renderOfertasF3PanelInModal(modal);
      return;
    } else {
      if (tableBoxEl) tableBoxEl.style.display = '';
      if (bottomBoxEl) bottomBoxEl.style.display = '';
      if (ofertasContainer) ofertasContainer.style.display = 'none';
    }

    var thead = table.querySelector('thead');
    var tbody = table.querySelector('tbody');
    if (!thead || !tbody) return;

    var numInpStyle = 'width:84px;text-align:right;padding:5px 8px;border-radius:6px;background:var(--cp-input-bg,#0f172a);color:var(--cp-text,#f8fafc);border:1px solid var(--cp-input-border,#334155);font-size:13px;font-weight:700;outline:none;';

    if (_modalPrecioViewMode === 'sucursales') {
      var showSucCol = (_modalBranchFilter === 'ALL');
      thead.innerHTML = '<tr>' +
        (showSucCol ? '<th><i class="fa-solid fa-store"></i>Sucursal</th>' : '') +
        '<th style="min-width:150px;"><i class="fa-solid fa-list-ul"></i>Escala</th>' +
        '<th><i class="fa-solid fa-truck-fast"></i>Costo c/Flete</th>' +
        '<th><i class="fa-solid fa-tag"></i>Margen Base (%)</th>' +
        '<th><i class="fa-solid fa-plus"></i>Ajuste Suc. (%)</th>' +
        '<th style="color:#f59e0b;"><i class="fa-solid fa-gear" style="color:#f59e0b;"></i>Oferta (%)</th>' +
        '<th><i class="fa-solid fa-briefcase"></i>Margen Final (%)</th>' +
        '<th><i class="fa-solid fa-dollar-sign"></i>Precio Venta</th>' +
        '<th class="cp-c">V</th>' +
        '<th>Precio<br>Activo</th>' +
        '<th><i class="fa-solid fa-building"></i>Comisión (%)</th>' +
      '</tr>';

      var rowsHtml = [];
      (global._paProductBranchScales || []).forEach(function (bs, idx) {
        if (_modalBranchFilter !== 'ALL' && norm(bs.branch_name || bs.branch_id) !== norm(_modalBranchFilter)) {
          return;
        }
        var mBase = num(bs.margen_ideal);
        var mAj = num(bs.sobreprecio_suc);
        var mOfer = num(bs.oferta);
        var mFinal = mBase + mAj - mOfer;
        var calcPrice = num(bs.precio);
        rowsHtml.push(
          '<tr data-bs-idx="' + idx + '"' + (rowsHtml.length === 0 ? ' class="cp-hl"' : '') + '>' +
            (showSucCol ? ('<td style="white-space:nowrap;font-weight:700;"><i class="fa-solid fa-store" style="color:#38a8ff;margin-right:6px;"></i>' + esc(bs.branch_name) + '</td>') : '') +
            '<td style="font-weight:700;white-space:nowrap;min-width:150px;">' + esc(bs.scale_name) + '</td>' +
            '<td class="cp-cell-cost" style="color:#34d399;font-weight:700;">$' + fmt2(costoRef) + '</td>' +
            '<td><input type="number" step="0.01" class="cp-live-inp cp-inp-bs-mbase" value="' + fmt2(mBase) + '" style="' + numInpStyle + 'color:#38bdf8;"></td>' +
            '<td><input type="number" step="0.01" class="cp-live-inp cp-inp-bs-maj" value="' + fmt2(mAj) + '" style="' + numInpStyle + 'color:#fbbf24;"></td>' +
            '<td><input type="number" step="0.01" class="cp-live-inp cp-inp-bs-ofer" value="' + fmt2(mOfer) + '" style="' + numInpStyle + 'width:76px;color:#f59e0b;border-color:rgba(245,158,11,0.65);"></td>' +
            '<td><input type="number" step="0.01" class="cp-live-inp cp-inp-bs-mfin" value="' + fmt2(mFinal) + '" style="' + numInpStyle + 'color:#34d399;"></td>' +
            '<td><input type="number" step="0.01" class="cp-input cp-live-inp cp-inp-bs-price" value="' + fmt2(calcPrice) + '" style="width:112px;font-weight:800;"></td>' +
            '<td class="cp-c cp-cell-trend">' + renderPriceTrendArrowHtml(bs) + '</td>' +
            '<td class="cp-cell-active-price" style="font-weight:800;color:#38bdf8;">$' + fmt2(bs.precio_activo != null ? bs.precio_activo : calcPrice) + '</td>' +
            '<td><input type="number" step="0.01" class="cp-live-inp cp-inp-bs-com" value="' + fmt2(bs.comision) + '" style="' + numInpStyle + 'width:72px;"></td>' +
          '</tr>'
        );
      });
      tbody.innerHTML = rowsHtml.join('');

      tbody.querySelectorAll('tr[data-bs-idx]').forEach(function (tr) {
        var idx = parseInt(tr.getAttribute('data-bs-idx'), 10);
        var bs = global._paProductBranchScales[idx];
        if (!bs) return;
        var inpBase  = tr.querySelector('.cp-inp-bs-mbase');
        var inpAj    = tr.querySelector('.cp-inp-bs-maj');
        var inpOfer  = tr.querySelector('.cp-inp-bs-ofer');
        var inpFin   = tr.querySelector('.cp-inp-bs-mfin');
        var inpPrice = tr.querySelector('.cp-inp-bs-price');
        var cellTrend = tr.querySelector('.cp-cell-trend');
        var cellAct   = tr.querySelector('.cp-cell-active-price');
        var inpCom   = tr.querySelector('.cp-inp-bs-com');

        [inpBase, inpAj, inpOfer, inpFin, inpPrice, inpCom].forEach(function (inp) {
          if (!inp) return;
          inp.addEventListener('focus', function () {
            if (num(bs.precio) > 0) bs._lastStepPrice = num(bs.precio);
            if (typeof inp.select === 'function') inp.select();
          });
          inp.addEventListener('change', function () {
            if (num(bs.precio) > 0) bs._lastStepPrice = num(bs.precio);
          });
        });

        function recalcFromMargins(source) {
          var c = getEffectiveProductCostContext();
          var mB = num(inpBase.value);
          var mA = num(inpAj.value);
          var mO = num(inpOfer ? inpOfer.value : 0);
          var mF = num(inpFin.value);
          if (source === 'fin') {
            mA = mF - mB + mO;
            if (inpAj) inpAj.value = fmt2(mA);
          } else {
            mF = mB + mA - mO;
            if (inpFin) inpFin.value = fmt2(mF);
          }
          var p = c.costoUnitConFlete > 0 ? (c.costoUnitConFlete * (1 + mF / 100) * c.factorIva) : num(inpPrice.value);
          var baseRefP = c.costoUnitConFlete > 0 ? (c.costoUnitConFlete * (1 + (mB + mA) / 100) * c.factorIva) : p;
          bs.margen_ideal = Number(mB.toFixed(4));
          bs.sobreprecio_suc = Number(mA.toFixed(4));
          bs.oferta = Number(mO.toFixed(4));
          bs.margen_final = Number(mF.toFixed(4));
          updateScaleItemPriceAndTrend(bs, p, baseRefP, true);
          syncDirectTableOfferRecord(bs.branch_name || bs.branch_id, bs.scale_name, mO, bs.precio);
          if (inpPrice && document.activeElement !== inpPrice) inpPrice.value = fmt2(bs.precio);
          if (cellTrend) cellTrend.innerHTML = renderPriceTrendArrowHtml(bs);
          if (cellAct) cellAct.textContent = '$' + fmt2(bs.precio_activo);
          renderInlineProductAltaScalesPreview();
        }

        function recalcFromPrice() {
          var c = getEffectiveProductCostContext();
          var p = num(inpPrice.value);
          var mB = num(inpBase.value);
          var mO = num(inpOfer ? inpOfer.value : 0);
          var mF = num(inpFin.value);
          if (c.costoUnitConFlete > 0 && p >= 0) {
            var pSinIva = c.factorIva > 0 ? (p / c.factorIva) : p;
            mF = ((pSinIva / c.costoUnitConFlete) - 1) * 100;
          }
          var mA = mF - mB + mO;
          var baseRefP = c.costoUnitConFlete > 0 ? (c.costoUnitConFlete * (1 + (mB + mA) / 100) * c.factorIva) : p;
          bs.margen_ideal = Number(mB.toFixed(4));
          bs.sobreprecio_suc = Number(mA.toFixed(4));
          bs.oferta = Number(mO.toFixed(4));
          bs.margen_final = Number(mF.toFixed(4));
          updateScaleItemPriceAndTrend(bs, p, baseRefP, true);
          syncDirectTableOfferRecord(bs.branch_name || bs.branch_id, bs.scale_name, mO, bs.precio);
          if (inpFin) inpFin.value = fmt2(mF);
          if (inpAj) inpAj.value = fmt2(mA);
          if (cellTrend) cellTrend.innerHTML = renderPriceTrendArrowHtml(bs);
          if (cellAct) cellAct.textContent = '$' + fmt2(bs.precio_activo);
          renderInlineProductAltaScalesPreview();
        }

        if (inpBase) inpBase.addEventListener('input', function () { recalcFromMargins('base'); });
        if (inpAj)   inpAj.addEventListener('input', function () { recalcFromMargins('aj'); });
        if (inpOfer) inpOfer.addEventListener('input', function () { recalcFromMargins('ofer'); });
        if (inpFin)  inpFin.addEventListener('input', function () { recalcFromMargins('fin'); });
        if (inpPrice) inpPrice.addEventListener('input', recalcFromPrice);
        if (inpCom)  inpCom.addEventListener('input', function () { bs.comision = num(inpCom.value); });
      });

    } else {
      thead.innerHTML = '<tr>' +
        '<th style="min-width:165px;"><i class="fa-solid fa-list-ul"></i>Escala</th>' +
        '<th><i class="fa-solid fa-truck-fast"></i>Costo c/Flete</th>' +
        '<th><i class="fa-solid fa-tag"></i>Margen<br>Ideal (%)</th>' +
        '<th><i class="fa-solid fa-briefcase"></i>Margen D/Trabajo (%)</th>' +
        '<th style="color:#f59e0b;"><i class="fa-solid fa-gear" style="color:#f59e0b;"></i>Oferta (%)</th>' +
        '<th><i class="fa-solid fa-dollar-sign"></i>Precio Venta</th>' +
        '<th class="cp-c">V</th>' +
        '<th>Precio<br>Activo</th>' +
        '<th><i class="fa-solid fa-building"></i>Comisión<br>Venta (%)</th>' +
      '</tr>';

      tbody.innerHTML = (global._paProductPriceScales || []).map(function (sc, idx) {
        var mIdeal = num(sc.margen_ideal);
        var ofer   = num(sc.oferta);
        var mTrab  = num(sc.margen_trabajo != null ? sc.margen_trabajo : (mIdeal - ofer));
        var calcPrice = num(sc.precio);
        return '<tr data-sc-idx="' + idx + '"' + (idx === 0 ? ' class="cp-hl"' : '') + '>' +
          '<td style="font-weight:700;white-space:nowrap;min-width:165px;">' + esc(sc.scale_name || sc.nombre) + '</td>' +
          '<td class="cp-cell-cost" style="color:#34d399;font-weight:700;">$' + fmt2(costoRef) + '</td>' +
          '<td><input type="number" step="0.01" class="cp-live-inp cp-inp-sc-mideal" value="' + fmt2(mIdeal) + '" style="' + numInpStyle + 'color:#38bdf8;"></td>' +
          '<td><input type="number" step="0.01" class="cp-live-inp cp-inp-sc-mtrab" value="' + fmt2(mTrab) + '" style="' + numInpStyle + 'color:#34d399;"></td>' +
          '<td><input type="number" step="0.01" class="cp-live-inp cp-inp-sc-ofer" value="' + fmt2(ofer) + '" style="' + numInpStyle + 'width:74px;color:#f59e0b;border-color:rgba(245,158,11,0.65);"></td>' +
          '<td><input type="number" step="0.01" class="cp-input cp-live-inp cp-inp-sc-price" value="' + fmt2(calcPrice) + '" style="width:112px;font-weight:800;"></td>' +
          '<td class="cp-c cp-cell-trend">' + renderPriceTrendArrowHtml(sc) + '</td>' +
          '<td class="cp-cell-active-price" style="font-weight:800;color:#38bdf8;">$' + fmt2(sc.precio_activo != null ? sc.precio_activo : calcPrice) + '</td>' +
          '<td><input type="number" step="0.01" class="cp-live-inp cp-inp-sc-com" value="' + fmt2(sc.comision) + '" style="' + numInpStyle + 'width:72px;"></td>' +
        '</tr>';
      }).join('');

      tbody.querySelectorAll('tr[data-sc-idx]').forEach(function (tr) {
        var idx = parseInt(tr.getAttribute('data-sc-idx'), 10);
        var sc = global._paProductPriceScales[idx];
        if (!sc) return;
        var inpIdeal  = tr.querySelector('.cp-inp-sc-mideal');
        var inpTrab   = tr.querySelector('.cp-inp-sc-mtrab');
        var inpOfer   = tr.querySelector('.cp-inp-sc-ofer');
        var inpPrice  = tr.querySelector('.cp-inp-sc-price');
        var cellTrend = tr.querySelector('.cp-cell-trend');
        var cellAct   = tr.querySelector('.cp-cell-active-price');
        var inpCom    = tr.querySelector('.cp-inp-sc-com');

        [inpIdeal, inpTrab, inpOfer, inpPrice, inpCom].forEach(function (inp) {
          if (!inp) return;
          inp.addEventListener('focus', function () {
            if (num(sc.precio) > 0) sc._lastStepPrice = num(sc.precio);
            if (typeof inp.select === 'function') inp.select();
          });
          inp.addEventListener('change', function () {
            if (num(sc.precio) > 0) sc._lastStepPrice = num(sc.precio);
          });
        });

        function recalcScaleFromPct(source) {
          var c = getEffectiveProductCostContext();
          var mI = num(inpIdeal.value);
          var mT = num(inpTrab.value);
          var of = num(inpOfer.value);
          if (source === 'trab') {
            mI = mT + of;
            if (inpIdeal) inpIdeal.value = fmt2(mI);
          } else {
            mT = mI - of;
            if (inpTrab) inpTrab.value = fmt2(mT);
          }
          var p = c.costoUnitConFlete > 0 ? (c.costoUnitConFlete * (1 + mT / 100) * c.factorIva) : num(inpPrice.value);
          var idealRefP = c.costoUnitConFlete > 0 ? (c.costoUnitConFlete * (1 + mI / 100) * c.factorIva) : p;
          sc.margen_ideal = Number(mI.toFixed(4));
          sc.oferta = Number(of.toFixed(4));
          sc.margen_trabajo = Number(mT.toFixed(4));
          sc.margin = Number(mT.toFixed(4));
          updateScaleItemPriceAndTrend(sc, p, idealRefP, false);
          syncDirectTableOfferRecord('MATRIZ', sc.scale_name || sc.nombre, of, sc.precio);
          if (inpPrice && document.activeElement !== inpPrice) inpPrice.value = fmt2(sc.precio);
          if (cellTrend) cellTrend.innerHTML = renderPriceTrendArrowHtml(sc);
          if (cellAct) cellAct.textContent = '$' + fmt2(sc.precio_activo);
          if (idx === 0) syncFirstScaleToMainForm(sc);
          renderInlineProductAltaScalesPreview();
        }

        function recalcScaleFromPrice() {
          var c = getEffectiveProductCostContext();
          var p = num(inpPrice.value);
          var of = num(inpOfer.value);
          var mT = num(inpTrab.value);
          if (c.costoUnitConFlete > 0 && p >= 0) {
            var pSinIva = c.factorIva > 0 ? (p / c.factorIva) : p;
            mT = ((pSinIva / c.costoUnitConFlete) - 1) * 100;
          }
          var mI = mT + of;
          var idealRefP = c.costoUnitConFlete > 0 ? (c.costoUnitConFlete * (1 + mI / 100) * c.factorIva) : p;
          sc.margen_ideal = Number(mI.toFixed(4));
          sc.oferta = Number(of.toFixed(4));
          sc.margen_trabajo = Number(mT.toFixed(4));
          sc.margin = Number(mT.toFixed(4));
          updateScaleItemPriceAndTrend(sc, p, idealRefP, false);
          syncDirectTableOfferRecord('MATRIZ', sc.scale_name || sc.nombre, of, sc.precio);
          if (inpTrab) inpTrab.value = fmt2(mT);
          if (inpIdeal) inpIdeal.value = fmt2(mI);
          if (cellTrend) cellTrend.innerHTML = renderPriceTrendArrowHtml(sc);
          if (cellAct) cellAct.textContent = '$' + fmt2(sc.precio_activo);
          if (idx === 0) syncFirstScaleToMainForm(sc);
          renderInlineProductAltaScalesPreview();
        }

        if (inpIdeal) inpIdeal.addEventListener('input', function () { recalcScaleFromPct('ideal'); });
        if (inpOfer)  inpOfer.addEventListener('input', function () { recalcScaleFromPct('ofer'); });
        if (inpTrab)  inpTrab.addEventListener('input', function () { recalcScaleFromPct('trab'); });
        if (inpPrice) inpPrice.addEventListener('input', recalcScaleFromPrice);
        if (inpCom)   inpCom.addEventListener('input', function () { sc.comision = num(inpCom.value); });
      });
    }

    if (modal.style.display === 'flex' && !_modalBranchDropdownOpen) {
      var actEl = document.activeElement;
      var inQuickCost = (actEl && (actEl.id === 'cp-quick-costo-inp' || actEl.id === 'cp-quick-flete-inp'));
      var inTableInp = (actEl && actEl.classList && actEl.classList.contains('cp-live-inp') && tbody.contains(actEl));
      if (!inQuickCost && !inTableInp) {
        var firstInp = tbody.querySelector('input.cp-live-inp:not([disabled])');
        if (firstInp) {
          setTimeout(function () {
            try { firstInp.focus(); } catch (e) {}
            if (typeof firstInp.select === 'function') {
              try { firstInp.select(); } catch (e) {}
            }
          }, 15);
        }
      }
    }
  };

  /* ───────────────────────── Navegación en #configuracion (Clicks + F1-F9 + Flechas) ───────────────────────── */
  global.cfgShowSection = function (key, focusCard) {
    if (SECS.indexOf(key) < 0) key = 'general';
    _activeSec = key;
    document.querySelectorAll('#cfg-hub .cfg-sec').forEach(function (sec) {
      sec.classList.toggle('on', sec.getAttribute('data-cfg-sec') === key);
    });
    document.querySelectorAll('#cfg-cards .cfg-card').forEach(function (c) {
      var isAct = c.getAttribute('data-cfg') === key;
      c.classList.toggle('active', isAct);
      if (isAct && focusCard) {
        try { c.focus({ preventScroll: true }); } catch (e) { c.focus(); }
      }
    });
    if (key === 'catalogos') {
      global.cfgShowCatalogo(_cat);
    } else if (key === 'whatsapp') {
      ensureStoreLoaded().then(function () { paintMensajeriaForm(); });
    } else if (key === 'impresoras') {
      ensureStoreLoaded().then(function () { renderPrintersSection(); });
    }
  };

  global.cfgShowCatalogo = function (sub) {
    if (['productos', 'precios', 'generales'].indexOf(sub) < 0) sub = 'productos';
    _cat = sub;
    document.querySelectorAll('#cfg-subnav .cfg-subbtn').forEach(function (b) {
      b.classList.toggle('active', b.getAttribute('data-cfgcat') === sub);
    });
    document.querySelectorAll('#cfg-hub .cfg-sub').forEach(function (p) {
      p.classList.toggle('on', p.getAttribute('data-cfg-sub') === sub);
    });
    if (sub === 'productos') {
      ensureStoreLoaded().then(function () {
        renderProductos(_prods || [], _params || {});
      }).catch(function (e) {
        var b = byId('cfg-prod-body'); if (b) b.innerHTML = errBox(e.message);
      });
    } else if (sub === 'precios') {
      ensureStoreLoaded().then(function () {
        renderPrecios(_prods || [], _params || {});
      }).catch(function (e) {
        var b = byId('cfg-precios-body'); if (b) b.innerHTML = errBox(e.message);
      });
    }
  };

  global.cfgIrProductos = function () {
    if (typeof global.navigateTo === 'function') global.navigateTo('productos'); else window.location.hash = '#productos';
  };

  /* Calcula el número de columnas visibles en el grid #cfg-cards para el salto de fila con ArrowUp/ArrowDown */
  function getCardsGridCols() {
    var cards = document.querySelectorAll('#cfg-cards .cfg-card');
    if (cards.length < 2) return 1;
    var firstTop = cards[0].offsetTop;
    var cols = 0;
    for (var i = 0; i < cards.length; i++) {
      if (Math.abs(cards[i].offsetTop - firstTop) <= 8) cols++;
      else break;
    }
    return Math.max(1, cols);
  }

  /* Navegación global por teclado dentro de #configuracion:
     - Teclas F1 a F9 seleccionan inmediatamente la tarjeta correspondiente (preventDefault)
     - Flechas ArrowLeft, ArrowRight, ArrowUp, ArrowDown mueven el foco activo entre las 9 tarjetas
  */
  if (!global.__cfgKeyboardNavBound) {
    global.__cfgKeyboardNavBound = true;
    document.addEventListener('keydown', function (e) {
      var cfgHub = byId('cfg-hub');
      if (!cfgHub || cfgHub.offsetParent === null) return;

      /* Cerrar modal de impresora con Escape si está abierto */
      var prtModal = byId('modal-impresora');
      if (e.key === 'Escape' && prtModal && prtModal.style.display === 'flex') {
        e.preventDefault();
        global.cerrarModalImpresora();
        return;
      }

      if (e.ctrlKey || e.shiftKey || e.altKey || e.metaKey) return;

      /* 1. Teclas de función F1 a F9 → Activan tarjeta inmediatamente */
      var fm = /^F([1-9])$/.exec(e.key || '');
      if (fm) {
        var fIdx = parseInt(fm[1], 10) - 1;
        if (fIdx >= 0 && fIdx < SECS.length) {
          e.preventDefault();
          e.stopPropagation();
          global.cfgShowSection(SECS[fIdx], true);
        }
        return;
      }

      /* 2. Navegación con Flechas (ArrowLeft, ArrowRight, ArrowUp, ArrowDown) */
      var isArrow = (e.key === 'ArrowLeft' || e.key === 'ArrowRight' || e.key === 'ArrowUp' || e.key === 'ArrowDown');
      if (!isArrow && e.key !== 'Enter') return;

      var target = e.target;
      var tag = target && target.tagName ? target.tagName.toUpperCase() : '';
      var isCardFocused = !!(target && target.closest && target.closest('#cfg-cards .cfg-card'));
      var isTypingField = (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || (target && target.isContentEditable));
      if (isTypingField && !isCardFocused) return;

      if (e.key === 'Enter' && isCardFocused) {
        e.preventDefault();
        var secKey = target.closest('.cfg-card').getAttribute('data-cfg');
        if (secKey) global.cfgShowSection(secKey, true);
        return;
      }

      if (!isArrow) return;
      e.preventDefault();

      var curIdx = SECS.indexOf(_activeSec);
      if (curIdx < 0) curIdx = 0;
      var total = SECS.length;
      var cols = getCardsGridCols();
      var nextIdx = curIdx;

      if (e.key === 'ArrowRight') {
        nextIdx = (curIdx + 1) % total;
      } else if (e.key === 'ArrowLeft') {
        nextIdx = (curIdx - 1 + total) % total;
      } else if (e.key === 'ArrowDown') {
        if (curIdx + cols < total) nextIdx = curIdx + cols;
        else nextIdx = curIdx % cols; /* vuelve a la primera fila en la misma columna */
      } else if (e.key === 'ArrowUp') {
        if (curIdx - cols >= 0) nextIdx = curIdx - cols;
        else {
          /* salta a la última fila disponible en esa columna */
          var col = curIdx % cols;
          var candidate = col + Math.floor((total - 1) / cols) * cols;
          if (candidate >= total) candidate -= cols;
          nextIdx = Math.max(0, candidate);
        }
      }

      global.cfgShowSection(SECS[nextIdx], true);
    }, true);
  }

  /* ───────────────────────── Estado en vivo de los botones ───────────────────────── */
  function setCard(key, text, state) {
    var t = byId('cfg-sub-' + key); if (t && text) t.textContent = text;
    var d = byId('cfg-dot-' + key); if (d && state) d.className = 'cfg-dot ' + state;
  }

  function refreshStatus() {
    safe(get('/api/branches')).then(function (b) {
      if (!Array.isArray(b)) return;
      var act = b.filter(function (x) { return x.status === 'ACTIVE'; }).length;
      setCard('sucursales', act + (act === 1 ? ' sucursal activa' : ' sucursales activas'), act ? 'ok' : 'off');
    });
    safe(get('/api/admin/integrations/whatsapp')).then(function (c) {
      if (!c) return;
      if (c.enabled && c.configured) setCard('whatsapp', 'WhatsApp activo · FB, IG, Correo y SMS', 'ok');
      else if (c.enabled) setCard('whatsapp', 'WhatsApp falta config. · FB, IG, Correo y SMS', 'warn');
      else updateRedesCardSubtitle();
    });
    safe(get('/api/admin/integrations/cfdi')).then(function (c) {
      if (!c) return;
      if (c.pac_mode === 'other') setCard('sat', 'PAC externo', 'off');
      else if (c.will_use_mock) setCard('sat', 'Modo simulación', 'warn');
      else if (c.configured) setCard('sat', (c.environment === 'production' ? 'Producción' : 'Pruebas') + ' · Listo', 'ok');
      else setCard('sat', 'Sin configurar', 'off');
    });
    safe(get('/api/multisucursal/config')).then(function (c) {
      if (!c) return;
      var n = Object.keys(c.terminales || {}).length;
      setCard('terminales', n + (n === 1 ? ' terminal' : ' terminales') + (c.enforce ? ' · acceso restringido' : ' · acceso libre'), c.enforce ? 'ok' : 'off');
    });
    loadParams().then(function (cfg) {
      var nombre = cfg['params.empresa_nombre'], mon = cfg['params.moneda'], zona = cfg['params.zona_horaria'], iva = cfg['params.iva_porcentaje'];
      var set = function (id, v) { var e = byId(id); if (e) e.value = v == null ? '' : v; };
      set('cfg-info-nombre', nombre); set('cfg-info-moneda', mon); set('cfg-info-zona', zona); set('cfg-info-iva', iva != null ? iva + ' %' : '');
      if (nombre) setCard('general', nombre);
      setCard('parametros', (mon || 'MXN') + ' · IVA ' + (iva != null ? iva : 16) + ' %');
    }).catch(function () {});
  }

  /* Exponer Store API para consumo directo */
  global.CalebsysCatalogStore = {
    ensureLoaded: ensureStoreLoaded,
    getSnapshot: getStoreSnapshot,
    resolveSatUnidad: resolveSatClaveUnidad,
    saveSatUnitAssociation: saveSatUnitAssociation,
    addFamilia: global.calebsysAddFamilia,
    addDepartamento: global.calebsysAddDepartamento,
    renderAccordion: global.renderProductAltaCatalogosPanel,
    notifyProductSaved: function (prodObj) {
      if (!prodObj) return;
      prodObj._userCreated = true;
      if (!Array.isArray(_prods)) _prods = [];
      var existingIdx = -1;
      for (var i = 0; i < _prods.length; i++) {
        if (norm(_prods[i].sku) === norm(prodObj.sku)) { existingIdx = i; break; }
      }
      if (existingIdx >= 0) _prods[existingIdx] = prodObj;
      else _prods.push(prodObj);
      var m = norm(meta(prodObj).marca || meta(prodObj).brand);
      if (m && _catLists.marcas.indexOf(m) < 0) {
        _catLists.marcas.push(m);
      }
      broadcastCatalogUpdate();
      refreshAllCatalogViews();
    }
  };

  /* ───────────────────────── Arranque ───────────────────────── */
  function cfgHubInit() {
    ensureAccordionStyles();
    if (!byId('cfg-hub')) return;
    _prods = null; _params = null; _cat = 'productos';
    global.cfgShowSection('general');
    refreshStatus();
    ensureStoreLoaded();
  }

  if (!global.__cfgHubWrapped) {
    global.__cfgHubWrapped = true;
    var _orig = global.loadEmpresaConfig;
    global.loadEmpresaConfig = async function () {
      try { if (typeof _orig === 'function') await _orig.apply(this, arguments); }
      finally { cfgHubInit(); }
    };
    setTimeout(function () {
      ensureStoreLoaded().then(function () {
        if (!global._paLoadedExistingProduct && byId('pa-product-form')) {
          global.resetProductPriceScalesForNewForm();
        }
      }).catch(function () {});
    }, 10);
  }

})(window);
