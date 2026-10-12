export const escapeHtml = (value) => {
  if (value === null || value === undefined) return "";
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
};

export const joinHtml = (items) => items.filter(Boolean).join("");

// Common ASCII transliterations for Latin-derived characters.
// Covers the same range as Rails ActiveSupport::Inflector.transliterate.
const TRANSLITERATIONS = {
  "\u00C0":"A","\u00C1":"A","\u00C2":"A","\u00C3":"A","\u00C4":"A","\u00C5":"A",
  "\u00C6":"AE","\u00C7":"C","\u00C8":"E","\u00C9":"E","\u00CA":"E","\u00CB":"E",
  "\u00CC":"I","\u00CD":"I","\u00CE":"I","\u00CF":"I","\u00D0":"D","\u00D1":"N",
  "\u00D2":"O","\u00D3":"O","\u00D4":"O","\u00D5":"O","\u00D6":"O","\u00D8":"O",
  "\u00D9":"U","\u00DA":"U","\u00DB":"U","\u00DC":"U","\u00DD":"Y","\u00DE":"Th",
  "\u00DF":"ss",
  "\u00E0":"a","\u00E1":"a","\u00E2":"a","\u00E3":"a","\u00E4":"a","\u00E5":"a",
  "\u00E6":"ae","\u00E7":"c","\u00E8":"e","\u00E9":"e","\u00EA":"e","\u00EB":"e",
  "\u00EC":"i","\u00ED":"i","\u00EE":"i","\u00EF":"i","\u00F0":"d","\u00F1":"n",
  "\u00F2":"o","\u00F3":"o","\u00F4":"o","\u00F5":"o","\u00F6":"o","\u00F8":"o",
  "\u00F9":"u","\u00FA":"u","\u00FB":"u","\u00FC":"u","\u00FD":"y","\u00FE":"th",
  "\u00FF":"y",
};

/**
 * Generate a URL-safe slug from a string, matching the behavior of
 * Ruby on Rails ActiveSupport::Inflector.parameterize.
 *
 * Algorithm:
 *  1. Transliterate accented / special Latin characters to ASCII.
 *  2. Lower-case the result.
 *  3. Replace every run of non-alphanumeric characters with the separator.
 *  4. Collapse consecutive separators into one.
 *  5. Strip leading / trailing separators.
 *
 * @param {string} str - The string to parameterize.
 * @param {string} [separator="-"] - The separator character.
 * @returns {string} A URL-safe slug.
 */
export const parameterize = (str, separator = "-") => {
  if (!str) return "";
  // 1. Transliterate
  let result = "";
  for (const ch of String(str)) {
    result += TRANSLITERATIONS[ch] || ch;
  }
  // 2-5. Lower, replace, collapse, trim
  const sep = separator.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); // escape for regex
  return result
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, separator)                    // non-alnum → separator
    .replace(new RegExp(`${sep}+`, "g"), separator)        // collapse
    .replace(new RegExp(`^${sep}|${sep}$`, "g"), "");      // trim
};
