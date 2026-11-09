# CALEBSYS POS — Resumen de Modificaciones y Código Fuente
**Fecha:** 8 de Octubre de 2026  
**Para:** Don Isael  
**Sistema:** Calebsys POS & Admin Shell  
**Ubicación del Proyecto:** `Calebsys_POS_RESPALDO_21Junio_v4_PERFECTO`

---

## 1. Resumen Ejecutivo de las Modificaciones

En esta versión se implementaron y perfeccionaron los módulos clave de catálogo e inventario, destacando la nueva pantalla de **Alta / Edición de Producto** con flujo ágil de captura comercial, soporte para moneda extranjera (USD), cálculo dinámico de flete y margen, navegación inteligente por teclado y persistencia completa.

---

## 2. Detalle de Funcionalidades Implementadas

### A. Pantalla de Alta y Edición de Producto (`#producto-alta`)
- **Acceso Rápido con Tecla INS:** Al estar en el catálogo de productos (`#productos`), presionar la tecla **<kbd>INS</kbd> (Insert)** o hacer clic en el botón **"Nuevo Producto"** abre inmediatamente la pantalla de alta.
- **Validación Estricta de Campos Obligatorios con Asterisco Rojo (`*`):**
  No permite guardar si alguno de los 7 campos obligatorios está vacío:
  1. `SKU *`
  2. `Código *`
  3. `Familia *`
  4. `Departamento *`
  5. `SAT ID *`
  6. `SAT UNIDAD *`
  7. `Descripción *`
  Si falta información, el sistema detiene el proceso, resalta la casilla en rojo (`.pa-input-error`) y posiciona el cursor en ella.
- **Campo MARCA Integrado en Fila 3:**
  - `Descripción` abarca 3 columnas.
  - `Marca` se ubica en la 4ª columna, alineado verticalmente debajo de `SAT UNIDAD`.
  - Incluye selector con marcas comerciales predeterminadas (`GENÉRICO`, `DEACERO`, `CEMEX`, `TRUPER`, etc.) y la opción `+ OTRA (CAPTURAR MARCA...)` para registrar cualquier marca adicional al vuelo.
- **Sección Costos / Precios (Cálculo Automático y Alineación):**
  - **Alineación Horizontal Perfecta:** Las casillas de `Costo de Pieza`, `Flete (%)` y `Margen (%)` están rigurosamente alineadas sobre la misma línea horizontal con etiquetas uniformes.
  - **Soporte Dólares (USD):** Switch interactivo `USD / DLLS` con Tipo de Cambio (`T.C.`) configurable. Al activarse:
    - El contorno de la tarjeta cambia a verde esmeralda suave (`pa-usd-mode-active`).
    - El símbolo de captura cambia a `US$`.
    - Convierte automáticamente el costo capturado en dólares a pesos mexicanos ($ MXN) utilizando el T.C. vigente.
  - **Flete (%):** El porcentaje de flete se suma sobre el costo base.
  - **Margen (%):** Se multiplica por el margen de utilidad.
  - **Precio Nuevo con IVA:** Se calcula y muestra en tiempo real en la tarjeta verde con el desglose de la fórmula.
- **Navegación Fluida con Tecla ENTER:**
  - Presionar <kbd>Enter</kbd> avanza de casilla en casilla automáticamente en orden lógico.
  - Omite los checkboxes laterales para no frenar la captura.
  - Al llegar a la última casilla (`Observaciones`) y presionar <kbd>Enter</kbd>, el producto **se guarda automáticamente**, la pantalla se limpia y queda lista con el cursor en `SKU` para dar de alta el siguiente producto sin tocar el ratón.
- **Barra Lateral de Atributos y Configuración Fija:**
  - Mantiene su posición fija en su columna derecha (`330px`) sin desplazarse ni flotar por la pantalla al hacer scroll (`position: static`).
  - **Auditoría de Kardex** opera como casilla independiente, sin bloquear las demás opciones del grupo.
  - Todas las casillas están visibles en pantalla sin scroll interno forzado.
- **Tarjeta de Historial de Precios:**
  - Tipografía unificada (`Inter`) y tamaño uniforme parejo (`11px`).
  - Muestra fecha/hora de actualización, precio registrado y usuario responsable.
- **Modo Oscuro (Dark Mode):**
  - Compatibilidad total con `[data-theme="dark"]` en toda la vista de producto.

---

## 3. Lista de Archivos Creados y Modificados

### Backend (Python / FastAPI / SQLAlchemy)
1. **`backend/crud.py`**:
   - `create_product`: Adaptado para recibir y guardar todos los atributos extendidos del producto (`barcode`, `sales_code`, `name`, `purchase_unit`, `sale_unit`, `conversion_factor`, `average_cost`, `stock_minimo`, `foto_url`, `meta_data` con marcas, flete, dólares y kardex).
   - `search_products`: Búsqueda ampliada por SKU, descripción y nombre con soporte ORM.
2. **`backend/schemas.py`**:
   - `ProductBase` y `Product`: Campos agregados (`name`, `barcode`, `sales_code`, `purchase_unit`, `sale_unit`, `conversion_factor`, `average_cost`, `foto_url`, `meta_data`).
3. **`backend/main.py`**:
   - Normalización de llamada de auditoría en login.

### Frontend (HTML5 / JavaScript / CSS)
4. **`frontend/pages/admin/producto-alta.html`** *(NUEVO)*:
   - Vista completa de alta y edición de producto con maquetación en grid responsivo, tarjetas de unidades, costos, foto, atributos, kardex e historial de precios, con soporte completo para modo claro y oscuro.
