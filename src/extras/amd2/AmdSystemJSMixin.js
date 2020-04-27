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

import {
  prototype,
  createError,
  getOwn,
  hasOwn,
  objectCopy,
  constantFun,
  length
} from "./util.js";

import {
  createDepSetter,
  isAbsoluteUrl,
  parseUrlWithModuleFragment
} from "./common.js";

import SystemJS, { base as baseSystemJS } from "./SystemJS.js";

import RootNode from "./nodes/RootNode.js";
import ResourceNode from "./nodes/ResourceNode.js";
import AnonymousNode from "./nodes/AnonymousNode.js";

/**
 * The information of an AMD `define` call.
 *
 * @typedef {({id: ?string, deps: ?Array.<string>, execute: function})} AmdInfo
 */

/**
 * Queue of AMD definitions added during the load of a script file
 * and which are pending processing.
 *
 * @type {Array.<AmdInfo>}
 * @readonly
 */
const __amdQueue = [];

const EMPTY_AMD_REGISTER = constantRegister();

/**
 * The `AmdSystemJSMixin` mixin class adds support for AMD modules to SystemJS.
 *
 * To that end, the following methods are overridden:
 * [_init]{@link AmdSystemJSMixin#_init},
 * [resolve]{@link AmdSystemJSMixin#resolve},
 * [instantiate]{@link AmdSystemJSMixin#instantiate} and
 * [getRegister]{@link AmdSystemJSMixin#getRegister}.
 *
 * The property [amd]{@link AmdSystemJSMixin#amd}
 * gives access to a hierarchical object model of modules,
 * each represented by a node in the hierarchy,
 * reflecting the current AMD configuration.
 *
 * For certain one-off operations, registering new nodes in the hierarchy
 * would be costly (memory leak or waste).
 * For these cases, missing nodes can be obtained _detached_ from the hierarchy.
 *
 * @name AmdSystemJSMixin
 * @class
 * @mixin
 */

