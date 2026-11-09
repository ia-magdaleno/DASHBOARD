/* 11-parked-sales.js — Cloud accounts / parked sales module
   Extraido de app_v66.js (fase 3, modularizacion post-auditoria 2026-08-03)
   Lineas originales: 4923-5674 */
// --- CLOUD ACCOUNTS / PARKED SALES MODULE ---


function toggleParkedMergeMode() {
  if (isParkedMergeMode && multiselectParkedIds.size >= 2) {
    mergeSelectedParked();
    return;
  }
  isParkedMergeMode = !isParkedMergeMode;
  multiselectParkedIds.clear();
  
  const th = document.getElementById("parked-th-checkbox");
  if (th) {
    th.style.display = isParkedMergeMode ? "table-cell" : "none";
  }
  
  const btn = document.getElementById("btn-unir-cuentas");
  if (btn) {
    if (isParkedMergeMode) {
      btn.classList.add("bg-blue-100", "border-blue-300");
      btn.classList.remove("bg-white", "border-slate-200");
    } else {
      btn.classList.remove("bg-blue-100", "border-blue-300");
      btn.classList.add("bg-white", "border-slate-200");
    }
  }
  
  renderParkedSalesTable();
}

function openParkedSalesModal() {
  activeModal = "modal-parked-sales";
  document.getElementById("modal-parked-sales").classList.remove("hidden");
  
  // Security rule: Only role ADMINISTRADOR can change Branch selection
  const userRole = "ADMINISTRADOR"; // Default role
  const branchSelect = document.getElementById("filter-parked-branch");
  if (branchSelect) {
    if (userRole === "ADMINISTRADOR") {
      branchSelect.disabled = false;
    } else {
      branchSelect.disabled = true;
      branchSelect.value = "MATRIZ";
    }
  }

  // Reset states
  selectedParkedIndex = -1;
  multiselectParkedIds.clear();
  document.getElementById("parked-search-filter").value = "";
  parkedSearchQuery = "";
  
  loadParkedSales();
  
  // Render lucide icons
  if (window.lucide) {
    window.lucide.createIcons();
  }
}

function loadParkedSales() {
  const branchElem = document.getElementById("filter-parked-branch");
  const sellerElem = document.getElementById("filter-parked-seller");
  
  const branch = branchElem ? branchElem.value : "";
  const seller = sellerElem ? sellerElem.value : "";
  const query = parkedSearchQuery.trim();

  let url = `${API_BASE}/parked-sales`;
  const params = [];
  if (branch) params.push(`branch=${encodeURIComponent(branch)}`);
  if (seller) params.push(`seller=${encodeURIComponent(seller)}`);
  if (query)  params.push(`q=${encodeURIComponent(query)}`);
  if (params.length > 0) url += `?${params.join("&")}`;

  apiFetch(url)
    .then(res => res.json())
    .then(data => {
      parkedSales = data;
      
      // Update selected row bounds
      if (parkedSales.length > 0) {
        if (selectedParkedIndex === -1 || selectedParkedIndex >= parkedSales.length) {
          selectedParkedIndex = 0;
        }
      } else {
        selectedParkedIndex = -1;
      }
      
      renderParkedSalesTable();
      renderParkedSaleDetails();
    })
    .catch(() => {
      showToast("Error al cargar cuentas de la nube.", "error");
    });
}

