// ════════════════════════════════════════════════
// MODULE MANAGER
// ════════════════════════════════════════════════
const MODULE_META = {
  home:        { label: 'Inicio',           icon: '🏠' },
  pos:         { label: 'Punto de Venta',   icon: '🖥️' },
  admin:       { label: 'Administración',   icon: '⚙️' },
  social:      { label: 'Redes Sociales',   icon: '📱' },
  gps:         { label: 'GPS Tracking',     icon: '📍' },
  contabilidad:{ label: 'El Contador',      icon: '📊' },
  ia:          { label: 'iAMAGDALENO IA',   icon: '🤖' },
  perfil:      { label: 'Mi Perfil',        icon: '👤' },
};

let activeModule = 'home';
let openTabs = ['home'];

function openModule(id) {
  if (id === 'pos') {
    launchPOS();
    return;
  }
  if (id === 'admin') {
    window.location.href = '/admin';
    return;
  }
  if (!MODULE_META[id]) return;

  // Add to tabs if not already open
  if (!openTabs.includes(id)) {
    openTabs.push(id);
    renderTabs();
  }
  switchTo(id);
}

function launchPOS() {
  // Guarda marca para que el POS sepa de dónde viene
  sessionStorage.setItem('calebsys_from_os', '1');
  window.location.href = '/';
}

function switchTo(id) {
  activeModule = id;

  // Hide all panels
  document.querySelectorAll('.module-panel').forEach(p => p.classList.remove('active'));

  // Show target
  const panel = document.getElementById('panel-' + id);
  if (panel) panel.classList.add('active');

  // Update sidebar nav active
  document.querySelectorAll('.sb-item').forEach(el => el.classList.remove('active'));
  const navEl = document.getElementById('nav-' + id);
  if (navEl) navEl.classList.add('active');

  // Update breadcrumb
  const meta = MODULE_META[id];
  document.getElementById('tb-module-name').textContent = meta.label;

  // Lazy-load module data
  if (id === 'clientes') loadClientes();
  if (id === 'home')     loadDashboard();

  renderTabs();
}

function closeTab(id, e) {
  e && e.stopPropagation();
  openTabs = openTabs.filter(t => t !== id);
  if (openTabs.length === 0) openTabs = ['home'];
  if (activeModule === id) switchTo(openTabs[openTabs.length - 1]);
  else renderTabs();
}

function renderTabs() {
  const bar = document.getElementById('tabs-bar');
  // Remove old tabs (keep the + button)
  bar.querySelectorAll('.app-tab').forEach(t => t.remove());
  const plusBtn = bar.querySelector('.new-tab-btn');

  openTabs.forEach(id => {
    const meta = MODULE_META[id];
    if (!meta) return;
    const tab = document.createElement('div');
    tab.className = 'app-tab' + (id === activeModule ? ' active' : '');
    tab.innerHTML = `<span class="tab-icon">${meta.icon}</span>${meta.label}<span class="tab-close" onclick="closeTab('${id}',event)">✕</span>`;
    tab.onclick = () => switchTo(id);
    bar.insertBefore(tab, plusBtn);
  });
}

// ════════════════════════════════════════════════
// CLOCK
// ════════════════════════════════════════════════
function updateClock() {
  const now = new Date();
  document.getElementById('tb-time').textContent = now.toLocaleTimeString('es-MX', {hour:'2-digit',minute:'2-digit'});
  document.getElementById('tb-date').textContent = now.toLocaleDateString('es-MX', {weekday:'short',day:'2-digit',month:'short'});
  // Greeting
  const h = now.getHours();
  const gr = h < 12 ? '¡Buenos días!' : h < 18 ? '¡Buenas tardes!' : '¡Buenas noches!';
  const grEl = document.querySelector('.greeting-title');
  if (grEl) grEl.textContent = gr + ' 👋';
}
setInterval(updateClock, 1000); updateClock();

// ════════════════════════════════════════════════
// KEYBOARD SHORTCUTS
// ════════════════════════════════════════════════
const SHORTCUTS = { F1:'pos', F2:'admin', F3:'social', F4:'gps', F5:'contabilidad', F9:'ia' };
document.addEventListener('keydown', e => {
  // Allow Ctrl+F5 or Shift+F5 or regular F5 by bypassing if the shortcut is just F5 but we've removed it from SHORTCUTS
  if (e.key in SHORTCUTS && !e.ctrlKey && !e.shiftKey) { e.preventDefault(); openModule(SHORTCUTS[e.key]); }
  if (e.key === 'Escape') openModule('home');
});

