"""Schemas Pydantic v2 y validación de seguridad de layouts del Dashboard ERP (Sección 15)."""
import re
from typing import Any, Dict, List, Optional
from pydantic import BaseModel, Field, field_validator, model_validator

from dashboard.widget_registry import WIDGET_CATALOG

_DANGEROUS_PATTERN = re.compile(
    r"(<\s*script|<\s*iframe|<\s*object|<\s*embed|javascript\s*:|vbscript\s*:|on\w+\s*=|<\s*style|expression\s*\()",
    re.IGNORECASE,
)

ALLOWED_MODES = {"dark", "light", "executive", "compact", "high_contrast"}
ALLOWED_VARIANTS = {"executive", "glass", "flat", "outline", "solid", "minimal"}
ALLOWED_DENSITIES = {"comfortable", "compact"}
ALLOWED_ACCENTS = {"blue", "cyan", "green", "purple", "orange", "red"}
ALLOWED_SCOPES = {"system", "company", "branch", "role", "user"}


def _assert_safe_value(val: Any, path: str = "root") -> None:
    """Rechaza cualquier intento de inyectar HTML, scripts, CSS ejecutable o URLs inseguras."""
    if isinstance(val, str):
        if _DANGEROUS_PATTERN.search(val):
            raise ValueError(f"Contenido no permitido o potencialmente inseguro detectado en '{path}'.")
        if "<" in val and ">" in val:
            raise ValueError(f"No se permite HTML arbitrario en '{path}'.")
    elif isinstance(val, dict):
        for k, v in val.items():
            _assert_safe_value(k, f"{path}.key")
            _assert_safe_value(v, f"{path}.{k}")
    elif isinstance(val, list):
        for idx, item in enumerate(val):
            _assert_safe_value(item, f"{path}[{idx}]")


class GridRectSchema(BaseModel):
    x: int = Field(ge=0, le=11)
    y: int = Field(ge=0, le=200)
    w: int = Field(ge=1, le=12)
    h: int = Field(ge=1, le=12)

    @model_validator(mode="after")
    def _validate_bounds(self):
        if self.x + self.w > 12:
            self.x = max(0, 12 - self.w)
        return self


class WidgetPositionsSchema(BaseModel):
    desktop: GridRectSchema
    tablet: Optional[GridRectSchema] = None
    mobile: Optional[GridRectSchema] = None


class WidgetInstanceSchema(BaseModel):
    instanceId: str = Field(min_length=2, max_length=80)
    widgetKey: str = Field(min_length=2, max_length=64)
    widgetVersion: int = Field(default=1, ge=1, le=10)
    visible: bool = True
    locked: bool = False
    positions: WidgetPositionsSchema
    settings: Dict[str, Any] = Field(default_factory=dict)
    filters: Dict[str, Any] = Field(default_factory=dict)

    @field_validator("instanceId", "widgetKey")
    @classmethod
    def _clean_id(cls, v: str) -> str:
        _assert_safe_value(v, "widget.id")
        if not re.match(r"^[a-zA-Z0-9_\-]+$", v):
            raise ValueError("Identificador de widget inválido.")
        return v

    @model_validator(mode="after")
    def _validate_against_catalog(self):
        wdef = WIDGET_CATALOG.get(self.widgetKey)
        if not wdef:
            raise ValueError(f"El widget '{self.widgetKey}' no existe en el catálogo oficial.")
        expected_version = wdef.get("version", 1)
        if self.widgetVersion > expected_version:
            raise ValueError(
                f"Versión incompatible ({self.widgetVersion}) para el widget '{self.widgetKey}' (máx {expected_version})."
            )
        min_s = wdef.get("minSize", {"w": 1, "h": 1})
        max_s = wdef.get("maxSize", {"w": 12, "h": 12})
        d = self.positions.desktop
        if d.w < min_s["w"] or d.w > max_s["w"] or d.h < min_s["h"] or d.h > max_s["h"]:
            raise ValueError(
                f"Tamaño ({d.w}x{d.h}) fuera de rango permitido para '{self.widgetKey}' "
                f"(min {min_s['w']}x{min_s['h']}, max {max_s['w']}x{max_s['h']})."
            )
        _assert_safe_value(self.settings, f"widget[{self.instanceId}].settings")
        _assert_safe_value(self.filters, f"widget[{self.instanceId}].filters")
        # Normalizar título personalizado a MAYÚSCULAS según regla Calebsys si existe
        if isinstance(self.settings.get("customTitle"), str) and self.settings["customTitle"].strip():
            self.settings["customTitle"] = self.settings["customTitle"].strip().upper()
        if isinstance(self.settings.get("customSubtitle"), str) and self.settings["customSubtitle"].strip():
            self.settings["customSubtitle"] = self.settings["customSubtitle"].strip().upper()
        return self


