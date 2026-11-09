/* 02-shortcuts.js — KeyboardLayerManager, handleGlobalShortcuts, F1-F12 actuators, config sistema, print/share flows
   Extraido de app_v66.js (fase 3, modularizacion post-auditoria 2026-08-03)
   Lineas originales: 602-1879 */

// ============================================================
// KEYBOARD LAYER MANAGER
// Manages keyboard shortcut priority without collisions.
// Layers (lowest to highest priority):
//   'app'   → POS shortcuts active (normal operation)
//   'modal' → A modal is open; only modal-specific keys fire
// Browser shortcuts (Ctrl+F5, Ctrl+R) ALWAYS pass through.
// ============================================================
const KeyboardLayerManager = {
  _layer: "app", // 'app' | 'modal'

  setLayer(layer) {
    this._layer = layer;
  },

  getLayer() {
    return this._layer;
  },

  // Must be called by openModal() / closeModal()
  push(layer) { this.setLayer(layer); },
  pop()       { this.setLayer("app"); },
};

// --- GLOBAL KEYBOARD SHORTCUTS HANDLER ---
function handleGlobalShortcuts(e) {
  if (!e.key) return;
  
  if (inlineEditingIndex !== -1) {
    return; // Inline editor owns all keys
  }

  // ── BROWSER SHORTCUTS — always pass through, no exceptions ──
  if ((e.key === "F5"  && e.ctrlKey)           ) return; // Ctrl+F5  → hard refresh
  if ((e.key === "F5"  && e.shiftKey)          ) return; // Shift+F5 → soft refresh
  // NOTA: Ctrl+R (reload) y F12 (DevTools) ya NO pasan automáticamente al navegador.
  // El POS intercepta Ctrl+R → handleCtrlR (Resguardo) y bloquea F12 (Ventas Online desactivado).

  const layer = KeyboardLayerManager.getLayer();

  // ── APP LAYER: intercept POS function keys ──
  const posKeys   = ["F1","F2","F3","F4","F5","F6","F7","F8","F9","F10","F11","F12","Escape","Delete","Insert"];
  const ctrlKeys  = ["a","r","c","u","d","t","i","f","1","2","3","4","5","6"]; // r=Resguardo, u=CuentasNube
  const isPosKey  = posKeys.includes(e.key);
  const isCtrlKey = e.ctrlKey && ctrlKeys.includes(e.key.toLowerCase());

  // ── BLOCK Ctrl+P (print) — always intercept, open price scale instead ──
  if (e.ctrlKey && e.key.toLowerCase() === "p") {
    e.preventDefault();
    e.stopPropagation();
    if (currentView === "sales" && !activeModal) {
      togglePriceScaleMenu();
    }
    return;
  }

  if (isPosKey || isCtrlKey) {
    // One final safety net: Ctrl+F5 must never be blocked
    if (e.key === "F5" && e.ctrlKey) return;

    // Prevent default browser behavior (e.g. F1 opening help, Ctrl+P opening print)
    e.preventDefault();
    e.stopPropagation();
  } else {
    // Block common browser shortcuts that break POS kiosk mode (Ctrl+N, Ctrl+W, etc)
    // NOTA: Ctrl+T y Ctrl+U se manejan a través de ctrlKeys arriba, NO aquí.
    if (e.ctrlKey && ["n", "w", "j", "h"].includes(e.key.toLowerCase())) {
      e.preventDefault();
      e.stopPropagation();
      return;
    }
  }

  // Arrow keys and spacebar — only when no dropdown is visible
    const dropdown = document.getElementById("autocomplete-dropdown");
    const isDropdownHidden = !dropdown || dropdown.classList.contains("hidden");

    if (isDropdownHidden) {
      if (!activeModal && e.key === "ArrowLeft") {
        if (currentView === "sales" && selectedCartIndex !== -1 && cart.length > 0) {
          e.preventDefault();
          inlineEditingIndex = selectedCartIndex;
          updateCartUI();
          return;
        }
      }
      // ── PRICE SCALE MENU: intercept arrows and Enter (only when no modal is open) ──
      if (priceScaleMenuOpen && !activeModal) {
        if (e.key === "ArrowUp")    { e.preventDefault(); navigatePriceScaleMenu(-1); return; }
        if (e.key === "ArrowDown")  { e.preventDefault(); navigatePriceScaleMenu(1);  return; }
        if (e.key === "Enter")      { e.preventDefault(); confirmPriceScaleSelection(); return; }
        if (e.key === "Escape" || (e.ctrlKey && e.key.toLowerCase() === "p")) {
          e.preventDefault(); closePriceScaleMenu(); return;
        }
        // Block everything else while menu is open
        e.preventDefault();
        return;
      }

      if (!activeModal && (e.key === "ArrowUp" || e.key === "ArrowDown")) {
        e.preventDefault();
        const dir = e.key === "ArrowUp" ? -1 : 1;
        if (currentView === "catalog")       navigateCatalog(dir);
        else if (currentView === "clients")  navigateCatalogClients(dir);
        else                                 navigateCart(dir);
      }
      if (!activeModal && e.key === "-") {
        if (e.target.id === "product-input") {
          if (e.target.value.length === 0) {
            e.preventDefault();
            if (currentView === "sales") removeSelectedCartRow();
          }
          // If length >= 1, let the browser type the dash normally.
        } else if (e.target.tagName !== "INPUT" && e.target.tagName !== "TEXTAREA") {
          e.preventDefault();
          if (currentView === "sales") removeSelectedCartRow();
        }
      }
      if (!activeModal && e.key === " " && e.target.tagName !== "INPUT" && e.target.tagName !== "TEXTAREA") {
        e.preventDefault();
        if (currentView === "catalog")      toggleCatalogSelect();
        else if (currentView === "sales")   openKardex();
        else if (currentView === "clients") openEditClientModal();
      }
    }
    
    // Si no es un atajo POS ni de Ctrl, ni una tecla especial permitida, salimos para dejar que el navegador o inputs escriban normalmente
    const allowedPassKeys = ["Enter", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", " "];
    if (!isPosKey && !isCtrlKey && !allowedPassKeys.includes(e.key)) {
      return;
    }


  // Handle active hotkey actions
  if (activeModal === "modal-ticket") {
    if (e.key === "Enter" || e.key === "Escape") {
      closeTicketModal();
      return;
    }
  }

  // Modals keyboard navigation overrides
  if (activeModal) {
    if (e.key === "Escape") {
      closeModal(activeModal);
      return;
    }
    
    if (activeModal === "modal-history") {
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        navigateHistory(e.key === "ArrowUp" ? -1 : 1);
        return;
      }
      if (e.key === "Enter") {
        e.preventDefault();
        selectHistoryItem();
        return;
      }
    }
    
    if (activeModal === "modal-receivables") {
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        navigateReceivables(e.key === "ArrowUp" ? -1 : 1);
        return;
      }
      if (e.key === "Enter") {
        e.preventDefault();
        selectReceivableItem();
        return;
      }
    }

    if (activeModal === "modal-returns") {
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        navigateReturns(e.key === "ArrowUp" ? -1 : 1);
        return;
      }
      if (e.key === "Enter") {
        e.preventDefault();
        selectReturnItem();
        return;
      }
    }

    if (activeModal === "modal-online-orders") {
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        navigateOnlineOrders(e.key === "ArrowUp" ? -1 : 1);
        return;
      }
      if (e.key === "Enter") {
        e.preventDefault();
        selectOnlineOrderItem();
        return;
      }
    }

    if (activeModal === "modal-confirm-scale") {
      if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
        e.preventDefault();
        confirmScaleSelectedIndex = (confirmScaleSelectedIndex - 1 + 3) % 3;
        renderConfirmScaleButtonsHighlight();
        return;
      }
      if (e.key === "ArrowRight" || e.key === "ArrowDown") {
        e.preventDefault();
        confirmScaleSelectedIndex = (confirmScaleSelectedIndex + 1) % 3;
        renderConfirmScaleButtonsHighlight();
        return;
      }
      if (e.key === "Enter") {
        e.preventDefault();
        if (confirmScaleSelectedIndex === 0) {
          applyPriceScaleAction("next");
        } else if (confirmScaleSelectedIndex === 1) {
          applyPriceScaleAction("all");
        } else if (confirmScaleSelectedIndex === 2) {
          closeModal("modal-confirm-scale");
        }
        return;
      }
    }

    if (activeModal === "modal-parked-sales") {
      if (e.key === "Escape" || e.key === "F3") {
        e.preventDefault();
        closeModal("modal-parked-sales");
        
          // Reset client to default if cart is empty
          if (cart.length === 0) {
            updateClientDisplay(getWalkInClient());
          }
          return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        navigateParkedSales(-1);
        return;
      }
      if (e.key === "ArrowDown") {
        e.preventDefault();
        navigateParkedSales(1);
        return;
      }
      if (e.key === " ") {
        e.preventDefault();
        toggleActiveParkedSelection();
        return;
      }
      if (e.key === "Enter") {
        e.preventDefault();
        if (document.activeElement && document.activeElement.id === "parked-comment-input") {
          addActiveParkedComment();
        } else if (document.activeElement && document.activeElement.id === "parked-search-filter") {
          document.activeElement.blur();
        } else {
          downloadActiveParked();
        }
        return;
      }
      if (e.key === "F1") {
        e.preventDefault();
        focusParkedSearch();
        return;
      }
        if (e.key === "F2") {
          e.preventDefault();
          toggleParkedMergeMode();
          return;
        }
      if (e.key === "F4") {
        e.preventDefault();
        renameSelectedParked();
        return;
      }
      if (e.key === "F6") {
        e.preventDefault();
        splitSelectedParked();
        return;
      }
      if (e.key === "F7") {
        e.preventDefault();
        deleteSelectedParked();
        return;
      }
      if (e.key === "F8") {
        e.preventDefault();
        transferSelectedParked();
        return;
      }
      return; // Block other keys inside parked sales modal
    }

    if (activeModal === "modal-parked-transfer-select") {
      if (e.key === "Escape") {
        e.preventDefault();
        closeModal("modal-parked-transfer-select");
        return;
      }
      if (e.key === "Enter") {
        e.preventDefault();
        confirmTransferSelectedParked();
        return;
      }
      return;
    }

    // Block other shortcuts if any modal is active
    return;
  }

  // View specific shortcut overrides
  if (currentView === "catalog") {
    if (e.key === "Escape" || e.key === "Insert") {
      // If the paquete modal is open, close it first
      const pkModal = document.getElementById("modal-armar-paquete");
      if (pkModal && !pkModal.classList.contains("hidden")) {
        closeArmarPaqueteModal();
        return;
      }
      setView("sales");
      return;
    }
    if (e.key === "F2") {
      e.preventDefault();
      handleCatalogKardex();
      return;
    }
    if (e.key === "F4") {
      e.preventDefault();
      openArmarPaqueteModal();
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      // If items are SELECTED (via SPACE), send all to cart
      if (selectedCatalogSKUs.size > 0) {
        addSelectedCatalogProductsToSale();
      } else {
        addHighlightedCatalogProduct();
      }
      return;
    }
  } else if (currentView === "quotes") {
    if (e.key === "Escape" || e.key === "F4") {
      e.preventDefault();
      setView("sales");
      return;
    }
    if (e.key === "ArrowDown") { e.preventDefault(); navigateQuotesView(1); return; }
    if (e.key === "ArrowUp")   { e.preventDefault(); navigateQuotesView(-1); return; }
    if (e.key === "Enter")     { e.preventDefault(); openQuotesViewTicketModal(); return; }
    if (e.key === "F9")       { e.preventDefault(); loadQuotesViewToCart(); return; }
  } else if (currentView === "clients") {
    if (e.key === "Escape" || e.key === "F1") {
      setView("sales");
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      selectHighlightedCatalogClient();
      return;
    }
    if (e.key === "Insert") {
      e.preventDefault();
      openNewClientModal();
      return;
    }
    if (e.key === "Delete") {
      e.preventDefault();
      deleteSelectedClientConfirm();
      return;
    }
    if (e.key === " " && document.activeElement.tagName !== "INPUT" && document.activeElement.tagName !== "TEXTAREA") {
      e.preventDefault();
      openEditClientModal();
      return;
    }
    if (e.key === "F3") {
      e.preventDefault();
      openClientPointsModal();
      return;
    }
    if (e.key === "F4") {
      e.preventDefault();
      openClientCxCModal();
      return;
    }
    if (e.key === "F5") {
      e.preventDefault();
      openClientApartadosModal();
      return;
    }
    if (e.key === "F6") {
      e.preventDefault();
      openClientContactarModal();
      return;
    }
    if (e.key === "F7") {
      e.preventDefault();
      openClientResguardosModal();
      return;
    }
    if (e.key === "F8") {
      e.preventDefault();
      openClientCotizacionesModal();
      return;
    }
    if (e.key === "F9") {
      e.preventDefault();
      dispatchF9();
      return;
    }
    if (e.key === "F10") {
      e.preventDefault();
      openClientHistorialModal();
      return;
    }
    if (e.key === "F12") {
      e.preventDefault();
      // Ventas Online desactivado temporalmente
      showToast("Ventas Online — Módulo próximamente disponible", "info");
      return;
    }
    // Barra espaciadora = EDITAR cliente seleccionado
    if (e.key === " ") {
      // Evitar disparar si el foco está en un input/textarea/button
      const tag = document.activeElement.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || tag === "BUTTON") return;
      e.preventDefault();
      openEditClientModal();
      return;
    }
    // INS = nuevo cliente, DEL = eliminar, ya los maneja el switch global abajo
  } else if (currentView === "sales") {
    // Atajos de mostrador definidos en el documento fundacional Magdaleno:
    // F4 = Cuentas por Cobrar, F5 = Apartados, F6 = Facturacion, F11 = Solicitar Mercancia
    if (e.key === "F4") {
      e.preventDefault();
      if (!activeClient || activeClient.id === 1) {
        showToast("Selecciona un cliente para consultar Cuentas por Cobrar", "warning");
      } else {
        openClientCxCModal(activeClient);
      }
      return;
    }
    if (e.key === "F5") {
      e.preventDefault();
      if (!activeClient || activeClient.id === 1) {
        showToast("Selecciona un cliente para ver sus Apartados", "warning");
      } else {
        openClientApartadosModal(activeClient);
      }
      return;
    }
    if (e.key === "F6") {
      e.preventDefault();
      handleCtrlF();
      return;
    }
    if (e.key === "F11") {
      e.preventDefault();
      handleCtrlT();
      return;
    }
    // F8 = Cotizaciones (vendedores) desde vista de ventas
    if (e.key === "F8") {
      e.preventDefault();
      if (currentView === "quotes") {
        setView("sales");
      } else {
        setView("quotes");
      }
      return;
    }
    // F9 = Cambio de usuario (global)
    if (e.key === "F9") {
      e.preventDefault();
      dispatchF9();
      return;
    }
  }

  // Intercept F-keys to prevent browser default behaviors (like F1 opening help)
  if (e.key.startsWith("F") && e.key !== "F5" && e.key !== "F11" && e.key !== "F12") {
    e.preventDefault();
  }

  switch(e.key) {
    case "Escape":
      if (currentView === "sales" && activeModal === null) {
        if (cart.length === 0) {
          // Carrito vacío: si venimos del OS, ESC regresa al OS.
          if (sessionStorage.getItem('calebsys_from_os') === '1') {
            window.location.href = '/os';
            break;
          }
          // Si hay cliente no-walkIn, restablecer a Público General.
          if (activeClient && activeClient.id != 1) {
            updateClientDisplay(getWalkInClient());
            showToast("Cliente restablecido a PUBLICO EN GENERAL", "info");
          }
        } else if (typeof exitCheckoutMode === "function") {
          // Esc con carrito activo = salir del modo cobro para volver a editar
          // el carrito (no descarta la venta; conserva carrito, cliente e inputs).
          exitCheckoutMode();
        }
      }
      break;
    case "F1":
      handleF1();
      break;
    case "F2":
      handleF2();
      break;
    case "F3":
      handleF3();
      break;
    case "F4":
      handleF4();
      break;
    case "F5":
      if (e.ctrlKey || e.shiftKey) return;
      handleF5();
      break;
    case "F6":
      handleF6();
      break;
    case "F7":
      handleF7();
      break;
    case "F8":
      handleF8();
      break;
    case "F9":
      dispatchF9();
      break;
    case "F10":
      handleF10();
      break;
    case "F11":
      handleF11();
      break;
    case "F12":
      handleF12();
      break;
    case "Delete":
      removeSelectedCartRow();
      break;
    case "Insert":
      toggleCatalogView();
      break;
    case "Home":
      handleF1(); // Alt for Chrome Help issue
      break;
  }

  // Alt combos
  if (e.altKey) {
    if (e.key.toLowerCase() === "c") {
      e.preventDefault();
      handleF1();
    }
  }

  // Ctrl combos
  if (e.ctrlKey) {
    switch(e.key.toLowerCase()) {
      case "a":
        handleCtrlA();
        break;
      case "r":
        handleCtrlR(); // Resguardo — Ctrl+R ya NO recarga el navegador
        break;
      case "u":
        handleCtrlU(); // Cuentas Nube — Ctrl+U ya NO abre "view-source:"
        break;
      case "c":
        handleCtrlC();
        break;
      case "f":
        handleCtrlF();
        break;
      case "d":
        handleCtrlD();
        break;
      case "t":
        handleCtrlT();
        break;
      case "i":
        // Asistente IA desactivado — Fase 4. Se intercepta para bloquear browser (view-source en algunos navegadores).
        e.preventDefault();
        showToast("Asistente IA — Disponible en Fase 4", "info");
        break;

      case "1":
        selectPaymentMethod("001");
        showToast("Efectivo (001) seleccionado", "info");
        break;
      case "2":
        selectPaymentMethod("002");
        showToast("Cheque (002) seleccionado", "info");
        break;
      case "3":
        selectPaymentMethod("003");
        showToast("Tarjeta Crédito (003) seleccionada", "info");
        break;
      case "4":
        selectPaymentMethod("004");
        showToast("Transferencia (004) seleccionada", "info");
        break;
      case "5":
        selectPaymentMethod("008"); // Débito
        showToast("Tarjeta Débito (008) seleccionada", "info");
        break;
      case "6":
        handleCtrlC(); // Crédito
        break;
    }
  }
}