function renderParkedSalesTable() {
  const tbody = document.getElementById("parked-table-body");
  if (!tbody) return;
  tbody.innerHTML = "";

  if (parkedSales.length === 0) {
    tbody.innerHTML = `<tr><td colspan="7" class="text-center py-8 text-slate-400">No hay cuentas pendientes en la nube.</td></tr>`;
    return;
  }

  parkedSales.forEach((sale, idx) => {
    const tr = document.createElement("tr");
    const isSelected = idx === selectedParkedIndex;
    const isChecked = multiselectParkedIds.has(sale.id);
    
    tr.className = `hover:bg-slate-50 cursor-pointer select-none transition border-b border-slate-100 ${
      isSelected ? 'bg-blue-50/70 border-l-4 border-l-blue-600 font-semibold text-slate-800' : ''
    }`;

    const dateObj = new Date(sale.created_at);
    const formattedDate = dateObj.toLocaleDateString("es-MX", { day: '2-digit', month: '2-digit', year: 'numeric' });

    const checkboxTd = isParkedMergeMode ? `

      <td class="py-2.5 px-4 text-center" onclick="event.stopPropagation(); toggleParkedSelectionById(${sale.id})">

        <input type="checkbox" class="rounded border-slate-300 text-blue-600 focus:ring-0" ${isChecked ? 'checked' : ''}>

      </td>` : '';



    tr.innerHTML = `

      ${checkboxTd}

      <td class="py-2.5 px-4 font-bold text-slate-500">${sale.folio}</td>

      <td class="py-2.5 px-4 text-slate-700">${sale.client_name}</td>

      <td class="py-2.5 px-4 text-slate-600">${sale.seller}</td>

      <td class="py-2.5 px-4 text-slate-500">${sale.branch}</td>

      <td class="py-2.5 px-4 text-slate-500 text-center">${formattedDate}</td>

      <td class="py-2.5 px-4 text-right font-black text-slate-800">$${sale.total.toFixed(2)}</td>

    `;


    tr.addEventListener("click", () => {
      selectedParkedIndex = idx;
      renderParkedSalesTable();
      renderParkedSaleDetails();
    });

    tbody.appendChild(tr);
  });
}

function renderParkedSaleDetails() {
  const content = document.getElementById("parked-detail-content");
  const empty = document.getElementById("parked-detail-empty");

  if (selectedParkedIndex === -1 || parkedSales.length === 0 || !parkedSales[selectedParkedIndex]) {
    content.classList.add("hidden");
    empty.classList.remove("hidden");
    return;
  }

  content.classList.remove("hidden");
  empty.classList.add("hidden");

  const sale = parkedSales[selectedParkedIndex];

  document.getElementById("parked-detail-folio").innerText = sale.folio;
  document.getElementById("parked-detail-id").innerText = sale.client_id || "- -";
  document.getElementById("parked-detail-client").innerText = sale.client_name;
  document.getElementById("parked-detail-rfc").innerText = sale.client_rfc || "S/N";
  document.getElementById("parked-detail-total").innerText = `$${sale.total.toFixed(2)}`;

  // Populate items
  const itemsList = document.getElementById("parked-detail-items-list");
  itemsList.innerHTML = "";
  
  sale.items.forEach(item => {
    const div = document.createElement("div");
    div.className = "flex gap-4 border-b border-slate-50 pb-1";
    const qtyColorClass = item.quantity < 0 ? 'text-red-500' : 'text-blue-600';
    
    div.innerHTML = `
      <span class="w-16 text-slate-700">${item.product_sku}</span>
      <span class="w-12 text-right ${qtyColorClass} font-black">${item.quantity}</span>
      <span class="flex-1 text-slate-800 uppercase pl-4">${item.description}</span>
    `;
    itemsList.appendChild(div);
  });

  // Populate comment logs (Only show the latest comment in the single box)
  const feed = document.getElementById("parked-comments-feed");
  if (sale.comments && sale.comments.length > 0) {
    const latestComment = sale.comments[sale.comments.length - 1];
    feed.innerText = latestComment.comment;
  } else {
    feed.innerText = "SIN COMENTARIOS";
  }
}

function toggleParkedSelectionById(id) {
  if (multiselectParkedIds.has(id)) {
    multiselectParkedIds.delete(id);
  } else {
    multiselectParkedIds.add(id);
  }
  renderParkedSalesTable();
}

function toggleActiveParkedSelection() {
  if (selectedParkedIndex !== -1 && parkedSales[selectedParkedIndex]) {
    const sale = parkedSales[selectedParkedIndex];
    toggleParkedSelectionById(sale.id);
  }
}