class ThemeSchema(BaseModel):
    mode: str = "dark"
    variant: str = "executive"
    density: str = "comfortable"
    accent: str = "blue"
    showHero: bool = True
    heroStyle: str = "illustrated"
    heroImageUrl: Optional[str] = None

    @model_validator(mode="after")
    def _validate_theme(self):
        if self.mode not in ALLOWED_MODES:
            self.mode = "dark"
        if self.variant not in ALLOWED_VARIANTS:
            self.variant = "executive"
        if self.density not in ALLOWED_DENSITIES:
            self.density = "comfortable"
        if self.accent not in ALLOWED_ACCENTS:
            self.accent = "blue"
        if self.heroStyle not in ("illustrated", "compact", "executive", "hidden"):
            self.heroStyle = "illustrated"
        if self.heroImageUrl:
            val = self.heroImageUrl.strip()
            if not (
                val.startswith("/assets/")
                or val.startswith("data:image/jpeg;base64,")
                or val.startswith("data:image/png;base64,")
                or val.startswith("data:image/webp;base64,")
            ):
                self.heroImageUrl = None
            elif len(val) > 900_000:
                self.heroImageUrl = None
            else:
                self.heroImageUrl = val
        return self


class GlobalFiltersSchema(BaseModel):
    datePreset: str = "today"
    dateFrom: Optional[str] = None
    dateTo: Optional[str] = None
    branchMode: str = "ALL"
    warehouseId: Optional[str] = None
    sellerId: Optional[str] = None
    channel: Optional[str] = None
    department: Optional[str] = None
    comparison: str = "previous_period"

    @model_validator(mode="after")
    def _validate_filters(self):
        _assert_safe_value(self.model_dump(), "globalFilters")
        return self


class LayoutPayloadSchema(BaseModel):
    schemaVersion: int = Field(default=1, ge=1, le=5)
    dashboardKey: str = Field(default="erp_main", max_length=64)
    name: str = Field(default="DASHBOARD EJECUTIVO", min_length=1, max_length=140)
    breakpoints: Dict[str, int] = Field(default_factory=lambda: {"desktop": 1200, "tablet": 768, "mobile": 0})
    theme: ThemeSchema = Field(default_factory=ThemeSchema)
    globalFilters: GlobalFiltersSchema = Field(default_factory=GlobalFiltersSchema)
    widgets: List[WidgetInstanceSchema] = Field(default_factory=list, max_length=40)

    @model_validator(mode="after")
    def _validate_layout(self):
        _assert_safe_value(self.name, "layout.name")
        # Regla global Calebsys: nombres de negocio capturados por el usuario en MAYÚSCULAS
        self.name = self.name.strip().upper()
        seen_ids = set()
        counts_by_key: Dict[str, int] = {}
        for w in self.widgets:
            if w.instanceId in seen_ids:
                raise ValueError(f"ID de instancia duplicado: '{w.instanceId}'.")
            seen_ids.add(w.instanceId)
            counts_by_key[w.widgetKey] = counts_by_key.get(w.widgetKey, 0) + 1
            wdef = WIDGET_CATALOG.get(w.widgetKey, {})
            if not wdef.get("allowMultiple", False) and counts_by_key[w.widgetKey] > 1:
                raise ValueError(f"El widget '{w.widgetKey}' no permite múltiples instancias en el mismo dashboard.")
        return self


class LayoutCreateRequest(BaseModel):
    name: str = Field(default="MI DASHBOARD", min_length=1, max_length=140)
    dashboardKey: str = "erp_main"
    scopeType: str = "user"  # user|role|branch|company
    scopeId: Optional[str] = None
    isDefault: bool = False
    isLocked: bool = False
    templateId: Optional[str] = None
    layout: Optional[LayoutPayloadSchema] = None

    @field_validator("name")
    @classmethod
    def _upper_name(cls, v: str) -> str:
        _assert_safe_value(v, "name")
        return v.strip().upper()

    @field_validator("scopeType")
    @classmethod
    def _check_scope(cls, v: str) -> str:
        if v not in ALLOWED_SCOPES:
            raise ValueError(f"scopeType inválido: {v}")
        return v


class LayoutUpdateRequest(BaseModel):
    version: int = Field(ge=1)
    name: Optional[str] = Field(default=None, max_length=140)
    isDefault: Optional[bool] = None
    isLocked: Optional[bool] = None
    layout: LayoutPayloadSchema

    @field_validator("name")
    @classmethod
    def _upper_name(cls, v: Optional[str]) -> Optional[str]:
        if v is not None:
            _assert_safe_value(v, "name")
            return v.strip().upper()
        return v


class LayoutCloneRequest(BaseModel):
    name: str = Field(min_length=1, max_length=140)
    scopeType: str = "user"
    scopeId: Optional[str] = None

    @field_validator("name")
    @classmethod
    def _upper_name(cls, v: str) -> str:
        _assert_safe_value(v, "name")
        return v.strip().upper()


class LayoutResetRequest(BaseModel):
    templateId: str = "executive"


class SnapshotWidgetItem(BaseModel):
    instanceId: str
    widgetKey: str
    filters: Dict[str, Any] = Field(default_factory=dict)
    settings: Dict[str, Any] = Field(default_factory=dict)


class SnapshotRequestSchema(BaseModel):
    dashboardKey: str = "erp_main"
    globalFilters: GlobalFiltersSchema = Field(default_factory=GlobalFiltersSchema)
    widgetRequests: List[SnapshotWidgetItem] = Field(default_factory=list, max_length=40)
