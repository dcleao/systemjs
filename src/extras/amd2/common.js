/*
 * Copyright 2020 Hitachi Vantara Corporation
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

// Portions of the following code are based on https://github.com/requirejs/requirejs.

"use strict";

import {
  isBrowser,
  isArray,
  stringSuffixFrom,
  stringContains,
  stringPrefix,
  stringIndexOf,
  length,
  createError,
  splitAt,
  objectCopy
} from "./util.js";

export const RE_RESOURCE_ID_UNNORMALIZED = /_unnormalized\d+$/;
export const RESOURCE_UNNORMALIZED = "_unnormalized";
export const MAP_SCOPE_ANY_MODULE = "*";

export const JS_EXT = ".js";
export const RE_JS_EXT = /\.js$/i;

// Specifier Types
export const SPEC_ABSOLUTE_URL = 1;
export const SPEC_SIMPLE = 2;
export const SPEC_RESOURCE = 4;
export const SPEC_STAR = 8;

// Absolute or Protocol Relative or Origin Relative
const RE_URL_ABSOLUTE = /^\/|[\w+.\-]+:/i;
export const RE_URL_BLOB = /^blob:/i;
export const RE_URL_DATA_OR_BLOB = /^(data|blob):/i;

const RESOURCE_SEPARATOR = "!";
export const PATH_SEPARATOR = "/";
export const URL_MODULE_FRAGMENT = "#!mid=";

export function createRequire(node) {

  const rootNode = node.root;

  return objectCopy(require, {
    isBrowser: isBrowser,

    /**
     * Gets the url of a module with the given identifier,
     * which may include an extension,
     * relative to this node.
     *
     * The extension, if present, is preserved.
     * The default ".js" extension is not added in any case.
     *
     * @param {string} id - The module identifier, which may include an extension.
     *
     * @return {?string} The url if one can be determined; `null`, otherwise.
     */
    toUrl: function(id) {

      let lastIndex = id.lastIndexOf('.');

      // Is it a real extension?
      // "."
      // ".."
      // ".ext"
      // "../foo"
      // "../foo.ext"
      let isExtension = lastIndex !== -1;
      if (isExtension) {
        let isNotRelative = stringIndexOf(id, ".") > 0;
        isExtension = (isNotRelative || lastIndex >= 2);
      }

      let moduleName, extension;
      if (isExtension) {
        // "../foo" and ".ext"
        moduleName = stringPrefix(id, lastIndex);
        extension = stringSuffixFrom(id, lastIndex);
      } else {
        moduleName = id;
        // `null` <=> use no extension.
        extension = null;
      }

      moduleName = node.normalizeDep(moduleName);

      return rootNode.$getOrCreateDetached(moduleName).getUrl(extension, true);
    }
    /*
    defined: function(id) {
    },

    specified: function(id) {
    }
    */
  });

  // ---

  function require(depRefs, callback, errback) {
    return isArray(depRefs)
      ? node.requireManyAsync(depRefs)
        .then(function(depValues) { callback.apply(null, depValues); }, errback)
      : node.requireOne(depRefs);
  }
}

export function createDepSetter(depValues, depIndex) {
  return function depSetter(ns) {
    depValues[depIndex] = resolveUseDefault(ns);
  };
}

export function resolveUseDefault(ns) {
  return ns && ns.__useDefault ? ns.default : ns;
}

export function assertSpecifier(id, type) {

  if (!id) {
    throw createError("Invalid empty id.");
  }

  if (id === MAP_SCOPE_ANY_MODULE) {
    if (!(type & SPEC_STAR)) {
      throw createError("Invalid id '" + MAP_SCOPE_ANY_MODULE + "'.");
    }
  } else if (isAbsoluteUrl(id)) {
    if (!(type & SPEC_ABSOLUTE_URL)) {
      throw createError("URL not allowed: '" + id + "'.");
    }
  } else if (isResourceId(id)) {
    if (!(type & SPEC_RESOURCE)) {
      throw createError("Plugin call id not allowed: '" + id + "'.");
    }
  } else if (!(type & SPEC_SIMPLE)) {
    throw createError("Simple identifier is not allowed: '" + id + "'.");
  }

  return id;
}

