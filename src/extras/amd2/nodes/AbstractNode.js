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
  O,
  objectCopy,
  prototype,
  getOwn,
  createObject,
  createError,
  length,
  stringPrefix,
  stringSuffixFrom,
  constantFun
} from "../util.js";

import {
  assertSpecifier,
  SPEC_SIMPLE,
  createDepSetter,
  resolveUseDefault,
  removeJsExtension,
  parseResourceId,
  buildResourceId,
  isResourceId,
  isUnnormalizedId,
  isAbsoluteUrl,
  absolutizeId,
  PATH_SEPARATOR,
  JS_EXT,
  RE_RESOURCE_ID_UNNORMALIZED,
  RESOURCE_UNNORMALIZED
} from "../common.js";

import SimpleNode from "./SimpleNode.js";

let unnormalizedCounter = 1;

/**
 * A regular node is a (non-abstract) child node which is _not_ a resource node.
 *
 * @typedef {SimpleNode | AnonymousNode} RegularNode
 */

/**
 * @classdesc The `AbstractNode` class describes a node in the AMD identifier namespace.
 *
 * Nodes do not directly represent AMD modules because the `id` of nodes
 * does not contain the `.js` identifier,
 * which is only used when the node is used as a leaf node,
 * for a module which is actually loaded, in which case it's `amdModule` is also created.
 * Otherwise, nodes can equally and simultaneously represent the "folder" module having a certain name.
 *
 * Apart from this important difference, nodes do represent AMD modules.
 *
 * ## Class Hierarchy
 *
 * ```
 * AbstractNode
 *  |  .name:         string? : null
 *  |  .id:           string? : null
 *  |  .children:     Array.<AbstractNamedNode>? = null (attached, named child nodes)
 *  |  .parent:       (SimpleNode | RootNode)?
 *  |  .root:         RootNode
 *  |  .isResource:   boolean : false
 *  |  .isNormalized: boolean : true
 *  |  .require:      function
 *  |  .aliasMap:     object    [.configMap(.), .applyMap()]
 *  |
 *  +- RootNode
 *  |    .name:     = null
 *  |    .id:       = null
 *  |    .parent:   = null
 *  |    .baseUrl:  string : ./ [.configure(.)]
 *  |    .urlArgs:  function    [.configure(.)]
 *  |
 *  +- AbstractChildNode
 *      |  .parent:     != null
 *      |  .isDetached: boolean
 *      |  .url:        string?
 *      |  .getUrl(extension, omitFragment) : string?
 *      |  .amdModule:  object?  <- `define(["module"])` <-- not for resources, unless bundled!!!
 *      |
 *      +- AnonymousNode  (URL-only modules; not "bundleable"; parent is root)
 *      |    .name:       = null
 *      |    .id:         = null
 *      |    .isDetached: = true
 *      |    .parent:     = root
 *      |
 *      +- AbstractNamedNode
 *          | .name:          != null
 *          | .id:            != null
 *          | .isDetached:    varies
 *          | .bundle:        SimpleNode?  [.configBundle(.)]
 *          | ._getUnbundledUrl(extension, omitFragment) : string?
 *          | .config:        object?      [.configConfig(.)]
 *          |
 *          +- SimpleNode
 *          |   .fixedPath: string?         [.path, .configPath(.), .configPackage(.)]
 *          |   .main:      SimpleNode?     [.configPackage(.)]
 *          |   .shim       {deps, factory} [.configShim(.)]
 *          |
 *          +- ResourceNode - <plugin>!<resource-name>
 *               .isResource:   true
 *               .isNormalized: varies
 *               .plugin:       SimpleNode
 *               .resourceName: string?
 * ```
 *
 * @name AbstractNode
 * @class
 *
 * @description Constructs a node.
 * @constructor
 * @param {?Object.<string, string>} aliasMap - The map of aliases to use for this node.
 */
export default function AbstractNode(aliasMap) {

  /**
   * Gets the map of identifiers for when this node is the context node.
   *
   * This map inherits from the corresponding map of the parent node,
   * so that lookups check all ascendant maps in one go.
   *
   * @type {Object.<string, string>}
   * @readonly
   * @protected
   */
  this._aliasMap = aliasMap;

  /**
   * Gets the array of attached child nodes. Lazily created.
   *
   * @type {?Array.<AbstractNamedNode>}
   * @readonly
   * @private
   */
  this.__children = null;

  /**
   * Gets the map of attached child nodes by their name.  Lazily created.
   *
   * @type {Object.<string, AbstractNamedNode>}
   * @readonly
   * @private
   */
  this.__byName = null;

  /**
   * Gets an AMD `require` function which has this node as the context node.
   *
   * Lazily created.
   *
   * @type {function}
   * @readonly
   * @private
   * @see AbstractNode#require
   */
  this.__require = null;
}