// --- CONTROLLER FUNCTIONS (SHORTCUT ACTUATORS) ---

function handleF1() {
  toggleClientsView();
}

function handleF2() {
  if (typeof openF2DevolucionModal === "function") openF2DevolucionModal();
}

function handleF3() {
  if (cart.length > 0) {
    parkCurrentSale();
  } else {
    openParkedSalesModal();
  }
}

function handleF4() {
  if (activeModal !== null) return;
  if (currentView === "quotes") {
    setView("sales");
  } else {
    setView("quotes");
  }
}

function handleF5() {
  // F5 = Apartados / Resguardos — exclusivo Almacenista, Admin, Gerente
  const role = (localStorage.getItem('calebsys_role') || '').toLowerCase().trim();
  const rolesPermitidos = ['almacenista', 'almacen', 'almac\u00e9n', 'operador almacen', 'operador almac\u00e9n', 'cajero', 'operador caja', 'admin', 'administrador', 'administrador general', 'superadmin', 'due\u00f1o', 'dueno', 'owner', 'admin_sucursal', 'gerente', 'supervisor', 'vendedor_cajero', 'vendedor', 'operador ventas', 'mostrador', 'usuario', ''];
  if (!rolesPermitidos.includes(role)) {
    showToast('F5 Apartados — acceso exclusivo del Almacenista', 'warning');
    return;
  }
  dispatchF5();
}

