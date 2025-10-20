(() => {
  const KEY = 'schoolModeEnabled';
  function isOn() { return localStorage.getItem(KEY) === '1'; }
  function setOn(v) { localStorage.setItem(KEY, v ? '1' : '0'); }
  let settingsToggleBtn = null;
  let settingsPanel = null;
  let settingsCloseBtn = null;
  let schoolModeCheckbox = null;
  let switchWrapper = null;
  function initUI() {
    settingsToggleBtn = document.getElementById('settings-toggle');
    settingsPanel = document.getElementById('settings-panel');
    settingsCloseBtn = document.getElementById('settings-close');
    schoolModeCheckbox = document.getElementById('school-mode-toggle');
    if (schoolModeCheckbox) {
      switchWrapper = document.createElement('label');
      switchWrapper.className = 'switch';
      const input = document.createElement('input');
      input.type = 'checkbox';
      input.id = 'school-mode-toggle-real';
      input.checked = isOn();
      const knob = document.createElement('span');
      knob.className = 'knob';
      switchWrapper.appendChild(input);
      switchWrapper.appendChild(knob);
      if (input.checked) switchWrapper.classList.add('on');
      schoolModeCheckbox.style.display = 'none';
      schoolModeCheckbox.parentNode && schoolModeCheckbox.parentNode.insertBefore(switchWrapper, schoolModeCheckbox);
      switchWrapper.addEventListener('click', () => {
        input.checked = !input.checked;
        input.dispatchEvent(new Event('change', { bubbles: true }));
      });
      input.addEventListener('change', (e) => {
        const on = !!e.target.checked;
        if (on) switchWrapper.classList.add('on'); else switchWrapper.classList.remove('on');
        setOn(on);
        if (on) injectSchoolWrapper();
      });
    }
    if (settingsToggleBtn && settingsPanel) {
      settingsToggleBtn.addEventListener('click', () => {
        const hidden = settingsPanel.getAttribute('aria-hidden') === 'true' || !settingsPanel.getAttribute('aria-hidden');
        if (hidden) {
          settingsPanel.setAttribute('aria-hidden', 'false');
          settingsPanel.classList.add('open');
        } else {
          settingsPanel.setAttribute('aria-hidden', 'true');
          settingsPanel.classList.remove('open');
        }
      });
    }
    if (settingsCloseBtn && settingsPanel) {
      settingsCloseBtn.addEventListener('click', () => {
        settingsPanel.setAttribute('aria-hidden', 'true');
        settingsPanel.classList.remove('open');
      });
    }
    if (isOn()) {
      injectSchoolWrapper();
      const real = document.getElementById('school-mode-toggle-real');
      if (real && real.checked && switchWrapper) switchWrapper.classList.add('on');
    }
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initUI, { once: true });
  } else {
    setTimeout(initUI, 0);
  }
  function injectSchoolWrapper() {
    try {
      if (window.__SCHOOL_WRAPPER_INJECTED__) {
        console.debug('[SchoolMode] wrapper already injected');
        return;
      }
      window.__SCHOOL_WRAPPER_INJECTED__ = true;
      console.debug('[SchoolMode] injecting wrapper script');
      const code = String(function(){
        try { console.debug('[SchoolMode:injected] init'); } catch(e){}
        (function () {
          window.__IN_AB_WRAPPER__ = /[?#].*__ab=1\b/.test(String(location.href));
          try { console.debug('[SchoolMode:injected] __IN_AB_WRAPPER__=', window.__IN_AB_WRAPPER__); } catch(e){}
        })();
        function safePanicRedirect(target) {
          target = target || 'https://www.google.com';
          if (window.__IN_AB_WRAPPER__) return;
          if (/^about:blank\b/i.test(location.href)) return;
          try { window.onbeforeunload = null; } catch (e) {}
          setTimeout(function () {
            try { location.replace(target); } catch (e) {}
            setTimeout(function () {
              try {
                if (location.hostname !== (new URL(target)).hostname) {
                  location.assign(target);
                }
              } catch (e) {}
            }, 200);
          }, 0);
        }
        function buildLauncherUrlWithFlag() {
          try {
            var u = new URL(window.location.href);
            if (!/[?#].*__ab=1\b/.test(u.toString())) {
              var extra = u.hash ? u.hash.replace(/^#/, '') + '&__ab=1' : '__ab=1';
              u.hash = extra;
            }
            return u.toString();
          } catch (e) {
            return window.location.href;
          }
        }
        function openAboutBlankWithLauncher() {
          var target = buildLauncherUrlWithFlag();
          var w = null;
          try { w = window.open('about:blank', '_blank'); } catch (e) { w = null; }
          if (!w) {
            try { console.debug('[SchoolMode:injected] popup blocked or open returned null'); } catch(e){}
            return false;
          }
          try {
            w.document.open();
            w.document.write('<script>document.title = "about:blank";<\/script>' +
              '<iframe id="__ab_launcher_iframe" style="position: absolute; top: 0px; bottom: 0px; right: 0px; width: 100%; border: none; margin: 0; padding: 0; overflow: hidden; z-index: 99999; height: 100%;" src="' + target.replace(/"/g, '&quot;') + '"></iframe>');
            w.document.close();
            try { console.debug('[SchoolMode:injected] wrote iframe to popup for', target); } catch(e){}
          } catch (e) {
            try { w.close(); } catch (e2) {}
            try { console.debug('[SchoolMode:injected] failed to write to popup', e); } catch(e){}
            return false;
          }
          var loaded = false;
          try {
            var iframe = null;
            try { iframe = w.document.getElementById('__ab_launcher_iframe'); } catch(e){}
            if (iframe) {
              try {
                iframe.addEventListener('load', function () {
                  loaded = true;
                  try { console.debug('[SchoolMode:injected] iframe load event fired'); } catch(e){}
                }, { once: true });
              } catch(e){}
            }
          } catch(e){}
          setTimeout(function () {
            try {
              if (loaded) {
                try { console.debug('[SchoolMode:injected] iframe loaded successfully'); } catch(e){}
                return;
              }
              try { console.debug('[SchoolMode:injected] iframe did not load; navigating popup directly to target'); } catch(e){}
              try { w.location.href = target; } catch (e) { try { console.debug('[SchoolMode:injected] failed to navigate popup directly', e); } catch(e){} }
            } catch(e){}
          }, 800);
          safePanicRedirect();
          return true;
        }
        try {
          window.openAboutBlankWithLauncher = openAboutBlankWithLauncher;
          window.buildLauncherUrlWithFlag = buildLauncherUrlWithFlag;
        } catch (e) {}
        (function autoLaunchFullLauncher() {
          if (window.__IN_AB_WRAPPER__) {
            try { console.debug('[SchoolMode:injected] inside wrapper, skipping auto-launch'); } catch(e){}
            return;
          }
          if (window._abLaunched) {
            try { console.debug('[SchoolMode:injected] _abLaunched already true, skipping'); } catch(e){}
            return;
          }
          window._abLaunched = true;
          function tryLaunch() {
            try {
              var ok = openAboutBlankWithLauncher();
              if (!ok) {
                try {
                  console.debug('[SchoolMode:injected] popup blocked; performing fallback reload with flag');
                  location.replace(buildLauncherUrlWithFlag());
                } catch (e) {
                  try { console.debug('[SchoolMode:injected] fallback failed', e); } catch(e){}
                }
              }
            } catch (e) {
              try { console.debug('[SchoolMode:injected] tryLaunch error', e); } catch(e){}
            }
          }
          if (document.readyState === 'loading') {
            window.addEventListener('DOMContentLoaded', function () {
              tryLaunch();
            }, { once: true });
            try { console.debug('[SchoolMode:injected] waiting for DOMContentLoaded to auto-launch'); } catch(e){}
          } else {
            try { console.debug('[SchoolMode:injected] document already ready; running auto-launch now'); } catch(e){}
            tryLaunch();
          }
        })();
      });
      const s = document.createElement('script');
      s.type = 'text/javascript';
      s.textContent = '(' + code + ')();';
      document.documentElement.appendChild(s);
      setTimeout(() => {
        try {
          if (typeof window.openAboutBlankWithLauncher === 'function') {
            if (!window.__IN_AB_WRAPPER__ && !window._abLaunched) {
              try { window.openAboutBlankWithLauncher(); } catch (e) {}
            }
          }
        } catch (e) {}
      }, 0);
    } catch (e) {
      console.warn('Failed to inject school-mode wrapper script:', e);
    }
  }
  window.SchoolMode = {
    isEnabled: isOn,
    enable: function(){ setOn(true); injectSchoolWrapper(); },
    disable: function(){ setOn(false); }
  };
})();
