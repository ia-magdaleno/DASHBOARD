/* 08-returns-receivables.js — F3 devoluciones, F4 CxC, F6 domicilio, F10 historial ventas, F12 pedidos online
   Extraido de app_v66.js (fase 3, modularizacion post-auditoria 2026-08-03)
   Lineas originales: 3355-3777 */

// ── F2: DEVOLUCIÓN RÁPIDA — busca por cliente+SKU en todas las sedes (E-04b / 2.19) ─────
// Usa activeClient + SKU del artículo; busca precio original en historial cross-sede.
// Submit vía POST /api/devoluciones/solicitud (notifica internamente a Admin/Gerente).

let f2CurrentSale = null;
let f2IsCrossSede = false;
let f2CurrentSku = null;

function openF2DevolucionModal() {
  f2CurrentSale = null;
  f2IsCrossSede = false;
  f2CurrentSku = null;
  const modal = document.getElementById("modal-f2-devolucion");
  if (!modal) return;

  const input = document.getElementById("f2-sale-input");
  if (input) input.value = "";
  const errEl = document.getElementById("f2-search-error");
  if (errEl) errEl.classList.add("hidden");
  document.getElementById("f2-step-items")?.classList.add("hidden");
  document.getElementById("f2-step-waiting")?.classList.add("hidden");
  document.getElementById("f2-step-search")?.classList.remove("hidden");
  const tbody = document.getElementById("f2-items-body");
  if (tbody) tbody.innerHTML = "";
  const totalEl = document.getElementById("f2-total-reintegro");
  if (totalEl) totalEl.textContent = "$0.00";
  const notes = document.getElementById("f2-notes");
  if (notes) notes.value = "";

  // Mostrar cliente activo
  const clientInfoEl = document.getElementById("f2-client-info");
  if (clientInfoEl) {
    const client = (typeof activeClient !== "undefined" && activeClient) ? activeClient : null;
    clientInfoEl.innerHTML = client
      ? `<i class="inline-block mr-1">👤</i><span class="font-black text-slate-800">${client.name}</span>`
          + (client.phone ? ` &nbsp;·&nbsp; ${client.phone}` : "")
      : `<span class="text-slate-400">Sin cliente seleccionado — selecciona un cliente con F1 primero</span>`;
  }

  const role = (localStorage.getItem("calebsys_role") || "").toLowerCase().trim();
  const isManager = ["admin", "gerente", "superadmin"].includes(role);
  document.getElementById("btn-f2-aprobar-directo")?.classList.toggle("hidden", !isManager);
  document.getElementById("btn-f2-solicitar")?.classList.toggle("hidden", isManager);

  modal.classList.remove("hidden");

  if (input && !input._f2EnterBound) {
    input._f2EnterBound = true;
    input.addEventListener("keydown", e => { if (e.key === "Enter") f2BuscarVenta(); });
  }
  setTimeout(() => document.getElementById("f2-sale-input")?.focus(), 50);
}

function closeF2Modal() {
  document.getElementById("modal-f2-devolucion")?.classList.add("hidden");
  f2CurrentSale = null;
  f2IsCrossSede = false;
  f2CurrentSku = null;
}

async function f2BuscarVenta() {
  const sku = (document.getElementById("f2-sale-input")?.value || "").trim().toUpperCase();
  const errEl = document.getElementById("f2-search-error");

  const client = (typeof activeClient !== "undefined" && activeClient) ? activeClient : null;
  if (!client || !client.id) {
    if (errEl) { errEl.textContent = "Selecciona un cliente con F1 antes de buscar."; errEl.classList.remove("hidden"); }
    return;
  }
  if (!sku) {
    if (errEl) { errEl.textContent = "Ingresa el SKU del artículo."; errEl.classList.remove("hidden"); }
    return;
  }
  errEl?.classList.add("hidden");
  f2CurrentSku = sku;

  try {
    const res = await apiFetch(`${API_BASE}/clients/${encodeURIComponent(client.id)}/purchase-history?sku=${encodeURIComponent(sku)}`);
    if (!res.ok) throw new Error("Error al consultar historial");
    const history = await res.json();

    if (!history || history.length === 0) {
      if (errEl) { errEl.textContent = `No se encontró compra de "${sku}" para este cliente en ninguna sede.`; errEl.classList.remove("hidden"); }
      return;
    }

    const currentSede = (localStorage.getItem("calebsys_sucursal") || "MATRIZ").toUpperCase();
    f2IsCrossSede = history.some(h => (h.sucursal_id || "MATRIZ").toUpperCase() !== currentSede);

    const crossBadge = f2IsCrossSede
      ? ` <span class="bg-amber-100 text-amber-800 border border-amber-300 font-bold text-[9px] px-2 py-0.5 rounded-lg ml-1">Cross-sede</span>`
      : "";
    document.getElementById("f2-sale-info").innerHTML =
      `SKU: <span class="font-black text-slate-700">${sku}</span> — ${history.length} compra(s) encontrada(s)${crossBadge}`;

    _f2RenderItems(history);
    document.getElementById("f2-step-items")?.classList.remove("hidden");
  } catch (e) {
    if (errEl) { errEl.textContent = e.message || "Error al buscar historial."; errEl.classList.remove("hidden"); }
  }
}

