/* 06-pos-checkout.js — Payment method, change calc, submitSale, ticket modal, print
   Extraido de app_v66.js (fase 3, modularizacion post-auditoria 2026-08-03)
   Lineas originales: 2764-3294 */
// --- SIDEBAR COBRAR & PAYMENT LOGIC (MÓDULO 5) ---

// GAP-2: handler ENTER en el importe — referencia módulo para poder limpiarlo
let _cashEnterHandler = null;

// Pago multimodal: formas de pago YA aplicadas (nunca incluye el efectivo de
// cierre — ese lo agrega submitSale()). [{ method:"003", amount: 500.00 }, ...]
let splitPayments = [];

const PAY_LABELS = {
  "001": "EFECTIVO", "002": "CHEQUE", "003": "T. CRÉDITO",
  "004": "TRANSFERENCIA", "006": "CRÉDITO", "008": "T. DÉBITO"
};

function _round2(n) { return Math.round((Number(n) || 0) * 100) / 100; }

// C-03: Lee los datos del panel de captura del método activo.
function _readPaymentMeta(method) {
  const v = id => { const el = document.getElementById(id); return el ? el.value.trim() : ""; };
  if (method === "002") {
    const m = { banco: v("chq-banco"), girador: v("chq-girador"), numero: v("chq-numero"), monto: v("chq-monto") };
    return (m.banco || m.numero) ? m : null;
  }
  if (method === "004") {
    const m = { referencia: v("trf-referencia"), banco_origen: v("trf-banco-origen"), estatus: v("trf-estatus") };
    return (m.referencia || m.banco_origen) ? m : null;
  }
  if (method === "003" || method === "008") {
    const m = { aprobacion: v("tdc-aprobacion"), recibo: v("tdc-recibo"), digitos: v("tdc-digitos"), fecha_hora: v("tdc-fecha") };
    return (m.aprobacion || m.digitos) ? m : null;
  }
  return null;
}

// C-03: Limpia todos los campos de los paneles de captura.
function _clearPaymentMeta() {
  ["chq-banco","chq-girador","chq-numero","chq-monto",
   "trf-referencia","trf-banco-origen",
   "tdc-aprobacion","tdc-recibo","tdc-digitos","tdc-fecha"].forEach(id => {
    const el = document.getElementById(id); if (el) el.value = "";
  });
  const sel = document.getElementById("trf-estatus"); if (sel) sel.value = "confirmada";
}

// C-03: Genera HTML de datos del método para el ticket térmico.
function _renderPayMetaHTML(meta, method) {
  if (!meta) return "";
  const row = (lbl, val) => val ? `<div class="t-flex t-small"><span>&nbsp;&nbsp;${lbl}:</span><span>${val}</span></div>` : "";
  if (method === "002") {
    return row("Banco", meta.banco) + row("Girador", meta.girador) + row("Nº Cheque", meta.numero);
  }
  if (method === "004") {
    return row("Referencia", meta.referencia) + row("Banco", meta.banco_origen) +
           (meta.estatus ? row("Estatus", meta.estatus.toUpperCase()) : "");
  }
  if (method === "003" || method === "008") {
    return row("Aprobación", meta.aprobacion) + row("Recibo", meta.recibo) +
           (meta.digitos ? row("Tarjeta", `**** ${meta.digitos}`) : "");
  }
  return "";
}

// Suma de lo ya aplicado en formas de pago no-efectivo.
function paymentApplied() {
  return _round2(splitPayments.reduce((s, p) => s + (Number(p.amount) || 0), 0));
}

// Lo que falta por cubrir del total (>= 0).
function paymentRestante() {
  const totals = calculateTotals();
  const sfAplicado = _getSaldoFavorAplicado();
  return Math.max(0, _round2(Math.abs(totals.total) - paymentApplied() - sfAplicado));
}

// E-06a: saldo_favor aplicado a esta venta (0 si el toggle no está activo).
function _getSaldoFavorAplicado() {
  const toggle = document.getElementById('saldo-favor-toggle');
  if (!toggle || !toggle.checked) return 0;
  const totals = calculateTotals();
  const disponible = parseFloat((activeClient && activeClient.saldo_favor) || 0);
  return Math.min(disponible, Math.abs(totals.total));
}

// E-06a/E-06b: mostrar/ocultar el row de saldo_favor y el banner de alerta.
function refreshSaldoFavorRow() {
  const row    = document.getElementById('saldo-favor-row');
  const label  = document.getElementById('saldo-favor-label');
  const toggle = document.getElementById('saldo-favor-toggle');
  const alert  = document.getElementById('saldo-favor-alert');
  const alertAmt = document.getElementById('saldo-favor-alert-amount');
  const alertBtn = document.getElementById('saldo-favor-alert-btn');

  const sf = parseFloat((activeClient && activeClient.saldo_favor) || 0);
  const fmtSf = '$' + sf.toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const sfApplied = toggle && toggle.checked;

  if (sf > 0) {
    // Fila toggle en panel cobro
    if (row)   row.classList.remove('hidden');
    if (label) label.textContent = fmtSf;

    // Banner de alerta en el carrito
    if (alert) alert.classList.remove('hidden');
    if (alertAmt) alertAmt.textContent = fmtSf;
    // Cambiar botón a "Quitar" si ya está aplicado
    if (alertBtn) {
      if (sfApplied) {
        alertBtn.textContent = 'Quitar';
        alertBtn.classList.replace('bg-emerald-500', 'bg-slate-400');
        alertBtn.classList.replace('hover:bg-emerald-600', 'hover:bg-slate-500');
      } else {
        alertBtn.textContent = 'Aplicar';
        alertBtn.classList.replace('bg-slate-400', 'bg-emerald-500');
        alertBtn.classList.replace('hover:bg-slate-500', 'hover:bg-emerald-600');
      }
    }
  } else {
    if (row)   row.classList.add('hidden');
    if (alert) alert.classList.add('hidden');
    if (toggle) toggle.checked = false;
  }
}

// E-06b: botón "Aplicar / Quitar" del banner de alerta.
function applySaldoFavorFromAlert() {
  const toggle = document.getElementById('saldo-favor-toggle');
  if (!toggle) return;
  toggle.checked = !toggle.checked;
  refreshSaldoFavorRow();
  calculateChange();
}

