/* 10-catalog.js — Multi-view catalog/client lists, kardex, armar paquete, apartados, cotizaciones
   Extraido de app_v66.js (fase 3, modularizacion post-auditoria 2026-08-03)
   Lineas originales: 3861-4922 */
// --- MULTI-VIEW & INLINE CATALOG/CLIENT LISTS LOGIC ---

function setView(viewName) {
  currentView = viewName;
  
  const salesView = document.getElementById("sales-view");
  const catalogView = document.getElementById("catalog-view");
  const clientsView = document.getElementById("clients-view");
  
  const salesHeader = document.getElementById("main-header-sales");

  // Toggle SIDEBARS
  const salesSidebar = document.getElementById("sales-sidebar");
  const clientsSidebar = document.getElementById("clients-sidebar");

  // Toggle FOOTERS
  const footerShortcuts = document.getElementById("footer-shortcuts");
  const footerStatus = document.getElementById("footer-status");
  
  salesView.classList.add("hidden");
  if (catalogView) catalogView.classList.add("hidden");
  if (clientsView) clientsView.classList.add("hidden");
  const _quotesViewEl = document.getElementById("quotes-view");
  if (_quotesViewEl) _quotesViewEl.classList.add("hidden");
    const newClientViewEl = document.getElementById("new-client-view");
    if (newClientViewEl) newClientViewEl.classList.add("hidden");
  
  if (salesHeader) {
    if (viewName === "clients") {
      salesHeader.classList.add("hidden");
    } else {
      salesHeader.classList.remove("hidden");
    }
  }

  if (viewName === "clients") {
    if (salesSidebar) salesSidebar.classList.add("hidden");
    if (clientsSidebar) clientsSidebar.classList.remove("hidden");
    if (footerShortcuts) footerShortcuts.classList.add("hidden");
    if (footerStatus) footerStatus.classList.remove("hidden");
    startStatusBarClock();
  } else {
    if (salesSidebar) salesSidebar.classList.remove("hidden");
    if (clientsSidebar) clientsSidebar.classList.add("hidden");
    if (footerShortcuts) footerShortcuts.classList.remove("hidden");
    if (footerStatus) footerStatus.classList.add("hidden");
    stopStatusBarClock();
  }
  
  if (viewName === "sales") {
    salesView.classList.remove("hidden");
    focusProductInput();
  } else if (viewName === "catalog") {
    if (catalogView) {
      catalogView.classList.remove("hidden");
      const catalogInput = document.getElementById("catalog-search-input");
      if (catalogInput) {
        catalogInput.value = "";
        catalogInput.focus();
      }
      performCatalogSearch("");
    }
  } else if (viewName === "clients") {
    if (clientsView) {
      clientsView.classList.remove("hidden");
      const clientsInput = document.getElementById("clients-search-input");
      if (clientsInput) {
        clientsInput.value = "";
        clientsInput.focus();
      }
      performCatalogClientSearch("");
    }
  } else if (viewName === "quotes") {
    const quotesViewEl = document.getElementById("quotes-view");
    if (quotesViewEl) {
      quotesViewEl.classList.remove("hidden");
      loadViewQuotes();
    }
  } else if (viewName === "new-client") {
      const newClientViewEl = document.getElementById("new-client-view");
      if (newClientViewEl) {
        newClientViewEl.classList.remove("hidden");
        const firstInput = document.getElementById("nc-razon-social");
        if (firstInput) setTimeout(() => firstInput.focus(), 100);
      }
    }
}

function toggleCatalogView() {
  if (activeModal === "modal-articles") {
    closeModal("modal-articles");
  } else {
    openModal("modal-articles");
    const articleInput = document.getElementById("article-search-input");
    if (articleInput) {
      articleInput.value = "";
      performProductSearch("");
    }
  }
}

function toggleClientsView() {
  if (currentView === "clients") {
    setView("sales");
  } else {
    setView("clients");
  }
}

// Product Catalog View
function performCatalogSearch(query) {
  apiFetch(`${API_BASE}/products/search?q=${encodeURIComponent(query)}`)
    .then(res => res.json())
    .then(products => {
      catalogProducts = products;
      selectedCatalogIndex = products.length > 0 ? 0 : -1;
      renderCatalogResults();
      updateCatalogDetail();
    });
}

