/* =============================================================================
   CALEBSYS ADMIN SHELL — CONTROLADOR ALTA / EDICIÓN DE PRODUCTO
   Archivo: frontend/scripts/loaders/products-form.js
   Atajos: F12 = Guardar, ESC = Cancelar
   Normalización: MAYÚSCULAS en campos de texto de negocio
   ============================================================================= */

(function (global) {
  'use strict';

  // Bloquear de forma permanente la ventana emergente de Ayuda del navegador (Chrome/Edge F1 -> support.google.com)
  if (!global.__calebsysF1HelpBlocked) {
    global.__calebsysF1HelpBlocked = true;
    global.onhelp = function () { return false; };
    if (typeof document !== 'undefined') {
      document.onhelp = function () { return false; };
      if (typeof document.addEventListener === 'function') {
        document.addEventListener('help', function (ev) {
          ev.preventDefault();
          ev.stopPropagation();
          return false;
        }, true);
        document.addEventListener('keydown', function (ev) {
          if (ev.key === 'F1' || ev.keyCode === 112) {
            ev.preventDefault();
          }
        }, true);
      }
    }
    if (typeof global.addEventListener === 'function') {
      global.addEventListener('help', function (ev) {
        ev.preventDefault();
        ev.stopPropagation();
        return false;
      }, true);
      global.addEventListener('keydown', function (ev) {
        if (ev.key === 'F1' || ev.keyCode === 112) {
          ev.preventDefault();
        }
      }, true);
    }
  }

  global.initProductAltaPage = function () {
    var form = document.getElementById('pa-product-form');
    if (!form) return;

    // ── 1. Cálculos de precios en tiempo real (Incluye Desglose Compra por Caja -> Venta por Pieza con Sobreprecio) ──
    var costoEl            = document.getElementById('pa-costo');
    var costoLabelEl       = document.getElementById('pa-costo-label');
    var currencySymbolEl   = document.getElementById('pa-costo-currency-symbol');
    var costoHelperEl      = document.getElementById('pa-costo-converted-helper');
    var fleteEl            = document.getElementById('pa-flete-pct');
    var fleteMontoBadgeEl  = document.getElementById('pa-flete-monto-badge');
    var costoOtroEl        = document.getElementById('pa-costo-otro');
    var margenEl           = document.getElementById('pa-margen');
    var margenLabelEl      = document.getElementById('pa-margen-label');
    var ivaEl              = document.getElementById('pa-iva');
    var isUsdEl            = document.getElementById('pa-is-usd');
    var tcEl               = document.getElementById('pa-tc-rate');
    var cardPreciosEl      = document.getElementById('pa-card-precios');
    var badgeUsdEl         = document.getElementById('pa-badge-usd-indicator');
    var badgeBoxModeEl     = document.getElementById('pa-badge-box-mode');
    var dispPrecio         = document.getElementById('pa-precio-display');
    var inputPrecio        = document.getElementById('pa-precio-final');
    var inputPrecioCaja    = document.getElementById('pa-precio-caja-final');
    var inputPrecioPieza   = document.getElementById('pa-precio-pieza-final');
    var detailFormulaEl    = document.getElementById('pa-precio-formula-detail');

    // Elementos de Unidades/Empaque y Desglose Caja -> Pieza
    var presCompraEl       = document.getElementById('pa-pres-compra');
    var paqueteSelectEl    = document.getElementById('pa-paquete');
    var paqueteQtyEl       = document.getElementById('pa-paquete-qty');
    var unidadVentaEl      = document.getElementById('pa-unidad-medida');
    var equivTextEl        = document.getElementById('pa-equivalencia-text');
    var desgloseBlockEl    = document.getElementById('pa-desglose-caja-block');
    var cantPiezasRoEl     = document.getElementById('pa-cant-piezas-ro');
    var costoPiezaRoEl     = document.getElementById('pa-costo-pieza-ro');
    var costoFletePzaRoEl  = document.getElementById('pa-costo-flete-pieza-ro');
    var costoFleteSumValEl = document.getElementById('pa-costo-flete-summary-val');
    var sobreprecioPctEl   = document.getElementById('pa-sobreprecio-pct');
    var sobreprecioMontoEl = document.getElementById('pa-sobreprecio-monto');
    var margenFinalPzaEl   = document.getElementById('pa-margen-final-pieza');
    var margenBreakHelper  = document.getElementById('pa-margen-breakdown-helper');
    var singlePriceBoxEl   = document.getElementById('pa-single-price-box');
    var dualPriceBoxEl     = document.getElementById('pa-dual-price-box');
    var dualCajaLabelEl    = document.getElementById('pa-dual-caja-label');
    var dualPiezaLabelEl   = document.getElementById('pa-dual-pieza-label');
    var dispPrecioCaja     = document.getElementById('pa-precio-caja-display');
    var dispPrecioCajaSub  = document.getElementById('pa-precio-caja-sub');
    var dispPrecioPieza    = document.getElementById('pa-precio-pieza-display');
    var dispPrecioPiezaSub = document.getElementById('pa-precio-pieza-sub');

    var _sobreprecioMode = 'pct'; // 'pct' | 'monto'

    var OFFICIAL_UNIT_TO_SAT_MAP = {
      'PIEZA': 'H87', 'PZA': 'H87', 'PZAS': 'H87', 'UNIDAD': 'H87',
      'METRO': 'MTR', 'MTR': 'MTR', 'METROS': 'MTR', 'TRAMO': 'MTR', 'TIRA': 'MTR',
      'KILOGRAMO': 'KGM', 'KG': 'KGM', 'KILO': 'KGM', 'KILOS': 'KGM', 'KGM': 'KGM',
      'LITRO': 'LTR', 'LT': 'LTR', 'LTS': 'LTR', 'LITROS': 'LTR', 'LTR': 'LTR',
      'TONELADA': 'TNE', 'TON': 'TNE', 'TNE': 'TNE', 'TONELADAS': 'TNE',
      'M3': 'MTQ', 'METRO CUBICO': 'MTQ', 'METRO CÚBICO': 'MTQ', 'MTQ': 'MTQ',
      'M2': 'MTK', 'METRO CUADRADO': 'MTK', 'MTK': 'MTK',
      'CAJA': 'XBX', 'XBX': 'XBX',
      'PAQUETE': 'XPK', 'PAQ': 'XPK', 'XPK': 'XPK',
      'BOLSA': 'XBG', 'XBG': 'XBG',
      'SACO': 'XSA', 'BULTO': 'XSA', 'COSTAL': 'XSA', 'XSA': 'XSA',
      'ATADO': 'XBH', 'MANOJO': 'XBH', 'XBH': 'XBH',
      'ROLLO': 'XRO', 'XRO': 'XRO',
      'CUBETA': 'XBJ', 'BALDE': 'XBJ', 'BOTE': 'XBJ', 'XBJ': 'XBJ',
      'BOTELLA': 'XBO', 'GARRAFON': 'XBO', 'GARRAFÓN': 'XBO', 'ENVASE': 'XBO', 'XBO': 'XBO',
      'GALON': 'GLL', 'GALÓN': 'GLL', 'GLL': 'GLL',
      'JUEGO': 'SET', 'KIT': 'SET', 'CONJUNTO': 'SET', 'SET': 'SET',
      'PAR': 'PR', 'PR': 'PR',
      'MILLAR': 'MIL', 'MIL': 'MIL',
      'SERVICIO': 'E48', 'FLETE': 'E48', 'E48': 'E48'
    };

    function cleanUnitName(val) {
      var raw = String(val || '').trim().toUpperCase();
      var m = /^(.+?)\s*\(([A-Z0-9]{2,4})\)$/.exec(raw);
      return m ? m[1].trim() : raw;
    }

    function resolveUnitToSatCode(unitName) {
      var raw = String(unitName || '').trim().toUpperCase();
      if (!raw) return 'H87';
      var mParen = /^(.+?)\s*\(([A-Z0-9]{2,4})\)$/.exec(raw);
      if (mParen) return mParen[2].trim();
      if (global.CalebsysCatalogStore && typeof global.CalebsysCatalogStore.resolveSatUnidad === 'function') {
        var fromStore = global.CalebsysCatalogStore.resolveSatUnidad(raw);
        if (fromStore) return fromStore;
      }
      if (OFFICIAL_UNIT_TO_SAT_MAP[raw]) return OFFICIAL_UNIT_TO_SAT_MAP[raw];
      var cleanNoAcc = raw.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
      if (OFFICIAL_UNIT_TO_SAT_MAP[cleanNoAcc]) return OFFICIAL_UNIT_TO_SAT_MAP[cleanNoAcc];
      return 'H87';
    }

    function syncSatUnidadFromEmpaque(opts) {
      opts = opts || {};
      var presName = cleanUnitName(presCompraEl ? presCompraEl.value : 'PIEZA') || 'PIEZA';
      var unidName = cleanUnitName(unidadVentaEl ? unidadVentaEl.value : 'PIEZA') || 'PIEZA';
      var satSaleCode = resolveUnitToSatCode(unidName);
      var satPresCode = resolveUnitToSatCode(presName);

      var satUnInp = document.getElementById('pa-sat-unidad');
      var satEmpInp = document.getElementById('pa-sat-unidad-empaque');
      if (satEmpInp) {
        satEmpInp.value = satPresCode;
      }
      if (satUnInp && !opts.keepManualSatUnidad) {
        satUnInp.value = satSaleCode;
        satUnInp.classList.remove('pa-input-error');
      }
      if (typeof global.updateSatBadgesProductAlta === 'function') {
        global.updateSatBadgesProductAlta();
      }
    }

    function isBulkPresentation(pres) {
      var p = cleanUnitName(pres);
      return p !== '' && p !== 'PIEZA' && p !== 'METRO' && p !== 'KILOGRAMO' && p !== 'KILO' && p !== 'LITRO' && p !== 'M2' && p !== 'M3' && p !== 'TONELADA' && p !== 'SERVICIO';
    }

    function extractPaqueteQty() {
      var qNum = parseFloat(paqueteQtyEl ? paqueteQtyEl.value : 0);
      if (qNum && qNum > 0) return qNum;
      var selVal = paqueteSelectEl ? String(paqueteSelectEl.value || '') : '';
      var m = /(\d+(\.\d+)?)/.exec(selVal);
      return m ? Math.max(1, parseFloat(m[1])) : 1;
    }

    function isDesgloseActive() {
      var pres = presCompraEl ? cleanUnitName(presCompraEl.value || 'PIEZA') : 'PIEZA';
      var qty = extractPaqueteQty();
      return isBulkPresentation(pres) || qty > 1;
    }

    function syncUsdMode() {
      var isUsd = !!(isUsdEl && isUsdEl.checked);
      var desglose = isDesgloseActive();
      var pres = presCompraEl ? cleanUnitName(presCompraEl.value || 'CAJA') : 'CAJA';
      var presTitle = pres.charAt(0) + pres.slice(1).toLowerCase();
      if (cardPreciosEl) {
        if (isUsd) {
          cardPreciosEl.classList.add('pa-usd-mode-active');
        } else {
          cardPreciosEl.classList.remove('pa-usd-mode-active');
        }
      }
      if (badgeUsdEl) {
        badgeUsdEl.style.display = isUsd ? 'inline-flex' : 'none';
      }
      if (costoLabelEl) {
        if (desglose) {
          costoLabelEl.textContent = isUsd ? ('Costo x ' + presTitle + ' (USD)') : ('Costo por ' + presTitle + ' ($)');
        } else {
          costoLabelEl.textContent = isUsd ? 'Costo (USD)' : 'Costo de Pieza';
        }
      }
      if (margenLabelEl) {
        margenLabelEl.textContent = desglose ? ('Margen ' + presTitle + ' (%)') : 'Margen (%)';
      }
      if (currencySymbolEl) {
        currencySymbolEl.textContent = isUsd ? 'US$' : '$';
      }
      var usdSub = document.getElementById('pa-usd-subtext');
      if (usdSub) {
        usdSub.textContent = isUsd ? 'Activo: Capturando costo en Dólares' : 'Calcular costo en Dólares';
      }
    }

    function recalcularPrecio(triggerSource) {
      var isUsd    = !!(isUsdEl && isUsdEl.checked);
      var tc       = parseFloat(tcEl ? tcEl.value : 17.50) || 17.50;
      var costoRaw = parseFloat(costoEl ? costoEl.value : 0) || 0;
      var fletePct = parseFloat(fleteEl ? fleteEl.value : (costoOtroEl ? costoOtroEl.value : 0)) || 0;
      var margen   = parseFloat(margenEl ? margenEl.value : 0) || 0;
      var iva      = parseFloat(ivaEl ? ivaEl.value : 0) || 0;

      if (costoOtroEl) {
        costoOtroEl.value = fletePct;
      }

      var pres = presCompraEl ? cleanUnitName(presCompraEl.value || 'PIEZA') : 'PIEZA';
      var unid = unidadVentaEl ? cleanUnitName(unidadVentaEl.value || 'PIEZA') : 'PIEZA';
      var satPres = resolveUnitToSatCode(pres);
      var satUnid = resolveUnitToSatCode(unid);
      var cantPiezas = Math.max(1, extractPaqueteQty());
      var desglose = isBulkPresentation(pres) || cantPiezas > 1;

      // Actualizar texto dinámico de validación de equivalencia con clave SAT
      var presCap = pres.charAt(0) + pres.slice(1).toLowerCase();
      var unidCap = unid.charAt(0) + unid.slice(1).toLowerCase() + (cantPiezas === 1 ? '' : 's');
      if (equivTextEl) {
        equivTextEl.textContent = 'Equivale a: 1 ' + presCap + ' (' + satPres + ') = ' + cantPiezas + ' ' + unidCap + ' (' + satUnid + ')';
      }

      // Mostrar u ocultar controles de desglose Caja -> Pieza
      if (desgloseBlockEl) {
        desgloseBlockEl.style.display = desglose ? 'block' : 'none';
      }
      if (badgeBoxModeEl) {
        badgeBoxModeEl.style.display = desglose ? 'inline-flex' : 'none';
      }
      if (singlePriceBoxEl) {
        singlePriceBoxEl.style.display = desglose ? 'none' : 'block';
      }
      if (dualPriceBoxEl) {
        dualPriceBoxEl.style.display = desglose ? 'grid' : 'none';
      }
      syncUsdMode();

      // 1. Costo Base de Compra en Pesos (MXN):
      // Si es Caja, costoBasePesos es el Costo por Caja (ej. $100.00)
      var costoCajaPesos = isUsd ? (costoRaw * tc) : costoRaw;
      var costoPiezaSinFlete = cantPiezas > 0 ? (costoCajaPesos / cantPiezas) : costoCajaPesos;

      // 2. Flete (%): se prorratea entre la caja y cada pieza
      var montoFleteCaja = costoCajaPesos * (fletePct / 100);
      var costoCajaConFlete = costoCajaPesos + montoFleteCaja;
      var costoPiezaConFlete = cantPiezas > 0 ? (costoCajaConFlete / cantPiezas) : costoCajaConFlete;

      if (fleteMontoBadgeEl) {
        fleteMontoBadgeEl.textContent = '$' + montoFleteCaja.toFixed(2);
      }
      if (cantPiezasRoEl) {
        cantPiezasRoEl.value = cantPiezas;
      }
      if (costoPiezaRoEl) {
        costoPiezaRoEl.value = costoPiezaSinFlete.toFixed(2);
      }
      if (costoFletePzaRoEl) {
        costoFletePzaRoEl.value = costoPiezaConFlete.toFixed(2);
      }
      if (costoFleteSumValEl) {
        costoFleteSumValEl.textContent = 'C/Flete: $' + costoCajaConFlete.toFixed(2) + ' ' + presCap + ' ($' + costoPiezaConFlete.toFixed(2) + ' por ' + unid.charAt(0) + unid.slice(1).toLowerCase() + ')';
      }

      // 3. Sincronización bidireccional Sobreprecio Pieza (% <-> $) y Precios Finales Manuales
      var baseRefPieza = costoPiezaSinFlete > 0 ? costoPiezaSinFlete : 1;
      var sobrePct = parseFloat(sobreprecioPctEl ? sobreprecioPctEl.value : 0) || 0;
      var sobreMonto = parseFloat(sobreprecioMontoEl ? sobreprecioMontoEl.value : 0) || 0;
      var factorIva = 1 + (iva / 100);

      // Si el usuario ingresa Costo o Flete y el margen principal aún está en 0.00 (sin haber sido editado manualmente a 0),
      // tomar automáticamente el margen de trabajo de la primera escala activa (PRECIO DE LISTA)
      if (costoCajaConFlete > 0 && margen === 0 && margenEl && !margenEl.dataset.userEditedZero) {
        if (typeof global.recalculateAllProductScalesFromCost === 'function') {
          global.recalculateAllProductScalesFromCost({ triggerSource: 'base', skipModalRender: true });
          margen = parseFloat(margenEl.value || 0) || 0;
        }
      }

      // Si el usuario editó manualmente el Precio Final (Modo Pieza Simple o Precio por Caja)
      if ((triggerSource === 'manual_single' || triggerSource === 'manual_single_blur' ||
           triggerSource === 'manual_caja'   || triggerSource === 'manual_caja_blur') && costoCajaConFlete > 0) {
        var targetCajaInp = (triggerSource === 'manual_single' || triggerSource === 'manual_single_blur') ? dispPrecio : dispPrecioCaja;
        var manualCajaPrecio = parseFloat(targetCajaInp ? targetCajaInp.value : 0);
        if (!isNaN(manualCajaPrecio) && manualCajaPrecio >= 0) {
          var subCajaSinIva = factorIva > 0 ? (manualCajaPrecio / factorIva) : manualCajaPrecio;
          margen = ((subCajaSinIva / costoCajaConFlete) - 1) * 100;
          if (margenEl) {
            margenEl.value = margen.toFixed(2);
          }
        }
      }

      if (triggerSource === 'sobre_monto') {
        _sobreprecioMode = 'monto';
        sobrePct = costoPiezaSinFlete > 0 ? ((sobreMonto / baseRefPieza) * 100) : 0;
        if (sobreprecioPctEl) sobreprecioPctEl.value = sobrePct.toFixed(2);
      } else if (triggerSource === 'sobre_pct') {
        _sobreprecioMode = 'pct';
        sobreMonto = baseRefPieza * (sobrePct / 100);
        if (sobreprecioMontoEl) sobreprecioMontoEl.value = sobreMonto.toFixed(2);
      } else if ((triggerSource === 'manual_pieza' || triggerSource === 'manual_pieza_blur') && costoPiezaConFlete > 0) {
        // Si el usuario editó manualmente el Precio por Pieza, recalcular Margen Final Pieza y Sobreprecio (% y $)
        var manualPiezaPrecio = parseFloat(dispPrecioPieza ? dispPrecioPieza.value : 0);
        if (!isNaN(manualPiezaPrecio) && manualPiezaPrecio >= 0) {
          var subPiezaSinIva = factorIva > 0 ? (manualPiezaPrecio / factorIva) : manualPiezaPrecio;
          var nuevoMargenFinal = ((subPiezaSinIva / costoPiezaConFlete) - 1) * 100;
          sobrePct = nuevoMargenFinal - margen;
          sobreMonto = baseRefPieza * (sobrePct / 100);
          _sobreprecioMode = 'pct';
          if (sobreprecioPctEl) sobreprecioPctEl.value = sobrePct.toFixed(2);
          if (sobreprecioMontoEl) sobreprecioMontoEl.value = sobreMonto.toFixed(2);
        }
      } else {
        if (_sobreprecioMode === 'monto' && costoPiezaSinFlete > 0) {
          sobrePct = (sobreMonto / baseRefPieza) * 100;
          if (sobreprecioPctEl) sobreprecioPctEl.value = sobrePct.toFixed(2);
        } else {
          sobreMonto = baseRefPieza * (sobrePct / 100);
          if (sobreprecioMontoEl) sobreprecioMontoEl.value = sobreMonto.toFixed(2);
        }
      }

      // 4. Margen Final de la Pieza = Margen Base Caja + Sobreprecio (%)
      var margenFinalPieza = desglose ? (margen + sobrePct) : margen;
      if (margenFinalPzaEl) {
        margenFinalPzaEl.value = margenFinalPieza.toFixed(2);
      }
      if (margenBreakHelper) {
        margenBreakHelper.textContent = margen.toFixed(2).replace(/\.00$/, '') + '% margen ' + pres.toLowerCase() +
          ' + ' + sobrePct.toFixed(2).replace(/\.00$/, '') + '% sobreprecio ($' + sobreMonto.toFixed(2) + ') = ' +
          margenFinalPieza.toFixed(2).replace(/\.00$/, '') + '% margen menudeo';
      }

      // 5. Cálculo de Precios Finales con IVA:
      // Precio de Caja (Mayoreo): (Costo Caja + Flete) * (1 + Margen Base %) * (1 + IVA %)
      var subtotalCaja = costoCajaConFlete * (1 + (margen / 100));
      var precioCajaFinal = subtotalCaja * factorIva;

      // Precio de Pieza (Menudeo con Sobreprecio): (Costo Pieza + Flete Prorrateado) * (1 + Margen Final %) * (1 + IVA %)
      var subtotalPieza = costoPiezaConFlete * (1 + (margenFinalPieza / 100));
      var precioPiezaFinal = subtotalPieza * factorIva;

      // Actualizar displays / inputs editables sin interrumpir al usuario mientras escribe
      if (dispPrecio && triggerSource !== 'manual_single') {
        if ('value' in dispPrecio) dispPrecio.value = precioCajaFinal.toFixed(2);
        else dispPrecio.textContent = '$' + precioCajaFinal.toFixed(2);
      }
      if (dualCajaLabelEl) {
        dualCajaLabelEl.textContent = 'PRECIO POR ' + pres + ' (IVA INC.)';
      }
      if (dualPiezaLabelEl) {
        dualPiezaLabelEl.textContent = 'PRECIO POR ' + unid + ' (C/SOBREPRECIO)';
      }
      if (dispPrecioCaja && triggerSource !== 'manual_caja') {
        if ('value' in dispPrecioCaja) dispPrecioCaja.value = precioCajaFinal.toFixed(2);
        else dispPrecioCaja.textContent = '$' + precioCajaFinal.toFixed(2);
      }
      if (dispPrecioCajaSub) {
        dispPrecioCajaSub.textContent = 'Sugerido ' + presCap + ': $' + costoCajaConFlete.toFixed(2) + ' c/flete · Margen ' + margen.toFixed(2).replace(/\.00$/, '') + '%';
      }
      if (dispPrecioPieza && triggerSource !== 'manual_pieza') {
        if ('value' in dispPrecioPieza) dispPrecioPieza.value = precioPiezaFinal.toFixed(2);
        else dispPrecioPieza.textContent = '$' + precioPiezaFinal.toFixed(2);
      }
      if (dispPrecioPiezaSub) {
        dispPrecioPiezaSub.textContent = 'Costo Pza c/flete $' + costoPiezaConFlete.toFixed(2) + ' · Margen ' + margenFinalPieza.toFixed(2).replace(/\.00$/, '') + '%';
      }

      // Inputs ocultos para persistencia al guardar (F12)
      if (inputPrecioCaja) inputPrecioCaja.value = precioCajaFinal.toFixed(2);
      if (inputPrecioPieza) inputPrecioPieza.value = precioPiezaFinal.toFixed(2);
      // Si hay desglose a pieza, el precio unitario de venta principal es el de la pieza; en modo pieza simple es precioCajaFinal
      var precioActivoPrincipal = desglose ? precioPiezaFinal : precioCajaFinal;
      if (inputPrecio) {
        inputPrecio.value = precioActivoPrincipal.toFixed(2);
      }
      var histActVal = document.getElementById('pa-hist-precio-activo');
      if (histActVal) {
        histActVal.textContent = desglose
          ? ('$' + precioPiezaFinal.toFixed(2) + ' Pza / $' + precioCajaFinal.toFixed(2) + ' ' + presCap)
          : ('$' + precioCajaFinal.toFixed(2));
      }

      // Helper de conversión a Pesos cuando USD está activo
      if (costoHelperEl) {
        if (isUsd) {
          costoHelperEl.style.display = 'flex';
          costoHelperEl.innerHTML = '<i class="fa-solid fa-arrow-right-arrow-left"></i> En pesos: <strong>$' + costoCajaPesos.toFixed(2) + ' MXN</strong> <span style="font-size:10px;opacity:0.8;">(T.C. $' + tc.toFixed(2) + ')</span>';
        } else {
          costoHelperEl.style.display = 'none';
        }
      }

      // Desglose paso a paso en la tarjeta de precio (modo pieza individual)
      if (detailFormulaEl) {
        var detail = 'Costo: $' + costoCajaPesos.toFixed(2);
        if (fletePct > 0) {
          detail += ' + Flete (' + fletePct + '%: $' + montoFleteCaja.toFixed(2) + ') = $' + costoCajaConFlete.toFixed(2);
        }
        detail += ' | Margen: ' + margen.toFixed(2).replace(/\.00$/, '') + '% | IVA: ' + iva + '%';
        detailFormulaEl.textContent = detail;
      }

      // 6. Actualizar automáticamente todas las Escalas Activas y Escalas de Sucursales en tiempo real
      if (typeof global.recalculateAllProductScalesFromCost === 'function') {
        global.recalculateAllProductScalesFromCost({
          triggerSource: triggerSource || 'base',
          keepZeroMainMargin: !triggerSource || triggerSource === 'init'
        });
      }
    }

    function triggerScaleSnapshotBeforeEdit() {
      if (typeof global.snapshotScalesBeforeEditStep === 'function') {
        global.snapshotScalesBeforeEditStep();
      }
    }

    [costoEl, fleteEl, costoOtroEl, ivaEl, tcEl].forEach(function (inp) {
      if (inp) {
        inp.addEventListener('focus', triggerScaleSnapshotBeforeEdit);
        inp.addEventListener('input', function () { recalcularPrecio('base'); });
        inp.addEventListener('change', function () {
          recalcularPrecio('base');
          triggerScaleSnapshotBeforeEdit();
        });
      }
    });
    if (margenEl) {
      margenEl.addEventListener('focus', triggerScaleSnapshotBeforeEdit);
      margenEl.addEventListener('input', function () {
        if (parseFloat(margenEl.value || '0') === 0) margenEl.dataset.userEditedZero = '1';
        else delete margenEl.dataset.userEditedZero;
        recalcularPrecio('margen');
      });
      margenEl.addEventListener('change', function () {
        recalcularPrecio('margen');
        triggerScaleSnapshotBeforeEdit();
      });
    }

    if (dispPrecio) {
      dispPrecio.addEventListener('focus', triggerScaleSnapshotBeforeEdit);
      dispPrecio.addEventListener('input', function () { recalcularPrecio('manual_single'); });
      dispPrecio.addEventListener('change', function () {
        recalcularPrecio('manual_single_blur');
        triggerScaleSnapshotBeforeEdit();
      });
    }
    if (dispPrecioCaja) {
      dispPrecioCaja.addEventListener('focus', triggerScaleSnapshotBeforeEdit);
      dispPrecioCaja.addEventListener('input', function () { recalcularPrecio('manual_caja'); });
      dispPrecioCaja.addEventListener('change', function () {
        recalcularPrecio('manual_caja_blur');
        triggerScaleSnapshotBeforeEdit();
      });
    }
    if (dispPrecioPieza) {
      dispPrecioPieza.addEventListener('focus', triggerScaleSnapshotBeforeEdit);
      dispPrecioPieza.addEventListener('input', function () { recalcularPrecio('manual_pieza'); });
      dispPrecioPieza.addEventListener('change', function () {
        recalcularPrecio('manual_pieza_blur');
        triggerScaleSnapshotBeforeEdit();
      });
    }

    if (sobreprecioPctEl) {
      sobreprecioPctEl.addEventListener('focus', triggerScaleSnapshotBeforeEdit);
      sobreprecioPctEl.addEventListener('input', function () { recalcularPrecio('sobre_pct'); });
      sobreprecioPctEl.addEventListener('change', function () {
        recalcularPrecio('sobre_pct');
        triggerScaleSnapshotBeforeEdit();
      });
    }
    if (sobreprecioMontoEl) {
      sobreprecioMontoEl.addEventListener('focus', triggerScaleSnapshotBeforeEdit);
      sobreprecioMontoEl.addEventListener('input', function () { recalcularPrecio('sobre_monto'); });
      sobreprecioMontoEl.addEventListener('change', function () {
        recalcularPrecio('sobre_monto');
        triggerScaleSnapshotBeforeEdit();
      });
    }

    if (presCompraEl) {
      presCompraEl.addEventListener('change', function () {
        var pres = cleanUnitName(presCompraEl.value || 'PIEZA');
        if (pres === 'PIEZA') {
          if (paqueteSelectEl) paqueteSelectEl.value = '--';
          if (paqueteQtyEl) paqueteQtyEl.value = '1';
        } else if (isBulkPresentation(pres)) {
          var curQ = extractPaqueteQty();
          if (curQ <= 1) {
            if (paqueteSelectEl) {
              var has10 = Array.from(paqueteSelectEl.options).some(function (o) { return o.value === '10 PZAS'; });
              if (has10) paqueteSelectEl.value = '10 PZAS';
            }
            if (paqueteQtyEl) paqueteQtyEl.value = '10';
          }
        }
        // Si es presentación unitaria directa (ej. METRO, KILOGRAMO, LITRO, M3, M2, TONELADA, SERVICIO) y no hay desglose, alinear también UNIDAD DE MEDIDA si existe
        if (!isBulkPresentation(pres) && extractPaqueteQty() <= 1 && unidadVentaEl) {
          var matchOpt = Array.from(unidadVentaEl.options).find(function (o) { return cleanUnitName(o.value) === pres; });
          if (matchOpt) unidadVentaEl.value = matchOpt.value;
        }
        syncSatUnidadFromEmpaque();
        recalcularPrecio('pres');
      });
    }

    if (paqueteSelectEl) {
      paqueteSelectEl.addEventListener('change', function () {
        var sel = String(paqueteSelectEl.value || '--');
        var m = /(\d+(\.\d+)?)/.exec(sel);
        var q = m ? Math.max(1, parseFloat(m[1])) : 1;
        if (paqueteQtyEl) paqueteQtyEl.value = String(q);
        if (q > 1 && presCompraEl && cleanUnitName(presCompraEl.value) === 'PIEZA') {
          presCompraEl.value = 'CAJA';
        } else if (q === 1 && sel === '--' && presCompraEl && !isBulkPresentation(presCompraEl.value)) {
          presCompraEl.value = 'PIEZA';
        }
        syncSatUnidadFromEmpaque();
        recalcularPrecio('paquete_sel');
      });
    }

    if (paqueteQtyEl) {
      paqueteQtyEl.addEventListener('input', function () {
        var q = Math.max(1, parseFloat(paqueteQtyEl.value || '1') || 1);
        if (paqueteSelectEl) {
          var matchVal = q + ' PZAS';
          var exists = Array.from(paqueteSelectEl.options).some(function (o) { return o.value === matchVal; });
          if (q === 1) {
            paqueteSelectEl.value = '--';
          } else if (exists) {
            paqueteSelectEl.value = matchVal;
          } else {
            var customOpt = paqueteSelectEl.querySelector('option[data-custom-paq="1"]');
            if (!customOpt) {
              customOpt = document.createElement('option');
              customOpt.setAttribute('data-custom-paq', '1');
              paqueteSelectEl.appendChild(customOpt);
            }
            customOpt.value = matchVal;
            customOpt.textContent = matchVal;
            paqueteSelectEl.value = matchVal;
          }
        }
        if (q > 1 && presCompraEl && cleanUnitName(presCompraEl.value) === 'PIEZA') {
          presCompraEl.value = 'CAJA';
        }
        syncSatUnidadFromEmpaque();
        recalcularPrecio('paquete_qty');
      });
    }

    if (unidadVentaEl) {
      unidadVentaEl.addEventListener('change', function () {
        syncSatUnidadFromEmpaque();
        recalcularPrecio('unidad');
      });
    }

    if (isUsdEl) {
      isUsdEl.addEventListener('change', function () {
        syncUsdMode();
        recalcularPrecio('usd');
      });
    }

    // Inicializar estado USD y cálculo inicial
    syncUsdMode();
    recalcularPrecio('init');

    // ── 2. SKU automático copia al campo Código si está vacío ──
    var skuEl    = document.getElementById('pa-sku');
    var codigoEl = document.getElementById('pa-codigo');
    if (skuEl && codigoEl) {
      skuEl.addEventListener('input', function () {
        if (!codigoEl.dataset.userEdited) {
          codigoEl.value = skuEl.value;
        }
      });
      codigoEl.addEventListener('input', function () {
        codigoEl.dataset.userEdited = 'true';
      });
    }

    // ── 2b. Sincronización Reactiva Bidireccional (Padre -> Hijo: Familia -> Departamentos) ──
    var familiaEl = document.getElementById('pa-familia');
    var deptoEl   = document.getElementById('pa-departamento');
    var marcaEl   = document.getElementById('pa-marca');
    var presEl    = document.getElementById('pa-pres-compra');
    var unidadEl  = document.getElementById('pa-unidad-medida');

    var _paFamTree = {
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

    function syncDepartamentosPorFamilia(opts) {
      opts = opts || {};
      if (!familiaEl || !deptoEl) return;
      var fam = (familiaEl.value || '').trim().toUpperCase();
      var deptos = Array.isArray(_paFamTree[fam]) ? _paFamTree[fam] : [];
      var prev = (deptoEl.value || '').trim().toUpperCase();

      if (!deptos.length) {
        deptoEl.innerHTML = '<option value="">Seleccionar departamento...</option>';
        deptoEl.value = '';
        return;
      }

      deptoEl.innerHTML = deptos.map(function (d) {
        return '<option value="' + String(d).replace(/"/g, '&quot;') + '">' + d + '</option>';
      }).join('');

      if (opts.selectDepto && deptos.indexOf(opts.selectDepto) >= 0) {
        deptoEl.value = opts.selectDepto;
      } else if (opts.resetDepto) {
        deptoEl.value = deptos[0];
      } else {
        deptoEl.value = deptos.indexOf(prev) >= 0 ? prev : deptos[0];
      }
    }

    function applyCatalogSnapshot(snap, opts) {
      opts = opts || {};
      if (snap && snap.familiasTree && Object.keys(snap.familiasTree).length) {
        _paFamTree = snap.familiasTree;
      }
      if (familiaEl) {
        var fams = Object.keys(_paFamTree);
        if (fams.length) {
          var prevFam = opts.selectFamilia || (familiaEl.value || '').trim().toUpperCase();
          familiaEl.innerHTML = fams.map(function (f) {
            return '<option value="' + String(f).replace(/"/g, '&quot;') + '">' + f + '</option>';
          }).join('');
          familiaEl.value = fams.indexOf(prevFam) >= 0 ? prevFam : fams[0];
        }
      }
      syncDepartamentosPorFamilia(opts);

      if (marcaEl && snap && Array.isArray(snap.marcas) && snap.marcas.length) {
        var prevMar = marcaEl.value;
        marcaEl.innerHTML = snap.marcas.map(function (m) {
          return '<option value="' + String(m).replace(/"/g, '&quot;') + '">' + m + '</option>';
        }).join('') + '<option value="__OTRA__">+ OTRA (CAPTURAR MARCA...)</option>';
        if (snap.marcas.indexOf(prevMar) >= 0) marcaEl.value = prevMar;
      }
      if (presEl && snap && Array.isArray(snap.presentaciones) && snap.presentaciones.length) {
        var prevPres = cleanUnitName(presEl.value);
        presEl.innerHTML = snap.presentaciones.map(function (p) {
          var cleanP = cleanUnitName(p);
          var satP = resolveUnitToSatCode(cleanP);
          return '<option value="' + String(cleanP).replace(/"/g, '&quot;') + '">' + cleanP + ' (' + satP + ')</option>';
        }).join('');
        var matchingPres = snap.presentaciones.map(cleanUnitName);
        if (matchingPres.indexOf(prevPres) >= 0) presEl.value = prevPres;
      }
      if (unidadEl && snap && Array.isArray(snap.unidades) && snap.unidades.length) {
        var prevUni = cleanUnitName(unidadEl.value);
        unidadEl.innerHTML = snap.unidades.map(function (u) {
          var cleanU = cleanUnitName(u);
          var satU = resolveUnitToSatCode(cleanU);
          return '<option value="' + String(cleanU).replace(/"/g, '&quot;') + '">' + cleanU + ' (' + satU + ')</option>';
        }).join('');
        var matchingUni = snap.unidades.map(cleanUnitName);
        if (matchingUni.indexOf(prevUni) >= 0) unidadEl.value = prevUni;
      }
      syncSatUnidadFromEmpaque({ keepManualSatUnidad: true });
      recalcularPrecio('catalog_sync');
      if (ivaEl && snap && Array.isArray(snap.ivas) && snap.ivas.length) {
        var dlId = 'pa-iva-datalist';
        var dl = document.getElementById(dlId);
        if (!dl && ivaEl.parentNode) {
          dl = document.createElement('datalist');
          dl.id = dlId;
          ivaEl.parentNode.appendChild(dl);
        }
        if (dl) {
          dl.innerHTML = snap.ivas.map(function (iv) {
            var m = /(\d+(\.\d+)?)/.exec(String(iv));
            var nVal = m ? m[1] : '0';
            return '<option value="' + nVal + '" label="' + String(iv).replace(/"/g, '&quot;') + '"></option>';
          }).join('');
          ivaEl.setAttribute('list', dlId);
        }
        if (!window._editingProductId && snap.defaultIva != null && !ivaEl.dataset.userEdited) {
          ivaEl.value = snap.defaultIva;
          recalcularPrecio();
        }
      }
    }

    if (ivaEl) {
      ivaEl.addEventListener('input', function () {
        ivaEl.dataset.userEdited = '1';
      });
    }

    if (familiaEl) {
      familiaEl.addEventListener('change', function () {
        syncDepartamentosPorFamilia({ resetDepto: true });
      });
    }

    if (global.CalebsysCatalogStore && typeof global.CalebsysCatalogStore.ensureLoaded === 'function') {
      global.CalebsysCatalogStore.ensureLoaded().then(function (snap) {
        applyCatalogSnapshot(snap);
      });
    } else {
      syncDepartamentosPorFamilia();
    }

    if (global.__paCatalogSyncListener) {
      global.removeEventListener('calebsys:catalog-updated', global.__paCatalogSyncListener);
    }
    global.__paCatalogSyncListener = function (ev) {
      if (ev && ev.detail) applyCatalogSnapshot(ev.detail);
    };
    global.addEventListener('calebsys:catalog-updated', global.__paCatalogSyncListener);

    // ── 2c. Creación Rápida Inline (+ junto a FAMILIA * y + junto a DEPARTAMENTO *) ──
    var btnQuickFam   = document.getElementById('pa-btn-quick-familia');
    var btnQuickDepto = document.getElementById('pa-btn-quick-depto');
    var quickModal    = document.getElementById('pa-quick-cat-modal');
    var quickTitle    = document.getElementById('pa-quick-cat-title');
    var quickSub      = document.getElementById('pa-quick-cat-sub');
    var quickInp      = document.getElementById('pa-quick-cat-inp');
    var quickSaveBtn  = document.getElementById('pa-quick-cat-save');
    var quickCancel   = document.getElementById('pa-quick-cat-cancel');
    var quickClose    = document.getElementById('pa-quick-cat-close');
    var quickGotoF5   = document.getElementById('pa-quick-cat-goto-f5');
    var _quickMode    = 'familia';

    function openQuickCatModal(mode) {
      if (!quickModal || !quickInp) return;
      _quickMode = mode;
      var curFam = familiaEl ? (familiaEl.value || '').trim().toUpperCase() : 'GENERAL';
      if (mode === 'familia') {
        if (quickTitle) quickTitle.innerHTML = '<i class="fa-solid fa-layer-group" style="color:#06b6d4;"></i> Nueva Familia';
        if (quickSub) quickSub.textContent = 'Se agregará al catálogo general y quedará seleccionada automáticamente.';
        quickInp.placeholder = 'Ej. ACEROS, FERRETERÍA...';
      } else {
        if (quickTitle) quickTitle.innerHTML = '<i class="fa-solid fa-sitemap" style="color:#06b6d4;"></i> Nuevo Departamento en «' + curFam + '»';
        if (quickSub) quickSub.textContent = 'Se vinculará a la familia «' + curFam + '» y quedará seleccionado en el formulario.';
        quickInp.placeholder = 'Ej. PERFILES, LÁMINAS...';
      }
      quickInp.value = '';
      quickModal.style.display = 'flex';
      setTimeout(function () { quickInp.focus(); }, 25);
    }

    function closeQuickCatModal() {
      if (quickModal) quickModal.style.display = 'none';
    }

    function saveQuickCatModal() {
      if (!quickInp) return;
      var val = (quickInp.value || '').trim().toUpperCase();
      if (!val) { quickInp.focus(); return; }
      if (_quickMode === 'familia') {
        if (typeof global.calebsysAddFamilia === 'function') {
          var rFam = global.calebsysAddFamilia(val);
          var targetFam = (rFam && rFam.familia) || val;
          if (global.CalebsysCatalogStore) {
            applyCatalogSnapshot(global.CalebsysCatalogStore.getSnapshot(), { selectFamilia: targetFam, resetDepto: true });
          }
        }
        closeQuickCatModal();
      } else {
        var curFam = familiaEl ? (familiaEl.value || '').trim().toUpperCase() : '';
        if (typeof global.calebsysAddDepartamento === 'function') {
          var rDep = global.calebsysAddDepartamento(curFam, val);
          var targetDep = (rDep && rDep.departamento) || val;
          if (global.CalebsysCatalogStore) {
            applyCatalogSnapshot(global.CalebsysCatalogStore.getSnapshot(), { selectFamilia: curFam, selectDepto: targetDep });
          }
        }
        closeQuickCatModal();
      }
    }

    if (btnQuickFam)   btnQuickFam.addEventListener('click', function () { openQuickCatModal('familia'); });
    if (btnQuickDepto) btnQuickDepto.addEventListener('click', function () { openQuickCatModal('depto'); });
    if (quickCancel)   quickCancel.addEventListener('click', closeQuickCatModal);
    if (quickClose)    quickClose.addEventListener('click', closeQuickCatModal);
    if (quickSaveBtn)  quickSaveBtn.addEventListener('click', saveQuickCatModal);
    if (quickInp) {
      quickInp.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); saveQuickCatModal(); }
        else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeQuickCatModal(); }
      });
    }
    if (quickGotoF5) {
      quickGotoF5.addEventListener('click', function () {
        closeQuickCatModal();
        var tabF5 = document.querySelector('#pa-tabs-nav .pa-tab[data-tab="catalogos"]');
        if (tabF5) tabF5.click();
      });
    }

    // ── 2c. Buscador Semántico Multicapa + IA Clasificadora SAT (Anti-Alucinación) + Aprendizaje en Caliente ──
    var SAT_CUSTOM_KEY  = 'calebsys_custom_sat_codes_v1';
    var SAT_LEARNED_KEY = 'calebsys_sat_learned_memory_v1';

    var SAT_PROD_SERV_BASE = [
      // ALIMENTOS, BEBIDAS, AGUA EMBOTELLADA Y ABARROTES (División 50)
      { code: '50202301', desc: 'Agua embotellada', cat: 'Alimentos, Bebidas y Tabaco > Bebidas no alcohólicas', unit: 'H87', kw: 'agua purificada embotellada garrafon botella mineral natural bonafont ciel epura litro' },
      { code: '50202300', desc: 'Bebidas no alcohólicas', cat: 'Alimentos, Bebidas y Tabaco > Bebidas no alcohólicas', unit: 'H87', kw: 'bebida no alcoholica liquido hidratante' },
      { code: '50202306', desc: 'Refrescos o bebidas carbonatadas', cat: 'Alimentos, Bebidas y Tabaco > Bebidas no alcohólicas', unit: 'H87', kw: 'refresco soda gaseosa coca pepsi lata botella' },
      { code: '50202309', desc: 'Bebidas energéticas o deportivas hidratantes', cat: 'Alimentos, Bebidas y Tabaco > Bebidas no alcohólicas', unit: 'H87', kw: 'bebida energetica isotonica electrolitos suero gatorade powerade' },
      { code: '50202304', desc: 'Jugos o néctares de frutas', cat: 'Alimentos, Bebidas y Tabaco > Bebidas no alcohólicas', unit: 'H87', kw: 'jugo nectar fruta concentrado' },
      { code: '50201700', desc: 'Café y té', cat: 'Alimentos, Bebidas y Tabaco > Café y té', unit: 'H87', kw: 'cafe soluble grano molido te infusiones' },
      { code: '50192100', desc: 'Botanas, papas fritas y frituras', cat: 'Alimentos, Bebidas y Tabaco > Botanas y snacks', unit: 'H87', kw: 'botana papas fritas frituras cacahuates chicharrones' },
      { code: '50161800', desc: 'Productos de confitería, dulces y chocolates', cat: 'Alimentos, Bebidas y Tabaco > Dulces y chocolates', unit: 'H87', kw: 'dulce caramelo chocolate paleta chicle gomita' },
      { code: '50181900', desc: 'Pan, galletas y pastelillos dulces', cat: 'Alimentos, Bebidas y Tabaco > Panadería y galletas', unit: 'H87', kw: 'galleta pan pastelito barra cereal' },
      { code: '50131700', desc: 'Leche y productos lácteos', cat: 'Alimentos, Bebidas y Tabaco > Lácteos y huevo', unit: 'LTR', kw: 'leche deslactosada entera evaporada queso crema yogurt' },
      { code: '50221100', desc: 'Granos, arroz, frijol y semillas', cat: 'Alimentos, Bebidas y Tabaco > Cereales y legumbres', unit: 'KGM', kw: 'arroz frijol maiz lenteja avena semilla' },
      { code: '50171500', desc: 'Aceites comestibles, azúcar, sal y condimentos', cat: 'Alimentos, Bebidas y Tabaco > Abarrotes y condimentos', unit: 'H87', kw: 'aceite vegetal cocina azucar sal salsa mayonesa' },

      // HERRAMIENTAS DE MANO Y MARTILLOS (División 27)
      { code: '27111602', desc: 'Martillos de uña o de carpintero', cat: 'Herramientas y Maquinaria > Herramientas manuales', unit: 'H87', kw: 'martillo carpintero una chivo 16oz 20oz truper' },
      { code: '27111600', desc: 'Martillos', cat: 'Herramientas y Maquinaria > Herramientas manuales', unit: 'H87', kw: 'martillo martillos golpe herramienta general' },
      { code: '27111604', desc: 'Martillos de bola', cat: 'Herramientas y Maquinaria > Herramientas manuales', unit: 'H87', kw: 'martillo bola mecanico herrero' },
      { code: '27111605', desc: 'Martillos de goma o hule', cat: 'Herramientas y Maquinaria > Herramientas manuales', unit: 'H87', kw: 'martillo goma hule mazo azulejero' },
      { code: '27111603', desc: 'Mazos o marros', cat: 'Herramientas y Maquinaria > Herramientas manuales', unit: 'H87', kw: 'mazo marro martillo pesado demolicion octogonal' },
      { code: '27111618', desc: 'Martillos demoledores o rotomartillos', cat: 'Herramientas y Maquinaria > Herramientas eléctricas', unit: 'H87', kw: 'rotomartillo martillo demoledor cincelador taladro' },
      { code: '27111700', desc: 'Llaves inglesas, desarmadores y dados', cat: 'Herramientas y Maquinaria > Llaves y desarmadores', unit: 'H87', kw: 'llave desarmador destornillador stilson perico espanola combinada' },
      { code: '27111701', desc: 'Desarmadores o destornilladores', cat: 'Herramientas y Maquinaria > Llaves y desarmadores', unit: 'H87', kw: 'desarmador destornillador plano cruz phillips' },
      { code: '27111704', desc: 'Llaves ajustables (pericos y llaves stilson)', cat: 'Herramientas y Maquinaria > Llaves y desarmadores', unit: 'H87', kw: 'llave ajustable perico stilson plomero' },
      { code: '27111708', desc: 'Llaves Allen o hexagonales', cat: 'Herramientas y Maquinaria > Llaves y desarmadores', unit: 'H87', kw: 'llave allen hexagonal torx' },
      { code: '27112100', desc: 'Pinzas, alicates y tenazas', cat: 'Herramientas y Maquinaria > Sujeción y pinzas', unit: 'H87', kw: 'pinza pinzas alicate tenaza electricista chofer presion corte' },
      { code: '27111500', desc: 'Herramientas de corte, cuchillas, cinceles y navajas', cat: 'Herramientas y Maquinaria > Herramientas de corte', unit: 'H87', kw: 'cutter exacto navaja cuchilla tijera cincel punzon' },
      { code: '27111800', desc: 'Herramientas de medición y trazado (flexómetros, niveles)', cat: 'Herramientas y Maquinaria > Medición y nivelación', unit: 'H87', kw: 'flexometro cinta metrica nivel escuadra plomada' },
      { code: '27111801', desc: 'Cintas métricas o flexómetros', cat: 'Herramientas y Maquinaria > Medición y nivelación', unit: 'H87', kw: 'flexometro cinta metrica metro medir' },
      { code: '27111802', desc: 'Niveles de burbuja o láser', cat: 'Herramientas y Maquinaria > Medición y nivelación', unit: 'H87', kw: 'nivel niveles burbuja aluminio laser' },
      { code: '27111900', desc: 'Limas, escofinas y piedras de afilar', cat: 'Herramientas y Maquinaria > Desbaste y limas', unit: 'H87', kw: 'lima escofina lija afilar' },
      { code: '27112000', desc: 'Palas, picos, azadones y herramientas de jardín', cat: 'Herramientas y Maquinaria > Jardinería y excavación', unit: 'H87', kw: 'pala pico zapapico azadon rastrillo machete cava' },
      { code: '27112200', desc: 'Llanas, cucharas de albañil, flotas y espátulas', cat: 'Herramientas y Maquinaria > Albañilería', unit: 'H87', kw: 'llana cuchara albanil espatula flota' },
      { code: '27112300', desc: 'Sierras manuales, seguetas y serruchos', cat: 'Herramientas y Maquinaria > Herramientas de corte', unit: 'H87', kw: 'sierra segueta serrucho arco' },
      { code: '27112700', desc: 'Herramientas eléctricas (taladros, esmeriladoras, sierras)', cat: 'Herramientas y Maquinaria > Herramientas eléctricas', unit: 'H87', kw: 'taladro esmeriladora pulidora sierra caladora circular' },
      { code: '27112701', desc: 'Taladros y rotomartillos eléctricos o inalámbricos', cat: 'Herramientas y Maquinaria > Herramientas eléctricas', unit: 'H87', kw: 'taladro rotomartillo atornillador inalambrico' },
      { code: '27112703', desc: 'Esmeriladoras angulares y pulidoras', cat: 'Herramientas y Maquinaria > Herramientas eléctricas', unit: 'H87', kw: 'esmeril esmeriladora pulidora miniesmeriladora buffer' },
      { code: '27112800', desc: 'Brocas, discos de corte, discos abrasivos y lijas', cat: 'Herramientas y Maquinaria > Brocas y abrasivos', unit: 'H87', kw: 'broca disco corte desbaste diamante sierra lija' },
      { code: '27113200', desc: 'Juegos de herramientas y cajas de herramientas', cat: 'Herramientas y Maquinaria > Juegos de herramientas', unit: 'KT', kw: 'juego herramientas kit caja autocle dados' },

      // ACEROS, PERFILES Y METALES (División 30)
      { code: '30101800', desc: 'Perfiles de acero y varillas de refuerzo', cat: 'Materiales de Construcción > Acero estructural y perfiles', unit: 'H87', kw: 'perfil acero ptr polin monten varilla refuerzo' },
      { code: '30102400', desc: 'Varillas de acero corrugadas y alambrón', cat: 'Materiales de Construcción > Acero estructural y varillas', unit: 'H87', kw: 'varilla corrugada alambron acero barra' },
      { code: '30102402', desc: 'Varilla corrugada de acero para refuerzo de concreto', cat: 'Materiales de Construcción > Acero estructural y varillas', unit: 'KGM', kw: 'varilla corrugada refuerzo 3/8 1/2 5/8 3/4 deacero' },
      { code: '30101500', desc: 'Ángulos de acero y soleras estructurales', cat: 'Materiales de Construcción > Acero estructural y perfiles', unit: 'H87', kw: 'angulo acero solera estructural' },
      { code: '30101700', desc: 'Vigas de acero (IPR, IPS, Canal)', cat: 'Materiales de Construcción > Acero estructural y perfiles', unit: 'H87', kw: 'viga acero ipr ips canal monten polin' },
      { code: '30102000', desc: 'Láminas y placas de acero (galvanizada, negra, acanalada)', cat: 'Materiales de Construcción > Láminas y placas metálicas', unit: 'H87', kw: 'lamina galvanizada zintro acanalada placa acero' },
      { code: '30102200', desc: 'Alambre recocido, alambre galvanizado y de púas', cat: 'Materiales de Construcción > Alambres y mallas', unit: 'KGM', kw: 'alambre recocido galvanizado puas amarre' },
      { code: '30102300', desc: 'Perfiles tubulares de acero (PTR, cuadrado, rectangular)', cat: 'Materiales de Construcción > Acero estructural y perfiles', unit: 'H87', kw: 'ptr perfil tubular cuadrado rectangular' },
      { code: '30103600', desc: 'Mallas electrosoldadas, malla ciclónica y tela gallinera', cat: 'Materiales de Construcción > Alambres y mallas', unit: 'XRO', kw: 'malla electrosoldada alambre recocido puas ciclonica criba' },
      { code: '30103604', desc: 'Castillos prefabricados electrosoldados (Armex)', cat: 'Materiales de Construcción > Alambres y mallas', unit: 'H87', kw: 'armex castillo electrosoldado escalerilla' },
      { code: '23271400', desc: 'Soldadura, electrodos, microalambre y equipos para soldar', cat: 'Maquinaria Industrial > Equipos y suministros de soldadura', unit: 'KGM', kw: 'soldadura electrodo microalambre 6013 7018 estano cautin' },

      // CEMENTO, CONCRETO, YESO Y ALBAÑILERÍA (División 30)
      { code: '30111500', desc: 'Concreto, cementos y morteros preparados', cat: 'Materiales de Construcción > Cemento, cal y concreto', unit: 'XBG', kw: 'cemento mortero concreto mezcla bulto' },
      { code: '30111600', desc: 'Cemento gris, cemento blanco y cal', cat: 'Materiales de Construcción > Cemento, cal y concreto', unit: 'XBG', kw: 'cemento gris blanco cal hidratada cemex apasco moctezuma' },
      { code: '30111601', desc: 'Cemento Portland (Bulto / Saco)', cat: 'Materiales de Construcción > Cemento, cal y concreto', unit: 'XBG', kw: 'cemento portland tolteca apasco cruz azul bulto 50kg' },
      { code: '30111602', desc: 'Cal hidratada para construcción', cat: 'Materiales de Construcción > Cemento, cal y concreto', unit: 'XBG', kw: 'cal hidratada bulto saco calidra' },
      { code: '30111700', desc: 'Yeso, estuco y pastas para muros', cat: 'Materiales de Construcción > Cemento, cal y concreto', unit: 'XBG', kw: 'yeso estuco pasta muro recubrimiento' },
      { code: '30161500', desc: 'Paneles de yeso (Tablaroca) y fibrocemento (Durock)', cat: 'Materiales de Construcción > Acabados y muros ligeros', unit: 'H87', kw: 'tablaroca panel paneles yeso durock plafon sheetrock' },
      { code: '30111800', desc: 'Áridos: Arena, grava, piedra y tezontle', cat: 'Materiales de Construcción > Áridos y agregados', unit: 'MTQ', kw: 'arena grava piedra tezontle tepetate sello' },
      { code: '30131500', desc: 'Bloques de concreto, ladrillos, tabiques y adoquines', cat: 'Materiales de Construcción > Bloques y ladrillos', unit: 'H87', kw: 'block bloque ladrillo tabique tabicon bovedilla' },
      { code: '30131600', desc: 'Azulejos, losetas, pisos cerámicos y porcelanatos', cat: 'Materiales de Construcción > Pisos y recubrimientos cerámicos', unit: 'MTK', kw: 'azulejo loseta piso ceramico porcelanato boquilla' },

      // MADERAS, LÁMINAS Y TECHOS
      { code: '30103619', desc: 'Madera de pino para construcción (Tablas, polines, barrotes)', cat: 'Materiales de Construcción > Maderas y cimbra', unit: 'H87', kw: 'madera pino tabla polin barrote cimbra duela' },
      { code: '30102903', desc: 'Triplay, madera contrachapada y MDF', cat: 'Materiales de Construcción > Maderas y cimbra', unit: 'H87', kw: 'triplay mdf aglomerado hoja cimbra' },
      { code: '30151500', desc: 'Materiales para techados, láminas e impermeabilizantes', cat: 'Materiales de Construcción > Techados y cubiertas', unit: 'H87', kw: 'lamina techo impermeabilizante teja carton' },

      // TORNILLERÍA, FIJACIÓN Y HERRAJES (División 31)
      { code: '31161500', desc: 'Tornillos, pijas y birlos', cat: 'Componentes de Fabricación > Tornillería y fijación', unit: 'H87', kw: 'tornillo tornillos pija pijas birlo chilillo tirafondo' },
      { code: '31161700', desc: 'Tuercas y rondanas (arandelas)', cat: 'Componentes de Fabricación > Tornillería y fijación', unit: 'H87', kw: 'tuerca tuercas rondana arandela hexagonal' },
      { code: '31162000', desc: 'Clavos, grapas y tachuelas', cat: 'Componentes de Fabricación > Tornillería y fijación', unit: 'KGM', kw: 'clavo clavos grapa tachuela concreto madera' },
      { code: '31162100', desc: 'Taquetes, anclas y sujetadores de expansión', cat: 'Componentes de Fabricación > Tornillería y fijación', unit: 'H87', kw: 'taquete ancla sujetador plastico expansion' },
      { code: '31162400', desc: 'Bisagras, abrazaderas, correderas y herrajes', cat: 'Componentes de Fabricación > Herrajes y cerrajería', unit: 'H87', kw: 'bisagra abrazadera cincho corredera herraje pasador' },
      { code: '46171500', desc: 'Candados, cerraduras, chapas y cerrojos', cat: 'Equipos de Seguridad > Cerrajería y control de acceso', unit: 'H87', kw: 'candado cerradura chapa cerrojo llave' },

      // PLOMERÍA, TUBERÍAS Y CONEXIONES (División 40 / 30)
      { code: '40171500', desc: 'Tubos y tuberías comerciales (PVC, CPVC, Cobre, Galvanizado, PPR)', cat: 'Plomería, Calefacción y Tuberías > Tubos y tuberías', unit: 'H87', kw: 'tubo tuberia pvc cpvc cobre galvanizado ppr sanitario hidraulico' },
      { code: '40141700', desc: 'Conexiones y accesorios de plomería (Codos, tees, coples)', cat: 'Plomería, Calefacción y Tuberías > Conexiones de tubería', unit: 'H87', kw: 'codo tee cople reduccion conector niple tuerca union' },
      { code: '40141600', desc: 'Válvulas, llaves de paso, mezcladoras y grifos', cat: 'Plomería, Calefacción y Tuberías > Válvulas y grifería', unit: 'H87', kw: 'valvula llave paso esfera nariz mezcladora regadera flotador check' },
      { code: '40142100', desc: 'Mangueras y conexiones para agua o gas', cat: 'Plomería, Calefacción y Tuberías > Mangueras y conexiones', unit: 'H87', kw: 'manguera jardin gas coflex alimentadora conector' },
      { code: '30181500', desc: 'Inodoros, sanitarios, lavabos, tinacos y muebles de baño', cat: 'Materiales de Construcción > Instalaciones de baño y tinacos', unit: 'H87', kw: 'tinaco rotoplas cisterna sanitario inodoro wc taza lavabo tarja' },
      { code: '40151500', desc: 'Bombas de agua e hidroneumáticos', cat: 'Plomería, Calefacción y Tuberías > Bombas y compresores', unit: 'H87', kw: 'bomba agua periferica centrifuga sumergible presurizador' },

      // MATERIAL ELÉCTRICO E ILUMINACIÓN (División 26 / 39)
      { code: '26121600', desc: 'Cables eléctricos, alambres de cobre y cordones', cat: 'Generación y Distribución Eléctrica > Cables y conductores', unit: 'MTR', kw: 'cable electrico thw cobre calibre 10 12 14 duplex uso rudo' },
      { code: '39121400', desc: 'Contactos, apagadores, clavijas, placas y extensiones eléctricas', cat: 'Iluminación y Accesorios Eléctricos > Dispositivos eléctricos', unit: 'H87', kw: 'contacto apagador interruptor clavija placa extension multicontacto' },
      { code: '39121600', desc: 'Pastillas termomagnéticas, centros de carga y fusibles', cat: 'Iluminación y Accesorios Eléctricos > Protección de circuitos', unit: 'H87', kw: 'pastilla termomagnetica breaker centro carga interruptor fusible' },
      { code: '39111500', desc: 'Lámparas, focos LED, reflectores y luminarias', cat: 'Iluminación y Accesorios Eléctricos > Iluminación y lámparas', unit: 'H87', kw: 'foco led bulbo lampara reflector luminaria' },
      { code: '39131700', desc: 'Cajas eléctricas (chalupas, registros), poliducto y tubo conduit', cat: 'Iluminación y Accesorios Eléctricos > Canalización y cajas eléctricas', unit: 'H87', kw: 'chalupa caja electrica registro poliducto manguera corrugada conduit canaleta' },

      // PINTURAS, QUÍMICOS, ADHESIVOS, LIMPIEZA Y LUBRICANTES
      { code: '31211500', desc: 'Pinturas vinílicas, esmaltes, aerosoles y barnices', cat: 'Componentes de Fabricación > Pinturas y recubrimientos', unit: 'LTR', kw: 'pintura vinilica acrilica esmalte aerosol barniz comex berel' },
      { code: '31211700', desc: 'Selladores, primers e impermeabilizantes', cat: 'Componentes de Fabricación > Pinturas y recubrimientos', unit: 'LTR', kw: 'impermeabilizante sellador primer asfaltico fibratado' },
      { code: '31211900', desc: 'Brochas, rodillos y accesorios para pintar', cat: 'Componentes de Fabricación > Pinturas y recubrimientos', unit: 'H87', kw: 'brocha rodillo charola felpa pintar' },
      { code: '12191600', desc: 'Solventes, thinner, aguarrás y diluyentes', cat: 'Productos Químicos > Solventes y diluyentes', unit: 'LTR', kw: 'thinner thiner solvente aguarras acido muriatico' },
      { code: '31201500', desc: 'Cintas adhesivas y selladoras (Masking, aislar, teflón, ducto)', cat: 'Componentes de Fabricación > Adhesivos y selladores', unit: 'H87', kw: 'cinta aislar masking teflon selladora canela empaque ducto' },
      { code: '31201600', desc: 'Pegamentos, silicones, pegazulejo, resanadores y epóxicos', cat: 'Componentes de Fabricación > Adhesivos y selladores', unit: 'H87', kw: 'pegamento silicon sellador resistol pegazulejo crest pvc epoxico' },
      { code: '46181500', desc: 'Equipo de protección personal (Guantes, cascos, lentes, botas)', cat: 'Equipos de Seguridad > Protección personal (EPP)', unit: 'H87', kw: 'guante guantes carnaza nitrilo casco lente seguridad bota chaleco cubrebocas faja' },
      { code: '31151500', desc: 'Cuerdas, sogas, lazos, cadenas y eslingas', cat: 'Componentes de Fabricación > Cuerdas, cadenas y cables', unit: 'MTR', kw: 'cuerda soga lazo rafia cadena eslinga' },
      { code: '47131600', desc: 'Escobas, trapeadores, cepillos y artículos de limpieza', cat: 'Equipos y Suministros de Limpieza > Utensilios de limpieza', unit: 'H87', kw: 'escoba trapeador jalador cepillo cubeta recogedor' },
      { code: '47131800', desc: 'Soluciones de limpieza, cloro, detergentes y desinfectantes', cat: 'Equipos y Suministros de Limpieza > Químicos y detergentes', unit: 'LTR', kw: 'cloro limpiador desinfectante detergente jabon pinol fabuloso' },
      { code: '15121500', desc: 'Aceites lubricantes, grasas automotrices y afloja todo', cat: 'Combustibles y Lubricantes > Lubricantes y aceites', unit: 'LTR', kw: 'aceite motor lubricante grasa afloja todo wd40 anticongelante' },
      { code: '44121600', desc: 'Suministros de papelería y oficina', cat: 'Equipos y Suministros de Oficina > Papelería', unit: 'H87', kw: 'papel hoja libreta cuaderno pluma boligrafo marcador carpeta' },
      { code: '78101800', desc: 'Transporte de carga por carretera (Fletes y envíos)', cat: 'Servicios de Transporte y Almacenaje > Transporte de carga', unit: 'E48', kw: 'flete envio transporte maniobra servicio entrega' },
      { code: '01010101', desc: 'No existe en el catálogo (Clave genérica SAT)', cat: 'Catálogo General SAT > Sin clasificación específica', unit: 'H87', kw: 'generico general no existe catalogo mostrador' }
    ];

    var SAT_UNIDADES_BASE = [
      { code: 'H87', desc: 'Pieza', usage: 'Venta individual, artículos por unidad, tramos, botellas', cat: 'Unidades de Medida SAT > Venta individual, artículos por unidad', kw: 'pieza pza unidad individual articulo tramo tira botella garrafon envase' },
      { code: 'MTR', desc: 'Metro', usage: 'Venta por longitud lineal, cables, mangueras, perfiles, tramos, tiras', cat: 'Unidades de Medida SAT > Longitud lineal, cables, tramos, tiras', kw: 'metro lineal mtr metros tramo tira perfil cable manguera cuerda' },
      { code: 'KGM', desc: 'Kilogramo', usage: 'Venta por peso, clavos, alambre recocido, acero', cat: 'Unidades de Medida SAT > Venta por peso, clavos, alambre, acero', kw: 'kilo kilogramo kg kilos peso granel clavo alambre' },
      { code: 'LTR', desc: 'Litro', usage: 'Líquidos, pinturas, solventes, impermeabilizantes, botellas, garrafones', cat: 'Unidades de Medida SAT > Líquidos, pinturas, botellas, garrafones', kw: 'litro lt litros liquido agua pintura solvente botella garrafon envase' },
      { code: 'TNE', desc: 'Tonelada métrica', usage: 'Acero estructural, varilla o cemento por volumen', cat: 'Unidades de Medida SAT > Acero estructural, varilla o cemento por volumen', kw: 'tonelada ton metrica tne mayoreo pesado' },
      { code: 'MTQ', desc: 'Metro cúbico', usage: 'Arena, grava, piedra, concreto premezclado', cat: 'Unidades de Medida SAT > Arena, grava, piedra, concreto premezclado', kw: 'metro cubico m3 mtq arena grava piedra concreto volumen' },
      { code: 'MTK', desc: 'Metro cuadrado', usage: 'Pisos cerámicos, azulejos, mallas, impermeabilizantes', cat: 'Unidades de Medida SAT > Pisos cerámicos, azulejos, superficie', kw: 'metro cuadrado m2 mtk piso azulejo loseta superficie area' },
      { code: 'XBX', desc: 'Caja', usage: 'Empaque cerrado de mayoreo, tornillería, azulejo', cat: 'Unidades de Medida SAT > Empaque cerrado de mayoreo, caja', kw: 'caja xbx empaque carton mayoreo' },
      { code: 'XPK', desc: 'Paquete', usage: 'Conjunto empaquetado de piezas o accesorios', cat: 'Unidades de Medida SAT > Conjunto empaquetado de piezas o accesorios', kw: 'paquete paq xpk blister empaque' },
      { code: 'XSA', desc: 'Saco', usage: 'Bulto o costal de cemento, mortero, cal, yeso, pegazulejo', cat: 'Unidades de Medida SAT > Bulto o costal de cemento, mortero, cal, yeso', kw: 'saco bulto costal xsa cemento mortero cal yeso pegazulejo' },
      { code: 'XBG', desc: 'Bolsa', usage: 'Bulto plástico, costal ligero, bolsa de material', cat: 'Unidades de Medida SAT > Bulto plástico, costal ligero, bolsa', kw: 'bolsa bulto costal saco xbg empaque plastico' },
      { code: 'XBH', desc: 'Atado / Manojo', usage: 'Atado de varilla, alambre, madera o tubería', cat: 'Unidades de Medida SAT > Atado de varilla, alambre, madera o tubería', kw: 'atado manojo xbh amarre varilla madera' },
      { code: 'XRO', desc: 'Rollo', usage: 'Rollo de cable eléctrico, malla ciclónica, manguera, poliducto', cat: 'Unidades de Medida SAT > Rollo de cable, malla ciclónica, manguera', kw: 'rollo xro bobina carrete cable malla manguera poliducto' },
      { code: 'XBJ', desc: 'Cubeta', usage: 'Cubeta de 19L de pintura, impermeabilizante o sellador', cat: 'Unidades de Medida SAT > Cubeta de 19L de pintura o impermeabilizante', kw: 'cubeta balde bote xbj xpl 19l pintura impermeabilizante' },
      { code: 'XBO', desc: 'Botella', usage: 'Botella, garrafón o envase individual de líquido o químico', cat: 'Unidades de Medida SAT > Botella, garrafón o envase individual', kw: 'botella garrafon envase frasco xbo liquido agua' },
      { code: 'GLL', desc: 'Galón', usage: 'Bote de 3.785L de pintura, esmalte, barniz o solvente', cat: 'Unidades de Medida SAT > Bote de 3.785L de pintura, esmalte o barniz', kw: 'galon gll pintura esmalte barniz impermeabilizante' },
      { code: 'SET', desc: 'Conjunto', usage: 'Juego o kit de herramientas, brocas, llaves o accesorios', cat: 'Unidades de Medida SAT > Juego o kit de herramientas y accesorios', kw: 'conjunto set juego kit kt herramientas accesorios' },
      { code: 'PR',  desc: 'Par', usage: 'Guantes de seguridad, botas industriales, bisagras', cat: 'Unidades de Medida SAT > Guantes de seguridad, botas, bisagras', kw: 'par pr pareja guantes botas calzado' },
      { code: 'MIL', desc: 'Millar', usage: 'Venta por cada 1,000 unidades: ladrillos, tornillos, pijas', cat: 'Unidades de Medida SAT > Venta por cada 1,000 unidades', kw: 'millar mil 1000 ladrillo tabique tornillo' },
      { code: 'E48', desc: 'Unidad de servicio', usage: 'Fletes, entregas a obra, maniobras, instalaciones', cat: 'Unidades de Medida SAT > Fletes, entregas a obra, maniobras', kw: 'servicio flete envio entrega maniobra mano obra e48' },
      { code: 'ACT', desc: 'Actividad', usage: 'Servicios generales, mano de obra o reparaciones', cat: 'Unidades de Medida SAT > Servicios generales o reparaciones', kw: 'actividad act instalacion mantenimiento reparacion' },
      { code: 'GRM', desc: 'Gramo', usage: 'Pesaje ligero, soldadura, químicos o pigmentos', cat: 'Unidades de Medida SAT > Pesaje ligero, soldadura o químicos', kw: 'gramo gr gramos grm peso' }
    ];

    // Sinónimos coloquiales directos hacia Claves SAT de Unidad (c_ClaveUnidad)
    var SAT_UNIT_COLLOQUIAL_PRIORITY = {
      'bulto':    ['XSA', 'XBG'],
      'bultos':   ['XSA', 'XBG'],
      'costal':   ['XSA', 'XBG'],
      'costales': ['XSA', 'XBG'],
      'saco':     ['XSA', 'XBG'],
      'bolsa':    ['XBG', 'XSA'],
      'botella':  ['XBO', 'LTR', 'H87'],
      'botellas': ['XBO', 'LTR', 'H87'],
      'garrafon': ['XBO', 'LTR', 'H87'],
      'envase':   ['XBO', 'LTR', 'H87'],
      'tramo':    ['MTR', 'H87'],
      'tramos':   ['MTR', 'H87'],
      'tira':     ['MTR', 'H87'],
      'tiras':    ['MTR', 'H87'],
      'pieza':    ['H87'],
      'pza':      ['H87'],
      'metro':    ['MTR', 'MTK', 'MTQ'],
      'mtr':      ['MTR'],
      'kilo':     ['KGM'],
      'kg':       ['KGM'],
      'kilogramo':['KGM'],
      'litro':    ['LTR', 'GLL', 'XBO'],
      'lt':       ['LTR'],
      'tonelada': ['TNE'],
      'ton':      ['TNE'],
      'm3':       ['MTQ'],
      'cubico':   ['MTQ'],
      'm2':       ['MTK'],
      'cuadrado': ['MTK'],
      'caja':     ['XBX'],
      'paquete':  ['XPK'],
      'atado':    ['XBH'],
      'manojo':   ['XBH'],
      'rollo':    ['XRO'],
      'cubeta':   ['XBJ', 'LTR'],
      'balde':    ['XBJ'],
      'bote':     ['XBJ', 'GLL'],
      'galon':    ['GLL', 'LTR'],
      'juego':    ['SET'],
      'kit':      ['SET'],
      'par':      ['PR'],
      'millar':   ['MIL'],
      'servicio': ['E48', 'ACT'],
      'flete':    ['E48']
    };

    // Conectores que se limpian en Nivel 1 (Tokenización)
    var SAT_STOPWORDS = {
      'de': 1, 'del': 1, 'el': 1, 'la': 1, 'los': 1, 'las': 1, 'para': 1, 'en': 1,
      'con': 1, 'sin': 1, 'por': 1, 'un': 1, 'una': 1, 'unos': 1, 'unas': 1, 'y': 1,
      'o': 1, 'u': 1, 'a': 1, 'al': 1, 'lo': 1, 'su': 1, 'sus': 1, 'mas': 1, 'tipo': 1
    };

    // Diccionario extensible de sinónimos comerciales / ferreteros / abarrotes (Nivel 1 y Nivel 2 IA)
    var SAT_SYNONYMS_MAP = {
      'purificada':   ['agua', 'embotellada', 'bebida', '50202301'],
      'embotellada':  ['agua', 'bebida', '50202301'],
      'garrafon':     ['agua', 'embotellada', 'botella', 'litro', '50202301'],
      'botella':      ['envase', 'litro', 'pieza'],
      'envase':       ['botella', 'litro', 'pieza'],
      'bulto':        ['saco', 'bolsa', 'cemento'],
      'costal':       ['saco', 'bolsa'],
      'tramo':        ['metro', 'pieza', 'varilla', 'tubo'],
      'tira':         ['metro', 'pieza', 'perfil'],
      'bonafont':     ['agua', 'embotellada', '50202301'],
      'ciel':         ['agua', 'embotellada', '50202301'],
      'epura':        ['agua', 'embotellada', '50202301'],
      'mineral':      ['agua', 'embotellada', '50202301'],
      'refresco':     ['bebida', 'carbonatada', '50202306'],
      'coca':         ['refresco', 'bebida', 'carbonatada', '50202306'],
      'pepsi':        ['refresco', 'bebida', 'carbonatada', '50202306'],
      'soda':         ['refresco', 'bebida', 'carbonatada', '50202306'],
      'gatorade':     ['bebida', 'energetica', 'hidratante', '50202309'],
      'electrolit':   ['bebida', 'hidratante', '50202309'],
      'tablaroca':    ['paneles', 'yeso', '30161500'],
      'sheetrock':    ['paneles', 'yeso', '30161500'],
      'durock':       ['paneles', 'fibrocemento', 'yeso', '30161500'],
      'teflon':       ['cinta', 'selladora', 'adhesiva', '31201500'],
      'masking':      ['cinta', 'adhesiva', '31201500'],
      'chalupa':      ['caja', 'electrica', 'registro', 'conduit', '39131700'],
      'poliducto':    ['tubo', 'conduit', 'electrico', '39131700'],
      'pija':         ['tornillo', 'fijacion', '31161500'],
      'pijas':        ['tornillos', 'fijacion', '31161500'],
      'chilillo':     ['tornillo', 'pija', '31161500'],
      'rondana':      ['arandela', 'tuerca', '31161700'],
      'perico':       ['llave', 'ajustable', 'inglesa', '27111704'],
      'stilson':      ['llave', 'ajustable', 'plomero', '27111704'],
      'desarmador':   ['destornillador', 'llave', '27111701'],
      'cutter':       ['navaja', 'herramienta', 'corte', '27111500'],
      'exacto':       ['navaja', 'herramienta', 'corte', '27111500'],
      'flexometro':   ['cinta', 'metrica', 'medicion', '27111801'],
      'rotomartillo': ['taladro', 'martillo', 'demoledor', '27112701'],
      'esmeril':      ['esmeriladora', 'pulidora', '27112703'],
      'buffer':       ['esmeriladora', 'pulidora', '27112703'],
      'armex':        ['castillo', 'electrosoldado', 'malla', '30103604'],
      'ptr':          ['perfil', 'tubular', 'acero', '30102300'],
      'monten':       ['viga', 'perfil', 'acero', '30101700'],
      'ipr':          ['viga', 'acero', '30101700'],
      'solera':       ['angulo', 'perfil', 'acero', '30101500'],
      'pegazulejo':   ['adhesivo', 'pegamento', 'piso', '31201600'],
      'crest':        ['adhesivo', 'pegazulejo', '31201600'],
      'resistol':     ['pegamento', 'adhesivo', '31201600'],
      'thinner':      ['solvente', 'diluyente', '12191600'],
      'thiner':       ['solvente', 'diluyente', '12191600'],
      'aguarras':     ['solvente', 'diluyente', '12191600'],
      'rotoplas':     ['tinaco', 'cisterna', 'agua', '30181500'],
      'tinaco':       ['almacenamiento', 'agua', 'bano', '30181500'],
      'wc':           ['inodoro', 'sanitario', 'bano', '30181500'],
      'taza':         ['inodoro', 'sanitario', 'bano', '30181500'],
      'breaker':      ['pastilla', 'termomagnetica', 'centro', 'carga', '39121600'],
      'foco':         ['lampara', 'led', 'iluminacion', '39111500'],
      'cloro':        ['limpieza', 'desinfectante', '47131800'],
      'pinol':        ['limpieza', 'desinfectante', '47131800'],
      'fabuloso':     ['limpieza', 'desinfectante', '47131800'],
      'wd40':         ['lubricante', 'aceite', '15121500']
    };

    function normStr(s) {
      return String(s || '')
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9\s/]/g, ' ')
        .trim();
    }

    function tokenizeClean(text) {
      var raw = normStr(text).split(/\s+/).filter(Boolean);
      var filtered = raw.filter(function (w) { return !SAT_STOPWORDS[w]; });
      return filtered.length > 0 ? filtered : raw;
    }

    function loadCustomSatCodes() {
      try {
        var raw = localStorage.getItem(SAT_CUSTOM_KEY);
        if (raw) {
          var parsed = JSON.parse(raw);
          if (Array.isArray(parsed)) return parsed;
        }
      } catch (_) {}
      return [];
    }

    function saveCustomSatCodes(arr) {
      try {
        localStorage.setItem(SAT_CUSTOM_KEY, JSON.stringify(arr));
      } catch (_) {}
    }

    // ── Nivel 3: Memoria de Aprendizaje en Caliente (CALEBSYS Memory) ──
    function loadLearnedSatMemory() {
      try {
        var raw = localStorage.getItem(SAT_LEARNED_KEY);
        if (raw) {
          var parsed = JSON.parse(raw);
          if (parsed && typeof parsed === 'object') return parsed;
        }
      } catch (_) {}
      return { byToken: {}, byDepto: {}, byFamilia: {} };
    }

    function saveLearnedSatMemory(mem) {
      try {
        localStorage.setItem(SAT_LEARNED_KEY, JSON.stringify(mem));
      } catch (_) {}
    }

    function getAllSatProdServ() {
      var custom = loadCustomSatCodes().filter(function (x) { return x.type !== 'unidad'; });
      var seen = {};
      var out = [];
      custom.concat(SAT_PROD_SERV_BASE).forEach(function (item) {
        if (item && item.code && !seen[item.code]) {
          seen[item.code] = true;
          out.push(item);
        }
      });
      return out;
    }

    function getAllSatUnidades() {
      var custom = loadCustomSatCodes().filter(function (x) { return x.type === 'unidad'; });
      var seen = {};
      var out = [];
      custom.concat(SAT_UNIDADES_BASE).forEach(function (item) {
        if (item && item.code && !seen[item.code]) {
          seen[item.code] = true;
          out.push(item);
        }
      });
      return out;
    }

    // Regla Anti-Alucinación: verifica que un código exista físicamente en nuestra tabla local de CALEBSYS
    function findValidLocalSatProdServ(code) {
      var c = String(code || '').trim().toUpperCase();
      if (!c) return null;
      return getAllSatProdServ().find(function (x) { return x.code.toUpperCase() === c; }) || null;
    }

    function recordSatHotLearning(opts) {
      opts = opts || {};
      var satId = String(opts.sat_id || '').trim().toUpperCase();
      var satUn = String(opts.sat_unidad || 'H87').trim().toUpperCase() || 'H87';
      // Regla Anti-Alucinación: solo aprende códigos verificados en el catálogo local
      if (!findValidLocalSatProdServ(satId)) return;

      var mem = loadLearnedSatMemory();
      mem.byToken   = mem.byToken   || {};
      mem.byDepto   = mem.byDepto   || {};
      mem.byFamilia = mem.byFamilia || {};

      var entry = { sat_id: satId, sat_unidad: satUn, ts: Date.now() };
      var depto = normStr(opts.departamento || '');
      var fam   = normStr(opts.familia || '');
      if (depto && depto !== 'general') mem.byDepto[depto] = entry;
      if (fam && fam !== 'general')     mem.byFamilia[fam] = entry;

      var tokens = tokenizeClean(opts.descripcion || opts.query || '');
      tokens.forEach(function (tok) {
        if (tok.length >= 3 && !/^\d+$/.test(tok)) {
          mem.byToken[tok] = entry;
        }
      });
      saveLearnedSatMemory(mem);

      // Sincronizar también en caliente con el backend (/api/cfdi/sat-learn)
      try {
        var token = localStorage.getItem('session_token') || sessionStorage.getItem('session_token');
        fetch('/api/cfdi/sat-learn', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': token ? ('Bearer ' + token) : ''
          },
          credentials: 'include',
          body: JSON.stringify({
            query_or_desc: opts.descripcion || opts.query || '',
            departamento: opts.departamento || '',
            familia: opts.familia || '',
            sat_id: satId,
            sat_unidad: satUn
          })
        }).catch(function () {});
      } catch (_) {}
    }
    global.recordSatHotLearning = recordSatHotLearning;

    // ── Motor Semántico Multicapa (Nivel 1: Tokenización + Sinónimos + Scoring Parcial | Nivel 2: Clasificador IA | Nivel 3: Memoria) ──
    function searchSatCatalog(query, type, contextOpts) {
      var list = (type === 'unidad') ? getAllSatUnidades() : getAllSatProdServ();
      contextOpts = contextOpts || {};
      var qNorm = normStr(query);
      var deptoNorm = normStr(contextOpts.departamento || document.getElementById('pa-departamento')?.value || '');
      var famNorm   = normStr(contextOpts.familia || document.getElementById('pa-familia')?.value || '');

      var mem = (type !== 'unidad') ? loadLearnedSatMemory() : { byToken: {}, byDepto: {}, byFamilia: {} };
      var byToken   = mem.byToken || {};
      var byDepto   = mem.byDepto || {};
      var byFamilia = mem.byFamilia || {};

      if (!qNorm && !contextOpts.useContextOnly) {
        return list;
      }

      var baseTokens = tokenizeClean(qNorm);
      var expandedTokens = {};
      var targetCodesFromSyn = {};
      var unitPriorityScores = {};

      baseTokens.forEach(function (tok) {
        expandedTokens[tok] = true;
        if (type === 'unidad') {
          Object.keys(SAT_UNIT_COLLOQUIAL_PRIORITY).forEach(function (uKey) {
            if (tok === uKey || (tok.length >= 3 && (uKey.indexOf(tok) === 0 || tok.indexOf(uKey) === 0))) {
              var pList = SAT_UNIT_COLLOQUIAL_PRIORITY[uKey];
              pList.forEach(function (uCode, idx) {
                var bonus = 140 - (idx * 25);
                if (!unitPriorityScores[uCode] || unitPriorityScores[uCode] < bonus) {
                  unitPriorityScores[uCode] = bonus;
                }
              });
            }
          });
        }
        Object.keys(SAT_SYNONYMS_MAP).forEach(function (synKey) {
          if (tok === synKey || (tok.length >= 4 && (synKey.indexOf(tok) === 0 || tok.indexOf(synKey) === 0))) {
            SAT_SYNONYMS_MAP[synKey].forEach(function (val) {
              if (/^\d{8}$/.test(val)) {
                targetCodesFromSyn[val] = true;
              } else {
                expandedTokens[val] = true;
              }
            });
          }
        });
      });

      // Códigos aprendidos en caliente por CALEBSYS
      var learnedCodes = {};
      baseTokens.forEach(function (tok) {
        if (byToken[tok] && byToken[tok].sat_id) {
          learnedCodes[byToken[tok].sat_id] = byToken[tok];
        }
      });
      if (deptoNorm && byDepto[deptoNorm] && byDepto[deptoNorm].sat_id) {
        learnedCodes[byDepto[deptoNorm].sat_id] = byDepto[deptoNorm];
      }
      if (famNorm && byFamilia[famNorm] && byFamilia[famNorm].sat_id) {
        learnedCodes[byFamilia[famNorm].sat_id] = byFamilia[famNorm];
      }

      var scored = [];
      list.forEach(function (item) {
        var codeNorm = normStr(item.code).replace(/\s+/g, '');
        var descNorm = normStr(item.desc);
        var catNorm  = normStr((item.usage || '') + ' ' + (item.cat || ''));
        var kwNorm   = normStr(item.kw || '');
        var hay      = codeNorm + ' ' + descNorm + ' ' + catNorm + ' ' + kwNorm;
        var hayWords = hay.split(/\s+/);

        var score = 0;
        var matchedBaseCount = 0;

        // 1. Coincidencia exacta o prefijo de código SAT
        var qCompact = qNorm.replace(/\s+/g, '');
        if (qCompact && codeNorm === qCompact) {
          score += 300;
          matchedBaseCount = baseTokens.length;
        } else if (qCompact && codeNorm.indexOf(qCompact) === 0) {
          score += 160;
          matchedBaseCount = baseTokens.length;
        }

        // Prioridad semántica directa para unidades SAT (ej. "bulto"/"costal" -> XSA, XBG; "botella"/"garrafon" -> XBO, LTR, H87; "tramo"/"tira" -> MTR, H87)
        if (type === 'unidad' && unitPriorityScores[item.code]) {
          score += unitPriorityScores[item.code];
          matchedBaseCount = Math.max(matchedBaseCount, 1);
        }

        // 2. Coincidencia parcial por relevancia (ej. "agua purificada embotellada" -> "agua" + "embotellada" = 2 de 3 palabras)
        baseTokens.forEach(function (tok) {
          var wordHit = hayWords.some(function (hw) {
            return hw === tok || (tok.length >= 4 && (hw.indexOf(tok) === 0 || tok.indexOf(hw) === 0));
          });
          if (wordHit) {
            matchedBaseCount++;
            if (descNorm.indexOf(tok) !== -1) score += 50;
            else if (kwNorm.indexOf(tok) !== -1) score += 36;
            else score += 22;
          } else if (tok.length >= 4 && hay.indexOf(tok) !== -1) {
            matchedBaseCount++;
            score += 26;
          }
        });

        // 3. Coincidencia por sinónimos comerciales / coloquiales
        Object.keys(expandedTokens).forEach(function (eTok) {
          if (baseTokens.indexOf(eTok) !== -1) return;
          if (hay.indexOf(eTok) !== -1) {
            score += 30;
          }
        });

        if (targetCodesFromSyn[item.code]) {
          score += 95;
        }

        // 4. Boost de Memoria Aprendida de CALEBSYS
        var isLearned = !!learnedCodes[item.code];
        if (isLearned) {
          score += 75;
        }

        // 5. Proporción de palabras clave cubiertas (ej. 2/3 palabras)
        if (baseTokens.length > 0 && matchedBaseCount > 0) {
          var ratio = matchedBaseCount / baseTokens.length;
          score += Math.round(ratio * 45);
        }

        // 6. Afinidad con Departamento y Familia del formulario
        if (deptoNorm && deptoNorm !== 'general' && hay.indexOf(deptoNorm) !== -1) {
          score += 18;
        }
        if (famNorm && famNorm !== 'general' && hay.indexOf(famNorm) !== -1) {
          score += 18;
        }

        if (score > 0) {
          var copy = Object.assign({}, item, {
            _score: score,
            _learned: isLearned,
            _learnedUnit: isLearned ? learnedCodes[item.code].sat_unidad : null
          });
          scored.push(copy);
        }
      });

      scored.sort(function (a, b) { return b._score - a._score; });
      return scored;
    }

    // Deducción inteligente de la SAT UNIDAD lógica según el producto, descripción y unidad de venta del formulario
    function deduceLogicalSatUnidad(prodServItem, descText) {
      var dNorm = normStr(descText || '');
      var saleUnitRaw = cleanUnitName(document.getElementById('pa-unidad-medida')?.value || 'PIEZA');
      var presCompraRaw = cleanUnitName(document.getElementById('pa-pres-compra')?.value || 'PIEZA');
      var satFromSaleSelector = resolveUnitToSatCode(saleUnitRaw);

      // Si el usuario ya seleccionó en UNIDAD DE MEDIDA algo distinto a PIEZA (ej. METRO, LITRO, KILOGRAMO, M3, M2, TONELADA), respetarlo siempre
      if (saleUnitRaw && saleUnitRaw !== 'PIEZA' && satFromSaleSelector !== 'H87') {
        return satFromSaleSelector;
      }

      if (prodServItem && prodServItem._learnedUnit) {
        return prodServItem._learnedUnit;
      }

      // Análisis de Descripción + Unidades (ej. "AGUA PURIFICADA EMBOTELLADA 1L" o "VARILLA CORRUGADA 3/8 TRAMO 12 MTS")
      // Si es agua embotellada / refresco / botella individual y la unidad de venta es PIEZA -> H87 (o LTR si se vende por LITRO)
      if (/\b(embotellada|botella|garrafon|refresco|bebida)\b/.test(dNorm)) {
        return saleUnitRaw === 'LITRO' ? 'LTR' : 'H87';
      }
      // Si menciona "tramo" o "varilla" o "tubo" o "perfil" y se vende por PIEZA -> H87; si se vende por METRO -> MTR
      if (/\b(tramo|tira|varilla|perfil|ptr|tubo)\b/.test(dNorm)) {
        return saleUnitRaw === 'METRO' ? 'MTR' : 'H87';
      }
      if (/\b(m3|metro cubico|metros cubicos)\b/.test(dNorm)) return 'MTQ';
      if (/\b(m2|metro cuadrado|metros cuadrados)\b/.test(dNorm)) return 'MTK';
      if (/\b(tonelada|toneladas)\b/.test(dNorm)) return 'TNE';
      if (/\b(bulto|saco|costal)\b/.test(dNorm) && (presCompraRaw === 'SACO' || presCompraRaw === 'BULTO') && !isDesgloseActive()) return 'XSA';
      if (/\b(kilo|kilogramo|kg|kgs|granel)\b/.test(dNorm) && !/\b(bulto|saco|costal|cubeta|caja)\b/.test(dNorm)) return 'KGM';
      if (/\b(litro|litros|galon)\b/.test(dNorm) && !/\b(embotellada|botella|pieza)\b/.test(dNorm)) return 'LTR';

      if (prodServItem && prodServItem.unit) {
        // Si la unidad de medida en el formulario es PIEZA y hay desglose Caja -> Pieza, mantener H87 en SAT UNIDAD * y guardar el empaque en sat_unidad_empaque
        if (isDesgloseActive() && saleUnitRaw === 'PIEZA') {
          return 'H87';
        }
        return prodServItem.unit;
      }
      return satFromSaleSelector || 'H87';
    }

    // ── Clasificador Semántico IA (Nivel 2: analiza Descripción + Familia + Departamento con Regla Anti-Alucinación) ──
    function runAiSatClassifier(options) {
      options = options || {};
      var descVal  = (document.getElementById('pa-descripcion')?.value || '').trim();
      var famVal   = (document.getElementById('pa-familia')?.value || '').trim();
      var deptoVal = (document.getElementById('pa-departamento')?.value || '').trim();
      var satTyped = (document.getElementById('pa-sat-id')?.value || '').trim();

      // Si el usuario escribió texto natural en #pa-sat-id (ej. "agua purificada embotellada"), priorizarlo junto con la descripción
      var isNumericSat = /^\d{8}$/.test(satTyped);
      var combinedQuery = '';
      if (satTyped && !isNumericSat) {
        combinedQuery = satTyped + ' ' + descVal;
      } else {
        combinedQuery = descVal;
      }
      if (!combinedQuery.trim() && famVal && famVal !== 'GENERAL') combinedQuery += ' ' + famVal;
      if (!combinedQuery.trim() && deptoVal && deptoVal !== 'GENERAL') combinedQuery += ' ' + deptoVal;

      var candidates = searchSatCatalog(combinedQuery, 'prodserv', {
        departamento: deptoVal,
        familia: famVal,
        useContextOnly: true
      });

      // Fallback a Familia/Departamento o Memoria Aprendida si la descripción tiene términos muy particulares
      if (candidates.length === 0 && (famVal || deptoVal)) {
        candidates = searchSatCatalog((famVal + ' ' + deptoVal).trim(), 'prodserv', {
          departamento: deptoVal,
          familia: famVal,
          useContextOnly: true
        });
      }

      if (candidates.length === 0) {
        if (!options.silent) {
          _showMsg('Escribe la Descripción del producto (ej. AGUA PURIFICADA EMBOTELLADA o MARTILLO) para que la IA sugiera la clave SAT.', 'info');
          openSatModal('prodserv', '');
        }
        return null;
      }

      // REGLA ANTI-ALUCINACIÓN: validar que el candidato #1 exista físicamente en el catálogo local de CALEBSYS
      var best = findValidLocalSatProdServ(candidates[0].code);
      if (!best) return null;

      var suggestedUnit = deduceLogicalSatUnidad(candidates[0], combinedQuery);
      if (satIdInput) {
        satIdInput.value = best.code;
        satIdInput.classList.remove('pa-input-error');
      }
      if (satUnidadInput && suggestedUnit) {
        satUnidadInput.value = suggestedUnit;
        satUnidadInput.classList.remove('pa-input-error');
      }
      // Sincronizar también la clave SAT de empaque (ej. XBX para Caja)
      syncSatUnidadFromEmpaque({ keepManualSatUnidad: true });
      updateSatBadges();

      if (options.openDropdown && satIdDropdown) {
        satIdDropdown.style.display = 'block';
        if (satIdDdInp) satIdDdInp.value = combinedQuery.trim().toUpperCase();
        renderSatIdInlineDropdown(combinedQuery.trim());
      } else {
        closeSatDropdowns();
      }

      if (!options.silent) {
        var sourceTag = candidates[0]._learned ? '🧠 Memoria CALEBSYS' : '✨ IA Clasificadora SAT';
        _showMsg(sourceTag + ': ' + best.code + ' (' + best.desc + ') · Unidad SAT: ' + suggestedUnit, 'success');
      }
      return best;
    }

    var satIdInput       = document.getElementById('pa-sat-id');
    var satUnidadInput   = document.getElementById('pa-sat-unidad');
    var satEmpaqueInput  = document.getElementById('pa-sat-unidad-empaque');
    var satIdBadge       = document.getElementById('pa-sat-id-desc-badge');
    var satUnidadBadge   = document.getElementById('pa-sat-unidad-desc-badge');
    var satIdDropdown    = document.getElementById('pa-sat-id-dropdown');
    var satIdDdInp       = document.getElementById('pa-sat-id-dd-inp');
    var satIdDdList      = document.getElementById('pa-sat-id-dd-list');
    var satIdDdMore      = document.getElementById('pa-sat-id-dd-more');
    var satUnDropdown    = document.getElementById('pa-sat-unidad-dropdown');
    var satUnDdInp       = document.getElementById('pa-sat-unidad-dd-inp');
    var satUnDdList      = document.getElementById('pa-sat-unidad-dd-list');
    var satUnDdMore      = document.getElementById('pa-sat-unidad-dd-more');
    var btnAiSuggestSat  = document.getElementById('pa-btn-ai-suggest-sat');
    var btnSearchSatId   = document.getElementById('pa-btn-search-sat-id');
    var btnIconSatId     = document.getElementById('pa-sat-id-icon-btn');
    var btnSearchSatUn   = document.getElementById('pa-btn-search-sat-unidad');
    var btnIconSatUn     = document.getElementById('pa-sat-unidad-icon-btn');

    // Modal elements (sincronizados con los IDs reales de producto-alta.html)
    var satModal         = document.getElementById('pa-sat-modal');
    var satModalClose    = document.getElementById('pa-sat-modal-close');
    var satModalTitle    = document.getElementById('pa-sat-modal-title');
    var satTabProd       = document.getElementById('pa-sat-tab-prod');
    var satTabUnit       = document.getElementById('pa-sat-tab-unit');
    var satSearchInp     = document.getElementById('pa-sat-modal-search-inp') || document.getElementById('pa-sat-search-inp');
    var satBtnAutodetect = document.getElementById('pa-sat-btn-from-desc') || document.getElementById('pa-sat-btn-autodetect');
    var satResultsBox    = document.getElementById('pa-sat-modal-results') || document.getElementById('pa-sat-results-tbody');
    var satCountBadge    = document.getElementById('pa-sat-modal-count') || document.getElementById('pa-sat-count-badge');
    var satCustomCodeInp = document.getElementById('pa-sat-custom-code');
    var satCustomDescInp = document.getElementById('pa-sat-custom-label') || document.getElementById('pa-sat-custom-desc');
    var satBtnAddCustom  = document.getElementById('pa-sat-custom-add-btn') || document.getElementById('pa-sat-btn-add-custom');
    var currentSatModalMode = 'prodserv'; // 'prodserv' | 'unidad'

    function updateSatBadges() {
      if (satIdInput && satIdBadge) {
        var val = (satIdInput.value || '').trim().toUpperCase();
        var found = findValidLocalSatProdServ(val);
        if (found) {
          satIdBadge.textContent = '✓ ' + found.code + ' · ' + found.desc + ' (' + (found.cat || 'SAT') + ')';
          satIdBadge.title = found.code + ' — ' + found.desc + ' | ' + (found.cat || '');
          satIdBadge.style.color = '#38bdf8';
        } else if (val) {
          var matches = searchSatCatalog(val, 'prodserv');
          if (matches.length > 0) {
            satIdBadge.textContent = '⏎ Enter para elegir: ' + matches[0].code + ' · ' + matches[0].desc;
            satIdBadge.style.color = '#fbbf24';
          } else {
            satIdBadge.textContent = '⚠ Sin coincidencia exacta — usa ✨ Sugerir o elige del catálogo local';
            satIdBadge.style.color = '#f87171';
          }
        } else {
          satIdBadge.textContent = 'Escribe producto o presiona ✨ Sugerir';
          satIdBadge.style.color = '#94a3b8';
        }
      }
      if (satUnidadInput && satUnidadBadge) {
        var uVal = (satUnidadInput.value || '').trim().toUpperCase();
        var uFound = getAllSatUnidades().find(function (x) { return x.code.toUpperCase() === uVal; });
        var presClean = cleanUnitName(presCompraEl ? presCompraEl.value : 'PIEZA');
        var empSat = resolveUnitToSatCode(presClean);
        if (satEmpaqueInput) satEmpaqueInput.value = empSat;
        var dualNote = (isDesgloseActive() && empSat && empSat !== uVal)
          ? (' · Empaque CFDI: ' + empSat + ' (' + presClean + ')')
          : '';

        if (uFound) {
          var shortUse = uFound.usage ? (' (' + uFound.usage + ')') : '';
          satUnidadBadge.textContent = '✓ ' + uFound.code + ' · ' + uFound.desc + (dualNote || shortUse);
          satUnidadBadge.title = uFound.code + ' — ' + uFound.desc + (uFound.usage ? ' (' + uFound.usage + ')' : '') + dualNote;
          satUnidadBadge.style.color = '#34d399';
        } else if (uVal) {
          var uMatches = searchSatCatalog(uVal, 'unidad');
          if (uMatches.length > 0) {
            satUnidadBadge.textContent = '⏎ Enter para elegir: ' + uMatches[0].code + ' · ' + uMatches[0].desc + ' (' + (uMatches[0].usage || '') + ')';
            satUnidadBadge.style.color = '#fbbf24';
          } else {
            satUnidadBadge.textContent = '✓ ' + uVal + ' · Unidad SAT' + dualNote;
            satUnidadBadge.style.color = '#38bdf8';
          }
        } else {
          satUnidadBadge.textContent = 'Ej: H87 Pieza, MTR Metro, KGM Kilo, LTR Litro, XSA Saco';
          satUnidadBadge.style.color = '#94a3b8';
        }
      }
    }

    function selectSatProdServItem(item, moveFocusNext, queryUsed) {
      if (!item || !satIdInput) return;
      // Regla Anti-Alucinación: confirmar existencia en catálogo local
      var verified = findValidLocalSatProdServ(item.code) || item;
      satIdInput.value = verified.code;
      satIdInput.classList.remove('pa-input-error');

      var descText = (document.getElementById('pa-descripcion')?.value || queryUsed || '').trim();
      var logicalUnit = deduceLogicalSatUnidad(verified, descText);
      if (satUnidadInput && logicalUnit) {
        satUnidadInput.value = logicalUnit;
        satUnidadInput.classList.remove('pa-input-error');
      }

      // Aprendizaje en caliente inmediato al elegir una clave
      recordSatHotLearning({
        query: queryUsed || (satIdDdInp ? satIdDdInp.value : ''),
        descripcion: descText,
        departamento: document.getElementById('pa-departamento')?.value || '',
        familia: document.getElementById('pa-familia')?.value || '',
        sat_id: verified.code,
        sat_unidad: satUnidadInput ? satUnidadInput.value : logicalUnit
      });

      updateSatBadges();
      closeSatDropdowns();
      if (satModal) satModal.style.display = 'none';
      _showMsg('✓ Clave SAT asignada: ' + verified.code + ' — ' + verified.desc + ' (Unidad: ' + (satUnidadInput ? satUnidadInput.value : logicalUnit) + ')', 'success');
      if (moveFocusNext && satUnidadInput) {
        satUnidadInput.focus();
        if (typeof satUnidadInput.select === 'function') satUnidadInput.select();
      }
    }

    // Sincronización inversa opcional cuando el usuario elige manualmente una clave en SAT UNIDAD *
    function alignUnidadMedidaSelectFromSatCode(satCode) {
      if (!unidadVentaEl || !satCode) return;
      var codeUp = String(satCode).trim().toUpperCase();
      var opts = Array.from(unidadVentaEl.options);
      var matchOpt = opts.find(function (o) {
        return resolveUnitToSatCode(o.value) === codeUp;
      });
      if (matchOpt && unidadVentaEl.value !== matchOpt.value) {
        unidadVentaEl.value = matchOpt.value;
        recalcularPrecio('sat_unidad_pick');
      }
    }

    function selectSatUnidadItem(item, moveFocusNext) {
      if (!item || !satUnidadInput) return;
      satUnidadInput.value = item.code;
      satUnidadInput.classList.remove('pa-input-error');
      alignUnidadMedidaSelectFromSatCode(item.code);
      updateSatBadges();
      closeSatDropdowns();
      if (satModal) satModal.style.display = 'none';
      _showMsg('✓ Unidad SAT asignada: ' + item.code + ' — ' + item.desc + (item.usage ? ' (' + item.usage + ')' : ''), 'success');
      if (moveFocusNext) {
        var descInp = document.getElementById('pa-descripcion');
        if (descInp) {
          descInp.focus();
          if (typeof descInp.select === 'function') descInp.select();
        }
      }
    }

    function closeSatDropdowns() {
      if (satIdDropdown) satIdDropdown.style.display = 'none';
      if (satUnDropdown) satUnDropdown.style.display = 'none';
    }

    // Renderiza la lista flotante oscura con las 8 mejores sugerencias (Clave en badge azul + Descripción oficial + Categoría padre gris)
    function renderSatIdInlineDropdown(queryText) {
      if (!satIdDropdown || !satIdDdList) return;
      var q = (queryText !== undefined ? queryText : (satIdDdInp ? satIdDdInp.value : '')).trim();
      if (!q && satIdInput) {
        var rawVal = (satIdInput.value || '').trim();
        var isExactCode = !!findValidLocalSatProdServ(rawVal);
        if (rawVal && !isExactCode) {
          q = rawVal;
        } else {
          var descText = (document.getElementById('pa-descripcion')?.value || '').trim();
          if (descText) q = descText;
        }
      }
      var results = searchSatCatalog(q, 'prodserv').slice(0, 8);
      if (results.length === 0) {
        satIdDdList.innerHTML =
          '<div style="padding:12px 14px;font-size:11.5px;color:#94a3b8;background:#0b1324;">' +
            'No se encontraron coincidencias literales para "<b style="color:#38bdf8;">' + q.replace(/</g, '&lt;') + '</b>". ' +
            '<button type="button" id="pa-sat-dd-ai-fallback-btn" style="margin-top:6px;display:inline-flex;align-items:center;gap:5px;background:linear-gradient(135deg,#0284c7,#6366f1);color:#fff;border:none;border-radius:6px;padding:4px 10px;font-size:11px;font-weight:700;cursor:pointer;">✨ Clasificar con IA por contexto</button>' +
          '</div>';
        var fbBtn = document.getElementById('pa-sat-dd-ai-fallback-btn');
        if (fbBtn) {
          fbBtn.addEventListener('mousedown', function (e) {
            e.preventDefault();
            runAiSatClassifier({ openDropdown: false });
          });
        }
        return;
      }

      satIdDdList.innerHTML = results.map(function (item, idx) {
        var rowBg = (idx === 0 && q) ? 'background:rgba(2,132,199,0.18);border-left:3px solid #38bdf8;' : 'background:#0b1324;border-left:3px solid transparent;';
        var learnedTag = item._learned
          ? '<span style="font-size:9.5px;font-weight:800;color:#fbbf24;background:rgba(251,191,36,0.14);border:1px solid rgba(251,191,36,0.35);padding:1px 5px;border-radius:4px;margin-left:6px;">🧠 Aprendido</span>'
          : '';
        return '<div class="pa-sat-dd-item" data-code="' + item.code + '" style="padding:8px 12px;border-bottom:1px solid #1e293b;cursor:pointer;display:flex;align-items:center;justify-content:space-between;gap:10px;transition:background .12s;' + rowBg + '">' +
          '<div style="min-width:0;flex:1;">' +
            '<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">' +
              '<span style="font-family:\'JetBrains Mono\',monospace;font-size:11.5px;font-weight:800;color:#ffffff;background:#0284c7;border:1px solid #38bdf8;padding:1px 7px;border-radius:5px;flex-shrink:0;">' + item.code + '</span>' +
              '<span style="font-size:12px;font-weight:700;color:#f8fafc;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' + item.desc + '</span>' +
              learnedTag +
            '</div>' +
            '<div style="font-size:10.5px;color:#94a3b8;margin-top:3px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' +
              (item.cat || 'Catálogo General SAT') + ' · <span style="color:#34d399;font-weight:700;">Unidad: ' + (item.unit || 'H87') + '</span>' +
            '</div>' +
          '</div>' +
          '<span style="font-size:10px;font-weight:700;color:#38bdf8;flex-shrink:0;">Elegir ⏎</span>' +
        '</div>';
      }).join('');

      satIdDdList.querySelectorAll('.pa-sat-dd-item').forEach(function (rowEl) {
        rowEl.addEventListener('mousedown', function (e) {
          e.preventDefault();
          var code = rowEl.getAttribute('data-code');
          var item = findValidLocalSatProdServ(code);
          if (item) selectSatProdServItem(item, true, q);
        });
      });
    }

    // Renderiza la lista flotante oscura para SAT UNIDAD * mostrando Clave en badge azul (H87), Nombre oficial (Pieza) y entre paréntesis su uso común
    function renderSatUnidadInlineDropdown(queryText) {
      if (!satUnDropdown || !satUnDdList) return;
      var q = (queryText !== undefined ? queryText : (satUnDdInp ? satUnDdInp.value : '')).trim();
      var isExact = getAllSatUnidades().some(function (x) { return x.code === q.toUpperCase(); });
      var results = searchSatCatalog(isExact ? '' : q, 'unidad').slice(0, 8);
      if (results.length === 0) {
        satUnDdList.innerHTML =
          '<div style="padding:12px 14px;font-size:11.5px;color:#94a3b8;background:#0b1324;">' +
            'Sin coincidencias para "<b style="color:#38bdf8;">' + q.replace(/</g, '&lt;') + '</b>". Prueba con: <b>pieza, bulto, costal, botella, garrafón, tramo, metro, kilo, litro, caja</b>.' +
          '</div>';
        return;
      }
      satUnDdList.innerHTML = results.map(function (item, idx) {
        var rowBg = (idx === 0 && q && !isExact) ? 'background:rgba(2,132,199,0.18);border-left:3px solid #38bdf8;' : 'background:#0b1324;border-left:3px solid transparent;';
        var usageParen = item.usage
          ? (' <span style="font-weight:500;color:#94a3b8;font-size:11px;">(' + item.usage + ')</span>')
          : '';
        return '<div class="pa-sat-un-item" data-code="' + item.code + '" style="padding:8px 12px;border-bottom:1px solid #1e293b;cursor:pointer;display:flex;align-items:center;justify-content:space-between;gap:8px;transition:background .12s;' + rowBg + '">' +
          '<div style="min-width:0;flex:1;">' +
            '<div style="display:flex;align-items:center;gap:7px;flex-wrap:wrap;">' +
              '<span style="font-family:\'JetBrains Mono\',monospace;font-size:11.5px;font-weight:800;color:#ffffff;background:#0284c7;border:1px solid #38bdf8;padding:1px 7px;border-radius:5px;flex-shrink:0;">' + item.code + '</span>' +
              '<span style="font-size:12px;font-weight:700;color:#f8fafc;">' + item.desc + usageParen + '</span>' +
            '</div>' +
            '<div style="font-size:10px;color:#64748b;margin-top:2px;">' + (item.cat || 'Unidades de Medida SAT (c_ClaveUnidad)') + '</div>' +
          '</div>' +
          '<span style="font-size:10px;font-weight:700;color:#34d399;flex-shrink:0;">Elegir ⏎</span>' +
        '</div>';
      }).join('');

      satUnDdList.querySelectorAll('.pa-sat-un-item').forEach(function (rowEl) {
        rowEl.addEventListener('mousedown', function (e) {
          e.preventDefault();
          var code = rowEl.getAttribute('data-code');
          var item = getAllSatUnidades().find(function (x) { return x.code === code; });
          if (item) selectSatUnidadItem(item, true);
        });
      });
    }

    function updateModalModeButtons() {
      if (satTabProd && satTabUnit) {
        if (currentSatModalMode === 'unidad') {
          satTabUnit.style.background = '#0284c7';
          satTabUnit.style.color = '#ffffff';
          satTabUnit.style.borderColor = '#06b6d4';
          satTabProd.style.background = '#0f172a';
          satTabProd.style.color = '#94a3b8';
          satTabProd.style.borderColor = '#334155';
        } else {
          satTabProd.style.background = '#0284c7';
          satTabProd.style.color = '#ffffff';
          satTabProd.style.borderColor = '#06b6d4';
          satTabUnit.style.background = '#0f172a';
          satTabUnit.style.color = '#94a3b8';
          satTabUnit.style.borderColor = '#334155';
        }
      }
      if (satModalTitle) {
        satModalTitle.textContent = (currentSatModalMode === 'unidad')
          ? 'BUSCADOR SEMÁNTICO DE UNIDADES SAT — c_ClaveUnidad (CFDI 4.0)'
          : 'BUSCADOR SEMÁNTICO E IA DE CLAVES SAT — c_ClaveProdServ (CFDI 4.0)';
      }
    }

    function openSatModal(mode, initialQuery) {
      if (!satModal) return;
      closeSatDropdowns();
      currentSatModalMode = (mode === 'unidad') ? 'unidad' : 'prodserv';
      updateModalModeButtons();
      satModal.style.display = 'flex';
      var q = (initialQuery !== undefined) ? initialQuery : '';
      if (!q && currentSatModalMode === 'prodserv') {
        var curVal = (satIdInput ? satIdInput.value : '').trim();
        var isKnownCode = !!findValidLocalSatProdServ(curVal);
        if (curVal && !isKnownCode) {
          q = curVal;
        } else {
          var descText = (document.getElementById('pa-descripcion')?.value || '').trim();
          if (descText) q = descText;
        }
      }
      if (satSearchInp) {
        satSearchInp.value = q;
        setTimeout(function () {
          satSearchInp.focus();
          if (typeof satSearchInp.select === 'function') satSearchInp.select();
        }, 40);
      }
      renderSatModalTable(q);
    }

    function renderSatModalTable(queryText) {
      if (!satResultsBox) return;
      var results = searchSatCatalog(queryText, currentSatModalMode);
      if (satCountBadge) {
        satCountBadge.textContent = results.length + ' claves oficiales verificadas en CALEBSYS';
      }
      if (results.length === 0) {
        satResultsBox.innerHTML = '<div style="padding:28px;text-align:center;color:#94a3b8;font-size:12.5px;">No se encontraron claves para "<b style="color:#38bdf8;">' + String(queryText || '').replace(/</g, '&lt;') + '</b>". Puedes registrarla abajo en <b>+ Agregar clave al catálogo</b>.</div>';
        return;
      }
      satResultsBox.innerHTML = results.map(function (item, idx) {
        var activeCls = (idx === 0 && queryText) ? ' active-row' : '';
        var learnedPill = item._learned
          ? '<span style="font-size:10px;font-weight:800;color:#fbbf24;background:rgba(251,191,36,0.14);border:1px solid rgba(251,191,36,0.35);padding:1px 6px;border-radius:4px;margin-left:6px;">🧠 Memoria CALEBSYS</span>'
          : '';
        var usageSuffix = item.usage ? (' <span style="font-weight:500;color:#94a3b8;">(' + item.usage + ')</span>') : '';
        return '<div class="pa-sat-row' + activeCls + '" data-code="' + item.code + '">' +
          '<div style="display:flex;align-items:center;gap:12px;min-width:0;flex:1;">' +
            '<span style="font-family:\'JetBrains Mono\',monospace;font-size:12.5px;font-weight:800;color:#ffffff;background:#0284c7;border:1px solid #38bdf8;padding:3px 9px;border-radius:6px;flex-shrink:0;">' + item.code + '</span>' +
            '<div style="min-width:0;flex:1;">' +
              '<div style="font-size:13px;font-weight:700;color:#f8fafc;">' + item.desc + usageSuffix + learnedPill + '</div>' +
              '<div style="font-size:11px;color:#94a3b8;margin-top:2px;">' + (item.cat || 'Catálogo Oficial SAT') +
                (item.unit ? ' · <span style="color:#34d399;font-weight:700;">Unidad sugerida: ' + item.unit + '</span>' : '') +
              '</div>' +
            '</div>' +
          '</div>' +
          '<button type="button" class="pa-sat-pick-btn" data-code="' + item.code + '" style="background:#0284c7;color:#fff;border:1px solid #38bdf8;border-radius:7px;padding:5px 12px;font-size:11.5px;font-weight:700;cursor:pointer;flex-shrink:0;">✓ Seleccionar</button>' +
        '</div>';
      }).join('');

      satResultsBox.querySelectorAll('.pa-sat-row').forEach(function (rowEl) {
        rowEl.addEventListener('click', function () {
          var code = rowEl.getAttribute('data-code');
          if (currentSatModalMode === 'unidad') {
            var uItem = getAllSatUnidades().find(function (x) { return x.code === code; });
            if (uItem) selectSatUnidadItem(uItem, true);
          } else {
            var pItem = findValidLocalSatProdServ(code);
            if (pItem) selectSatProdServItem(pItem, true, queryText);
          }
        });
      });
    }

    // Eventos del botón ✨ Sugerir junto a SAT ID *
    if (btnAiSuggestSat) {
      btnAiSuggestSat.addEventListener('click', function (e) {
        e.preventDefault();
        e.stopPropagation();
        runAiSatClassifier({ openDropdown: true });
      });
    }

    // Eventos del campo #pa-sat-id (permite números como 30101800 o descripciones naturales como "agua purificada embotellada")
    if (satIdInput) {
      satIdInput.addEventListener('focus', function () {
        if (satUnDropdown) satUnDropdown.style.display = 'none';
        if (satIdDropdown) {
          satIdDropdown.style.display = 'block';
          var cur = (satIdInput.value || '').trim();
          var isDefaultOrExact = !!findValidLocalSatProdServ(cur);
          var initQ = isDefaultOrExact ? '' : cur;
          if (satIdDdInp) satIdDdInp.value = initQ;
          renderSatIdInlineDropdown(initQ);
        }
      });
      satIdInput.addEventListener('click', function () {
        if (satIdDropdown && satIdDropdown.style.display === 'none') {
          satIdDropdown.style.display = 'block';
          renderSatIdInlineDropdown('');
        }
      });
      satIdInput.addEventListener('input', function () {
        var v = (satIdInput.value || '').trim();
        if (satIdDropdown) satIdDropdown.style.display = 'block';
        if (satIdDdInp) satIdDdInp.value = v;
        renderSatIdInlineDropdown(v);
        updateSatBadges();
      });
      satIdInput.addEventListener('keydown', function (e) {
        if (e.key === 'F2' || (e.altKey && e.key === 'ArrowDown')) {
          e.preventDefault();
          e.stopPropagation();
          openSatModal('prodserv', '');
          return;
        }
        if (e.key === 'Escape' && satIdDropdown && satIdDropdown.style.display !== 'none') {
          e.preventDefault();
          e.stopPropagation();
          closeSatDropdowns();
          return;
        }
        if (e.key === 'Enter') {
          var raw = (satIdInput.value || '').trim();
          var exact = findValidLocalSatProdServ(raw);
          if (!exact && raw) {
            // El usuario escribió p.ej. "AGUA PURIFICADA EMBOTELLADA" o "MARTILLO" y dio Enter -> elegir el #1 del buscador semántico
            var matches = searchSatCatalog(raw, 'prodserv');
            if (matches.length > 0) {
              e.preventDefault();
              e.stopPropagation();
              selectSatProdServItem(matches[0], true, raw);
              return;
            }
          }
          closeSatDropdowns();
        }
      });
    }

    if (satIdDdInp) {
      satIdDdInp.addEventListener('input', function () {
        renderSatIdInlineDropdown(satIdDdInp.value);
      });
      satIdDdInp.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') {
          e.preventDefault();
          e.stopPropagation();
          var matches = searchSatCatalog(satIdDdInp.value, 'prodserv');
          if (matches.length > 0) {
            selectSatProdServItem(matches[0], true, satIdDdInp.value);
          }
        } else if (e.key === 'Escape') {
          e.preventDefault();
          e.stopPropagation();
          closeSatDropdowns();
          if (satIdInput) satIdInput.focus();
        }
      });
    }

    if (satIdDdMore) {
      satIdDdMore.addEventListener('mousedown', function (e) {
        e.preventDefault();
        openSatModal('prodserv', satIdDdInp ? satIdDdInp.value : '');
      });
    }

    // Eventos del campo #pa-sat-unidad (búsqueda por clave o lenguaje coloquial: bulto, costal, botella, garrafón, tramo, tira)
    if (satUnidadInput) {
      satUnidadInput.addEventListener('focus', function () {
        if (satIdDropdown) satIdDropdown.style.display = 'none';
        if (satUnDropdown) {
          satUnDropdown.style.display = 'block';
          var curU = (satUnidadInput.value || '').trim();
          var isExactU = getAllSatUnidades().some(function (x) { return x.code === curU.toUpperCase(); });
          var initQU = isExactU ? '' : curU;
          if (satUnDdInp) satUnDdInp.value = initQU;
          renderSatUnidadInlineDropdown(initQU);
        }
      });
      satUnidadInput.addEventListener('click', function () {
        if (satUnDropdown && satUnDropdown.style.display === 'none') {
          satUnDropdown.style.display = 'block';
          renderSatUnidadInlineDropdown('');
        }
      });
      satUnidadInput.addEventListener('input', function () {
        var vU = (satUnidadInput.value || '').trim();
        if (satUnDropdown) satUnDropdown.style.display = 'block';
        if (satUnDdInp) satUnDdInp.value = vU;
        renderSatUnidadInlineDropdown(vU);
        updateSatBadges();
      });
      satUnidadInput.addEventListener('keydown', function (e) {
        if (e.key === 'F2' || (e.altKey && e.key === 'ArrowDown')) {
          e.preventDefault();
          e.stopPropagation();
          openSatModal('unidad', '');
          return;
        }
        if (e.key === 'Escape' && satUnDropdown && satUnDropdown.style.display !== 'none') {
          e.preventDefault();
          e.stopPropagation();
          closeSatDropdowns();
          return;
        }
        if (e.key === 'Enter') {
          var rawU = (satUnidadInput.value || '').trim();
          var exactU = getAllSatUnidades().find(function (x) { return x.code.toUpperCase() === rawU.toUpperCase(); });
          if (!exactU && rawU) {
            var uMatches = searchSatCatalog(rawU, 'unidad');
            if (uMatches.length > 0) {
              e.preventDefault();
              e.stopPropagation();
              selectSatUnidadItem(uMatches[0], true);
              return;
            }
          } else if (exactU) {
            alignUnidadMedidaSelectFromSatCode(exactU.code);
          }
          closeSatDropdowns();
        }
      });
    }

    if (satUnDdInp) {
      satUnDdInp.addEventListener('input', function () {
        renderSatUnidadInlineDropdown(satUnDdInp.value);
      });
      satUnDdInp.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') {
          e.preventDefault();
          e.stopPropagation();
          var uMatches = searchSatCatalog(satUnDdInp.value, 'unidad');
          if (uMatches.length > 0) {
            selectSatUnidadItem(uMatches[0], true);
          }
        } else if (e.key === 'Escape') {
          e.preventDefault();
          e.stopPropagation();
          closeSatDropdowns();
          if (satUnidadInput) satUnidadInput.focus();
        }
      });
    }

    if (satUnDdMore) {
      satUnDdMore.addEventListener('mousedown', function (e) {
        e.preventDefault();
        openSatModal('unidad', satUnDdInp ? satUnDdInp.value : '');
      });
    }

    // Botones de lupa y "Catálogo / Buscar"
    if (btnSearchSatId) btnSearchSatId.addEventListener('click', function () { openSatModal('prodserv', ''); });
    if (btnIconSatId)   btnIconSatId.addEventListener('click', function () { openSatModal('prodserv', ''); });
    if (btnSearchSatUn) btnSearchSatUn.addEventListener('click', function () { openSatModal('unidad', ''); });
    if (btnIconSatUn)   btnIconSatUn.addEventListener('click', function () { openSatModal('unidad', ''); });

    if (satTabProd) {
      satTabProd.addEventListener('click', function () {
        currentSatModalMode = 'prodserv';
        updateModalModeButtons();
        renderSatModalTable(satSearchInp ? satSearchInp.value : '');
      });
    }
    if (satTabUnit) {
      satTabUnit.addEventListener('click', function () {
        currentSatModalMode = 'unidad';
        updateModalModeButtons();
        renderSatModalTable(satSearchInp ? satSearchInp.value : '');
      });
    }

    // Cerrar dropdowns inline al hacer clic fuera
    document.addEventListener('mousedown', function (e) {
      var t = e.target;
      if (!t) return;
      var inSatIdArea = (satIdInput && satIdInput.contains(t)) ||
                        (satIdDropdown && satIdDropdown.contains(t)) ||
                        (btnSearchSatId && btnSearchSatId.contains(t)) ||
                        (btnAiSuggestSat && btnAiSuggestSat.contains(t)) ||
                        (btnIconSatId && btnIconSatId.contains(t));
      var inSatUnArea = (satUnidadInput && satUnidadInput.contains(t)) ||
                        (satUnDropdown && satUnDropdown.contains(t)) ||
                        (btnSearchSatUn && btnSearchSatUn.contains(t)) ||
                        (btnIconSatUn && btnIconSatUn.contains(t));
      if (!inSatIdArea && satIdDropdown) satIdDropdown.style.display = 'none';
      if (!inSatUnArea && satUnDropdown) satUnDropdown.style.display = 'none';
    });

    // Eventos del Modal Buscador SAT (#pa-sat-modal)
    if (satModalClose) satModalClose.addEventListener('click', function () { satModal.style.display = 'none'; });
    if (satModal) {
      satModal.addEventListener('click', function (e) {
        if (e.target === satModal) satModal.style.display = 'none';
      });
      satModal.querySelectorAll('.pa-sat-qchip').forEach(function (chip) {
        chip.addEventListener('click', function () {
          var q = chip.getAttribute('data-q') || '';
          currentSatModalMode = 'prodserv';
          updateModalModeButtons();
          if (satSearchInp) {
            satSearchInp.value = q;
            satSearchInp.focus();
          }
          renderSatModalTable(q);
        });
      });
    }

    if (satSearchInp) {
      satSearchInp.addEventListener('input', function () {
        renderSatModalTable(satSearchInp.value);
      });
      satSearchInp.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') {
          e.preventDefault();
          e.stopPropagation();
          var matches = searchSatCatalog(satSearchInp.value, currentSatModalMode);
          if (matches.length > 0) {
            if (currentSatModalMode === 'unidad') selectSatUnidadItem(matches[0], true);
            else selectSatProdServItem(matches[0], true, satSearchInp.value);
          }
        } else if (e.key === 'Escape') {
          e.preventDefault();
          e.stopPropagation();
          if (satModal) satModal.style.display = 'none';
        }
      });
    }

    if (satBtnAutodetect) {
      satBtnAutodetect.addEventListener('click', function () {
        var descVal  = (document.getElementById('pa-descripcion')?.value || '').trim();
        var famVal   = (document.getElementById('pa-familia')?.value || '').trim();
        var deptoVal = (document.getElementById('pa-departamento')?.value || '').trim();
        var queryToTry = descVal || famVal || deptoVal;
        if (!queryToTry) {
          _showMsg('Escribe primero la Descripción del producto (ej. AGUA PURIFICADA EMBOTELLADA o MARTILLO) o usa el buscador.', 'info');
          if (satSearchInp) satSearchInp.focus();
          return;
        }
        currentSatModalMode = 'prodserv';
        updateModalModeButtons();
        if (satSearchInp) satSearchInp.value = queryToTry;
        renderSatModalTable(queryToTry);
      });
    }

    if (satBtnAddCustom) {
      satBtnAddCustom.addEventListener('click', function () {
        var code = (satCustomCodeInp ? satCustomCodeInp.value : '').trim().toUpperCase();
        var desc = (satCustomDescInp ? satCustomDescInp.value : '').trim();
        if (!code || !desc) {
          _showMsg('Ingresa la Clave SAT y su Descripción para guardarla en el catálogo local.', 'warning');
          return;
        }
        var customArr = loadCustomSatCodes();
        var newItem = {
          code: code,
          desc: desc,
          cat: 'Catálogo Local CALEBSYS > Clave SAT Registrada',
          unit: 'H87',
          kw: normStr(desc),
          type: currentSatModalMode
        };
        customArr.unshift(newItem);
        saveCustomSatCodes(customArr);
        if (satCustomCodeInp) satCustomCodeInp.value = '';
        if (satCustomDescInp) satCustomDescInp.value = '';
        if (currentSatModalMode === 'unidad') {
          selectSatUnidadItem(newItem, true);
        } else {
          selectSatProdServItem(newItem, true, desc);
        }
      });
    }

    // Auto-clasificar con IA al terminar de escribir DESCRIPCIÓN * (si SAT ID está vacío o en el default 30101800)
    var descInputForSat = document.getElementById('pa-descripcion');
    if (descInputForSat && satIdInput) {
      descInputForSat.addEventListener('blur', function () {
        var currentSat = (satIdInput.value || '').trim();
        if (currentSat === '' || currentSat === '30101800') {
          var dText = (descInputForSat.value || '').trim();
          if (!dText) return;
          runAiSatClassifier({ silent: true, openDropdown: false });
        }
      });
    }

    // También sugerir de la Memoria de CALEBSYS cuando cambia Departamento o Familia si SAT ID está vacío o default
    [familiaEl, deptoEl].forEach(function (selEl) {
      if (!selEl) return;
      selEl.addEventListener('change', function () {
        var currentSat = (satIdInput ? satIdInput.value : '').trim();
        if (currentSat === '' || currentSat === '30101800') {
          var mem = loadLearnedSatMemory();
          var dKey = normStr(deptoEl ? deptoEl.value : '');
          var fKey = normStr(familiaEl ? familiaEl.value : '');
          var learnedEntry = (dKey && mem.byDepto && mem.byDepto[dKey]) || (fKey && mem.byFamilia && mem.byFamilia[fKey]);
          if (learnedEntry && learnedEntry.sat_id) {
            var validItem = findValidLocalSatProdServ(learnedEntry.sat_id);
            if (validItem && satIdInput) {
              satIdInput.value = validItem.code;
              if (satUnidadInput && learnedEntry.sat_unidad) {
                satUnidadInput.value = learnedEntry.sat_unidad;
              }
              updateSatBadges();
            }
          }
        }
      });
    });

    updateSatBadges();
    global.updateSatBadgesProductAlta = updateSatBadges;

    if (marcaEl) {
      marcaEl.addEventListener('change', function () {
        if (marcaEl.value === '__OTRA__') {
          var customMarca = prompt('Escribe el nombre de la nueva marca:');
          if (customMarca && customMarca.trim()) {
            var cleanMarca = customMarca.trim().toUpperCase();
            var exists = Array.from(marcaEl.options).some(function (opt) { return opt.value === cleanMarca; });
            if (!exists) {
              var newOpt = document.createElement('option');
              newOpt.value = cleanMarca;
              newOpt.textContent = cleanMarca;
              marcaEl.insertBefore(newOpt, marcaEl.lastElementChild);
            }
            marcaEl.value = cleanMarca;
          } else {
            marcaEl.value = (marcaEl.options[0] && marcaEl.options[0].value !== '__OTRA__') ? marcaEl.options[0].value : 'GENÉRICO';
          }
        }
      });
    }

    // ── 3. Normalización a MAYÚSCULAS (Regla Calebsys) ──
    var upperInputs = form.querySelectorAll('.pa-uppercase');
    upperInputs.forEach(function (inp) {
      inp.addEventListener('input', function () {
        var start = this.selectionStart;
        var end   = this.selectionEnd;
        this.value = this.value.toUpperCase();
        if (start !== null && end !== null && typeof this.setSelectionRange === 'function') {
          this.setSelectionRange(start, end);
        }
      });
      inp.addEventListener('blur', function () {
        this.value = this.value.toUpperCase().trim();
      });
    });

    // ── 4. Contador de caracteres en Observaciones ──
    var obsEl     = document.getElementById('pa-observaciones');
    var counterEl = document.getElementById('pa-obs-counter');
    if (obsEl && counterEl) {
      obsEl.addEventListener('input', function () {
        counterEl.textContent = obsEl.value.length + '/500';
      });
    }

    // ── 5. Toggle de Estado Activo / Inactivo ──
    var statusChk  = document.getElementById('pa-is-active');
    var statusText = document.getElementById('pa-status-text');
    if (statusChk && statusText) {
      statusChk.addEventListener('change', function () {
        statusText.textContent = statusChk.checked ? 'Activo' : 'Inactivo';
        statusText.style.color = statusChk.checked ? '#059669' : '#dc2626';
      });
    }

    // ── 6. Carga de foto de producto y vista previa ──
    var photoInput = document.getElementById('pa-photo-file-input');
    var photoBtn   = document.getElementById('pa-btn-upload-photo');
    var photoImg   = document.getElementById('pa-photo-img');
    var photoPh    = document.getElementById('pa-photo-placeholder');
    var photoWrap  = document.querySelector('#pa-product-form .pa-photo-preview-wrap');

    function isValidProductPhotoUrl(url) {
      if (!url || typeof url !== 'string') return false;
      var s = url.trim();
      if (!s || s === 'null' || s === 'undefined') return false;
      if (s.indexOf('data:image/') === 0) return true;
      if (s.indexOf('blob:') === 0) return true;
      if (/\/admin(\b|#|\?|$)/i.test(s) && !/\.(png|jpe?g|webp|gif|svg|avif|bmp)(\?|$)/i.test(s)) return false;
      if (s.indexOf('http://') === 0 || s.indexOf('https://') === 0 || s.indexOf('/') === 0 || s.indexOf('uploads/') !== -1) {
        return true;
      }
      return false;
    }

    function setPhotoPreviewUrl(url) {
      var imgEl = document.getElementById('pa-photo-img');
      var phEl  = document.getElementById('pa-photo-placeholder');
      if (!imgEl) return;
      if (isValidProductPhotoUrl(url)) {
        var cleanUrl = url.trim();
        imgEl.setAttribute('data-valid-photo', cleanUrl);
        imgEl.src = cleanUrl;
        imgEl.classList.remove('pa-hidden');
        if (phEl) phEl.classList.add('pa-hidden');
      } else {
        imgEl.removeAttribute('data-valid-photo');
        imgEl.removeAttribute('src');
        imgEl.classList.add('pa-hidden');
        if (phEl) phEl.classList.remove('pa-hidden');
      }
    }

    function extractPhotoFromProductObj(p) {
      if (!p || typeof p !== 'object') return '';
      var m = (p.meta_data && typeof p.meta_data === 'object') ? p.meta_data : {};
      var candidates = [p.foto_url, p.image_url, m.foto_url, m.image_url, m.imagen];
      for (var i = 0; i < candidates.length; i++) {
        if (isValidProductPhotoUrl(candidates[i])) return String(candidates[i]).trim();
      }
      return '';
    }

    function applyProductPhotoToForm(prod) {
      var foundUrl = extractPhotoFromProductObj(prod);
      if (!foundUrl && prod && prod.sku) {
        var targetSku = String(prod.sku).trim().toUpperCase();
        var pools = [
          global._productsAll || [],
          global._productsCache || [],
          f3ProductsListCache || [],
          global._productoAltaEdit ? [global._productoAltaEdit] : []
        ];
        for (var pIdx = 0; pIdx < pools.length && !foundUrl; pIdx++) {
          var arr = pools[pIdx];
          if (!Array.isArray(arr)) continue;
          for (var j = 0; j < arr.length; j++) {
            var item = arr[j];
            if (item && String(item.sku || '').trim().toUpperCase() === targetSku) {
              var u = extractPhotoFromProductObj(item);
              if (u) {
                foundUrl = u;
                break;
              }
            }
          }
        }
      }
      setPhotoPreviewUrl(foundUrl);
    }
    global.applyProductPhotoToForm = applyProductPhotoToForm;

    function loadPhotoFileIntoPreview(file) {
      if (!file || !file.type || file.type.indexOf('image/') !== 0) return;
      var reader = new FileReader();
      reader.onload = function (e) {
        if (e && e.target && e.target.result) {
          setPhotoPreviewUrl(e.target.result);
        }
      };
      reader.readAsDataURL(file);
    }

    if (photoImg) {
      photoImg.addEventListener('error', function () {
        photoImg.removeAttribute('data-valid-photo');
        photoImg.classList.add('pa-hidden');
        if (photoPh) photoPh.classList.remove('pa-hidden');
      });
    }

    if (photoBtn && photoInput) {
      photoBtn.addEventListener('click', function () {
        photoInput.click();
      });
    }

    if (photoWrap && photoInput) {
      photoWrap.style.cursor = 'pointer';
      photoWrap.title = 'Haz clic, arrastra una imagen aquí o pega con Ctrl+V';
      photoWrap.addEventListener('click', function () {
        photoInput.click();
      });
      photoWrap.addEventListener('dragover', function (e) {
        e.preventDefault();
        e.stopPropagation();
        photoWrap.style.borderColor = '#38bdf8';
      });
      photoWrap.addEventListener('dragleave', function (e) {
        e.preventDefault();
        e.stopPropagation();
        photoWrap.style.borderColor = '';
      });
      photoWrap.addEventListener('drop', function (e) {
        e.preventDefault();
        e.stopPropagation();
        photoWrap.style.borderColor = '';
        var dt = e.dataTransfer;
        if (!dt) return;
        if (dt.files && dt.files.length > 0) {
          loadPhotoFileIntoPreview(dt.files[0]);
          return;
        }
        var droppedUrl = dt.getData('text/uri-list') || dt.getData('text/plain') || '';
        if (isValidProductPhotoUrl(droppedUrl)) {
          setPhotoPreviewUrl(droppedUrl);
        }
      });
    }

    if (photoInput && photoImg) {
      photoInput.addEventListener('change', function () {
        var file = photoInput.files && photoInput.files[0];
        if (file) {
          loadPhotoFileIntoPreview(file);
        }
      });
    }

    // ── 7. Pestañas de Navegación (F1-F6 con persistencia total de datos del formulario) ──
    var tabs = document.querySelectorAll('#pa-tabs-nav .pa-tab');
    var panelCatalogosF5 = document.getElementById('pa-tab-panel-catalogos');
    var panelStockF3     = document.getElementById('pa-tab-panel-stock-f3');
    var btnBackGeneralF1 = document.getElementById('pa-btn-back-general-f1');
    var btnF3BackF1      = document.getElementById('pa-f3-btn-back-f1');

    // =========================================================================
    // ── 7b. CONTROLADOR DE "STOCK Y OPERACIONES [F3]" (CONECTADO EN VIVO AL POS Y BASE DE DATOS REAL) ──
    // =========================================================================
    var f3CurrentOpType = 'ENTRADA'; // 'ENTRADA' | 'SALIDA' | 'TRASLADO' | 'AJUSTE'
    var f3ActiveDateRange = 'mes';
    var f3LiveRecordCache = null;    // Respuesta real de /api/products-f3/detail
    var f3ProductsListCache = [];    // Lista real de productos del POS
    var f3FetchInFlight = false;
    // Acceso de solo lectura para el controlador F4 (fuera de este cierre): evita ReferenceError que abortaba initProductAltaPage
    global.__paGetF3ProductsList = function () { return f3ProductsListCache; };

    function getAuthTokenF3() {
      return localStorage.getItem('session_token') ||
             sessionStorage.getItem('session_token') ||
             localStorage.getItem('calebsys_token') ||
             sessionStorage.getItem('auth_token') ||
             localStorage.getItem('auth_token') || '';
    }

    function setSelectOptionUpper(selEl, val) {
      if (!selEl || !val) return;
      var clean = String(val).trim().toUpperCase();
      if (!clean) return;
      var exists = Array.from(selEl.options).some(function (o) {
        return String(o.value).trim().toUpperCase() === clean;
      });
      if (!exists) {
        var opt = document.createElement('option');
        opt.value = clean;
        opt.textContent = clean;
        selEl.appendChild(opt);
      }
      selEl.value = clean;
    }

    var _isPopulatingRealProduct = false;

    function showDuplicateProductBanner(prod) {
      var banner = document.getElementById('pa-duplicate-code-banner');
      if (banner) banner.style.display = 'none';
      var saveBtn = document.getElementById('pa-btn-save');
      if (saveBtn && prod) {
        saveBtn.innerHTML = '<i class="fa-solid fa-floppy-disk"></i> Guardar <span class="pa-kbd">F12</span>';
      }
    }

    function hideDuplicateProductBanner() {
      var banner = document.getElementById('pa-duplicate-code-banner');
      if (banner) banner.style.display = 'none';
      var saveBtn = document.getElementById('pa-btn-save');
      if (saveBtn && !saveBtn.disabled) {
        saveBtn.innerHTML = '<i class="fa-solid fa-floppy-disk"></i> Guardar <span class="pa-kbd">F12</span>';
      }
      global._paLoadedExistingProduct = null;
    }
    global.hideDuplicateProductBanner = hideDuplicateProductBanner;

    async function ensureProductsCatalogLoadedForDuplicateCheck(forceRefresh) {
      if (!forceRefresh && Array.isArray(f3ProductsListCache) && f3ProductsListCache.length > 0 && f3ProductsListCache[0].barcode !== undefined) {
        return f3ProductsListCache;
      }
      try {
        var items = null;
        if (typeof AdminAPI !== 'undefined' && typeof AdminAPI.apiFetch === 'function') {
          var res = await AdminAPI.apiFetch('/api/products/search?limit=500');
          items = Array.isArray(res) ? res : (res && (res.items || res.products || res.data) || []);
        } else {
          var tok = getAuthTokenF3();
          var r = await fetch('/api/products/search?limit=500', {
            headers: tok ? { 'Authorization': 'Bearer ' + tok } : {},
            credentials: 'include'
          });
          if (r.ok) {
            var d = await r.json();
            items = Array.isArray(d) ? d : (d && (d.items || d.products || d.data) || []);
          }
        }
        if (Array.isArray(items) && items.length) {
          global._productsAll = items;
          if (!Array.isArray(f3ProductsListCache) || !f3ProductsListCache.length) {
            f3ProductsListCache = items;
          } else {
            // Enriquecer f3ProductsListCache con barcode y sales_code de /api/products/search
            var bySku = {};
            items.forEach(function (it) {
              if (it && it.sku) bySku[String(it.sku).trim().toUpperCase()] = it;
            });
            f3ProductsListCache.forEach(function (fp) {
              var k = String(fp.sku || '').trim().toUpperCase();
              if (bySku[k]) {
                if (!fp.barcode) fp.barcode = bySku[k].barcode || fp.sku;
                if (!fp.sales_code) fp.sales_code = bySku[k].sales_code || '';
                if (!fp.foto_url && bySku[k].foto_url) fp.foto_url = bySku[k].foto_url;
                if (!fp.meta_data && bySku[k].meta_data) fp.meta_data = bySku[k].meta_data;
              }
            });
            items.forEach(function (it) {
              var k = String(it.sku || '').trim().toUpperCase();
              var exists = f3ProductsListCache.some(function (fp) { return String(fp.sku || '').trim().toUpperCase() === k; });
              if (!exists) f3ProductsListCache.push(it);
            });
          }
        }
      } catch (e) {
        console.warn('[Calebsys] Error precargando catálogo para detector de duplicados:', e);
      }
      return f3ProductsListCache || global._productsAll || [];
    }

    function getCombinedProductsForDuplicateCheck() {
      var map = {};
      var out = [];
      var sources = [f3ProductsListCache || [], global._productsAll || []];
      sources.forEach(function (arr) {
        if (!Array.isArray(arr)) return;
        arr.forEach(function (p) {
          if (!p || !p.sku) return;
          var k = String(p.sku).trim().toUpperCase();
          if (!map[k]) {
            map[k] = Object.assign({}, p);
            out.push(map[k]);
          } else {
            if (!map[k].barcode && p.barcode) map[k].barcode = p.barcode;
            if (!map[k].sales_code && p.sales_code) map[k].sales_code = p.sales_code;
            if (!map[k].foto_url && p.foto_url) map[k].foto_url = p.foto_url;
            if (!map[k].meta_data && p.meta_data) map[k].meta_data = p.meta_data;
          }
        });
      });
      return out;
    }

    function findMatchingProductByAnyCode(rawCode) {
      var clean = String(rawCode || '').trim().toUpperCase();
      if (!clean || clean.length < 2) return null;
      var cleanNoZeros = clean.replace(/^0+/, '');
      var list = getCombinedProductsForDuplicateCheck();
      for (var i = 0; i < list.length; i++) {
        var p = list[i];
        if (String(p.sku || '').trim().toUpperCase() === clean) {
          return { product: p, fieldLabel: 'SKU', matchedBy: 'SKU', typedCode: clean };
        }
      }
      for (var j = 0; j < list.length; j++) {
        var p2 = list[j];
        var bc = String(p2.barcode || (p2.meta_data && p2.meta_data.codigo_barras) || '').trim().toUpperCase();
        var bcNoZeros = bc.replace(/^0+/, '');
        if (bc && (bc === clean || (cleanNoZeros && cleanNoZeros.length >= 4 && bcNoZeros === cleanNoZeros))) {
          return { product: p2, fieldLabel: 'CÓDIGO DE BARRAS', matchedBy: 'CÓDIGO DE BARRAS', typedCode: clean };
        }
      }
      for (var k = 0; k < list.length; k++) {
        var p3 = list[k];
        var sc = String(p3.sales_code || (p3.meta_data && p3.meta_data.codigo_alterno) || '').trim().toUpperCase();
        if (sc && sc === clean) {
          return { product: p3, fieldLabel: 'CÓDIGO ALTERNO', matchedBy: 'CÓDIGO ALTERNO', typedCode: clean };
        }
      }
      return null;
    }
    global.findMatchingProductByAnyCode = findMatchingProductByAnyCode;

    function loadRealProductIntoForm(prod, dupContext) {
      if (!prod || !prod.sku) return;
      _isPopulatingRealProduct = true;
      try {
        global._paLoadedExistingProduct = prod;
        var meta = (prod.meta_data && typeof prod.meta_data === 'object') ? prod.meta_data : {};

        var skuIn = document.getElementById('pa-sku');
        var codIn = document.getElementById('pa-codigo');
        var altIn = document.getElementById('pa-codigo-alt');
        var descIn = document.getElementById('pa-descripcion');
        if (skuIn) skuIn.value = String(prod.sku || '').toUpperCase();
        if (codIn) {
          codIn.value = String(prod.barcode || prod.sku || '').toUpperCase();
          codIn.dataset.userEdited = '1';
        }
        if (altIn) altIn.value = String(prod.sales_code || '').toUpperCase();
        if (descIn) descIn.value = String(prod.description || prod.name || '').toUpperCase();

        setSelectOptionUpper(document.getElementById('pa-familia'), prod.familia || meta.familia || 'GENERAL');
        setSelectOptionUpper(document.getElementById('pa-departamento'), prod.departamento || meta.departamento || 'GENERAL');
        setSelectOptionUpper(document.getElementById('pa-marca'), prod.marca || meta.marca || meta.brand || 'GENÉRICO');

        var satIdIn = document.getElementById('pa-sat-id');
        var satUnIn = document.getElementById('pa-sat-unidad');
        var satEmpIn = document.getElementById('pa-sat-unidad-empaque');
        if (satIdIn) satIdIn.value = String(prod.sat_id || meta.sat_id || '30101800').toUpperCase();
        if (satUnIn) satUnIn.value = String(prod.sat_unidad || meta.sat_unidad || 'H87').toUpperCase();
        if (satEmpIn) satEmpIn.value = String(meta.sat_unidad_empaque || prod.sat_unidad || 'H87').toUpperCase();

        setSelectOptionUpper(document.getElementById('pa-pres-compra'), cleanUnitName(prod.purchase_unit || 'PIEZA') || 'PIEZA');
        setSelectOptionUpper(document.getElementById('pa-unidad-medida'), cleanUnitName(prod.sale_unit || 'PIEZA') || 'PIEZA');

        var paqQtyIn = document.getElementById('pa-paquete-qty');
        if (paqQtyIn) paqQtyIn.value = String(prod.piezas_por_caja || meta.piezas_por_caja || 1);

        var costoIn = document.getElementById('pa-costo');
        var fleteIn = document.getElementById('pa-flete-pct');
        var margenIn = document.getElementById('pa-margen');
        var sobreIn = document.getElementById('pa-sobreprecio-pct');
        var precioFinIn = document.getElementById('pa-precio-final');
        var precioPiezaIn = document.getElementById('pa-precio-pieza-final');
        var precioCajaIn = document.getElementById('pa-precio-caja-final');

        var realCost = parseFloat(meta.costo_raw != null ? meta.costo_raw : (prod.average_cost || 0)) || 0;
        var realPrice = parseFloat(prod.price || 0) || 0;
        if (costoIn) costoIn.value = realCost.toFixed(2);
        if (fleteIn) fleteIn.value = (parseFloat(meta.flete_pct || 0) || 0).toFixed(2);
        if (margenIn && meta.margen != null) {
          margenIn.value = (parseFloat(meta.margen) || 0).toFixed(2);
        } else if (margenIn && realCost > 0 && realPrice > 0) {
          var calcM = (((realPrice / 1.16) - realCost) / realCost) * 100;
          margenIn.value = Math.max(0, calcM).toFixed(2);
        }
        if (sobreIn && meta.sobreprecio_pieza_pct != null) {
          sobreIn.value = (parseFloat(meta.sobreprecio_pieza_pct) || 0).toFixed(2);
        }

        if (typeof global.recalcularPrecioProductAlta === 'function') {
          global.recalcularPrecioProductAlta();
        }
        if (realPrice > 0) {
          if (precioFinIn) precioFinIn.value = realPrice.toFixed(2);
          if (precioPiezaIn) precioPiezaIn.value = realPrice.toFixed(2);
          if (precioCajaIn && (!meta.precio_caja || meta.precio_caja <= 0)) {
            precioCajaIn.value = realPrice.toFixed(2);
          }
        }
        if (typeof global.loadProductPriceScalesFromRecord === 'function') {
          global.loadProductPriceScalesFromRecord(prod);
        }

        // Cargar imagen del producto reconocido en el recuadro "Imagen del Producto"
        applyProductPhotoToForm(prod);

        var stAct = document.getElementById('pa-stock-actual');
        var stAlm = document.getElementById('pa-stock-almacen');
        var stMin = document.getElementById('pa-stock-min');
        var stMax = document.getElementById('pa-stock-max');
        var stTra = document.getElementById('pa-stock-transito');
        var realStock = parseFloat(prod.stock != null ? prod.stock : 0) || 0;
        if (stAct) stAct.value = String(realStock);
        if (stAlm) stAlm.value = String(meta.stock_almacen != null ? meta.stock_almacen : realStock);
        if (stMin) stMin.value = String(prod.stock_minimo != null ? prod.stock_minimo : 10);
        if (stMax) stMax.value = String(prod.stock_max != null ? prod.stock_max : (meta.stock_max || 100));
        if (stTra) stTra.value = String(prod.stock_transito != null ? prod.stock_transito : (meta.stock_transito || 0));

        // Cargar Diversos y Observaciones exclusivos de este producto
        var iepsIn = document.getElementById('pa-ieps');
        var ivaIn = document.getElementById('pa-iva');
        var garIn = document.getElementById('pa-garantia');
        var ptsIn = document.getElementById('pa-puntos');
        var obsIn = document.getElementById('pa-observaciones');
        var obsCounterIn = document.getElementById('pa-obs-counter');
        if (iepsIn) iepsIn.value = (parseFloat(meta.ieps != null ? meta.ieps : 0) || 0).toFixed(2);
        if (ivaIn) ivaIn.value = (parseFloat(meta.iva != null ? meta.iva : 16) || 16).toFixed(2);
        if (garIn) garIn.value = String(parseInt(meta.garantia || 0, 10) || 0);
        if (ptsIn) ptsIn.value = (parseFloat(meta.puntos != null ? meta.puntos : 0) || 0).toFixed(2);
        var obsStr = String(meta.observaciones || '').toUpperCase();
        if (obsIn) obsIn.value = obsStr;
        if (obsCounterIn) obsCounterIn.textContent = obsStr.length + '/500';

        // Cargar Atributos y Configuración exclusivos de este producto
        var setChk = function (id, val) {
          var c = document.getElementById(id);
          if (c) c.checked = !!val;
        };
        var isActiveVal = (meta.is_active !== false);
        setChk('pa-is-active', isActiveVal);
        var statusTxtEl = document.getElementById('pa-status-text');
        if (statusTxtEl) {
          statusTxtEl.textContent = isActiveVal ? 'Activo' : 'Inactivo';
          statusTxtEl.style.color = isActiveVal ? '#16a34a' : '#dc2626';
        }
        setChk('pa-art-pesado', !!meta.art_pesado);
        setChk('pa-precio-abierto', !!meta.precio_abierto);
        setChk('pa-art-negativo', !!meta.art_negativo);
        setChk('pa-desact-venta', !!meta.desact_venta);
        setChk('pa-desact-compras', !!meta.desact_compras);
        setChk('pa-desact-traspasos', !!meta.desact_traspasos);

        var kdx = (meta.kardex && typeof meta.kardex === 'object') ? meta.kardex : {};
        setChk('pa-kardex-auditoria', !!kdx.auditoria);
        setChk('pa-kardex-servicio', !!kdx.servicio);
        setChk('pa-kardex-no-desc', !!kdx.no_desc);
        setChk('pa-kardex-no-ofertas-cal', !!kdx.no_ofertas_cal);
        setChk('pa-kardex-no-ofertas-depto', !!kdx.no_ofertas_depto);
        setChk('pa-kardex-corte-z', !!kdx.corte_z);
        setChk('pa-kardex-no-variantes', !!kdx.no_variantes);
        setChk('pa-kardex-base-prod', !!kdx.base_prod);
        setChk('pa-kardex-ofertas-cruzadas', kdx.ofertas_cruzadas !== false);
        setChk('pa-kardex-recarga-celular', !!kdx.recarga_celular);
        setChk('pa-kardex-antibiotico', !!kdx.antibiotico);
        setChk('pa-kardex-exento-iva', !!kdx.exento_iva);
        setChk('pa-kardex-desc-abierta', !!kdx.desc_abierta);
        setChk('pa-kardex-prod-controlado', !!kdx.prod_controlado);
        setChk('pa-kardex-existencia-neg', kdx.existencia_neg !== false);
        setChk('pa-kardex-autorizacion', !!kdx.autorizacion);
        setChk('pa-kardex-no-inventariable', !!kdx.no_inventariable);
        setChk('pa-kardex-recetas-paquetes', !!kdx.recetas_paquetes);

        // Cargar Historial de Precios exclusivo de este producto
        var histTbody = document.getElementById('pa-price-history-tbody');
        var statPrecio = document.getElementById('pa-hist-precio-activo');
        var statFecha = document.getElementById('pa-hist-fecha-act');
        var prodHist = Array.isArray(meta.price_history) ? meta.price_history : [];
        var fmtPriceAct = '$' + (realPrice || 0).toFixed(2);
        var fmtDateAct = meta.last_price_update || (prodHist[0] && prodHist[0].fecha) || 'Registro actual';
        if (statPrecio) statPrecio.textContent = fmtPriceAct;
        if (statFecha) statFecha.textContent = fmtDateAct;
        if (histTbody) {
          if (prodHist.length) {
            histTbody.innerHTML = prodHist.map(function (h) {
              return '<tr>' +
                '<td><i class="fa-regular fa-clock"></i> ' + String(h.fecha || '') + '</td>' +
                '<td class="pa-td-price">' + String(h.precio || fmtPriceAct) + '</td>' +
                '<td class="pa-td-user">' + String(h.usuario || 'ADMIN') + '</td>' +
              '</tr>';
            }).join('');
          } else {
            histTbody.innerHTML =
              '<tr>' +
                '<td><i class="fa-regular fa-clock"></i> ' + fmtDateAct + '</td>' +
                '<td class="pa-td-price">' + fmtPriceAct + '</td>' +
                '<td class="pa-td-user">SISTEMA</td>' +
              '</tr>';
          }
        }

        if (typeof global.updateSatBadgesProductAlta === 'function') {
          global.updateSatBadgesProductAlta();
        }

        ['pa-sku', 'pa-codigo', 'pa-familia', 'pa-departamento', 'pa-sat-id', 'pa-sat-unidad', 'pa-descripcion'].forEach(function (id) {
          var el = document.getElementById(id);
          if (el) el.classList.remove('pa-input-error');
        });

        if (typeof global.loadComplementsF4FromProduct === 'function') {
          global.loadComplementsF4FromProduct(prod);
        }

        // Cargar Venta Sugerida exclusiva de este artículo
        var rawSug = Array.isArray(meta.suggested_products)
          ? meta.suggested_products
          : (Array.isArray(meta.venta_sugerida) ? meta.venta_sugerida : []);
        global._paSuggestedProducts = rawSug.map(function (s) {
          return {
            sku: String(s.sku || '').toUpperCase(),
            barcode: String(s.barcode || s.sku || '').toUpperCase(),
            description: String(s.description || s.name || s.sku || '').toUpperCase(),
            brand: String(s.brand || s.marca || 'GENÉRICO').toUpperCase(),
            unit: String(s.unit || s.sale_unit || 'PIEZA').toUpperCase(),
            price: parseFloat(s.price != null ? s.price : 0) || 0,
            stock: parseFloat(s.stock != null ? s.stock : 0) || 0
          };
        }).filter(function (s) { return !!s.sku; });
        if (typeof global.renderPaSuggestedProductsTable === 'function') {
          global.renderPaSuggestedProductsTable();
        }

        if (dupContext) {
          showDuplicateProductBanner(prod, dupContext);
        }
      } finally {
        _isPopulatingRealProduct = false;
      }
    }
    global.loadRealProductIntoForm = loadRealProductIntoForm;

    function getActiveProductContextF3() {
      var p = (f3LiveRecordCache && f3LiveRecordCache.product) ? f3LiveRecordCache.product : null;
      var rawSku    = (document.getElementById('pa-sku')?.value || (p && p.sku) || '').trim().toUpperCase();
      var rawDesc   = (document.getElementById('pa-descripcion')?.value || (p && p.description) || '').trim().toUpperCase();
      var rawSat    = (document.getElementById('pa-sat-id')?.value || (p && p.sat_id) || '30101800').trim().toUpperCase();
      var rawSatUn  = (document.getElementById('pa-sat-unidad')?.value || (p && p.sat_unidad) || 'H87').trim().toUpperCase();
      var rawFam    = (document.getElementById('pa-familia')?.value || (p && p.familia) || 'GENERAL').trim().toUpperCase();
      var rawUm     = cleanUnitName(document.getElementById('pa-unidad-medida')?.value || (p && p.sale_unit) || 'PIEZA') || 'PIEZA';
      var rawPres   = cleanUnitName(document.getElementById('pa-pres-compra')?.value || (p && p.purchase_unit) || 'PIEZA') || 'PIEZA';
      var rawPaqQty = Math.max(1, parseFloat(document.getElementById('pa-paquete-qty')?.value || (p && p.piezas_por_caja) || '1') || 1);
      var rawCosto  = parseFloat(document.getElementById('pa-costo')?.value || (p && p.average_cost) || '0') || 0;
      var rawPrecio = parseFloat(document.getElementById('pa-precio-final')?.value || (p && p.price) || '0') || 0;
      var rawMin    = parseFloat(document.getElementById('pa-stock-min')?.value || (p && p.stock_minimo) || '10') || 10;
      var rawMax    = parseFloat(document.getElementById('pa-stock-max')?.value || (p && p.stock_max) || '100') || 100;
      var rawTrans  = parseFloat(document.getElementById('pa-stock-transito')?.value || (p && p.stock_transito) || '0') || 0;

      var sku  = rawSku  || (p ? p.sku : 'SIN-SKU');
      var desc = rawDesc || (p ? p.description : 'PRODUCTO EN ALTA');
      var sat  = rawSat  || '30101800';
      var fam  = rawFam  || 'GENERAL';
      var umShort = (rawUm === 'PIEZA' || rawUm === 'PZA') ? 'PZ'
                  : (rawUm === 'KILOGRAMO' || rawUm === 'KG') ? 'KG'
                  : (rawUm === 'METRO' || rawUm === 'MTR') ? 'MTR'
                  : (rawUm === 'LITRO' || rawUm === 'LT') ? 'LT'
                  : (rawUm === 'TONELADA' || rawUm === 'TON') ? 'TON'
                  : (rawUm === 'M3' || rawUm === 'METRO CÚBICO') ? 'M3'
                  : (rawUm === 'M2' || rawUm === 'METRO CUADRADO') ? 'M2'
                  : 'PZ';

      var eqText = rawPaqQty > 1
        ? ('1 ' + rawPres + ' = ' + rawPaqQty + ' ' + rawUm + 'S (' + rawSatUn + ')')
        : ('1 ' + rawUm + ' (' + rawSatUn + ')');

      return {
        sku: sku,
        desc: desc,
        sat: sat,
        satUnidad: rawSatUn,
        familia: fam,
        um: rawUm,
        umShort: umShort,
        presCompra: rawPres,
        paqQty: rawPaqQty,
        equivalencia: eqText,
        min: rawMin,
        max: rawMax,
        transito: rawTrans,
        formCosto: rawCosto > 0 ? rawCosto : ((p && p.average_cost) ? p.average_cost : 0),
        formPrecio: rawPrecio > 0 ? rawPrecio : ((p && p.price) ? p.price : 0)
      };
    }

    function getActiveF3ProductState() {
      var ctx = getActiveProductContextF3();
      var rec = f3LiveRecordCache || {
        sku: ctx.sku,
        desc: ctx.desc,
        costoPromedio: ctx.formCosto || 0,
        warehouses: [
          { key: 'MATRIZ', nombre: 'MATRIZ (Maderas y Materiales Magdaleno)', min: ctx.min, max: ctx.max, fisico: parseFloat(document.getElementById('pa-stock-actual')?.value || '0') || 0 }
        ],
        kardex: []
      };
      return { ctx: ctx, rec: rec };
    }

    function populateF3PosProductSelector(productsList, activeSku) {
      var sel = document.getElementById('pa-f3-product-selector');
      if (!sel) return;
      if (Array.isArray(productsList) && productsList.length) {
        f3ProductsListCache = productsList;
      }
      var list = f3ProductsListCache || [];
      if (!list.length) return;

      var currentSku = String(activeSku || document.getElementById('pa-sku')?.value || '').trim().toUpperCase();
      sel.innerHTML = list.map(function (item) {
        var s = String(item.sku || '').toUpperCase();
        var n = String(item.name || '').toUpperCase();
        var st = parseFloat(item.stock || 0) || 0;
        var pr = parseFloat(item.price || 0) || 0;
        return '<option value="' + s + '">SKU ' + s + ' — ' + n + ' (Stock POS: ' + st + ' | $' + pr.toFixed(2) + ')</option>';
      }).join('');

      if (currentSku && list.some(function (i) { return String(i.sku || '').toUpperCase() === currentSku; })) {
        sel.value = currentSku;
      }
    }

    async function fetchRealProductF3FromServer(requestedSku, options) {
      options = options || {};
      if (f3FetchInFlight && !options.force) return f3LiveRecordCache;
      f3FetchInFlight = true;

      var skuToQuery = String(requestedSku != null ? requestedSku : (document.getElementById('pa-sku')?.value || '')).trim();
      var url = '/api/products-f3/detail' + (skuToQuery ? ('?sku=' + encodeURIComponent(skuToQuery)) : '');

      try {
        var data = null;
        if (typeof AdminAPI !== 'undefined' && typeof AdminAPI.apiFetch === 'function') {
          data = await AdminAPI.apiFetch(url);
        } else {
          var tok = getAuthTokenF3();
          var resp = await fetch(url, {
            headers: tok ? { 'Authorization': 'Bearer ' + tok } : {},
            credentials: 'include'
          });
          if (resp.ok) data = await resp.json();
        }

        if (data && typeof data === 'object') {
          if (Array.isArray(data.products_list)) {
            f3ProductsListCache = data.products_list;
          } else if (Array.isArray(data.all_products)) {
            f3ProductsListCache = data.all_products;
          }
          // REGLA DE HIERRO #1: Si el usuario está dando de alta un Nuevo Producto (skuToQuery vacío y !options.populateForm),
          // NO enlazar f3LiveRecordCache al primer producto de la base de datos para no contaminar el expediente nuevo.
          if (skuToQuery && data.found && data.product) {
            f3LiveRecordCache = data;
            if (options.populateForm) {
              loadRealProductIntoForm(data.product, options.dupContext || null);
            }
            populateF3PosProductSelector(f3ProductsListCache, data.product.sku);
          } else {
            // Producto nuevo en captura que aún no existe en BD: mostrar sucursales reales con stock del formulario (0)
            var draftStock = parseFloat(document.getElementById('pa-stock-actual')?.value || document.getElementById('pa-stock-almacen')?.value || '0') || 0;
            var draftCosto = parseFloat(document.getElementById('pa-costo')?.value || '0') || 0;
            f3LiveRecordCache = {
              found: false,
              product: null,
              sku: skuToQuery.toUpperCase(),
              costoPromedio: draftCosto,
              warehouses: (data.warehouses || []).map(function (w, idx) {
                return {
                  key: w.key,
                  nombre: w.nombre,
                  min: w.min || 10,
                  max: w.max || 100,
                  fisico: idx === 0 ? draftStock : 0
                };
              }),
              kardex: []
            };
            populateF3PosProductSelector(f3ProductsListCache, skuToQuery);
          }
          renderStockF3Dom();
        }
      } catch (err) {
        console.warn('[Calebsys F3] Error consultando /api/products-f3/detail:', err);
      } finally {
        f3FetchInFlight = false;
      }
      return f3LiveRecordCache;
    }

    // Calcula métricas por sucursal y globales a partir de las sucursales reales y los folios reales del Kardex
    function computeF3BranchAndGlobalMetrics(rec, selectedBranchFilter) {
      var branchFilter = String(selectedBranchFilter || 'TODOS').toUpperCase();
      var statsByBranch = {};

      (rec.warehouses || []).forEach(function (w) {
        var k = String(w.key).toUpperCase();
        statsByBranch[k] = {
          fisico: parseFloat(w.fisico) || 0,
          ventasUnidades: 0,
          ventasImporte: 0,
          facturasUnidades: 0,
          facturasCount: 0,
          notasVentaUnidades: 0,
          notasVentaCount: 0,
          devolucionesUnidades: 0,
          devolucionesCount: 0,
          notasCreditoUnidades: 0,
          notasCreditoCount: 0
        };
      });

      (rec.kardex || []).forEach(function (m) {
        var bKey = String(m.almacenKey || m.almacen || 'MATRIZ').toUpperCase();
        if (!statsByBranch[bKey]) {
          statsByBranch[bKey] = {
            fisico: 0,
            ventasUnidades: 0,
            ventasImporte: 0,
            facturasUnidades: 0,
            facturasCount: 0,
            notasVentaUnidades: 0,
            notasVentaCount: 0,
            devolucionesUnidades: 0,
            devolucionesCount: 0,
            notasCreditoUnidades: 0,
            notasCreditoCount: 0
          };
        }
        var st = statsByBranch[bKey];
        var cKey = String(m.conceptoKey || '').toUpperCase();
        var sal = parseFloat(m.salida) || 0;
        var ent = parseFloat(m.entrada) || 0;

        if (cKey === 'FACTURA') {
          st.ventasUnidades += sal;
          st.ventasImporte  += Math.abs(parseFloat(m.totalMov) || (sal * (parseFloat(m.costoUnit) || 0)));
          st.facturasUnidades += sal;
          st.facturasCount++;
        } else if (cKey === 'NOTA_VENTA' || cKey === 'VENTA') {
          st.ventasUnidades += sal;
          st.ventasImporte  += Math.abs(parseFloat(m.totalMov) || (sal * (parseFloat(m.costoUnit) || 0)));
          st.notasVentaUnidades += sal;
          st.notasVentaCount++;
        } else if (cKey === 'DEVOLUCION') {
          st.devolucionesUnidades += ent;
          st.devolucionesCount++;
        } else if (cKey === 'NOTA_CREDITO') {
          st.notasCreditoUnidades += ent;
          st.notasCreditoCount++;
        }
      });

      var totalFisico = 0;
      var totalVentasUds = 0;
      var totalFacturasUds = 0;
      var totalNotasVentaUds = 0;
      var totalDevUds = 0;
      var totalNcUds = 0;

      Object.keys(statsByBranch).forEach(function (bKey) {
        if (branchFilter !== 'TODOS' && bKey !== branchFilter) return;
        var s = statsByBranch[bKey];
        totalFisico        += s.fisico;
        totalVentasUds     += s.ventasUnidades;
        totalFacturasUds   += s.facturasUnidades;
        totalNotasVentaUds += s.notasVentaUnidades;
        totalDevUds        += s.devolucionesUnidades;
        totalNcUds         += s.notasCreditoUnidades;
      });

      var costoProm = parseFloat(rec.costoPromedio) || 0;
      var valorTotal = totalFisico * costoProm;

      return {
        byBranch: statsByBranch,
        fisicoTotal: totalFisico,
        disponible: totalFisico,
        ventasUnidades: totalVentasUds,
        facturasUnidades: totalFacturasUds,
        notasVentaUnidades: totalNotasVentaUds,
        devolucionesTotal: totalDevUds + totalNcUds,
        devolucionesUnidades: totalDevUds,
        notasCreditoUnidades: totalNcUds,
        costoProm: costoProm,
        valorTotal: valorTotal
      };
    }

    function formatMoneyMXN(n) {
      var val = parseFloat(n) || 0;
      var absFormatted = Math.abs(val).toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
      return (val < 0 ? '-$' : '$') + absFormatted;
    }

    function populateF3BranchSelectors(rec, activeBranchFilter) {
      var filterSel = document.getElementById('pa-f3-filter-almacen');
      var opOrigSel = document.getElementById('pa-f3-op-almacen');
      var opDestSel = document.getElementById('pa-f3-op-destino');
      var pillsWrap = document.getElementById('pa-f3-branch-pills');

      var whs = rec.warehouses || [];

      if (filterSel) {
        var prev = activeBranchFilter || filterSel.value || 'TODOS';
        filterSel.innerHTML = '<option value="TODOS">Todas (Matriz + Sucursales)</option>' +
          whs.map(function (w) {
            return '<option value="' + w.key + '">' + w.nombre + '</option>';
          }).join('');
        filterSel.value = (prev === 'TODOS' || whs.some(function (w) { return w.key === prev; })) ? prev : 'TODOS';
      }

      if (opOrigSel) {
        var prevOrig = opOrigSel.value;
        opOrigSel.innerHTML = whs.map(function (w) {
          return '<option value="' + w.key + '">' + w.nombre + ' (Stock: ' + w.fisico + ')</option>';
        }).join('');
        if (prevOrig && whs.some(function (w) { return w.key === prevOrig; })) opOrigSel.value = prevOrig;
      }

      if (opDestSel) {
        var prevDest = opDestSel.value;
        opDestSel.innerHTML = whs.map(function (w) {
          return '<option value="' + w.key + '">' + w.nombre + '</option>';
        }).join('');
        if (prevDest && whs.some(function (w) { return w.key === prevDest; })) {
          opDestSel.value = prevDest;
        } else if (whs.length > 1) {
          opDestSel.value = whs[1].key;
        }
      }

      if (pillsWrap) {
        var curFilter = (filterSel ? filterSel.value : 'TODOS').toUpperCase();
        var allBtnStyle = curFilter === 'TODOS'
          ? 'background:#2563eb;color:#fff;border:1px solid #38bdf8;box-shadow:0 0 10px rgba(37,99,235,.4);'
          : 'background:var(--f3-pill-bg);color:var(--f3-muted);border:1px solid var(--f3-border);';
        var html = '<span style="font-size:11px;color:#9ca3af;font-weight:700;margin-right:2px;"><i class="fa-solid fa-filter" style="color:#38bdf8;"></i> Filtrar Sede:</span>' +
          '<button type="button" class="f3-branch-pill-btn" data-branch="TODOS" style="cursor:pointer;padding:3px 10px;border-radius:999px;font-size:11px;font-weight:800;' + allBtnStyle + '">' +
            'Todas (' + whs.length + ')' +
          '</button>';

        whs.forEach(function (w) {
          var isAct = curFilter === String(w.key).toUpperCase();
          var st = isAct
            ? 'background:#059669;color:#fff;border:1px solid #34d399;box-shadow:0 0 10px rgba(16,185,129,.4);'
            : 'background:var(--f3-pill-bg);color:var(--f3-text-sub);border:1px solid var(--f3-border);';
          html += '<button type="button" class="f3-branch-pill-btn" data-branch="' + w.key + '" style="cursor:pointer;padding:3px 10px;border-radius:999px;font-size:11px;font-weight:800;' + st + '">' +
            '<i class="fa-solid fa-store"></i> ' + w.key + ' (' + w.fisico + ')' +
          '</button>';
        });
        pillsWrap.innerHTML = html;

        pillsWrap.querySelectorAll('.f3-branch-pill-btn').forEach(function (btn) {
          btn.addEventListener('click', function () {
            var bVal = btn.getAttribute('data-branch') || 'TODOS';
            if (filterSel) filterSel.value = bVal;
            renderStockF3Dom();
          });
        });
      }
    }

    function renderStockF3Dom() {
      var state = getActiveF3ProductState();
      var ctx = state.ctx;
      var rec = state.rec;

      var filterSel = document.getElementById('pa-f3-filter-almacen');
      var activeBranch = filterSel ? (filterSel.value || 'TODOS') : 'TODOS';
      populateF3BranchSelectors(rec, activeBranch);
      activeBranch = filterSel ? (filterSel.value || 'TODOS') : 'TODOS';

      var metrics = computeF3BranchAndGlobalMetrics(rec, activeBranch);
      var globalMetrics = computeF3BranchAndGlobalMetrics(rec, 'TODOS');

      // 1. Actualizar Banner de Producto Activo (Exclusivo 1 solo producto real del POS)
      var bSku  = document.getElementById('pa-f3-banner-sku');
      var bDesc = document.getElementById('pa-f3-banner-desc');
      var bSat  = document.getElementById('pa-f3-banner-sat');
      var bFam  = document.getElementById('pa-f3-banner-fam');
      if (bSku)  bSku.textContent  = ctx.sku;
      if (bDesc) bDesc.textContent = ctx.desc;
      if (bSat)  bSat.textContent  = ctx.sat;
      if (bFam)  bFam.textContent  = 'Familia: ' + ctx.familia;

      // 2. Actualizar Bloque 1: 5 KPIs conectados a Matriz y Sucursales
      var kpiFisico    = document.getElementById('pa-f3-kpi-fisico');
      var kpiFisicoSub = document.getElementById('pa-f3-kpi-fisico-sub');
      var kpiVentas    = document.getElementById('pa-f3-kpi-comprometido');
      var kpiVentasSub = document.getElementById('pa-f3-kpi-ventas-sub');
      var kpiDisp      = document.getElementById('pa-f3-kpi-disponible');
      var kpiDispSub   = document.getElementById('pa-f3-kpi-disp-sub');
      var kpiDev       = document.getElementById('pa-f3-kpi-transito');
      var kpiDevSub    = document.getElementById('pa-f3-kpi-dev-sub');
      var kpiValor     = document.getElementById('pa-f3-kpi-valor');
      var kpiValSub    = document.getElementById('pa-f3-kpi-valor-sub');

      var scopeLabel = activeBranch === 'TODOS' ? 'Suma de Matriz y Sucursales' : ('Sede seleccionada: ' + activeBranch);

      if (kpiFisico)    kpiFisico.textContent    = metrics.fisicoTotal + ' ' + ctx.umShort;
      if (kpiFisicoSub) kpiFisicoSub.textContent = scopeLabel;
      if (kpiVentas)    kpiVentas.textContent    = metrics.ventasUnidades + ' ' + ctx.umShort;
      if (kpiVentasSub) kpiVentasSub.textContent = 'Facturas: ' + metrics.facturasUnidades + ' ' + ctx.umShort + ' | Notas Venta: ' + metrics.notasVentaUnidades + ' ' + ctx.umShort;
      if (kpiDisp)      kpiDisp.textContent      = metrics.disponible + ' ' + ctx.umShort;
      if (kpiDispSub)   kpiDispSub.textContent   = 'Disponible en POS (' + (activeBranch === 'TODOS' ? 'Matriz y Sucursales' : activeBranch) + ')';
      if (kpiDev)       kpiDev.textContent       = metrics.devolucionesTotal + ' ' + ctx.umShort;
      if (kpiDevSub)    kpiDevSub.textContent    = 'Devoluciones: ' + metrics.devolucionesUnidades + ' | Notas Crédito: ' + metrics.notasCreditoUnidades;
      if (kpiValor)     kpiValor.textContent     = formatMoneyMXN(metrics.valorTotal) + ' MXN';
      if (kpiValSub)    kpiValSub.textContent    = metrics.fisicoTotal + ' ' + ctx.umShort + ' × ' + formatMoneyMXN(metrics.costoProm) + ' Costo Prom.';

      // Sincronizar con casilla Stock Actual y Stock Almacén de F1 solo cuando el SKU de F1 coincide con el producto cargado
      var curF1Sku = (document.getElementById('pa-sku')?.value || '').trim().toUpperCase();
      var recProdSku = (rec && rec.product && rec.product.sku) ? String(rec.product.sku).trim().toUpperCase() : '';
      if (curF1Sku && curF1Sku === recProdSku) {
        var f1StockActual = document.getElementById('pa-stock-actual');
        var f1StockAlmacen = document.getElementById('pa-stock-almacen');
        if (f1StockActual) f1StockActual.value = String(globalMetrics.fisicoTotal);
        if (f1StockAlmacen) f1StockAlmacen.value = String(globalMetrics.fisicoTotal);
      }

      // 3. Renderizar Bloque 2: Tabla de Sucursales y Matriz Reales
      var whTbody = document.getElementById('pa-f3-warehouses-tbody');
      if (whTbody) {
        whTbody.innerHTML = '';
        (rec.warehouses || []).forEach(function (w) {
          var bKey = String(w.key).toUpperCase();
          if (activeBranch !== 'TODOS' && bKey !== activeBranch.toUpperCase()) return;

          var bStats = metrics.byBranch[bKey] || {
            ventasUnidades: 0,
            ventasImporte: 0,
            facturasUnidades: 0,
            notasVentaUnidades: 0,
            devolucionesUnidades: 0,
            notasCreditoUnidades: 0
          };

          var tr = document.createElement('tr');
          var statusHtml = '';
          if ((parseFloat(w.fisico) || 0) <= 0) {
            statusHtml = '<span class="f3-status-pill" style="color:#f87171;"><span class="f3-dot" style="background:#ef4444;box-shadow:0 0 8px #ef4444;"></span> Sin Existencia</span>';
          } else if ((parseFloat(w.fisico) || 0) <= (parseFloat(w.min) || 0)) {
            statusHtml = '<span class="f3-status-pill" style="color:#fbbf24;"><span class="f3-dot" style="background:#f59e0b;box-shadow:0 0 8px #f59e0b;"></span> Punto de Reorden</span>';
          } else {
            statusHtml = '<span class="f3-status-pill" style="color:#34d399;"><span class="f3-dot" style="background:#10b981;box-shadow:0 0 8px #10b981;"></span> Óptimo</span>';
          }

          var fisicoColor = (parseFloat(w.fisico) || 0) <= 0 ? '#ef4444' : 'var(--f3-text)';
          var ventasHtml =
            '<div style="font-weight:800;color:#60a5fa;">' + bStats.ventasUnidades + ' ' + ctx.umShort + ' <span style="color:#9ca3af;font-weight:600;font-size:11px;">(' + formatMoneyMXN(bStats.ventasImporte) + ')</span></div>' +
            '<div style="font-size:10.5px;color:#9ca3af;margin-top:2px;">' +
              '<span style="color:#38bdf8;font-weight:700;">Facturas: ' + bStats.facturasUnidades + '</span> · ' +
              '<span style="color:#22d3ee;font-weight:700;">Notas Venta: ' + bStats.notasVentaUnidades + '</span>' +
            '</div>';

          var devHtml =
            '<div style="font-weight:700;color:#fbbf24;">' + (bStats.devolucionesUnidades + bStats.notasCreditoUnidades) + ' ' + ctx.umShort + '</div>' +
            '<div style="font-size:10.5px;color:#9ca3af;margin-top:2px;">' +
              'Dev: ' + bStats.devolucionesUnidades + ' · N. Créd: ' + bStats.notasCreditoUnidades +
            '</div>';

          tr.innerHTML =
            '<td style="font-weight:800;color:var(--f3-text);">' +
              '<i class="fa-solid fa-store" style="color:#38bdf8;margin-right:6px;"></i>' + w.nombre +
            '</td>' +
            '<td style="color:var(--f3-text-sub);font-size:12px;">' + ctx.equivalencia + '</td>' +
            '<td style="color:var(--f3-text-sub);font-family:\'JetBrains Mono\',monospace;">' + w.min + ' / ' + w.max + '</td>' +
            '<td>' + ventasHtml + '</td>' +
            '<td>' + devHtml + '</td>' +
            '<td style="font-weight:900;color:' + fisicoColor + ';font-size:13.5px;font-family:\'JetBrains Mono\',monospace;">' + w.fisico + ' ' + ctx.umShort + '</td>' +
            '<td>' + statusHtml + '</td>';
          whTbody.appendChild(tr);
        });
      }

      // 4. Renderizar Bloque 4: Kardex Detallado con Folios Reales del POS y Almacén
      renderF3KardexTable();
    }

    function syncAndRenderStockF3Panel(options) {
      options = options || {};
      var curSku = (document.getElementById('pa-sku')?.value || '').trim().toUpperCase();
      if (options.forceFetch || !f3LiveRecordCache || (curSku && (!f3LiveRecordCache.product || String(f3LiveRecordCache.product.sku || '').toUpperCase() !== curSku))) {
        fetchRealProductF3FromServer(curSku, { populateForm: !curSku, force: !!options.forceFetch });
      } else {
        renderStockF3Dom();
      }
    }

    function getDocTypeBadgeHtml(conceptoKey, tipo) {
      var c = String(conceptoKey || '').toUpperCase();
      if (c === 'FACTURA') {
        return '<span style="background:rgba(59,130,246,.18);color:#60a5fa;border:1px solid rgba(59,130,246,.4);padding:2px 8px;border-radius:6px;font-size:11px;font-weight:800;display:inline-flex;align-items:center;gap:5px;"><i class="fa-solid fa-file-invoice-dollar"></i> FACTURA CFDI</span>';
      }
      if (c === 'NOTA_VENTA' || c === 'VENTA') {
        return '<span style="background:rgba(6,182,212,.18);color:#22d3ee;border:1px solid rgba(6,182,212,.4);padding:2px 8px;border-radius:6px;font-size:11px;font-weight:800;display:inline-flex;align-items:center;gap:5px;"><i class="fa-solid fa-receipt"></i> NOTA DE VENTA</span>';
      }
      if (c === 'DEVOLUCION') {
        return '<span style="background:rgba(245,158,11,.18);color:#fbbf24;border:1px solid rgba(245,158,11,.4);padding:2px 8px;border-radius:6px;font-size:11px;font-weight:800;display:inline-flex;align-items:center;gap:5px;"><i class="fa-solid fa-rotate-left"></i> DEVOLUCIÓN</span>';
      }
      if (c === 'NOTA_CREDITO') {
        return '<span style="background:rgba(168,85,247,.18);color:#c084fc;border:1px solid rgba(168,85,247,.4);padding:2px 8px;border-radius:6px;font-size:11px;font-weight:800;display:inline-flex;align-items:center;gap:5px;"><i class="fa-solid fa-file-circle-minus"></i> NOTA DE CRÉDITO</span>';
      }
      if (c === 'COMPRA') {
        return '<span style="background:rgba(16,185,129,.18);color:#34d399;border:1px solid rgba(16,185,129,.4);padding:2px 8px;border-radius:6px;font-size:11px;font-weight:800;display:inline-flex;align-items:center;gap:5px;"><i class="fa-solid fa-truck-ramp-box"></i> COMPRA / ALTA</span>';
      }
      if (c === 'TRASLADO' || tipo === 'TRASLADO') {
        return '<span style="background:rgba(148,163,184,.18);color:#cbd5e1;border:1px solid rgba(148,163,184,.4);padding:2px 8px;border-radius:6px;font-size:11px;font-weight:800;display:inline-flex;align-items:center;gap:5px;"><i class="fa-solid fa-right-left"></i> TRASPASO SUC.</span>';
      }
      return '<span style="background:rgba(244,63,94,.18);color:#fb7185;border:1px solid rgba(244,63,94,.4);padding:2px 8px;border-radius:6px;font-size:11px;font-weight:800;display:inline-flex;align-items:center;gap:5px;"><i class="fa-solid fa-scale-balanced"></i> AJUSTE STOCK</span>';
    }

    function getFilteredF3KardexRows() {
      var state = getActiveF3ProductState();
      var rows = (state.rec.kardex || []).slice();

      var almFilter  = (document.getElementById('pa-f3-filter-almacen')?.value || 'TODOS').toUpperCase();
      var tipoFilter = (document.getElementById('pa-f3-filter-tipo')?.value || 'TODOS').toUpperCase();
      var concFilter = (document.getElementById('pa-f3-filter-concepto')?.value || 'TODOS').toUpperCase();
      var qSearch    = (document.getElementById('pa-f3-filter-search')?.value || '').trim().toUpperCase();
      var dateFrom   = document.getElementById('pa-f3-date-from')?.value || '';
      var dateTo     = document.getElementById('pa-f3-date-to')?.value || '';
      var todayIso   = new Date().toISOString().slice(0, 10);

      return rows.filter(function (r) {
        var rBranch = String(r.almacenKey || r.almacen || '').toUpperCase();
        if (almFilter !== 'TODOS' && rBranch !== almFilter) {
          return false;
        }
        if (tipoFilter !== 'TODOS' && (r.tipo || '').toUpperCase() !== tipoFilter) {
          return false;
        }
        if (concFilter !== 'TODOS' && (r.conceptoKey || '').toUpperCase() !== concFilter) {
          return false;
        }
        if (f3ActiveDateRange === 'hoy' && r.isoDate && r.isoDate !== todayIso) {
          return false;
        }
        if (f3ActiveDateRange === 'custom') {
          if (dateFrom && r.isoDate && r.isoDate < dateFrom) return false;
          if (dateTo && r.isoDate && r.isoDate > dateTo) return false;
        }
        if (qSearch) {
          var hay = ((r.folio || '') + ' ' + (r.docTipoLabel || '') + ' ' + (r.concepto || '') + ' ' + (r.almacen || '') + ' ' + (r.usuario || '') + ' ' + (r.obs || '')).toUpperCase();
          if (hay.indexOf(qSearch) === -1) return false;
        }
        return true;
      });
    }

    function renderF3KardexTable() {
      var tbody = document.getElementById('pa-f3-kardex-tbody');
      if (!tbody) return;
      var filtered = getFilteredF3KardexRows();
      tbody.innerHTML = '';

      if (!filtered.length) {
        tbody.innerHTML = '<tr><td colspan="12" style="text-align:center;padding:22px;color:#9ca3af;">No hay movimientos registrados para este producto con los filtros seleccionados. Realiza una venta en el POS o registra una operación arriba.</td></tr>';
        return;
      }

      filtered.forEach(function (r) {
        var tr = document.createElement('tr');
        var docBadge = getDocTypeBadgeHtml(r.conceptoKey, r.tipo);

        var entradaCell = r.entrada > 0
          ? '<span style="color:#34d399;font-weight:800;">+' + r.entrada + '</span>'
          : '<span style="color:#64748b;">-</span>';

        var salidaCell = r.salida > 0
          ? '<span style="color:#fb7185;font-weight:800;">-' + r.salida + '</span>'
          : '<span style="color:#64748b;">-</span>';

        if (r.tipo === 'TRASLADO') {
          entradaCell = '<span style="color:#60a5fa;font-weight:800;">+' + r.entrada + '</span>';
          salidaCell  = '<span style="color:#60a5fa;font-weight:800;">-' + r.salida + '</span>';
        }

        var totalColor = r.totalMov > 0 ? '#34d399' : (r.totalMov < 0 ? '#fb7185' : '#9ca3af');
        var totalStr = (r.totalMov > 0 ? '+' : '') + formatMoneyMXN(r.totalMov);

        tr.innerHTML =
          '<td style="color:var(--f3-text-sub);white-space:nowrap;">' + r.fecha + '</td>' +
          '<td><button type="button" class="f3-folio-link" data-folio="' + r.folio + '" title="Ver detalle del folio ' + r.folio + '">' + r.folio + '</button></td>' +
          '<td>' + docBadge + '</td>' +
          '<td style="color:#38bdf8;font-weight:700;"><i class="fa-solid fa-store" style="font-size:10.5px;margin-right:4px;"></i>' + r.almacen + '</td>' +
          '<td style="color:var(--f3-text);">' + r.concepto + '</td>' +
          '<td style="text-align:right;font-family:\'JetBrains Mono\',monospace;">' + entradaCell + '</td>' +
          '<td style="text-align:right;font-family:\'JetBrains Mono\',monospace;">' + salidaCell + '</td>' +
          '<td style="text-align:right;font-weight:900;color:var(--f3-text);font-family:\'JetBrains Mono\',monospace;">' + r.saldo + '</td>' +
          '<td style="text-align:right;color:var(--f3-text-sub);font-family:\'JetBrains Mono\',monospace;">' + formatMoneyMXN(r.costoUnit) + '</td>' +
          '<td style="text-align:right;color:var(--f3-text-sub);font-family:\'JetBrains Mono\',monospace;">' + formatMoneyMXN(r.costoProm) + '</td>' +
          '<td style="text-align:right;font-weight:800;color:' + totalColor + ';font-family:\'JetBrains Mono\',monospace;">' + totalStr + '</td>' +
          '<td style="color:var(--f3-muted);">' + r.usuario + '</td>';

        var folioBtn = tr.querySelector('.f3-folio-link');
        if (folioBtn) {
          folioBtn.addEventListener('click', function () {
            openF3DocumentModal(r);
          });
        }
        tbody.appendChild(tr);
      });
    }

    function openF3DocumentModal(mov) {
      var modal = document.getElementById('pa-f3-doc-modal');
      var title = document.getElementById('pa-f3-doc-modal-title');
      var body  = document.getElementById('pa-f3-doc-modal-body');
      var ctx   = getActiveProductContextF3();
      if (!modal || !body) return;

      var docLabel = mov.docTipoLabel || mov.conceptoKey || mov.tipo;
      if (title) {
        title.innerHTML = '<i class="fa-solid fa-file-invoice" style="color:#38bdf8;"></i> Folio ' + mov.folio + ' — ' + docLabel;
      }
      body.innerHTML =
        '<div style="background:var(--f3-card-bg);border:1px solid var(--f3-border);border-radius:10px;padding:12px 14px;margin-bottom:12px;">' +
          '<div style="font-size:11px;color:#9ca3af;text-transform:uppercase;font-weight:700;">Producto en Documento</div>' +
          '<div style="font-size:13.5px;font-weight:800;color:#38bdf8;margin-top:2px;">SKU ' + ctx.sku + ' — ' + ctx.desc + '</div>' +
        '</div>' +
        '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:12px;">' +
          '<div><span style="color:#9ca3af;font-size:11px;display:block;">TIPO DE DOCUMENTO</span>' + getDocTypeBadgeHtml(mov.conceptoKey, mov.tipo) + '</div>' +
          '<div><span style="color:#9ca3af;font-size:11px;display:block;">SUCURSAL / SEDE</span><strong style="color:#38bdf8;"><i class="fa-solid fa-store"></i> ' + mov.almacen + '</strong></div>' +
          '<div><span style="color:#9ca3af;font-size:11px;display:block;">FECHA / HORA</span><strong style="color:var(--f3-text);">' + mov.fecha + '</strong></div>' +
          '<div><span style="color:#9ca3af;font-size:11px;display:block;">CAJERO / USUARIO</span><strong style="color:var(--f3-text);">' + mov.usuario + '</strong></div>' +
          '<div><span style="color:#9ca3af;font-size:11px;display:block;">ENTRADA / SALIDA</span><strong style="color:#34d399;">+' + mov.entrada + '</strong> / <strong style="color:#fb7185;">-' + mov.salida + '</strong> (' + ctx.umShort + ')</div>' +
          '<div><span style="color:#9ca3af;font-size:11px;display:block;">EXISTENCIA RESULTANTE</span><strong style="color:var(--f3-text);">' + mov.saldo + ' ' + ctx.umShort + '</strong></div>' +
          '<div><span style="color:#9ca3af;font-size:11px;display:block;">PRECIO / COSTO UNIT.</span><strong style="color:var(--f3-text);">' + formatMoneyMXN(mov.costoUnit) + '</strong></div>' +
          '<div><span style="color:#9ca3af;font-size:11px;display:block;">IMPORTE DEL MOVIMIENTO</span><strong style="color:#38bdf8;">' + formatMoneyMXN(mov.totalMov) + ' MXN</strong></div>' +
        '</div>' +
        '<div style="background:var(--f3-card-bg);border:1px solid var(--f3-border);border-radius:8px;padding:10px 12px;">' +
          '<span style="color:#9ca3af;font-size:11px;display:block;font-weight:700;">DETALLE DEL FOLIO / REFERENCIA</span>' +
          '<span style="color:var(--f3-text);font-size:12px;">' + (mov.obs || mov.concepto) + '</span>' +
        '</div>';

      modal.style.display = 'flex';
    }

    function openF3OperationModal(opType) {
      f3CurrentOpType = opType;
      var modal       = document.getElementById('pa-f3-op-modal');
      var titleEl     = document.getElementById('pa-f3-op-modal-title');
      var hdrEl       = document.getElementById('pa-f3-op-modal-hdr');
      var almLabel    = document.getElementById('pa-f3-op-alm-label');
      var destWrap    = document.getElementById('pa-f3-op-dest-wrap');
      var motivoWrap  = document.getElementById('pa-f3-op-motivo-wrap');
      var motivoSel   = document.getElementById('pa-f3-op-motivo');
      var qtyLabel    = document.getElementById('pa-f3-op-qty-label');
      var qtyInp      = document.getElementById('pa-f3-op-qty');
      var costoInp    = document.getElementById('pa-f3-op-costo');
      var folioInp    = document.getElementById('pa-f3-op-folio');
      var obsInp      = document.getElementById('pa-f3-op-obs');

      if (!modal) return;
      var state = getActiveF3ProductState();
      populateF3BranchSelectors(state.rec);

      var activeFilter = document.getElementById('pa-f3-filter-almacen')?.value || 'TODOS';
      var opOrigSel = document.getElementById('pa-f3-op-almacen');
      if (opOrigSel && activeFilter !== 'TODOS') {
        opOrigSel.value = activeFilter;
      }

      if (obsInp) obsInp.value = '';
      if (qtyInp) qtyInp.value = '5';

      var rnd = Math.floor(1000 + Math.random() * 8999);
      if (opType === 'ENTRADA') {
        if (titleEl) titleEl.innerHTML = '<i class="fa-solid fa-plus" style="color:#34d399;"></i> + Entrada / Devolución / Nota de Crédito';
        if (hdrEl)   hdrEl.style.background = 'rgba(16, 185, 129, 0.16)';
        if (almLabel) almLabel.textContent = 'Sucursal / Matriz Receptora *';
        if (destWrap) destWrap.style.display = 'none';
        if (motivoWrap) motivoWrap.style.display = 'block';
        if (qtyLabel) qtyLabel.textContent = 'Cantidad a Ingresar (+) *';
        if (costoInp) costoInp.value = (state.ctx.formCosto || 0).toFixed(2);
        if (folioInp) folioInp.value = 'OC-' + rnd;
        if (motivoSel) {
          motivoSel.innerHTML =
            '<option value="COMPRA|COMPRA / RECEPCIÓN|OC-">Compra / Factura de Proveedor (OC)</option>' +
            '<option value="DEVOLUCION|DEVOLUCIÓN|DEV-">Devolución de Cliente (DEV)</option>' +
            '<option value="NOTA_CREDITO|NOTA DE CRÉDITO|NC-">Nota de Crédito CFDI (NC)</option>';
        }
      } else if (opType === 'SALIDA') {
        if (titleEl) titleEl.innerHTML = '<i class="fa-solid fa-minus" style="color:#fb7185;"></i> - Salida por Factura o Nota de Venta';
        if (hdrEl)   hdrEl.style.background = 'rgba(244, 63, 94, 0.16)';
        if (almLabel) almLabel.textContent = 'Sucursal / Matriz Vendedora *';
        if (destWrap) destWrap.style.display = 'none';
        if (motivoWrap) motivoWrap.style.display = 'block';
        if (qtyLabel) qtyLabel.textContent = 'Cantidad Vendida / Salida (-) *';
        if (costoInp) costoInp.value = (state.ctx.formPrecio || 0).toFixed(2);
        if (folioInp) folioInp.value = 'FAC-A' + rnd;
        if (motivoSel) {
          motivoSel.innerHTML =
            '<option value="FACTURA|FACTURA (CFDI)|FAC-A">Factura CFDI 4.0 (FAC)</option>' +
            '<option value="NOTA_VENTA|NOTA DE VENTA|NV-">Nota de Venta / Ticket Mostrador (NV)</option>' +
            '<option value="AJUSTE|BAJA / MERMA|BAJ-">Salida por Baja / Consumo Interno</option>';
        }
      } else if (opType === 'TRASLADO') {
        if (titleEl) titleEl.innerHTML = '<i class="fa-solid fa-right-left" style="color:#60a5fa;"></i> ⇄ Traspaso entre Matriz y Sucursal';
        if (hdrEl)   hdrEl.style.background = 'rgba(59, 130, 246, 0.16)';
        if (almLabel) almLabel.textContent = 'Sucursal Origen *';
        if (destWrap) destWrap.style.display = 'block';
        if (motivoWrap) motivoWrap.style.display = 'none';
        if (qtyLabel) qtyLabel.textContent = 'Cantidad a Traspasar *';
        if (costoInp) costoInp.value = (state.ctx.formCosto || 0).toFixed(2);
        if (folioInp) folioInp.value = 'TRA-' + rnd;
      } else if (opType === 'AJUSTE') {
        if (titleEl) titleEl.innerHTML = '<i class="fa-solid fa-scale-balanced" style="color:#fbbf24;"></i> ⚖️ Ajuste Físico de Stock en Sucursal';
        if (hdrEl)   hdrEl.style.background = 'rgba(245, 158, 11, 0.16)';
        if (almLabel) almLabel.textContent = 'Sucursal Auditada *';
        if (destWrap) destWrap.style.display = 'none';
        if (motivoWrap) motivoWrap.style.display = 'block';
        if (qtyLabel) qtyLabel.textContent = 'Existencia Real en Sucursal *';
        if (costoInp) costoInp.value = (state.ctx.formCosto || 0).toFixed(2);
        if (folioInp) folioInp.value = 'AJU-' + rnd;
        if (motivoSel) {
          motivoSel.innerHTML =
            '<option value="AJUSTE|AJUSTE DE STOCK|AJU-">Ajuste por Conteo Físico en Sucursal</option>';
        }
        var curAlmKey = document.getElementById('pa-f3-op-almacen')?.value || 'MATRIZ';
        var curWh = (state.rec.warehouses || []).find(function (w) { return w.key === curAlmKey; });
        if (qtyInp && curWh) qtyInp.value = String(curWh.fisico);
      }

      updateF3OpModalPreview();
      modal.style.display = 'flex';
      setTimeout(function () {
        if (qtyInp) { qtyInp.focus(); if (typeof qtyInp.select === 'function') qtyInp.select(); }
      }, 60);
    }

    function updateF3OpModalPreview() {
      var prevEl  = document.getElementById('pa-f3-op-preview');
      if (!prevEl) return;
      var state   = getActiveF3ProductState();
      var almKey  = document.getElementById('pa-f3-op-almacen')?.value || 'MATRIZ';
      var destKey = document.getElementById('pa-f3-op-destino')?.value || 'SUC-MAG2';
      var qty     = parseFloat(document.getElementById('pa-f3-op-qty')?.value || '0') || 0;
      var costo   = parseFloat(document.getElementById('pa-f3-op-costo')?.value || '0') || 0;

      var whOrig = (state.rec.warehouses || []).find(function (w) { return w.key === almKey; });
      var whDest = (state.rec.warehouses || []).find(function (w) { return w.key === destKey; });
      var curStock = whOrig ? (parseFloat(whOrig.fisico) || 0) : 0;

      if (f3CurrentOpType === 'ENTRADA') {
        var nextIn = curStock + qty;
        prevEl.innerHTML = 'Sede: <strong style="color:#38bdf8;">' + almKey + '</strong> | Existencia en POS pasará de <strong>' + curStock + '</strong> a <strong style="color:#34d399;">' + nextIn + ' ' + state.ctx.umShort + '</strong> (Importe: <strong>+' + formatMoneyMXN(qty * costo) + '</strong>)';
      } else if (f3CurrentOpType === 'SALIDA') {
        var nextOut = Math.max(0, curStock - qty);
        prevEl.innerHTML = 'Sede: <strong style="color:#38bdf8;">' + almKey + '</strong> | Existencia en POS pasará de <strong>' + curStock + '</strong> a <strong style="color:#fb7185;">' + nextOut + ' ' + state.ctx.umShort + '</strong> (Importe Venta/Salida: <strong>' + formatMoneyMXN(qty * costo) + '</strong>)';
      } else if (f3CurrentOpType === 'TRASLADO') {
        var curDest = whDest ? (parseFloat(whDest.fisico) || 0) : 0;
        prevEl.innerHTML = 'Traspaso de <strong style="color:#60a5fa;">' + qty + ' ' + state.ctx.umShort + '</strong>: <strong>' + almKey + '</strong> (' + curStock + ' → ' + Math.max(0, curStock - qty) + ') ➔ <strong>' + destKey + '</strong> (' + curDest + ' → ' + (curDest + qty) + ')';
      } else if (f3CurrentOpType === 'AJUSTE') {
        var diff = qty - curStock;
        var diffStr = (diff >= 0 ? '+' : '') + diff;
        prevEl.innerHTML = 'Conteo en <strong>' + almKey + '</strong>: Sistema POS <strong>' + curStock + '</strong> vs Real <strong>' + qty + ' ' + state.ctx.umShort + '</strong> ➔ Diferencia: <strong style="color:#fbbf24;">' + diffStr + ' ' + state.ctx.umShort + '</strong>';
      }
    }

    async function executeF3OperationConfirm() {
      var state   = getActiveF3ProductState();
      var rec     = state.rec;
      var ctx     = state.ctx;
      var almKey  = document.getElementById('pa-f3-op-almacen')?.value || 'MATRIZ';
      var destKey = document.getElementById('pa-f3-op-destino')?.value || 'SUC-MAG2';
      var motivoRaw = document.getElementById('pa-f3-op-motivo')?.value || 'AJUSTE|AJUSTE DE STOCK|AJU-';
      var qty     = parseFloat(document.getElementById('pa-f3-op-qty')?.value || '0') || 0;
      var costo   = parseFloat(document.getElementById('pa-f3-op-costo')?.value || '0') || 0;
      var folio   = (document.getElementById('pa-f3-op-folio')?.value || 'FOL-AUTO').trim().toUpperCase();
      var obs     = (document.getElementById('pa-f3-op-obs')?.value || '').trim();

      var whOrig = (rec.warehouses || []).find(function (w) { return w.key === almKey; });
      if (!whOrig) return;

      if (f3CurrentOpType !== 'AJUSTE' && qty <= 0) {
        _showMsg('La cantidad debe ser mayor a 0.', 'warning');
        return;
      }
      if (!obs) {
        _showMsg('Indica el Cliente, Proveedor o Referencia del folio.', 'warning');
        document.getElementById('pa-f3-op-obs')?.focus();
        return;
      }
      if (f3CurrentOpType === 'TRASLADO' && almKey === destKey) {
        _showMsg('La sucursal origen y destino deben ser distintas.', 'warning');
        return;
      }
      if ((f3CurrentOpType === 'SALIDA' || f3CurrentOpType === 'TRASLADO') && qty > (parseFloat(whOrig.fisico) || 0)) {
        _showMsg('Existencia insuficiente en ' + whOrig.nombre + ' (Disponible: ' + whOrig.fisico + ').', 'warning');
        return;
      }

      var parts = motivoRaw.split('|');
      var conceptoKey = parts[0] || 'AJUSTE';
      var docTipoLabel = parts[1] || 'AJUSTE DE STOCK';

      var confirmBtn = document.getElementById('pa-f3-op-confirm');
      var origBtnHtml = confirmBtn ? confirmBtn.innerHTML : '';
      if (confirmBtn) {
        confirmBtn.disabled = true;
        confirmBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Aplicando en POS...';
      }

      try {
        var opPayload = {
          sku: ctx.sku,
          op_type: f3CurrentOpType,
          concepto_key: conceptoKey,
          sucursal_origen: almKey,
          sucursal_destino: destKey,
          qty: qty,
          unit_price_or_cost: costo,
          folio: folio,
          obs: obs,
          usuario: getCurrentUser()
        };

        var updatedData = null;
        if (typeof AdminAPI !== 'undefined' && typeof AdminAPI.apiFetch === 'function') {
          updatedData = await AdminAPI.apiFetch('/api/products-f3/operation', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(opPayload)
          });
        } else {
          var tok = getAuthTokenF3();
          var resp = await fetch('/api/products-f3/operation', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': tok ? ('Bearer ' + tok) : ''
            },
            credentials: 'include',
            body: JSON.stringify(opPayload)
          });
          if (!resp.ok) {
            var errObj = await resp.json().catch(function () { return {}; });
            throw new Error(errObj.detail || ('Error HTTP ' + resp.status));
          }
          updatedData = await resp.json();
        }

        if (updatedData && updatedData.found) {
          f3LiveRecordCache = updatedData;
          if (Array.isArray(updatedData.products_list)) {
            f3ProductsListCache = updatedData.products_list;
            populateF3PosProductSelector(f3ProductsListCache, updatedData.sku);
          }
          if (updatedData.product) {
            loadRealProductIntoForm(updatedData.product);
          }
          renderStockF3Dom();
        }

        var modal = document.getElementById('pa-f3-op-modal');
        if (modal) modal.style.display = 'none';
        _showMsg('Folio ' + folio + ' (' + docTipoLabel + ') registrado en ' + almKey + ' y sincronizado con el POS.', 'success');
      } catch (err) {
        console.error('[Calebsys F3] Error al registrar operación:', err);
        _showMsg('No se pudo registrar la operación: ' + (err.message || 'Verifica que el producto esté guardado en el catálogo.'), 'danger');
      } finally {
        if (confirmBtn) {
          confirmBtn.disabled = false;
          confirmBtn.innerHTML = origBtnHtml;
        }
      }
    }

    // ── Exportaciones y Reportes por Sucursal y Tipo de Folio (Bloque 5) ──
    function handleF3ExportAction(exportType) {
      var state   = getActiveF3ProductState();
      var ctx     = state.ctx;
      var rec     = state.rec;
      var activeB = document.getElementById('pa-f3-filter-almacen')?.value || 'TODOS';
      var totals  = computeF3BranchAndGlobalMetrics(rec, activeB);
      var rows    = getFilteredF3KardexRows();

      if (exportType === 'excel-csv') {
        var headers = ['SKU', 'Producto', 'Fecha/Hora', 'Folio', 'Tipo Documento', 'Sucursal/Sede', 'Cliente/Proveedor/Referencia', 'Entrada(+)', 'Salida(-)', 'Existencia(Saldo)', 'Costo/Precio Unit.', 'Costo Prom.', 'Total Mov.($)', 'Usuario'];
        var csvLines = [headers.join(',')];
        rows.forEach(function (r) {
          var line = [
            '"' + ctx.sku + '"',
            '"' + ctx.desc.replace(/"/g, '""') + '"',
            '"' + r.fecha + '"',
            '"' + r.folio + '"',
            '"' + (r.docTipoLabel || r.conceptoKey || r.tipo) + '"',
            '"' + r.almacen + '"',
            '"' + (r.concepto || '').replace(/"/g, '""') + '"',
            r.entrada,
            r.salida,
            r.saldo,
            r.costoUnit.toFixed(2),
            r.costoProm.toFixed(2),
            r.totalMov.toFixed(2),
            '"' + r.usuario + '"'
          ];
          csvLines.push(line.join(','));
        });
        var blob = new Blob(['\uFEFF' + csvLines.join('\r\n')], { type: 'text/csv;charset=utf-8;' });
        var url = URL.createObjectURL(blob);
        var a = document.createElement('a');
        a.href = url;
        a.download = 'KARDEX_' + ctx.sku + '_' + (activeB === 'TODOS' ? 'TODAS_SUCURSALES' : activeB) + '.csv';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        _showMsg('Archivo Excel/CSV descargado para SKU ' + ctx.sku, 'success');
        return;
      }

      if (exportType === 'concepto') {
        var summary = {};
        rows.forEach(function (r) {
          var k = r.docTipoLabel || r.conceptoKey || r.tipo || 'OTROS';
          if (!summary[k]) summary[k] = { movs: 0, entradas: 0, salidas: 0, importe: 0 };
          summary[k].movs++;
          summary[k].entradas += (parseFloat(r.entrada) || 0);
          summary[k].salidas  += (parseFloat(r.salida) || 0);
          summary[k].importe  += (parseFloat(r.totalMov) || 0);
        });
        var trs = Object.keys(summary).map(function (k) {
          var s = summary[k];
          return '<tr>' +
            '<td style="padding:7px;border-bottom:1px solid #1d2a45;font-weight:700;color:#38bdf8;">' + k + '</td>' +
            '<td style="padding:7px;border-bottom:1px solid #1d2a45;text-align:center;">' + s.movs + '</td>' +
            '<td style="padding:7px;border-bottom:1px solid #1d2a45;text-align:right;color:#34d399;">+' + s.entradas + '</td>' +
            '<td style="padding:7px;border-bottom:1px solid #1d2a45;text-align:right;color:#fb7185;">-' + s.salidas + '</td>' +
            '<td style="padding:7px;border-bottom:1px solid #1d2a45;text-align:right;font-weight:800;">' + formatMoneyMXN(s.importe) + '</td>' +
          '</tr>';
        }).join('');

        var docModal = document.getElementById('pa-f3-doc-modal');
        var docTitle = document.getElementById('pa-f3-doc-modal-title');
        var docBody  = document.getElementById('pa-f3-doc-modal-body');
        if (docModal && docBody) {
          if (docTitle) docTitle.innerHTML = '<i class="fa-solid fa-clipboard-list" style="color:#38bdf8;"></i> Resumen por Tipo de Folio — SKU ' + ctx.sku;
          docBody.innerHTML =
            '<div style="margin-bottom:10px;font-size:12px;color:#9ca3af;">Producto: <strong style="color:var(--f3-text);">' + ctx.desc + '</strong> | Sede: <strong style="color:#38bdf8;">' + activeB + '</strong></div>' +
            '<table style="width:100%;border-collapse:collapse;font-size:12px;">' +
              '<thead><tr style="background:#1d2a45;color:#cbd5e1;"><th style="padding:7px;text-align:left;">Tipo de Folio / Documento</th><th style="padding:7px;">Folios</th><th style="padding:7px;text-align:right;">Entradas</th><th style="padding:7px;text-align:right;">Salidas</th><th style="padding:7px;text-align:right;">Importe ($)</th></tr></thead>' +
              '<tbody>' + trs + '</tbody>' +
            '</table>';
          docModal.style.display = 'flex';
        }
        return;
      }

      if (exportType === 'send-report') {
        var whSummaryLines = (rec.warehouses || []).map(function (w) {
          return '• ' + w.nombre + ': Existencia ' + w.fisico + ' ' + ctx.umShort + ' | Ventas: ' + (w.ventasUnidades || 0) + ' ' + ctx.umShort + ' (' + formatMoneyMXN(w.ventasMonto || 0) + ')';
        }).join('\n');
        var kSummaryLines = rows.slice(0, 15).map(function (r) {
          var movStr = r.entrada ? ('+' + r.entrada) : ('-' + (r.salida || 0));
          return '• [' + r.fecha + '] ' + r.folio + ' (' + (r.docTipoLabel || r.tipo) + ') - ' + r.almacen + ': ' + movStr + ' -> Saldo: ' + r.saldo + ' (' + formatMoneyMXN(r.totalMov) + ')';
        }).join('\n');
        var reportText =
          '📊 *REPORTE DE EXISTENCIAS Y KARDEX — CALEBSYS ERP*\n' +
          'Producto: ' + ctx.sku + ' — ' + ctx.desc + '\n' +
          'Fecha: ' + formatDateTimeNow() + ' | Sede: ' + activeB + '\n\n' +
          '*RESUMEN GENERAL:*\n' +
          '• Existencia en Sucursales: ' + totals.fisicoTotal + ' ' + ctx.umShort + '\n' +
          '• Ventas POS: ' + totals.ventasUnidades + ' ' + ctx.umShort + ' (' + formatMoneyMXN(totals.ventasMonto) + ')\n' +
          '• Disponible en POS: ' + totals.disponible + ' ' + ctx.umShort + '\n' +
          '• Devoluciones / N. Crédito: ' + totals.devolucionesTotal + ' ' + ctx.umShort + '\n' +
          '• Valor en Inventario: ' + formatMoneyMXN(totals.valorTotal) + ' MXN\n\n' +
          '*POR SUCURSAL / SEDE:*\n' + (whSummaryLines || '• Sin sucursales') + '\n\n' +
          '*MOVIMIENTOS KARDEX (' + rows.length + '):*\n' + (kSummaryLines || '• Sin movimientos en el filtro actual');

        var docModal = document.getElementById('pa-f3-doc-modal');
        var docTitle = document.getElementById('pa-f3-doc-modal-title');
        var docBody  = document.getElementById('pa-f3-doc-modal-body');
        if (docModal && docBody) {
          if (docTitle) docTitle.innerHTML = '<i class="fa-solid fa-paper-plane" style="color:#38bdf8;"></i> Enviar / Compartir Reporte — SKU ' + ctx.sku;
          docBody.innerHTML =
            '<div style="display:flex;flex-direction:column;gap:12px;">' +
              '<div style="font-size:12px;color:var(--f3-muted,#64748b);">Envía el reporte de existencias y Kardex por <b>WhatsApp</b>, <b>Correo Electrónico</b>, o imprímelo en PDF:</div>' +
              '<div style="display:grid;grid-template-columns:1fr auto;gap:8px;align-items:center;">' +
                '<input type="tel" id="pa-f3-send-wa-phone" class="pa-input" placeholder="Teléfono WhatsApp (10 dígitos, opcional)..." style="height:36px;font-size:12.5px;">' +
                '<button type="button" id="pa-f3-send-wa-btn" style="height:36px;padding:0 14px;border-radius:8px;border:none;background:#16a34a;color:#fff;font-weight:700;font-size:12px;cursor:pointer;display:inline-flex;align-items:center;gap:6px;">' +
                  '<i class="fa-brands fa-whatsapp" style="font-size:15px;"></i> Enviar WhatsApp' +
                '</button>' +
              '</div>' +
              '<div style="display:grid;grid-template-columns:1fr auto;gap:8px;align-items:center;">' +
                '<input type="email" id="pa-f3-send-email-to" class="pa-input" placeholder="Correo electrónico del destinatario..." style="height:36px;font-size:12.5px;">' +
                '<button type="button" id="pa-f3-send-email-btn" style="height:36px;padding:0 14px;border-radius:8px;border:none;background:#2563eb;color:#fff;font-weight:700;font-size:12px;cursor:pointer;display:inline-flex;align-items:center;gap:6px;">' +
                  '<i class="fa-solid fa-envelope"></i> Enviar Correo' +
                '</button>' +
              '</div>' +
              '<div>' +
                '<label style="font-size:11px;font-weight:700;color:var(--f3-muted,#64748b);display:block;margin-bottom:4px;">VISTA PREVIA DEL REPORTE:</label>' +
                '<textarea id="pa-f3-send-preview-txt" style="width:100%;height:170px;padding:10px;border-radius:8px;border:1px solid var(--f3-border,#cbd5e1);background:var(--f3-input-bg,#f8fafc);color:var(--f3-text,#0f172a);font-family:monospace;font-size:11.5px;resize:vertical;"></textarea>' +
              '</div>' +
              '<div style="display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap;padding-top:4px;">' +
                '<button type="button" id="pa-f3-send-copy-btn" style="height:34px;padding:0 12px;border-radius:8px;border:1px solid #64748b;background:transparent;color:var(--f3-text,#0f172a);font-weight:700;font-size:12px;cursor:pointer;display:inline-flex;align-items:center;gap:6px;">' +
                  '<i class="fa-regular fa-copy"></i> Copiar al Portapapeles' +
                '</button>' +
                '<button type="button" id="pa-f3-send-print-btn" style="height:34px;padding:0 14px;border-radius:8px;border:1px solid #2563eb;background:rgba(37,99,235,.12);color:#2563eb;font-weight:700;font-size:12px;cursor:pointer;display:inline-flex;align-items:center;gap:6px;">' +
                  '<i class="fa-solid fa-print"></i> Imprimir / Guardar PDF' +
                '</button>' +
              '</div>' +
            '</div>';
          var txtEl = document.getElementById('pa-f3-send-preview-txt');
          if (txtEl) txtEl.value = reportText;
          document.getElementById('pa-f3-send-wa-btn')?.addEventListener('click', function () {
            var rawPhone = (document.getElementById('pa-f3-send-wa-phone')?.value || '').replace(/\D+/g, '');
            var msg = (document.getElementById('pa-f3-send-preview-txt')?.value || reportText);
            if (rawPhone.length === 10) rawPhone = '52' + rawPhone;
            var waUrl = rawPhone
              ? 'https://wa.me/' + rawPhone + '?text=' + encodeURIComponent(msg)
              : 'https://wa.me/?text=' + encodeURIComponent(msg);
            window.open(waUrl, '_blank', 'noopener');
          });
          document.getElementById('pa-f3-send-email-btn')?.addEventListener('click', function () {
            var email = (document.getElementById('pa-f3-send-email-to')?.value || '').trim();
            var msg = (document.getElementById('pa-f3-send-preview-txt')?.value || reportText);
            var subj = 'Reporte de Kardex y Existencias - SKU ' + ctx.sku + ' (' + ctx.desc + ')';
            window.location.href = 'mailto:' + encodeURIComponent(email) + '?subject=' + encodeURIComponent(subj) + '&body=' + encodeURIComponent(msg);
          });
          document.getElementById('pa-f3-send-copy-btn')?.addEventListener('click', function () {
            var msg = (document.getElementById('pa-f3-send-preview-txt')?.value || reportText);
            if (navigator.clipboard && navigator.clipboard.writeText) {
              navigator.clipboard.writeText(msg).then(function () {
                _showMsg('Reporte copiado al portapapeles.', 'success');
              });
            }
          });
          document.getElementById('pa-f3-send-print-btn')?.addEventListener('click', function () {
            handleF3ExportAction('pdf-kardex');
          });
          docModal.style.display = 'flex';
        }
        return;
      }

      if (exportType === 'pdf-kardex' || exportType === 'ciego-pdf') {
        var win = window.open('', '_blank', 'width=980,height=740');
        if (!win) {
          _showMsg('Permite ventanas emergentes para imprimir el reporte en PDF.', 'warning');
          return;
        }
        if (exportType === 'ciego-pdf') {
          var whRowsHtml = (rec.warehouses || []).map(function (w) {
            return '<tr>' +
              '<td><strong>' + w.nombre + '</strong></td>' +
              '<td>' + ctx.equivalencia + '</td>' +
              '<td>' + w.min + ' / ' + w.max + '</td>' +
              '<td style="text-align:center;color:#94a3b8;font-style:italic;">[ OCULTO - CONTEO CIEGO ]</td>' +
              '<td style="height:28px;"></td>' +
              '<td></td>' +
            '</tr>';
          }).join('');
          win.document.write(
            '<html><head><title>Hoja de Conteo por Sucursal - SKU ' + ctx.sku + '</title>' +
            '<style>body{font-family:Arial,sans-serif;padding:26px;color:#0f172a;}h2{margin:0 0 4px;}table{width:100%;border-collapse:collapse;margin-top:16px;font-size:12.5px;}th,td{border:1px solid #334155;padding:9px;}th{background:#e2e8f0;text-align:left;}.sigs{display:grid;grid-template-columns:1fr 1fr 1fr;gap:30px;margin-top:65px;text-align:center;font-size:12px;}.sig-line{border-top:1px solid #0f172a;padding-top:6px;}</style></head><body>' +
            '<h2>CALEBSYS ERP — HOJA DE CONTEO FÍSICO POR SUCURSAL Y MATRIZ</h2>' +
            '<div><strong>PRODUCTO:</strong> SKU ' + ctx.sku + ' — ' + ctx.desc + ' (SAT: ' + ctx.sat + ')</div>' +
            '<div><strong>Fecha:</strong> ' + formatDateTimeNow() + ' | <strong>Unidad:</strong> ' + ctx.um + '</div>' +
            '<table><thead><tr><th>Sucursal / Sede</th><th>Presentación / Equivalencia</th><th>Mín / Máx</th><th>Existencia Sistema</th><th>Conteo Físico Real (' + ctx.umShort + ')</th><th>Observaciones</th></tr></thead><tbody>' + whRowsHtml + '</tbody></table>' +
            '<div class="sigs"><div class="sig-line">Responsable de Sucursal</div><div class="sig-line">Auditoría de Inventarios</div><div class="sig-line">Autorización Matriz</div></div>' +
            '</body></html>'
          );
          win.document.close();
          win.focus();
          setTimeout(function () { try { win.print(); } catch (e) {} }, 250);
          return;
        }

        // PDF Kardex + Sucursales por Producto
        var whDetailHtml = (rec.warehouses || []).map(function (w) {
          return '<tr>' +
            '<td><strong>' + w.nombre + '</strong></td>' +
            '<td>' + ctx.equivalencia + '</td>' +
            '<td>' + w.min + ' / ' + w.max + '</td>' +
            '<td>' + (w.ventasUnidades || 0) + ' ' + ctx.umShort + ' (' + formatMoneyMXN(w.ventasMonto || 0) + ')</td>' +
            '<td>' + ((w.devoluciones || 0) + (w.notasCredito || 0)) + ' ' + ctx.umShort + '</td>' +
            '<td style="text-align:right;font-weight:bold;">' + w.fisico + ' ' + ctx.umShort + '</td>' +
          '</tr>';
        }).join('');
        var kRowsHtml = rows.map(function (r) {
          return '<tr>' +
            '<td>' + r.fecha + '</td>' +
            '<td style="font-family:monospace;font-weight:bold;">' + r.folio + '</td>' +
            '<td>' + (r.docTipoLabel || r.conceptoKey || r.tipo) + '</td>' +
            '<td><strong>' + r.almacen + '</strong></td>' +
            '<td>' + r.concepto + '</td>' +
            '<td style="text-align:right;">' + (r.entrada ? '+' + r.entrada : '-') + '</td>' +
            '<td style="text-align:right;">' + (r.salida ? '-' + r.salida : '-') + '</td>' +
            '<td style="text-align:right;font-weight:bold;">' + r.saldo + '</td>' +
            '<td style="text-align:right;">' + formatMoneyMXN(r.costoUnit) + '</td>' +
            '<td style="text-align:right;">' + formatMoneyMXN(r.totalMov) + '</td>' +
            '<td>' + r.usuario + '</td>' +
          '</tr>';
        }).join('');
        win.document.write(
          '<html><head><title>Reporte de Existencias y Kardex - SKU ' + ctx.sku + '</title>' +
          '<style>body{font-family:Arial,sans-serif;padding:24px;color:#0f172a;}h2{margin:0 0 4px;}h3{margin:16px 0 6px;font-size:13px;color:#1e293b;text-transform:uppercase;}table{width:100%;border-collapse:collapse;margin-top:6px;font-size:11.5px;}th,td{border:1px solid #cbd5e1;padding:6px 8px;}th{background:#f1f5f9;text-align:left;}.kpis{display:grid;grid-template-columns:repeat(5,1fr);gap:10px;margin:14px 0;}.kpi{border:1px solid #94a3b8;border-radius:6px;padding:8px;text-align:center;}.sigs{display:grid;grid-template-columns:1fr 1fr 1fr;gap:30px;margin-top:60px;text-align:center;font-size:12px;}.sig-line{border-top:1px solid #0f172a;padding-top:6px;}</style></head><body>' +
          '<h2>CALEBSYS ERP — REPORTE DE EXISTENCIAS Y KARDEX POR SUCURSAL</h2>' +
          '<div><strong>SKU:</strong> ' + ctx.sku + ' | <strong>DESCRIPCIÓN:</strong> ' + ctx.desc + ' | <strong>SEDE FILTRADA:</strong> ' + activeB + ' | <strong>FECHA:</strong> ' + formatDateTimeNow() + '</div>' +
          '<div class="kpis">' +
            '<div class="kpi"><small>EXISTENCIA</small><br><strong>' + totals.fisicoTotal + ' ' + ctx.umShort + '</strong></div>' +
            '<div class="kpi"><small>VENTAS (FAC / NV)</small><br><strong>' + totals.ventasUnidades + ' ' + ctx.umShort + '</strong></div>' +
            '<div class="kpi"><small>DISPONIBLE VENTA</small><br><strong>' + totals.disponible + ' ' + ctx.umShort + '</strong></div>' +
            '<div class="kpi"><small>DEVOLUCIONES / NC</small><br><strong>' + totals.devolucionesTotal + ' ' + ctx.umShort + '</strong></div>' +
            '<div class="kpi"><small>VALOR INVENTARIO</small><br><strong>' + formatMoneyMXN(totals.valorTotal) + ' MXN</strong></div>' +
          '</div>' +
          '<h3>Existencias y Ventas por Sucursal y Matriz</h3>' +
          '<table><thead><tr><th>Sucursal / Sede</th><th>Presentación</th><th>Mín / Máx</th><th>Ventas POS</th><th>Devoluciones / NC</th><th style="text-align:right;">Existencia Actual</th></tr></thead><tbody>' + whDetailHtml + '</tbody></table>' +
          '<h3>Movimientos del Kardex del Producto</h3>' +
          '<table><thead><tr><th>Fecha/Hora</th><th>Folio</th><th>Tipo Doc.</th><th>Sucursal</th><th>Cliente / Referencia</th><th>Entrada</th><th>Salida</th><th>Saldo</th><th>Precio/Costo</th><th>Total Mov.</th><th>Usuario</th></tr></thead><tbody>' + kRowsHtml + '</tbody></table>' +
          '<div class="sigs"><div class="sig-line">Encargado de Sucursal / Matriz</div><div class="sig-line">Auditoría</div><div class="sig-line">Dirección General</div></div>' +
          '</body></html>'
        );
        win.document.close();
        win.focus();
        setTimeout(function () { try { win.print(); } catch (e) {} }, 250);
      }
    }

    // ── Eventos de Botones y Filtros del Panel F3 ──
    document.getElementById('pa-f3-btn-entrada')?.addEventListener('click', function () { openF3OperationModal('ENTRADA'); });
    document.getElementById('pa-f3-btn-salida')?.addEventListener('click', function () { openF3OperationModal('SALIDA'); });
    document.getElementById('pa-f3-btn-traslado')?.addEventListener('click', function () { openF3OperationModal('TRASLADO'); });
    document.getElementById('pa-f3-btn-ajuste')?.addEventListener('click', function () { openF3OperationModal('AJUSTE'); });

    // Botones inferiores de Imprimir Reporte / Exportar Excel / Enviar Reporte (al pie del Bloque 4)
    document.getElementById('pa-f3-btn-bottom-print')?.addEventListener('click', function () { handleF3ExportAction('pdf-kardex'); });
    document.getElementById('pa-f3-btn-bottom-excel')?.addEventListener('click', function () { handleF3ExportAction('excel-csv'); });
    document.getElementById('pa-f3-btn-bottom-send')?.addEventListener('click', function () { handleF3ExportAction('send-report'); });

    document.getElementById('pa-f3-op-motivo')?.addEventListener('change', function () {
      var val = (this.value || '').split('|');
      var prefix = val[2] || 'FOL-';
      var folioInp = document.getElementById('pa-f3-op-folio');
      if (folioInp) {
        folioInp.value = prefix + Math.floor(1000 + Math.random() * 8999);
      }
    });

    document.getElementById('pa-f3-op-modal-close')?.addEventListener('click', function () {
      var m = document.getElementById('pa-f3-op-modal');
      if (m) m.style.display = 'none';
    });
    document.getElementById('pa-f3-op-cancel')?.addEventListener('click', function () {
      var m = document.getElementById('pa-f3-op-modal');
      if (m) m.style.display = 'none';
    });
    document.getElementById('pa-f3-op-confirm')?.addEventListener('click', executeF3OperationConfirm);

    ['pa-f3-op-almacen', 'pa-f3-op-destino', 'pa-f3-op-qty', 'pa-f3-op-costo'].forEach(function (id) {
      var el = document.getElementById(id);
      if (el) {
        el.addEventListener('input', updateF3OpModalPreview);
        el.addEventListener('change', function () {
          if (id === 'pa-f3-op-almacen' && f3CurrentOpType === 'AJUSTE') {
            var st = getActiveF3ProductState();
            var wh = (st.rec.warehouses || []).find(function (w) { return w.key === el.value; });
            var qEl = document.getElementById('pa-f3-op-qty');
            if (wh && qEl) qEl.value = String(wh.fisico);
          }
          updateF3OpModalPreview();
        });
      }
    });

    document.getElementById('pa-f3-doc-modal-close')?.addEventListener('click', function () {
      var m = document.getElementById('pa-f3-doc-modal');
      if (m) m.style.display = 'none';
    });
    document.getElementById('pa-f3-doc-modal-ok')?.addEventListener('click', function () {
      var m = document.getElementById('pa-f3-doc-modal');
      if (m) m.style.display = 'none';
    });

    // Dropdown Exportar (Bloque 5)
    var f3ExportBtn  = document.getElementById('pa-f3-btn-export-toggle');
    var f3ExportMenu = document.getElementById('pa-f3-export-dropdown');
    if (f3ExportBtn && f3ExportMenu) {
      f3ExportBtn.addEventListener('click', function (e) {
        e.stopPropagation();
        var isOpen = f3ExportMenu.style.display === 'block';
        f3ExportMenu.style.display = isOpen ? 'none' : 'block';
      });
      f3ExportMenu.querySelectorAll('.f3-export-item').forEach(function (item) {
        item.addEventListener('click', function () {
          f3ExportMenu.style.display = 'none';
          handleF3ExportAction(item.getAttribute('data-export'));
        });
      });
      document.addEventListener('click', function (e) {
        if (f3ExportMenu.style.display === 'block' && !f3ExportMenu.contains(e.target) && e.target !== f3ExportBtn) {
          f3ExportMenu.style.display = 'none';
        }
      });
    }

    // Selector de Productos Reales del POS y botón Sincronizar POS en el Banner F3
    var f3PosSel = document.getElementById('pa-f3-product-selector');
    if (f3PosSel) {
      f3PosSel.addEventListener('change', function () {
        var chosenSku = (this.value || '').trim();
        if (chosenSku) {
          fetchRealProductF3FromServer(chosenSku, { populateForm: true, force: true });
        }
      });
    }

    var f3SyncBtn = document.getElementById('pa-f3-btn-sync-pos');
    if (f3SyncBtn) {
      f3SyncBtn.addEventListener('click', async function () {
        var curSku = (document.getElementById('pa-f3-product-selector')?.value || document.getElementById('pa-sku')?.value || '').trim();
        f3SyncBtn.disabled = true;
        f3SyncBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Sincronizando...';
        await fetchRealProductF3FromServer(curSku, { populateForm: true, force: true });
        f3SyncBtn.disabled = false;
        f3SyncBtn.innerHTML = '<i class="fa-solid fa-rotate"></i> Sincronizar POS';
        _showMsg('Existencias, sucursales y ventas sincronizadas en tiempo real con el POS.', 'success');
      });
    }

    // ── Detector en Tiempo Real de Códigos Duplicados (SKU, Código de Barras y Código Alterno) ──
    var codigoAltEl = document.getElementById('pa-codigo-alt');
    var dupCheckTimer = null;
    var _lastToastDupKey = '';

    async function verifyAndLoadDuplicateCode(inputEl, fieldLabel, isImmediate) {
      if (_isPopulatingRealProduct || !inputEl) return false;
      var typedVal = (inputEl.value || '').trim().toUpperCase();
      if (!typedVal || typedVal.length < 2) {
        var sVal = (skuEl ? skuEl.value : '').trim();
        var cVal = (codigoEl ? codigoEl.value : '').trim();
        var aVal = (codigoAltEl ? codigoAltEl.value : '').trim();
        if (!sVal && !cVal && !aVal) {
          hideDuplicateProductBanner();
        }
        return false;
      }

      // Asegurar que la lista completa de productos (con barcode y sales_code) esté en memoria
      await ensureProductsCatalogLoadedForDuplicateCheck(false);

      var match = findMatchingProductByAnyCode(typedVal);
      if (match && match.product) {
        loadRealProductIntoForm(match.product);
        fetchRealProductF3FromServer(match.product.sku, { populateForm: true, force: true });
        return true;
      }

      // Consultar directo al servidor por si el producto se acaba de crear en otra sesión
      if (isImmediate || typedVal.length >= 3) {
        var srvData = await fetchRealProductF3FromServer(typedVal, { populateForm: false, force: true });
        if (srvData && srvData.found && srvData.product && srvData.matched_by && srvData.matched_by !== 'DEFAULT') {
          loadRealProductIntoForm(srvData.product);
          return true;
        }
      }
      return false;
    }

    [
      { el: skuEl, label: 'SKU' },
      { el: codigoEl, label: 'CÓDIGO DE BARRAS' },
      { el: codigoAltEl, label: 'CÓDIGO ALTERNO' }
    ].forEach(function (cfg) {
      if (!cfg.el) return;
      cfg.el.addEventListener('input', function () {
        if (_isPopulatingRealProduct) return;
        if (dupCheckTimer) clearTimeout(dupCheckTimer);
        dupCheckTimer = setTimeout(function () {
          verifyAndLoadDuplicateCode(cfg.el, cfg.label, false);
        }, 160);
      });
      cfg.el.addEventListener('change', function () {
        if (_isPopulatingRealProduct) return;
        verifyAndLoadDuplicateCode(cfg.el, cfg.label, true);
      });
      cfg.el.addEventListener('blur', function () {
        if (_isPopulatingRealProduct) return;
        verifyAndLoadDuplicateCode(cfg.el, cfg.label, true);
      });
    });

    // ── Buscador Inteligente en el Header de Alta / Edición (#pa-header-search-input) ──
    var paHdrSearchInp = document.getElementById('pa-header-search-input');
    var paHdrSearchBtn = document.getElementById('pa-header-search-btn');
    var paHdrSearchClr = document.getElementById('pa-header-search-clear');
    var paHdrSearchDd  = document.getElementById('pa-header-search-dropdown');
    var paHdrSearchTimer = null;
    var paHdrResults = [];
    var paHdrActiveIdx = 0;

    function _paStripAccUpper(s) {
      if (!s) return '';
      return String(s).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().trim();
    }

    function _paNormToken(t) {
      var u = _paStripAccUpper(t);
      u = u.replace(/^(\d+(?:\.\d+)?)(KGS?|KILOS?|KILOGRAMOS?)$/, '$1K');
      u = u.replace(/^(\d+(?:\.\d+)?)(LTS?|LITROS?)$/, '$1L');
      u = u.replace(/^(\d+(?:\.\d+)?)(MTS?|METROS?)$/, '$1M');
      u = u.replace(/^(\d+(?:\.\d+)?)(GRS?|GRAMOS?)$/, '$1G');
      return u;
    }

    function _paStemToken(t) {
      var u = _paNormToken(t);
      if (u === 'CEMETO' || u === 'SEMENTO' || u === 'CEMENTOS') return 'CEMENTO';
      if (u.length > 4 && u.slice(-2) === 'ES' && !/\d/.test(u)) return u.slice(0, -2);
      if (u.length > 3 && u.slice(-1) === 'S' && !/\d/.test(u)) return u.slice(0, -1);
      return u;
    }

    function _paTokenizeQuery(q) {
      var raw = _paStripAccUpper(q).replace(/[,;|]+/g, ' ');
      var parts = raw.split(/\s+/).filter(Boolean);
      var merged = [];
      var i = 0;
      while (i < parts.length) {
        var cur = parts[i];
        var nxt = (i + 1 < parts.length) ? parts[i + 1] : '';
        if (/^\d+(?:\.\d+)?$/.test(cur) && /^(K|KG|KGS|KILO|KILOS|G|GR|GRS|L|LT|LTS|M|MT|MTS|CM|MM|PZA|PZAS|PZ)$/.test(nxt)) {
          merged.push(_paNormToken(cur + nxt));
          i += 2;
          continue;
        }
        merged.push(_paNormToken(cur));
        i += 1;
      }
      return merged;
    }

    function _paAlnumCompare(aStr, bStr) {
      var a = _paStripAccUpper(aStr || '');
      var b = _paStripAccUpper(bStr || '');
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

    function _paFilterAndSortLocal(qRaw, sourceItems) {
      var qClean = _paStripAccUpper(qRaw);
      var qNoZeros = qClean.replace(/^0+/, '');
      var tokens = _paTokenizeQuery(qRaw);
      if (!tokens.length) return [];
      var list = Array.isArray(sourceItems) && sourceItems.length ? sourceItems : getCombinedProductsForDuplicateCheck();
      var scored = [];
      list.forEach(function (p) {
        if (!p || !p.sku) return;
        var m = (p.meta_data && typeof p.meta_data === 'object') ? p.meta_data : {};
        var sku = _paStripAccUpper(p.sku);
        var bc = _paStripAccUpper(p.barcode || m.codigo_barras || '');
        var bcNoZ = bc.replace(/^0+/, '');
        var sc = _paStripAccUpper(p.sales_code || m.codigo_alterno || '');
        var nm = _paStripAccUpper(p.name || p.description || '');
        var mar = _paStripAccUpper(p.marca || m.marca || m.brand || '');
        var fam = _paStripAccUpper(p.familia || m.familia || '');
        var dep = _paStripAccUpper(p.departamento || m.departamento || '');
        var obs = _paStripAccUpper(m.observaciones || m.referencia || m.referencias || '');
        var baseBlob = [sku, bc, bcNoZ, sc, nm, mar, fam, dep, obs].filter(Boolean).join(' ');
        var blob = baseBlob.replace(/(\d+(?:\.\d+)?)\s*(K|KG|KGS|KILO|KILOS|L|LT|LTS|M|MT|MTS)\b/g, function (_m, num, u) {
          return _m + ' ' + _paNormToken(num + u) + ' ' + num + 'K ' + num + 'KG ' + num + ' K ' + num + ' KG';
        });
        var words = blob.split(/[\s\-_/.,;:()[\]]+/).filter(Boolean);

        if (sku === qClean || (bc && (bc === qClean || (qNoZeros && bcNoZ === qNoZeros))) || (sc && sc === qClean)) {
          scored.push({ p: p, tier: 0 });
          return;
        }

        for (var ti = 0; ti < tokens.length; ti++) {
          var tok = tokens[ti];
          var tokStem = _paStemToken(tok);
          var ok = false;
          if (blob.indexOf(tok) !== -1 || (tokStem && blob.indexOf(tokStem) !== -1)) {
            ok = true;
          } else {
            for (var wi = 0; wi < words.length; wi++) {
              var w = words[wi];
              var ws = _paStemToken(w);
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
        var cName = _paAlnumCompare(a.p.name || a.p.description || a.p.sku, b.p.name || b.p.description || b.p.sku);
        if (cName !== 0) return cName;
        return _paAlnumCompare(a.p.sku, b.p.sku);
      });
      return scored.map(function (x) { return x.p; });
    }

    function renderPaHeaderSearchDropdown(items, qRaw) {
      if (!paHdrSearchDd) return;
      paHdrResults = Array.isArray(items) ? items : [];
      if (!qRaw || !String(qRaw).trim()) {
        paHdrSearchDd.style.display = 'none';
        paHdrSearchDd.innerHTML = '';
        return;
      }
      if (paHdrActiveIdx >= paHdrResults.length) paHdrActiveIdx = 0;
      if (paHdrResults.length === 0) {
        paHdrSearchDd.style.display = 'block';
        paHdrSearchDd.innerHTML =
          '<div style="padding:12px 14px;font-size:12px;color:#94a3b8;display:flex;align-items:center;gap:8px;">' +
            '<i class="fa-solid fa-circle-info" style="color:#38bdf8;"></i>' +
            '<span>Sin coincidencias para <b style="color:#f8fafc;">"' + String(qRaw).replace(/</g, '&lt;') + '"</b></span>' +
          '</div>';
        return;
      }
      var html =
        '<div style="padding:6px 12px;background:rgba(2,132,199,0.16);border-bottom:1px solid rgba(56,189,248,0.22);display:flex;align-items:center;justify-content:space-between;font-size:10.5px;font-weight:800;color:#38bdf8;text-transform:uppercase;letter-spacing:.3px;">' +
          '<span><i class="fa-solid fa-arrow-down-a-z"></i> ' + paHdrResults.length + (paHdrResults.length === 1 ? ' producto encontrado' : ' productos en orden alfanumérico') + '</span>' +
          '<span>↑↓ Navegar · ENTER Cargar</span>' +
        '</div>';

      paHdrResults.slice(0, 25).forEach(function (p, idx) {
        var m = (p.meta_data && typeof p.meta_data === 'object') ? p.meta_data : {};
        var sku = String(p.sku || '').toUpperCase();
        var bc = String(p.barcode || m.codigo_barras || '').toUpperCase();
        var name = String(p.name || p.description || sku).toUpperCase();
        var marca = String(p.marca || m.marca || m.brand || 'GENÉRICO').toUpperCase();
        var price = parseFloat(p.price || 0) || 0;
        var stock = parseFloat(p.stock || 0) || 0;
        var isAct = idx === paHdrActiveIdx;
        var bg = isAct ? 'background:rgba(2,132,199,0.24);border-left:3px solid #38bdf8;' : 'background:#0b1324;border-left:3px solid transparent;';
        var bcTag = (bc && bc !== sku) ? (' <span style="font-size:10px;color:#94a3b8;font-family:\'JetBrains Mono\',monospace;"><i class="fa-solid fa-barcode"></i> ' + bc + '</span>') : '';
        var marcaTag = (marca && marca !== 'GENÉRICO' && marca !== 'GENERICO')
          ? (' <span style="font-size:10px;padding:1px 6px;border-radius:4px;background:rgba(56,189,248,0.14);color:#38bdf8;border:1px solid rgba(56,189,248,0.3);font-weight:800;">' + marca + '</span>')
          : '';

        html +=
          '<div class="pa-hdr-search-item" data-idx="' + idx + '" data-sku="' + sku.replace(/"/g, '&quot;') + '" style="padding:8px 12px;border-bottom:1px solid #1e293b;cursor:pointer;display:flex;align-items:center;justify-content:space-between;gap:10px;' + bg + '">' +
            '<div style="min-width:0;flex:1;">' +
              '<div style="display:flex;align-items:center;gap:7px;flex-wrap:wrap;">' +
                '<span style="font-family:\'JetBrains Mono\',monospace;font-size:11px;font-weight:800;color:#fff;background:#0284c7;padding:1px 7px;border-radius:5px;">' + sku + '</span>' +
                bcTag +
                marcaTag +
              '</div>' +
              '<div style="font-size:12.5px;font-weight:700;color:#f8fafc;margin-top:3px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' + name + '</div>' +
            '</div>' +
            '<div style="text-align:right;flex-shrink:0;">' +
              '<div style="font-size:12.5px;font-weight:800;color:#34d399;font-family:\'JetBrains Mono\',monospace;">$' + price.toFixed(2) + '</div>' +
              '<div style="font-size:10px;color:#94a3b8;font-weight:600;">Stock: ' + stock + '</div>' +
            '</div>' +
          '</div>';
      });

      paHdrSearchDd.innerHTML = html;
      paHdrSearchDd.style.display = 'block';

      paHdrSearchDd.querySelectorAll('.pa-hdr-search-item').forEach(function (el) {
        el.addEventListener('mousedown', function (ev) {
          ev.preventDefault();
          var idx = parseInt(el.getAttribute('data-idx') || '0', 10);
          var chosen = paHdrResults[idx];
          if (chosen) pickProductFromPaHeaderSearch(chosen);
        });
      });
    }

    var paHdrAutoClearTimer = null;
    function schedulePaHeaderSearchClear4s() {
      clearTimeout(paHdrAutoClearTimer);
      if (!paHdrSearchInp || !paHdrSearchInp.value) return;
      paHdrAutoClearTimer = setTimeout(function () {
        if (paHdrSearchInp) paHdrSearchInp.value = '';
        if (paHdrSearchClr) paHdrSearchClr.style.display = 'none';
        if (paHdrSearchDd) paHdrSearchDd.style.display = 'none';
      }, 1500);
    }

    function pickProductFromPaHeaderSearch(prod) {
      if (!prod || !prod.sku) return;
      if (paHdrSearchDd) paHdrSearchDd.style.display = 'none';
      if (paHdrSearchInp) paHdrSearchInp.value = prod.sku + ' — ' + (prod.name || prod.description || '');
      if (paHdrSearchClr) paHdrSearchClr.style.display = 'inline-flex';
      schedulePaHeaderSearchClear4s();
      loadRealProductIntoForm(prod);
      fetchRealProductF3FromServer(prod.sku, { populateForm: true, force: true });
    }

    async function executePaHeaderSearch(qRaw, pickIfSingleOrEnter) {
      var q = String(qRaw || '').trim();
      if (paHdrSearchClr) paHdrSearchClr.style.display = q ? 'inline-flex' : 'none';
      if (!q) {
        renderPaHeaderSearchDropdown([], '');
        return;
      }
      await ensureProductsCatalogLoadedForDuplicateCheck(false);
      var localMatches = _paFilterAndSortLocal(q);
      renderPaHeaderSearchDropdown(localMatches, q);

      // Consultar backend en paralelo para enriquecer coincidencias por marca/referencia/código
      try {
        var tok = getAuthTokenF3();
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
              var k = String(it.sku).trim().toUpperCase();
              if (!mergedMap[k]) {
                mergedMap[k] = it;
                mergedArr.push(it);
              }
            });
            var sortedMerged = _paFilterAndSortLocal(q, mergedArr);
            if (!sortedMerged.length) sortedMerged = mergedArr;
            renderPaHeaderSearchDropdown(sortedMerged, q);
          }
        }
      } catch (e) {}

      if (pickIfSingleOrEnter && paHdrResults.length > 0) {
        var targetProd = paHdrResults[paHdrActiveIdx] || paHdrResults[0];
        if (paHdrResults.length === 1 || pickIfSingleOrEnter === 'enter') {
          pickProductFromPaHeaderSearch(targetProd);
        }
      }
    }

    if (paHdrSearchInp && !paHdrSearchInp.__calebBound) {
      paHdrSearchInp.__calebBound = true;
      paHdrSearchInp.addEventListener('focus', function () {
        if (paHdrSearchInp.value.indexOf(' — ') !== -1) {
          paHdrSearchInp.select();
        } else if (paHdrSearchInp.value.trim()) {
          executePaHeaderSearch(paHdrSearchInp.value, false);
        }
      });
      paHdrSearchInp.addEventListener('input', function () {
        var q = paHdrSearchInp.value;
        paHdrActiveIdx = 0;
        if (paHdrSearchClr) paHdrSearchClr.style.display = q ? 'inline-flex' : 'none';
        var localMatches = _paFilterAndSortLocal(q);
        renderPaHeaderSearchDropdown(localMatches, q);
        schedulePaHeaderSearchClear4s();
        clearTimeout(paHdrSearchTimer);
        paHdrSearchTimer = setTimeout(function () {
          executePaHeaderSearch(q, false);
        }, 180);
      });
      paHdrSearchInp.addEventListener('keydown', function (ev) {
        if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') {
          if (!paHdrResults.length) return;
          ev.preventDefault();
          ev.stopPropagation();
          var maxIdx = Math.min(24, paHdrResults.length - 1);
          paHdrActiveIdx = ev.key === 'ArrowDown'
            ? Math.min(maxIdx, paHdrActiveIdx + 1)
            : Math.max(0, paHdrActiveIdx - 1);
          renderPaHeaderSearchDropdown(paHdrResults, paHdrSearchInp.value);
        } else if (ev.key === 'Enter') {
          ev.preventDefault();
          ev.stopPropagation();
          if (paHdrResults.length > 0 && paHdrSearchDd && paHdrSearchDd.style.display !== 'none') {
            pickProductFromPaHeaderSearch(paHdrResults[paHdrActiveIdx] || paHdrResults[0]);
          } else {
            executePaHeaderSearch(paHdrSearchInp.value, 'enter');
          }
        } else if (ev.key === 'Escape') {
          if (paHdrSearchDd && paHdrSearchDd.style.display !== 'none') {
            ev.preventDefault();
            ev.stopPropagation();
            paHdrSearchDd.style.display = 'none';
          }
        }
      });
    }

    if (paHdrSearchBtn && !paHdrSearchBtn.__calebBound) {
      paHdrSearchBtn.__calebBound = true;
      paHdrSearchBtn.addEventListener('click', function (ev) {
        ev.preventDefault();
        var rawVal = paHdrSearchInp ? paHdrSearchInp.value : '';
        if (rawVal.indexOf(' — ') !== -1) rawVal = rawVal.split(' — ')[0];
        executePaHeaderSearch(rawVal, true);
      });
    }

    if (paHdrSearchClr && !paHdrSearchClr.__calebBound) {
      paHdrSearchClr.__calebBound = true;
      paHdrSearchClr.addEventListener('click', function (ev) {
        ev.preventDefault();
        if (paHdrSearchInp) {
          paHdrSearchInp.value = '';
          paHdrSearchInp.focus();
        }
        paHdrSearchClr.style.display = 'none';
        if (paHdrSearchDd) paHdrSearchDd.style.display = 'none';
      });
    }

    document.addEventListener('mousedown', function (ev) {
      var wrap = document.getElementById('pa-header-search-wrap');
      if (paHdrSearchDd && paHdrSearchDd.style.display !== 'none' && wrap && !wrap.contains(ev.target)) {
        paHdrSearchDd.style.display = 'none';
      }
    });

    document.getElementById('pa-dup-btn-ver-stock')?.addEventListener('click', function () {
      var tabF3 = document.querySelector('#pa-tabs-nav .pa-tab[data-tab="inventario"]');
      if (tabF3) activateProductAltaTab(tabF3);
    });

    document.getElementById('pa-dup-btn-nuevo')?.addEventListener('click', function () {
      if (typeof global.limpiarFormularioAlta === 'function') {
        global.limpiarFormularioAlta();
      }
    });

    // =========================================================================
    // ── 7c. VENTA SUGERIDA — BARRA BUSCADORA MULTIMODAL + VENTANA DE ARTÍCULOS MULTIMODAL ──
    // =========================================================================
    if (!Array.isArray(global._paSuggestedProducts)) {
      global._paSuggestedProducts = [];
    }

    var paSugInlineInp   = document.getElementById('pa-sugerido-search-input');
    var paSugInlineClr   = document.getElementById('pa-sugerido-search-clear');
    var paSugInlineDd    = document.getElementById('pa-sugerido-search-dropdown');
    var paSugInlineWrap  = document.getElementById('pa-sugerido-search-bar-wrap');
    var paBtnAddSug      = document.getElementById('pa-btn-add-sugerido');

    var paModalSug       = document.getElementById('pa-modal-sugeridos');
    var paModalSugClose  = document.getElementById('pa-modal-sug-close');
    var paModalSugCancel = document.getElementById('pa-modal-sug-cancel');
    var paModalSugInp    = document.getElementById('pa-modal-sug-search-inp');
    var paModalSugClr    = document.getElementById('pa-modal-sug-search-clear');
    var paModalSugBtn    = document.getElementById('pa-modal-sug-search-btn');
    var paModalSugChkAll = document.getElementById('pa-modal-sug-check-all');
    var paModalSugTbody  = document.getElementById('pa-modal-sug-tbody');
    var paModalSugAddSel = document.getElementById('pa-modal-sug-add-selected');

    var _sugInlineResults = [];
    var _sugInlineActiveIdx = 0;
    var _sugInlineNavigated = false;
    var _sugInlineTimer = null;

    var _sugModalFiltered = [];
    var _sugModalActiveIdx = 0;
    var _sugModalNavigated = false;
    var _sugModalCheckedSkus = {};
    var _sugModalTab = 'todo';
    var _sugModalTimer = null;

    function _escSug(s) {
      return String(s == null ? '' : s)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
    }

    function _getSugCatalogExcludingActive() {
      var curSku = _paStripAccUpper(document.getElementById('pa-sku')?.value || '');
      var all = getCombinedProductsForDuplicateCheck();
      return all.filter(function (p) {
        return p && p.sku && _paStripAccUpper(p.sku) !== curSku;
      });
    }

    function _filterSugCatalogMultimodal(qRaw, sourceList) {
      var base = Array.isArray(sourceList) ? sourceList : _getSugCatalogExcludingActive();
      var curSku = _paStripAccUpper(document.getElementById('pa-sku')?.value || '');
      var filteredBase = base.filter(function (p) {
        return p && p.sku && _paStripAccUpper(p.sku) !== curSku;
      });
      var q = String(qRaw || '').trim();
      if (!q) {
        var copy = filteredBase.slice();
        copy.sort(function (a, b) {
          var cName = _paAlnumCompare(a.name || a.description || a.sku, b.name || b.description || b.sku);
          if (cName !== 0) return cName;
          return _paAlnumCompare(a.sku, b.sku);
        });
        return copy;
      }
      return _paFilterAndSortLocal(q, filteredBase);
    }

    function renderPaSuggestedProductsTable() {
      var tbody = document.getElementById('pa-sugeridos-tbody');
      var badge = document.getElementById('pa-sugeridos-count-badge');
      if (!tbody) return;

      var list = Array.isArray(global._paSuggestedProducts) ? global._paSuggestedProducts : [];
      var catalog = getCombinedProductsForDuplicateCheck();

      list.forEach(function (item) {
        var live = catalog.find(function (p) {
          return _paStripAccUpper(p.sku) === _paStripAccUpper(item.sku);
        });
        if (live) {
          var m = (live.meta_data && typeof live.meta_data === 'object') ? live.meta_data : {};
          item.barcode = String(live.barcode || m.codigo_barras || item.barcode || live.sku).toUpperCase();
          item.description = String(live.name || live.description || item.description || live.sku).toUpperCase();
          item.brand = String(live.marca || m.marca || m.brand || item.brand || 'GENÉRICO').toUpperCase();
          item.unit = String(live.sale_unit || item.unit || 'PIEZA').toUpperCase();
          item.price = parseFloat(live.price != null ? live.price : item.price) || 0;
          item.stock = parseFloat(live.stock != null ? live.stock : item.stock) || 0;
        }
      });

      if (badge) {
        badge.textContent = list.length + (list.length === 1 ? ' sugerido' : ' sugeridos');
      }

      if (!list.length) {
        tbody.innerHTML =
          '<tr>' +
            '<td colspan="5" class="pa-td-empty">' +
              '<i class="fa-solid fa-box-archive"></i> No hay productos sugeridos. Usa el buscador arriba o pulsa «+ Agregar producto».' +
            '</td>' +
          '</tr>';
        return;
      }

      tbody.innerHTML = list.map(function (it, idx) {
        var sku = String(it.sku || '').toUpperCase();
        var bc = String(it.barcode || '').toUpperCase();
        var desc = String(it.description || sku).toUpperCase();
        var brand = String(it.brand || 'GENÉRICO').toUpperCase();
        var pr = parseFloat(it.price || 0) || 0;
        var st = parseFloat(it.stock || 0) || 0;
        var bcSub = (bc && bc !== sku) ? ('<div style="font-size:9.5px;color:#64748b;font-family:monospace;">Cód: ' + _escSug(bc) + '</div>') : '';
        var brandBadge = (brand && brand !== 'GENÉRICO' && brand !== 'GENERICO')
          ? (' <span style="font-size:9.5px;padding:1px 6px;border-radius:4px;background:#eff6ff;color:#1d4ed8;border:1px solid #bfdbfe;font-weight:800;">' + _escSug(brand) + '</span>')
          : '';
        var stockBadge = '<span style="font-size:9.5px;margin-left:6px;font-weight:800;color:' + (st > 0 ? '#15803d' : '#dc2626') + ';">Stock: ' + st + '</span>';

        return '<tr>' +
          '<td style="font-weight:800;color:#64748b;">' + (idx + 1) + '</td>' +
          '<td>' +
            '<span style="font-family:\'JetBrains Mono\',monospace;font-size:11px;font-weight:800;color:#1d4ed8;background:#dbeafe;padding:2px 6px;border-radius:5px;">' + _escSug(sku) + '</span>' +
            bcSub +
          '</td>' +
          '<td>' +
            '<div style="font-weight:800;color:#0f172a;font-size:11.5px;">' + _escSug(desc) + brandBadge + stockBadge + '</div>' +
          '</td>' +
          '<td style="text-align:right;font-family:\'JetBrains Mono\',monospace;font-weight:900;color:#0f172a;">$' + pr.toFixed(2) + '</td>' +
          '<td style="text-align:center;">' +
            '<button type="button" data-pa-sug-del="' + idx + '" title="Quitar artículo sugerido" style="background:#fef2f2;color:#dc2626;border:1px solid #fecaca;border-radius:6px;padding:3px 8px;cursor:pointer;font-size:11px;font-weight:800;">' +
              '<i class="fa-solid fa-trash"></i>' +
            '</button>' +
          '</td>' +
        '</tr>';
      }).join('');

      tbody.querySelectorAll('[data-pa-sug-del]').forEach(function (btn) {
        btn.addEventListener('click', function () {
          var i = parseInt(btn.getAttribute('data-pa-sug-del'), 10);
          if (!isNaN(i) && global._paSuggestedProducts[i]) {
            var removed = global._paSuggestedProducts.splice(i, 1)[0];
            renderPaSuggestedProductsTable();
            if (paModalSug && paModalSug.style.display === 'flex') {
              renderPaSugModalTable();
            }
            _showMsg('Artículo sugerido ' + (removed.sku || '') + ' eliminado.', 'info');
          }
        });
      });
    }
    global.renderPaSuggestedProductsTable = renderPaSuggestedProductsTable;

    function addPaSuggestedProduct(prod, opts) {
      opts = opts || {};
      if (!prod || !prod.sku) return false;
      var curSku = _paStripAccUpper(document.getElementById('pa-sku')?.value || '');
      var targetSku = _paStripAccUpper(prod.sku);
      if (curSku && targetSku === curSku) {
        if (!opts.silent) _showMsg('No puedes agregar el mismo artículo activo como sugerido de sí mismo.', 'warning');
        return false;
      }
      if (!Array.isArray(global._paSuggestedProducts)) global._paSuggestedProducts = [];
      var exists = global._paSuggestedProducts.some(function (x) {
        return _paStripAccUpper(x.sku) === targetSku;
      });
      if (exists) {
        if (!opts.silent) _showMsg('El artículo ' + targetSku + ' ya está en Venta Sugerida.', 'info');
        return false;
      }

      var m = (prod.meta_data && typeof prod.meta_data === 'object') ? prod.meta_data : {};
      global._paSuggestedProducts.push({
        sku: targetSku,
        barcode: String(prod.barcode || m.codigo_barras || targetSku).toUpperCase(),
        description: String(prod.name || prod.description || targetSku).toUpperCase(),
        brand: String(prod.marca || m.marca || m.brand || 'GENÉRICO').toUpperCase(),
        unit: String(prod.sale_unit || 'PIEZA').toUpperCase(),
        price: parseFloat(prod.price != null ? prod.price : 0) || 0,
        stock: parseFloat(prod.stock != null ? prod.stock : 0) || 0
      });

      renderPaSuggestedProductsTable();
      if (!opts.silent) {
        _showMsg('🛒 Artículo sugerido agregado: ' + targetSku + ' — ' + String(prod.name || prod.description || '').toUpperCase(), 'success');
      }
      return true;
    }

    // ── A. Buscador Multimodal Inline en Tarjeta "Venta Sugerida" ──
    function renderPaSugInlineDropdown(items, qRaw) {
      if (!paSugInlineDd) return;
      _sugInlineResults = Array.isArray(items) ? items : [];
      if (_sugInlineActiveIdx >= _sugInlineResults.length) _sugInlineActiveIdx = 0;

      if (_sugInlineResults.length === 0) {
        paSugInlineDd.style.display = 'block';
        paSugInlineDd.innerHTML =
          '<div style="padding:12px 14px;font-size:12px;color:#94a3b8;display:flex;align-items:center;justify-content:space-between;gap:8px;">' +
            '<span><i class="fa-solid fa-circle-info" style="color:#38bdf8;margin-right:6px;"></i>Sin coincidencias para <b style="color:#f8fafc;">"' + _escSug(qRaw || '') + '"</b></span>' +
            '<button type="button" id="pa-sug-dd-open-cat" style="padding:3px 9px;border-radius:6px;border:1px solid #38bdf8;background:rgba(56,189,248,0.15);color:#38bdf8;font-size:10.5px;font-weight:800;cursor:pointer;">Abrir Catálogo Multimodal</button>' +
          '</div>';
        paSugInlineDd.querySelector('#pa-sug-dd-open-cat')?.addEventListener('mousedown', function (ev) {
          ev.preventDefault();
          paSugInlineDd.style.display = 'none';
          openPaSugeridosModal('');
        });
        return;
      }

      var html =
        '<div style="padding:6px 12px;background:rgba(2,132,199,0.2);border-bottom:1px solid rgba(56,189,248,0.25);display:flex;align-items:center;justify-content:space-between;font-size:10px;font-weight:800;color:#38bdf8;text-transform:uppercase;letter-spacing:.3px;position:sticky;top:0;z-index:2;backdrop-filter:blur(6px);">' +
          '<span><i class="fa-solid fa-arrow-down-a-z"></i> ' + _sugInlineResults.length + (_sugInlineResults.length === 1 ? ' artículo disponible' : ' artículos en orden alfanumérico') + '</span>' +
          '<span>↑↓ Navegar · ENTER o Clic para Agregar</span>' +
        '</div>';

      _sugInlineResults.slice(0, 25).forEach(function (p, idx) {
        var m = (p.meta_data && typeof p.meta_data === 'object') ? p.meta_data : {};
        var sku = String(p.sku || '').toUpperCase();
        var bc = String(p.barcode || m.codigo_barras || '').toUpperCase();
        var name = String(p.name || p.description || sku).toUpperCase();
        var marca = String(p.marca || m.marca || m.brand || 'GENÉRICO').toUpperCase();
        var price = parseFloat(p.price || 0) || 0;
        var stock = parseFloat(p.stock || 0) || 0;
        var already = (global._paSuggestedProducts || []).some(function (s) { return _paStripAccUpper(s.sku) === sku; });
        var isAct = idx === _sugInlineActiveIdx;
        var bg = isAct ? 'background:rgba(2,132,199,0.26);border-left:3px solid #38bdf8;' : 'background:#0b1324;border-left:3px solid transparent;';
        var bcTag = (bc && bc !== sku) ? (' <span style="font-size:10px;color:#94a3b8;font-family:monospace;"><i class="fa-solid fa-barcode"></i> ' + _escSug(bc) + '</span>') : '';
        var marcaTag = (marca && marca !== 'GENÉRICO' && marca !== 'GENERICO')
          ? (' <span style="font-size:10px;padding:1px 6px;border-radius:4px;background:rgba(56,189,248,0.14);color:#38bdf8;border:1px solid rgba(56,189,248,0.3);font-weight:800;">' + _escSug(marca) + '</span>')
          : '';
        var statusPill = already
          ? '<span style="font-size:9.5px;padding:1px 6px;border-radius:4px;background:rgba(16,185,129,0.2);color:#34d399;border:1px solid rgba(16,185,129,0.4);font-weight:800;">✓ Agregado</span>'
          : '<span style="font-size:9.5px;padding:1px 6px;border-radius:4px;background:rgba(37,99,235,0.25);color:#93c5fd;border:1px solid rgba(59,130,246,0.4);font-weight:800;">+ Sugerir</span>';

        html +=
          '<div class="pa-sug-inline-item" data-idx="' + idx + '" style="padding:8px 12px;border-bottom:1px solid #1e293b;cursor:pointer;display:flex;align-items:center;justify-content:space-between;gap:10px;' + bg + '">' +
            '<div style="min-width:0;flex:1;">' +
              '<div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;">' +
                '<span style="font-family:monospace;font-size:11px;font-weight:800;color:#fff;background:#0284c7;padding:1px 7px;border-radius:5px;">' + _escSug(sku) + '</span>' +
                bcTag +
                marcaTag +
                statusPill +
              '</div>' +
              '<div style="font-size:12px;font-weight:700;color:#f8fafc;margin-top:3px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' + _escSug(name) + '</div>' +
            '</div>' +
            '<div style="text-align:right;flex-shrink:0;">' +
              '<div style="font-size:12px;font-weight:800;color:#34d399;font-family:monospace;">$' + price.toFixed(2) + '</div>' +
              '<div style="font-size:10px;color:' + (stock > 0 ? '#94a3b8' : '#f87171') + ';font-weight:700;">Stock: ' + stock + '</div>' +
            '</div>' +
          '</div>';
      });

      paSugInlineDd.innerHTML = html;
      paSugInlineDd.style.display = 'block';

      var actEl = paSugInlineDd.querySelector('.pa-sug-inline-item[data-idx="' + _sugInlineActiveIdx + '"]');
      if (actEl && typeof actEl.scrollIntoView === 'function') {
        try { actEl.scrollIntoView({ block: 'nearest' }); } catch (e) {}
      }

      paSugInlineDd.querySelectorAll('.pa-sug-inline-item').forEach(function (el) {
        el.addEventListener('mousedown', function (ev) {
          ev.preventDefault();
          ev.stopPropagation();
          var i = parseInt(el.getAttribute('data-idx') || '0', 10);
          var chosen = _sugInlineResults[i];
          if (chosen) {
            addPaSuggestedProduct(chosen);
            if (paSugInlineInp) paSugInlineInp.value = '';
            if (paSugInlineClr) paSugInlineClr.style.display = 'none';
            paSugInlineDd.style.display = 'none';
          }
        });
      });
    }

    async function executePaSugInlineSearch(qRaw, pickOnEnter) {
      var q = String(qRaw || '').trim();
      if (paSugInlineClr) paSugInlineClr.style.display = q ? 'inline-flex' : 'none';
      await ensureProductsCatalogLoadedForDuplicateCheck(false);
      var localMatches = _filterSugCatalogMultimodal(q);
      renderPaSugInlineDropdown(localMatches, q);

      if (q) {
        try {
          var tok = getAuthTokenF3();
          var r = await fetch('/api/products/search?limit=50&q=' + encodeURIComponent(q), {
            headers: tok ? { 'Authorization': 'Bearer ' + tok } : {},
            credentials: 'include'
          });
          if (r.ok) {
            var srv = await r.json();
            if (Array.isArray(srv) && srv.length) {
              var map = {};
              var merged = [];
              localMatches.concat(srv).forEach(function (it) {
                if (!it || !it.sku) return;
                var k = _paStripAccUpper(it.sku);
                if (!map[k]) {
                  map[k] = it;
                  merged.push(it);
                }
              });
              var sorted = _filterSugCatalogMultimodal(q, merged);
              renderPaSugInlineDropdown(sorted.length ? sorted : merged, q);
            }
          }
        } catch (e) {}
      }

      if (pickOnEnter && _sugInlineResults.length > 0) {
        var chosen = _sugInlineResults[_sugInlineActiveIdx] || _sugInlineResults[0];
        if (chosen) {
          addPaSuggestedProduct(chosen);
          if (paSugInlineInp) paSugInlineInp.value = '';
          if (paSugInlineClr) paSugInlineClr.style.display = 'none';
          if (paSugInlineDd) paSugInlineDd.style.display = 'none';
        }
      }
    }

    if (paSugInlineInp && !paSugInlineInp.__calebSugBound) {
      paSugInlineInp.__calebSugBound = true;
      paSugInlineInp.addEventListener('focus', function () {
        _sugInlineNavigated = false;
        executePaSugInlineSearch(paSugInlineInp.value, false);
      });
      paSugInlineInp.addEventListener('input', function () {
        var q = paSugInlineInp.value;
        _sugInlineActiveIdx = 0;
        _sugInlineNavigated = false;
        if (paSugInlineClr) paSugInlineClr.style.display = q ? 'inline-flex' : 'none';
        var localMatches = _filterSugCatalogMultimodal(q);
        renderPaSugInlineDropdown(localMatches, q);
        clearTimeout(_sugInlineTimer);
        _sugInlineTimer = setTimeout(function () {
          executePaSugInlineSearch(q, false);
        }, 160);
      });
      paSugInlineInp.addEventListener('keydown', function (ev) {
        if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') {
          if (!_sugInlineResults.length) return;
          ev.preventDefault();
          ev.stopPropagation();
          _sugInlineNavigated = true;
          var maxIdx = Math.min(24, _sugInlineResults.length - 1);
          _sugInlineActiveIdx = ev.key === 'ArrowDown'
            ? Math.min(maxIdx, _sugInlineActiveIdx + 1)
            : Math.max(0, _sugInlineActiveIdx - 1);
          renderPaSugInlineDropdown(_sugInlineResults, paSugInlineInp.value);
        } else if ((ev.key === ' ' || ev.code === 'Space') && (_sugInlineNavigated || !paSugInlineInp.value.trim()) && _sugInlineResults.length > 0 && paSugInlineDd && paSugInlineDd.style.display !== 'none') {
          ev.preventDefault();
          ev.stopPropagation();
          var spaceTarget = _sugInlineResults[_sugInlineActiveIdx] || _sugInlineResults[0];
          if (spaceTarget) {
            addPaSuggestedProduct(spaceTarget);
            renderPaSugInlineDropdown(_sugInlineResults, paSugInlineInp.value);
          }
        } else if (ev.key === 'Enter') {
          ev.preventDefault();
          ev.stopPropagation();
          if (_sugInlineResults.length > 0 && paSugInlineDd && paSugInlineDd.style.display !== 'none') {
            var target = _sugInlineResults[_sugInlineActiveIdx] || _sugInlineResults[0];
            if (target) {
              addPaSuggestedProduct(target);
              paSugInlineInp.value = '';
              _sugInlineNavigated = false;
              if (paSugInlineClr) paSugInlineClr.style.display = 'none';
              paSugInlineDd.style.display = 'none';
            }
          } else {
            executePaSugInlineSearch(paSugInlineInp.value, true);
          }
        } else if (ev.key === 'Escape') {
          if (paSugInlineDd && paSugInlineDd.style.display !== 'none') {
            ev.preventDefault();
            ev.stopPropagation();
            paSugInlineDd.style.display = 'none';
          }
        }
      });
    }

    if (paSugInlineClr && !paSugInlineClr.__calebSugBound) {
      paSugInlineClr.__calebSugBound = true;
      paSugInlineClr.addEventListener('click', function (ev) {
        ev.preventDefault();
        if (paSugInlineInp) {
          paSugInlineInp.value = '';
          paSugInlineInp.focus();
        }
        paSugInlineClr.style.display = 'none';
        executePaSugInlineSearch('', false);
      });
    }

    document.addEventListener('mousedown', function (ev) {
      if (paSugInlineDd && paSugInlineDd.style.display !== 'none' && paSugInlineWrap && !paSugInlineWrap.contains(ev.target)) {
        paSugInlineDd.style.display = 'none';
      }
    });

    // ── B. Ventana Modal de Artículos Multimodal (#pa-modal-sugeridos) ──
    function updatePaSugModalSelectedCounter() {
      var pill = document.getElementById('pa-modal-sug-selected-pill');
      var count = Object.keys(_sugModalCheckedSkus).filter(function (k) { return !!_sugModalCheckedSkus[k]; }).length;
      if (pill) {
        pill.textContent = count + (count === 1 ? ' artículo marcado' : ' artículos marcados');
      }
    }

    function renderPaSugModalTable(sourceItems) {
      if (!paModalSugTbody) return;
      var q = paModalSugInp ? paModalSugInp.value : '';

      var matches = _filterSugCatalogMultimodal(q, sourceItems);
      matches = matches.filter(function (p) {
        var m = (p.meta_data && typeof p.meta_data === 'object') ? p.meta_data : {};
        var st = parseFloat(p.stock || 0) || 0;
        var minSt = parseFloat(p.stock_minimo != null ? p.stock_minimo : (m.stock_min || 5)) || 5;

        if (_sugModalTab === 'con-stock' && st <= 0) return false;
        if (_sugModalTab === 'sin-stock' && st > 0) return false;
        if (_sugModalTab === 'bajo-minimo' && st > minSt) return false;
        return true;
      });

      _sugModalFiltered = matches;
      var maxAllowedIdx = Math.max(0, Math.min(79, _sugModalFiltered.length - 1));
      if (_sugModalActiveIdx > maxAllowedIdx) _sugModalActiveIdx = 0;

      var countEl = document.getElementById('pa-modal-sug-count');
      if (countEl) {
        countEl.textContent = _sugModalFiltered.length + (_sugModalFiltered.length === 1 ? ' artículo' : ' artículos');
      }

      if (!_sugModalFiltered.length) {
        paModalSugTbody.innerHTML =
          '<tr><td colspan="8" style="text-align:center;padding:28px;color:#64748b;font-size:12.5px;font-weight:700;">' +
            '<i class="fa-solid fa-magnifying-glass" style="color:#2563eb;margin-right:6px;"></i>No se encontraron artículos con los filtros actuales.' +
          '</td></tr>';
        return;
      }

      var visibleSlice = _sugModalFiltered.slice(0, 80);
      paModalSugTbody.innerHTML = visibleSlice.map(function (p, idx) {
        var m = (p.meta_data && typeof p.meta_data === 'object') ? p.meta_data : {};
        var sku = String(p.sku || '').toUpperCase();
        var bc = String(p.barcode || m.codigo_barras || '').toUpperCase();
        var desc = String(p.name || p.description || sku).toUpperCase();
        var brand = String(p.marca || m.marca || m.brand || 'GENÉRICO').toUpperCase();
        var fam = String(p.familia || m.familia || 'GENERAL').toUpperCase();
        var unit = String(p.sale_unit || 'PIEZA').toUpperCase();
        var price = parseFloat(p.price || 0) || 0;
        var stock = parseFloat(p.stock || 0) || 0;
        var isChecked = !!_sugModalCheckedSkus[sku];
        var isFocused = idx === _sugModalActiveIdx;
        var alreadyInList = (global._paSuggestedProducts || []).some(function (s) { return _paStripAccUpper(s.sku) === sku; });

        var rowBg = isFocused ? '#dbeafe' : (isChecked ? '#eff6ff' : '#ffffff');
        var rowBorderLeft = isFocused ? '3px solid #2563eb' : '3px solid transparent';

        return '<tr data-sug-mod-row="' + idx + '" data-sug-mod-sku="' + _escSug(sku) + '" style="background:' + rowBg + ';border-left:' + rowBorderLeft + ';cursor:pointer;transition:background .1s;">' +
          '<td style="text-align:center;padding:7px 8px;">' +
            '<input type="checkbox" data-sug-mod-chk="' + _escSug(sku) + '"' + (isChecked ? ' checked' : '') + ' style="width:15px;height:15px;accent-color:#2563eb;cursor:pointer;">' +
          '</td>' +
          '<td style="padding:7px 10px;">' +
            '<span style="font-family:\'JetBrains Mono\',monospace;font-size:11px;font-weight:800;color:#1d4ed8;background:#eff6ff;border:1px solid #bfdbfe;padding:1px 6px;border-radius:5px;">' + _escSug(sku) + '</span>' +
            ((bc && bc !== sku) ? ('<div style="font-size:9.5px;color:#64748b;font-family:monospace;margin-top:2px;">' + _escSug(bc) + '</div>') : '') +
          '</td>' +
          '<td style="padding:7px 10px;font-weight:800;color:#0f172a;font-size:12px;">' + _escSug(desc) + '</td>' +
          '<td style="padding:7px 10px;">' +
            '<span style="font-size:10px;padding:1px 6px;border-radius:4px;background:#f1f5f9;color:#334155;font-weight:800;">' + _escSug(brand) + '</span>' +
            '<div style="font-size:9.5px;color:#64748b;margin-top:2px;">' + _escSug(fam) + '</div>' +
          '</td>' +
          '<td style="padding:7px 10px;text-align:center;font-size:11px;font-weight:700;color:#475569;">' + _escSug(unit) + '</td>' +
          '<td style="padding:7px 10px;text-align:right;font-family:\'JetBrains Mono\',monospace;font-weight:900;color:#0f172a;">$' + price.toFixed(2) + '</td>' +
          '<td style="padding:7px 10px;text-align:center;font-weight:800;color:' + (stock > 0 ? '#15803d' : '#dc2626') + ';">' + stock + '</td>' +
          '<td style="padding:7px 10px;text-align:center;">' +
            (alreadyInList
              ? '<span style="font-size:10px;padding:3px 8px;border-radius:6px;background:#dcfce7;color:#15803d;border:1px solid #86efac;font-weight:800;">✓ Sugerido</span>'
              : '<button type="button" data-sug-mod-pick="' + _escSug(sku) + '" style="padding:4px 9px;border-radius:6px;border:1px solid #2563eb;background:#2563eb;color:#ffffff;font-size:10.5px;font-weight:800;cursor:pointer;">+ Elegir</button>') +
          '</td>' +
        '</tr>';
      }).join('');

      var activeRowEl = paModalSugTbody.querySelector('tr[data-sug-mod-row="' + _sugModalActiveIdx + '"]');
      if (activeRowEl && typeof activeRowEl.scrollIntoView === 'function') {
        try { activeRowEl.scrollIntoView({ block: 'nearest' }); } catch (e) {}
      }

      paModalSugTbody.querySelectorAll('tr[data-sug-mod-row]').forEach(function (tr) {
        tr.addEventListener('click', function (ev) {
          if (ev.target && (ev.target.tagName === 'INPUT' || ev.target.tagName === 'BUTTON' || ev.target.closest('button'))) return;
          var idx = parseInt(tr.getAttribute('data-sug-mod-row') || '0', 10);
          var sku = tr.getAttribute('data-sug-mod-sku') || '';
          _sugModalActiveIdx = idx;
          _sugModalNavigated = true;
          if (sku) {
            _sugModalCheckedSkus[sku] = !_sugModalCheckedSkus[sku];
            updatePaSugModalSelectedCounter();
          }
          renderPaSugModalTable();
        });
        tr.addEventListener('dblclick', function () {
          var idx = parseInt(tr.getAttribute('data-sug-mod-row') || '0', 10);
          var prod = _sugModalFiltered[idx];
          if (prod) {
            addPaSuggestedProduct(prod);
            renderPaSugModalTable();
          }
        });
      });

      paModalSugTbody.querySelectorAll('input[data-sug-mod-chk]').forEach(function (chk) {
        chk.addEventListener('change', function (ev) {
          ev.stopPropagation();
          var sku = chk.getAttribute('data-sug-mod-chk') || '';
          var rowEl = chk.closest('tr[data-sug-mod-row]');
          if (rowEl) {
            _sugModalActiveIdx = parseInt(rowEl.getAttribute('data-sug-mod-row') || '0', 10);
            _sugModalNavigated = true;
          }
          if (sku) {
            _sugModalCheckedSkus[sku] = !!chk.checked;
            updatePaSugModalSelectedCounter();
            renderPaSugModalTable();
          }
        });
      });

      paModalSugTbody.querySelectorAll('button[data-sug-mod-pick]').forEach(function (btn) {
        btn.addEventListener('click', function (ev) {
          ev.stopPropagation();
          var sku = btn.getAttribute('data-sug-mod-pick') || '';
          var prod = _sugModalFiltered.find(function (p) { return _paStripAccUpper(p.sku) === _paStripAccUpper(sku); });
          if (prod) {
            addPaSuggestedProduct(prod);
            renderPaSugModalTable();
          }
        });
      });
    }

    async function openPaSugeridosModal(initialQuery) {
      if (!paModalSug) return;
      _sugModalCheckedSkus = {};
      _sugModalActiveIdx = 0;
      _sugModalNavigated = false;
      if (paModalSugChkAll) paModalSugChkAll.checked = false;
      updatePaSugModalSelectedCounter();
      paModalSug.style.display = 'flex';

      await ensureProductsCatalogLoadedForDuplicateCheck(false);
      var catalog = _getSugCatalogExcludingActive();

      if (paModalSugInp) {
        paModalSugInp.value = String(initialQuery != null ? initialQuery : (paSugInlineInp ? paSugInlineInp.value : '')).trim().toUpperCase();
        if (paModalSugClr) paModalSugClr.style.display = paModalSugInp.value ? 'inline-flex' : 'none';
      }
      renderPaSugModalTable(catalog);
      setTimeout(function () {
        if (paModalSugInp) {
          paModalSugInp.focus();
          if (typeof paModalSugInp.select === 'function') paModalSugInp.select();
        }
      }, 40);
    }

    function closePaSugeridosModal() {
      if (paModalSug) paModalSug.style.display = 'none';
    }

    function confirmPaSugModalSelection() {
      var checkedSkus = Object.keys(_sugModalCheckedSkus).filter(function (k) { return !!_sugModalCheckedSkus[k]; });
      var catalog = _getSugCatalogExcludingActive();
      var addedCount = 0;

      if (checkedSkus.length > 0) {
        checkedSkus.forEach(function (sku) {
          var prod = catalog.find(function (p) { return _paStripAccUpper(p.sku) === _paStripAccUpper(sku); }) ||
                     _sugModalFiltered.find(function (p) { return _paStripAccUpper(p.sku) === _paStripAccUpper(sku); });
          if (prod && addPaSuggestedProduct(prod, { silent: true })) {
            addedCount++;
          }
        });
        _sugModalCheckedSkus = {};
        if (paModalSugChkAll) paModalSugChkAll.checked = false;
        updatePaSugModalSelectedCounter();
        if (addedCount > 0) {
          _showMsg('🛒 Se agregaron ' + addedCount + (addedCount === 1 ? ' artículo a Venta Sugerida.' : ' artículos a Venta Sugerida.'), 'success');
        }
        closePaSugeridosModal();
        return;
      }

      var activeProd = _sugModalFiltered[_sugModalActiveIdx] || _sugModalFiltered[0];
      if (activeProd) {
        addPaSuggestedProduct(activeProd);
        closePaSugeridosModal();
      } else {
        _showMsg('Selecciona o busca al menos un artículo para agregar a Venta Sugerida.', 'warning');
      }
    }

    if (paBtnAddSug && !paBtnAddSug.__calebSugBound) {
      paBtnAddSug.__calebSugBound = true;
      paBtnAddSug.addEventListener('click', function (ev) {
        ev.preventDefault();
        openPaSugeridosModal('');
      });
    }
    if (paModalSugClose) paModalSugClose.addEventListener('click', closePaSugeridosModal);
    if (paModalSugCancel) paModalSugCancel.addEventListener('click', closePaSugeridosModal);
    if (paModalSug) {
      paModalSug.addEventListener('mousedown', function (ev) {
        if (ev.target === paModalSug) closePaSugeridosModal();
      });
    }
    if (paModalSugAddSel) {
      paModalSugAddSel.addEventListener('click', function (ev) {
        ev.preventDefault();
        confirmPaSugModalSelection();
      });
    }

    document.querySelectorAll('#pa-modal-sug-filter-tabs .pa-sug-tab-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        _sugModalTab = btn.getAttribute('data-sug-tab') || 'todo';
        _sugModalActiveIdx = 0;
        _sugModalNavigated = true;
        document.querySelectorAll('#pa-modal-sug-filter-tabs .pa-sug-tab-btn').forEach(function (b) {
          var isAct = b === btn;
          b.style.background = isAct ? '#2563eb' : '#ffffff';
          b.style.color = isAct ? '#ffffff' : '#475569';
          b.style.borderColor = isAct ? '#2563eb' : '#cbd5e1';
        });
        renderPaSugModalTable();
      });
    });

    if (paModalSugChkAll) {
      paModalSugChkAll.addEventListener('change', function () {
        var check = !!paModalSugChkAll.checked;
        _sugModalFiltered.slice(0, 80).forEach(function (p) {
          var sku = String(p.sku || '').toUpperCase();
          if (sku) _sugModalCheckedSkus[sku] = check;
        });
        updatePaSugModalSelectedCounter();
        renderPaSugModalTable();
      });
    }

    if (paModalSugInp && !paModalSugInp.__calebSugBound) {
      paModalSugInp.__calebSugBound = true;
      paModalSugInp.addEventListener('input', function () {
        var q = paModalSugInp.value;
        _sugModalActiveIdx = 0;
        _sugModalNavigated = false;
        if (paModalSugClr) paModalSugClr.style.display = q ? 'inline-flex' : 'none';
        renderPaSugModalTable();
        clearTimeout(_sugModalTimer);
        if (q.trim()) {
          _sugModalTimer = setTimeout(async function () {
            try {
              var tok = getAuthTokenF3();
              var r = await fetch('/api/products/search?limit=50&q=' + encodeURIComponent(q.trim()), {
                headers: tok ? { 'Authorization': 'Bearer ' + tok } : {},
                credentials: 'include'
              });
              if (r.ok) {
                var srv = await r.json();
                if (Array.isArray(srv) && srv.length) {
                  var base = _getSugCatalogExcludingActive();
                  var map = {};
                  var merged = [];
                  base.concat(srv).forEach(function (it) {
                    if (!it || !it.sku) return;
                    var k = _paStripAccUpper(it.sku);
                    if (!map[k]) {
                      map[k] = it;
                      merged.push(it);
                    }
                  });
                  renderPaSugModalTable(merged);
                }
              }
            } catch (e) {}
          }, 180);
        }
      });
    }

    // Manejador global en fase de captura para teclado (↑↓ Navegar, ESPACIO Marcar, ENTER Seleccionar, ESC Cerrar) en #pa-modal-sugeridos
    if (window.__paSugModalKeyHandler) {
      document.removeEventListener('keydown', window.__paSugModalKeyHandler, true);
    }
    window.__paSugModalKeyHandler = function (ev) {
      if (!paModalSug || paModalSug.style.display !== 'flex') return;

      if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') {
        if (!_sugModalFiltered.length) return;
        ev.preventDefault();
        ev.stopPropagation();
        _sugModalNavigated = true;
        var maxIdx = Math.min(79, _sugModalFiltered.length - 1);
        _sugModalActiveIdx = ev.key === 'ArrowDown'
          ? Math.min(maxIdx, _sugModalActiveIdx + 1)
          : Math.max(0, _sugModalActiveIdx - 1);
        renderPaSugModalTable();
        return;
      }

      if (ev.key === ' ' || ev.code === 'Space') {
        var inpFocused = (document.activeElement === paModalSugInp);
        var inpVal = paModalSugInp ? String(paModalSugInp.value || '') : '';
        var shouldToggleRow = !inpFocused || _sugModalNavigated || inpVal.trim() === '';
        if (shouldToggleRow) {
          ev.preventDefault();
          ev.stopPropagation();
          var activeItem = _sugModalFiltered[_sugModalActiveIdx];
          if (activeItem && activeItem.sku) {
            var activeSku = String(activeItem.sku).toUpperCase();
            _sugModalCheckedSkus[activeSku] = !_sugModalCheckedSkus[activeSku];
            updatePaSugModalSelectedCounter();
            renderPaSugModalTable();
          }
          return;
        }
      }

      if (ev.key === 'Enter') {
        ev.preventDefault();
        ev.stopPropagation();
        confirmPaSugModalSelection();
        return;
      }

      if (ev.key === 'Escape') {
        ev.preventDefault();
        ev.stopPropagation();
        closePaSugeridosModal();
      }
    };
    document.addEventListener('keydown', window.__paSugModalKeyHandler, true);

    if (paModalSugClr) {
      paModalSugClr.addEventListener('click', function () {
        if (paModalSugInp) {
          paModalSugInp.value = '';
          paModalSugInp.focus();
        }
        _sugModalNavigated = false;
        paModalSugClr.style.display = 'none';
        renderPaSugModalTable();
      });
    }
    if (paModalSugBtn) {
      paModalSugBtn.addEventListener('click', function () {
        _sugModalNavigated = true;
        renderPaSugModalTable();
      });
    }

    // Filtros reactivos del Kardex y Sucursal (Bloque 4)
    document.getElementById('pa-f3-filter-almacen')?.addEventListener('change', function () {
      renderStockF3Dom();
    });

    ['pa-f3-filter-tipo', 'pa-f3-filter-concepto', 'pa-f3-filter-search', 'pa-f3-date-from', 'pa-f3-date-to'].forEach(function (id) {
      var el = document.getElementById(id);
      if (el) {
        el.addEventListener('input', renderF3KardexTable);
        el.addEventListener('change', renderF3KardexTable);
      }
    });

    document.querySelectorAll('#pa-tab-panel-stock-f3 .f3-date-chip').forEach(function (chip) {
      chip.addEventListener('click', function () {
        document.querySelectorAll('#pa-tab-panel-stock-f3 .f3-date-chip').forEach(function (c) { c.classList.remove('active'); });
        chip.classList.add('active');
        f3ActiveDateRange = chip.getAttribute('data-date-range') || 'mes';
        var customWrap = document.getElementById('pa-f3-custom-dates-wrap');
        if (customWrap) {
          customWrap.style.display = (f3ActiveDateRange === 'custom') ? 'inline-flex' : 'none';
        }
        renderF3KardexTable();
      });
    });

    function activateProductAltaTab(tabEl) {
      if (!tabEl) return;
      var tabKey = tabEl.getAttribute('data-tab');
      // Pestaña "Precios (F2)" → abre la ventana flotante "Cambio de Precio" siempre iniciando en Precios de Matriz (Tienda #1)
      if (tabKey === 'precios') {
        if (typeof global.openModalCambioPrecio === 'function') {
          global.openModalCambioPrecio();
        } else {
          var modalPrecio = document.getElementById('modal-cambio-precio');
          if (modalPrecio) {
            modalPrecio.style.display = 'flex';
            if (typeof global.renderModalCambioPrecioScales === 'function') {
              global.renderModalCambioPrecioScales('escalas');
            }
          }
        }
        return;
      }
      // Pestaña "Imprimir Etiquetas (F6)" → genera etiqueta exclusiva del artículo activo en pantalla
      if (tabKey === 'etiqueta') {
        if (typeof global.printActiveProductLabelF6 === 'function') {
          global.printActiveProductLabelF6();
        }
        return;
      }

      tabs.forEach(function (t) { t.classList.remove('active'); });
      tabEl.classList.add('active');

      // Pestaña "Stock y Operaciones (F3)" → muestra el módulo de Kardex/Multialmacén conectado a datos reales del POS
      if (tabKey === 'inventario') {
        form.style.display = 'none';
        if (panelCatalogosF5) panelCatalogosF5.style.display = 'none';
        if (panelStockF3) {
          panelStockF3.style.display = 'block';
          syncAndRenderStockF3Panel({ forceFetch: true });
        }
        return;
      }

      // Pestaña "Catálogos (F5)" → muestra EXCLUSIVAMENTE Familias y Departamentos sin destruir #pa-product-form
      var panelGeneralLowerF1 = document.getElementById('pa-tab-general-f1-lower');
      var panelComplementosF4 = document.getElementById('pa-tab-complementos-f4');

      if (tabKey === 'catalogos') {
        form.style.display = 'none';
        if (panelStockF3) panelStockF3.style.display = 'none';
        if (panelCatalogosF5) {
          panelCatalogosF5.style.display = 'block';
          if (typeof global.renderProductAltaCatalogosPanel === 'function') {
            global.renderProductAltaCatalogosPanel('pa-catalogos-f5-mount');
          }
        }
      } else if (tabKey === 'complementos') {
        if (panelCatalogosF5) panelCatalogosF5.style.display = 'none';
        if (panelStockF3) panelStockF3.style.display = 'none';
        form.style.display = '';
        if (panelGeneralLowerF1) panelGeneralLowerF1.style.display = 'none';
        if (panelComplementosF4) {
          panelComplementosF4.style.display = 'flex';
          if (typeof global.refreshComplementsF4View === 'function') {
            global.refreshComplementsF4View();
          }
        }
      } else {
        if (panelCatalogosF5) panelCatalogosF5.style.display = 'none';
        if (panelStockF3) panelStockF3.style.display = 'none';
        form.style.display = '';
        if (panelComplementosF4) panelComplementosF4.style.display = 'none';
        if (panelGeneralLowerF1) panelGeneralLowerF1.style.display = 'flex';
      }
    }

    var btnF4BackF1 = document.getElementById('pa-f4-btn-back-f1');
    if (btnF4BackF1) {
      btnF4BackF1.addEventListener('click', function () {
        var tabF1 = document.querySelector('#pa-tabs-nav .pa-tab[data-tab="general"]');
        if (tabF1) activateProductAltaTab(tabF1);
      });
    }

    tabs.forEach(function (tab) {
      tab.addEventListener('click', function () {
        activateProductAltaTab(tab);
      });
    });

    if (btnBackGeneralF1) {
      btnBackGeneralF1.addEventListener('click', function () {
        var tabF1 = document.querySelector('#pa-tabs-nav .pa-tab[data-tab="general"]');
        if (tabF1) activateProductAltaTab(tabF1);
      });
    }
    if (btnF3BackF1) {
      btnF3BackF1.addEventListener('click', function () {
        var tabF1 = document.querySelector('#pa-tabs-nav .pa-tab[data-tab="general"]');
        if (tabF1) activateProductAltaTab(tabF1);
      });
    }

    // Cerrar la ventana flotante al hacer clic fuera de ella (revierte cambios no guardados)
    var modalPrecioBg = document.getElementById('modal-cambio-precio');
    if (modalPrecioBg) {
      modalPrecioBg.addEventListener('click', function (e) {
        if (e.target === modalPrecioBg) {
          if (typeof global.cancelAndCloseModalCambioPrecio === 'function') {
            global.cancelAndCloseModalCambioPrecio();
          } else {
            modalPrecioBg.style.display = 'none';
          }
        }
      });
    }

    // -- Accesos rapidos F1-F6 (izquierda a derecha: General, Precios, Stock y Operaciones, Complementos, Catalogos, Etiquetas) --
    if (window.__paTabKeysHandler) {
      document.removeEventListener('keydown', window.__paTabKeysHandler, true);
    }
    window.__paTabKeysHandler = function (e) {
      var nav = document.getElementById('pa-tabs-nav');
      if (!nav || nav.offsetParent === null) return;            // la pantalla de producto no está visible
      var priceModal = document.getElementById('modal-cambio-precio');
      var modalOpen = !!priceModal && priceModal.style.display === 'flex';
      var quickCatOpen = !!(quickModal && quickModal.style.display === 'flex');
      var satModalOpen = !!(satModal && satModal.style.display === 'flex');
      var satDdOpen = !!((satIdDropdown && satIdDropdown.style.display !== 'none') || (satUnDropdown && satUnDropdown.style.display !== 'none'));
      var f3OpModalEl  = document.getElementById('pa-f3-op-modal');
      var f3DocModalEl = document.getElementById('pa-f3-doc-modal');
      var f3OpOpen     = !!(f3OpModalEl && f3OpModalEl.style.display === 'flex');
      var f3DocOpen    = !!(f3DocModalEl && f3DocModalEl.style.display === 'flex');
      var f3ExpOpen    = !!(f3ExportMenu && f3ExportMenu.style.display === 'block');
      var activeTabEl = nav.querySelector('.pa-tab.active');
      var activeTabKey = activeTabEl ? activeTabEl.getAttribute('data-tab') : 'general';
      var inCatalogosF5 = (activeTabKey === 'catalogos') || !!(panelCatalogosF5 && panelCatalogosF5.style.display !== 'none');
      var inStockF3     = (activeTabKey === 'inventario') || !!(panelStockF3 && panelStockF3.style.display !== 'none');
      var inCompF4      = (activeTabKey === 'complementos');
      var f4DocPrevEl   = document.getElementById('pa-f4-doc-preview-modal');
      var f4DocPrevOpen = !!(f4DocPrevEl && f4DocPrevEl.style.display === 'flex');
      var sugModEl      = document.getElementById('pa-modal-sugeridos');
      var sugModOpen    = !!(sugModEl && sugModEl.style.display === 'flex');

      // ESC con la ventana de artículos multimodal de Venta Sugerida abierta
      if (e.key === 'Escape' && sugModOpen) {
        e.preventDefault();
        e.stopPropagation();
        sugModEl.style.display = 'none';
        return;
      }

      // ESC con el visor de documentos de Complementos [F4] abierto
      if (e.key === 'Escape' && f4DocPrevOpen) {
        e.preventDefault();
        e.stopPropagation();
        f4DocPrevEl.style.display = 'none';
        return;
      }

      // ESC dentro de Complementos [F4] regresa limpiamente a Información General [F1]
      if (e.key === 'Escape' && inCompF4 && !modalOpen && !quickCatOpen && !satModalOpen && !satDdOpen) {
        e.preventDefault();
        e.stopPropagation();
        var tabGen = nav.querySelector('.pa-tab[data-tab="general"]');
        if (tabGen) activateProductAltaTab(tabGen);
        return;
      }

      // ESC con sub-modales o menú de exportación de F3 abiertos
      if (e.key === 'Escape' && (f3OpOpen || f3DocOpen || f3ExpOpen)) {
        e.preventDefault();
        e.stopPropagation();
        if (f3OpOpen && f3OpModalEl)   f3OpModalEl.style.display = 'none';
        if (f3DocOpen && f3DocModalEl) f3DocModalEl.style.display = 'none';
        if (f3ExpOpen && f3ExportMenu) f3ExportMenu.style.display = 'none';
        return;
      }

      // ESC con el modal buscador SAT o dropdowns SAT abiertos
      if (e.key === 'Escape' && (satModalOpen || satDdOpen)) {
        e.preventDefault();
        e.stopPropagation();
        if (satModalOpen && satModal) satModal.style.display = 'none';
        closeSatDropdowns();
        return;
      }

      // ESC con el modal rápido de familia/departamento abierto
      if (e.key === 'Escape' && quickCatOpen) {
        e.preventDefault();
        e.stopPropagation();
        closeQuickCatModal();
        return;
      }

      // ESC con la ventana de precios abierta: cerrarla y revertir ediciones no guardadas (salvo que el selector F2 de sucursal esté abierto)
      if (e.key === 'Escape' && modalOpen) {
        var popEl = document.getElementById('cp-branch-selector-popover');
        if (popEl) return; // el selector de sucursales cierra primero con su propio manejador
        e.preventDefault();
        e.stopPropagation();
        if (typeof global.cancelAndCloseModalCambioPrecio === 'function') {
          global.cancelAndCloseModalCambioPrecio();
        } else {
          priceModal.style.display = 'none';
        }
        return;
      }

      // ESC dentro de Stock y Operaciones (F3) o Catálogos (F5): NO debe salir a Productos; se usa F1
      if (e.key === 'Escape' && (inCatalogosF5 || inStockF3)) {
        e.preventDefault();
        e.stopPropagation();
        if (e.target && e.target.classList && e.target.classList.contains('cfg-marca-edit-inp')) {
          if (typeof global.cfgCancelEditCatalogItem === 'function') {
            global.cfgCancelEditCatalogItem();
          }
          return;
        }
        _showMsg('Para regresar a Información General del Producto presiona F1', 'info');
        return;
      }

      if (e.ctrlKey || e.shiftKey || e.altKey || e.metaKey) return;   // Ctrl+F5 sigue recargando la página
      var m = /^F([1-6])$/.exec(e.key || '');
      if (!m) return;
      e.preventDefault();                                             // evita ayuda (F1) y recarga (F5) del navegador
      e.stopPropagation();

      var fnIdx = parseInt(m[1], 10);
      if (modalOpen && fnIdx <= 3) {
        // Dentro de la ventana flotante: F1 no es acceso directo; F2 Seleccionar Sucursal; F3 Ofertas Calendarizadas
        if (fnIdx === 1) return;
        if (fnIdx === 2 && typeof global.openModalBranchSelectorDropdown === 'function') {
          global.openModalBranchSelectorDropdown();
          return;
        }
        var btns = priceModal.querySelectorAll('.cp-top-btn');
        var b = btns[fnIdx - 1];
        if (b) b.click();
        return;
      }
      if (modalOpen) {
        if (typeof global.cancelAndCloseModalCambioPrecio === 'function') {
          global.cancelAndCloseModalCambioPrecio();
        } else {
          priceModal.style.display = 'none';
        }
      }
      var tab = nav.querySelector('.pa-tab[data-key="F' + m[1] + '"]');
      if (tab) activateProductAltaTab(tab);
    };
    document.addEventListener('keydown', window.__paTabKeysHandler, true);

    // ── 8. Tarjeta de Precio y Historial de Precios (Colapso y Eventos) ──
    var toggleHistBtn = document.getElementById('pa-btn-toggle-historial');
    var toggleHistHdr = document.getElementById('pa-historial-header-toggle');
    var histBody      = document.getElementById('pa-historial-body-content');
    var histChevron   = document.getElementById('pa-historial-chevron');

    function toggleHistorial(e) {
      if (e) e.preventDefault();
      if (!histBody) return;
      var isHidden = (histBody.style.display === 'none');
      histBody.style.display = isHidden ? 'block' : 'none';
      if (histChevron) {
        histChevron.className = isHidden ? 'fa-solid fa-chevron-up' : 'fa-solid fa-chevron-down';
      }
    }

    if (toggleHistBtn) {
      toggleHistBtn.addEventListener('click', toggleHistorial);
    }
    if (toggleHistHdr) {
      toggleHistHdr.addEventListener('click', function (e) {
        if (e.target !== toggleHistBtn && !toggleHistBtn.contains(e.target)) {
          toggleHistorial(e);
        }
      });
    }

    // ── 8b. Limpiar clase de error (.pa-input-error) en campos obligatorios al teclear o cambiar ──
    var REQUIRED_ASTERISK_IDS = ['pa-sku', 'pa-codigo', 'pa-familia', 'pa-departamento', 'pa-sat-id', 'pa-sat-unidad', 'pa-descripcion'];
    REQUIRED_ASTERISK_IDS.forEach(function (id) {
      var inp = document.getElementById(id);
      if (inp) {
        inp.addEventListener('input', function () {
          if ((inp.value || '').trim()) {
            inp.classList.remove('pa-input-error');
          }
        });
        inp.addEventListener('change', function () {
          if ((inp.value || '').trim()) {
            inp.classList.remove('pa-input-error');
          }
        });
      }
    });

    // ── 9. Navegación fluida con ENTER y FLECHAS entre casillas hasta guardar y limpiar ──
    // Omite los cuadros de verificación del menú lateral derecho y checkboxes auxiliares
    var ENTER_SEQUENCE_IDS = [
      'pa-sku',
      'pa-codigo',
      'pa-codigo-alt',
      'pa-familia',
      'pa-departamento',
      'pa-sat-id',
      'pa-sat-unidad',
      'pa-descripcion',
      'pa-marca',
      'pa-pres-compra',
      'pa-paquete',
      'pa-paquete-qty',
      'pa-unidad-medida',
      'pa-costo',
      'pa-flete-pct',
      'pa-margen',
      'pa-sobreprecio-pct',
      'pa-sobreprecio-monto',
      'pa-precio-display',
      'pa-precio-caja-display',
      'pa-precio-pieza-display',
      'pa-stock-min',
      'pa-stock-actual',
      'pa-stock-almacen',
      'pa-stock-max',
      'pa-stock-transito',
      'pa-ieps',
      'pa-iva',
      'pa-garantia',
      'pa-puntos',
      'pa-observaciones'
    ];

    function focusFieldInFormSequence(fromIdx, stepDir) {
      var len = ENTER_SEQUENCE_IDS.length;
      if (!len) return false;
      for (var step = 1; step <= len; step++) {
        var nextIdx = (fromIdx + stepDir * step + len) % len;
        var nextEl = document.getElementById(ENTER_SEQUENCE_IDS[nextIdx]);
        if (nextEl && !nextEl.disabled && !nextEl.readOnly && nextEl.offsetParent !== null) {
          nextEl.focus();
          if (typeof nextEl.select === 'function' && nextEl.tagName !== 'SELECT') {
            setTimeout(function () {
              try { nextEl.select(); } catch (e) {}
            }, 0);
          }
          return true;
        }
      }
      return false;
    }

    form.addEventListener('keydown', function (e) {
      var pmOpen = document.getElementById('modal-cambio-precio');
      if (pmOpen && pmOpen.style.display === 'flex') return;
      var target = e.target;
      if (!target) return;
      if (target.tagName === 'BUTTON') return;

      // Si el dropdown SAT inline está abierto y el foco está en pa-sat-id o pa-sat-unidad, dejar que su manejador use las flechas
      if ((target.id === 'pa-sat-id' && satIdDropdown && satIdDropdown.style.display !== 'none') ||
          (target.id === 'pa-sat-unidad' && satUnDropdown && satUnDropdown.style.display !== 'none')) {
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') return;
      }

      var idx = ENTER_SEQUENCE_IDS.indexOf(target.id);

      // Navegación con flechas (↑ ↓ ← →) entre campos de la ventana
      if (idx !== -1 && !e.ctrlKey && !e.altKey && !e.metaKey &&
          (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'ArrowRight' || e.key === 'ArrowLeft')) {
        var tag = target.tagName;
        var inpType = (target.type || '').toLowerCase();
        var isNumberInp = (tag === 'INPUT' && inpType === 'number');
        var isSelectEl = (tag === 'SELECT');

        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
          // En SELECT nativo dejamos que ArrowUp/ArrowDown cambie la opción salvo que sea INPUT/TEXTAREA
          if (!isSelectEl) {
            e.preventDefault();
            e.stopPropagation();
            focusFieldInFormSequence(idx, e.key === 'ArrowDown' ? 1 : -1);
            return;
          }
        } else if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
          var canMoveHoriz = isNumberInp || isSelectEl;
          if (!canMoveHoriz && (tag === 'INPUT' || tag === 'TEXTAREA')) {
            try {
              var valLen = (target.value || '').length;
              var selStart = target.selectionStart;
              var selEnd = target.selectionEnd;
              var allSelected = (selStart === 0 && selEnd === valLen && valLen > 0);
              if (allSelected || valLen === 0) {
                canMoveHoriz = true;
              } else if (e.key === 'ArrowRight' && selStart === valLen && selEnd === valLen) {
                canMoveHoriz = true;
              } else if (e.key === 'ArrowLeft' && selStart === 0 && selEnd === 0) {
                canMoveHoriz = true;
              }
            } catch (err) {
              canMoveHoriz = true;
            }
          }
          if (canMoveHoriz) {
            e.preventDefault();
            e.stopPropagation();
            focusFieldInFormSequence(idx, e.key === 'ArrowRight' ? 1 : -1);
            return;
          }
        }
      }

      if (e.key === 'Enter') {
        // Si el usuario presiona Enter o escanea código de barras en SKU, Código o Código Alterno, verificar duplicado al instante
        if (target.id === 'pa-sku' || target.id === 'pa-codigo' || target.id === 'pa-codigo-alt') {
          var lblMap = { 'pa-sku': 'SKU', 'pa-codigo': 'CÓDIGO DE BARRAS', 'pa-codigo-alt': 'CÓDIGO ALTERNO' };
          verifyAndLoadDuplicateCode(target, lblMap[target.id] || 'CÓDIGO', true);
        }

        // Si el usuario presiona Enter en el T.C. editable, saltar a Flete
        if (target.id === 'pa-tc-rate') {
          e.preventDefault();
          var fl = document.getElementById('pa-flete-pct');
          if (fl) { fl.focus(); if (typeof fl.select === 'function') fl.select(); }
          return;
        }

        if (idx !== -1) {
          // Si está en el último elemento (Observaciones) y presiona Enter sin Shift: guardar y limpiar
          if (idx === ENTER_SEQUENCE_IDS.length - 1) {
            if (!e.shiftKey) {
              e.preventDefault();
              e.stopPropagation();
              if (typeof global.saveProductFromPage === 'function') {
                global.saveProductFromPage({ resetAndStay: true });
              }
              return;
            }
          } else {
            // Avanzar a la siguiente casilla válida
            e.preventDefault();
            e.stopPropagation();
            for (var i = idx + 1; i < ENTER_SEQUENCE_IDS.length; i++) {
              var nextEl = document.getElementById(ENTER_SEQUENCE_IDS[i]);
              if (nextEl && !nextEl.disabled && !nextEl.readOnly && nextEl.offsetParent !== null) {
                nextEl.focus();
                if (typeof nextEl.select === 'function' && nextEl.tagName !== 'SELECT') {
                  nextEl.select();
                }
                return;
              }
            }
            // Si ya no hay más casillas disponibles, guardar y limpiar
            if (typeof global.saveProductFromPage === 'function') {
              global.saveProductFromPage({ resetAndStay: true });
            }
          }
        }
      }
    }, true);

    // Guardar referencia para recalcular precio desde afuera
    global.recalcularPrecioProductAlta = recalcularPrecio;

    if (typeof global.initComplementsF4Controller === 'function') {
      global.initComplementsF4Controller();
    }

    // Cargar producto real seleccionado desde #productos o pre-cargar lista real de productos del POS
    var editSku = '';
    var editTab = '';
    try {
      editSku = sessionStorage.getItem('calebsys_edit_product_sku') || '';
      editTab = sessionStorage.getItem('calebsys_edit_product_tab') || '';
      if (editSku) {
        sessionStorage.removeItem('calebsys_edit_product_sku');
        sessionStorage.removeItem('calebsys_edit_product_tab');
      }
    } catch (e) {}

    // SEPARACIÓN EDITAR [ENTER] vs NUEVO [INS]:
    // `Editar [ENTER]` deja una solicitud de un solo uso (_paEditRequest) con el producto seleccionado en #productos.
    // `Nuevo [INS]` NO deja solicitud alguna -> modo Alta limpia.
    var paEditReq = global._paEditRequest || null;
    var paEditLocalProd = (paEditReq && global._productoAltaEdit && global._productoAltaEdit.sku) ? global._productoAltaEdit : null;
    global._paEditRequest = null; // un solo uso: evita que una apertura posterior herede el modo edición
    if (!editSku && paEditReq && paEditReq.sku) {
      editSku = String(paEditReq.sku);
    }
    var paIsEditMode = Boolean(editSku);
    global._isEditingExistingProduct = paIsEditMode;

    // Precargar siempre el catálogo completo con códigos de barras para el detector de duplicados
    ensureProductsCatalogLoadedForDuplicateCheck(true);

    if (paIsEditMode) {
      // MODO EDICIÓN: jamás se ejecuta limpiarFormularioAlta() sobre el producto cargado.
      // #producto-alta ya está visible en el DOM aquí; se inyectan los datos de F1..F6 del artículo seleccionado.
      var paApplyLocalEditFallback = function () {
        var skuNowEl = document.getElementById('pa-sku');
        if (skuNowEl && !String(skuNowEl.value || '').trim() && paEditLocalProd && typeof loadRealProductIntoForm === 'function') {
          // El servidor no devolvió el expediente: cargar el mismo artículo seleccionado desde el catálogo en memoria
          loadRealProductIntoForm(paEditLocalProd);
        }
      };
      fetchRealProductF3FromServer(editSku, { populateForm: true, force: true }).then(function () {
        paApplyLocalEditFallback();
        if (editTab === 'inventario') {
          var tabF3 = document.querySelector('#pa-tabs-nav .pa-tab[data-tab="inventario"]');
          if (tabF3) activateProductAltaTab(tabF3);
        }
      }).catch(function () {
        paApplyLocalEditFallback();
      });
    } else {
      // MODO NUEVO REGISTRO (INS): expediente limpio en F1..F6
      global._paLoadedExistingProduct = null;
      if (typeof global.limpiarFormularioAlta === 'function') {
        global.limpiarFormularioAlta({ noScroll: true, fromOpen: true });
      }
      // Precargar el catálogo real del POS para el selector de Stock y Operaciones [F3] sin alterar F1 si es un alta nueva
      fetchRealProductF3FromServer('', { populateForm: false, force: true });
      // ALTA AVANZADA desde Recepción de Mercancía: precargar lo leído del XML del proveedor (códigos, nombre, SAT, costo y margen)
      var rhPf = global._rhAltaPrefill;
      if (rhPf) {
        global._rhAltaPrefill = null;
        try {
          var rhSet = function (id, v) { var e = document.getElementById(id); if (e && v != null && v !== '') e.value = String(v); };
          var rhDesc = document.getElementById('pa-descripcion');
          rhSet('pa-descripcion', rhPf.name);
          if (rhDesc) rhDesc.dispatchEvent(new Event('input', { bubbles: true }));
          rhSet('pa-sku', rhPf.sku); rhSet('pa-codigo', rhPf.barcode); rhSet('pa-codigo-alt', rhPf.sales_code);
          var rhCod = document.getElementById('pa-codigo'); if (rhCod) rhCod.dataset.userEdited = '1';
          rhSet('pa-sat-id', rhPf.sat_id); rhSet('pa-sat-unidad', rhPf.sat_unidad);
          if (rhPf.unidad) {
            setSelectOptionUpper(document.getElementById('pa-pres-compra'), rhPf.unidad);
            setSelectOptionUpper(document.getElementById('pa-unidad-medida'), rhPf.unidad);
          }
          rhSet('pa-costo', rhPf.costo != null ? Number(rhPf.costo).toFixed(2) : ''); rhSet('pa-flete-pct', rhPf.flete_pct); rhSet('pa-margen', rhPf.margen);
          if (typeof global.updateSatBadgesProductAlta === 'function') global.updateSatBadgesProductAlta();
          if (typeof global.recalcularPrecioProductAlta === 'function') global.recalcularPrecioProductAlta();
          if (rhPf.supplier_code && typeof _f4State !== 'undefined' && _f4State && Array.isArray(_f4State.suppliers)) {
            _f4State.suppliers.push({
              provider_name: String(rhPf.supplier_name || '').toUpperCase(), name: String(rhPf.supplier_name || '').toUpperCase(),
              rfc: String(rhPf.supplier_rfc || '').toUpperCase(), xml_sku: String(rhPf.supplier_code).toUpperCase(),
              cost: Number(rhPf.xml_cost) || 0, last_cost: Number(rhPf.xml_cost) || 0, currency: 'MXN', lead_days: 1, min_qty: 1, factor: 1, is_primary: true
            });
            if (typeof renderF4SuppliersTable === 'function') renderF4SuppliersTable();
          }
          _showMsg('Alta avanzada desde Recepción de Mercancía: completa el producto y presiona Guardar [F12] para regresar al Paso 2.', 'info');
        } catch (rhErr) { console.warn('[Recepción→Alta] precarga parcial:', rhErr); }
      }
    }

    // Foco inicial en SKU
    setTimeout(function () {
      if (skuEl && (!panelStockF3 || panelStockF3.style.display === 'none')) {
        skuEl.focus();
        if (typeof skuEl.select === 'function') skuEl.select();
      }
    }, 150);
  };

  // ── 10. Limpiar formulario para nuevo registro (REGLA DE HIERRO #1: Expediente 100% Limpio en F1..F6) ──
  global.limpiarFormularioAlta = function (opts) {
    opts = opts || {};
    var form = document.getElementById('pa-product-form');
    if (!form) return;

    // Blindaje: la apertura de la vista en Modo Edición (Editar [ENTER]) nunca debe limpiar el producto cargado
    if (opts.fromOpen && global._isEditingExistingProduct === true) return;

    // Limpiar = Modo Nuevo Registro
    global._isEditingExistingProduct = false;

    // Reiniciar punteros de producto activo en memoria para evitar contaminar con el artículo anterior
    global._paLoadedExistingProduct = null;
    if (typeof f3LiveRecordCache !== 'undefined' && f3LiveRecordCache) {
      f3LiveRecordCache = {
        found: false,
        product: null,
        sku: '',
        costoPromedio: 0,
        warehouses: Array.isArray(f3LiveRecordCache.warehouses)
          ? f3LiveRecordCache.warehouses.map(function (w) {
              return { key: w.key, nombre: w.nombre, min: 10, max: 100, fisico: 0 };
            })
          : [{ key: 'MATRIZ', nombre: 'MATRIZ (Maderas y Materiales Magdaleno)', min: 10, max: 100, fisico: 0 }],
        kardex: []
      };
    }

    // Limpiar buscador rápido del header si tenía texto de otro producto
    var hdrSearchInp = document.getElementById('pa-header-search-input');
    var hdrSearchClr = document.getElementById('pa-header-search-clear');
    var hdrSearchDd  = document.getElementById('pa-header-search-dropdown');
    if (hdrSearchInp) hdrSearchInp.value = '';
    if (hdrSearchClr) hdrSearchClr.style.display = 'none';
    if (hdrSearchDd)  hdrSearchDd.style.display = 'none';

    // 1. Textos e identificadores principales y ocultar banner de duplicado
    if (typeof global.hideDuplicateProductBanner === 'function') {
      global.hideDuplicateProductBanner();
    }
    var skuEl = document.getElementById('pa-sku');
    var codEl = document.getElementById('pa-codigo');
    var codAltEl = document.getElementById('pa-codigo-alt');
    var descEl = document.getElementById('pa-descripcion');
    if (skuEl) skuEl.value = '';
    if (codEl) { codEl.value = ''; delete codEl.dataset.userEdited; }
    if (codAltEl) codAltEl.value = '';
    if (descEl) descEl.value = '';

    // 2. Selects y Claves SAT
    var famEl = document.getElementById('pa-familia');
    var depEl = document.getElementById('pa-departamento');
    var satIdEl = document.getElementById('pa-sat-id');
    var satUnEl = document.getElementById('pa-sat-unidad');
    var satEmpEl = document.getElementById('pa-sat-unidad-empaque');
    var marcaEl = document.getElementById('pa-marca');
    if (famEl) famEl.selectedIndex = 0;
    if (depEl) depEl.selectedIndex = 0;
    if (marcaEl) marcaEl.value = 'GENÉRICO';
    if (satIdEl) satIdEl.value = '';
    if (satUnEl) satUnEl.value = 'H87';
    if (satEmpEl) satEmpEl.value = 'H87';
    if (typeof global.updateSatBadgesProductAlta === 'function') {
      global.updateSatBadgesProductAlta();
    }

    // 3. Unidades y empaque
    var presEl = document.getElementById('pa-pres-compra');
    var paqEl = document.getElementById('pa-paquete');
    var paqQtyEl = document.getElementById('pa-paquete-qty');
    var umEl = document.getElementById('pa-unidad-medida');
    if (presEl) presEl.value = 'PIEZA';
    if (paqEl) paqEl.value = '--';
    if (paqQtyEl) paqQtyEl.value = '1';
    if (umEl) umEl.value = 'PIEZA';

    // 4. Precios, Costo, Flete, Margen y Sobreprecio (todos en 0.00 por defecto)
    var costoEl = document.getElementById('pa-costo');
    var fleteEl = document.getElementById('pa-flete-pct');
    var costoOtroEl = document.getElementById('pa-costo-otro');
    var margenEl = document.getElementById('pa-margen');
    var sobrePctEl = document.getElementById('pa-sobreprecio-pct');
    var sobreMontoEl = document.getElementById('pa-sobreprecio-monto');
    var usdChkEl = document.getElementById('pa-is-usd');
    if (usdChkEl) usdChkEl.checked = false;
    if (costoEl) costoEl.value = '0.00';
    if (fleteEl) fleteEl.value = '0.00';
    if (costoOtroEl) costoOtroEl.value = '0.00';
    if (margenEl) margenEl.value = '0.00';
    if (sobrePctEl) sobrePctEl.value = '0.00';
    if (sobreMontoEl) sobreMontoEl.value = '0.00';

    // 5. Inventario (todos en 0 por defecto)
    ['pa-stock-min', 'pa-stock-actual', 'pa-stock-almacen', 'pa-stock-max', 'pa-stock-transito'].forEach(function (id) {
      var el = document.getElementById(id);
      if (el) el.value = '0';
    });

    // 6. Diversos
    var iepsEl = document.getElementById('pa-ieps');
    var ivaEl = document.getElementById('pa-iva');
    var garEl = document.getElementById('pa-garantia');
    var ptsEl = document.getElementById('pa-puntos');
    if (iepsEl) iepsEl.value = '0.00';
    if (ivaEl) ivaEl.value = '16.00';
    if (garEl) garEl.value = '0';
    if (ptsEl) ptsEl.value = '0.00';

    // 6b. Reiniciar Atributos y Configuración, Enviar a Impresor y Venta Sugerida
    var setChkClean = function (id, val) {
      var c = document.getElementById(id);
      if (c) c.checked = !!val;
    };
    setChkClean('pa-is-active', true);
    var statusTxtClean = document.getElementById('pa-status-text');
    if (statusTxtClean) {
      statusTxtClean.textContent = 'Activo';
      statusTxtClean.style.color = '#16a34a';
    }
    ['pa-art-pesado', 'pa-precio-abierto', 'pa-art-negativo', 'pa-desact-venta', 'pa-desact-compras', 'pa-desact-traspasos',
     'pa-kardex-auditoria', 'pa-kardex-servicio', 'pa-kardex-no-desc', 'pa-kardex-no-ofertas-cal', 'pa-kardex-no-ofertas-depto',
     'pa-kardex-corte-z', 'pa-kardex-no-variantes', 'pa-kardex-base-prod', 'pa-kardex-recarga-celular', 'pa-kardex-antibiotico',
     'pa-kardex-exento-iva', 'pa-kardex-desc-abierta', 'pa-kardex-prod-controlado', 'pa-kardex-autorizacion',
     'pa-kardex-no-inventariable', 'pa-kardex-recetas-paquetes',
     'pa-print-1', 'pa-print-2', 'pa-print-3', 'pa-print-4', 'pa-print-5', 'pa-print-6'].forEach(function (id) {
      setChkClean(id, false);
    });
    setChkClean('pa-kardex-ofertas-cruzadas', true);
    setChkClean('pa-kardex-existencia-neg', true);

    global._paSuggestedProducts = [];
    var sugSearchInpClean = document.getElementById('pa-sugerido-search-input');
    var sugSearchClrClean = document.getElementById('pa-sugerido-search-clear');
    var sugSearchDdClean  = document.getElementById('pa-sugerido-search-dropdown');
    if (sugSearchInpClean) sugSearchInpClean.value = '';
    if (sugSearchClrClean) sugSearchClrClean.style.display = 'none';
    if (sugSearchDdClean)  sugSearchDdClean.style.display = 'none';
    if (typeof global.renderPaSuggestedProductsTable === 'function') {
      global.renderPaSuggestedProductsTable();
    } else {
      var sugTbody = document.getElementById('pa-sugeridos-tbody');
      if (sugTbody) {
        sugTbody.innerHTML = '<tr><td colspan="5" class="pa-td-empty"><i class="fa-solid fa-box-archive"></i> No hay productos sugeridos</td></tr>';
      }
    }

    // 6c. Reiniciar Historial de Precios a estado limpio para el nuevo artículo
    var statPrecioClean = document.getElementById('pa-hist-precio-activo');
    var statFechaClean = document.getElementById('pa-hist-fecha-act');
    var histTbodyClean = document.getElementById('pa-price-history-tbody');
    if (statPrecioClean) statPrecioClean.textContent = '$0.00';
    if (statFechaClean) statFechaClean.textContent = 'Sin registro';
    if (histTbodyClean) {
      histTbodyClean.innerHTML = '<tr data-empty-history="1"><td colspan="3" style="text-align:center;color:#64748b;font-size:11px;padding:12px;">Sin historial de precios registrado para este artículo</td></tr>';
    }

    // 7. Observaciones
    var obsEl = document.getElementById('pa-observaciones');
    var obsCounter = document.getElementById('pa-obs-counter');
    if (obsEl) obsEl.value = '';
    if (obsCounter) obsCounter.textContent = '0/500';

    // 8. Foto
    var photoImg = document.getElementById('pa-photo-img');
    var photoPlaceholder = document.getElementById('pa-photo-placeholder');
    var photoFileInput = document.getElementById('pa-photo-file-input');
    if (photoImg) {
      photoImg.removeAttribute('data-valid-photo');
      photoImg.removeAttribute('src');
      photoImg.classList.add('pa-hidden');
    }
    if (photoPlaceholder) photoPlaceholder.classList.remove('pa-hidden');
    if (photoFileInput) photoFileInput.value = '';

    // 9. Recalcular precio y reiniciar escalas del producto a $0.00
    if (typeof global.resetProductPriceScalesForNewForm === 'function') {
      global.resetProductPriceScalesForNewForm();
    }
    if (typeof global.recalcularPrecioProductAlta === 'function') {
      global.recalcularPrecioProductAlta('init');
    }

    // 10. Limpiar advertencias/errores visuales en campos obligatorios
    ['pa-sku', 'pa-codigo', 'pa-familia', 'pa-departamento', 'pa-sat-id', 'pa-sat-unidad', 'pa-descripcion'].forEach(function (id) {
      var el = document.getElementById(id);
      if (el) el.classList.remove('pa-input-error');
    });

    if (typeof global.resetComplementsF4ForNewForm === 'function') {
      global.resetComplementsF4ForNewForm();
    }

    // 11. Posicionar foco en el primer campo (SKU)
    if (skuEl && !opts.noScroll) {
      skuEl.focus();
      if (typeof skuEl.select === 'function') skuEl.select();
    }

    // Scroll arriba suave
    if (!opts.noScroll) {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  };

  // ── 11. Cancelar y volver al catálogo ──
  global.cancelProductFromPage = function () {
    // Alta avanzada lanzada desde Recepción de Mercancía: al cancelar se regresa al asistente (mismo paso)
    if (global._rhWizardReturn) {
      if (typeof global.navigateTo === 'function') global.navigateTo('compras-recepciones'); else window.location.hash = '#compras-recepciones';
      return;
    }
    if (typeof global.navigateTo === 'function') {
      global.navigateTo('productos');
    } else {
      window.location.hash = '#productos';
    }
  };

  // ── Helpers para Historial de Precios y Auditoría ──
  function formatDateTimeNow() {
    var d = new Date();
    var pad = function (n) { return (n < 10 ? '0' : '') + n; };
    return pad(d.getDate()) + '/' + pad(d.getMonth() + 1) + '/' + d.getFullYear() + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
  }

  function getCurrentUser() {
    var sidebarName = document.getElementById('sidebar-user-name');
    var footUser = document.getElementById('pa-foot-user');
    var user = (sidebarName && sidebarName.textContent.trim()) || (footUser && footUser.textContent.trim()) || 'ANTONIO M.';
    if (user.toUpperCase() === 'ADMINISTRADOR') user = 'ANTONIO M.';
    return user.toUpperCase();
  }

  function addPriceHistoryRow(priceFormatted, user, dateStr) {
    var tbody = document.getElementById('pa-price-history-tbody');
    if (!tbody) return;
    var emptyRow = tbody.querySelector('[data-empty-history="1"]');
    if (emptyRow) emptyRow.remove();
    dateStr = dateStr || formatDateTimeNow();
    user = (user || getCurrentUser()).toUpperCase();

    var tr = document.createElement('tr');
    tr.innerHTML = '<td><i class="fa-regular fa-clock"></i> ' + dateStr + '</td>' +
                   '<td class="pa-td-price">' + priceFormatted + '</td>' +
                   '<td class="pa-td-user">' + user + '</td>';
    tbody.insertBefore(tr, tbody.firstChild);

    var statPrecio = document.getElementById('pa-hist-precio-activo');
    var statFecha = document.getElementById('pa-hist-fecha-act');
    if (statPrecio) statPrecio.textContent = priceFormatted;
    if (statFecha) statFecha.textContent = dateStr;
  }

  function getPriceHistoryArray() {
    var historyItems = [];
    var tbody = document.getElementById('pa-price-history-tbody');
    if (tbody) {
      var rows = tbody.querySelectorAll('tr');
      rows.forEach(function (r) {
        if (r.getAttribute('data-empty-history') === '1') return;
        var tds = r.querySelectorAll('td');
        if (tds.length >= 3) {
          historyItems.push({
            fecha: tds[0].textContent.trim(),
            precio: tds[1].textContent.trim(),
            usuario: tds[2].textContent.trim()
          });
        }
      });
    }
    return historyItems;
  }

  // ── 12. Guardar Producto (F12, Clic o Enter final) ──
  global.saveProductFromPage = async function (options) {
    options = options || {};

    // ── 12a. Validación estricta de TODOS los campos obligatorios con asterisco rojo (*) ──
    var REQUIRED_FIELDS = [
      { id: 'pa-sku', label: 'SKU' },
      { id: 'pa-codigo', label: 'Código' },
      { id: 'pa-familia', label: 'Familia' },
      { id: 'pa-departamento', label: 'Departamento' },
      { id: 'pa-sat-id', label: 'SAT ID' },
      { id: 'pa-sat-unidad', label: 'SAT UNIDAD' },
      { id: 'pa-descripcion', label: 'Descripción' }
    ];

    var firstMissing = null;
    var missingCount = 0;

    REQUIRED_FIELDS.forEach(function (req) {
      var el = document.getElementById(req.id);
      if (!el) return;
      var val = (el.value || '').trim();
      if (!val) {
        el.classList.add('pa-input-error');
        missingCount++;
        if (!firstMissing) firstMissing = { el: el, label: req.label };
      } else {
        el.classList.remove('pa-input-error');
      }
    });

    if (firstMissing) {
      _showMsg('El campo ' + firstMissing.label + ' es obligatorio (*). Completa todos los campos con asterisco rojo para guardar.', 'warning');
      firstMissing.el.focus();
      if (typeof firstMissing.el.select === 'function') firstMissing.el.select();
      return;
    }

    var skuEl       = document.getElementById('pa-sku');
    var descEl      = document.getElementById('pa-descripcion');
    var sku         = (skuEl ? skuEl.value : '').trim().toUpperCase();
    var codigo      = (document.getElementById('pa-codigo')?.value || sku).trim().toUpperCase();
    var codigoAlt   = (document.getElementById('pa-codigo-alt')?.value || '').trim().toUpperCase();
    var descripcion = (descEl ? descEl.value : '').trim().toUpperCase();
    var precio      = parseFloat(document.getElementById('pa-precio-final')?.value || '0') || 0;
    var precioCaja  = parseFloat(document.getElementById('pa-precio-caja-final')?.value || '0') || precio;
    var precioPieza = parseFloat(document.getElementById('pa-precio-pieza-final')?.value || '0') || precio;

    // ── 12b. Bloqueo de Códigos Duplicados (SKU, Código de Barras o Código Alterno) ──
    if (typeof global.findMatchingProductByAnyCode === 'function') {
      var dupBarcodeHit = codigo ? global.findMatchingProductByAnyCode(codigo) : null;
      if (dupBarcodeHit && dupBarcodeHit.product && String(dupBarcodeHit.product.sku || '').toUpperCase() !== sku) {
        await global.fetchRealProductF3FromServer(dupBarcodeHit.product.sku, {
          populateForm: true,
          force: true,
          dupContext: { fieldLabel: 'CÓDIGO DE BARRAS', matchedBy: dupBarcodeHit.matchedBy, typedValue: codigo }
        });
        return;
      }
      var dupAltHit = codigoAlt ? global.findMatchingProductByAnyCode(codigoAlt) : null;
      if (dupAltHit && dupAltHit.product && String(dupAltHit.product.sku || '').toUpperCase() !== sku) {
        await global.fetchRealProductF3FromServer(dupAltHit.product.sku, {
          populateForm: true,
          force: true,
          dupContext: { fieldLabel: 'CÓDIGO ALTERNO', matchedBy: dupAltHit.matchedBy, typedValue: codigoAlt }
        });
        return;
      }
    }

    var saveBtn = document.getElementById('pa-btn-save');
    var originalBtnHtml = saveBtn ? saveBtn.innerHTML : '';
    if (saveBtn) {
      saveBtn.disabled = true;
      saveBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Guardando...';
    }

    var isUsd             = !!document.getElementById('pa-is-usd')?.checked;
    var tc                = parseFloat(document.getElementById('pa-tc-rate')?.value || '17.50') || 17.50;
    var costoRaw          = parseFloat(document.getElementById('pa-costo')?.value || '0') || 0;
    var fletePct          = parseFloat(document.getElementById('pa-flete-pct')?.value || document.getElementById('pa-costo-otro')?.value || '0') || 0;
    var costoBasePesos    = isUsd ? (costoRaw * tc) : costoRaw;
    var montoFlete        = costoBasePesos * (fletePct / 100);
    var costoConFlete     = costoBasePesos + montoFlete;
    var cantPiezas        = Math.max(1, parseFloat(document.getElementById('pa-paquete-qty')?.value || '1') || 1);
    var costoPieza        = cantPiezas > 0 ? (costoBasePesos / cantPiezas) : costoBasePesos;
    var costoPiezaFlete   = cantPiezas > 0 ? (costoConFlete / cantPiezas) : costoConFlete;
    var margenBase        = parseFloat(document.getElementById('pa-margen')?.value || '0') || 0;
    var sobreprecioPct    = parseFloat(document.getElementById('pa-sobreprecio-pct')?.value || '0') || 0;
    var sobreprecioMonto  = parseFloat(document.getElementById('pa-sobreprecio-monto')?.value || '0') || 0;
    var margenFinalPieza  = parseFloat(document.getElementById('pa-margen-final-pieza')?.value || String(margenBase)) || margenBase;

    if (typeof global.recalculateAllProductScalesFromCost === 'function') {
      global.recalculateAllProductScalesFromCost({ triggerSource: 'base', skipModalRender: true });
    }
    var exentoIvaChk = !!document.getElementById('pa-kardex-exento-iva')?.checked;
    var ivaValCheck = exentoIvaChk ? 0 : (parseFloat(document.getElementById('pa-iva')?.value || '16') || 16);
    var iepsValCheck = parseFloat(document.getElementById('pa-ieps')?.value || '0') || 0;
    var costoUnitCheck = cantPiezas > 1 ? costoPiezaFlete : costoConFlete;
    var costoPisoStrict = Number((costoUnitCheck * (1 + ivaValCheck / 100) * (1 + iepsValCheck / 100)).toFixed(2));
    if (costoPisoStrict > 0 && precio > 0 && precio < costoPisoStrict - 0.005) {
      _showMsg('🛑 BLOQUEO DE SEGURIDAD: No se permite guardar un precio ($' + precio.toFixed(2) + ') menor al Precio de Costo con Flete + IVA ($' + costoPisoStrict.toFixed(2) + ')', 'danger');
      if (saveBtn) {
        saveBtn.disabled = false;
        saveBtn.innerHTML = originalBtnHtml;
      }
      return;
    }
    margenBase       = parseFloat(document.getElementById('pa-margen')?.value || String(margenBase)) || margenBase;
    margenFinalPieza = parseFloat(document.getElementById('pa-margen-final-pieza')?.value || String(margenBase)) || margenBase;
    precio           = parseFloat(document.getElementById('pa-precio-final')?.value || String(precio)) || precio;
    precioCaja       = parseFloat(document.getElementById('pa-precio-caja-final')?.value || String(precio)) || precio;
    precioPieza      = parseFloat(document.getElementById('pa-precio-pieza-final')?.value || String(precio)) || precio;
    if (precio <= 0 && Array.isArray(global._paProductPriceScales) && global._paProductPriceScales.length > 0) {
      var firstScPrice = parseFloat(global._paProductPriceScales[0].precio || 0) || 0;
      if (firstScPrice > 0) {
        precio = firstScPrice;
        if (precioPieza <= 0) precioPieza = firstScPrice;
        if (precioCaja <= 0) precioCaja = firstScPrice * cantPiezas;
      }
    }

    var satUnBase = (document.getElementById('pa-sat-unidad')?.value || 'H87').trim().toUpperCase();
    var satUnEmpaque = (document.getElementById('pa-sat-unidad-empaque')?.value || satUnBase).trim().toUpperCase();

    var rawStockActual  = parseFloat(document.getElementById('pa-stock-actual')?.value || '0') || 0;
    var rawStockAlmacen = parseFloat(document.getElementById('pa-stock-almacen')?.value || '0') || 0;
    var effectiveStock  = rawStockActual > 0 ? rawStockActual : rawStockAlmacen;

    var photoEl = document.getElementById('pa-photo-img');
    var rawPhotoAttr = photoEl ? (photoEl.getAttribute('data-valid-photo') || photoEl.getAttribute('src') || '').trim() : '';
    var validPhotoUrl = null;
    if (photoEl && !photoEl.classList.contains('pa-hidden') && rawPhotoAttr && (rawPhotoAttr.indexOf('data:image/') === 0 || rawPhotoAttr.indexOf('/admin') === -1)) {
      validPhotoUrl = rawPhotoAttr;
    } else if (global._paLoadedExistingProduct && String(global._paLoadedExistingProduct.sku || '').toUpperCase() === sku) {
      var prevFoto = global._paLoadedExistingProduct.foto_url || (global._paLoadedExistingProduct.meta_data && global._paLoadedExistingProduct.meta_data.foto_url) || '';
      if (prevFoto && (String(prevFoto).indexOf('data:image/') === 0 || String(prevFoto).indexOf('/admin') === -1)) {
        validPhotoUrl = prevFoto;
      }
    }

    var payload = {
      sku: sku,
      barcode: codigo,
      sales_code: codigoAlt,
      name: descripcion,
      description: descripcion,
      price: precio,
      stock: effectiveStock,
      stock_minimo: parseFloat(document.getElementById('pa-stock-min')?.value || '0') || null,
      purchase_unit: document.getElementById('pa-pres-compra')?.value || 'PIEZA',
      sale_unit: document.getElementById('pa-unidad-medida')?.value || 'PIEZA',
      average_cost: Number((cantPiezas > 1 ? costoPiezaFlete : costoConFlete).toFixed(4)),
      foto_url: validPhotoUrl,
      price_scales: global._paProductPriceScales || [],
      meta_data: {
        foto_url: validPhotoUrl,
        familia: document.getElementById('pa-familia')?.value || 'GENERAL',
        departamento: document.getElementById('pa-departamento')?.value || 'GENERAL',
        marca: (document.getElementById('pa-marca')?.value || 'GENÉRICO').toUpperCase(),
        brand: (document.getElementById('pa-marca')?.value || 'GENÉRICO').toUpperCase(),
        sat_id: document.getElementById('pa-sat-id')?.value || '',
        sat_unidad: satUnBase,
        sat_unidad_empaque: satUnEmpaque,
        paquete: document.getElementById('pa-paquete')?.value || '--',
        piezas_por_caja: cantPiezas,
        costo_raw: costoRaw,
        costo_caja: Number(costoBasePesos.toFixed(4)),
        costo_pieza: Number(costoPieza.toFixed(4)),
        costo_pieza_con_flete: Number(costoPiezaFlete.toFixed(4)),
        costo_base_pesos: Number(costoBasePesos.toFixed(4)),
        costo_con_flete: Number(costoConFlete.toFixed(4)),
        flete_pct: fletePct,
        monto_flete: Number(montoFlete.toFixed(4)),
        costo_otro: fletePct,
        margen: margenBase,
        margen_base_caja: margenBase,
        sobreprecio_pieza_pct: sobreprecioPct,
        sobreprecio_pieza_monto: sobreprecioMonto,
        margen_final_pieza: margenFinalPieza,
        precio_caja: Number(precioCaja.toFixed(2)),
        precio_pieza: Number(precioPieza.toFixed(2)),
        price_scales: global._paProductPriceScales || [],
        branch_price_scales: global._paProductBranchScales || [],
        product_offers: (typeof global.computeProductOfferFlagsSummary === 'function' ? global.computeProductOfferFlagsSummary().product_offers : (global._paProductOffers || [])),
        en_oferta: (typeof global.computeProductOfferFlagsSummary === 'function' ? global.computeProductOfferFlagsSummary().en_oferta : false),
        oferta_activa: (typeof global.computeProductOfferFlagsSummary === 'function' ? global.computeProductOfferFlagsSummary().oferta_activa : false),
        descuento_oferta: (typeof global.computeProductOfferFlagsSummary === 'function' ? global.computeProductOfferFlagsSummary().descuento_oferta : 0),
        precio_oferta: (typeof global.computeProductOfferFlagsSummary === 'function' ? global.computeProductOfferFlagsSummary().precio_oferta : 0),
        is_usd: isUsd,
        tc_compra: tc,
        stock_almacen: effectiveStock,
        stock_max: parseFloat(document.getElementById('pa-stock-max')?.value || '0') || 0,
        stock_transito: parseFloat(document.getElementById('pa-stock-transito')?.value || '0') || 0,
        ieps: parseFloat(document.getElementById('pa-ieps')?.value || '0') || 0,
        iva: parseFloat(document.getElementById('pa-iva')?.value || '0') || 16.0,
        garantia: parseInt(document.getElementById('pa-garantia')?.value || '0') || 0,
        puntos: parseFloat(document.getElementById('pa-puntos')?.value || '0') || 0,
        observaciones: (document.getElementById('pa-observaciones')?.value || '').trim().toUpperCase(),
        is_active: !!document.getElementById('pa-is-active')?.checked,
        art_pesado: !!document.getElementById('pa-art-pesado')?.checked,
        precio_abierto: !!document.getElementById('pa-precio-abierto')?.checked,
        art_negativo: !!document.getElementById('pa-art-negativo')?.checked,
        desact_venta: !!document.getElementById('pa-desact-venta')?.checked,
        desact_compras: !!document.getElementById('pa-desact-compras')?.checked,
        desact_traspasos: !!document.getElementById('pa-desact-traspasos')?.checked,
        price_history: getPriceHistoryArray(),
        last_price_update: formatDateTimeNow(),
        kardex: {
          auditoria: !!document.getElementById('pa-kardex-auditoria')?.checked,
          servicio: !!document.getElementById('pa-kardex-servicio')?.checked,
          no_desc: !!document.getElementById('pa-kardex-no-desc')?.checked,
          no_ofertas_cal: !!document.getElementById('pa-kardex-no-ofertas-cal')?.checked,
          no_ofertas_depto: !!document.getElementById('pa-kardex-no-ofertas-depto')?.checked,
          corte_z: !!document.getElementById('pa-kardex-corte-z')?.checked,
          no_variantes: !!document.getElementById('pa-kardex-no-variantes')?.checked,
          base_prod: !!document.getElementById('pa-kardex-base-prod')?.checked,
          ofertas_cruzadas: !!document.getElementById('pa-kardex-ofertas-cruzadas')?.checked,
          recarga_celular: !!document.getElementById('pa-kardex-recarga-celular')?.checked,
          antibiotico: !!document.getElementById('pa-kardex-antibiotico')?.checked,
          exento_iva: !!document.getElementById('pa-kardex-exento-iva')?.checked,
          desc_abierta: !!document.getElementById('pa-kardex-desc-abierta')?.checked,
          prod_controlado: !!document.getElementById('pa-kardex-prod-controlado')?.checked,
          existencia_neg: !!document.getElementById('pa-kardex-existencia-neg')?.checked,
          autorizacion: !!document.getElementById('pa-kardex-autorizacion')?.checked,
          no_inventariable: !!document.getElementById('pa-kardex-no-inventariable')?.checked,
          recetas_paquetes: !!document.getElementById('pa-kardex-recetas-paquetes')?.checked
        },
        complements_f4: (typeof global.collectComplementsF4Payload === 'function')
          ? global.collectComplementsF4Payload()
          : {},
        suggested_products: Array.isArray(global._paSuggestedProducts) ? global._paSuggestedProducts : [],
        venta_sugerida: Array.isArray(global._paSuggestedProducts) ? global._paSuggestedProducts : []
      }
    };

    try {
      var res;
      if (typeof AdminAPI !== 'undefined' && typeof AdminAPI.apiFetch === 'function') {
        res = await AdminAPI.apiFetch('/api/products', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
      } else {
        var token = localStorage.getItem('session_token') || sessionStorage.getItem('session_token');
        var r = await fetch('/api/products', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': token ? ('Bearer ' + token) : ''
          },
          credentials: 'include',
          body: JSON.stringify(payload)
        });
        if (!r.ok) {
          var errData = await r.json().catch(function() { return {}; });
          throw new Error(errData.detail || ('Error HTTP ' + r.status));
        }
        res = await r.json();
      }

      // Registrar actualización en la tabla de historial visual, en el Store de Catálogos, en el POS en tiempo real y en la Memoria SAT de CALEBSYS
      addPriceHistoryRow('$' + precio.toFixed(2), getCurrentUser(), formatDateTimeNow());
      if (global.CalebsysCatalogStore && typeof global.CalebsysCatalogStore.notifyProductSaved === 'function') {
        global.CalebsysCatalogStore.notifyProductSaved(res || payload);
      }
      if (typeof global.broadcastPosPricingRealtime === 'function') {
        global.broadcastPosPricingRealtime({
          sku: sku,
          product: res || payload,
          product_price_scales: global._paProductPriceScales || [],
          product_branch_scales: global._paProductBranchScales || []
        });
      }
      if (typeof global.recordSatHotLearning === 'function') {
        global.recordSatHotLearning({
          descripcion: descripcion,
          departamento: payload.meta_data.departamento,
          familia: payload.meta_data.familia,
          sat_id: payload.meta_data.sat_id,
          sat_unidad: payload.meta_data.sat_unidad
        });
      }

      // Alta avanzada lanzada desde Recepción de Mercancía: regresar al asistente (mismo paso) con el producto guardado
      if (global._rhWizardReturn) {
        global._rhWizardReturn.savedSku = sku;
        _showMsg('¡Producto ' + sku + ' registrado! Regresando a la recepción…', 'success');
        setTimeout(function () {
          if (typeof global.navigateTo === 'function') global.navigateTo('compras-recepciones'); else window.location.hash = '#compras-recepciones';
        }, 350);
        return;
      }

      if (options && options.resetAndStay) {
        _showMsg('¡Producto ' + sku + ' registrado! Listo para el siguiente.', 'success');
        if (typeof global.limpiarFormularioAlta === 'function') {
          global.limpiarFormularioAlta();
        }
        if (saveBtn) {
          saveBtn.disabled = false;
          saveBtn.innerHTML = originalBtnHtml;
        }
      } else {
        _showMsg('¡Producto ' + sku + ' registrado correctamente!', 'success');
        
        // Regresar al catálogo y recargar lista
        setTimeout(function () {
          if (typeof global.navigateTo === 'function') {
            global.navigateTo('productos');
          } else {
            window.location.hash = '#productos';
          }
          if (typeof global.loadProducts === 'function') {
            global.loadProducts();
          }
        }, 500);
      }

    } catch (err) {
      console.error('[Calebsys] Error al guardar producto:', err);
      _showMsg('Error al guardar: ' + (err.message || 'Verifique los datos'), 'danger');
      if (saveBtn) {
        saveBtn.disabled = false;
        saveBtn.innerHTML = originalBtnHtml;
      }
    }
  };

  function _showMsg(msg, type) {
    if (typeof rhToast === 'function') {
      rhToast(msg);
    } else if (typeof AdminAPI !== 'undefined' && typeof AdminAPI.toast === 'function') {
      AdminAPI.toast(msg, type);
    } else {
      alert(msg);
    }
  }

  // ===========================================================================
  // CONTROLADOR COMPLETO DE LA PESTAÑA: 🧩 COMPLEMENTOS [F4] (#pa-tab-complementos-f4)
  // 1. Bóveda Documental (5 Slots Oficiales + Semáforo Vigencia NOM + Adjunto en Cotización)
  // 2. Logística, Dimensiones Físicas (m³ en vivo), Carta Porte 3.1 y Comercio Exterior
  // 3. Catálogo Multi-Proveedor y Cruce Automático de XML de Compras
  // 4. Productos Equivalentes / Sustitutos (Cross-Reference cuando Stock = 0 en POS)
  // 5. Especificaciones Técnicas (Plantillas por Giro), Licitaciones y Código QR Técnico
  // ===========================================================================
  var F4_DOC_SLOTS_DEF = [
    { key: 'FT',       icon: '📄', title: 'Ficha Técnica (FT)',                                      subtitle: 'Especificaciones de fabricante / ingeniería', defaultAttach: true },
    { key: 'HDS',      icon: '☣️', title: 'Hoja de Datos de Seguridad (HDS / MSDS - NOM-018)',       subtitle: 'Químicos, pinturas, solventes, cementos',     defaultAttach: true },
    { key: 'NOM',      icon: '🏅', title: 'Certificado de Calidad / Norma (NOM / ANCE / ISO / UL)', subtitle: 'Cumplimiento normativo y vigencia',           defaultAttach: true, isCert: true },
    { key: 'MANUAL',   icon: '📘', title: 'Manual de Instalación / Diagrama de Despiece',            subtitle: 'Guía técnica de montaje y partes',            defaultAttach: false },
    { key: 'GARANTIA', icon: '🛡️', title: 'Póliza de Garantía Escrita',                              subtitle: 'Términos y cobertura oficial de garantía',    defaultAttach: false }
  ];

  var F4_SPEC_TEMPLATES = {
    'FERRETERIA': [
      { attr: 'MATERIAL DE FABRICACIÓN', val: 'ACERO AL CARBÓN FORJADO' },
      { attr: 'MEDIDA / CAPACIDAD',      val: '' },
      { attr: 'ACABADO / RECUBRIMIENTO', val: 'GALVANIZADO / CROMADO' },
      { attr: 'NORMA / CERTIFICACIÓN',   val: 'NOM / ANSI' },
      { attr: 'USO RECOMENDADO',         val: 'INDUSTRIAL / PESADO' }
    ],
    'MADERERIA_ACERO': [
      { attr: 'CALIBRE / ESPESOR',            val: '' },
      { attr: 'LARGO TOTAL (M)',              val: '' },
      { attr: 'GRADO / RESISTENCIA (KG/CM²)', val: 'FY 4,200 KG/CM²' },
      { attr: 'ESPECIE / ALEACIÓN',           val: '' },
      { attr: 'PESO TEÓRICO POR UNIDAD (KG)', val: '' }
    ],
    'ELECTRICO': [
      { attr: 'VOLTAJE DE OPERACIÓN (V)',   val: '127V / 220V CA' },
      { attr: 'CORRIENTE / AMPERAJE (A)',   val: '' },
      { attr: 'CALIBRE AWG / CONDUCTOR',    val: 'COBRE ELECTROLÍTICO 99.9%' },
      { attr: 'TEMPERATURA MÁXIMA (°C)',    val: '90 °C' },
      { attr: 'GRADO DE PROTECCIÓN / NORMA', val: 'NOM-063-SCFI / IP65' }
    ],
    'PINTURAS_QUIMICOS': [
      { attr: 'RENDIMIENTO TEÓRICO (M²/L)', val: '8 A 10 M²/L A 2 MANOS' },
      { attr: 'TIEMPO DE SECADO AL TACTO',  val: '30 MINUTOS' },
      { attr: 'SOLVENTE / DILUYENTE',       val: 'AGUA LIMPIA (MÁX. 10%)' },
      { attr: 'ACABADO / BRILLO',           val: 'MATE / SATINADO' },
      { attr: 'CONTENIDO COV / NORMA',      val: 'BAJO VOC · NOM-018-STPS' }
    ],
    'FARMACIA_SALUD': [
      { attr: 'SUSTANCIA ACTIVA',            val: '' },
      { attr: 'CONCENTRACIÓN / GRAMAJE',     val: '' },
      { attr: 'VÍA DE ADMINISTRACIÓN',       val: 'ORAL / TÓPICA' },
      { attr: 'REGISTRO SANITARIO COFEPRIS', val: '' },
      { attr: 'TEMPERATURA DE CONSERVACIÓN', val: 'NO MÁS DE 30 °C EN LUGAR SECO' }
    ],
    'REFACCIONARIA': [
      { attr: 'NÚMERO DE PARTE OEM',     val: '' },
      { attr: 'ARMADORA / MODELOS',      val: '' },
      { attr: 'POSICIÓN / EJE',          val: 'DELANTERO / TRASERO' },
      { attr: 'MATERIAL DEL COMPONENTE', val: '' },
      { attr: 'GARANTÍA DE FÁBRICA',     val: '12 MESES CONTRA DEFECTO' }
    ]
  };

  function _createEmptyF4State() {
    var docs = {};
    F4_DOC_SLOTS_DEF.forEach(function (d) {
      docs[d.key] = {
        key: d.key,
        fileName: '',
        mimeType: '',
        dataUrl: '',
        uploadedAt: '',
        attachQuote: !!d.defaultAttach,
        certNumber: '',
        expiryDate: ''
      };
    });
    return {
      documents: docs,
      logistics: {
        peso_kg: 0,
        largo_cm: 0,
        ancho_cm: 0,
        alto_cm: 0,
        volumen_m3: 0,
        pallet_qty: 0,
        estiba_max: 0,
        mat_peligroso: false,
        un_code: '',
        hazard_class: '',
        embalaje_sat: '',
        pais_origen: 'MÉXICO',
        fraccion_arancelaria: '',
        pedimento_reciente: ''
      },
      suppliers: [],
      equivalents: [],
      specs: {
        items: [
          { attr: 'NORMA / ESPECIFICACIÓN', val: '' },
          { attr: 'MATERIAL PRINCIPAL',     val: '' }
        ],
        licitacion_desc: '',
        video_url: ''
      }
    };
  }

  var _f4State = _createEmptyF4State();
  var _f4ActiveUploadDocKey = null;
  var _f4SelectedEqCandidate = null;
  var _f4EqMatches = [];

  function _escF4(str) {
    return String(str == null ? '' : str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function _computeCertSemaphore(expiryDateStr) {
    if (!expiryDateStr) {
      return { bg: '#f1f5f9', fg: '#475569', border: '#cbd5e1', text: '⚪ Sin fecha' };
    }
    var expMs = Date.parse(expiryDateStr + 'T23:59:59');
    if (isNaN(expMs)) {
      return { bg: '#f1f5f9', fg: '#475569', border: '#cbd5e1', text: '⚪ Sin fecha' };
    }
    var diffDays = Math.ceil((expMs - Date.now()) / (1000 * 60 * 60 * 24));
    if (diffDays < 0) {
      return { bg: '#fef2f2', fg: '#dc2626', border: '#fca5a5', text: '🔴 Vencido (' + Math.abs(diffDays) + 'd)' };
    }
    if (diffDays <= 30) {
      return { bg: '#fffbeb', fg: '#b45309', border: '#fcd34d', text: '🟡 Por vencer (' + diffDays + 'd)' };
    }
    return { bg: '#f0fdf4', fg: '#15803d', border: '#86efac', text: '🟢 Vigente (' + diffDays + 'd)' };
  }

  // ── 1. Renderizado de Bóveda Documental (5 Slots Oficiales) ──
  function renderF4DocumentsVault() {
    var listEl = document.getElementById('pa-f4-docs-list');
    var countEl = document.getElementById('pa-f4-docs-counter');
    if (!listEl) return;

    var loadedCount = 0;
    var html = '';

    F4_DOC_SLOTS_DEF.forEach(function (slot) {
      var doc = (_f4State.documents && _f4State.documents[slot.key]) ? _f4State.documents[slot.key] : {
        key: slot.key, fileName: '', mimeType: '', dataUrl: '', attachQuote: !!slot.defaultAttach, certNumber: '', expiryDate: ''
      };
      var hasFile = !!(doc.dataUrl && doc.fileName);
      if (hasFile) loadedCount++;

      var certExtraHtml = '';
      if (slot.isCert) {
        var sem = _computeCertSemaphore(doc.expiryDate);
        certExtraHtml =
          '<div style="display:grid;grid-template-columns:1fr 145px auto;gap:6px;align-items:center;margin-top:6px;padding-top:6px;border-top:1px dashed #cbd5e1;">' +
            '<input type="text" data-f4-cert-num="NOM" value="' + _escF4(doc.certNumber || '') + '" class="pa-input pa-uppercase" placeholder="No. Certificado / Norma (Ej. NOM-001-ANCE)" style="height:26px;font-size:10.5px;padding:0 7px;">' +
            '<input type="date" data-f4-cert-exp="NOM" value="' + _escF4(doc.expiryDate || '') + '" class="pa-input" title="Fecha de vencimiento del certificado" style="height:26px;font-size:10.5px;padding:0 6px;">' +
            '<span id="pa-f4-nom-sem-badge" style="font-size:10px;font-weight:800;padding:2px 8px;border-radius:999px;background:' + sem.bg + ';color:' + sem.fg + ';border:1px solid ' + sem.border + ';white-space:nowrap;">' + sem.text + '</span>' +
          '</div>';
      }

      html +=
        '<div style="background:' + (hasFile ? '#f0f9ff' : '#f8fafc') + ';border:1px solid ' + (hasFile ? '#93c5fd' : '#e2e8f0') + ';border-radius:8px;padding:7px 10px;">' +
          '<div style="display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap;">' +
            '<div style="min-width:0;flex:1;">' +
              '<div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;">' +
                '<span style="font-size:13px;">' + slot.icon + '</span>' +
                '<strong style="font-size:11.5px;color:#0f172a;">' + _escF4(slot.title) + '</strong>' +
                (hasFile
                  ? '<span style="font-size:9.5px;font-weight:800;padding:1px 6px;border-radius:4px;background:#dcfce7;color:#15803d;border:1px solid #86efac;">✓ ' + _escF4(doc.fileName) + '</span>'
                  : '<span style="font-size:9.5px;font-weight:700;color:#64748b;">(Sin archivo)</span>') +
              '</div>' +
              '<div style="display:flex;align-items:center;gap:12px;margin-top:3px;">' +
                '<label style="display:inline-flex;align-items:center;gap:5px;font-size:10px;font-weight:700;color:#334155;cursor:pointer;margin:0;">' +
                  '<input type="checkbox" data-f4-doc-attach="' + slot.key + '"' + (doc.attachQuote ? ' checked' : '') + ' style="accent-color:#2563eb;">' +
                  '<span>Adjuntar automáticamente en Cotizaciones y Licitaciones</span>' +
                '</label>' +
              '</div>' +
            '</div>' +
            '<div style="display:flex;align-items:center;gap:4px;flex-shrink:0;">' +
              '<button type="button" data-f4-doc-upload="' + slot.key + '" style="background:#2563eb;color:#ffffff;border:1px solid #1d4ed8;border-radius:6px;padding:4px 8px;font-size:10.5px;font-weight:800;cursor:pointer;" title="Subir PDF o Imagen">' +
                '📤 Subir PDF/Img' +
              '</button>' +
              '<button type="button" data-f4-doc-preview="' + slot.key + '"' + (hasFile ? '' : ' disabled') + ' style="background:' + (hasFile ? '#ffffff' : '#f1f5f9') + ';color:' + (hasFile ? '#0f172a' : '#94a3b8') + ';border:1px solid #cbd5e1;border-radius:6px;padding:4px 7px;font-size:10.5px;font-weight:800;cursor:' + (hasFile ? 'pointer' : 'not-allowed') + ';" title="Ver Vista Previa en Modal">' +
                '👁️' +
              '</button>' +
              '<button type="button" data-f4-doc-download="' + slot.key + '"' + (hasFile ? '' : ' disabled') + ' style="background:' + (hasFile ? '#ffffff' : '#f1f5f9') + ';color:' + (hasFile ? '#1d4ed8' : '#94a3b8') + ';border:1px solid #cbd5e1;border-radius:6px;padding:4px 7px;font-size:10.5px;font-weight:800;cursor:' + (hasFile ? 'pointer' : 'not-allowed') + ';" title="Descargar archivo">' +
                '⬇️' +
              '</button>' +
              '<button type="button" data-f4-doc-remove="' + slot.key + '"' + (hasFile ? '' : ' disabled') + ' style="background:' + (hasFile ? '#fef2f2' : '#f1f5f9') + ';color:' + (hasFile ? '#dc2626' : '#94a3b8') + ';border:1px solid ' + (hasFile ? '#fecaca' : '#cbd5e1') + ';border-radius:6px;padding:4px 7px;font-size:10.5px;font-weight:800;cursor:' + (hasFile ? 'pointer' : 'not-allowed') + ';" title="Quitar documento">' +
                '🗑️' +
              '</button>' +
            '</div>' +
          '</div>' +
          certExtraHtml +
        '</div>';
    });

    listEl.innerHTML = html;
    if (countEl) {
      countEl.textContent = loadedCount + ' / 5 cargados';
    }

    // Bind events for document slots
    listEl.querySelectorAll('[data-f4-doc-upload]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        _f4ActiveUploadDocKey = btn.getAttribute('data-f4-doc-upload');
        var fileInp = document.getElementById('pa-f4-doc-file-input');
        if (fileInp) {
          fileInp.value = '';
          fileInp.click();
        }
      });
    });

    listEl.querySelectorAll('[data-f4-doc-preview]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var key = btn.getAttribute('data-f4-doc-preview');
        openF4DocumentPreviewModal(key);
      });
    });

    listEl.querySelectorAll('[data-f4-doc-download]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var key = btn.getAttribute('data-f4-doc-download');
        var doc = _f4State.documents && _f4State.documents[key];
        if (!doc || !doc.dataUrl) return;
        var a = document.createElement('a');
        a.href = doc.dataUrl;
        a.download = doc.fileName || (key + '.pdf');
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
      });
    });

    listEl.querySelectorAll('[data-f4-doc-remove]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var key = btn.getAttribute('data-f4-doc-remove');
        if (_f4State.documents && _f4State.documents[key]) {
          _f4State.documents[key].fileName = '';
          _f4State.documents[key].mimeType = '';
          _f4State.documents[key].dataUrl = '';
          _f4State.documents[key].uploadedAt = '';
          renderF4DocumentsVault();
        }
      });
    });

    listEl.querySelectorAll('[data-f4-doc-attach]').forEach(function (chk) {
      chk.addEventListener('change', function () {
        var key = chk.getAttribute('data-f4-doc-attach');
        if (_f4State.documents && _f4State.documents[key]) {
          _f4State.documents[key].attachQuote = !!chk.checked;
        }
      });
    });

    var certNumInp = listEl.querySelector('[data-f4-cert-num="NOM"]');
    if (certNumInp) {
      certNumInp.addEventListener('input', function () {
        certNumInp.value = certNumInp.value.toUpperCase();
        if (_f4State.documents && _f4State.documents.NOM) {
          _f4State.documents.NOM.certNumber = certNumInp.value.trim();
        }
      });
    }

    var certExpInp = listEl.querySelector('[data-f4-cert-exp="NOM"]');
    if (certExpInp) {
      certExpInp.addEventListener('change', function () {
        if (_f4State.documents && _f4State.documents.NOM) {
          _f4State.documents.NOM.expiryDate = certExpInp.value;
        }
        var badge = document.getElementById('pa-f4-nom-sem-badge');
        if (badge) {
          var sem = _computeCertSemaphore(certExpInp.value);
          badge.style.background = sem.bg;
          badge.style.color = sem.fg;
          badge.style.borderColor = sem.border;
          badge.textContent = sem.text;
        }
      });
    }
  }

  var _f4LastPreviewBlobUrl = null;

  function _dataUrlToBlobUrlF4(dataUrl, fallbackMime) {
    try {
      if (!dataUrl || typeof dataUrl !== 'string') return '';
      if (dataUrl.indexOf('data:') !== 0) return dataUrl;
      var parts = dataUrl.split(',');
      if (parts.length < 2) return dataUrl;
      var metaPart = parts[0];
      var base64Data = parts.slice(1).join(',');
      var mimeMatch = /^data:([^;]+);base64$/i.exec(metaPart);
      var mime = (mimeMatch && mimeMatch[1]) ? mimeMatch[1] : (fallbackMime || 'application/pdf');
      var binStr = atob(base64Data);
      var len = binStr.length;
      var bytes = new Uint8Array(len);
      for (var i = 0; i < len; i++) {
        bytes[i] = binStr.charCodeAt(i);
      }
      var blob = new Blob([bytes], { type: mime });
      return URL.createObjectURL(blob);
    } catch (e) {
      return dataUrl;
    }
  }

  function openF4DocumentPreviewModal(docKey) {
    var doc = _f4State.documents && _f4State.documents[docKey];
    if (!doc || !doc.dataUrl) return;
    var modal = document.getElementById('pa-f4-doc-preview-modal');
    var titleEl = document.getElementById('pa-f4-doc-preview-title');
    var bodyEl = document.getElementById('pa-f4-doc-preview-body');
    if (!modal || !bodyEl) return;

    if (_f4LastPreviewBlobUrl) {
      try { URL.revokeObjectURL(_f4LastPreviewBlobUrl); } catch (e) {}
      _f4LastPreviewBlobUrl = null;
    }

    var isPdf = String(doc.mimeType || '').toLowerCase().indexOf('pdf') !== -1 || /\.pdf$/i.test(doc.fileName || '');
    var previewUrl = _dataUrlToBlobUrlF4(doc.dataUrl, isPdf ? 'application/pdf' : (doc.mimeType || 'image/png'));
    if (previewUrl && previewUrl.indexOf('blob:') === 0) {
      _f4LastPreviewBlobUrl = previewUrl;
    }

    var slotDef = F4_DOC_SLOTS_DEF.find(function (s) { return s.key === docKey; });
    if (titleEl) {
      titleEl.innerHTML =
        '<span>' + _escF4((slotDef ? slotDef.icon + ' ' + slotDef.title : '📄 Documento') + ' — ' + (doc.fileName || '')) + '</span>' +
        '<a href="' + previewUrl + '" target="_blank" rel="noopener" style="margin-left:12px;background:#2563eb;color:#ffffff;text-decoration:none;padding:3px 9px;border-radius:5px;font-size:11px;font-weight:800;border:1px solid #60a5fa;">↗ Abrir en pestaña nueva</a>';
    }

    if (isPdf) {
      bodyEl.innerHTML =
        '<object data="' + previewUrl + '" type="application/pdf" style="width:100%;height:100%;border:none;border-radius:8px;background:#ffffff;">' +
          '<embed src="' + previewUrl + '" type="application/pdf" style="width:100%;height:100%;border:none;border-radius:8px;" />' +
        '</object>';
    } else {
      bodyEl.innerHTML = '<img src="' + previewUrl + '" alt="' + _escF4(doc.fileName) + '" style="max-width:100%;max-height:100%;object-fit:contain;border-radius:8px;box-shadow:0 8px 24px rgba(0,0,0,0.18);">';
    }
    modal.style.display = 'flex';
  }

  // ── 2. Logística, Dimensiones Físicas y Carta Porte 3.1 (SAT) ──
  function recalcF4LogisticsVolume() {
    var l = parseFloat(document.getElementById('f4-log-largo')?.value || '0') || 0;
    var a = parseFloat(document.getElementById('f4-log-ancho')?.value || '0') || 0;
    var h = parseFloat(document.getElementById('f4-log-alto')?.value || '0') || 0;
    var volM3 = (l * a * h) / 1000000;
    var volEl = document.getElementById('f4-log-volumen');
    if (volEl) {
      volEl.value = volM3.toFixed(6);
    }
    _f4State.logistics.largo_cm = l;
    _f4State.logistics.ancho_cm = a;
    _f4State.logistics.alto_cm = h;
    _f4State.logistics.volumen_m3 = Number(volM3.toFixed(6));
  }

  function syncF4HazmatVisibility() {
    var chk = document.getElementById('f4-log-mat-peligroso');
    var box = document.getElementById('f4-log-hazmat-box');
    var isHaz = !!(chk && chk.checked);
    if (box) {
      box.style.display = isHaz ? 'grid' : 'none';
    }
    _f4State.logistics.mat_peligroso = isHaz;
  }

  // ── 3. Catálogo Multi-Proveedor y Cruce XML de Compras ──
  function renderF4SuppliersTable() {
    var tbody = document.getElementById('f4-prov-tbody');
    var countEl = document.getElementById('pa-f4-prov-count');
    if (!tbody) return;

    var list = Array.isArray(_f4State.suppliers) ? _f4State.suppliers : [];
    if (countEl) {
      countEl.textContent = list.length + (list.length === 1 ? ' proveedor' : ' proveedores');
    }

    if (!list.length) {
      tbody.innerHTML = '<tr><td colspan="7" class="pa-td-empty">Sin proveedores vinculados para cruce de XML de compras</td></tr>';
      return;
    }

    tbody.innerHTML = list.map(function (sup, idx) {
      var costNum = parseFloat(sup.cost) || 0;
      return '<tr>' +
        '<td style="font-weight:700;color:#0f172a;">' + _escF4(sup.provider_name) + '</td>' +
        '<td style="font-family:monospace;font-weight:800;color:#1d4ed8;">' + _escF4(sup.xml_sku) + '</td>' +
        '<td style="text-align:right;font-family:monospace;font-weight:800;">$' + costNum.toFixed(2) + ' <span style="font-size:9.5px;color:#475569;">' + _escF4(sup.currency || 'MXN') + '</span></td>' +
        '<td style="text-align:center;">' + (parseInt(sup.lead_days, 10) || 1) + ' d</td>' +
        '<td style="text-align:center;">' + (parseFloat(sup.min_qty) || 1) + '</td>' +
        '<td style="text-align:center;">' +
          '<button type="button" data-f4-sup-primary="' + idx + '" style="background:transparent;border:none;cursor:pointer;font-size:14px;" title="Marcar como Proveedor Principal">' +
            (sup.is_primary ? '⭐' : '☆') +
          '</button>' +
        '</td>' +
        '<td style="text-align:center;">' +
          '<button type="button" data-f4-sup-del="' + idx + '" style="background:#fef2f2;color:#dc2626;border:1px solid #fecaca;border-radius:5px;padding:2px 6px;cursor:pointer;font-size:11px;" title="Eliminar proveedor">' +
            '<i class="fa-solid fa-trash"></i>' +
          '</button>' +
        '</td>' +
      '</tr>';
    }).join('');

    tbody.querySelectorAll('[data-f4-sup-primary]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var i = parseInt(btn.getAttribute('data-f4-sup-primary'), 10);
        _f4State.suppliers.forEach(function (s, idx) {
          s.is_primary = (idx === i);
        });
        renderF4SuppliersTable();
      });
    });

    tbody.querySelectorAll('[data-f4-sup-del]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var i = parseInt(btn.getAttribute('data-f4-sup-del'), 10);
        _f4State.suppliers.splice(i, 1);
        renderF4SuppliersTable();
      });
    });
  }

  // ── 4. Productos Equivalentes / Sustitutos (Cross-Reference cuando Stock = 0) ──
  function _getAvailableCatalogForEquivalents() {
    var map = {};
    var currentSku = String(document.getElementById('pa-sku')?.value || '').trim().toUpperCase();
    var pools = [
      (typeof global.__paGetF3ProductsList === 'function' ? global.__paGetF3ProductsList() : []) || [],
      global._productsAll || [],
      global._productsCache || []
    ];
    pools.forEach(function (arr) {
      if (!Array.isArray(arr)) return;
      arr.forEach(function (p) {
        if (!p || !p.sku) return;
        var s = String(p.sku).trim().toUpperCase();
        if (s === currentSku) return;
        if (!map[s]) map[s] = p;
      });
    });
    return Object.keys(map).map(function (k) { return map[k]; });
  }

  function renderF4EquivalentsDropdown(query) {
    var dd = document.getElementById('f4-eq-search-dd');
    if (!dd) return;
    var q = String(query || '').trim().toUpperCase();
    if (!q) {
      dd.style.display = 'none';
      dd.innerHTML = '';
      _f4EqMatches = [];
      return;
    }

    var catalog = _getAvailableCatalogForEquivalents();
    var matches = catalog.filter(function (p) {
      var s = String(p.sku || '').toUpperCase();
      var n = String(p.name || p.description || '').toUpperCase();
      var b = String(p.barcode || '').toUpperCase();
      return s.indexOf(q) !== -1 || n.indexOf(q) !== -1 || b.indexOf(q) !== -1;
    }).slice(0, 12);

    _f4EqMatches = matches;
    if (!matches.length) {
      dd.innerHTML = '<div style="padding:8px 10px;font-size:11px;color:#64748b;">Sin coincidencias en el catálogo para "' + _escF4(q) + '".</div>';
      dd.style.display = 'block';
      return;
    }

    dd.innerHTML = matches.map(function (p) {
      var s = String(p.sku || '').toUpperCase();
      var n = String(p.name || p.description || s).toUpperCase();
      var m = (p.meta_data && typeof p.meta_data === 'object') ? p.meta_data : {};
      var br = String(p.marca || m.marca || m.brand || 'GENÉRICO').toUpperCase();
      var st = parseFloat(p.stock != null ? p.stock : 0) || 0;
      var pr = parseFloat(p.price != null ? p.price : 0) || 0;
      return '<div data-f4-eq-pick="' + _escF4(s) + '" style="padding:6px 10px;border-bottom:1px solid #e2e8f0;cursor:pointer;display:flex;align-items:center;justify-content:space-between;gap:8px;font-size:11px;background:#ffffff;">' +
        '<div style="min-width:0;flex:1;">' +
          '<span style="font-family:monospace;font-weight:800;color:#1d4ed8;background:#eff6ff;padding:1px 5px;border-radius:4px;margin-right:6px;">' + _escF4(s) + '</span>' +
          '<strong style="color:#0f172a;">' + _escF4(n) + '</strong> ' +
          '<span style="color:#64748b;font-size:10px;">(' + _escF4(br) + ')</span>' +
        '</div>' +
        '<div style="white-space:nowrap;font-family:monospace;font-weight:800;">' +
          '<span style="color:' + (st > 0 ? '#15803d' : '#dc2626') + ';margin-right:8px;">Stock: ' + st + '</span>' +
          '<span style="color:#0f172a;">$' + pr.toFixed(2) + '</span>' +
        '</div>' +
      '</div>';
    }).join('');
    dd.style.display = 'block';

    dd.querySelectorAll('[data-f4-eq-pick]').forEach(function (row) {
      row.addEventListener('mousedown', function (ev) {
        ev.preventDefault();
        var skuPick = row.getAttribute('data-f4-eq-pick');
        var found = matches.find(function (x) { return String(x.sku).toUpperCase() === String(skuPick).toUpperCase(); });
        if (found) {
          _f4SelectedEqCandidate = found;
          var inp = document.getElementById('f4-eq-search-inp');
          if (inp) inp.value = found.sku + ' — ' + (found.name || found.description || '');
          dd.style.display = 'none';
          addF4EquivalentProduct(found);
        }
      });
    });
  }

  function addF4EquivalentProduct(prodCandidate) {
    var prod = prodCandidate || _f4SelectedEqCandidate || (_f4EqMatches.length ? _f4EqMatches[0] : null);
    var inp = document.getElementById('f4-eq-search-inp');
    var dd = document.getElementById('f4-eq-search-dd');
    var typeSel = document.getElementById('f4-eq-type');
    var eqType = (typeSel && typeSel.value) || 'IDÉNTICO OTRA MARCA';

    if (!prod && inp && inp.value.trim()) {
      var raw = inp.value.split(' — ')[0].trim().toUpperCase();
      prod = _getAvailableCatalogForEquivalents().find(function (p) {
        return String(p.sku).toUpperCase() === raw;
      });
    }

    if (!prod) {
      _showMsg('Busca y selecciona un producto del catálogo para vincularlo como sustituto.', 'warning');
      return;
    }

    var skuUp = String(prod.sku).toUpperCase();
    var exists = _f4State.equivalents.some(function (e) { return String(e.sku).toUpperCase() === skuUp; });
    if (exists) {
      _showMsg('El producto ' + skuUp + ' ya está en la lista de equivalentes.', 'info');
      return;
    }

    var m = (prod.meta_data && typeof prod.meta_data === 'object') ? prod.meta_data : {};
    _f4State.equivalents.push({
      sku: skuUp,
      description: String(prod.name || prod.description || skuUp).toUpperCase(),
      brand: String(prod.marca || m.marca || m.brand || 'GENÉRICO').toUpperCase(),
      stock: parseFloat(prod.stock != null ? prod.stock : 0) || 0,
      price: parseFloat(prod.price != null ? prod.price : 0) || 0,
      equiv_type: eqType
    });

    _f4SelectedEqCandidate = null;
    _f4EqMatches = [];
    if (inp) inp.value = '';
    if (dd) dd.style.display = 'none';
    renderF4EquivalentsTable();
  }

  function renderF4EquivalentsTable() {
    var tbody = document.getElementById('f4-eq-tbody');
    var countEl = document.getElementById('pa-f4-eq-count');
    if (!tbody) return;

    var catalog = _getAvailableCatalogForEquivalents();
    var list = Array.isArray(_f4State.equivalents) ? _f4State.equivalents : [];

    // Sincronizar stock y precio en vivo desde el catálogo si el producto está en caché
    list.forEach(function (eq) {
      var live = catalog.find(function (p) { return String(p.sku).toUpperCase() === String(eq.sku).toUpperCase(); });
      if (live) {
        eq.description = String(live.name || live.description || eq.description || eq.sku).toUpperCase();
        var m = (live.meta_data && typeof live.meta_data === 'object') ? live.meta_data : {};
        eq.brand = String(live.marca || m.marca || m.brand || eq.brand || 'GENÉRICO').toUpperCase();
        eq.stock = parseFloat(live.stock != null ? live.stock : eq.stock) || 0;
        eq.price = parseFloat(live.price != null ? live.price : eq.price) || 0;
      }
    });

    if (countEl) {
      countEl.textContent = list.length + (list.length === 1 ? ' sustituto' : ' sustitutos');
    }

    if (!list.length) {
      tbody.innerHTML = '<tr><td colspan="7" class="pa-td-empty">No hay productos sustitutos configurados para sugerir en Caja POS cuando Stock = 0</td></tr>';
      return;
    }

    tbody.innerHTML = list.map(function (eq, idx) {
      var st = parseFloat(eq.stock) || 0;
      var pr = parseFloat(eq.price) || 0;
      return '<tr>' +
        '<td style="font-family:monospace;font-weight:800;color:#1d4ed8;">' + _escF4(eq.sku) + '</td>' +
        '<td style="font-weight:700;color:#0f172a;">' + _escF4(eq.description) + '</td>' +
        '<td><span style="font-size:10px;padding:1px 6px;border-radius:4px;background:#f1f5f9;color:#334155;font-weight:700;">' + _escF4(eq.brand || 'GENÉRICO') + '</span></td>' +
        '<td style="text-align:center;font-weight:800;color:' + (st > 0 ? '#15803d' : '#dc2626') + ';">' + st + '</td>' +
        '<td style="text-align:right;font-family:monospace;font-weight:800;">$' + pr.toFixed(2) + '</td>' +
        '<td>' +
          '<select data-f4-eq-type-idx="' + idx + '" class="pa-select" style="height:25px;font-size:10.5px;padding:0 5px;">' +
            '<option value="IDÉNTICO OTRA MARCA"' + (eq.equiv_type === 'IDÉNTICO OTRA MARCA' ? ' selected' : '') + '>Idéntico otra marca</option>' +
            '<option value="CALIDAD SUPERIOR"' + (eq.equiv_type === 'CALIDAD SUPERIOR' ? ' selected' : '') + '>Calidad Superior</option>' +
            '<option value="ECONÓMICO / GENÉRICO"' + (eq.equiv_type === 'ECONÓMICO / GENÉRICO' ? ' selected' : '') + '>Económico / Genérico</option>' +
          '</select>' +
        '</td>' +
        '<td style="text-align:center;">' +
          '<button type="button" data-f4-eq-del="' + idx + '" style="background:#fef2f2;color:#dc2626;border:1px solid #fecaca;border-radius:5px;padding:2px 6px;cursor:pointer;font-size:11px;" title="Quitar sustituto">' +
            '<i class="fa-solid fa-trash"></i>' +
          '</button>' +
        '</td>' +
      '</tr>';
    }).join('');

    tbody.querySelectorAll('[data-f4-eq-type-idx]').forEach(function (sel) {
      sel.addEventListener('change', function () {
        var i = parseInt(sel.getAttribute('data-f4-eq-type-idx'), 10);
        if (_f4State.equivalents[i]) {
          _f4State.equivalents[i].equiv_type = sel.value;
        }
      });
    });

    tbody.querySelectorAll('[data-f4-eq-del]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var i = parseInt(btn.getAttribute('data-f4-eq-del'), 10);
        _f4State.equivalents.splice(i, 1);
        renderF4EquivalentsTable();
      });
    });
  }

  // ── 5. Especificaciones Técnicas (Característica ➔ Valor), Licitaciones y QR Técnico ──
  function renderF4SpecsTable() {
    var tbody = document.getElementById('f4-spec-tbody');
    if (!tbody) return;
    var items = (_f4State.specs && Array.isArray(_f4State.specs.items)) ? _f4State.specs.items : [];
    if (!items.length) {
      tbody.innerHTML = '<tr><td colspan="3" class="pa-td-empty">Haz clic en "+ Agregar Especificación" o elige una Plantilla Rápida por Giro arriba.</td></tr>';
      return;
    }

    tbody.innerHTML = items.map(function (sp, idx) {
      return '<tr>' +
        '<td style="padding:4px 6px;">' +
          '<input type="text" data-f4-spec-attr="' + idx + '" value="' + _escF4(sp.attr || '') + '" class="pa-input pa-uppercase" placeholder="Ej. VOLTAJE, CALIBRE, RESISTENCIA..." style="height:28px;font-size:11px;font-weight:700;padding:0 8px;">' +
        '</td>' +
        '<td style="padding:4px 6px;">' +
          '<input type="text" data-f4-spec-val="' + idx + '" value="' + _escF4(sp.val || '') + '" class="pa-input pa-uppercase" placeholder="Ej. 120V, 12 AWG, F\'C 250 KG/CM²..." style="height:28px;font-size:11px;padding:0 8px;">' +
        '</td>' +
        '<td style="text-align:center;padding:4px;">' +
          '<button type="button" data-f4-spec-del="' + idx + '" style="background:#fef2f2;color:#dc2626;border:1px solid #fecaca;border-radius:5px;padding:2px 6px;cursor:pointer;font-size:11px;" title="Eliminar fila">' +
            '<i class="fa-solid fa-trash"></i>' +
          '</button>' +
        '</td>' +
      '</tr>';
    }).join('');

    tbody.querySelectorAll('[data-f4-spec-attr]').forEach(function (inp) {
      inp.addEventListener('input', function () {
        var i = parseInt(inp.getAttribute('data-f4-spec-attr'), 10);
        inp.value = inp.value.toUpperCase();
        if (_f4State.specs.items[i]) _f4State.specs.items[i].attr = inp.value;
      });
    });

    tbody.querySelectorAll('[data-f4-spec-val]').forEach(function (inp) {
      inp.addEventListener('input', function () {
        var i = parseInt(inp.getAttribute('data-f4-spec-val'), 10);
        inp.value = inp.value.toUpperCase();
        if (_f4State.specs.items[i]) _f4State.specs.items[i].val = inp.value;
      });
    });

    tbody.querySelectorAll('[data-f4-spec-del]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var i = parseInt(btn.getAttribute('data-f4-spec-del'), 10);
        _f4State.specs.items.splice(i, 1);
        renderF4SpecsTable();
      });
    });
  }

  function renderF4TechnicalQrCanvas() {
    var canvas = document.getElementById('f4-spec-qr-canvas');
    if (!canvas || !canvas.getContext) return;
    var ctx = canvas.getContext('2d');
    var urlVal = String(document.getElementById('f4-spec-video-url')?.value || '').trim();
    var skuVal = String(document.getElementById('pa-sku')?.value || 'SKU').trim().toUpperCase();
    var descVal = String(document.getElementById('pa-descripcion')?.value || 'PRODUCTO').trim().toUpperCase();
    var payloadStr = urlVal || ('CALEBSYS://' + skuVal + '|' + descVal);

    var size = 21; // Matriz QR Versión 1 (21x21 módulos)
    var grid = [];
    for (var r = 0; r < size; r++) {
      grid[r] = [];
      for (var c = 0; c < size; c++) grid[r][c] = 0;
    }

    function drawFinder(row0, col0) {
      for (var r = 0; r < 7; r++) {
        for (var c = 0; c < 7; c++) {
          var isBorder = (r === 0 || r === 6 || c === 0 || c === 6);
          var isInner = (r >= 2 && r <= 4 && c >= 2 && c <= 4);
          grid[row0 + r][col0 + c] = (isBorder || isInner) ? 1 : 0;
        }
      }
    }
    drawFinder(0, 0);
    drawFinder(0, size - 7);
    drawFinder(size - 7, 0);

    for (var i = 8; i < size - 8; i++) {
      grid[6][i] = (i % 2 === 0) ? 1 : 0;
      grid[i][6] = (i % 2 === 0) ? 1 : 0;
    }

    var hash = 2166136261;
    for (var k = 0; k < payloadStr.length; k++) {
      hash ^= payloadStr.charCodeAt(k);
      hash = Math.imul(hash, 16777619);
    }

    for (var rr = 0; rr < size; rr++) {
      for (var cc = 0; cc < size; cc++) {
        var inFinderTL = (rr < 8 && cc < 8);
        var inFinderTR = (rr < 8 && cc >= size - 8);
        var inFinderBL = (rr >= size - 8 && cc < 8);
        if (inFinderTL || inFinderTR || inFinderBL || rr === 6 || cc === 6) continue;
        var bitSeed = Math.imul(hash ^ (rr * 31 + cc * 17), 2654435761) >>> 0;
        var charCode = payloadStr.charCodeAt((rr * size + cc) % payloadStr.length) || 7;
        grid[rr][cc] = ((bitSeed + charCode + rr + cc) % 2 === 0) ? 1 : 0;
      }
    }

    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    var pad = 4;
    var cell = (canvas.width - pad * 2) / size;
    ctx.fillStyle = urlVal ? '#0f172a' : '#1e3a8a';
    for (var y = 0; y < size; y++) {
      for (var x = 0; x < size; x++) {
        if (grid[y][x]) {
          ctx.fillRect(Math.floor(pad + x * cell), Math.floor(pad + y * cell), Math.ceil(cell), Math.ceil(cell));
        }
      }
    }
  }

  var F4_LOGISTICS_FIELD_IDS = [
    'f4-log-peso',
    'f4-log-largo',
    'f4-log-ancho',
    'f4-log-alto',
    'f4-log-pallet-qty',
    'f4-log-estiba',
    'f4-log-mat-peligroso',
    'f4-log-un-code',
    'f4-log-hazard-class',
    'f4-log-embalaje-sat',
    'f4-log-fraccion'
  ];

  function clearF4LogisticsManualFlags() {
    F4_LOGISTICS_FIELD_IDS.forEach(function (id) {
      var el = document.getElementById(id);
      if (el && el.dataset) {
        delete el.dataset.userEdited;
      }
    });
    var badge = document.getElementById('pa-f4-auto-logistics-badge');
    if (badge) {
      badge.textContent = '⚡ Carta Porte 3.1: 100% Automático';
      badge.style.background = '#dcfce7';
      badge.style.color = '#15803d';
      badge.style.borderColor = '#86efac';
    }
  }

  function updateF4ActiveRecordBanner() {
    var skuEl = document.getElementById('pa-f4-banner-sku');
    var descEl = document.getElementById('pa-f4-banner-desc');
    var rawSku = String(document.getElementById('pa-sku')?.value || '').trim().toUpperCase();
    var rawDesc = String(document.getElementById('pa-descripcion')?.value || '').trim().toUpperCase();
    if (skuEl) skuEl.textContent = rawSku || 'SIN-SKU';
    if (descEl) descEl.textContent = rawDesc || 'NUEVO ARTÍCULO EN CAPTURA';
  }
  global.updateF4ActiveRecordBanner = updateF4ActiveRecordBanner;

  function _stripAccentsF4(str) {
    return String(str || '')
      .toUpperCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '');
  }

  // ===========================================================================
  // ⚡ REGLA DE HIERRO #2: MOTOR DE INFERENCIA AUTOMÁTICA AL 100% EN
  // `2. Logística, Dimensiones y Carta Porte 3.1 (SAT)` (CERO MEDICIÓN MANUAL)
  // ===========================================================================
  function inferLogisticsAndCartaPorteFromContext() {
    var rawDesc = String(document.getElementById('pa-descripcion')?.value || '').trim().toUpperCase();
    var normDesc = _stripAccentsF4(rawDesc);
    var normFam = _stripAccentsF4(document.getElementById('pa-familia')?.value || '');
    var normDep = _stripAccentsF4(document.getElementById('pa-departamento')?.value || '');
    var normPres = _stripAccentsF4(document.getElementById('pa-pres-compra')?.value || 'PIEZA');
    var normUm = _stripAccentsF4(document.getElementById('pa-unidad-medida')?.value || 'PIEZA');
    var normSatUn = _stripAccentsF4(document.getElementById('pa-sat-unidad')?.value || 'H87');
    var paqQty = Math.max(1, parseFloat(document.getElementById('pa-paquete-qty')?.value || '1') || 1);

    if (!normDesc) {
      return {
        isEmpty: true,
        peso_kg: 0,
        largo_cm: 0,
        ancho_cm: 0,
        alto_cm: 0,
        pallet_qty: 0,
        estiba_max: 0,
        fraccion_arancelaria: '',
        mat_peligroso: false,
        un_code: '',
        hazard_class: '',
        embalaje_sat: ''
      };
    }

    var combined = ' ' + normDesc + ' ' + normFam + ' ' + normDep + ' ';
    var peso = 0;
    var largo = 0;
    var ancho = 0;
    var alto = 0;
    var pallet = 0;
    var estiba = 0;
    var fraccion = '';

    // 1. Reglas de Dominio por Familia / Producto (Ferretería / Construcción / Maderería)
    if (/\b(CEMENTO|MORTERO)\b/.test(normDesc) || (normFam === 'CEMENTO' && !/\b(PEGAZULEJO|ADHESIVO|CREST)\b/.test(normDesc))) {
      peso = 50.000;
      largo = 62.0;
      ancho = 42.0;
      alto = 13.0; // 62 x 42 x 13 cm = 0.033852 m³
      pallet = 40;
      estiba = 8;
      fraccion = '2523.29.99';
    } else if (/\b(ADHESIVO|PEGAZULEJO|ESTUCO|BOQUILLA|CREST)\b/.test(normDesc)) {
      peso = 25.000;
      largo = 50.0;
      ancho = 35.0;
      alto = 11.0;
      pallet = 60;
      estiba = 10;
      fraccion = '3214.90.99';
    } else if (/\b(CALHIDRA|CAL\s+HIDRATADA|YESO|BLANCO\s+DE\s+ESPANA)\b/.test(normDesc)) {
      peso = 25.000;
      largo = 52.0;
      ancho = 36.0;
      alto = 12.0;
      pallet = 60;
      estiba = 8;
      fraccion = '2522.20.01';
    } else if (/\b(BLOCK|BLOQUE)\b/.test(normDesc)) {
      peso = 12.500;
      largo = 40.0;
      ancho = 15.0;
      alto = 20.0; // 40 x 15 x 20 cm = 0.012000 m³
      pallet = 120;
      estiba = 2;
      fraccion = '6810.11.01';
    } else if (/\b(LADRILLO|TABIQUE|TABICON|BOVEDILLA)\b/.test(normDesc)) {
      peso = 2.500;
      largo = 24.0;
      ancho = 12.0;
      alto = 6.0;
      pallet = 500;
      estiba = 2;
      fraccion = '6904.10.01';
    } else if (/\b(ARENA|GRAVA|PIEDRA|TEZONTLE|BALASTRE|TEPEXIL)\b/.test(normDesc)) {
      peso = 1500.000;
      largo = 100.0;
      ancho = 100.0;
      alto = 100.0; // 1.000000 m³
      pallet = 1;
      estiba = 1;
      fraccion = '2505.10.01';
    } else if (/\bVARILLA\b/.test(normDesc) || normFam === 'VARILLA') {
      largo = 1200.0;
      ancho = 1.2;
      alto = 1.2;
      pallet = 100;
      estiba = 5;
      fraccion = '7214.20.01';
      if (/\b3\/8\b/.test(normDesc)) {
        peso = 6.700;
        ancho = 1.0; alto = 1.0;
      } else if (/\b1\/2\b/.test(normDesc)) {
        peso = 11.930;
        ancho = 1.3; alto = 1.3;
      } else if (/\b5\/8\b/.test(normDesc)) {
        peso = 18.600;
        ancho = 1.6; alto = 1.6;
      } else if (/\b3\/4\b/.test(normDesc)) {
        peso = 26.800;
        ancho = 1.9; alto = 1.9;
      } else if (/\b1\s*("|PULG)/.test(normDesc)) {
        peso = 47.600;
        ancho = 2.5; alto = 2.5;
      } else {
        peso = 6.700;
      }
    } else if (/\b(CASTILLO|ARMEX)\b/.test(normDesc)) {
      peso = 7.800;
      largo = 600.0;
      ancho = 15.0;
      alto = 15.0;
      pallet = 50;
      estiba = 4;
      fraccion = '7314.20.01';
    } else if (/\b(ALAMBRON|ALAMBRE\s+RECOCIDO|MALLA\s+ELECTROSOLDADA)\b/.test(normDesc)) {
      peso = (normUm === 'KILOGRAMO' || normUm === 'KG') ? 1.000 : 42.000;
      largo = 60.0;
      ancho = 60.0;
      alto = 25.0;
      pallet = 20;
      estiba = 3;
      fraccion = '7213.91.03';
    } else if (/\b(TUBO\s+PVC|TUBO\s+CPVC|TUBO\s+CONDUIT|CONDUIT|TUBO\s+SANITARIO|TUBO\s+HIDRAULICO|TUBO\s+GALVANIZADO|TUBO\s+DE\s+COBRE|POLIDUCTO)\b/.test(normDesc)) {
      peso = 3.200;
      largo = 600.0;
      ancho = 10.0;
      alto = 10.0;
      pallet = 80;
      estiba = 4;
      fraccion = '3917.23.99';
    } else if (/\b(TRIPLAY|MDF|MELAMINA|TABLA|TABLON|POLIN|BARROTE|VIGA\s+DE\s+MADERA|DUELA|CIMBRA)\b/.test(normDesc) || normFam === 'MADERAS') {
      peso = 18.000;
      largo = 244.0;
      ancho = 122.0;
      alto = 1.8;
      pallet = 50;
      estiba = 4;
      fraccion = '4412.39.99';
    } else if (/\b(TINACO|CISTERNA)\b/.test(normDesc)) {
      peso = 22.500;
      largo = 110.0;
      ancho = 110.0;
      alto = 140.0;
      pallet = 1;
      estiba = 2;
      fraccion = '3925.10.01';
    } else if (/\b(CARRETILLA)\b/.test(normDesc)) {
      peso = 16.500;
      largo = 145.0;
      ancho = 65.0;
      alto = 62.0;
      pallet = 10;
      estiba = 2;
      fraccion = '8716.80.02';
    }

    // 2. Detección explícita de Peso / Volumen en el texto (50 KG, 25 KG, 20 KG, 1 KG, 19 L, 4 L, 1 L, 600 ML, M3)
    var mKg = /(\d+(?:\.\d+)?)\s*(?:KG|KGS|KILO|KILOS|KILOGRAMOS)\b/.exec(normDesc);
    var mGr = /(\d+(?:\.\d+)?)\s*(?:GR|GRS|GRAMOS|G)\b/.exec(normDesc);
    var mTon = /(\d+(?:\.\d+)?)\s*(?:TON|TONS|TONELADA|TONELADAS)\b/.exec(normDesc);
    var mLt = /(\d+(?:\.\d+)?)\s*(?:L|LT|LTS|LITRO|LITROS)\b/.exec(normDesc);
    var mMl = /(\d+(?:\.\d+)?)\s*(?:ML|MILILITROS)\b/.exec(normDesc);
    var hasM3 = /\b(M3|M³|METRO\s+CUBICO|METROS\s+CUBICOS)\b/.test(rawDesc) || /\bM3\b/.test(normDesc) || normUm === 'M3' || normSatUn === 'MTQ';

    if (mKg) {
      peso = parseFloat(mKg[1]) || peso;
    } else if (mTon) {
      peso = (parseFloat(mTon[1]) || 1) * 1000;
    } else if (mGr) {
      peso = Number(((parseFloat(mGr[1]) || 0) / 1000).toFixed(3));
    } else if (hasM3) {
      if (peso <= 0) peso = 1500.000;
      if (largo <= 0) { largo = 100.0; ancho = 100.0; alto = 100.0; }
      if (pallet <= 0) { pallet = 1; estiba = 1; }
      if (!fraccion) fraccion = '2505.10.01';
    } else if (mLt || /\b(CUBETA|GALON)\b/.test(normDesc)) {
      var liters = mLt ? parseFloat(mLt[1]) : (/\bCUBETA\b/.test(normDesc) ? 19 : 4);
      if (Math.abs(liters - 19) <= 1.5 || /\bCUBETA\b/.test(normDesc)) {
        peso = 24.000;
        if (largo <= 0) { largo = 30.0; ancho = 30.0; alto = 38.0; }
        if (pallet <= 0) { pallet = 36; estiba = 3; }
      } else if (Math.abs(liters - 4) <= 0.5 || /\bGALON\b/.test(normDesc)) {
        peso = 4.800;
        if (largo <= 0) { largo = 18.0; ancho = 18.0; alto = 21.0; }
        if (pallet <= 0) { pallet = 120; estiba = 4; }
      } else if (Math.abs(liters - 1) <= 0.2) {
        peso = 1.100;
        if (largo <= 0) { largo = 11.0; ancho = 11.0; alto = 14.0; }
        if (pallet <= 0) { pallet = 240; estiba = 5; }
      } else if (liters > 0 && !/\bTINACO|CISTERNA\b/.test(normDesc)) {
        peso = Number((liters * 1.2).toFixed(3));
        if (largo <= 0) { largo = 25.0; ancho = 25.0; alto = 30.0; }
        if (pallet <= 0) { pallet = 48; estiba = 3; }
      }
      if (!fraccion) fraccion = '3209.10.99';
    } else if (mMl) {
      var mlVal = parseFloat(mMl[1]) || 600;
      peso = Number((mlVal / 1000).toFixed(3));
      if (largo <= 0) { largo = 8.0; ancho = 8.0; alto = 20.0; }
      if (pallet <= 0) { pallet = 300; estiba = 5; }
    }

    // 3. Detección explícita de Dimensiones en el texto (15x20x40, 12 MTS, 6 MTS, 3 MTS, 1/2", 3/8", 4")
    var m3D = /(\d+(?:\.\d+)?)\s*[X×*]\s*(\d+(?:\.\d+)?)\s*[X×*]\s*(\d+(?:\.\d+)?)/.exec(rawDesc.toUpperCase());
    if (m3D) {
      var d1 = parseFloat(m3D[1]) || 0;
      var d2 = parseFloat(m3D[2]) || 0;
      var d3 = parseFloat(m3D[3]) || 0;
      if (/\b(BLOCK|BLOQUE|LADRILLO|TABIQUE)\b/.test(normDesc) && d1 === 15 && d2 === 20 && d3 === 40) {
        largo = 40.0;
        ancho = 15.0;
        alto = 20.0;
      } else {
        largo = Math.max(d1, d3);
        ancho = Math.min(d1, d2);
        alto = d2;
      }
    } else {
      var mMts = /\b(\d+(?:\.\d+)?)\s*(?:MTS|MT|METROS|M)\b/.exec(normDesc);
      if (mMts) {
        var metersVal = parseFloat(mMts[1]) || 0;
        if (metersVal > 0 && metersVal <= 50) {
          largo = Number((metersVal * 100).toFixed(1));
        }
      }
      var mCm = /\b(\d+(?:\.\d+)?)\s*CM\b/.exec(normDesc);
      if (mCm && largo <= 0) {
        largo = parseFloat(mCm[1]) || 0;
      }
      // Detección de pulgadas para diámetro/sección (1/2", 3/8", 5/8", 3/4", 4", etc.)
      var inchVal = 0;
      var mFracIn = /\b(\d+)\/(\d+)\s*(?:"|''|PULG|PULGADAS)?\b/.exec(normDesc);
      var mWholeIn = /\b(\d+(?:\.\d+)?)\s*(?:"|''|PULG|PULGADAS)\b/.exec(normDesc);
      if (mFracIn && parseFloat(mFracIn[2]) > 0) {
        inchVal = parseFloat(mFracIn[1]) / parseFloat(mFracIn[2]);
      } else if (mWholeIn) {
        inchVal = parseFloat(mWholeIn[1]) || 0;
      }
      if (inchVal > 0 && !/\bVARILLA\b/.test(normDesc)) {
        var cmFromIn = Number((inchVal * 2.54).toFixed(1));
        if (/\b(TUBO|CONDUIT|POLIDUCTO|MANGUERA)\b/.test(normDesc)) {
          var tubeD = Math.abs(inchVal - 4) < 0.05 ? 10.0 : Math.max(1.5, cmFromIn);
          ancho = tubeD;
          alto = tubeD;
          if (largo <= 0) largo = 600.0;
        } else if (ancho <= 0 && alto <= 0) {
          var pieceD = Math.max(2.0, cmFromIn);
          if (largo <= 0) largo = Math.max(10.0, Number((pieceD * 2).toFixed(1)));
          ancho = Math.max(5.0, pieceD);
          alto = Math.max(5.0, pieceD);
        }
      }
    }

    // 4. Regla de respaldo para pieza chica / ferretería general (CODO, CONECTOR, APAGADOR, TORNILLO, etc.)
    // Nunca permitir que Carta Porte 3.1 quede en 0.000 kg o 0.000000 m³
    if (peso <= 0) {
      if (normUm === 'KILOGRAMO' || normUm === 'KG' || normSatUn === 'KGM') {
        peso = 1.000;
      } else if (normUm === 'TONELADA' || normUm === 'TON' || normSatUn === 'TNE') {
        peso = 1000.000;
      } else if (normUm === 'LITRO' || normUm === 'LT' || normSatUn === 'LTR') {
        peso = 1.100;
      } else if (normPres === 'BULTO' || normPres === 'SACO') {
        peso = 25.000;
      } else {
        // Unidad PIEZA (H87) o cualquier otra sin peso explícito en texto -> 0.150 kg
        peso = paqQty > 1 ? Number((0.150 * paqQty).toFixed(3)) : 0.150;
      }
    }
    if (largo <= 0 || ancho <= 0 || alto <= 0) {
      largo = 10.0;
      ancho = 10.0;
      alto = 5.0;
    }
    if (pallet <= 0) {
      pallet = peso >= 25 ? 48 : (peso >= 5 ? 80 : 200);
    }
    if (estiba <= 0) {
      estiba = peso >= 25 ? 6 : 5;
    }
    if (!fraccion) {
      if (normFam === 'ELECTRICO') fraccion = '8536.69.99';
      else if (normFam === 'PLOMERIA') fraccion = '3917.40.01';
      else if (normFam === 'ACEROS' || normFam === 'VARILLA') fraccion = '7214.20.01';
      else if (normFam === 'CEMENTO') fraccion = '2523.29.99';
      else if (normFam === 'MADERAS') fraccion = '4407.11.01';
      else fraccion = '7318.15.99';
    }

    // 5. Detección Automática de Material Peligroso (SAT Carta Porte 3.1)
    var isHazmat = /\b(THINNER|SOLVENTE|AGUARRAS|ACIDO|MURIATICO|GAS|AEROSOL|ESMALTE|IMPERMEABILIZANTE\s+ASFALTICO|ASFALTICO|INFLAMABLE|CORROSIVO|BARNIZ|LACA|RESINA\s+POLIESTER|CATALIZADOR|SOSA\s+CAUSTICA)\b/.test(combined);
    var unCode = isHazmat ? 'UN1263' : '';
    var hazardClass = isHazmat ? '3' : '';
    var embalajeSat = isHazmat ? 'III' : '';

    return {
      isEmpty: false,
      peso_kg: Number(peso.toFixed(3)),
      largo_cm: Number(largo.toFixed(1)),
      ancho_cm: Number(ancho.toFixed(1)),
      alto_cm: Number(alto.toFixed(1)),
      pallet_qty: parseInt(pallet, 10) || 1,
      estiba_max: parseInt(estiba, 10) || 1,
      fraccion_arancelaria: fraccion,
      mat_peligroso: isHazmat,
      un_code: unCode,
      hazard_class: hazardClass,
      embalaje_sat: embalajeSat
    };
  }

  function autoInferF4LogisticsFromProductContext(opts) {
    opts = opts || {};
    updateF4ActiveRecordBanner();
    var inferred = inferLogisticsAndCartaPorteFromContext();

    var applyIfNotManual = function (id, stateKey, val, formatter) {
      var el = document.getElementById(id);
      if (!opts.ignoreManual && el && el.dataset && el.dataset.userEdited === '1') {
        return;
      }
      _f4State.logistics[stateKey] = val;
      if (el) {
        el.value = formatter ? formatter(val) : String(val);
      }
    };

    applyIfNotManual('f4-log-peso', 'peso_kg', inferred.peso_kg, function (v) { return (parseFloat(v) || 0).toFixed(3); });
    applyIfNotManual('f4-log-largo', 'largo_cm', inferred.largo_cm, function (v) { return (parseFloat(v) || 0).toFixed(1); });
    applyIfNotManual('f4-log-ancho', 'ancho_cm', inferred.ancho_cm, function (v) { return (parseFloat(v) || 0).toFixed(1); });
    applyIfNotManual('f4-log-alto', 'alto_cm', inferred.alto_cm, function (v) { return (parseFloat(v) || 0).toFixed(1); });
    applyIfNotManual('f4-log-pallet-qty', 'pallet_qty', inferred.pallet_qty, function (v) { return String(parseInt(v, 10) || 0); });
    applyIfNotManual('f4-log-estiba', 'estiba_max', inferred.estiba_max, function (v) { return String(parseInt(v, 10) || 0); });
    applyIfNotManual('f4-log-fraccion', 'fraccion_arancelaria', inferred.fraccion_arancelaria, function (v) { return String(v || ''); });

    var hazChk = document.getElementById('f4-log-mat-peligroso');
    if (opts.ignoreManual || !hazChk || !hazChk.dataset || hazChk.dataset.userEdited !== '1') {
      _f4State.logistics.mat_peligroso = !!inferred.mat_peligroso;
      if (hazChk) hazChk.checked = !!inferred.mat_peligroso;
      applyIfNotManual('f4-log-un-code', 'un_code', inferred.un_code, function (v) { return String(v || ''); });
      applyIfNotManual('f4-log-hazard-class', 'hazard_class', inferred.hazard_class, function (v) { return String(v || ''); });
      applyIfNotManual('f4-log-embalaje-sat', 'embalaje_sat', inferred.embalaje_sat, function (v) { return String(v || ''); });
    }

    recalcF4LogisticsVolume();
    syncF4HazmatVisibility();
    renderF4TechnicalQrCanvas();
  }
  global.autoInferF4LogisticsFromProductContext = autoInferF4LogisticsFromProductContext;

  function syncF4InputsFromState() {
    updateF4ActiveRecordBanner();
    var log = _f4State.logistics || {};
    var setVal = function (id, v) {
      var el = document.getElementById(id);
      if (el) el.value = v;
    };
    setVal('f4-log-peso', (parseFloat(log.peso_kg) || 0).toFixed(3));
    setVal('f4-log-largo', (parseFloat(log.largo_cm) || 0).toFixed(1));
    setVal('f4-log-ancho', (parseFloat(log.ancho_cm) || 0).toFixed(1));
    setVal('f4-log-alto', (parseFloat(log.alto_cm) || 0).toFixed(1));
    setVal('f4-log-pallet-qty', parseInt(log.pallet_qty, 10) || 0);
    setVal('f4-log-estiba', parseInt(log.estiba_max, 10) || 0);
    var hazChk = document.getElementById('f4-log-mat-peligroso');
    if (hazChk) hazChk.checked = !!log.mat_peligroso;
    setVal('f4-log-un-code', log.un_code || '');
    setVal('f4-log-hazard-class', log.hazard_class || '');
    setVal('f4-log-embalaje-sat', log.embalaje_sat || '');
    setVal('f4-log-pais', log.pais_origen || 'MÉXICO');
    setVal('f4-log-fraccion', log.fraccion_arancelaria || '');
    setVal('f4-log-pedimento', log.pedimento_reciente || '');
    recalcF4LogisticsVolume();
    syncF4HazmatVisibility();

    var sp = _f4State.specs || {};
    setVal('f4-spec-licitacion-desc', sp.licitacion_desc || '');
    setVal('f4-spec-video-url', sp.video_url || '');
    var licCounter = document.getElementById('f4-spec-lic-counter');
    if (licCounter) licCounter.textContent = String((sp.licitacion_desc || '').length) + '/1500';

    renderF4DocumentsVault();
    renderF4SuppliersTable();
    renderF4EquivalentsTable();
    renderF4SpecsTable();
    renderF4TechnicalQrCanvas();
  }

  global.initComplementsF4Controller = function () {
    var panel = document.getElementById('pa-tab-complementos-f4');
    if (!panel || panel.__f4Initialized) return;
    panel.__f4Initialized = true;

    // Input de archivo para Bóveda Documental
    var docFileInp = document.getElementById('pa-f4-doc-file-input');
    if (docFileInp) {
      docFileInp.addEventListener('change', function () {
        var file = docFileInp.files && docFileInp.files[0];
        if (!file || !_f4ActiveUploadDocKey) return;
        var targetKey = _f4ActiveUploadDocKey;
        var reader = new FileReader();
        reader.onload = function (ev) {
          if (!_f4State.documents[targetKey]) {
            _f4State.documents[targetKey] = { key: targetKey, attachQuote: true };
          }
          _f4State.documents[targetKey].fileName = file.name;
          _f4State.documents[targetKey].mimeType = file.type || 'application/pdf';
          _f4State.documents[targetKey].dataUrl = ev.target.result;
          _f4State.documents[targetKey].uploadedAt = new Date().toISOString();
          renderF4DocumentsVault();
          _showMsg('📁 Documento "' + file.name + '" cargado en Bóveda Documental.', 'success');
        };
        reader.readAsDataURL(file);
      });
    }

    // Cerrar visor de documentos F4
    var prevModal = document.getElementById('pa-f4-doc-preview-modal');
    var prevClose = document.getElementById('pa-f4-doc-preview-close');
    if (prevClose && prevModal) {
      prevClose.addEventListener('click', function () { prevModal.style.display = 'none'; });
    }
    if (prevModal) {
      prevModal.addEventListener('click', function (e) {
        if (e.target === prevModal) prevModal.style.display = 'none';
      });
    }

    // Eventos de Logística y Carta Porte 3.1 + Respeto a Edición Manual Excepcional
    var markManualEditF4 = function (el) {
      if (_isPopulatingRealProduct) return;
      if (el && el.dataset) {
        el.dataset.userEdited = '1';
      }
      _f4State.logistics._manual_override = true;
      var badge = document.getElementById('pa-f4-auto-logistics-badge');
      if (badge) {
        badge.textContent = '✏️ Carta Porte 3.1: Ajuste Manual Respetado';
        badge.style.background = '#eff6ff';
        badge.style.color = '#1d4ed8';
        badge.style.borderColor = '#93c5fd';
      }
    };

    ['f4-log-largo', 'f4-log-ancho', 'f4-log-alto'].forEach(function (id) {
      var el = document.getElementById(id);
      if (el) {
        el.addEventListener('input', function (ev) {
          if (ev && ev.isTrusted) markManualEditF4(el);
          recalcF4LogisticsVolume();
        });
      }
    });

    ['f4-log-peso', 'f4-log-pallet-qty', 'f4-log-estiba', 'f4-log-un-code', 'f4-log-hazard-class', 'f4-log-embalaje-sat', 'f4-log-fraccion'].forEach(function (id) {
      var el = document.getElementById(id);
      if (el) {
        el.addEventListener('input', function (ev) {
          if (ev && ev.isTrusted) markManualEditF4(el);
        });
      }
    });

    var hazMatEl = document.getElementById('f4-log-mat-peligroso');
    if (hazMatEl) {
      hazMatEl.addEventListener('change', function (ev) {
        if (ev && ev.isTrusted) {
          markManualEditF4(hazMatEl);
          if (hazMatEl.checked) {
            var unEl = document.getElementById('f4-log-un-code');
            var clEl = document.getElementById('f4-log-hazard-class');
            var emEl = document.getElementById('f4-log-embalaje-sat');
            if (unEl && !unEl.value.trim()) unEl.value = 'UN1263';
            if (clEl && !clEl.value.trim()) clEl.value = '3';
            if (emEl && !emEl.value.trim()) emEl.value = 'III';
          }
        }
        syncF4HazmatVisibility();
      });
    }

    // Conectar listeners reactivos a Información General [F1] para autocálculo 100% silencioso en tiempo real
    var f1SkuInp = document.getElementById('pa-sku');
    if (f1SkuInp && !f1SkuInp.__f4BannerBound) {
      f1SkuInp.__f4BannerBound = true;
      f1SkuInp.addEventListener('input', function () {
        updateF4ActiveRecordBanner();
        renderF4TechnicalQrCanvas();
      });
    }

    var F1_REACTIVE_LOGISTICS_IDS = [
      'pa-descripcion',
      'pa-pres-compra',
      'pa-paquete',
      'pa-paquete-qty',
      'pa-unidad-medida',
      'pa-sat-unidad',
      'pa-familia',
      'pa-departamento'
    ];
    F1_REACTIVE_LOGISTICS_IDS.forEach(function (id) {
      var f1El = document.getElementById(id);
      if (f1El && !f1El.__f4AutoLogisticsBound) {
        f1El.__f4AutoLogisticsBound = true;
        var handler = function () {
          if (_isPopulatingRealProduct) return;
          autoInferF4LogisticsFromProductContext();
        };
        f1El.addEventListener('input', handler);
        f1El.addEventListener('change', handler);
      }
    });

    // Eventos de Multi-Proveedor
    var btnAddProv = document.getElementById('f4-prov-add-btn');
    var addSupplierHandler = function () {
      var nameInp = document.getElementById('f4-prov-name');
      var xmlInp  = document.getElementById('f4-prov-xml-sku');
      var costInp = document.getElementById('f4-prov-cost');
      var curSel  = document.getElementById('f4-prov-currency');
      var daysInp = document.getElementById('f4-prov-lead-days');
      var minInp  = document.getElementById('f4-prov-min-qty');

      var pName = String(nameInp ? nameInp.value : '').trim().toUpperCase();
      var xSku  = String(xmlInp ? xmlInp.value : '').trim().toUpperCase();
      if (!pName || !xSku) {
        _showMsg('Ingresa el Proveedor y el SKU/Código en su Factura XML.', 'warning');
        if (!pName && nameInp) nameInp.focus();
        else if (xmlInp) xmlInp.focus();
        return;
      }

      _f4State.suppliers.push({
        provider_name: pName,
        xml_sku: xSku,
        cost: parseFloat(costInp ? costInp.value : '0') || 0,
        currency: (curSel && curSel.value) || 'MXN',
        lead_days: parseInt(daysInp ? daysInp.value : '1', 10) || 1,
        min_qty: parseFloat(minInp ? minInp.value : '1') || 1,
        is_primary: _f4State.suppliers.length === 0
      });

      if (nameInp) nameInp.value = '';
      if (xmlInp) xmlInp.value = '';
      if (costInp) costInp.value = '0.00';
      renderF4SuppliersTable();
      if (nameInp) nameInp.focus();
    };
    if (btnAddProv) btnAddProv.addEventListener('click', addSupplierHandler);
    ['f4-prov-xml-sku', 'f4-prov-cost'].forEach(function (id) {
      document.getElementById(id)?.addEventListener('keydown', function (ev) {
        if (ev.key === 'Enter') {
          ev.preventDefault();
          addSupplierHandler();
        }
      });
    });

    // Eventos de Buscador de Productos Equivalentes / Sustitutos
    var eqSearchInp = document.getElementById('f4-eq-search-inp');
    var eqSearchDd  = document.getElementById('f4-eq-search-dd');
    var eqAddBtn    = document.getElementById('f4-eq-add-btn');
    if (eqSearchInp) {
      eqSearchInp.addEventListener('input', function () {
        _f4SelectedEqCandidate = null;
        renderF4EquivalentsDropdown(eqSearchInp.value);
      });
      eqSearchInp.addEventListener('focus', function () {
        if (eqSearchInp.value.trim()) renderF4EquivalentsDropdown(eqSearchInp.value);
      });
      eqSearchInp.addEventListener('keydown', function (ev) {
        if (ev.key === 'Enter') {
          ev.preventDefault();
          addF4EquivalentProduct();
        } else if (ev.key === 'Escape' && eqSearchDd) {
          eqSearchDd.style.display = 'none';
        }
      });
    }
    if (eqAddBtn) {
      eqAddBtn.addEventListener('click', function () {
        addF4EquivalentProduct();
      });
    }
    document.addEventListener('mousedown', function (ev) {
      if (eqSearchDd && eqSearchDd.style.display !== 'none') {
        if (!eqSearchDd.contains(ev.target) && ev.target !== eqSearchInp) {
          eqSearchDd.style.display = 'none';
        }
      }
    });

    // Eventos de Especificaciones Técnicas, Plantillas por Giro, Licitaciones y QR
    document.getElementById('f4-spec-add-btn')?.addEventListener('click', function () {
      _f4State.specs.items.push({ attr: '', val: '' });
      renderF4SpecsTable();
    });

    document.getElementById('f4-spec-load-tpl-btn')?.addEventListener('click', function () {
      var tplSel = document.getElementById('f4-spec-template-sel');
      var key = tplSel ? tplSel.value : '';
      if (!key || !F4_SPEC_TEMPLATES[key]) {
        _showMsg('Selecciona primero una Plantilla Rápida por Giro.', 'info');
        return;
      }
      var tplRows = F4_SPEC_TEMPLATES[key];
      var currentItems = _f4State.specs.items.filter(function (x) {
        return (x.attr && x.attr.trim()) || (x.val && x.val.trim());
      });
      tplRows.forEach(function (tr) {
        var exists = currentItems.some(function (c) { return String(c.attr).toUpperCase() === tr.attr; });
        if (!exists) {
          currentItems.push({ attr: tr.attr, val: tr.val });
        }
      });
      _f4State.specs.items = currentItems;
      renderF4SpecsTable();
      _showMsg('⚡ Plantilla de especificaciones cargada. Completa los valores técnicos.', 'success');
    });

    var licDescEl = document.getElementById('f4-spec-licitacion-desc');
    var licCountEl = document.getElementById('f4-spec-lic-counter');
    if (licDescEl) {
      licDescEl.addEventListener('input', function () {
        _f4State.specs.licitacion_desc = licDescEl.value.toUpperCase();
        if (licCountEl) licCountEl.textContent = licDescEl.value.length + '/1500';
      });
    }

    var videoUrlEl = document.getElementById('f4-spec-video-url');
    if (videoUrlEl) {
      videoUrlEl.addEventListener('input', function () {
        _f4State.specs.video_url = videoUrlEl.value.trim();
        renderF4TechnicalQrCanvas();
      });
    }

    document.getElementById('f4-spec-qr-download-btn')?.addEventListener('click', function () {
      renderF4TechnicalQrCanvas();
      var canvas = document.getElementById('f4-spec-qr-canvas');
      if (!canvas) return;
      var sku = String(document.getElementById('pa-sku')?.value || 'PRODUCTO').trim().toUpperCase();
      var a = document.createElement('a');
      a.href = canvas.toDataURL('image/png');
      a.download = 'QR_TECNICO_' + sku + '.png';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    });

    document.getElementById('f4-spec-qr-print-btn')?.addEventListener('click', function () {
      renderF4TechnicalQrCanvas();
      var canvas = document.getElementById('f4-spec-qr-canvas');
      if (!canvas) return;
      var sku = String(document.getElementById('pa-sku')?.value || 'SIN-SKU').trim().toUpperCase();
      var desc = String(document.getElementById('pa-descripcion')?.value || 'PRODUCTO').trim().toUpperCase();
      var url = String(document.getElementById('f4-spec-video-url')?.value || '').trim();
      var qrDataUrl = canvas.toDataURL('image/png');
      var specsHtml = (_f4State.specs.items || []).filter(function (s) { return s.attr || s.val; }).map(function (s) {
        return '<tr><td style="padding:4px 8px;border:1px solid #cbd5e1;font-weight:700;">' + _escF4(s.attr) + '</td><td style="padding:4px 8px;border:1px solid #cbd5e1;">' + _escF4(s.val) + '</td></tr>';
      }).join('');
      var w = window.open('', '_blank', 'width=680,height=640');
      if (!w) return;
      w.document.write(
        '<html><head><title>Ficha QR Técnico - ' + _escF4(sku) + '</title></head>' +
        '<body style="font-family:Arial,sans-serif;padding:24px;color:#0f172a;">' +
          '<div style="display:flex;align-items:center;justify-content:space-between;border-bottom:2px solid #1e3a8a;padding-bottom:12px;margin-bottom:16px;">' +
            '<div>' +
              '<div style="font-size:12px;font-weight:800;color:#2563eb;">CALEBSYS ERP · FICHA TÉCNICA & QR</div>' +
              '<h2 style="margin:4px 0;font-size:18px;">' + _escF4(desc) + '</h2>' +
              '<div style="font-family:monospace;font-size:13px;font-weight:700;">SKU: ' + _escF4(sku) + '</div>' +
              (url ? '<div style="font-size:11px;color:#475569;margin-top:4px;">URL: ' + _escF4(url) + '</div>' : '') +
            '</div>' +
            '<div style="text-align:center;">' +
              '<img src="' + qrDataUrl + '" style="width:120px;height:120px;border:1px solid #cbd5e1;padding:6px;border-radius:8px;">' +
              '<div style="font-size:10px;font-weight:800;margin-top:4px;">ESCANEAR FICHA / VIDEO</div>' +
            '</div>' +
          '</div>' +
          (specsHtml ? '<table style="width:100%;border-collapse:collapse;font-size:12px;margin-bottom:14px;"><thead><tr style="background:#f1f5f9;"><th style="padding:6px 8px;border:1px solid #cbd5e1;text-align:left;">CARACTERÍSTICA</th><th style="padding:6px 8px;border:1px solid #cbd5e1;text-align:left;">VALOR TÉCNICO</th></tr></thead><tbody>' + specsHtml + '</tbody></table>' : '') +
          (_f4State.specs.licitacion_desc ? '<div style="font-size:12px;background:#f8fafc;border:1px solid #cbd5e1;padding:10px;border-radius:6px;"><strong>DESCRIPCIÓN EXTENDIDA DE LICITACIÓN:</strong><br>' + _escF4(_f4State.specs.licitacion_desc) + '</div>' : '') +
          '<script>window.onload=function(){window.print();};<\/script>' +
        '</body></html>'
      );
      w.document.close();
    });

    document.getElementById('f4-spec-open-url-btn')?.addEventListener('click', function () {
      var u = String(document.getElementById('f4-spec-video-url')?.value || '').trim();
      if (!u) {
        _showMsg('Ingresa primero una URL de video demostrativo o catálogo web.', 'info');
        return;
      }
      if (!/^https?:\/\//i.test(u)) u = 'https://' + u;
      window.open(u, '_blank', 'noopener');
    });

    syncF4InputsFromState();
  };

  global.refreshComplementsF4View = function () {
    if (typeof global.initComplementsF4Controller === 'function') {
      global.initComplementsF4Controller();
    }
    updateF4ActiveRecordBanner();
    // Si el usuario ya escribió descripción en F1 y los campos logísticos siguen en 0, calcular al instante
    var curPeso = parseFloat(document.getElementById('f4-log-peso')?.value || '0') || 0;
    var curLargo = parseFloat(document.getElementById('f4-log-largo')?.value || '0') || 0;
    var hasDesc = !!String(document.getElementById('pa-descripcion')?.value || '').trim();
    if (hasDesc && curPeso <= 0 && curLargo <= 0) {
      autoInferF4LogisticsFromProductContext();
    }
    renderF4DocumentsVault();
    renderF4SuppliersTable();
    renderF4EquivalentsTable();
    renderF4SpecsTable();
    renderF4TechnicalQrCanvas();
  };

  global.resetComplementsF4ForNewForm = function () {
    _f4State = _createEmptyF4State();
    clearF4LogisticsManualFlags();
    syncF4InputsFromState();
  };

  global.loadComplementsF4FromProduct = function (prod) {
    _f4State = _createEmptyF4State();
    clearF4LogisticsManualFlags();
    var meta = (prod && prod.meta_data && typeof prod.meta_data === 'object') ? prod.meta_data : {};
    var saved = (meta.complements_f4 && typeof meta.complements_f4 === 'object') ? meta.complements_f4 : null;
    if (saved) {
      if (saved.documents && typeof saved.documents === 'object') {
        F4_DOC_SLOTS_DEF.forEach(function (d) {
          if (saved.documents[d.key]) {
            _f4State.documents[d.key] = Object.assign({}, _f4State.documents[d.key], saved.documents[d.key]);
          }
        });
      }
      if (saved.logistics && typeof saved.logistics === 'object') {
        _f4State.logistics = Object.assign({}, _f4State.logistics, saved.logistics);
      }
      if (Array.isArray(saved.suppliers)) {
        _f4State.suppliers = JSON.parse(JSON.stringify(saved.suppliers));
      }
      if (Array.isArray(saved.equivalents)) {
        _f4State.equivalents = JSON.parse(JSON.stringify(saved.equivalents));
      }
      if (saved.specs && typeof saved.specs === 'object') {
        _f4State.specs = {
          items: Array.isArray(saved.specs.items) ? JSON.parse(JSON.stringify(saved.specs.items)) : _f4State.specs.items,
          licitacion_desc: String(saved.specs.licitacion_desc || ''),
          video_url: String(saved.specs.video_url || '')
        };
      }
    }
    syncF4InputsFromState();

    // Si el producto guardado tenía medidas/peso en 0, calcular automáticamente con el motor Carta Porte 3.1
    var savedPeso = parseFloat(_f4State.logistics.peso_kg || 0) || 0;
    var savedLargo = parseFloat(_f4State.logistics.largo_cm || 0) || 0;
    if (savedPeso <= 0 || savedLargo <= 0) {
      autoInferF4LogisticsFromProductContext({ ignoreManual: true });
    } else if (_f4State.logistics._manual_override) {
      F4_LOGISTICS_FIELD_IDS.forEach(function (id) {
        var el = document.getElementById(id);
        if (el && el.dataset) el.dataset.userEdited = '1';
      });
      var badge = document.getElementById('pa-f4-auto-logistics-badge');
      if (badge) {
        badge.textContent = '✏️ Carta Porte 3.1: Ajuste Manual Respetado';
        badge.style.background = '#eff6ff';
        badge.style.color = '#1d4ed8';
        badge.style.borderColor = '#93c5fd';
      }
    }
  };

  global.collectComplementsF4Payload = function () {
    // Si el producto tiene descripción pero aún tenía 0 en logística y no fue editado a mano, autocalcular antes de guardar
    var curPeso = parseFloat(document.getElementById('f4-log-peso')?.value || '0') || 0;
    var curLargo = parseFloat(document.getElementById('f4-log-largo')?.value || '0') || 0;
    if (curPeso <= 0 || curLargo <= 0) {
      autoInferF4LogisticsFromProductContext();
    }
    recalcF4LogisticsVolume();
    _f4State.logistics.peso_kg = parseFloat(document.getElementById('f4-log-peso')?.value || '0') || 0;
    _f4State.logistics.pallet_qty = parseInt(document.getElementById('f4-log-pallet-qty')?.value || '0', 10) || 0;
    _f4State.logistics.estiba_max = parseInt(document.getElementById('f4-log-estiba')?.value || '0', 10) || 0;
    _f4State.logistics.mat_peligroso = !!document.getElementById('f4-log-mat-peligroso')?.checked;
    _f4State.logistics.un_code = String(document.getElementById('f4-log-un-code')?.value || '').trim().toUpperCase();
    _f4State.logistics.hazard_class = String(document.getElementById('f4-log-hazard-class')?.value || '').trim().toUpperCase();
    _f4State.logistics.embalaje_sat = String(document.getElementById('f4-log-embalaje-sat')?.value || '').trim().toUpperCase();
    _f4State.logistics.pais_origen = String(document.getElementById('f4-log-pais')?.value || 'MÉXICO').trim().toUpperCase();
    _f4State.logistics.fraccion_arancelaria = String(document.getElementById('f4-log-fraccion')?.value || '').trim().toUpperCase();
    _f4State.logistics.pedimento_reciente = String(document.getElementById('f4-log-pedimento')?.value || '').trim().toUpperCase();

    _f4State.specs.licitacion_desc = String(document.getElementById('f4-spec-licitacion-desc')?.value || '').trim().toUpperCase();
    _f4State.specs.video_url = String(document.getElementById('f4-spec-video-url')?.value || '').trim();

    return JSON.parse(JSON.stringify(_f4State));
  };

  // ── 6. Impresión de Etiqueta Exclusiva del Artículo Activo [F6] ──
  global.printActiveProductLabelF6 = function () {
    var sku = String(document.getElementById('pa-sku')?.value || '').trim().toUpperCase();
    var barcode = String(document.getElementById('pa-codigo')?.value || sku || '').trim().toUpperCase();
    var desc = String(document.getElementById('pa-descripcion')?.value || '').trim().toUpperCase();
    var price = parseFloat(document.getElementById('pa-precio-final')?.value || '0') || 0;
    var um = String(document.getElementById('pa-unidad-medida')?.value || 'PIEZA').trim().toUpperCase();

    if (!sku && !desc) {
      _showMsg('Captura o selecciona un producto primero para imprimir su etiqueta [F6].', 'warning');
      return;
    }

    renderF4TechnicalQrCanvas();
    var qrCanvas = document.getElementById('f4-spec-qr-canvas');
    var qrImgUrl = qrCanvas ? qrCanvas.toDataURL('image/png') : '';

    var w = window.open('', '_blank', 'width=480,height=340');
    if (!w) return;
    w.document.write(
      '<html><head><title>Etiqueta ' + _escF4(sku || 'PRODUCTO') + '</title></head>' +
      '<body style="font-family:Arial,sans-serif;margin:0;padding:16px;display:flex;align-items:center;justify-content:center;">' +
        '<div style="width:380px;border:2px solid #0f172a;border-radius:10px;padding:12px 14px;box-sizing:border-box;">' +
          '<div style="font-size:10px;font-weight:800;color:#2563eb;letter-spacing:.5px;">MADERAS Y MATERIALES MAGDALENO · CALEBSYS</div>' +
          '<div style="font-size:14px;font-weight:900;color:#0f172a;margin:4px 0 8px;line-height:1.25;">' + _escF4(desc || 'SIN DESCRIPCIÓN') + '</div>' +
          '<div style="display:flex;align-items:center;justify-content:space-between;gap:10px;border-top:1px dashed #94a3b8;padding-top:8px;">' +
            '<div>' +
              '<div style="font-size:11px;font-weight:700;color:#475569;">PRECIO (' + _escF4(um) + '):</div>' +
              '<div style="font-size:26px;font-weight:900;color:#0f172a;font-family:monospace;">$' + price.toFixed(2) + '</div>' +
              '<div style="font-size:11px;font-family:monospace;font-weight:800;color:#1e293b;margin-top:4px;">SKU: ' + _escF4(sku) + '</div>' +
              '<div style="font-size:10px;font-family:monospace;color:#475569;">COD: ' + _escF4(barcode) + '</div>' +
            '</div>' +
            (qrImgUrl ? '<img src="' + qrImgUrl + '" style="width:74px;height:74px;border:1px solid #cbd5e1;padding:3px;border-radius:6px;">' : '') +
          '</div>' +
        '</div>' +
        '<script>window.onload=function(){window.print();};<\/script>' +
      '</body></html>'
    );
    w.document.close();
  };

  // ── 7. Buscador Multi-Proveedor por SKU en XML (Compras / Recepción de Mercancía CFDI 4.0) ──
  global.findProductBySupplierXmlSkuSync = function (rfcOrSupplier, xmlSku, catalogArray) {
    var targetXmlSku = String(xmlSku || '').trim().toUpperCase();
    var targetSupplier = String(rfcOrSupplier || '').trim().toUpperCase();
    if (!targetXmlSku) return null;

    var list = Array.isArray(catalogArray)
      ? catalogArray
      : (Array.isArray(global._productsCatalogCache) ? global._productsCatalogCache : (Array.isArray(global.productsCatalogCache) ? global.productsCatalogCache : []));

    for (var i = 0; i < list.length; i++) {
      var prod = list[i];
      if (!prod) continue;
      var meta = (prod.meta_data && typeof prod.meta_data === 'object') ? prod.meta_data : {};
      var f4 = (meta.complements_f4 && typeof meta.complements_f4 === 'object') ? meta.complements_f4 : {};
      var suppliers = Array.isArray(f4.suppliers) ? f4.suppliers : [];
      for (var s = 0; s < suppliers.length; s++) {
        var sup = suppliers[s] || {};
        var supXmlSku = String(sup.xml_sku || '').trim().toUpperCase();
        var supName = String(sup.name || '').trim().toUpperCase();
        if (supXmlSku && supXmlSku === targetXmlSku) {
          if (!targetSupplier || !supName || supName.indexOf(targetSupplier) !== -1 || targetSupplier.indexOf(supName) !== -1) {
            return {
              product: prod,
              supplierMatch: sup,
              conversionFactor: parseFloat(sup.factor || 1) || 1,
              lastCost: parseFloat(sup.last_cost || prod.last_cost || 0) || 0
            };
          }
        }
      }
    }
    return null;
  };

  global.findProductBySupplierXmlSku = async function (rfcOrSupplier, xmlSku, catalogOptional) {
    var syncHit = global.findProductBySupplierXmlSkuSync(rfcOrSupplier, xmlSku, catalogOptional);
    if (syncHit) return syncHit;

    try {
      var token = localStorage.getItem('token') || sessionStorage.getItem('token') || '';
      var headers = { 'Accept': 'application/json' };
      if (token) headers['Authorization'] = 'Bearer ' + token;
      var resp = await fetch('/api/products?limit=500', { headers: headers });
      if (resp.ok) {
        var allProds = await resp.json();
        if (Array.isArray(allProds)) {
          global._productsCatalogCache = allProds;
          return global.findProductBySupplierXmlSkuSync(rfcOrSupplier, xmlSku, allProds);
        }
      }
    } catch (_e) {}
    return null;
  };

})(window);