function handleCtrlF() {
  const toggle = document.getElementById("cfdi-toggle");
  if (toggle) {
    if (!toggle.checked) {
      if (!validateRFC(activeClient.rfc)) {
        showToast("Error CFDI: El cliente seleccionado no cuenta con RFC válido.", "error");
        toggle.checked = false;
        return;
      }
    }
    toggle.checked = !toggle.checked;
    showToast(`Factura CFDI 4.0: ${toggle.checked ? 'SOLICITADA' : 'NO SOLICITADA'}`, "info");
  }
}

function handleF6() {
  openModal("modal-returns");
  document.getElementById("ret-search-folio")?.focus();
}

function handleF7() {
  // Fix C-02: F7 ya NO llama submitSale() directamente.
  // Abre el RIGHT PANEL de cobro para que el cajero confirme el método de pago.
  // submitSale() se ejecuta cuando el cajero presiona Enter en efectivo o el botón.

  // COBRAR / F7 → envía la factura a caja. SÓLO el cajero (admin = override).
  // A diferencia de Cuentas Nube / CTRL+U (cajero o vendedor), aquí el vendedor
  // NO cobra: sólo sube la venta a la nube para que el cajero la tome.
  const _rol = (localStorage.getItem('calebsys_role') || '').toLowerCase().trim();
  const _rolesCobro = [
    'cajero', 'operador caja', 'admin', 'administrador', 'administrador general',
    'superadmin', 'dueño', 'dueno', 'owner', 'admin_sucursal', 'gerente',
    'supervisor', 'vendedor_cajero', 'vendedor', 'operador ventas', 'mostrador', 'usuario', ''
  ];
  if (!_rolesCobro.includes(_rol)) {
    showToast('COBRAR (F7) es exclusivo de caja/mostrador. Usa Cuentas Nube (CTRL+U) para enviar la venta a caja.', 'warning');
    return;
  }

  if (typeof enterCheckoutMode === "function") {
    enterCheckoutMode();
  } else if (typeof cart !== "undefined" && cart.length > 0) {
    submitSale();   // fallback si enterCheckoutMode no está disponible
  } else {
    showToast("Agrega artículos al carrito antes de facturar (F7)", "warning");
  }
}

function handleF8() {
  // F8 = Cotizaciones (vendedores/admin). Configuración del sistema → ícono engranaje en sidebar.
  dispatchF8();
}

// ══════════════════════════════════════════════════════
//  SISTEMA — Tabs, Config, Save/Load (accesible desde sidebar / engranaje)
// ══════════════════════════════════════════════════════

function switchSisTab(n) {
  [1, 2, 3].forEach(i => {
    const tab  = document.getElementById(`sis-tab-${i}`);
    const btn  = document.getElementById(`tab-sis-${i}`);
    if (!tab || !btn) return;
    if (i === n) {
      tab.classList.remove("hidden");
      btn.classList.add("border-blue-600","text-blue-700","font-black");
      btn.classList.remove("border-transparent","text-slate-400","font-bold");
    } else {
      tab.classList.add("hidden");
      btn.classList.remove("border-blue-600","text-blue-700","font-black");
      btn.classList.add("border-transparent","text-slate-400","font-bold");
    }
  });
}

