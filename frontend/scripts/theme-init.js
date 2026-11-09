// =============================================================================
// CALEBSYS — frontend/scripts/theme-init.js
// Anti-flash: aplica el tema guardado ANTES de pintar (evita parpadeo
// dark->light). Externo porque la CSP (script-src 'self' sin
// 'unsafe-inline') bloquea los <script> inline; este archivo si pasa.
// Debe cargarse con <script src="/scripts/theme-init.js"> justo despues
// de <body>, antes del resto del contenido, para que corra a tiempo.
// =============================================================================
if (localStorage.getItem('calebsys_theme') === 'light') {
  document.body.classList.add('light-mode');
}
