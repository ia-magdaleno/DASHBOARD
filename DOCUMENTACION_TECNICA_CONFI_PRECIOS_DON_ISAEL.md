# Documentación Técnica de Arquitectura y Lógica — Módulo `confi-precios`, Catálogos, Inventario F3/F12 y Sincronización POS en Tiempo Real

**Dirigido a:** Ing. / Don Isael (Programador Principal — Integración a Sistema Real en la Nube)  
**Repositorio:** `confi-precios` (`ia-magdaleno/confi-precios`)  
**Sistema Base:** CALEBSYS POS & ERP  

---

## 1. Resumen Ejecutivo para Integración en la Nube

Este repositorio concentra toda la ingeniería de **Configuración de Precios (`confi-precios`)**, **Escalas de Precios Generales y por Sucursal**, **Alta/Edición de Productos (`#producto-alta`)**, **Catálogo Maestro de Precios y Kardex (`#productos`)**, **Clasificador Semántico SAT CFDI 4.0 con Aprendizaje en Caliente**, y **Sincronización en Tiempo Real con el Punto de Venta (`POS`)**.

El objetivo de esta guía es que puedas **inspeccionar, extraer y migrar la lógica exacta** hacia la arquitectura real en la nube sin perder ninguna regla de negocio ni comportamiento de interfaz.

---

## 2. Mapa de Archivos Modificados y Creados

### A. Frontend (Lógica, Controladores y Vistas)
1. **`frontend/scripts/loaders/config-hub.js` (NUEVO — Motor Central de Configuración, Escalas, Sucursales y Sincronización POS)**
   - Controlador maestro de `#configuracion`, `#modal-cambio-precio` (`F2` en Alta de Producto), Escalas de Precios Globales (`catalog.price_scales`), Escalas por Sucursal (`catalog.branch_price_scales`), Catálogos Operativos (Familias, Departamentos, Marcas, Unidades, IVAs, Monedas) y emisión de eventos en tiempo real al POS (`BroadcastChannel('calebsys_pos_pricing_sync')` + `CustomEvent('calebsys:pos-pricing-updated')`).
2. **`frontend/scripts/loaders/products-form.js` (MODIFICADO — Controlador de `#producto-alta`)**
   - Motor de cálculo bidireccional de costos, fletes, desglose de compra (`CAJA`/`BULTO`/`PAQUETE` $\leftrightarrow$ `PIEZA`), sobreprecio de menudeo (`%` $\leftrightarrow$ `$`), selector unificado `SUCURSAL - ESCALA` (con `MATRIZ - PRECIO DE LISTA (PÚBLICO)` siempre por defecto), detector en vivo de códigos duplicados, módulo `Stock y Operaciones [F3]` conectado a base de datos real, motor semántico SAT CFDI 4.0 con memoria de aprendizaje, y navegación completa con teclado (`Enter` y flechas `↑ ↓ ← →`).
3. **`frontend/scripts/loaders/products.js` (MODIFICADO — Controlador de `#productos` / Catálogo y Precios)**
   - Accesos rápidos de teclado de nivel ERP:
     - `INS`: Nuevo Producto (`#producto-alta` limpio).
     - `ENTER`: Editar Producto seleccionado en `#producto-alta`.
     - `DELETE` / `Supr`: Eliminar producto(s) marcados o fila activa.
     - `Barra Espaciadora (Space)`: Marcar / desmarcar producto (selección múltiple con resaltado visual y contador).
     - `F4`: Filtro interactivo por **Familia**.
     - `F5`: Filtro interactivo por **Departamento**.
     - `F6`: Filtro interactivo por **Marca**.
     - `F7`: Filtro rápido de **Productos en Oferta** (toggle).
     - `F8`: Modal de **Stock Multialmacén por Sucursal** (`Matriz` + cada sucursal activa, con semáforo de existencias y totales).
     - `F12`: Modal de **Kardex General / Por Producto** (Entradas, Salidas y Ajustes, filtrable por **Todos los productos** o **Un solo producto**, y por **Matriz**, **Sucursales** o **Ambas**).
