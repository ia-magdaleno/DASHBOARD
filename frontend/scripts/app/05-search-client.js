/* 05-search-client.js — Modal busqueda producto/cliente, client display, price scale, submitNewClient
   Extraido de app_v66.js (fase 3, modularizacion post-auditoria 2026-08-03)
   Lineas originales: 2416-2763 */
// --- MODAL SEARCH TABLE LOGIC (F1 & F2) ---

function performProductSearch(query) {
  apiFetch(`${API_BASE}/products/search?q=${encodeURIComponent(query)}`)
    .then(res => {
      if (!res.ok) throw new Error("HTTP " + res.status);
      return res.json();
    })
    .then(products => {
      selectedSearchList = Array.isArray(products) ? products : [];
      selectedSearchIndex = selectedSearchList.length > 0 ? 0 : -1;
      renderProductSearchResults();
    })
    .catch(err => {
      console.error("[performProductSearch] Error:", err);
      showToast("Error cargando productos. Verifica que el servidor este activo.", "warning");
    });
}

function renderProductSearchResults() {
  const tbody = document.getElementById("article-results-body");
  tbody.innerHTML = "";

  if (selectedSearchList.length === 0) {
    tbody.innerHTML = `<tr><td colspan="4" class="text-center py-6 text-slate-400">Ningún producto coincide</td></tr>`;
    return;
  }

  const targetScale = (typeof temporaryPriceScale !== "undefined" && temporaryPriceScale) ? temporaryPriceScale : (typeof activePriceScale !== "undefined" ? activePriceScale : "PRECIO DE LISTA");

  selectedSearchList.forEach((product, idx) => {
    const tr = document.createElement("tr");
    const isSelected = idx === selectedSearchIndex;
    const resolvedPrice = typeof getProductPriceForClient === "function"
      ? getProductPriceForClient(product, targetScale)
      : parseFloat(product.price || 0);
    tr.className = `hover:bg-slate-50 cursor-pointer ${isSelected ? "bg-blue-50 font-semibold" : ""}`;
    tr.innerHTML = `
      <td class="py-2 px-3 font-bold text-slate-500">${product.sku}</td>
      <td class="py-2 px-3 text-slate-700">${product.description}</td>
      <td class="py-2 px-3 text-right font-bold">$${resolvedPrice.toFixed(2)}</td>
      <td class="py-2 px-3 text-right font-semibold ${product.stock <= 0 ? 'text-red-500':'text-slate-500'}">${product.stock}</td>
    `;
    
    tr.addEventListener("click", () => {
      selectedSearchIndex = idx;
      selectHighlightedSearch();
    });

    tbody.appendChild(tr);
  });
}

function performClientSearch(query) {
  // POS-SEARCH: detectar si el query parece un número de teléfono (≥7 dígitos)
  // y actualizar el placeholder del input para feedback visual
  const cleanDigits = query.replace(/\D/g, "");
  const isPhoneQuery = cleanDigits.length >= 7;
  const searchInput = document.getElementById("client-search-input");
  if (searchInput) {
    const hint = document.getElementById("client-search-hint");
    if (hint) {
      hint.textContent = isPhoneQuery
        ? `🔍 Buscando por teléfono: ${cleanDigits}`
        : `🔍 Buscando por nombre / RFC`;
      hint.className = isPhoneQuery
        ? "text-[10px] text-blue-500 font-semibold mt-1 block"
        : "text-[10px] text-slate-400 mt-1 block";
    }
  }
  apiFetch(`${API_BASE}/clients?q=${encodeURIComponent(query)}`)
    .then(res => res.json())
    .then(clients => {
      selectedSearchList = clients;
      selectedSearchIndex = clients.length > 0 ? 0 : -1;
      renderClientSearchResults();
    });
}