5. **`frontend/scripts/loaders/products-form.js`** *(NUEVO)*:
   - Controlador JavaScript: cálculos en tiempo real de USD, T.C., Flete y Margen; secuencia de <kbd>Enter</kbd>; atajos <kbd>F12</kbd> (Guardar) y <kbd>ESC</kbd> (Cancelar); validación de asteriscos rojos; captura de marca; reseteo del formulario y persistencia API.
6. **`frontend/admin_shell.html`**:
   - Inclusión del script `scripts/loaders/products-form.js`.
7. **`frontend/scripts/admin-shell.js`**:
   - Registro de la ruta `producto-alta`.
   - Atajo global <kbd>INS</kbd> para abrir nuevo producto desde el catálogo.
   - Atajos <kbd>F12</kbd> para guardar y <kbd>ESC</kbd> para cancelar.
8. **`frontend/pages/admin/productos.html`**:
   - Habilitación del botón "Nuevo Producto" con indicativo de atajo <kbd>INS</kbd>.
9. **`frontend/scripts/loaders/products.js`**:
   - Función `productsNuevoProducto` para redirección a `#producto-alta`.
   - Soporte para descripción en el buscador de la tabla.

### Scripts de Ejecución
10. **`INICIAR_SERVIDOR.bat`** *(NUEVO)*:
    - Lanzador rápido para Windows que activa el entorno virtual `.venv`, arranca el servidor `uvicorn` en el puerto 8000 y abre el navegador automáticamente.

---

## 4. Instrucciones para Ejecutar y Probar

1. **Iniciar el Servidor:**
   Hacer doble clic en `INICIAR_SERVIDOR.bat` o desde la terminal:
   ```powershell
   .venv\Scripts\activate
   uvicorn backend.main:app --host 127.0.0.1 --port 8000
   ```
2. **Abrir en el Navegador:**
   Ir a: `http://127.0.0.1:8000/admin` (o `#productos`).
3. **Probar el Alta de Producto:**
   - Presionar la tecla **INS** para entrar a `#producto-alta`.
   - Llenar los campos obligatorios.
   - Usar la tecla **Enter** para brincar entre casillas.
   - Probar el switch **USD / DLLS** y el porcentaje de **Flete (%)**.
   - Presionar **F12** o llegar al final con **Enter** para guardar.


---

## 5. Actualización 11 de Octubre de 2026 — Catálogo, Ventana de Precios y Atajos

### A. Catálogo de Productos (`#productos`) — nuevo diseño
- **Barra de acciones** con iconos y atajos: Nuevo Producto (`INS`), Editar, Eliminar, Familia (`F4`), Departamento (`F5`), Marcar (`F6`), Ofertas (`CTRL+O`), Etiquetas (`F7`), Sin Filtro (`F9`), Stock (`F8`), Kardex (`F12`).
- **Búsqueda y filtros:** buscador por nombre / código / código alterno, filtros Categoría (Familia o Departamento), Marca y Estado, y botón *Limpiar filtros*.
- **Tabla:** Código, Producto, Unidad, Costo, Mon (PES/USD), Margen (etiqueta de color), Precio y Existencia (rojo en 0). Selección de fila por clic; la primera queda marcada al entrar.
- **Margen:** `((Precio / (1 + IVA)) - Costo) / Costo`. El precio de venta incluye IVA (16 % por defecto o `meta_data.iva`).
- **Resumen inferior:** Total, Activos, Sin Stock, En Promoción; *Accesos Rápidos* e *Información adicional* (usuario, sucursal, total de registros).
- Compatible con modo claro y oscuro (usa las variables del shell).
- **Archivos:** `frontend/pages/admin/productos.html`, `frontend/scripts/loaders/products.js`.

### B. Alta / Edición de Producto (`#producto-alta`)
- **Ventana flotante "Cambio de Precio"** (pestaña *Precios*, `F2`): escalas de precio, margen ideal / de trabajo, oferta, precio activo, comisión, fechas e historial. Modo claro y oscuro; el fondo usa el mismo oscurecido que las demás ventanas del sistema. Se cierra con *Cancelar*, la X, clic fuera o `ESC`.
- **Accesos rápidos en las pestañas, de izquierda a derecha:** `F1` Información General · `F2` Precios · `F3` Inventario · `F4` Complementos · `F5` Imprimir Etiqueta. Con la ventana de precios abierta, `F1/F2/F3` accionan *Editar / Precio Sucursales / Ofertas Calendarizadas*. `Ctrl+F5` sigue recargando el navegador.
- **Ancho completo:** se eliminó el tope de 1560 px; la pantalla aprovecha todo el espacio disponible.
- **Archivos:** `frontend/pages/admin/producto-alta.html`, `frontend/scripts/loaders/products-form.js`.

### C. Pendiente de conectar (lógica / backend)
- Productos: *Editar*, *Eliminar*, *Etiquetas*, *Precios Sucursales*, *Ofertas Calendarizadas* (hoy muestran un aviso). El filtro *Ofertas* requiere `meta_data.en_oferta`.
- Ventana *Cambio de Precio*: botones *Guardar*, *Editar*, *Precio Sucursales* y *Ofertas Calendarizadas*; hoy es diseño con datos de ejemplo.
- Alta de producto: cargar un producto existente para edición (hoy solo crea).