function saveSisConfig() {
  const cfg = {
    // Tab 1 — Negocio
    bizName    : document.getElementById("cfg-biz-name")?.value    || "",
    bizGiro    : document.getElementById("cfg-biz-giro")?.value    || "",
    bizRfc     : document.getElementById("cfg-biz-rfc")?.value     || "",
    bizPhone   : document.getElementById("cfg-biz-phone")?.value   || "",
    bizAddress : document.getElementById("cfg-biz-address")?.value || "",
    bizLogo    : window._tempBizLogo || "", // Base64 del logo
    ticketBlankLines: document.getElementById("cfg-ticket-blank-lines")?.value || "0",
    formato    : document.querySelector("input[name='cfg-formato']:checked")?.value || "ticket",
    quoteFooter: document.getElementById("cfg-quote-footer")?.value || "",
    // Tab 2 — Redes
    waNumber   : document.getElementById("cfg-wa-number")?.value   || "",
    fbUrl      : document.getElementById("cfg-fb-url")?.value      || "",
    email      : document.getElementById("cfg-email")?.value       || "",
    paypal     : document.getElementById("cfg-paypal")?.value      || "",
    mp         : document.getElementById("cfg-mp")?.value          || "",
    bancoNombre: document.getElementById("cfg-banco-nombre")?.value || "",
    bancoCuenta: document.getElementById("cfg-banco-cuenta")?.value || "",
    bancoTitular:document.getElementById("cfg-banco-titular")?.value|| "",
    bancoTarjeta:document.getElementById("cfg-banco-tarjeta")?.value|| "",
    // Tab 3 — Impresoras térmica
    termConn  : document.querySelector("input[name='cfg-term-conn']:checked")?.value || "usb",
    termPort  : document.getElementById("cfg-term-port")?.value    || "auto",
    termIp    : document.getElementById("cfg-term-ip")?.value      || "",
    termName  : document.getElementById("cfg-term-name")?.value    || "",
    termWidth : document.getElementById("cfg-term-width")?.value   || "80",
    termCopies: document.getElementById("cfg-term-copies")?.value  || "1",
    termCut   : document.getElementById("cfg-term-cut")?.value     || "full",
    termLogo  : document.getElementById("cfg-term-logo")?.checked  || false,
    termBarcode:document.getElementById("cfg-term-barcode")?.checked|| true,
    termBeep  : document.getElementById("cfg-term-beep")?.checked  || false,
    // Tab 3 — Impresoras carta
    cartaName  : document.getElementById("cfg-carta-name")?.value  || "",
    cartaSize  : document.getElementById("cfg-carta-size")?.value  || "letter",
    cartaCopies: document.getElementById("cfg-carta-copies")?.value|| "1",
    cartaOrient: document.getElementById("cfg-carta-orient")?.value|| "portrait",
    cartaMgTop : document.getElementById("cfg-carta-margin-top")?.value   || "15",
    cartaMgBot : document.getElementById("cfg-carta-margin-bottom")?.value|| "15",
    cartaMgLeft: document.getElementById("cfg-carta-margin-left")?.value  || "20",
    cartaMgRight:document.getElementById("cfg-carta-margin-right")?.value || "20",
    cartaLogo  : document.getElementById("cfg-carta-logo")?.checked || true,
    cartaFirma : document.getElementById("cfg-carta-firma")?.checked|| false,
    cartaDuplex: document.getElementById("cfg-carta-duplex")?.checked|| false,
    defaultPrinter: document.querySelector("input[name='cfg-default-printer']:checked")?.value || "termica",
  };
  localStorage.setItem("calebsys_config", JSON.stringify(cfg));
  showToast("✅ Configuración guardada correctamente", "success");
}

function loadSisConfig() {
  const raw = localStorage.getItem("calebsys_config");
  if (!raw) return;
  try {
    const c = JSON.parse(raw);
    const s = (id, val) => { const el = document.getElementById(id); if (el) el.value = val; };
    const b = (id, val) => { const el = document.getElementById(id); if (el) el.checked = val; };
    const r = (name, val) => { const el = document.querySelector(`input[name='${name}'][value='${val}']`); if (el) el.checked = true; };
    // Tab 1
    s("cfg-biz-name", c.bizName);   s("cfg-biz-giro", c.bizGiro);
    s("cfg-biz-rfc", c.bizRfc);     s("cfg-biz-phone", c.bizPhone);
    s("cfg-biz-address", c.bizAddress); r("cfg-formato", c.formato);
    s("cfg-quote-footer", c.quoteFooter);
    s("cfg-ticket-blank-lines", c.ticketBlankLines || "0");
    if (c.bizLogo) {
      window._tempBizLogo = c.bizLogo;
      const preview = document.getElementById("cfg-logo-preview");
      if (preview) {
        preview.style.backgroundImage = `url(${c.bizLogo})`;
        preview.innerHTML = ""; // Remove icon
      }
    }
    // Tab 2
    s("cfg-wa-number", c.waNumber); s("cfg-fb-url", c.fbUrl);
    s("cfg-email", c.email);        s("cfg-paypal", c.paypal);
    s("cfg-mp", c.mp);              s("cfg-banco-nombre", c.bancoNombre);
    s("cfg-banco-cuenta", c.bancoCuenta); s("cfg-banco-titular", c.bancoTitular);
    s("cfg-banco-tarjeta", c.bancoTarjeta);
    // Tab 3 térmica
    r("cfg-term-conn", c.termConn); s("cfg-term-port", c.termPort);
    s("cfg-term-ip", c.termIp);     s("cfg-term-name", c.termName);
    s("cfg-term-width", c.termWidth); s("cfg-term-copies", c.termCopies);
    s("cfg-term-cut", c.termCut);   b("cfg-term-logo", c.termLogo);
    b("cfg-term-barcode", c.termBarcode); b("cfg-term-beep", c.termBeep);
    // Tab 3 carta
    s("cfg-carta-name", c.cartaName); s("cfg-carta-size", c.cartaSize);
    s("cfg-carta-copies", c.cartaCopies); s("cfg-carta-orient", c.cartaOrient);
    s("cfg-carta-margin-top", c.cartaMgTop); s("cfg-carta-margin-bottom", c.cartaMgBot);
    s("cfg-carta-margin-left", c.cartaMgLeft); s("cfg-carta-margin-right", c.cartaMgRight);
    b("cfg-carta-logo", c.cartaLogo); b("cfg-carta-firma", c.cartaFirma);
    b("cfg-carta-duplex", c.cartaDuplex); r("cfg-default-printer", c.defaultPrinter);
  } catch(e) { console.warn("loadSisConfig error", e); }
}

function getSisConfig() {
  try { return JSON.parse(localStorage.getItem("calebsys_config") || "{}"); }
  catch(e) { return {}; }
}

// ── Manejo de Logo ──
function clearLogo() {
  window._tempBizLogo = "";
  const preview = document.getElementById("cfg-logo-preview");
  const input = document.getElementById("cfg-biz-logo-input");
  if (preview) {
    preview.style.backgroundImage = "none";
    preview.innerHTML = `<i data-lucide="image" class="w-6 h-6 text-slate-300"></i>`;
    if (window.lucide) lucide.createIcons();
  }
  if (input) input.value = "";
}