function renderClientSearchResults() {
  const tbody = document.getElementById("client-results-body");
  tbody.innerHTML = "";

  if (selectedSearchList.length === 0) {
    // Obtener el query actual para ofrecerlo en el botón "Crear"
    const searchInput = document.getElementById("client-search-input");
    const q = searchInput ? searchInput.value.trim() : "";
    const isPhone = /^\d{7,10}$/.test(q.replace(/\D/g, ""));
    tbody.innerHTML = `
      <tr>
        <td colspan="4" class="text-center py-6">
          <div class="text-slate-400 mb-3">
            <i class="fa-solid fa-user-xmark text-2xl mb-2 block opacity-40"></i>
            ${isPhone ? `No se encontró cliente con teléfono <strong class="text-slate-600">${q}</strong>.` : "Ningún cliente coincide con la búsqueda."}
          </div>
          <div class="flex items-center justify-center gap-3">
            <button onclick="posCrearNuevoCliente()" class="bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs px-4 py-2 rounded-xl transition flex items-center gap-2">
              <i class="fa-solid fa-user-plus"></i> Crear cliente nuevo
            </button>
            <button onclick="posUsarPublicoGeneral()" class="bg-slate-100 hover:bg-slate-200 text-slate-600 font-bold text-xs px-4 py-2 rounded-xl transition flex items-center gap-2">
              <i class="fa-solid fa-users"></i> Continuar como Público General
            </button>
          </div>
        </td>
      </tr>`;
    return;
  }

  selectedSearchList.forEach((client, idx) => {
    const tr = document.createElement("tr");
    const isSelected = idx === selectedSearchIndex;
    tr.className = `hover:bg-slate-50 cursor-pointer ${isSelected ? "bg-blue-50 font-semibold" : ""}`;
    tr.innerHTML = `
      <td class="py-2 px-3 text-slate-500 font-medium text-indigo-600">${client.client_code || "N/A"}${client.phone ? ' / TEL:'+client.phone : ''}${client.whatsapp ? ' / WA:'+client.whatsapp : ''}</td>
      <td class="py-2 px-3 text-slate-700 font-bold">${client.name}</td>
      <td class="py-2 px-3 text-slate-500">${client.rfc || 'S/N'}</td>
      <td class="py-2 px-3"><span class="bg-slate-100 text-slate-600 font-semibold text-[10px] px-2 py-0.5 rounded">${client.client_type}</span></td>
    `;
    
    tr.addEventListener("click", () => {
      selectedSearchIndex = idx;
      selectHighlightedSearch();
    });

    tbody.appendChild(tr);
  });
}

function handleSearchNavigation(e) {
  if (selectedSearchList.length === 0) return;

  if (e.key === "ArrowDown") {
    e.preventDefault();
    selectedSearchIndex = (selectedSearchIndex + 1) % selectedSearchList.length;
    if (selectedSearchType === "product") renderProductSearchResults();
    else renderClientSearchResults();
  } else if (e.key === "ArrowUp") {
    e.preventDefault();
    selectedSearchIndex = (selectedSearchIndex - 1 + selectedSearchList.length) % selectedSearchList.length;
    if (selectedSearchType === "product") renderProductSearchResults();
    else renderClientSearchResults();
  } else if (e.key === "Enter") {
    e.preventDefault();
    selectHighlightedSearch();
  }
}

function updateClientDisplay(client) {
  activeClient = client;
  document.getElementById("active-client-display").innerText = client.name;
  document.getElementById("active-client-rfc").innerText = client.rfc || "S/N";
  // D-02: sincronizar campo quick-search del panel cobro
  var cobroField = document.getElementById("client-quick-search-cobro");
  if (cobroField && document.activeElement !== cobroField) {
    cobroField.value = client.name;
  }
  
  // NR-03: usar assigned_price_scale (campo real de BD) como escala activa
  // Fallback: client_type (compatible con objetos creados antes de NR-03)
  activePriceScale = client.assigned_price_scale || client.client_type || "Público General";
  temporaryPriceScale = null;
  document.getElementById("price-type-display").innerText = activePriceScale.toUpperCase();

  // NR-03: recalcular precios del carrito usando price_scales reales del item
  // (price_scales se guarda en el item desde addToCart — ver 04-pos-cart.js)
  cart.forEach(item => {
    const basePrice = item.base_price || item.price;
    item.base_price = basePrice;
    item.price = getProductPriceForClient(item, activePriceScale);  // usa price_scales del item
    item.subtotal = item.quantity * item.price;
  });
  updateCartUI();

  // If CFDI is toggled, validate new client RFC
  const cfdiToggle = document.getElementById("cfdi-toggle");
  if (cfdiToggle && cfdiToggle.checked) {
    if (!validateRFC(client.rfc)) {
      cfdiToggle.checked = false;
      showToast("CFDI desactivado: El nuevo cliente no cuenta con RFC válido.", "warning");
    }
  }

  // If credit payment method is selected and client is Público General, reset payment method
  if (activePaymentMethod === "006" && client.id === 1) {
    selectPaymentMethod("001");
    showToast("Método de pago cambiado a Efectivo (Público General no admite crédito)", "warning");
  }

  // E-06a/E-06b: mostrar/actualizar row y banner de saldo a favor
  if (typeof refreshSaldoFavorRow === "function") refreshSaldoFavorRow();

  // E-06b: toast de alerta si el cliente tiene saldo a favor
  const _sf = parseFloat(client.saldo_favor || 0);
  if (_sf > 0 && client.id && client.id !== 1 && String(client.id) !== "1") {
    const _sfStr = '$' + _sf.toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    showToast(`${client.name} tiene ${_sfStr} de saldo a favor`, 'info');
  }

  // Ítem 1: cargar puntos de lealtad del cliente recién seleccionado
  if (typeof loadLoyaltyPtsForClient === "function") {
    clearLoyaltyDiscount && clearLoyaltyDiscount();
    loadLoyaltyPtsForClient(client.id && client.id !== 1 ? String(client.id) : null);
  }
}

