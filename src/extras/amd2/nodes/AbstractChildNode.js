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

import {
  classExtend,
  createError
} from "../util.js";

import {
  resolveUseDefault,
  isBlobUrl,
  createRequire
} from "../common.js";

import AbstractNode from "./AbstractNode.js";

/**
 * The AMD module object.
 *
 * The type of the special AMD "module" dependency.
 *
 * @typedef {({id: ?string, uri: string, config: object, exports: *})} AmdModule
 */

/**
 * @class
 * @extends AbstractNode
 * @abstract
 */
export default function AbstractChildNode(parent, aliasMap) {

  AbstractNode.call(this, aliasMap);

  this.__parent = parent;
  this.__root = parent.root;
  this.__isLoaded = false;

  /**
   * The AMD "module" dependency. Lazily created.
   *
   * @type {?AmdModule}
   * @private
   */
  this.__amdModule = null;
}

classExtend(AbstractChildNode, AbstractNode, /** @lends AbstractChildNode# */{
  /** @override */
  get isRoot() {
    return false;
  },

  /** @override */
  get root() {
    return this.__root;
  },

  /** @override */
  get parent() {
    return this.__parent;
  },

  /** @override */
  get parentId() {
    return this.__parent && this.__parent.id;
  },

  get amdModule() {
    return this.__amdModule;
  },

  get registeredExports() {
    return resolveUseDefault(this.root.sys.get(this.url)) || null;
  },

  get isLoaded() {
    return this.__isLoaded;
  },

  $setLoaded: function() {
    if (!process.env.SYSTEM_PRODUCTION && this.__isLoaded) {
      throw createError("Invalid state.");
    }

    this.__isLoaded = true;
  },

  /**
   * Gets a value that indicates if this node is detached from the node hierarchy.
   *
   * @name isDetached
   * @memberOf AbstractChildNode#
   * @type {boolean}
   * @readonly
   * @abstract
   */

  /**
   * Gets the url for a module having this node's identifier,
   * optionally, with a given extension.
   *
   * For purposes of better supporting `canonicalIdByUrl` and
   * to integrate better with SystemJS's resolve semantics,
   * module URLs include a fragment annotation.
   *
   * ## URL of a Regular Module
   *
   * Unbundled:
   * - simple.js#!mid=simple/id - simple module - module which has no special role;
   * - plugin.js#!mid=plugin/id - plugin module - module which has the resource loader role;
   * - bundle.js#!mid=bundle/id - bundle module - module which has the bundling role; typically, itself has an undefined value;
   *
   * Bundled:
   * - bundle.js#!mid=bundle/id#!mid=simple/id - simple module which has been bundled;
   * - bundle.js#!mid=bundle/id#!mid=plugin/id - plugin module which has been bundled;
   *
   * ## URL of a Resource Module
   *
   * Unbundled:
   * - plugin.js#!mid=plugin/id!resource-id - resource module, when resolved client-side
   * - plugin.js#!mid=plugin/id!resource-id_unnormalized123 - unnormalized resource module, when resolved client-side.
   *
   * Bundled:
   * - bundle.js#!mid=bundle/id#!mid=plugin/id!resource-id - resource module, when processed server-side and bundled (always normalized).
   *
   * The URL is determined from the node's {@link AbstractNode#id}
   * using the following procedure:
   *
   * TODO: review procedure description
   * 1. if this.bundle
   *    return this.bundle.url
   * 2. let loadId <- this.id
   *    let regularUrl <- this.url
   * 2. if this.bundle:
   *    loadId = this.bundle.id
   *    regularUrl = this.bundle.url
   * 3. let regularUrl <- path(loadId)
   *    if no path then url <- null
   *    return url
   * 4. if not (regularUrl is "data:..." or "blob:..." URL or has a "?")
   *    regularUrl = regularUrl + ".js"
   * 5. if not (regularUrl is "/..." or "//..." or "pro+to-col:...")
   *    regularUrl = this.baseUrl + regularUrl
   * 4. let url = regularUrl
   * 5. if this.urlArgs and not url is "blob:...":
   *    url = url + this.urlArgs(load-id, url)
   * 6. url <- setUrlFragment(url, "#!mid=<id>")
   *
   * @param {?string} [extension] - The extension to use (e.g. `".css"`).
   * When `null`, no extension is used.
   * When `undefined`, the default extension is used (`".js"` for simple nodes).
   *
   * @param {?boolean} [omitFragment=false] - Indicates that the URL fragment annotation
   * containing the module's leaf identifier should be omitted.
   *
   * @return {?string} The url if one can be determined; `null`, otherwise.
   * @overridable
   */
  getUrl: function(extension, omitFragment) {
    return null;
  },

  /**
   * Gets the URL of the leaf module represented by this node, if one can be determined; `null`, otherwise.
   *
   * @type {?string}
   * @readonly
   */
  get url() {
    return this.getUrl();
  },

  /**
   * Applies the configured {@link RootNode#urlArgs}, if any, to the given URL.
   *
   * @param {string} url - The URL to apply URL arguments to.
   * @return {string} The transformed URL.
   * @internal
   */
  $applyUrlArgs: function(url) {
    const urlArgs = this.root.urlArgs;
    if (urlArgs && !isBlobUrl(url)) {
      // Append any query parameters to URL.
      // Function should detect if ? or & is needed...
      url += urlArgs(this.id || url, url);
    }

    return url;
  },

  /**
   * Gets the configuration of this node, if any; `null`, otherwise.
   *
   * @name config
   * @memberOf AbstractChildNode#
   * @type {?object}
   * @readonly
   * @abstract
   */

  /** @private */
  __getOrCreateAmdModule() {
    return this.__amdModule || this.$initAmdModule();
  },

  /**
   * @internal
   */
  $initAmdModule: function() {
    if (!process.env.SYSTEM_PRODUCTION && this.__amdModule) {
      throw createError("Invalid State!");
    }

    const node = this;
    const url = this.url;
    let hasExports = false;
    let exports;

    /** @type AmdModule */
    const amdModule = {
      // Per RequireJS, when there is no AMD context,
      // the id of a "module" dependency is its URL.
      id: (this.id || url),
      uri: url,

      config: function() {
        return node.config || {};
      },

      get $hasExports() {
        return hasExports;
      },

      get exports() {
        if (!hasExports) {
          hasExports = true;
          exports = node.isLoaded ? node.registeredExports : {};
        }

        return exports;
      },
      set exports(value) {
        exports = value;
      }
    };

    return (this.__amdModule = amdModule);
  },

  /** @internal */
  $assertAttached: function() {
    if (this.isDetached) {
      throw createError("Operation invalid on detached module nodes.");
    }
  },

  /** @override */
  _createRequire: function() {
    return createRequire(this);
  }
});