4. **`frontend/pages/admin/producto-alta.html` (MODIFICADO)**
   - Limpieza visual de textos pequeños/subtítulos innecesarios en las tarjetas de costos y precios.
   - Integración del filtro unificado **`SUCURSAL - ESCALA (`#pa-sucursal-escala-select`)`** que cambia toda la ventana en vivo y mantiene **`MATRIZ - PRECIO DE LISTA (PÚBLICO)`** como valor por defecto en todo momento.
   - Rediseño del modal **`Cambio de Precio (`#modal-cambio-precio`)`**: eliminación de los `checkbox` en la columna `V` y reemplazo por el **indicador automático de tendencia de precio** (flecha verde hacia arriba `▲` cuando el precio sube y flecha roja hacia abajo `▼` cuando el precio baja), además de barra rápida de `Costo Base` y `Flete (%)`.
5. **`frontend/pages/admin/productos.html` (MODIFICADO)**
   - Barra de accesos rápidos (`INS`, `ENTER`, `DEL`, `ESPACIO`, `F4`, `F5`, `F6`, `F7`, `F8`, `F12`), eliminación de iconos flotantes innecesarios, y estructura de los modales de **Stock por Sucursal (`F8`)** y **Kardex (`F12`)** con diseño nativo CALEBSYS.
6. **`frontend/pages/admin/configuracion.html` (MODIFICADO)**
   - Hub de configuración con secciones de **Escalas de Precios**, **Escalas por Sucursal**, **Catálogos (Familias, Departamentos, Marcas, Presentaciones, Unidades, IVAs)** y configuración operativa.
7. **`frontend/scripts/app/03-search-ui.js`, `04-pos-cart.js`, `05-search-client.js`, `10-catalog.js` (MODIFICADOS — Integración POS en Tiempo Real)**
   - El Punto de Venta (`POS`) escucha los cambios de precios, escalas de cliente y escalas por sucursal en tiempo real y recalcula automáticamente el carrito activo y el buscador sin necesidad de recargar la página (`F5`).

### B. Backend (API FastAPI, Esquemas y Persistencia)
1. **`backend/routers/products.py` (MODIFICADO)**
   - Endpoints para alta/actualización de productos (`POST /api/products`), enriquecimiento automático de `price_scales` y `branch_price_scales` dentro de `meta_data`, consulta de detalle y kardex multialmacén (`/api/products-f3/...`), y registro de movimientos de inventario (`ENTRADA`, `SALIDA`, `TRASLADO`, `AJUSTE`).
2. **`backend/routers/admin.py` (MODIFICADO)**
   - Persistencia de llaves de configuración en la nube/BD (`GET / PUT /api/admin/config/{key}`), incluyendo `catalog.price_scales`, `catalog.branch_price_scales`, `catalog.familias_tree`, `catalog.marcas`, etc.
3. **`backend/routers/cfdi.py` y `backend/cfdi_catalogs.py` (MODIFICADOS)**
   - Clasificador semántico SAT CFDI 4.0 (`/api/cfdi/sat-classify`, `/api/cfdi/sat-learn`) con validación anti-alucinación contra el catálogo local y memoria de aprendizaje en caliente.
4. **`backend/crud.py`, `backend/schemas.py`, `backend/routers/sales.py` (MODIFICADOS)**
   - Soporte de `price_scales`, `meta_data`, `sales_code`, unidades de compra/venta y sincronización de existencias al vender en el POS.

---

## 3. Explicación Detallada de la Lógica de Negocio (Para Migrar a la Nube)

### 3.1. Fórmula Maestra de Costos, Flete y Desglose (`CAJA` $\leftrightarrow$ `PIEZA`)
Ubicación: `frontend/scripts/loaders/products-form.js` (`recalcularPrecio`) y `frontend/scripts/loaders/config-hub.js` (`getEffectiveProductCostContext`).

1. **Conversión de Moneda (USD $\rightarrow$ MXN):**
   $$\text{CostoCajaPesos} = \text{isUSD} \ ? \ (\text{CostoRaw} \times \text{TipoCambio}) : \text{CostoRaw}$$
2. **Prorrateo por Presentación de Compra (`cantPiezas`):**
   - Si el producto se compra por `CAJA`, `PAQUETE`, `BULTO`, etc. con $N$ piezas (`cantPiezas` $> 1$):
     $$\text{CostoPiezaSinFlete} = \frac{\text{CostoCajaPesos}}{\text{cantPiezas}}$$