// E-06a/E-06b: recalcular cambio y sincronizar banner cuando se activa/desactiva.
function onSaldoFavorToggle() {
  refreshSaldoFavorRow();
  calculateChange();
}

function renderSplitPayments() {
  const box  = document.getElementById("split-payments-box");
  const list = document.getElementById("split-payments-list");
  const rest = document.getElementById("split-restante");
  if (!box || !list) return;

  if (!splitPayments.length) {
    box.classList.add("hidden");
    list.innerHTML = "";
  } else {
    box.classList.remove("hidden");
    list.innerHTML = splitPayments.map((p, i) =>
      `<div class="flex items-center justify-between text-[10px] font-bold text-blue-50">
         <span>${PAY_LABELS[p.method] || p.method}</span>
         <span class="flex items-center gap-2">
           <span>$${_round2(p.amount).toFixed(2)}</span>
           <button type="button" onclick="removeSplitPayment(${i})"
             class="text-red-300 hover:text-red-200 font-black leading-none" title="Quitar">✕</button>
         </span>
       </div>`
    ).join("");
  }
  if (rest) rest.textContent = `Restante $${paymentRestante().toFixed(2)}`;
}

function removeSplitPayment(i) {
  splitPayments.splice(i, 1);
  renderSplitPayments();
  const inp = document.getElementById("cash-received-input");
  if (inp) inp.value = paymentRestante().toFixed(2);
  calculateChange();
}

// Aplica el importe escrito como una forma de pago NO-efectivo y deja el foco
// listo para la siguiente. Si con esto se cubre el total, cierra la venta.
function applySplitPayment() {
  const m = activePaymentMethod;
  if (m === "001") { submitSale(); return; }          // efectivo = cierre
  if (m === "006") { return; }                        // crédito no se desglosa

  const inp = document.getElementById("cash-received-input");
  let amt = parseFloat(inp && inp.value);
  const rest = paymentRestante();

  if (isNaN(amt) || amt <= 0) {
    if (typeof showToast === "function") showToast("Escribe el importe de este pago", "warning");
    return;
  }
  // SÓLO el efectivo da cambio: un pago electrónico nunca puede exceder el saldo.
  amt = Math.min(_round2(amt), rest);
  if (amt <= 0) {
    if (typeof showToast === "function") showToast("El cobro ya está cubierto", "info");
    return;
  }

  const _meta = _readPaymentMeta(m);
  splitPayments.push({ method: m, amount: amt, ...(_meta ? { meta: _meta } : {}) });
  renderSplitPayments();

  const newRest = paymentRestante();
  if (newRest <= 0.005) {
    // Totalmente cubierto con formas no-efectivo → registrar.
    submitSale();
    return;
  }
  // Queda saldo: preparar el siguiente pago (efectivo al final).
  if (inp) { inp.value = newRest.toFixed(2); inp.focus(); inp.select(); }
  if (typeof showToast === "function") {
    showToast(`${PAY_LABELS[m] || m} $${amt.toFixed(2)} aplicado. Restante $${newRest.toFixed(2)} — elige la siguiente forma de pago (efectivo al final).`, "info");
  }
  calculateChange();
}

function selectPaymentMethod(method) {
  activePaymentMethod = method;

  const methodButtons = ["001", "002", "003", "004", "006", "008"];
  methodButtons.forEach(code => {
    const btn = document.getElementById(`pay-method-${code}`);
    if (btn) {
      btn.className = "bg-blue-950/20 border border-blue-900 text-blue-300 font-bold py-1.5 rounded-xl text-[9px] uppercase transition focus:outline-none select-none";
    }
  });
  const selectedBtn = document.getElementById(`pay-method-${method}`);
  if (selectedBtn) {
    selectedBtn.className = "bg-blue-800 border-2 border-blue-500 text-white font-bold py-1.5 rounded-xl text-[9px] uppercase transition focus:outline-none select-none";
  }

  const cashFields = document.getElementById("cash-calculation-fields");
  const cashInput  = document.getElementById("cash-received-input");
  const label      = document.getElementById("pay-amount-label");
  const hint       = document.getElementById("pay-amount-hint");
  const applyBtn   = document.getElementById("btn-aplicar-pago");
  const splitBox   = document.getElementById("split-payments-box");

  // Paneles de captura C-03 (datos de cheque / transferencia / tarjeta).
  const toggle = (id, on) => { const el = document.getElementById(id); if (el) el.classList.toggle("hidden", !on); };
  toggle("cheque-fields",        method === "002");
  toggle("transferencia-fields", method === "004");
  toggle("tarjeta-fields",       method === "003" || method === "008");
  const tarjetaLbl = document.getElementById("tarjeta-tipo-label");
  if (tarjetaLbl) tarjetaLbl.textContent = method === "003" ? "DATOS DE T. CRÉDITO" : "DATOS DE T. DÉBITO";

  // GAP-2: limpiar listener previo antes de asignar uno nuevo
  if (_cashEnterHandler && cashInput) {
    cashInput.removeEventListener('keydown', _cashEnterHandler);
    _cashEnterHandler = null;
  }

  renderSplitPayments();

  if (method === "006") {
    // Crédito: no es multimodal. El importe lo gobierna #advance-input.
    if (cashFields) cashFields.classList.add("hidden");
    if (splitBox)   splitBox.classList.add("hidden");
    calculateChange();
    return;
  }

  // Todos los demás métodos comparten el mismo input de importe.
  if (cashFields) cashFields.classList.remove("hidden");
  const rest = paymentRestante();
  if (cashInput) {
    cashInput.value = rest.toFixed(2);
  }

  if (method === "001") {
    // Efectivo = cierre de venta y ÚNICA forma que da cambio.
    if (label) label.textContent = splitPayments.length ? "EFECTIVO (CIERRE) — PAGA CON" : "PAGA CON (EFECTIVO)";
    if (hint)  hint.textContent  = "ENTER registra la venta. Editable con el efectivo que entrega el cliente para calcular el cambio.";
    if (applyBtn) applyBtn.classList.add("hidden");
    _cashEnterHandler = function (e) {
      if (e.key === 'Enter') { e.preventDefault(); submitSale(); }
    };
    if (cashInput) {
      cashInput.addEventListener('keydown', _cashEnterHandler);
      requestAnimationFrame(() => { cashInput.focus(); cashInput.select(); });
    }
  } else {
    // Cheque / T. Crédito / Transfer / T. Débito → se aplican como split.
    if (label) label.textContent = `IMPORTE — ${PAY_LABELS[method] || method}`;
    if (hint)  hint.textContent  = "Escribe el importe y ENTER. El efectivo se deja al final; los pagos electrónicos no dan cambio.";
    if (applyBtn) applyBtn.classList.remove("hidden");
    _cashEnterHandler = function (e) {
      if (e.key === 'Enter') { e.preventDefault(); applySplitPayment(); }
    };
    if (cashInput) {
      cashInput.addEventListener('keydown', _cashEnterHandler);
      requestAnimationFrame(() => { cashInput.focus(); cashInput.select(); });
    }
  }

  calculateChange();
}

