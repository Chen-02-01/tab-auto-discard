var DEFAULT_SETTINGS = {
  timeoutMinutes: 5,
  excludedRules: [],
  skipPinned: true,
  skipAudible: true
};

var HISTORY_PREVIEW_LIMIT = 6;

/**
 * wrapChromeCall
 * @author Chen
 */
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

/**
 * storageGet
 * @author Chen
 */
function storageGet(keys) {
  return wrapChromeCall(function (done) {
    chrome.storage.local.get(keys, done);
  });
}

/**
 * storageSet
 * @author Chen
 */
function storageSet(items) {
  return wrapChromeCall(function (done) {
    chrome.storage.local.set(items, done);
  });
}

/**
 * tabsQuery
 * @author Chen
 */
function tabsQuery(queryInfo) {
  return wrapChromeCall(function (done) {
    chrome.tabs.query(queryInfo, done);
  });
}

/**
 * sanitizeSettings
 * @author Chen
 */
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

/**
 * sanitizeDiscardHistory
 * @author Chen
 */
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

  return cleanHistory;
}

/**
 * isSupportedSite
 * @author Chen
 */
function isSupportedSite(url) {
  try {
    var parsed = new URL(url);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch (error) {
    return false;
  }
}

/**
 * formatTimestamp
 * @author Chen
 */
function formatTimestamp(timestamp) {
  var date = new Date(timestamp);

  return date.toLocaleString("zh-CN", {
    hour12: false,
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  });
}

var state = {
  currentSettings: sanitizeSettings(DEFAULT_SETTINGS),
  currentTab: null,
  currentUrl: "",
  currentHost: "",
  discardHistory: []
};

var elements = {
  clearHistory: document.getElementById("clearHistory"),
  currentSite: document.getElementById("currentSite"),
  excludeState: document.getElementById("excludeState"),
  historyList: document.getElementById("historyList"),
  historyMeta: document.getElementById("historyMeta"),
  saveSettings: document.getElementById("saveSettings"),
  skipAudible: document.getElementById("skipAudible"),
  skipPinned: document.getElementById("skipPinned"),
  statusText: document.getElementById("statusText"),
  timeoutMinutes: document.getElementById("timeoutMinutes"),
  toggleCurrentSite: document.getElementById("toggleCurrentSite")
};

/**
 * showStatus
 * @author Chen
 */
function showStatus(message, isError) {
  elements.statusText.textContent = message || "";
  elements.statusText.className = isError ? "status error" : "status";
}

/**
 * renderSettings
 * @author Chen
 */
function renderSettings() {
  elements.timeoutMinutes.value = String(state.currentSettings.timeoutMinutes);
  elements.skipPinned.checked = state.currentSettings.skipPinned;
  elements.skipAudible.checked = state.currentSettings.skipAudible;
}

/**
 * renderCurrentSite
 * @author Chen
 */
function renderCurrentSite() {
  var url = state.currentUrl;
  var exactHostRuleExists = state.currentSettings.excludedRules.indexOf(state.currentHost) !== -1;
  var matchingRule = TabDiscardRules.getMatchingRule(state.currentSettings.excludedRules, url);

  if (!state.currentHost || !isSupportedSite(url)) {
    elements.currentSite.textContent = "当前页面不是普通网站";
    elements.excludeState.textContent = "内部页面、扩展页或特殊协议不会加入站点排除列表。";
    elements.toggleCurrentSite.disabled = true;
    return;
  }

  elements.currentSite.textContent = state.currentHost;
  elements.excludeState.textContent = matchingRule
    ? "已排除，匹配规则：" + matchingRule
    : "未排除，超时后会被自动丢弃。";
  elements.toggleCurrentSite.disabled = false;
  elements.toggleCurrentSite.textContent = exactHostRuleExists
    ? "移除当前站点规则"
    : "将当前站点加入排除";
}

/**
 * renderHistory
 * @author Chen
 */
function renderHistory() {
  elements.historyList.innerHTML = "";

  if (state.discardHistory.length === 0) {
    elements.historyMeta.textContent = "还没有自动丢弃记录。";
    elements.clearHistory.disabled = true;

    var emptyItem = document.createElement("li");
    emptyItem.className = "history-empty";
    emptyItem.textContent = "当插件自动丢弃后台标签页后，记录会显示在这里。";
    elements.historyList.appendChild(emptyItem);
    return;
  }

  elements.clearHistory.disabled = false;
  elements.historyMeta.textContent = "共 " + state.discardHistory.length + " 条记录，当前展示最近 " + Math.min(state.discardHistory.length, HISTORY_PREVIEW_LIMIT) + " 条。";

  state.discardHistory.slice(0, HISTORY_PREVIEW_LIMIT).forEach(function (entry) {
    var item = document.createElement("li");
    item.className = "history-item";

    var title = document.createElement("strong");
    title.className = "history-title";
    title.textContent = entry.title;

    var meta = document.createElement("div");
    meta.className = "history-meta";
    meta.textContent = (entry.hostname || entry.url || "未知站点") + " · " + formatTimestamp(entry.discardedAt);

    item.appendChild(title);
    item.appendChild(meta);
    elements.historyList.appendChild(item);
  });
}

/**
 * loadPopupState
 * @author Chen
 */
async function loadPopupState() {
  var stored = await storageGet(["settings", "discardHistory"]);
  var activeTabs = await tabsQuery({
    active: true,
    currentWindow: true
  });

  state.currentSettings = sanitizeSettings(stored.settings);
  state.discardHistory = sanitizeDiscardHistory(stored.discardHistory);
  state.currentTab = activeTabs[0] || null;
  state.currentUrl = state.currentTab && state.currentTab.url ? state.currentTab.url : "";
  state.currentHost = TabDiscardRules.extractHostname(state.currentUrl);

  renderSettings();
  renderCurrentSite();
  renderHistory();
}

/**
 * saveSettings
 * @author Chen
 */
async function saveSettings() {
  var nextSettings = {
    timeoutMinutes: elements.timeoutMinutes.value,
    excludedRules: state.currentSettings.excludedRules,
    skipPinned: elements.skipPinned.checked,
    skipAudible: elements.skipAudible.checked
  };

  state.currentSettings = sanitizeSettings(nextSettings);
  await storageSet({
    settings: state.currentSettings
  });

  renderSettings();
  renderCurrentSite();
  showStatus("设置已保存。");
}

/**
 * toggleCurrentSiteRule
 * @author Chen
 */
async function toggleCurrentSiteRule() {
  if (!state.currentHost || !isSupportedSite(state.currentUrl)) {
    return;
  }

  var nextRules = state.currentSettings.excludedRules.slice();
  var currentIndex = nextRules.indexOf(state.currentHost);

  if (currentIndex === -1) {
    nextRules.push(state.currentHost);
    showStatus("当前站点已加入排除列表。");
  } else {
    nextRules.splice(currentIndex, 1);
    showStatus("当前站点规则已移除。");
  }

  state.currentSettings = sanitizeSettings({
    timeoutMinutes: state.currentSettings.timeoutMinutes,
    excludedRules: nextRules,
    skipPinned: state.currentSettings.skipPinned,
    skipAudible: state.currentSettings.skipAudible
  });

  await storageSet({
    settings: state.currentSettings
  });

  renderCurrentSite();
}

/**
 * clearHistory
 * @author Chen
 */
async function clearHistory() {
  state.discardHistory = [];
  await storageSet({
    discardHistory: []
  });
  renderHistory();
  showStatus("自动丢弃记录已清空。");
}

elements.saveSettings.addEventListener("click", function () {
  saveSettings().catch(function (error) {
    showStatus(error.message || "保存失败。", true);
  });
});

elements.toggleCurrentSite.addEventListener("click", function () {
  toggleCurrentSiteRule().catch(function (error) {
    showStatus(error.message || "更新排除列表失败。", true);
  });
});

elements.clearHistory.addEventListener("click", function () {
  clearHistory().catch(function (error) {
    showStatus(error.message || "清空记录失败。", true);
  });
});

chrome.storage.onChanged.addListener(function (changes, areaName) {
  if (areaName !== "local") {
    return;
  }

  if (changes.settings) {
    state.currentSettings = sanitizeSettings(changes.settings.newValue);
    renderSettings();
    renderCurrentSite();
  }

  if (changes.discardHistory) {
    state.discardHistory = sanitizeDiscardHistory(changes.discardHistory.newValue);
    renderHistory();
  }
});

loadPopupState().catch(function (error) {
  showStatus(error.message || "读取设置失败。", true);
});