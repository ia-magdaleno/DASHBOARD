/* 14-misc-patches.js — Constancia fiscal upload, parches de auditoria, alta cliente features, OS back button
   Extraido de app_v66.js (fase 3, modularizacion post-auditoria 2026-08-03)
   Lineas originales: 6545-7092 */
// --- CONSTANCIA FISCAL UPLOAD ---
function handleConstanciaFile(event) {
  const zone = document.getElementById('nc-upload-zone');
  const originalContent = zone ? zone.innerHTML : null;

  if (zone) {
    zone.classList.add('border-blue-400', 'bg-blue-50');
    zone.querySelector('button') && (zone.querySelector('button').disabled = true);
  }

  const file = event.target.files[0];
  // reset input so the same file can be re-selected if needed
  if (event.target && event.target.value !== undefined) event.target.value = '';
  if (!file) return;

  const formData = new FormData();
  formData.append("file", file);

  // Optimistic feedback
  const statusEl = zone && zone.querySelector('.nc-constancia-status');
  if (statusEl) { statusEl.textContent = '⏳ Procesando…'; statusEl.className = 'nc-constancia-status text-[11px] font-semibold text-blue-600 ml-2'; }

  apiFetch("/api/constancia", { method: "POST", body: formData })
    .then(r => r.json())
    .then(data => {
      if (data.success || data.rfc) {
        const flash = (id, val) => {
          if (!val) return;
          const el = document.getElementById(id);
          if (!el) return;
          // select → set by value, else set text value
          if (el.tagName === 'SELECT') {
            const opt = Array.from(el.options).find(o => o.value.startsWith(val) || val.startsWith(o.value));
            if (opt) el.value = opt.value;
          } else {
            el.value = val;
          }
          el.classList.add('ring-2', 'ring-green-400');
          setTimeout(() => el.classList.remove('ring-2', 'ring-green-400'), 1800);
        };

        flash("nc-rfc",           data.rfc);
        flash("nc-razon-social",  data.nombre);
        flash("nc-nombre-comercial", data.nombre_comercial);
        flash("nc-cp",            data.cp);
        flash("nc-colonia",       data.colonia);
        flash("nc-ciudad",        data.municipio);   // ciudad ← municipio es lo más cercano
        flash("nc-municipio",     data.municipio);
        flash("nc-estado",        data.estado);
        flash("nc-direccion",     data.vialidad);
        flash("nc-numero-ext",    data.num_ext);
        flash("nc-numero-int",    data.num_int);
        flash("nc-regimen",       data.regimen_fiscal);
        flash("nc-uso-cfdi",      data.uso_cfdi);

        if (statusEl) { statusEl.textContent = '✓ Datos cargados'; statusEl.className = 'nc-constancia-status text-[11px] font-semibold text-green-600 ml-2'; }
        if (zone) zone.classList.replace('border-blue-400', 'border-green-400');
      } else {
        if (statusEl) { statusEl.textContent = '✗ No se pudo leer la Constancia'; statusEl.className = 'nc-constancia-status text-[11px] font-semibold text-red-600 ml-2'; }
        if (zone) { zone.classList.remove('border-blue-400', 'bg-blue-50'); zone.classList.add('border-red-400'); }
      }
      if (zone) zone.querySelector('button') && (zone.querySelector('button').disabled = false);
    })
    .catch(err => {
      console.error(err);
      if (statusEl) { statusEl.textContent = '✗ Error de conexión'; statusEl.className = 'nc-constancia-status text-[11px] font-semibold text-red-600 ml-2'; }
      if (zone) { zone.classList.remove('border-blue-400', 'bg-blue-50'); zone.classList.add('border-red-400'); zone.querySelector('button') && (zone.querySelector('button').disabled = false); }
    });
}