function _f2RenderItems(history) {
  const tbody = document.getElementById("f2-items-body");
  tbody.innerHTML = "";

  history.forEach((entry, idx) => {
    const price = parseFloat(entry.price);
    const qty = parseFloat(entry.quantity);
    const date = entry.fecha ? new Date(entry.fecha).toLocaleDateString("es-MX") : "—";
    const sede = entry.sucursal_id || "MATRIZ";
    const tr = document.createElement("tr");
    tr.className = "border-b border-slate-100 text-slate-700";
    tr.innerHTML = `
      <td class="py-2 pr-1 text-center w-6">
        <input type="checkbox" class="f2-item-check w-3.5 h-3.5 cursor-pointer rounded accent-red-600"
               data-idx="${idx}" checked />
      </td>
      <td class="py-2">
        <div class="font-semibold text-xs">${date}</div>
        <div class="text-[9px] text-slate-400">Sede: ${sede} · $${price.toFixed(2)} c/u · Ticket: ${entry.sale_id}</div>
      </td>
      <td class="py-2 text-center text-xs">${qty}</td>
      <td class="py-2 text-center">
        <input type="number" class="f2-item-qty w-14 border border-slate-300 rounded-lg px-1.5 py-1 text-xs text-center
               focus:outline-none focus:ring-1 focus:ring-red-400"
               data-idx="${idx}" data-price="${price}" data-sku="${entry.product_sku || f2CurrentSku}"
               data-sale-id="${entry.sale_id}" data-sede="${sede}"
               min="1" max="${qty}" value="1" />
      </td>
      <td class="py-2 text-right text-xs font-bold text-red-700 f2-item-sub">
        $${price.toFixed(2)}
      </td>
    `;
    tbody.appendChild(tr);
  });

  tbody.querySelectorAll(".f2-item-qty, .f2-item-check").forEach(el => {
    el.addEventListener("input", _f2RecalcTotal);
    el.addEventListener("change", _f2RecalcTotal);
  });

  _f2RecalcTotal();
}

function _f2RecalcTotal() {
  let total = 0;
  document.querySelectorAll("#f2-items-body tr").forEach(tr => {
    const check = tr.querySelector(".f2-item-check");
    const qtyInput = tr.querySelector(".f2-item-qty");
    const subEl = tr.querySelector(".f2-item-sub");
    if (!check || !qtyInput || !subEl) return;
    const price = parseFloat(qtyInput.dataset.price || "0");
    const qty = check.checked ? Math.max(0, Math.min(parseInt(qtyInput.value) || 0, parseInt(qtyInput.max) || 0)) : 0;
    subEl.textContent = `$${(price * qty).toFixed(2)}`;
    total += price * qty;
  });
  const totalEl = document.getElementById("f2-total-reintegro");
  if (totalEl) totalEl.textContent = `$${total.toFixed(2)}`;
}

function _f2GetSelectedItems() {
  const items = [];
  document.querySelectorAll("#f2-items-body tr").forEach(tr => {
    const check = tr.querySelector(".f2-item-check");
    const qtyInput = tr.querySelector(".f2-item-qty");
    if (!check?.checked || !qtyInput) return;
    const qty = Math.max(0, Math.min(parseInt(qtyInput.value) || 0, parseInt(qtyInput.max) || 0));
    if (qty > 0) items.push({
      sku: qtyInput.dataset.sku,
      qty,
      price: parseFloat(qtyInput.dataset.price || "0"),
      sale_id: qtyInput.dataset.saleId,
      sede: qtyInput.dataset.sede || "MATRIZ"
    });
  });
  return items;
}

