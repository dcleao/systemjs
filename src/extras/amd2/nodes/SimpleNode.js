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
  global,
  isArray,
  classExtend,
  createError,
  prototype,
  getGlobal,
  stringContains
} from "../util.js";

import {
  composeIds,
  isResourceId,
  removeTrailingSlash,
  isAbsoluteUrl,
  isDataOrBlobUrl,
  removeUrlFragment,
  JS_EXT,
  URL_MODULE_FRAGMENT
} from "../common.js";

import { base as baseSystemJS } from "../SystemJS.js";

import AbstractNamedNode from "./AbstractNamedNode.js";

/**
 * The AMD shim configuration.
 *
 * @typedef {({exports: ?string, deps: ?Array.<string>, init: ?function})} AmdShimConfig
 */

/**
 * @class
 * @extends AbstractNamedNode
 */
export default function SimpleNode(name/*, parent, isDetached*/) {

  if (!process.env.SYSTEM_PRODUCTION && isResourceId(name)) {
    throw createError("Resource must be child of root.");
  }

  AbstractNamedNode.apply(this, arguments);

  /**
   * The main node of this node, if any; `null`, otherwise.
   * @type {?SimpleNode}
   * @private
   */
  this.__main = null;

  // The fixed path, if any.
  this.__fixedPath = null;

  // `null` means no fixed path was defined for self of any of the ascendant nodes (except root).
  this.__pathCached = undefined;

  // `null` means no fixed path was defined (idem)...
  this.__regularUrlCached = undefined;

  /**
   * The shim AMD information, if any; `null`, otherwise.
   *
   * @type {?AmdInfo}
   * @private
   */
  this.__shim = null;
}

const baseNamedNodeInvalidateUrl = prototype(AbstractNamedNode)._invalidateRegularUrl;