function setupConstanciaDragDrop() {
  const zone = document.getElementById('nc-upload-zone');
  if (!zone || zone._dzReady) return;
  zone._dzReady = true;
  zone.addEventListener("dragover", (e) => { e.preventDefault(); zone.classList.add("border-blue-400", "bg-blue-50"); });
  zone.addEventListener("dragleave", (e) => { e.preventDefault(); zone.classList.remove("border-blue-400", "bg-blue-50"); });
  zone.addEventListener("drop", (e) => {
    e.preventDefault();
    zone.classList.remove("border-blue-400", "bg-blue-50");
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      handleConstanciaFile({ target: { files: e.dataTransfer.files } });
    }
  });
}

// --- PARCHES DE AUDITORIA ---
function getClientDeterministicDetails(client) {
  if (!client) return { phone: "", puntos: 0 };
  return {
    phone: client.phone || (client.id ? client.id.toString() : ""),
    puntos: client.puntos || client.loyalty_points || 0
  };
}

function handleQuotesFilterChange() { loadViewQuotes(); }

// --- LÓGICA DEL MODAL DE DEVOLUCIONES POR RECIBO (CTRL+D) ---
let currentReturnTicket = null;

function _retGetRole() {
  const token = localStorage.getItem('calebsys_token');
  if (!token) return '';
  try {
    const p = JSON.parse(atob(token.split('.')[1]));
    return (p.role || p.rol || '').toUpperCase();
  } catch(e) { return ''; }
}

function searchTicketForReturn() {
  const folio = document.getElementById("ret-search-folio").value.trim();
  if (!folio) { showToast("Ingresa un folio válido", "warning"); return; }

  apiFetch(`${API_BASE}/sales/${folio}`)
    .then(res => { if (!res.ok) throw new Error(); return res.json(); })
    .then(sale => {
      currentReturnTicket = sale;
      document.getElementById("ret-ticket-info").classList.remove("hidden");
      document.getElementById("ret-ticket-id").innerText = `#${sale.id}`;
      document.getElementById("ret-ticket-date").innerText = new Date(sale.created_at).toLocaleDateString("es-MX");
      document.getElementById("ret-ticket-client").innerText = sale.client ? sale.client.name : "Público General";
      document.getElementById("ret-ticket-total").innerText = `$${sale.total.toFixed(2)}`;

      // Badge de rol
      const role = _retGetRole();
      const badge = document.getElementById("ret-role-badge");
      if (badge) {
        const isAuth = ['ADMIN','GERENTE','ALMACENISTA'].includes(role);
        badge.classList.remove("hidden");
        badge.className = `text-[9px] font-black uppercase tracking-wider px-2 py-1 rounded-lg text-center ${isAuth ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700'}`;
        badge.textContent = isAuth ? `✓ ${role} — procesará directo` : `${role} — enviará solicitud`;
      }

      const tbody = document.getElementById("ret-items-body");
      tbody.innerHTML = sale.items.map(i => {
        const maxDev = i.quantity - (i.returned_quantity || 0);
        const agotado = maxDev <= 0;
        return `
          <tr class="border-b border-slate-50 hover:bg-slate-50 ${agotado ? 'opacity-40' : ''}">
            <td class="py-2 text-slate-500">${i.product_sku}</td>
            <td class="py-2 text-slate-700">${i.description || 'Producto'}</td>
            <td class="py-2 text-center">${i.quantity}</td>
            <td class="py-2 text-center ${(i.returned_quantity || 0) > 0 ? 'text-red-500 font-bold' : ''}">${i.returned_quantity || 0}</td>
            <td class="py-2 text-right">$${parseFloat(i.price).toFixed(2)}</td>
            <td class="py-2 text-center">
              <input type="number" min="0" max="${maxDev}" value="${agotado ? 0 : ''}"
                     data-sku="${i.product_sku}" data-price="${i.price}"
                     class="ret-qty-input w-16 text-center border border-slate-300 rounded font-bold outline-none focus:ring-2 focus:ring-blue-500"
                     ${agotado ? 'disabled title="Ya devuelto totalmente"' : ''}
                     oninput="calcTotalReturn()">
            </td>
          </tr>`;
      }).join("");
      document.getElementById("btn-submit-return").disabled = false;
      document.getElementById("ret-notes")?.value === undefined || (document.getElementById("ret-notes").value = "");
      calcTotalReturn();
    }).catch(() => { showToast("Ticket no encontrado", "error"); });
}