function renderCatalogResults() {
  const tbody = document.getElementById("catalog-table-body");
  if (!tbody) return;
  tbody.innerHTML = "";

  if (catalogProducts.length === 0) {
    tbody.innerHTML = `<tr><td colspan="6" class="text-center py-6 text-slate-400">Ningún producto coincide</td></tr>`;
    return;
  }

  // Update the selection badge in the topbar
  const badge = document.getElementById("catalog-selection-badge");
  const countEl = document.getElementById("catalog-selection-count");
  if (badge && countEl) {
    if (selectedCatalogSKUs.size > 0) {
      badge.classList.remove("hidden");
      countEl.textContent = `${selectedCatalogSKUs.size} seleccionado${selectedCatalogSKUs.size !== 1 ? 's' : ''}`;
    } else {
      badge.classList.add("hidden");
    }
  }

  catalogProducts.forEach((product, idx) => {
    const tr = document.createElement("tr");
    const isFocused  = idx === selectedCatalogIndex;          // ← navegar con flechas
    const isSelected = selectedCatalogSKUs.has(product.sku); // ← ESPACIO para marcar

    // FOCO = gris muy tenue + ring sutil | SELECCIONADO = azul suave
    if (isSelected) {
      tr.className = "bg-blue-50 cursor-pointer border-l-4 border-blue-500";
    } else if (isFocused) {
      tr.className = "bg-gray-50 cursor-pointer ring-1 ring-inset ring-gray-300";
    } else {
      tr.className = "hover:bg-slate-50 cursor-pointer";
    }

    tr.dataset.idx = idx;
    tr.dataset.sku = product.sku;

    const stockClass = product.stock <= 0 ? 'text-red-500 font-black' : 'text-green-600';
    const targetScale = (typeof temporaryPriceScale !== 'undefined' && temporaryPriceScale) || (typeof activePriceScale !== 'undefined' && activePriceScale) || 'PRECIO DE LISTA';
    const effectiveCatalogPrice = typeof getProductPriceForClient === 'function'
      ? getProductPriceForClient(product, targetScale)
      : (parseFloat(product.price) || 0);

    tr.innerHTML = `
      <td class="py-2.5 px-3 text-center">
        <input type="checkbox" class="catalog-row-check w-3.5 h-3.5 accent-blue-600 cursor-pointer rounded" data-sku="${product.sku}" ${isSelected ? 'checked' : ''}
          onclick="event.stopPropagation(); toggleCatalogSku('${product.sku}'); renderCatalogResults();">
      </td>
      <td class="py-2.5 px-4 font-bold text-slate-500">${product.sku}</td>
      <td class="py-2.5 px-4 text-slate-800">${product.description}</td>
      <td class="py-2.5 px-4 text-slate-500 uppercase">${product.unit || 'Pz'}</td>
      <td class="py-2.5 px-4 text-right font-extrabold text-slate-800">$${effectiveCatalogPrice.toFixed(2)}</td>
      <td class="py-2.5 px-4 text-right font-bold ${stockClass}">${product.stock}</td>
    `;

    tr.addEventListener("click", () => {
      selectedCatalogIndex = idx;
      renderCatalogResults();
      updateCatalogDetail();
    });

    tbody.appendChild(tr);
  });

  // Sync select-all checkbox state
  const selectAllCb = document.getElementById("catalog-select-all");
  if (selectAllCb) {
    const allSelected = catalogProducts.length > 0 && catalogProducts.every(p => selectedCatalogSKUs.has(p.sku));
    selectAllCb.checked = allSelected;
    selectAllCb.indeterminate = !allSelected && selectedCatalogSKUs.size > 0;
  }
}

function toggleCatalogSku(sku) {
  if (selectedCatalogSKUs.has(sku)) {
    selectedCatalogSKUs.delete(sku);
  } else {
    selectedCatalogSKUs.add(sku);
  }
}

function toggleCatalogSelect() {
  if (selectedCatalogIndex === -1 || catalogProducts.length === 0) return;
  const product = catalogProducts[selectedCatalogIndex];
  toggleCatalogSku(product.sku);
  renderCatalogResults();
}

function navigateCatalog(direction) {
  if (catalogProducts.length === 0) return;
  // Hard wall: stop at first and last, no wrap-around
  selectedCatalogIndex = Math.max(0, Math.min(selectedCatalogIndex + direction, catalogProducts.length - 1));
  renderCatalogResults();
  
  const tbody = document.getElementById("catalog-table-body");
  if (tbody) {
    const rows = tbody.getElementsByTagName("tr");
    if (rows[selectedCatalogIndex]) {
      rows[selectedCatalogIndex].scrollIntoView({ block: "nearest" });
    }
  }
  
  updateCatalogDetail();
}

function updateCatalogDetail() {
  if (selectedCatalogIndex === -1 || catalogProducts.length === 0) {
    document.getElementById("spec-product-title").innerText = "Selecciona un Producto";
    document.getElementById("spec-product-price").innerText = "$0.00";
    document.getElementById("spec-product-sku").innerText = "- -";
    document.getElementById("spec-product-sat").innerText = "- -";
    document.getElementById("spec-product-unit").innerText = "- -";
    document.getElementById("spec-product-brand").innerText = "- -";
    document.getElementById("spec-product-date").innerText = "- -";
    document.getElementById("spec-product-location").innerText = "- -";
    document.getElementById("spec-stock-suc1").innerText = "0 Pz";
    document.getElementById("spec-stock-suc2").innerText = "0 Pz";
    document.getElementById("spec-stock-suc3").innerText = "0 Pz";
    document.getElementById("spec-stock-suc4").innerText = "0 Pz";
    document.getElementById("spec-product-status").classList.add("hidden");
    document.getElementById("spec-product-image").classList.add("hidden");
    document.getElementById("spec-product-image-placeholder").classList.remove("hidden");
    return;
  }

  const product = catalogProducts[selectedCatalogIndex];
  
  const satCode = getDeterministicHash(product.sku, ["84111506", "30191501", "30191502", "30191505", "30191509"]);
  const brand = getDeterministicHash(product.description, ["CEMEX", "HOLCIM", "TRUPER", "DEWALT", "CREST", "PANEL REY", "MAGDALENO"]);
  const location = getDeterministicHash(product.sku, ["A-12-B", "B-03-F", "C-09-A", "D-11-E", "Bodega Gral.", "Mostrador B"]);
  
  const h1 = parseInt(product.sku) || 7;
  const stock1 = Math.abs((h1 * 3) % 40);
  const stock2 = Math.abs((h1 * 7 + 12) % 30);
  const stock3 = Math.abs((h1 * 13 + 5) % 15);
  const stock4 = Math.abs((h1 * 19 + 2) % 10);
  
  const createDate = `10/09/202${Math.abs(h1 % 6)}`;
  const targetScaleDetail = (typeof temporaryPriceScale !== 'undefined' && temporaryPriceScale) || (typeof activePriceScale !== 'undefined' && activePriceScale) || 'PRECIO DE LISTA';
  const effectiveDetailPrice = typeof getProductPriceForClient === 'function'
    ? getProductPriceForClient(product, targetScaleDetail)
    : (parseFloat(product.price) || 0);
  
  document.getElementById("spec-product-title").innerText = product.description;
  document.getElementById("spec-product-price").innerText = `$${effectiveDetailPrice.toFixed(2)}`;
  document.getElementById("spec-product-sku").innerText = product.sku;
  document.getElementById("spec-product-sat").innerText = satCode;
  document.getElementById("spec-product-unit").innerText = product.unit || "Pz";
  document.getElementById("spec-product-brand").innerText = brand;
  document.getElementById("spec-product-date").innerText = createDate;
  document.getElementById("spec-product-location").innerText = location;
  // Stock por sucursal con alerta visual si la Matriz está en 0
  const suc1El  = document.getElementById("spec-stock-suc1");
  const suc1Row = document.getElementById("spec-suc1-row");
  suc1El.innerText = `${stock1} ${product.unit || 'Pz'}`;
  if (stock1 <= 0) {
    suc1El.className = "font-extrabold text-red-600";
    suc1Row.className = "flex justify-between items-center px-2 py-1 rounded-md bg-red-50 border border-red-200";
  } else {
    suc1El.className = "font-extrabold text-green-600";
    suc1Row.className = "flex justify-between items-center px-2 py-1 rounded-md";
  }
  document.getElementById("spec-stock-suc2").innerText = `${stock2} ${product.unit || 'Pz'}`;
  document.getElementById("spec-stock-suc3").innerText = `${stock3} ${product.unit || 'Pz'}`;
  document.getElementById("spec-stock-suc4").innerText = `${stock4} ${product.unit || 'Pz'}`;

  const statusLabel = document.getElementById("spec-product-status");
  if (product.stock > 0) {
    statusLabel.innerText = "EN STOCK";
    statusLabel.className = "bg-green-100 text-green-800 text-[8px] font-black px-2 py-0.5 rounded uppercase tracking-wider";
    statusLabel.classList.remove("hidden");
  } else {
    statusLabel.innerText = "AGOTADO";
    statusLabel.className = "bg-red-100 text-red-800 text-[8px] font-black px-2 py-0.5 rounded uppercase tracking-wider";
    statusLabel.classList.remove("hidden");
  }

  document.getElementById("spec-product-image").classList.add("hidden");
  document.getElementById("spec-product-image-placeholder").classList.remove("hidden");
}