3. **Aplicación de Flete (`fletePct %`):**
   $$\text{MontoFleteCaja} = \text{CostoCajaPesos} \times \left(\frac{\text{fletePct}}{100}\right)$$
   $$\text{CostoCajaConFlete} = \text{CostoCajaPesos} + \text{MontoFleteCaja}$$
   $$\text{CostoUnitarioConFlete} = \frac{\text{CostoCajaConFlete}}{\text{cantPiezas}}$$
4. **Cálculo Bidireccional de Escalas de Precios (`Editar [F1]` en `#modal-cambio-precio`):**
   Cada escala $i$ (ej. `PRECIO DE LISTA`, `CONTRATISTA`, `REVENTA`, `CREDITO`, `CREDITOS ESPECIALES`) tiene:
   - `margen_ideal` ($M_{\text{ideal}}\%$)
   - `oferta` ($O\%$)
   - `margen_trabajo` ($M_{\text{trab}}\% = M_{\text{ideal}} - O$)
   - **De Margen a Precio:**
     $$\text{PrecioVenta}_i = \text{CostoUnitarioConFlete} \times \left(1 + \frac{M_{\text{trab}}}{100}\right) \times \left(1 + \frac{\text{IVA}}{100}\right)$$
   - **De Precio a Margen (cuando el usuario escribe directamente el Precio Venta):**
     $$\text{SubtotalSinIVA} = \frac{\text{PrecioVenta}_i}{1 + \frac{\text{IVA}}{100}}$$
     $$M_{\text{trab}} = \left(\frac{\text{SubtotalSinIVA}}{\text{CostoUnitarioConFlete}} - 1\right) \times 100$$
     $$M_{\text{ideal}} = M_{\text{trab}} + O$$

---

### 3.2. Lógica de Escalas por Sucursal (`Precio Sucursales [F2]` en `#modal-cambio-precio`)
Ubicación: `frontend/scripts/loaders/config-hub.js` (`ensureProductScalesInitialized`, `recalculateAllProductScalesFromCost`, `renderModalCambioPrecioScales`).

1. **Generación de Matriz Cruzada (`Sucursal` $\times$ `Escala`):**
   - Por cada sucursal (`MATRIZ` + sucursales registradas en `branches`) y por cada una de las 5 escalas:
     - `margen_ideal`: Toma como base el `margen_trabajo` de la escala general en `MATRIZ`.
     - `sobreprecio_suc` (`Ajuste Suc. %`): Porcentaje adicional (o descuento si es negativo) exclusivo de esa sucursal. En `MATRIZ` por defecto es `0.00%`.
     - `margen_final`:
       $$M_{\text{final\_suc}} = M_{\text{base\_escala}} + \text{AjusteSuc}\%$$
     - `precio` y `precio_activo`:
       $$\text{PrecioSucursal} = \text{CostoUnitarioConFlete} \times \left(1 + \frac{M_{\text{final\_suc}}}{100}\right) \times \left(1 + \frac{\text{IVA}}{100}\right)$$
2. **Sincronización Bidireccional `MATRIZ` $\leftrightarrow$ Escala General:**
   - Si se modifica una escala en `Editar [F1]`, automáticamente actualiza el `Margen Base` de todas las sucursales para esa escala y recalcula sus precios respetando el `Ajuste Suc. (%)` de cada sucursal.
   - Si se modifica una fila de `MATRIZ` dentro de `Precio Sucursales [F2]`, sincroniza de vuelta la escala general correspondiente.

---

### 3.3. Filtro Maestro `SUCURSAL - ESCALA` en Alta de Producto (Default: `MATRIZ - PRECIO DE LISTA`)
Ubicación: `frontend/scripts/loaders/config-hub.js` (`populateMainFormSucursalEscalaSelector`, `applyMainFormSelectedSucursalEscala`, `resetMainFormSucursalEscalaToDefault`).