function calcTotalReturn() {
  let total = 0;
  document.querySelectorAll(".ret-qty-input").forEach(inp => {
    total += (parseFloat(inp.value) || 0) * (parseFloat(inp.getAttribute("data-price")) || 0);
  });
  document.getElementById("ret-total-refund").innerText = `$${total.toFixed(2)}`;
}

async function submitReturn() {
  if (!currentReturnTicket) return;

  const items = [];
  document.querySelectorAll(".ret-qty-input").forEach(inp => {
    const qty = parseFloat(inp.value) || 0;
    if (qty > 0) items.push({
      product_sku: inp.getAttribute("data-sku"),
      quantity_returned: qty,
      notes: document.getElementById("ret-refund-method")?.value || "Devolución CTRL+D"
    });
  });
  if (items.length === 0) { showToast("Ingresa la cantidad a devolver en al menos un artículo", "warning"); return; }

  const refundMethod = document.getElementById("ret-refund-method")?.value || "Efectivo";
  const notes = document.getElementById("ret-notes")?.value.trim() || "";
  const totalText = document.getElementById("ret-total-refund")?.innerText || "$0.00";
  const total = parseFloat(totalText.replace(/[$,]/g, "")) || 0;
  const clientId = currentReturnTicket?.client?.id || currentReturnTicket?.client_id;
  const saleId = currentReturnTicket.id;

  const role = _retGetRole();
  const isAuthorized = ['ADMIN', 'GERENTE', 'ALMACENISTA'].includes(role);

  const btn = document.getElementById("btn-submit-return");
  if (btn) btn.disabled = true;

  if (isAuthorized) {
    // Admin / Gerente / Almacenista → procesa directo
    try {
      const res = await apiFetch(`${API_BASE}/sales/${saleId}/returns`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items, total_refund_amount: total, refund_method: refundMethod })
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        showToast(err.detail || "Error al procesar devolución", "error");
        if (btn) btn.disabled = false;
        return;
      }

      // Si "Saldo a Favor" y hay cliente ligado → acreditar anticipo
      if (refundMethod === "Saldo a Favor" && clientId && clientId !== 1) {
        try {
          await apiFetch(`${API_BASE}/clients/${clientId}/anticipo`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              amount: total,
              description: `Reembolso devolución ticket #${saleId}${notes ? ` — ${notes}` : ''}`
            })
          });
          showToast(`$${total.toFixed(2)} acreditado como Saldo a Favor del cliente`, "success");
        } catch(e) {
          showToast("Devolución OK — no se pudo acreditar saldo (revisar manualmente)", "warning");
        }
      } else {
        showToast("Devolución aplicada correctamente", "success");
      }
      closeModal("modal-returns");
    } catch(e) {
      showToast("Error de conexión al procesar devolución", "error");
      if (btn) btn.disabled = false;
    }
  } else {
    // Cajero / Vendedor → levanta solicitud, admin autoriza
    const solicitudItems = items.map(i => ({ sku: i.product_sku, qty: i.quantity_returned }));
    const detalle = [
      `Devolución por recibo #${saleId}`,
      `Método reembolso: ${refundMethod}`,
      notes || null
    ].filter(Boolean).join(" — ");

    try {
      const res = await apiFetch(`${API_BASE}/devoluciones/solicitud`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sale_id: String(saleId),
          ticket_ref: String(saleId),
          client_id: clientId ? String(clientId) : null,
          items: solicitudItems,
          detalle
        })
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        showToast(err.detail || "Error al enviar la solicitud", "error");
        if (btn) btn.disabled = false;
        return;
      }
      showToast("Solicitud enviada — Admin/Gerente recibirá notificación para autorizar", "info");
      closeModal("modal-returns");
    } catch(e) {
      showToast("Error de conexión al enviar solicitud", "error");
      if (btn) btn.disabled = false;
    }
  }
}

// --- ALTA DE CLIENTE FEATURES ---

let currentEmails = [];

