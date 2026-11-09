from fastapi import FastAPI
import sqlite3
import zipfile
import os
from datetime import datetime
import uvicorn

app = FastAPI(title="Servidor de Respaldos en Caliente")

@app.get("/trigger-backup")
def trigger_backup():
    # Portable: usa la carpeta raíz del proyecto (padre de este archivo backend/)
    # en vez de la ruta fija A:\Calebsys_POS_RESPALDO_21Junio_v4_PERFECTO, que ya no existe.
    base_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    backups_dir = os.path.join(base_dir, "..", "respaldos_calebsys")
    os.makedirs(backups_dir, exist_ok=True)
    db_path = os.path.join(base_dir, "backend", "calebsys.db")
    clone_db_path = os.path.join(base_dir, "backend", "calebsys_clon.db")
    
    # 1. Clonación en Caliente (Hot Backup) para evadir bloqueo
    try:
        if os.path.exists(db_path):
            src = sqlite3.connect(db_path)
            dst = sqlite3.connect(clone_db_path)
            with dst:
                src.backup(dst)
            dst.close()
            src.close()
    except Exception as e:
        return {"status": "error", "message": f"Error clonando base de datos: {e}"}
        
    # 2. Empaquetado Inteligente (Ignorar .venv, renombrar clon a original en el zip)
    timestamp = datetime.now().strftime("%d-%b-%Y_%H-%M-%S").upper()
    zip_name = os.path.join(backups_dir, f"Calebsys_POS_Respaldo_Seguro_{timestamp}.zip")
    
    try:
        with zipfile.ZipFile(zip_name, 'w', zipfile.ZIP_DEFLATED) as zipf:
            for root, dirs, files in os.walk(base_dir):
                # Evitar carpetas pesadas innecesarias y basura
                if '.venv' in root or '.agents' in root or '__pycache__' in root or '.git' in root:
                    continue
                    
                for file in files:
                    # Ignorar archivos temporales
                    if file.endswith('.zip') or file.startswith('scratch_') or file.startswith('fix_') or file.endswith('.db-journal'):
                        continue
                        
                    # Omitir el archivo bloqueado original
                    if file == "calebsys.db":
                        continue
                    
                    file_path = os.path.join(root, file)
                    arcname = os.path.relpath(file_path, base_dir)
                    
                    # Truco: Dentro del ZIP, el clon se llamará exactamente como el original
                    if file == "calebsys_clon.db":
                        arcname = arcname.replace("calebsys_clon.db", "calebsys.db")
                        
                    zipf.write(file_path, arcname)
                    
        # Limpiar rastro del clon temporal
        if os.path.exists(clone_db_path):
            os.remove(clone_db_path)
            
        print(f"Respaldo exitoso: {zip_name}")
        return {"status": "success", "message": f"Respaldo creado con exito en {zip_name}"}
    except Exception as e:
        return {"status": "error", "message": f"Error comprimiendo el sistema: {e}"}

if __name__ == "__main__":
    uvicorn.run(app, host="127.0.0.1", port=8009)