async function f2AprobarDirecto() {
  // Admin/Gerente: procesa directo por cada compra histórica seleccionada
  const client = (typeof activeClient !== "undefined" && activeClient) ? activeClient : null;
  if (!client?.id) { showToast("Selecciona un cliente primero.", "warning"); return; }
  const items = _f2GetSelectedItems();
  if (items.length === 0) { showToast("Selecciona al menos un artículo a devolver.", "warning"); return; }
  const notes = document.getElementById("f2-notes")?.value.trim() || "Devolución F2";
  const currentSede = (localStorage.getItem("calebsys_sucursal") || "MATRIZ").toUpperCase();
  let hasError = false;
  for (const item of items) {
    const isCross = (item.sede).toUpperCase() !== currentSede;
    const endpoint = isCross ? "cross-return" : "return";
    try {
      const res = await apiFetch(`${API_BASE}/sales/${encodeURIComponent(item.sale_id)}/${endpoint}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ product_sku: item.sku, quantity_returned: item.qty, notes })
      });
      if (!res.ok) hasError = true;
    } catch { hasError = true; }
  }
  if (hasError) {
    showToast("Algunas devoluciones no se procesaron.", "error");
  } else {
    showToast("Devolución procesada correctamente.", "success");
    closeF2Modal();
  }
}

async function f2SolicitarAprobacion() {
  // Cajero/Vendedor: levanta solicitud → backend notifica a Admin/Gerente/Almacén con historial
  const client = (typeof activeClient !== "undefined" && activeClient) ? activeClient : null;
  if (!client?.id) { showToast("Selecciona un cliente primero.", "warning"); return; }
  const items = _f2GetSelectedItems();
  if (items.length === 0) { showToast("Selecciona al menos un artículo a devolver.", "warning"); return; }
  const notes = document.getElementById("f2-notes")?.value.trim() || "";
  const ticketRef = items[0]?.sale_id || "";
  try {
    const res = await apiFetch(`${API_BASE}/devoluciones/solicitud`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        client_id: client.id,
        sku: f2CurrentSku,
        items: items.map(i => ({ sku: i.sku, qty: i.qty })),
        ticket_ref: ticketRef,
        detalle: notes || null,
        sale_id: ticketRef || null
      })
    });
    if (!res.ok) { showToast("Error al registrar la solicitud.", "error"); return; }
  } catch { showToast("Error de red al enviar solicitud.", "error"); return; }

  document.getElementById("f2-step-search")?.classList.add("hidden");
  document.getElementById("f2-step-items")?.classList.add("hidden");
  document.getElementById("f2-step-waiting")?.classList.remove("hidden");
}

// --- F3: DEVOLUCIONES LOGIC ---
function searchSaleForReturn() {
  const saleId = document.getElementById("return-sale-id-input").value.trim();
  if (!saleId) {
    showToast("Por favor, ingresa un ID de ticket válido.", "warning");
    return;
  }
  
  apiFetch(`${API_BASE}/sales/${saleId}`)
    .then(res => {
      if (!res.ok) throw new Error("Ticket no encontrado");
      return res.json();
    })
    .then(async sale => {
      returnSale = sale;
      const fetchDescriptions = sale.items.map(item => 
        apiFetch(`${API_BASE}/products/${item.product_sku}`)
          .then(r => r.json())
          .then(p => { item.description = p.description; })
          .catch(() => { item.description = `Producto ${item.product_sku}`; })
      );
      await Promise.all(fetchDescriptions);
      
      returnItems = sale.items;
      selectedReturnIndex = returnItems.length > 0 ? 0 : -1;
      
      document.getElementById("return-client-name").innerText = sale.client ? sale.client.name : `Cliente #${sale.client_id}`;
      document.getElementById("return-sale-total").innerText = `$${sale.total.toFixed(2)}`;
      
      document.getElementById("return-sale-details").classList.remove("hidden");
      document.getElementById("return-qty-section").classList.add("hidden");
      
      renderReturns();
    })
    .catch(err => {
      showToast("Venta no encontrada en el sistema.", "error");
      document.getElementById("return-sale-details").classList.add("hidden");
    });
}

function renderReturns() {
  const tbody = document.getElementById("return-items-body");
  tbody.innerHTML = "";
  
  if (returnItems.length === 0) {
    tbody.innerHTML = `<tr><td colspan="4" class="text-center py-4 text-slate-400">Sin artículos</td></tr>`;
    return;
  }
  
  returnItems.forEach((item, idx) => {
    const tr = document.createElement("tr");
    const isSelected = idx === selectedReturnIndex;
    tr.className = `hover:bg-slate-50 cursor-pointer ${isSelected ? "bg-blue-50 font-semibold text-blue-900 border-l-4 border-l-blue-600" : "text-slate-700"}`;
    
    tr.innerHTML = `
      <td class="py-2.5 px-3">
        <div class="font-bold">${item.description}</div>
        <div class="text-[9px] text-slate-400">SKU: ${item.product_sku}</div>
      </td>
      <td class="py-2.5 px-3 text-center">${item.quantity}</td>
      <td class="py-2.5 px-3 text-center ${item.returned_quantity > 0 ? 'text-red-500 font-bold':''}">${item.returned_quantity}</td>
      <td class="py-2.5 px-3 text-right">$${item.price.toFixed(2)}</td>
    `;
    
    tr.addEventListener("click", () => {
      selectedReturnIndex = idx;
      renderReturns();
      selectReturnItem();
    });
    
    tbody.appendChild(tr);
  });
}

function navigateReturns(direction) {
  if (returnItems.length === 0) return;
  selectedReturnIndex = (selectedReturnIndex + direction + returnItems.length) % returnItems.length;
  renderReturns();
  const returnQtySec = document.getElementById("return-qty-section");
  if (!returnQtySec.classList.contains("hidden")) {
    selectReturnItem();
  }
}

function selectReturnItem() {
  if (selectedReturnIndex === -1 || returnItems.length === 0) return;
  const item = returnItems[selectedReturnIndex];
  
  const returnQtySec = document.getElementById("return-qty-section");
  returnQtySec.classList.remove("hidden");
  
  document.getElementById("return-selected-desc").innerText = `${item.description} (Límite: ${item.quantity - item.returned_quantity})`;
  const input = document.getElementById("return-quantity-input");
  input.value = (item.quantity - item.returned_quantity);
  setTimeout(() => {
    input.focus();
    input.select();
  }, 30);
}

function confirmReturn() {
  if (selectedReturnIndex === -1 || !returnSale) return;
  const item = returnItems[selectedReturnIndex];
  const qtyInput = document.getElementById("return-quantity-input");
  const qty = parseFloat(qtyInput.value);
  const available = item.quantity - item.returned_quantity;
  
  if (isNaN(qty) || qty <= 0) {
    showToast("Por favor, ingresa una cantidad válida de devolución.", "warning");
    return;
  }
  
  if (qty > available) {
    showToast(`Cantidad excede el límite disponible para devolución (${available}).`, "error");
    return;
  }
  
  apiFetch(`${API_BASE}/sales/${returnSale.id}/return`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      product_sku: item.product_sku,
      quantity_returned: qty,
      notes: "Devolución en caja"
    })
  })
    .then(res => {
      if (!res.ok) throw new Error("Error en devolución");
      return res.json();
    })
    .then(data => {
      showToast("Devolución registrada exitosamente.", "success");
      searchSaleForReturn();
    })
    .catch(err => {
      showToast("No se pudo completar la devolución.", "error");
    });
}