objectCopy(prototype(SystemJS), /** @lends AmdSystemJSMixin# */{

  /** @override */
  _init: function() {

    baseSystemJS._init.call(this);

    this.$initAmd();
  },

  /**
   * Initializes the AMD aspects of this instance.
   *
   * @internal
   */
  $initAmd: function() {
    /**
     * Gets the root node of the AMD module's namespace.
     *
     * @memberOf AmdSystemJSMixin#
     * @type {RootNode}
     * @readonly
     */
    this.amd = new RootNode(this);

    /**
     * When not `undefined`, the {@link AmdSystemJSMixin#getRegister} method returns this value.
     *
     * @memberOf AmdSystemJSMixin#
     * @type {Array|undefined}
     * @private
     *
     * @see AmdSystemJSMixin#getRegister
     * @see AmdSystemJSMixin#_processRegister
     */
    this.__forcedGetRegister = undefined;
  },

  // Declared as a method to allow for unit testing.
  /**
   * Logs a given warning text.
   *
   * @param {string} text - The text to log.
   * @internal
   */
  $warn: function(text) {
    console.warn(text);
  },

  /** @override */
  resolve: function(specifier, referralUrl) {
    try {
      // Give precedence to other resolution strategies.
      // Any isAbsoluteUrl(depId) is handled by import maps.
      return baseSystemJS.resolve.apply(this, arguments);

    } catch (error) {
      // No isAbsoluteUrl URLs here!
      if (!process.env.SYSTEM_PRODUCTION && isAbsoluteUrl(specifier)) {
        throw error;
      }

      // named-registry.js extra is loaded after,
      // but still, its `resolve` implementation checks the registry only
      // after the base implementation, so it's necessary to check it here.
      if (hasOwn(this.__nameRegistry, specifier)) {
        return specifier;
      }

      const referralNode = this.__amdNodeOfUrl(referralUrl);
      const normalizedId = referralNode.normalizeDep(specifier);

      // Throw if normalizedId has no assigned URL (i.e. does not have a defined path or bundle).
      const node = this.amd.$getOrCreateDetached(normalizedId);
      const url = node.url;
      if (!url) {
        throw error;
      }

      return url;
    }
  },

  // NOTE: Ideally, this operation would be part of SystemJS and would be overridden by both the Import Maps and this extra.
  /**
   * Gets the canonical identifier of a given URL, if one exists; `null`, otherwise.
   *
   * This operation is the _possible_ inverse of the {@link SystemJS#resolve} operation.
   *
   * ## Canonical Identifier
   *
   * Given all of the identifiers which _globally_ map to a given URL,
   * the canonical identifier is chosen according to the following precedence order rules:
   *
   * 1. has the smallest number of segments -- an id closer to the root is a more direct one;
   * 2. has the greatest number of prefix segments -- an id with more "predefined" segments is more tailored;
   * 3. is before in ascending order of segment names -- lastly, for predictability.
   *
   * ## URL canonical identifier annotation fragment
   *
   * If a URL contains a fragment with the form `#!mid=<id>`,
   * it is trusted that `<id>` is its canonical identifier.
   *
   * For example,
   * the canonical identifier of the URL
   * `http://my-company.com/scripts/utils.js#!mid=@my-company/core/utils`
   * is `@my-company/core/utils`.
   *
   * ## Import Maps
   *
   * When defined via the import map,
   * the canonical identifier is based on a bare name defined in the global scope.
   *
   * ## AMD
   *
   * When defined via the AMD configuration,
   * the canonical identifier is based on a bare name which either:
   * a) has as associated path (via `paths`), or
   * b) has an associated bundle which has an associated path (via `bundles` and `paths`).
   *
   * To be able to determine the canonical identifier of a bundled module,
   * the given URL must contain the special fragment canonical identifier annotation.
   *
   * For example, the canonical identifier of the URL
   * `http://my-company.com/scripts/bundle.js#!mid=bundled/module/id`
   * is `bundled/module/id`.
   *
   * ## Example
   *
   * Take the following hypothetical global-scope imports/paths configurations:
   *
   * ```json
   * {
   *   "a/b":   "./foo/bar",
   *   "a/c":   "./foo/bar",
   *   "c/d/e": "./foo",
   *   "f":     "./foo",
   *   "g":     "./foo/bar"
   * }
   * ```
   *
   * Additionally, given the URL `./foo/bar/duu.js`,
   * any of the following identifiers, sorted according to precedence order,
   * resolves to it:
   *
   * 1. `"g/duu"`         (2 segments)
   * 2. `"a/b/duu"`       (3 segments; 2 prefix segments; b < c)
   * 3. `"a/c/duu"`       (3 segments; 2 prefix segments)
   * 4. `"f/bar/duu"`     (3 segments; 1 prefix segment)
   * 5. `"c/d/e/bar/duu"` (5 segments; 3 prefix segments)
   *
   * The canonical identifier would be `g/duu`.
   */
  canonicalIdByUrl: function(url) {
    // If the fragment #!mid=<id> is there, just trust it and return the module identifier.
    // - Prefer bundledId, if present, otherwise, return the scriptId.
    // Else, go through the actual inverse algorithms.
    const urlAndIdAndBundledId = parseUrlWithModuleFragment(url);
    return urlAndIdAndBundledId
      ? (urlAndIdAndBundledId[2] || urlAndIdAndBundledId[1])
      : this._canonicalIdByUrl(url);
  },

  _canonicalIdByUrl: function(url) {

    // 1. SystemJS - Import Maps

    // 2. SystemJS - AMD
    return this.amd.canonicalIdByUrl(url);
  },

  /** @override */
  instantiate: function(loadUrl, referralUrl) {
    // named-registry.js extra is loaded after require.js.
    // If `loadUrl` were a name in the name registry, the code would not reach here.
    // If it were not a name in the name registry, resolve would have thrown.
    // All specifiers resolved via AMD or ImportMap are URLs.
    // => `loadUrl` must be an URL.
    if (!process.env.SYSTEM_PRODUCTION && !isAbsoluteUrl(loadUrl)) {
      throw createError("Invalid program.");
    }

    // Is there a canonical identifier for it?
    // This captures any #!mid=<import/canonical/id> in the URL fragment.
    // Recovers the _originally imported module_ in the case of loadUrl being a bundle's URL.

    // const [scriptUrl, scriptId, bundledId] = ...
    const urlParts = parseUrlWithModuleFragment(loadUrl) || [loadUrl, this._canonicalIdByUrl(loadUrl), null];
    const scriptUrl = urlParts[0];
    const scriptId = urlParts[1];
    const bundledId = urlParts[2];
    const isBundled = !!bundledId;

    const importId = isBundled ? bundledId : scriptId;

    let namedImportNode = importId && this.amd.$getOrCreate(importId);

    let scriptNode = null;
    let scriptShim = null;
    let getScriptNode = null;

    if (namedImportNode) {
      if (namedImportNode instanceof ResourceNode) {
        // Load the plugin first.
        return this.import(namedImportNode.plugin.id)
          .then(this.__instantiateResource.bind(this, namedImportNode, referralUrl));
      }
      // -> It's a SimpleNode

      // Check if the _script module_ has a configured shim.
      // If so, load its dependencies, beforehand.
      // The shims of bundled modules are ignored; these must be handled by the bundler.
      scriptNode = isBundled ? this.amd.$getOrCreate(scriptId) : namedImportNode;
      scriptShim = scriptNode.shim;
      getScriptNode = constantFun(scriptNode);

      if (scriptShim && scriptShim.deps) {
        return scriptNode.requireManyAsync(scriptShim.deps)
          .then(instantiateRegular.bind(this));
      }
      // -> Not shimmed.
      // -> scriptNode !== null
    }

    // Lazy getScriptNode, if really needed.
    // If scriptNode is a named node, then it has already been determined, above.
    // It only remains being an Anonymous node.
    if (!getScriptNode) {
      getScriptNode = function() {
        return scriptNode || (scriptNode = new AnonymousNode(scriptUrl, this.amd));
      }.bind(this);
    }

    return instantiateRegular.call(this);

    function instantiateRegular() {
      return Promise.resolve(baseSystemJS.instantiate.call(this, loadUrl, referralUrl))
        .then(this.__instantiateRegularEnd.bind(this, namedImportNode, getScriptNode, scriptShim));
    }
  },

  /**
   * Returns the last registered SystemJS register, if any; `undefined`, otherwise.
   *
   * Overridden to be able to return a fixed result so that classes overridding this one
   * can modify a new SystemJS register which has been created by means different from those
   * of script-load and worked-load.
   *
   * @return {Array|undefined} A SystemJS register or `undefined`.
   * @override
   *
   * @see AmdSystemJSMixin#_processRegister
   */
  getRegister: function() {

    const result = this.__forcedGetRegister;
    if (result !== undefined) {
      this.__forcedGetRegister = undefined;
      return result;
    }

    return baseSystemJS.getRegister.call(this);
  },

  /**
   * Handles the end phase of instantiation.
   *
   * Processes any queued AMD `define` calls
   * by creating and registering corresponding SystemJS registers.
   *
   * The first found anonymous AMD `define` call gets the URL and,
   * if defined, the identity, of the script module being loaded.
   *
   * If the module being instantiated was imported by _bare name_,
   * or if a canonical name exists for the imported URL,
   * as is represented by the given `namedImportNode` argument,
   * this module's SystemJS register is read from the named registry and returned.
   * If it is missing, an empty SystemJS register is returned for it.
   *
   * Otherwise, if `namedImportNode` is `null`,
   * the SystemJS register given in argument `baseRegister` is returned.
   *
   * It is expected that a script file contains either AMD _or_ SystemJS definitions, but not both.
   *
   * @param {?SimpleNode} namedImportNode - The simple node representing a named import; `null`, if there isn't one.
   * @param {function() : RegularNode} getScriptNode - A function which obtains the script node being loaded.
   * the base implementation, {@link SystemJS#instantiate}. Assuming it is defined.
   * @param {AmdInfo} scriptShim - The shim AMD information of the script module.
   * @param {Array} baseRegister - The SystemJS register returned by the base implementation of `instantiate`.
   *
   * @return {Array} A SystemJS register.
   * @private
   */
  __instantiateRegularEnd: function(namedImportNode, getScriptNode, scriptShim, baseRegister) {

    // 0|1 <=> false|true
    let foundScriptModule = 0;

    if (length(__amdQueue) > 0) {
      const scriptNode = getScriptNode();
      let amdInfo;
      while((amdInfo = __amdQueue.shift()) !== undefined) {
        foundScriptModule |= this.__processAmd(scriptNode, amdInfo);
      }
    }

    // ---

    // Is it a shimmed module? If so, automatically provide a definition for it.
    if (!foundScriptModule && scriptShim) {
      this.__processAmd(getScriptNode(), scriptShim);
    }

    // ---

    if (namedImportNode) {
      return getOwn(this.__nameRegistry, namedImportNode.url) || EMPTY_AMD_REGISTER;
    }

    return baseRegister;
  },

  __instantiateResource: function(resourceNode, referralUrl, plugin) {

    // Resource already normalized.
    const resourceValuePromise = resourceNode.isNormalized

      // Load the normalized resource.
      ? resourceNode.loadWithPlugin(plugin, this.__amdNodeOfUrl(referralUrl))

      // Now that the plugin is loaded, ask for the original resource again.
      // The resourceNode argument represents an "alias" node for the original node.
      : this.import(resourceNode.$originalId, referralUrl);

    // Convert the resource value to a SystemJS register.
    return resourceValuePromise.then(constantRegister);
  },

  // NOTE: Ideally, this operation would be part of SystemJS and would be overridden by extras.
  /**
   * Processes a _new_ SystemJS register.
   *
   * Subclasses may process the new register by either overriding
   * the {@link AmdSystemJSMixin#getRegister} method or this method, directly.
   *
   * @param {Array} register - A SystemJS register to process.
   * @return {Array} The processed SystemJS register, possibly identical to `register`.
   *
   * @protected
   */
  _processRegister: function(register) {
    this.__forcedGetRegister = register;
    try {
      return this.getRegister() || register;
    } finally {
      // J.I.C. this class' implementation of getRegister isn't called.
      this.__forcedGetRegister = undefined;
    }
  },

  // -> AbstractChildNode
  __amdNodeOfUrl: function(url) {
    if (!url) {
      return this.amd;
    }

    let id = this.canonicalIdByUrl(url);
    if (!id) {
      return new AnonymousNode(url, this.amd);
    }

    return this.amd.$getOrCreateDetached(id);
  },

  /**
   * Queues an AMD (module definition).
   *
   * @param {?string} id - The AMD identifier of the AMD (definition).
   * @param {Array.<string>} deps - An array of AMD references of the dependencies of the AMD (definition), possibly empty.
   * @param {function} execute - The AMD factory function.
   * @internal
   */
  $queueAmd: function(id, deps, execute) {
    __amdQueue.push({id: id, deps: deps, execute: execute});
  },

  /**
   * Processes an AMD (module definition) and registers a SystemJS register under its URL.
   *
   * @param {AbstractChildNode} scriptNode - The node of the script being loaded.
   * @param {AmdInfo} amdInfo - An AMD information object.
   * @return {boolean} `true` if an AMD module with the given identifier or that of `loadNode` was found.
   * @private
   */
  __processAmd: function(scriptNode, amdInfo) {

    const isNamedDefinition = !!amdInfo.id;

    // The AMD node being _defined_.
    // When the definition is anonymous, assume that it is `scriptNode` which is being defined.
    // - Note that `scriptNode` may or may not have a canonical identifier...
    // When the definition is named, get or create a node for it.
    const definedNode = isNamedDefinition
      ? this.amd.$getOrCreate(this.amd.$normalizeDefined(amdInfo.id))
      : scriptNode;

    const url = definedNode.url;

    if (!process.env.SYSTEM_PRODUCTION) {
      // Both of the following cases are the result of misconfiguration and are thus not supported:
      // - If the node has no defined bundle, `scriptNode` could be it.
      // - If the node has no defined fixedPath, `scriptNode.url` could be it.
      if (isNamedDefinition && definedNode !== scriptNode && definedNode.bundle !== scriptNode) {
        throw createError("AMD named define for a module without a configured path or bundle.");
      }

      if (url === null) {
        throw createError("Invalid state");
      }
    }

    // TODO: Valid way to test if a module has already been defined?
    // Through the API, node.require can ask for module even if the module has not been loaded.
    if (definedNode.amdModule) {
      this.$warn("Module '" + (definedNode.id || url) + "' is already defined. Ignoring.");
      return false;
    }

    // Create the register.
    // Let any other extras _transform_ it by making it go through `getRegister`.
    // Save it in the named register. No other way to register multiple modules by URL loaded by a single URL...
    this.__nameRegistry[url] = this._processRegister(createAmdRegister(definedNode, amdInfo));

    // Was it anonymous or the named, loaded script?
    return !isNamedDefinition || (definedNode.id === scriptNode.id);
  },

  get __nameRegistry() {
    const register = this.registerRegistry;
    // Must include extras/named-register.js.
    if (!register) {
      throw createError("The named-register.js extra for SystemJS is required.");
    }

    return register;
  },

  nextTick: typeof setTimeout !== "undefined" ? function (fn) { setTimeout(fn, 4); } :
            typeof process !== "undefined" ? process.nextTick :
            function (fn) { fn(); }
});

