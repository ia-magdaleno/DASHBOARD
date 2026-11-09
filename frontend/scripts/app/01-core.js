/* 01-core.js — Bootstrap: apiFetch, guard de auth, estado global (cart, activeClient), focus helpers
   Extraido de app_v66.js (fase 3, modularizacion post-auditoria 2026-08-03)
   Lineas originales: 1-601 */

function escHTML(s) {
  if (s == null) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
window.escHTML = escHTML;

// --- MULTI-TENANT JWT INTERCEPTOR ---
async function apiFetch(url, options = {}) {
  const token = localStorage.getItem('calebsys_token');
  if (!options.headers) {
    options.headers = {};
  }
  
  // We only add Content-Type if it's not a FormData payload
  if (!(options.body instanceof FormData) && !options.headers['Content-Type'] && options.method && options.method !== 'GET') {
    options.headers['Content-Type'] = 'application/json';
  }

  if (token) {
    options.headers['Authorization'] = `Bearer ${token}`;
  }

  const response = await fetch(url, options);
  
  if (response.status === 401) {
    console.error("JWT Expired or Invalid. Redirecting to login...");
    window.location.href = '/login';
  }
  return response;
}
// ------------------------------------

// Redirect to login if no auth present.
// Acepta AMBAS formas de auth:
//  - calebsys_token: JWT legacy (usuarios antiguos, guardado en localStorage)
//  - calebsys_role:  cookie-based auth (usuarios nuevos desde RH — httpOnly cookie,
//                    login solo guarda role/user en localStorage, no el token)
const _calebsysAuth = localStorage.getItem('calebsys_token')
                   || localStorage.getItem('calebsys_role');
if (!_calebsysAuth && window.location.pathname !== '/login') {
    window.location.href = '/login';
}

// CALEBSYS - Point of Sale (POS) Client Logic

// Global state
let cart = [];
let activeClient = { id: 1, name: "Público General", rfc: "XAXX010101000", client_type: "Público General" };

try {
  const savedCart = localStorage.getItem("pos_cart");
  if (savedCart && savedCart !== "undefined") cart = JSON.parse(savedCart);
  
  const savedClient = localStorage.getItem("pos_active_client");
  if (savedClient && savedClient !== "undefined") activeClient = JSON.parse(savedClient);
} catch (e) {
  console.warn("Error loading state from localStorage, using defaults.");
}

// FORCE UI UPDATE ON LOAD TO PREVENT DESYNC
window.addEventListener('DOMContentLoaded', () => {
  updateClientDisplay(activeClient);
});

// ── _getEmpresaIdFromToken: lee empresa del JWT sin librería externa ────
// Solo para aislar la caché visual/offline. No se usa como autorización backend.
function _getEmpresaIdFromToken() {
  try {
    const tok = localStorage.getItem('calebsys_token');
    if (!tok) return null;
    const payload = JSON.parse(atob(tok.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
    return payload.empresa || null;
  } catch { return null; }
}

// ── SYNC PUBLICO EN GENERAL: cargar / crear desde DB al iniciar POS ────
// 1. Busca RFC XAXX010101000 en el tenant actual.
// 2. Si no existe, lo crea automáticamente vía POST /api/clients.
// 3. Guarda el UUID real en caché aislada por empresa (pos_walk_in_db_id:<empresa>).
window.addEventListener('DOMContentLoaded', async () => {
  try {
    if (!activeClient || activeClient.id !== 1) return;
    const _posEmpresaId = _getEmpresaIdFromToken();
    const _cacheKey     = _posEmpresaId ? `pos_walk_in_db_id:${_posEmpresaId}` : 'pos_walk_in_db_id';

    // Paso 1: buscar en el tenant autenticado (apiFetch agrega Bearer token)
    const res = await apiFetch('/api/clients?q=XAXX010101000');
    if (!res.ok) return;
    const list  = await res.json();
    const items = Array.isArray(list) ? list : (list.items || list.clients || list.data || []);
    let dbClient = items.find(c =>
      (c.rfc  || '').toUpperCase() === 'XAXX010101000' ||
      (c.name || '').toUpperCase() === 'PUBLICO EN GENERAL'
    );

    // Paso 2: si no existe en el tenant, crearlo automáticamente
    if (!dbClient) {
      const createRes = await apiFetch('/api/clients', {
        method: 'POST',
        body: JSON.stringify({
          name:           'PUBLICO EN GENERAL',
          rfc:            'XAXX010101000',
          client_type:    'Público General',
          regimen_fiscal: '616',
          limite_credito: 0
        })
      });
      if (createRes.ok) {
        dbClient = await createRes.json();
      }
    }

    // Paso 3: sincronizar activeClient y persistir caché aislada por tenant
    if (dbClient) {
      localStorage.setItem(_cacheKey, dbClient.id);
      activeClient = Object.assign({}, dbClient, {
        id:          1,              // sentinel walk-in (nunca se envía al backend)
        is_walk_in:  true,
        name:        (dbClient.name || 'PUBLICO EN GENERAL').toUpperCase(),
        rfc:         dbClient.rfc || 'XAXX010101000',
        _db_id:      dbClient.id,
        _empresa_id: _posEmpresaId
      });
      updateClientDisplay(activeClient);
    }
  } catch (e) {
    console.warn('[CALEBSYS POS] sync PUBLICO EN GENERAL falló:', e.message);
  }
});

// ── getWalkInClient: objeto PUBLICO EN GENERAL con _db_id real ───────
// Lee caché aislada por empresa para evitar mezclar tenants.
// Si el caché pertenece a otra empresa, devuelve _db_id: null.
function getWalkInClient() {
  const empresaId = _getEmpresaIdFromToken();
  const cacheKey  = empresaId ? `pos_walk_in_db_id:${empresaId}` : 'pos_walk_in_db_id';
  const dbId      = localStorage.getItem(cacheKey) || null;
  return {
    id:          1,
    is_walk_in:  true,
    name:       'PUBLICO EN GENERAL',
    rfc:        'XAXX010101000',
    client_type: 'Publico General',
    price_list:  'PUBLICO',
    _db_id:      dbId,
    _empresa_id: empresaId
  };
}

// ── persistedClientId: id real para payload de ventas ────────────────
// Nunca envía el sentinel 1 al backend. Usa _db_id del cliente activo
// o el caché aislado por tenant. Devuelve null si no hay UUID válido.
function persistedClientId() {
  if (activeClient.id !== 1) return activeClient.id;
  const empresaId = _getEmpresaIdFromToken();
  const cacheKey  = empresaId ? `pos_walk_in_db_id:${empresaId}` : 'pos_walk_in_db_id';
  return activeClient._db_id || localStorage.getItem(cacheKey) || null;
}
let activePriceScale = localStorage.getItem("pos_active_price_scale") || "Público General";
let temporaryPriceScale = localStorage.getItem("pos_temp_price_scale") || null;
let activePaymentMethod = "001"; // Default to "001" (Efectivo)
let activeModal = null; // 'modal-articles', 'modal-clients', 'modal-ticket'
let selectedSearchIndex = -1;
let selectedSearchList = [];
let selectedSearchType = ""; // 'product' or 'client'
let selectedCartIndex = -1;

// Additional POS module states
let returnSale = null;
let returnItems = [];
let selectedReturnIndex = -1;

let receivableDebts = [];
let selectedReceivableIndex = -1;

let salesHistory = [];
let selectedHistoryIndex = -1;

let onlineOrders = [];
let selectedOnlineOrderIndex = -1;

let deliveryDetails = null; // Stores { street, colony, phone, date, notes }
let activeTicketIsQuote = false;

// Return Mode State (F2 Devolucion)
let isReturnModeActive = false;

// Price Scale Override State
let pendingScaleSelection = null;
let confirmScaleSelectedIndex = 0;
let inlineEditingIndex = -1;

// Parked Sales State (Cuentas en la Nube)
let parkedSales = [];
let selectedParkedIndex = -1;
let multiselectParkedIds = new Set();
let activeBranchFilter = "MATRIZ";
let activeSellerFilter = "";
let parkedSearchQuery = "";
let isParkedMergeMode = false;
let activeReturnRefundMethod = "cash";

// Multi-view State management
let currentView = "sales"; // "sales", "catalog", "clients"
let catalogProducts = [];
let selectedCatalogIndex = -1;
let selectedCatalogSKUs = new Set();
let catalogClients = [];
let selectedCatalogClientIndex = -1;

// Autocomplete dropdown state
let autocompleteItems = [];
let autocompleteSelectedIndex = -1;
let autocompleteNavigated = false;

const API_BASE = "/api";

// ─────────────────────────────────────────────────────────────
// GUARDIÁN GLOBAL DE MAYÚSCULAS
// Convierte automáticamente a MAYÚSCULAS todo texto ingresado,
// preservando la posición del cursor y respetando excepciones.
// ─────────────────────────────────────────────────────────────
document.addEventListener('input', function(e) {
  const target = e.target;

  if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') {
    const type = target.type ? target.type.toLowerCase() : '';
    const id   = target.id   ? target.id.toLowerCase()   : '';
    const name = target.name ? target.name.toLowerCase() : '';

    const isEmail    = type === 'email'    || id.includes('email')    || name.includes('email')
                     || id.includes('correo') || name.includes('correo');
    const isSocial   = id.includes('social') || id.includes('redes')
                     || id.includes('facebook') || id.includes('instagram')
                     || name.includes('social');
    const isPassword = type === 'password';
    const isNumber = type === 'number';

    if (!isEmail && !isSocial && !isPassword && !isNumber) {
      try {
        const start = target.selectionStart;
        const end   = target.selectionEnd;

        target.value = target.value.toUpperCase();

        if (target.setSelectionRange) {
          target.setSelectionRange(start, end);
        }
      } catch (err) {
        // Fallback for inputs that somehow don't support selection
        target.value = target.value.toUpperCase();
      }
    }
  }
});

// Initialize UI elements and listeners
document.addEventListener("DOMContentLoaded", () => {
  // Focus main product input on load
  focusProductInput();

  // Keep focus on active view input unless clicking another input/button/select or active modals/checkout fields
  document.addEventListener("click", (e) => {
    const activeInputId = getActiveInputSelector();
    if (activeInputId && e.target.id === activeInputId) {
      return; // Already clicking the active input
    }
    
    const isTypingElement = (e.target.tagName === "INPUT" && ["text", "number", "date", "email", "search"].includes(e.target.type)) ||
                            e.target.tagName === "TEXTAREA" ||
                            e.target.tagName === "SELECT";
                            
    let bypassRefocus = false;
    
    // Bypass refocus if clicked inside the currently active modal (any element, not just typing inputs)
    if (activeModal) {
      const modalEl = document.getElementById(activeModal);
      if (modalEl && modalEl.contains(e.target)) {
        bypassRefocus = true;
      }
    }
    
    // Bypass refocus if clicked inside the price scale toggle or dropdown
    const changeScaleBtn = document.getElementById("btn-change-scale");
    const priceScaleDropdown = document.getElementById("price-scale-dropdown");
    if ((changeScaleBtn && changeScaleBtn.contains(e.target)) || (priceScaleDropdown && priceScaleDropdown.contains(e.target))) {
      bypassRefocus = true;
    }
    
    // Bypass refocus for typing inputs outside active modals
    if (!bypassRefocus && isTypingElement) {
      const allowedIds = ["discount-input", "advance-input", "cash-received-input", "client-quick-search-cobro"];
      if (allowedIds.includes(e.target.id)) {
        bypassRefocus = true;
      }
    }
    
    if (!bypassRefocus) {
      setTimeout(() => {
        focusActiveViewInput();
      }, 50);
    }
  });

  // Handle keys and input in main search bar (Omnidirectional Search)
  const productInput = document.getElementById("product-input");
  
  productInput.addEventListener("input", (e) => {
    handleAutocompleteSearch(e.target.value);
  });

  productInput.addEventListener("keydown", (e) => {
    // Dropdown key navigation overrides
    const dropdown = document.getElementById("autocomplete-dropdown");
    const isDropdownVisible = !dropdown.classList.contains("hidden");

    if (isDropdownVisible && autocompleteItems.length > 0) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        autocompleteSelectedIndex = (autocompleteSelectedIndex + 1) % autocompleteItems.length;
        autocompleteNavigated = true;
        renderAutocompleteHighlight();
        return;
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        autocompleteSelectedIndex = (autocompleteSelectedIndex - 1 + autocompleteItems.length) % autocompleteItems.length;
        autocompleteNavigated = true;
        renderAutocompleteHighlight();
        return;
      } else if (e.key === "Enter") {
        e.preventDefault();
        if (autocompleteNavigated && autocompleteSelectedIndex !== -1) {
          selectAutocompleteItem();
        } else {
          // Standard scanned sku or typed enter - checks exact SKU first, then falls back to dropdown
          processMainInput(e.target.value);
          e.target.value = "";
        }
        return;
      } else if (e.key === "Escape") {
        e.preventDefault();
        e.target.value = "";
        hideAutocomplete();
        return;
      }
    } else {
      // Standard search bar enter or escape
      if (e.key === "Enter") {
        e.preventDefault();
        processMainInput(e.target.value);
        e.target.value = "";
      } else if (e.key === "Escape") {
        e.preventDefault();
        e.target.value = "";
        hideAutocomplete();
        if (cart.length === 0) {
          updateClientDisplay(getWalkInClient());
        }
      }
    }
  });

  // Handle search inputs in modals
  const articleSearch = document.getElementById("article-search-input");
  articleSearch.addEventListener("input", (e) => {
    performProductSearch(e.target.value);
  });
  articleSearch.addEventListener("keydown", handleSearchNavigation);

  const clientSearch = document.getElementById("client-search-input");
  clientSearch.addEventListener("input", (e) => {
    performClientSearch(e.target.value);
  });
  clientSearch.addEventListener("keydown", handleSearchNavigation);

  // Inline Product Catalog search and navigation
  const catalogSearch = document.getElementById("catalog-search-input");
  if (catalogSearch) {
    catalogSearch.addEventListener("input", (e) => {
      performCatalogSearch(e.target.value);
    });
    catalogSearch.addEventListener("keydown", (e) => {
      if (e.key === "ArrowDown" || e.key === "ArrowUp" || e.key === "Enter") {
        e.preventDefault();
        e.stopPropagation();
        if (e.key === "ArrowDown") navigateCatalog(1);
        else if (e.key === "ArrowUp") navigateCatalog(-1);
        else if (e.key === "Enter") addHighlightedCatalogProduct();
      }
    });
  }

  // Inline Client Catalog search and navigation
  const clientsSearch = document.getElementById("clients-search-input");
  if (clientsSearch) {
  // Debounce timer for live search (fires 300ms after user stops typing)
  let _clientSearchDebounce = null;
  clientsSearch.addEventListener("input", (e) => {
    clearTimeout(_clientSearchDebounce);
    _clientSearchDebounce = setTimeout(() => {
      performCatalogClientSearch(e.target.value);
    }, 300);
  });
    clientsSearch.addEventListener("keydown", (e) => {
      if (e.key === "ArrowDown" || e.key === "ArrowUp" || e.key === "Enter") {
        e.preventDefault();
        e.stopPropagation();
        if (e.key === "ArrowDown") {
          navigateCatalogClients(1);
          // Transfer focus to table container so global spacebar hotkey works
          clientsSearch.blur();
          const tableContainer = document.getElementById("clients-table-container");
          if (tableContainer) tableContainer.focus();
        }
        else if (e.key === "ArrowUp") navigateCatalogClients(-1);
        else if (e.key === "Enter") selectHighlightedCatalogClient();
      }
      // Note: Spacebar is purposely NOT intercepted here so users can type spaces in names.
      // If focus is transferred to the table container, the global keydown listener
      // will handle Spacebar to open the edit modal.
    });
  }

  // D-02: Campo quick-search de cliente en panel cobro
  const cobroClientSearch = document.getElementById("client-quick-search-cobro");
  if (cobroClientSearch) {
    let _cobroDebounce = null;
    cobroClientSearch.addEventListener("input", (e) => {
      clearTimeout(_cobroDebounce);
      _cobroDebounce = setTimeout(() => {
        const q = e.target.value.trim();
        if (q.length < 2) return;
        // Pre-poblar el modal de clientes y abrirlo con el query
        const modalInput = document.getElementById("client-search-input");
        if (modalInput) {
          modalInput.value = q;
          performClientSearch(q);
        }
        selectedSearchType = "client";
        openModal("modal-clients");
      }, 350);
    });
    cobroClientSearch.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        e.preventDefault();
        cobroClientSearch.value = activeClient ? activeClient.name : "";
        focusProductInput();
      }
      if (e.key === "Enter") {
        e.preventDefault();
        const q = cobroClientSearch.value.trim();
        if (q.length >= 2) {
          const modalInput = document.getElementById("client-search-input");
          if (modalInput) {
            modalInput.value = q;
            performClientSearch(q);
          }
          selectedSearchType = "client";
          openModal("modal-clients");
        }
      }
    });
    // Restaurar nombre del cliente activo si el campo queda vacío al perder foco
    cobroClientSearch.addEventListener("blur", () => {
      if (!cobroClientSearch.value.trim()) {
        cobroClientSearch.value = activeClient ? activeClient.name : "";
      }
    });
  }

  // Handle Cash Received Input calculations
  const cashInput = document.getElementById("cash-received-input");
  cashInput.addEventListener("input", (e) => {
    calculateChange();
  });
  // GAP-2 fix (sesion 6): listener de ENTER->submitSale() removido de aqui.
  // Causaba doble submitSale() porque 06-pos-checkout.js::selectPaymentMethod('001')
  // ya agrega/limpia su propio listener (_cashEnterHandler) sobre este mismo input,
  // de forma correctamente scoped (solo mientras el metodo activo es efectivo).

  // Handle Discounts and Advances inputs
  const discountInput = document.getElementById("discount-input");
  const advanceInput = document.getElementById("advance-input");
  const cfdiToggle = document.getElementById("cfdi-toggle");
  
  discountInput.addEventListener("input", () => {
    updateCartUI();
  });
  discountInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      const advanceInput = document.getElementById("advance-input");
      if (advanceInput) {
        advanceInput.focus();
        advanceInput.select();
      }
    }
  });

  advanceInput.addEventListener("input", () => {
    calculateChange();
  });
  advanceInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      if (activePaymentMethod === "001") {
        const cashInput = document.getElementById("cash-received-input");
        if (cashInput) {
          cashInput.focus();
          cashInput.select();
        }
      } else {
        submitSale();
      }
    }
  });

  if (cfdiToggle) {
    cfdiToggle.addEventListener("change", (e) => {
      if (e.target.checked) {
        if (!validateRFC(activeClient.rfc)) {
          showToast("Error CFDI: El cliente seleccionado no cuenta con un RFC válido.", "error");
          e.target.checked = false;
        }
      }
    });
  }

  // Keydown listeners for the new modals inputs
  const returnSaleIdInput = document.getElementById("return-sale-id-input");
  if (returnSaleIdInput) {
    returnSaleIdInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        searchSaleForReturn();
      }
    });
  }

  const returnQtyInput = document.getElementById("return-quantity-input");
  if (returnQtyInput) {
    returnQtyInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        confirmReturn();
      }
    });
  }

  const paymentAmountInput = document.getElementById("payment-amount-input");
  if (paymentAmountInput) {
    paymentAmountInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        submitReceivablePayment();
      }
    });
  }

  const aiQueryInput = document.getElementById("ai-assistant-query");
  if (aiQueryInput) {
    aiQueryInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        sendAIQuery();
      }
    });
  }

  // Global Keyboard listener for POS Shortcuts
  window.addEventListener("keydown", handleGlobalShortcuts);

  // Set default payment method selections in layout
  selectPaymentMethod("001");

  // Setup form Enter-key transitions
  setupFormEnterTransition("delivery-details-form", ["delivery-street", "delivery-colony", "delivery-phone", "delivery-date", "delivery-notes"]);
  setupFormEnterTransition("transfer-form", ["transfer-warehouse", "transfer-product-input", "transfer-qty-input"]);

  // Update layout and details
  updateCartUI();
});

