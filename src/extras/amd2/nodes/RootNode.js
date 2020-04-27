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
  prototype,
  classExtend,
  createError,
  createObject,
  getOwn,
  eachOwn,
  objectCopy,
  isString,
  isFunction,
  isArray,
  constantFun,
  stringContains,
  stringIndexOf,
  stringPrefix,
  stringSuffixFrom
} from "../util.js";

import {
  assertSimple,
  createRequire,
  ensureTrailingSlash,
  isBareName,
  isResourceId,
  removeJsExtension,
  removeUrlFragment,
  MAP_SCOPE_ANY_MODULE,
  JS_EXT,
  RE_URL_BLOB,
  RE_URL_DATA_OR_BLOB,
  PATH_SEPARATOR
} from "../common.js";

import AbstractNode from "./AbstractNode.js";
import ResourceNode from "./ResourceNode.js";

const REQUIRE_EXPORTS_MODULE = ["require", "exports", "module"];

/**
 * @class
 * @extends AbstractNode
 */
export default function RootNode(systemJS) {

  const aliasMap = createObject();

  AbstractNode.call(this, aliasMap);

  /**
   * The associated SystemJS instance.
   *
   * @type {SystemJS}
   * @readonly
   */
  this.sys = systemJS;

  /**
   * A map of all descendant named nodes by id.
   *
   * Detached nodes are not included.
   *
   * @type {Object.<string, AbstractNamedNode>}
   * @readonly
   * @private
   */
  this.__byId = createObject();

  /**
   * A map of all descendant nodes by their _regular_ URL.
   *
   * Only instances of `SimpleNode` have a regular URL.
   * Moreover, only nodes having a specified `fixedPath` are included in this index.
   *
   * Detached nodes are not included.
   *
   * @type {Object.<string, SimpleNode>}
   * @readonly
   * @private
   *
   * @see AbstractNamedNode#url
   */
  this.__byUrl = createObject();

  /**
   * The base URL for relative paths.
   *
   * The default is `"./"`.
   *
   * @type {string}
   * @private
   */
  this.__baseUrl = "./";

  /**
   * A function which receives a module identifier and its determined URL
   * and returns a new URL possibly containing additional query parameters.
   *
   * @type {?(function(string, string): string)}
   * @private
   */
  this.__urlArgs = null;

  /**
   * Gets the AMD `define` function of this node hierarchy.
   *
   * @type {function}
   * @readonly
   */
  this.define = createDefine(this);
}

const baseGetDescendant = prototype(AbstractNode).getDescendant;

