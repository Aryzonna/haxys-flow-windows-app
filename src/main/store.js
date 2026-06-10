const Store = require('electron-store');

const store = new Store({
  name: 'haxysflow-settings',
  defaults: {
    mainWindowBounds: { width: 1280, height: 800 },
    widgetBounds: { width: 420, height: 620 },
    startWithWindows: false,
    lastWidgetOpen: false,
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

// ── Widget ──────────────────────────────────────────────────────────
function getWidgetBounds() {
  return store.get('widgetBounds');
}
function setWidgetBounds(bounds) {
  store.set('widgetBounds', bounds);
}
function getLastWidgetOpen() {
  return store.get('lastWidgetOpen');
}
function setLastWidgetOpen(value) {
  store.set('lastWidgetOpen', value);
}

module.exports = {
  store,
  getMainBounds,
  setMainBounds,
  getStartWithWindows,
  setStartWithWindows,
  getWidgetBounds,
  setWidgetBounds,
  getLastWidgetOpen,
  setLastWidgetOpen,
};
