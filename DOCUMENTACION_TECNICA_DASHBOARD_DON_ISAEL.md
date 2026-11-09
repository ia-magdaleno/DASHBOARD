# DOCUMENTACIÓN TÉCNICA Y ARQUITECTÓNICA — DASHBOARD PRINCIPAL ERP CALEBSYS
**Documento Técnico preparado para:** Don Isael  
**Sistema:** CALEBSYS ERP · POS · CRM · IA (`v5.1A`)  
**Módulo:** Motor de Dashboard Principal Configurable, Multiempresa, Multisucursal y Basado en Widgets + Conector Abierto de Módulos (`Plug & Play`)  
**Ruta en el Sistema:** `Administración > Principal > Dashboard` (`/admin#dashboard`)

---

## 1. Resumen Ejecutivo

Se diseñó e implementó desde cero el nuevo **Motor de Dashboard Principal del ERP CALEBSYS**, sustituyendo la vista rígida anterior por una **plataforma modular basada en widgets configurables, persistentes en base de datos, aislados por empresa/sucursal y gobernados por permisos de rol (RBAC)**.

Adicionalmente, el motor incorpora:
1. **Explorador Universal de Ventanas, Rutas y Parámetros:** Permite buscar cualquier ventana del sistema mostrando su **ruta exacta** (ej. `Operaciones > Recepción de Mercancía · /admin#compras-recepciones`) y todas las opciones/indicadores disponibles en esa ventana para colocarlos en el Dashboard con un clic.
2. **Conexión Abierta (`Plug & Play`) para Futuros Módulos (ej. Producción):** Deja abierta la arquitectura tanto en interfaz gráfica como en API REST (`POST /api/dashboard/modules/register`), Python y JavaScript para que cuando se cree cualquier módulo nuevo (como **Producción**, **Mantenimiento**, **Calidad** o **Flotilla**), se pueda registrar su ventana, su ruta y crear su widget en caliente sin modificar el núcleo del Dashboard.
3. **Ajustador Manual 1:1 del Banner Empresarial:** Modal interactivo con lienzo a escala exacta (`width × height` real del panel), arrastre con mouse, zoom, posición horizontal/vertical y brillo.
4. **Adaptación Automática a Modo Oscuro / Modo Claro y Vista en 1 Sola Ventana:** Sincronización en vivo con el tema del Admin Shell y ajuste compacto (`1 Ventana` / `Expandir Vista`) con controles flotantes de desplazamiento (`▲` / `▼`).

---

## 2. Inventario de Archivos del Módulo Dashboard

### 2.1 Backend (`backend/dashboard/` y modelos)

| Archivo | Responsabilidad Técnica |
| :--- | :--- |
| `backend/dashboard/__init__.py` | Inicializador del paquete modular `dashboard` y exportación del router FastAPI. |
| `backend/dashboard/schemas.py` | Esquemas Pydantic v2 con validación estricta de layouts, dimensiones (`x, y, w, h`), filtros globales/locales y **bloqueo anti-XSS / anti-inyección** (rechaza `<script>`, `javascript:`, `onerror=`, SQL crudo o HTML arbitrario). |
| `backend/dashboard/permissions.py` | Matriz RBAC de capacidades (`dashboard.view`, `dashboard.view_consolidated`, `dashboard.finance.view`, `dashboard.edit_self`, `dashboard.edit_company`, etc.) y resolución del alcance de sucursal (`ALL` vs. `sucursal_id` asignada). |
| `backend/dashboard/metrics.py` | Diccionario formal de métricas del ERP (`METRIC_DEFINITIONS`), resolución de zonas horarias (`America/Mazatlan`), periodos (`today`, `yesterday`, `7d`, `30d`, `month`, `prev_month`, `year`, `custom`) y periodos comparativos equivalentes. |
| `backend/dashboard/widget_registry.py` | Catálogo central de **25+ widgets**, **7 plantillas oficiales por rol**, el **Directorio Completo de las 23+ Ventanas, Rutas y Parámetros de CALEBSYS** (`WINDOWS_PARAMETERS_DIRECTORY`) y las funciones de **Conexión Abierta** (`register_external_module_window`, `register_external_widget`, `get_merged_windows_directory`). |
| `backend/dashboard/providers.py` | Proveedores de datos reales en SQLAlchemy/SQLite/PostgreSQL para cada widget, incluyendo el proveedor universal `window_parameter_card` y el conector automático de tablas SQL (`sourceTable`) para módulos nuevos como **Producción**. |
| `backend/dashboard/router.py` | API REST completa bajo `/api/dashboard/*`: contexto, catálogo, layouts jerárquicos, guardado con bloqueo optimista (`HTTP 409`), clonación, exportación/importación JSON, carga por lote (`/snapshot`), buscador global por ruta (`/search`), SSE (`/stream`) y registro abierto de nuevos módulos (`/modules/register`). |
| `backend/models.py` | Modelos SQLAlchemy `DashboardLayout` (diseños persistidos por empresa/sucursal/rol/usuario con versión) y `DashboardLayoutAudit` (bitácora de auditoría de cambios), más tabla dinámica `dashboard_custom_modules`. |
| `backend/tests/test_dashboard_erp.py` | Suite de pruebas automatizadas (`pytest`) que valida catálogo, persistencia, conflicto de concurrencia `HTTP 409`, aislamiento multiempresa/multisucursal, privacidad financiera en IA por rol y rechazo de JSON malicioso. |

