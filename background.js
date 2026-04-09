importScripts("rules.js");

var DEFAULT_SETTINGS = Object.freeze({
  timeoutMinutes: 5,
  excludedRules: [],
  skipPinned: true,
  skipAudible: true
});

var STORAGE_KEYS = {
  settings: "settings",
  tabState: "tabState",
  discardHistory: "discardHistory"
};

var ALARM_NAME = "discard-inactive-tabs";
var DISCARD_HISTORY_LIMIT = 25;
var DISCARDABLE_PROTOCOLS = {
  "file:": true,
  "ftp:": true,
  "http:": true,
  "https:": true
};

var cachedState = null;
var activeTabByWindow = {};
var lastFocusedWindowId = chrome.windows.WINDOW_ID_NONE;

function runSafely(label, task) {
  Promise.resolve()
    .then(task)
    .catch(function (error) {
      console.error("[Tab Auto Discard] " + label, error);
    });
}

function wrapChromeCall(register) {
  return new Promise(function (resolve, reject) {
    register(function (result) {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }

      resolve(result);
    });
  });
}

function storageGet(keys) {
  return wrapChromeCall(function (done) {
    chrome.storage.local.get(keys, done);
  });
}

function storageSet(items) {
  return wrapChromeCall(function (done) {
    chrome.storage.local.set(items, done);
  });
}

function tabsQuery(queryInfo) {
  return wrapChromeCall(function (done) {
    chrome.tabs.query(queryInfo, done);
  });
}

function tabsGet(tabId) {
  return wrapChromeCall(function (done) {
    chrome.tabs.get(tabId, done);
  });
}

function tabsUpdate(tabId, updateProperties) {
  return wrapChromeCall(function (done) {
    chrome.tabs.update(tabId, updateProperties, done);
  });
}

function tabsDiscard(tabId) {
  return wrapChromeCall(function (done) {
    chrome.tabs.discard(tabId, done);
  });
}

function windowsGet(windowId) {
  return wrapChromeCall(function (done) {
    chrome.windows.get(windowId, {}, done);
  });
}

function windowsGetLastFocused() {
  return wrapChromeCall(function (done) {
    chrome.windows.getLastFocused({}, done);
  });
}

function sanitizeSettings(rawSettings) {
  var settings = rawSettings && typeof rawSettings === "object" ? rawSettings : {};
  var timeoutMinutes = Number(settings.timeoutMinutes);

  if (!Number.isFinite(timeoutMinutes)) {
    timeoutMinutes = DEFAULT_SETTINGS.timeoutMinutes;
  }

  timeoutMinutes = Math.round(timeoutMinutes);
  timeoutMinutes = Math.max(1, Math.min(10, timeoutMinutes));

  return {
    timeoutMinutes: timeoutMinutes,
    excludedRules: TabDiscardRules.sortAndDedupeRules(settings.excludedRules),
    skipPinned: settings.skipPinned !== false,
    skipAudible: settings.skipAudible !== false
  };
}

function sanitizeTabState(rawTabState) {
  var cleanState = {};

  if (!rawTabState || typeof rawTabState !== "object") {
    return cleanState;
  }

  Object.keys(rawTabState).forEach(function (tabId) {
    var entry = rawTabState[tabId];
    var timestamp = entry && Number(entry.lastViewedAt);

    if (Number.isFinite(timestamp) && timestamp > 0) {
      cleanState[String(tabId)] = {
        lastViewedAt: timestamp
      };
    }
  });

  return cleanState;
}

function sanitizeDiscardHistory(rawDiscardHistory) {
  var cleanHistory = [];

  if (!Array.isArray(rawDiscardHistory)) {
    return cleanHistory;
  }

  for (var index = 0; index < rawDiscardHistory.length; index += 1) {
    var item = rawDiscardHistory[index];

    if (!item || typeof item !== "object") {
      continue;
    }

    var discardedAt = Number(item.discardedAt);

    if (!Number.isFinite(discardedAt) || discardedAt <= 0) {
      continue;
    }

    var url = typeof item.url === "string" ? item.url : "";
    var hostname = typeof item.hostname === "string" && item.hostname
      ? item.hostname.toLowerCase()
      : TabDiscardRules.extractHostname(url);
    var title = typeof item.title === "string" && item.title.trim()
      ? item.title.trim()
      : hostname || url || "Untitled tab";

    cleanHistory.push({
      title: title,
      url: url,
      hostname: hostname,
      discardedAt: discardedAt
    });
  }

  cleanHistory.sort(function (left, right) {
    return right.discardedAt - left.discardedAt;
  });

  return cleanHistory.slice(0, DISCARD_HISTORY_LIMIT);
}