// ════════════════════════════════════════════════
// NOTIFICATIONS
// ════════════════════════════════════════════════
function notify(msg, sub='', type='info') {
  const stack = document.getElementById('notif-stack');
  const icons = { info:'ℹ️', success:'✅', error:'❌' };
  const n = document.createElement('div');
  n.className = `notif ${type}`;
  n.innerHTML = `<span>${icons[type]||'ℹ️'}</span><div><div class="notif-body">${msg}</div>${sub?`<div class="notif-sub">${sub}</div>`:''}</div>`;
  stack.appendChild(n);
  setTimeout(() => n.remove(), 3500);
}

// ════════════════════════════════════════════════
// MÓDULO CLIENTES — CRM completo
// ════════════════════════════════════════════════
let _allClientes = [];
let _sortAsc = true;
let _clientesLoaded = false;

async function loadClientes() {
  if (_clientesLoaded && _allClientes.length > 0) return; // ya cargado
  const tbody = document.getElementById('clientes-tbody');
  if (!tbody) return;
  tbody.innerHTML = '<tr><td colspan="9" style="text-align:center;padding:40px;color:var(--text3)">Cargando clientes...</td></tr>';
  try {
    const res = await fetch('/api/clients?limit=2000');
    if (!res.ok) throw new Error('Error ' + res.status);
    _allClientes = await res.json();
    _clientesLoaded = true;
    renderClientes(_allClientes);
  } catch(err) {
    tbody.innerHTML = `<tr><td colspan="9" style="text-align:center;padding:40px;color:var(--red)">Error al cargar: ${err.message}</td></tr>`;
  }
}

function renderClientes(list) {
  const tbody = document.getElementById('clientes-tbody');
  const count = document.getElementById('cli-count');
  if (!tbody) return;
  if (count) count.textContent = `${list.length} cliente${list.length !== 1 ? 's' : ''}`;
  if (list.length === 0) {
    tbody.innerHTML = '<tr><td colspan="9" style="text-align:center;padding:40px;color:var(--text3)">No se encontraron clientes</td></tr>';
    return;
  }
  const fmt$ = n => n > 0 ? '$ ' + Number(n).toLocaleString('es-MX', {minimumFractionDigits:2,maximumFractionDigits:2}) : '$';
  const cellR = 'padding:10px 14px;text-align:right;border-bottom:1px solid var(--surface3)';
  const cellC = 'padding:10px 14px;text-align:center;border-bottom:1px solid var(--surface3)';
  const cellL = 'padding:10px 14px;text-align:left;border-bottom:1px solid var(--surface3)';

  tbody.innerHTML = list.map((c, idx) => {
    const hasCredit = c.saldo_actual > 0;
    const saldoColor = hasCredit ? 'color:#f59e0b;font-weight:800' : '';
    const isEven = idx % 2 === 0;
    const rowBg = isEven ? 'background:var(--surface)' : 'background:#fafbfc';
    return `
    <tr style="${rowBg};cursor:pointer;transition:background .1s" onmouseover="this.style.background='#eff6ff'" onmouseout="this.style.background='${isEven ? 'var(--surface)' : '#fafbfc'}'">
      <td style="${cellL};font-weight:600;color:var(--text2);font-size:.7rem">${c.phone || c.id}</td>
      <td style="${cellL}">
        <div style="font-weight:800;color:var(--text);font-size:.78rem">${c.name}</div>
        ${c.rfc ? `<div style="font-size:.6rem;color:var(--text3)">${c.rfc}</div>` : ''}
      </td>
      <td style="${cellR}"><span style="color:var(--green);font-weight:700">${fmt$(c.saldo_favor)}</span></td>
      <td style="${cellR}">${fmt$(c.limite_credito)}</td>
      <td style="${cellR}"><span style="${saldoColor}">${fmt$(c.saldo_actual)}</span></td>
      <td style="${cellR}">${fmt$(c.apartados)}</td>
      <td style="${cellC};color:var(--text2)">${c.ultima_compra || 'S/N'}</td>
      <td style="${cellC}">
        ${c.resguardos ? '<span style="color:var(--green);font-size:1rem">✓</span>' : '<span style="color:var(--text3)">-</span>'}
      </td>
      <td style="${cellC};font-weight:800;color:var(--text)">${c.puntos > 0 ? c.puntos : ''}</td>
    </tr>`;
  }).join('');
}