function renderEmails() {
    const container = document.getElementById('nc-email-container');
    if (!container) return;
    
    // Remove all current pill elements
    const pills = container.querySelectorAll('.email-pill');
    pills.forEach(p => p.remove());
    
    // Create new pills
    const input = document.getElementById('nc-email-input');
    currentEmails.forEach((email, index) => {
        const pill = document.createElement('div');
        pill.className = 'email-pill bg-indigo-100 text-indigo-700 px-2 py-0.5 rounded text-[11px] font-semibold flex items-center gap-1';
        pill.innerHTML = `${email} <i data-lucide="x" class="w-3 h-3 cursor-pointer hover:text-indigo-900" onclick="removeEmail(${index})"></i>`;
        container.insertBefore(pill, input);
    });
    
    if (window.lucide) {
        lucide.createIcons();
    }
}

function removeEmail(index) {
    currentEmails.splice(index, 1);
    renderEmails();
}

function initNewClientFeatures() {
    // 2. Email Pills
    const emailInput = document.getElementById('nc-email-input');
    if (emailInput) {
        emailInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                const val = emailInput.value.trim();
                if (val && val.includes('@')) {
                    if(!currentEmails.includes(val)) {
                        currentEmails.push(val);
                        renderEmails();
                    }
                    emailInput.value = '';
                }
            }
        });
        renderEmails();
    }
    
    // 3. Drag & Drop Constancia
    const dropZone = document.getElementById('nc-upload-zone');
    const preview = document.getElementById('nc-upload-preview');
    
    if (dropZone) {
        dropZone.addEventListener('dragover', (e) => {
            e.preventDefault();
            dropZone.classList.add('bg-indigo-50', 'border-indigo-400');
        });
        
        dropZone.addEventListener('dragleave', (e) => {
            e.preventDefault();
            dropZone.classList.remove('bg-indigo-50', 'border-indigo-400');
        });
        
        dropZone.addEventListener('drop', (e) => {
            e.preventDefault();
            dropZone.classList.remove('bg-indigo-50', 'border-indigo-400');
            
            const file = e.dataTransfer.files[0];
            if (!file) return;

            // Show preview / loading state
            if (preview) {
                preview.classList.remove('hidden', 'opacity-0');
                preview.classList.add('flex', 'opacity-100');
            }
            
            showToast("Leyendo Constancia Fiscal del SAT...", "info");
            
            const formData = new FormData();
            formData.append("file", file);
            
            apiFetch("/api/constancia", {
                method: "POST",
                body: formData
            })
            .then(res => res.json())
            .then(data => {
                if (data.success && (data.rfc || data.nombre)) {
                    // Helper: set value and flash green
                    const setVal = (id, val) => {
                        if (!val) return;
                        const el = document.getElementById(id);
                        if (el) {
                            el.value = val;
                            el.classList.add('border-green-400');
                            setTimeout(() => el.classList.remove('border-green-400'), 2000);
                        }
                    };

                    setVal('nc-razon-social', data.nombre);
                    setVal('nc-nombre-comercial', data.nombre_comercial);
                    setVal('nc-rfc', data.rfc);

                    // Direccion fiscal explicita
                    setVal('nc-direccion', data.direccion);
                    setVal('nc-numero-ext', data.numero_ext);
                    setVal('nc-numero-int', data.numero_int);
                    setVal('nc-colonia', data.colonia);
                    setVal('nc-ciudad', data.localidad);
                    setVal('nc-municipio', data.municipio);
                    setVal('nc-estado', data.estado);
                    setVal('nc-cp', data.cp);
                    setTimeout(syncProfileCard, 100);

                    // Estatus activo
                    if (data.estatus === 'ACTIVO') {
                        showToast("✅ Constancia válida — RFC ACTIVO en el SAT", "success");
                    } else {
                        showToast(`⚠️ RFC ${data.rfc} — Estatus: ${data.estatus || 'Desconocido'}`, "warning");
                    }

                    // Llenar campos nc-* si existen (vista Alta de Cliente)
                    setVal('nc-rfc', data.rfc);
                    setVal('nc-razon-social', data.nombre);
                    // El usuario pidió que el nombre comercial sea igual a la razón social con espacios
                    setVal('nc-nombre-comercial', data.nombre);

                    // Inyectando Mapa e ID
                    const mapPreview = document.getElementById('nc-mapa-preview');
                    if (mapPreview) {
                        const dDir = data.direccion || '';
                        const dCol = data.localidad || '';
                        const dMun = data.municipio || '';
                        const dEst = data.estado || '';
                        const dCp = data.cp || '';
                        const queryMap = `${dDir} ${dCol} ${dMun} ${dEst} ${dCp}`.trim();
                        if (queryMap) {
                            mapPreview.innerHTML = `<iframe width="100%" height="100%" frameborder="0" style="border:0" src="https://maps.google.com/maps?q=${encodeURIComponent(queryMap)}&t=&z=15&ie=UTF8&iwloc=&output=embed" allowfullscreen></iframe>`;
                            mapPreview.classList.remove("bg-slate-200");
                            mapPreview.style.backgroundImage = 'none';
                        }
                    }
                    
                    const idInput = document.getElementById('nc-id-cliente');
                    if(idInput && !idInput.value && !window.currentEditClientId) {
                        idInput.value = 'Se generará al guardar';
                        const perfilId = document.getElementById('perfil-id');
                        if(perfilId) perfilId.innerText = idInput.value;
                    }

                    
                    // Update Profile Card
                    const perfilNombre = document.getElementById('perfil-nombre');
                    if(perfilNombre) perfilNombre.innerText = data.nombre || 'Nuevo Cliente';
                    const perfilRfc = document.getElementById('perfil-rfc');
                    if(perfilRfc) perfilRfc.innerText = data.rfc || 'Sin RFC';
                    
                    // Seleccionar régimen fiscal (el backend ahora envía el código 3 dígitos directamente, ej '612')
                    if (data.regimen) {
                        const regimenSelect = document.getElementById('nc-regimen');
                        if (regimenSelect) {
                            let matchFound = false;
                            for (let i = 0; i < regimenSelect.options.length; i++) {
                                if (regimenSelect.options[i].value === data.regimen || regimenSelect.options[i].text.includes(data.regimen)) {
                                    regimenSelect.selectedIndex = i;
                                    regimenSelect.classList.add('border-green-400');
                                    setTimeout(() => regimenSelect.classList.remove('border-green-400'), 2000);
                                    matchFound = true;
                                    
                                    // Set moral/fisica based on regimen
                                    let isMoral = false;
                                    if (data.regimen === '601' || data.regimen === '603' || data.regimen === '620' || data.regimen === '622' || data.regimen === '609' || data.regimen === '623' || data.regimen === '624') {
                                        document.getElementById('nc-moral')?.click();
                                        isMoral = true;
                                    } else {
                                        document.getElementById('nc-fisica')?.click();
                                    }
                                    const perfilTipo = document.getElementById('perfil-tipo');
                                    if(perfilTipo) perfilTipo.innerText = isMoral ? 'Moral' : 'Física';
                                    break;
                                }
                            }
                        }
                    }

                } else if (data.is_image) {
                    showToast("⚠️ Imagen detectada — extracción manual requerida", "warning");
                } else {
                    showToast("No se pudieron extraer datos. ¿Es una Constancia del SAT?", "error");
                }
            })
            .catch(() => {
                showToast("Error al conectar con el servidor", "error");
            })
            .finally(() => {
                setTimeout(() => {
                    if (preview) {
                        preview.classList.remove('opacity-100');
                        preview.classList.add('opacity-0');
                        setTimeout(() => {
                            if (preview) {
                                preview.classList.remove('flex');
                                preview.classList.add('hidden');
                            }
                        }, 300);
                    }
                }, 4000);
            });
        });
    }
}