// --- FOCUS HELPER ---
function focusProductInput() {
  const input = document.getElementById("product-input");
  if (input) {
    setTimeout(() => {
      input.focus();
    }, 20);
  }
}

function getActiveInputSelector() {
  if (inlineEditingIndex !== -1) return "inline-qty-input";
  if (activeModal) {
    if (activeModal === "modal-articles") return "article-search-input";
    if (activeModal === "modal-clients") return "client-search-input";
    if (activeModal === "modal-returns") return "return-sale-id-input";
    if (activeModal === "modal-receivables") return "payment-amount-input";
    if (activeModal === "modal-apartados") return "apartado-anticipo";
    if (activeModal === "modal-delivery") return "delivery-street";
    if (activeModal === "modal-transfers") return "transfer-product-input";
    if (activeModal === "modal-ai-assistant") return "ai-assistant-query";
    return null;
  }
  if (currentView === "catalog") return "catalog-search-input";
  if (currentView === "clients") return "clients-search-input";
  return "product-input";
}

function focusActiveViewInput() {
  if (activeModal) {
    if (activeModal === "modal-articles") {
      const inp = document.getElementById("article-search-input");
      if (inp) inp.focus();
    } else if (activeModal === "modal-clients") {
      const inp = document.getElementById("client-search-input");
      if (inp) inp.focus();
    } else if (activeModal === "modal-returns") {
      const inp = document.getElementById("return-sale-id-input");
      if (inp) inp.focus();
    } else if (activeModal === "modal-receivables") {
      const inp = document.getElementById("payment-amount-input");
      if (inp) inp.focus();
    } else if (activeModal === "modal-apartados") {
      const inp = document.getElementById("apartado-anticipo");
      if (inp) inp.focus();
    } else if (activeModal === "modal-delivery") {
      const inp = document.getElementById("delivery-street");
      if (inp) inp.focus();
    } else if (activeModal === "modal-transfers") {
      const inp = document.getElementById("transfer-product-input");
      if (inp) inp.focus();
    } else if (activeModal === "modal-ai-assistant") {
      const inp = document.getElementById("ai-assistant-query");
      if (inp) inp.focus();
    }
    return;
  }
  
  if (currentView === "catalog") {
    const catalogInput = document.getElementById("catalog-search-input");
    if (catalogInput) catalogInput.focus();
  } else if (currentView === "clients") {
    const clientsInput = document.getElementById("clients-search-input");
    if (clientsInput) clientsInput.focus();
  } else {
    focusProductInput();
  }
}

