/* 12-client-modals.js — Status bar clock + client modal openers (CxC, Apartados, Resguardos, Anticipos, Cotizaciones, Historial, Online, Contactar)
   Extraido de app_v66.js (fase 3, modularizacion post-auditoria 2026-08-03)
   Lineas originales: 5675-6357 */
// ==================== STATUS BAR CLOCK ====================
let _statusClockTimer = null;

function startStatusBarClock() {
  updateStatusBarClock();
  if (!_statusClockTimer) {
    _statusClockTimer = setInterval(updateStatusBarClock, 1000);
  }
}

function stopStatusBarClock() {
  if (_statusClockTimer) {
    clearInterval(_statusClockTimer);
    _statusClockTimer = null;
  }
}

function updateStatusBarClock() {
  const now = new Date();
  const timeEl = document.getElementById("status-time");
  const dateEl = document.getElementById("status-date");
  const folioEl = document.getElementById("status-folio");

  if (timeEl) {
    let h = now.getHours();
    const m = String(now.getMinutes()).padStart(2, "0");
    const ampm = h >= 12 ? "PM" : "AM";
    h = h % 12 || 12;
    timeEl.textContent = `${h}:${m} ${ampm}`;
  }
  if (dateEl) {
    const d = String(now.getDate()).padStart(2, "0");
    const mo = String(now.getMonth() + 1).padStart(2, "0");
    const y = now.getFullYear();
    dateEl.textContent = `${d}/${mo}/${y}`;
  }
  // Update folio from current cart or last sale
  if (folioEl) {
    const folioDisplay = document.getElementById("current-folio-display");
    folioEl.textContent = folioDisplay ? (folioDisplay.textContent || "-") : "-";
  }
}

// ==================== CLIENT MODAL OPENERS ====================

// Helper: get currently highlighted client data
function getHighlightedClientData() {
  const highlighted = document.querySelector("#clients-table-body tr.bg-blue-50, #clients-table-body tr.ring-2");
  if (!highlighted) return null;
  return {
    id:            highlighted.dataset.clientId,
    name:          highlighted.dataset.clientName,
    phone:         highlighted.dataset.clientPhone,
    rfc:           highlighted.dataset.clientRfc          || "",
    email:         highlighted.dataset.clientEmail        || "",
    address:       highlighted.dataset.clientAddress      || "",
    city:          highlighted.dataset.clientCity         || "",
    cp:            highlighted.dataset.clientCp           || "",
    regimen:       highlighted.dataset.clientRegimen      || "",
    clientType:    highlighted.dataset.clientType         || "",
    balance:       highlighted.dataset.clientBalance      || 0,
    creditLimit:   highlighted.dataset.clientCreditLimit  || 0,
    creditDays:    highlighted.dataset.clientCreditDays   || 30,
    points:        highlighted.dataset.clientPoints       || 0,
    paymentMethod: highlighted.dataset.clientPaymentMethod || "Efectivo",
  };
}

function openNewClientModal() {
  // Clear the new client form
  ["nc-razon-social", "nc-nombre-comercial", "nc-rfc", "nc-id-cliente", "nc-direccion", "nc-numero-ext", "nc-numero-int", "nc-colonia", "nc-ciudad", "nc-municipio", "nc-estado", "nc-cp", "nc-phone", "nc-whatsapp", "nc-limite-credito", "nc-dias-credito", "nc-dias-apartado"].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = "";
  });
  
  if (typeof currentEmails !== 'undefined') {
      currentEmails = [];
      if (typeof renderEmails === 'function') renderEmails();
  }

  window.currentEditClientId = null;

  // Reset status badge de constancia
  const statusEl = document.querySelector('.nc-constancia-status');
  if (statusEl) { statusEl.textContent = ''; statusEl.className = 'nc-constancia-status text-[11px] text-slate-400 ml-2'; }
  const zone = document.getElementById('nc-upload-zone');
  if (zone) { zone.classList.remove('border-blue-400','border-green-400','border-red-400','bg-blue-50'); }

  // RBAC: Vendedor y Cajero no asignan cupos de crédito ni escala de precios
  _applyClientFormRbac();

  setView("new-client");
  if (typeof setupConstanciaDragDrop === "function") setupConstanciaDragDrop();
}

/**
 * Bloquea/desbloquea los campos de crédito y escala según el rol.
 * Vendedor / Cajero → campos solo-lectura con badge de "Solo Admin".
 * Admin / Gerente / Cajero-Admin → sin restricción.
 */
function _applyClientFormRbac() {
  const role = (localStorage.getItem('calebsys_role') || '').toLowerCase().trim();
  const ROLES_RESTRINGIDOS = ['vendedor', 'operador ventas', 'supervisor', 'cajero', 'operador caja'];
  // Cartera SÍ puede asignar cupos y escalas — no está en la lista restringida
  const restringido = ROLES_RESTRINGIDOS.includes(role);

  // IDs de campos bloqueados para Vendedor/Cajero
  const CAMPOS_ADMIN = ['nc-limite-credito', 'nc-dias-credito', 'nc-dias-apartado'];

  CAMPOS_ADMIN.forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    if (restringido) {
      el.disabled = true;
      el.style.opacity = '0.45';
      el.title = 'Solo Admin / Gerente puede asignar cupos de crédito';
    } else {
      el.disabled = false;
      el.style.opacity = '';
      el.title = '';
    }
  });

  // Badge visual junto a la sección de crédito
  const badge = document.getElementById('nc-credit-rbac-badge');
  if (restringido && !badge) {
    const limEl = document.getElementById('nc-limite-credito');
    if (limEl && limEl.closest) {
      const section = limEl.closest('.space-y-1\\.5') || limEl.parentElement?.parentElement;
      if (section) {
        const b = document.createElement('div');
        b.id = 'nc-credit-rbac-badge';
        b.className = 'text-[9px] font-black text-amber-500 uppercase tracking-wider mt-1 flex items-center gap-1';
        b.innerHTML = '⚠ Solo Admin o Gerente puede editar cupos y escalas de crédito';
        section.appendChild(b);
      }
    }
  } else if (!restringido && badge) {
    badge.remove();
  }
}