function navigateParkedSales(dir) {
  if (parkedSales.length === 0) return;
  selectedParkedIndex += dir;
  // Hard wall: stop at first and last, no wrap-around
  if (selectedParkedIndex < 0) selectedParkedIndex = 0;
  if (selectedParkedIndex >= parkedSales.length) selectedParkedIndex = parkedSales.length - 1;
  
  renderParkedSalesTable();
  renderParkedSaleDetails();

  // Scroll table row into view
  const tbody = document.getElementById("parked-table-body");
  if (tbody) {
    const rows = tbody.getElementsByTagName("tr");
    if (rows[selectedParkedIndex]) {
      rows[selectedParkedIndex].scrollIntoView({ block: "nearest" });
    }
  }
}

function changeParkedBranchFilter() {
  selectedParkedIndex = -1;
  multiselectParkedIds.clear();
  loadParkedSales();
}

function changeParkedSellerFilter() {
  selectedParkedIndex = -1;
  multiselectParkedIds.clear();
  loadParkedSales();
}

function changeParkedSearchQuery() {
  parkedSearchQuery = document.getElementById("parked-search-filter").value;
  selectedParkedIndex = -1;
  multiselectParkedIds.clear();
  loadParkedSales();
}

function focusParkedSearch() {
  const search = document.getElementById("parked-search-filter");
  if (search) {
    search.focus();
    search.select();
  }
}

function addActiveParkedComment() {
  if (selectedParkedIndex === -1 || parkedSales.length === 0) return;
  const sale = parkedSales[selectedParkedIndex];
  const input = document.getElementById("parked-comment-input");
  const commentText = input.value.trim();
  if (!commentText) return;

  apiFetch(`${API_BASE}/parked-sales/${sale.id}/comments`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      comment_text: commentText,
      author: "ANTONIO M."
    })
  })
  .then(res => res.json())
  .then(comment => {
    input.value = "";
    sale.comments.push(comment);
    renderParkedSaleDetails();
    showToast("Comentario agregado a la bitácora", "success");
  })
  .catch(() => {
    showToast("No se pudo agregar el comentario.", "error");
  });
}

function downloadActiveParked() {
  // Determine which account(s) to load into the cart
  let ids = [];
  if (multiselectParkedIds.size > 0) {
    ids = Array.from(multiselectParkedIds);
  } else if (selectedParkedIndex !== -1 && parkedSales[selectedParkedIndex]) {
    ids = [parkedSales[selectedParkedIndex].id];
  }

  if (ids.length === 0) {
    showToast("No hay ninguna cuenta seleccionada para bajar.", "warning");
    return;
  }

  const downloads = ids.map(id => apiFetch(`${API_BASE}/parked-sales/${id}`).then(res => res.json()));

  Promise.all(downloads)
    .then(loadedSales => {
      cart = [];

      // Collect all IDs to delete: the selected ones + orphaned originals of any merged master
      const allIdsToDelete = [...ids];

      loadedSales.forEach(s => {
        // If this is a merged master, also delete the hidden originals it references
        if (s.merged_from_ids) {
          s.merged_from_ids.split(",").map(x => x.trim()).filter(Boolean).forEach(cid => {
            if (!allIdsToDelete.includes(cid)) allIdsToDelete.push(cid);
          });
        }

        s.items.forEach(item => {
          const basePrice = item.price;
          const scaledPrice = getProductPriceForClient({ price: basePrice }, { client_type: activePriceScale });
          const existingIndex = cart.findIndex(ci => ci.sku === item.product_sku && Math.sign(ci.quantity) === Math.sign(item.quantity));
          if (existingIndex !== -1) {
            cart[existingIndex].quantity += item.quantity;
            cart[existingIndex].subtotal = cart[existingIndex].quantity * cart[existingIndex].price;
          } else {
            cart.push({
              sku: item.product_sku,
              description: item.description,
              base_price: basePrice,
              price: scaledPrice,
              quantity: item.quantity,
              subtotal: item.quantity * scaledPrice
            });
          }
        });
      });

      const firstSale = loadedSales[0];
      updateClientDisplay({
        id: Math.floor(Math.random() * 900) + 100,
        name: firstSale.client_name,
        rfc: firstSale.client_rfc || "XAXX010101000",
        client_type: "Público General"
      });

      closeModal("modal-parked-sales");
      updateCartUI();
      focusProductInput();

      apiFetch(`${API_BASE}/parked-sales/delete-bulk`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(allIdsToDelete)
      }).then(() => {
        showToast("Cuenta(s) bajadas y removidas de la nube.", "success");
      });
    })
    .catch(() => {
      showToast("Error al bajar la cuenta.", "error");
    });
}