/* ═══════════════════════════════════════════════════════════════
   FIX-1 / FIX-3 / FIX-4 — POS INIT PATCH
   Corre después de DOMContentLoaded para aplicar:
   • Pantalla completa (fullscreen toggle)
   • RBAC: bloqueo del panel de totales para Vendedor
   • Avatar de cajero con iniciales desde sesión real
   ═══════════════════════════════════════════════════════════════ */

// ── FIX-1: Fullscreen toggle POS ──────────────────────────────
window.togglePosFullscreen = function () {
  if (!document.fullscreenElement) {
    document.documentElement.requestFullscreen().catch(function (err) {
      console.warn('[POS] Fullscreen no disponible:', err.message);
    });
  } else {
    document.exitFullscreen();
  }
};

document.addEventListener('fullscreenchange', function () {
  const icon = document.getElementById('pos-fs-icon');
  const btn  = document.getElementById('pos-fullscreen-btn');
  if (!icon || !btn) return;
  if (document.fullscreenElement) {
    // Icono "compress"
    icon.innerHTML = '<path d="M5 16h3v3h2v-5H5v2zm3-8H5v2h5V5H8v3zm6 11h2v-3h3v-2h-5v5zm2-11V5h-2v5h5V8h-3z"/>';
    btn.title = 'Salir de pantalla completa';
  } else {
    // Icono "expand"
    icon.innerHTML = '<path d="M3 3h6v2H5v4H3V3zm12 0h6v6h-2V5h-4V3zM3 15h2v4h4v2H3v-6zm16 4h-4v2h6v-6h-2v4z"/>';
    btn.title = 'Pantalla completa';
  }
});