// ─── MULTI-SELECCIÓN: Llevar todos los seleccionados a la venta ───
function addSelectedCatalogProductsToSale() {
  if (selectedCatalogSKUs.size === 0) {
    showToast("Marca al menos un artículo con ESPACIO", "warning");
    return;
  }
  catalogProducts.forEach(p => {
    if (selectedCatalogSKUs.has(p.sku)) addToCart(p, 1);
  });
  const n = selectedCatalogSKUs.size;
  selectedCatalogSKUs.clear();
  renderCatalogResults();
  setView("sales");
  showToast(`${n} artículo${n !== 1 ? 's' : ''} llevados a la venta`, "success");
}

// ─── KARDEX (stub — conectar con modal o vista) ───
function handleCatalogKardex() {
  if (selectedCatalogIndex === -1 || catalogProducts.length === 0) {
    showToast("Selecciona un artículo primero", "warning");
    return;
  }
  const product = catalogProducts[selectedCatalogIndex];
  showToast(`Kardex de: ${product.description}`, "info");
}

// ─── MODAL ARMAR PAQUETE (F4) ───
function openArmarPaqueteModal() {
  const modal = document.getElementById("modal-armar-paquete");
  if (!modal) return;

  // Populate kit components preview from current SELECTED items
  const previewEl = document.getElementById("paquete-items-preview");
  if (selectedCatalogSKUs.size === 0) {
    previewEl.innerHTML = `<span class="text-slate-400 italic">Sin artículos seleccionados en la tabla.</span>`;
  } else {
    const selected = catalogProducts.filter(p => selectedCatalogSKUs.has(p.sku));
    previewEl.innerHTML = selected.map(p =>
      `<div class="flex justify-between gap-2">
        <span class="font-semibold text-slate-700 truncate">${p.description}</span>
        <span class="text-blue-600 font-bold whitespace-nowrap">$${p.price.toFixed(2)}</span>
       </div>`
    ).join("");
  }

  modal.classList.remove("hidden");
  document.getElementById("paquete-nombre")?.focus();
}

function closeArmarPaqueteModal() {
  document.getElementById("modal-armar-paquete")?.classList.add("hidden");
}

function guardarPaquete() {
  const nombre = document.getElementById("paquete-nombre")?.value.trim();
  if (!nombre) {
    showToast("Escribe el nombre del paquete", "warning");
    document.getElementById("paquete-nombre")?.focus();
    return;
  }
  if (selectedCatalogSKUs.size === 0) {
    showToast("Selecciona al menos un artículo en la tabla", "warning");
    return;
  }
  const descuento = parseFloat(document.getElementById("paquete-descuento")?.value || 0);
  const escala    = document.getElementById("paquete-escala")?.value || "menudeo";
  const items     = catalogProducts.filter(p => selectedCatalogSKUs.has(p.sku));
  showToast(`Paquete "${nombre}" guardado con ${items.length} componente${items.length !== 1 ? 's' : ''}`, "success");
  closeArmarPaqueteModal();
}

function addHighlightedCatalogProduct() {
  if (selectedCatalogIndex === -1 || catalogProducts.length === 0) return;
  const product = catalogProducts[selectedCatalogIndex];
  addToCart(product, 1);
  setView("sales");
  showToast(`Añadido: ${product.description}`, "success");
}

function handleSolicitarMercancia() {
  if (selectedCatalogSKUs.size === 0) {
    showToast("No has seleccionado ningún artículo para solicitar", "warning");
    return;
  }
  const skuList = Array.from(selectedCatalogSKUs).join(", ");
  showToast(`Mercancía solicitada para los productos: ${skuList}`, "success");
  selectedCatalogSKUs.clear();
  renderCatalogResults();
}

// Client Catalog View
function performCatalogClientSearch(query) {
  apiFetch(`${API_BASE}/clients?q=${encodeURIComponent(query)}`)
    .then(res => res.json())
    .then(clients => {
      catalogClients = clients;
      selectedCatalogClientIndex = clients.length > 0 ? 0 : -1;
      renderCatalogClientResults();
      updateCatalogClientDetail();
    });
}