// F7: activa el cobro — el panel cobro ya es visible (mitad inferior permanente).
// F7 ahora funciona como atajo de foco: valida carrito y mueve el foco
// al campo de pago activo. NO toca `hidden` de #standard-checkout-panel /
// #return-checkout-panel: esa visibilidad la maneja 04-pos-cart.js (flujo F2).
function enterCheckoutMode() {
  if (typeof cart === "undefined" || cart.length === 0) {
    if (typeof showToast === "function") {
      showToast("Agrega artículos al carrito antes de cobrar (F7)", "warning");
    }
    return;
  }

  // RBAC D-03: si el overlay de cobro está activo (rol sin permiso de cobro),
  // no forzar foco ni cambiar de método.
  if (document.getElementById("cobro-rbac-overlay")) {
    if (typeof showToast === "function") {
      showToast("El cobro no está disponible para tu rol", "warning");
    }
    return;
  }

  // Panel cobro siempre visible — actualizar UI y enfocar campo de pago.
  if (typeof updateCartUI === "function") updateCartUI();

  var method = (typeof activePaymentMethod !== "undefined" && activePaymentMethod)
    ? activePaymentMethod
    : "001";
  selectPaymentMethod(method);

  // selectPaymentMethod ya hace focus()+select() en requestAnimationFrame;
  // no se duplica aquí para no cancelar el frame pendiente.
}

// Botón Cancelar del panel cobro: regresa el foco al escáner de productos.
// El carrito y los inputs de cobro se conservan — no se descartan nada.
// Vaciar carrito y resetear campos es responsabilidad exclusiva de closeTicketModal().
// No toca la visibilidad de #standard/#return-checkout-panel (la gobierna 04-pos-cart.js).
function exitCheckoutMode() {
  // Panel cobro siempre visible — solo regresar foco al escáner.
  // Limpiar el listener ENTER de efectivo — mismo patrón que closeTicketModal().
  if (_cashEnterHandler) {
    var ci = document.getElementById("cash-received-input");
    if (ci) ci.removeEventListener('keydown', _cashEnterHandler);
    _cashEnterHandler = null;
  }
  // Devolver el foco al scanner para seguir editando el carrito.
  if (typeof focusProductInput === "function") {
    focusProductInput();
  } else {
    var p = document.getElementById("product-input");
    if (p) p.focus();
  }
}

function calculateChange() {
  const totals = calculateTotals();
  const cashInput = document.getElementById("cash-received-input");
  const advanceInput = document.getElementById("advance-input");
  const display = document.getElementById("change-returned-display");
  const label   = document.getElementById("change-label");
  if (!display) return;

  let received = parseFloat(cashInput && cashInput.value);
  if (isNaN(received)) received = 0.0;
  let advance = parseFloat(advanceInput && advanceInput.value);
  if (isNaN(advance)) advance = 0.0;

  if (activePaymentMethod === "001") {
    // Efectivo: ÚNICA forma que da cambio. Se compara contra lo que falta por
    // cubrir (total menos lo ya aplicado en pagos electrónicos).
    if (label) label.textContent = "CAMBIO:";
    const rest = paymentRestante();
    const change = _round2(received - rest);
    if (change < -0.005) {
      display.className = "text-sm text-red-400 font-extrabold";
      display.innerText = `Faltan $${Math.abs(change).toFixed(2)}`;
    } else {
      display.className = "text-sm text-green-400 font-extrabold";
      display.innerText = `$${Math.max(0, change).toFixed(2)}`;
    }
  } else if (activePaymentMethod === "006") {
    if (label) label.textContent = "SALDO CRÉDITO:";
    const remainingCredit = Math.abs(totals.total) - advance;
    display.className = "text-sm text-blue-300 font-extrabold";
    display.innerText = `$${Math.max(0, remainingCredit).toFixed(2)}`;
  } else {
    // Métodos electrónicos: no dan cambio.
    if (label) label.textContent = "CAMBIO:";
    display.className = "text-sm text-blue-300 font-extrabold";
    display.innerText = "$0.00 (sin cambio)";
  }
}

function validateRFC(rfc) {
  if (!rfc) return false;
  // Standard Mexican RFC format length validation
  const cleanRfc = rfc.trim().toUpperCase();
  return (cleanRfc.length === 12 || cleanRfc.length === 13) && cleanRfc !== "XAXX010101000";
}