function rememberActiveTab(windowId, tabId) {
  if (typeof windowId !== "number") {
    return;
  }

  if (tabId) {
    activeTabByWindow[String(windowId)] = tabId;
    return;
  }

  delete activeTabByWindow[String(windowId)];
}

function getRememberedActiveTab(windowId) {
  return activeTabByWindow[String(windowId)] || null;
}

async function rebuildWindowTracking() {
  var activeTabs = await tabsQuery({
    active: true
  });

  activeTabByWindow = {};

  activeTabs.forEach(function (tab) {
    if (tab && tab.id && typeof tab.windowId === "number") {
      rememberActiveTab(tab.windowId, tab.id);
    }
  });

  try {
    var focusedWindow = await windowsGetLastFocused();
    lastFocusedWindowId = focusedWindow && focusedWindow.focused
      ? focusedWindow.id
      : chrome.windows.WINDOW_ID_NONE;
  } catch (error) {
    lastFocusedWindowId = chrome.windows.WINDOW_ID_NONE;
  }
}

async function getState() {
  if (cachedState) {
    return cachedState;
  }

  var stored = await storageGet([
    STORAGE_KEYS.settings,
    STORAGE_KEYS.tabState,
    STORAGE_KEYS.discardHistory
  ]);
  cachedState = {
    settings: sanitizeSettings(stored[STORAGE_KEYS.settings]),
    tabState: sanitizeTabState(stored[STORAGE_KEYS.tabState]),
    discardHistory: sanitizeDiscardHistory(stored[STORAGE_KEYS.discardHistory])
  };

  return cachedState;
}

async function saveSettings(settings) {
  var state = await getState();
  state.settings = sanitizeSettings(settings);
  await storageSet({
    settings: state.settings
  });
  return state.settings;
}

async function saveTabState(tabState) {
  var state = await getState();
  state.tabState = sanitizeTabState(tabState);
  await storageSet({
    tabState: state.tabState
  });
  return state.tabState;
}

async function saveDiscardHistory(discardHistory) {
  var state = await getState();
  state.discardHistory = sanitizeDiscardHistory(discardHistory);
  await storageSet({
    discardHistory: state.discardHistory
  });
  return state.discardHistory;
}

async function ensureAlarm() {
  chrome.alarms.create(ALARM_NAME, {
    delayInMinutes: 1,
    periodInMinutes: 1
  });
}

function isSupportedDiscardUrl(url) {
  if (!url) {
    return false;
  }

  try {
    var parsed = new URL(url);
    return Boolean(DISCARDABLE_PROTOCOLS[parsed.protocol]);
  } catch (error) {
    return false;
  }
}

function isManualDiscardCandidate(tab, settings) {
  if (!tab || !tab.id || tab.discarded || tab.status === "loading") {
    return false;
  }

  // Never discard the currently selected tab of any browser window.
  if (tab.active) {
    return false;
  }

  if (settings.skipPinned && tab.pinned) {
    return false;
  }

  if (settings.skipAudible && tab.audible) {
    return false;
  }

  if (!isSupportedDiscardUrl(tab.url)) {
    return false;
  }

  return !TabDiscardRules.getMatchingRule(settings.excludedRules, tab.url);
}

async function markTabViewed(tabId, timestamp) {
  if (!tabId) {
    return;
  }

  var state = await getState();
  state.tabState[String(tabId)] = {
    lastViewedAt: timestamp || Date.now()
  };

  await saveTabState(state.tabState);
}

async function markRememberedTabViewed(windowId) {
  var tabId = getRememberedActiveTab(windowId);

  if (!tabId) {
    return;
  }

  await markTabViewed(tabId);
}


async function seedExistingTabs() {
  var state = await getState();
  var allTabs = await tabsQuery({});
  var now = Date.now();
  var knownIds = {};
  var changed = false;

  allTabs.forEach(function (tab) {
    if (!tab.id) {
      return;
    }

    var tabKey = String(tab.id);
    knownIds[tabKey] = true;

    if (!state.tabState[tabKey]) {
      state.tabState[tabKey] = {
        lastViewedAt: now
      };
      changed = true;
    }

    if (tab.active && typeof tab.windowId === "number") {
      rememberActiveTab(tab.windowId, tab.id);
    }
  });

  Object.keys(state.tabState).forEach(function (tabKey) {
    if (!knownIds[tabKey]) {
      delete state.tabState[tabKey];
      changed = true;
    }
  });

  if (changed) {
    await saveTabState(state.tabState);
  }
}