function mergeSelectedParked() {
  if (multiselectParkedIds.size < 2) {
    showToast("Por favor selecciona 2 o más cuentas para unir.", "warning");
    return;
  }

  const ids = Array.from(multiselectParkedIds);
  const selectedSales = ids.map(id => parkedSales.find(s => s.id === id)).filter(Boolean);
  if (selectedSales.length < 2) {
    showToast("No se encontraron las cuentas seleccionadas.", "warning");
    return;
  }

  const names = selectedSales.map(s => s.client_name);
  const newName = "* " + names.join(" + ").substring(0, 48);
  const firstSale = selectedSales[0];

  // Clear multiselect and exit merge mode BEFORE the async call to prevent state issues
  multiselectParkedIds.clear();
  isParkedMergeMode = false;
  const th = document.getElementById("parked-th-checkbox");
  if (th) th.style.display = "none";
  const btn = document.getElementById("btn-unir-cuentas");
  if (btn) {
    btn.classList.remove("bg-blue-100", "border-blue-300");
    btn.classList.add("bg-white", "border-slate-200");
  }

  // Use the proper merge endpoint: originals are hidden (is_merged=True), master is created
  apiFetch(`${API_BASE}/parked-sales/merge`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      account_ids: ids,
      new_client_name: newName,
      seller: firstSale.seller,
      branch: firstSale.branch
    })
  })
  .then(res => {
    if (!res.ok) throw new Error("Merge fail");
    return res.json();
  })
  .then(() => {
    showToast(`Cuentas unidas: ${newName}`, "success");
    loadParkedSales(); // Refresh: originals disappear, master appears
  })
  .catch(() => {
    showToast("Error al unir las cuentas.", "error");
  });
}

function splitSelectedParked() {
  if (selectedParkedIndex === -1 || parkedSales.length === 0) return;
  const sale = parkedSales[selectedParkedIndex];

  if (!sale.merged_from_ids) {
    showToast("La cuenta seleccionada no es una fusión de cuentas.", "warning");
    return;
  }

  // /split restores original accounts (is_merged=False) and deletes the master
  apiFetch(`${API_BASE}/parked-sales/${sale.id}/split`, { method: "POST" })
    .then(res => {
      if (!res.ok) throw new Error("Split fail");
      return res.json();
    })
    .then(() => {
      showToast("Cuentas separadas correctamente.", "success");
      loadParkedSales();
    })
    .catch(() => {
      showToast("Error al separar las cuentas.", "error");
    });
}

function renameSelectedParked() {
  if (selectedParkedIndex === -1 || parkedSales.length === 0) return;
  const sale = parkedSales[selectedParkedIndex];

  const newName = prompt("Editar nombre de referencia del cliente:", sale.client_name);
  if (!newName || !newName.trim()) return;

  apiFetch(`${API_BASE}/parked-sales/${sale.id}/rename`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_name: newName.trim()
    })
  })
  .then(res => {
    if (!res.ok) throw new Error("Rename fail");
    return res.json();
  })
  .then(updated => {
    showToast("Referencia de cuenta actualizada", "success");
    sale.client_name = updated.client_name;
    renderParkedSalesTable();
    renderParkedSaleDetails();
  })
  .catch(() => {
    showToast("Error al renombrar cuenta.", "error");
  });
}