### 2.2 Frontend (`frontend/pages/admin/`, `frontend/styles/dashboard/`, `frontend/scripts/dashboard/`)

| Archivo | Responsabilidad Técnica |
| :--- | :--- |
| `frontend/pages/admin/dashboard.html` | Estructura HTML5 semántica del Dashboard: barra ejecutiva, buscador global (`Ctrl + K`), banner empresarial adaptable, barra de filtros globales, barra de modo edición, rejilla de 12 columnas y modales (Explorador de Ventanas/Rutas + Conector de Nuevos Módulos, Plantillas, Recortador Manual 1:1 de Imagen, Copiloto IA, Exportar/Importar JSON y Drawer de configuración por widget). |
| `frontend/styles/dashboard/tokens.css` | Sistema centralizado de tokens visuales CSS (`--dash-*`) para Modo Oscuro Corporativo y Modo Claro (`[data-theme="light"]`). |
| `frontend/styles/dashboard/dashboard.css` | Estilos de la rejilla de 12 columnas, tarjetas KPI con sparkline, gráficas SVG, modo compacto `1 Ventana`, explorador de rutas y recortador interactivo de imagen. |
| `frontend/scripts/dashboard/registry.js` | Registro de renderizadores visuales en Vanilla JS + SVG puro (cero dependencias externas pesadas, 100% compatible con CSP `script-src 'self'`). |
| `frontend/scripts/dashboard/layout-engine.js` | Motor interactivo de rejilla de 12 columnas: Drag & Drop por puntero, redimensionamiento (`w × h`), compactación vertical automática sin traslapes y serialización JSON. |
| `frontend/scripts/dashboard/editor.js` | Controlador principal del Dashboard: ciclo de vida SPA, petición en lote `/api/dashboard/snapshot`, buscador por ruta, conector de nuevos módulos (`window.CalebsysDashboardEngine.registerNewModuleAndWidget`), historial `Deshacer/Rehacer`, borradores locales y recortador 1:1 de imagen del banner. |

---

## 3. Arquitectura de Seguridad, Multiempresa y Permisos (RBAC)

1. **Aislamiento Multiempresa (`empresa_id`) y Multisucursal (`sucursal_id`):**
   - Todas las consultas en `backend/dashboard/providers.py` y `backend/dashboard/router.py` extraen `empresa_id` y `sucursal_id` directamente del token JWT autenticado (`get_tenant_context`), nunca confiando ciegamente en parámetros enviados por el cliente.
   - Si un usuario no posee el permiso `dashboard.view_consolidated`, el backend fuerza automáticamente el alcance a su propia sucursal activa (`effective_sucursal_id`), impidiendo ver montos de otras sucursales o el consolidado de matriz.