objectCopy(prototype(AbstractNode), /** @lends AbstractNode# */{
  /**
   * Gets a value that indicates if this node is a root node.
   *
   * @name isRoot
   * @memberOf AbstractNode#
   * @type {boolean}
   * @readonly
   * @abstract
   */

  /**
   * Gets the root node of this node.
   *
   * The root node returns itself.
   *
   * @name root
   * @memberOf AbstractNode#
   * @type {RootNode}
   * @readonly
   * @abstract
   */

  /**
   * Gets a value that indicates if the identifier of this node is normalized.
   *
   * Plugin call modules may not be normalized.
   *
   * @type {boolean}
   * @readonly
   * @default false
   */
  get isNormalized() {
    return true;
  },

  /**
   * Gets the identifier of this node, if any; `null`, otherwise.
   *
   * @type {?string}
   * @readonly
   */
  get id() {
    return null;
  },

  /**
   * Gets the leaf identifier of this node, if any; `null`, otherwise.
   *
   * The _leaf_ identifier is suitable for identifying a leaf module -
   * one which is loaded and whose main part of the identifier ends with `.js`.
   *
   * E.g. `my/plugin.js!resource`
   * E.g. `my/module.js`
   *
   * @name leafId
   * @memberOf AbstractNode#
   * @type {?string}
   * @readonly
   * @abstract
   */

  /**
   * Gets the parent node of this node, if any; `null`, otherwise.
   *
   * @name parent
   * @memberOf AbstractNode#
   * @type {?AbstractNode}
   * @readonly
   * @abstract
   */

  /**
   * Gets the identifier of this module's parent module, if any; `null`, otherwise.
   *
   * @name parentId
   * @memberOf AbstractNode#
   * @type {?string}
   * @readonly
   * @abstract
   */

  /**
   * Gets the name by which this node is known by its parent node, if any; `null`, otherwise.
   *
   * @type {?string}
   * @readonly
   */
  get name() {
    return null;
  },

  /**
   * Gets the array of attached child nodes, if any; `null` otherwise.
   *
   * @type {?Array.<AbstractNamedNode>}
   * @readonly
   */
  get children() {
    return this.__children;
  },

  /**
   * Gets the child node with the given name, optionally creating it, if missing.
   *
   * @param {string} neutralName - The neutral name of the child node (no `.js` extension).
   * @param {boolean} [createIfMissing=false] - Indicates that a child node with
   * the given name should be created, if one does not exist.
   * @param {boolean} [createDetached=false] - Indicates that missing child nodes
   * should be created detached from their parents.
   * Only applies if `createIfMissing` is `true`.
   *
   * @return {?AbstractNamedNode} The child node, if any; `null` otherwise.
   */
  childByName: function(neutralName, createIfMissing, createDetached) {
    let child = getOwn(this.__byName, neutralName) || null;
    if (!child && createIfMissing) {
      child = new SimpleNode(neutralName, this, createDetached);
    }

    return child;
  },

  $eachChild: function(f, x) {
    const children = this.__children;
    if (children) {
      children.forEach(f, x || this);
    }
  },

  /**
   * Adds the given named child node to the list of children.
   *
   * @param {AbstractNamedNode} child - The child node.
   * @internal
   */
  $addChild: function(child) {

    if (!process.env.SYSTEM_PRODUCTION && (child.parent !== this || this.childByName(child.name))) {
      throw createError("Invalid argument.");
    }

    if (!this.__children) {
      this.__children = [];
      this.__byName = createObject();
    }

    this.__children.push(child);
    this.__byName[child.name] = child;
  },

  /**
   * Gets the descendant node having the given descendant identifier, optionally, creating it, if missing.
   *
   * @param {string} normalizedId - The descendant identifier. Interpreted as if it started with `./`.
   * @param {boolean} [createIfMissing=false] - Indicates that a node with
   * the given relative identifier should be created, if one does not exist.
   * @param {boolean} [createDetached=false] - Indicates that when a node is
   * created it is created detached from its parent.
   * Only applies if `createIfMissing` is `true`.
   *
   * @return {?AbstractNamedNode} The descendant node, if any exists or is created; `null`, otherwise.
   *
   * @overridable
   */
  getDescendant: function(normalizedId, createIfMissing, createDetached) {

    let parent = this;

    const names = removeJsExtension(normalizedId).split(PATH_SEPARATOR);
    const L = length(names);
    let i = -1;
    let node;
    while ((++i < L) && (node = parent.childByName(names[i], createIfMissing, createDetached))) {
      parent = node;
    }

    return node;
  },

  // region normalization

  // Supports AMD plugins.
  // When !process.env.SYSTEM_PRODUCTION and !Lax:
  // - Throws on null id.
  // - Throws on URLs via $normalizeSimple
  //
  // isFull:
  // 1. Removes ".js" from main part of id.
  // 2. Applies map.
  // 3. Applies package main.
  //
  // isLeaf:
  // 1. adds ".js" to head part after normalization
  // NOTE: resource identifiers are always isLeaf
  normalize: function(id, isFull, isLax, isLeaf) {
    if (isLax) {
      if (!id) {
        return null;
      }
    } else if (!process.env.SYSTEM_PRODUCTION) {
      if (!id) {
        throw createError("Invalid empty id.");
      }
    }

    // const [simpledId = id, resourceName] = parseResourceId(id);
    let simpleId = id;
    let resourceName = null;
    let isLeafEf = !!isLeaf;
    const resourceIdParts = parseResourceId(id);
    if (resourceIdParts) {
      simpleId = resourceIdParts[0];
      resourceName = resourceIdParts[1];
      isLeafEf = true;
    }

    simpleId = this.$normalizeSimple(simpleId, isFull, isLax, isLeafEf);

    if (resourceIdParts) {
      return buildResourceId(simpleId, this.__normalizePluginResource(simpleId, resourceName));
    }

    return simpleId;
  },

  // Does not support resources.
  // Does not support URLs.
  // Resolves "./" and "../" relative to this node's identifier.
  // - Throws on going above this node's id.
  // Removes .js extension, if any.
  // Strict / NonLax
  // - Throws on STAR.
  // - Throws on empty.
  // - Throws on containing "!".
  // - Throws on (isAbsoluteUrl) URL.
  //
  // Lax
  // - Returns `null` if empty.
  //
  // Full normalization:
  // - applies maps
  // - resolves package main
  //
  // isLeaf:
  // - in the end, adds .js extension.
  //
  // isLax: allows "*" and the "!" character; for use in resource ids.
  // isLeaf: adds ".js" to head part after normalization
  $normalizeSimple: function(simpleId, isFull, isLax, isLeaf) {

    if (isLax) {
      if (!simpleId) {
        return null;
      }
    } else if (!process.env.SYSTEM_PRODUCTION) {
      assertSpecifier(simpleId, SPEC_SIMPLE);
    }

    let normalizedId = absolutizeId(removeJsExtension(simpleId), this.parentId);

    if (isFull) {

      // Mapping.
      normalizedId = this.applyMap(normalizedId);

      // For now, assuming map cannot return a resource identifier.
      if (!process.env.SYSTEM_PRODUCTION) {
        assertSpecifier(normalizedId, SPEC_SIMPLE);
      }

      // Main.
      const node = this.root.get(normalizedId);
      if (node) {
        normalizedId = (node.main || node).id;
      }
    }

    if (isLeaf) {
      normalizedId += JS_EXT;
    }

    return normalizedId;
  },

  // require(["idOrAbsURL", ...]
  normalizeDep: function(depId) {
    return isAbsoluteUrl(depId) ? depId : this.normalize(depId, true, false, true);
  },

  // define(id, ...
  $normalizeDefined: function(definedId) {
    // Ensure normalized (assumes normalize is idempotent...)
    return this.normalize(definedId, true, false, true);
  },

  __normalizePluginResource: function(normalizedPluginId, resourceName) {

    // If the plugin is loaded, use it to normalize resourceName.
    const plugin = this.root.$getOrCreate(normalizedPluginId).registeredExports;
    if (!plugin) {
      // TODO: When/If `SystemJS#resolve` becomes async, consider loading the plugin to avoid the `__unnormalized` workaround.
      // This probably causes several other methods to have to return Promises (e.g. createAmdRegister).

      // Already marked unnormalized?
      if (isUnnormalizedId(resourceName)) {
        return resourceName;
      }

      // Mark unnormalized and fix later.
      return resourceName + RESOURCE_UNNORMALIZED + (unnormalizedCounter++);
    }

    return this.__normalizePluginLoadedResource(plugin, resourceName);
  },

  __normalizePluginLoadedResource: function(plugin, resourceName) {

    // Remove the unnormalized marker, if one exists.
    const $originalResourceName = resourceName.replace(RE_RESOURCE_ID_UNNORMALIZED, "");

    if (plugin.normalize) {
      return plugin.normalize($originalResourceName, this.__normalizeResource.bind(this));
    }

    // Per RequireJS, nested plugin calls would not normalize correctly...
    if (isResourceId($originalResourceName)) {
      return $originalResourceName;
    }

    return this.__normalizeResource($originalResourceName);
  },

  // Default normalization used when loader plugin does not have a normalize method.
  __normalizeResource: function(resourceName) {
    return this.$normalizeSimple(resourceName, true, true, false);
  },

  /**
   * Applies mapping configurations to a given normalized identifier and
   * returns the mapped identifier.
   *
   * When no mapping configurations apply to the given identifier, it is returned.
   *
   * @param {string} normalizedId - A normalized identifier.
   * @return {string} The mapped identifier, possibly identical to `normalizedId`.
   */
  applyMap: function(normalizedId) {

    // For each prefix of normalizedId
    //   0. "a/b/c.js"
    //   1. "a/b/c"
    //   2. "a/b"
    //   3. "a"
    //   For each contextNode in this ... root (*)
    //     - has configured path for prefix ?

    let prefixId = normalizedId;
    let prefixIndex = -1;
    while (true) {
      const resolvedPrefixId = this._aliasMap[prefixId];
      if (resolvedPrefixId) {
        // Was mapped.
        return prefixIndex < 0
          // Matched wholly, upon first iteration.
          ? resolvedPrefixId
          // Join the resolved prefix with the remainder in normalizedId.
          : (resolvedPrefixId + stringSuffixFrom(normalizedId, prefixIndex));
      }

      // Get next greatest prefix.
      prefixIndex = prefixId.lastIndexOf(PATH_SEPARATOR);
      if (prefixIndex < 0) {
        // Last segment.
        // No match occurred for any of the prefixes,
        // so just return the original normalizedId.
        return normalizedId;
      }

      prefixId = stringPrefix(prefixId, prefixIndex);
    }
  },
  // endregion

  configMap: function(mapSpec) {

    O.keys(mapSpec).forEach(function(aliasId) {
      this._aliasMap[assertSpecifier(aliasId, SPEC_SIMPLE)] = assertSpecifier(mapSpec[aliasId], SPEC_SIMPLE);
    }, this);
  },

  /**
   * Gets this node's AMD contextual `require` function.
   * @type {function}
   * @readonly
   * @see AbstractNode#_createRequire
   */
  get require() {
    return this.__require || (this.__require = this._createRequire());
  },

  /**
   * Creates an AMD `require` function which has this node as the context node.
   * @name _createRequire
   * @memberOf AbstractNode#
   * @return {function} A AMD `require` function.
   * @protected
   * @abstract
   */

  /**
   * @public
   */
  requireManyAsync: function(depSpecifiers) {
    // For dependencies which are _not_ AMD special dependencies.
    const waitPromises = [];
    const L = length(depSpecifiers);
    const depValues = new Array(L);
    const systemJS = this.root.sys;
    for (let i = 0; i < L; i++) {
      this.$getDependency(depSpecifiers[i], function(normalizedSpecifier, value, hasDep) {
        if (hasDep) {
          depValues[i] = value;
        } else {
          const waitPromise = systemJS.import(normalizedSpecifier)
            .then(createDepSetter(depValues, i));

          waitPromises.push(waitPromise);
        }
      });
    }

    return Promise.all(waitPromises).then(constantFun(depValues));
  },

  requireOne: function(depSpecifier) {

    const systemJS = this.root.sys;

    return this.$getDependency(depSpecifier, function(normalizedSpecifier, value, hasDep) {
      if (hasDep) {
        return value;
      }

      const depUrl = systemJS.resolve(normalizedSpecifier);
      if (systemJS.has(depUrl)) {
        return resolveUseDefault(systemJS.get(depUrl));
      }

      throw createError("Dependency '" + normalizedSpecifier + "' isn't loaded yet.");
    });
  },

  $getDependency: function(depRef, callback) {
    if (depRef === "require") {
      return callback(depRef, this.require, true);
    }

    if (depRef === "module") {
      return callback(depRef, this.__getOrCreateAmdModule(), true);
    }

    if (depRef === "exports") {
      return callback(depRef, this.__getOrCreateAmdModule().exports, true);
    }

    return callback(this.normalizeDep(depRef), undefined, false);
  }
});