function submitSale() {
  const totals = calculateTotals();
  if (cart.length === 0) {
    showToast("No hay productos en el carrito", "warning");
    return;
  }

  if (totals.total < 0.0) {
    // Return operation!
    const absTotal = Math.abs(totals.total);
    let cashRefunded = 0.0;
    let creditRefunded = 0.0;

    if (activeReturnRefundMethod === "cash") {
      cashRefunded = absTotal;
    } else if (activeReturnRefundMethod === "credit") {
      creditRefunded = absTotal;
    } else if (activeReturnRefundMethod === "mixed") {
      const inputVal = parseFloat(document.getElementById("return-cash-returned").value) || 0.0;
      cashRefunded = Math.min(absTotal, inputVal);
      creditRefunded = Math.max(0.0, absTotal - cashRefunded);
    }

    let clientPhone = "";
    if (creditRefunded > 0) {
      const clientDetails = getClientDeterministicDetails(activeClient);
      let defaultPhone = clientDetails.phone ? clientDetails.phone.replace(/[^0-9]/g, '') : "";
      if (defaultPhone.startsWith("52")) {
        defaultPhone = defaultPhone.substring(2);
      }
      
      if (activeClient.id === 1 || !defaultPhone || defaultPhone.length !== 10) {
        const phonePrompt = prompt("Ingrese el número de teléfono del cliente (10 dígitos) para asignar el Saldo a Favor:", "");
        if (!phonePrompt) {
          showToast("Operación cancelada: se requiere teléfono para asignar Saldo a Favor.", "error");
          return;
        }
        clientPhone = phonePrompt.replace(/[^0-9]/g, '');
        if (clientPhone.length !== 10) {
          showToast("El número de teléfono debe tener exactamente 10 dígitos.", "error");
          return;
        }
      } else {
        clientPhone = defaultPhone;
      }
    }

    const saleItems = cart.map(item => ({
      product_sku: item.sku,
      quantity: item.quantity,
      price: item.price,
      subtotal: item.subtotal
    }));

    const saleBody = {
      client_id: persistedClientId(),
      total: totals.total,
      payment_method: "001",
      amount_paid: -cashRefunded,
      change_returned: 0.0,
      is_cfdi: false,
      discount: totals.discount,
      advance: 0.0,
      is_safekept: false,
      items: saleItems
    };

    apiFetch(`${API_BASE}/sales`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(saleBody)
    })
    .then(res => {
      if (!res.ok) throw new Error("Return sale creation failed");
      return res.json();
    })
    .then(async dbSale => {
      if (creditRefunded > 0) {
        const refundResponse = await apiFetch(`${API_BASE}/clients/by-phone/${clientPhone}/add-saldo-favor`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            amount: creditRefunded,
            description: `Devolución de saldo de Venta #${dbSale.id}`
          })
        });
        if (refundResponse.ok) {
          const updatedClient = await refundResponse.json();
          showToast(`Devolución registrada. Saldo a Favor de $${creditRefunded.toFixed(2)} asignado a ${updatedClient.name}.`, "success");
        } else {
          showToast("Venta registrada, pero falló la asignación de Saldo a Favor.", "error");
        }
      } else {
        showToast("Devolución registrada con éxito en caja (Dinero Regresado).", "success");
      }

      dbSale.notes = `DEVOLUCIÓN DE SALDO\nREFUND TOTAL: -$${absTotal.toFixed(2)}\nEFECTIVO REGRESADO: $${cashRefunded.toFixed(2)}\nSALDO A FAVOR ASIGNADO: $${creditRefunded.toFixed(2)}`;
      
      cart = [];
      updateCartUI();
      openTicketModal(dbSale);
    })
    .catch(err => {
      showToast(`Error al registrar devolución: ${err.message}`, "error");
    });

    return;
  }

  // 1. Validation for Invoicing CFDI 4.0
  const isCFDI = document.getElementById("cfdi-toggle").checked;
  if (isCFDI) {
    if (!validateRFC(activeClient.rfc)) {
      showToast("Error CFDI: El cliente no cuenta con un RFC fiscal válido.", "error");
      return;
    }
  }

  // 2. Validation for Credit Sales (Público General cannot have Credit)
  if (activePaymentMethod === "006" && activeClient.id === 1) {
    showToast("Error Crédito: Público General no cuenta con línea de crédito.", "error");
    return;
  }

  // 3. Extract inputs
  const isSafekept = document.getElementById("safekept-toggle").checked;
  const advance = parseFloat(document.getElementById("advance-input").value) || 0.0;
  const saldoFavorAplicado = _getSaldoFavorAplicado();

  // ── Desglose de pago (multimodal) ─────────────────────────────────────
  // splitPayments = formas NO-efectivo ya aplicadas. Aquí se cierra con
  // efectivo (o con el propio método si no hay efectivo). SÓLO el efectivo
  // puede generar cambio.
  let payments = splitPayments.map(p => ({ method: p.method, amount: _round2(p.amount), ...(p.meta ? { meta: p.meta } : {}) }));
  let received = 0.0;   // total efectivamente cubierto
  let change   = 0.0;   // vueltas (sólo efectivo)
  let finalMethod = activePaymentMethod;
  window._lastSalePayments = null;   // para el ticket

  if (activePaymentMethod === "006") {
    // Crédito: sin multimodal. Lo pagado = anticipo; el resto queda a crédito.
    payments = [];
    received = advance;
    finalMethod = "006";
  } else {
    const cubiertoPrevio = payments.reduce((s, p) => s + p.amount, 0);
    const restante = _round2(totals.total - cubiertoPrevio);

    if (restante < -0.005) {
      showToast("Los pagos aplicados exceden el total. Quita alguno.", "error");
      return;
    }

    if (activePaymentMethod === "001") {
      // Efectivo = cierre. Único que da cambio.
      const val = parseFloat(document.getElementById("cash-received-input").value);
      const cashGiven = isNaN(val) ? 0.0 : _round2(val);
      if (cashGiven < restante - 0.005) {
        showToast(`Faltan $${(restante - cashGiven).toFixed(2)} en efectivo para cubrir el total`, "error");
        return;
      }
      if (restante > 0.005) payments.push({ method: "001", amount: restante });
      received = _round2(totals.total);
      change   = _round2(cashGiven - restante);
    } else {
      // Método no-efectivo como cierre (sin efectivo final).
      const val = parseFloat(document.getElementById("cash-received-input").value);
      let amt = isNaN(val) ? restante : Math.min(_round2(val), restante);
      const _closingMeta = _readPaymentMeta(activePaymentMethod);
      if (amt > 0.005) payments.push({ method: activePaymentMethod, amount: amt, ...(_closingMeta ? { meta: _closingMeta } : {}) });
      const cubierto = payments.reduce((s, p) => s + p.amount, 0);
      if (cubierto < totals.total - 0.005) {
        showToast(`Falta cubrir $${(totals.total - cubierto).toFixed(2)}. Agrega otro pago — el efectivo va al final.`, "error");
        return;
      }
      received = _round2(cubierto);
      change   = 0.0;   // sin efectivo → sin cambio
    }

    finalMethod = payments.length > 1
      ? "MIXTO"
      : (payments[0] ? payments[0].method : activePaymentMethod);
    if (payments.length > 1) {
      window._lastSalePayments = payments.map(p => ({
        method: p.method, label: (PAY_LABELS[p.method] || p.method), amount: _round2(p.amount),
        ...(p.meta ? { meta: p.meta } : {})
      }));
    } else if (payments.length === 1 && payments[0].meta) {
      // Método único con datos de captura (cheque/tarjeta/transferencia).
      window._lastSalePayments = [{
        method: payments[0].method, label: PAY_LABELS[payments[0].method] || payments[0].method,
        amount: _round2(payments[0].amount), meta: payments[0].meta
      }];
    }
  }

  // Prep items payload
  const saleItems = cart.map(item => ({
    product_sku: item.sku,
    quantity: item.quantity,
    price: item.price,
    subtotal: item.subtotal
  }));

  const saleBody = {
    client_id: persistedClientId(),
    total: totals.total,
    payment_method: finalMethod,
    amount_paid: received,
    change_returned: Math.max(0.0, change),
    is_cfdi: isCFDI,
    discount: totals.discount,
    advance: advance,
    is_safekept: isSafekept,
    saldo_favor_applied: saldoFavorAplicado,
    items: saleItems
  };
  if (window._lastSalePayments) {
    saleBody.payment_details = { splits: window._lastSalePayments };
  }

  // D-4: Offline queue — save to IndexedDB when there is no connectivity.
  // Credit (006) and CFDI require server-side processing; they cannot be queued.
  if (!navigator.onLine && typeof offlineQueuePush === 'function') {
    if (isCFDI) {
      showToast('Sin conexión — la factura CFDI requiere internet. Procesa la venta sin CFDI.', 'error');
      return;
    }
    if (finalMethod === '006') {
      showToast('Sin conexión — las ventas a crédito requieren internet.', 'error');
      return;
    }
    const offlineBody = {
      ...saleBody,
      items: cart.map(item => ({
        product_sku: item.sku,
        quantity:    item.quantity,
        price:       item.price,
        subtotal:    item.subtotal,
        description: item.name || item.sku
      }))
    };
    offlineQueuePush(offlineBody).then(localId => {
      _oqRefreshBadge();
      const syntheticSale = {
        id:              `OFFLINE-${localId}`,
        folio:           `OFF-${String(localId).padStart(4, '0')}`,
        created_at:      new Date().toISOString(),
        total:           offlineBody.total,
        payment_method:  offlineBody.payment_method,
        payment_details: offlineBody.payment_details || null,
        discount:        offlineBody.discount,
        amount_paid:     offlineBody.amount_paid,
        change_returned: offlineBody.change_returned,
        is_cfdi:         false,
        is_safekept:     offlineBody.is_safekept,
        items:           offlineBody.items,
        client:          { name: activeClient?.name, rfc: activeClient?.rfc, phone: activeClient?.phone },
        resguardos:      [],
        nr04_sub_sales:  [],
        _offline:        true
      };
      if (window._lastSalePayments && !syntheticSale.payment_details) {
        syntheticSale.payment_details = { splits: window._lastSalePayments };
      }
      showToast('Sin conexión — venta guardada localmente', 'warning');
      document.getElementById("last-ticket-id").innerText = `#${syntheticSale.folio}`;
      document.getElementById("discount-input").value  = "";
      document.getElementById("advance-input").value   = "";
      document.getElementById("cfdi-toggle").checked   = false;
      document.getElementById("safekept-toggle").checked = false;
      const _sfTgl = document.getElementById("saldo-favor-toggle");
      if (_sfTgl) _sfTgl.checked = false;
      splitPayments = [];
      window._lastSalePayments = null;
      if (typeof renderSplitPayments === 'function') renderSplitPayments();
      _clearPaymentMeta();
      if ((window._loyaltyPtsUsed || 0) > 0 && typeof clearLoyaltyDiscount === 'function') {
        clearLoyaltyDiscount();
      }
      cart = [];
      updateCartUI();
      openTicketModal(syntheticSale);
    }).catch(err => {
      console.error('[CALEBSYS] offline enqueue failed:', err);
      showToast('Error al guardar venta offline. Verifique almacenamiento del navegador.', 'error');
    });
    return;
  }

  apiFetch(`${API_BASE}/sales`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(saleBody)
  })
    .then(res => {
      if (!res.ok) {
        // Leer body del error para diagnóstico visible
        return res.text().then(errText => {
          let detail = errText;
          try { detail = JSON.stringify(JSON.parse(errText)); } catch(_) {}
          throw new Error(`HTTP ${res.status} — ${detail}`);
        });
      }
      return res.json();
    })
    .then(dbSale => {
      showToast("Venta registrada con éxito", "success");
      const _resg = (dbSale.resguardos || []).filter(r => (r.quantity_pending || 0) > 0);
      if (_resg.length) {
        showToast(`▣ ${_resg.length} artículo(s) sin stock quedaron en resguardo — se avisará al cliente cuando lleguen`, "warn");
      }
      // NR-04: mostrar folios de sub-facturas generadas automáticamente
      if (Array.isArray(dbSale.nr04_sub_sales) && dbSale.nr04_sub_sales.length > 0) {
        const subFolios = dbSale.nr04_sub_sales.map(s => s.folio).join(", ");
        showToast(`NR-04: venta dividida en ${dbSale.nr04_sub_sales.length + 1} facturas: ${dbSale.folio || ""}, ${subFolios}`, "warn");
      }
      document.getElementById("last-ticket-id").innerText = `#${dbSale.id}`;

      // El backend guarda payment_details como texto; para el ticket usamos el
      // desglose local capturado al enviar (window._lastSalePayments).
      if (window._lastSalePayments && !dbSale.payment_details) {
        dbSale.payment_details = { splits: window._lastSalePayments };
      }

      // Reset sidebar checkout adjustments + desglose multimodal
      document.getElementById("discount-input").value = "";
      document.getElementById("advance-input").value = "";
      document.getElementById("cfdi-toggle").checked = false;
      document.getElementById("safekept-toggle").checked = false;
      const _sfToggle = document.getElementById("saldo-favor-toggle");
      if (_sfToggle) _sfToggle.checked = false;
      splitPayments = [];
      window._lastSalePayments = null;
      renderSplitPayments();
      _clearPaymentMeta();

      // E-06a: actualizar saldo_favor en activeClient si se aplicó alguno
      if (saldoFavorAplicado > 0 && typeof activeClient !== 'undefined' && activeClient) {
        activeClient.saldo_favor = Math.max(0, (activeClient.saldo_favor || 0) - saldoFavorAplicado);
        refreshSaldoFavorRow();
      }

      // Ítem 1: si hubo puntos aplicados, registrar canje en el backend
      if (window._loyaltyPtsUsed > 0 && saleBody.client_id && saleBody.client_id !== "1") {
        const _cid   = saleBody.client_id;
        const _pts   = window._loyaltyPtsUsed;
        const _sid   = dbSale.id;
        apiFetch(`/api/loyalty/clients/${encodeURIComponent(_cid)}/redeem`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            client_id: _cid,
            redemption_mode: "pago_parcial",
            puntos_canjeados: _pts,
            sale_id: _sid,
            notas: "Canje en checkout POS"
          })
        }).catch(() => {});  // silencioso: la venta ya está registrada
        clearLoyaltyDiscount();
      }

      openTicketModal(dbSale);
    })
    .catch((err) => {
      // ⚠️ Error real de API — NO falsear éxito, NO abrir ticket, carrito intacto
      console.error("[CALEBSYS] submitSale falló:", err.message);
      showToast(`❌ Error al guardar venta: ${err.message}`, "error");
      // El carrito permanece intacto para que el cajero pueda reintentar
    });
}