2. **Privacidad Financiera por Rol:**
   - Un **Cajero**, **Vendedor** o **Almacenista** no tiene la capacidad `dashboard.finance.view`.
   - Si intenta solicitar el widget `financial_summary_month` (Utilidad Bruta, Costo de Ventas, Margen Neto), el backend responde con estado `forbidden` para ese widget sin romper el resto del Dashboard, y el **Copiloto Ejecutivo IA** omite cualquier dato de utilidad o margen.
3. **Jerarquía de Diseños (`Layout Hierarchy`):**
   - Al abrir el Dashboard, `/api/dashboard/layouts/active` resuelve el diseño activo siguiendo la jerarquía:
     1. Diseño personalizado del **Usuario** (`scope_type = 'user'`)
     2. Diseño de la **Sucursal** (`scope_type = 'branch'`)
     3. Plantilla asignada al **Rol** (`scope_type = 'role'`)
     4. Plantilla corporativa de la **Empresa** (`scope_type = 'company'`)
     5. Plantilla predeterminada del **Sistema** según el rol (`executive`, `commercial`, `operations`, `finance`, `inventory`, `branch`, `seller`).
4. **Control de Concurrencia Optimista (`HTTP 409 VERSION_CONFLICT`):**
   - Cada guardado valida `req.version == row.version`. Si otro administrador modificó el mismo layout simultáneamente, devuelve `HTTP 409` con los metadatos de la versión del servidor y abre el modal de resolución de conflictos.

---

## 4. Explorador Universal de Ventanas, Rutas y Parámetros

Tanto en el buscador superior (`Ctrl + K`) como en el botón **`+ Agregar módulo`** (modo **`Por Ventana y Ruta`**), el sistema expone el directorio completo de ventanas de CALEBSYS con su ruta exacta:

- `Principal > Punto de Venta (POS)` (`/`)
- `Operaciones > Productos` (`/admin#productos`)
- `Operaciones > Inventario` (`/admin#inventario`)
- `Operaciones > CFDI 4.0` (`/admin#cfdi`)
- `Operaciones > Kardex` (`/admin#kardex`)
- `Operaciones > Traslados` (`/admin#traspasos`)
- `Operaciones > Devoluciones` (`/admin#almacen-devoluciones`)
- `Operaciones > Ajuste de Inventario` (`/admin#almacen-ajuste`)
- `Operaciones > Recepción de Mercancía` (`/admin#compras-recepciones`)
- `Operaciones > Producción` (`/admin#produccion`)
- `Compras > Proveedores` (`/admin#proveedores`)
- `Compras > Órdenes de Compra` (`/admin#compras-ordenes`)
- `Compras > Cuentas x Pagar` (`/admin#compras-cxp`)
- `Clientes y Finanzas > Clientes / CRM` (`/admin#clientes`)
- `Clientes y Finanzas > Cuentas x Cobrar` (`/admin#cuentas_cobrar`)
- `Clientes y Finanzas > Caja y Cortes` (`/admin#caja`)
- `Administración > Recursos Humanos` (`/admin#recursos-humanos`)
- `Administración > Reportes y Analítica` (`/admin#reportes`)
- `Comercial > Configuración de Vendedores` (`/admin#sellers-config`)
- `Comercial > Proyectos y Obras` (`/admin#projects`)
- `Comercial > Contratistas` (`/admin#contractors`)
- `Comercial > Fidelización de Puntos` (`/admin#loyalty`)
- `Logística > Rutas de Reparto` (`/admin#rutas`)
- `Sistema > Usuarios y Roles` (`/admin#usuarios`)
- `Sistema > Auditoría` (`/admin#auditoria`)
- `Sistema > Configuración` (`/admin#configuracion`)

Cada tarjeta colocada en el Dashboard muestra un botón de ruta (`📍 Operaciones > ... ↗`) que lleva directamente a la ventana origen al hacer clic.

---

