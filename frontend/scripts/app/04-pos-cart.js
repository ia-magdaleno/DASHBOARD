/* 04-pos-cart.js — Cart actions & calculation
   Extraido de app_v66.js (fase 3, modularizacion post-auditoria 2026-08-03)
   Lineas originales: 2124-2415 */
// --- CART ACTIONS & CALCULATION ---

/* NR-03 — Resolución de precio por escala de cliente
 * Prioridad de resolución:
 *   1. assigned_price_scale del cliente (campo real de BD, llega desde /api/clients)
 *   2. scaleName pasado como string directo (cuando el cajero cambia escala manualmente)
 *   3. client_type como fallback legacy (compatibilidad con objetos sin assigned_price_scale)
 *   4. "Público General" → precio base sin modificar
 *
 * El producto debe llevar price_scales [] para que el lookup sea real;
 * si price_scales está vacío cae directo al precio base (retrocompatible).
 */
function _normScaleNamePOS(str) {
  return String(str || "")
    .trim()
    .toUpperCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function _isListPriceScaleAliasPOS(normName) {
  return (
    normName === "PRECIO DE LISTA" ||
    normName === "PUBLICO GENERAL" ||
    normName === "PUBLICO EN GENERAL" ||
    normName === "PRECIO PUBLICO" ||
    normName === "LISTA" ||
    normName === "MENUDEO"
  );
}

function _scaleNamesMatchPOS(a, b) {
  const na = _normScaleNamePOS(a);
  const nb = _normScaleNamePOS(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  if (_isListPriceScaleAliasPOS(na) && _isListPriceScaleAliasPOS(nb)) return true;
  return false;
}

function _getActivePosBranchInfo() {
  const badgeEl = document.getElementById("branch-Badge") || document.getElementById("pos-branch-badge");
  const badgeText = badgeEl ? (badgeEl.textContent || "").trim() : "";
  const bId =
    sessionStorage.getItem("active_sucursal_id") ||
    localStorage.getItem("active_sucursal_id") ||
    localStorage.getItem("calebsys_sucursal") ||
    localStorage.getItem("calebsys_branch") ||
    badgeText ||
    "MATRIZ";
  const bName =
    sessionStorage.getItem("active_sucursal_nombre") ||
    localStorage.getItem("active_sucursal_nombre") ||
    localStorage.getItem("calebsys_sucursal") ||
    localStorage.getItem("calebsys_branch") ||
    badgeText ||
    "MATRIZ";
  return {
    id: _normScaleNamePOS(bId),
    name: _normScaleNamePOS(bName)
  };
}

/* ── Blindaje Financiero POS: Costo Piso Intocable, Escalones de Volumen, Bloqueo 0 Puntos y Comisión Real ── */
function getProductCostoPisoInfoPOS(productOrItem) {
  if (!productOrItem) return { unitCostWithFreight: 0, factorTax: 1.16, costoPisoConIva: 0 };
  const meta = (productOrItem.meta_data && typeof productOrItem.meta_data === "object") ? productOrItem.meta_data : {};
  const kardex = (meta.kardex && typeof meta.kardex === "object") ? meta.kardex : {};
  const exentoIva = !!kardex.exento_iva;
  const ivaPct = exentoIva ? 0 : (parseFloat(meta.iva != null ? meta.iva : 16) || 0);
  const iepsPct = parseFloat(meta.ieps != null ? meta.ieps : 0) || 0;
  const factorTax = (1 + (ivaPct / 100)) * (1 + (iepsPct / 100));

  let unitCostWithFreight = parseFloat(
    meta.costo_pieza_con_flete ?? meta.costo_con_flete ?? productOrItem.average_cost ?? meta.costo_raw ?? 0
  ) || 0;

  const costoPisoConIva = unitCostWithFreight > 0
    ? Number((unitCostWithFreight * factorTax).toFixed(2))
    : 0;

  return {
    unitCostWithFreight,
    ivaPct,
    iepsPct,
    exentoIva,
    factorTax,
    costoPisoConIva
  };
}

function showCostoPisoSecurityAlertPOS(costoPisoVal) {
  const msg = `🛑 BLOQUEO DE SEGURIDAD: No se permite aplicar un descuento menor al Precio de Costo con Flete + IVA ($${Number(costoPisoVal || 0).toFixed(2)})`;
  if (typeof showToast === "function") {
    showToast(msg, "error");
  } else {
    alert(msg);
  }
}

function evaluatePosItemFinancials(productOrItem, clientOrScaleName, explicitQty) {
  if (!productOrItem) {
    return {
      unitPrice: 0,
      normalPrice: 0,
      costoPisoConIva: 0,
      offerApplied: false,
      offerLabel: "",
      pointsLocked: false,
      earnedPoints: 0,
      commissionPct: 0,
      commissionAmountMxn: 0
    };
  }

  let scaleName;
  if (typeof clientOrScaleName === "string" && clientOrScaleName.trim()) {
    scaleName = clientOrScaleName.trim();
  } else if (clientOrScaleName && clientOrScaleName.assigned_price_scale) {
    scaleName = clientOrScaleName.assigned_price_scale;
  } else if (clientOrScaleName && clientOrScaleName.client_type) {
    scaleName = clientOrScaleName.client_type;
  } else {
    scaleName = "PRECIO DE LISTA";
  }

  const meta = (productOrItem.meta_data && typeof productOrItem.meta_data === "object")
    ? productOrItem.meta_data
    : {};
  const kardexFlags = (meta.kardex && typeof meta.kardex === "object") ? meta.kardex : {};
  const branchInfo = _getActivePosBranchInfo();
  const basePriceFallback = parseFloat(productOrItem.base_price) || parseFloat(productOrItem.price) || 0;
  const pisoInfo = getProductCostoPisoInfoPOS(productOrItem);
  let unitCostWithFreight = pisoInfo.unitCostWithFreight;
  const factorIva = pisoInfo.factorTax;
  let costoPisoConIva = pisoInfo.costoPisoConIva;

  let globalScales = [];
  let globalBranchScales = [];
  try {
    globalScales = JSON.parse(localStorage.getItem("calebsys_price_scales_v1") || "[]");
    if (!Array.isArray(globalScales)) globalScales = [];
  } catch (e) { globalScales = []; }
  try {
    globalBranchScales = JSON.parse(localStorage.getItem("calebsys_branch_price_scales_v1") || "[]");
    if (!Array.isArray(globalBranchScales)) globalBranchScales = [];
  } catch (e) { globalBranchScales = []; }

  if (unitCostWithFreight <= 0 && basePriceFallback > 0) {
    const listScale = globalScales.find(s => s && _isListPriceScaleAliasPOS(_normScaleNamePOS(s.name || s.scale_name)));
    const listMargin = listScale ? ((parseFloat(listScale.margen_ideal) || 25) - (parseFloat(listScale.oferta) || 0)) : 25;
    const denom = (1 + listMargin / 100) * factorIva;
    if (denom > 0) {
      unitCostWithFreight = basePriceFallback / denom;
      costoPisoConIva = Number((unitCostWithFreight * factorIva).toFixed(2));
    }
  }

  const isPosMatriz = !branchInfo.id ||
    branchInfo.id === "MATRIZ" ||
    branchInfo.name === "MATRIZ" ||
    branchInfo.name === "MADERAS Y MATERIALES MAGDALENO";

  const prodBranchScales = Array.isArray(meta.branch_price_scales) ? meta.branch_price_scales : [];
  const metaScales = Array.isArray(meta.price_scales) ? meta.price_scales : [];
  const ormScales = Array.isArray(productOrItem.price_scales) ? productOrItem.price_scales : [];
  const combinedScales = metaScales.length > 0 ? metaScales : ormScales;

  const itemQty = Math.max(1, Math.abs(parseFloat(explicitQty != null ? explicitQty : productOrItem.quantity) || 1));
  const activePaymentMethod = String(window.activePosPaymentMethod || "EFECTIVO").toUpperCase();

  // Determinar Margen Normal, Precio Normal y Comisión Base de la escala/sucursal
  let normalMargin = 50;
  let normalUnitPrice = basePriceFallback;
  let baseCommissionPct = 0;
  let scaleDirectOfferPct = 0;

  if (!isPosMatriz && prodBranchScales.length > 0 && (branchInfo.id || branchInfo.name)) {
    const bm = prodBranchScales.find(bs => {
      if (!bs || bs.activa === false || bs.active === false) return false;
      const bsId = _normScaleNamePOS(bs.branch_id || bs.branch);
      const bsName = _normScaleNamePOS(bs.branch_name || bs.branch);
      const sameBranch =
        (branchInfo.id && (bsId === branchInfo.id || bsName === branchInfo.id)) ||
        (branchInfo.name && (bsName === branchInfo.name || bsId === branchInfo.name));
      return sameBranch && _scaleNamesMatchPOS(bs.scale_name, scaleName);
    });
    if (bm) {
      normalMargin = (parseFloat(bm.margen_ideal) || 0) + (parseFloat(bm.sobreprecio_suc) || 0);
      scaleDirectOfferPct = parseFloat(bm.oferta) || 0;
      baseCommissionPct = parseFloat(bm.comision) || 0;
      if (unitCostWithFreight > 0) {
        normalUnitPrice = Number((unitCostWithFreight * (1 + normalMargin / 100) * factorIva).toFixed(2));
      } else if (parseFloat(bm.precio || bm.price) > 0) {
        normalUnitPrice = parseFloat(bm.precio || bm.price);
      }
    }
  } else if (combinedScales.length > 0) {
    const sm = combinedScales.find(s => s && s.activa !== false && s.active !== false && _scaleNamesMatchPOS(s.scale_name || s.nombre || s.name, scaleName));
    if (sm) {
      normalMargin = parseFloat(sm.margen_ideal) || 0;
      scaleDirectOfferPct = parseFloat(sm.oferta) || 0;
      baseCommissionPct = parseFloat(sm.comision) || 0;
      if (unitCostWithFreight > 0) {
        normalUnitPrice = Number((unitCostWithFreight * (1 + normalMargin / 100) * factorIva).toFixed(2));
      } else if (parseFloat(sm.precio_activo ?? sm.precio ?? sm.price) > 0) {
        normalUnitPrice = parseFloat(sm.precio_activo ?? sm.precio ?? sm.price);
      }
    }
  }

  let finalUnitPrice = normalUnitPrice;
  let offerApplied = false;
  let offerLabel = "";
  let forceZeroCommission = false;

  // 0. Evaluar ofertas registradas (`product_offers` F3) incluyendo Tabla Multiescalón de Volumen
  const prodOffers = Array.isArray(meta.product_offers) ? meta.product_offers : [];
  if (prodOffers.length > 0) {
    const nowMs = Date.now();
    const matchingOffer = prodOffers.find(ofIt => {
      if (!ofIt || ofIt.paused) return false;
      const bScope = _normScaleNamePOS(ofIt.branch_scope || "ALL");
      const brList = Array.isArray(ofIt.branches) ? ofIt.branches.map(_normScaleNamePOS) : [];
      if (isPosMatriz) {
        if (bScope !== "ALL" && bScope !== "MATRIZ" && !brList.includes("MATRIZ") && !brList.includes("ALL")) return false;
      } else {
        const matchBr = bScope === "ALL" ||
          bScope === branchInfo.id ||
          bScope === branchInfo.name ||
          brList.includes("ALL") ||
          (branchInfo.id && brList.includes(branchInfo.id)) ||
          (branchInfo.name && brList.includes(branchInfo.name));
        if (!matchBr) return false;
      }
      const scList = Array.isArray(ofIt.scales) && ofIt.scales.length ? ofIt.scales : ["PRECIO DE LISTA"];
      if (!scList.some(s => _scaleNamesMatchPOS(s, scaleName))) return false;
      if (ofIt.vigencia_type === "FECHAS") {
        if (kardexFlags.no_ofertas_cal) return false;
        const startMs = ofIt.start_at ? Date.parse(ofIt.start_at) : NaN;
        const endMs = ofIt.end_at ? Date.parse(ofIt.end_at) : NaN;
        if (!isNaN(startMs) && nowMs < startMs) return false;
        if (!isNaN(endMs) && nowMs > endMs) return false;
      }
      if (ofIt.modality === "LIMITE_STOCK") {
        const maxSt = Math.max(1, parseFloat(ofIt.max_stock || 15));
        const soldSt = Math.max(0, parseFloat(ofIt.sold_stock || 0));
        if (soldSt >= maxSt) return false;
      } else if (ofIt.modality === "VOLUMEN") {
        if (Array.isArray(ofIt.volume_tiers) && ofIt.volume_tiers.length > 0) {
          const minFirst = Math.max(2, parseFloat(ofIt.volume_tiers[0].min_qty || 10));
          if (itemQty < minFirst) return false;
        } else {
          const minQ = Math.max(2, parseFloat(ofIt.vol_min || 10));
          if (itemQty < minQ) return false;
        }
      } else if (ofIt.modality === "CRUZADA") {
        const nxm = String(ofIt.nxm_type || "3x2").toUpperCase();
        if (nxm === "3X2") {
          if (itemQty < 3) return false;
        } else if (nxm === "4X3") {
          if (itemQty < 4) return false;
        } else if (nxm === "2X1" || nxm === "2DO_50") {
          if (itemQty < 2) return false;
        } else if (nxm === "CRUZADA_SKU" || nxm === "COMBO_SKU") {
          const reqA = Math.max(1, parseFloat(ofIt.qty_a || 1));
          const reqB = Math.max(1, parseFloat(ofIt.qty_b || 1));
          if (itemQty < reqA) return false;
          const activeCartArr = Array.isArray(cart) ? cart : (Array.isArray(window.cart) ? window.cart : []);
          const linkedSkuNorm = String(ofIt.linked_sku || "").trim().toUpperCase();
          if (!linkedSkuNorm) return false;
          const linkedItemInCart = activeCartArr.find(ci => ci && String(ci.sku || "").trim().toUpperCase() === linkedSkuNorm && ci.quantity >= reqB);
          if (!linkedItemInCart) return false;
        }
      } else if (ofIt.modality === "CONTADO") {
        if (activePaymentMethod === "TARJETA" || activePaymentMethod === "CREDITO" || activePaymentMethod === "CRÉDITO") {
          return false;
        }
      }
      return true;
    });

    if (matchingOffer) {
      if (matchingOffer.modality === "VOLUMEN" && Array.isArray(matchingOffer.volume_tiers) && matchingOffer.volume_tiers.length > 0) {
        let matchedTier = null;
        let matchedTierIdx = -1;
        for (let ti = 0; ti < matchingOffer.volume_tiers.length; ti++) {
          const t = matchingOffer.volume_tiers[ti];
          const minQ = parseFloat(t.min_qty || 0);
          const maxQ = parseFloat(t.max_qty || 0);
          if (itemQty >= minQ && (maxQ <= 0 || itemQty <= maxQ)) {
            matchedTier = t;
            matchedTierIdx = ti;
          }
        }
        if (matchedTier) {
          offerApplied = true;
          forceZeroCommission = !!matchedTier.zero_commission || !!matchingOffer.zero_commission;
          const totPct = parseFloat(matchedTier.total_pct || 0);
          offerLabel = `📦 Escalón ${matchedTierIdx + 1} (${totPct.toFixed(2)}% desc.)`;
          if (parseFloat(matchedTier.unit_price || 0) > 0 && _isListPriceScaleAliasPOS(_normScaleNamePOS(scaleName))) {
            finalUnitPrice = Number(parseFloat(matchedTier.unit_price).toFixed(2));
          } else if (unitCostWithFreight > 0) {
            finalUnitPrice = Number((unitCostWithFreight * (1 + (normalMargin - totPct) / 100) * factorIva).toFixed(2));
          } else {
            finalUnitPrice = Number((normalUnitPrice * (1 - totPct / 100)).toFixed(2));
          }
        }
      } else if (matchingOffer.modality === "CRUZADA") {
        const nxm = String(matchingOffer.nxm_type || "3x2").toUpperCase();
        forceZeroCommission = !!matchingOffer.zero_commission;

        if (nxm === "3X2" || nxm === "4X3" || nxm === "2X1" || nxm === "2DO_50") {
          // SUB-MODO A: Promoción Múltiple del MISMO Producto por múltiplos exactos (piezas sueltas se cobran a precio normal)
          let groupSize = 3;
          let discountUnitsPerGroup = 1;
          if (nxm === "4X3") { groupSize = 4; discountUnitsPerGroup = 1; }
          else if (nxm === "2X1") { groupSize = 2; discountUnitsPerGroup = 1; }
          else if (nxm === "2DO_50") { groupSize = 2; discountUnitsPerGroup = 0.5; }

          const completeGroups = Math.floor(itemQty / groupSize);
          if (completeGroups >= 1) {
            offerApplied = true;
            const freeEquivalentUnits = completeGroups * discountUnitsPerGroup;
            const payableUnits = Math.max(0, itemQty - freeEquivalentUnits);
            const totalLineNormal = payableUnits * normalUnitPrice;
            finalUnitPrice = Number((totalLineNormal / itemQty).toFixed(2));
            offerLabel = nxm === "2DO_50"
              ? `🤝 2do al 50% (${completeGroups} par${completeGroups > 1 ? 'es' : ''})`
              : `🤝 Promo ${nxm} (${completeGroups} lote${completeGroups > 1 ? 's' : ''})`;
          }
        } else if (nxm === "CRUZADA_SKU") {
          // SUB-MODO B en Producto A: Producto A conserva su precio normal, pero bloquea sus puntos a 0 mientras B recibe el descuento cruzado
          offerApplied = true;
          finalUnitPrice = normalUnitPrice;
          offerLabel = `🤝 Promo Cruzada Activa (con ${matchingOffer.linked_sku})`;
        } else if (nxm === "COMBO_SKU") {
          // SUB-MODO C en Producto A: Paquete Combo A + B (aplica proporción del paquete sobre los combos completos)
          const activeCartArr = Array.isArray(cart) ? cart : (Array.isArray(window.cart) ? window.cart : []);
          const reqA = Math.max(1, parseFloat(matchingOffer.qty_a || 1));
          const reqB = Math.max(1, parseFloat(matchingOffer.qty_b || 1));
          const linkedSkuNorm = String(matchingOffer.linked_sku || "").trim().toUpperCase();
          const itemB = activeCartArr.find(ci => ci && String(ci.sku || "").trim().toUpperCase() === linkedSkuNorm && ci.quantity >= reqB);
          if (itemB) {
            const numCombos = Math.min(Math.floor(itemQty / reqA), Math.floor(itemB.quantity / reqB));
            if (numCombos >= 1) {
              offerApplied = true;
              const normalPriceB = parseFloat(itemB.base_price || (matchingOffer.linked_product_data && matchingOffer.linked_product_data.precio_lista) || itemB.price || 0);
              const normalComboTotal = (normalUnitPrice * reqA) + (normalPriceB * reqB);
              const pkgPrice = parseFloat(matchingOffer.offer_price || 0) > 0
                ? parseFloat(matchingOffer.offer_price)
                : (normalComboTotal * (1 - (parseFloat(matchingOffer.discount_pct || 0) / 100)));
              const comboRatio = normalComboTotal > 0 ? (pkgPrice / normalComboTotal) : (1 - (parseFloat(matchingOffer.discount_pct || 0) / 100));
              const comboUnitsA = numCombos * reqA;
              const looseUnitsA = Math.max(0, itemQty - comboUnitsA);
              const unitComboPriceA = normalUnitPrice * comboRatio;
              finalUnitPrice = Number((((comboUnitsA * unitComboPriceA) + (looseUnitsA * normalUnitPrice)) / itemQty).toFixed(2));
              offerLabel = `🎁 Combo / Kit Activo (${numCombos} paq. con ${linkedSkuNorm})`;
            }
          }
        }
      } else {
        offerApplied = true;
        forceZeroCommission = !!matchingOffer.zero_commission;
        let effPct = parseFloat(matchingOffer.discount_pct || 0);
        if (matchingOffer.modality === "VOLUMEN") {
          const maxQ = parseFloat(matchingOffer.vol_max || 0);
          const tier2Pct = parseFloat(matchingOffer.vol_tier2_pct || 0);
          if (maxQ > 0 && itemQty > maxQ && tier2Pct > 0) effPct = tier2Pct;
          offerLabel = `📦 Volumen (${effPct.toFixed(2)}% desc.)`;
        } else {
          offerLabel = `🏷️ Oferta (${effPct.toFixed(2)}% desc.)`;
        }
        if (matchingOffer.modality !== "VOLUMEN" && parseFloat(matchingOffer.offer_price || 0) > 0 && _isListPriceScaleAliasPOS(_normScaleNamePOS(scaleName))) {
          finalUnitPrice = Number(parseFloat(matchingOffer.offer_price).toFixed(2));
        } else if (unitCostWithFreight > 0 && effPct > 0) {
          finalUnitPrice = Number((unitCostWithFreight * (1 + (normalMargin - effPct) / 100) * factorIva).toFixed(2));
        }
      }
    }
  }

  // 0.b Evaluar si este producto es el SKU Vinculado (Producto B) de una Oferta Cruzada o Combo de otro Producto A presente en el carrito
  let subsidizedByCrossOffer = false;
  if (!offerApplied) {
    const activeCartArr = Array.isArray(cart) ? cart : (Array.isArray(window.cart) ? window.cart : []);
    const mySkuNorm = String(productOrItem.sku || "").trim().toUpperCase();
    if (mySkuNorm && activeCartArr.length > 0) {
      for (let ci = 0; ci < activeCartArr.length; ci++) {
        const otherItem = activeCartArr[ci];
        if (!otherItem || String(otherItem.sku || "").trim().toUpperCase() === mySkuNorm) continue;
        const otherMeta = (otherItem.meta_data && typeof otherItem.meta_data === "object") ? otherItem.meta_data : {};
        const otherOffers = Array.isArray(otherMeta.product_offers) ? otherMeta.product_offers : [];
        const crossMatch = otherOffers.find(ofIt => {
          if (!ofIt || ofIt.paused || ofIt.modality !== "CRUZADA") return false;
          const linkedNorm = String(ofIt.linked_sku || "").trim().toUpperCase();
          if (linkedNorm !== mySkuNorm) return false;
          const reqA = Math.max(1, parseFloat(ofIt.qty_a || 1));
          const reqB = Math.max(1, parseFloat(ofIt.qty_b || 1));
          return otherItem.quantity >= reqA && itemQty >= reqB;
        });
        if (crossMatch) {
          const nxm = String(crossMatch.nxm_type || "CRUZADA_SKU").toUpperCase();
          const reqA = Math.max(1, parseFloat(crossMatch.qty_a || 1));
          const reqB = Math.max(1, parseFloat(crossMatch.qty_b || 1));
          const normalPriceA = parseFloat(otherItem.base_price || otherItem.price || 0);
          const costoPisoA = parseFloat(otherItem.costo_piso_iva || (otherMeta.costo_piso_con_iva) || 0);

          if (nxm === "CRUZADA_SKU") {
            const setsA = Math.floor(otherItem.quantity / reqA);
            const maxPromoUnitsB = setsA * reqB;
            const promoUnitsB = Math.min(itemQty, maxPromoUnitsB);
            const looseUnitsB = Math.max(0, itemQty - promoUnitsB);
            let targetOfferUnitB = crossMatch.offer_price != null
              ? parseFloat(crossMatch.offer_price)
              : Number((normalUnitPrice * (1 - (parseFloat(crossMatch.discount_pct || 0) / 100))).toFixed(2));
            // Candado duro combinado: Ingreso_A + Ingreso_B >= CostoPiso_A + CostoPiso_B
            const minAllowedForB = Math.max(0, (((costoPisoA * reqA) + (costoPisoConIva * reqB)) - (normalPriceA * reqA)) / reqB);
            if (targetOfferUnitB < minAllowedForB) {
              targetOfferUnitB = Number(minAllowedForB.toFixed(2));
            }
            finalUnitPrice = Number((((promoUnitsB * targetOfferUnitB) + (looseUnitsB * normalUnitPrice)) / itemQty).toFixed(2));
            offerApplied = true;
            subsidizedByCrossOffer = true;
            forceZeroCommission = !!crossMatch.zero_commission;
            offerLabel = `🤝 Promo Cruzada Activa (por ${otherItem.sku})`;
            break;
          } else if (nxm === "COMBO_SKU") {
            const numCombos = Math.min(Math.floor(otherItem.quantity / reqA), Math.floor(itemQty / reqB));
            if (numCombos >= 1) {
              const normalComboTotal = (normalPriceA * reqA) + (normalUnitPrice * reqB);
              const pkgPrice = parseFloat(crossMatch.offer_price || 0) > 0
                ? parseFloat(crossMatch.offer_price)
                : (normalComboTotal * (1 - (parseFloat(crossMatch.discount_pct || 0) / 100)));
              const comboRatio = normalComboTotal > 0 ? (pkgPrice / normalComboTotal) : (1 - (parseFloat(crossMatch.discount_pct || 0) / 100));
              const comboUnitsB = numCombos * reqB;
              const looseUnitsB = Math.max(0, itemQty - comboUnitsB);
              const unitComboPriceB = normalUnitPrice * comboRatio;
              finalUnitPrice = Number((((comboUnitsB * unitComboPriceB) + (looseUnitsB * normalUnitPrice)) / itemQty).toFixed(2));
              offerApplied = true;
              subsidizedByCrossOffer = true;
              forceZeroCommission = !!crossMatch.zero_commission;
              offerLabel = `🎁 Combo / Kit Activo (${numCombos} paq. con ${otherItem.sku})`;
              break;
            }
          }
        }
      }
    }
  }

  // 1. Si no aplicó una oferta especial de product_offers, revisar oferta directa en escala de Sucursal o Matriz
  if (!offerApplied) {
    if (!isPosMatriz && prodBranchScales.length > 0 && (branchInfo.id || branchInfo.name)) {
      const branchMatch = prodBranchScales.find(bs => {
        if (!bs || bs.activa === false || bs.active === false) return false;
        const bsId = _normScaleNamePOS(bs.branch_id || bs.branch);
        const bsName = _normScaleNamePOS(bs.branch_name || bs.branch);
        const sameBranch =
          (branchInfo.id && (bsId === branchInfo.id || bsName === branchInfo.id)) ||
          (branchInfo.name && (bsName === branchInfo.name || bsId === branchInfo.name));
        return sameBranch && _scaleNamesMatchPOS(bs.scale_name, scaleName);
      });
      if (branchMatch) {
        const mB = parseFloat(branchMatch.margen_ideal) || 0;
        const mA = parseFloat(branchMatch.sobreprecio_suc) || 0;
        const mO = parseFloat(branchMatch.oferta) || 0;
        if (mO > 0) {
          offerApplied = true;
          offerLabel = `🏷️ Oferta Sucursal (${mO.toFixed(2)}%)`;
        }
        if (unitCostWithFreight > 0) {
          const mF = (branchMatch.margen_final != null && mO === 0) ? parseFloat(branchMatch.margen_final) : (mB + mA - mO);
          finalUnitPrice = Number((unitCostWithFreight * (1 + mF / 100) * factorIva).toFixed(2));
        } else {
          finalUnitPrice = parseFloat(branchMatch.precio ?? branchMatch.price ?? normalUnitPrice) || normalUnitPrice;
        }
      }
    } else if (combinedScales.length > 0) {
      const match = combinedScales.find(s => {
        if (!s || s.activa === false || s.active === false) return false;
        return _scaleNamesMatchPOS(s.scale_name || s.nombre || s.name || "", scaleName);
      });
      if (match) {
        const mO = parseFloat(match.oferta) || 0;
        if (mO > 0) {
          offerApplied = true;
          offerLabel = `🏷️ Oferta (${mO.toFixed(2)}%)`;
        }
        const pVal = parseFloat(match.precio_activo ?? match.precio ?? match.price ?? 0);
        if (pVal > 0) finalUnitPrice = pVal;
      }
    }
  }

  // EVALUACIÓN DE COMPONENTES DE PAQUETE / KIT [F10] DESGLOSADOS EN EL CARRITO
  if (productOrItem && productOrItem.package_group_id) {
    const pkgDiscPct = parseFloat(productOrItem.package_discount_pct || 0) || 0;
    const pkgBasePrice = parseFloat(productOrItem.package_unit_normal || productOrItem.base_price || normalUnitPrice) || normalUnitPrice;
    if (pkgBasePrice > 0) {
      normalUnitPrice = pkgBasePrice;
    }
    if (pkgDiscPct > 0.001) {
      let pkgUnitOffer = parseFloat(productOrItem.package_unit_price) || Number((normalUnitPrice * (1 - pkgDiscPct / 100)).toFixed(2));
      if (costoPisoConIva > 0 && pkgUnitOffer < costoPisoConIva) {
        pkgUnitOffer = costoPisoConIva;
      }
      finalUnitPrice = pkgUnitOffer;
      offerApplied = true;
      offerLabel = `📦 Desc. Paquete ${productOrItem.package_sku || ""} (-${pkgDiscPct.toFixed(2)}%)`;
    }
  }

  // CANDADO OBLIGATORIO #2: Bloqueo estricto contra descuentos bajo costo (Costo Piso)
  if (!subsidizedByCrossOffer && costoPisoConIva > 0 && finalUnitPrice >= 0 && finalUnitPrice < costoPisoConIva - 0.005) {
    finalUnitPrice = costoPisoConIva;
    showCostoPisoSecurityAlertPOS(costoPisoConIva);
  }

  // CANDADO OBLIGATORIO #1: Bloqueo automático de Puntos en Ofertas y Volumen (0 Puntos)
  const unitPointsConfig = parseFloat(meta.puntos || 0) || 0;
  const pointsLocked = offerApplied;
  const earnedPoints = pointsLocked ? 0 : Number((unitPointsConfig * itemQty).toFixed(2));

  // REGLA #4: Comisión del vendedor calculada sobre Subtotal Neto Real cobrado (sin IVA) y ajustada a reducción de margen
  const netUnitPriceNoTax = factorIva > 0 ? (finalUnitPrice / factorIva) : finalUnitPrice;
  const netSubtotalNoTax = netUnitPriceNoTax * itemQty;
  const actualMarginPct = unitCostWithFreight > 0 ? (((netUnitPriceNoTax / unitCostWithFreight) - 1) * 100) : normalMargin;
  let effectiveCommissionPct = baseCommissionPct;
  if (forceZeroCommission || actualMarginPct <= 0) {
    effectiveCommissionPct = 0;
  } else if (offerApplied && normalMargin > 0) {
    effectiveCommissionPct = Math.max(0, baseCommissionPct * (actualMarginPct / normalMargin));
  }
  const commissionAmountMxn = Number((Math.max(0, netSubtotalNoTax) * (effectiveCommissionPct / 100)).toFixed(2));

  return {
    unitPrice: finalUnitPrice,
    normalPrice: normalUnitPrice,
    costoPisoConIva,
    offerApplied,
    offerLabel,
    pointsLocked,
    earnedPoints,
    commissionPct: Number(effectiveCommissionPct.toFixed(2)),
    commissionAmountMxn
  };
}

function getProductPriceForClient(productOrItem, clientOrScaleName) {
  const res = evaluatePosItemFinancials(productOrItem, clientOrScaleName, productOrItem && productOrItem.quantity);
  return res.unitPrice;
}

/* ── Motor de Desglose Editable en Tiempo Real para Paquetes / Kits / Recetas [F10] ── */
function _getPosPackageConfig(product) {
  if (!product) return null;
  const meta = (product.meta_data && typeof product.meta_data === "object") ? product.meta_data : {};
  const cfg = (meta.package_config && typeof meta.package_config === "object") ? meta.package_config : null;
  const comps = (cfg && Array.isArray(cfg.components) && cfg.components.length > 0)
    ? cfg.components
    : (Array.isArray(meta.package_components) && meta.package_components.length > 0 ? meta.package_components : null);
  if (!comps || comps.length === 0) return null;
  return {
    sku: product.sku || (cfg && cfg.sku) || "PKT",
    name: product.name || product.description || (cfg && cfg.name) || product.sku || "PAQUETE",
    group_type: (cfg && cfg.group_type) || "PAQUETE_VENTA",
    branch: (cfg && cfg.branch) || "TODAS",
    scale_name: (cfg && cfg.scale_name) || "PRECIO DE LISTA",
    vigencia_type: (cfg && cfg.vigencia_type) || "PERMANENTE",
    start_date: (cfg && cfg.start_date) || "",
    end_date: (cfg && cfg.end_date) || "",
    active: cfg ? cfg.active !== false : (meta.activo !== false),
    discount_pct: parseFloat((cfg && cfg.discount_pct) || 0) || 0,
    components: comps
  };
}

function _isPosPackageVigenciaValid(pkgCfg) {
  if (!pkgCfg || pkgCfg.active === false) return { active: false, reason: "El paquete está pausado o inactivo." };
  if (pkgCfg.branch && pkgCfg.branch !== "TODAS") {
    const activeBr = _getActivePosBranchInfo();
    const targetBr = _normScaleNamePOS(pkgCfg.branch);
    if (targetBr && activeBr.name !== targetBr && activeBr.id !== targetBr) {
      return { active: false, reason: `Exclusivo para sucursal ${pkgCfg.branch}.` };
    }
  }
  if (pkgCfg.vigencia_type === "FECHAS") {
    const now = new Date();
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, "0");
    const d = String(now.getDate()).padStart(2, "0");
    const todayIso = `${y}-${m}-${d}`;
    if (pkgCfg.start_date && todayIso < pkgCfg.start_date) {
      return { active: false, reason: `Inicia vigencia el ${pkgCfg.start_date}.` };
    }
    if (pkgCfg.end_date && todayIso > pkgCfg.end_date) {
      return { active: false, reason: `Vigencia vencida el ${pkgCfg.end_date}.` };
    }
  }
  return { active: true, reason: "" };
}

function removePackageGroupFromCart(pkgGroupId) {
  if (!pkgGroupId || !Array.isArray(cart)) return;
  const beforeLen = cart.length;
  for (let i = cart.length - 1; i >= 0; i--) {
    if (cart[i] && cart[i].package_group_id === pkgGroupId) {
      cart.splice(i, 1);
    }
  }
  if (cart.length !== beforeLen) {
    selectedCartIndex = cart.length > 0 ? Math.min(selectedCartIndex, cart.length - 1) : -1;
    if (typeof showToast === "function") {
      showToast("📦 Paquete completo retirado del carrito.", "info");
    }
    updateCartUI();
    if (typeof focusProductInput === "function") focusProductInput();
  }
}
window.removePackageGroupFromCart = removePackageGroupFromCart;

function removeCartRowByIndex(idx) {
  if (!Array.isArray(cart) || idx < 0 || idx >= cart.length) return;
  const removed = cart[idx];
  cart.splice(idx, 1);
  if (typeof showToast === "function" && removed) {
    showToast(`Componente eliminado: ${removed.description}`, "info");
  }
  selectedCartIndex = cart.length > 0 ? Math.min(idx, cart.length - 1) : -1;
  updateCartUI();
  if (typeof focusProductInput === "function") focusProductInput();
}
window.removeCartRowByIndex = removeCartRowByIndex;

/* ── TEST 3: Motor de Productos Equivalentes / Sustitutos [F4] en Carrito y Buscador POS cuando Stock <= 0 ── */
function getAvailablePosSubstitutesForProduct(productOrItem) {
  if (!productOrItem) return [];
  const meta = (productOrItem.meta_data && typeof productOrItem.meta_data === "object") ? productOrItem.meta_data : {};
  const f4Comp = (meta.complements_f4 && typeof meta.complements_f4 === "object") ? meta.complements_f4 : {};
  const eqList = Array.isArray(f4Comp.equivalents) ? f4Comp.equivalents : [];
  if (!eqList.length) return [];

  const catalogCache = Array.isArray(window._productsCache) ? window._productsCache : (Array.isArray(window._productsAll) ? window._productsAll : []);
  return eqList.map(eq => {
    if (!eq || !eq.sku) return null;
    const skuUp = String(eq.sku).trim().toUpperCase();
    const live = catalogCache.find(p => p && String(p.sku || "").trim().toUpperCase() === skuUp);
    return {
      sku: skuUp,
      description: String((live && (live.name || live.description)) || eq.description || skuUp).toUpperCase(),
      brand: String((live && live.meta_data && (live.meta_data.marca || live.meta_data.brand)) || eq.brand || "GENÉRICO").toUpperCase(),
      stock: live && live.stock != null ? (parseFloat(live.stock) || 0) : (parseFloat(eq.stock) || 0),
      price: live && live.price != null ? (parseFloat(live.price) || 0) : (parseFloat(eq.price) || 0),
      equiv_type: String(eq.equiv_type || "IDÉNTICO OTRA MARCA").toUpperCase()
    };
  }).filter(eq => eq && eq.stock > 0);
}
window.getAvailablePosSubstitutesForProduct = getAvailablePosSubstitutesForProduct;

async function loadSubstituteIntoPosCart(subSku, replaceCartIdx, explicitQty) {
  const cleanSku = String(subSku || "").trim();
  if (!cleanSku) return null;

  let subProd = null;
  const pools = [window._productsCache || [], window._productsAll || [], typeof autocompleteItems !== "undefined" ? autocompleteItems : []];
  for (const pool of pools) {
    if (!Array.isArray(pool)) continue;
    const hit = pool.find(p => p && String(p.sku || "").trim().toUpperCase() === cleanSku.toUpperCase());
    if (hit) { subProd = hit; break; }
  }

  if (!subProd) {
    try {
      const apiBase = typeof API_BASE !== "undefined" ? API_BASE : "/api";
      const fetchFn = typeof apiFetch === "function" ? apiFetch : fetch;
      const res = await fetchFn(`${apiBase}/products/${encodeURIComponent(cleanSku)}`);
      if (res && res.ok) {
        subProd = await res.json();
      }
    } catch (e) {}
  }

  if (!subProd) {
    if (typeof showToast === "function") {
      showToast(`No se encontró el producto sustituto [${cleanSku}] en el catálogo.`, "warning");
    }
    return null;
  }

  const targetScale = (typeof temporaryPriceScale !== "undefined" && temporaryPriceScale)
    ? temporaryPriceScale
    : (typeof activePriceScale !== "undefined" ? activePriceScale : "PRECIO DE LISTA");

  if (typeof replaceCartIdx === "number" && replaceCartIdx >= 0 && Array.isArray(cart) && cart[replaceCartIdx]) {
    const oldItem = cart[replaceCartIdx];
    const qtyToUse = Math.max(1, parseFloat(explicitQty != null ? explicitQty : oldItem.quantity) || 1);
    const finSub = evaluatePosItemFinancials(subProd, targetScale, qtyToUse);
    cart[replaceCartIdx] = {
      sku: subProd.sku,
      description: subProd.description || subProd.name || subProd.sku,
      stock: parseFloat(subProd.stock ?? 0) || 0,
      base_price: parseFloat(subProd.price) || 0,
      average_cost: parseFloat(subProd.average_cost) || 0,
      meta_data: subProd.meta_data || {},
      price_scales: subProd.price_scales || [],
      price: finSub.unitPrice,
      quantity: qtyToUse,
      subtotal: qtyToUse * finSub.unitPrice,
      costo_piso_iva: finSub.costoPisoConIva,
      offer_applied: finSub.offerApplied,
      offer_label: finSub.offerLabel,
      points_locked: finSub.pointsLocked,
      earned_points: finSub.earnedPoints,
      commission_pct: finSub.commissionPct,
      commission_amount: finSub.commissionAmountMxn
    };
    selectedCartIndex = replaceCartIdx;
    updateCartUI();
    if (typeof showToast === "function") {
      showToast(`🔄 Sustituto cargado: [${subProd.sku}] ${subProd.description || subProd.name} (Stock: ${subProd.stock}) en lugar de ${oldItem.sku}.`, "success");
    }
    if (typeof focusProductInput === "function") focusProductInput();
    return cart[replaceCartIdx];
  } else {
    const qtyToUse = Math.max(1, parseFloat(explicitQty) || 1);
    addToCart(subProd, qtyToUse);
    if (typeof showToast === "function") {
      showToast(`🔄 Sustituto añadido al carrito: [${subProd.sku}] ${subProd.description || subProd.name} x${qtyToUse}`, "success");
    }
    if (typeof hideAutocomplete === "function") hideAutocomplete();
    if (typeof focusProductInput === "function") focusProductInput();
    return subProd;
  }
}
window.loadSubstituteIntoPosCart = loadSubstituteIntoPosCart;

/* ── TEST 4: Cruce Automático de XML de Compras por Proveedor y SKU XML [F4 Tarjeta 3] ── */
function findProductBySupplierXmlSkuSync(rfcOrSupplier, xmlSku, catalogArray) {
  const cleanXml = String(xmlSku || "").trim().toUpperCase();
  const cleanSup = String(rfcOrSupplier || "").trim().toUpperCase();
  if (!cleanXml) return null;

  const pools = [];
  if (Array.isArray(catalogArray)) pools.push(catalogArray);
  if (Array.isArray(window.f3ProductsListCache)) pools.push(window.f3ProductsListCache);
  if (Array.isArray(window._productsAll)) pools.push(window._productsAll);
  if (Array.isArray(window._productsCache)) pools.push(window._productsCache);

  let fallbackMatch = null;
  for (const arr of pools) {
    for (const prod of arr) {
      if (!prod || !prod.sku) continue;
      const meta = (prod.meta_data && typeof prod.meta_data === "object") ? prod.meta_data : {};
      const f4 = (meta.complements_f4 && typeof meta.complements_f4 === "object") ? meta.complements_f4 : {};
      const suppliers = Array.isArray(f4.suppliers) ? f4.suppliers : [];
      for (const sup of suppliers) {
        if (!sup || !sup.xml_sku) continue;
        const supXml = String(sup.xml_sku).trim().toUpperCase();
        if (supXml !== cleanXml) continue;
        const supName = String(sup.provider_name || "").trim().toUpperCase();
        const matchObj = {
          matched: true,
          product: prod,
          supplierEntry: sup,
          internalSku: prod.sku,
          internalName: prod.name || prod.description || prod.sku,
          agreedCost: parseFloat(sup.cost) || 0,
          currency: sup.currency || "MXN",
          leadDays: parseInt(sup.lead_days, 10) || 1,
          minQty: parseFloat(sup.min_qty) || 1
        };
        if (!cleanSup || supName.includes(cleanSup) || cleanSup.includes(supName)) {
          return matchObj;
        }
        if (!fallbackMatch) fallbackMatch = matchObj;
      }
    }
  }
  return fallbackMatch;
}
window.findProductBySupplierXmlSkuSync = findProductBySupplierXmlSkuSync;

async function findProductBySupplierXmlSku(rfcOrSupplier, xmlSku, catalogOptional) {
  const syncHit = findProductBySupplierXmlSkuSync(rfcOrSupplier, xmlSku, catalogOptional);
  if (syncHit) return syncHit;

  try {
    const apiBase = typeof API_BASE !== "undefined" ? API_BASE : "/api";
    const fetchFn = typeof apiFetch === "function" ? apiFetch : fetch;
    const res = await fetchFn(`${apiBase}/products?limit=500`);
    if (res && res.ok) {
      const list = await res.json();
      if (Array.isArray(list)) {
        window._productsCache = list;
        return findProductBySupplierXmlSkuSync(rfcOrSupplier, xmlSku, list);
      }
    }
  } catch (e) {}
  return null;
}
window.findProductBySupplierXmlSku = findProductBySupplierXmlSku;

function addToCart(product, quantity) {
  if (isReturnModeActive) {
    quantity = -Math.abs(quantity);
  }

  const targetScale = temporaryPriceScale || activePriceScale;
  const pkgCfg = _getPosPackageConfig(product);

  // Si el producto escaneado/buscado es un PAQUETE / KIT / RECETA [F10], desglosar todos sus componentes editables
  if (pkgCfg) {
    const vigCheck = _isPosPackageVigenciaValid(pkgCfg);
    if (!vigCheck.active) {
      if (typeof showToast === "function") {
        showToast(`⚠️ Paquete [${pkgCfg.sku}]: ${vigCheck.reason} Se cargarán sus productos a precio normal.`, "warning");
      }
    }
    const effectiveDiscPct = vigCheck.active ? (parseFloat(pkgCfg.discount_pct) || 0) : 0;
    const pkgGroupId = `PKTGRP-${pkgCfg.sku}-${Date.now()}`;
    const catalogCache = Array.isArray(window._productsCache) ? window._productsCache : [];

    pkgCfg.components.forEach(comp => {
      const compSku = String(comp.sku || "").trim();
      const catProd = catalogCache.find(p => p && String(p.sku || "").trim().toUpperCase() === compSku.toUpperCase());
      const compQty = Number(((parseFloat(comp.qty) || 1) * quantity).toFixed(4));
      const baseNormal = parseFloat(comp.unit_price_normal) || (catProd ? parseFloat(catProd.price) : 0) || 0;
      const floorIva = parseFloat(comp.floor_cost_iva) || (catProd ? getProductCostoPisoInfoPOS(catProd).costoPisoConIva : 0) || 0;
      let unitPkgPrice = effectiveDiscPct > 0
        ? (parseFloat(comp.unit_price_package) || Number((baseNormal * (1 - effectiveDiscPct / 100)).toFixed(2)))
        : baseNormal;
      if (floorIva > 0 && unitPkgPrice < floorIva) {
        unitPkgPrice = floorIva;
      }

      const compMeta = Object.assign(
        {},
        (catProd && catProd.meta_data && typeof catProd.meta_data === "object") ? JSON.parse(JSON.stringify(catProd.meta_data)) : {},
        {
          costo_piso_iva: floorIva,
          costo_con_flete: floorIva > 0 ? Number((floorIva / 1.16).toFixed(2)) : 0
        }
      );

      const itemRecord = {
        sku: compSku,
        description: comp.name || (catProd && (catProd.name || catProd.description)) || compSku,
        base_price: baseNormal,
        average_cost: (catProd && catProd.average_cost) || (floorIva > 0 ? Number((floorIva / 1.16).toFixed(2)) : 0),
        meta_data: compMeta,
        price_scales: (catProd && Array.isArray(catProd.price_scales)) ? catProd.price_scales : [],
        price: unitPkgPrice,
        quantity: compQty,
        subtotal: compQty * unitPkgPrice,
        costo_piso_iva: floorIva,
        package_group_id: pkgGroupId,
        package_sku: pkgCfg.sku,
        package_name: pkgCfg.name,
        package_discount_pct: effectiveDiscPct,
        package_unit_normal: baseNormal,
        package_unit_price: unitPkgPrice
      };

      const finComp = evaluatePosItemFinancials(itemRecord, targetScale, compQty);
      itemRecord.price = finComp.unitPrice;
      itemRecord.subtotal = compQty * finComp.unitPrice;
      itemRecord.offer_applied = finComp.offerApplied;
      itemRecord.offer_label = finComp.offerLabel;
      itemRecord.points_locked = finComp.pointsLocked;
      itemRecord.earned_points = finComp.earnedPoints;
      itemRecord.commission_pct = finComp.commissionPct;
      itemRecord.commission_amount = finComp.commissionAmountMxn;

      cart.push(itemRecord);
    });

    selectedCartIndex = cart.length - 1;
    if (typeof showToast === "function") {
      showToast(`📦 Paquete [${pkgCfg.sku}] ${pkgCfg.name} desglosado (${pkgCfg.components.length} productos editables).`, "success");
    }
    updateCartUI();
    if (typeof focusProductInput === "function") focusProductInput();
    return;
  }

  const fin = evaluatePosItemFinancials(product, targetScale, quantity);

  // Aviso discreto de Productos Equivalentes / Sustitutos [F4] cuando el artículo tiene Stock = 0
  const prodStockVal = parseFloat(product.stock ?? (product.meta_data && product.meta_data.stock_almacen) ?? 0) || 0;
  if (quantity > 0 && prodStockVal <= 0) {
    const availableEqs = getAvailablePosSubstitutesForProduct(product);
    if (availableEqs.length > 0 && typeof showToast === "function") {
      const sugTxt = availableEqs
        .slice(0, 3)
        .map(eq => `[${eq.sku}] ${eq.description} (${eq.equiv_type || "Sustituto"} · Stock: ${eq.stock} · $${(parseFloat(eq.price) || 0).toFixed(2)})`)
        .join(" | ");
      showToast(`🔄 Stock 0 en ${product.sku}. Sustitutos con existencia listos para cargar en 1 clic: ${sugTxt}`, "info");
    }
  }

  cart.push({
    sku: product.sku,
    description: product.description,
    stock: prodStockVal,
    base_price: product.price,
    average_cost: product.average_cost || 0,
    meta_data: product.meta_data || {},
    price_scales: product.price_scales || [],
    price: fin.unitPrice,
    quantity: quantity,
    subtotal: quantity * fin.unitPrice,
    costo_piso_iva: fin.costoPisoConIva,
    offer_applied: fin.offerApplied,
    offer_label: fin.offerLabel,
    points_locked: fin.pointsLocked,
    earned_points: fin.earnedPoints,
    commission_pct: fin.commissionPct,
    commission_amount: fin.commissionAmountMxn
  });
  selectedCartIndex = cart.length - 1;

  if (isReturnModeActive) {
    isReturnModeActive = false;
    const f2Btn = document.getElementById("btn-f2-devolucion");
    if (f2Btn) {
      f2Btn.style.borderColor = "";
      f2Btn.style.backgroundColor = "";
      f2Btn.style.color = "";
    }
    showToast("Modo DEVOLUCION desactivado", "info");
  }

  if (temporaryPriceScale) {
    temporaryPriceScale = null;
    activePriceScale = activeClient.assigned_price_scale || activeClient.client_type || "Público General";
    const scaleBtnDisplay = document.getElementById("price-type-display");
    if (scaleBtnDisplay) scaleBtnDisplay.innerText = activePriceScale.toUpperCase();
  }

  updateCartUI();
  focusProductInput();
}

function updateCartUI() {
  if (updateCartUI._busy) return;
  updateCartUI._busy = true;
  try {
  const targetScaleNow = temporaryPriceScale || activePriceScale;
  const manualDiscVal = parseFloat(document.getElementById("discount-input")?.value || 0) || 0;

  // Recalcular cada renglón en tiempo real (escalones de volumen, bloqueo de 0 puntos, comisión neta y candado Costo Piso)
  cart.forEach(item => {
    const fin = evaluatePosItemFinancials(item, targetScaleNow, item.quantity);
    item.price = fin.unitPrice;
    item.costo_piso_iva = fin.costoPisoConIva;
    item.offer_applied = fin.offerApplied;
    item.offer_label = fin.offerLabel;
    // Si hay descuento manual en caja también se bloquean los puntos a 0
    item.points_locked = fin.pointsLocked || manualDiscVal > 0;
    item.earned_points = item.points_locked ? 0 : fin.earnedPoints;
    item.commission_pct = fin.commissionPct;
    item.commission_amount = fin.commissionAmountMxn;
    item.subtotal = item.quantity * item.price;
  });

  localStorage.setItem("pos_cart", JSON.stringify(cart));
  localStorage.setItem("pos_active_client", JSON.stringify(activeClient));
  localStorage.setItem("pos_active_price_scale", activePriceScale);
  if (temporaryPriceScale) {
    localStorage.setItem("pos_temp_price_scale", temporaryPriceScale);
  } else {
    localStorage.removeItem("pos_temp_price_scale");
  }

  const tableBody = document.getElementById("cart-table-body");
  const emptyRow = document.getElementById("empty-cart-row");

  const rows = tableBody.querySelectorAll("tr:not(#empty-cart-row)");
  rows.forEach(r => { try { r.remove(); } catch (_) {} });

  if (cart.length === 0) {
    emptyRow.classList.remove("hidden");
    selectedCartIndex = -1;
  } else {
    emptyRow.classList.add("hidden");
    let lastRenderedPkgGroupId = null;

    cart.forEach((item, index) => {
      // Encabezado agrupador visual de Paquete / Kit [F10] en el carrito POS
      if (item.package_group_id && item.package_group_id !== lastRenderedPkgGroupId) {
        lastRenderedPkgGroupId = item.package_group_id;
        const pkgItems = cart.filter(x => x && x.package_group_id === item.package_group_id);
        const pkgSub = pkgItems.reduce((acc, x) => acc + (parseFloat(x.subtotal) || 0), 0);
        const pkgDisc = parseFloat(item.package_discount_pct || 0) || 0;
        const headerTr = document.createElement("tr");
        headerTr.className = "bg-sky-900 text-white border-b border-sky-700 select-none";
        headerTr.innerHTML = `
          <td colspan="4" class="py-2 px-4">
            <div class="flex items-center gap-2 flex-wrap">
              <span class="inline-flex items-center px-2 py-0.5 rounded bg-sky-400 text-slate-950 font-black text-[11px]">📦 PAQUETE: [${item.package_sku || 'PKT'}]</span>
              <span class="font-extrabold text-xs tracking-wide text-white">${item.package_name || 'PAQUETE DE PRODUCTOS'}</span>
              <span class="text-[11px] text-sky-200 font-semibold">(${pkgItems.length} componentes editables en tiempo real)</span>
              ${pkgDisc > 0 ? `<span class="inline-flex items-center px-2 py-0.5 rounded bg-amber-400 text-slate-950 font-black text-[10px]">🏷️ -${pkgDisc.toFixed(2)}% Desc. Paquete · 🚫 0 Pts</span>` : ''}
            </div>
          </td>
          <td class="py-2 px-4 text-right font-mono font-black text-xs text-sky-200">Total Pkt: $${pkgSub.toFixed(2)}</td>
          <td class="py-2 px-4 text-right">
            <button type="button" data-pkg-remove="${item.package_group_id}" class="inline-flex items-center gap-1 px-2.5 py-1 rounded bg-red-600 hover:bg-red-500 text-white font-extrabold text-[11px] shadow-sm transition cursor-pointer" title="Quitar todos los productos de este paquete">
              🗑️ Quitar paquete completo
            </button>
          </td>
        `;
        const rmPkgBtn = headerTr.querySelector("[data-pkg-remove]");
        if (rmPkgBtn) {
          rmPkgBtn.addEventListener("click", (ev) => {
            ev.stopPropagation();
            removePackageGroupFromCart(item.package_group_id);
          });
        }
        tableBody.appendChild(headerTr);
      } else if (!item.package_group_id) {
        lastRenderedPkgGroupId = null;
      }

      const tr = document.createElement("tr");
      const isSelected = index === selectedCartIndex;
      const isReturn = item.quantity < 0;
      
      let rowStyle = "";
      if (isReturn) {
        rowStyle = isSelected 
          ? 'bg-red-50/80 border-l-4 border-l-red-600 font-semibold text-red-700' 
          : 'bg-red-50/30 text-red-600 border-b border-red-100';
      } else if (item.package_group_id) {
        rowStyle = isSelected
          ? 'bg-sky-100/80 border-l-4 border-l-sky-600 font-semibold text-slate-800'
          : 'bg-sky-50/35 text-slate-800 border-b border-sky-100';
      } else {
        rowStyle = isSelected 
          ? 'bg-blue-50/70 border-l-4 border-l-blue-600 font-semibold text-slate-800' 
          : 'text-slate-800 border-b border-slate-100';
      }
      tr.className = `hover:bg-slate-50 cursor-pointer select-none transition ${rowStyle}`;
      
      const qtyClass = isReturn ? 'text-red-600 font-black' : 'text-slate-800 font-bold';
      const descClass = isReturn ? 'text-red-600 font-bold' : 'text-slate-700';
      const priceClass = isReturn ? 'text-red-600 font-bold' : 'text-slate-800';
      const skuClass = isReturn ? 'text-red-500 font-bold' : 'text-slate-500';
      const importClass = isReturn ? 'text-red-600 font-black' : 'text-slate-800 font-black';

      const pkgChildBadge = item.package_group_id
        ? `<span class="inline-flex items-center px-1.5 py-0.5 rounded bg-sky-100 text-sky-900 border border-sky-300 text-[10px] font-extrabold">📦 Parte de: ${item.package_name || item.package_sku}</span>`
        : '';

      const itemStockNow = parseFloat(item.stock ?? (item.meta_data && item.meta_data.stock_almacen) ?? 999);
      const itemSubstitutes = (!isReturn && itemStockNow <= 0) ? getAvailablePosSubstitutesForProduct(item) : [];
      const substitutesBarHtml = itemSubstitutes.length > 0
        ? `<div class="mt-1.5 p-2 rounded-lg bg-amber-50 border border-amber-300 flex flex-col gap-1">
             <div class="text-[10px] font-extrabold text-amber-900 flex items-center gap-1">
               <span>⚠️ SIN STOCK EN ${item.sku} (0.00) — Producto(s) sustituto(s) con existencia disponible:</span>
             </div>
             <div class="flex flex-wrap gap-1.5">
               ${itemSubstitutes.map(eq => `
                 <button type="button" data-pos-sub-sku="${eq.sku}" data-pos-sub-idx="${index}"
                   class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-blue-600 hover:bg-blue-700 text-white font-extrabold text-[10.5px] shadow-sm transition cursor-pointer"
                   title="Reemplazar ${item.sku} por ${eq.sku} (${eq.equiv_type}) en 1 clic">
                   🔄 Cargar [${eq.sku}] ${eq.description} · Stock: ${eq.stock} · $${(parseFloat(eq.price) || 0).toFixed(2)}
                 </button>
               `).join("")}
             </div>
           </div>`
        : '';

      const badgesHtml = item.points_locked
        ? `<div class="mt-0.5 flex items-center flex-wrap gap-1.5">
             ${pkgChildBadge}
             ${item.offer_label ? `<span class="inline-flex items-center px-1.5 py-0.5 rounded bg-sky-100 text-sky-800 border border-sky-300 text-[10px] font-extrabold">${item.offer_label}</span>` : ''}
             <span class="inline-flex items-center px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 border border-amber-300 text-[10px] font-extrabold">🚫 Puntos Bloqueados en Oferta/Volumen (0 Pts)</span>
           </div>${substitutesBarHtml}`
        : ((pkgChildBadge || item.earned_points > 0 || substitutesBarHtml)
            ? `<div class="mt-0.5 flex items-center flex-wrap gap-1.5">
                 ${pkgChildBadge}
                 ${item.earned_points > 0 ? `<span class="inline-flex items-center px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-800 text-[10px] font-bold">⭐ +${item.earned_points.toFixed(2)} Pts</span>` : ''}
               </div>${substitutesBarHtml}`
            : '');

      const discountColHtml = item.offer_applied
        ? `<span class="text-amber-600 font-extrabold text-xs">${item.offer_label || 'OFERTA'}</span>`
        : `<span class="text-slate-400 font-semibold">- -</span>`;

      const quickDeleteBtnHtml = `
        <button type="button" data-row-del="${index}" class="ml-2 inline-flex items-center justify-center w-6 h-6 rounded bg-red-50 hover:bg-red-100 text-red-600 border border-red-200 text-xs transition" title="Quitar este producto del carrito">
          🗑️
        </button>
      `;

      if (index === inlineEditingIndex) {
        tr.innerHTML = `
          <td class="py-3 px-4 ${skuClass}">${item.sku}</td>
          <td class="py-3 px-4 text-center">
            <input type="number" step="any" id="inline-qty-input" class="w-16 text-center border-2 border-blue-500 rounded-lg bg-white font-bold text-slate-800 focus:ring-0 focus:outline-none" value="${item.quantity}">
          </td>
          <td class="py-3 px-4 ${descClass}">${item.description}${badgesHtml}</td>
          <td class="py-3 px-4 text-right ${priceClass}">$${item.price.toFixed(2)}</td>
          <td class="py-3 px-4 text-center">${discountColHtml}</td>
          <td class="py-3 px-4 text-right ${importClass}">$${item.subtotal.toFixed(2)}${quickDeleteBtnHtml}</td>
        `;
      } else {
        tr.innerHTML = `
          <td class="py-3 px-4 ${skuClass}">${item.sku}</td>
          <td class="py-3 px-4 text-center ${qtyClass} group" style="cursor:pointer;" title="Clic para editar cantidad">
            <span class="inline-flex items-center gap-1">
              ${item.quantity}
              <svg class="w-3 h-3 opacity-0 group-hover:opacity-40 transition-opacity" fill="none" viewBox="0 0 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15.232 5.232l3.536 3.536M9 11l6.586-6.586a2 2 0 112.828 2.828L11.828 13.828A2 2 0 0110 14H8v-2a2 2 0 01.586-1.414z"/></svg>
            </span>
          </td>
          <td class="py-3 px-4 ${descClass}">${item.description}${badgesHtml}</td>
          <td class="py-3 px-4 text-right ${priceClass}">$${item.price.toFixed(2)}</td>
          <td class="py-3 px-4 text-center">${discountColHtml}</td>
          <td class="py-3 px-4 text-right ${importClass}">$${item.subtotal.toFixed(2)}${quickDeleteBtnHtml}</td>
        `;
      }

      const rowDelBtn = tr.querySelector("[data-row-del]");
      if (rowDelBtn) {
        rowDelBtn.addEventListener("click", (ev) => {
          ev.stopPropagation();
          removeCartRowByIndex(index);
        });
      }

      tr.querySelectorAll("[data-pos-sub-sku]").forEach(subBtn => {
        subBtn.addEventListener("click", (ev) => {
          ev.stopPropagation();
          const targetSubSku = subBtn.getAttribute("data-pos-sub-sku");
          const targetRowIdx = parseInt(subBtn.getAttribute("data-pos-sub-idx"), 10);
          loadSubstituteIntoPosCart(targetSubSku, targetRowIdx, item.quantity);
        });
      });

      tr.addEventListener("click", () => {
        selectedCartIndex = index;
        updateCartUI();
      });

      tr.addEventListener("dblclick", (e) => {
        e.preventDefault();
        if (document.getElementById('pos-left-section')?.getAttribute('data-pos-readonly') === 'true') return;
        selectedCartIndex = index;
        inlineEditingIndex = index;
        updateCartUI();
      });

      const tds = tr.querySelectorAll("td");
      if (tds[1]) {
        tds[1].style.cursor = "pointer";
        tds[1].title = "Clic o doble clic para editar";
        tds[1].addEventListener("click", (e) => {
          e.stopPropagation();
          if (document.getElementById('pos-left-section')?.getAttribute('data-pos-readonly') === 'true') return;
          selectedCartIndex = index;
          inlineEditingIndex = index;
          updateCartUI();
        });
      }

      tableBody.appendChild(tr);
    });

    if (inlineEditingIndex !== -1) {
      setTimeout(() => {
        const input = document.getElementById("inline-qty-input");
        if (input) {
          input.focus();
          input.select();

          input.addEventListener("input", () => {
            if (inlineEditingIndex === -1) return;
            const v = parseFloat(input.value);
            const it = cart[inlineEditingIndex];
            if (!it || isNaN(v) || v <= 0) return;
            it.quantity = v;
            const finLive = evaluatePosItemFinancials(it, targetScaleNow, v);
            it.price = finLive.unitPrice;
            it.offer_applied = finLive.offerApplied;
            it.offer_label = finLive.offerLabel;
            it.points_locked = finLive.pointsLocked;
            it.earned_points = finLive.earnedPoints;
            it.commission_pct = finLive.commissionPct;
            it.commission_amount = finLive.commissionAmountMxn;
            it.subtotal = v * it.price;
            const liveRow = tableBody.querySelectorAll("tr:not(#empty-cart-row)")[inlineEditingIndex];
            if (liveRow) {
              const cells = liveRow.querySelectorAll("td");
              if (cells.length >= 6) {
                cells[3].textContent = `$${it.price.toFixed(2)}`;
                cells[5].textContent = `$${it.subtotal.toFixed(2)}`;
              }
            }
            renderCartTotals();
            calculateChange();
          });

          input.addEventListener("keydown", (e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              e.stopPropagation();
              const val = parseFloat(input.value);
              if (!isNaN(val)) {
                if (val === 0) {
                  cart.splice(inlineEditingIndex, 1);
                  selectedCartIndex = cart.length > 0 ? 0 : -1;
                } else {
                  const item = cart[inlineEditingIndex];
                  item.quantity = val;
                  const finEnter = evaluatePosItemFinancials(item, targetScaleNow, val);
                  item.price = finEnter.unitPrice;
                  item.subtotal = val * item.price;
                }
                showToast("Cantidad modificada", "success");
              }
              inlineEditingIndex = -1;
              updateCartUI();
              focusProductInput();
            } else if (e.key === "Escape") {
              e.preventDefault();
              e.stopPropagation();
              inlineEditingIndex = -1;
              updateCartUI();
              focusProductInput();
            }
          });

          input.addEventListener("blur", () => {
            if (inlineEditingIndex === -1 || !input.isConnected) return;
            const val = parseFloat(input.value);
            if (!isNaN(val) && val > 0 && cart[inlineEditingIndex]) {
              cart[inlineEditingIndex].quantity = val;
              const finBlur = evaluatePosItemFinancials(cart[inlineEditingIndex], targetScaleNow, val);
              cart[inlineEditingIndex].price = finBlur.unitPrice;
              cart[inlineEditingIndex].subtotal = val * cart[inlineEditingIndex].price;
            }
            inlineEditingIndex = -1;
            updateCartUI();
          });
        }
      }, 0);
    }
  }

  renderCartTotals();
  calculateChange();
  } finally {
    updateCartUI._busy = false;
  }
}

