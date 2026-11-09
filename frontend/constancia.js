
// --- CONSTANCIA FISCAL UPLOAD ---
function showConstanciaPreviewBox() {
  const container = document.getElementById("constancia-preview-container");
  if (container) container.classList.remove("hidden");
}

function handleConstanciaFile(event) {
  const dz = document.getElementById('constancia-drop-zone');
  if (dz) { 
    dz.classList.remove('border-slate-300', 'bg-slate-50', 'text-slate-500', 'hover:border-blue-400', 'hover:bg-blue-50');
    dz.classList.add('border-blue-500', 'bg-blue-50', 'text-blue-700');
    dz.innerHTML = `<i data-lucide="loader-2" class="w-6 h-6 animate-spin mx-auto mb-1"></i>
      <span class="text-[10px] font-bold">Procesando archivo...</span>`;
    if (window.lucide) lucide.createIcons();
  }

  const file = event.target.files[0];
  if (!file) return;

  const formData = new FormData();
  formData.append("file", file);

  fetch("/api/constancia", { method: "POST", body: formData })
    .then(r => r.json())
    .then(data => {
      if (data.success || data.rfc) {
        const setVal = (id, val) => {
          if (!val) return;
          const el = document.getElementById(id);
          if (el) {
            el.value = val;
            el.classList.add('bg-green-50', 'border-green-300');
            setTimeout(() => el.classList.remove('bg-green-50', 'border-green-300'), 1500);
          }
        };

        setVal("fc-rfc", data.rfc);
        setVal("fc-name", data.nombre);
        setVal("fc-cp", data.cp);

        if (dz) {
          dz.classList.remove('border-blue-500', 'bg-blue-50', 'text-blue-700', 'animate-pulse');
          dz.classList.add('border-green-500', 'bg-green-50', 'text-green-700');
          dz.innerHTML = `<i data-lucide="check-circle-2" class="w-6 h-6 mx-auto mb-1"></i>
            <span class="text-[10px] font-bold">Datos extraídos con éxito</span>`;
          if (window.lucide) lucide.createIcons();
        }
      } else {
        if (dz) {
          dz.classList.remove('border-blue-500', 'bg-blue-50', 'text-blue-700');
          dz.classList.add('border-red-500', 'bg-red-50', 'text-red-700');
          dz.innerHTML = `<i data-lucide="alert-circle" class="w-6 h-6 mx-auto mb-1"></i>
            <span class="text-[10px] font-bold">No se pudo leer la Constancia</span>`;
          if (window.lucide) lucide.createIcons();
        }
      }
    })
    .catch(err => {
      console.error(err);
      if (dz) {
        dz.classList.remove('border-blue-500', 'bg-blue-50', 'text-blue-700');
        dz.classList.add('border-red-500', 'bg-red-50', 'text-red-700');
        dz.innerHTML = `<i data-lucide="x-circle" class="w-6 h-6 mx-auto mb-1"></i>
          <span class="text-[10px] font-bold">Error de conexión</span>`;
        if (window.lucide) lucide.createIcons();
      }
    });
}

function setupConstanciaDragDrop() {
  const dz = document.getElementById('constancia-drop-zone');
  if (!dz) return;
  dz.addEventListener("dragover", (e) => {
    e.preventDefault();
    dz.classList.add("border-blue-500", "bg-blue-50");
  });
  dz.addEventListener("dragleave", (e) => {
    e.preventDefault();
    dz.classList.remove("border-blue-500", "bg-blue-50");
  });
  dz.addEventListener("drop", (e) => {
    e.preventDefault();
    dz.classList.remove("border-blue-500", "bg-blue-50");
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      handleConstanciaFile({ target: { files: e.dataTransfer.files } });
    }
  });
}