// ── FIX-3: RBAC POS cobro (quirúrgico) ────────────────────────
// REGLAS DEFINITIVAS (2026-08-20):
//   Vendedor / Mostrador
//     ✓ Ve totales (total, subtotal, IVA, artículos) — SIEMPRE VISIBLE
//     ✗ NO puede cobrar: #checkout-controls-section cubierto con overlay opaco
//       + disabled: #btn-registrar-venta, #btn-pausar-venta, #btn-f7-cobrar
//   Cajero
//     ✓ Ve y usa todo el panel de cobro
//     ✗ NO edita facturas registradas (modal-ticket solo lectura, ya implementado)
//   F2 Devolucion: bloqueado para cajero/vendedor/mostrador (doble guard: UI + backend)

// Roles que NO pueden usar los controles de cobro (solo ven el resumen)
const POS_ROLES_BLOQUEADOS_COBRO = [
  'vendedor_calle',
  'almacenista', 'comprador', 'transportista', 'auxiliar'
];
// F2 Devolución rápida: cualquier rol del POS puede ABRIR el modal.
// Vendedor / Cajero / Mostrador sólo pueden "Solicitar aprobación" (queda
// PENDIENTE y alerta a Gerente/Admin/Almacén); Admin/Gerente aprueban directo.
// El backend (/api/sales/{id}/cross-return) impone la regla real.
const POS_ROLES_BLOQUEADOS_DEVOLUCION = [];