- En la ventana de Alta de Producto (`#producto-alta`), el selector `#pa-sucursal-escala-select` lista todas las combinaciones:
  - Grupo `MATRIZ (PRECIO POR DEFECTO)`: `MATRIZ - PRECIO DE LISTA (PÚBLICO)`, `MATRIZ - CONTRATISTA`, `MATRIZ - REVENTA`, etc.
  - Grupos `SUCURSAL: <NOMBRE>`: `<SUCURSAL> - PRECIO DE LISTA`, `<SUCURSAL> - CONTRATISTA`, etc.
- **Regla de Oro:** Siempre que se abre o limpia la ventana de Alta de Producto, el filtro se posiciona automáticamente en **`MATRIZ__0` (`MATRIZ - PRECIO DE LISTA (PÚBLICO)`)** como valor por defecto global.
- Al cambiar este selector a cualquier otra escala o sucursal, **toda la ventana de Alta de Producto** actualiza en vivo el `MARGEN (%)`, `PRECIO FINAL DE VENTA (IVA INC.)`, las tarjetas de vista previa de escalas y los cálculos derivados. Si el usuario edita el margen o el precio teniendo seleccionada una escala/sucursal, el cambio se guarda directamente en esa escala/sucursal.

---

### 3.4. Indicador Automático de Tendencia de Precio (Flecha Verde `▲` / Flecha Roja `▼`) y Eliminación de Checkboxes
Ubicación: `frontend/scripts/loaders/config-hub.js` (`updateScaleItemPriceAndTrend`, `snapshotScalesBeforeEditStep`, `renderPriceTrendArrowHtml`).

1. **Sin casillas manuales (`checkbox`):**
   - Todas las escalas y escalas por sucursal están activas en tiempo real (`activa = true`) sin requerir que el usuario marque casillas en la columna `V`.
2. **Detección automática de subida o bajada de precio:**
   - Antes de iniciar una edición de costo, flete, margen, oferta o precio (`focus` / `change`), `snapshotScalesBeforeEditStep()` guarda el precio de referencia (`_lastStepPrice` y `_baselinePrice`) de cada escala y de cada sucursal.
   - Cada vez que se calcula o ingresa un nuevo precio $P_{\text{nuevo}}$:
     - Si $P_{\text{nuevo}} > P_{\text{ref}} + 0.005$:
       - `item.trend = 'up'`
       - Renderiza en la columna `V` una **flecha verde hacia arriba (`fa-arrow-up`, `#22c55e`)** indicando el cambio (`$Anterior → $Nuevo`).
     - Si $P_{\text{nuevo}} < P_{\text{ref}} - 0.005$:
       - `item.trend = 'down'`
       - Renderiza en la columna `V` una **flecha roja hacia abajo (`fa-arrow-down`, `#ef4444`)** indicando el cambio (`$Anterior → $Nuevo`).
     - Si no hubo cambio respecto a la referencia:
       - `item.trend = 'same'` (muestra `—` neutro).
   - Esto ocurre en tiempo real tanto en **Editar [F1] (Escalas)** como en **Precio Sucursales [F2] (Sucursales)**.

---

### 3.5. Navegación con Teclado (Flechas `↑`, `↓`, `←`, `→` y `Enter`) en Todas las Pantallas
Ubicación:
- Modal Cambio de Precio (`F2`): `bindModalCambioPrecioArrowNavigation` en `frontend/scripts/loaders/config-hub.js`.
- Formulario General de Alta de Producto (`F1`): `focusFieldInFormSequence` en `frontend/scripts/loaders/products-form.js`.
- Catálogo de Productos (`#productos`): manejador de teclado en `frontend/scripts/loaders/products.js`.

**Detalle técnico importante para la nube:**
- En HTML5 nativo, los `<input type="number" step="0.01">` interceptan las teclas `ArrowUp` y `ArrowDown` para sumar o restar `0.01` al número, impidiendo navegar entre filas.
- Para solucionarlo de raíz, el listener se registra en **fase de captura (`addEventListener('keydown', ..., true)`)**, ejecuta `e.preventDefault()` y `e.stopPropagation()` cuando detecta `ArrowUp`, `ArrowDown`, `ArrowLeft`, `ArrowRight` o `Enter`, mueve el foco a la celda correspondiente de la matriz `(fila, columna)`, aplica `.select()` al contenido del input para edición inmediata y resalta la fila activa con `.cp-hl`.

---

