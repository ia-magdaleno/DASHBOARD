// 19-pos-layout.js — Visibilidad del panel de cobro y modo lectura por rol
//
// Panel cobro (totals-panel): ocupa la mitad inferior de la pantalla.
// Se muestra automáticamente para roles con acceso a cobro.
// El cajero ve la mitad superior en modo solo-lectura (no puede agregar productos).

const POS_ROLES_CON_COBRO = [
  'admin', 'administrador', 'administrador general', 'superadmin',
  'dueño', 'dueno', 'owner', 'admin_sucursal', 'gerente', 'supervisor',
  'vendedor_cajero', 'cajero', 'operador caja', 'vendedor', 'operador ventas',
  'mostrador', 'usuario', ''
];
const POS_ROLES_CARRITO_SOLO_LECTURA = [];

function posLayoutInit() {
  const role = (localStorage.getItem('calebsys_role') || '').toLowerCase().trim();
  const totalsPanel   = document.getElementById('totals-panel');
  const posLeftSection = document.getElementById('pos-left-section');
  const productInput  = document.getElementById('product-input');

  if (totalsPanel) {
    totalsPanel.classList.remove('hidden');
  }

  if (POS_ROLES_CARRITO_SOLO_LECTURA.includes(role)) {
    _aplicarCarritoSoloLectura(posLeftSection, productInput);
  }
}

function _aplicarCarritoSoloLectura(section, productInput) {
  if (productInput) {
    productInput.disabled    = true;
    productInput.placeholder = 'Ventas: solo lectura';
    productInput.style.opacity = '0.5';
    productInput.style.cursor  = 'not-allowed';
  }
  if (!section) return;
  section.setAttribute('data-pos-readonly', 'true');

  const mainBlock = section.querySelector('.bg-white.rounded-3xl');
  if (mainBlock && !document.getElementById('cart-readonly-badge')) {
    mainBlock.style.position = 'relative';
    const badge = document.createElement('div');
    badge.id = 'cart-readonly-badge';
    badge.style.cssText = [
      'position:absolute',
      'top:12px',
      'right:16px',
      'background:rgba(239,68,68,0.9)',
      'color:white',
      'font-size:10px',
      'font-weight:900',
      'padding:2px 8px',
      'border-radius:6px',
      'letter-spacing:.08em',
      'text-transform:uppercase',
      'z-index:10',
    ].join(';');
    badge.textContent = 'Solo Lectura';
    mainBlock.appendChild(badge);
  }
}

document.addEventListener('DOMContentLoaded', function () {
  posLayoutInit();
});
