"""
seed_cloud.py
-------------
Siembra el usuario admin inicial directamente en el nodo CLOUD (Postgres /
Neon), sin tocar seed.py (que sigue siendo el camino para SQLite local,
usado por el escritorio). Se ejecuta dentro del contenedor:

    docker compose exec calebsys python seed_cloud.py
"""
from sqlalchemy.orm import Session
import bcrypt

from database import engine_cloud, Base
from models import User

Base.metadata.create_all(bind=engine_cloud)  # no-op si bootstrap_db.py ya corrio

db = Session(bind=engine_cloud)
try:
    existing = (
        db.query(User)
        .filter(User.empresa_id == "MAG-001", User.username == "admin")
        .first()
    )
    if not existing:
        hashed_pw = bcrypt.hashpw("admin123".encode("utf-8"), bcrypt.gensalt()).decode("utf-8")
        new_admin = User(
            empresa_id="MAG-001",
            sucursal_id="MATRIZ",
            username="admin",
            hashed_password=hashed_pw,
            role="admin",
        )
        db.add(new_admin)
        db.commit()
        print("Usuario 'admin' (password: admin123) creado en Postgres cloud.")
    else:
        print("El usuario 'admin' ya existe en Postgres cloud.")
finally:
    db.close()