function openTicketModal(sale, isQuote = false) {
  const container = document.getElementById("thermal-ticket-container");
  activeTicketIsQuote = isQuote;
  window._currentTicketSale = sale;
  const cfg = getSisConfig();

  // ── Mapas de forma de pago ──
  const methodMap = {
    "001":"EFECTIVO","002":"CHEQUE","003":"T. CRÉDITO",
    "004":"TRANSFERENCIA","006":"CRÉDITO","008":"T. DÉBITO"
  };

  const dateObj  = new Date(sale.created_at);
  const fDate    = dateObj.toLocaleDateString("es-MX", {day:"2-digit",month:"2-digit",year:"numeric"});
  const fTime    = dateObj.toLocaleTimeString("es-MX", {hour:"2-digit",minute:"2-digit",hour12:true});
  const folio    = sale.folio || sale.id.slice(0, 6).toUpperCase();
  const isRefund = sale.total < 0;
  const isCredit = sale.payment_method === "006";
  const isCoti   = sale.payment_method === "COTIZACIÓN" || isQuote;
  const isMixto  = sale.payment_method === "MIXTO";
  // Desglose multimodal: puede venir como objeto (local) o string JSON (backend).
  let _pd = sale.payment_details;
  if (typeof _pd === "string") { try { _pd = JSON.parse(_pd); } catch (_) { _pd = null; } }
  const saleSplits = (_pd && Array.isArray(_pd.splits)) ? _pd.splits : null;
  const metodoPago = isCoti ? "COTIZACIÓN"
    : isMixto ? "PAGO MIXTO"
    : (methodMap[sale.payment_method] || sale.payment_method || "EFECTIVO");

  const clientName  = (sale.client?.name  || activeClient?.name  || "PÚBLICO EN GENERAL").toUpperCase();
  const clientRfc   = (sale.client?.rfc   || activeClient?.rfc   || "XAXX010101000").toUpperCase();
  const clientPhone = sale.client?.phone  || activeClient?.phone  || "";
  const cajero      = (document.getElementById("cashier-name")?.textContent || "CAJA 1").toUpperCase();
  const docLabel    = isCoti ? "COTIZACIÓN" : isRefund ? "DEVOLUCIÓN" : "TICKET";

  // ── Filas de productos ──
  const itemsToPrint = sale.items || [];
  const itemsHTML = itemsToPrint.map(item => {
    const desc    = (item.description || `PROD ${item.product_sku}`).substring(0,22).toUpperCase();
    const isNeg   = (item.quantity || 0) < 0;
    const absQty  = Math.abs(item.quantity);
    const qtyStr  = (isNeg ? "-" : "") + (absQty % 1 === 0 ? absQty.toFixed(0) : absQty.toFixed(2));
    const imp     = Math.abs(item.subtotal).toFixed(2);
    const impStr  = isNeg ? `-$${imp}` : `$${imp}`;
    return `
      <div style="margin-bottom:5px">
        <div class="t-bold">${desc}</div>
        <div class="t-item-row">
          <div class="t-col-50">${item.product_sku}</div>
          <div class="t-col-25c">${qtyStr}</div>
          <div class="t-col-25r">${impStr}</div>
        </div>
      </div>`;
  }).join("");

  // ── Cálculo de totales ──
  const absTotal   = Math.abs(sale.total);
  const subtotalNI = absTotal / 1.16;
  const iva        = absTotal - subtotalNI;

  // ── Bloque de descuento (opcional) ──
  const discountHTML = (sale.discount > 0)
    ? `<div class="t-flex"><span>DESCUENTO:</span><span>-$${sale.discount.toFixed(2)}</span></div>`
    : "";

  // ── Bloque de pago según tipo ──
  let payHTML = `<div class="t-flex"><span>FORMA DE PAGO:</span><span>${metodoPago}</span></div>`;
  if (isRefund) {
    const cashR   = Math.abs(sale.amount_paid || 0);
    const creditR = Math.max(0, absTotal - cashR);
    payHTML += `<div class="t-flex"><span>EFECTIVO REGRESADO:</span><span>$${cashR.toFixed(2)}</span></div>`;
    if (creditR > 0)
      payHTML += `<div class="t-flex t-bold"><span>SALDO A FAVOR:</span><span>$${creditR.toFixed(2)}</span></div>`;
  } else if (isCredit) {
    const adv  = sale.advance || 0;
    payHTML += `<div class="t-flex"><span>ANTICIPO:</span><span>$${adv.toFixed(2)}</span></div>`;
    payHTML += `<div class="t-flex t-bold"><span>SALDO CRÉDITO:</span><span>$${(absTotal - adv).toFixed(2)}</span></div>`;
  } else if (!isCoti) {
    const recibido = sale.amount_paid || 0;
    const cambio   = sale.change_returned || 0;
    if (saleSplits && saleSplits.length) {
      // Pago multimodal: renglón por forma de pago + datos capturados (C-03).
      saleSplits.forEach(s => {
        payHTML += `<div class="t-flex"><span>· ${(s.label || methodMap[s.method] || s.method)}:</span><span>$${Number(s.amount || 0).toFixed(2)}</span></div>`;
        payHTML += _renderPayMetaHTML(s.meta || null, s.method);
      });
    } else if (_pd && _pd.splits && _pd.splits[0] && _pd.splits[0].meta) {
      // Método único con datos de captura (cheque/tarjeta/transferencia).
      payHTML += _renderPayMetaHTML(_pd.splits[0].meta, sale.payment_method);
    }
    payHTML += `<div class="t-flex"><span>RECIBIDO:</span><span>$${recibido.toFixed(2)}</span></div>`;
    payHTML += `<div class="t-flex t-bold"><span>CAMBIO:</span><span>$${cambio.toFixed(2)}</span></div>`;
  }

  // ── Badges especiales ──
  let badgesHTML = "";
  if (sale.is_cfdi)
    badgesHTML += `<div class="t-center t-bold" style="border:1px solid #000;padding:3px;margin:5px 0">★ FACTURADO CFDI 4.0 ★</div>`;
  if (sale.is_safekept)
    badgesHTML += `<div class="t-center t-bold" style="border:1px solid #000;padding:3px;margin:5px 0">▣ RESGUARDO DE MATERIAL</div>`;
  if (isCoti)
    badgesHTML += `
      <div class="t-center" style="border:1px dashed #000;padding:5px;margin:5px 0">
        <div class="t-bold">COTIZACIÓN - NO ES COMPROBANTE FISCAL</div>
        <div class="t-small">VALIDEZ: 15 DÍAS NATURALES</div>
      </div>`;

  // ── T-4f: renglones a resguardo por faltante ──
  const _resg = (sale.resguardos || []).filter(r => (r.quantity_pending || 0) > 0);
  if (_resg.length) {
    badgesHTML += `
      <div style="border:1px solid #000;padding:5px;margin:5px 0">
        <div class="t-bold t-center">▣ ARTÍCULOS EN RESGUARDO</div>
        ${_resg.map(r => `<div class="t-small">${r.product_sku} · ${r.quantity_pending} pza · llega aprox. ${r.eta_date || "por confirmar"}</div>`).join("")}
        <div class="t-small t-center" style="margin-top:3px">Se te avisará cuando esté listo para recoger.</div>
      </div>`;
  }

  // ── Domicilio (opcional) ──
  let delivHTML = "";
  if (deliveryDetails) {
    delivHTML = `
      <div class="t-divider"></div>
      <div class="t-bold">📦 ENTREGA A DOMICILIO:</div>
      <div>CALLE: ${deliveryDetails.street}</div>
      <div>COL: ${deliveryDetails.colony}</div>
      <div>TEL: ${deliveryDetails.phone || "S/N"}</div>
      <div>FECHA: ${deliveryDetails.date || "S/N"}</div>
      ${deliveryDetails.notes ? `<div>NOTAS: ${deliveryDetails.notes}</div>` : ""}`;
  }

  // ── Mensaje de pie ──
  const footerMsg = isRefund
    ? "✓ DEVOLUCIÓN REGISTRADA"
    : isCoti
      ? "GRACIAS POR SU PREFERENCIA"
      : "¡GRACIAS POR SU COMPRA! VUELVA PRONTO";

  // ════════════════════════════════════════════
  // PLANTILLA MAESTRA 80MM (estructura exacta)
  // ════════════════════════════════════════════
  const blankLines = parseInt(cfg.ticketBlankLines || "0");
  const spacing = "<br>".repeat(blankLines);
  const logoHtml = (cfg.termLogo && cfg.bizLogo) ? `<div class="t-center" style="margin-bottom:10px"><img src="${cfg.bizLogo}" style="max-width:60mm;max-height:30mm;filter:grayscale(100%) contrast(1.2)"></div>` : "";

  const ticketHTML = `
<div id="ticket-80mm" class="ticket-container">

  <!-- CABECERA -->
  ${spacing}
  ${logoHtml}
  <div class="t-center">
    <div class="t-bold t-large">${cfg.bizName || "MAGDALENO"}</div>
    <div>${cfg.bizGiro || "MADERAS & MATERIALES"}</div>
    <div>${cfg.bizAddress || "CALLE HIDALGO #124, COL. CENTRO"}</div>
    <div>TEL: ${cfg.bizPhone || "(615) 157-0000"}</div>
    ${cfg.bizRfc ? `<div>RFC: ${cfg.bizRfc}</div>` : ""}
  </div>

  <div class="t-divider"></div>

  <!-- DATOS DEL DOCUMENTO -->
  <div class="t-flex"><span>${docLabel}:</span><span class="t-bold">#${folio}</span></div>
  <div class="t-flex"><span>FECHA:</span><span>${fDate}</span></div>
  <div class="t-flex"><span>HORA:</span><span>${fTime}</span></div>
  <div class="t-flex"><span>CAJERO:</span><span>${cajero}</span></div>

  <div class="t-divider"></div>

  <!-- CLIENTE -->
  <div>CLIENTE: ${clientName}</div>
  <div>RFC: ${clientRfc}</div>
  ${clientPhone ? `<div>TEL: ${clientPhone}</div>` : ""}

  <div class="t-divider"></div>

  <!-- ENCABEZADO COLUMNAS -->
  <div class="t-item-row t-bold">
    <div class="t-col-50">ARTÍCULO</div>
    <div class="t-col-25c">CANT</div>
    <div class="t-col-25r">IMPORTE</div>
  </div>
  <div class="t-divider-solid"></div>

  <!-- PRODUCTOS -->
  ${itemsHTML}

  <div class="t-divider-solid"></div>

  <!-- TOTALES -->
  ${discountHTML}
  <div class="t-flex"><span>SUBTOTAL S/IVA:</span><span>$${subtotalNI.toFixed(2)}</span></div>
  <div class="t-flex"><span>IVA (16%):</span><span>$${iva.toFixed(2)}</span></div>
  <div class="t-flex t-bold t-large" style="margin-top:3px">
    <span>${isRefund ? "DEVOLUCIÓN:" : "TOTAL:"}</span>
    <span>${isRefund ? "-" : ""}$${absTotal.toFixed(2)}</span>
  </div>

  <div class="t-divider"></div>

  <!-- PAGO -->
  ${payHTML}

  <!-- DOMICILIO -->
  ${delivHTML}

  <!-- BADGES -->
  ${badgesHTML}

  <!-- CÓDIGO DE BARRAS REAL -->
  <div class="t-center t-barcode" style="margin-top:10px">*${folio}*</div>
  <div class="t-center t-small" style="letter-spacing:4px">${folio.split("").join(" ")}</div>

  <!-- PIE -->
  <div class="t-center" style="margin-top:12px;font-size:10px">
    ${footerMsg}<br>VENDEDOR VIRTUAL - CALEBSYS V2.0
  </div>

</div>`;

  container.innerHTML = ticketHTML;
  document.getElementById("modal-ticket").classList.remove("hidden");
  activeModal = "modal-ticket";
}