function openEditClientModal() {
  if (selectedCatalogClientIndex < 0 || selectedCatalogClientIndex >= catalogClients.length) return;
  const client = catalogClients[selectedCatalogClientIndex];
  
  const razon = document.getElementById("nc-razon-social");
  if (razon) razon.value = client.name || "";
  
  const rfc = document.getElementById("nc-rfc");
  if (rfc) rfc.value = client.rfc || "";
  
  const idc = document.getElementById("nc-id-cliente");
  if (idc) idc.value = client.client_code || client.id || "";
  
  const phone = document.getElementById("nc-phone");
  if (phone) phone.value = client.phone || "";
  
  if (client.email) {
      currentEmails = client.email.split(',').map(e => e.trim()).filter(e => e);
      if (typeof renderEmails === 'function') renderEmails();
  } else {
      currentEmails = [];
      if (typeof renderEmails === 'function') renderEmails();
  }

  ["direccion", "numero_ext", "numero_int", "colonia", "ciudad", "municipio", "estado", "cp", "regimen_fiscal", "whatsapp"].forEach(key => {
      const el = document.getElementById("nc-" + key.replace('_', '-'));
      if (el) el.value = client[key] || "";
  });

  window.currentEditClientId = client.id;
  setView("new-client");
}

function submitNewClientView(e, startSale = false) {
  e.preventDefault();
  const name = document.getElementById("nc-razon-social") ? document.getElementById("nc-razon-social").value : "";
  const rfc = document.getElementById("nc-rfc") ? document.getElementById("nc-rfc").value : "XAXX010101000";
  const phone = document.getElementById("nc-phone") ? document.getElementById("nc-phone").value : "";
  const whatsapp = document.getElementById("nc-whatsapp") ? document.getElementById("nc-whatsapp").value : "";
  
  let email = typeof currentEmails !== 'undefined' && currentEmails.length > 0 ? currentEmails.join(', ') : "";
  const emailInput = document.getElementById("nc-email-input");
  if (emailInput && emailInput.value) {
      email = email ? email + ", " + emailInput.value : emailInput.value;
  }

  const address = document.getElementById("nc-direccion") ? document.getElementById("nc-direccion").value : "";
  const client_type = "Publico General";
  const price_list = document.getElementById("nc-precio") ? document.getElementById("nc-precio").value : "PUBLICO";

  if (!name.trim()) { showToast("Razón Social obligatoria", "error"); return; }

  const payload = {
    name, rfc, phone, whatsapp, email, client_type, price_list,

    direccion: address,
    numero_ext: document.getElementById("nc-numero-ext") ? document.getElementById("nc-numero-ext").value : "",
    numero_int: document.getElementById("nc-numero-int") ? document.getElementById("nc-numero-int").value : "",
    colonia: document.getElementById("nc-colonia") ? document.getElementById("nc-colonia").value : "",
    ciudad: document.getElementById("nc-ciudad") ? document.getElementById("nc-ciudad").value : "",
    municipio: document.getElementById("nc-municipio") ? document.getElementById("nc-municipio").value : "",
    estado: document.getElementById("nc-estado") ? document.getElementById("nc-estado").value : "",
    cp: document.getElementById("nc-cp") ? document.getElementById("nc-cp").value : "",
    pais: "México",
    regimen_fiscal: document.getElementById("nc-regimen") ? document.getElementById("nc-regimen").value : "",
    uso_cfdi: document.getElementById("nc-uso-cfdi") ? document.getElementById("nc-uso-cfdi").value : null
  };
  
  let url = window.currentEditClientId ? `${API_BASE}/clients/${window.currentEditClientId}` : `${API_BASE}/clients`;
  let method = window.currentEditClientId ? "PUT" : "POST";

  apiFetch(url, {
    method: method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  })
  .then(res => res.json())
  .then(client => {
    if (startSale) {
      updateClientDisplay(client);
      setView("sales");
    } else {
      setView("clients");
      performCatalogSearch("");
    }
    showToast(`Cliente guardado exitosamente`, "success");
  })
  .catch(err => showToast("Error al guardar cliente", "error"));
}

async function submitFullNewClient(event) {
  event.preventDefault();
  const editId = document.getElementById("edit-client-id").value;
  const isEdit = !!editId;

  const payload = {
    name: document.getElementById("fc-name").value.trim(),
    rfc: document.getElementById("fc-rfc").value.trim() || null,
    regimen_fiscal: document.getElementById("fc-regimen").value || null,
    phone: document.getElementById("fc-phone").value.trim(),
    email: document.getElementById("fc-email").value.trim() || null,
    direccion: document.getElementById("fc-address").value.trim() || null,
    ciudad: document.getElementById("fc-city").value.trim() || null,
    cp: document.getElementById("fc-cp").value.trim() || null,
    client_type: document.getElementById("fc-type").value,
    limite_credito: parseFloat(document.getElementById("fc-credit-limit").value) || 0,
    dias_credito: parseInt(document.getElementById("fc-credit-days").value) || 30,
    payment_method: document.getElementById("fc-payment-method").value || "Efectivo",
    puntos: parseInt(document.getElementById("fc-points").value) || 0,
  };

  // Validate phone = client ID (max 10 digits)
  if (!payload.phone || payload.phone.replace(/\D/g, "").length < 7) {
    showToast("El teléfono es requerido (mínimo 7 dígitos)", "error");
    return;
  }

  const url = isEdit ? `/api/clients/${encodeURIComponent(editId)}` : "/api/clients";
  const method = isEdit ? "PUT" : "POST";

  try {
    const resp = await apiFetch(url, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!resp.ok) {
      const err = await resp.json().catch(() => ({}));
      throw new Error(err.detail || "Error al guardar el cliente");
    }
    const saved = await resp.json();
    showToast(isEdit ? `Cliente actualizado: ${saved.name}` : `Cliente registrado: ${saved.name}`, "success");
    closeModal("modal-new-client");
    performCatalogClientSearch(document.getElementById("clients-search-input")?.value || "");
    if (window.lucide) lucide.createIcons();
  } catch (err) {
    showToast(err.message, "error");
  }
}