function deleteSelectedParked() {
  let ids = [];
  if (multiselectParkedIds.size > 0) {
    ids = Array.from(multiselectParkedIds);
  } else if (selectedParkedIndex !== -1 && parkedSales[selectedParkedIndex]) {
    ids = [parkedSales[selectedParkedIndex].id];
  }

  if (ids.length === 0) {
    showToast("Selecciona cuentas para eliminar.", "warning");
    return;
  }

  if (!confirm(`¿Estás seguro de que deseas eliminar permanentemente estas ${ids.length} cuentas de la nube?`)) return;

  apiFetch(`${API_BASE}/parked-sales/delete-bulk`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(ids)
  })
  .then(res => {
    if (!res.ok) throw new Error("Delete fail");
    showToast("Cuentas eliminadas correctamente", "success");
    multiselectParkedIds.clear();
    loadParkedSales();
  })
  .catch(() => {
    showToast("Error al eliminar las cuentas.", "error");
  });
}

function transferSelectedParked() {
  let ids = [];
  if (multiselectParkedIds.size > 0) {
    ids = Array.from(multiselectParkedIds);
  } else if (selectedParkedIndex !== -1 && parkedSales[selectedParkedIndex]) {
    ids = [parkedSales[selectedParkedIndex].id];
  }

  if (ids.length === 0) {
    showToast("Selecciona cuentas para transferir.", "warning");
    return;
  }

  // Open transfer submodal
  openModal("modal-parked-transfer-select");
  
  // Keep active parked sales modal visible under it (we manually handle sub-modal focus)
  document.getElementById("modal-parked-sales").classList.remove("hidden");
}

function confirmTransferSelectedParked() {
  let ids = [];
  if (multiselectParkedIds.size > 0) {
    ids = Array.from(multiselectParkedIds);
  } else if (selectedParkedIndex !== -1 && parkedSales[selectedParkedIndex]) {
    ids = [parkedSales[selectedParkedIndex].id];
  }

  const destBranch = document.getElementById("transfer-dest-branch").value;

  apiFetch(`${API_BASE}/parked-sales/transfer-bulk`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      account_ids: ids,
      destination_branch: destBranch
    })
  })
  .then(res => {
    if (!res.ok) throw new Error("Transfer fail");
    closeModal("modal-parked-transfer-select");
    activeModal = "modal-parked-sales"; // return to cloud modal state
    
    showToast(`Cuentas transferidas con éxito a ${destBranch}`, "success");
    multiselectParkedIds.clear();
    loadParkedSales();
  })
  .catch(() => {
    showToast("No se pudo completar la transferencia.", "error");
  });
}

function parkCurrentSale() {
  const totals = calculateTotals();
  if (cart.length === 0) {
    showToast("No hay productos en el carrito para subir a la nube", "warning");
    return;
  }

  // Get active client details
  let clientPhone = activeClient.phone ? activeClient.phone.replace(/[^0-9]/g, '') : "";
  if (clientPhone.startsWith("52")) {
    clientPhone = clientPhone.substring(2); // strip country code if present
  }
  if (!clientPhone || clientPhone.length !== 10) {
    clientPhone = "6151000000"; // default fallback phone number
  }

  let internalCounter = parseInt(localStorage.getItem("internalOrderCounter") || "1");
  const clientName = activeClient.name === "Público General" 
    ? `PED-${String(internalCounter).padStart(3, '0')}` 
    : activeClient.name;

  if (activeClient.name === "Público General") {
    internalCounter++;
    localStorage.setItem("internalOrderCounter", internalCounter);
  }

  const cleanPhone = clientPhone || "6151000000";
  const commentText = `Cuenta generada en caja: ${clientName}`;
  
  const saleItems = cart.map(item => ({
    product_sku: item.sku,
    description: item.description,
    quantity: item.quantity,
    price: item.price,
    subtotal: item.subtotal,
    source_group: item.source_group || null
  }));

  const payload = {
    client_id: cleanPhone,
    client_name: clientName.trim(),
    client_rfc: activeClient.rfc || "XAXX010101000",
    seller: "ANTONIO M.",
    branch: activeBranchFilter || "MATRIZ",
    total: totals.total,
    is_merged: false,
    items: saleItems,
    comment: commentText || null
  };

  apiFetch(`${API_BASE}/parked-sales`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  })
  .then(res => {
    if (!res.ok) throw new Error("API fail");
    return res.json();
  })
  .then(parked => {
    showToast(`Cuenta subida a la nube con éxito! Folio: ${parked.folio}`, "success");
    cart = [];
    updateCartUI();
    // Reset client to PUBLICO EN GENERAL for next sale
    updateClientDisplay(getWalkInClient());
    if (activeModal === "modal-parked-sales") {
      loadParkedSales();
    }
  })
  .catch(() => {
    showToast("Error al subir cuenta a la nube.", "error");
  });
}