// Call init once the DOM is ready or view is shown
document.addEventListener('DOMContentLoaded', () => {
    setTimeout(initNewClientFeatures, 1000); // Small delay to ensure elements exist if dynamically loaded
});


window.openGoogleMaps = function() {
    const dir = document.getElementById('nc-direccion')?.value || '';
    const mun = document.getElementById('nc-municipio')?.value || '';
    const est = document.getElementById('nc-estado')?.value || '';
    const query = `${dir} ${mun} ${est}`.trim();
    if(query) {
        window.open(`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`, '_blank');
    } else {
        showToast("Ingresa una dirección primero", "warning");
    }
};


// Sincronizar Tarjeta de Perfil

const syncProfileCard = () => {
    const rfcel = document.getElementById('nc-rfc');
    const razon = document.getElementById('nc-razon-social');
    const pNombre = document.getElementById('perfil-nombre');
    const pRfc = document.getElementById('perfil-rfc');
    const pTipo = document.getElementById('perfil-tipo');
    const idInput = document.getElementById('nc-id-cliente');
    const pId = document.getElementById('perfil-id');
    
    if (pNombre && razon) pNombre.innerText = razon.value || 'Nuevo Cliente';
    if (pRfc && rfcel) pRfc.innerText = rfcel.value || '-';
    const waInput = document.getElementById('nc-whatsapp');
    if (pId && idInput) {
        let val = idInput.value || 'Se generará al guardar';
        if (val === '-' || val === '') val = 'Se generará al guardar';
        if (waInput && waInput.value) {
            val += ` / WA: ${waInput.value}`;
        }
        pId.innerText = val;
    }
    
    const fis = document.getElementById('nc-pfisica');
    if (fis && pTipo) pTipo.innerText = fis.checked ? 'Física' : 'Moral';
};