function renderCartTotals() {
  const totals = calculateTotals();
  const totalDisplay = document.getElementById("total-display") || document.getElementById("total-amount-display");
  const subtotalDisplay = document.getElementById("subtotal-display");
  const ivaDisplay = document.getElementById("iva-display");
  const panel = document.getElementById("totals-panel") || document.getElementById("checkout-panel");
  const standardCheckout = document.getElementById("standard-checkout-panel") || document.getElementById("standard-checkout-view");
  const returnCheckout = document.getElementById("return-checkout-panel") || document.getElementById("return-checkout-view");
  const currencySymbol = document.getElementById("total-currency-symbol");

  if (totals.total < 0.0) {
    const absTotal = Math.abs(totals.total);
    const absSub = Math.abs(totals.subtotal);
    const absIva = Math.abs(totals.iva);

    if (panel) {
      panel.classList.remove("bg-[#1e3a8a]");
      panel.classList.add("bg-red-600");
    }
    if (currencySymbol) currencySymbol.innerText = "-$";
    if (totalDisplay) totalDisplay.innerText = absTotal.toFixed(2);
    if (subtotalDisplay) subtotalDisplay.innerText = `-$${absSub.toFixed(2)}`;
    if (ivaDisplay) ivaDisplay.innerText = `-$${absIva.toFixed(2)}`;

    if (standardCheckout) standardCheckout.classList.add("hidden");
    if (returnCheckout) returnCheckout.classList.remove("hidden");

    if (!activeReturnRefundMethod) {
      selectReturnRefundMethod("cash");
    }
    updateReturnRefundUI();
  } else {
    if (panel) {
      panel.classList.remove("bg-red-600");
      panel.classList.add("bg-[#1e3a8a]");
    }
    if (currencySymbol) currencySymbol.innerText = "$";
    if (totalDisplay) totalDisplay.innerText = totals.total.toFixed(2);
    if (subtotalDisplay) subtotalDisplay.innerText = `$${totals.subtotal.toFixed(2)}`;
    if (ivaDisplay) ivaDisplay.innerText = `$${totals.iva.toFixed(2)}`;

    if (standardCheckout) standardCheckout.classList.remove("hidden");
    if (returnCheckout) returnCheckout.classList.add("hidden");
  }

  const loyaltyRow = document.getElementById("loyalty-discount-row");
  const loyaltyDspEl = document.getElementById("loyalty-discount-display");
  if (loyaltyRow && loyaltyDspEl) {
    const ld = parseFloat(window._loyaltyMxnDiscount) || 0;
    if (ld > 0) {
      loyaltyDspEl.textContent = `-$${ld.toFixed(2)}`;
      loyaltyRow.classList.remove("hidden");
    } else {
      loyaltyRow.classList.add("hidden");
    }
  }
  const itemsCountText = cart.length === 1 ? "1 artículo" : `${cart.length} artículos`;
  document.getElementById("items-count-display").innerText = itemsCountText;

  const footCount = document.getElementById("cart-items-count");
  const footTotal = document.getElementById("cart-total-foot-display");
  if (footCount) {
    footCount.innerText = cart.length === 1 ? "1 ítem" : `${cart.length} ítems`;
  }
  if (footTotal) {
    footTotal.innerText = (totals.total < 0.0)
      ? `-$${Math.abs(totals.total).toFixed(2)}`
      : `$${totals.total.toFixed(2)}`;
    footTotal.classList.toggle("text-red-600", totals.total < 0.0);
    footTotal.classList.toggle("text-slate-800", totals.total >= 0.0);
  }
}

