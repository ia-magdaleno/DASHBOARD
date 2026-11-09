/* 09-transfers-ai.js — CTRL+T traspasos, CTRL+I asistente IA
   Extraido de app_v66.js (fase 3, modularizacion post-auditoria 2026-08-03) */

// --- CTRL+T: TRASPASOS ---

function _trfGetRole() {
  const token = localStorage.getItem('calebsys_token');
  if (!token) return '';
  try {
    const p = JSON.parse(atob(token.split('.')[1]));
    return (p.role || p.rol || '').toUpperCase();
  } catch(e) { return ''; }
}

let _trfWarehouses = [];

async function loadTransferWarehouses() {
  try {
    const res = await apiFetch(`${API_BASE}/warehouses`);
    if (!res.ok) return;
    _trfWarehouses = await res.json();

    const src = document.getElementById('trf-source-wh');
    const dst = document.getElementById('trf-dest-wh');
    if (!src || !dst) return;

    const opts = _trfWarehouses.map(w =>
      `<option value="${escHTML(String(w.id))}">${escHTML(w.name)}</option>`
    ).join('');
    src.innerHTML = '<option value="">— Selecciona origen —</option>' + opts;
    dst.innerHTML = '<option value="">— Selecciona destino —</option>' + opts;

    const role = _trfGetRole();
    const badge = document.getElementById('trf-role-badge');
    if (badge) {
      const authorized = ['ADMIN', 'ALMACENISTA', 'GERENTE'].includes(role);
      badge.textContent = authorized
        ? `${role} — Traspaso directo`
        : `${role} — Solicitud (requiere autorización)`;
      badge.className = `text-[9px] font-black uppercase tracking-wider px-2 py-1 rounded-lg text-center ${
        authorized ? 'bg-green-100 text-green-800' : 'bg-amber-100 text-amber-800'
      }`;
      badge.classList.remove('hidden');
    }
  } catch(e) {}
}

let _stockCheckTimer = null;
function checkTransferStock() {
  clearTimeout(_stockCheckTimer);
  _stockCheckTimer = setTimeout(async () => {
    const sku = (document.getElementById('trf-sku-input')?.value || '').trim();
    const srcId = document.getElementById('trf-source-wh')?.value || '';
    const el = document.getElementById('trf-stock-info');
    if (!el) return;
    if (!sku || !srcId) { el.textContent = ''; return; }

    try {
      const res = await apiFetch(
        `${API_BASE}/warehouse-stock?product_sku=${encodeURIComponent(sku)}&warehouse_id=${encodeURIComponent(srcId)}`
      );
      if (!res.ok) { el.textContent = ''; return; }
      const data = await res.json();
      const qty = Array.isArray(data)
        ? (data[0]?.quantity ?? data[0]?.stock ?? 0)
        : (data.quantity ?? data.stock ?? 0);
      el.textContent = `Disponible en origen: ${qty}`;
      el.className = `text-[10px] font-bold mt-1 h-4 ${qty > 0 ? 'text-green-600' : 'text-red-500'}`;
    } catch(e) { el.textContent = ''; }
  }, 400);
}