// --- F4: CUENTAS POR COBRAR LOGIC ---
function loadReceivableDebts() {
  apiFetch(`${API_BASE}/accounts-receivable`)
    .then(res => res.json())
    .then(data => {
      receivableDebts = data.filter(d => d.status === "Pendiente");
      selectedReceivableIndex = receivableDebts.length > 0 ? 0 : -1;
      renderReceivables();
    })
    .catch(() => {
      showToast("Error al cargar cuentas por cobrar.", "error");
    });
}

function renderReceivables() {
  const tbody = document.getElementById("receivable-debts-body");
  tbody.innerHTML = "";
  
  if (receivableDebts.length === 0) {
    tbody.innerHTML = `<tr><td colspan="4" class="text-center py-6 text-slate-400">No hay cuentas por cobrar pendientes.</td></tr>`;
    return;
  }
  
  receivableDebts.forEach((debt, idx) => {
    const tr = document.createElement("tr");
    const isSelected = idx === selectedReceivableIndex;
    tr.className = `hover:bg-slate-50 cursor-pointer ${isSelected ? "bg-blue-50 font-semibold text-blue-900 border-l-4 border-l-blue-600" : "text-slate-700"}`;
    
    tr.innerHTML = `
      <td class="py-2.5 px-3">
        <div class="font-bold">${debt.client.name}</div>
        <div class="text-[9px] text-slate-400">Cliente ID: ${debt.client_id}</div>
      </td>
      <td class="py-2.5 px-3 text-center">${debt.sale_id}</td>
      <td class="py-2.5 px-3 text-right">$${debt.original_amount.toFixed(2)}</td>
      <td class="py-2.5 px-3 text-right text-red-500 font-extrabold">$${debt.current_balance.toFixed(2)}</td>
    `;
    
    tr.addEventListener("click", () => {
      selectedReceivableIndex = idx;
      renderReceivables();
      selectReceivableItem();
    });
    
    tbody.appendChild(tr);
  });
}

