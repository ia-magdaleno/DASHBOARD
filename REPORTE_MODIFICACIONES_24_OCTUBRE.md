# 📋 Reporte General de Modificaciones — `MODIFICACIONES 24OCTUBRE`

> [!IMPORTANT]
> **Resumen Ejecutivo para Ingeniería (Don Isael):**
> Este documento detalla la totalidad de los archivos nuevos y modificados en **CALEBSYS ERP** desde la última entrega en GitHub (`ia-magdaleno/cfdi` / `confi-precios`), abarcando **23 archivos de código fuente** (`+19,929` líneas insertadas y `6` módulos/migraciones nuevos) listos para publicarse en el nuevo repositorio **`MODIFICACIONES-24OCTUBRE`**.

---

## 1. Inventario Completo de Archivos Modificados y Nuevos

### 🆕 Archivos Nuevos (6 archivos)
| Archivo | Módulo / Propósito |
| :--- | :--- |
| [backend/routers/receptions.py](file:///C:/Users/ACTECK%201/.gemini/antigravity/scratch/CALEBSYS/backend/routers/receptions.py) | Router FastAPI del **Centro de Recepción de Mercancía 360°**: parser CFDI 4.0 XML, homologación de códigos de proveedor, pre-alta y alta de productos con escalas, prorrateo de fletes multi-tramo (*Landed Cost*), evidencias fotográficas, incidencias/notas de crédito, calificación 5 estrellas de proveedor y generación de CxP. |
| [backend/payables_tracking.py](file:///C:/Users/ACTECK%201/.gemini/antigravity/scratch/CALEBSYS/backend/payables_tracking.py) | Motor de **Seguimiento de Cuentas por Pagar (CxP)**: foliador consecutivo (`CXP-AAAA-####`), hidratación automática desde expedientes/XML, lectura de UUID fiscal, serie/folio, fechas de emisión, recepción y vencimiento, y entrega segura de archivos XML/PDF. |
| [backend/alembic/versions/20261024_0001_r360_reception_hub.py](file:///C:/Users/ACTECK%201/.gemini/antigravity/scratch/CALEBSYS/backend/alembic/versions/20261024_0001_r360_reception_hub.py) | Migración Alembic PostgreSQL/SQLite para tablas `reception_expedientes`, `reception_files` y `operating_expenses`. |
| [backend/alembic/versions/20261024_0002_r360_ap_tracking.py](file:///C:/Users/ACTECK%201/.gemini/antigravity/scratch/CALEBSYS/backend/alembic/versions/20261024_0002_r360_ap_tracking.py) | Migración Alembic para las 8 columnas de seguimiento fiscal y documental en `accounts_payable` (`folio`, `invoice_uuid`, `invoice_ref`, `issue_date`, `receipt_date`, `expediente_id`, `concept`, `credit_days`). |
| [frontend/scripts/loaders/reception-hub.js](file:///C:/Users/ACTECK%201/.gemini/antigravity/scratch/CALEBSYS/frontend/scripts/loaders/reception-hub.js) | Controlador del Dashboard de **Recepción de Mercancía (`#compras-recepciones`)**: KPIs en tiempo real, filtros, tabla histórica y visores de 1 clic (`Factura XML/PDF`, `Evidencias`, `Incidencia / NC` y `Expediente 360°`). |
| [frontend/scripts/loaders/reception-wizard.js](file:///C:/Users/ACTECK%201/.gemini/antigravity/scratch/CALEBSYS/frontend/scripts/loaders/reception-wizard.js) | **Asistente Inteligente de Recepción (Wizard de 5 Pasos)** integrado en página (no flotante): carga de XML CFDI 4.0 + PDF, hoja de homologación y pre-alta con escalas/márgenes y alta avanzada, costeo *Landed Cost* con múltiples transportes/fletes, conteo físico/evidencias/incidencias y calificación de proveedor. |

---

### ✏️ Archivos Modificados (17 archivos)
| Archivo | Líneas Modificadas | Resumen de Cambios |
| :--- | :---: | :--- |
| [backend/models.py](file:///C:/Users/ACTECK%201/.gemini/antigravity/scratch/CALEBSYS/backend/models.py) | `+131` | Nuevos modelos `ReceptionExpediente`, `ReceptionFile`, `OperatingExpense` y nuevas columnas de seguimiento en `AccountsPayable`. |
| [backend/main.py](file:///C:/Users/ACTECK%201/.gemini/antigravity/scratch/CALEBSYS/backend/main.py) | `+71 / -18` | Registro de `receptions.router`, auto-migración SQLite de tablas/columnas (`ensure_reception_tables`, `ensure_ap_columns`), endpoints enriquecidos de `/api/accounts-payable` (listado, detalle con factura y descarga/visor de XML/PDF) y cabeceras `Cache-Control: no-cache` para `.html`, `.js` y `.css`. |
| [backend/routers/products.py](file:///C:/Users/ACTECK%201/.gemini/antigravity/scratch/CALEBSYS/backend/routers/products.py) | `+898 / -42` | Endpoints de búsqueda/homologación de productos por SKU, código de barras, código alterno y SKU XML de proveedor (`Complementos F4`), sincronización de existencias/Kardex por sucursal (`F3`), escalas de precios (`F2`) y ofertas (`F3`). |
| [backend/crud.py](file:///C:/Users/ACTECK%201/.gemini/antigravity/scratch/CALEBSYS/backend/crud.py) | `+359 / -31` | Persistencia completa de metadatos extendidos de productos (`meta_data`), escalas de precios, códigos alternos, proveedores vinculados y actualización transaccional de inventario. |
| [backend/schemas.py](file:///C:/Users/ACTECK%201/.gemini/antigravity/scratch/CALEBSYS/backend/schemas.py) | `+11 / -2` | Esquemas Pydantic actualizados para soportar campos extendidos de producto y metadatos. |
| [frontend/admin_shell.html](file:///C:/Users/ACTECK%201/.gemini/antigravity/scratch/CALEBSYS/frontend/admin_shell.html) | `+38 / -12` | Inclusión de `reception-hub.js`, `reception-wizard.js` y actualización de versionado de scripts (`?v=20261025b`). |
| [frontend/scripts/admin-shell.js](file:///C:/Users/ACTECK%201/.gemini/antigravity/scratch/CALEBSYS/frontend/scripts/admin-shell.js) | `+88 / -19` | Navegación SPA, preservación de estado al abrir `#producto-alta` en modo edición vs. nuevo registro, y recarga limpia de vistas. |
| [frontend/pages/admin/productos.html](file:///C:/Users/ACTECK%201/.gemini/antigravity/scratch/CALEBSYS/frontend/pages/admin/productos.html) | `+911 / -85` | Catálogo de Productos (`#productos`) con barra de acciones por teclado (`INS` Nuevo, `ENTER` Editar, `F1` Producto Express, `F2` Cambio de Precio), filtros y modales operativos. |
| [frontend/scripts/loaders/products.js](file:///C:/Users/ACTECK%201/.gemini/antigravity/scratch/CALEBSYS/frontend/scripts/loaders/products.js) | `+4,526 / -310` | Separación quirúrgica entre `ENTER (Editar producto seleccionado)` e `INS (Nuevo Producto)`, flujo completo de **Producto Express `[F1]`** (escaneo de producto existente/nuevo, guardado con `Enter` en Precio Final y limpieza automática para captura continua), y búsqueda de código de proveedor XML (`findProductBySupplierXmlSku`). |
| [frontend/pages/admin/producto-alta.html](file:///C:/Users/ACTECK%201/.gemini/antigravity/scratch/CALEBSYS/frontend/pages/admin/producto-alta.html) | `+845 / -120` | Vista de **Alta / Edición de Producto (`#producto-alta`)** con pestañas `F1` a `F6`, y nueva barra inferior en **Stock y Operaciones `[F3]`** con botones **`Imprimir Reporte`**, **`Exportar Excel / CSV`** y **`Enviar Reporte`**. |
| [frontend/scripts/loaders/products-form.js](file:///C:/Users/ACTECK%201/.gemini/antigravity/scratch/CALEBSYS/frontend/scripts/loaders/products-form.js) | `+5,054 / -480` | Controlador integral de `#producto-alta` (`F1` Información General, `F2` Escalas de Precios y Márgenes, `F3` Stock/Operaciones/Kardex por Sucursal + impresión PDF y envío por WhatsApp/Correo, `F4` Complementos y Homologación XML de Proveedores, `F5` Catálogos, `F6` Etiquetas) y retorno automático al Wizard de Recepción tras Alta Avanzada. |
| [frontend/pages/admin/compras-recepciones.html](file:///C:/Users/ACTECK%201/.gemini/antigravity/scratch/CALEBSYS/frontend/pages/admin/compras-recepciones.html) | `+294 / -95` | Estructura HTML del Dashboard de **Recepción de Mercancía (`#compras-recepciones`)**, tarjetas KPI, contenedor inline del Wizard de 5 pasos y visores documentales. |
| [frontend/pages/admin/compras-cxp.html](file:///C:/Users/ACTECK%201/.gemini/antigravity/scratch/CALEBSYS/frontend/pages/admin/compras-cxp.html) | `+23 / -13` | Tabla de **Cuentas por Pagar (`#compras-cxp`)** ampliada a 10 columnas (`Folio Seguimiento (CxP)`, `Proveedor`, `Folio Fiscal / Factura`, `Fecha de Recepción`, `Día de Emisión`, `Fecha de Vencimiento`, `Total`, `Saldo`, `Estado`, `Acciones`) y modal ampliado para visor de factura. |
| [frontend/scripts/admin/page-inits.js](file:///C:/Users/ACTECK%201/.gemini/antigravity/scratch/CALEBSYS/frontend/scripts/admin/page-inits.js) | `+3,610 / -3,301` | Actualización de `compras-cxp` para alimentar todos los campos de seguimiento fiscal/recepción, filtros por UUID/Folio/Recepción, delegación `data-click` compatible con `Content-Security-Policy` y visor embebido de PDF y XML en el botón del ojito (`👁️`). |
| [frontend/scripts/loaders/config-hub.js](file:///C:/Users/ACTECK%201/.gemini/antigravity/scratch/CALEBSYS/frontend/scripts/loaders/config-hub.js) | `+4,319 / -612` | Configuración de parámetros operativos, sucursales, escalas y preferencias del sistema. |
| [frontend/scripts/app/03-search-ui.js](file:///C:/Users/ACTECK%201/.gemini/antigravity/scratch/CALEBSYS/frontend/scripts/app/03-search-ui.js) | `+103 / -18` | Sincronización del buscador del POS con los productos, códigos alternos y precios actualizados. |
| [frontend/scripts/app/04-pos-cart.js](file:///C:/Users/ACTECK%201/.gemini/antigravity/scratch/CALEBSYS/frontend/scripts/app/04-pos-cart.js) | `+1,165 / -140` | Integración de escalas de precios, existencias y validaciones en el carrito del POS. |

---

## 2. Detalle Funcional por Módulo

### A. Recepción de Mercancía 360° (`#compras-recepciones`)
1. **Dashboard y Expediente 360° en 1 Clic:**
   - 4 KPIs superiores: Recepciones del Mes, Costos de Flete / Maniobras Prorrateados (`%`), Incidencias / Notas de Crédito Pendientes y Calificación Promedio de Proveedores (`⭐`).
   - Tabla histórica con botones de 1 clic para ver **Factura XML/PDF**, **Evidencias Fotográficas**, **Incidencia / NC** y **Expediente 360°** (13 puntos de auditoría).
2. **Asistente Inteligente de Recepción (Wizard de 5 Pasos integrado en pantalla, no flotante):**
   - **Paso 1 (Origen, OC y Bóveda CFDI 4.0):** Selector de tipo de recepción, vinculación con Orden de Compra (`OC`), parser real de XML CFDI 4.0 + carga de PDF y condición de pago.
   - **Paso 2 (Hoja Precargada de Homologación y Pre-Alta XML):**
     - Reconocimiento flexible por **1, 2 o 3 códigos** (`Código Proveedor XML`, `SKU`, `Código de Barras`, `Código Alterno`).
     - Escalas de precios (`P1` a `P5`) conectadas bidireccionalmente con los **márgenes de utilidad (`%`)**.
     - Botón **`Confirmar Alta de Todos los Productos`** en lote.
     - Botón **`Alta de Producto Avanzada`**: abre `#producto-alta` completo con los datos del renglón XML precargados y, al guardar (`F12`), regresa automáticamente al Paso 2 del Wizard para continuar con el siguiente producto.
   - **Paso 3 (Motor de Costeo Real — *Landed Cost* Multi-Transporte):**
     - Permite agregar **1, 2, 3 o más fletes/traslados** (`+ Agregar otro transporte / flete`) para compras con transbordos entre ciudades, prorrateando el flete en el costo real unitario.
   - **Paso 4 (Conteo Físico, Evidencias e Incidencias):**
     - Captura de cantidades recibidas/dañadas, fotos de evidencia y generación automática de reclamo / Nota de Crédito si hay faltantes o daños.
   - **Paso 5 (Calificación `⭐⭐⭐⭐⭐` y Cierre Transaccional):**
     - Afecta existencias, actualiza costos/precios, guarda el vínculo en `Complementos [F4]` y genera las Cuentas por Pagar de mercancía y fletes.

### B. Cuentas por Pagar (`#compras-cxp`)
1. **Nuevos Datos de Seguimiento en Tabla y Detalle:**
   - **Folio de Seguimiento (CxP):** `CXP-AAAA-####` (ej. `CXP-2026-0001`).
   - **Folio Fiscal (UUID) y Serie/Folio de Factura:** Leídos directamente de la recepción o del XML CFDI adjunto.
   - **Fecha de Recepción y Folio de Recepción (`RCP-AAAA-####`)**.
   - **Día / Fecha de Emisión del CFDI**.
   - **Fecha de Vencimiento y Días de Crédito**.
2. **Visor de Factura en el Botón del Ojito (`👁️`):**
   - Al pulsar el ícono del ojo en la columna `ACCIONES`, se abre el modal con el desglose fiscal de la factura y el **visor embebido de PDF y XML** con opción de descarga directa.

### C. Catálogo de Productos (`#productos`), Producto Express (`[F1]`) y Alta/Edición (`#producto-alta`)
1. **Separación Quirúrgica `ENTER (Editar)` vs `INS (Nuevo Producto)`:**
   - Presionar **`Enter`** o clic en **`Editar [ENTER]`** sobre un producto abre `#producto-alta` en **Modo Edición** cargando íntegramente sus datos en `F1` a `F6` sin que el cambio de hash limpie el formulario.
   - Presionar **`Insert (INS)`** o clic en **`Nuevo Producto [INS]`** abre `#producto-alta` limpio en **Modo Nuevo Registro**.
2. **Producto Express `[F1]`:**
   - Al escanear un producto ya existente, precarga su nombre y precio; al llegar al **Precio Final** con `Enter` y presionar `Enter` nuevamente, guarda/suma al inventario y **limpia todos los campos automáticamente** para capturar el siguiente artículo.
3. **Barra Inferior de Reportes en `Stock y Operaciones [F3]`:**
   - Botones al pie del Kardex del producto para **`🖨️ Imprimir Reporte`** (PDF completo con KPIs, tabla por sucursal y movimientos de Kardex), **`📄 Exportar Excel / CSV`** y **`✈️ Enviar Reporte`** (por WhatsApp, Correo Electrónico o copiar al portapapeles).