async function submitTransferForm(e) {
  if (e) e.preventDefault();

  const srcId = document.getElementById('trf-source-wh')?.value || '';
  const dstId = document.getElementById('trf-dest-wh')?.value || '';
  const sku   = (document.getElementById('trf-sku-input')?.value || '').trim();
  const qty   = parseFloat(document.getElementById('trf-qty-input')?.value || '0');
  const mode  = document.getElementById('trf-delivery-mode')?.value || 'Interno';
  const notes = (document.getElementById('trf-notes')?.value || '').trim();

  if (!srcId)          { showToast('Selecciona el almacén de origen.', 'warning'); return; }
  if (!dstId)          { showToast('Selecciona el almacén destino.', 'warning'); return; }
  if (srcId === dstId) { showToast('Origen y destino no pueden ser el mismo almacén.', 'warning'); return; }
  if (!sku)            { showToast('Ingresa el SKU del producto.', 'warning'); return; }
  if (isNaN(qty) || qty <= 0) { showToast('Ingresa una cantidad válida mayor a 0.', 'warning'); return; }

  const role = _trfGetRole();
  const isAuthorized = ['ADMIN', 'ALMACENISTA', 'GERENTE'].includes(role);

  const btn = document.querySelector('#transfer-form button[type="submit"]');
  if (btn) { btn.disabled = true; btn.querySelector('span').textContent = 'Procesando…'; }

  try {
    if (isAuthorized) {
      const idempKey = `trf-${Date.now()}-${Math.random().toString(36).slice(2,8)}`;
      const notesFull = [mode !== 'Interno' ? mode : null, notes].filter(Boolean).join(' | ') || null;
      const res = await apiFetch(`${API_BASE}/warehouse/transfer`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          product_sku: sku,
          quantity: qty,
          source_warehouse_id: srcId,
          destination_warehouse_id: dstId,
          notes: notesFull,
          idempotency_key: idempKey
        })
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || `Error HTTP ${res.status}`);
      }
      showToast('Traspaso realizado. Stock actualizado en ambos almacenes.', 'success');
      closeModal('modal-transfers');
    } else {
      const res = await apiFetch(`${API_BASE}/traspasos/solicitud`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          product_sku: sku,
          quantity: qty,
          source_warehouse_id: srcId,
          destination_warehouse_id: dstId,
          delivery_mode: mode,
          notes: notes || null
        })
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || `Error HTTP ${res.status}`);
      }
      showToast('Solicitud enviada. El almacenista procesará el traspaso.', 'info');
      closeModal('modal-transfers');
    }
  } catch(err) {
    showToast(`Error: ${err.message}`, 'error');
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.querySelector('span').textContent = 'Realizar Traspaso';
    }
  }
}


// --- CTRL+I: ASISTENTE IA ---

function sendAIQuery() {
  const queryInput = document.getElementById("ai-assistant-query");
  const query = queryInput.value.trim();
  if (!query) return;

  const chatHistory = document.getElementById("ai-chat-history");

  const userDiv = document.createElement("div");
  userDiv.className = "bg-slate-100 text-slate-800 p-3 rounded-2xl leading-relaxed self-end text-right ml-12";
  userDiv.innerHTML = `<b>Tú:</b> ${escHTML(query)}`;
  chatHistory.appendChild(userDiv);

  queryInput.value = "";
  chatHistory.scrollTop = chatHistory.scrollHeight;

  const loadingDiv = document.createElement("div");
  loadingDiv.className = "bg-blue-50 text-blue-900 p-3 rounded-2xl leading-relaxed animate-pulse";
  loadingDiv.innerText = "Pensando...";
  chatHistory.appendChild(loadingDiv);
  chatHistory.scrollTop = chatHistory.scrollHeight;

  apiFetch(`${API_BASE}/ai/query?q=${encodeURIComponent(query)}`)
    .then(res => res.json())
    .then(data => {
      loadingDiv.remove();
      const aiDiv = document.createElement("div");
      aiDiv.className = "bg-blue-50 text-blue-900 p-3 rounded-2xl leading-relaxed mr-12";
      aiDiv.innerHTML = `<b>Asistente:</b> ${escHTML(data.reply)}`;
      chatHistory.appendChild(aiDiv);
      chatHistory.scrollTop = chatHistory.scrollHeight;
    })
    .catch(() => {
      loadingDiv.remove();
      const errDiv = document.createElement("div");
      errDiv.className = "bg-red-50 text-red-900 p-3 rounded-2xl leading-relaxed mr-12";
      errDiv.innerHTML = `<b>Error:</b> No se pudo establecer conexión con el asistente local.`;
      chatHistory.appendChild(errDiv);
      chatHistory.scrollTop = chatHistory.scrollHeight;
    });
}