// Credit Sync
const syncCredit = () => {
    const limiteInput = document.getElementById('nc-limite-credito');
    let val = limiteInput ? limiteInput.value.replace(/[^0-9.]/g, '') : 0;
    val = parseFloat(val) || 0;
    
    const formatted = new Intl.NumberFormat('es-MX', {style: 'currency', currency: 'MXN'}).format(val);
    
    const grDisp = document.getElementById('grafica-limite-disp');
    const grPct = document.getElementById('grafica-limite-pct');
    const pMonto = document.getElementById('perfil-limite-monto');
    const pDisp = document.getElementById('perfil-limite-disponible');
    
    if (grDisp) grDisp.innerText = formatted;
    if (grPct) grPct.innerText = val > 0 ? '100%' : '0%';
    if (pMonto) pMonto.innerText = formatted;
    if (pDisp) pDisp.innerText = formatted;
};

document.addEventListener('DOMContentLoaded', () => {
    document.querySelectorAll('#nc-razon-social, #nc-rfc, input[name="nc-tipo"], #nc-id-cliente, #nc-whatsapp').forEach(el => {
        if(el) {
            el.addEventListener('input', syncProfileCard);
            el.addEventListener('change', syncProfileCard);
        }
    });
    
    const limiteInput = document.getElementById('nc-limite-credito');
    if (limiteInput) {
        limiteInput.addEventListener('input', syncCredit);
        limiteInput.addEventListener('blur', () => {
            let val = limiteInput.value.replace(/[^0-9.]/g, '');
            if (val) limiteInput.value = new Intl.NumberFormat('es-MX', {style: 'currency', currency: 'MXN'}).format(parseFloat(val));
        });
    }
});


// Navegacion con Enter
document.addEventListener('keydown', function(e) {
    const view = document.getElementById('new-client-view');
    if (view && !view.classList.contains('hidden')) {
        if (e.key === 'Escape') {
            e.preventDefault();
            e.stopPropagation();
            setView('clients');
            return;
        }
        if (e.key === 'Enter') {
            if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') {
                e.preventDefault();
                const formElements = Array.from(view.querySelectorAll('input:not([type="hidden"]):not(:disabled), select:not(:disabled), button:not(:disabled)'));
                const index = formElements.indexOf(e.target);
                if (index > -1 && index < formElements.length - 1) {
                    formElements[index + 1].focus();
                }
            }
        }
    }
});