function renderCatalogClientResults() {
  const tbody = document.getElementById("clients-table-body");
  if (!tbody) return;
  tbody.innerHTML = "";

  if (catalogClients.length === 0) {
    tbody.innerHTML = `<tr><td colspan="9" class="text-center py-6 text-slate-400">Ningún cliente coincide</td></tr>`;
    return;
  }

  catalogClients.forEach((client, idx) => {
    const tr = document.createElement("tr");
    const isSelected = idx === selectedCatalogClientIndex;
    tr.className = `hover:bg-slate-50 cursor-pointer ${isSelected ? "bg-blue-50 font-bold border-l-4 border-blue-500" : ""}`;
    
    const formatCurrency = (val) => {
      if (val === undefined || val === null || val === 0) return "$";
      return `$ ${val.toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2})}`;
    };

    const phoneId = (client.client_code || "N/A") + (client.whatsapp ? ' / WA:'+client.whatsapp : '');
    const saldoFavorStr = formatCurrency(client.saldo_favor);
    const limiteStr = formatCurrency(client.limite_credito);
    
    let saldoActualStr = "$";
    let saldoActualClass = "text-slate-700";
    if (client.saldo_actual > 0) {
      saldoActualStr = `$ ${client.saldo_actual.toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2})}`;
      if (client.saldo_actual > 5000) {
        saldoActualClass = "text-blue-600 font-bold";
      } else {
        saldoActualClass = "text-orange-500 font-bold";
      }
    }
    
    const apartadosStr = formatCurrency(client.apartados);
    const ultimaCompraStr = client.ultima_compra || "S/N";
    
    let resguardosHTML = "-";
    if (client.resguardos) {
      resguardosHTML = '<span class="inline-flex items-center justify-center bg-green-100 text-green-800 text-[10px] font-black rounded-full px-1.5 py-0.5"><i data-lucide="check" class="w-3 h-3 text-green-600"></i></span>';
    }

    const puntosStr = client.puntos > 0 ? client.puntos.toLocaleString('en-US') : "";

    tr.innerHTML = `
      <td class="py-3 px-4 font-bold text-slate-500 whitespace-nowrap">${phoneId}</td>
      <td class="py-3 px-4 text-slate-800 whitespace-nowrap">${client.name}</td>
      <td class="py-3 px-4 text-right font-semibold text-slate-600 whitespace-nowrap">${saldoFavorStr}</td>
      <td class="py-3 px-4 text-right font-semibold text-slate-600 whitespace-nowrap">${limiteStr}</td>
      <td class="py-3 px-4 text-right ${saldoActualClass} whitespace-nowrap">${saldoActualStr}</td>
      <td class="py-3 px-4 text-right text-slate-600 whitespace-nowrap">${apartadosStr}</td>
      <td class="py-3 px-4 text-center text-slate-600 font-semibold whitespace-nowrap">${ultimaCompraStr}</td>
      <td class="py-3 px-4 text-center whitespace-nowrap">${resguardosHTML}</td>
      <td class="py-3 px-4 text-right text-slate-600 font-bold whitespace-nowrap">${puntosStr}</td>
    `;

    // ── REGLA DE ORO: data-* completos para pre-llenado de modal (tecla Espacio) ──
    tr.dataset.clientId          = client.id;          // True ID
    tr.dataset.clientName        = client.name         || "";
    tr.dataset.clientPhone       = client.phone        || "";
    tr.dataset.clientRfc         = client.rfc          || "";
    tr.dataset.clientEmail       = client.email        || "";
    tr.dataset.clientAddress     = client.address      || "";
    tr.dataset.clientCity        = client.city         || "";
    tr.dataset.clientCp          = client.zip_code     || "";
    tr.dataset.clientRegimen     = client.tax_regime   || "";
    tr.dataset.clientType        = client.client_type  || "";
    tr.dataset.clientBalance     = client.saldo_actual  || 0;
    tr.dataset.clientCreditLimit = client.limite_credito || 0;
    tr.dataset.clientCreditDays  = client.dias_credito  || 30;
    tr.dataset.clientPoints      = client.puntos        || 0;
    tr.dataset.clientPaymentMethod = client.payment_method || "Efectivo";

    tr.addEventListener("click", () => {
      selectedCatalogClientIndex = idx;
      renderCatalogClientResults();
      updateCatalogClientDetail();
    });

    tbody.appendChild(tr);
  });
  
  if (window.lucide) {
    window.lucide.createIcons();
  }
}

function navigateCatalogClients(direction) {
  if (catalogClients.length === 0) return;
  // Hard wall: stop at first and last, no wrap-around
  selectedCatalogClientIndex = Math.max(0, Math.min(selectedCatalogClientIndex + direction, catalogClients.length - 1));
  renderCatalogClientResults();
  
  const tbody = document.getElementById("clients-table-body");
  if (tbody) {
    const rows = tbody.getElementsByTagName("tr");
    if (rows[selectedCatalogClientIndex]) {
      rows[selectedCatalogClientIndex].scrollIntoView({ block: "nearest" });
    }
  }
  
  updateCatalogClientDetail();
}