classExtend(RootNode, AbstractNode, /** @lends RootNode# */{
  /** @override */
  get isRoot() {
    return true;
  },

  /** @override */
  get root() {
    return this;
  },

  /** @override */
  get isDetached() {
    return false;
  },

  /** @override */
  get parent() {
    return null;
  },

  /** @override */
  get parentId() {
    return null;
  },

  get baseUrl() {
    return this.__baseUrl;
  },

  set baseUrl(value) {
    // Normalize `value`.
    let newValue;
    if (value) {
      newValue = ensureTrailingSlash(value);

      if (isBareName(newValue)) {
        // If left as is, when calling base.resolve with the URL built
        // in `SimpleNode#__regularUrl`,
        // would give incorrect results or throw.
        newValue = "./" + newValue;
      }
    } else {
      newValue = "./";
    }

    if (this.__baseUrl !== newValue) {
      this.__baseUrl = newValue;

      this.$eachChild(function(child) {
        child.$onBaseUrlChanged();
      });
    }
  },

  get urlArgs() {
    return this.__urlArgs;
  },

  set urlArgs(value) {
    if (isString(value)) {

      const urlArgs = value;

      value = function(id, url) {
        return (stringContains(url, "?") ? "&" : "?") + urlArgs;
      };
    }
    // else assume it's a function or null.

    this.__urlArgs = value || null;
  },

  /** @override */
  getDescendant: function(normalizedId, createIfMissing, createDetached) {
    // Resources always use the .js extension on their plugin prefix.
    const isResource = isResourceId(normalizedId);
    const neutralId = isResource ? normalizedId : removeJsExtension(normalizedId);

    let node = getOwn(this.__byId, neutralId) || null;
    if (!node && createIfMissing) {
      // Resources are children of root.
      if (isResource) {
        node = new ResourceNode(neutralId, this, createDetached);
      } else {
        node = baseGetDescendant.apply(this, arguments);
      }
    }

    return node;
  },

  get: function(normalizedId, createIfMissing, createDetached) {
    return this.getDescendant(normalizedId, createIfMissing, createDetached);
  },

  $getOrCreate: function(normalizedId, isDetached) {
    return this.getDescendant(normalizedId, true, isDetached);
  },

  $getOrCreateDetached: function(normalizedId) {
    return this.getDescendant(normalizedId, true, true);
  },

  /**
   * Configures the AMD nodes of this node hierarchy.
   *
   * @param {object} config - The configuration object.
   */
  configure: function(config) {

    const baseUrl = config.baseUrl;
    if (baseUrl !== undefined) {
      this.baseUrl = baseUrl;
    }

    const urlArgs = config.urlArgs;
    if (urlArgs !== undefined) {
      this.urlArgs = urlArgs;
    }

    const root = this;

    function getOrCreateSingle(id) {
      return root.$getOrCreate(assertSimple(id));
    }

    function processObjectConfig(configById, configMethodName, allowStar) {
      eachOwn(configById, function(config, id) {
        const node = allowStar && id === MAP_SCOPE_ANY_MODULE ? root : getOrCreateSingle(id);
        node[configMethodName](config);
      });
    }

    if (config.packages) {
      config.packages.forEach(function(pkgSpec) {
        if (pkgSpec) {
          if (isString(pkgSpec)) {
            pkgSpec = {name: pkgSpec};
          }

          getOrCreateSingle(pkgSpec.name).configPackage(pkgSpec);
        }
      });
    }

    processObjectConfig(config.paths, "configPath");
    processObjectConfig(config.map, "configMap", true);
    processObjectConfig(config.shim, "configShim");
    processObjectConfig(config.config, "configConfig");
    processObjectConfig(config.bundles, "configBundle");
  },

  /**
   * Gets the canonical identifier of the leaf module which has the given URL, if any;
   * `null`, if one does not exist.
   *
   * Note that the given URL cannot correspond to the identifier of a resource module,
   * as these are _virtual_ and don't have an own URL.
   *
   * ## Algorithm
   *
   * If the URL contains an URL fragment, the fragment is ignored,
   * as it does not affect script "identity" and mapping.
   *
   * The algorithm proceeds by matching the URL against an index that maps an URL to the id of its module.
   * It is assumed that only one module can be mapped to any given URL.
   * The URL index will contain the _regular URLs_ of modules configured with fixed paths.
   * Unlike the "final" url, the regular url doesn't have the automatically
   * added `.js` extension not the effect of the `urlArgs` configuration property.
   *
   * Note that, when the URL contains a query (`?`), it may be because:
   *
   * 1. when `urlArgs` is defined, the function added it (can add ? or &);
   * 2. it was already part of the module's `__regularUrl`.
   *
   * Whatever the case, the implemented algorithm removes each part of the URL,
   * from the end, matching it with the URL index,
   * to find the longest (most specific) configured regular URL,
   * while ignoring if `urlArgs` added ? or & or none.
   *
   * E.g. URL match attempts (without some special cases):
   *
   * 1. `foo/bar.js?a=b&c=d`
   * 2. `foo/bar.js?a=b`
   * 3. `foo/bar.js`
   * 4. `foo/bar`
   * 5. `foo`
   *
   * ## Index maintenance
   *
   * Because AMD configuration can be made at anytime,
   * the URL index needs to be invalidated/updated upon changes to
   * the configuration properties which influence the modules' URL:
   * `baseUrl`, `paths`, `packages` or `bundles`.
   *
   * The `urlArgs` is expected not to change to `null`,
   * after being defined and URLs have been obtained.
   *
   * @param {string} url - The URL of the module. Assumed normalized.
   * No special cases are tested such as `.` or `..` path segments.
   *
   * @return {?string} The canonical identifier or `null`.
   */
  canonicalIdByUrl: function(url) {

    const STATE_INIT = 0;
    const STATE_NEXT_QUERY_ARG = 1;
    const STATE_FIRST_PATH_SEGMENT = 2;
    const STATE_NEXT_PATH_SEGMENT = 3;

    if (!url) {
      return null;
    }

    // Remove the URL fragment, if any.
    url = removeUrlFragment(url);

    let state = STATE_INIT;
    let indexQuery = -1;

    /** @type {?string} */
    let urlPrevious = null;
    let idSuffix = "";

    while (true) {
      // Has URL changed (or is it the first iteration)?
      if (urlPrevious !== url) {
        const node = getOwn(this.__byUrl, url);
        if (node) {
          return node.id + idSuffix + JS_EXT;
        }

        urlPrevious = url;
      }
      // Else only the state changed.

      if (state === STATE_INIT) {
        // Is there a query part?
        indexQuery = stringIndexOf(url, "?");
        if (indexQuery < 0) {
          // > No query part.
          state = STATE_FIRST_PATH_SEGMENT;

          // The following assumption becomes invalid if `urlArgs` becomes null
          // after URLs have been generated.
        } else if (this.urlArgs && !RE_URL_BLOB.test(url)) {
          // > There is a query part AND `urlArgs` was used.
          // E.g. foo.org/bar.js?a=b&c=d
          state = STATE_NEXT_QUERY_ARG;

        } else {
          // > There is a query part AND `urlArgs` does not exist or was not used.
          // The `?` has to be part of the fixed path,
          // and such paths do not work well with composition,
          // and so can only be used reliably for leaf modules.
          // Concluding. No other matches are possible.
          return null;
        }
      } else if (state === STATE_NEXT_QUERY_ARG) {
        // Remove the next query argument, if any, and repeat match.
        const index = url.lastIndexOf("&", indexQuery + 1);
        if (index < 0) {
          // No more query args, so remove the query.
          // E.g. `foo.org/bar.js?a=b`
          url = stringPrefix(url, indexQuery);
          // E.g. `foo.org/bar.js`
          state = STATE_FIRST_PATH_SEGMENT;
        } else {
          // E.g. `foo.org/bar.js?a=b&c=d`
          url = stringPrefix(url, index);
          // E.g. `foo.org/bar.js?a=b`
        }
      } else if (state === STATE_FIRST_PATH_SEGMENT) {
        if (!RE_URL_DATA_OR_BLOB.test(url)) {
          // Remove the ".js" extension, which is automatically added.
          // E.g. foo.org/bar.js
          url = removeJsExtension(url);
          // E.g. foo.org/bar
        }

        state = STATE_NEXT_PATH_SEGMENT;

      } else if (state === STATE_NEXT_PATH_SEGMENT) {
        // Chop the next `/segment`.
        const index = url.lastIndexOf(PATH_SEPARATOR);
        if (index < 0) {
          // No (more) segments. No match found.
          // E.g. `foo.org`
          return null;
        }

        // Accumulate the removed path segment (prepending).
        idSuffix = stringSuffixFrom(url, index) + idSuffix;

        // Remove the path segment.
        // a) foo.org/bar
        // b) foo.org/bar/
        // c) http://foo.org
        // d) http:/
        url = stringPrefix(url, index);
        // a) foo.org
        // b) foo.org/bar
        // c) http:/
        // d) http:
      }
    }
  },

  /** @override */
  _createRequire: function() {
    return createRootRequire(this);
  },

  /**
   * Registers a non-detached descendant named node.
   *
   * @param {AbstractNamedNode} namedNode - The named node to register.
   * @internal
   */
  $indexNode: function(namedNode) {
    if (!process.env.SYSTEM_PRODUCTION && this.get(namedNode.id)) {
      throw createError("A node with id '" + namedNode.id + "' is already defined.");
    }

    this.__byId[namedNode.id] = namedNode;
  },

  /**
   * Updates the URL index to account for the change of
   * _regular URL_ of a descendant node.
   *
   * Only called for nodes having (or stopping to have) a {@link AbstractNamedNode#fixedPath}.
   *
   * @param {AbstractNamedNode} childNode - The descendant node.
   * @param {?string} regularUrlNew - The new regular URL value.
   * @param {?string} regularUrlOld - The old regular URL value.
   * @internal
   * @see AbstractNamedNode#url
   */
  $onNodeRegularUrlChanged: function(childNode, regularUrlNew, regularUrlOld) {
    // Don't delete if old regular url is taken by another node.
    if (regularUrlOld && getOwn(this.__byUrl, regularUrlOld) === childNode) {
      delete this.__byUrl[regularUrlOld];
    }

    // Don't add if new regular url is taken by another node.
    if (regularUrlNew && !getOwn(this.__byUrl, regularUrlNew)) {
      this.__byUrl[regularUrlNew] = childNode;
    }
  }
});