export function absolutizeId(id, parentId) {

  // Anything not starting with a "." needs no handling.
  if (!id || id[0] !== ".") {
    return id;
  }

  const baseIds = parentId ? parentId.split(PATH_SEPARATOR) : null;
  const names = id.split(PATH_SEPARATOR);

  // Remove _leading_ "./" or "../".
  while (length(names) > 0) {
    const name = names[0];
    if (name === "..") {
      // Go up one base name.
      if (!baseIds || length(baseIds) === 0) {
        throw createError("Invalid identifier '" + id + "'.");
      }

      baseIds.pop();
    } else if (name !== ".") {

      // Found first non "." or "..".

      if (name && name[0] === ".") {
        // Something like "..."...
        throw createError("Invalid identifier '" + id + "'.");
      }

      if (baseIds && length(baseIds) > 0) {
        names.unshift.apply(names, baseIds);
      }

      return names.join(PATH_SEPARATOR);
    }

    // Discard "." or "..".
    names.shift();
  }
}

export function removeJsExtension(value) {
  const L = length(value);
  if (L >= 3 && value[L - 3] === "." && value[L - 2].toLowerCase() === "j" && value[L - 1].toLowerCase() === "s") {
    return stringPrefix(value, L - 3);
  }

  return value;
}

export function removeTrailingSlash(value) {
  const lastIndex = length(value) - 1;
  return value[lastIndex] === PATH_SEPARATOR ? stringPrefix(value, lastIndex) : value;
}

export function ensureTrailingSlash(value) {
  return value[length(value) - 1] === PATH_SEPARATOR ? value : (value + PATH_SEPARATOR);
}

export function composeIds(baseId, childId) {
  return baseId ? (baseId + PATH_SEPARATOR + childId) : childId;
}

export function removeUrlFragment(url) {
  const index = stringIndexOf(url, "#");
  return index < 0 ? url : stringPrefix(url, index);
}

/**
 * Parses a URL annotated with a fragment containing module identifiers.
 *
 * URLs with module fragments can have any of the following forms
 * (there are only three syntactic forms, but these are all of the semantic possibilities):
 * - `module.js#!mid=module/id`
 * - `bundle.js#!mid=bundle/id`
 * - `plugin.js#!mid=plugin/id`
 * - `bundle.js#!mid=bundle/id#!mid=bundled/module/id`
 * - `bundle.js#!mid=bundle/id#!mid=plugin/id!resource/name`
 *
 * When the given URL does not contain `#mid=`, `null` is returned.
 * Otherwise, returns an array with the following elements:
 *
 * 1. the URL without the fragment section,
 * 2. the module identifier directly corresponding to URL (canonical or not), and
 * 3. when present, the identifier of a sub-resource module which is bundled in the URL.
 *
 * @param {string} url - The URL to parse.
 * @return {?([string, ?string, ?string])} An array having three positions or `null`.
 */
export function parseUrlWithModuleFragment(url) {

  let index = stringIndexOf(url, URL_MODULE_FRAGMENT);
  if (index < 0) {
    return null;
  }

  const LEN = length(URL_MODULE_FRAGMENT);

  const scriptUrl = stringPrefix(url, index);
  let scriptId = stringSuffixFrom(url, index + LEN);
  let bundledId = null;

  index = stringIndexOf(scriptId, URL_MODULE_FRAGMENT);
  if (index >= 0) {
    bundledId = stringSuffixFrom(scriptId, index + LEN);
    scriptId = stringPrefix(scriptId, index);
  }

  return [scriptUrl, scriptId, bundledId];
}

// "/a" - origin relative
// "//a" - protocol relative
// "http://" - absolute
export function isAbsoluteUrl(text) {
  return !!text && RE_URL_ABSOLUTE.test(text);
}

export function isDataOrBlobUrl(text) {
  return RE_URL_DATA_OR_BLOB.test(text);
}

export function isBlobUrl(text) {
  return RE_URL_BLOB.test(text);
}

export function isBareName(text) {
  return !!text && !isAbsoluteUrl(text) && text[0] !== ".";
}

export function parseResourceId(id) {
  return splitAt(id, RESOURCE_SEPARATOR);
}

export function buildResourceId(plugin, resource) {
  return plugin + RESOURCE_SEPARATOR + resource;
}

export function isResourceId(id) {
  return !!id && stringContains(id, RESOURCE_SEPARATOR);
}

export function isUnnormalizedId(id) {
  return RE_RESOURCE_ID_UNNORMALIZED.test(id);
}