function navigateReceivables(direction) {
  if (receivableDebts.length === 0) return;
  selectedReceivableIndex = (selectedReceivableIndex + direction + receivableDebts.length) % receivableDebts.length;
  renderReceivables();
  const paymentSec = document.getElementById("payment-debt-section");
  if (!paymentSec.classList.contains("hidden")) {
    selectReceivableItem();
  }
}

function selectReceivableItem() {
  if (selectedReceivableIndex === -1 || receivableDebts.length === 0) return;
  const debt = receivableDebts[selectedReceivableIndex];
  
  const paymentSec = document.getElementById("payment-debt-section");
  paymentSec.classList.remove("hidden");
  
  document.getElementById("payment-selected-client").innerText = `${debt.client.name} (Venta #${debt.sale_id} - Saldo: $${debt.current_balance.toFixed(2)})`;
  const input = document.getElementById("payment-amount-input");
  input.value = debt.current_balance.toFixed(2);
  setTimeout(() => {
    input.focus();
    input.select();
  }, 30);
}

function submitReceivablePayment() {
  if (selectedReceivableIndex === -1 || receivableDebts.length === 0) return;
  const debt = receivableDebts[selectedReceivableIndex];
  const amountInput = document.getElementById("payment-amount-input");
  const amount = parseFloat(amountInput.value);
  
  if (isNaN(amount) || amount <= 0) {
    showToast("Por favor, ingresa un monto válido de abono.", "warning");
    return;
  }
  
  apiFetch(`${API_BASE}/accounts-receivable/${debt.id}/pay`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ amount: amount })
  })
    .then(res => {
      if (!res.ok) throw new Error("Error de abono");
      return res.json();
    })
    .then(data => {
      showToast(`Abono de $${amount.toFixed(2)} registrado con éxito.`, "success");
      document.getElementById("payment-debt-section").classList.add("hidden");
      loadReceivableDebts();
    })
    .catch(err => {
      showToast("No se pudo procesar el pago del abono.", "error");
    });
}

// --- F6: DOMICILIO LOGIC ---
function saveDeliveryDetails(e) {
  if (e) e.preventDefault();
  
  const street = document.getElementById("delivery-street").value.trim();
  const colony = document.getElementById("delivery-colony").value.trim();
  const phone = document.getElementById("delivery-phone").value.trim();
  const date = document.getElementById("delivery-date").value;
  const notes = document.getElementById("delivery-notes").value.trim();
  
  if (!street || !colony) {
    showToast("Por favor, ingresa calle y colonia para la entrega.", "warning");
    return;
  }
  
  deliveryDetails = { street, colony, phone, date, notes };
  closeModal("modal-delivery");
  showToast("Datos de entrega a domicilio guardados.", "success");
}

// --- F10: HISTORIAL DE VENTAS LOGIC ---
function loadSalesHistory() {
  apiFetch(`${API_BASE}/sales?limit=50`)
    .then(res => res.json())
    .then(data => {
      salesHistory = data;
      selectedHistoryIndex = salesHistory.length > 0 ? 0 : -1;
      renderHistory();
    })
    .catch(() => {
      showToast("Error al cargar historial de ventas.", "error");
    });
}