function _posApplyRbac() {
  // ══════════════════════════════════════════════════════════════════
  // RBAC POS — REGLAS DEFINITIVAS (2026-08-20)
  //
  //  Vendedor / Mostrador
  //    ✓ Ve totales (total $, subtotal, IVA, artículos)  ← VISIBLE
  //    ✗ NO puede interactuar con controles de cobro      ← BLOQUEADO
  //      (métodos pago, descuento, anticipo, CFDI,
  //       efectivo recibido, REGISTRAR VENTA, PAUSAR, F7)
  //
  //  Cajero
  //    ✓ Ve y usa todo el panel de cobro                  ← VISIBLE
  //    ✗ NO puede editar facturas registradas (modal-ticket solo lectura — ya implementado)
  //
  //  Implementación:
  //    • Overlay opaco SOLO sobre #checkout-controls-section (no sobre totales)
  //    • Buttons #btn-registrar-venta, #btn-pausar-venta, #btn-f7-cobrar → disabled
  //    • F2 devolucion → bloqueado para cajero/vendedor/mostrador (guard backend también)
  // ══════════════════════════════════════════════════════════════════

  const role = (localStorage.getItem('calebsys_role') || '').toLowerCase().trim();

  // ── 1. RBAC F2: Devolucion ─────────────────────────────────────
  const btnF2 = document.getElementById('btn-f2-devolucion');
  if (btnF2) {
    if (POS_ROLES_BLOQUEADOS_DEVOLUCION.includes(role)) {
      btnF2.setAttribute('disabled', 'disabled');
      btnF2.title         = 'Sin permiso — requiere Gerente o Admin';
      btnF2.style.opacity = '0.4';
      btnF2.style.cursor  = 'not-allowed';
      btnF2.onclick = function(e) {
        e.preventDefault(); e.stopPropagation();
        if (typeof showToast === 'function') showToast('Devoluciones requieren autorización de Gerente o Admin', 'warning');
      };
    } else {
      btnF2.removeAttribute('disabled');
      btnF2.title         = 'Devoluciones (F2)';
      btnF2.style.opacity = '';
      btnF2.style.cursor  = '';
      // onclick se mantiene intacto (handleF2 en el HTML)
    }
  }

  // ── 2. Elementos con IDs ahora presentes en index.html ─────────
  const checkoutSection = document.getElementById('checkout-controls-section');
  const btnRegistrar    = document.getElementById('btn-registrar-venta');
  const btnPausar       = document.getElementById('btn-pausar-venta');
  const btnF7           = document.getElementById('btn-f7-cobrar');   // header

  // ── 3. Limpiar estado anterior (re-entrada segura) ──────────────
  const oldOverlay = document.getElementById('cobro-rbac-overlay');
  if (oldOverlay) oldOverlay.remove();

  // Helpers internos
  const _blockBtn = (btn, msg) => {
    if (!btn) return;
    btn.setAttribute('disabled', 'disabled');
    btn.style.opacity = '0.35';
    btn.style.cursor  = 'not-allowed';
    btn.onclick = function(e) {
      e.preventDefault(); e.stopPropagation();
      if (typeof showToast === 'function') showToast(msg, 'warning');
    };
  };
  const _restoreBtn = (btn, handler) => {
    if (!btn) return;
    btn.removeAttribute('disabled');
    btn.style.opacity = '';
    btn.style.cursor  = '';
    btn.title = '';
    if (handler) btn.onclick = handler;
  };

  // ── 4. Aplicar lógica por rol ───────────────────────────────────
  if (POS_ROLES_BLOQUEADOS_COBRO.includes(role)) {
    // ─ 4a. Overlay QUIRÚRGICO sobre la zona de controles de cobro ─
    //   (los totales quedan arriba, completamente visibles)
    if (checkoutSection) {
      checkoutSection.style.position = 'relative';
      const overlay = document.createElement('div');
      overlay.id = 'cobro-rbac-overlay';
      overlay.style.cssText = [
        'position:absolute',
        'inset:0',
        'background:rgba(15,23,42,0.88)',
        'border-radius:12px',
        'display:flex',
        'flex-direction:column',
        'align-items:center',
        'justify-content:center',
        'gap:8px',
        'z-index:10',
        'pointer-events:all',
        'user-select:none',
      ].join(';');
      overlay.innerHTML = [
        '<svg viewBox="0 0 24 24" style="width:28px;height:28px;fill:rgba(255,255,255,0.28)">',
        '<path d="M18 8h-1V6A5 5 0 0 0 7 6v2H6a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h12a2 2 0 0 0',
        ' 2-2V10a2 2 0 0 0-2-2zm-6 9a2 2 0 1 1 0-4 2 2 0 0 1 0 4zm3.1-9H8.9V6a3.1 3.1 0 0 1 6.2 0v2z"/>',
        '</svg>',
        '<div style="color:rgba(255,255,255,0.45);font-size:10px;font-weight:700;',
        'text-align:center;letter-spacing:.07em;text-transform:uppercase;line-height:1.8">',
        'Solo lectura<br>Cobro · requiere Cajero',
        '</div>',
      ].join('');
      checkoutSection.appendChild(overlay);
    }

    // ─ 4b. Bloquear botones de acción (panel inferior) ─────────
    _blockBtn(btnRegistrar, 'Solo el Cajero puede registrar ventas');
    _blockBtn(btnPausar,    'Solo el Cajero puede pausar / subir a nube');

    // ─ 4c. Bloquear F7 en el header ────────────────────────────
    if (btnF7) {
      btnF7.setAttribute('disabled', 'disabled');
      btnF7.style.opacity = '0.4';
      btnF7.style.cursor  = 'not-allowed';
      btnF7.title = 'Cobro requiere rol Cajero';
      btnF7.onclick = function(e) {
        e.preventDefault(); e.stopPropagation();
        if (typeof showToast === 'function') showToast('Solo el Cajero puede cobrar (F7)', 'warning');
      };
    }

  } else {
    // ─ 5. Restaurar: rol con permisos completos de cobro ──────────
    _restoreBtn(btnRegistrar, function() { submitSale(); });
    _restoreBtn(btnPausar,    function() { parkCurrentSale(); });
    _restoreBtn(btnF7,        function() { dispatchF7(); });
  }
}