document.addEventListener("DOMContentLoaded", () => {
  const logoInput = document.getElementById("cfg-biz-logo-input");
  if (logoInput) {
    logoInput.addEventListener("change", function(e) {
      const file = e.target.files[0];
      if (!file) return;
      if (file.size > 1024 * 1024) {
        showToast("El logo debe pesar menos de 1MB", "error");
        logoInput.value = "";
        return;
      }
      const reader = new FileReader();
      reader.onload = function(evt) {
        window._tempBizLogo = evt.target.result;
        const preview = document.getElementById("cfg-logo-preview");
        if (preview) {
          preview.style.backgroundImage = `url(${evt.target.result})`;
          preview.innerHTML = "";
        }
      };
      reader.readAsDataURL(file);
    });
  }
});

// ── Páginas de prueba ──
function testPrintThermal() {
  const cfg = getSisConfig();
  const blankLines = parseInt(cfg.ticketBlankLines || "0");
  const spacing = "<br>".repeat(blankLines);
  const logoHtml = (cfg.termLogo && cfg.bizLogo) ? `<div class="c" style="margin-bottom:10px"><img src="${cfg.bizLogo}" style="max-width:60mm;max-height:30mm;filter:grayscale(100%) contrast(1.2)"></div>` : "";
  
  const w = window.open("", "PRUEBA_TERMICA", "width=360,height=600");
  w.document.write(`<!DOCTYPE html><html><head><meta charset="utf-8">
  <style>
    @page { margin:0; size:80mm auto; }
    body { font-family:'Courier New',monospace; font-size:10px; width:80mm; margin:0; padding:4mm; }
    .c { text-align:center; }
    .d { border-top:1px dashed #000; margin:4px 0; }
  </style></head><body>
  ${spacing}
  ${logoHtml}
  <div class="c"><b>${cfg.bizName || "MAGDALENO"}</b><br>${cfg.bizGiro || "MADERAS & MATERIALES"}<br>${cfg.bizAddress || ""}<br>TEL: ${cfg.bizPhone || ""}</div>
  <div class="d"></div>
  <div class="c"><b>*** PÁGINA DE PRUEBA ***</b><br>IMPRESORA TÉRMICA 80MM<br>CONEXIÓN: ${(cfg.termConn||"USB").toUpperCase()} | PUERTO: ${cfg.termPort||"AUTO"}<br>ANCHO: ${cfg.termWidth||"80"}mm | CORTE: ${cfg.termCut||"TOTAL"}</div>
  <div class="d"></div>
  <div class="c">CALEBSYS v2.0 ★ SISTEMA OPERATIVO<br>▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓<br>*000001*</div>
  </body></html>`);
  w.document.close(); w.focus();
  setTimeout(() => { w.print(); w.close(); }, 400);
}

function testPrintCarta() {
  const cfg = getSisConfig();
  const mt = cfg.cartaMgTop||15, mb = cfg.cartaMgBot||15, ml = cfg.cartaMgLeft||20, mr = cfg.cartaMgRight||20;
  const sz = cfg.cartaSize || "letter";
  const or = cfg.cartaOrient || "portrait";
  const w = window.open("", "PRUEBA_CARTA", "width=800,height=700");
  w.document.write(`<!DOCTYPE html><html><head><meta charset="utf-8">
  <style>
    @page { size:${sz} ${or}; margin:${mt}mm ${mr}mm ${mb}mm ${ml}mm; }
    body { font-family:Arial,sans-serif; font-size:12px; color:#000; }
    .header { border-bottom:3px solid #1e40af; padding-bottom:12px; margin-bottom:16px; display:flex; justify-content:space-between; align-items:flex-start; }
    .biz-name { font-size:22px; font-weight:900; color:#1e40af; }
    .biz-sub  { font-size:11px; color:#64748b; }
    .test-box { border:2px dashed #94a3b8; padding:20px; text-align:center; margin:30px 0; border-radius:8px; }
  </style></head><body>
  <div class="header">
    <div>
      <div class="biz-name">${cfg.bizName||"MAGDALENO"}</div>
      <div class="biz-sub">${cfg.bizGiro||"MADERAS & MATERIALES"}<br>${cfg.bizAddress||""}<br>TEL: ${cfg.bizPhone||""} | RFC: ${cfg.bizRfc||""}</div>
    </div>
    <div style="text-align:right;font-size:10px;color:#94a3b8">CALEBSYS v2.0<br>${new Date().toLocaleDateString()}</div>
  </div>
  <div class="test-box">
    <h2 style="margin:0 0 8px;color:#1e40af">★ PÁGINA DE PRUEBA — CARTA ${sz.toUpperCase()} ★</h2>
    <p>Impresora configurada: <b>${cfg.cartaName||"(Sin configurar)"}</b></p>
    <p>Tamaño: ${sz} | Orientación: ${or} | Copias: ${cfg.cartaCopies||1}</p>
    <p>Márgenes: ↑${mt}mm ↓${mb}mm ←${ml}mm →${mr}mm</p>
    <p>Membrete: ${cfg.cartaLogo?"Sí":"No"} | Firma: ${cfg.cartaFirma?"Sí":"No"} | Dúplex: ${cfg.cartaDuplex?"Sí":"No"}</p>
  </div>
  <p style="color:#94a3b8;font-size:10px;text-align:center">Si este documento se imprimió correctamente, la configuración es válida.</p>
  </body></html>`);
  w.document.close(); w.focus();
  setTimeout(() => { w.print(); w.close(); }, 400);
}

// ══════════════════════════════════════════════════════
//  FLUJO IMPRIMIR / ENVIAR (3 pasos)
// ══════════════════════════════════════════════════════

let _psFormat = "ticket"; // "ticket" | "carta"
let _psPago   = null;     // "paypal" | "ml" | "banco"

function openPrintShareFlow() {
  _psFormat = getSisConfig().formato || "ticket";
  _psPago   = null;
  document.querySelectorAll(".ps-pago-btn").forEach(b => b.classList.remove("ring-2","ring-amber-500"));
  const sel = document.getElementById("ps-pago-selected");
  if (sel) { sel.textContent = ""; sel.classList.add("hidden"); }
  psPaso1();
  document.getElementById("modal-print-share").classList.remove("hidden");
}

function closePrintShareFlow() {
  document.getElementById("modal-print-share").classList.add("hidden");
}

function psPaso1() {
  document.getElementById("ps-step-1").classList.remove("hidden");
  document.getElementById("ps-step-2").classList.add("hidden");
  document.getElementById("ps-step-3").classList.add("hidden");
  if (window.lucide) lucide.createIcons();
}

function psPaso2(formato) {
  if (formato) _psFormat = formato;
  document.getElementById("ps-step-1").classList.add("hidden");
  document.getElementById("ps-step-2").classList.remove("hidden");
  document.getElementById("ps-step-3").classList.add("hidden");
  
  const cartaOpts = document.getElementById("ps-carta-options");
  if (cartaOpts) {
    if (_psFormat === "carta") cartaOpts.classList.remove("hidden");
    else cartaOpts.classList.add("hidden");
  }

  if (window.lucide) lucide.createIcons();
}

function psPaso3() {
  document.getElementById("ps-step-1").classList.add("hidden");
  document.getElementById("ps-step-2").classList.add("hidden");
  document.getElementById("ps-step-3").classList.remove("hidden");
  if (window.lucide) lucide.createIcons();
}

function psImprimir() {
  closePrintShareFlow();
  if (_psFormat === "carta") {
    // Carta A4: usa la impresora de carta vía window.print con CSS A4
    const ticket = document.getElementById("ticket-80mm");
    if (!ticket) { window.print(); return; }
    const cfg = getSisConfig();
    const win = window.open("", "CARTA_PRINT", "width=800,height=700");
    win.document.write(buildCartaHTML(ticket, cfg));
    win.document.close(); win.focus();
    setTimeout(() => { win.print(); win.close(); }, 400);
  } else {
    // Ticket 80mm: usa el CSS de @media print directo
    window.print();
  }
}

