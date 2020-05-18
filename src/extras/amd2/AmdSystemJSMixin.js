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
  constantFun,
  createError,
  getOwn,
  hasOwn,
  length,
  objectCopy,
  prototype
} from "./util.js";

import {
  JS_EXT,
  RE_AMD_ID_PREFIX,
  createDepSetter,
  isAbsoluteUrl,
  isResourceId,
  parseUrlWithModuleFragment
} from "./common.js";

import SystemJS, { base as baseSystemJS } from "./SystemJS.js";

import { takeDefine } from "./define.js";

import RootNode from "./nodes/RootNode.js";
import AnonymousNode from "./nodes/AnonymousNode.js";

const EMPTY_AMD_REGISTER = constantRegister();

const evalInGlobalScope = eval;

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
     * @see AmdSystemJSMixin#__processRegister
     */
    this.__forcedGetRegister = undefined;
  },

  /** @override */
  resolve: function(specifier, referralUrl) {

    // An identifier which is an AMD dependency?
    // amd:foo/bar ?
    // See AbstractNode#$getDependency.
    const isAmdSpec = RE_AMD_ID_PREFIX.test(specifier);
    if (isAmdSpec) {
      specifier = specifier.replace(RE_AMD_ID_PREFIX, "");
    }

    try {
      // Give precedence to other resolution strategies.
      // Any isAbsoluteUrl(depId) is handled by import maps.
      const originalUrl = baseSystemJS.resolve.call(this, specifier, referralUrl);

      // In the AMD identifier case, there's a need to double check.
      // Otherwise, return immediately.
      if (!isAmdSpec || isAbsoluteUrl(specifier)) {
        return originalUrl;
      }

      // When there is no "package" mapping for the given specifier, "foo/bar",
      // and the mapping key that matched was, for example, "foo/",
      // the resulting URL should end in ".../bar".

      // Yet, if there's no "package" mapping, in AMD, the result of resolving foo/bar.js should be returned instead.
      // To detect if the current result is from a package mapping or not,
      // we add the .js extension and check if the new result is the same plus the js extension.
      try {
        const withJsUrl = baseSystemJS.resolve.call(this, specifier + JS_EXT, referralUrl);
        if (withJsUrl !== originalUrl + JS_EXT) {
          // Assume it was a package mapping initially after all.
          // Package mappings have priority.
          return originalUrl;
        }

        // Import-Maps expect .js extension to be specified with modules identifiers,
        // but being AMD dependency, had to add it.
        return withJsUrl;
      } catch (error2) {
        // Did not have a mapping for foo/bar.js, but had for foo/bar.
        // Assume a package mapping existed after all.
        return originalUrl;
      }
    } catch (error) {
      // No isAbsoluteUrl URLs here!
      if (!process.env.SYSTEM_PRODUCTION && isAbsoluteUrl(specifier)) {
        console.warn("Should not be an Absolute URL.");
        throw createError("Should not be an Absolute URL.");
      }

      // If it was an AMD dependency (and there was no mapping for foo/bar),
      // "foo/bar.js" has to be tested as well.
      if (isAmdSpec) {
        try {
          return baseSystemJS.resolve.call(this, specifier + JS_EXT, referralUrl);
        } catch (error3) {
          // No mapping for JS_EXT as well.
          // Continue to resolve against the Named and AMD registry.
        }
      }

      // The `named-register.js` extra is loaded after,
      // but still, its `resolve` implementation checks the registry only
      // if/after the base implementation throws, so it's necessary to check it here.
      if (hasOwn(this.__nameRegistry, specifier)) {
        return specifier;
      }

      // Check the AMD "registry".
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
    // The `named-register.js` extra is loaded after `amd2.js`.
    // When `loadUrl` is a "name" in the "named" registry,
    // its `instantiate` implementation immediately returns the register.

    // In the odd case that some installed extra did not return an absolute URL from the `resolve` method,
    // this implementation would not know how to handle it.
    if (!isAbsoluteUrl(loadUrl)) {
      return baseSystemJS.instantiate.call(this, loadUrl, referralUrl);
    }

    const sys = this;
    const rootNode = sys.amd;

    // Does `loadUrl` have a module id fragment? OR ELSE
    // Can a canonical identifier be determined for it?
    const urlParts = parseUrlWithModuleFragment(loadUrl) || [loadUrl, this._canonicalIdByUrl(loadUrl), null];

    // Destructure. const [scriptUrl, scriptId, bundledId] = urlParts;
    /**
     * The URL of the script to load, without fragment.
     * @type {string}
     */
    const scriptUrl = urlParts[0];

    /**
     * The module identifier corresponding to `scriptUrl`, if any.
     * Either present as a URL fragment annotation or the canonical identifier obtained from `_canonicalIdByUrl`.
     * @type {?string}
     */
    const scriptId = urlParts[1];

    /**
     * Determined lazily, if needed.
     * See `getScriptNode`, below.
     * @type {?RegularNode}
     */
    let scriptNode = null;

    /**
     * The identifier of a module which is bundled in `loadUrl`.
     * Has to be given as a URL fragment annotation.
     * Only defined when `scriptId` is as well.
     * @type {?string}
     */
    const bundledId = urlParts[2];

    /**
     * The identifier which was used to call `System.import(importId)`
     * (or a canonical identifier that could have been used to), if any.
     * When an "unmapped" URL was passed to `import(.)`, then this will be `null`.
     *
     * This is used to get any AMD configurations.
     * @type {?string}
     */
    const importId = bundledId || scriptId;
    if (importId) {
      // assert scriptId

      // Resources are handled specially.
      if (isResourceId(importId)) {
        const importNode = rootNode.$getOrCreate(importId);

        // Ensure the plugin is loaded first. Continue by actually loading the resource.
        return this.import(importNode.plugin.id)
          .then(this.__instantiateResource.bind(this, importNode, referralUrl));
      }

      // Is there an AMD shim configured for the script node and
      // does it have dependencies?
      // If so load these first.
      // Note that shims of bundled modules are ignored; these are handled by the bundler.
      if (getScriptNode(false)) {
        const scriptShim = scriptNode.shim;
        if (scriptShim && scriptShim.deps) {
          return scriptNode.requireManyAsync(scriptShim.deps).then(instantiateRegular);
        }
      }
    }

    return instantiateRegular();

    function instantiateRegular() {
      return Promise.resolve(baseSystemJS.instantiate.call(sys, loadUrl, referralUrl))
        .then(instantiateRegularEnd);
    }

    function instantiateRegularEnd(baseRegister) {

      // Intake any queued AMD definitions.
      // Returns an AMD register matched with the script node, if any.
      // null -> Named AMD modules only.
      // undefined -> no AMD modules.
      const scriptRegisterAmd = sys.__intakeAmds(getScriptNode);

      const isAmdScript = scriptRegisterAmd !== undefined;
      if (!isAmdScript) {
        return baseRegister;
      }

      if (!bundledId || !scriptId) {
        // importId === scriptId
        // When nully, SystemJS ends up throwing, as expected.
        return scriptRegisterAmd;
      }

      // Bundling case
      // scriptId != null
      // bundledId != null
      // importId === bundledId

      if (scriptRegisterAmd) {
        // The method `__intakeAmds` does not register `scriptRegisterAmd` in the named register,
        // assuming that it is the returned register.
        // In this case, however, it is the imported module, if any, that is returned.
        sys.__nameRegistry[scriptNode.url] = scriptRegisterAmd;
      }

      // Has a module with id importId been defined with AMD?
      // It should have, otherwise, SystemJS ends up throwing, as expected.
      if (importId) {
        const importNode = rootNode.get(importId);
        if (importNode) {
          return getOwn(sys.__nameRegistry, importNode.url);
        }
      }

      // return undefined;
    }

    function getScriptNode(createIfMissing) {
      if (!scriptNode) {
        scriptNode = scriptId
          ? rootNode.get(scriptId, createIfMissing) // A SimpleNode
          : (createIfMissing ? new AnonymousNode(scriptUrl, rootNode) : null);
      }

      return scriptNode;
    }
  },

  __instantiateResource: function(resourceNode, referralUrl, plugin) {

    if (resourceNode.isNormalized) {
      return this.__instantiateResourceNormalized(resourceNode, referralUrl, plugin);
    }

    // Now that the plugin is loaded, ask-for/load the original (unnormalized) resource again.
    // The resourceNode argument is like an "alias" node for the original one.
    // Convert the resource value to a SystemJS register.
    return this.import(resourceNode.$originalId, referralUrl).then(constantRegister);
  },

  __instantiateResourceNormalized: function(resourceNode, referralUrl, plugin) {

    const sys = this;
    const referralNode = sys.__amdNodeOfUrl(referralUrl);
    const rootNode = resourceNode.root;

    return new Promise(function(resolve, reject) {

      const onLoadCallback = createOnloadCallback(resolve, reject);

      plugin.load(resourceNode.resourceName, referralNode.require, onLoadCallback, rootNode.__pluginsConfig);
    });

    // ---

    function createOnloadCallback(resolve, reject) {

      function onLoadCallback(value) {
        resolve(constantRegister(value));
      }

      onLoadCallback.createError = reject;

      /**
       * Finishes loading by loading the given source code, as if it were from a script module,
       * whose anonymous module, if any, gets associated with the identifier `this.resourceName`.
       *
       * The resource module finishes loading by exporting the same value as that module.
       *
       * The module "inherits" the configuration of the resource node.
       *
       * @param {string} text - The source code.
       * @param {?string} [textAlt] - The alternative argument for source code,
       * provided for backwards compatibility. When specified, takes precedence over the `text` argument.
       */
      onLoadCallback.fromText = function(text, textAlt) {

        if (textAlt) {
          text = textAlt;
        }

        // 1. Copy config from id to resourceName, if any.
        // Generally, it is node guaranteed that this node will have a mapped URL...
        // For RequireJS/AMD this isn't a problem, but for this implementation,
        // it is assumed that every named node has a URL to be placed in the named registry.
        // This also seems to be a problem for ad hoc, virtually defined AMD modules no?
        const directResourceNode = rootNode.$getOrCreate(resourceNode.resourceName);
        if (resourceNode.config) {
          directResourceNode.config = resourceNode.config;
        }

        try {
          // 2. May call the global `define` one or more times.
          sys.evaluate(text);

          // 3. Intake defines into this hierarchy, and
          // 4. Register the script register in the named registry.
          // The method `__intakeAmds` does not register `scriptRegisterAmd` in the named register,
          // assuming that it is the "returned" register.
          // However, it is the register of resourceNode which is "returned".

          const register = sys.__intakeAmds(constantFun(directResourceNode)) || EMPTY_AMD_REGISTER;

          // Note, directResourceNode.url gets defined only within the above __intakeAmds call.
          const url = directResourceNode.url;

          sys.__nameRegistry[url] = register;

          // 5. Call onLoadCallback with the value of resourceName.
          sys.import(directResourceNode.id, referralUrl).then(onLoadCallback);
        } catch (ex) {
          reject(ex);
        }
      };

      return onLoadCallback;
    }
  },

  /**
   * Intakes any queued AMD definitions
   * by creating and registering corresponding SystemJS registers.
   *
   * The first found anonymous AMD `define` call gets the URL and,
   * if defined, the identity, of the script module being loaded.
   *
   * @param {function(boolean) : ?RegularNode} getScriptNode - A function that obtains the script node being loaded, if any.
   * @return {Array|null|undefined} The script register, if an anonymous or AMD module was found,
   *  or one with the identifier of `scriptNode`, was found,
   *  or a shim AMD definition was configured;
   *  `null`, if named AMD modules were found (but no anonymous one);
   *  `undefined`, if no AMD modules were found (named or anonymous).
   * @private
   */
  __intakeAmds: function(getScriptNode) {

    let scriptRegister = null;
    let hasAmd = false;

    /** @type {AmdInfo} */
    let amdInfo;
    while ((amdInfo = takeDefine())) {
      hasAmd = true;
      const register = this.__processAmd(amdInfo, getScriptNode(true));
      if (!scriptRegister && register) {
        scriptRegister = register;
      }
    }

    // If no AMD script register was defined, check if there is a configured shim for it.
    // Otherwise, ignore any configured shim.
    if (!scriptRegister) {
      // Is it a shimmed module? If so, automatically provide its definition.
      const scriptNode = getScriptNode(false);
      if (scriptNode && scriptNode.shim) {
        hasAmd = true;
        scriptRegister = this.__processAmd(scriptNode.shim, scriptNode);
        // assert scriptRegister
      }
    }

    return scriptRegister || (hasAmd ? null : undefined);
  },

  /**
   * Returns the last registered SystemJS register, if any; `undefined`, otherwise.
   *
   * Overridden to be able to return a fixed result so that classes overriding this one
   * can modify a new SystemJS register which has been created by means different from those
   * of script-load and worked-load.
   *
   * @return {Array|undefined} A SystemJS register or `undefined`.
   * @override
   *
   * @see AmdSystemJSMixin#__processRegister
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
   * Processes a _new_ SystemJS register.
   *
   * @param {Array} register - A SystemJS register to process.
   * @return {Array} The processed SystemJS register, possibly identical to `register`.
   *
   * @private
   */
  __processRegister: function(register) {
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

    const id = this.canonicalIdByUrl(url);
    if (!id) {
      return new AnonymousNode(url, this.amd);
    }

    return this.amd.$getOrCreateDetached(id);
  },

  /**
   * Processes an AMD (module definition) and registers a SystemJS register under its URL.
   *
   * @param {AmdInfo} amdInfo - An AMD information object.
   * @param {?AbstractChildNode} scriptNode - The node of the script being loaded, if any;
   * `null` if there is no script being loaded, in which case, `amdInfo` must have a defined identifier.
   * @return {Array|undefined} The register, if an anonymous AMD module, or one with the identifier of `scriptNode`, when defined, was found;
   * `undefined`, otherwise.
   * @private
   */
  __processAmd: function(amdInfo, scriptNode) {

    const isNamedDefinition = !!amdInfo.id;

    // The AMD node being _defined_.
    // When the definition is anonymous, assume that it is `scriptNode` which is being defined.
    // - Note that `scriptNode` may or may not have a canonical identifier...
    // When the definition is named, get or create a node for it.
    const definedNode = isNamedDefinition
      ? this.amd.$getOrCreate(this.amd.$normalizeDefined(amdInfo.id))
      : scriptNode;

    if (!process.env.SYSTEM_PRODUCTION) {
      if (!definedNode) {
        throw createError("Anonymous define requires a contextual script node.");
      }

      // Both of the following cases are the result of misconfiguration and are thus not supported:
      // - If the node has no defined bundle, `scriptNode` could be it.
      // - If the node has no defined fixedPath, `scriptNode.url` could be it.
      if (isNamedDefinition && scriptNode && definedNode !== scriptNode && definedNode.bundle !== scriptNode) {
        throw createError("AMD named define for a module without a configured path or bundle.");
      }
    }

    let url = definedNode.url;
    if (!url) {
      // Assign a virtual module URL: `import:id`;
      definedNode.fixedPath = "import:" + definedNode.id;
      url = definedNode.url;
    }

    // TODO: Valid way to test if a module has already been defined?
    // Through the API, Node#require can ask for "module" dependency even if the module has not been loaded...
    if (definedNode.amdModule) {
      console.warn("Module '" + (definedNode.id || url) + "' is already defined. Ignoring.");
      return;
    }

    // Create the register.
    // Let any other extras _transform_ it by making it go through `getRegister`.
    const register = this.__processRegister(createAmdRegister(definedNode, amdInfo));

    // Was it anonymous or a named script with the same id as the script being loaded?
    const isScriptRegister = !!scriptNode && (!isNamedDefinition || definedNode.id === scriptNode.id);
    if (isScriptRegister) {
      // Assume to be the return value of `instantiate` and don't register in the named registry.
      return register;
    }

    // Register it in the named register.
    // No other way to register multiple modules by URL loaded by a single URL.
    this.__nameRegistry[url] = register;
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
            function (fn) { fn(); },

  evaluate: function(text) {
    return evalInGlobalScope(text);
  }
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
