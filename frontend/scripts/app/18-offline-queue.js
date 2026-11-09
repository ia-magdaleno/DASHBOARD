// D-4: Offline POS queue backed by IndexedDB
// Queues sales when navigator.onLine === false; syncs on reconnect.

const _OQ_DB_NAME = 'calebsys_offline_v1';
const _OQ_STORE   = 'pending_sales';
let   _oqDb       = null;

function _oqOpenDB() {
  return new Promise((resolve, reject) => {
    if (_oqDb) { resolve(_oqDb); return; }
    const req = indexedDB.open(_OQ_DB_NAME, 1);
    req.onupgradeneeded = ev => {
      const db = ev.target.result;
      if (!db.objectStoreNames.contains(_OQ_STORE)) {
        db.createObjectStore(_OQ_STORE, { keyPath: 'local_id', autoIncrement: true });
      }
    };
    req.onsuccess = ev => { _oqDb = ev.target.result; resolve(_oqDb); };
    req.onerror   = ev => reject(ev.target.error);
  });
}

function _oqUpdateBadge(count) {
  const wrapper = document.getElementById('offline-queue-wrapper');
  const badge   = document.getElementById('offline-queue-badge');
  if (!wrapper || !badge) return;
  if (count > 0) {
    badge.textContent = count;
    wrapper.hidden = false;
  } else {
    wrapper.hidden = true;
  }
}

async function _oqRefreshBadge() {
  try {
    const db = await _oqOpenDB();
    const count = await new Promise((res, rej) => {
      const tx  = db.transaction(_OQ_STORE, 'readonly');
      const req = tx.objectStore(_OQ_STORE).count();
      req.onsuccess = ev => res(ev.target.result);
      req.onerror   = ev => rej(ev.target.error);
    });
    _oqUpdateBadge(count);
    return count;
  } catch (_) { return 0; }
}

// Push a sale to the offline queue. Returns the auto-incremented local_id.
async function offlineQueuePush(saleBody) {
  const db = await _oqOpenDB();
  return new Promise((resolve, reject) => {
    const tx    = db.transaction(_OQ_STORE, 'readwrite');
    const store = tx.objectStore(_OQ_STORE);
    const req   = store.add({
      sale_body:  saleBody,
      queued_at:  new Date().toISOString(),
      status:     'pending'
    });
    req.onsuccess = ev => resolve(ev.target.result);
    req.onerror   = ev => reject(ev.target.error);
  });
}

// Attempt to sync all pending sales to the server.
async function offlineQueueSync() {
  let records;
  try {
    const db = await _oqOpenDB();
    records = await new Promise((res, rej) => {
      const tx  = db.transaction(_OQ_STORE, 'readonly');
      const req = tx.objectStore(_OQ_STORE).getAll();
      req.onsuccess = ev => res(ev.target.result);
      req.onerror   = ev => rej(ev.target.error);
    });
  } catch (_) { return; }

  if (!records.length) return;

  let synced = 0;
  let failed = 0;

  for (const rec of records) {
    if (!navigator.onLine) break;
    try {
      const res = await apiFetch(`${API_BASE}/sales`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(rec.sale_body)
      });
      if (res.ok) {
        const db2 = await _oqOpenDB();
        await new Promise((res2, rej2) => {
          const tx  = db2.transaction(_OQ_STORE, 'readwrite');
          const req = tx.objectStore(_OQ_STORE).delete(rec.local_id);
          req.onsuccess = () => res2();
          req.onerror   = ev => rej2(ev.target.error);
        });
        synced++;
      } else {
        failed++;
      }
    } catch (_) {
      failed++;
    }
  }

  await _oqRefreshBadge();

  if (synced > 0 && typeof showToast === 'function') {
    showToast(`${synced} venta(s) sin conexión sincronizada(s).`, 'success');
  }
  if (failed > 0 && typeof showToast === 'function') {
    showToast(`${failed} venta(s) no pudieron sincronizarse. Se reintentará al reconectar.`, 'warning');
  }
}

// Wire up reconnect auto-sync
window.addEventListener('online', () => {
  if (typeof showToast === 'function') {
    showToast('Conexión restaurada — sincronizando ventas pendientes...', 'info');
  }
  offlineQueueSync().catch(() => {});
});

// Init: open DB + refresh badge after DOM is ready
document.addEventListener('DOMContentLoaded', () => {
  _oqOpenDB()
    .then(_oqRefreshBadge)
    .catch(e => console.warn('[offline-queue] IDB no disponible:', e));
});
