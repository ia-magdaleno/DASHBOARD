/* =============================================================================
   CALEBSYS — Recepción de Mercancía 360° · ASISTENTE (WIZARD) DE 5 PASOS
   Archivo: frontend/scripts/loaders/reception-wizard.js   (requiere reception-hub.js)

   PASO 1  Origen, OC y Bóveda de facturas (parser real CFDI 4.0)
   PASO 2  Hoja precargada de Homologación de códigos XML y Pre-Alta de productos
   PASO 3  Flete, costos adicionales (Landed Cost) y prorrateo automático
   PASO 4  Inspección física, fotos de evidencia y gestión de anomalías
   PASO 5  Calificación del proveedor, firmas digitales y afectación integral
   ============================================================================= */
(function (global) {
  'use strict';
  var RH = global.RH = global.RH || {};
  var esc = function (s) { return RH.esc(s); };
  var num = function (v) { return RH.num(v); };
  var $ = function (id) { return document.getElementById(id); };

  var ORIGINS = [
    ['OC', '🏢 Compra de Proveedor (Con Orden de Compra)', 'Precarga proveedor, bodega y productos esperados de la OC'],
    ['DIRECTA', '⚡ Compra Directa de Proveedor (Sin Orden de Compra)', 'Entrada directa contra factura'],
    ['TRASPASO', '🔄 Traspaso entre Sucursales', 'Entra a inventario sin factura de proveedor'],
    ['REPOSICION', '↩️ Reposición / Cambio Físico de Proveedor', 'Mercancía que repone un reclamo previo'],
    ['CONSIGNACION', '🤝 Mercancía en Consignación', 'No genera cuenta por pagar hasta que se venda']
  ];
  var FREIGHT_CONDS = [
    ['PROVEEDOR', '🟢 Pagado por el Proveedor', 'Sin costo para nosotros (0%)'],
    ['CONTADO', '💵 Pagado por Nosotros de Contado / Anticipado', 'Entra a Gastos y Caja/Bancos'],
    ['POR_COBRAR', '🚚 Por Cobrar al Llegar', 'Se paga al chofer y entra a Gastos'],
    ['CREDITO', '💳 Flete a Crédito con la Transportista', 'Entra a Gastos y genera Cuenta por Pagar a la fletera']
  ];
  var COST_TYPES = [['FLETE', '🚛 Flete'], ['MANIOBRAS', '🏗️ Maniobras de descarga'], ['SEGURO', '🛡️ Seguro'], ['ADUANA', '🛃 Aduana'], ['OTRO', '📦 Otro']];
  var METHODS = [
    ['IMPORTE', 'Por Importe ($ proporcional al valor de factura)'],
    ['PESO', 'Por Peso (Kg) — usa el peso de Complementos [F4]'],
    ['VOLUMEN', 'Por Volumen (m³) — usa el cubicaje de Complementos [F4]'],
    ['CANTIDAD', 'Por Cantidad de Piezas']
  ];
  var CAUSES = ['Roto', 'Abierto', 'Humedad', 'Oxidación', 'Golpeado', 'Caducado', 'Otro'];
  var UNIT_MAP = { H87: 'PIEZA', KGM: 'KILOGRAMO', MTR: 'METRO', LTR: 'LITRO', XBX: 'CAJA', XSA: 'SACO', XBG: 'BOLSA', MTQ: 'M3', MTK: 'M2',
    TNE: 'TONELADA', XPK: 'PAQUETE', XRO: 'ROLLO', XBJ: 'CUBETA', GLL: 'GALON', SET: 'JUEGO', PR: 'PAR', E48: 'SERVICIO' };
  var STEP_NAMES = ['Origen y Facturas', 'Homologación XML', 'Flete y Landed Cost', 'Inspección física', 'Calificación y Firmas'];
  var IVA = 1.16;

  var S = null;                 // estado del asistente
  var LISTS = { suppliers: [], warehouses: [] };

  function newState() {
    return {
      step: 1, busy: false, inspected: false,
      origin: 'OC', supplier: null, warehouse_id: '', po: null, poList: [], poFolioManual: '',
      inv: { xmlText: '', xmlName: '', parsed: null, pdf: null, duplicate: false },
      payment: 'CREDITO', cartaPorte: [], packing: [], items: [], prealtas: [],
      freight: { legs: [newLeg()], open2: false },
      method: 'IMPORTE', physical: { state: 'SELLADA', notes: '' }, arrival: [],
      incident: { action: '', status: 'ABIERTO', notes: '' },
      ratings: { empaque: 0, tiempo: 0, documentacion: 0, producto: 0, comments: '' },
      sigs: { chofer: null, almacen: null, supervisor: null }, authorized: false,
      idem: 'rec-' + Date.now() + '-' + Math.random().toString(36).slice(2, 10)
    };
  }
  RH.wizardState = function () { return S; };

  /* ──────────────────────────── Utilidades del asistente ──────────────────────────── */
  function msg(html, kind) {
    var box = $('rh-wz-msg'); if (!box) return;
    box.innerHTML = html ? '<div class="rh-alert ' + (kind || 'bad') + '">' + html + '</div>' : '';
    if (html && box.scrollIntoView) box.scrollIntoView({ block: 'nearest' });
  }
  function isSinCargoOrigin(o) { return o === 'TRASPASO' || o === 'CONSIGNACION' || o === 'REPOSICION'; }
  function findProduct(sku) {
    var s = String(sku || '').trim().toUpperCase();
    return RH.catalog.filter(function (p) { return String(p.sku || '').toUpperCase() === s; })[0] || null;
  }
  function productByCode(code) {
    var c = String(code || '').trim().toUpperCase(); if (!c) return null;
    var nz = RH.noZeros(c), cat = RH.catalog, i;
    for (i = 0; i < cat.length; i++) if (String(cat[i].sku || '').toUpperCase() === c) return { p: cat[i], via: 'SKU' };
    for (i = 0; i < cat.length; i++) { var b = String(cat[i].barcode || '').toUpperCase(); if (b && (b === c || (nz && RH.noZeros(b) === nz))) return { p: cat[i], via: 'BARCODE' }; }
    for (i = 0; i < cat.length; i++) if (RH.pAlt(cat[i]) === c) return { p: cat[i], via: 'ALTERNO' };
    return null;
  }
  function productCost(p) { return num(p && p.average_cost); }
  function prodLabel(p) { return esc(p.sku) + ' — ' + esc(p.name || p.description || ''); }
  function totalsOf(items, fn) { return items.reduce(function (s, it) { return s + fn(it); }, 0); }
  function scrollKeep(fn) {
    var b = $('content-area') || $('rh-wz-body'), t = b ? b.scrollTop : 0;
    fn();
    if (b) b.scrollTop = t;
  }

  /* ─────────────────────── Matching de partidas XML ↔ catálogo ─────────────────────── */
  function applyMatch(it, product, status, via) {
    it.match = { status: status, via: via, product: product };
    it.sku = product.sku; it.barcode = product.barcode || product.sku;
    var lg = RH.pLogistics(product);
    it.unit_weight_kg = num(lg.peso_kg); it.unit_volume_m3 = num(lg.volumen_m3);
    it.prev_cost = productCost(product);
  }
  function matchLine(it) {
    it.match = null; it.sku = ''; it.barcode = '';
    var supKey = (S.supplier && (S.supplier.rfc || S.supplier.name)) || '';
    var f4 = (typeof global.findProductBySupplierXmlSkuSync === 'function') ? global.findProductBySupplierXmlSkuSync(supKey, it.supplier_code, RH.catalog) : null;
    if (f4 && f4.product) {
      applyMatch(it, f4.product, 'HOMOLOGADO', 'PROVEEDOR_F4');
      var fac = num(f4.conversionFactor) || 1;
      if (fac !== 1 && !it.factor) {
        it.factor = fac; it.qty_invoiced = RH.r4(it.qty_invoiced * fac); it.unit_cost = RH.r4(it.unit_cost / fac);
      }
      return;
    }
    var hit = productByCode(it.supplier_code);
    if (hit) applyMatch(it, hit.p, 'HOMOLOGADO', hit.via);
  }
  function makeLine(c, idx) {
    return {
      line_no: c.line_no || idx + 1, supplier_code: String(c.code || '').toUpperCase(), description: c.description || '',
      sat_key: c.sat_key || '', sat_unit: c.sat_unit || 'H87', qty_invoiced: num(c.qty), unit_cost: RH.r4(c.net_unit != null ? c.net_unit : c.unit_cost),
      iva_rate: c.iva_rate != null ? c.iva_rate : 0.16, match: null, sku: '', barcode: '', panel: '', linkQ: '', sheet: null,
      qty_ok: 0, qty_missing: num(c.qty), qty_damaged: 0, damage_cause: '', lot: '', expiry: '', checked: false, damagePhoto: null,
      prev_cost: 0, unit_weight_kg: 0, unit_volume_m3: 0, update_price: false, new_price: 0, margin_pct: 0, poi_id: null, oc_qty: null
    };
  }
  function rebuildItemsFromCfdi() {
    var P = S.inv.parsed; if (!P) return;
    S.items = P.concepts.map(function (c, i) { return makeLine(c, i); });
    S.items.forEach(matchLine);
    attachOcExpected();
  }
  function attachOcExpected() {
    if (!S.po || !S.po.items) return;
    S.items.forEach(function (it) {
      var poi = S.po.items.filter(function (x) { return String(x.sku || '').toUpperCase() === String(it.sku || it.supplier_code).toUpperCase(); })[0];
      if (poi) { it.oc_qty = num(poi.quantity_ordered) - num(poi.quantity_received); it.poi_id = poi.id; }
    });
  }

  /* ───────────────────────────── Apertura / cierre ───────────────────────────── */
  RH.actions['wizard-open'] = async function () {
    S = newState();
    var ov = $('rh-wizard'); if (!ov) return;
    ov.classList.add('open'); ov.setAttribute('aria-hidden', 'false');
    $('rh-wz-body').innerHTML = '<div style="padding:40px;text-align:center;color:var(--text-muted);"><i class="fa-solid fa-spinner fa-spin"></i> Preparando el asistente…</div>';
    try {
      var r = await Promise.all([
        RH.api('/api/suppliers?limit=200'), RH.api('/api/warehouses'), RH.loadCatalog(true),
        RH.api('/api/reception-hub/price-scales').catch(function () { return null; })
      ]);
      LISTS.suppliers = (r[0] || []).filter(function (s) { return s.status === 'ACTIVE' || !s.status; });
      LISTS.warehouses = Array.isArray(r[1]) ? r[1] : [];
      S.scales = ((r[3] && r[3].price_scales) || []).filter(function (a) { return a.active !== false; });
      if (!S.scales.length) S.scales = [{ name: 'PRECIO DE LISTA', margen_trabajo: 50 }];
      if (LISTS.warehouses.length === 1) S.warehouse_id = LISTS.warehouses[0].id;
      render();
    } catch (e) {
      $('rh-wz-body').innerHTML = '<div class="rh-alert bad">No se pudo preparar el asistente: ' + esc(e.message) + '</div>';
    }
  };
  function closeWizard() {
    var ov = $('rh-wizard'); if (ov) { ov.classList.remove('open'); ov.setAttribute('aria-hidden', 'true'); }
    S = null;
  }
  RH.actions['wizard-close'] = function () { RH.wizardRequestClose(); };
  RH.wizardRequestClose = function () {
    if (S && !S.busy && (S.items.length || S.inv.parsed || S.step > 1)) {
      if (!global.confirm('¿Cerrar el asistente? Se perderá lo capturado en esta recepción.')) return;
    }
    closeWizard();
  };

  /* ───────────────────────────── Render principal ───────────────────────────── */
  function render() {
    if (!S) return;
    var steps = STEP_NAMES.map(function (n, i) {
      var k = i + 1, cls = k === S.step ? 'active' : (k < S.step ? 'done' : '');
      return '<div class="rh-step ' + cls + '"><b>' + (k < S.step ? '✓' : k) + '</b>' + esc(n) + '</div>';
    }).join('');
    $('rh-wz-steps').innerHTML = steps;
    scrollKeep(function () {
      var html;
      try { html = ([null, step1, step2, step3, step4, step5][S.step])(); }
      catch (err) { console.error('[Recepción] error al dibujar el paso', S.step, err); html = '<div class="rh-alert bad">No se pudo mostrar este paso: ' + esc(err.message) + '</div>'; }
      $('rh-wz-body').innerHTML = '<div id="rh-wz-msg"></div>' + html;
    });
    renderFoot();
    afterRender();
  }
  function renderFoot() {
    var back = S.step > 1 ? '<button type="button" class="rh-btn" data-rh="wz-back">← Atrás</button>' : '<button type="button" class="rh-btn" data-rh="wizard-close">Cancelar</button>';
    var info = '<span class="rh-muted" id="rh-wz-info">' + esc(footInfo()) + '</span>';
    var next = S.step < 5
      ? '<button type="button" class="rh-btn primary" data-rh="wz-next">Siguiente →</button>'
      : '<button type="button" class="rh-btn success" id="rh-confirm-btn" data-rh="wz-confirm"' + (S.authorized ? '' : ' disabled') + '>💾 Confirmar Recepción, Afectar Inventario y Enviar a CxP / Gastos</button>';
    $('rh-wz-foot').innerHTML = '<div style="display:flex;gap:8px;align-items:center;">' + back + info + '</div>' + next;
  }
  function footInfo() {
    var n = S.items.length;
    if (S.step === 1) return S.inv.parsed ? 'Factura leída: ' + n + ' partida(s)' : (S.po ? 'OC cargada: ' + n + ' partida(s)' : '');
    if (n) return n + ' partida(s) · ' + RH.mxn(invoiceTotal());
    return '';
  }
  function afterRender() {
    if (S.step === 5) { ['chofer', 'almacen', 'supervisor'].forEach(function (k) { initSig(k); }); }
    if (S.step === 4) refreshInspection();
    if (S.step === 3) refreshLanded();
    if (S.step === 2) S.items.forEach(function (it, i) { if (!it.match && it.panel === 'link' && it.linkQ) linkResults(it.linkQ, i); });
  }
  RH.actions['wz-back'] = function () { if (S.step > 1) { S.step--; render(); } };
  RH.actions['wz-next'] = function () {
    if (!S || S.busy) return;
    var v;
    try { v = validate(S.step); } catch (err) { console.error(err); RH.toast('Error al validar el paso: ' + err.message, 'bad'); return; }
    if (!v.ok) {
      msg('⚠️ ' + esc(v.msg), 'bad'); setFootMsg(v.msg); RH.toast(v.msg, 'warn');
      if (S.step === 2 && v.jump != null) jumpTo(v.jump);
      return;
    }
    if (S.step === 4) { S.inspected = true; }
    S.step++; render();
    var b = $('content-area') || $('rh-wz-body'); if (b) b.scrollTop = 0;
  };
  /** Mensaje visible en el pie del asistente (junto al botón Siguiente), para que nunca pase inadvertido. */
  function setFootMsg(t) {
    var e = $('rh-wz-info'); if (!e) return;
    clearTimeout(S._fm);
    if (t) {
      e.textContent = '⚠️ ' + t; e.style.color = '#b91c1c'; e.style.fontWeight = '800';
      S._fm = setTimeout(function () { var x = $('rh-wz-info'); if (x && S) { x.style.color = ''; x.style.fontWeight = ''; x.textContent = footInfo(); } }, 9000);
    } else { e.style.color = ''; e.style.fontWeight = ''; e.textContent = footInfo(); }
  }

  /* ───────────────────────────── Cálculos globales ───────────────────────────── */
  function invoiceSubtotalCalc() { return totalsOf(S.items, function (it) { return it.qty_invoiced * it.unit_cost; }); }
  function invoiceTotalCalc() { return totalsOf(S.items, function (it) { return it.qty_invoiced * it.unit_cost * (1 + it.iva_rate); }); }
  function invoiceTotal() { return (S.inv.parsed && S.inv.parsed.total > 0) ? S.inv.parsed.total : invoiceTotalCalc(); }
  function invoiceSub() { return (S.inv.parsed && S.inv.parsed.subtotal > 0) ? S.inv.parsed.subtotal : invoiceSubtotalCalc(); }
  function freightTotal() { return totalsOf(S.freight.legs, legTotal); }
  function landedNow() { return RH.computeLanded(S.items, freightTotal(), S.method, S.inspected); }
  function disputes() {
    var units = 0, money = 0;
    S.items.forEach(function (it) {
      var u = num(it.qty_missing) + num(it.qty_damaged); units += u;
      money += u * it.unit_cost * (1 + it.iva_rate);
    });
    return { units: units, money: money };
  }
  function payableNow() {
    if (S.payment === 'SIN_CARGO') return 0;
    var d = disputes();
    return Math.max(0, invoiceTotal() - (S.incident.action === 'NC' ? d.money : 0));
  }
  function recomputeMissing(it) {
    it.qty_ok = Math.max(0, num(it.qty_ok)); it.qty_damaged = Math.max(0, num(it.qty_damaged));
    it.qty_missing = Math.max(0, RH.r4(it.qty_invoiced - it.qty_ok - it.qty_damaged));
  }

  /* ═════════════════════════════════ PASO 1 ═════════════════════════════════ */
  function step1() {
    var supOpts = '<option value="">— Selecciona proveedor —</option>' + LISTS.suppliers.map(function (s) {
      return '<option value="' + esc(s.id) + '"' + (S.supplier && S.supplier.id === s.id ? ' selected' : '') + '>' + esc(s.name) + (s.rfc ? ' · ' + esc(s.rfc) : '') + '</option>';
    }).join('') + '<option value="__new__"' + (S.supplier && !S.supplier.id ? ' selected' : '') + '>➕ Proveedor / origen nuevo…</option>';
    var whOpts = '<option value="">— Selecciona bodega —</option>' + LISTS.warehouses.map(function (w) {
      return '<option value="' + esc(w.id) + '"' + (S.warehouse_id === w.id ? ' selected' : '') + '>' + esc(w.name) + '</option>';
    }).join('');
    var newSup = (S.supplier && !S.supplier.id)
      ? '<div class="rh-grid c2" style="margin-top:8px;"><div class="rh-field"><label>Nombre del proveedor / origen *</label><input class="rh-input" data-rhin="s1-supname" value="' + esc(S.supplier.name) + '" placeholder="Razón social o sucursal de origen"></div>' +
        '<div class="rh-field"><label>RFC</label><input class="rh-input rh-mono" data-rhin="s1-suprfc" value="' + esc(S.supplier.rfc || '') + '" style="text-transform:uppercase;"></div></div>' +
        '<div class="rh-alert info">Se dará de alta automáticamente en el catálogo de Proveedores al confirmar la recepción.</div>' : '';

    var ocBlock = '';
    if (S.origin === 'OC') {
      ocBlock = '<div class="rh-card"><h4>🧾 Vinculación con Orden de Compra (OC)</h4><div class="rh-grid c2">' +
        '<div class="rh-field"><label>OC abierta del proveedor</label><select class="rh-select" data-rhch="s1-oc"><option value="">— Elegir OC —</option>' +
        S.poList.map(function (o) { return '<option value="' + esc(o.id) + '"' + (S.po && S.po.id === o.id ? ' selected' : '') + '>' + esc(o.folio) + ' — ' + RH.mxn(o.total) + ' (' + esc(o.status) + ')</option>'; }).join('') + '</select>' +
        (S.supplier && !S.poList.length ? '<div class="rh-muted" style="margin-top:3px;">Este proveedor no tiene OC abiertas.</div>' : '') + '</div>' +
        '<div class="rh-field"><label>O escanea / escribe el folio de la OC</label><input class="rh-input rh-mono" data-rhkd="s1-ocfolio" data-rhin="s1-ocfolio-in" id="rh-ocfolio" placeholder="Ej. OC-2026-000145 + Enter" value="' + esc(S.poFolioManual) + '" style="text-transform:uppercase;"></div></div>' +
        (S.po ? '<div class="rh-alert ok">✅ <b>' + esc(S.po.folio) + '</b> vinculada · ' + S.po.items.length + ' partida(s) esperada(s)' + (S.po.notes ? ' · ' + esc(S.po.notes) : '') +
          (S.supplier && S.supplier.credit_days ? ' · Crédito ' + S.supplier.credit_days + ' días' : '') + '</div>' : '') +
        (!S.po && S.poFolioManual ? '<div class="rh-alert warn">Folio «' + esc(S.poFolioManual) + '» no encontrado entre las OC abiertas: se guardará solo como referencia.</div>' : '') + '</div>';
    }

    var pays = [['CREDITO', '💳 A Crédito (Enviar a Cuentas x Pagar)'], ['CONTADO', '💵 Pagada de Contado (Caja)'], ['TRANSFERENCIA', '🏦 Pagada por Transferencia (Bancos)']];
    if (isSinCargoOrigin(S.origin)) pays.push(['SIN_CARGO', '🎁 Sin cargo / sin factura a pagar']);
    var payHtml = '<div class="rh-grid c2" style="margin-top:8px;">' + pays.map(function (p) {
      return '<div class="rh-choice' + (S.payment === p[0] ? ' sel' : '') + '" data-rh="s1-pay" data-v="' + p[0] + '">' + p[1] + '</div>';
    }).join('') + '</div>';

    var P = S.inv.parsed;
    var summary = P
      ? '<div class="rh-alert ok" style="line-height:1.55;">✅ <b>CFDI ' + esc(P.version || '') + ' leído:</b> ' + esc(P.emisor.nombre) + ' <span class="rh-mono">(' + esc(P.emisor.rfc) + ')</span><br>' +
        'Folio <b>' + esc((P.serie || '') + (P.folio || '—')) + '</b> · UUID <span class="rh-mono">' + esc(P.uuid || 'sin timbre') + '</span> · ' + esc(P.fecha) + '<br>' +
        'Pago: <b>' + esc(P.metodoPago || '—') + '</b> (' + (P.metodoPago === 'PPD' ? 'crédito' : 'contado') + ') · Forma ' + esc(P.formaPago || '—') +
        ' · SubTotal ' + RH.mxn(P.subtotal) + ' · IVA ' + RH.mxn(P.totalTraslados) + ' · <b>Total ' + RH.mxn(P.total) + '</b> · ' + P.concepts.length + ' concepto(s)</div>' +
        P.warnings.map(function (w) { return '<div class="rh-alert warn">⚠️ ' + esc(w) + '</div>'; }).join('') +
        (S.inv.duplicate ? '<div class="rh-alert bad">🚫 Esta factura (UUID) ya fue recibida en otro expediente. No se puede capturar dos veces.</div>' : '') +
        (S.supplier && !S.supplier.id ? '<div class="rh-alert info">El emisor (RFC ' + esc(P.emisor.rfc) + ') no está en tu catálogo de proveedores: se dará de alta al confirmar.</div>' : '') : '';

    function chips(list, kind) {
      return list.map(function (f, i) { return '<span class="rh-file-chip">📎 ' + esc(f.filename) + ' <button type="button" data-rh="s1-rmfile" data-k="' + kind + '" data-i="' + i + '" title="Quitar">✕</button></span>'; }).join('');
    }
    var invChips = (S.inv.xmlName ? '<span class="rh-file-chip">🧾 ' + esc(S.inv.xmlName) + ' <button type="button" data-rh="s1-rmfile" data-k="xml" data-i="0">✕</button></span>' : '') +
      (S.inv.pdf ? '<span class="rh-file-chip">📕 ' + esc(S.inv.pdf.filename) + ' <button type="button" data-rh="s1-rmfile" data-k="pdf" data-i="0">✕</button></span>' : '');

    return '<div class="rh-card"><h4>1️⃣ ¿Qué estás recibiendo?</h4><div class="rh-grid c3">' + ORIGINS.map(function (o) {
        return '<div class="rh-choice' + (S.origin === o[0] ? ' sel' : '') + '" data-rh="s1-origin" data-v="' + o[0] + '"><div>' + o[1] + '<small>' + o[2] + '</small></div></div>';
      }).join('') + '</div></div>' +
      '<div class="rh-card"><h4>🏭 Proveedor y bodega de destino</h4><div class="rh-grid c2">' +
      '<div class="rh-field"><label>' + (S.origin === 'TRASPASO' ? 'Sucursal / origen que envía *' : 'Proveedor *') + '</label><select class="rh-select" data-rhch="s1-supplier">' + supOpts + '</select></div>' +
      '<div class="rh-field"><label>Bodega de destino *</label><select class="rh-select" data-rhch="s1-wh">' + whOpts + '</select></div></div>' + newSup + '</div>' +
      ocBlock +
      '<div class="rh-card"><h4>🗄️ Bóveda de archivos de la recepción</h4><div class="rh-grid c2">' +
      '<div><div class="rh-drop" data-rh="s1-pick" data-t="inv" data-rh-drop="inv"><div class="big">🧾</div><b>Factura de Mercancía</b><p>Arrastra aquí el <b>.XML (CFDI 4.0)</b> y el <b>.PDF</b> opcional, o haz clic para elegir</p></div>' +
      '<div style="margin-top:8px;"><button type="button" class="rh-btn sm" data-rh="s1-demo">🧪 Cargar XML de Demostración (Proveedor Ferretero)</button></div>' +
      '<div style="margin-top:6px;">' + invChips + '</div></div>' +
      '<div><div class="rh-grid c2"><div class="rh-drop" data-rh="s1-pick" data-t="carta" data-rh-drop="carta"><div class="big">📄</div><b>Carta Porte</b><p>Opcional</p></div>' +
      '<div class="rh-drop" data-rh="s1-pick" data-t="packing" data-rh-drop="packing"><div class="big">📋</div><b>Packing List / Remisión</b><p>Opcional</p></div></div>' +
      '<div style="margin-top:6px;">' + chips(S.cartaPorte, 'carta') + chips(S.packing, 'packing') + '</div></div></div>' +
      '<input type="file" id="rh-f-inv" accept=".xml,.pdf,text/xml,application/pdf" multiple style="display:none" data-rhch="s1-files-inv">' +
      '<input type="file" id="rh-f-carta" accept=".pdf,.xml,image/*" multiple style="display:none" data-rhch="s1-files-carta">' +
      '<input type="file" id="rh-f-packing" accept=".pdf,.xml,image/*" multiple style="display:none" data-rhch="s1-files-packing">' +
      summary +
      '<div style="margin-top:10px;"><label class="rh-muted" style="font-weight:800;text-transform:uppercase;">Condición de pago de la factura</label>' + payHtml + '</div></div>';
  }

  RH.actions['s1-origin'] = function (el) {
    S.origin = el.getAttribute('data-v');
    S.payment = isSinCargoOrigin(S.origin) ? 'SIN_CARGO' : (S.inv.parsed ? RH.paymentFromCfdi(S.inv.parsed) : (S.payment === 'SIN_CARGO' ? 'CREDITO' : S.payment));
    if (S.origin !== 'OC') { S.po = null; S.poList = []; S.poFolioManual = ''; }
    else if (S.supplier && S.supplier.id) loadOcs();
    render();
  };
  RH.actions['s1-pay'] = function (el) { S.payment = el.getAttribute('data-v'); render(); };
  RH.changes['s1-supplier'] = async function (el) {
    var v = el.value;
    if (v === '__new__') S.supplier = { id: null, name: '', rfc: '', isNew: true };
    else if (!v) S.supplier = null;
    else S.supplier = LISTS.suppliers.filter(function (s) { return s.id === v; })[0] || null;
    S.po = null; S.poList = [];
    if (S.supplier && S.supplier.id && S.origin === 'OC') await loadOcs();
    if (S.inv.parsed) S.items.forEach(matchLine);
    render();
  };
  RH.changes['s1-wh'] = function (el) { S.warehouse_id = el.value; };
  RH.inputs['s1-supname'] = function (el) { if (S.supplier) S.supplier.name = el.value; };
  RH.inputs['s1-suprfc'] = function (el) { el.value = el.value.toUpperCase(); if (S.supplier) S.supplier.rfc = el.value; };
  RH.inputs['s1-ocfolio-in'] = function (el) { el.value = el.value.toUpperCase(); S.poFolioManual = el.value; };

  async function loadOcs() {
    try {
      var l = await RH.api('/api/purchase-orders?supplier_id=' + encodeURIComponent(S.supplier.id) + '&limit=100');
      S.poList = (l || []).filter(function (o) { return o.status === 'SENT' || o.status === 'PARTIAL'; });
    } catch (e) { S.poList = []; }
  }
  async function pickOc(id) {
    try {
      var oc = await RH.api('/api/purchase-orders/' + encodeURIComponent(id));
      S.po = { id: oc.id, folio: oc.folio, notes: oc.notes || '', supplier_id: oc.supplier_id, items: (oc.items || []).filter(function (x) { return x.status !== 'RECEIVED'; }) };
      S.poFolioManual = oc.folio;
      var sup = LISTS.suppliers.filter(function (s) { return s.id === oc.supplier_id; })[0];
      if (sup && (!S.supplier || S.supplier.id !== sup.id)) S.supplier = sup;
      if (!S.inv.parsed) {
        S.items = S.po.items.map(function (x, i) {
          var it = makeLine({ line_no: i + 1, code: x.sku, description: x.description || x.sku, qty: num(x.quantity_ordered) - num(x.quantity_received), unit_cost: num(x.unit_cost), iva_rate: 0.16 }, i);
          it.poi_id = x.id; it.oc_qty = it.qty_invoiced; return it;
        });
        S.items.forEach(matchLine);
      } else attachOcExpected();
      RH.toast('OC ' + oc.folio + ' vinculada: se precargaron proveedor y partidas esperadas.', 'ok');
    } catch (e) { RH.toast('No se pudo cargar la OC: ' + e.message, 'bad'); }
    render();
  }
  RH.changes['s1-oc'] = function (el) { if (el.value) pickOc(el.value); else { S.po = null; render(); } };
  RH.keys['s1-ocfolio'] = async function (el, e) {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    var f = String(el.value || '').trim().toUpperCase(); if (!f) return;
    try {
      var all = await RH.api('/api/purchase-orders?limit=300');
      var oc = (all || []).filter(function (o) { return String(o.folio).toUpperCase() === f; })[0];
      if (oc) await pickOc(oc.id); else { S.poFolioManual = f; S.po = null; RH.toast('OC «' + f + '» no encontrada; se usará como referencia.', 'warn'); render(); }
    } catch (err) { RH.toast(err.message, 'bad'); }
  };

  /* ── Bóveda: XML / PDF / documentos ── */
  RH.actions['s1-pick'] = function (el) { var t = el.getAttribute('data-t'); var f = $('rh-f-' + t); if (f) { f.value = ''; f.click(); } };
  RH.changes['s1-files-inv'] = function (el) { ingestInvoiceFiles(el.files); };
  RH.changes['s1-files-carta'] = function (el) { ingestDocs(el.files, 'carta'); };
  RH.changes['s1-files-packing'] = function (el) { ingestDocs(el.files, 'packing'); };
  RH.actions['drop:inv'] = function (z, files) { ingestInvoiceFiles(files); };
  RH.actions['drop:carta'] = function (z, files) { ingestDocs(files, 'carta'); };
  RH.actions['drop:packing'] = function (z, files) { ingestDocs(files, 'packing'); };
  RH.actions['s1-demo'] = function () { loadXmlText(RH.buildDemoXml(), 'FACTURA-DEMO-FERRETERO.xml'); };
  RH.actions['s1-rmfile'] = function (el) {
    var k = el.getAttribute('data-k'), i = num(el.getAttribute('data-i'));
    if (k === 'xml') { S.inv.xmlText = ''; S.inv.xmlName = ''; S.inv.parsed = null; S.inv.duplicate = false; S.items = []; }
    else if (k === 'pdf') S.inv.pdf = null;
    else if (k === 'carta') S.cartaPorte.splice(i, 1);
    else if (k === 'packing') S.packing.splice(i, 1);
    render();
  };

  async function ingestInvoiceFiles(files) {
    for (var i = 0; i < files.length; i++) {
      var f = files[i], name = f.name || '';
      try {
        if (/\.xml$/i.test(name) || /xml/i.test(f.type)) await loadXmlText(await RH.readText(f), name, true);
        else if (/\.pdf$/i.test(name) || /pdf/i.test(f.type)) {
          var du = await RH.readDataUrl(f);
          S.inv.pdf = { filename: name, mime: 'application/pdf', b64: RH.stripDataUrl(du) };
        } else RH.toast('«' + name + '» no es XML ni PDF.', 'warn');
      } catch (e) { msg('No se pudo leer «' + esc(name) + '»: ' + esc(e.message), 'bad'); }
    }
    render();
  }
  async function ingestDocs(files, kind) {
    for (var i = 0; i < files.length; i++) {
      var f = files[i];
      try {
        var du = await RH.readDataUrl(f);
        (kind === 'carta' ? S.cartaPorte : S.packing).push({ filename: f.name, mime: f.type || 'application/octet-stream', b64: RH.stripDataUrl(du) });
      } catch (e) { RH.toast(e.message, 'bad'); }
    }
    render();
  }
  async function loadXmlText(text, name, skipRender) {
    var parsed;
    try { parsed = RH.parseCfdi(text); }
    catch (e) { msg('🚫 ' + esc(e.message), 'bad'); RH.toast(e.message, 'bad'); return; }
    S.inv.xmlText = text; S.inv.xmlName = name; S.inv.parsed = parsed;
    S.inv.duplicate = !!(parsed.uuid && (RH.rows || []).some(function (r) { return String(r.invoice_uuid || '').toUpperCase() === parsed.uuid; }));
    var em = parsed.emisor, sup = null;
    if (S.origin !== 'TRASPASO') {
      sup = LISTS.suppliers.filter(function (s) { return em.rfc && String(s.rfc || '').toUpperCase() === em.rfc; })[0] ||
        LISTS.suppliers.filter(function (s) { return em.nombre && String(s.name || '').toUpperCase() === em.nombre.toUpperCase(); })[0] || null;
      S.supplier = sup || { id: null, name: em.nombre, rfc: em.rfc, isNew: true };
    }
    if (!isSinCargoOrigin(S.origin)) S.payment = RH.paymentFromCfdi(parsed);
    rebuildItemsFromCfdi();
    if (S.origin === 'OC' && S.supplier && S.supplier.id && !S.poList.length) await loadOcs();
    if (!skipRender) render();
  }

  /* ═════════════════════════════════ PASO 2 ═════════════════════════════════ */
  /* La precarga funciona con 1, 2 o los 3 códigos: Código del proveedor (XML), Código de barras (CÓDIGO *) y SKU interno.
     Todo lo que falte se completa solo; el margen sale de la escala PRECIO DE LISTA del catálogo y las demás escalas
     (CONTRATISTA, REVENTA, CRÉDITO…) se calculan con sus propios márgenes. */
  function mainMargin() { var sc = (S.scales || [])[0]; return sc ? num(sc.margen_trabajo) : 50; }
  function ensureSheet(it, i, L) {
    if (!it.sheet) {
      var rows = (L || landedNow()).rows, r = rows[i], cost = r ? r.landed : it.unit_cost, m = mainMargin();
      it.sheet = { barcode: '', sku: '', name: String(it.description || '').toUpperCase(), margin: m, cost: cost,
        price: RH.r2(cost * (1 + m / 100) * IVA), satKey: it.sat_key || '', anchor: 'margin' };
    }
    return it.sheet;
  }
  function deriveCodes(it) {
    var sh = it.sheet || {}, sc = String(it.supplier_code || '').trim().toUpperCase();
    var bc = String(sh.barcode || '').trim().toUpperCase(), sk = String(sh.sku || '').trim().toUpperCase();
    var sku = sk || bc || sc, barcode = bc || sku;
    return { sku: sku, barcode: barcode, alt: (sc && sc !== sku && sc !== barcode) ? sc : '', supplier: sc };
  }
  function codesText(c) {
    return 'SKU <b>' + esc(c.sku) + '</b> · CÓDIGO* <b>' + esc(c.barcode) + '</b>' + (c.alt ? ' · ALTERNO <b>' + esc(c.alt) + '</b>' : '') +
      ' · F4 «SKU en XML» <b>' + esc(c.supplier) + '</b>';
  }
  function precargaText(it, i, L) {
    var sh = ensureSheet(it, i, L);
    return 'Se dará de alta con: ' + codesText(deriveCodes(it)) + ' · margen <b>' + RH.r2(sh.margin) + '%</b> → <b>' + RH.mxn(sh.price) + '</b>';
  }
  function matchBadge(it) {
    var m = it.match;
    if (!m) return '<span class="rh-badge warn">🟡 Código del Proveedor Nuevo</span>';
    if (m.status === 'HOMOLOGADO') return '<span class="rh-badge ok">🟢 Homologado</span>' + (it.factor ? ' <span class="rh-badge info">×' + it.factor + '</span>' : '');
    if (m.status === 'LIGADO') return '<span class="rh-badge info">🔗 Ligado a existente</span>';
    return '<span class="rh-badge ok">⚡ Pre-alta creada</span>';
  }
  function syncSheetCosts(L) {
    S.items.forEach(function (it, i) {
      if (it.match || !it.sheet) return;
      var r = L.rows[i]; if (!r) return;
      var sh = it.sheet; sh.cost = r.landed;
      if (sh.anchor === 'price' && sh.cost > 0) sh.margin = RH.r2((sh.price / IVA / sh.cost - 1) * 100);
      else sh.price = RH.r2(sh.cost * (1 + sh.margin / 100) * IVA);
    });
  }
  function step2() {
    var L = landedNow(); syncSheetCosts(L);
    var hasOc = S.items.some(function (i) { return i.oc_qty != null; });
    var pend = S.items.filter(function (i) { return !i.match; }).length;
    var span = hasOc ? 10 : 9;
    var rows = S.items.map(function (it, i) {
      var dest;
      if (it.match) {
        dest = '<b class="rh-mono">' + esc(it.sku) + '</b><div class="rh-muted rh-mono">CB: ' + esc(it.barcode) + '</div><div class="rh-muted">' + esc(it.match.product.name || '') + '</div>';
      } else {
        dest = '<div style="display:flex;gap:6px;flex-wrap:wrap;"><button type="button" class="rh-btn sm" data-rh="s2-open" data-i="' + i + '" data-m="link">🔗 Ligar a Artículo YA Dado de Alta</button>' +
          '<button type="button" class="rh-btn sm primary" data-rh="s2-open" data-i="' + i + '" data-m="new">⚡ Hoja Precargada para Dar de Alta Producto Nuevo</button>' +
          '<button type="button" class="rh-btn sm" data-rh="s2-adv" data-i="' + i + '" title="Abre la pantalla completa de Alta de Producto; al guardar regresas a este paso">🧩 Alta de Producto Avanzada</button></div>' +
          '<div class="rh-muted" id="rh-pre-' + i + '" style="margin-top:5px;">' + precargaText(it, i, L) + '</div>';
      }
      var act = (it.match && it.match.status === 'LIGADO' ? '<button type="button" class="rh-btn sm" data-rh="s2-undo" data-i="' + i + '">↺ Cambiar</button> ' : '') +
        '<button type="button" class="rh-btn sm danger" data-rh="s2-del" data-i="' + i + '" title="Quitar esta partida de la recepción">🗑</button>';
      var oc = hasOc ? '<td class="rh-num">' + (it.oc_qty != null ? it.oc_qty + (it.oc_qty !== it.qty_invoiced ? ' <span class="rh-badge warn" title="Difiere de lo facturado">≠</span>' : '') : '—') + '</td>' : '';
      var main = '<tr id="rh-row-' + i + '"><td>' + it.line_no + '</td><td class="rh-mono"><b>' + esc(it.supplier_code || '—') + '</b></td><td style="min-width:230px;">' + esc(it.description) +
        (it.sat_key ? '<div class="rh-muted">SAT ' + esc(it.sat_key) + ' · ' + esc(it.sat_unit) + '</div>' : '') + '</td>' +
        '<td class="rh-num">' + it.qty_invoiced + '</td>' + oc + '<td class="rh-num">' + RH.mxn(it.unit_cost) + '</td><td>' + matchBadge(it) + '</td><td>' + dest + '</td><td style="white-space:nowrap;">' + act + '</td></tr>';
      var sub = '';
      if (!it.match && it.panel === 'link') sub = '<tr class="rh-subrow"><td colspan="' + span + '">' + linkPanel(it, i) + '</td></tr>';
      if (!it.match && it.panel === 'new') sub = '<tr class="rh-subrow"><td colspan="' + span + '">' + newSheet(it, i) + '</td></tr>';
      return main + sub;
    }).join('');
    var counts = { h: 0, l: 0, p: 0 };
    S.items.forEach(function (it) { if (it.match) { if (it.match.status === 'HOMOLOGADO') counts.h++; else if (it.match.status === 'LIGADO') counts.l++; else counts.p++; } });

    var manual = !S.inv.parsed
      ? '<div class="rh-card"><h4>➕ Agregar partida manual del catálogo</h4><div class="rh-grid c4"><div class="rh-field rh-ac" style="grid-column:span 2;"><label>Producto</label><input class="rh-input" id="rh-man-q" data-rhin="s2-man-q" placeholder="SKU, código de barras o nombre…" autocomplete="off"><div id="rh-man-list"></div></div>' +
        '<div class="rh-field"><label>Cantidad</label><input class="rh-input" id="rh-man-qty" type="number" min="0" step="0.01" value="1"></div><div class="rh-field"><label>Costo unitario sin IVA</label><input class="rh-input" id="rh-man-cost" type="number" min="0" step="0.01"></div></div></div>' : '';

    var ft = freightTotal();
    var frCard = '<div class="rh-card"><div style="display:flex;gap:10px;flex-wrap:wrap;align-items:center;justify-content:space-between;">' +
      '<div><b>🚛 Costo de fletes / traslados de esta compra</b><div class="rh-muted">Agrégalos aquí para que el alta de los productos nuevos ya incluya el flete en su costo. Puedes capturar 1, 2, 3 o más traslados.</div></div>' +
      '<div style="display:flex;gap:8px;align-items:center;"><span class="rh-badge info" id="rh-fr-total-2">' + freightText() + '</span>' +
      '<button type="button" class="rh-btn sm' + (S.freight.open2 ? '' : ' primary') + '" data-rh="s2-frtoggle">' + (S.freight.open2 ? 'Ocultar fletes' : (ft > 0 ? '✏️ Editar fletes' : '➕ Incluir costo de fletes')) + '</button></div></div>' +
      (S.freight.open2 ? '<div style="margin-top:10px;">' + legsEditor() + '</div>' : '') + '</div>';

    var bulk = '<div class="rh-card" id="rh-bulkbar" style="position:sticky;bottom:64px;z-index:5;border-color:' + (pend ? '#f59e0b' : '#22c55e') + ';box-shadow:0 -6px 18px rgba(15,23,42,.12);">' +
      (pend
        ? '<div style="display:flex;gap:10px;flex-wrap:wrap;align-items:center;justify-content:space-between;"><div><b>🟡 ' + pend + ' producto(s) pendiente(s) de alta</b>' +
          '<div class="rh-muted">Si los datos precargados son correctos, da de alta todos de una vez con su código del proveedor (o los códigos que capturaste), el margen de la escala <b>' +
          esc(((S.scales || [])[0] || {}).name || 'PRECIO DE LISTA') + ' (' + RH.r2(mainMargin()) + '%)</b> y sus demás escalas de precio.</div><div id="rh-bulk-msg" class="rh-muted"></div></div>' +
          '<div style="display:flex;gap:8px;flex-wrap:wrap;"><button type="button" class="rh-btn" data-rh="s2-nextpend">⏭ Ir al siguiente pendiente</button>' +
          '<button type="button" class="rh-btn success" id="rh-bulk-btn" data-rh="s2-bulk">✅ Confirmar alta de TODOS los productos (' + pend + ')</button></div></div>'
        : '<div style="display:flex;gap:10px;flex-wrap:wrap;align-items:center;justify-content:space-between;"><b style="color:#15803d;">✔ Todas las partidas están resueltas.</b>' +
          '<button type="button" class="rh-btn primary" data-rh="wz-next">Continuar al Paso 3: Flete y Landed Cost →</button></div>') + '</div>';

    return '<div class="rh-card" style="display:flex;gap:10px;flex-wrap:wrap;align-items:center;justify-content:space-between;">' +
      '<div><b>📑 Hoja Precargada de Homologación y Pre-Alta XML</b><div class="rh-muted">Cada artículo de la factura debe quedar ligado a un producto de CALEBSYS antes de afectar inventario.</div></div>' +
      '<div><span class="rh-badge ok">🟢 ' + counts.h + ' homologados</span> <span class="rh-badge info">🔗 ' + counts.l + ' ligados</span> <span class="rh-badge ok">⚡ ' + counts.p + ' pre-altas</span> ' +
      (pend ? '<span class="rh-badge warn">🟡 ' + pend + ' pendientes</span>' : '<span class="rh-badge ok">✔ Todo resuelto</span>') + '</div></div>' + frCard +
      (S.items.length ? '<div class="rh-table-wrap"><table class="rh-table"><thead><tr><th>#</th><th>Código en factura (XML)</th><th>Descripción</th><th class="rh-num">Cant.</th>' + (hasOc ? '<th class="rh-num">OC esperada</th>' : '') +
        '<th class="rh-num">Costo unit.</th><th>Estado</th><th>Destino en CALEBSYS</th><th></th></tr></thead><tbody>' + rows + '</tbody></table></div>'
        : '<div class="rh-alert warn">No hay partidas: carga el XML en el Paso 1' + (S.po ? '' : ', vincula una OC') + ' o agrega partidas manuales abajo.</div>') + manual + (S.items.length ? bulk : '');
  }
  function freightText() {
    var ft = freightTotal(), sub = invoiceSub();
    return RH.mxn(ft) + ' (' + (sub > 0 ? (ft / sub * 100).toFixed(2) : '0.00') + '% sobre factura)';
  }

  function linkPanel(it, i) {
    return '<div class="rh-card" style="margin:0;"><h4>🔗 Ligar «' + esc(it.supplier_code) + '» a un artículo ya dado de alta</h4>' +
      '<div class="rh-ac"><input class="rh-input" style="width:100%;" id="rh-link-q-' + i + '" data-rhin="s2-link-q" data-i="' + i + '" placeholder="Buscar por SKU, código de barras, código alterno o nombre…" autocomplete="off" value="' + esc(it.linkQ || '') + '">' +
      '<div id="rh-link-list-' + i + '"></div></div>' +
      '<div class="rh-muted" style="margin-top:6px;">Al confirmar la recepción, <b>' + esc(it.supplier_code) + '</b> se guardará en <b>Complementos [F4] → Proveedores (SKU en XML)</b> y en <b>Código Alterno</b>; las próximas facturas se reconocerán solas.</div>' +
      '<div style="margin-top:8px;"><button type="button" class="rh-btn sm" data-rh="s2-close" data-i="' + i + '">Cancelar</button></div></div>';
  }
  function linkResults(q, i) {
    q = String(q || '').trim().toUpperCase();
    var box = $('rh-link-list-' + i); if (!box) return;
    if (q.length < 1) { box.innerHTML = ''; return; }
    var res = RH.catalog.filter(function (p) {
      return [p.sku, p.barcode, RH.pAlt(p), p.name, p.description].some(function (v) { return String(v || '').toUpperCase().indexOf(q) > -1; });
    }).slice(0, 8);
    box.innerHTML = res.length ? '<div class="rh-ac-list">' + res.map(function (p) {
      return '<div class="rh-ac-item" data-rh="s2-link-pick" data-i="' + i + '" data-sku="' + esc(p.sku) + '"><span><b>' + esc(p.sku) + '</b> — ' + esc(p.name || p.description) + '</span><span class="rh-muted">Stock ' + num(p.stock) + '</span></div>';
    }).join('') + '</div>' : '<div class="rh-ac-list"><div class="rh-ac-item">Sin coincidencias</div></div>';
  }
  RH.inputs['s2-link-q'] = function (el) { var i = num(el.getAttribute('data-i')); S.items[i].linkQ = el.value; linkResults(el.value, i); };
  RH.actions['s2-link-pick'] = function (el) {
    var i = num(el.getAttribute('data-i')), p = findProduct(el.getAttribute('data-sku')); if (!p) return;
    var it = S.items[i];
    applyMatch(it, p, 'LIGADO', 'MANUAL'); it.panel = '';
    RH.toast('«' + it.supplier_code + '» ligado a ' + p.sku + '. Se guardará en Complementos [F4] al confirmar.', 'ok');
    render();
    openNextPending(true, i);
  };
  RH.actions['s2-undo'] = function (el) { var it = S.items[num(el.getAttribute('data-i'))]; it.match = null; it.sku = ''; it.barcode = ''; it.panel = ''; render(); };
  RH.actions['s2-del'] = function (el) {
    var i = num(el.getAttribute('data-i')), it = S.items[i];
    if (!global.confirm('¿Quitar la partida «' + (it.supplier_code || it.description) + '» de esta recepción? (No se dará de alta ni entrará a inventario.)')) return;
    S.items.splice(i, 1); render();
  };
  RH.actions['s2-open'] = function (el) {
    var i = num(el.getAttribute('data-i')), it = S.items[i];
    it.panel = el.getAttribute('data-m');
    if (it.panel === 'new') ensureSheet(it, i);
    render();
    var f = $(it.panel === 'new' ? 'rh-sh-barcode-' + i : 'rh-link-q-' + i); if (f) f.focus();
  };
  RH.actions['s2-close'] = function (el) { S.items[num(el.getAttribute('data-i'))].panel = ''; render(); };
  RH.actions['s2-frtoggle'] = function () { S.freight.open2 = !S.freight.open2; render(); };

  function newSheet(it, i) {
    var sh = ensureSheet(it, i), r = landedNow().rows[i] || { fpu: 0, landed: sh.cost };
    return '<div class="rh-card" style="margin:0;"><h4>⚡ Hoja precargada — Alta de producto nuevo desde la factura</h4>' +
      '<div class="rh-alert info" style="margin-top:0;">Puedes capturar <b>uno, dos o los tres códigos</b>. Si dejas vacíos el código de barras y el SKU, se usa el código del proveedor; si capturas solo uno, ese sirve para ambos.</div>' +
      '<div class="rh-grid c3">' +
      '<div class="rh-field"><label>Código Proveedor (XML)</label><input class="rh-input rh-mono" readonly value="' + esc(it.supplier_code) + '" style="background:#e2e8f0;"><div class="rh-muted">Se guarda en Complementos [F4] → SKU en XML (y en Código Alterno si es distinto)</div></div>' +
      '<div class="rh-field"><label>Código de Barras para Venta (CÓDIGO *) — opcional</label><div style="display:flex;gap:6px;"><input class="rh-input rh-mono" id="rh-sh-barcode-' + i + '" data-rhin="s2-sh" data-i="' + i + '" data-f="barcode" placeholder="Escanea el código de la pieza física" value="' + esc(sh.barcode) + '" style="flex:1;text-transform:uppercase;">' +
      '<button type="button" class="rh-btn sm" data-rh="s2-gen" data-i="' + i + '">🎲 Generar</button></div></div>' +
      '<div class="rh-field"><label>SKU Interno CALEBSYS (SKU *) — opcional</label><input class="rh-input rh-mono" id="rh-sh-sku-' + i + '" data-rhin="s2-sh" data-i="' + i + '" data-f="sku" value="' + esc(sh.sku) + '" style="text-transform:uppercase;">' +
      '<div style="margin-top:4px;display:flex;gap:5px;flex-wrap:wrap;"><button type="button" class="rh-btn sm" data-rh="s2-sku" data-i="' + i + '" data-m="barcode">Usar Código de Barras</button><button type="button" class="rh-btn sm" data-rh="s2-sku" data-i="' + i + '" data-m="supplier">Usar Cód. Proveedor</button></div></div>' +
      '</div><div class="rh-muted" id="rh-sh-res-' + i + '" style="margin:6px 0 2px;">Se registrará como: ' + codesText(deriveCodes(it)) + '</div>' +
      '<div class="rh-grid c4" style="margin-top:8px;">' +
      '<div class="rh-field" style="grid-column:span 2;"><label>Nombre Comercial en POS</label><input class="rh-input" data-rhin="s2-sh" data-i="' + i + '" data-f="name" value="' + esc(sh.name) + '" style="text-transform:uppercase;"></div>' +
      '<div class="rh-field"><label>Clave SAT</label><input class="rh-input rh-mono" data-rhin="s2-sh" data-i="' + i + '" data-f="satKey" value="' + esc(sh.satKey) + '"><div class="rh-muted">Unidad SAT: ' + esc(it.sat_unit) + ' (' + esc(UNIT_MAP[it.sat_unit] || 'PIEZA') + ')</div></div>' +
      '<div class="rh-field"><label>Costo XML + Flete prorrateado</label><input class="rh-input rh-mono" readonly id="rh-sh-cost-' + i + '" value="' + RH.mxn(sh.cost) + '" style="background:#e2e8f0;"><div class="rh-muted" id="rh-sh-fpu-' + i + '">XML ' + RH.mxn(it.unit_cost) + ' + flete ' + RH.mxn(r.fpu) + '</div></div>' +
      '<div class="rh-field"><label>% Margen de Utilidad (escala principal)</label><input class="rh-input" type="number" step="0.01" id="rh-sh-margin-' + i + '" data-rhin="s2-sh" data-i="' + i + '" data-f="margin" value="' + RH.r2(sh.margin) + '"></div>' +
      '<div class="rh-field"><label>Precio Final de Venta ($ c/IVA)</label><input class="rh-input" type="number" step="0.01" id="rh-sh-price-' + i + '" data-rhin="s2-sh" data-i="' + i + '" data-f="price" value="' + sh.price + '"></div>' +
      '<div class="rh-field" style="grid-column:span 2;"><label>Escalas de precio ligadas al catálogo</label><div id="rh-sh-scales-' + i + '">' + scalesPreview(it) + '</div></div></div>' +
      '<div style="margin-top:10px;display:flex;gap:8px;flex-wrap:wrap;"><button type="button" class="rh-btn success" data-rh="s2-new-ok" data-i="' + i + '">✅ Confirmar Alta del Producto</button>' +
      '<button type="button" class="rh-btn" data-rh="s2-adv" data-i="' + i + '">🧩 Alta de Producto Avanzada</button><button type="button" class="rh-btn" data-rh="s2-close" data-i="' + i + '">Cancelar</button></div></div>';
  }
  function scalesPreview(it) {
    var sh = it.sheet, scs = S.scales || [];
    if (!scs.length) return '<span class="rh-muted">Sin escalas configuradas.</span>';
    return '<table class="rh-table" style="font-size:11.5px;"><thead><tr><th>Escala</th><th class="rh-num">% margen</th><th class="rh-num">Precio c/IVA</th></tr></thead><tbody>' + scs.map(function (s, k) {
      var m = k === 0 ? sh.margin : num(s.margen_trabajo), p = k === 0 ? sh.price : RH.r2(sh.cost * (1 + m / 100) * IVA);
      return '<tr><td>' + esc(s.name) + (k === 0 ? ' <span class="rh-badge info">principal</span>' : '') + '</td><td class="rh-num">' + RH.r2(m) + '%</td><td class="rh-num"><b>' + RH.mxn(p) + '</b></td></tr>';
    }).join('') + '</tbody></table>';
  }
  function sheetChanged(i) {
    var it = S.items[i]; if (!it || !it.sheet) return;
    var r = $('rh-sh-res-' + i); if (r) r.innerHTML = 'Se registrará como: ' + codesText(deriveCodes(it));
    var sc = $('rh-sh-scales-' + i); if (sc) sc.innerHTML = scalesPreview(it);
    var pre = $('rh-pre-' + i); if (pre) pre.innerHTML = precargaText(it, i);
  }
  RH.inputs['s2-sh'] = function (el) {
    var i = num(el.getAttribute('data-i')), f = el.getAttribute('data-f'), it = S.items[i], sh = it.sheet;
    if (f === 'barcode' || f === 'sku') { el.value = el.value.toUpperCase(); sh[f] = el.value; }
    else if (f === 'name') { el.value = el.value.toUpperCase(); sh.name = el.value; }
    else if (f === 'satKey') sh.satKey = el.value;
    else if (f === 'margin') { sh.anchor = 'margin'; sh.margin = num(el.value); sh.price = RH.r2(sh.cost * (1 + sh.margin / 100) * IVA); $('rh-sh-price-' + i).value = sh.price; }
    else if (f === 'price') { sh.anchor = 'price'; sh.price = num(el.value); sh.margin = sh.cost > 0 ? RH.r2((sh.price / IVA / sh.cost - 1) * 100) : 0; $('rh-sh-margin-' + i).value = sh.margin; }
    sheetChanged(i);
  };
  RH.actions['s2-gen'] = function (el) {
    var i = num(el.getAttribute('data-i')), sh = S.items[i].sheet, code, tries = 0;
    do {
      var d = '750' + String(Math.floor(Math.random() * 1e9)).padStart(9, '0');
      var sum = 0; for (var k = 0; k < 12; k++) sum += num(d[k]) * (k % 2 ? 3 : 1);
      code = d + ((10 - (sum % 10)) % 10);
    } while (productByCode(code) && ++tries < 20);
    sh.barcode = code; $('rh-sh-barcode-' + i).value = code; sheetChanged(i);
  };
  RH.actions['s2-sku'] = function (el) {
    var i = num(el.getAttribute('data-i')), it = S.items[i], sh = it.sheet, m = el.getAttribute('data-m');
    var v = m === 'barcode' ? sh.barcode : it.supplier_code;
    if (!v) { RH.toast(m === 'barcode' ? 'Primero escanea o genera el código de barras.' : 'No hay código de proveedor.', 'warn'); return; }
    sh.sku = String(v).toUpperCase(); $('rh-sh-sku-' + i).value = sh.sku; sheetChanged(i);
  };

  /** Actualiza costo/precio de las hojas abiertas y de las precargas cuando cambia el flete. */
  function refreshSheets() {
    if (S.step !== 2) return;
    var L = landedNow();
    S.items.forEach(function (it, i) {
      if (it.match || !it.sheet) return;
      var sh = it.sheet, r = L.rows[i]; if (!r) return;
      sh.cost = r.landed;
      if (sh.anchor === 'price' && sh.cost > 0) sh.margin = RH.r2((sh.price / IVA / sh.cost - 1) * 100);
      else sh.price = RH.r2(sh.cost * (1 + sh.margin / 100) * IVA);
      var c = $('rh-sh-cost-' + i); if (c) c.value = RH.mxn(sh.cost);
      var f = $('rh-sh-fpu-' + i); if (f) f.textContent = 'XML ' + RH.mxn(it.unit_cost) + ' + flete ' + RH.mxn(r.fpu);
      var p = $('rh-sh-price-' + i); if (p) p.value = sh.price;
      var m = $('rh-sh-margin-' + i); if (m) m.value = RH.r2(sh.margin);
      sheetChanged(i);
    });
  }

  /** Alta real del producto en el catálogo a partir de la hoja precargada (la usan el botón individual y el masivo). */
  async function createFromSheet(it, i, L) {
    // Si el catálogo ya conoce este código del proveedor (p. ej. la misma clave repetida en la factura), se liga en vez de duplicar
    matchLine(it);
    if (it.match) { it.panel = ''; return { ok: true, sku: it.sku, linked: true }; }
    var sh = ensureSheet(it, i, L), c = deriveCodes(it);
    var name = String(sh.name || it.description || '').trim().toUpperCase();
    if (!c.sku) return { ok: false, error: 'Sin código: la partida no trae código de proveedor.' };
    if (!name) return { ok: false, error: 'Captura el Nombre Comercial en POS.' };
    if (!(sh.price > 0)) return { ok: false, error: 'Captura el Precio Final de Venta.' };
    var dupSku = productByCode(c.sku), dupBc = c.barcode !== c.sku ? productByCode(c.barcode) : null;
    if (dupSku) return { ok: false, error: 'El SKU «' + c.sku + '» ya existe en el catálogo (' + dupSku.p.sku + '). Usa «Ligar a Artículo YA Dado de Alta».', dup: dupSku.p };
    if (dupBc) return { ok: false, error: 'El código de barras «' + c.barcode + '» ya pertenece a ' + dupBc.p.sku + '. Usa «Ligar a Artículo YA Dado de Alta».', dup: dupBc.p };
    var cost = sh.cost, unit = UNIT_MAP[it.sat_unit] || 'PIEZA';
    var supName = (S.supplier && S.supplier.name || '').toUpperCase(), supRfc = (S.supplier && S.supplier.rfc || '').toUpperCase();
    var margNet = cost > 0 ? RH.r4((sh.price / IVA / cost - 1) * 100) : 0;
    var r = (L || landedNow()).rows[i] || { fpu: 0 };
    var body = {
      sku: c.sku, barcode: c.barcode, sales_code: c.alt || null, name: name, description: name, price: sh.price, stock: 0, average_cost: RH.r4(cost),
      purchase_unit: unit, sale_unit: unit, conversion_factor: 1,
      meta_data: {
        familia: 'GENERAL', departamento: 'GENERAL', marca: 'GENÉRICO', sat_id: sh.satKey || '01010101', sat_unidad: it.sat_unit || 'H87',
        codigo_alterno: c.alt || undefined, costo_raw: RH.r2(it.unit_cost), costo_pieza: RH.r2(it.unit_cost), costo_con_flete: RH.r4(cost),
        flete_pct: it.unit_cost > 0 ? RH.r4(r.fpu / it.unit_cost * 100) : 0, flete_monto: RH.r4(r.fpu),
        costo_piso_iva: RH.r2(cost), margen: margNet, margen_final_pieza: margNet, precio_final_pieza: sh.price, precio_caja: sh.price,
        iva: 16, ieps: 0, is_active: true, activo: true, art_negativo: true, art_pesado: it.sat_unit === 'KGM', created_via: 'RECEPCION_360',
        complements_f4: { sku: c.sku, logistics: {}, suppliers: [{ provider_name: supName, name: supName, rfc: supRfc, xml_sku: it.supplier_code, cost: RH.r4(it.unit_cost),
          last_cost: RH.r4(it.unit_cost), currency: 'MXN', lead_days: 1, min_qty: 1, factor: 1, is_primary: true }], equivalents: [], documents: {} }
      }
    };
    try {
      var saved = await RH.api('/api/products', { method: 'POST', body: body });
      var prod = Object.assign({}, body, saved || {}, { meta_data: Object.assign({}, body.meta_data, (saved && saved.meta_data) || {}) });
      RH.catalog = RH.catalog.filter(function (p) { return p.sku !== c.sku; }); RH.catalog.push(prod);
      applyMatch(it, prod, 'PREALTA', 'ALTA'); it.panel = '';
      it.update_price = true; it.new_price = sh.price; it.margin_pct = margNet; it.prev_cost = 0;
      S.prealtas.push({ sku: c.sku, barcode: c.barcode, alt: c.alt, supplier_code: it.supplier_code, name: name, cost: RH.r4(cost), price: sh.price, margin: margNet });
      return { ok: true, sku: c.sku };
    } catch (e) { return { ok: false, error: e.message }; }
  }
  RH.actions['s2-new-ok'] = async function (el) {
    var i = num(el.getAttribute('data-i')), it = S.items[i];
    el.disabled = true;
    var r = await createFromSheet(it, i);
    if (!r.ok) { el.disabled = false; RH.toast(r.error, 'bad'); msg('⚠️ ' + esc(r.error), 'bad'); return; }
    RH.toast('Producto ' + r.sku + ' dado de alta y ligado a la recepción.', 'ok');
    render();
    openNextPending(true, i);
  };

  /** ✅ Confirmar alta de TODOS los productos pendientes con sus datos precargados. */
  RH.actions['s2-bulk'] = async function (el) {
    var idxs = []; S.items.forEach(function (it, i) { if (!it.match) idxs.push(i); });
    if (!idxs.length) return RH.toast('No hay productos pendientes de alta.', 'info');
    if (!global.confirm('Se darán de alta ' + idxs.length + ' producto(s) nuevo(s) con los datos precargados:\n\n• SKU / Código de barras: los que capturaste o, si no hay, el código del proveedor\n• Margen: ' +
      RH.r2(mainMargin()) + '% (escala ' + (((S.scales || [])[0] || {}).name || 'PRECIO DE LISTA') + ') y demás escalas del catálogo\n• Costo: XML + flete prorrateado\n\n¿Continuar?')) return;
    S.busy = true; el.disabled = true;
    var L = landedNow(), made = {}, errors = [], ok = 0;
    for (var k = 0; k < idxs.length; k++) {
      var i = idxs[k], it = S.items[i];
      var bm = $('rh-bulk-msg'); if (bm) bm.textContent = 'Dando de alta ' + (k + 1) + ' de ' + idxs.length + '… ' + (it.supplier_code || '');
      matchLine(it); if (it.match) { ok++; continue; }   // el catálogo ya lo reconoce (clave repetida en la factura)
      var codes = deriveCodes(it), twin = made[codes.sku];
      if (twin) { applyMatch(it, twin, 'HOMOLOGADO', 'SKU'); ok++; continue; }   // el mismo código repetido en la factura
      var r = await createFromSheet(it, i, L);
      if (r.ok) { ok++; made[codes.sku] = it.match.product; }
      else { errors.push({ i: i, line: it.line_no, code: it.supplier_code, error: r.error }); }
    }
    S.busy = false;
    if (errors.length) S.items[errors[0].i].panel = 'new';
    render();
    if (errors.length) {
      msg('✅ ' + ok + ' alta(s) correcta(s). 🚫 ' + errors.length + ' no se pudieron dar de alta (siguen pendientes):<ul style="margin:6px 0 0 18px;">' +
        errors.slice(0, 8).map(function (e) { return '<li>Partida ' + e.line + ' «' + esc(e.code) + '»: ' + esc(e.error) + '</li>'; }).join('') + (errors.length > 8 ? '<li>… y ' + (errors.length - 8) + ' más</li>' : '') + '</ul>', 'warn');
      RH.toast(ok + ' alta(s) correcta(s), ' + errors.length + ' con error.', 'warn');
      jumpTo(errors[0].i);
    } else {
      RH.toast('✅ ' + ok + ' producto(s) dado(s) de alta. Presiona Siguiente para continuar.', 'ok');
      msg('✅ ' + ok + ' producto(s) dados de alta con sus escalas de precio. Todo resuelto: continúa al Paso 3.', 'ok');
    }
  };

  function jumpTo(i) {
    var row = $('rh-row-' + i);
    if (row) { if (row.scrollIntoView) row.scrollIntoView({ block: 'center', behavior: 'smooth' }); row.classList.remove('rh-flash'); void row.offsetWidth; row.classList.add('rh-flash'); }
  }
  /** Salta al siguiente producto sin resolver (y abre su hoja precargada si openSheet). */
  function openNextPending(openSheet, fromIdx) {
    var idx = -1, n = S.items.length, start = (fromIdx == null ? -1 : fromIdx);
    for (var k = 1; k <= n; k++) { var j = (start + k + n) % n; if (!S.items[j].match) { idx = j; break; } }
    if (idx < 0) { jumpToBulk(); return false; }
    if (openSheet) { S.items[idx].panel = 'new'; ensureSheet(S.items[idx], idx); render(); var f = $('rh-sh-barcode-' + idx); if (f) f.focus(); }
    jumpTo(idx);
    return true;
  }
  function jumpToBulk() { var b = $('rh-bulkbar'); if (b && b.scrollIntoView) b.scrollIntoView({ block: 'nearest' }); }
  RH.actions['s2-nextpend'] = function () { if (!openNextPending(false)) RH.toast('No hay pendientes.', 'info'); };

  /** 🧩 Alta de Producto Avanzada: abre #producto-alta completa; al guardar se regresa a este mismo paso. */
  RH.actions['s2-adv'] = function (el) {
    var i = num(el.getAttribute('data-i')), it = S.items[i], sh = ensureSheet(it, i), c = deriveCodes(it);
    var r = landedNow().rows[i] || { fpu: 0 };
    global._rhWizardReturn = { lineNo: it.line_no, supplier_code: it.supplier_code, savedSku: null };
    global._rhAltaPrefill = {
      sku: c.sku, barcode: c.barcode, sales_code: c.alt, name: sh.name, sat_id: sh.satKey, sat_unidad: it.sat_unit, unidad: UNIT_MAP[it.sat_unit] || 'PIEZA',
      costo: it.unit_cost, flete_pct: it.unit_cost > 0 ? RH.r4(r.fpu / it.unit_cost * 100) : 0, margen: RH.r2(sh.margin),
      supplier_code: it.supplier_code, supplier_name: S.supplier && S.supplier.name, supplier_rfc: S.supplier && S.supplier.rfc, xml_cost: it.unit_cost
    };
    // misma preparación que «Nuevo Producto [INS]»: alta limpia, sin arrastrar el producto anterior
    global._isEditingExistingProduct = false; global._productoAltaEdit = null; global._paEditRequest = null; global._paLoadedExistingProduct = null;
    global._paProductPriceScales = null; global._paProductBranchScales = null; global._paProductOffers = [];
    try { sessionStorage.removeItem('calebsys_edit_product_sku'); } catch (e) {}
    var ov = $('rh-wizard'); if (ov) { ov.classList.remove('open'); ov.setAttribute('aria-hidden', 'true'); }   // el estado S se conserva
    if (typeof global.navigateTo === 'function') global.navigateTo('producto-alta'); else global.location.hash = '#producto-alta';
  };
  /** Al regresar de #producto-alta: reabre el asistente en el Paso 2, liga el producto guardado y sigue con el siguiente. */
  RH.wizardResume = async function () {
    var ret = global._rhWizardReturn; global._rhWizardReturn = null; global._rhAltaPrefill = null;
    if (!ret) return;
    if (!S) { RH.toast('El asistente ya no estaba abierto: inicia la recepción de nuevo.', 'warn'); return; }
    var ov = $('rh-wizard'); if (ov) { ov.classList.add('open'); ov.setAttribute('aria-hidden', 'false'); }
    try { await RH.loadCatalog(true); } catch (e) {}
    var it = S.items.filter(function (x) { return x.line_no === ret.lineNo && x.supplier_code === ret.supplier_code; })[0];
    S.step = 2;
    if (it && ret.savedSku) {
      var p = findProduct(ret.savedSku), i = S.items.indexOf(it);
      if (p) {
        var landed = (landedNow().rows[i] || { landed: it.unit_cost }).landed;
        applyMatch(it, p, 'PREALTA', 'ALTA_AVANZADA'); it.panel = '';
        it.update_price = true; it.new_price = num(p.price); it.prev_cost = 0;
        it.margin_pct = landed > 0 ? RH.r2((it.new_price / IVA / landed - 1) * 100) : 0;
        S.prealtas.push({ sku: p.sku, barcode: p.barcode, supplier_code: it.supplier_code, name: p.name, cost: RH.r4(landed), price: it.new_price, margin: it.margin_pct, via: 'ALTA_AVANZADA' });
        RH.toast('Producto ' + p.sku + ' guardado y ligado a «' + it.supplier_code + '». Continúa con el siguiente.', 'ok');
      } else RH.toast('No se encontró el producto guardado (' + ret.savedSku + ') en el catálogo.', 'warn');
    } else if (it) RH.toast('Alta avanzada cancelada: la partida «' + it.supplier_code + '» sigue pendiente.', 'info');
    render();
    openNextPending(true, it ? S.items.indexOf(it) : null);
  };

  /* partida manual */
  RH.inputs['s2-man-q'] = function (el) {
    var q = String(el.value || '').trim().toUpperCase(), box = $('rh-man-list'); if (!box) return;
    if (!q) { box.innerHTML = ''; return; }
    var res = RH.catalog.filter(function (p) { return [p.sku, p.barcode, RH.pAlt(p), p.name].some(function (v) { return String(v || '').toUpperCase().indexOf(q) > -1; }); }).slice(0, 8);
    box.innerHTML = '<div class="rh-ac-list">' + (res.length ? res.map(function (p) {
      return '<div class="rh-ac-item" data-rh="s2-man-add" data-sku="' + esc(p.sku) + '"><span><b>' + esc(p.sku) + '</b> — ' + esc(p.name) + '</span><span class="rh-muted">Costo ' + RH.mxn(productCost(p)) + '</span></div>';
    }).join('') : '<div class="rh-ac-item">Sin coincidencias</div>') + '</div>';
  };
  RH.actions['s2-man-add'] = function (el) {
    var p = findProduct(el.getAttribute('data-sku')); if (!p) return;
    var qty = num($('rh-man-qty').value) || 1, cost = $('rh-man-cost').value !== '' ? num($('rh-man-cost').value) : productCost(p);
    var it = makeLine({ line_no: S.items.length + 1, code: p.sku, description: p.name, qty: qty, unit_cost: cost, iva_rate: 0.16 }, S.items.length);
    applyMatch(it, p, 'HOMOLOGADO', 'MANUAL'); S.items.push(it); render();
  };

  /* ═════════════════════════════════ PASO 3 ═════════════════════════════════ */
  /* Fletes: hasta 3, 4… N traslados (un transporte cobra de una ciudad a otra y de ahí recoge otro transporte).
     Cada traslado tiene su transportista, su condición de pago, su factura (XML/PDF) y sus costos. */
  function newLeg(cond) {
    return { condition: cond || 'PROVEEDOR', carrier_name: '', carrier_rfc: '', origin: '', destination: '', doc_uuid: '', doc_folio: '',
      xml: null, pdf: null, lines: [{ type: 'FLETE', amount: 0, note: '' }] };
  }
  function legTotal(l) { return l.condition === 'PROVEEDOR' ? 0 : totalsOf(l.lines, function (x) { return num(x.amount); }); }
  function legOf(el) { return S.freight.legs[num(el.getAttribute('data-l'))]; }

  function legsEditor() {
    var N = S.freight.legs.length;
    var cards = S.freight.legs.map(function (l, li) {
      var conds = FREIGHT_CONDS.map(function (c) {
        return '<div class="rh-choice' + (l.condition === c[0] ? ' sel' : '') + '" data-rh="s3-cond" data-l="' + li + '" data-v="' + c[0] + '"><div>' + c[1] + '<small>' + c[2] + '</small></div></div>';
      }).join('');
      var body;
      if (l.condition === 'PROVEEDOR') {
        body = '<div class="rh-alert ok" style="margin:8px 0 0;">🟢 Este traslado lo paga el proveedor: <b>0%</b> de costo adicional.</div>';
      } else {
        var lines = l.lines.map(function (ln, k) {
          return '<tr><td><select class="rh-select" data-rhch="s3-ltype" data-l="' + li + '" data-i="' + k + '">' + COST_TYPES.map(function (t) { return '<option value="' + t[0] + '"' + (ln.type === t[0] ? ' selected' : '') + '>' + t[1] + '</option>'; }).join('') + '</select></td>' +
            '<td><input class="rh-input" style="width:130px;text-align:right;" type="number" min="0" step="0.01" data-rhin="s3-lamt" data-l="' + li + '" data-i="' + k + '" value="' + (ln.amount || '') + '" placeholder="0.00"></td>' +
            '<td><input class="rh-input" style="width:100%;" data-rhin="s3-lnote" data-l="' + li + '" data-i="' + k + '" value="' + esc(ln.note || '') + '" placeholder="Nota (opcional)"></td>' +
            '<td><button type="button" class="rh-btn sm danger" data-rh="s3-ldel" data-l="' + li + '" data-i="' + k + '">🗑</button></td></tr>';
        }).join('');
        body = '<div class="rh-grid c4" style="margin-top:8px;">' +
          '<div class="rh-field"><label>Transportista / Fletera *</label><input class="rh-input" data-rhin="s3-lf" data-l="' + li + '" data-f="carrier_name" value="' + esc(l.carrier_name) + '"></div>' +
          '<div class="rh-field"><label>RFC</label><input class="rh-input rh-mono" data-rhin="s3-lf" data-l="' + li + '" data-f="carrier_rfc" value="' + esc(l.carrier_rfc) + '" style="text-transform:uppercase;"></div>' +
          '<div class="rh-field"><label>Ciudad / punto de origen</label><input class="rh-input" data-rhin="s3-lf" data-l="' + li + '" data-f="origin" value="' + esc(l.origin) + '" placeholder="Ej. Monterrey"></div>' +
          '<div class="rh-field"><label>Ciudad / punto de destino</label><input class="rh-input" data-rhin="s3-lf" data-l="' + li + '" data-f="destination" value="' + esc(l.destination) + '" placeholder="Ej. Guadalajara"></div></div>' +
          '<div class="rh-grid c3" style="margin-top:8px;">' +
          '<div class="rh-field"><label>Folio de la factura del flete</label><input class="rh-input rh-mono" data-rhin="s3-lf" data-l="' + li + '" data-f="doc_folio" value="' + esc(l.doc_folio) + '"></div>' +
          '<div class="rh-field"><label>UUID de la factura del flete</label><input class="rh-input rh-mono" data-rhin="s3-lf" data-l="' + li + '" data-f="doc_uuid" value="' + esc(l.doc_uuid) + '"></div>' +
          '<div><div class="rh-drop" style="padding:8px;" data-rh="s3-pick" data-l="' + li + '" data-rh-drop="flete"><b>📎 .XML / .PDF de la Factura de la Fletera</b><p>Arrastra o haz clic · el XML llena transportista, folio, UUID y total</p></div>' +
          '<input type="file" id="rh-f-flete-' + li + '" accept=".xml,.pdf,text/xml,application/pdf" multiple style="display:none" data-rhch="s3-files" data-l="' + li + '">' +
          '<div>' + (l.xml ? '<span class="rh-file-chip">🧾 ' + esc(l.xml.filename) + '</span>' : '') + (l.pdf ? '<span class="rh-file-chip">📕 ' + esc(l.pdf.filename) + '</span>' : '') + '</div></div></div>' +
          '<div class="rh-table-wrap" style="margin-top:8px;"><table class="rh-table"><thead><tr><th>Concepto</th><th class="rh-num">Importe $</th><th>Nota</th><th></th></tr></thead><tbody>' + lines + '</tbody></table></div>' +
          '<div style="margin-top:6px;display:flex;justify-content:space-between;align-items:center;"><button type="button" class="rh-btn sm" data-rh="s3-ladd" data-l="' + li + '">＋ Agregar concepto (maniobras, seguro…)</button>' +
          '<b>Subtotal traslado ' + (li + 1) + ': <span id="rh-leg-sub-' + li + '">' + RH.mxn(legTotal(l)) + '</span></b></div>';
      }
      return '<div class="rh-card" style="border-left:4px solid #2563eb;"><div style="display:flex;justify-content:space-between;align-items:center;gap:8px;">' +
        '<h4 style="margin:0;">🚛 Traslado ' + (li + 1) + ' de ' + N + (l.origin || l.destination ? ' · ' + esc(l.origin || '?') + ' → ' + esc(l.destination || '?') : '') + '</h4>' +
        (N > 1 ? '<button type="button" class="rh-btn sm danger" data-rh="s3-legdel" data-l="' + li + '">🗑 Quitar traslado</button>' : '') + '</div>' +
        '<div class="rh-grid c2" style="margin-top:8px;">' + conds + '</div>' + body + '</div>';
    }).join('');
    return cards + '<div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;"><button type="button" class="rh-btn primary" data-rh="s3-legadd">➕ Agregar otro flete / traslado</button>' +
      '<span class="rh-muted">Si un transporte te cobra de una ciudad a otra y de ahí recoge otro, agrega cada uno (3 o más).</span>' +
      '<b style="margin-left:auto;">Total fletes: <span id="rh-fr-total-3">' + freightText() + '</span></b></div>';
  }

  function step3() {
    var methods = METHODS.map(function (m) {
      return '<div class="rh-choice' + (S.method === m[0] ? ' sel' : '') + '" data-rh="s3-method" data-v="' + m[0] + '">' + m[1] + '</div>';
    }).join('');
    var rows = S.items.map(function (it, i) {
      var pc = it.prev_cost || 0, price = it.match ? num(it.match.product.price) : 0;
      return '<tr><td><b class="rh-mono">' + esc(it.sku) + '</b><div class="rh-muted">' + esc((it.match.product.name || '').slice(0, 34)) + '</div></td>' +
        '<td class="rh-num">' + it.qty_invoiced + '</td><td class="rh-num">' + RH.mxn(it.unit_cost) + '</td>' +
        '<td class="rh-num" id="rh-lc-fpu-' + i + '">—</td><td class="rh-num" id="rh-lc-landed-' + i + '"><b>—</b></td>' +
        '<td class="rh-num">' + (pc > 0 ? RH.mxn(pc) : '<span class="rh-muted">nuevo</span>') + '</td><td id="rh-lc-delta-' + i + '">—</td>' +
        '<td><div style="display:flex;gap:5px;align-items:center;"><input type="checkbox" id="rh-pc-c-' + i + '" data-rhch="s3-pcc" data-i="' + i + '"' + (it.update_price ? ' checked' : '') + ' title="Actualizar precio de venta">' +
        '<input class="rh-input" style="width:68px;" type="number" step="0.01" id="rh-pc-m-' + i + '" data-rhin="s3-pcm" data-i="' + i + '" title="% margen s/IVA (escala principal)">' +
        '<input class="rh-input" style="width:92px;" type="number" step="0.01" id="rh-pc-p-' + i + '" data-rhin="s3-pcp" data-i="' + i + '" title="Precio final c/IVA"></div>' +
        '<div class="rh-muted" id="rh-pc-hint-' + i + '">Precio actual ' + RH.mxn(price) + '</div><div class="rh-muted" id="rh-pc-sc-' + i + '"></div></td></tr>';
    }).join('');
    return '<div class="rh-card"><h4>1️⃣ Fletes, traslados y costos adicionales (Landed Cost)</h4>' + legsEditor() + '</div>' +
      '<div class="rh-card"><h4>2️⃣ Método de prorrateo</h4><div class="rh-grid c2">' + methods + '</div><div id="rh-lc-methodnote"></div></div>' +
      '<div class="rh-card"><h4>3️⃣ Costeo real puesto en almacén</h4>' +
      '<div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:8px;" id="rh-lc-kpis"></div>' +
      '<div class="rh-table-wrap"><table class="rh-table"><thead><tr><th>Producto</th><th class="rh-num">Cant.</th><th class="rh-num">Costo factura XML</th><th class="rh-num">Flete/costos prorrateados (c/u)</th><th class="rh-num">Costo real en almacén</th><th class="rh-num">Costo anterior</th><th>Variación</th><th>Actualizar precio de venta (☑ · % margen · $ final)</th></tr></thead><tbody>' + rows + '</tbody></table></div>' +
      '<div class="rh-muted" style="margin-top:6px;">El % de flete equivalente se asigna al campo <b>Flete (%)</b> de cada artículo. El margen es sin IVA (precio = costo × (1+margen) × 1.16), igual que en Alta de Producto. <b>Al actualizar el precio de la escala principal se recalculan también las demás escalas</b> (CONTRATISTA, REVENTA, CRÉDITO…) con sus propios márgenes.</div></div>';
  }

  RH.actions['s3-cond'] = function (el) {
    var l = legOf(el); l.condition = el.getAttribute('data-v');
    if (l.condition !== 'PROVEEDOR' && !l.lines.length) l.lines.push({ type: 'FLETE', amount: 0, note: '' });
    render();
  };
  RH.actions['s3-method'] = function (el) { S.method = el.getAttribute('data-v'); render(); };
  RH.inputs['s3-lf'] = function (el) { var f = el.getAttribute('data-f'); if (f === 'carrier_rfc' || f === 'doc_uuid') el.value = el.value.toUpperCase(); legOf(el)[f] = el.value; };
  RH.changes['s3-ltype'] = function (el) { legOf(el).lines[num(el.getAttribute('data-i'))].type = el.value; };
  RH.inputs['s3-lamt'] = function (el) { legOf(el).lines[num(el.getAttribute('data-i'))].amount = num(el.value); onFreightChanged(); };
  RH.inputs['s3-lnote'] = function (el) { legOf(el).lines[num(el.getAttribute('data-i'))].note = el.value; };
  RH.actions['s3-ladd'] = function (el) { legOf(el).lines.push({ type: 'MANIOBRAS', amount: 0, note: '' }); render(); };
  RH.actions['s3-ldel'] = function (el) { legOf(el).lines.splice(num(el.getAttribute('data-i')), 1); render(); };
  RH.actions['s3-legadd'] = function () { S.freight.legs.push(newLeg('CONTADO')); if (S.step === 2) S.freight.open2 = true; render(); };
  RH.actions['s3-legdel'] = function (el) { S.freight.legs.splice(num(el.getAttribute('data-l')), 1); if (!S.freight.legs.length) S.freight.legs.push(newLeg()); render(); };
  RH.actions['s3-pick'] = function (el) { var f = $('rh-f-flete-' + el.getAttribute('data-l')); if (f) { f.value = ''; f.click(); } };
  RH.changes['s3-files'] = function (el) { ingestFreightFiles(num(el.getAttribute('data-l')), el.files); };
  RH.actions['drop:flete'] = function (z, files) { ingestFreightFiles(num(z.getAttribute('data-l')), files); };
  async function ingestFreightFiles(li, files) {
    var l = S.freight.legs[li]; if (!l) return;
    for (var i = 0; i < files.length; i++) {
      var f = files[i];
      try {
        if (/\.xml$/i.test(f.name) || /xml/i.test(f.type)) {
          var text = await RH.readText(f), p = RH.parseCfdi(text);
          l.xml = { filename: f.name, mime: 'text/xml', b64: RH.textToB64(text) };
          l.carrier_name = l.carrier_name || p.emisor.nombre; l.carrier_rfc = l.carrier_rfc || p.emisor.rfc;
          l.doc_uuid = p.uuid || l.doc_uuid; l.doc_folio = ((p.serie || '') + (p.folio || '')) || l.doc_folio;
          var subtotal = p.subtotal - p.descuento;
          if (!l.lines.some(function (x) { return num(x.amount) > 0; })) l.lines = [{ type: 'FLETE', amount: RH.r2(subtotal), note: 'Según factura ' + ((p.serie || '') + (p.folio || '')) }];
          RH.toast('Factura del traslado ' + (li + 1) + ' leída: ' + p.emisor.nombre + ' · subtotal ' + RH.mxn(subtotal), 'ok');
        } else {
          var du = await RH.readDataUrl(f); l.pdf = { filename: f.name, mime: f.type || 'application/pdf', b64: RH.stripDataUrl(du) };
        }
      } catch (e) { RH.toast('No se pudo leer «' + f.name + '»: ' + e.message, 'bad'); }
    }
    render();
  }
  /** Se llama cada vez que cambia un importe de flete: refresca totales, costo real y hojas de alta. */
  function onFreightChanged() {
    if (!S) return;
    var t = freightText();
    ['rh-fr-total-2', 'rh-fr-total-3'].forEach(function (id) { var e = $(id); if (e) e.textContent = t; });
    S.freight.legs.forEach(function (l, li) { var e = $('rh-leg-sub-' + li); if (e) e.textContent = RH.mxn(legTotal(l)); });
    if (S.step === 3) refreshLanded();
    if (S.step === 2) refreshSheets();
  }

  function scaleChips(it, landed) {
    var p = it.match && it.match.product, scs = RH.pMeta(p).price_scales;
    if (!Array.isArray(scs) || scs.length < 2) return '';
    return 'Escalas: ' + scs.map(function (sc, k) {
      var nm = String(sc.scale_name || sc.nombre || sc.name || '').trim(), m = num(sc.margen_trabajo != null ? sc.margen_trabajo : sc.margin);
      var price = (it.update_price && it.new_price > 0) ? (k === 0 ? it.new_price : RH.r2(landed * (1 + m / 100) * IVA)) : num(sc.precio || sc.price);
      return esc(nm) + ' <b>' + RH.mxn(price) + '</b>';
    }).join(' · ');
  }

  function refreshLanded() {
    if (S.step !== 3) return;
    var ft = freightTotal(), L = landedNow(), sub = invoiceSub();
    var note = $('rh-lc-methodnote');
    if (note) note.innerHTML = L.fallback ? '<div class="rh-alert warn">⚠️ Faltan datos de ' + (S.method === 'PESO' ? 'peso' : 'volumen') + ' en Complementos [F4] de los artículos: se prorrateó por <b>Importe</b>.</div>' : '';
    var k = $('rh-lc-kpis');
    if (k) k.innerHTML = '<span class="rh-badge info">Flete + costos: ' + RH.mxn(ft) + '</span><span class="rh-badge info">% sobre factura: ' + (sub > 0 ? (ft / sub * 100).toFixed(2) : '0.00') + '%</span>' +
      '<span class="rh-badge gray">Traslados: ' + S.freight.legs.filter(function (l) { return legTotal(l) > 0; }).length + '</span>' +
      '<span class="rh-badge gray">Método: ' + esc(L.methodUsed) + '</span>' + (S.inspected ? '<span class="rh-badge ok">Con unidades sanas reales</span>' : '<span class="rh-badge gray">Estimado sobre lo facturado</span>');
    S.items.forEach(function (it, i) {
      var r = L.rows[i], landed = r.landed, pc = it.prev_cost || 0;
      var f1 = $('rh-lc-fpu-' + i); if (f1) f1.textContent = RH.mxn(r.fpu);
      var f2 = $('rh-lc-landed-' + i); if (f2) f2.innerHTML = '<b>' + RH.mxn(landed) + '</b>';
      var d = $('rh-lc-delta-' + i);
      if (d) {
        if (pc > 0) {
          var inc = (landed / pc - 1) * 100;
          d.innerHTML = inc > 10 ? '<span class="rh-badge warn" title="El costo nuevo supera en más de 10% al anterior">⚠️ Alerta de Incremento de Costo (>10%) +' + inc.toFixed(1) + '%</span>'
            : '<span class="rh-badge ' + (inc > 0 ? 'info' : 'ok') + '">' + (inc >= 0 ? '+' : '') + inc.toFixed(1) + '%</span>';
        } else d.innerHTML = '<span class="rh-muted">—</span>';
      }
      var p = it.match ? num(it.match.product.price) : 0;
      var m = $('rh-pc-m-' + i), pr = $('rh-pc-p-' + i), hint = $('rh-pc-hint-' + i), sc = $('rh-pc-sc-' + i);
      if (m && pr && document.activeElement !== m && document.activeElement !== pr) {
        if (it.update_price && it.new_price > 0) { pr.value = it.new_price; m.value = RH.r2((it.new_price / IVA / landed - 1) * 100); }
        else { pr.value = p ? RH.r2(p) : ''; m.value = p && landed > 0 ? RH.r2((p / IVA / landed - 1) * 100) : ''; }
      }
      if (hint) {
        var curMargin = (pc > 0 && p > 0) ? (p / IVA / pc - 1) : null;
        var sug = curMargin != null ? RH.r2(landed * (1 + curMargin) * IVA) : null;
        hint.innerHTML = 'Precio actual ' + RH.mxn(p) + (sug && Math.abs(sug - p) > 0.01 ? ' · <a href="#" data-rh="s3-sug" data-i="' + i + '" data-v="' + sug + '">usar sugerido ' + RH.mxn(sug) + ' (conserva margen)</a>' : '');
      }
      if (sc) sc.innerHTML = scaleChips(it, landed);
    });
  }
  RH.actions['s3-sug'] = function (el, e) { e.preventDefault(); var i = num(el.getAttribute('data-i')), it = S.items[i]; it.update_price = true; it.new_price = num(el.getAttribute('data-v')); $('rh-pc-c-' + i).checked = true; refreshLanded(); };
  RH.changes['s3-pcc'] = function (el) {
    var i = num(el.getAttribute('data-i')), it = S.items[i];
    it.update_price = el.checked;
    if (it.update_price && !(it.new_price > 0)) it.new_price = num($('rh-pc-p-' + i).value) || (it.match ? num(it.match.product.price) : 0);
    refreshLanded();
  };
  RH.inputs['s3-pcm'] = function (el) {
    var i = num(el.getAttribute('data-i')), it = S.items[i], landed = landedNow().rows[i].landed;
    it.new_price = RH.r2(landed * (1 + num(el.value) / 100) * IVA); it.update_price = true; it.margin_pct = num(el.value);
    $('rh-pc-p-' + i).value = it.new_price; $('rh-pc-c-' + i).checked = true;
    var sc = $('rh-pc-sc-' + i); if (sc) sc.innerHTML = scaleChips(it, landed);
  };
  RH.inputs['s3-pcp'] = function (el) {
    var i = num(el.getAttribute('data-i')), it = S.items[i], landed = landedNow().rows[i].landed;
    it.new_price = num(el.value); it.update_price = it.new_price > 0; it.margin_pct = landed > 0 ? RH.r2((it.new_price / IVA / landed - 1) * 100) : 0;
    $('rh-pc-m-' + i).value = it.margin_pct; $('rh-pc-c-' + i).checked = it.update_price;
    var sc = $('rh-pc-sc-' + i); if (sc) sc.innerHTML = scaleChips(it, landed);
  };

  /* ═════════════════════════════════ PASO 4 ═════════════════════════════════ */
  function step4() {
    var sem = [['SELLADA', '🟢 Cajas / Tarimas Selladas e Íntegras'], ['VIOLADA', '🟡 Empaque Violado / Abierto'], ['DANADA', '🔴 Mercancía Golpeada / Mojada']].map(function (s) {
      return '<div class="rh-choice' + (S.physical.state === s[0] ? ' sel' : '') + '" data-rh="s4-state" data-v="' + s[0] + '">' + s[1] + '</div>';
    }).join('');
    var thumbs = S.arrival.map(function (f, i) { return '<div class="rh-thumb"><img src="' + f.dataUrl + '" alt=""><button type="button" data-rh="s4-rmarr" data-i="' + i + '">✕</button></div>'; }).join('');
    var rows = S.items.map(function (it, i) {
      return '<tr id="rh-ins-row-' + i + '"><td><b class="rh-mono">' + esc(it.sku) + '</b><div class="rh-muted">' + esc((it.match.product.name || it.description || '').slice(0, 36)) + '</div></td>' +
        '<td class="rh-num"><b>' + it.qty_invoiced + '</b></td>' +
        '<td class="rh-num"><div style="display:flex;gap:3px;justify-content:flex-end;"><button type="button" class="rh-btn sm" data-rh="s4-step" data-i="' + i + '" data-d="-1">−</button>' +
        '<input class="rh-input rh-qty" type="number" min="0" step="any" id="rh-ins-ok-' + i + '" data-rhin="s4-q" data-i="' + i + '" data-f="qty_ok" value="' + it.qty_ok + '">' +
        '<button type="button" class="rh-btn sm" data-rh="s4-step" data-i="' + i + '" data-d="1">＋</button></div></td>' +
        '<td class="rh-num" id="rh-ins-miss-' + i + '">0</td>' +
        '<td class="rh-num"><input class="rh-input rh-qty" type="number" min="0" step="any" id="rh-ins-dmg-' + i + '" data-rhin="s4-q" data-i="' + i + '" data-f="qty_damaged" value="' + it.qty_damaged + '"></td>' +
        '<td><select class="rh-select" style="width:100px;" id="rh-ins-cause-' + i + '" data-rhch="s4-cause" data-i="' + i + '"><option value="">—</option>' + CAUSES.map(function (c) { return '<option' + (it.damage_cause === c ? ' selected' : '') + '>' + c + '</option>'; }).join('') + '</select></td>' +
        '<td><input class="rh-input" style="width:74px;" placeholder="Lote" data-rhin="s4-t" data-i="' + i + '" data-f="lot" value="' + esc(it.lot) + '"><input class="rh-input" style="width:118px;margin-top:3px;" type="date" data-rhin="s4-t" data-i="' + i + '" data-f="expiry" value="' + esc(it.expiry) + '" title="Caducidad"></td>' +
        '<td id="rh-ins-photo-' + i + '"></td>' +
        '<td style="text-align:center;"><input type="checkbox" id="rh-ins-chk-' + i + '" data-rhch="s4-chk" data-i="' + i + '"' + (it.checked ? ' checked' : '') + ' style="width:18px;height:18px;"></td></tr>';
    }).join('');
    return '<div class="rh-card"><h4>1️⃣ Estado de llegada del camión</h4><div class="rh-grid c3">' + sem + '</div>' +
      '<div style="margin-top:9px;"><button type="button" class="rh-btn" data-rh="s4-arrpick">📷 Subir Fotos de Llegada del Camión / Tarimas</button>' +
      '<input type="file" id="rh-f-arr" accept="image/*" multiple style="display:none" data-rhch="s4-arrfiles"><div class="rh-thumbs">' + thumbs + '</div></div>' +
      '<div class="rh-field" style="margin-top:9px;"><label>Observaciones del almacenista</label><input class="rh-input" style="width:100%;" data-rhin="s4-notes" value="' + esc(S.physical.notes) + '" placeholder="Ej. Tarima 2 con cajas mojadas…"></div></div>' +
      '<div class="rh-card"><h4>2️⃣ Verificación física (conciliación por escáner o manual)</h4>' +
      '<div class="rh-grid c3"><div class="rh-field" style="grid-column:span 2;"><label>🔎 Escanear código de barras (suma +1 a Recibido Sano)</label><input class="rh-input rh-mono" id="rh-scan" data-rhkd="s4-scan" autocomplete="off" placeholder="Escanea con el lector y presiona Enter…" style="font-size:15px;height:42px;"></div>' +
      '<div class="rh-field"><label>&nbsp;</label><button type="button" class="rh-btn" style="width:100%;height:42px;" data-rh="s4-all">✅ Recibir todo completo</button></div></div><div id="rh-scan-msg" class="rh-muted" style="margin:5px 0 8px;"></div>' +
      '<div class="rh-table-wrap"><table class="rh-table"><thead><tr><th>Producto</th><th class="rh-num">Cant. facturada</th><th class="rh-num">✅ Recibido sano (entra a stock)</th><th class="rh-num">❌ Faltante</th><th class="rh-num">⚠️ Dañado / mal estado</th><th>Causa</th><th>Lote / Caducidad</th><th>📷 Foto daño</th><th>✔</th></tr></thead><tbody>' + rows + '</tbody></table></div></div>' +
      '<div id="rh-anom"></div><input type="file" id="rh-f-dmg" accept="image/*" style="display:none" data-rhch="s4-dmgfile">';
  }
  RH.actions['s4-state'] = function (el) { S.physical.state = el.getAttribute('data-v'); scrollKeep(function () { render(); }); };
  RH.inputs['s4-notes'] = function (el) { S.physical.notes = el.value; };
  RH.actions['s4-arrpick'] = function () { var f = $('rh-f-arr'); f.value = ''; f.click(); };
  RH.changes['s4-arrfiles'] = async function (el) {
    for (var i = 0; i < el.files.length; i++) { try { S.arrival.push(await RH.imageToJpeg(el.files[i])); } catch (e) { RH.toast(e.message, 'bad'); } }
    render();
  };
  RH.actions['s4-rmarr'] = function (el) { S.arrival.splice(num(el.getAttribute('data-i')), 1); render(); };
  RH.inputs['s4-t'] = function (el) { S.items[num(el.getAttribute('data-i'))][el.getAttribute('data-f')] = el.value; };
  RH.changes['s4-cause'] = function (el) { S.items[num(el.getAttribute('data-i'))].damage_cause = el.value; };
  RH.changes['s4-chk'] = function (el) { S.items[num(el.getAttribute('data-i'))].checked = el.checked; refreshInspection(); };
  RH.inputs['s4-q'] = function (el) {
    var i = num(el.getAttribute('data-i')), it = S.items[i];
    it[el.getAttribute('data-f')] = Math.max(0, num(el.value));
    recomputeMissing(it); it.checked = (it.qty_ok + it.qty_damaged) > 0 ? true : it.checked;
    refreshInspection();
  };
  RH.actions['s4-step'] = function (el) {
    var i = num(el.getAttribute('data-i')), it = S.items[i], d = num(el.getAttribute('data-d'));
    it.qty_ok = Math.max(0, Math.min(it.qty_invoiced - it.qty_damaged, num(it.qty_ok) + d)); recomputeMissing(it); it.checked = true;
    $('rh-ins-ok-' + i).value = it.qty_ok; refreshInspection();
  };
  RH.actions['s4-all'] = function () {
    S.items.forEach(function (it) { it.qty_ok = it.qty_invoiced; it.qty_damaged = 0; it.qty_missing = 0; it.checked = true; it.damage_cause = ''; });
    render();
  };
  RH.keys['s4-scan'] = function (el, e) {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    var code = String(el.value || '').trim().toUpperCase(); el.value = ''; if (!code) return;
    var nz = RH.noZeros(code), idx = -1;
    S.items.forEach(function (it, i) {
      if (idx > -1) return;
      var cands = [it.sku, it.barcode, it.supplier_code, it.match && RH.pAlt(it.match.product)].map(function (v) { return String(v || '').toUpperCase(); });
      if (cands.indexOf(code) > -1 || (nz && cands.some(function (v) { return v && RH.noZeros(v) === nz; }))) idx = i;
    });
    var out = $('rh-scan-msg');
    if (idx < 0) { if (out) out.innerHTML = '<span style="color:#b91c1c;font-weight:800;">✗ «' + esc(code) + '» no pertenece a esta recepción (sobrante).</span>'; RH.toast('Código ' + code + ' no está en la factura.', 'warn'); return; }
    var it = S.items[idx];
    if (it.qty_ok + it.qty_damaged >= it.qty_invoiced) { if (out) out.innerHTML = '<span style="color:#b45309;font-weight:800;">⚠ ' + esc(it.sku) + ' ya está completo (' + it.qty_invoiced + '). Sobrante no registrado.</span>'; return; }
    it.qty_ok += 1; recomputeMissing(it); it.checked = true;
    $('rh-ins-ok-' + idx).value = it.qty_ok;
    if (out) out.innerHTML = '<span style="color:#15803d;font-weight:800;">✓ ' + esc(it.sku) + ' · ' + it.qty_ok + ' / ' + it.qty_invoiced + '</span>';
    var row = $('rh-ins-row-' + idx); if (row && row.scrollIntoView) row.scrollIntoView({ block: 'nearest' });
    refreshInspection();
  };
  RH.actions['s4-dmgpick'] = function (el) { S._dmgIdx = num(el.getAttribute('data-i')); var f = $('rh-f-dmg'); f.value = ''; f.click(); };
  RH.changes['s4-dmgfile'] = async function (el) {
    if (!el.files.length || S._dmgIdx == null) return;
    try { S.items[S._dmgIdx].damagePhoto = await RH.imageToJpeg(el.files[0]); } catch (e) { RH.toast(e.message, 'bad'); }
    refreshInspection();
  };
  RH.actions['s4-rmdmg'] = function (el) { S.items[num(el.getAttribute('data-i'))].damagePhoto = null; refreshInspection(); };

  function refreshInspection() {
    if (S.step !== 4) return;
    S.items.forEach(function (it, i) {
      recomputeMissing(it);
      var m = $('rh-ins-miss-' + i); if (m) m.innerHTML = it.qty_missing > 0 ? '<b style="color:#b91c1c;">' + it.qty_missing + '</b>' : '0';
      var c = $('rh-ins-chk-' + i); if (c) c.checked = !!it.checked;
      var ph = $('rh-ins-photo-' + i);
      if (ph) {
        if (it.qty_damaged > 0) ph.innerHTML = it.damagePhoto
          ? '<div class="rh-thumb" style="width:70px;height:54px;"><img src="' + it.damagePhoto.dataUrl + '" alt=""><button type="button" data-rh="s4-rmdmg" data-i="' + i + '">✕</button></div>'
          : '<button type="button" class="rh-btn sm danger" data-rh="s4-dmgpick" data-i="' + i + '">📷 Foto requerida</button>';
        else ph.innerHTML = '<span class="rh-muted">—</span>';
      }
      var row = $('rh-ins-row-' + i);
      if (row) row.style.background = (it.qty_missing > 0 || it.qty_damaged > 0) ? 'rgba(220,38,38,.06)' : (it.checked ? 'rgba(22,163,74,.06)' : '');
    });
    var d = disputes(), box = $('rh-anom'); if (!box) return;
    if (!d.units) { box.innerHTML = '<div class="rh-alert ok">✅ Sin faltantes ni daños: la recepción quedará <b>Completa</b>.</div>'; return; }
    var st = [['ABIERTO', 'Abierto'], ['EN_PROCESO', 'En Proceso'], ['NC_APLICADA', 'Nota de Crédito Aplicada'], ['REPOSICION_RECIBIDA', 'Reposición Recibida'], ['CONCLUIDO', 'Concluido']];
    var keepFocus = document.activeElement && document.activeElement.id === 'rh-inc-notes-w' ? document.activeElement : null;
    if (keepFocus) return;   // no re-render mientras el usuario escribe notas
    box.innerHTML = '<div class="rh-card" style="border-color:#fca5a5;background:#fef2f2;"><h4 style="color:#991b1b;">🚨 Gestión de Anomalía con el Proveedor — ' + d.units + ' unidad(es) · ' + RH.mxn(d.money) + ' c/IVA en disputa</h4>' +
      '<div class="rh-grid c2"><div class="rh-choice' + (S.incident.action === 'NC' ? ' sel' : '') + '" data-rh="s4-act" data-v="NC">📄 Solicitar Nota de Crédito (Descontar de Cuentas x Pagar)</div>' +
      '<div class="rh-choice' + (S.incident.action === 'REPOSICION' ? ' sel' : '') + '" data-rh="s4-act" data-v="REPOSICION">🔄 Solicitar Cambio Físico / Reposición de Mercancía</div></div>' +
      '<div class="rh-grid c2" style="margin-top:9px;"><div class="rh-field"><label>Estatus del expediente</label><select class="rh-select" id="rh-inc-status-w" data-rhch="s4-incst">' + st.map(function (s) { return '<option value="' + s[0] + '"' + (S.incident.status === s[0] ? ' selected' : '') + '>' + s[1] + '</option>'; }).join('') + '</select></div>' +
      '<div class="rh-field"><label>Notas para el proveedor</label><input class="rh-input" style="width:100%;" id="rh-inc-notes-w" data-rhin="s4-incnotes" value="' + esc(S.incident.notes) + '" placeholder="Detalle del reclamo…"></div></div>' +
      '<div style="margin-top:9px;display:flex;gap:8px;flex-wrap:wrap;"><button type="button" class="rh-btn" data-rh="s4-report">📤 Generar Reporte PDF con Evidencia Fotográfica para el Proveedor</button>' +
      '<button type="button" class="rh-btn" data-rh="s4-wa">💬 WhatsApp</button><button type="button" class="rh-btn" data-rh="s4-mail">✉️ Correo</button></div>' +
      '<div class="rh-muted" style="margin-top:6px;">Faltante o daño exige elegir la acción y, para los daños, la foto de evidencia por producto.</div></div>';
  }
  RH.actions['s4-act'] = function (el) { S.incident.action = el.getAttribute('data-v'); S.incident.status = S.incident.status || 'ABIERTO'; refreshInspection(); };
  RH.changes['s4-incst'] = function (el) { S.incident.status = el.value; };
  RH.inputs['s4-incnotes'] = function (el) { S.incident.notes = el.value; };
  function stateReport() {
    var sup = S.supplier || {}, P = S.inv.parsed;
    var photos = [];
    S.items.forEach(function (it) { if (it.damagePhoto) photos.push({ label: 'Daño · ' + it.sku, src: it.damagePhoto.dataUrl }); });
    S.arrival.forEach(function (f, i) { photos.push({ label: 'Llegada del camión #' + (i + 1), src: f.dataUrl }); });
    return {
      folio: '(borrador de recepción)', date: new Date().toLocaleDateString('es-MX'), supplier: sup.name, rfc: sup.rfc, invoiceFolio: P ? (P.serie || '') + (P.folio || '') : '',
      invoiceUuid: P ? P.uuid : '', action: S.incident.action || 'NC', disputed: disputes().money, notes: S.incident.notes,
      items: S.items.filter(function (it) { return it.qty_missing + it.qty_damaged > 0; }).map(function (it) {
        return { sku: it.sku, description: it.description, qty_invoiced: it.qty_invoiced, qty_missing: it.qty_missing, qty_damaged: it.qty_damaged, cause: it.damage_cause, amount: (it.qty_missing + it.qty_damaged) * it.unit_cost * (1 + it.iva_rate) };
      }), photos: photos
    };
  }
  RH.actions['s4-report'] = function () { var w = RH.openPrintWindow(); RH.finishPrintWindow(w, RH.buildReportHtml(stateReport())); };
  RH.actions['s4-wa'] = function () {
    var ph = String((S.supplier && S.supplier.id && (LISTS.suppliers.filter(function (s) { return s.id === S.supplier.id; })[0] || {}).phone) || '').replace(/\D/g, '');
    global.open('https://wa.me/' + (ph ? (ph.length === 10 ? '52' + ph : ph) : '') + '?text=' + encodeURIComponent(RH.reportMessage(stateReport())), '_blank', 'noopener');
  };
  RH.actions['s4-mail'] = function () {
    var em = (S.supplier && S.supplier.id && (LISTS.suppliers.filter(function (s) { return s.id === S.supplier.id; })[0] || {}).email) || '';
    global.location.href = 'mailto:' + encodeURIComponent(em) + '?subject=' + encodeURIComponent('Reclamo de recepción — ' + (S.supplier && S.supplier.name || '')) + '&body=' + encodeURIComponent(RH.reportMessage(stateReport()));
  };

  /* ═════════════════════════════════ PASO 5 ═════════════════════════════════ */
  function starsInput(k, label) {
    var v = S.ratings[k], out = '';
    for (var i = 1; i <= 5; i++) out += '<span class="' + (i <= v ? 'on' : '') + '" data-rh="s5-star" data-k="' + k + '" data-v="' + i + '">★</span>';
    return '<div class="rh-field"><label>' + label + '</label><div class="rh-star-in" id="rh-star-' + k + '">' + out + '</div></div>';
  }
  function afectaciones() {
    var L = landedNow(), d = disputes(), ft = freightTotal(), pay = payableNow();
    var units = totalsOf(S.items, function (it) { return num(it.qty_ok); });
    var upd = S.items.filter(function (it) { return it.update_price && it.new_price > 0; }).length;
    var links = S.items.filter(function (it) { return it.match && it.match.status === 'LIGADO'; }).length;
    var payTxt = S.payment === 'CREDITO' ? 'Cuenta por Pagar a ' + (S.supplier && S.supplier.name || 'proveedor') + ': <b>' + RH.mxn(pay) + '</b>'
      : (S.payment === 'SIN_CARGO' ? 'Sin cuenta por pagar (sin cargo)' : 'Pago inmediato (' + (S.payment === 'CONTADO' ? 'Caja' : 'Bancos') + '): <b>' + RH.mxn(pay) + '</b>');
    var items = [
      '📦 Inventario y Kardex: <b>+' + units + '</b> unidades sanas en ' + S.items.length + ' producto(s)',
      '💲 Costos: ' + S.items.length + ' costo(s) reales actualizados' + (ft > 0 ? ' (flete prorrateado ' + (invoiceSub() > 0 ? (ft / invoiceSub() * 100).toFixed(2) : '0') + '%)' : '') + ' · Precios de venta actualizados: <b>' + upd + '</b>',
      '💳 ' + payTxt,
      ft > 0 ? '🚛 Gastos operativos de flete/maniobras: <b>' + RH.mxn(ft) + '</b> en ' + S.freight.legs.filter(function (l) { return legTotal(l) > 0; }).length + ' traslado(s): ' + S.freight.legs.filter(function (l) { return legTotal(l) > 0; }).map(function (l) { return esc(l.carrier_name || 'transportista') + ' ' + RH.mxn(legTotal(l)) + ' (' + ({ CONTADO: 'contado', POR_COBRAR: 'al chofer', CREDITO: 'crédito → CxP' })[l.condition] + ')'; }).join(' · ') : '🚛 Sin gasto de flete para la empresa',
      d.units ? '🚨 Expediente de incidencia: <b>' + d.units + '</b> unidad(es) · ' + RH.mxn(d.money) + ' (' + (S.incident.action === 'NC' ? 'NC: se descuenta de CxP' : 'reposición física') + ')' : '✅ Sin incidencias',
      '🔗 Códigos de proveedor ligados en Complementos [F4]: <b>' + (links + S.prealtas.length) + '</b> · Pre-altas creadas: <b>' + S.prealtas.length + '</b>',
      '📂 Se guardará el Expediente 360° con XMLs, PDFs, fotos, firmas, costeo y reclamos'
    ];
    return '<ul style="margin:0;padding-left:18px;line-height:1.85;font-size:12.5px;">' + items.map(function (x) { return '<li>' + x + '</li>'; }).join('') + '</ul>';
  }
  function step5() {
    var d = disputes();
    return '<div class="rh-card"><h4>⭐ Evaluación de la calidad de entrega — ' + esc(S.supplier ? S.supplier.name : '') + '</h4><div class="rh-grid c4">' +
      starsInput('empaque', 'Empaque') + starsInput('tiempo', 'Tiempo de entrega') + starsInput('documentacion', 'Documentación') + starsInput('producto', 'Estado del producto') + '</div>' +
      '<div class="rh-field" style="margin-top:8px;"><label>Comentarios sobre la entrega</label><input class="rh-input" style="width:100%;" data-rhin="s5-comments" value="' + esc(S.ratings.comments) + '"></div>' +
      '<div class="rh-muted" style="margin-top:5px;">La calificación alimenta los KPIs del proveedor (promedio de estrellas del tablero).</div></div>' +
      '<div class="rh-card"><h4>✍️ Firmas digitales (mouse o pantalla táctil)</h4><div class="rh-grid c3">' +
      [['chofer', 'Firma del Chofer / Transportista *'], ['almacen', 'Firma del Almacenista que Recibe *'], ['supervisor', 'Firma de Supervisor / Autorización' + (d.units ? ' *' : '')]].map(function (s) {
        return '<div class="rh-field"><label>' + s[1] + '</label><canvas class="rh-sig" id="rh-sig-' + s[0] + '"></canvas><button type="button" class="rh-btn sm" style="margin-top:4px;" data-rh="s5-sigclear" data-k="' + s[0] + '">🧹 Limpiar</button></div>';
      }).join('') + '</div></div>' +
      '<div class="rh-card"><h4>📋 Resumen de lo que se afectará</h4>' + afectaciones() + '</div>' +
      '<div class="rh-card" style="border-color:#2563eb;"><div class="rh-choice' + (S.authorized ? ' sel' : '') + '" id="rh-auth" data-rh="s5-auth"><div>' + (S.authorized ? '☑' : '☐') + ' <b>¿Autoriza afectar inventario y finanzas?</b> Confirmo que la información capturada es correcta y autorizo el movimiento de inventario, costos, cuentas por pagar y gastos.</div></div></div>';
  }
  RH.actions['s5-star'] = function (el) { S.ratings[el.getAttribute('data-k')] = num(el.getAttribute('data-v')); var k = el.getAttribute('data-k'); var box = $('rh-star-' + k); if (box) Array.prototype.forEach.call(box.children, function (c, i) { c.className = (i + 1) <= S.ratings[k] ? 'on' : ''; }); };
  RH.inputs['s5-comments'] = function (el) { S.ratings.comments = el.value; };
  RH.actions['s5-auth'] = function (el) {
    S.authorized = !S.authorized;
    el.className = 'rh-choice' + (S.authorized ? ' sel' : '');
    el.innerHTML = '<div>' + (S.authorized ? '☑' : '☐') + ' <b>¿Autoriza afectar inventario y finanzas?</b> Confirmo que la información capturada es correcta y autorizo el movimiento de inventario, costos, cuentas por pagar y gastos.</div>';
    var b = $('rh-confirm-btn'); if (b) b.disabled = !S.authorized;
  };
  var _sigDirty = {};
  function initSig(k) {
    var c = $('rh-sig-' + k); if (!c) return;
    var ratio = global.devicePixelRatio || 1, w = c.clientWidth || 300, h = c.clientHeight || 130;
    c.width = Math.round(w * ratio); c.height = Math.round(h * ratio);
    var ctx = c.getContext('2d'); ctx.lineWidth = 2.2 * ratio; ctx.lineCap = 'round'; ctx.strokeStyle = '#0f172a';
    if (S.sigs[k]) { var im = new Image(); im.onload = function () { ctx.drawImage(im, 0, 0, c.width, c.height); }; im.src = S.sigs[k]; }
    var drawing = false, last = null;
    function pos(e) { var r = c.getBoundingClientRect(); return { x: (e.clientX - r.left) * (c.width / r.width), y: (e.clientY - r.top) * (c.height / r.height) }; }
    c.addEventListener('pointerdown', function (e) { drawing = true; last = pos(e); try { c.setPointerCapture(e.pointerId); } catch (x) {} e.preventDefault(); });
    c.addEventListener('pointermove', function (e) {
      if (!drawing) return; var p = pos(e);
      ctx.beginPath(); ctx.moveTo(last.x, last.y); ctx.lineTo(p.x, p.y); ctx.stroke(); last = p; _sigDirty[k] = true; e.preventDefault();
    });
    function end() { if (!drawing) return; drawing = false; if (_sigDirty[k] || S.sigs[k]) S.sigs[k] = c.toDataURL('image/png'); }
    c.addEventListener('pointerup', end); c.addEventListener('pointerleave', end); c.addEventListener('pointercancel', end);
  }
  RH.actions['s5-sigclear'] = function (el) {
    var k = el.getAttribute('data-k'), c = $('rh-sig-' + k); if (!c) return;
    c.getContext('2d').clearRect(0, 0, c.width, c.height); S.sigs[k] = null; _sigDirty[k] = false;
  };

  /* ───────────────────────────── Validaciones por paso ───────────────────────────── */
  function validate(step) {
    if (step === 1) {
      if (!S.supplier || (!S.supplier.id && !String(S.supplier.name || '').trim())) return { ok: false, msg: 'Selecciona o captura el proveedor.' };
      if (!S.warehouse_id) return { ok: false, msg: 'Selecciona la bodega de destino.' };
      if (S.inv.duplicate) return { ok: false, msg: 'Esa factura ya fue recibida: quita el XML o carga otra factura.' };
      if (S.origin === 'OC' && !S.po && !S.poFolioManual) return { ok: false, msg: 'Vincula la Orden de Compra (elígela o escanea su folio), o cambia el origen a Compra Directa.' };
      return { ok: true };
    }
    if (step === 2) {
      if (!S.items.length) return { ok: false, msg: 'No hay partidas: carga el XML, vincula una OC o agrega partidas manuales.' };
      var pend = S.items.filter(function (i) { return !i.match; });
      if (pend.length) return { ok: false, jump: S.items.indexOf(pend[0]), msg: 'Faltan ' + pend.length + ' código(s) por homologar (primero: «' + (pend[0].supplier_code || pend[0].description) + '»). Ligálos, dalos de alta o usa «Confirmar alta de TODOS los productos».' };
      var badQ = S.items.filter(function (i) { return !(i.qty_invoiced > 0) || i.unit_cost < 0; });
      if (badQ.length) return { ok: false, msg: 'La partida ' + badQ[0].sku + ' tiene cantidad o costo inválido.' };
      return { ok: true };
    }
    if (step === 3) {
      for (var li = 0; li < S.freight.legs.length; li++) {
        var lg = S.freight.legs[li];
        if (lg.condition === 'PROVEEDOR') continue;
        if (!(legTotal(lg) > 0)) return { ok: false, msg: 'Traslado ' + (li + 1) + ': captura el importe del flete / costos adicionales (o elige «Pagado por el Proveedor»).' };
        if (!String(lg.carrier_name || '').trim()) return { ok: false, msg: 'Traslado ' + (li + 1) + ': captura el nombre del transportista.' };
      }
      var np = S.items.filter(function (i) { return i.update_price && !(i.new_price > 0); });
      if (np.length) return { ok: false, msg: 'Captura un precio válido en ' + np[0].sku + ' o desmarca «actualizar precio».' };
      return { ok: true };
    }
    if (step === 4) {
      var un = S.items.filter(function (i) { return !i.checked; });
      if (un.length) return { ok: false, msg: 'Marca ✔ cada producto verificado (' + un.length + ' sin verificar).' };
      var d = disputes();
      if (d.units > 0) {
        if (S.incident.action !== 'NC' && S.incident.action !== 'REPOSICION') return { ok: false, msg: 'Hay faltantes o daños: elige Nota de Crédito o Cambio Físico / Reposición.' };
        var nf = S.items.filter(function (i) { return i.qty_damaged > 0 && !i.damagePhoto; });
        if (nf.length) return { ok: false, msg: 'El daño de ' + nf[0].sku + ' exige foto de evidencia.' };
      }
      return { ok: true };
    }
    return { ok: true };
  }

  /* ───────────────────────────── CONFIRMAR (paso 5) ───────────────────────────── */
  RH.actions['wz-confirm'] = async function () {
    if (S.busy) return;
    if (!S.authorized) return RH.toast('Marca la autorización para continuar.', 'warn');
    var d = disputes();
    if (!S.sigs.chofer || !S.sigs.almacen) return msg('⚠️ Faltan las firmas del Chofer y del Almacenista.', 'bad');
    if (d.units > 0 && !S.sigs.supervisor) return msg('⚠️ Con incidencias se requiere también la firma del Supervisor.', 'bad');
    var L = landedNow();
    var P = S.inv.parsed;
    var files = [];
    function addF(kind, f, ref) { if (f) files.push({ kind: kind, filename: f.filename, mime: f.mime, b64: f.b64, item_ref: ref || null }); }
    if (S.inv.xmlText) addF('FACTURA_XML', { filename: S.inv.xmlName || 'factura.xml', mime: 'text/xml', b64: RH.textToB64(S.inv.xmlText) });
    addF('FACTURA_PDF', S.inv.pdf);
    S.cartaPorte.forEach(function (f) { addF('CARTA_PORTE', f); });
    S.packing.forEach(function (f) { addF('PACKING_LIST', f); });
    S.freight.legs.forEach(function (l, li) { if (l.condition !== 'PROVEEDOR') { addF('FLETE_XML', l.xml, 'FLETE' + (li + 1)); addF('FLETE_PDF', l.pdf, 'FLETE' + (li + 1)); } });
    S.arrival.forEach(function (f) { addF('FOTO_LLEGADA', f); });
    S.items.forEach(function (it) { if (it.qty_damaged > 0 && it.damagePhoto) addF('FOTO_DANO', it.damagePhoto, it.sku); });
    [['chofer', 'FIRMA_CHOFER'], ['almacen', 'FIRMA_ALMACEN'], ['supervisor', 'FIRMA_SUPERVISOR']].forEach(function (s) {
      if (S.sigs[s[0]]) files.push({ kind: s[1], filename: s[0] + '.png', mime: 'image/png', b64: RH.stripDataUrl(S.sigs[s[0]]) });
    });
    var body = {
      idempotency_key: S.idem, origin_type: S.origin, po_id: S.po ? S.po.id : null, po_folio: S.po ? S.po.folio : (S.poFolioManual || null),
      supplier_id: S.supplier.id || null, supplier_name: S.supplier.name, supplier_rfc: S.supplier.rfc || null, warehouse_id: S.warehouse_id,
      invoice: P ? { uuid: P.uuid, serie: P.serie, folio: P.folio, fecha: P.fecha, metodoPago: P.metodoPago, formaPago: P.formaPago, moneda: P.moneda,
        subtotal: P.subtotal - P.descuento, total: P.total, emisor: P.emisor, receptor: P.receptor } : {},
      payment_condition: S.payment, prorate_method: S.method,
      freight: { legs: S.freight.legs.map(function (l) {
        return { condition: l.condition, carrier_name: l.carrier_name, carrier_rfc: l.carrier_rfc, origin: l.origin, destination: l.destination, doc_uuid: l.doc_uuid, doc_folio: l.doc_folio,
          lines: l.condition === 'PROVEEDOR' ? [] : l.lines.filter(function (x) { return num(x.amount) > 0; }) };
      }) },
      items: S.items.map(function (it, i) {
        recomputeMissing(it);
        return { line_no: it.line_no, supplier_code: it.supplier_code, sku: it.sku, description: it.description, sat_key: it.sat_key, sat_unit: it.sat_unit,
          qty_invoiced: it.qty_invoiced, unit_cost: it.unit_cost, iva_rate: it.iva_rate, qty_ok: it.qty_ok, qty_missing: it.qty_missing, qty_damaged: it.qty_damaged,
          damage_cause: it.damage_cause || null, lot: it.lot || null, expiry: it.expiry || null, checked: !!it.checked,
          unit_weight_kg: it.unit_weight_kg || 0, unit_volume_m3: it.unit_volume_m3 || 0, update_price: !!(it.update_price && it.new_price > 0), new_price: it.new_price || null,
          margin_pct: it.margin_pct || null, homolog_status: it.match.status === 'PREALTA' ? 'PREALTA' : (it.match.status === 'LIGADO' ? 'LIGADO' : 'HOMOLOGADO'),
          homolog_by: it.match.via, purchase_order_item_id: it.poi_id || null, prev_cost: it.prev_cost || 0 };
      }),
      physical: { state: S.physical.state, notes: S.physical.notes }, incident: d.units > 0 ? { action: S.incident.action, status: S.incident.status, notes: S.incident.notes } : {},
      ratings: S.ratings,
      extra: {
        homologation: S.items.map(function (it) { return { codigo: it.supplier_code, descripcion: it.description, sku: it.sku, barcode: it.barcode, via: it.match.via,
          estado: it.match.status === 'HOMOLOGADO' ? 'Homologado (' + it.match.via + ')' : (it.match.status === 'LIGADO' ? 'Ligado manualmente a ' + it.sku : 'Pre-alta de producto nuevo') }; }),
        prealtas: S.prealtas
      },
      files: files
    };
    S.busy = true;
    var btn = $('rh-confirm-btn'); if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Afectando inventario y finanzas…'; }
    try {
      var r = await RH.api('/api/reception-hub/expedientes', { method: 'POST', body: body });
      var skus = S.items.map(function (i) { return i.sku; });
      closeWizard();
      RH.toast('✅ Recepción ' + r.folio + ' confirmada · CxP ' + (r.ap_id ? RH.mxn(r.payable) : 'sin cargo') + (r.expense_folio ? ' · Gasto ' + r.expense_folio : '') + (r.disputed > 0 ? ' · Incidencia abierta' : ''), 'ok');
      try { global.dispatchEvent(new CustomEvent('calebsys:pos-pricing-updated', { detail: { source: 'reception_hub', skus: skus } })); } catch (e) {}
      RH.loadCatalog(true).catch(function () {});
      await RH.refreshAll();
      RH.actions['v-360']({ getAttribute: function () { return r.id; } });
    } catch (e) {
      S.busy = false;
      msg('🚫 No se pudo confirmar: ' + esc(e.message), 'bad'); RH.toast(e.message, 'bad');
      var b2 = $('rh-confirm-btn'); if (b2) { b2.disabled = !S.authorized; b2.innerHTML = '💾 Confirmar Recepción, Afectar Inventario y Enviar a CxP / Gastos'; }
    }
  };
})(window);
