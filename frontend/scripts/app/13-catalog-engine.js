/* 13-catalog-engine.js — Motor del buscador de productos (keyboard-first): navegacion, foco, panel detalle
   Extraido de app_v66.js (fase 3, modularizacion post-auditoria 2026-08-03)
   Lineas originales: 6358-6544 */
// =========================================================
// MOTOR DEL BUSCADOR DE PRODUCTOS (KEYBOARD FIRST)
// Controla: INSERT abre, flechas navegan, ESPACIO selecciona,
// ENTER manda a venta, ESC cierra, F4 abre modal paquete.
// =========================================================
let catalogoAbierto = false;
let rowFocusIndex = 0;
let rowsSeleccionadas = new Set();

document.addEventListener('keydown', function(evCatalogo) {
  const modalCatalogo = document.getElementById('modulo-catalogo');
  const modalPaquete  = document.getElementById('modal-paquete');
  if (!modalCatalogo || !modalPaquete) return;

  // Ignorar si el foco está en un input/textarea (exceptuando el buscador del catálogo)
  const tag = document.activeElement.tagName;
  const isSearchFocused = document.activeElement.id === 'catalogo-search';
  if ((tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') && !isSearchFocused) return;

  // 1. ABRIR CATÁLOGO CON [INSERT]
  if (evCatalogo.key === 'Insert' && !catalogoAbierto) {
    evCatalogo.preventDefault();
    modalCatalogo.classList.remove('hidden');
    catalogoAbierto = true;
    rowFocusIndex = 0;
    rowsSeleccionadas.clear();
    lucide.createIcons();
    actualizarFocoCatalogo();
    setTimeout(() => document.getElementById('catalogo-search')?.focus(), 50);
    return;
  }

  if (!catalogoAbierto) return;

  // NAVEGACIÓN CON EL INPUT DE BÚSQUEDA ACTIVO
  if (isSearchFocused) {
    if (evCatalogo.key === 'ArrowDown') {
      evCatalogo.preventDefault();
      document.activeElement.blur();
      rowFocusIndex = 0;
      actualizarFocoCatalogo();
    }
    // ESC cierra desde el buscador también
    if (evCatalogo.key === 'Escape') {
      evCatalogo.preventDefault();
      modalCatalogo.classList.add('hidden');
      catalogoAbierto = false;
    }
    return;
  }

  // CONTROLES CUANDO EL MODAL DE PAQUETE ESTÁ ABIERTO
  if (!modalPaquete.classList.contains('hidden')) {
    if (evCatalogo.key === 'Escape') {
      evCatalogo.preventDefault();
      modalPaquete.classList.add('hidden');
    }
    return;
  }

  const rows = document.querySelectorAll('#tabla-productos .item-row');
  if (rows.length === 0) return;

  switch (evCatalogo.key) {
    case 'Escape':
      evCatalogo.preventDefault();
      modalCatalogo.classList.add('hidden');
      catalogoAbierto = false;
      rowsSeleccionadas.clear();
      break;

    case 'F4':
      evCatalogo.preventDefault();
      modalPaquete.classList.remove('hidden');
      break;

    case 'ArrowDown':
      evCatalogo.preventDefault();
      if (rowFocusIndex < rows.length - 1) rowFocusIndex++;
      actualizarFocoCatalogo();
      break;

    case 'ArrowUp':
      evCatalogo.preventDefault();
      if (rowFocusIndex > 0) rowFocusIndex--;
      actualizarFocoCatalogo();
      break;

    case ' ':
      evCatalogo.preventDefault();
      const focusedRow = rows[rowFocusIndex];
      const id = focusedRow?.getAttribute('data-id');
      if (!id) break;
      if (rowsSeleccionadas.has(id)) {
        rowsSeleccionadas.delete(id);
      } else {
        rowsSeleccionadas.add(id);
      }
      actualizarFocoCatalogo();
      // Actualizar panel derecho con el producto enfocado
      actualizarPanelDetalle(focusedRow);
      break;

    case 'Enter':
      evCatalogo.preventDefault();
      if (rowsSeleccionadas.size > 0) {
        // Múltiples seleccionados → llevar todos
        showToast(`${rowsSeleccionadas.size} producto(s) llevados a la venta`, 'success');
      } else {
        // Solo el enfocado
        const fila = rows[rowFocusIndex];
        if (fila) {
          const desc = fila.getAttribute('data-desc') || '—';
          showToast(`"${desc}" agregado a la venta`, 'success');
        }
      }
      modalCatalogo.classList.add('hidden');
      catalogoAbierto = false;
      rowsSeleccionadas.clear();
      break;
  }
});

function actualizarFocoCatalogo() {
  const rows = document.querySelectorAll('#tabla-productos .item-row');
  rows.forEach((row, index) => {
    const id = row.getAttribute('data-id');
    const iconBox = row.querySelector('.check-box');

    // Limpiar todos los estados visuales
    row.classList.remove('bg-gray-100', 'ring-2', 'ring-inset', 'ring-gray-300',
                          'bg-blue-50', 'border-l-4', 'border-blue-500');

    // 1. Estado SELECCIONADO (azul, checkbox marcado)
    if (rowsSeleccionadas.has(id)) {
      row.classList.add('bg-blue-50', 'border-l-4', 'border-blue-500');
      if (iconBox) iconBox.innerHTML = '<i data-lucide="check-square" class="w-4 h-4 mx-auto text-blue-600"></i>';
    } else {
      if (iconBox) iconBox.innerHTML = '<i data-lucide="square" class="w-4 h-4 mx-auto text-gray-300"></i>';
    }

    // 2. Estado FOCO (gris tenue encima de lo que ya tiene)
    if (index === rowFocusIndex) {
      row.classList.add('bg-gray-100', 'ring-2', 'ring-inset', 'ring-gray-300');
      row.scrollIntoView({ block: 'nearest' });
      actualizarPanelDetalle(row);
    }
  });
  lucide.createIcons();
}

function actualizarPanelDetalle(row) {
  if (!row) return;
  const desc   = row.getAttribute('data-desc')   || '—';
  const precio = row.getAttribute('data-precio')  || '—';
  const sku    = row.getAttribute('data-sku')     || '—';
  const el = (id) => document.getElementById(id);
  if (el('panel-desc'))   el('panel-desc').textContent   = desc;
  if (el('panel-precio')) el('panel-precio').textContent = `$ ${precio}`;
  if (el('panel-sku'))    el('panel-sku').textContent    = sku;
}

// Click en filas también navega
document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('tabla-productos')?.addEventListener('click', (e) => {
    const row = e.target.closest('.item-row');
    if (!row) return;
    const rows = document.querySelectorAll('#tabla-productos .item-row');
    rowFocusIndex = Array.from(rows).indexOf(row);
    actualizarFocoCatalogo();
  });

  // Buscador filtra filas en tiempo real
  document.getElementById('catalogo-search')?.addEventListener('input', (e) => {
    const q = e.target.value.toLowerCase();
    document.querySelectorAll('#tabla-productos .item-row').forEach(row => {
      const text = row.textContent.toLowerCase();
      row.style.display = text.includes(q) ? '' : 'none';
    });
    rowFocusIndex = 0;
    actualizarFocoCatalogo();
  });
});




