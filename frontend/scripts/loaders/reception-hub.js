/* =============================================================================
   CALEBSYS — Recepción de Mercancía 360° (núcleo + dashboard + visores)
   Archivo: frontend/scripts/loaders/reception-hub.js
   Vista:   #compras-recepciones  (pages/admin/compras-recepciones.html)
   API:     /api/reception-hub/*   (backend/routers/receptions.py)

   Este archivo contiene:
     · utilidades (API, formatos, toasts, eventos delegados)
     · parser real de XML CFDI 4.0 y generador de XML de demostración
     · motor de Costeo Real (Landed Cost) idéntico al del backend
     · Dashboard (KPIs, filtros, tabla histórica con acciones de 1 clic)
     · Visores: Factura XML/PDF, Evidencias, Incidencia/NC y Expediente 360°
   El asistente de 5 pasos vive en reception-wizard.js (comparte window.RH).
   ============================================================================= */
(function (global) {
  'use strict';

  var RH = global.RH = global.RH || {};
  RH.actions = RH.actions || {};   // data-rh="accion"      (click)
  RH.inputs  = RH.inputs  || {};   // data-rhin="nombre"    (input)
  RH.changes = RH.changes || {};   // data-rhch="nombre"    (change)
  RH.keys    = RH.keys    || {};   // data-rhkd="nombre"    (keydown)
  RH.rows = [];
  RH.catalog = [];

  /* ───────────────────────────── Utilidades ───────────────────────────── */
  RH.$ = function (id) { return document.getElementById(id); };
  RH.esc = function (s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (m) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m];
    });
  };
  RH.num = function (v) { var n = parseFloat(v); return isFinite(n) ? n : 0; };
  RH.r2 = function (n) { return Math.round((RH.num(n) + 1e-9) * 100) / 100; };
  RH.r4 = function (n) { return Math.round((RH.num(n) + 1e-9) * 10000) / 10000; };
  RH.mxn = function (n) {
    return '$' + RH.num(n).toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  };
  RH.fmtDate = function (iso, withTime) {
    if (!iso) return '—';
    var s = String(iso);
    if (!/[zZ]|[+-]\d\d:?\d\d$/.test(s) && s.indexOf('T') > -1) s += 'Z';
    var d = new Date(s.indexOf('T') === -1 ? s.replace(' ', 'T') + 'Z' : s);
    if (isNaN(d.getTime())) return String(iso).slice(0, 16);
    var o = { day: '2-digit', month: '2-digit', year: 'numeric' };
    if (withTime !== false) { o.hour = '2-digit'; o.minute = '2-digit'; }
    return d.toLocaleString('es-MX', o);
  };
  RH.uuid = function () {
    var h = '0123456789ABCDEF', out = '';
    for (var i = 0; i < 36; i++) {
      if (i === 8 || i === 13 || i === 18 || i === 23) out += '-';
      else out += h[Math.floor(Math.random() * 16)];
    }
    return out;
  };
  RH.token = function () {
    var keys = ['calebsys_token', 'auth_token', 'session_token', 'token'];
    for (var i = 0; i < keys.length; i++) {
      var v = null;
      try { v = sessionStorage.getItem(keys[i]) || localStorage.getItem(keys[i]); } catch (e) {}
      if (v) return v;
    }
    return '';
  };
  function detailMsg(d) {
    if (!d) return '';
    if (typeof d === 'string') return d;
    if (Array.isArray(d)) return d.map(function (x) { return (x && (x.msg || x.message)) || JSON.stringify(x); }).join('; ');
    return JSON.stringify(d);
  }
  RH.api = async function (path, opts) {
    opts = opts || {};
    var headers = Object.assign({ 'Accept': 'application/json' }, opts.headers || {});
    var tk = RH.token();
    if (tk) headers.Authorization = 'Bearer ' + tk;
    var init = { method: opts.method || 'GET', headers: headers, credentials: 'include' };
    if (opts.body !== undefined) { headers['Content-Type'] = 'application/json'; init.body = JSON.stringify(opts.body); }
    var res = await fetch(path, init);
    if (!res.ok) {
      var msg = 'Error ' + res.status;
      try { var j = await res.json(); msg = detailMsg(j.detail) || msg; } catch (e) {}
      var err = new Error(msg); err.status = res.status; throw err;
    }
    if (opts.raw) return res;
    return res.json();
  };
  RH.toast = function (msg, kind) {
    var box = RH.$('rh-toast');
    if (!box) { if (typeof global.showToast === 'function') global.showToast(msg, kind === 'bad' ? 'error' : (kind || 'info')); return; }
    var el = document.createElement('div');
    el.className = kind || 'info';
    el.textContent = msg;
    box.appendChild(el);
    setTimeout(function () { if (el.parentNode) el.parentNode.removeChild(el); }, kind === 'bad' ? 7000 : 4200);
  };
  RH.stars = function (avg) {
    var n = Math.round(RH.num(avg));
    if (!(RH.num(avg) > 0)) return '<span class="rh-muted">Sin calificar</span>';
    var out = '';
    for (var i = 1; i <= 5; i++) out += i <= n ? '★' : '<span class="off">★</span>';
    return '<span class="rh-stars" title="' + RH.num(avg).toFixed(2) + ' / 5">' + out + '</span> <span class="rh-muted">' + RH.num(avg).toFixed(1) + '</span>';
  };
  RH.readText = function (file) {
    return new Promise(function (resolve, reject) {
      var r = new FileReader();
      r.onload = function () { resolve(String(r.result || '')); };
      r.onerror = function () { reject(new Error('No se pudo leer «' + file.name + '».')); };
      r.readAsText(file);
    });
  };
  RH.readDataUrl = function (file) {
    return new Promise(function (resolve, reject) {
      var r = new FileReader();
      r.onload = function () { resolve(String(r.result || '')); };
      r.onerror = function () { reject(new Error('No se pudo leer «' + file.name + '».')); };
      r.readAsDataURL(file);
    });
  };
  RH.textToB64 = function (text) {
    try { return btoa(unescape(encodeURIComponent(text))); } catch (e) { return btoa(text); }
  };
  RH.stripDataUrl = function (d) { var i = String(d || '').indexOf(','); return i > -1 ? d.slice(i + 1) : d; };
  /** Reduce una imagen a JPEG (máx. 1280 px) para que el expediente pese poco. Devuelve {filename,mime,b64,dataUrl}. */
  RH.imageToJpeg = function (file, maxDim, quality) {
    maxDim = maxDim || 1280; quality = quality || 0.72;
    return RH.readDataUrl(file).then(function (dataUrl) {
      return new Promise(function (resolve) {
        var img = new Image();
        img.onload = function () {
          try {
            var w = img.width, h = img.height, k = Math.min(1, maxDim / Math.max(w, h));
            var c = document.createElement('canvas');
            c.width = Math.max(1, Math.round(w * k)); c.height = Math.max(1, Math.round(h * k));
            c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
            var out = c.toDataURL('image/jpeg', quality);
            resolve({ filename: file.name.replace(/\.[^.]+$/, '') + '.jpg', mime: 'image/jpeg', b64: RH.stripDataUrl(out), dataUrl: out });
          } catch (e) {
            resolve({ filename: file.name, mime: file.type || 'image/jpeg', b64: RH.stripDataUrl(dataUrl), dataUrl: dataUrl });
          }
        };
        img.onerror = function () {
          resolve({ filename: file.name, mime: file.type || 'image/jpeg', b64: RH.stripDataUrl(dataUrl), dataUrl: dataUrl });
        };
        img.src = dataUrl;
      });
    });
  };

  /* ───────────────────────────── Catálogo ───────────────────────────── */
  RH.loadCatalog = async function (force) {
    if (!force && RH.catalog.length) return RH.catalog;
    var list = await RH.api('/api/products/search?limit=500');
    RH.catalog = Array.isArray(list) ? list : [];
    global._productsCatalogCache = RH.catalog;
    return RH.catalog;
  };
  RH.pMeta = function (p) { return (p && p.meta_data && typeof p.meta_data === 'object') ? p.meta_data : {}; };
  RH.pAlt = function (p) { return String((p && p.sales_code) || RH.pMeta(p).codigo_alterno || '').trim().toUpperCase(); };
  RH.pLogistics = function (p) {
    var f4 = RH.pMeta(p).complements_f4;
    return (f4 && f4.logistics && typeof f4.logistics === 'object') ? f4.logistics : {};
  };
  RH.noZeros = function (s) { return String(s || '').trim().toUpperCase().replace(/^0+/, ''); };

  /* ───────────────────────── Parser CFDI 4.0 (XML) ───────────────────────── */
  function attr(node, name) { return node && node.getAttribute ? (node.getAttribute(name) || '') : ''; }
  function childrenByName(parent, name) {
    var out = [];
    if (!parent) return out;
    for (var i = 0; i < parent.childNodes.length; i++) {
      var n = parent.childNodes[i];
      if (n.nodeType === 1 && (n.localName || n.nodeName.split(':').pop()) === name) out.push(n);
    }
    return out;
  }
  function firstDeep(root, name) {
    var l = root.getElementsByTagNameNS ? root.getElementsByTagNameNS('*', name) : [];
    return l && l.length ? l[0] : null;
  }

  RH.parseCfdi = function (xmlText) {
    var doc = new DOMParser().parseFromString(String(xmlText || '').replace(/^\uFEFF/, ''), 'application/xml');
    if (doc.getElementsByTagName('parsererror').length) throw new Error('El archivo XML está mal formado o no es un XML válido.');
    var root = doc.documentElement;
    var rootName = root ? (root.localName || root.nodeName.split(':').pop()) : '';
    if (rootName !== 'Comprobante') throw new Error('No parece un CFDI: no se encontró el nodo <cfdi:Comprobante>.');

    var warnings = [];
    var version = attr(root, 'Version') || attr(root, 'version');
    if (version && version !== '4.0') warnings.push('La factura es CFDI ' + version + ' (se esperaba 4.0); se leyó igualmente.');
    var tipo = attr(root, 'TipoDeComprobante') || attr(root, 'tipoDeComprobante');
    if (tipo && tipo !== 'I') warnings.push('El comprobante es de tipo «' + tipo + '» (no es Ingreso). Verifica que sea la factura de compra.');

    var moneda = attr(root, 'Moneda') || 'MXN';
    var tc = RH.num(attr(root, 'TipoCambio')) || 1;
    if (moneda !== 'MXN' && moneda !== 'XXX') {
      if (!(RH.num(attr(root, 'TipoCambio')) > 0)) warnings.push('Factura en ' + moneda + ' sin tipo de cambio: se tomó 1.00.');
      else warnings.push('Factura en ' + moneda + ': importes convertidos a MXN con T.C. ' + tc + '.');
    } else { tc = 1; }

    var emisor = firstDeep(root, 'Emisor'), receptor = firstDeep(root, 'Receptor');
    var timbre = firstDeep(root, 'TimbreFiscalDigital');
    var uuid = (attr(timbre, 'UUID') || '').toUpperCase();
    if (!uuid) warnings.push('El CFDI no trae Timbre Fiscal Digital (UUID): no se puede validar contra el SAT.');

    var conceptosNode = firstDeep(root, 'Conceptos');
    var concepts = [];
    childrenByName(conceptosNode, 'Concepto').forEach(function (c, idx) {
      var qty = RH.num(attr(c, 'Cantidad'));
      var amount = RH.num(attr(c, 'Importe'));
      var disc = RH.num(attr(c, 'Descuento'));
      var vu = RH.num(attr(c, 'ValorUnitario'));
      var netUnit = qty > 0 ? (amount - disc) / qty : vu;
      var ivaRate = 0, ivaAmount = 0, hasIva = false;
      var imp = childrenByName(c, 'Impuestos')[0];
      var tras = imp ? childrenByName(childrenByName(imp, 'Traslados')[0], 'Traslado') : [];
      tras.forEach(function (t) {
        if (attr(t, 'Impuesto') === '002') {
          if (attr(t, 'TipoFactor') === 'Exento') { hasIva = true; return; }
          ivaRate = RH.num(attr(t, 'TasaOCuota')); ivaAmount += RH.num(attr(t, 'Importe')); hasIva = true;
        }
      });
      if (!hasIva && attr(c, 'ObjetoImp') === '02') ivaRate = 0.16;
      concepts.push({
        line_no: idx + 1,
        code: (attr(c, 'NoIdentificacion') || '').trim().toUpperCase(),
        sat_key: attr(c, 'ClaveProdServ'), sat_unit: attr(c, 'ClaveUnidad'), unit_name: attr(c, 'Unidad'),
        qty: qty, description: attr(c, 'Descripcion'),
        unit_value: RH.r4(vu * tc), amount: RH.r2(amount * tc), discount: RH.r2(disc * tc),
        net_unit: RH.r4(netUnit * tc), iva_rate: ivaRate, iva_amount: RH.r2(ivaAmount * tc),
        object_imp: attr(c, 'ObjetoImp')
      });
    });
    if (!concepts.length) throw new Error('El CFDI no contiene conceptos (<cfdi:Concepto>).');

    var impTot = childrenByName(root, 'Impuestos')[0];
    var out = {
      version: version, tipo: tipo, serie: attr(root, 'Serie'), folio: attr(root, 'Folio'),
      fecha: attr(root, 'Fecha'), formaPago: attr(root, 'FormaPago'), metodoPago: attr(root, 'MetodoPago'),
      moneda: moneda, tipoCambio: tc, lugar: attr(root, 'LugarExpedicion'),
      subtotal: RH.r2(RH.num(attr(root, 'SubTotal')) * tc), descuento: RH.r2(RH.num(attr(root, 'Descuento')) * tc),
      total: RH.r2(RH.num(attr(root, 'Total')) * tc),
      totalTraslados: RH.r2(RH.num(attr(impTot, 'TotalImpuestosTrasladados')) * tc),
      emisor: { rfc: (attr(emisor, 'Rfc') || '').toUpperCase(), nombre: attr(emisor, 'Nombre'), regimen: attr(emisor, 'RegimenFiscal') },
      receptor: { rfc: (attr(receptor, 'Rfc') || '').toUpperCase(), nombre: attr(receptor, 'Nombre'), uso: attr(receptor, 'UsoCFDI') },
      uuid: uuid, fechaTimbrado: attr(timbre, 'FechaTimbrado'), concepts: concepts, warnings: warnings
    };
    var calcSub = concepts.reduce(function (s, c) { return s + c.amount - c.discount; }, 0);
    if (out.subtotal > 0 && Math.abs(out.subtotal - out.descuento - calcSub) > 1) {
      warnings.push('La suma de los conceptos (' + RH.mxn(calcSub) + ') no coincide con el SubTotal del CFDI (' + RH.mxn(out.subtotal) + ').');
    }
    return out;
  };

  /** Forma de pago SAT → condición de pago de la recepción. */
  RH.paymentFromCfdi = function (c) {
    if (!c) return 'CREDITO';
    if (c.metodoPago === 'PPD') return 'CREDITO';
    if (c.formaPago === '03') return 'TRANSFERENCIA';
    return 'CONTADO';
  };

  /** XML de demostración (Proveedor Ferretero) para probar el flujo completo en 1 clic. */
  RH.buildDemoXml = function () {
    var uuid = RH.uuid();
    var folio = String(1000 + Math.floor(Math.random() * 9000));
    var fecha = new Date().toISOString().slice(0, 19);
    var lines = [
      { code: 'CEM-50K',   sat: '30111601', unit: 'XSA', unitName: 'Saco',  qty: 100, desc: 'Cemento gris 50 kg',                  vu: 185.00 },
      { code: 'CGU-VR38',  sat: '30102000', unit: 'H87', unitName: 'Pieza', qty: 200, desc: 'Varilla corrugada 3/8 x 12 m',        vu: 95.00 },
      { code: 'CGU-PVC4',  sat: '40141700', unit: 'H87', unitName: 'Pieza', qty: 50,  desc: 'Tubo PVC sanitario 4 pulg x 6 m',     vu: 142.50 },
      { code: 'CGU-MOR25', sat: '30111601', unit: 'XSA', unitName: 'Saco',  qty: 80,  desc: 'Mortero adhesivo gris 25 kg',         vu: 78.40 },
      { code: 'BLO-15X20', sat: '30131500', unit: 'H87', unitName: 'Pieza', qty: 500, desc: 'Block de concreto 15x20x40',          vu: 9.50 }
    ];
    var sub = 0, iva = 0, cx = '';
    lines.forEach(function (l) {
      var imp = RH.r2(l.qty * l.vu), t = RH.r2(imp * 0.16);
      sub += imp; iva += t;
      cx += '<cfdi:Concepto ClaveProdServ="' + l.sat + '" NoIdentificacion="' + l.code + '" Cantidad="' + l.qty.toFixed(2) + '" ClaveUnidad="' + l.unit +
        '" Unidad="' + l.unitName + '" Descripcion="' + RH.esc(l.desc) + '" ValorUnitario="' + l.vu.toFixed(2) + '" Importe="' + imp.toFixed(2) + '" ObjetoImp="02">' +
        '<cfdi:Impuestos><cfdi:Traslados><cfdi:Traslado Base="' + imp.toFixed(2) + '" Impuesto="002" TipoFactor="Tasa" TasaOCuota="0.160000" Importe="' + t.toFixed(2) + '"/></cfdi:Traslados></cfdi:Impuestos>' +
        '</cfdi:Concepto>';
    });
    sub = RH.r2(sub); iva = RH.r2(iva);
    return '<?xml version="1.0" encoding="UTF-8"?>\n' +
      '<cfdi:Comprobante xmlns:cfdi="http://www.sat.gob.mx/cfd/4" xmlns:tfd="http://www.sat.gob.mx/TimbreFiscalDigital" Version="4.0" Serie="FH" Folio="' + folio +
      '" Fecha="' + fecha + '" FormaPago="99" MetodoPago="PPD" SubTotal="' + sub.toFixed(2) + '" Moneda="MXN" Total="' + RH.r2(sub + iva).toFixed(2) +
      '" TipoDeComprobante="I" Exportacion="01" LugarExpedicion="44100">' +
      '<cfdi:Emisor Rfc="CGU830512HJ4" Nombre="Cementos Guadalajara S.A. de C.V." RegimenFiscal="601"/>' +
      '<cfdi:Receptor Rfc="MMM9801019X3" Nombre="Maderas y Materiales Magdaleno" DomicilioFiscalReceptor="44100" RegimenFiscalReceptor="601" UsoCFDI="G01"/>' +
      '<cfdi:Conceptos>' + cx + '</cfdi:Conceptos>' +
      '<cfdi:Impuestos TotalImpuestosTrasladados="' + iva.toFixed(2) + '"><cfdi:Traslados><cfdi:Traslado Base="' + sub.toFixed(2) +
      '" Impuesto="002" TipoFactor="Tasa" TasaOCuota="0.160000" Importe="' + iva.toFixed(2) + '"/></cfdi:Traslados></cfdi:Impuestos>' +
      '<cfdi:Complemento><tfd:TimbreFiscalDigital Version="1.1" UUID="' + uuid + '" FechaTimbrado="' + fecha + '" RfcProvCertif="SPR190613I52" SelloCFD="DEMO" NoCertificadoSAT="00001000000504465028" SelloSAT="DEMO"/></cfdi:Complemento>' +
      '</cfdi:Comprobante>';
  };

  /* ──────────────── Costeo Real (Landed Cost) — igual que el backend ──────────────── */
  /** Cantidad base del costeo: lo recibido sano si ya hubo inspección, si no, lo facturado. */
  RH.costQty = function (it, inspected) { return inspected ? RH.num(it.qty_ok) : RH.num(it.qty_invoiced); };

  RH.computeLanded = function (items, freightTotal, method, inspected) {
    var m = method || 'IMPORTE';
    function baseOf(it, mm) {
      var q = RH.costQty(it, inspected);
      if (mm === 'IMPORTE') return q * RH.num(it.unit_cost);
      if (mm === 'CANTIDAD') return q;
      if (mm === 'PESO') return q * RH.num(it.unit_weight_kg);
      if (mm === 'VOLUMEN') return q * RH.num(it.unit_volume_m3);
      return 0;
    }
    var used = m;
    var bases = items.map(function (it) { return baseOf(it, used); });
    var sum = bases.reduce(function (a, b) { return a + b; }, 0);
    var fallback = false;
    if (sum <= 0 && used !== 'IMPORTE') { used = 'IMPORTE'; fallback = true; bases = items.map(function (it) { return baseOf(it, used); }); sum = bases.reduce(function (a, b) { return a + b; }, 0); }
    var rows = items.map(function (it, i) {
      var q = RH.costQty(it, inspected);
      var alloc = (freightTotal > 0 && sum > 0 && bases[i] > 0) ? freightTotal * bases[i] / sum : 0;
      var fpu = q > 0 ? alloc / q : 0;
      return { alloc: alloc, fpu: fpu, landed: RH.num(it.unit_cost) + fpu, base: bases[i] };
    });
    return { methodUsed: used, fallback: fallback, baseTotal: sum, rows: rows };
  };

  /* ───────────────────── Eventos delegados + ESC global ───────────────────── */
  RH.bindRoot = function () {
    var root = RH.$('rh-app');
    if (!root || root.__rhBound) return;
    root.__rhBound = true;
    root.addEventListener('click', function (e) {
      var el = e.target.closest('[data-rh]');
      if (!el || !root.contains(el)) return;
      var fn = RH.actions[el.getAttribute('data-rh')];
      if (typeof fn === 'function') fn(el, e);
    });
    root.addEventListener('input', function (e) {
      var el = e.target.closest('[data-rhin]');
      if (!el) return;
      var fn = RH.inputs[el.getAttribute('data-rhin')];
      if (typeof fn === 'function') fn(el, e);
    });
    root.addEventListener('change', function (e) {
      var el = e.target.closest('[data-rhch]');
      if (!el) return;
      var fn = RH.changes[el.getAttribute('data-rhch')];
      if (typeof fn === 'function') fn(el, e);
    });
    root.addEventListener('keydown', function (e) {
      var el = e.target.closest('[data-rhkd]');
      if (!el) return;
      var fn = RH.keys[el.getAttribute('data-rhkd')];
      if (typeof fn === 'function') fn(el, e);
    });
    ['dragover', 'dragenter'].forEach(function (ev) {
      root.addEventListener(ev, function (e) {
        var z = e.target.closest && e.target.closest('[data-rh-drop]');
        if (z) { e.preventDefault(); z.classList.add('over'); }
      });
    });
    root.addEventListener('dragleave', function (e) {
      var z = e.target.closest && e.target.closest('[data-rh-drop]');
      if (z) z.classList.remove('over');
    });
    root.addEventListener('drop', function (e) {
      var z = e.target.closest && e.target.closest('[data-rh-drop]');
      if (!z) return;
      e.preventDefault(); z.classList.remove('over');
      var fn = RH.actions['drop:' + z.getAttribute('data-rh-drop')];
      if (typeof fn === 'function') fn(z, e.dataTransfer ? e.dataTransfer.files : []);
    });
  };

  if (!global.__rhEscBound) {
    global.__rhEscBound = true;
    document.addEventListener('keydown', function (e) {
      if (e.key !== 'Escape' || !RH.$('rh-app')) return;
      var lb = RH.$('rh-lightbox'), vw = RH.$('rh-viewer'), wz = RH.$('rh-wizard');
      if (lb && lb.classList.contains('open')) { lb.classList.remove('open'); e.stopPropagation(); return; }
      if (vw && vw.classList.contains('open')) { RH.closeViewer(); e.stopPropagation(); return; }
      if (wz && wz.classList.contains('open')) { if (typeof RH.wizardRequestClose === 'function') RH.wizardRequestClose(); e.stopPropagation(); }
    }, true);
  }

  /* ───────────────────────────── Dashboard ───────────────────────────── */
  var ORIGIN_LBL = {
    OC: '🏢 Compra c/ OC', DIRECTA: '⚡ Compra directa', TRASPASO: '🔄 Traspaso',
    REPOSICION: '↩️ Reposición', CONSIGNACION: '🤝 Consignación'
  };
  RH.ORIGIN_LBL = ORIGIN_LBL;

  function statusBadge(s) {
    return ({
      COMPLETA: '<span class="rh-badge ok">✔ Completa</span>',
      RESUELTA: '<span class="rh-badge ok">✔ Incidencia resuelta</span>',
      INCIDENCIA: '<span class="rh-badge warn">⚠ Con incidencia / faltantes</span>',
      NC_PENDIENTE: '<span class="rh-badge bad">📄 NC pendiente</span>'
    })[s] || '<span class="rh-badge gray">' + RH.esc(s) + '</span>';
  }
  function physBadge(s) {
    return ({
      SELLADA: '<span class="rh-badge ok">🟢 Íntegra / sellada</span>',
      VIOLADA: '<span class="rh-badge warn">🟡 Empaque violado</span>',
      DANADA: '<span class="rh-badge bad">🔴 Golpeada / mojada</span>'
    })[s] || '<span class="rh-badge gray">' + RH.esc(s) + '</span>';
  }
  RH.statusBadge = statusBadge; RH.physBadge = physBadge;

  function payCell(r) {
    if (r.ap) {
      var map = { PENDING: ['warn', 'CxP pendiente'], PARTIAL: ['info', 'CxP parcial'], PAID: ['ok', 'CxP pagada'], OVERDUE: ['bad', 'CxP vencida'] };
      var m = map[r.ap.status] || ['gray', r.ap.status];
      return '<span class="rh-badge ' + m[0] + '">💳 ' + m[1] + '</span><div class="rh-muted">Saldo ' + RH.mxn(r.ap.balance) + '</div>';
    }
    return ({
      CONTADO: '<span class="rh-badge ok">💵 Contado (caja)</span>',
      TRANSFERENCIA: '<span class="rh-badge ok">🏦 Transferencia</span>',
      SIN_CARGO: '<span class="rh-badge gray">Sin cargo</span>'
    })[r.payment_condition] || '<span class="rh-badge gray">' + RH.esc(r.payment_condition) + '</span>';
  }

  RH.loadSummary = async function () {
    try {
      var s = await RH.api('/api/reception-hub/summary');
      RH.$('rh-k1').textContent = s.month.count + ' recep.';
      RH.$('rh-k1s').textContent = RH.mxn(s.month.amount) + ' acumulado del mes';
      RH.$('rh-k2').textContent = RH.num(s.freight.avg_pct).toFixed(2) + '%';
      RH.$('rh-k2s').textContent = RH.mxn(s.freight.amount) + ' en flete / maniobras del mes';
      RH.$('rh-k3').textContent = s.incidents.count + ' pendientes';
      RH.$('rh-k3s').textContent = RH.mxn(s.incidents.amount) + ' en disputa con proveedores';
      RH.$('rh-k4').innerHTML = s.rating.count ? RH.num(s.rating.avg).toFixed(1) + ' <span style="font-size:15px;" class="rh-stars">★</span>' : '—';
      var top = (s.rating.ranking || [])[0];
      RH.$('rh-k4s').textContent = s.rating.count
        ? (s.rating.count + ' entregas calificadas' + (top ? ' · mejor: ' + top.supplier : ''))
        : 'Aún sin entregas calificadas';
      RH.summary = s;
    } catch (e) {
      ['rh-k1s', 'rh-k2s', 'rh-k3s', 'rh-k4s'].forEach(function (id) { if (RH.$(id)) RH.$(id).textContent = 'No se pudo cargar (' + e.message + ')'; });
    }
  };

  RH.loadList = async function () {
    var tb = RH.$('rh-tbody');
    if (!tb) return;
    var q = (RH.$('rh-search') || {}).value || '';
    var st = (RH.$('rh-status') || {}).value || '';
    try {
      var rows = await RH.api('/api/reception-hub/expedientes?limit=300&q=' + encodeURIComponent(q.trim()) + '&status=' + encodeURIComponent(st));
      RH.rows = Array.isArray(rows) ? rows : [];
      RH.renderList();
    } catch (e) {
      tb.innerHTML = '<tr><td colspan="10" style="text-align:center;padding:30px;color:#b91c1c;">No se pudo cargar: ' + RH.esc(e.message) + '</td></tr>';
    }
  };

  RH.renderList = function () {
    var tb = RH.$('rh-tbody');
    if (!tb) return;
    var rows = RH.rows || [];
    var c = RH.$('rh-count'); if (c) c.textContent = rows.length + ' recepción(es)';
    if (!rows.length) {
      tb.innerHTML = '<tr><td colspan="10" style="text-align:center;padding:36px;color:var(--text-muted);">Sin recepciones registradas. Pulsa <b>+ Registrar Recepción</b> para iniciar el asistente.</td></tr>';
      return;
    }
    tb.innerHTML = rows.map(function (r) {
      var fl = r.freight_total > 0
        ? '<b>' + RH.mxn(r.freight_total) + '</b><div class="rh-muted">' + RH.num(r.freight_pct).toFixed(2) + '% · ' +
          ({ CONTADO: 'contado', POR_COBRAR: 'por cobrar', CREDITO: 'a crédito', MIXTO: 'varios traslados' }[r.freight_condition] || '') + '</div>'
        : '<span class="rh-muted">Sin costo para nosotros</span>';
      var inv = r.invoice_uuid || r.invoice_folio
        ? '<div class="rh-mono" style="font-weight:800;">' + RH.esc((r.invoice_serie || '') + (r.invoice_folio || '—')) + '</div><div class="rh-muted rh-mono" title="' + RH.esc(r.invoice_uuid || '') + '">' + RH.esc((r.invoice_uuid || '').slice(0, 13)) + (r.invoice_uuid ? '…' : '') + '</div>'
        : '<span class="rh-muted">Sin factura</span>';
      var inc = r.incident_status && r.incident_status !== 'NINGUNA';
      return '<tr>' +
        '<td><b class="rh-mono">' + RH.esc(r.folio) + '</b><div class="rh-muted">' + RH.fmtDate(r.created_at) + '</div>' + (r.receipt_folio ? '<div class="rh-muted">' + RH.esc(r.receipt_folio) + '</div>' : '') + '</td>' +
        '<td>' + (ORIGIN_LBL[r.origin_type] || RH.esc(r.origin_type)) + (r.po_folio ? '<div class="rh-muted rh-mono">' + RH.esc(r.po_folio) + '</div>' : '') + '</td>' +
        '<td><b>' + RH.esc(r.supplier_name) + '</b><div class="rh-muted rh-mono">' + RH.esc(r.supplier_rfc || '') + '</div></td>' +
        '<td>' + inv + '</td>' +
        '<td class="rh-num">' + fl + '</td>' +
        '<td>' + physBadge(r.physical_state) + '<div style="margin-top:3px;">' + statusBadge(r.status) + '</div></td>' +
        '<td>' + RH.stars(r.rating_avg) + '</td>' +
        '<td class="rh-num"><b>' + RH.mxn(r.total) + '</b>' + (r.disputed_amount > 0 ? '<div class="rh-muted" style="color:#b91c1c;">en disputa ' + RH.mxn(r.disputed_amount) + '</div>' : '') + '</td>' +
        '<td>' + payCell(r) + '</td>' +
        '<td><div class="rh-actions">' +
          '<button type="button" class="rh-ico-btn" title="Factura XML/PDF (mercancía y flete)" data-rh="v-invoice" data-id="' + r.id + '">📄</button>' +
          '<button type="button" class="rh-ico-btn" title="Evidencias: fotos del camión, daños y firmas" data-rh="v-evidence" data-id="' + r.id + '">📷' + (r.evidence_count ? '<span class="rh-dot">' + r.evidence_count + '</span>' : '') + '</button>' +
          '<button type="button" class="rh-ico-btn" title="Incidencia / Nota de Crédito" data-rh="v-incident" data-id="' + r.id + '"' + (inc ? '' : ' disabled') + '>⚠️' + (inc && (r.status === 'INCIDENCIA' || r.status === 'NC_PENDIENTE') ? '<span class="rh-dot">!</span>' : '') + '</button>' +
          '<button type="button" class="rh-ico-btn" title="Expediente 360° (13 puntos de auditoría)" data-rh="v-360" data-id="' + r.id + '">📂</button>' +
        '</div></td></tr>';
    }).join('');
  };

  RH.refreshAll = function () { return Promise.all([RH.loadSummary(), RH.loadList()]); };

  var _searchTimer = null;
  RH.inputs['search'] = function () { clearTimeout(_searchTimer); _searchTimer = setTimeout(RH.loadList, 280); };
  RH.changes['status'] = function () { RH.loadList(); };
  RH.actions['refresh'] = function () { RH.refreshAll(); };

  RH.initPage = function () {
    RH.bindRoot();
    var s = RH.$('rh-search'), st = RH.$('rh-status');
    if (s && !s.__rhB) { s.__rhB = true; s.setAttribute('data-rhin', 'search'); }
    if (st && !st.__rhB) { st.__rhB = true; st.setAttribute('data-rhch', 'status'); }
    RH.refreshAll();
    RH.loadCatalog().catch(function () {});
    if (global._rhWizardReturn && typeof RH.wizardResume === 'function') RH.wizardResume();
  };

  /* ───────────────────────────── Visor genérico ───────────────────────────── */
  RH.openViewer = function (title, bodyHtml, footHtml, narrow) {
    var v = RH.$('rh-viewer'); if (!v) return;
    RH.$('rh-viewer-title').innerHTML = title;
    RH.$('rh-viewer-body').innerHTML = bodyHtml;
    RH.$('rh-viewer-foot').innerHTML = footHtml || '<span></span><button type="button" class="rh-btn" data-rh="viewer-close">Cerrar [ESC]</button>';
    RH.$('rh-viewer-dlg').classList.toggle('narrow', !!narrow);
    v.classList.add('open'); v.setAttribute('aria-hidden', 'false');
  };
  RH.closeViewer = function () {
    var v = RH.$('rh-viewer'); if (v) { v.classList.remove('open'); v.setAttribute('aria-hidden', 'true'); }
  };
  RH.actions['viewer-close'] = RH.closeViewer;
  RH.actions['lightbox-close'] = function () { var l = RH.$('rh-lightbox'); if (l) l.classList.remove('open'); };
  RH.actions['lightbox'] = function (el) {
    var l = RH.$('rh-lightbox'), i = RH.$('rh-lightbox-img'); if (!l || !i) return;
    var im = el.querySelector('img'); if (!im || !im.src) return;
    i.src = im.src; l.classList.add('open');
  };

  var _blobCache = {};
  RH.fileBlob = async function (fileId) {
    if (_blobCache[fileId]) return _blobCache[fileId];
    var res = await RH.api('/api/reception-hub/files/' + fileId, { raw: true });
    var blob = await res.blob();
    _blobCache[fileId] = blob;
    return blob;
  };
  RH.fileUrl = async function (fileId) { return URL.createObjectURL(await RH.fileBlob(fileId)); };
  RH.fileText = async function (fileId) { return (await RH.fileBlob(fileId)).text(); };
  RH.fileDataUrl = async function (fileId) {
    var blob = await RH.fileBlob(fileId);
    return new Promise(function (resolve, reject) {
      var r = new FileReader(); r.onload = function () { resolve(String(r.result)); }; r.onerror = reject; r.readAsDataURL(blob);
    });
  };
  RH.download = async function (fileId, filename) {
    var url = await RH.fileUrl(fileId);
    var a = document.createElement('a'); a.href = url; a.download = filename || 'archivo';
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
  };
  RH.fillImages = function (container) {
    var imgs = container.querySelectorAll('img[data-fid]');
    Array.prototype.forEach.call(imgs, function (img) {
      RH.fileUrl(img.getAttribute('data-fid')).then(function (u) { img.src = u; }).catch(function () { img.alt = 'No disponible'; });
    });
  };

  RH.detail = async function (id) { return RH.api('/api/reception-hub/expedientes/' + id); };

  function kv(pairs) {
    return '<dl class="rh-kv">' + pairs.filter(function (p) { return p; }).map(function (p) {
      return '<dt>' + RH.esc(p[0]) + '</dt><dd>' + (p[2] ? p[1] : RH.esc(p[1] == null || p[1] === '' ? '—' : p[1])) + '</dd>';
    }).join('') + '</dl>';
  }
  function tbl(heads, rows, numCols) {
    numCols = numCols || [];
    if (!rows.length) return '<div class="rh-muted" style="padding:6px 0;">Sin registros.</div>';
    return '<div class="rh-table-wrap" style="margin-top:8px;"><table class="rh-table"><thead><tr>' + heads.map(function (h, i) {
      return '<th' + (numCols.indexOf(i) > -1 ? ' class="rh-num"' : '') + '>' + RH.esc(h) + '</th>';
    }).join('') + '</tr></thead><tbody>' + rows.map(function (r) {
      return '<tr>' + r.map(function (c, i) { return '<td' + (numCols.indexOf(i) > -1 ? ' class="rh-num"' : '') + '>' + (c == null ? '—' : c) + '</td>'; }).join('') + '</tr>';
    }).join('') + '</tbody></table></div>';
  }
  RH.kv = kv; RH.tbl = tbl;

  var KIND_LBL = {
    FACTURA_XML: 'Factura de mercancía (XML)', FACTURA_PDF: 'Factura de mercancía (PDF)', FLETE_XML: 'Factura de flete (XML)',
    FLETE_PDF: 'Factura de flete (PDF)', CARTA_PORTE: 'Carta Porte', PACKING_LIST: 'Packing List / Remisión',
    FOTO_LLEGADA: 'Foto de llegada del camión / tarimas', FOTO_DANO: 'Foto de evidencia de daño',
    FIRMA_CHOFER: 'Firma del Chofer / Transportista', FIRMA_ALMACEN: 'Firma del Almacenista', FIRMA_SUPERVISOR: 'Firma de Supervisor'
  };
  RH.KIND_LBL = KIND_LBL;
  RH.incLbl = function (s) {
    return ({ NINGUNA: 'Sin incidencia', ABIERTO: 'Abierto', EN_PROCESO: 'En proceso', NC_APLICADA: 'Nota de crédito aplicada', REPOSICION_RECIBIDA: 'Reposición recibida', CONCLUIDO: 'Concluido' })[s] || s;
  };

  /* ───────────────────────── Visor 1: Factura XML / PDF ───────────────────────── */
  RH.actions['v-invoice'] = async function (el) {
    var id = el.getAttribute('data-id');
    try {
      var D = await RH.detail(id);
      var P = D.payload || {}, F = P.p3_factura || {}, FL = P.p7_flete || {};
      var files = D.files_list || [];
      function fileBtns(kinds, ref) {
        var out = '';
        kinds.forEach(function (k) {
          files.filter(function (f) { return f.kind === k && (!ref || f.item_ref === ref); }).forEach(function (f) {
            var isPdf = /pdf/i.test(f.mime) || /\.pdf$/i.test(f.filename);
            out += '<button type="button" class="rh-btn sm" data-rh="open-file" data-fid="' + f.id + '" data-mime="' + RH.esc(f.mime) + '" data-name="' + RH.esc(f.filename) + '">' + (isPdf ? '🖼️ Ver PDF' : '👁️ Ver XML') + ' · ' + RH.esc(f.filename) + '</button> ' +
              '<button type="button" class="rh-btn sm" data-rh="dl-file" data-fid="' + f.id + '" data-name="' + RH.esc(f.filename) + '">⬇️ Descargar</button> ';
          });
        });
        return out || '<span class="rh-muted">No se adjuntó XML/PDF.</span>';
      }
      var conc = (F.conceptos || []).map(function (c) {
        return [RH.esc(c.codigo), RH.esc(c.descripcion), RH.num(c.cantidad), RH.mxn(c.valor_unitario), RH.esc(c.clave_sat || '—'), RH.esc(c.unidad_sat || '—')];
      });
      var merc =
        '<div class="rh-card"><h4>📄 Factura de la mercancía</h4>' +
        kv([['Proveedor', (D.supplier_name || '') + ' · ' + (D.supplier_rfc || '')], ['Serie / Folio', (D.invoice_serie || '') + (D.invoice_folio || '—')],
            ['UUID', D.invoice_uuid || '—'], ['Fecha', F.fecha || D.invoice_date], ['Método / Forma de pago', (F.metodoPago || '—') + ' / ' + (F.formaPago || '—')],
            ['Condición en la recepción', D.payment_condition], ['SubTotal', RH.mxn(D.subtotal)], ['IVA', RH.mxn(D.tax_amount)], ['Total factura', RH.mxn(D.total)]]) +
        '<div style="margin-top:9px;">' + fileBtns(['FACTURA_XML', 'FACTURA_PDF']) + '</div></div>' +
        '<div class="rh-card"><h4>🧾 Conceptos de la factura</h4>' + tbl(['Código proveedor', 'Descripción', 'Cantidad', 'Valor unitario', 'Clave SAT', 'Unidad'], conc, [2, 3]) + '</div>';
      var CONDLBL = { CONTADO: 'Pagado por nosotros de contado / anticipado', POR_COBRAR: 'Por cobrar al llegar (se paga al chofer)', CREDITO: 'A crédito con la transportista', PROVEEDOR: 'Pagado por el proveedor' };
      var legs = (FL.traslados && FL.traslados.length) ? FL.traslados
        : (FL.total > 0 ? [{ n: 1, condicion: FL.condicion, transportista: FL.transportista, rfc: FL.rfc, doc_uuid: FL.doc_uuid, doc_folio: FL.doc_folio,
            total: FL.total, renglones: FL.renglones, gasto_folio: FL.gasto_folio }] : []);
      var fr = legs.length
        ? legs.map(function (l) {
            var route = (l.origen || l.destino) ? ' · ' + RH.esc(l.origen || '?') + ' → ' + RH.esc(l.destino || '?') : '';
            return '<div class="rh-card"><h4>🚛 Traslado ' + l.n + ' de ' + legs.length + route + '</h4>' +
              kv([['Condición', CONDLBL[l.condicion] || l.condicion], ['Transportista', (l.transportista || '—') + (l.rfc ? ' · ' + l.rfc : '')],
                  ['UUID / Folio de la factura', (l.doc_uuid || '—') + ' / ' + (l.doc_folio || '—')],
                  ['Costo para la empresa', RH.mxn(l.total)], ['Gasto operativo', l.gasto_folio || (l.condicion === 'PROVEEDOR' ? 'Sin gasto (lo paga el proveedor)' : '—')]]) +
              tbl(['Concepto', 'Importe', 'Nota'], (l.renglones || []).map(function (x) { return [RH.esc(x.type), RH.mxn(x.amount), RH.esc(x.note || '')]; }), [1]) +
              '<div style="margin-top:9px;">' + fileBtns(['FLETE_XML', 'FLETE_PDF'], 'FLETE' + l.n) + '</div></div>';
          }).join('')
        : '<div class="rh-card"><h4>🚛 Factura del flete / maniobras</h4><div class="rh-muted">Esta recepción no generó costo de flete para la empresa (lo pagó el proveedor).</div></div>';
      RH.openViewer('📄 Facturas — ' + RH.esc(D.folio),
        '<div style="display:flex;gap:6px;margin-bottom:10px;"><button class="rh-btn sm primary" data-rh="inv-tab" data-t="m">📦 Mercancía</button><button class="rh-btn sm" data-rh="inv-tab" data-t="f">🚛 Flete</button></div>' +
        '<div id="rh-inv-m">' + merc + '</div><div id="rh-inv-f" style="display:none;">' + fr + '</div><div id="rh-inv-view"></div>');
    } catch (e) { RH.toast('No se pudo abrir la factura: ' + e.message, 'bad'); }
  };
  RH.actions['inv-tab'] = function (el) {
    var t = el.getAttribute('data-t');
    RH.$('rh-inv-m').style.display = t === 'm' ? '' : 'none';
    RH.$('rh-inv-f').style.display = t === 'f' ? '' : 'none';
    var btns = el.parentNode.querySelectorAll('button');
    Array.prototype.forEach.call(btns, function (b) { b.classList.toggle('primary', b === el); });
  };
  RH.actions['open-file'] = async function (el) {
    var fid = el.getAttribute('data-fid'), mime = el.getAttribute('data-mime') || '', name = el.getAttribute('data-name') || '';
    var host = RH.$('rh-inv-view') || RH.$('rh-viewer-body');
    var box = document.createElement('div'); box.className = 'rh-card'; box.innerHTML = '<h4>' + RH.esc(name) + '</h4><div class="rh-muted">Cargando…</div>';
    if (host.id === 'rh-inv-view') host.innerHTML = '';
    host.appendChild(box);
    try {
      if (/pdf/i.test(mime) || /\.pdf$/i.test(name)) {
        var u = await RH.fileUrl(fid);
        box.innerHTML = '<h4>' + RH.esc(name) + '</h4><iframe src="' + u + '" style="width:100%;height:520px;border:1px solid var(--border);border-radius:8px;background:#fff;"></iframe>';
      } else if (/^image\//i.test(mime)) {
        var iu = await RH.fileUrl(fid);
        box.innerHTML = '<h4>' + RH.esc(name) + '</h4><img src="' + iu + '" style="max-width:100%;border-radius:8px;">';
      } else {
        var txt = await RH.fileText(fid);
        box.innerHTML = '<h4>' + RH.esc(name) + '</h4>';
        var pre = document.createElement('pre');
        pre.style.cssText = 'max-height:420px;overflow:auto;background:#0f172a;color:#e2e8f0;padding:12px;border-radius:8px;font-size:11.5px;white-space:pre-wrap;word-break:break-all;';
        pre.textContent = txt.length > 80000 ? txt.slice(0, 80000) + '\n… (recortado)' : txt;
        box.appendChild(pre);
      }
      box.scrollIntoView && box.scrollIntoView({ block: 'nearest' });
    } catch (e) { box.innerHTML = '<div class="rh-alert bad">No se pudo abrir el archivo: ' + RH.esc(e.message) + '</div>'; }
  };
  RH.actions['dl-file'] = function (el) {
    RH.download(el.getAttribute('data-fid'), el.getAttribute('data-name')).catch(function (e) { RH.toast('No se pudo descargar: ' + e.message, 'bad'); });
  };

  /* ───────────────────────── Visor 2: Evidencias ───────────────────────── */
  RH.actions['v-evidence'] = async function (el) {
    try {
      var D = await RH.detail(el.getAttribute('data-id'));
      var files = D.files_list || [];
      function group(title, kinds, withRef) {
        var list = files.filter(function (f) { return kinds.indexOf(f.kind) > -1; });
        if (!list.length) return '<div class="rh-card"><h4>' + title + '</h4><div class="rh-muted">Sin archivos.</div></div>';
        return '<div class="rh-card"><h4>' + title + ' <span class="rh-badge gray">' + list.length + '</span></h4><div class="rh-gallery">' + list.map(function (f) {
          var isImg = /^image\//i.test(f.mime);
          var cap = (KIND_LBL[f.kind] || f.kind) + (withRef && f.item_ref ? ' · ' + RH.esc(f.item_ref) : '');
          return isImg
            ? '<div class="rh-gal-item" data-rh="lightbox"><img data-fid="' + f.id + '" alt=""><div>' + cap + '</div></div>'
            : '<div class="rh-gal-item" style="cursor:default;"><div style="padding:14px 8px;">📎 ' + RH.esc(f.filename) + '</div><div>' + cap +
              '<br><button class="rh-btn sm" data-rh="open-file" data-fid="' + f.id + '" data-mime="' + RH.esc(f.mime) + '" data-name="' + RH.esc(f.filename) + '">Abrir</button></div></div>';
        }).join('') + '</div></div>';
      }
      var html =
        '<div class="rh-card"><b>' + RH.esc(D.supplier_name) + '</b> · ' + physBadge(D.physical_state) + ' · ' + statusBadge(D.status) + '</div>' +
        group('🚛 Llegada del camión / tarimas', ['FOTO_LLEGADA']) +
        group('📦 Cajas selladas o dañadas (evidencia de daños)', ['FOTO_DANO'], true) +
        group('✍️ Firmas digitales', ['FIRMA_CHOFER', 'FIRMA_ALMACEN', 'FIRMA_SUPERVISOR']) +
        group('📋 Carta Porte y Packing List', ['CARTA_PORTE', 'PACKING_LIST']);
      RH.openViewer('📷 Evidencias — ' + RH.esc(D.folio), html);
      RH.fillImages(RH.$('rh-viewer-body'));
    } catch (e) { RH.toast('No se pudieron abrir las evidencias: ' + e.message, 'bad'); }
  };

  /* ───────────────────────── Visor 3: Incidencia / NC ───────────────────────── */
  RH.supplierContact = async function (supplierId) {
    try {
      var list = await RH.api('/api/suppliers?limit=200');
      return (list || []).filter(function (s) { return s.id === supplierId; })[0] || {};
    } catch (e) { return {}; }
  };

  RH.buildReportHtml = function (o) {
    var rows = (o.items || []).map(function (i) {
      return '<tr><td>' + RH.esc(i.sku) + '</td><td>' + RH.esc(i.description) + '</td><td class="n">' + RH.num(i.qty_invoiced) + '</td><td class="n">' + RH.num(i.qty_missing) +
        '</td><td class="n">' + RH.num(i.qty_damaged) + '</td><td>' + RH.esc(i.cause || '') + '</td><td class="n">' + RH.mxn(i.amount) + '</td></tr>';
    }).join('');
    var photos = (o.photos || []).map(function (p) {
      return '<figure><img src="' + p.src + '"><figcaption>' + RH.esc(p.label) + '</figcaption></figure>';
    }).join('');
    return '<!doctype html><html><head><meta charset="utf-8"><title>Reporte de incidencia ' + RH.esc(o.folio) + '</title><style>' +
      'body{font-family:Arial,Helvetica,sans-serif;color:#0f172a;margin:26px;font-size:12.5px} h1{font-size:19px;margin:0 0 2px} h2{font-size:14px;margin:18px 0 6px;border-bottom:2px solid #2563eb;padding-bottom:3px}' +
      'table{width:100%;border-collapse:collapse;margin-top:6px} th,td{border:1px solid #cbd5e1;padding:6px 8px;text-align:left} th{background:#eff6ff;font-size:11px;text-transform:uppercase} td.n{text-align:right}' +
      '.meta{display:grid;grid-template-columns:1fr 1fr;gap:4px 18px;margin-top:8px} .meta b{color:#475569} .photos{display:grid;grid-template-columns:repeat(3,1fr);gap:10px}' +
      'figure{margin:0;border:1px solid #cbd5e1;padding:5px;border-radius:6px} figure img{width:100%;height:170px;object-fit:cover} figcaption{font-size:10.5px;color:#475569;margin-top:3px}' +
      '.sign{display:flex;gap:40px;margin-top:46px} .sign div{flex:1;border-top:1px solid #0f172a;padding-top:4px;text-align:center;font-size:11px} @media print{body{margin:12mm}}' +
      '</style></head><body>' +
      '<h1>Reporte de Incidencia en Recepción de Mercancía</h1><div style="color:#475569">CALEBSYS ERP · Expediente ' + RH.esc(o.folio) + ' · ' + RH.esc(o.date) + '</div>' +
      '<h2>Datos del reclamo</h2><div class="meta">' +
      '<div><b>Proveedor:</b> ' + RH.esc(o.supplier) + '</div><div><b>RFC:</b> ' + RH.esc(o.rfc || '—') + '</div>' +
      '<div><b>Factura:</b> ' + RH.esc(o.invoiceFolio || '—') + '</div><div><b>UUID:</b> ' + RH.esc(o.invoiceUuid || '—') + '</div>' +
      '<div><b>Acción solicitada:</b> ' + (o.action === 'NC' ? 'Nota de Crédito (descontar de Cuentas por Pagar)' : 'Cambio físico / reposición de mercancía') + '</div>' +
      '<div><b>Monto en disputa (c/IVA):</b> ' + RH.mxn(o.disputed) + '</div></div>' +
      '<h2>Partidas afectadas</h2><table><thead><tr><th>SKU</th><th>Descripción</th><th>Facturado</th><th>Faltante</th><th>Dañado</th><th>Causa</th><th>Importe c/IVA</th></tr></thead><tbody>' + rows + '</tbody></table>' +
      (o.notes ? '<h2>Observaciones del almacén</h2><p>' + RH.esc(o.notes) + '</p>' : '') +
      (photos ? '<h2>Evidencia fotográfica</h2><div class="photos">' + photos + '</div>' : '') +
      '<div class="sign"><div>Recibió (Almacén)</div><div>Autorizó (Supervisor)</div><div>Enterado (Proveedor)</div></div>' +
      '</body></html>';
  };
  RH.openPrintWindow = function () {
    var w = null;
    try { w = global.open('', '_blank'); } catch (e) {}
    if (!w) { RH.toast('El navegador bloqueó la ventana del reporte. Permite pop-ups para este sitio.', 'warn'); return null; }
    w.document.write('<html><body style="font-family:Arial;padding:30px;color:#475569">Generando reporte…</body></html>');
    return w;
  };
  RH.finishPrintWindow = function (w, html) {
    if (!w) return;
    w.document.open(); w.document.write(html); w.document.close();
    setTimeout(function () { try { w.focus(); w.print(); } catch (e) {} }, 650);
  };
  RH.reportMessage = function (o) {
    return 'Hola, te escribimos de ' + (o.company || 'CALEBSYS') + '. En la recepción ' + o.folio + ' de tu factura ' + (o.invoiceFolio || o.invoiceUuid || '') +
      ' detectamos faltantes/daños por ' + RH.mxn(o.disputed) + '. Solicitamos ' + (o.action === 'NC' ? 'Nota de Crédito' : 'cambio físico / reposición') +
      '. Te compartimos el reporte con evidencia fotográfica. Gracias.';
  };

  function incidentItems(P) {
    return (P.p9_costeo || []).filter(function (r) { return RH.num(r.qty_missing) + RH.num(r.qty_damaged) > 0; }).map(function (r) {
      var units = RH.num(r.qty_missing) + RH.num(r.qty_damaged);
      return { sku: r.sku, description: r.description, qty_invoiced: r.qty_invoiced, qty_missing: r.qty_missing, qty_damaged: r.qty_damaged,
               cause: r.damage_cause, amount: units * RH.num(r.unit_cost_xml) * 1.16 };
    });
  }

  RH.actions['v-incident'] = async function (el) {
    try {
      var D = await RH.detail(el.getAttribute('data-id'));
      RH.renderIncident(D);
    } catch (e) { RH.toast('No se pudo abrir la incidencia: ' + e.message, 'bad'); }
  };
  RH.renderIncident = function (D) {
    var P = D.payload || {}, I = P.p11_incidencia || {};
    if (!D.incident_action || D.incident_status === 'NINGUNA') {
      RH.openViewer('⚠️ Incidencia — ' + RH.esc(D.folio), '<div class="rh-alert ok">Esta recepción se recibió completa y sin daños: no hay incidencia ni reclamo al proveedor.</div>', null, true);
      return;
    }
    var photos = (D.files_list || []).filter(function (f) { return f.kind === 'FOTO_DANO'; });
    var statuses = D.incident_action === 'NC'
      ? [['ABIERTO', 'Abierto'], ['EN_PROCESO', 'En proceso'], ['NC_APLICADA', 'Nota de crédito aplicada'], ['CONCLUIDO', 'Concluido']]
      : [['ABIERTO', 'Abierto'], ['EN_PROCESO', 'En proceso'], ['REPOSICION_RECIBIDA', 'Reposición recibida (suma al inventario)'], ['CONCLUIDO', 'Concluido']];
    var closed = ['NC_APLICADA', 'REPOSICION_RECIBIDA', 'CONCLUIDO'].indexOf(D.incident_status) > -1;
    var tl = (I.timeline || []).slice().reverse().map(function (t) {
      return '<div><b>' + RH.esc(RH.incLbl(t.estatus)) + '</b> · <span class="rh-muted">' + RH.fmtDate(t.fecha) + ' · ' + RH.esc(t.usuario) + '</span><div>' + RH.esc(t.nota || '') + '</div></div>';
    }).join('');
    var html =
      '<div class="rh-card"><h4>📋 Reclamo al proveedor</h4>' + kv([
        ['Proveedor', D.supplier_name], ['Factura', (D.invoice_serie || '') + (D.invoice_folio || '—')],
        ['Acción solicitada', D.incident_action === 'NC' ? '📄 Nota de Crédito (se descontó de CxP)' : '🔄 Cambio físico / reposición'],
        ['Estatus', RH.incLbl(D.incident_status)], ['Monto en disputa (c/IVA)', RH.mxn(D.disputed_amount)],
        ['NC folio / monto', I.nc_folio ? I.nc_folio + ' / ' + RH.mxn(I.nc_monto) : '—'], ['Observaciones', I.notas || '—']]) + '</div>' +
      '<div class="rh-card"><h4>📦 Partidas con faltante o daño</h4>' + tbl(['SKU', 'Descripción', 'Facturado', 'Faltante', 'Dañado', 'Causa', 'Importe c/IVA'],
        incidentItems(P).map(function (r) { return [RH.esc(r.sku), RH.esc(r.description), r.qty_invoiced, r.qty_missing, r.qty_damaged, RH.esc(r.cause || '—'), RH.mxn(r.amount)]; }), [2, 3, 4, 6]) + '</div>' +
      '<div class="rh-card"><h4>📷 Evidencia de daños <span class="rh-badge gray">' + photos.length + '</span></h4><div class="rh-gallery">' + photos.map(function (f) {
        return '<div class="rh-gal-item" data-rh="lightbox"><img data-fid="' + f.id + '" alt=""><div>' + RH.esc(f.item_ref || '') + '</div></div>';
      }).join('') + '</div></div>' +
      '<div class="rh-card"><h4>🕒 Seguimiento</h4><div class="rh-timeline">' + (tl || '<div class="rh-muted">Sin movimientos.</div>') + '</div></div>' +
      (closed ? '<div class="rh-alert ok">Este reclamo ya está cerrado.</div>' :
        '<div class="rh-card"><h4>✏️ Actualizar estatus del expediente</h4><div class="rh-grid c3">' +
        '<div class="rh-field"><label>Estatus</label><select class="rh-select" id="rh-inc-status">' + statuses.map(function (s) {
          return '<option value="' + s[0] + '"' + (s[0] === D.incident_status ? ' selected' : '') + '>' + s[1] + '</option>';
        }).join('') + '</select></div>' +
        (D.incident_action === 'NC' ? '<div class="rh-field"><label>Folio de la NC</label><input class="rh-input" id="rh-inc-ncf" placeholder="Folio / UUID de la NC"></div>' +
          '<div class="rh-field"><label>Monto de la NC ($)</label><input class="rh-input" id="rh-inc-ncm" type="number" step="0.01" value="' + RH.r2(D.disputed_amount) + '"></div>' : '<div></div><div></div>') +
        '</div><div class="rh-field" style="margin-top:8px;"><label>Notas del seguimiento</label><textarea class="rh-textarea" id="rh-inc-notes" placeholder="Ej. Proveedor aceptó el reclamo, repone el jueves…"></textarea></div>' +
        '<div style="margin-top:8px;"><button class="rh-btn success" data-rh="inc-save" data-id="' + D.id + '">💾 Guardar seguimiento</button></div></div>');
    var foot = '<div style="display:flex;gap:8px;flex-wrap:wrap;">' +
      '<button class="rh-btn" data-rh="inc-report" data-id="' + D.id + '">📤 Reporte PDF con evidencia</button>' +
      '<button class="rh-btn" data-rh="inc-wa" data-id="' + D.id + '">💬 WhatsApp</button>' +
      '<button class="rh-btn" data-rh="inc-mail" data-id="' + D.id + '">✉️ Correo</button></div>' +
      '<button type="button" class="rh-btn" data-rh="viewer-close">Cerrar [ESC]</button>';
    RH.openViewer('⚠️ Incidencia / Nota de Crédito — ' + RH.esc(D.folio), html, foot);
    RH.fillImages(RH.$('rh-viewer-body'));
  };
  RH.actions['inc-save'] = async function (el) {
    var id = el.getAttribute('data-id');
    var body = { status: RH.$('rh-inc-status').value, notes: (RH.$('rh-inc-notes') || {}).value || null };
    if (RH.$('rh-inc-ncf')) { body.nc_folio = RH.$('rh-inc-ncf').value || null; body.nc_amount = RH.num(RH.$('rh-inc-ncm').value); }
    el.disabled = true;
    try {
      await RH.api('/api/reception-hub/expedientes/' + id + '/incident', { method: 'PATCH', body: body });
      RH.toast('Seguimiento guardado.', 'ok');
      RH.renderIncident(await RH.detail(id));
      RH.refreshAll();
      if (body.status === 'REPOSICION_RECIBIDA') { try { global.dispatchEvent(new CustomEvent('calebsys:pos-pricing-updated', { detail: { source: 'reception_hub' } })); } catch (e) {} }
    } catch (e) { RH.toast(e.message, 'bad'); el.disabled = false; }
  };
  async function reportData(id) {
    var D = await RH.detail(id), P = D.payload || {}, I = P.p11_incidencia || {};
    var sup = await RH.supplierContact(D.supplier_id);
    var photos = [];
    var dmg = (D.files_list || []).filter(function (f) { return f.kind === 'FOTO_DANO'; });
    for (var i = 0; i < dmg.length; i++) {
      try { photos.push({ label: 'Daño · ' + (dmg[i].item_ref || ''), src: await RH.fileDataUrl(dmg[i].id) }); } catch (e) {}
    }
    return { D: D, sup: sup, rep: {
      folio: D.folio, date: RH.fmtDate(D.created_at), supplier: D.supplier_name, rfc: D.supplier_rfc, invoiceFolio: (D.invoice_serie || '') + (D.invoice_folio || ''),
      invoiceUuid: D.invoice_uuid, action: D.incident_action, disputed: D.disputed_amount, notes: I.notas, items: incidentItems(P), photos: photos } };
  }
  RH.actions['inc-report'] = async function (el) {
    var w = RH.openPrintWindow();
    try { var r = await reportData(el.getAttribute('data-id')); RH.finishPrintWindow(w, RH.buildReportHtml(r.rep)); }
    catch (e) { if (w) w.close(); RH.toast('No se pudo generar el reporte: ' + e.message, 'bad'); }
  };
  RH.actions['inc-wa'] = async function (el) {
    try {
      var r = await reportData(el.getAttribute('data-id'));
      var phone = String(r.sup.whatsapp || r.sup.phone || '').replace(/\D/g, '');
      global.open('https://wa.me/' + (phone ? (phone.length === 10 ? '52' + phone : phone) : '') + '?text=' + encodeURIComponent(RH.reportMessage(r.rep)), '_blank', 'noopener');
      RH.toast('Se abrió WhatsApp. Adjunta el PDF con «📤 Reporte PDF con evidencia».', 'info');
    } catch (e) { RH.toast(e.message, 'bad'); }
  };
  RH.actions['inc-mail'] = async function (el) {
    try {
      var r = await reportData(el.getAttribute('data-id'));
      global.location.href = 'mailto:' + encodeURIComponent(r.sup.email || '') + '?subject=' + encodeURIComponent('Reclamo de recepción ' + r.rep.folio + ' — ' + r.rep.supplier) +
        '&body=' + encodeURIComponent(RH.reportMessage(r.rep));
    } catch (e) { RH.toast(e.message, 'bad'); }
  };

  /* ───────────────────────── Visor 4: Expediente 360° ───────────────────────── */
  RH.sections = function (D) {
    var P = D.payload || {}, A = (P.p13_autorizacion || {}).afectaciones || {};
    var files = D.files_list || [];
    var F = P.p3_factura || {}, FL = P.p7_flete || {}, PR = P.p8_prorrateo || {}, INS = P.p10_inspeccion || {}, INC = P.p11_incidencia || {}, RT = P.p12_calificacion || {};
    var cost = P.p9_costeo || [];
    var docs = files.filter(function (f) { return ['FACTURA_XML', 'FACTURA_PDF', 'FLETE_XML', 'FLETE_PDF', 'CARTA_PORTE', 'PACKING_LIST'].indexOf(f.kind) > -1; });
    var fotos = files.filter(function (f) { return f.kind === 'FOTO_LLEGADA' || f.kind === 'FOTO_DANO'; });
    var firmas = files.filter(function (f) { return f.kind.indexOf('FIRMA_') === 0; });
    var hasInc = D.incident_status && D.incident_status !== 'NINGUNA';
    var out = [];
    out.push({ n: 1, t: 'Origen de la mercancía y Orden de Compra', ok: true, html: kv([
      ['Tipo de recepción', RH.ORIGIN_LBL[(P.p1_origen || {}).tipo] || (P.p1_origen || {}).tipo], ['Orden de Compra', (P.p1_origen || {}).po_folio || 'Sin OC'],
      ['Bodega de destino', (P.p1_origen || {}).bodega], ['Fecha de captura', RH.fmtDate(D.created_at)], ['Recibió / capturó', D.created_by], ['Recepción legada', D.receipt_folio]]) });
    out.push({ n: 2, t: 'Proveedor', ok: true, html: kv([['Nombre', (P.p2_proveedor || {}).nombre], ['RFC', (P.p2_proveedor || {}).rfc], ['Días de crédito', (P.p2_proveedor || {}).dias_credito],
      ['Calificación de esta entrega', RH.stars(D.rating_avg), true]]) });
    out.push({ n: 3, t: 'Factura de la mercancía (CFDI)', ok: !!D.invoice_uuid || !!D.invoice_folio, html: kv([
      ['UUID', D.invoice_uuid], ['Serie / Folio', (D.invoice_serie || '') + (D.invoice_folio || '')], ['Fecha', F.fecha], ['Método / Forma de pago', (F.metodoPago || '—') + ' / ' + (F.formaPago || '—')],
      ['Condición de pago', D.payment_condition], ['Subtotal / IVA / Total', RH.mxn(D.subtotal) + ' / ' + RH.mxn(D.tax_amount) + ' / ' + RH.mxn(D.total)],
      ['Total a pagar (neto de disputa)', RH.mxn(D.payable_total)]]) + tbl(['Código prov.', 'Descripción', 'Cantidad', 'Valor unit.'],
      (F.conceptos || []).map(function (c) { return [RH.esc(c.codigo), RH.esc(c.descripcion), RH.num(c.cantidad), RH.mxn(c.valor_unitario)]; }), [2, 3]) });
    out.push({ n: 4, t: 'Documentos adjuntos (XML, PDF, Carta Porte, Packing List)', ok: docs.length > 0, html: docs.length
      ? '<div>' + docs.map(function (f) { return '<button class="rh-btn sm" style="margin:2px;" data-rh="open-file" data-fid="' + f.id + '" data-mime="' + RH.esc(f.mime) + '" data-name="' + RH.esc(f.filename) + '">' + RH.esc(RH.KIND_LBL[f.kind] || f.kind) + ' · ' + RH.esc(f.filename) + '</button>'; }).join('') + '</div><div id="rh-inv-view"></div>'
      : '<span class="rh-muted">Sin documentos adjuntos.</span>' });
    out.push({ n: 5, t: 'Homologación de códigos XML', ok: (P.p5_homologacion || []).length > 0, html: tbl(['Código en factura', 'Descripción', 'Resultado', 'SKU interno', 'Código de barras'],
      (P.p5_homologacion || []).map(function (h) { return [RH.esc(h.codigo), RH.esc(h.descripcion || ''), RH.esc(h.estado || h.status || ''), RH.esc(h.sku || ''), RH.esc(h.barcode || '')]; })) });
    out.push({ n: 6, t: 'Pre-altas de productos nuevos', ok: (P.p6_prealtas || []).length > 0, html: (P.p6_prealtas || []).length ? tbl(['SKU interno', 'Código de barras', 'Código proveedor (F4)', 'Nombre en POS', 'Costo', 'Precio final'],
      (P.p6_prealtas || []).map(function (h) { return [RH.esc(h.sku), RH.esc(h.barcode), RH.esc(h.supplier_code), RH.esc(h.name), RH.mxn(h.cost), RH.mxn(h.price)]; }), [4, 5]) : '<span class="rh-muted">No hubo productos nuevos en esta recepción.</span>' });
    out.push({ n: 7, t: 'Flete, maniobras y costos adicionales (traslados)', ok: FL.total > 0, html: (FL.traslados && FL.traslados.length && FL.total > 0)
      ? FL.traslados.map(function (l) {
          return '<b>Traslado ' + l.n + ' de ' + FL.traslados.length + '</b>' + ((l.origen || l.destino) ? ' · ' + RH.esc(l.origen || '?') + ' → ' + RH.esc(l.destino || '?') : '') +
            kv([['Condición', ({ CONTADO: 'Pagado por nosotros de contado / anticipado', POR_COBRAR: 'Por cobrar al llegar', CREDITO: 'A crédito con la transportista', PROVEEDOR: 'Pagado por el proveedor' })[l.condicion] || l.condicion],
              ['Transportista', (l.transportista || '—') + ' ' + (l.rfc || '')], ['Factura del flete', (l.doc_uuid || '—') + ' / ' + (l.doc_folio || '—')],
              ['Costo / gasto generado', RH.mxn(l.total) + ' · ' + (l.gasto_folio || '—')]]) +
            tbl(['Concepto', 'Importe', 'Nota'], (l.renglones || []).map(function (x) { return [RH.esc(x.type), RH.mxn(x.amount), RH.esc(x.note || '')]; }), [1]);
        }).join('<hr style="border:none;border-top:1px dashed var(--border);margin:10px 0;">') + '<div style="margin-top:8px;"><b>Total fletes: ' + RH.mxn(FL.total) + '</b></div>'
      : (FL.total > 0 ? kv([
      ['Condición', ({ CONTADO: 'Pagado por nosotros de contado / anticipado', POR_COBRAR: 'Por cobrar al llegar', CREDITO: 'A crédito con la transportista' })[FL.condicion] || FL.condicion],
      ['Transportista', (FL.transportista || '—') + ' ' + (FL.rfc || '')], ['Factura del flete', (FL.doc_uuid || '—') + ' / ' + (FL.doc_folio || '—')], ['Gasto operativo generado', FL.gasto_folio || '—']]) +
      tbl(['Concepto', 'Importe', 'Nota'], (FL.renglones || []).map(function (l) { return [RH.esc(l.type), RH.mxn(l.amount), RH.esc(l.note || '')]; }), [1])
      : '<span class="rh-muted">El flete lo pagó el proveedor: 0% para la empresa.</span>') });
    out.push({ n: 8, t: 'Método de prorrateo', ok: true, html: kv([['Método solicitado', PR.metodo_solicitado], ['Método aplicado', PR.metodo_aplicado],
      ['% de flete equivalente sobre factura', RH.num(PR.pct_flete_sobre_factura).toFixed(2) + '%'], ['Base de prorrateo', PR.base_total]]) });
    out.push({ n: 9, t: 'Costeo real puesto en almacén (Landed Cost)', ok: cost.length > 0, html: tbl(['SKU', 'Costo XML', 'Flete/u', 'Costo real', 'Costo anterior', 'Δ%', 'Alerta', 'Precio'],
      cost.map(function (r) { return [RH.esc(r.sku), RH.mxn(r.unit_cost_xml), RH.mxn(r.freight_per_unit), '<b>' + RH.mxn(r.landed_unit_cost) + '</b>', RH.mxn(r.prev_cost), RH.num(r.cost_increase_pct).toFixed(1) + '%',
        r.cost_alert ? '<span class="rh-badge warn">⚠ >10%</span>' : '—', r.price_updated ? '<span class="rh-badge ok">' + RH.mxn(r.new_price) + '</span>' : '—']; }), [1, 2, 3, 4, 5]) });
    out.push({ n: 10, t: 'Inspección física y evidencias del almacenista', ok: true, html: kv([['Estado de llegada', physBadge(INS.estado_fisico), true], ['Notas', INS.notas], ['Fotos adjuntas', fotos.length]]) +
      tbl(['SKU', 'Facturado', 'Sano', 'Faltante', 'Dañado', 'Causa', 'Lote', 'Caducidad'], cost.map(function (r) { return [RH.esc(r.sku), r.qty_invoiced, r.qty_ok, r.qty_missing, r.qty_damaged, RH.esc(r.damage_cause || '—'), RH.esc(r.lot || '—'), RH.esc(r.expiry || '—')]; }), [1, 2, 3, 4]) });
    out.push({ n: 11, t: 'Incidencia / reclamo al proveedor', ok: hasInc ? true : null, html: hasInc ? kv([['Acción', INC.accion === 'NC' ? 'Nota de Crédito' : 'Cambio físico / reposición'], ['Estatus', RH.incLbl(D.incident_status)],
      ['Monto en disputa', RH.mxn(D.disputed_amount)], ['NC', INC.nc_folio ? INC.nc_folio + ' / ' + RH.mxn(INC.nc_monto) : '—']]) + '<div class="rh-timeline">' + (INC.timeline || []).map(function (t) {
        return '<div><b>' + RH.esc(RH.incLbl(t.estatus)) + '</b> · <span class="rh-muted">' + RH.fmtDate(t.fecha) + '</span> ' + RH.esc(t.nota || '') + '</div>'; }).join('') + '</div>'
      : '<span class="rh-muted">Recepción completa: no aplica.</span>' });
    out.push({ n: 12, t: 'Calificación del proveedor', ok: RH.num(D.rating_avg) > 0, html: kv([['Empaque', RH.stars(RT.empaque), true], ['Tiempo de entrega', RH.stars(RT.tiempo), true],
      ['Documentación', RH.stars(RT.documentacion), true], ['Estado del producto', RH.stars(RT.producto), true], ['Promedio', RH.stars(RT.promedio), true], ['Comentarios', RT.comentarios]]) });
    out.push({ n: 13, t: 'Firmas digitales, autorización y afectaciones', ok: firmas.length > 0, html:
      '<div class="rh-gallery" style="margin-bottom:10px;">' + firmas.map(function (f) { return '<div class="rh-gal-item" data-rh="lightbox"><img data-fid="' + f.id + '" alt="" style="object-fit:contain;background:#fff;"><div>' + RH.esc(RH.KIND_LBL[f.kind] || f.kind) + '</div></div>'; }).join('') + '</div>' +
      kv([['Autorizó', (P.p13_autorizacion || {}).autorizado_por], ['Confirmado', RH.fmtDate((P.p13_autorizacion || {}).confirmado_en)],
        ['Inventario / Kardex', (A.inventario_kardex || []).filter(function (x) { return x.qty_ok > 0; }).map(function (x) { return RH.esc(x.sku) + ' +' + x.qty_ok; }).join(' · ') || '—', true],
        ['Cuenta por pagar', A.cxp_id ? RH.mxn(A.cxp_monto) + ' (CxP generada)' : (A.pago_inmediato ? 'Pago inmediato ' + A.pago_inmediato.condicion + ' ' + RH.mxn(A.pago_inmediato.monto) : 'Sin cargo')],
        ['Gastos de flete', (FL.gastos_folios && FL.gastos_folios.length) ? FL.gastos_folios.join(', ') + ' · ' + RH.mxn(FL.total) : (FL.gasto_folio ? FL.gasto_folio + ' · ' + RH.mxn(FL.total) : '—')], ['Monto en disputa', RH.mxn(A.monto_en_disputa)], ['Total a pagar', RH.mxn(A.total_pagable)]]) });
    return out;
  };

  RH.actions['v-360'] = async function (el) {
    try {
      var D = await RH.detail(el.getAttribute('data-id'));
      var secs = RH.sections(D);
      var okCount = secs.filter(function (s) { return s.ok === true; }).length;
      var html =
        '<div class="rh-card" style="display:flex;gap:14px;flex-wrap:wrap;align-items:center;justify-content:space-between;">' +
        '<div><b style="font-size:15px;">' + RH.esc(D.supplier_name) + '</b><div class="rh-muted">' + RH.esc(RH.ORIGIN_LBL[D.origin_type] || D.origin_type) + (D.po_folio ? ' · ' + RH.esc(D.po_folio) : '') + ' · ' + RH.fmtDate(D.created_at) + '</div></div>' +
        '<div>' + statusBadge(D.status) + ' ' + physBadge(D.physical_state) + '</div>' +
        '<div style="text-align:right;"><div style="font-size:18px;font-weight:900;">' + RH.mxn(D.total) + '</div><div class="rh-muted">' + okCount + ' / 13 puntos con información</div></div></div>' +
        secs.map(function (s, i) {
          var mark = s.ok === true ? '✅' : (s.ok === null ? '⚪' : '▫️');
          return '<details class="rh-acc"' + (i === 0 ? ' open' : '') + '><summary><span>' + mark + '</span> ' + s.n + '. ' + RH.esc(s.t) + '</summary><div class="rh-acc-body">' + s.html + '</div></details>';
        }).join('');
      var foot = '<div style="display:flex;gap:8px;flex-wrap:wrap;"><button class="rh-btn" data-rh="print-360" data-id="' + D.id + '">🖨️ Imprimir expediente</button></div><button type="button" class="rh-btn" data-rh="viewer-close">Cerrar [ESC]</button>';
      RH.openViewer('📂 Expediente 360° — ' + RH.esc(D.folio), html, foot);
      RH.fillImages(RH.$('rh-viewer-body'));
      RH._last360 = D;
    } catch (e) { RH.toast('No se pudo abrir el expediente: ' + e.message, 'bad'); }
  };
  RH.actions['print-360'] = function () {
    var D = RH._last360; if (!D) return;
    var secs = RH.sections(D);
    var html = '<!doctype html><html><head><meta charset="utf-8"><title>Expediente ' + RH.esc(D.folio) + '</title><style>body{font-family:Arial;margin:22px;font-size:12px;color:#0f172a}h1{font-size:18px}h2{font-size:13.5px;border-bottom:2px solid #2563eb;padding-bottom:3px;margin-top:16px}' +
      'table{width:100%;border-collapse:collapse}th,td{border:1px solid #cbd5e1;padding:4px 6px;text-align:left}th{background:#eff6ff;font-size:10.5px;text-transform:uppercase}.rh-num{text-align:right}' +
      'dl{display:grid;grid-template-columns:200px 1fr;gap:3px 10px}dt{font-weight:bold;color:#475569}dd{margin:0}button,.rh-gallery{display:none}.rh-badge{border:1px solid #cbd5e1;border-radius:9px;padding:0 6px}</style></head><body>' +
      '<h1>Expediente 360° — ' + RH.esc(D.folio) + '</h1><div>' + RH.esc(D.supplier_name) + ' · Total ' + RH.mxn(D.total) + '</div>' +
      secs.map(function (s) { return '<h2>' + s.n + '. ' + RH.esc(s.t) + '</h2>' + s.html; }).join('') + '</body></html>';
    var w = RH.openPrintWindow(); RH.finishPrintWindow(w, html);
  };

  /* ───────────────────── Registro del handler de página ───────────────────── */
  global.pageInitHandlers = global.pageInitHandlers || {};
  global.pageInitHandlers['compras-recepciones'] = function () { RH.initPage(); };
  /* Compatibilidad: otros módulos pueden pedir recargar la lista */
  global.recCargar = function () { return RH.refreshAll(); };
})(window);