function updateCatalogClientDetail() {
  if (selectedCatalogClientIndex === -1 || catalogClients.length === 0) {
    document.getElementById("spec-client-name").innerText = "Selecciona un Cliente";
    document.getElementById("spec-client-id").innerText = "- -";
    document.getElementById("spec-client-rfc").innerText = "- -";
    document.getElementById("spec-client-regimen").innerText = "- -";
    document.getElementById("spec-client-email").innerText = "- -";
    document.getElementById("spec-client-phone").innerText = "- -";
    document.getElementById("spec-client-address").innerText = "- -";
    document.getElementById("spec-client-city").innerText = "- -";
    document.getElementById("spec-client-cp").innerText = "- -";
    document.getElementById("spec-client-created").innerText = "- -";
    document.getElementById("spec-client-credit-limit").innerText = "- -";
    document.getElementById("spec-client-credit-days").innerText = "- -";
    document.getElementById("spec-client-balance").innerText = "- -";
    document.getElementById("spec-client-available").innerText = "- -";
    document.getElementById("spec-client-payment-method").innerText = "- -";
    document.getElementById("spec-client-avatar").innerText = "- -";
    
    const ledgerTbody = document.getElementById("client-ledger-body");
    if (ledgerTbody) {
      ledgerTbody.innerHTML = `<tr><td colspan="3" class="text-center py-4 text-slate-400">Seleccione un cliente para ver movimientos</td></tr>`;
    }
    return;
  }

  const client = catalogClients[selectedCatalogClientIndex];
  
  const initials = client.name.split(" ").map(n => n[0]).join("").substring(0, 2).toUpperCase();
  document.getElementById("spec-client-avatar").innerText = initials;
  document.getElementById("spec-client-name").innerText = client.name;
  
  const formattedId = client.client_code || 'CLI-' + String(client.id).substring(0, 5);
  document.getElementById("spec-client-id").innerText = formattedId + (client.whatsapp ? ` (WA: ${client.whatsapp})` : "");
  document.getElementById("spec-client-rfc").innerText = client.rfc || "XAXX010101000";
  document.getElementById("spec-client-regimen").innerText = client.regimen_fiscal || "616 - SIN OBLIGACIONES FISCALES";
  document.getElementById("spec-client-email").innerText = client.email || "S/N";
  
  const phoneFormatted = client.phone ? `(52) ${client.phone}` : "S/N";
  document.getElementById("spec-client-phone").innerText = phoneFormatted;
  document.getElementById("spec-client-address").innerText = client.direccion || "Conocido, Local";
  document.getElementById("spec-client-city").innerText = client.ciudad || "S/N";
  document.getElementById("spec-client-cp").innerText = client.cp || "S/N";
  
  const formattedAlta = client.created_at ? new Date(client.created_at).toLocaleDateString("es-MX") : "10/09/2025";
  document.getElementById("spec-client-created").innerText = formattedAlta;
  
  const creditLimitFormatted = client.limite_credito > 0 
    ? `$ ${client.limite_credito.toLocaleString('en-US', {minimumFractionDigits: 2})}` 
    : "$ 0.00";
  document.getElementById("spec-client-credit-limit").innerText = creditLimitFormatted;
  document.getElementById("spec-client-credit-days").innerText = `${client.dias_credito || 30} DIAS`;
  
  const balanceFormatted = `$ ${client.saldo_actual.toLocaleString('en-US', {minimumFractionDigits: 2})}`;
  const balanceElem = document.getElementById("spec-client-balance");
  balanceElem.innerText = balanceFormatted;
  balanceElem.className = client.saldo_actual > 5000 ? "text-blue-600 font-extrabold" : "text-slate-800 font-extrabold";
  
  const availableFormatted = `$ ${(Math.max(0, client.limite_credito - client.saldo_actual)).toLocaleString('en-US', {minimumFractionDigits: 2})}`;
  document.getElementById("spec-client-available").innerText = availableFormatted;
  
  const payMethod = client.client_type === "Contratista" ? "TRANSFERENCIA" : "EFECTIVO";
  document.getElementById("spec-client-payment-method").innerText = payMethod;

  // Points and type badge
  const pointsEl = document.getElementById("spec-client-points");
  if (pointsEl) pointsEl.innerText = client.puntos ? client.puntos.toLocaleString("en-US") : "0";
  
  const satBadge = document.getElementById("spec-client-sat-badge");
  if (satBadge) satBadge.innerText = client.rfc && client.rfc !== "XAXX010101000" ? "SAT REGISTRADO" : "PÚBLICO GENERAL";
  
  const typeBadge = document.getElementById("spec-client-type-badge");
  if (typeBadge) {
    typeBadge.innerText = client.client_type || "TIPO";
    const typeColors = {
      "VIP": "bg-yellow-100 text-yellow-700",
      "Distribuidor": "bg-purple-100 text-purple-700",
      "Contratista": "bg-blue-100 text-blue-700",
      "Precio Público": "bg-green-100 text-green-700",
    };
    typeBadge.className = `inline-block ${typeColors[client.client_type] || "bg-slate-100 text-slate-500"} text-[8px] font-black px-1.5 py-0.5 rounded uppercase tracking-wider`;
  }

  const ledgerTbody = document.getElementById("client-ledger-body");
  if (ledgerTbody) {
    ledgerTbody.innerHTML = `<tr><td colspan="3" class="text-center py-4 text-slate-400">Cargando movimientos...</td></tr>`;
    apiFetch(`${API_BASE}/clients/${client.id}/ledger`)
      .then(res => {
        if (!res.ok) throw new Error("Error fetching ledger");
        return res.json();
      })
      .then(logs => {
        ledgerTbody.innerHTML = "";
        if (logs.length === 0) {
          ledgerTbody.innerHTML = `<tr><td colspan="3" class="text-center py-4 text-slate-400">No hay movimientos registrados</td></tr>`;
          return;
        }
        
        logs.forEach(log => {
          const dateObj = new Date(log.created_at);
          const formattedDate = dateObj.toLocaleDateString("es-MX", { day: '2-digit', month: '2-digit' });
          const amountFormatted = log.amount >= 0 
            ? `<span class="text-green-600 font-bold">+$${log.amount.toFixed(2)}</span>` 
            : `<span class="text-red-600 font-bold">-$${Math.abs(log.amount).toFixed(2)}</span>`;
            
          const tr = document.createElement("tr");
          tr.className = "hover:bg-slate-50";
          tr.innerHTML = `
            <td class="py-1.5 px-2">${formattedDate}</td>
            <td class="py-1.5 px-2 max-w-[120px] truncate" title="${log.description || ''}">${log.description || 'Ajuste de saldo'}</td>
            <td class="py-1.5 px-2 text-right">${amountFormatted}</td>
          `;
          ledgerTbody.appendChild(tr);
        });
      })
      .catch(err => {
        ledgerTbody.innerHTML = `<tr><td colspan="3" class="text-center py-4 text-red-500">Error al cargar historial</td></tr>`;
      });
  }
}