### 3.6. Sincronización en Tiempo Real con el Punto de Venta (`POS`)
Ubicación: `broadcastPosPricingRealtime` en `frontend/scripts/loaders/config-hub.js` y receptores en `frontend/scripts/app/04-pos-cart.js`, `03-search-ui.js`, `10-catalog.js`.

1. Cuando se guarda un producto (`F12` en Alta de Producto) o se aplican cambios en `Cambio de Precio` (`Guardar y Actualizar`), se emite:
   - Un mensaje por `BroadcastChannel('calebsys_pos_pricing_sync')` (sincroniza pestañas/ventanas abiertas del POS).
   - Un evento DOM `CustomEvent('calebsys:pos-pricing-updated')` y actualización en `localStorage` (`calebsys_pos_pricing_ping`).
2. El POS recibe el evento en caliente, actualiza su catálogo en memoria, resuelve el precio según la **Sucursal activa del POS** y la **Escala asignada al cliente**, y recalcula el carrito activo al instante.

---

### 3.7. Pantalla de Catálogo de Productos (`#productos`) — Accesos Rápidos, Stock (`F8`) y Kardex (`F12`)
Ubicación: `frontend/scripts/loaders/products.js` y `frontend/pages/admin/productos.html`.

| Tecla | Acción en `#productos` | Descripción Técnica |
| :--- | :--- | :--- |
| **`INS`** | Producto Nuevo | Limpia estado de edición y abre `#producto-alta` listo para captura. |
| **`ENTER`** | Editar Producto | Carga el SKU de la fila activa y abre `#producto-alta` con todos sus datos y escalas. |
| **`DEL` / `Supr`** | Eliminar Producto | Elimina el producto activo o todos los productos marcados con barra espaciadora. |
| **`ESPACIO`** | Marcar / Desmarcar | Alterna la selección del producto en la fila actual (`selectedSkus`) y avanza o mantiene foco. |
| **`F4`** | Filtro Familia | Abre selector rápido de **Familia** y filtra la tabla en vivo. |
| **`F5`** | Filtro Departamento | Abre selector rápido de **Departamento** y filtra la tabla en vivo. |
| **`F6`** | Filtro Marca | Abre selector rápido de **Marca** y filtra la tabla en vivo. |
| **`F7`** | Filtro Ofertas | Conmuta la vista para mostrar únicamente productos con oferta activa (`oferta > 0`). |
| **`F8`** | Stock por Sucursal | Abre modal con el desglose de existencias del producto en **Matriz** y en cada **Sucursal**, mostrando stock actual, mínimo y estado. |
| **`F12`** | Kardex General / Producto | Abre el Kardex de **Entradas, Salidas y Ajustes**, permitiendo filtrar por **Todos los productos** o **Un solo producto**, y por **Matriz**, **Sucursales** o **Ambas**. |

---

## 4. Estructura de Datos JSON que Debe Respetar la Base de Datos en la Nube

En la tabla `products`, la columna `meta_data` (JSON/JSONB) y `price_scales` almacenan la siguiente estructura para cada producto:

```json
{
  "costo_raw": 100.00,
  "flete_pct": 5.00,
  "costo_con_flete": 105.00,
  "costo_pieza_con_flete": 105.00,
  "margen": 30.00,
  "iva": 16.00,
  "price_scales": [
    {
      "scale_id": 1,
      "scale_name": "PRECIO DE LISTA",
      "costo_con_flete": 105.00,
      "margen_ideal": 30.00,
      "oferta": 0.00,
      "margen_trabajo": 30.00,
      "precio": 158.34,
      "precio_activo": 158.34,
      "trend": "up",
      "prev_price": 150.00,
      "activa": true,
      "comision": 0.00
    }
  ],
  "branch_price_scales": [
    {
      "branch_id": "MATRIZ",
      "branch_name": "MATRIZ",
      "scale_id": 1,
      "scale_name": "PRECIO DE LISTA",
      "costo_con_flete": 105.00,
      "margen_ideal": 30.00,
      "sobreprecio_suc": 0.00,
      "margen_final": 30.00,
      "precio": 158.34,
      "precio_activo": 158.34,
      "trend": "up",
      "prev_price": 150.00,
      "activa": true,
      "comision": 0.00
    }
  ]
}
```