function calculateTotals() {
  const discountInput = document.getElementById("discount-input");
  let discount = parseFloat(discountInput ? discountInput.value : 0.0) || 0.0;
  const loyaltyDiscount = parseFloat(window._loyaltyMxnDiscount) || 0;

  const base_total = cart.reduce((sum, item) => sum + item.subtotal, 0);

  // CANDADO OBLIGATORIO #2: Bloqueo Duro en Caja (POS) contra Descuentos Bajo Costo Piso (Costo c/Flete + IVA + IEPS)
  if (base_total > 0 && (discount > 0 || loyaltyDiscount > 0)) {
    const minCartCostoPiso = cart.reduce((sum, item) => {
      if (item.quantity <= 0) return sum;
      const pisoUnit = parseFloat(item.costo_piso_iva) || getProductCostoPisoInfoPOS(item).costoPisoConIva || 0;
      return sum + (item.quantity * pisoUnit);
    }, 0);

    if (minCartCostoPiso > 0 && (base_total - discount - loyaltyDiscount) < (minCartCostoPiso - 0.005)) {
      const maxAllowedDiscount = Math.max(0, Number((base_total - minCartCostoPiso - loyaltyDiscount).toFixed(2)));
      discount = maxAllowedDiscount;
      if (discountInput) {
        discountInput.value = maxAllowedDiscount > 0 ? maxAllowedDiscount.toFixed(2) : "0.00";
      }
      showCostoPisoSecurityAlertPOS(minCartCostoPiso);
    }
  }

  let total = base_total - discount - loyaltyDiscount;
  if (base_total >= 0.0) {
    total = Math.max(0.0, total);
  }
  const subtotal = total / 1.16;
  const iva = total - subtotal;

  return { total, subtotal, iva, discount, loyaltyDiscount };
}