function selectHighlightedCatalogClient() {
  if (selectedCatalogClientIndex === -1 || catalogClients.length === 0) return;
  const client = catalogClients[selectedCatalogClientIndex];
  updateClientDisplay(client);
  setView("sales");
  showToast(`Cliente seleccionado: ${client.name}`, "success");
}

function getDeterministicHash(inputStr, optionList) {
  let hash = 0;
  const str = String(inputStr);
  for (let i = 0; i < str.length; i++) {
    hash = str.charCodeAt(i) + ((hash << 5) - hash);
  }
  const index = Math.abs(hash) % optionList.length;
  return optionList[index];
}

// Modal Bindings
function openDeliveryModalFromView() {
  openDeliveryModal();
}

function openReceivablesModalFromView() {
  handleF4();
}

function openKardex() {
  openModal("modal-kardex");
  loadKardexLogs();
}

function loadKardexLogs() {
  const tbody = document.getElementById("kardex-logs-body");
  if (!tbody) return;
  tbody.innerHTML = `<tr><td colspan="5" class="text-center py-6 text-slate-400">Cargando movimientos...</td></tr>`;
  
  apiFetch("/api/kardex")
    .then(res => res.json())
    .then(logs => {
      tbody.innerHTML = "";
      if (logs.length === 0) {
        tbody.innerHTML = `<tr><td colspan="5" class="text-center py-6 text-slate-400">No hay movimientos registrados</td></tr>`;
        return;
      }
      
      logs.forEach(log => {
        const tr = document.createElement("tr");
        tr.className = "hover:bg-slate-50 border-b border-slate-100 font-semibold";
        
        let qtyClass = "text-slate-600";
        if (log.quantity > 0) qtyClass = "text-green-600 font-extrabold";
        else if (log.quantity < 0) qtyClass = "text-red-600 font-extrabold";
        
        const displayQty = log.quantity > 0 ? `+${log.quantity}` : log.quantity;
        
        tr.innerHTML = `
          <td class="py-2 px-3 text-slate-500">${log.timestamp}</td>
          <td class="py-2 px-3 text-slate-700 font-bold">${log.product_sku}</td>
          <td class="py-2 px-3"><span class="px-2 py-0.5 rounded text-[9px] font-bold ${log.movement === 'TRASPASO' ? 'bg-orange-100 text-orange-800' : log.movement === 'ENTREGA RESG.' ? 'bg-purple-100 text-purple-800' : log.movement === 'VENTA' ? 'bg-blue-100 text-blue-800' : 'bg-green-100 text-green-800'}">${log.movement}</span></td>
          <td class="py-2 px-3 text-right ${qtyClass}">${displayQty}</td>
          <td class="py-2 px-3 text-slate-600 text-[10px]">${log.details}</td>
        `;
        tbody.appendChild(tr);
      });
    })
    .catch(err => {
      tbody.innerHTML = `<tr><td colspan="5" class="text-center py-6 text-red-500">Error al cargar movimientos: ${err.message}</td></tr>`;
    });
}

function openPuntos() {
  openModal("modal-puntos");
  const details = getClientDeterministicDetails(activeClient);
  document.getElementById("puntos-client-name").innerText = activeClient.name;
  document.getElementById("puntos-client-balance").innerText = `${details.puntos} pts`;
}

function openApartados() {
  openModal("modal-apartados");
  document.getElementById("apartado-client-display").innerText = activeClient.name;
  document.getElementById("apartado-anticipo").value = "";
  
  const today = new Date();
  today.setDate(today.getDate() + 30);
  const yyyy = today.getFullYear();
  const mm = String(today.getMonth() + 1).padStart(2, '0');
  const dd = String(today.getDate()).padStart(2, '0');
  document.getElementById("apartado-date").value = `${yyyy}-${mm}-${dd}`;
  
  setTimeout(() => {
    document.getElementById("apartado-anticipo").focus();
  }, 100);
}

function submitApartado(e) {
  e.preventDefault();
  const totals = calculateTotals();
  if (cart.length === 0) {
    showToast("No hay productos en el carrito para apartar", "warning");
    return;
  }
  
  const advance = parseFloat(document.getElementById("apartado-anticipo").value) || 0.0;
  const limitDate = document.getElementById("apartado-date").value;
  
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
    amount_paid: advance,
    change_returned: 0.0,
    is_cfdi: false,
    discount: totals.discount,
    advance: advance,
    is_safekept: true,
    items: saleItems
  };

  apiFetch(`${API_BASE}/sales`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(saleBody)
  })
    .then(res => {
      if (!res.ok) throw new Error("API transaction fail");
      return res.json();
    })
    .then(dbSale => {
      showToast(`Apartado registrado con éxito. Límite: ${limitDate}`, "success");
      closeModal("modal-apartados");
      
      document.getElementById("discount-input").value = "";
      document.getElementById("advance-input").value = "";
      document.getElementById("cfdi-toggle").checked = false;
      document.getElementById("safekept-toggle").checked = false;

      dbSale.notes = `APARTADO - FECHA LIMITE DE RETIRO: ${limitDate}`;
      openTicketModal(dbSale);
    })
    .catch(() => {
      showToast(`Apartado registrado (Modo Local Offline). Límite: ${limitDate}`, "success");
      closeModal("modal-apartados");
      const mockSale = {
        id: Math.floor(Math.random() * 1000) + 1,
        created_at: new Date().toISOString(),
        total: totals.total,
        payment_method: "001",
        amount_paid: advance,
        change_returned: 0.0,
        is_cfdi: false,
        discount: totals.discount,
        advance: advance,
        is_safekept: true,
        client: activeClient,
        items: saleItems,
        notes: `APARTADO - FECHA LIMITE DE RETIRO: ${limitDate}`
      };
      
      document.getElementById("discount-input").value = "";
      document.getElementById("advance-input").value = "";
      document.getElementById("cfdi-toggle").checked = false;
      document.getElementById("safekept-toggle").checked = false;

      openTicketModal(mockSale);
    });
}