// Validacion de ID duplicado (Simulado frontend)
let debounceIdTimer;
const checkDuplicateId = (id) => {
    if(!id) return;
    // Simulacion de base de datos
    const dummyDb = ['CLI-12345', '5512345678'];
    if(dummyDb.includes(id)) {
        if(window.Swal) {
            Swal.fire({
                icon: 'warning',
                title: 'Cliente Duplicado',
                text: `El ID o WhatsApp "${id}" ya se encuentra registrado con otro cliente.`,
                confirmButtonColor: '#4f46e5',
                confirmButtonText: 'Revisar'
            });
        } else {
            alert(`ALARMA: El ID o WhatsApp ${id} ya existe en la base de datos.`);
        }
    }
};

const handleIdValidation = (e) => {
    clearTimeout(debounceIdTimer);
    debounceIdTimer = setTimeout(() => {
        checkDuplicateId(e.target.value);
    }, 800);
};

document.addEventListener('DOMContentLoaded', () => {
    const idInput = document.getElementById('nc-id-cliente');
    const waInput = document.getElementById('nc-whatsapp');
    if(idInput) idInput.addEventListener('input', handleIdValidation);
    if(waInput) waInput.addEventListener('input', handleIdValidation);
});


// \u2500\u2500 OS BACK BUTTON: inicializar desde JS externo (CSP: script-src 'self') \u2500\u2500\u2500
// app_v66.js se carga con defer \u2192 el DOM ya est\u00e1 completo cuando este c\u00f3digo corre.
// No se necesita DOMContentLoaded; se llama directamente al final del script.
(function initializeOSBackButton() {
  var btn = document.getElementById('os-back-btn');
  if (!btn || btn.dataset.osInit === '1') return; // evitar doble registro
  btn.dataset.osInit = '1';

  // Mostrar solo si el POS fue abierto desde CALEBSYS OS (mismo origin, misma pesta\u00f1a)
  if (sessionStorage.getItem('calebsys_from_os') === '1') {
    btn.style.display = 'flex';
  }

  // Regresar al OS al hacer clic (sin onclick inline \u2014 CSP seguro)
  btn.addEventListener('click', function() {
    window.location.href = '/os';
  });
}());


// ── E-01: Reloj auto-check para roles operativos en POS ──────────────────────
// RH-04 (Don Antonio 02-09-2026): solo Admin (dueño del Tenant) y SuperAdmin
// (dueño del software) están exentos del reloj. Gerente (admin de sede) SÍ checa.
//
// El modal #relojModal ahora vive dentro del propio index.html; reloj-embed.js
// consulta /api/asistencia/reloj/estado-hoy y, si el empleado no ha fichado hoy,
// abre el modal ahí mismo (sin banner, sin salir del POS). Esta función queda
// como puente para el llamado que hace 01-core.js tras el login.
// ──────────────────────────────────────────────────────────────────────────────

function _posTriggerRelojCheck() {
  if (window.CalebsysReloj && typeof window.CalebsysReloj.checkAndOpen === 'function') {
    window.CalebsysReloj.checkAndOpen();
  }
}

window._posTriggerRelojCheck = _posTriggerRelojCheck;

// ── LOGOUT (POS) ──────────────────────────────────────────────────────────────
// Referenciado desde index.html (boton Cerrar Sesion):
//   onclick="if(confirm('Cerrar sesion?')) logout()"
// Limpia TODA la sesion del POS antes de redirigir al login.
// ──────────────────────────────────────────────────────────────────────────────
function logout() {
  const keysToRemove = [
    'calebsys_token', 'calebsys_role', 'calebsys_user',
    'calebsys_username', 'calebsys_display_name',
    'calebsys_company', 'calebsys_branch',
    'pos_cart', 'pos_active_client',
    'pos_active_price_scale', 'pos_temp_price_scale'
  ];
  keysToRemove.forEach(function(k) { localStorage.removeItem(k); });
  // Limpiar cache aislado por tenant (pos_walk_in_db_id:<empresa>)
  Object.keys(localStorage)
    .filter(function(k) { return k.startsWith('pos_walk_in_db_id'); })
    .forEach(function(k) { localStorage.removeItem(k); });
  window.location.href = '/login';
}