function createDefine(rootNode) {

  define.amd = {
    // https://github.com/amdjs/amdjs-api/wiki/jQuery-and-AMD
    jQuery: true
  };

  return define;

  /**
   * - define("id", {})
   * - define("id", function(require, exports, module) {})
   * - define("id", [], function() {})
   * - define({})
   * - define(function(require, exports, module) {})
   * - define([], function() {})
   */
  function define(id, deps, execute) {

    if (!isString(id)) {
      // Anonymous define. Shift arguments right.
      execute = deps;
      deps = id;
      id = null;
    }

    if (isFunction(deps)) {
      execute = deps;
      deps = REQUIRE_EXPORTS_MODULE;

    } else if (!isArray(deps)) {
      // deps is an object or some other value.
      execute = constantFun(deps);
      deps = [];

    } // else, `deps` is an array and assuming but not checking that `execute` is a fun...

    rootNode.sys.$queueAmd(id, deps, execute);
  }
}

function createRootRequire(rootNode) {

  const baseRequire = createRequire(rootNode);

  return objectCopy(objectCopy(rootRequire, baseRequire), {
    config: function(cfg) {
      return rootRequire(cfg);
    },

    undef: function(id) {

    }
  });

  // Unlike local require functions, accepts a config, object argument.
  function rootRequire(deps, callback, errback, optional) {

    const isSyncInterface = isString(deps);
    if (!isSyncInterface && !isArray(deps)) {

      // require({}, [], function)
      // require({}, [], function, function)
      // require({})
      // require({}, function)
      // require({}, function, function)

      // deps is a config object.
      const cfg = deps;
      if (cfg) {
        rootNode.configure(cfg);
      }

      if (isArray(callback)) {
        // Shift args right.
        deps = callback;

        callback = errback;
        errback = optional;
      } else if (callback) {
        deps = [];
      } else {
        return rootRequire;
      }
    }
    // else
    //   require("")
    //   require([], function)
    //   require([], function, function)

    const result = baseRequire(deps, callback, errback);
    return isSyncInterface ? result : rootRequire;
  }
}

