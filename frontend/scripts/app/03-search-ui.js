/* 03-search-ui.js — Modal utilities, autocomplete engine, scanner/input logic
   Extraido de app_v66.js (fase 3, modularizacion post-auditoria 2026-08-03)
   Lineas originales: 1880-2123 */
// --- MODAL UTILITIES ---
function openModal(modalId) {
  if (activeModal) {
    closeModal(activeModal);
  }
  const modal = document.getElementById(modalId);
  if (modal) {
    modal.classList.remove("hidden");
    activeModal = modalId;
    selectedSearchIndex = -1;
    selectedSearchList = [];
    selectedSearchType = modalId === "modal-articles" ? "product" : "client";
    KeyboardLayerManager.push("modal"); // Block app-level shortcuts while modal is open

    // Focus inner inputs
    if (modalId === "modal-articles") {
      setTimeout(() => document.getElementById("article-search-input").focus(), 50);
    } else if (modalId === "modal-clients") {
      setTimeout(() => document.getElementById("client-search-input").focus(), 50);
    }
  }
}

function closeModal(modalId) {
  const modal = document.getElementById(modalId);
  if (modal) {
    modal.classList.add("hidden");
    activeModal = null;
    selectedSearchIndex = -1;
    selectedSearchList = [];
    selectedSearchType = "";
    KeyboardLayerManager.pop(); // Restore app-level shortcuts
    focusActiveViewInput();
  }
}

// Toggle between client search and client creation
function toggleClientTab(tab) {
  const searchTab = document.getElementById("tab-client-search");
  const addTab = document.getElementById("tab-client-add");
  const searchSec = document.getElementById("client-search-section");
  const addForm = document.getElementById("client-add-form");
  const footer = document.getElementById("client-instructions-footer");

  if (tab === "search") {
    searchTab.className = "border-b-2 border-blue-500 text-blue-600 px-4 py-2 -mb-px";
    addTab.className = "border-b-2 border-transparent text-slate-400 px-4 py-2 -mb-px hover:text-slate-600";
    searchSec.classList.remove("hidden");
    addForm.classList.add("hidden");
    footer.classList.remove("hidden");
    document.getElementById("client-search-input").focus();
  } else {
    searchTab.className = "border-b-2 border-transparent text-slate-400 px-4 py-2 -mb-px hover:text-slate-600";
    addTab.className = "border-b-2 border-blue-500 text-blue-600 px-4 py-2 -mb-px";
    searchSec.classList.add("hidden");
    addForm.classList.remove("hidden");
    footer.classList.add("hidden");
    document.getElementById("new-client-name").focus();
  }
}

// --- AUTOCOMPLETE ENGINE (MÓDULO 1) ---

function handleAutocompleteSearch(query) {
  const trimmed = query.trim();
  if (!trimmed) {
    hideAutocomplete();
    return;
  }

  // If input contains * separator (quantity prefix), look up the SKU part
  const asterIndex = trimmed.indexOf("*");
  const searchQuery = asterIndex !== -1 ? trimmed.substring(asterIndex + 1).trim() : trimmed;

  if (searchQuery.length < 1) {
    hideAutocomplete();
    return;
  }

  apiFetch(`${API_BASE}/products/search?q=${encodeURIComponent(searchQuery)}`)
    .then(res => res.json())
    .then(products => {
      autocompleteItems = Array.isArray(products) ? products : [];
      autocompleteSelectedIndex = autocompleteItems.length > 0 ? 0 : -1;
      autocompleteNavigated = false; // Reset navigation flag
      renderAutocompleteDropdown();
    })
    .catch(() => {
      hideAutocomplete();
    });
}

