const Store = require('electron-store');

const store = new Store({
  name: 'haxyscore-settings',
  defaults: {
    mainWindowBounds: { width: 1280, height: 800 },
    startWithWindows: false,
  },
});

// ── Main Window Bounds ──────────────────────────────────────────────
function getMainBounds() {
  return store.get('mainWindowBounds');
}
function setMainBounds(bounds) {
  store.set('mainWindowBounds', bounds);
}

// ── Startup ─────────────────────────────────────────────────────────
function getStartWithWindows() {
  return store.get('startWithWindows');
}
function setStartWithWindows(value) {
  store.set('startWithWindows', value);
}

module.exports = {
  store,
  getMainBounds,
  setMainBounds,
  getStartWithWindows,
  setStartWithWindows,
};