function navigateCart(direction) {
  if (cart.length === 0) return;
  selectedCartIndex += direction;
  // Hard wall: stop at first and last item, no wrap-around
  if (selectedCartIndex < 0) selectedCartIndex = 0;
  if (selectedCartIndex >= cart.length) selectedCartIndex = cart.length - 1;
  updateCartUI();
}

function modifySelectedCartQuantity(amount) {
  if (selectedCartIndex === -1 || cart.length === 0) return;
  const item = cart[selectedCartIndex];
  item.quantity += amount;
  if (item.quantity <= 0) {
    removeSelectedCartRow();
  } else {
    const targetScale = temporaryPriceScale || activePriceScale;
    const recalcPrice = getProductPriceForClient(item, targetScale);
    if (recalcPrice > 0) item.price = recalcPrice;
    item.subtotal = item.quantity * item.price;
    updateCartUI();
  }
}

function removeSelectedCartRow() {
  if (selectedCartIndex === -1 || cart.length === 0) return;
  const removedItem = cart[selectedCartIndex];
  cart.splice(selectedCartIndex, 1);
  showToast(`Eliminado: ${removedItem.description}`, "info");

  if (cart.length === 0) {
    selectedCartIndex = -1;
  } else if (selectedCartIndex >= cart.length) {
    selectedCartIndex = cart.length - 1;
  }
  updateCartUI();
  focusProductInput();
}

