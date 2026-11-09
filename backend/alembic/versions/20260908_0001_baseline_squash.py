"""baseline: esquema completo squasheado

Punto de partida unico del historial Alembic. Reemplaza las 12 revisiones
incrementales previas (head anterior: d1a2b3c4e5f6), que se generaron como
diff `--autogenerate` contra una BD que ya tenia el esquema base y por eso
nunca corrian standalone (`alembic upgrade head` desde vacio moria en la
primera FK a `sales`).

Esta revision materializa el esquema completo a partir de los modelos ORM
(`models.py` / `Base.metadata`). Es exactamente el mismo esquema que
`Base.metadata.create_all()` ya venia creando en el arranque cloud, asi que
una BD provista por esa via (incluida la Supabase de produccion) queda
alineada con esta baseline con un `alembic stamp` de esta revision.

Revision ID: 0001_baseline
Revises:
Create Date: 2026-09-08
"""
from alembic import op

# revision identifiers, used by Alembic.
revision = "0001_baseline"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    # env.py ya ejecuta `import models`, que puebla Base.metadata al importar.
    # Se reimporta aqui de forma explicita para que la revision sea legible y
    # no dependa del orden de imports de quien la invoque.
    import models  # noqa: F401  (registra las tablas en Base.metadata)
    from database import Base

    bind = op.get_bind()
    Base.metadata.create_all(bind=bind)


def downgrade() -> None:
    import models  # noqa: F401
    from database import Base

    bind = op.get_bind()
    Base.metadata.drop_all(bind=bind)