function constantRegister(value) {
  return [[], function(_export) {
    _export({ default: value, __useDefault: true });
    return {};
  }];
}

/**
 * Creates a SystemJS register for a given AMD definition.
 *
 * @param {AbstractChildNode} node - The AMD child node of the module being defined.
 * @param {AmdInfo} amdInfo - An AMD information object.
 * @return {Array} A SystemJS register.
 * @private
 */
function createAmdRegister(node, amdInfo) {

  // Dependencies which are _not_ AMD special dependencies.
  const registerDepIds = [];
  const registerDepSetters = [];

  // Process dependencies.
  const depSpecifiers = amdInfo.deps;
  const L = depSpecifiers ? length(depSpecifiers) : 0;
  const depValues = new Array(L);

  // Handle special AMD dependencies.
  // Add setters for other dependencies.
  let i = -1;
  while(++i < L) {
    node.$getDependency(depSpecifiers[i], function(depSpecifier, value, hasDep) {
      if (hasDep) {
        depValues[i] = value;
      } else {
        registerDepIds.push(depSpecifier);
        registerDepSetters.push(createDepSetter(depValues, i));
      }
    });
  }

  return [registerDepIds, declareAmd];

  function declareAmd(_export, _context) {

    _export({ default: undefined, __useDefault: true });

    return {
      setters: registerDepSetters,
      execute: function() {
        let exports;
        try {
          exports = amdInfo.execute.apply(undefined, depValues);
        } finally {
          node.$setLoaded();
        }

        // <-> module.exports
        const module = node.amdModule;
        if (module) {
          if (exports !== undefined) {
            module.exports = exports;
          } else if (module.$hasExports) {
            exports = module.exports;
          }
        }

        if (exports !== undefined) {
          _export("default", exports);
        }
      }
    };
  }
}