async function syncFocusedTab() {
  var focusedWindow;

  try {
    focusedWindow = await windowsGetLastFocused();
  } catch (error) {
    return;
  }

  if (!focusedWindow || !focusedWindow.focused || typeof focusedWindow.id !== "number") {
    lastFocusedWindowId = chrome.windows.WINDOW_ID_NONE;
    return;
  }

  lastFocusedWindowId = focusedWindow.id;

  var activeTabs = await tabsQuery({
    active: true,
    windowId: focusedWindow.id
  });

  if (activeTabs.length === 0 || !activeTabs[0].id) {
    return;
  }

  rememberActiveTab(focusedWindow.id, activeTabs[0].id);
  await markTabViewed(activeTabs[0].id);
}

async function applyAutoDiscardablePolicy(tab) {
  if (!tab || !tab.id || !tab.url || !isSupportedDiscardUrl(tab.url)) {
    return;
  }

  var state = await getState();
  var isExcluded = Boolean(TabDiscardRules.getMatchingRule(state.settings.excludedRules, tab.url));
  var desiredValue = !isExcluded;

  if (tab.autoDiscardable === desiredValue) {
    return;
  }

  try {
    await tabsUpdate(tab.id, {
      autoDiscardable: desiredValue
    });
  } catch (error) {
    console.warn("[Tab Auto Discard] Unable to update autoDiscardable for tab", tab.id, error);
  }
}

async function refreshAutoDiscardablePolicy() {
  var allTabs = await tabsQuery({});

  for (var index = 0; index < allTabs.length; index += 1) {
    await applyAutoDiscardablePolicy(allTabs[index]);
  }
}

function getDueTabIds(tabState, now, discardThresholdMs) {
  var dueTabIds = [];

  Object.keys(tabState).forEach(function (tabId) {
    var entry = tabState[tabId];

    if (!entry || !entry.lastViewedAt) {
      return;
    }

    if (now - entry.lastViewedAt >= discardThresholdMs) {
      dueTabIds.push(Number(tabId));
    }
  });

  return dueTabIds;
}

async function discardExpiredTabs() {
  var state = await getState();
  var settings = state.settings;
  var now = Date.now();
  var discardThresholdMs = settings.timeoutMinutes * 60 * 1000;
  var dueTabIds = getDueTabIds(state.tabState, now, discardThresholdMs);
  var shouldSaveTabState = false;

  for (var index = 0; index < dueTabIds.length; index += 1) {
    var tabId = dueTabIds[index];
    var tab;

    try {
      tab = await tabsGet(tabId);
    } catch (error) {
      if (state.tabState[String(tabId)]) {
        delete state.tabState[String(tabId)];
        shouldSaveTabState = true;
      }
      continue;
    }

    if (!isManualDiscardCandidate(tab, settings)) {
      continue;
    }

    var entry = state.tabState[String(tab.id)];

    if (!entry || !entry.lastViewedAt) {
      continue;
    }

    if (now - entry.lastViewedAt < discardThresholdMs) {
      continue;
    }

    try {
      await tabsDiscard(tab.id);
      await appendDiscardHistory(tab, now);
    } catch (error) {
      console.warn("[Tab Auto Discard] Unable to discard tab", tab.id, error);
    }
  }

  if (shouldSaveTabState) {
    await saveTabState(state.tabState);
  }
}

async function appendDiscardHistory(tab, discardedAt) {
  if (!tab || !tab.id) {
    return;
  }

  var state = await getState();
  var timestamp = discardedAt || Date.now();

  state.discardHistory.unshift({
    title: typeof tab.title === "string" && tab.title.trim()
      ? tab.title.trim()
      : TabDiscardRules.extractHostname(tab.url) || tab.url || "Untitled tab",
    url: typeof tab.url === "string" ? tab.url : "",
    hostname: TabDiscardRules.extractHostname(tab.url),
    discardedAt: timestamp
  });

  await saveDiscardHistory(state.discardHistory);
}

async function initializeExtension() {
  var state = await getState();
  await saveSettings(state.settings);
  await saveTabState(state.tabState);
  await saveDiscardHistory(state.discardHistory);
  await ensureAlarm();
  await seedExistingTabs();
  await rebuildWindowTracking();
  await syncFocusedTab();
  await refreshAutoDiscardablePolicy();
}