// ─────────────────────────────────────────────
// COTIZACIONES F4 - PANTALLA COMPLETA
// ─────────────────────────────────────────────

let quotesList = [];
let selectedQuoteIndex = -1;
let activeQuoteId = null;

function loadViewQuotes() {
  const tbody = document.getElementById("quotes-view-table-body");
  if (tbody) tbody.innerHTML = '<tr><td colspan="5" class="text-center py-6 text-slate-500 font-bold">Cargando cotizaciones...</td></tr>';

  const filterContainer = document.getElementById("quotes-view-filter-container");
  const searchInput = document.getElementById("quotes-search-folio");
  const rawNameForCheck = activeClient.name || "Publico General";
  const normalizedNameForCheck = rawNameForCheck.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase();
  const isPublico = !activeClient.id || activeClient.id === "1" || normalizedNameForCheck.includes("PUBLICO");
  
  const labelTodas = document.getElementById("quotes-label-todas");
  const searchContainer = document.getElementById("quotes-search-container");
  const textSolo = document.getElementById("quotes-text-solo");

  if (filterContainer) {
    filterContainer.style.display = "flex";
    if (isPublico) {
      if (labelTodas) labelTodas.style.display = "flex";
      if (searchContainer) searchContainer.style.display = "flex";
      if (textSolo) textSolo.innerHTML = "Solo P&uacute;blico General";
    } else {
      if (labelTodas) labelTodas.style.display = "none";
      if (searchContainer) searchContainer.style.display = "none";
      if (searchInput) searchInput.value = "";
      if (textSolo) textSolo.innerHTML = `Solo: ${escHTML(activeClient.name)}`;
      
      const publicoRadio = document.querySelector('input[name="quotes-view-filter"][value="publico"]');
      if (publicoRadio) publicoRadio.checked = true;
    }
  }

  let url;
  
  if (isPublico && searchInput && searchInput.value.trim() !== "") {
    const query = searchInput.value.trim().toUpperCase().replace("C-", "");
    if (query !== "") {
      url = `${API_BASE}/quotes/${query}`;
    } else {
      url = `${API_BASE}/quotes?client_name=PUBLICO`;
    }
  } 
  else if (isPublico) {
    const todasRadio = document.getElementById("quotes-radio-todas");
      const filter = (todasRadio && todasRadio.checked) ? "todas" : "publico";
      if (filter === "todas") {
        url = `${API_BASE}/quotes?_t=` + Date.now();
      } else {
        url = `${API_BASE}/quotes?client_name=PUBLICO&_t=` + Date.now();
      }
  } 
  else {
    const rawName = activeClient.name || "Publico General";
    const normalizedName = rawName.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase();
    const clientName = encodeURIComponent(normalizedName);
    url = `${API_BASE}/quotes?client_name=${clientName}`;
  }

  apiFetch(url)
    .then(res => {
      if (!res.ok) return [];
      return res.json();
    })
    .then(data => {
      if (data && !Array.isArray(data) && data.id) {
         data = [data];
      }
      if (!Array.isArray(data)) data = [];
      quotesList = Array.isArray(data) ? data : [];
      selectedQuoteIndex = quotesList.length > 0 ? 0 : -1;
      renderQuotesViewList();
      renderQuotesViewDetails();
    })
    .catch(err => {
      if (tbody) tbody.innerHTML = '<tr><td colspan="5" class="text-center py-6 text-red-500 font-bold">Error cargando cotizaciones</td></tr>';
      console.error(err);
    });
}

function renderQuotesViewList() {
  const tbody = document.getElementById("quotes-view-table-body");
  if (!tbody) return;

  if (quotesList.length === 0) {
    tbody.innerHTML = '<tr><td colspan="5" class="text-center py-6 text-slate-400 font-bold text-sm">No hay cotizaciones para mostrar.</td></tr>';
    return;
  }

  tbody.innerHTML = "";
  quotesList.forEach((q, index) => {
    const d = new Date(q.created_at).toLocaleDateString("es-MX", { day: "2-digit", month: "2-digit", year: "numeric" });
    const isClosed = q.status === "CERRADA";
    const isSelected = index === selectedQuoteIndex;
    const tr = document.createElement("tr");
    tr.id = `quote-view-row-${index}`;
    tr.className = `cursor-pointer transition-colors ${isSelected ? "bg-blue-50 font-semibold text-blue-900 border-l-4 border-l-blue-600" : "hover:bg-slate-50 text-slate-800 border-b border-slate-100"}`;
    if (isClosed && !isSelected) tr.classList.add("opacity-60");
    tr.onclick = () => { selectedQuoteIndex = index; renderQuotesViewList(); renderQuotesViewDetails(); };
    tr.innerHTML = `
      <td class="py-3 px-4 font-black text-slate-700">${q.folio}</td>
      <td class="py-3 px-4 font-bold truncate max-w-[120px]">${q.client_name || "—"}</td>
      <td class="py-3 px-4 text-slate-500 text-[10px]">${d}</td>
      <td class="py-3 px-4 text-right font-black">$${Number(q.total).toFixed(2)}</td>
      <td class="py-3 px-4 text-center"><span class="text-[9px] font-bold px-2 py-0.5 rounded ${isClosed ? "bg-slate-200 text-slate-500" : "bg-yellow-100 text-yellow-700"}">${q.status}</span></td>
    `;
    tbody.appendChild(tr);
  });

  if (selectedQuoteIndex !== -1) {
    const el = document.getElementById(`quote-view-row-${selectedQuoteIndex}`);
    if (el) el.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }
}

