"""
bootstrap_db.py
----------------
Prepara el esquema de la BD cloud (Supabase) en el arranque: corre
`alembic upgrade head` y nada más.

Contexto: el historial Alembic se squasheó a una baseline standalone
(revisión 0001_baseline). Ahora `alembic upgrade head` funciona desde una BD
vacía y es la ÚNICA fuente de verdad del esquema — se acabó la bifurcación
"BD vacía -> create_all + stamp" que mantenía dos definiciones (models.py vía
create_all y la cadena de migraciones) que podían divergir en silencio.

Casos que este script tolera como no-op limpio:
  - BD vacía: la baseline crea el esquema completo.
  - BD ya migrada (alembic_version == head): upgrade no hace nada.
  - BD provista antes por create_all() y stampeada a la baseline: idem.

Se invoca desde docker-entrypoint.sh cuando DEPLOYMENT_MODE=cloud.
"""
import logging
import os
import sys

from alembic.config import Config
from alembic import command

sys.path.append(os.path.dirname(os.path.abspath(__file__)))

from database import SQLALCHEMY_CLOUD_URL
import models  # noqa: F401  (registra las tablas en Base.metadata al importarse)


def main() -> None:
    backend_dir = os.path.dirname(os.path.abspath(__file__))
    alembic_cfg = Config(os.path.join(backend_dir, "alembic.ini"))
    # alembic/env.py solo arma la URL de Postgres si DEPLOYMENT_MODE=cloud está
    # en el entorno; bootstrap_db.py se invoca a veces sin esa variable. Se
    # fuerza acá la URL real (la misma que usa engine_cloud en database.py),
    # sin depender de quién invoque el script.
    alembic_cfg.set_main_option("sqlalchemy.url", SQLALCHEMY_CLOUD_URL)

    _log = logging.getLogger("calebsys.bootstrap")
    _log.info("Aplicando 'alembic upgrade head'...")
    command.upgrade(alembic_cfg, "head")
    _log.info("Esquema al día.")


if __name__ == "__main__":
    main()