classExtend(SimpleNode, AbstractNamedNode, /** @lends SimpleNode# */{
  /**
   * Gets the main module of this module.
   *
   * A module which has a main module is considered a package.
   *
   * When set, the identifier string of the main node can be specified,
   * considered relative to this module,
   * even when a bare name (without starting with `./`).
   * If the value has the extension `.js`, if is removed.
   *
   * @type {?SimpleNode}
   * @readonly
   * @see AbstractNamedNode#setMain
   */
  get main() {
    return this.__main;
  },

  /**
   * Sets the main module of this module.
   *
   * Should be a simple module identifier.
   *
   * @param {?string} descendantId - The descendant identifier of the main node of this node.
   * The identifier is considered relative to this node,
   * even when a bare name (without starting with `./`).
   * If the value has the extension `.js`, it is removed.
   *
   * @see AbstractNamedNode#main
   */
  setMain: function(descendantId) {

    this.$assertAttached();

    this.__main = descendantId
      ? this.getDescendant(this.$normalizeSimple(descendantId), true)
      : null;
  },

  /**
   * Gets or sets the fixed path of this node.
   *
   * When relative, it is relative to the root node's
   * {@link RootNode#baseUrl}.
   * When not specified,
   * the path is built from the parent node's [path]{@link AbstractNamedNode#path}
   * and this node's [name]{@link AbstractNode#name}.
   *
   * When set, a trailing slash is removed.
   *
   * @type {?string}
   * @see AbstractNamedNode#path
   */
  get fixedPath() {
    return this.__fixedPath;
  },

  set fixedPath(value) {

    this.$assertAttached();

    const fixedPathNew = value ? removeTrailingSlash(value) : null;
    if (fixedPathNew !== this.__fixedPath) {
      this._invalidateRegularUrl(function applyChange() {
        /** @this SimpleNode# */
        this.__fixedPath = fixedPathNew;
        this.__invalidatePath();
      });
    }
  },

  /**
   * Gets the effective path of this node, if one can be determined; `null`, otherwise.
   *
   * When {@link AbstractNamedNode#fixedPath} is specified, it is returned.
   * Otherwise, the path is built from the parent node's [path]{@link AbstractNamedNode#path}
   * and this node's [name]{@link AbstractNode#name}.
   * If none of the ascendant nodes has a specified `fixedPath`, `null` is returned.
   *
   * @type {?string}
   * @readonly
   */
  get path() {
    if (this.__pathCached === undefined) {
      this.__pathCached = this.__buildPath();
    }

    return this.__pathCached;
  },

  /**
   * Gets the node's shim AMD information, if any; `null`, otherwise.
   *
   * @type {?AmdInfo}
   * @readonly
   */
  get shim() {
    return this.__shim;
  },

  configPackage: function(packageSpec) {

    this.setMain(packageSpec.main || "main");

    if (packageSpec.location) {
      this.fixedPath = packageSpec.location;
    }
  },

  configPath: function(pathSpec) {
    if (pathSpec) {
      if (isArray(pathSpec)) {
        pathSpec = pathSpec[0];
      }

      this.fixedPath = pathSpec;
    }
  },

  /**
   * Configures the node's shim.
   *
   * @param {AmdShimConfig} shimConfig - The AMD shim configuration.
   */
  configShim: function(shimConfig) {

    this.$assertAttached();

    /** @type {AmdInfo} */
    const shim = {id: null, deps: null, execute: null};

    if (isArray(shimConfig)) {
      shim.deps = shimConfig.slice(0);
    } else {
      if (shimConfig.deps) {
        shim.deps = shimConfig.deps.slice(0);
      }

      if (shimConfig.exports || shimConfig.init) {
        shim.execute = createShimExecute(shimConfig);
      }
    }

    this.__shim = (shim.deps || shim.execute) ? shim : null;
  },

  /** @override */
  _getUnbundledUrl: function(extension, omitFragment) {
    let url = this.__regularUrl;
    if (url) {

      // Add extension.
      // If extension is `null` don't add.
      // If extension is `undefined` add default (for certain cases).
      // Else add it unconditionally.
      if (extension !== null) {
        if (extension === undefined) {
          // Default extension.
          if (!isDataOrBlobUrl(url) && !stringContains(url, "?")) {
            url += JS_EXT;
          }
        } else {
          url += extension;
        }
      }

      url = removeUrlFragment(this.$applyUrlArgs(url));

      if (!omitFragment) {
        // module.js#!mid=module/id
        // bundle.js#!mid=bundle/id
        // plugin.js#!mid=plugin/id
        url += URL_MODULE_FRAGMENT + this.id;
      }
    }

    return url;
  },

  /**
   * Gets the regular part of the URL of modules of, or descending from, this node.
   *
   * @type {?string}
   * @private
   *
   * @see SimpleNode#_invalidateRegularUrl
   * @see SimpleNode#__buildRegularUrl
   * @see SimpleNode#__isIndexedByRegularUrl
   * @see RootNode#$onNodeRegularUrlChanged
   */
  get __regularUrl() {
    if (this.__regularUrlCached === undefined) {
      this.__regularUrlCached = this.__buildRegularUrl();
    }

    return this.__regularUrlCached;
  },

  __invalidatePath: function() {

    this.__pathCached = undefined;

    this.$eachChild(function(child) {
      // Stop invalidation propagation if child node does not inherit the parent's path.
      if ((child instanceof SimpleNode) && !child.fixedPath) {
        // child is SimpleNode.
        child.__invalidatePath();
      }
    });
  },

  // ~ on fixedPath and on parent.path
  __buildPath: function() {

    const fixedPath = this.fixedPath;
    if (fixedPath) {
      return fixedPath;
    }

    const parent = this.parent;

    // Do not allow top-level modules without a fixed path.
    if (parent.isRoot) {
      return null;
    }

    // Propagate `null` to child modules.
    const parentPath = parent.path;
    return parentPath && composeIds(parentPath, this.name);
  },

  /** @override */
  _invalidateRegularUrl: function(applyChange) {
    // If regular URL was or will be indexed (before and after applyChange).
    let wasOrWillBeIndexed = this.__isIndexedByRegularUrl;

    // "Cold" value.
    let regularUrlOld;
    let regularUrlNew;

    if (wasOrWillBeIndexed) {
      regularUrlOld = this.__regularUrlCached || null;
    }

    baseNamedNodeInvalidateUrl.call(this, applyChange);

    // Has it become "index by regular URL"?
    if (!wasOrWillBeIndexed) {
      wasOrWillBeIndexed = this.__isIndexedByRegularUrl;
    }

    this.__regularUrlCached = undefined;

    if (wasOrWillBeIndexed) {
      regularUrlNew = this.__regularUrl;

      // If either old or new value are non-null,
      // then this node needs to have its regularUrl re-indexed!
      // Also, only need to re-index if regularUrl actually changed.
      // If both are null, then they're equal, so the !== test covers both conditions.
      if (regularUrlNew !== regularUrlOld) {
        this.root.$onNodeRegularUrlChanged(this, regularUrlNew, regularUrlOld);
      }
    }
  },

  // Module is indexed by regularUrl only if it has a fixedPath.
  get __isIndexedByRegularUrl() {
    return !!this.fixedPath;
  },

  // Determines the value of __regularUrl.
  // Depends on path, bundle and baseUrl
  __buildRegularUrl: function() {
    if (this.bundle) {
      return null;
    }

    // If there is no `path`, there can be no URL.
    const path = this.path;
    if (!path) {
      return null;
    }

    let url = path;

    // Not "//foo", "/foo" or "http://foo".
    if (!isAbsoluteUrl(url)) {
      url = this.root.baseUrl + url;
    }

    // Let base implementation apply further URL normalizations and URL mappings via Import Map!
    return baseSystemJS.resolve.call(this.root.sys, url);
  }
});

/**
 * Creates an AMD execution function for a given shimming specification.
 *
 * @param {AmdShimConfig} shimConfig - The AMD shim configuration.
 * @return {function} The AMD execution function.
 */
function createShimExecute(shimConfig) {

  const exportedPath = shimConfig.exports || undefined;
  const init = shimConfig.init || undefined;

  return shimExecute;

  // Called with the dependencies' values as arguments.
  function shimExecute() {
    return (init && init.apply(global, arguments)) || getGlobal(exportedPath);
  }
}