function renderHistory() {
  const tbody = document.getElementById("history-sales-body");
  tbody.innerHTML = "";
  
  if (salesHistory.length === 0) {
    tbody.innerHTML = `<tr><td colspan="5" class="text-center py-6 text-slate-400">No hay ventas registradas.</td></tr>`;
    return;
  }
  
  salesHistory.forEach((sale, idx) => {
    const tr = document.createElement("tr");
    const isSelected = idx === selectedHistoryIndex;
    tr.className = `hover:bg-slate-50 cursor-pointer ${isSelected ? "bg-blue-50 font-semibold text-blue-900 border-l-4 border-l-blue-600" : "text-slate-700"}`;
    
    const dateObj = new Date(sale.created_at);
    const formattedDate = dateObj.toLocaleString("es-MX", { hour12: false });
    
    const methodMap = {
      "001": "Efectivo",
      "002": "Cheque",
      "003": "Tarjeta Crd",
      "004": "Transferencia",
      "006": "Crédito",
      "008": "Tarjeta Deb"
    };
    const methodName = methodMap[sale.payment_method] || sale.payment_method;
    
    tr.innerHTML = `
      <td class="py-2.5 px-3 font-bold">#${sale.id.toString().padStart(6, '0')}</td>
      <td class="py-2.5 px-3">${sale.client ? sale.client.name : `Cliente #${sale.client_id}`}</td>
      <td class="py-2.5 px-3 text-center">${formattedDate}</td>
      <td class="py-2.5 px-3 text-center"><span class="bg-slate-100 px-2 py-0.5 rounded font-semibold text-[10px]">${methodName}</span></td>
      <td class="py-2.5 px-3 text-right font-black text-slate-800">$${sale.total.toFixed(2)}</td>
    `;
    
    tr.addEventListener("click", () => {
      selectedHistoryIndex = idx;
      renderHistory();
      selectHistoryItem();
    });
    
    tbody.appendChild(tr);
  });
}

function navigateHistory(direction) {
  if (salesHistory.length === 0) return;
  selectedHistoryIndex = (selectedHistoryIndex + direction + salesHistory.length) % salesHistory.length;
  renderHistory();
}

function selectHistoryItem() {
  if (selectedHistoryIndex === -1 || salesHistory.length === 0) return;
  const sale = salesHistory[selectedHistoryIndex];
  openTicketModal(sale);
}

// --- F12: PEDIDOS ONLINE LOGIC ---
function loadOnlineOrders() {
  apiFetch(`${API_BASE}/online-orders`)
    .then(res => res.json())
    .then(data => {
      onlineOrders = data;
      selectedOnlineOrderIndex = onlineOrders.length > 0 ? 0 : -1;
      renderOnlineOrders();
    })
    .catch(() => {
      showToast("Error al cargar pedidos online.", "error");
    });
}

function renderOnlineOrders() {
  const tbody = document.getElementById("online-orders-body");
  tbody.innerHTML = "";
  
  if (onlineOrders.length === 0) {
    tbody.innerHTML = `<tr><td colspan="3" class="text-center py-6 text-slate-400">No hay pedidos online pendientes.</td></tr>`;
    return;
  }
  
  onlineOrders.forEach((order, idx) => {
    const tr = document.createElement("tr");
    const isSelected = idx === selectedOnlineOrderIndex;
    tr.className = `hover:bg-slate-50 cursor-pointer ${isSelected ? "bg-blue-50 font-semibold text-blue-900 border-l-4 border-l-blue-600" : "text-slate-700"}`;
    
    const itemsSummary = order.items.map(item => `${item.description} (x${item.quantity})`).join(", ");
    
    tr.innerHTML = `
      <td class="py-2.5 px-3 font-bold">#${order.id}</td>
      <td class="py-2.5 px-3">${order.client_name}</td>
      <td class="py-2.5 px-3 text-slate-500 font-medium truncate max-w-[280px]" title="${itemsSummary}">${itemsSummary}</td>
    `;
    
    tr.addEventListener("click", () => {
      selectedOnlineOrderIndex = idx;
      renderOnlineOrders();
      selectOnlineOrderItem();
    });
    
    tbody.appendChild(tr);
  });
}

function navigateOnlineOrders(direction) {
  if (onlineOrders.length === 0) return;
  selectedOnlineOrderIndex = (selectedOnlineOrderIndex + direction + onlineOrders.length) % onlineOrders.length;
  renderOnlineOrders();
}

function selectOnlineOrderItem() {
  if (selectedOnlineOrderIndex === -1 || onlineOrders.length === 0) return;
  const order = onlineOrders[selectedOnlineOrderIndex];
  
  cart = [];
  
  const loadItemsPromises = order.items.map(item => {
    return apiFetch(`${API_BASE}/products/${item.product_sku}`)
      .then(res => res.json())
      .then(p => {
        cart.push({
          sku: p.sku,
          description: p.description,
          price: p.price,
          quantity: item.quantity,
          subtotal: item.quantity * p.price
        });
      })
      .catch(() => {
        cart.push({
          sku: item.product_sku,
          description: item.description,
          price: item.price,
          quantity: item.quantity,
          subtotal: item.quantity * item.price
        });
      });
  });
  
  Promise.all(loadItemsPromises).then(() => {
    updateCartUI();
    closeModal("modal-online-orders");
    showToast(`Pedido online #${order.id} cargado en el carrito.`, "success");
    focusProductInput();
  });
}