// ── PRICE SCALE DROPDOWN STATE & REAL-TIME SYNC WITH ADMIN CONFIG / PRODUCT ALTA ──
let priceScaleMenuOpen = false;
let priceScaleHighlightIndex = 0;

function renderDynamicPosPriceScaleDropdown(customScales) {
  const dropdown = document.getElementById("price-scale-dropdown");
  if (!dropdown) return;
  const listContainer = dropdown.querySelector("div.py-1") || dropdown;
  if (!listContainer) return;

  let scales = Array.isArray(customScales) ? customScales : null;
  if (!scales || !scales.length) {
    try {
      scales = JSON.parse(localStorage.getItem("calebsys_price_scales_v1") || "null");
    } catch (e) {}
  }
  if (!Array.isArray(scales) || !scales.length) {
    scales = [
      { name: "PRECIO DE LISTA", active: true },
      { name: "CONTRATISTA", active: true },
      { name: "REVENTA", active: true },
      { name: "CREDITO", active: true },
      { name: "CREDITOS ESPECIALES", active: true }
    ];
  }

  const activeScales = scales.filter(s => s && s.active !== false && s.activa !== false);
  if (!activeScales.length) return;

  listContainer.innerHTML = activeScales.map((sc, i) => {
    const rawName = String(sc.name || sc.scale_name || sc.nombre || "PRECIO DE LISTA").trim();
    const isLast = i === activeScales.length - 1;
    const icon = i === 0 ? "💰" : (rawName.toUpperCase().includes("CONTRAT") ? "🔧" : (rawName.toUpperCase().includes("CRED") ? "💳" : "🏪"));
    return `<button type="button" data-scale="${rawName.replace(/"/g, '&quot;')}" data-click="selectPriceScale" data-click-arg="${rawName.replace(/"/g, '&quot;')}" class="w-full text-left px-4 py-2.5 transition ${isLast ? '' : 'border-b border-slate-100'} font-bold text-slate-700 hover:bg-slate-50">${icon} ${rawName}</button>`;
  }).join("");
}

async function syncPosPriceScalesFromBackend() {
  try {
    const r = await apiFetch(`${API_BASE}/admin/config`);
    if (r && r.ok) {
      const cfg = await r.json();
      if (cfg && Array.isArray(cfg["catalog.price_scales"]) && cfg["catalog.price_scales"].length) {
        localStorage.setItem("calebsys_price_scales_v1", JSON.stringify(cfg["catalog.price_scales"]));
      }
      if (cfg && Array.isArray(cfg["catalog.branch_price_scales"]) && cfg["catalog.branch_price_scales"].length) {
        localStorage.setItem("calebsys_branch_price_scales_v1", JSON.stringify(cfg["catalog.branch_price_scales"]));
      }
    }
  } catch (e) {}
  renderDynamicPosPriceScaleDropdown();
}