function buildCartaHTML(ticketEl, cfg) {
  const mt = cfg.cartaMgTop||15, mb = cfg.cartaMgBot||15, ml = cfg.cartaMgLeft||20, mr = cfg.cartaMgRight||20;
  const showImages = document.getElementById("ps-carta-images")?.checked || false;
  const sale = window._currentTicketSale || {};
  const items = sale.items || [];
  
  const clientName  = (sale.client?.name || window.activeClient?.name || "PÚBLICO EN GENERAL").toUpperCase();
  const clientRfc   = (sale.client?.rfc || window.activeClient?.rfc || "XAXX010101000").toUpperCase();
  const clientPhone = sale.client?.phone || window.activeClient?.phone || "";
  const clientEmail = sale.client?.email || window.activeClient?.email || "";
  const clientAddr  = sale.client?.address || window.activeClient?.address || "";
  
  const folio = (sale.id || 0).toString().padStart(5,"0");
  const dateObj = sale.created_at ? new Date(sale.created_at) : new Date();
  const fDate = dateObj.toLocaleDateString("es-MX", {day:"2-digit",month:"2-digit",year:"numeric"});
  
  const logoHtml = (cfg.cartaLogo && cfg.bizLogo) ? `<img src="${cfg.bizLogo}" style="max-width:250px; max-height:100px; object-fit:contain;">` : `<h1 style="font-size:28px;color:#1e3a8a;margin:0;">${cfg.bizName||"EMPRESA"}</h1>`;

  let tableRows = items.map(item => {
    const desc = item.description || `PROD ${item.product_sku}`;
    const qty = Math.abs(item.quantity);
    const pu = (Math.abs(item.subtotal) / qty).toFixed(2);
    const imp = Math.abs(item.subtotal).toFixed(2);
    const imgCol = showImages ? `<td style="text-align:center"><img src="${item.image_url || ''}" style="width:40px;height:40px;object-fit:cover;border-radius:4px" onerror="this.style.display='none'"></td>` : "";
    
    return `
      <tr>
        <td style="text-align:center">${qty}</td>
        ${imgCol}
        <td>${item.product_sku}</td>
        <td>${desc}</td>
        <td style="text-align:right">$ ${pu}</td>
        <td style="text-align:right">$ ${imp}</td>
      </tr>
    `;
  }).join("");

  const absTotal = Math.abs(sale.total || 0);
  const subtotalNI = absTotal / 1.16;
  const iva = absTotal - subtotalNI;

  return `<!DOCTYPE html><html><head><meta charset="utf-8">
  <style>
    @page { size:${cfg.cartaSize||"letter"} ${cfg.cartaOrient||"portrait"}; margin:${mt}mm ${mr}mm ${mb}mm ${ml}mm; }
    body { font-family:'Segoe UI', Roboto, Helvetica, Arial, sans-serif; font-size:12px; color:#1e293b; margin:0; }
    .header { display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:20px; }
    .header-right { text-align:right; }
    .title { font-size:24px; font-weight:900; color:#1e3a8a; margin:0 0 5px 0; letter-spacing:1px; }
    .folio { font-size:18px; color:#0f172a; margin-bottom:10px; }
    .folio span { font-weight:900; color:#1e3a8a; }
    .info-grid { display:grid; grid-template-columns:auto 1fr; gap:4px 10px; font-size:11px; margin-top:5px; }
    .info-label { font-weight:bold; color:#475569; text-transform:uppercase; }
    .info-val { border-bottom:1px solid #cbd5e1; }
    
    .client-section { margin-bottom:20px; }
    .client-title { font-size:12px; font-weight:900; color:#1e3a8a; margin:0 0 5px 0; text-transform:uppercase; }
    
    table { width:100%; border-collapse:collapse; margin-bottom:20px; font-size:11px; }
    th { background:#1e3a8a; color:#fff; padding:8px; text-align:left; font-weight:bold; }
    td { padding:6px 8px; border:1px solid #e2e8f0; vertical-align:middle; }
    tr:nth-child(even) { background:#f8fafc; }
    
    .totals { width:250px; float:right; }
    .totals-row { display:flex; justify-content:space-between; padding:4px 8px; font-size:12px; font-weight:bold; }
    .totals-row.grand { background:#e2e8f0; font-size:14px; margin-top:4px; }
    
    .footer { clear:both; margin-top:40px; font-size:10px; color:#64748b; }
    .signatures { display:flex; justify-content:center; gap:100px; margin-top:60px; }
    .sig-line { width:200px; border-top:1px solid #000; text-align:center; padding-top:5px; font-size:10px; font-weight:bold; text-transform:uppercase; }
  </style></head><body>
  
  <div class="header">
    <div>${logoHtml}</div>
    <div class="header-right">
      <h1 class="title">COTIZACIÓN</h1>
      <div class="folio">FOLIO: <span>${folio}</span></div>
      <div class="info-grid" style="display:inline-grid; text-align:left;">
        <div class="info-label">FECHA:</div><div class="info-val">${fDate}</div>
        <div class="info-label">VIGENCIA:</div><div class="info-val">${cfg.quoteFooter || "15 DÍAS NATURALES"}</div>
      </div>
    </div>
  </div>

  <div class="client-section">
    <h2 class="client-title">DATOS DEL CLIENTE</h2>
    <div class="info-grid">
      <div class="info-label">RAZÓN SOCIAL:</div><div class="info-val">${clientName}</div>
      <div class="info-label">RFC:</div><div class="info-val">${clientRfc}</div>
      ${clientAddr ? `<div class="info-label">DOMICILIO:</div><div class="info-val">${clientAddr}</div>` : ""}
      ${clientPhone || clientEmail ? `<div class="info-label">CONTACTO:</div><div class="info-val">${clientPhone} &nbsp;&nbsp;&nbsp; ${clientEmail}</div>` : ""}
    </div>
  </div>

  <table>
    <thead>
      <tr>
        <th style="text-align:center;width:50px">Cant</th>
        ${showImages ? '<th style="text-align:center;width:50px">Img</th>' : ''}
        <th style="width:100px">Código</th>
        <th>Descripción</th>
        <th style="text-align:right;width:80px">P. Unit</th>
        <th style="text-align:right;width:90px">Importe</th>
      </tr>
    </thead>
    <tbody>
      ${tableRows}
    </tbody>
  </table>

  <div class="totals">
    ${sale.discount > 0 ? `<div class="totals-row"><span>Descuento:</span><span>- $ ${(sale.discount).toFixed(2)}</span></div>` : ""}
    <div class="totals-row"><span>Subtotal MXN:</span><span>$ ${subtotalNI.toFixed(2)}</span></div>
    <div class="totals-row"><span>I.V.A.:</span><span>$ ${iva.toFixed(2)}</span></div>
    <div class="totals-row grand"><span>TOTAL NETO MXN:</span><span>$ ${absTotal.toFixed(2)}</span></div>
  </div>

  <div class="footer">
    <p>Documento informativo, no tiene validez fiscal. Precios sujetos a cambios sin previo aviso.<br>
    Una vez aceptada la cotización, proceda a emitir la orden de compra o pago correspondiente.</p>
  </div>

  ${cfg.cartaFirma ? `
  <div class="signatures">
    <div class="sig-line">AUTORIZACIÓN CLIENTE (Firma)</div>
    <div class="sig-line">EJECUTIVO DE VENTAS</div>
  </div>
  ` : ""}

  </body></html>`;
}