## 5. Guía Técnica: Cómo Conectar un Módulo Nuevo (Ej. Producción) y Crear su Widget

El motor cuenta con **3 vías abiertas** para sumar cualquier módulo futuro y sus widgets sin tocar el código base del Dashboard:

### Vía 1: Desde la Interfaz Gráfica del Dashboard (Sin escribir código)
1. Entrar a `/admin#dashboard` y hacer clic en **`Personalizar dashboard`** → **`+ Agregar módulo`**.
2. Presionar el botón verde **`🔌 + Conectar Nuevo Módulo / Widget`**.
3. Capturar:
   - **Nombre del Módulo / Ventana:** ej. `PRODUCCIÓN` (se normaliza automáticamente a MAYÚSCULAS conforme a `AGENTS.md`).
   - **Ruta donde está en el sistema:** ej. `OPERACIONES > PRODUCCIÓN`.
   - **URL / Hash de la Ventana:** ej. `/admin#produccion`.
   - **Nombre del Widget / Parámetro a poner:** ej. `ÓRDENES DE PRODUCCIÓN EN PROCESO`.
   - **Descripción del Indicador:** ej. `CONTROL DE LOTES, MATERIA PRIMA Y PRODUCTO TERMINADO`.
   - **Tabla SQL / Origen de Datos (Opcional):** ej. `production_orders` (si la tabla existe en la BD, el proveedor consulta automáticamente el conteo real de registros filtrando por `empresa_id`).
4. Hacer clic en **`Conectar Módulo y Poner Widget en el Dashboard`**. El módulo queda guardado permanentemente en la tabla `dashboard_custom_modules` y el widget se coloca de inmediato en el tablero.

### Vía 2: Vía API REST (`POST /api/dashboard/modules/register`)
Cualquier módulo backend o microservicio puede registrar su ventana y sus widgets enviando:
```json
POST /api/dashboard/modules/register
{
  "windowId": "produccion",
  "windowName": "PRODUCCIÓN Y MANUFACTURA",
  "section": "OPERACIONES Y PLANTA",
  "routePath": "OPERACIONES > PRODUCCIÓN",
  "routeUrl": "/admin#produccion",
  "page": "produccion",
  "icon": "fa-industry",
  "accent": "orange",
  "sourceTable": "production_orders",
  "paramTitle": "ÓRDENES DE PRODUCCIÓN ACTIVAS",
  "paramDescription": "SEGUIMIENTO DE LOTES EN PLANTA Y MERMA"
}
```

### Vía 3: Vía SDK en Python o JavaScript
- **En Python (`backend/dashboard/widget_registry.py`):**
  ```python
  from dashboard.widget_registry import register_external_module_window, register_external_widget

  register_external_module_window({
      "windowId": "produccion",
      "windowName": "PRODUCCIÓN Y MANUFACTURA",
      "routePath": "OPERACIONES > PRODUCCIÓN",
      "routeUrl": "/admin#produccion",
      "page": "produccion",
      "icon": "fa-industry",
      "accent": "orange",
      "sourceTable": "production_orders",
      "options": [
          {
              "paramId": "produccion.lotes_hoy",
              "title": "LOTES PRODUCIDOS HOY",
              "description": "UNIDADES TERMINADAS EN PLANTA",
              "widgetKey": "window_parameter_card",
              "accent": "orange",
          }
      ],
  })
  ```
- **En JavaScript (`frontend`):**
  ```javascript
  await window.CalebsysDashboardEngine.registerNewModuleAndWidget({
    windowName: 'PRODUCCIÓN',
    routePath: 'OPERACIONES > PRODUCCIÓN',
    routeUrl: '/admin#produccion',
    paramTitle: 'LOTES TERMINADOS HOY',
    sourceTable: 'production_orders',
    accent: 'orange',
    autoPlace: true
  });
  ```

---

## 6. Ejecución de Pruebas Automatizadas

Para verificar la integridad completa del motor de Dashboard en cualquier entorno:

```powershell
cd backend
..\.venv\Scripts\python.exe -m pytest tests/test_dashboard_erp.py -v
```
