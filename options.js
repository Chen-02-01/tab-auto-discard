var DEFAULT_SETTINGS = {
  timeoutMinutes: 5,
  excludedRules: [],
  skipPinned: true,
  skipAudible: true
};

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

var state = {
  settings: sanitizeSettings(DEFAULT_SETTINGS)
};

var elements = {
  addRuleForm: document.getElementById("addRuleForm"),
  newRule: document.getElementById("newRule"),
  rulesList: document.getElementById("rulesList"),
  settingsForm: document.getElementById("settingsForm"),
  skipAudible: document.getElementById("skipAudible"),
  skipPinned: document.getElementById("skipPinned"),
  statusText: document.getElementById("statusText"),
  timeoutMinutes: document.getElementById("timeoutMinutes")
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
  elements.timeoutMinutes.value = String(state.settings.timeoutMinutes);
  elements.skipPinned.checked = state.settings.skipPinned;
  elements.skipAudible.checked = state.settings.skipAudible;
}

/**
 * renderRules
 * @author Chen
 */
function renderRules() {
  elements.rulesList.innerHTML = "";

  if (state.settings.excludedRules.length === 0) {
    var emptyItem = document.createElement("li");
    emptyItem.className = "empty";
    emptyItem.textContent = "还没有排除规则。";
    elements.rulesList.appendChild(emptyItem);
    return;
  }

  state.settings.excludedRules.forEach(function (rule) {
    var item = document.createElement("li");
    item.className = "rule-item";

    var text = document.createElement("span");
    text.className = "rule-text";
    text.textContent = rule;

    var removeButton = document.createElement("button");
    removeButton.type = "button";
    removeButton.className = "secondary";
    removeButton.textContent = "删除";
    removeButton.dataset.rule = rule;

    item.appendChild(text);
    item.appendChild(removeButton);
    elements.rulesList.appendChild(item);
  });
}

/**
 * loadSettings
 * @author Chen
 */
async function loadSettings() {
  var stored = await storageGet(["settings"]);
  state.settings = sanitizeSettings(stored.settings);
  renderSettings();
  renderRules();
}

/**
 * persistSettings
 * @author Chen
 */
async function persistSettings(successMessage) {
  await storageSet({
    settings: state.settings
  });
  renderSettings();
  renderRules();

  if (successMessage) {
    showStatus(successMessage);
  }
}

elements.settingsForm.addEventListener("submit", function (event) {
  event.preventDefault();

  state.settings = sanitizeSettings({
    timeoutMinutes: elements.timeoutMinutes.value,
    excludedRules: state.settings.excludedRules,
    skipPinned: elements.skipPinned.checked,
    skipAudible: elements.skipAudible.checked
  });

  persistSettings("基础设置已保存。").catch(function (error) {
    showStatus(error.message || "保存基础设置失败。", true);
  });
});

elements.addRuleForm.addEventListener("submit", function (event) {
  event.preventDefault();

  var normalizedRule = TabDiscardRules.normalizeRule(elements.newRule.value);

  if (!normalizedRule) {
    showStatus("请输入有效的站点或匹配规则。", true);
    return;
  }

  state.settings = sanitizeSettings({
    timeoutMinutes: state.settings.timeoutMinutes,
    excludedRules: state.settings.excludedRules.concat([normalizedRule]),
    skipPinned: state.settings.skipPinned,
    skipAudible: state.settings.skipAudible
  });

  persistSettings("排除规则已添加。")
    .then(function () {
      elements.newRule.value = "";
      elements.newRule.focus();
    })
    .catch(function (error) {
      showStatus(error.message || "添加规则失败。", true);
    });
});

elements.rulesList.addEventListener("click", function (event) {
  var button = event.target;

  if (!(button instanceof HTMLButtonElement) || !button.dataset.rule) {
    return;
  }

  state.settings = sanitizeSettings({
    timeoutMinutes: state.settings.timeoutMinutes,
    excludedRules: state.settings.excludedRules.filter(function (rule) {
      return rule !== button.dataset.rule;
    }),
    skipPinned: state.settings.skipPinned,
    skipAudible: state.settings.skipAudible
  });

  persistSettings("排除规则已删除。").catch(function (error) {
    showStatus(error.message || "删除规则失败。", true);
  });
});

chrome.storage.onChanged.addListener(function (changes, areaName) {
  if (areaName !== "local" || !changes.settings) {
    return;
  }

  state.settings = sanitizeSettings(changes.settings.newValue);
  renderSettings();
  renderRules();
});

loadSettings().catch(function (error) {
  showStatus(error.message || "读取设置失败。", true);
});

