/* 07-shared-ui.js — Toast system, form enter focus transition helper
   Extraido de app_v66.js (fase 3, modularizacion post-auditoria 2026-08-03)
   Lineas originales: 3295-3354 */
// --- TOAST SYSTEM ---


function showToast(message, type = "info", duration = 3000) {
  const toast = document.getElementById("toast-notification");
  const msgText = document.getElementById("toast-notification").querySelector("span.text-xs");
  const iconBox = document.getElementById("toast-icon-box");

  msgText.innerText = message;

  if (type === "success") {
    iconBox.className = "bg-green-500 text-white p-1 rounded-full";
    iconBox.innerHTML = `<i data-lucide="check" class="w-4 h-4"></i>`;
  } else if (type === "error") {
    iconBox.className = "bg-red-500 text-white p-1 rounded-full";
    iconBox.innerHTML = `<i data-lucide="x" class="w-4 h-4"></i>`;
  } else if (type === "warning") {
    iconBox.className = "bg-yellow-500 text-white p-1 rounded-full";
    iconBox.innerHTML = `<i data-lucide="alert-triangle" class="w-4 h-4"></i>`;
  } else {
    iconBox.className = "bg-blue-500 text-white p-1 rounded-full";
    iconBox.innerHTML = `<i data-lucide="info" class="w-4 h-4"></i>`;
  }

  lucide.createIcons();

  toast.classList.remove("translate-y-12", "opacity-0");
  toast.classList.add("translate-y-0", "opacity-100");

  setTimeout(() => {
    toast.classList.remove("translate-y-0", "opacity-100");
    toast.classList.add("translate-y-12", "opacity-0");
  }, duration);
}

// --- FORM ENTER FOCUS TRANSITION HELPER ---
function setupFormEnterTransition(formId, sequence) {
  sequence.forEach((id, idx) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        if (idx < sequence.length - 1) {
          const next = document.getElementById(sequence[idx + 1]);
          if (next) {
            next.focus();
            if (next.select) next.select();
          }
        } else {
          const form = document.getElementById(formId);
          if (form) {
            form.dispatchEvent(new Event("submit", { cancelable: true, bubbles: true }));
          }
        }
      }
    });
  });
}

