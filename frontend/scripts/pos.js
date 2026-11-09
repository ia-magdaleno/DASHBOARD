window.addEventListener('error', function(event) {
      const errorDiv = document.createElement('div');
      errorDiv.style.cssText = 'position:fixed;top:0;left:0;width:100%;background:red;color:white;z-index:99999;padding:20px;font-size:24px;white-space:pre-wrap;';
      errorDiv.innerText = 'JS FATAL ERROR: ' + event.message + '\nLine: ' + event.lineno + '\nFile: ' + event.filename;
      document.documentElement.appendChild(errorDiv);
    });
  


    tailwind.config = {
      theme: {
        extend: {
          fontFamily: {
            sans: ['Inter', 'sans-serif'],
            montserrat: ['Montserrat', 'sans-serif'],
            mono: ['Fira Code', 'monospace'],
          },
          colors: {
            posBlue: {
              50: '#eff6ff',
              100: '#dbeafe',
              500: '#3b82f6',
              600: '#2563eb',
              700: '#1d4ed8',
              800: '#1e40af',
              900: '#1e3a8a',
            }
          }
        }
      }
    }
  


    window.addEventListener('error', function(event) {
      const errorDiv = document.createElement('div');
      errorDiv.style.cssText = 'position:fixed;top:0;left:0;width:100%;background:red;color:white;z-index:99999;padding:20px;font-size:24px;white-space:pre-wrap;';
      errorDiv.innerText = 'JS ERROR: ' + event.message + '\nLine: ' + event.lineno + '\nCol: ' + event.colno + '\nFile: ' + event.filename;
      document.body.prepend(errorDiv);
    });
  


    // Initialize icons
    lucide.createIcons();
  


// Muestra el botón de regreso solo si viene desde el OS
(function() {
  if (sessionStorage.getItem('calebsys_from_os') === '1') {
    const btn = document.getElementById('os-back-btn');
    if (btn) btn.style.display = 'flex';
  }
})();