function filterClientes(q) {
  q = q.toLowerCase().trim();
  if (!q) { renderClientes(_allClientes); return; }
  const filtered = _allClientes.filter(c =>
    (c.name || '').toLowerCase().includes(q) ||
    (c.phone || '').toLowerCase().includes(q) ||
    (c.rfc || '').toLowerCase().includes(q) ||
    (c.email || '').toLowerCase().includes(q)
  );
  renderClientes(filtered);
}

function sortClientes() {
  _sortAsc = !_sortAsc;
  const sorted = [..._allClientes].sort((a, b) =>
    _sortAsc ? a.name.localeCompare(b.name) : b.name.localeCompare(a.name)
  );
  renderClientes(sorted);
}

function exportClientes() {
  const rows = [['ID','Nombre','RFC','Teléfono','Saldo Favor','Límite Crédito','Saldo Actual','Apartados','Última Compra','Puntos']];
  _allClientes.forEach(c => rows.push([c.id, c.name, c.rfc||'', c.phone||'', c.saldo_favor, c.limite_credito, c.saldo_actual, c.apartados, c.ultima_compra||'', c.puntos]));
  const csv = rows.map(r => r.map(v => `"${v}"`).join(',')).join('\n');
  const a = document.createElement('a');
  a.href = 'data:text/csv;charset=utf-8,' + encodeURIComponent(csv);
  a.download = 'clientes_calebsys.csv';
  a.click();
}

function openNewClientModal() {
  notify('Módulo nuevo cliente', 'Disponible en el POS con tecla INS', 'info');
}


// ════════════════════════════════════════════════
// DASHBOARD — DATOS EN TIEMPO REAL
// ════════════════════════════════════════════════

let mainChart = null;
let currentDashboardData = null;