function printTicketText() {
  // ✅ SOLUCIÓN CORRECTA PARA IMPRESORAS TÉRMICAS:
  // Usamos window.print() en la MISMA PÁGINA.
  // El @media print en el <head> de index.html oculta todo
  // excepto #ticket-80mm — cero páginas en blanco garantizado.
  window.print();
}

function closeTicketModal() {

  document.getElementById("modal-ticket").classList.add("hidden");
  activeModal = null;
  
  if (!activeTicketIsQuote) {
    cart = [];
    
    // Reset return mode state and layout styling
    isReturnModeActive = false;
    const f2Btn = document.getElementById("btn-f2-devolucion");
    if (f2Btn) {
      f2Btn.style.borderColor = "";
      f2Btn.style.backgroundColor = "";
      f2Btn.style.color = "";
    }

    updateClientDisplay(getWalkInClient());

    // Reset Inputs
    document.getElementById("cash-received-input").value = "";
    document.getElementById("discount-input").value = "";
    document.getElementById("advance-input").value = "";
    document.getElementById("cfdi-toggle").checked = false;
    document.getElementById("safekept-toggle").checked = false;
    const _sfT = document.getElementById("saldo-favor-toggle");
    if (_sfT) _sfT.checked = false;
    deliveryDetails = null; // Clear delivery details for next sale

    // Limpiar el desglose de pago multimodal para la siguiente venta.
    splitPayments = [];
    window._lastSalePayments = null;
    if (typeof renderSplitPayments === "function") renderSplitPayments();

    updateCartUI();
  }
  
  activeTicketIsQuote = false;
  // Panel cobro siempre visible — no se oculta al cerrar ticket.
  // GAP-2: limpiar listener ENTER de efectivo al cerrar ticket
  if (_cashEnterHandler) {
    const ci = document.getElementById("cash-received-input");
    if (ci) ci.removeEventListener('keydown', _cashEnterHandler);
    _cashEnterHandler = null;
  }
  focusProductInput();
}