async function handleRealtimePosPricingUpdate(payload) {
  payload = payload || {};
  if (Array.isArray(payload.price_scales) && payload.price_scales.length) {
    try { localStorage.setItem("calebsys_price_scales_v1", JSON.stringify(payload.price_scales)); } catch (e) {}
  }
  if (Array.isArray(payload.branch_price_scales) && payload.branch_price_scales.length) {
    try { localStorage.setItem("calebsys_branch_price_scales_v1", JSON.stringify(payload.branch_price_scales)); } catch (e) {}
  }
  renderDynamicPosPriceScaleDropdown(payload.price_scales);

  const targetScale = (typeof temporaryPriceScale !== "undefined" && temporaryPriceScale) ? temporaryPriceScale : (typeof activePriceScale !== "undefined" ? activePriceScale : "PRECIO DE LISTA");

  // Actualizar productos que ya están en el carrito del POS en tiempo real
  if (typeof cart !== "undefined" && Array.isArray(cart) && cart.length > 0) {
    let cartChanged = false;
    for (let i = 0; i < cart.length; i++) {
      const item = cart[i];
      if (!item || !item.sku) continue;
      if (payload.sku && String(item.sku).toUpperCase() === String(payload.sku).toUpperCase() && payload.product) {
        const p = payload.product;
        item.base_price = p.price != null ? p.price : item.base_price;
        item.average_cost = p.average_cost != null ? p.average_cost : item.average_cost;
        item.meta_data = p.meta_data || item.meta_data || {};
        item.price_scales = p.price_scales || (item.meta_data && item.meta_data.price_scales) || item.price_scales || [];
      } else if (!payload.sku || String(item.sku).toUpperCase() === String(payload.sku).toUpperCase()) {
        try {
          const res = await apiFetch(`${API_BASE}/products/${encodeURIComponent(item.sku)}`);
          if (res && res.ok) {
            const freshProd = await res.json();
            item.base_price = freshProd.price;
            item.average_cost = freshProd.average_cost || 0;
            item.meta_data = freshProd.meta_data || {};
            item.price_scales = freshProd.price_scales || [];
          }
        } catch (e) {}
      }
      const newPrice = typeof getProductPriceForClient === "function"
        ? getProductPriceForClient(item, targetScale)
        : item.price;
      if (Math.abs((parseFloat(item.price) || 0) - newPrice) > 0.001) {
        item.price = newPrice;
        item.subtotal = item.quantity * item.price;
        cartChanged = true;
      }
    }
    if (cartChanged && typeof updateCartUI === "function") {
      updateCartUI();
      if (typeof showToast === "function") {
        showToast("Precios actualizados en tiempo real", "info");
      }
    }
  }

  // Si el dropdown de autocompletado o buscador de artículos está abierto, refrescar precios en vivo
  const autoDd = document.getElementById("autocomplete-dropdown");
  if (autoDd && !autoDd.classList.contains("hidden") && typeof autocompleteItems !== "undefined" && Array.isArray(autocompleteItems) && autocompleteItems.length > 0) {
    if (payload.sku && payload.product) {
      autocompleteItems.forEach((ap, idx) => {
        if (String(ap.sku || "").toUpperCase() === String(payload.sku).toUpperCase()) {
          autocompleteItems[idx] = Object.assign({}, ap, payload.product);
        }
      });
    }
    if (typeof renderAutocompleteDropdown === "function") renderAutocompleteDropdown();
  }

  const artModal = document.getElementById("modal-articles");
  if (artModal && !artModal.classList.contains("hidden") && typeof selectedSearchList !== "undefined" && Array.isArray(selectedSearchList) && selectedSearchList.length > 0) {
    if (payload.sku && payload.product) {
      selectedSearchList.forEach((sp, idx) => {
        if (String(sp.sku || "").toUpperCase() === String(payload.sku).toUpperCase()) {
          selectedSearchList[idx] = Object.assign({}, sp, payload.product);
        }
      });
    }
    renderProductSearchResults();
  }
}

if (!window.__posRealtimePricingBound) {
  window.__posRealtimePricingBound = true;
  try {
    if (typeof BroadcastChannel !== "undefined") {
      const ch = new BroadcastChannel("calebsys_pos_sync");
      ch.addEventListener("message", ev => {
        if (ev && ev.data) handleRealtimePosPricingUpdate(ev.data);
      });
    }
  } catch (e) {}
  window.addEventListener("storage", ev => {
    if (!ev) return;
    if (ev.key === "calebsys_pos_sync_event_v1" && ev.newValue) {
      try { handleRealtimePosPricingUpdate(JSON.parse(ev.newValue)); } catch (e) {}
    } else if (ev.key === "calebsys_price_scales_v1" || ev.key === "calebsys_branch_price_scales_v1") {
      handleRealtimePosPricingUpdate({});
    }
  });
  window.addEventListener("calebsys:pos-pricing-updated", ev => {
    handleRealtimePosPricingUpdate((ev && ev.detail) || {});
  });
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => { syncPosPriceScalesFromBackend(); });
  } else {
    setTimeout(() => { syncPosPriceScalesFromBackend(); }, 150);
  }
}

