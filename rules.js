(function (globalScope) {
  /**
   * escapeRegex
   * @author Chen
   */
  function escapeRegex(value) {
    return value.replace(/[|\\{}()[\]^$+?.]/g, "\\$&");
  }

  /**
   * normalizeRule
   * @author Chen
   */
  function normalizeRule(rule) {
    if (typeof rule !== "string") {
      return "";
    }

    var normalized = rule.trim().toLowerCase();

    if (!normalized) {
      return "";
    }

    if (normalized.indexOf("://") === -1 && normalized.indexOf("/") === -1) {
      normalized = normalized.replace(/^\.+/, "");
    }

    return normalized;
  }

  /**
   * extractHostname
   * @author Chen
   */
  function extractHostname(url) {
    try {
      return new URL(url).hostname.toLowerCase();
    } catch (error) {
      return "";
    }
  }

  /**
   * isUrlPattern
   * @author Chen
   */
  function isUrlPattern(rule) {
    return rule === "<all_urls>" || rule.indexOf("://") !== -1 || rule.indexOf("/") !== -1;
  }

  /**
   * matchAllUrls
   * @author Chen
   */
  function matchAllUrls(url) {
    try {
      var parsed = new URL(url);
      return ["http:", "https:", "file:", "ftp:"].indexOf(parsed.protocol) !== -1;
    } catch (error) {
      return false;
    }
  }

  /**
   * matchWildcardHostname
   * @author Chen
   */
  function matchWildcardHostname(rule, hostname) {
    var regexSource = "^" + escapeRegex(rule).replace(/\\\*/g, ".*") + "$";
    return new RegExp(regexSource, "i").test(hostname);
  }

  /**
   * matchHostnameRule
   * @author Chen
   */
  function matchHostnameRule(rule, hostname) {
    if (!rule || !hostname) {
      return false;
    }

    if (rule.indexOf("*") !== -1) {
      return matchWildcardHostname(rule, hostname);
    }

    return hostname === rule || hostname.endsWith("." + rule);
  }

  /**
   * matchUrlPattern
   * @author Chen
   */
  function matchUrlPattern(rule, url) {
    if (rule === "<all_urls>") {
      return matchAllUrls(url);
    }

    var regexSource = "^" + escapeRegex(rule).replace(/\\\*/g, ".*") + "$";
    return new RegExp(regexSource, "i").test(url);
  }

  /**
   * ruleMatchesUrl
   * @author Chen
   */
  function ruleMatchesUrl(rule, url) {
    var normalizedRule = normalizeRule(rule);

    if (!normalizedRule || !url) {
      return false;
    }

    if (isUrlPattern(normalizedRule)) {
      return matchUrlPattern(normalizedRule, url);
    }

    return matchHostnameRule(normalizedRule, extractHostname(url));
  }

  /**
   * getMatchingRule
   * @author Chen
   */
  function getMatchingRule(rules, url) {
    if (!Array.isArray(rules) || !url) {
      return "";
    }

    for (var index = 0; index < rules.length; index += 1) {
      if (ruleMatchesUrl(rules[index], url)) {
        return normalizeRule(rules[index]);
      }
    }

    return "";
  }

  /**
   * sortAndDedupeRules
   * @author Chen
   */
  function sortAndDedupeRules(rules) {
    var unique = {};
    var result = [];

    if (!Array.isArray(rules)) {
      return result;
    }

    for (var index = 0; index < rules.length; index += 1) {
      var normalizedRule = normalizeRule(rules[index]);

      if (!normalizedRule || unique[normalizedRule]) {
        continue;
      }

      unique[normalizedRule] = true;
      result.push(normalizedRule);
    }

    result.sort();
    return result;
  }

  globalScope.TabDiscardRules = {
    extractHostname: extractHostname,
    getMatchingRule: getMatchingRule,
    normalizeRule: normalizeRule,
    ruleMatchesUrl: ruleMatchesUrl,
    sortAndDedupeRules: sortAndDedupeRules
  };
})(typeof self !== "undefined" ? self : window);
