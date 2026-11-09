// Fase 0: puente transparente entre Capacitor Preferences y localStorage.
// Si corre dentro de una app Capacitor, usa storage nativo persistente
// (sobrevive limpiezas de caché). En navegador normal usa localStorage.
// Debe cargarse ANTES de login.js y os-admin.js.
(function (global) {
  'use strict';

  var isNative = !!(
    global.Capacitor &&
    global.Capacitor.isNativePlatform &&
    global.Capacitor.isNativePlatform()
  );

  global.CalebNative = {
    isNative: isNative,

    async getTerminalId() {
      if (!isNative) {
        try { return localStorage.getItem('calebsys_terminal_id') || ''; } catch (e) { return ''; }
      }
      try {
        var r = await global.Capacitor.Plugins.Preferences.get({ key: 'calebsys_terminal_id' });
        return r.value || '';
      } catch (e) { return ''; }
    },

    async setTerminalId(id) {
      if (!isNative) {
        try { localStorage.setItem('calebsys_terminal_id', id); } catch (e) {}
        return;
      }
      try {
        await global.Capacitor.Plugins.Preferences.set({ key: 'calebsys_terminal_id', value: String(id) });
      } catch (e) {}
    }
  };
})(window);