// ── FIX-4: Avatar cajero con iniciales reales ─────────────────
function _posLoadUserSession() {
  const avatarEl  = document.getElementById('cashier-avatar-initials');
  const nameEl    = document.getElementById('cashier-name');
  const roleEl    = document.getElementById('cashier-role-label');
  // segundo header (ventas pausadas)
  const avatar2El = document.getElementById('cashier2-avatar-initials');
  const name2El   = document.getElementById('cashier2-name');
  const role2El   = document.getElementById('cashier2-role-label');

  // Leer desde localStorage (guardado en login/shell). 'calebsys_user' es el
  // que SÍ escribe login.js; el resto son alias opcionales.
  const storedName = localStorage.getItem('calebsys_display_name')
                  || localStorage.getItem('calebsys_username')
                  || localStorage.getItem('calebsys_user')
                  || '';
  const storedRole = localStorage.getItem('calebsys_role') || 'USUARIO';

  // Intentar decodificar JWT para obtener sub (username) si no hay nombre
  let displayName = storedName;
  if (!displayName) {
    try {
      const tok = localStorage.getItem('calebsys_token');
      if (tok) {
        const pl = JSON.parse(atob(tok.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
        displayName = pl.sub || pl.username || pl.name || '';
      }
    } catch (_) {}
  }

  // Nunca dejar el placeholder "ANTONIO M" del HTML — usar algo neutral.
  _posApplyUserIdentity(displayName || 'Usuario', storedRole);

  // Nombre "bonito" real desde el backend (nombre_completo) — asíncrono.
  try {
    apiFetch(`${API_BASE}/auth/me`).then(function (r) {
      return r && r.ok ? r.json() : null;
    }).then(function (u) {
      if (!u) return;
      const real = u.nombre_completo || u.name || u.username || u.email || '';
      const role = u.role || u.rol || storedRole;
      if (real) {
        try { localStorage.setItem('calebsys_display_name', real); } catch (_) {}
        _posApplyUserIdentity(real, role);
      }
    }).catch(function () { /* sin red — nos quedamos con lo local */ });
  } catch (_) {}
}

/* Escribe nombre + iniciales + rol en ambos headers del POS. */
function _posApplyUserIdentity(displayName, role) {
  const avatarEl  = document.getElementById('cashier-avatar-initials');
  const nameEl    = document.getElementById('cashier-name');
  const roleEl    = document.getElementById('cashier-role-label');
  const avatar2El = document.getElementById('cashier2-avatar-initials');
  const name2El   = document.getElementById('cashier2-name');
  const role2El   = document.getElementById('cashier2-role-label');

  const parts    = String(displayName || 'Usuario').trim().split(/\s+/).filter(Boolean);
  const initials = parts.length >= 2
    ? (parts[0][0] + parts[1][0]).toUpperCase()
    : String(displayName || 'US').slice(0, 2).toUpperCase();
  const upper = String(displayName || 'Usuario').toUpperCase();

  if (avatarEl)  avatarEl.textContent  = initials;
  if (nameEl)    nameEl.textContent    = upper;
  if (avatar2El) avatar2El.textContent = initials;
  if (name2El)   name2El.textContent   = upper;

  const roleUpper = String(role || 'USUARIO').toUpperCase();
  if (roleEl)  roleEl.textContent  = roleUpper;
  if (role2El) {
    const icon = role2El.querySelector('[data-lucide]');
    role2El.textContent = roleUpper + ' ';
    if (icon) role2El.appendChild(icon);
  }
}

// ── Arranque integrado ─────────────────────────────────────────
document.addEventListener('DOMContentLoaded', function () {
  _posLoadUserSession();
  _posApplyRbac();
  // P3: arrancar campana de notificaciones del POS
  if (typeof PosNotificationsInit === 'function') PosNotificationsInit();
  // E-01: reloj auto-check para Vendedor/Cajero/Mostrador (no pasan por /os)
  if (typeof _posTriggerRelojCheck === 'function') _posTriggerRelojCheck();
});