function getPriceScaleOptions() {
  // Reads options directly from the dropdown HTML
  const dropdown = document.getElementById("price-scale-dropdown");
  if (!dropdown) return [];
  return Array.from(dropdown.querySelectorAll("button[data-scale]"));
}

function togglePriceScaleMenu() {
  if (priceScaleMenuOpen) {
    closePriceScaleMenu();
  } else {
    openPriceScaleMenu();
  }
}

function openPriceScaleMenu() {
  const dropdown = document.getElementById("price-scale-dropdown");
  const productInput = document.getElementById("product-search-input");
  if (!dropdown) return;

  renderDynamicPosPriceScaleDropdown();

  priceScaleMenuOpen = true;
  priceScaleHighlightIndex = 0;
  dropdown.classList.remove("hidden");

  // BLOCK product input while menu is open
  if (productInput) {
    productInput.disabled = true;
    productInput.placeholder = "— ELIGE ESCALA DE PRECIO —";
    productInput.classList.add("opacity-40", "cursor-not-allowed");
  }

  renderPriceScaleHighlight();
}

function closePriceScaleMenu() {
  const dropdown = document.getElementById("price-scale-dropdown");
  const productInput = document.getElementById("product-search-input");

  priceScaleMenuOpen = false;
  if (dropdown) dropdown.classList.add("hidden");

  // UNBLOCK product input
  if (productInput) {
    productInput.disabled = false;
    productInput.placeholder = "Buscar producto...";
    productInput.classList.remove("opacity-40", "cursor-not-allowed");
    productInput.focus();
  }
}

function renderPriceScaleHighlight() {
  const btns = getPriceScaleOptions();
  btns.forEach((btn, i) => {
    btn.classList.remove("bg-blue-600", "text-white", "font-black");
    btn.classList.add("text-slate-700");
    if (i === priceScaleHighlightIndex) {
      btn.classList.add("bg-blue-600", "text-white", "font-black");
      btn.classList.remove("text-slate-700");
    }
  });
}

function navigatePriceScaleMenu(dir) {
  if (!priceScaleMenuOpen) return;
  const btns = getPriceScaleOptions();
  if (btns.length === 0) return;
  priceScaleHighlightIndex = (priceScaleHighlightIndex + dir + btns.length) % btns.length;
  renderPriceScaleHighlight();
}

function confirmPriceScaleSelection() {
  if (!priceScaleMenuOpen) return;
  const btns = getPriceScaleOptions();
  if (btns.length === 0) return;
  const selectedBtn = btns[priceScaleHighlightIndex];
  if (selectedBtn) {
    const scaleName = selectedBtn.getAttribute("data-scale");
    closePriceScaleMenu();
    selectPriceScale(scaleName);
  }
}

function selectPriceScale(scaleName) {
  // Hide dropdown
  closePriceScaleMenu();

  // ALWAYS ask confirmation
  pendingScaleSelection = scaleName;
  document.getElementById("new-scale-name").innerText = scaleName.toUpperCase();
  confirmScaleSelectedIndex = 0;
  openModal("modal-confirm-scale");
  renderConfirmScaleButtonsHighlight();
}

function renderConfirmScaleButtonsHighlight() {
  const btnNext = document.getElementById("btn-confirm-scale-next");
  const btnAll = document.getElementById("btn-confirm-scale-all");
  const btnCancel = document.getElementById("btn-confirm-scale-cancel");
  
  if (!btnNext || !btnAll || !btnCancel) return;
  
  // Set default styles
  btnNext.className = "bg-slate-200 hover:bg-slate-300 text-slate-700 font-bold text-xs px-4 py-2 rounded-xl transition border-2 border-transparent";
  btnAll.className = "bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs px-4 py-2 rounded-xl transition border-2 border-transparent";
  btnCancel.className = "bg-slate-100 hover:bg-slate-200 text-slate-500 font-bold text-xs px-3 py-2 rounded-xl transition border-2 border-transparent";
  
  // Apply active style to selected button
  if (confirmScaleSelectedIndex === 0) {
    btnNext.className = "bg-blue-600 text-white font-black text-xs px-4 py-2 rounded-xl transition border-2 border-blue-400 shadow-md";
  } else if (confirmScaleSelectedIndex === 1) {
    btnAll.className = "bg-blue-700 text-white font-black text-xs px-4 py-2 rounded-xl transition border-2 border-blue-400 shadow-md";
  } else if (confirmScaleSelectedIndex === 2) {
    btnCancel.className = "bg-red-600 text-white font-black text-xs px-3 py-2 rounded-xl transition border-2 border-red-400 shadow-md";
  }
}