function deleteSelectedClientConfirm() {
  const client = getHighlightedClientData();
  if (!client || !client.id) {
    showToast("Selecciona un cliente primero", "warning");
    return;
  }
  const nameDisplay = document.getElementById("delete-client-name-display");
  if (nameDisplay) nameDisplay.textContent = `${client.name} (ID: ${client.id})`;
  openModal("modal-confirm-delete-client");
  if (window.lucide) lucide.createIcons();
}

async function confirmDeleteClient() {
  const client = getHighlightedClientData();
  if (!client || !client.id) return;
  try {
    const resp = await apiFetch(`/api/clients/${encodeURIComponent(client.id)}`, { method: "DELETE" });
    if (!resp.ok) throw new Error("No se pudo eliminar el cliente");
    showToast(`Cliente eliminado: ${client.name}`, "success");
    closeModal("modal-confirm-delete-client");
    performCatalogClientSearch(document.getElementById("clients-search-input")?.value || "");
  } catch (err) {
    showToast(err.message, "error");
  }
}

// ---- F3: PUNTOS ----
function openClientPointsModal() {
  const client = getHighlightedClientData();
  if (!client || !client.id) {
    showToast("Selecciona un cliente para ver sus puntos", "warning");
    return;
  }
  const initials = (client.name || "??").split(" ").slice(0, 2).map(w => w[0]).join("").toUpperCase();
  const avatar = document.getElementById("points-client-avatar");
  if (avatar) avatar.textContent = initials;
  const nameEl = document.getElementById("points-client-name");
  if (nameEl) nameEl.textContent = client.name || "-";
  const balanceEl = document.getElementById("points-balance-display");

  // Cargar puntos actuales desde el nuevo API de lealtad
  apiFetch(`/api/loyalty/clients/${encodeURIComponent(client.id)}/points`)
    .then(r => r.ok ? r.json() : null)
    .then(d => {
      if (balanceEl) balanceEl.textContent = d ? (d.puntos || 0) : "0";
    }).catch(() => { if (balanceEl) balanceEl.textContent = "0"; });

  // Cargar historial de canjes
  const body = document.getElementById("points-history-body");
  if (body) body.innerHTML = `<tr><td colspan="3" class="text-center py-4 text-slate-400">Cargando...</td></tr>`;
  apiFetch(`/api/loyalty/clients/${encodeURIComponent(client.id)}/history`)
    .then(r => r.ok ? r.json() : [])
    .then(rows => {
      if (!body) return;
      if (!rows || !rows.length) {
        body.innerHTML = `<tr><td colspan="3" class="text-center py-4 text-slate-400">Sin canjes registrados</td></tr>`;
        return;
      }
      body.innerHTML = rows.map(r => {
        const fecha = r.created_at ? r.created_at.slice(0, 10) : "-";
        const modo = r.redemption_mode || "-";
        return `<tr>
          <td class="py-1.5 px-3">${fecha}</td>
          <td class="py-1.5 px-3">${modo}</td>
          <td class="py-1.5 px-3 text-right text-red-600">-${r.puntos_canjeados}</td>
        </tr>`;
      }).join("");
    }).catch(() => {
      if (body) body.innerHTML = `<tr><td colspan="3" class="text-center py-4 text-slate-400">Error al cargar</td></tr>`;
    });

  openModal("modal-client-points");
  if (window.lucide) lucide.createIcons();
}

