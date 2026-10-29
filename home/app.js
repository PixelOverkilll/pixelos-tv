(function () {
  'use strict';

  // Eigenstaendige Fassung von tools/pixelhome/www/app.js: kein PC-Helfer, keine /api-Aufrufe.
  // Der TV fuehrt die Kachel-Aktionen selbst aus, ueber seine eigenen Schnittstellen auf 127.0.0.1
  // (SmartCenter-Tasten wie T1b, DIAL-App-Start wie pixelboot.py). Ausserhalb des TVs nur Demo.
  var loadedAt = new Date();
  var owner = null;
  var busy = false;
  var enterHeld = false;
  var theme = 'ocean';
  var keyset = { requested: 447, available: false, applied: false, status: 'unavailable' };
  var actionNames = { netflix: 'Netflix', prime: 'Prime Video', sources: 'TV-Quellen', volume_up: 'Lauter', volume_down: 'Leiser', exit: 'Zurück zum TV' };
  var KEYS = { volume_up: 1016, volume_down: 1017, sources: 1056 };
  var APPS = { netflix: 'Netflix', prime: 'AmazonInstantVideo' };
  var onTv = /HbbTV|Vestel|SmartTvA/.test(navigator.userAgent) && !/[?&]demo=1/.test(location.search);
  var config = { mode: onTv ? 'control' : 'preview' };
  var status = document.getElementById('status');
  var launcher = document.getElementById('launcher');
  var actions = document.querySelectorAll('[data-action]');
  var themeButton = document.getElementById('theme-button');
  var statusPanel = document.getElementById('status-panel');
  var settingsButton = document.getElementById('settings-button');
  var settingsPanel = document.getElementById('settings-panel');
  var startup = document.getElementById('startup');
  var startupButton = document.getElementById('startup-button');
  var startupEnabled = true;
  var startupActive = false;
  var startupTimer = null;

  function setStatus(message) {
    status.textContent = message;
    statusPanel.hidden = !message;
  }

  function showSettings(visible) {
    settingsPanel.hidden = !visible;
    settingsButton.setAttribute('aria-expanded', visible ? 'true' : 'false');
    if (visible) { themeButton.focus(); } else { settingsButton.focus(); }
  }

  function finishStartup() {
    window.clearTimeout(startupTimer);
    startup.hidden = true;
    startupActive = false;
  }

  function playStartup() {
    finishStartup();
    if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) { return; }
    startupActive = true;
    startup.hidden = false;
    startupTimer = window.setTimeout(finishStartup, 1700);
  }

  function renderStartupPreference() {
    startupButton.textContent = 'Startanimation: ' + (startupEnabled ? 'Ein' : 'Aus');
    startupButton.setAttribute('aria-pressed', startupEnabled ? 'true' : 'false');
  }

  // Simple Request (text/plain, keine eigenen Header) -> kein CORS-Preflight. Status 0 heisst nur,
  // dass die Antwort nicht lesbar war; ob am TV etwas passiert, sieht man am Bildschirm.
  function tvRequest(path, body, callback) {
    var xhr = new XMLHttpRequest();
    var finished = false;
    function finish(statusCode) {
      if (finished) { return; }
      finished = true;
      callback(statusCode);
    }
    try {
      xhr.open('POST', 'http://127.0.0.1:56789' + path, true);
      xhr.setRequestHeader('Content-Type', 'text/plain; charset=ISO-8859-1');
      xhr.timeout = 10000;
      xhr.onloadend = function () { finish(xhr.status); };
      xhr.send(body);
    } catch (error) {
      finish(-1);
    }
  }

  function initializeHbbTV() {
    var manager;
    try {
      var factory = window.oipfObjectFactory;
      if (factory && typeof factory.createApplicationManagerObject === 'function') {
        manager = factory.createApplicationManagerObject();
        if (manager && typeof manager.getOwnerApplication === 'function') {
          owner = manager.getOwnerApplication(document);
        }
      }
    } catch (error) { owner = null; }
    if (!owner) {
      try {
        manager = document.getElementById('application-manager');
        if (manager && typeof manager.getOwnerApplication === 'function') {
          owner = manager.getOwnerApplication(document);
        }
      } catch (error) { owner = null; }
    }
    if (!owner) { return; }
    try { if (typeof owner.show === 'function') { owner.show(); } } catch (error) {}
    try {
      var keys = owner.privateData && owner.privateData.keyset;
      if (keys && typeof keys.setValue === 'function') {
        keyset.available = true;
        keys.setValue(447);
        keyset.applied = true;
        keyset.status = 'set';
      }
    } catch (error) { keyset.status = 'failed'; }
  }

  function renderMode() {
    var badge = document.getElementById('mode-badge');
    var note = document.getElementById('mode-note');
    if (config.mode === 'preview') {
      badge.textContent = 'Demomodus';
      badge.className = 'mode-badge demo';
      note.textContent = 'Nur eine Demo außerhalb des Fernsehers. Es werden keine TV-Befehle gesendet.';
    } else {
      badge.textContent = 'TV-Steuerung';
      badge.className = 'mode-badge control';
      note.textContent = 'Läuft ohne PC. Apps und TV-Funktionen starten erst nach deiner Auswahl.';
    }
  }

  function focusables() {
    var nodes = document.querySelectorAll('[data-focusable]');
    var result = [];
    var index;
    for (index = 0; index < nodes.length; index += 1) {
      if (!nodes[index].disabled && nodes[index].getBoundingClientRect().width > 0) { result.push(nodes[index]); }
    }
    return result;
  }

  function focusInitial() {
    var items = focusables();
    if ((!document.activeElement || document.activeElement === document.body || document.activeElement.disabled) && items.length) {
      var preferred = document.querySelector('.app-tile:not(:disabled)');
      (preferred || items[0]).focus();
    }
  }

  function backInstruction() {
    return 'Mit der Zurück- oder Beenden-Taste deiner Fernbedienung verlässt du die Startseite.';
  }

  function activate(button) {
    if (startupActive) { finishStartup(); return; }
    var action = button.getAttribute('data-action');
    if (button.disabled || busy || !Object.prototype.hasOwnProperty.call(actionNames, action)) { return; }
    if (config.mode === 'preview') {
      setStatus('Nur eine Demo. Keine TV-Befehle gesendet.' + (action === 'exit' ? ' ' + backInstruction() : ''));
      return;
    }
    if (action === 'exit') {
      try {
        if (owner && typeof owner.destroyApplication === 'function') {
          owner.destroyApplication();
          setStatus('Rückkehr zum TV angefordert. ' + backInstruction());
          return;
        }
      } catch (error) {}
      setStatus(backInstruction());
      return;
    }
    busy = true;
    launcher.setAttribute('aria-busy', 'true');
    button.classList.add('is-pending');
    setStatus(actionNames[action] + ': Anfrage wird gesendet…');
    var path = KEYS[action] ? '/apps/SmartCenter' : '/apps/' + APPS[action];
    var body = KEYS[action] ? "<?xml version='1.0' ?><remote><key code='" + KEYS[action] + "'/></remote>" : '';
    tvRequest(path, body, function (statusCode) {
      busy = false;
      launcher.setAttribute('aria-busy', 'false');
      button.classList.remove('is-pending');
      if (statusCode >= 200 && statusCode < 300) {
        setStatus(actionNames[action] + ': Anfrage gesendet.');
      } else if (statusCode === 0) {
        setStatus(actionNames[action] + ': gesendet, der Fernseher hat keine lesbare Antwort gegeben.');
      } else {
        setStatus(actionNames[action] + ': Der Fernseher hat abgelehnt (' + statusCode + ').');
      }
    });
  }

  function moveFocus(code) {
    var items = focusables();
    var current = document.activeElement;
    var index;
    if (items.indexOf(current) === -1) { if (items.length) { items[0].focus(); } return; }
    var origin = current.getBoundingClientRect();
    var horizontal = code === 37 || code === 39;
    var sign = code === 37 || code === 38 ? -1 : 1;
    var best = null;
    var bestScore = Infinity;
    for (index = 0; index < items.length; index += 1) {
      if (items[index] === current) { continue; }
      var rect = items[index].getBoundingClientRect();
      var dx = (rect.left + rect.right - origin.left - origin.right) / 2;
      var dy = (rect.top + rect.bottom - origin.top - origin.bottom) / 2;
      var forward = (horizontal ? dx : dy) * sign;
      if (forward <= 1) { continue; }
      var sideways = Math.abs(horizontal ? dy : dx);
      var aligned = horizontal ? rect.bottom > origin.top && rect.top < origin.bottom : rect.right > origin.left && rect.left < origin.right;
      var score = forward + sideways * 3 + (aligned ? 0 : 1000);
      if (score < bestScore) { bestScore = score; best = items[index]; }
    }
    if (best) { best.focus(); }
  }

  function onKeyDown(event) {
    var code = event.keyCode || event.which;
    if (startupActive && (code === 13 || (code >= 37 && code <= 40) || code === 461 || code === 8 || code === 27)) {
      event.preventDefault();
      finishStartup();
      return;
    }
    if (code >= 37 && code <= 40) {
      event.preventDefault();
      moveFocus(code);
    } else if (code === 13) {
      var current = document.activeElement;
      if (!current || !current.hasAttribute('data-focusable') || current.disabled) { return; }
      event.preventDefault();
      if (enterHeld || event.repeat) { return; }
      enterHeld = true;
      current.click();
    } else if (code === 461 || code === 8 || code === 27) {
      event.preventDefault();
      if (!settingsPanel.hidden) { showSettings(false); return; }
      var exit = document.getElementById('return-to-tv');
      if (!exit.disabled) {
        showSettings(true);
        exit.focus();
        setStatus('„Zurück zum TV“ ausgewählt. Mit OK bestätigen oder die Beenden-Taste nutzen.');
      } else { setStatus(backInstruction()); }
    }
  }

  function applyTheme() {
    document.body.classList.toggle('theme-lagoon', theme === 'lagoon');
    themeButton.textContent = 'Design: ' + (theme === 'lagoon' ? 'Lagune' : 'Ozean');
    themeButton.setAttribute('aria-label', 'Design: ' + (theme === 'lagoon' ? 'Lagune' : 'Ozean') + '. Drücken, um das Farbdesign zu wechseln.');
  }

  function updateClock() {
    var now = new Date();
    var days = ['Sonntag', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag'];
    var months = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];
    var hours = now.getHours();
    document.getElementById('clock').textContent = (hours < 10 ? '0' : '') + hours + ':' + (now.getMinutes() < 10 ? '0' : '') + now.getMinutes();
    document.getElementById('clock').setAttribute('datetime', now.toISOString());
    document.getElementById('date').textContent = days[now.getDay()] + ', ' + now.getDate() + '. ' + months[now.getMonth()];
    document.getElementById('greeting').textContent = hours < 12 ? 'Guten Morgen' : hours < 18 ? 'Guten Tag' : 'Guten Abend';
  }

  var index;
  for (index = 0; index < actions.length; index += 1) {
    actions[index].addEventListener('click', function () { activate(this); });
    actions[index].disabled = false;
  }
  themeButton.addEventListener('click', function () {
    theme = theme === 'ocean' ? 'lagoon' : 'ocean';
    applyTheme();
    try { window.localStorage.setItem('pixelhome.theme', theme); } catch (error) {}
  });
  settingsButton.addEventListener('click', function () { showSettings(settingsPanel.hidden); });
  document.getElementById('close-settings').addEventListener('click', function () { showSettings(false); });
  startupButton.addEventListener('click', function () {
    startupEnabled = !startupEnabled;
    renderStartupPreference();
    try { window.localStorage.setItem('pixelhome.startup', startupEnabled ? 'on' : 'off'); } catch (error) {}
  });
  document.getElementById('replay-startup').addEventListener('click', function () { showSettings(false); playStartup(); });
  startup.addEventListener('click', finishStartup);
  document.addEventListener('keydown', onKeyDown);
  document.addEventListener('keyup', function (event) { if ((event.keyCode || event.which) === 13) { enterHeld = false; } });
  window.addEventListener('blur', function () { enterHeld = false; });
  document.addEventListener('visibilitychange', function () {
    enterHeld = false;
    if (!document.hidden) { updateClock(); }
  });
  try { if (window.localStorage.getItem('pixelhome.theme') === 'lagoon') { theme = 'lagoon'; } } catch (error) {}
  try { startupEnabled = window.localStorage.getItem('pixelhome.startup') !== 'off'; } catch (error) {}
  applyTheme();
  renderStartupPreference();
  renderMode();
  if (startupEnabled) { playStartup(); }
  initializeHbbTV();
  updateClock();
  window.setInterval(updateClock, 30000);
  focusInitial();
}());
