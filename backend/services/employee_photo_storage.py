"""
Almacenamiento local de fotos de empleados (RH).

Este módulo NO existía en el repo (bug pre-existente, confirmado por
`git log --all` — nunca se commiteó): backend/main.py lo importa
(`from services.employee_photo_storage import ...`) pero el archivo no
estaba en ningún commit, así que la app no podía ni arrancar. Se agrega
aquí una implementación mínima que respeta exactamente la interfaz que
main.py ya espera (ver líneas ~2015-2085 de main.py).

Interfaz usada por main.py:
    - LocalEmployeePhotoStorage().save(empresa_id, employee_id, content, content_type) -> filename
    - LocalEmployeePhotoStorage().delete(empresa_id, employee_id, filename) -> None
    - LocalEmployeePhotoStorage().open(empresa_id, employee_id, filename) -> (path, media_type)
    - MAX_PHOTO_BYTES
    - PhotoStorageError (con mensajes "photo_too_large" / "unsupported_content_type")

⚠️ IMPORTANTE para Docker/servidor: esto guarda archivos en disco local
(EMPLOYEE_PHOTOS_DIR, por defecto backend/../media/employee_photos). En
un contenedor sin volumen persistente, las fotos se pierden en cada
redeploy. Si vas a producción real detrás de Docker, monta un volumen
sobre esa carpeta (ver docker-compose.yml) o reemplaza esta clase por un
backend de objetos (S3-compatible / equivalente).
"""
import os
import uuid

MAX_PHOTO_BYTES = 5 * 1024 * 1024  # 5 MB

_ALLOWED_CONTENT_TYPES = {
    "image/jpeg": ".jpg",
    "image/jpg": ".jpg",
    "image/png": ".png",
    "image/webp": ".webp",
}

_EXT_TO_MEDIA_TYPE = {
    ".jpg": "image/jpeg",
    ".png": "image/png",
    ".webp": "image/webp",
}

MEDIA_ROOT = os.environ.get(
    "EMPLOYEE_PHOTOS_DIR",
    os.path.join(
        os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
        "..", "media", "employee_photos",
    ),
)


class PhotoStorageError(Exception):
    """Error de validación o de negocio al guardar/leer una foto de empleado."""


class LocalEmployeePhotoStorage:
    """Guarda/lee/borra fotos de empleados en disco local, separadas por
    empresa_id/employee_id (multi-tenant)."""

    def __init__(self, root: str = MEDIA_ROOT):
        self.root = root

    @staticmethod
    def _safe_segment(value: str) -> str:
        # Defensa adicional: aunque empresa_id/employee_id ya vienen
        # validados contra la BD antes de llegar aquí, evitamos que un
        # valor con separadores de ruta pueda escapar de su carpeta.
        value = str(value)
        if not value or "/" in value or "\\" in value or ".." in value:
            raise PhotoStorageError("invalid_identifier")
        return value

    def _dir_for(self, empresa_id: str, employee_id: str) -> str:
        d = os.path.join(
            self.root,
            self._safe_segment(empresa_id),
            self._safe_segment(employee_id),
        )
        os.makedirs(d, exist_ok=True)
        return d

    def save(self, empresa_id: str, employee_id: str, content: bytes, content_type: str) -> str:
        if len(content) > MAX_PHOTO_BYTES:
            raise PhotoStorageError("photo_too_large")
        ext = _ALLOWED_CONTENT_TYPES.get((content_type or "").split(";")[0].strip().lower())
        if not ext:
            raise PhotoStorageError("unsupported_content_type")
        filename = f"{uuid.uuid4().hex}{ext}"
        path = os.path.join(self._dir_for(empresa_id, employee_id), filename)
        with open(path, "wb") as f:
            f.write(content)
        return filename

    def delete(self, empresa_id: str, employee_id: str, filename: str) -> None:
        path = os.path.join(self._dir_for(empresa_id, employee_id), self._safe_segment(filename))
        try:
            os.remove(path)
        except FileNotFoundError:
            pass

    def open(self, empresa_id: str, employee_id: str, filename: str):
        path = os.path.join(self._dir_for(empresa_id, employee_id), self._safe_segment(filename))
        if not os.path.isfile(path):
            raise FileNotFoundError(filename)
        ext = os.path.splitext(filename)[1].lower()
        media_type = _EXT_TO_MEDIA_TYPE.get(ext, "application/octet-stream")
        return path, media_type