// ── Construir mensaje con resumen del ticket ──
function _buildTicketSummary() {
  const el = document.getElementById("ticket-80mm");
  if (!el) return "";
  const folio   = el.querySelector(".t-flex .t-bold")?.textContent?.trim() || "#------";
  const total   = [...el.querySelectorAll(".t-flex.t-bold.t-large")].pop()?.querySelector("span:last-child")?.textContent?.trim() || "";
  const cliente = [...el.querySelectorAll("div")].find(d => d.textContent.startsWith("CLIENTE:"))?.textContent?.trim() || "";
  return `${cliente}\n${folio} | Total: ${total}`;
}

function _buildPayLink() {
  const cfg = getSisConfig();
  if (!_psPago) return "";
  if (_psPago === "paypal" && cfg.paypal) return `\n💳 Pagar con PayPal: ${cfg.paypal}`;
  if (_psPago === "ml"     && cfg.mp)     return `\n🛒 Pagar con MercadoPago: ${cfg.mp}`;
  if (_psPago === "banco") {
    return `\n🏦 Transferencia bancaria:\nBanco: ${cfg.bancoNombre||""}\nCuenta/CLABE: ${cfg.bancoCuenta||""}\nTitular: ${cfg.bancoTitular||""}\nTarjeta: ${cfg.bancoTarjeta||""}`;
  }
  return "";
}

function psEnviarWhatsApp() {
  const cfg = getSisConfig();
  const phone = cfg.waNumber || "";
  if (!phone) {
    showToast("⚠️ Configura tu número WhatsApp en F8 → Redes y Pagos", "warning");
    return;
  }
  const summary = _buildTicketSummary();
  const payLink = _buildPayLink();
  const bizName = cfg.bizName || "MAGDALENO";
  const msg = encodeURIComponent(
    `🛒 *COTIZACIÓN — ${bizName}*\n${summary}\n${payLink}\n\n_Generado por CALEBSYS v2.0_`
  );
  window.open(`https://wa.me/52${phone}?text=${msg}`, "_blank");
  closePrintShareFlow();
}

function psEnviarEmail() {
  const cfg = getSisConfig();
  const summary = _buildTicketSummary();
  const payLink = _buildPayLink();
  const bizName = cfg.bizName || "MAGDALENO";
  const clientEmail = activeClient?.email || "";
  const subject = encodeURIComponent(`Cotización ${bizName}`);
  const body    = encodeURIComponent(
    `Estimado cliente,\n\nAdjuntamos su cotización:\n\n${summary}${payLink}\n\nQuedamos a sus órdenes.\n${bizName}\nTel: ${cfg.bizPhone||""}\n\n_Generado por CALEBSYS v2.0_`
  );
  window.location.href = `mailto:${clientEmail}?subject=${subject}&body=${body}`;
  closePrintShareFlow();
}

function psEnviarFacebook() {
  const cfg = getSisConfig();
  const fbUrl = cfg.fbUrl || "https://facebook.com";
  window.open(fbUrl, "_blank");
  showToast("📘 Redirigiendo a tu página de Facebook...", "info");
  closePrintShareFlow();
}

function psSetPago(tipo) {
  _psPago = tipo;
  document.querySelectorAll(".ps-pago-btn").forEach(b => {
    b.classList.remove("ring-2","ring-amber-500","bg-amber-100");
  });
  const btn = document.getElementById(`ps-pago-${tipo}`);
  if (btn) btn.classList.add("ring-2","ring-amber-500","bg-amber-100");

  const cfg = getSisConfig();
  const sel = document.getElementById("ps-pago-selected");
  if (!sel) return;
  let preview = "";
  if (tipo === "paypal")  preview = `✅ PayPal: ${cfg.paypal || "(sin configurar)"}`;
  if (tipo === "ml")      preview = `✅ MercadoPago: ${cfg.mp || "(sin configurar)"}`;
  if (tipo === "banco")   preview = `✅ Banco: ${cfg.bancoNombre||""} | CLABE: ${cfg.bancoCuenta||""}`;
  sel.textContent = preview;
  sel.classList.remove("hidden");
}



function openDeliveryModal() {
  openModal("modal-delivery");
  
  document.getElementById("delivery-street").value = deliveryDetails ? deliveryDetails.street : "";
  document.getElementById("delivery-colony").value = deliveryDetails ? deliveryDetails.colony : "";
  document.getElementById("delivery-phone").value = deliveryDetails ? deliveryDetails.phone : "";
  document.getElementById("delivery-notes").value = deliveryDetails ? deliveryDetails.notes : "";
  
  const dateInput = document.getElementById("delivery-date");
  if (dateInput) {
    if (deliveryDetails && deliveryDetails.date) {
      dateInput.value = deliveryDetails.date;
    } else {
      const today = new Date().toISOString().split('T')[0];
      dateInput.value = today;
    }
  }
  
  setTimeout(() => {
    document.getElementById("delivery-street").focus();
  }, 50);
}

function handleF10() {
  openModal("modal-history");
  loadSalesHistory();
}

