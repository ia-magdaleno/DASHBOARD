from logging.config import fileConfig

from sqlalchemy import engine_from_config
from sqlalchemy import pool

from alembic import context

import sys
import os
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import models
from dotenv import load_dotenv
load_dotenv(os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))), ".env"))

# this is the Alembic Config object, which provides
# access to the values within the .ini file in use.
config = context.config

# ─── Override de la URL de conexión ────────────────────────────────────────
# alembic.ini trae "sqlite:///calebsys.db" fijo (nodo local de escritorio).
# Ese valor queda solo como fallback: acá lo pisamos según el entorno, para
# que CI, las corridas manuales y el arranque cloud usen todos la misma URL.
#
# Prioridad:
#   1. TEST_DATABASE_URL         — CI (services: postgres) y `run_tests.ps1`.
#                                  También lo consumen conftest.py y
#                                  test_schema_integrity.py, así que el
#                                  `alembic upgrade head` del job y el que
#                                  corren los tests apuntan a la misma base.
#   2. DEPLOYMENT_MODE=cloud     — Docker/servidor/Render: se arma la URL de
#                                  PostgreSQL con las mismas variables DB_*
#                                  que backend/database.py.
#   3. sqlalchemy.url de alembic.ini (SQLite fijo) — fallback local.
_test_db_url = os.getenv("TEST_DATABASE_URL", "").strip().strip('"').strip("'")
_deployment_mode = os.getenv("DEPLOYMENT_MODE", "local").strip().strip('"').strip("'").lower()

if _test_db_url:
    config.set_main_option("sqlalchemy.url", _test_db_url)
elif _deployment_mode == "cloud":
    import urllib.parse as _urlparse
    _db_user = os.getenv("DB_USER", "postgres")
    _db_password = _urlparse.quote_plus(os.getenv("DB_PASSWORD", "password"))
    _db_host = os.getenv("DB_HOST", "localhost")
    _db_port = os.getenv("DB_PORT", "5432")
    _db_name = os.getenv("DB_NAME", "calebsys_prod")
    _db_sslmode = os.getenv("DB_SSLMODE", "require")
    config.set_main_option(
        "sqlalchemy.url",
        f"postgresql://{_db_user}:{_db_password}@{_db_host}:{_db_port}/{_db_name}?sslmode={_db_sslmode}",
    )

# Interpret the config file for Python logging.
# This line sets up loggers basically.
if config.config_file_name is not None:
    fileConfig(config.config_file_name)

# add your model's MetaData object here
# for 'autogenerate' support
# from myapp import mymodel
# target_metadata = mymodel.Base.metadata
target_metadata = models.Base.metadata

# other values from the config, defined by the needs of env.py,
# can be acquired:
# my_important_option = config.get_main_option("my_important_option")
# ... etc.


def run_migrations_offline() -> None:
    """Run migrations in 'offline' mode.

    This configures the context with just a URL
    and not an Engine, though an Engine is acceptable
    here as well.  By skipping the Engine creation
    we don't even need a DBAPI to be available.

    Calls to context.execute() here emit the given string to the
    script output.

    """
    url = config.get_main_option("sqlalchemy.url")
    context.configure(
        url=url,
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
    )

    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    """Run migrations in 'online' mode.

    In this scenario we need to create an Engine
    and associate a connection with the context.

    """
    connectable = engine_from_config(
        config.get_section(config.config_ini_section, {}),
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
    )

    with connectable.connect() as connection:
        context.configure(
            connection=connection, target_metadata=target_metadata
        )

        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