// ── Ítem 1: Puntos de lealtad en checkout ────────────────────────────────────

window._loyaltyPtsUsed     = 0;   // puntos comprometidos en esta venta
window._loyaltyValorPunto  = 1.0; // MXN/punto (cargado con el cliente)
window._loyaltyPtsBalance  = 0;   // saldo del cliente
window._loyaltyMxnDiscount = 0;   // MXN descontados por puntos (separado de discount-input)

function loadLoyaltyPtsForClient(clientId) {
  const panel = document.getElementById("loyalty-pts-panel");
  if (!panel) return;
  if (!clientId || clientId === "1") { panel.classList.add("hidden"); return; }

  apiFetch(`/api/loyalty/clients/${encodeURIComponent(clientId)}/points`)
    .then(r => r.ok ? r.json() : null)
    .then(d => {
      if (!d) { panel.classList.add("hidden"); return; }
      window._loyaltyPtsBalance = d.puntos || 0;
      window._loyaltyValorPunto = d.puntos > 0 ? (d.valor_mxn / d.puntos) : 1.0;
      const infoEl = document.getElementById("loyalty-pts-info");
      if (infoEl) infoEl.textContent = `${d.puntos} pts = $${(d.valor_mxn||0).toFixed(2)}`;
      if (d.puntos > 0) {
        panel.classList.remove("hidden");
      } else {
        panel.classList.add("hidden");
      }
    }).catch(() => panel.classList.add("hidden"));
}