function renderAutocompleteDropdown() {
  const dropdown = document.getElementById("autocomplete-dropdown");
  dropdown.innerHTML = "";

  if (autocompleteItems.length === 0) {
    dropdown.classList.add("hidden");
    return;
  }

  dropdown.classList.remove("hidden");

  autocompleteItems.forEach((product, idx) => {
    const itemDiv = document.createElement("div");
    const isSelected = idx === autocompleteSelectedIndex;
    const targetScale = (typeof temporaryPriceScale !== "undefined" && temporaryPriceScale) ? temporaryPriceScale : (typeof activePriceScale !== "undefined" ? activePriceScale : "PRECIO DE LISTA");
    const resolvedPrice = typeof getProductPriceForClient === "function"
      ? getProductPriceForClient(product, targetScale)
      : parseFloat(product.price || 0);
    const meta = (product.meta_data && typeof product.meta_data === "object") ? product.meta_data : {};
    const marca = String(meta.marca || meta.brand || "").trim().toUpperCase();
    const barcode = String(product.barcode || "").trim();
    const brandPart = (marca && marca !== "GENÉRICO" && marca !== "GENERICO") ? ` | Marca: ${marca}` : "";
    const barcodePart = (barcode && barcode.toUpperCase() !== String(product.sku || "").toUpperCase()) ? ` | Cód: ${barcode}` : "";
    const stockVal = parseFloat(product.stock || 0);
    const availableSubs = (stockVal <= 0 && typeof window.getAvailablePosSubstitutesForProduct === "function")
      ? window.getAvailablePosSubstitutesForProduct(product)
      : [];
    const subBtnsHtml = availableSubs.length > 0
      ? `<div class="mt-1 flex flex-wrap gap-1">${availableSubs.map((sub) =>
          `<button type="button" data-ac-sub-sku="${String(sub.sku || "").replace(/"/g, "&quot;")}" class="px-2 py-0.5 rounded bg-emerald-600 hover:bg-emerald-700 text-white text-[9px] font-black shadow-sm transition-colors">🔄 Sustituto con Stock: ${sub.sku}${sub.stock !== null ? ` (${Number(sub.stock).toFixed(2)})` : ""} — Cargar en 1 clic</button>`
        ).join("")}</div>`
      : "";
    
    itemDiv.className = `px-4 py-2.5 cursor-pointer text-xs font-bold font-montserrat flex items-center justify-between border-b border-slate-100 ${
      isSelected ? "bg-blue-50 text-blue-600" : "text-slate-700 hover:bg-slate-50"
    }`;
    
    itemDiv.innerHTML = `
      <div class="flex flex-col">
        <span class="font-extrabold text-slate-900">${product.name || product.description}</span>
        <span class="text-[9px] ${stockVal <= 0 ? "text-amber-600 font-bold" : "text-slate-400 font-medium"}">SKU: ${product.sku}${barcodePart}${brandPart} | Stock: ${product.stock}</span>
        ${subBtnsHtml}
      </div>
      <span class="font-black text-slate-800">$${resolvedPrice.toFixed(2)}</span>
    `;

    itemDiv.querySelectorAll("[data-ac-sub-sku]").forEach((btn) => {
      btn.addEventListener("click", (ev) => {
        ev.stopPropagation();
        const subSku = btn.getAttribute("data-ac-sub-sku");
        const val = document.getElementById("product-input")?.value || "";
        const parsed = typeof parseInput === "function" ? parseInput(val) : null;
        const qty = parsed ? parsed.quantity : 1;
        if (typeof window.loadSubstituteIntoPosCart === "function") {
          window.loadSubstituteIntoPosCart(subSku, null, qty);
        }
        const inputEl = document.getElementById("product-input");
        if (inputEl) inputEl.value = "";
        hideAutocomplete();
      });
    });

    itemDiv.addEventListener("click", () => {
      autocompleteSelectedIndex = idx;
      selectAutocompleteItem();
    });

    dropdown.appendChild(itemDiv);
  });
}

function renderAutocompleteHighlight() {
  const dropdown = document.getElementById("autocomplete-dropdown");
  const divs = dropdown.querySelectorAll("div.cursor-pointer");
  divs.forEach((div, idx) => {
    if (idx === autocompleteSelectedIndex) {
      div.className = "px-4 py-2.5 cursor-pointer text-xs font-bold font-montserrat flex items-center justify-between border-b border-slate-100 bg-blue-50 text-blue-600";
      div.scrollIntoView({ block: 'nearest' });
    } else {
      div.className = "px-4 py-2.5 cursor-pointer text-xs font-bold font-montserrat flex items-center justify-between border-b border-slate-100 text-slate-700 hover:bg-slate-50";
    }
  });
}

function selectAutocompleteItem() {
  if (autocompleteSelectedIndex === -1 || autocompleteItems.length === 0) return;
  const product = autocompleteItems[autocompleteSelectedIndex];

  // Parse input quantity prefix if any
  const val = document.getElementById("product-input").value;
  const parsed = parseInput(val);
  const qty = parsed ? parsed.quantity : 1;

  addToCart(product, qty);
  showToast(`Añadido: ${product.description} x${qty}`, "success");
  
  // Reset input and hide
  document.getElementById("product-input").value = "";
  hideAutocomplete();
}

function hideAutocomplete() {
  const input = document.getElementById("product-input");
  if (input && input.value.trim() !== "") {
    // Avoid closing or wiping dropdown if the user has already scanned/typed the next barcode quickly
    return;
  }
  const dropdown = document.getElementById("autocomplete-dropdown");
  if (dropdown) dropdown.classList.add("hidden");
  autocompleteItems = [];
  autocompleteSelectedIndex = -1;
  focusProductInput();
}


// --- SCANNER / INPUT LOGIC ---

function parseInput(val) {
  const trimmed = val.trim();
  if (!trimmed) return null;

  const asterIndex = trimmed.indexOf("*");
  if (asterIndex !== -1) {
    const qtyStr = trimmed.substring(0, asterIndex);
    const skuStr = trimmed.substring(asterIndex + 1);
    const quantity = parseFloat(qtyStr);
    
    return {
      quantity: isNaN(quantity) ? 1 : quantity,
      sku: skuStr.trim()
    };
  }

  return {
    quantity: 1,
    sku: trimmed
  };
}

function processMainInput(value) {
  const parsed = parseInput(value);
  if (!parsed) return;

  // Search product details by SKU, barcode, or sales_code
  apiFetch(`${API_BASE}/products/${encodeURIComponent(parsed.sku)}`)
    .then(res => {
      if (res.status === 404) {
        throw new Error("Product not found");
      }
      return res.json();
    })
    .then(product => {
      addToCart(product, parsed.quantity);
      showToast(`Añadido: ${product.description} x${parsed.quantity}`, "success");
      hideAutocomplete();
      focusProductInput();
    })
    .catch(err => {
      // Check if autocomplete dropdown is visible and has items
      const dropdown = document.getElementById("autocomplete-dropdown");
      const isDropdownVisible = dropdown && !dropdown.classList.contains("hidden");
      if (isDropdownVisible && autocompleteItems.length > 0 && autocompleteSelectedIndex !== -1) {
        const product = autocompleteItems[autocompleteSelectedIndex];
        addToCart(product, parsed.quantity);
        showToast(`Añadido: ${product.description} x${parsed.quantity}`, "success");
        hideAutocomplete();
        focusProductInput();
        return;
      }
      // Fallback: search by name/brand/reference/weight (e.g. "CEMEX", "50 K", "CEMETO GALLO CEMEX 50 K")
      apiFetch(`${API_BASE}/products/search?q=${encodeURIComponent(parsed.sku)}`)
        .then(r => r.ok ? r.json() : [])
        .then(products => {
          if (Array.isArray(products) && products.length === 1) {
            const product = products[0];
            addToCart(product, parsed.quantity);
            showToast(`Añadido: ${product.description} x${parsed.quantity}`, "success");
            hideAutocomplete();
            focusProductInput();
          } else if (Array.isArray(products) && products.length > 1) {
            const input = document.getElementById("product-input");
            if (input) input.value = value;
            autocompleteItems = products;
            autocompleteSelectedIndex = 0;
            autocompleteNavigated = false;
            renderAutocompleteDropdown();
            focusProductInput();
          } else {
            throw new Error("No search matches");
          }
        })
        .catch(() => {
          hideAutocomplete();
          const input = document.getElementById("product-input");
          if (input) {
            input.value = "";
            input.placeholder = "SKU ERROR";
            input.classList.add("border-red-500", "ring-2", "ring-red-300", "text-red-600", "placeholder-red-500", "bg-red-50");
            input.classList.remove("border-slate-200", "bg-slate-50");
            setTimeout(() => {
              input.placeholder = "Buscar producto...";
              input.classList.remove("border-red-500", "ring-2", "ring-red-300", "text-red-600", "placeholder-red-500", "bg-red-50");
              input.classList.add("border-slate-200", "bg-slate-50");
            }, 333);
          }
          focusProductInput();
        });
    });
}