function selectReturnRefundMethod(method) {
  activeReturnRefundMethod = method;
  updateReturnRefundUI();
}

function updateReturnRefundUI() {
  const totals = calculateTotals();
  const absTotal = Math.abs(totals.total);

  const btnCash = document.getElementById("btn-return-cash");
  const btnCredit = document.getElementById("btn-return-credit");
  const btnMixed = document.getElementById("btn-return-mixed");

  if (btnCash) {
    btnCash.className = activeReturnRefundMethod === "cash"
      ? "bg-blue-800 border-2 border-blue-500 text-white font-bold py-1.5 rounded-xl text-[9px] uppercase transition focus:outline-none"
      : "bg-blue-950/20 border border-blue-900 text-blue-300 font-bold py-1.5 rounded-xl text-[9px] uppercase transition focus:outline-none";
  }
  if (btnCredit) {
    btnCredit.className = activeReturnRefundMethod === "credit"
      ? "bg-blue-800 border-2 border-blue-500 text-white font-bold py-1.5 rounded-xl text-[9px] uppercase transition focus:outline-none"
      : "bg-blue-950/20 border border-blue-900 text-blue-300 font-bold py-1.5 rounded-xl text-[9px] uppercase transition focus:outline-none";
  }
  if (btnMixed) {
    btnMixed.className = activeReturnRefundMethod === "mixed"
      ? "bg-blue-800 border-2 border-blue-500 text-white font-bold py-1.5 rounded-xl text-[9px] uppercase transition focus:outline-none"
      : "bg-blue-950/20 border border-blue-900 text-blue-300 font-bold py-1.5 rounded-xl text-[9px] uppercase transition focus:outline-none";
  }

  const cashInputField = document.getElementById("return-cash-input-field");
  const cashInput = document.getElementById("return-cash-returned");
  const creditDisplay = document.getElementById("return-credit-display-field");
  const creditAmountSpan = document.getElementById("return-credit-amount");

  if (activeReturnRefundMethod === "cash") {
    if (cashInputField) cashInputField.classList.add("hidden");
    if (creditDisplay) creditDisplay.classList.add("hidden");
  } else if (activeReturnRefundMethod === "credit") {
    if (cashInputField) cashInputField.classList.add("hidden");
    if (creditDisplay) creditDisplay.classList.remove("hidden");
    if (creditAmountSpan) creditAmountSpan.innerText = `$${absTotal.toFixed(2)}`;
  } else if (activeReturnRefundMethod === "mixed") {
    if (cashInputField) cashInputField.classList.remove("hidden");
    if (creditDisplay) creditDisplay.classList.remove("hidden");
    
    if (cashInput && !cashInput.dataset.listener) {
      cashInput.dataset.listener = "true";
      cashInput.addEventListener("input", () => {
        updateReturnRefundUI();
      });
    }

    const cashVal = parseFloat(cashInput ? cashInput.value : 0) || 0.0;
    const creditVal = Math.max(0, absTotal - cashVal);
    if (creditAmountSpan) creditAmountSpan.innerText = `$${creditVal.toFixed(2)}`;
  }
}