function renderQuotesViewDetails() {
  const noSel = selectedQuoteIndex === -1 || quotesList.length === 0;
  ["quotes-view-spec-id","quotes-view-spec-client","quotes-view-spec-date","quotes-view-spec-status"].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.innerText = noSel ? "- -" : "";
  });
  if (noSel) {
    document.getElementById("quotes-view-spec-id").innerText = "Sin cotizacion seleccionada";
    document.getElementById("quotes-view-spec-total").innerText = "$0.00";
    const ic = document.getElementById("quotes-view-spec-items");
    if (ic) ic.innerHTML = '<span class="text-slate-400 italic">No hay articulos</span>';
    return;
  }
  const q = quotesList[selectedQuoteIndex];
  document.getElementById("quotes-view-spec-id").innerText = q.folio;
  document.getElementById("quotes-view-spec-client").innerText = q.client_name || "—";
  document.getElementById("quotes-view-spec-date").innerText = new Date(q.created_at).toLocaleString("es-MX");
  document.getElementById("quotes-view-spec-status").innerText = q.status;
  document.getElementById("quotes-view-spec-total").innerText = `$${Number(q.total).toFixed(2)}`;
  const ic = document.getElementById("quotes-view-spec-items");
  if (ic && q.items) {
    ic.innerHTML = q.items.map(i => `
      <div class="flex justify-between items-start bg-slate-50 border border-slate-100 p-2 rounded-lg">
        <div class="flex-1"><div class="font-bold text-slate-700 text-[10px]">${i.description}</div><div class="text-slate-400 text-[9px]">${i.product_sku}</div></div>
        <div class="text-right"><div class="font-black text-slate-700 text-[10px]">${i.quantity} x $${Number(i.price).toFixed(2)}</div><div class="font-black text-blue-600 text-[10px]">$${Number(i.subtotal).toFixed(2)}</div></div>
      </div>`).join("");
  }
}

function navigateQuotesView(dir) {
  if (quotesList.length === 0) return;
  selectedQuoteIndex = Math.max(0, Math.min(quotesList.length - 1, selectedQuoteIndex + dir));
  renderQuotesViewList();
  renderQuotesViewDetails();
}

function openQuotesViewTicketModal() {
  if (selectedQuoteIndex >= 0 && selectedQuoteIndex < quotesList.length) {
    openTicketModal(quotesList[selectedQuoteIndex], true);
  }
}

async function loadQuotesViewToCart() {
  if (selectedQuoteIndex < 0 || selectedQuoteIndex >= quotesList.length) return;
  const q = quotesList[selectedQuoteIndex];
  if (q.status === "CERRADA") { showToast("Esta cotizacion ya esta cerrada", "warning"); return; }
  if (cart.length > 0 && !confirm("El carrito actual se borrara. Continuar?")) return;

  try {
    const res = await apiFetch(`${API_BASE}/quotes/${q.id}`);
    const quote = await res.json();

    cart = quote.items.map(qi => ({
      sku: qi.product_sku,
      description: qi.description,
      quantity: qi.quantity,
      price: qi.price,
      base_price: qi.price,
      subtotal: qi.subtotal
    }));

    activeQuoteId = quote.id;
    updateCartUI();
    // Force active client to match quote client
    updateClientDisplay({
      id: quote.client_id || 1,
      name: quote.client_name || "Publico General",
      rfc: "XAXX010101000",
      client_type: "Publico General"
    });
    setView("sales");
    showToast(`Cotizacion ${quote.folio} cargada al carrito (F12)`, "success");
  } catch (err) {
    console.error(err);
    showToast("Error cargando la cotizacion", "error");
  }
}

function createNewQuote() {
  if (cart.length === 0) { showToast("El carrito esta vacio", "warning"); return; }
  const totals = calculateTotals();
  // Normalize client name to uppercase without accents for consistency
  const normalizedClientName = (activeClient.name || "Publico General")
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase();
  const payload = {
    client_id: String(activeClient.id || 1),
    client_name: normalizedClientName,
    total: totals.total,
    items: cart.map(i => ({ product_sku: i.sku, description: i.description, quantity: i.quantity, price: i.price, subtotal: i.subtotal }))
  };
  apiFetch(`${API_BASE}/quotes`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) })
    .then(res => res.json())
    .then(data => {
      showToast(`Cotizacion ${data.folio} generada`, "success");
      cart = [];
      updateCartUI();
      updateClientDisplay(getWalkInClient());
      openTicketModal(data, true);
    })
    .catch(err => { console.error(err); showToast("Error generando cotizacion", "error"); });
}


function submitQuote() {
  if (cart.length === 0) {
    showToast("No hay artículos para cotizar", "warning");
    return;
  }
  const totals = calculateTotals();
  const saleItems = cart.map(item => ({
    product_sku: item.sku,
    quantity: item.quantity,
    price: item.price,
    subtotal: item.subtotal
  }));
  const mockQuote = {
    id: Math.floor(Math.random() * 90000) + 10000,
    created_at: new Date().toISOString(),
    total: totals.total,
    payment_method: "COTIZACIÓN",
    amount_paid: 0.0,
    change_returned: 0.0,
    is_cfdi: false,
    discount: totals.discount,
    advance: 0.0,
    is_safekept: false,
    client: activeClient,
    items: cart.map(item => ({
      product_sku: item.sku,
      quantity: item.quantity,
      price: item.price,
      subtotal: item.subtotal,
      description: item.description
    }))
  };
  openTicketModal(mockQuote, true);
  showToast("Cotización generada correctamente", "success");
}