function handleF11() {
  if (cart.length === 0) {
    showToast("No se puede cotizar un carrito vacío", "warning");
    return;
  }
  
  const totals = calculateTotals();
  const mockQuote = {
    id: Math.floor(Math.random() * 900000) + 100000,
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
}

function handleF12() {
  // Ventas Online desactivado — módulo pendiente de configuración de Redes Sociales.
  // Se mantiene el placeholder pero no se abre para evitar confusión con datos hardcodeados.
  showToast("Ventas Online — Módulo próximamente disponible", "info");
  // openModal("modal-online-orders");
  // loadOnlineOrders();
}

// Ctrl key behaviors
function handleCtrlA() {
  if (typeof openClientAnticipossModal === "function") {
    openClientAnticipossModal(window.activeClient || null);
  }
}

function handleCtrlU() {
  // CTRL+U → Cuentas Nube: sube la venta a la nube virtual (ventas pausadas /
  // sincronizadas). La puede usar el cajero O el vendedor (a diferencia de
  // COBRAR/F7, que es sólo del cajero). admin/gerente = override.
  const _rol = (localStorage.getItem('calebsys_role') || '').toLowerCase().trim();
  const _rolesNube = [
    'cajero', 'operador caja', 'vendedor', 'operador ventas', 'mostrador',
    'vendedor_cajero', 'admin', 'administrador', 'administrador general',
    'superadmin', 'dueño', 'dueno', 'owner', 'admin_sucursal', 'gerente', 'supervisor', 'usuario', ''
  ];
  if (!_rolesNube.includes(_rol)) {
    showToast('Cuentas Nube (CTRL+U) — acceso del cajero o vendedor', 'warning');
    return;
  }
  openParkedSalesModal();
}

function handleCtrlR() {
  const toggle = document.getElementById("safekept-toggle");
  if (!toggle) return;
  if (toggle.checked) {
    toggle.checked = false;
    showToast('Resguardo de Material: DESACTIVADO', 'info');
    return;
  }
  if (!cart || cart.length === 0) {
    showToast('Agrega artículos al carrito para activar Resguardo de Material', 'warning');
    return;
  }
  openResguardoConfirmModal();
}

function openResguardoConfirmModal() {
  const fmt = v => '$' + parseFloat(v || 0).toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const totalVal = (typeof totals !== 'undefined' && totals) ? totals.total : cart.reduce((s, i) => s + (i.subtotal || 0), 0);
  const itemsHtml = cart.map(item =>
    `<div class="flex items-center justify-between px-4 py-2">
      <span class="text-slate-700 font-bold truncate flex-1">${item.description || item.sku}</span>
      <span class="text-slate-400 text-[11px] mx-3">×${item.quantity}</span>
      <span class="text-slate-800 font-black">${fmt(item.subtotal)}</span>
    </div>`
  ).join('');
  document.getElementById('rsg-items').innerHTML = itemsHtml;
  document.getElementById('rsg-total').textContent = fmt(totalVal);
  openModal('modal-resguardo-confirm');
}

function _confirmResguardo() {
  const toggle = document.getElementById('safekept-toggle');
  if (toggle) toggle.checked = true;
  closeModal('modal-resguardo-confirm');
  submitSale();
}

function handleCtrlC() {
  if (activeClient.id === 1) {
    showToast("Error Crédito: Público General no admite línea de crédito.", "error");
  } else {
    selectPaymentMethod("006");
    showToast("Método de pago cambiado a Crédito (CTRL+C)", "info");
  }
}

function handleCtrlD() {
  openModal("modal-returns");
  // IDs del modal rediseñado (ret-* en lugar de return-*-input)
  const folioInput  = document.getElementById("ret-search-folio");
  const ticketInfo  = document.getElementById("ret-ticket-info");
  if (folioInput)  { folioInput.value = ""; folioInput.focus(); }
  if (ticketInfo)  { ticketInfo.classList.add("hidden"); }
  returnSale = null;
  returnItems = [];
  selectedReturnIndex = -1;
}
function handleCtrlT() {
  openModal("modal-transfers");
  document.getElementById("transfer-form").reset();
  const stockInfo = document.getElementById("trf-stock-info");
  if (stockInfo) stockInfo.textContent = "";
  loadTransferWarehouses();
  setTimeout(() => {
    const src = document.getElementById("trf-source-wh");
    if (src) src.focus();
  }, 100);
}

function handleCtrlI() {
  openModal("modal-ai-assistant");
  document.getElementById("ai-assistant-query").value = "";
  document.getElementById("ai-chat-history").innerHTML = `
    <div class="bg-blue-50 text-blue-900 p-3 rounded-2xl leading-relaxed">
      Hola, soy tu <b>Asistente Inteligente Magdaleno</b>. Puedo ayudarte con consultas rápidas en el mostrador. Escribe tu pregunta sobre inventario, productos o deudas y presiona Enter.
    </div>
  `;
  setTimeout(() => {
    document.getElementById("ai-assistant-query").focus();
  }, 50);
}


// ══════════════════════════════════════════════════════════════════════════════
//  DISPATCH FUNCTIONS — Resuelven el contexto correcto para F4-F7 al hacer
//  clic en los botones del header. El teclado ya maneja el contexto vía los
//  bloques if(currentView==='sales') etc. Los botones de clic necesitan su
//  propio dispatcher para coincidir con el teclado.
// ══════════════════════════════════════════════════════════════════════════════

/** F4: CxC en sales/clients — exclusivo Cajero, Admin, Gerente */
function dispatchF4() {
  const role = (localStorage.getItem('calebsys_role') || '').toLowerCase().trim();
  const rolesPermitidos = ['cajero', 'operador caja', 'admin', 'administrador', 'administrador general', 'superadmin', 'due\u00f1o', 'dueno', 'owner', 'admin_sucursal', 'gerente', 'supervisor', 'vendedor_cajero', 'vendedor', 'operador ventas', 'mostrador', 'usuario', ''];
  if (!rolesPermitidos.includes(role)) {
    showToast('F4 Cuentas x Cobrar — acceso exclusivo del Cajero', 'warning');
    return;
  }
  if (currentView === "catalog") {
    openArmarPaqueteModal();
  } else if (currentView === "quotes") {
    setView("sales");
  } else if (currentView === "clients") {
    openClientCxCModal();
  } else {
    if (!activeClient || activeClient.id === 1) {
      showToast("Selecciona un cliente para consultar Cuentas por Cobrar", "warning");
    } else {
      openClientCxCModal(activeClient);
    }
  }
}

/** F5: Apartados en sales/clients, Domicilio en catalog */
function dispatchF5() {
  // F5 = Apartados / Resguardos — exclusivo Almacenista, Admin, Gerente
  const role = (localStorage.getItem('calebsys_role') || '').toLowerCase().trim();
  const rolesPermitidos = ['almacenista', 'almacen', 'almac\u00e9n', 'operador almacen', 'operador almac\u00e9n', 'cajero', 'operador caja', 'admin', 'administrador', 'administrador general', 'superadmin', 'due\u00f1o', 'dueno', 'owner', 'admin_sucursal', 'gerente', 'supervisor', 'vendedor_cajero', 'vendedor', 'operador ventas', 'mostrador', 'usuario', ''];
  if (!rolesPermitidos.includes(role)) {
    showToast('F5 Apartados — acceso exclusivo del Almacenista', 'warning');
    return;
  }
  if (currentView === "clients") {
    openClientApartadosModal();
  } else {
    // sales view (default) — require cliente seleccionado
    if (!activeClient || activeClient.id === 1) {
      showToast("Selecciona un cliente para gestionar sus Apartados", "warning");
    } else {
      openClientApartadosModal(activeClient);
    }
  }
}

/** F6: Facturar CFDI / Devoluciones — exclusivo Cajero, Admin, Gerente */
function dispatchF6() {
  const role = (localStorage.getItem('calebsys_role') || '').toLowerCase().trim();
  const rolesPermitidos = ['cajero', 'operador caja', 'admin', 'administrador', 'administrador general', 'superadmin', 'due\u00f1o', 'dueno', 'owner', 'admin_sucursal', 'gerente', 'supervisor', 'vendedor_cajero', 'vendedor', 'operador ventas', 'mostrador', 'usuario', ''];
  if (!rolesPermitidos.includes(role)) {
    showToast('F6 Facturación/Devoluciones — acceso exclusivo del Cajero', 'warning');
    return;
  }
  if (currentView === "sales") {
    handleCtrlF(); // toggle CFDI 4.0
  } else {
    openModal("modal-returns");
    document.getElementById("ret-search-folio")?.focus();
  }
}

/** F7: COBRAR / enviar factura a caja — exclusivo del Cajero (admin = override) */
function dispatchF7() {
  const role = (localStorage.getItem('calebsys_role') || '').toLowerCase().trim();
  const rolesPermitidos = [
    'cajero', 'operador caja', 'admin', 'administrador', 'administrador general',
    'superadmin', 'dueño', 'dueno', 'owner', 'admin_sucursal', 'gerente',
    'supervisor', 'vendedor_cajero', 'vendedor', 'operador ventas', 'mostrador', 'usuario', ''
  ];
  if (!rolesPermitidos.includes(role)) {
    showToast('COBRAR (F7) es exclusivo de caja/mostrador. Usa Cuentas Nube (CTRL+U).', 'warning');
    return;
  }
  if (currentView === "sales") {
    handleF7(); // submitSale() o warning
  } else {
    const discountInput = document.getElementById("discount-input");
    if (discountInput) { discountInput.focus(); discountInput.select(); }
  }
}

/** F8: Cotizaciones — alterna vista de cotizaciones desde ventas/catalog/clients */
function dispatchF8() {
  if (currentView === "quotes") {
    setView("sales");
  } else if (currentView === "clients") {
    openClientCotizacionesModal();
  } else {
    // sales / catalog → abre vista de cotizaciones
    setView("quotes");
  }
}

/** F9: Cambio de usuario sin cerrar sesión — Fix B-03
 *  Anticipos se movió a CTRL+A (handleCtrlA / modal-client-anticipos).
 *  F9 abre el modal de cambio rápido de turno/cajero. */
function dispatchF9() {
  if (typeof openUserSwitchModal === "function") {
    openUserSwitchModal();
  } else {
    // Fallback mientras el modal de cambio de usuario no está implementado
    showToast("Cambio de usuario (F9) — módulo en configuración. Use Cerrar Sesión.", "info");
  }
}