function updateMainChart() {
  if (!currentDashboardData) return;
  const d = currentDashboardData;
  const range = document.getElementById('main-chart-select').value;
  const titleEl = document.getElementById('main-chart-title');
  const fmt = n => '$' + Number(n).toLocaleString('es-MX', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
  
  let labels = [];
  let data = [];
  let titleStr = '';
  let lblTotal = 'TOTAL VENTAS';
  let lblAvg = '';
  let lblMax = '';

  if (range === 'hoy') {
    titleStr = 'VENTAS POR HORA (HOY)';
    lblAvg = 'PROMEDIO / HORA';
    lblMax = 'MÁXIMA HORA';
    if (d.hourly_sales) {
      labels = d.hourly_sales.map(h => h.hour.slice(0,5));
      data = d.hourly_sales.map(h => h.total);
    }
  } else if (range === 'mes') {
    titleStr = 'VENTAS POR DÍA (ESTE MES)';
    lblAvg = 'PROMEDIO / DÍA';
    lblMax = 'MÁXIMO DÍA';
    if (d.daily_sales) {
      labels = d.daily_sales.map(x => x.day);
      data = d.daily_sales.map(x => x.total);
    }
  } else if (range === 'ano') {
    titleStr = 'VENTAS POR MES (ESTE AÑO)';
    lblAvg = 'PROMEDIO / MES';
    lblMax = 'MÁXIMO MES';
    if (d.monthly_sales) {
      labels = d.monthly_sales.map(x => x.month);
      data = d.monthly_sales.map(x => x.total);
    }
  }

  titleEl.innerHTML = `<span class="card-title-icon" style="color:#3B82F6;">📈</span> ${titleStr}`;
  
  const total = data.reduce((a,b)=>a+b, 0);
  const avg = data.length ? total / data.length : 0;
  let max = 0;
  let maxIdx = 0;
  data.forEach((v,i) => { if(v>max){max=v; maxIdx=i;} });

  document.getElementById('cs-total-lbl').textContent = lblTotal;
  document.getElementById('cs-avg-lbl').textContent = lblAvg;
  document.getElementById('cs-max-title').textContent = lblMax;

  document.getElementById('cs-total').textContent = fmt(total);
  document.getElementById('cs-avg').textContent = fmt(avg);
  document.getElementById('cs-max').textContent = fmt(max);
  document.getElementById('cs-max-lbl').textContent = labels[maxIdx] || '-';

  const ctx = document.getElementById('main-chart').getContext('2d');
  
  // Gradient
  let gradient = ctx.createLinearGradient(0, 0, 0, 300);
  gradient.addColorStop(0, 'rgba(59, 130, 246, 0.4)');
  gradient.addColorStop(1, 'rgba(59, 130, 246, 0)');

  if (mainChart) mainChart.destroy();
  
  mainChart = new Chart(ctx, {
    type: 'line',
    data: {
      labels: labels,
      datasets: [{
        label: 'Ventas',
        data: data,
        borderColor: '#3B82F6',
        backgroundColor: gradient,
        borderWidth: 2,
        pointBackgroundColor: '#fff',
        pointBorderColor: '#3B82F6',
        pointBorderWidth: 2,
        pointRadius: 4,
        pointHoverRadius: 6,
        fill: true,
        tension: 0.4
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: '#fff',
          titleColor: '#64748B',
          bodyColor: '#1E293B',
          bodyFont: { weight: 'bold', size: 14 },
          borderColor: '#E2E8F0',
          borderWidth: 1,
          padding: 10,
          displayColors: false,
          callbacks: {
            label: function(context) { return fmt(context.raw); }
          }
        }
      },
      scales: {
        y: {
          beginAtZero: true,
          grid: { color: '#F1F5F9', borderDash: [5, 5] },
          ticks: {
            color: '#94A3B8',
            callback: function(value) { return '$' + (value >= 1000 ? (value/1000) + 'K' : value); }
          },
          border: { display: false }
        },
        x: {
          grid: { display: false },
          ticks: { color: '#94A3B8' },
          border: { display: false }
        }
      }
    }
  });
}

async function loadDashboard() {
  try {
    const res = await fetch('/api/dashboard/stats', {
      method: 'GET',
      credentials: 'include'
    });
    
    if (res.status === 401 || res.status === 403) {
      alert("Sesión expirada o acceso denegado. Serás redirigido al login.");
      localStorage.removeItem('calebsys_token');
      localStorage.removeItem('calebsys_role');
      window.location.href = '/';
      return;
    }
    
    if (!res.ok) throw new Error('API error ' + res.status);
    const d = await res.json();

    const fmt = n => '$' + Number(n).toLocaleString('es-MX', { minimumFractionDigits: 0, maximumFractionDigits: 0 });

    // ── KPI Cards ───────────────────────────────
    const set = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
    set('kpi-ventas',   fmt(d.ventas_hoy));
    set('kpi-tickets',  d.tickets_hoy);
    set('kpi-clientes', d.clientes_hoy);
    set('kpi-cxc',      fmt(d.cuentas_por_cobrar));

    // Delta ventas vs ayer
    const dv = document.getElementById('kpi-delta-ventas');
    if (dv) {
      if (d.delta_ventas > 0) {
        dv.textContent = `↑ +${d.delta_ventas}%`;
        dv.className = 'stat-trend trend-up';
      } else if (d.delta_ventas < 0) {
        dv.textContent = `↓ ${d.delta_ventas}%`;
        dv.className = 'stat-trend trend-down';
      } else {
        dv.textContent = '0%';
        dv.className = 'stat-trend';
      }
    }
    const dc = document.getElementById('kpi-delta-clientes');
    if (dc) {
      if (d.clientes_semana > 0) {
        dc.textContent = `↑ +${d.clientes_semana}%`;
        dc.className = 'stat-trend trend-up';
      } else {
        dc.textContent = '0%';
        dc.className = 'stat-trend';
      }
    }

    // Sidebar badge entregas
    const badge = document.getElementById('badge-entregas');
    if (badge) {
      badge.textContent = d.entregas_pendientes || '';
      badge.style.display = d.entregas_pendientes > 0 ? '' : 'none';
    }

    // ── Gráfica Principal ───────────────
    updateMainChart();

    // ── Últimas ventas ───────────────────────────
    const tbody = document.getElementById('recent-sales-body');
    if (tbody) {
      if (!d.recent_sales || d.recent_sales.length === 0) {
        tbody.innerHTML = '<tr><td colspan="4" style="text-align:center;color:var(--text3);padding:16px">Sin ventas registradas hoy</td></tr>';
      } else {
        tbody.innerHTML = d.recent_sales.map(s => {
          const pm = (s.payment_method || 'EFECTIVO').toUpperCase();
          const badgeClass = pm.includes('EFECTIVO') ? 'pill-green' : (pm.includes('TARJETA') ? 'pill-blue' : 'pill-purple');
          const icon = pm.includes('EFECTIVO') ? '💵' : (pm.includes('TARJETA') ? '💳' : '🏦');
          return `
          <tr>
            <td><strong style="font-family:monospace">#${String(s.id).padStart(4,'0')}</strong></td>
            <td>${s.created_at}</td>
            <td><span class="${badgeClass} pill">${icon} ${pm.slice(0,10)}</span></td>
            <td style="text-align:right;font-weight:800;color:var(--green)">${fmt(s.total)}</td>
          </tr>`;
        }).join('');
      }
    }

    // ── Top productos ────────────────────────────
    const topEl = document.getElementById('top-products-list');
    if (topEl) {
      if (!d.top_products || d.top_products.length === 0) {
        topEl.innerHTML = '<div style="color:var(--text3);font-size:.72rem;text-align:center;padding:20px 0">Sin ventas hoy</div>';
      } else {
        const colors = ['#3B82F6', '#8B5CF6', '#10B981', '#F59E0B', '#EF4444'];
        topEl.innerHTML = d.top_products.map((p, i) => {
          const bg = colors[i % colors.length];
          const initial = p.sku ? p.sku.charAt(0).toUpperCase() : 'P';
          return `
          <div class="prod-item" style="margin-bottom: 12px;">
            <div class="prod-img" style="background:${bg}; color:white; display:flex; align-items:center; justify-content:center; font-weight:800; font-size:1.2rem; border:none;">${initial}</div>
            <div class="prod-info">
              <div class="prod-name" style="text-transform: capitalize;">${(p.sku || '').toLowerCase()}</div>
              <div class="prod-qty">${Math.round(p.qty)} unidades</div>
            </div>
            <div class="prod-val" style="color:var(--text-main)">${fmt(p.revenue)}</div>
          </div>`;
        }).join('');
      }
    }

  } catch (err) {
    console.warn('Dashboard error:', err);
    // Show error state on KPIs
    ['kpi-ventas','kpi-tickets','kpi-clientes','kpi-cxc'].forEach(id => {
      const el = document.getElementById(id);
      if (el && !el.textContent.trim()) el.textContent = '—';
    });
  }
}

// Auto-refresh cada 60 segundos
setInterval(loadDashboard, 60000);

// ════════════════════════════════════════════════// ───
// INIT & SECURITY GUARD
// ───
const token = localStorage.getItem('calebsys_token');
storedRole = localStorage.getItem('calebsys_role');

if (!token || !storedRole || storedRole.toLowerCase() !== 'admin') {
  alert("Acceso Denegado. Esta pantalla es exclusiva para Administradores del sistema.");
  window.location.href = '/';
}
// ════════════════════════════════════════════════
const storedUser = localStorage.getItem('calebsys_usuario');
if (storedUser) {
  const name = storedUser.replace('.',' ').replace(/\b\w/g, c => c.toUpperCase());
  document.getElementById('sb-username').textContent = name.split(' ')[0] + ' ' + (name.split(' ')[1]?.[0] || '') + '.';
  document.getElementById('sb-initials').textContent = name.split(' ').map(w=>w[0]).join('').slice(0,2).toUpperCase();
}
storedRole = localStorage.getItem('calebsys_role');
if (storedRole) document.getElementById('sb-role').textContent = storedRole.charAt(0).toUpperCase()+storedRole.slice(1);

renderTabs();
loadDashboard(); // ← Carga datos reales al iniciar
setTimeout(() => notify('Dashboard actualizado', 'Datos en tiempo real cargados', 'success'), 900);