function applyPriceScaleAction(actionType) {
  if (!pendingScaleSelection) return;
  
  const scaleName = pendingScaleSelection;
  pendingScaleSelection = null;
  closeModal("modal-confirm-scale");

  if (actionType === "all") {
    // NR-03: aplicar escala a todos los items usando sus price_scales reales
    activePriceScale = scaleName;
    document.getElementById("price-type-display").innerText = scaleName.toUpperCase();

    cart.forEach(item => {
      item.base_price = item.base_price || item.price;
      item.price      = getProductPriceForClient(item, scaleName);  // usa price_scales del item
      item.subtotal   = item.quantity * item.price;
    });

    updateCartUI();
    showToast(`Escala aplicada a toda la cuenta: ${scaleName}`, "success");
  } else if (actionType === "next") {
    // NR-03: aplicar solo al item seleccionado o al próximo
    if (selectedCartIndex !== -1 && cart.length > 0) {
      const item = cart[selectedCartIndex];
      item.base_price = item.base_price || item.price;
      item.price      = getProductPriceForClient(item, scaleName);
      item.subtotal   = item.quantity * item.price;
      updateCartUI();
      showToast(`Escala ${scaleName} aplicada al producto seleccionado`, "success");
    } else {
      // Apply temporary override for the next product
      temporaryPriceScale = scaleName;
      document.getElementById("price-type-display").innerText = `${scaleName.toUpperCase()} (SGTE ART.)`;
      showToast(`Escala temporal para el próximo producto: ${scaleName}`, "info");
    }
  }
}

function selectHighlightedSearch() {
  if (selectedSearchIndex === -1 || selectedSearchList.length === 0) return;
  const selected = selectedSearchList[selectedSearchIndex];

  if (selectedSearchType === "product") {
    addToCart(selected, 1);
    closeModal("modal-articles");
    showToast(`Añadido: ${selected.description}`, "success");
  } else {
    updateClientDisplay(selected);
    closeModal("modal-clients");
    showToast(`Cliente seleccionado: ${selected.name}`, "success");
  }
  focusProductInput();
}

// ── POS-1: Helpers "no encontrado" ──────────────────────────────────────
function posCrearNuevoCliente() {
  // Pre-rellenar el teléfono si la búsqueda parece un número
  const searchInput = document.getElementById("client-search-input");
  const q = searchInput ? searchInput.value.trim() : "";
  const isPhone = /^\d{7,10}$/.test(q.replace(/\D/g, ""));
  if (isPhone) {
    const phoneField = document.getElementById("new-client-phone");
    if (phoneField) phoneField.value = q;
  }
  // Cambiar a la tab "Agregar cliente" dentro del modal
  if (typeof toggleClientTab === "function") {
    toggleClientTab("add");
  } else {
    const addTab = document.getElementById("tab-client-add");
    if (addTab) addTab.click();
  }
}

function posUsarPublicoGeneral() {
  const publicoGeneral = {
    id: null,
    name: "Público en General",
    rfc: "XAXX010101000",
    client_type: "Público General",
    loyalty_points: 0,
  };
  updateClientDisplay(publicoGeneral);
  closeModal("modal-clients");
  showToast("Venta a Público en General", "info");
}
// ─────────────────────────────────────────────────────────────────────────

function submitNewClient(e) {
  e.preventDefault();
  const name = document.getElementById("new-client-name").value;
  const rfc = document.getElementById("new-client-rfc").value;
  const phone = document.getElementById("new-client-phone").value;
  const type = document.getElementById("new-client-type").value;

  // Validate phone if provided
  let cleanPhone = null;
  if (phone) {
    cleanPhone = phone.replace(/[^0-9]/g, '');
    if (cleanPhone.length !== 10) {
      showToast("El número de teléfono debe tener exactamente 10 dígitos.", "error");
      return;
    }
  }

  apiFetch(`${API_BASE}/clients`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, rfc: rfc || null, phone: cleanPhone, client_type: type })
  })
    .then(res => {
      if (!res.ok) throw new Error("Error al registrar cliente");
      return res.json();
    })
    .then(client => {
      updateClientDisplay(client);
      document.getElementById("client-add-form").reset();
      closeModal("modal-clients");
      showToast(`Cliente registrado: ${client.name}`, "success");
    })
    .catch((err) => {
      showToast(err.message || "Error al registrar cliente", "error");
    });
}