function previewLoyaltyDiscount() {
  const inp     = document.getElementById("loyalty-pts-input");
  const preview = document.getElementById("loyalty-pts-preview");
  if (!inp || !preview) return;
  const pts = parseInt(inp.value) || 0;
  if (pts <= 0) { preview.classList.add("hidden"); return; }
  const mxn = (pts * window._loyaltyValorPunto).toFixed(2);
  preview.textContent = `= $${mxn} de descuento`;
  preview.classList.remove("hidden");
}

function applyLoyaltyDiscount() {
  const inp = document.getElementById("loyalty-pts-input");
  const pts = parseInt(inp && inp.value) || 0;
  if (pts <= 0) { showToast("Ingresa cuántos puntos usar", "warning"); return; }
  if (pts > window._loyaltyPtsBalance) {
    showToast(`Sólo tiene ${window._loyaltyPtsBalance} pts disponibles`, "warning"); return;
  }
  const mxnRaw = _round2(pts * window._loyaltyValorPunto);
  // Cap: descuento de puntos no puede superar lo que falta por pagar (menos el descuento manual)
  const baseTot = cart.reduce((s, i) => s + i.subtotal, 0);
  const manualDisc = parseFloat(document.getElementById("discount-input")?.value) || 0;
  const maxRoom = Math.max(0, _round2(baseTot - manualDisc));
  const mxn = Math.min(mxnRaw, maxRoom);

  window._loyaltyPtsUsed     = pts;
  window._loyaltyMxnDiscount = mxn;

  const clearBtn = document.getElementById("loyalty-pts-clear");
  const preview  = document.getElementById("loyalty-pts-preview");
  if (clearBtn) clearBtn.classList.remove("hidden");
  if (inp)      inp.disabled = true;
  if (preview)  { preview.textContent = `= $${mxn.toFixed(2)} aplicado`; preview.classList.remove("hidden"); }
  showToast(`${pts} pts = $${mxn.toFixed(2)} descontados`, "success");
  updateCartUI();
}

function clearLoyaltyDiscount() {
  window._loyaltyPtsUsed     = 0;
  window._loyaltyMxnDiscount = 0;
  const inp     = document.getElementById("loyalty-pts-input");
  const preview = document.getElementById("loyalty-pts-preview");
  const clearBtn= document.getElementById("loyalty-pts-clear");
  if (inp)     { inp.value = ""; inp.disabled = false; }
  if (preview)  preview.classList.add("hidden");
  if (clearBtn) clearBtn.classList.add("hidden");
  updateCartUI();
}