function addClientPoints() {
  // Ajuste manual de puntos: llama al endpoint de lealtad (accrue)
  const amt = parseInt(document.getElementById("points-add-amount")?.value) || 0;
  if (amt <= 0) { showToast("Ingresa una cantidad válida", "warning"); return; }
  const client = getHighlightedClientData();
  if (!client) return;
  apiFetch(`/api/loyalty/accrue`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ client_id: String(client.id), sale_total: 0, sale_id: null, _manual_pts: amt })
  }).then(r => r.ok ? r.json() : null).then(d => {
    // Fallback: si el endpoint no soporta _manual_pts, actualizar via PATCH al cliente
    if (!d) {
      return apiFetch(`/api/clients/${encodeURIComponent(client.id)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ puntos: (parseInt(client.points || 0)) + amt })
      }).then(r => r.ok ? r.json() : null);
    }
    return d;
  }).then(d => {
    showToast(`+${amt} puntos agregados`, "success");
    const balanceEl = document.getElementById("points-balance-display");
    apiFetch(`/api/loyalty/clients/${encodeURIComponent(client.id)}/points`)
      .then(r => r.ok ? r.json() : null)
      .then(pts => { if (balanceEl && pts) balanceEl.textContent = pts.puntos || "0"; });
    if (document.getElementById("points-add-amount")) document.getElementById("points-add-amount").value = "";
  }).catch(() => showToast("Error al agregar puntos", "error"));
}

function redeemClientPoints() {
  const amt = parseInt(document.getElementById("points-redeem-amount")?.value) || 0;
  if (amt <= 0) { showToast("Ingresa una cantidad válida", "warning"); return; }
  const client = getHighlightedClientData();
  if (!client) return;
  apiFetch(`/api/loyalty/clients/${encodeURIComponent(client.id)}/redeem`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: String(client.id),
      redemption_mode: "regalo",
      puntos_canjeados: amt,
      notas: "Canje manual desde panel de cliente"
    })
  }).then(r => {
    if (!r.ok) return r.json().then(e => { throw new Error(e.detail || "Error"); });
    return r.json();
  }).then(d => {
    showToast(`-${amt} puntos canjeados`, "success");
    const balanceEl = document.getElementById("points-balance-display");
    if (balanceEl) balanceEl.textContent = d.puntos_restantes ?? "0";
    if (document.getElementById("points-redeem-amount")) document.getElementById("points-redeem-amount").value = "";
  }).catch(err => showToast(`Error: ${err.message}`, "error"));
}

// ---- F4: CxC ----
async function openClientCxCModal(client = getHighlightedClientData()) {
  if (!client || !client.id) {
    showToast("Selecciona un cliente para ver su cuenta corriente", "warning");
    return;
  }
  const header = document.getElementById("cxc-client-name-header");
  if (header) header.textContent = client.name || "-";

  const creditLimit = parseFloat(client.creditLimit) || 0;
  const balance = parseFloat(client.balance) || 0;
  const available = Math.max(0, creditLimit - balance);

  document.getElementById("cxc-total-debt").textContent = `$${balance.toFixed(2)}`;
  document.getElementById("cxc-credit-avail").textContent = `$${available.toFixed(2)}`;
  document.getElementById("cxc-credit-limit").textContent = `$${creditLimit.toFixed(2)}`;

  try {
    const resp = await apiFetch(`/api/accounts-receivable?client_id=${encodeURIComponent(client.id)}`);
    const data = await resp.json();
    const tbody = document.getElementById("cxc-table-body");
    if (!tbody) return;
    if (!data || data.length === 0) {
      tbody.innerHTML = `<tr><td colspan="6" class="text-center py-6 text-slate-400">Sin cuentas por cobrar para este cliente</td></tr>`;
    } else {
      tbody.innerHTML = data.map(a => `
        <tr class="hover:bg-slate-50">
          <td class="py-2.5 px-4">${a.folio || "-"}</td>
          <td class="py-2.5 px-4">${a.date || "-"}</td>
          <td class="py-2.5 px-4">${a.concept || "Saldo"}</td>
          <td class="py-2.5 px-4 text-right text-red-600">$${parseFloat(a.amount || 0).toFixed(2)}</td>
          <td class="py-2.5 px-4 text-center"><span class="bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full text-[9px] font-black">${a.status || "PENDIENTE"}</span></td>
          <td class="py-2.5 px-4 text-center"><button onclick="makePaymentFromCxC()" class="bg-blue-100 text-blue-600 px-2 py-0.5 rounded-lg text-[9px] font-bold hover:bg-blue-200 transition">Abonar</button></td>
        </tr>`).join("");
    }
  } catch {
    const tbody = document.getElementById("cxc-table-body");
    if (tbody) tbody.innerHTML = `<tr><td colspan="6" class="text-center py-4 text-slate-400">Error al cargar las cuentas</td></tr>`;
  }
  openModal("modal-client-cxc");
  if (window.lucide) lucide.createIcons();
}

function makePaymentFromCxC() {
  showToast("Redirigiendo a módulo de pago...", "info");
  closeModal("modal-client-cxc");
}

// ---- F5: APARTADOS ----
let _apartadoCurrentClient = null;
let _abonoLayawayId = null;

async function openClientApartadosModal(client = getHighlightedClientData()) {
  if (!client || !client.id) {
    showToast("Selecciona un cliente primero", "warning");
    return;
  }
  _apartadoCurrentClient = client;
  const nameEl = document.getElementById("apartados-client-name");
  if (nameEl) nameEl.textContent = client.name || "-";

  try {
    const resp = await apiFetch(`/api/layaways?client_id=${encodeURIComponent(client.id)}`);
    const data = await resp.json();
    const tbody = document.getElementById("apartados-table-body");
    if (!tbody) return;
    if (!data || data.length === 0) {
      tbody.innerHTML = `<tr><td colspan="7" class="text-center py-6 text-slate-400">Sin apartados registrados para este cliente</td></tr>`;
    } else {
      tbody.innerHTML = data.map(a => {
        const total = parseFloat(a.total_amount || 0);
        const paid = parseFloat(a.amount_paid || 0);
        const pending = parseFloat(a.amount_pending || 0);
        const fecha = a.created_at ? a.created_at.substring(0, 10) : "-";
        const statusCls = a.status === "ACTIVO"
          ? "bg-green-100 text-green-700"
          : a.status === "COMPLETADO"
          ? "bg-blue-100 text-blue-700"
          : "bg-red-100 text-red-600";
        const statusBadge = `<span class="${statusCls} px-1.5 py-0.5 rounded text-[8px] font-bold ml-1">${a.status}</span>`;
        const abonarBtn = a.status === "ACTIVO"
          ? `<button onclick="openAbonarApartadoModal('${a.id}','${a.folio}',${pending})" class="bg-green-100 text-green-700 px-2 py-0.5 rounded-lg text-[9px] font-bold hover:bg-green-200 transition">Abonar</button>`
          : `<span class="text-slate-300 text-[9px]">—</span>`;
        return `<tr class="hover:bg-slate-50">
          <td class="py-2.5 px-4 font-mono text-xs">${a.folio || "-"}${statusBadge}</td>
          <td class="py-2.5 px-4 text-slate-500">${(a.items || []).length} art.</td>
          <td class="py-2.5 px-4">${fecha}</td>
          <td class="py-2.5 px-4 text-right">$${total.toFixed(2)}</td>
          <td class="py-2.5 px-4 text-right text-green-600">$${paid.toFixed(2)}</td>
          <td class="py-2.5 px-4 text-right ${pending > 0 ? "text-red-500 font-black" : "text-slate-400"}">$${pending.toFixed(2)}</td>
          <td class="py-2.5 px-4 text-center">${abonarBtn}</td>
        </tr>`;
      }).join("");
    }
  } catch {
    const tbody = document.getElementById("apartados-table-body");
    if (tbody) tbody.innerHTML = `<tr><td colspan="7" class="text-center py-4 text-slate-400">Error al cargar apartados</td></tr>`;
  }

  const btnNuevo = document.getElementById("btn-nuevo-apartado");
  if (btnNuevo) btnNuevo.classList.toggle("hidden", !Array.isArray(cart) || cart.length === 0);

  openModal("modal-client-apartados");
  if (window.lucide) lucide.createIcons();
}

function openAbonarApartadoModal(layawayId, folio, pending) {
  _abonoLayawayId = layawayId;
  const titleEl = document.getElementById("abono-modal-title");
  if (titleEl) titleEl.textContent = `Registrar Abono — ${folio}`;
  const montoEl = document.getElementById("abono-monto");
  if (montoEl) { montoEl.value = parseFloat(pending).toFixed(2); montoEl.max = parseFloat(pending).toFixed(2); }
  const pendEl = document.getElementById("abono-pendiente");
  if (pendEl) pendEl.textContent = `$${parseFloat(pending).toFixed(2)}`;
  const metodoEl = document.getElementById("abono-metodo");
  if (metodoEl) metodoEl.value = "efectivo";
  openModal("modal-abono-apartado");
  if (window.lucide) lucide.createIcons();
}

async function _submitAbono() {
  if (!_abonoLayawayId) return;
  const monto = parseFloat(document.getElementById("abono-monto")?.value || 0);
  if (!monto || monto <= 0) { showToast("Ingresa un monto válido", "warning"); return; }
  const metodo = document.getElementById("abono-metodo")?.value || "efectivo";
  try {
    const resp = await apiFetch(`/api/layaways/${_abonoLayawayId}/payments`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ amount: monto, payment_method: metodo }),
    });
    if (!resp.ok) {
      const err = await resp.json().catch(() => ({}));
      showToast(err.detail || "Error al registrar abono", "error");
      return;
    }
    showToast("Abono registrado correctamente", "success");
    closeModal("modal-abono-apartado");
    openClientApartadosModal(_apartadoCurrentClient);
  } catch {
    showToast("Error de red al registrar abono", "error");
  }
}

function openNuevoApartadoModal() {
  if (!_apartadoCurrentClient) { showToast("Selecciona un cliente primero", "warning"); return; }
  const cartItems = Array.isArray(cart) ? cart : [];
  if (cartItems.length === 0) { showToast("No hay artículos en el carrito", "warning"); return; }

  const total = cartItems.reduce((s, i) => s + parseFloat(i.price || i.base_price || 0) * parseFloat(i.quantity || 1), 0);

  const itemsEl = document.getElementById("nuevo-ap-items");
  if (itemsEl) {
    itemsEl.innerHTML = cartItems.map(i => {
      const p = parseFloat(i.price || i.base_price || 0);
      const q = parseFloat(i.quantity || 1);
      return `<div class="flex items-center px-3 py-2 border-b border-slate-50 last:border-0 gap-2">
        <span class="font-mono text-slate-400 text-[10px] w-20 shrink-0">${i.sku || "-"}</span>
        <span class="flex-1 text-xs">${i.description || i.sku}</span>
        <span class="text-slate-400 text-[10px] w-8 text-center shrink-0">${q}</span>
        <span class="font-bold text-xs w-16 text-right shrink-0">$${(p * q).toFixed(2)}</span>
      </div>`;
    }).join("");
  }
  const totalEl = document.getElementById("nuevo-ap-total");
  if (totalEl) totalEl.textContent = `$${total.toFixed(2)}`;
  const montoEl = document.getElementById("nuevo-ap-monto");
  if (montoEl) { montoEl.value = ""; montoEl.max = total.toFixed(2); montoEl.placeholder = `0.01 – ${total.toFixed(2)}`; }
  const notaEl = document.getElementById("nuevo-ap-nota");
  if (notaEl) notaEl.value = "";
  const metodoEl = document.getElementById("nuevo-ap-metodo");
  if (metodoEl) metodoEl.value = "efectivo";
  openModal("modal-nuevo-apartado");
  if (window.lucide) lucide.createIcons();
}

async function _submitNuevoApartado() {
  if (!_apartadoCurrentClient) return;
  const cartItems = Array.isArray(cart) ? cart : [];
  if (cartItems.length === 0) { showToast("No hay artículos en el carrito", "warning"); return; }
  const monto = parseFloat(document.getElementById("nuevo-ap-monto")?.value || 0);
  if (!monto || monto <= 0) { showToast("Ingresa el monto del abono inicial", "warning"); return; }
  const metodo = document.getElementById("nuevo-ap-metodo")?.value || "efectivo";
  const nota = document.getElementById("nuevo-ap-nota")?.value.trim() || null;

  const items = cartItems.map(i => ({
    product_id: i.product_id || null,
    product_sku: i.sku || "",
    description: i.description || i.sku || "",
    quantity: parseFloat(i.quantity || 1),
    price: parseFloat(i.price || i.base_price || 0),
  }));

  const payload = {
    client_id: String(_apartadoCurrentClient.id),
    client_name: _apartadoCurrentClient.name || _apartadoCurrentClient.nombre || "",
    items,
    initial_payment: monto,
    payment_method: metodo,
    nota,
  };

  try {
    const resp = await apiFetch("/api/layaways", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!resp.ok) {
      const err = await resp.json().catch(() => ({}));
      showToast(err.detail || "Error al crear apartado", "error");
      return;
    }
    const lay = await resp.json();
    showToast(`Apartado ${lay.folio} creado — Abono: $${monto.toFixed(2)}`, "success");
    closeModal("modal-nuevo-apartado");
    closeModal("modal-client-apartados");
  } catch {
    showToast("Error de red al crear apartado", "error");
  }
}

// ---- F7: RESGUARDOS ----
async function openClientResguardosModal() {
  const client = getHighlightedClientData();
  if (!client || !client.id) {
    showToast("Selecciona un cliente primero", "warning");
    return;
  }
  const nameEl = document.getElementById("resguardos-client-name");
  if (nameEl) nameEl.textContent = client.name || "-";

  try {
    const resp = await apiFetch(`/api/safekept?client_id=${encodeURIComponent(client.id)}&is_safekept=false`);
    const data = await resp.json();
    const tbody = document.getElementById("resguardos-table-body");
    if (!tbody) return;
    if (!data || data.length === 0) {
      tbody.innerHTML = `<tr><td colspan="6" class="text-center py-6 text-slate-400">Sin resguardos activos para este cliente</td></tr>`;
    } else {
      tbody.innerHTML = data.map(a => `<tr class="hover:bg-slate-50">
        <td class="py-2.5 px-4 font-mono text-slate-400">${a.sku || "-"}</td>
        <td class="py-2.5 px-4">${a.product_name || "-"}</td>
        <td class="py-2.5 px-4 text-center">${a.quantity || 1}</td>
        <td class="py-2.5 px-4">${a.date || "-"}</td>
        <td class="py-2.5 px-4 text-slate-400">${a.notes || "-"}</td>
        <td class="py-2.5 px-4 text-right">$${parseFloat(a.total_amount || 0).toFixed(2)}</td>
      </tr>`).join("");
    }
  } catch {
    const tbody = document.getElementById("resguardos-table-body");
    if (tbody) tbody.innerHTML = `<tr><td colspan="6" class="text-center py-4 text-slate-400">Error al cargar resguardos</td></tr>`;
  }
  openModal("modal-client-resguardos");
  if (window.lucide) lucide.createIcons();
}

// ---- F8: ANTICIPOS / LEDGER ----
async function openClientAnticipossModal() {
  const client = getHighlightedClientData();
  if (!client || !client.id) {
    showToast("Selecciona un cliente primero", "warning");
    return;
  }
  const nameEl = document.getElementById("anticipos-client-name");
  if (nameEl) nameEl.textContent = client.name || "-";

  try {
    const resp = await apiFetch(`/api/clients/${encodeURIComponent(client.id)}/ledger`);
    const data = await resp.json();

    const creditBalance = data.credit_balance !== undefined ? data.credit_balance : 0;
    const balanceEl = document.getElementById("anticipos-balance");
    if (balanceEl) balanceEl.textContent = `$${parseFloat(creditBalance).toFixed(2)}`;

    const tbody = document.getElementById("anticipos-ledger-body");
    if (!tbody) return;
    const entries = data.entries || [];
    if (entries.length === 0) {
      tbody.innerHTML = `<tr><td colspan="5" class="text-center py-4 text-slate-400">Sin movimientos en bóveda</td></tr>`;
    } else {
      let runningBalance = 0;
      tbody.innerHTML = entries.map((e, i) => {
        runningBalance += parseFloat(e.amount || 0);
        const color = e.amount > 0 ? "text-green-600" : "text-red-500";
        const sign = e.amount > 0 ? "+" : "";
        return `<tr class="hover:bg-slate-50">
          <td class="py-2 px-3 text-slate-400">${i + 1}</td>
          <td class="py-2 px-3">${e.created_at ? new Date(e.created_at).toLocaleDateString("es-MX") : "-"}</td>
          <td class="py-2 px-3">${e.description || e.transaction_type || "-"}</td>
          <td class="py-2 px-3 text-right ${color}">${sign}$${Math.abs(e.amount).toFixed(2)}</td>
          <td class="py-2 px-3 text-right font-black">$${runningBalance.toFixed(2)}</td>
        </tr>`;
      }).join("");
    }
  } catch {
    const tbody = document.getElementById("anticipos-ledger-body");
    if (tbody) tbody.innerHTML = `<tr><td colspan="5" class="text-center py-4 text-slate-400">Error al cargar la bóveda</td></tr>`;
  }
  openModal("modal-client-anticipos");
  if (window.lucide) lucide.createIcons();
}

async function _registrarAnticipo() {
  const client = getHighlightedClientData();
  if (!client || !client.id) { showToast("Selecciona un cliente primero", "warning"); return; }
  const amountRaw = parseFloat(document.getElementById("anticipo-amount")?.value || "0");
  if (!amountRaw || amountRaw <= 0) { showToast("Ingresa un monto válido", "warning"); return; }
  const paymentMethod = document.getElementById("anticipo-payment-method")?.value || "efectivo";
  const description = document.getElementById("anticipo-description")?.value.trim() || null;
  try {
    const resp = await apiFetch(`/api/clients/${encodeURIComponent(client.id)}/anticipo`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ amount: amountRaw, payment_method: paymentMethod, description }),
    });
    if (!resp.ok) {
      const err = await resp.json().catch(() => ({}));
      showToast(err.detail || "Error al registrar anticipo", "error");
      return;
    }
    const updatedClient = await resp.json();
    // update local activeClient if it matches
    if (typeof activeClient !== "undefined" && activeClient && activeClient.id === client.id) {
      activeClient.saldo_favor = updatedClient.saldo_favor;
      if (typeof refreshSaldoFavorRow === "function") refreshSaldoFavorRow();
    }
    const fmtAmt = "$" + amountRaw.toLocaleString("es-MX", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    showToast(`Anticipo de ${fmtAmt} registrado`, "success");
    // clear form
    if (document.getElementById("anticipo-amount")) document.getElementById("anticipo-amount").value = "";
    if (document.getElementById("anticipo-description")) document.getElementById("anticipo-description").value = "";
    // refresh ledger view
    await openClientAnticipossModal();
  } catch {
    showToast("Error de red al registrar anticipo", "error");
  }
}

// ---- F9: COTIZACIONES ----
function openClientCotizacionesModal() {
  const client = getHighlightedClientData();
  if (!client || !client.id) {
    showToast("Selecciona un cliente primero", "warning");
    return;
  }
  const nameEl = document.getElementById("cotizaciones-client-name");
  if (nameEl) nameEl.textContent = client.name || "-";

  // Cotizaciones are stored in localStorage by clientId
  const key = `cotizaciones_${client.id}`;
  const stored = JSON.parse(localStorage.getItem(key) || "[]");
  const tbody = document.getElementById("cotizaciones-table-body");
  if (!tbody) return;
  if (stored.length === 0) {
    tbody.innerHTML = `<tr><td colspan="6" class="text-center py-6 text-slate-400">Sin cotizaciones para este cliente. Genera una cotización desde el módulo de ventas.</td></tr>`;
  } else {
    tbody.innerHTML = stored.map(c => `<tr class="hover:bg-slate-50">
      <td class="py-2.5 px-4 font-mono">${c.folio || "-"}</td>
      <td class="py-2.5 px-4">${c.date || "-"}</td>
      <td class="py-2.5 px-4 text-slate-400">${(c.items || []).length} art.</td>
      <td class="py-2.5 px-4 text-right font-black">$${parseFloat(c.total || 0).toFixed(2)}</td>
      <td class="py-2.5 px-4 text-center"><span class="bg-blue-100 text-blue-600 px-2 py-0.5 rounded-full text-[9px] font-black">${c.status || "VIGENTE"}</span></td>
      <td class="py-2.5 px-4 text-center">
        <button onclick="loadCotizacionToCart('${c.folio}')" class="bg-blue-100 text-blue-600 px-2 py-0.5 rounded-lg text-[9px] font-bold hover:bg-blue-200 transition">Cargar</button>
      </td>
    </tr>`).join("");
  }
  openModal("modal-client-cotizaciones");
  if (window.lucide) lucide.createIcons();
}

function loadCotizacionToCart(folio) {
  showToast(`Cargando cotización ${folio} al carrito...`, "info");
  closeModal("modal-client-cotizaciones");
}

// ---- F10: HISTORIAL COMPLETO ----
async function openClientHistorialModal() {
  const client = getHighlightedClientData();
  if (!client || !client.id) {
    showToast("Selecciona un cliente primero", "warning");
    return;
  }
  const nameEl = document.getElementById("historial-client-name");
  if (nameEl) nameEl.textContent = client.name || "-";

  try {
    const resp = await apiFetch(`/api/sales?client_id=${encodeURIComponent(client.id)}&limit=200`);
    const data = await resp.json();
    const sales = Array.isArray(data) ? data : (data.sales || []);

    // Stats
    const totalAmt = sales.reduce((s, v) => s + parseFloat(v.total || 0), 0);
    const avgTicket = sales.length > 0 ? totalAmt / sales.length : 0;
    const lastDate = sales.length > 0 ? new Date(sales[0].created_at || sales[0].date).toLocaleDateString("es-MX") : "-";

    document.getElementById("hist-total-purchases").textContent = sales.length;
    document.getElementById("hist-total-amount").textContent = `$${totalAmt.toFixed(2)}`;
    document.getElementById("hist-avg-ticket").textContent = `$${avgTicket.toFixed(2)}`;
    document.getElementById("hist-last-purchase").textContent = lastDate;

    const tbody = document.getElementById("historial-table-body");
    if (!tbody) return;
    if (sales.length === 0) {
      tbody.innerHTML = `<tr><td colspan="6" class="text-center py-6 text-slate-400">Sin historial de compras</td></tr>`;
    } else {
      tbody.innerHTML = sales.map(s => `<tr class="hover:bg-slate-50">
        <td class="py-2.5 px-4 font-mono text-slate-500">${s.folio || s.id || "-"}</td>
        <td class="py-2.5 px-4">${s.created_at ? new Date(s.created_at).toLocaleDateString("es-MX") : s.date || "-"}</td>
        <td class="py-2.5 px-4 text-slate-400">${(s.items || []).length} art.</td>
        <td class="py-2.5 px-4 text-slate-500">${s.payment_method || "Efectivo"}</td>
        <td class="py-2.5 px-4 text-right font-black text-blue-700">$${parseFloat(s.total || 0).toFixed(2)}</td>
        <td class="py-2.5 px-4 text-center">
          <button onclick="reprintTicket('${s.id}')" class="bg-slate-100 text-slate-600 px-2 py-0.5 rounded-lg text-[9px] font-bold hover:bg-slate-200 transition">🖨 Reimpr.</button>
        </td>
      </tr>`).join("");
    }
  } catch {
    const tbody = document.getElementById("historial-table-body");
    if (tbody) tbody.innerHTML = `<tr><td colspan="6" class="text-center py-4 text-slate-400">Error al cargar historial</td></tr>`;
  }
  openModal("modal-client-historial");
  if (window.lucide) lucide.createIcons();
}

function exportClientHistorial() {
  const rows = document.querySelectorAll("#historial-table-body tr");
  let csv = "FOLIO,FECHA,ARTICULOS,PAGO,TOTAL\n";
  rows.forEach(r => {
    const cells = r.querySelectorAll("td");
    if (cells.length >= 5) {
      csv += `"${cells[0].textContent.trim()}","${cells[1].textContent.trim()}","${cells[2].textContent.trim()}","${cells[3].textContent.trim()}","${cells[4].textContent.trim()}"\n`;
    }
  });
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a"); a.href = url; a.download = "historial_cliente.csv"; a.click();
  URL.revokeObjectURL(url);
  showToast("Historial exportado como CSV", "success");
}

function reprintTicket(saleId) {
  showToast(`Reimprimiendo ticket #${saleId}...`, "info");
}

// ---- F12: ONLINE SALES ----
function openClientOnlineSalesModal() {
  const client = getHighlightedClientData();
  if (!client || !client.id) {
    showToast("Selecciona un cliente primero", "warning");
    return;
  }
  const tbody = document.getElementById("online-sales-body");
  if (tbody) tbody.innerHTML = `<tr><td colspan="6" class="text-center py-6 text-slate-300">Módulo de ventas online en desarrollo para: ${escHTML(client.name)}</td></tr>`;
  openModal("modal-client-online");
  if (window.lucide) lucide.createIcons();
}

// ---- CTRL+C: CONTACTAR ----
function handleClientCtrlC() {
  const client = getHighlightedClientData();
  if (!client || !client.id) {
    showToast("Selecciona un cliente primero", "warning");
    return;
  }
  const initials = (client.name || "??").split(" ").slice(0, 2).map(w => w[0]).join("").toUpperCase();
  const avatarEl = document.getElementById("contactar-avatar");
  if (avatarEl) avatarEl.textContent = initials;
  const nameEl = document.getElementById("contactar-client-name");
  if (nameEl) nameEl.textContent = client.name || "-";
  const phoneEl = document.getElementById("contactar-client-phone");
  if (phoneEl) phoneEl.textContent = client.phone || "-";
  const emailEl = document.getElementById("contactar-client-email");
  if (emailEl) emailEl.textContent = client.email || "-";

  // Populate links
  const waLink = document.getElementById("contactar-whatsapp-link");
  if (waLink) waLink.href = `https://wa.me/52${(client.whatsapp || client.phone || "").replace(/\D/g, "")}`;
  const phoneLink = document.getElementById("contactar-phone-link");
  if (phoneLink) phoneLink.href = `tel:${client.phone || ""}`;
  const emailLink = document.getElementById("contactar-email-link");
  if (emailLink) emailLink.href = `mailto:${client.email || ""}`;

  openModal("modal-client-contactar");
  if (window.lucide) lucide.createIcons();
}

function openWhatsApp() {
  const waLink = document.getElementById("contactar-whatsapp-link");
  if (waLink && waLink.href !== "#") return true; // allow native link
  showToast("No hay número de teléfono registrado", "warning");
  return false;
}

function saveContactNote() {
  const note = document.getElementById("contactar-note")?.value?.trim();
  if (!note) { showToast("Escribe una nota primero", "warning"); return; }
  showToast("Nota de cobranza guardada", "success");
  closeModal("modal-client-contactar");
}

// ---- RECORDATORIO ----
function openReminderModal() {
  const now = new Date();
  const dateInput = document.getElementById("reminder-date");
  if (dateInput) dateInput.value = now.toISOString().split("T")[0];
  const timeInput = document.getElementById("reminder-time");
  if (timeInput) {
    const h = String(now.getHours()).padStart(2, "0");
    const m = String(now.getMinutes()).padStart(2, "0");
    timeInput.value = `${h}:${m}`;
  }
  openModal("modal-reminder");
  if (window.lucide) lucide.createIcons();
}

function saveReminder() {
  const date = document.getElementById("reminder-date")?.value;
  const time = document.getElementById("reminder-time")?.value;
  const msg = document.getElementById("reminder-message")?.value?.trim();
  if (!date || !msg) { showToast("Completa la fecha y el mensaje", "warning"); return; }
  const reminders = JSON.parse(localStorage.getItem("calebsys_reminders") || "[]");
  reminders.push({ date, time, message: msg, created: new Date().toISOString() });
  localStorage.setItem("calebsys_reminders", JSON.stringify(reminders));
  showToast(`Recordatorio guardado para ${date}`, "success");
  closeModal("modal-reminder");
}

// ---- F6: CONTACTAR ----
function openClientContactarModal() {
  const client = getHighlightedClientData();
  if (!client || !client.id) {
    showToast("Selecciona un cliente primero", "warning");
    return;
  }
  // Construir opciones de contacto disponibles
  const lines = [];
  if (client.phone)    lines.push(`📞 Teléfono: <a href="tel:${client.phone}" class="text-blue-600 underline font-bold">${client.phone}</a>`);
  if (client.whatsapp) lines.push(`💬 WhatsApp: <a href="https://wa.me/52${client.whatsapp.replace(/\D/g,'')}" target="_blank" class="text-green-600 underline font-bold">${client.whatsapp}</a>`);
  if (client.email)    lines.push(`✉️ Email: <a href="mailto:${client.email}" class="text-indigo-600 underline font-bold">${client.email}</a>`);
  if (lines.length === 0) {
    showToast("Este cliente no tiene datos de contacto registrados", "warning");
    return;
  }
  // Mostrar en toast enriquecido o en modal genérico
  const body = document.getElementById("modal-contactar-body");
  const nameEl = document.getElementById("modal-contactar-name");
  if (body && nameEl) {
    nameEl.textContent = client.name || "-";
    body.innerHTML = lines.map(l => `<div class="py-1.5 text-sm">${l}</div>`).join("");
    openModal("modal-contactar");
    if (window.lucide) lucide.createIcons();
  } else {
    // Fallback: toast con info básica
    showToast(`${client.name} — ${client.phone || client.whatsapp || client.email || "Sin contacto"}`, "info");
  }
}

// ---- EXPORT CLIENT REPORT ----
function exportClientReport() {
  const rows = document.querySelectorAll("#clients-table-body tr");
  if (rows.length === 0) { showToast("No hay clientes para exportar", "warning"); return; }
  let csv = "ID/TELEFONO,CLIENTE,SALDO A FAVOR,LIMITE CREDITO,SALDO ACTUAL,APARTADOS,ULTIMA COMPRA,RESGUARDOS,PUNTOS\n";
  rows.forEach(r => {
    const cells = r.querySelectorAll("td");
    if (cells.length >= 9) {
      csv += Array.from(cells).slice(0, 9).map(c => `"${c.textContent.trim()}"`).join(",") + "\n";
    }
  });
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a"); a.href = url; a.download = "reporte_clientes.csv"; a.click();
  URL.revokeObjectURL(url);
  showToast("Reporte de clientes exportado", "success");
}