async function handleTabActivated(activeInfo) {
  if (!activeInfo || !activeInfo.tabId || typeof activeInfo.windowId !== "number") {
    return;
  }

  var targetWindow;
  var previousTabId = getRememberedActiveTab(activeInfo.windowId);

  rememberActiveTab(activeInfo.windowId, activeInfo.tabId);

  try {
    targetWindow = await windowsGet(activeInfo.windowId);
  } catch (error) {
    return;
  }

  if (!targetWindow.focused) {
    return;
  }

  lastFocusedWindowId = activeInfo.windowId;

  if (previousTabId && previousTabId !== activeInfo.tabId) {
    await markTabViewed(previousTabId);
  }

  await markTabViewed(activeInfo.tabId);
}

async function handleWindowFocusChanged(windowId) {
  if (lastFocusedWindowId !== chrome.windows.WINDOW_ID_NONE && lastFocusedWindowId !== windowId) {
    await markRememberedTabViewed(lastFocusedWindowId);
  }

  lastFocusedWindowId = windowId;

  if (windowId === chrome.windows.WINDOW_ID_NONE) {
    return;
  }

  var activeTabs = await tabsQuery({
    active: true,
    windowId: windowId
  });

  if (activeTabs.length === 0 || !activeTabs[0].id) {
    return;
  }

  rememberActiveTab(windowId, activeTabs[0].id);
  await markTabViewed(activeTabs[0].id);
}

chrome.runtime.onInstalled.addListener(function () {
  runSafely("initialize on install", initializeExtension);
});

chrome.runtime.onStartup.addListener(function () {
  runSafely("initialize on startup", initializeExtension);
});

chrome.alarms.onAlarm.addListener(function (alarm) {
  if (!alarm || alarm.name !== ALARM_NAME) {
    return;
  }

  runSafely("discard expired tabs", async function () {
    await discardExpiredTabs();
  });
});

chrome.tabs.onCreated.addListener(function (tab) {
  runSafely("track created tab", async function () {
    if (!tab || !tab.id) {
      return;
    }

    if (tab.active && typeof tab.windowId === "number") {
      rememberActiveTab(tab.windowId, tab.id);
    }

    await markTabViewed(tab.id);
    await applyAutoDiscardablePolicy(tab);
  });
});

chrome.tabs.onActivated.addListener(function (activeInfo) {
  runSafely("mark activated tab", function () {
    return handleTabActivated(activeInfo);
  });
});

chrome.windows.onFocusChanged.addListener(function (windowId) {
  runSafely("track focused window", function () {
    return handleWindowFocusChanged(windowId);
  });
});

chrome.tabs.onUpdated.addListener(function (tabId, changeInfo, tab) {
  runSafely("handle tab update", async function () {
    if (!tabId) {
      return;
    }

    if (tab.active && typeof tab.windowId === "number") {
      rememberActiveTab(tab.windowId, tabId);
    }

    if (changeInfo.url || changeInfo.status === "complete") {
      await applyAutoDiscardablePolicy(tab);
    }
  });
});

chrome.tabs.onRemoved.addListener(function (tabId, removeInfo) {
  runSafely("cleanup removed tab", async function () {
    var state = await getState();
    var tabKey = String(tabId);

    if (removeInfo && typeof removeInfo.windowId === "number" && getRememberedActiveTab(removeInfo.windowId) === tabId) {
      rememberActiveTab(removeInfo.windowId, null);
    }

    if (!state.tabState[tabKey]) {
      return;
    }

    delete state.tabState[tabKey];
    await saveTabState(state.tabState);
  });
});

chrome.storage.onChanged.addListener(function (changes, areaName) {
  if (areaName !== "local" || !changes) {
    return;
  }

  if (changes.settings) {
    runSafely("refresh settings", async function () {
      var state = await getState();
      state.settings = sanitizeSettings(changes.settings.newValue);
      await ensureAlarm();
      await refreshAutoDiscardablePolicy();
      await discardExpiredTabs();
    });
  }

  if (changes.tabState) {
    getState().then(function (state) {
      state.tabState = sanitizeTabState(changes.tabState.newValue);
    });
  }

  if (changes.discardHistory) {
    getState().then(function (state) {
      state.discardHistory = sanitizeDiscardHistory(changes.discardHistory.newValue);
    });
  }
});

runSafely("cold start", async function () {
  await getState();
  await rebuildWindowTracking();
  await ensureAlarm();
});