if (!window.__boundPosCartRealtimeOffersSync) {
  window.__boundPosCartRealtimeOffersSync = true;
  function handleRealtimePricingUpdate(payload) {
    if (!payload || !Array.isArray(window.cart) || window.cart.length === 0) return;
    const targetSku = String(payload.sku || (payload.product && payload.product.sku) || "").trim().toUpperCase();
    let updatedAny = false;
    window.cart.forEach(item => {
      if (!targetSku || String(item.sku || "").trim().toUpperCase() === targetSku) {
        if (payload.product && payload.product.meta_data) {
          item.meta_data = Object.assign({}, item.meta_data || {}, payload.product.meta_data);
        }
        if (Array.isArray(payload.product_price_scales)) {
          item.price_scales = payload.product_price_scales;
          item.meta_data = item.meta_data || {};
          item.meta_data.price_scales = payload.product_price_scales;
        }
        if (Array.isArray(payload.product_branch_scales)) {
          item.meta_data = item.meta_data || {};
          item.meta_data.branch_price_scales = payload.product_branch_scales;
        }
        if (Array.isArray(payload.product_offers)) {
          item.meta_data = item.meta_data || {};
          item.meta_data.product_offers = payload.product_offers;
        }
        updatedAny = true;
      }
    });
    if (updatedAny && typeof updateCartUI === "function") {
      updateCartUI();
    }
  }
  window.addEventListener("calebsys:pos-pricing-updated", function (ev) {
    handleRealtimePricingUpdate(ev && ev.detail);
  });
  if (typeof BroadcastChannel !== "undefined") {
    try {
      const bc = new BroadcastChannel("calebsys_pos_pricing_sync");
      bc.addEventListener("message", function (ev) {
        handleRealtimePricingUpdate(ev && ev.data);
      });
    } catch (e) {}
  }

  // Integrar Paquetes / Kits [F10] locales en búsquedas del Punto de Venta (/api/products/search)
  if (typeof window.fetch === "function" && !window.__posPackagesFetchHooked) {
    window.__posPackagesFetchHooked = true;
    const _origFetch = window.fetch.bind(window);
    window.fetch = async function (input, init) {
      const urlStr = typeof input === "string" ? input : (input && input.url ? input.url : "");
      const resp = await _origFetch(input, init);
      try {
        if (urlStr.includes("/api/products/search") && resp && resp.ok) {
          const rawPkts = localStorage.getItem("calebsys_packages_catalog_v1");
          const localPkts = rawPkts ? JSON.parse(rawPkts) : [];
          if (Array.isArray(localPkts) && localPkts.length > 0) {
            const cloned = resp.clone();
            const data = await cloned.json();
            if (Array.isArray(data)) {
              const uObj = new URL(urlStr, window.location.origin);
              const q = String(uObj.searchParams.get("q") || "").trim().toUpperCase();
              const existingSkus = new Set(data.map(p => String((p && p.sku) || "").trim().toUpperCase()));
              localPkts.forEach(pkt => {
                if (!pkt || !pkt.sku) return;
                const s = String(pkt.sku).trim().toUpperCase();
                const nm = String(pkt.name || pkt.description || "").trim().toUpperCase();
                if (existingSkus.has(s)) return;
                if (!q || s.includes(q) || nm.includes(q)) {
                  data.unshift(pkt);
                  existingSkus.add(s);
                }
              });
              return new Response(JSON.stringify(data), {
                status: resp.status,
                statusText: resp.statusText,
                headers: resp.headers
              });
            }
          }
        }
      } catch (e) {}
      return resp;
    };
  }
}

