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

(function(global) {

  const DEBUG = true;
  const O_HAS_OWN = Object.prototype.hasOwnProperty;
  const REQUIRE_EXPORTS_MODULE = ["require", "exports", "module"];
  const EMTPY_AMD_REGISTER = [[], function(_export) {
    _export({ default: undefined, __useDefault: true });
    return {};
  }];
  const STAR = "*";
  const RE_JS_EXT = /\.js$/i;
  // Absolute or Protocol Relative or Origin Relative
  const RE_URL_ABSOLUTE = /^\/|[\w\+\.\-]+:/i;
  const RE_URL_BLOB = /^blob:/i;
  const RE_URL_DATA_OR_BLOB = /^(data|blob):/i;
  const URL_MODULE_FRAGMENT = "#!mid=";
  const isBrowser = typeof window !== "undefined" && typeof navigator !== "undefined" && !!window.document;

  let unnormalizedCounter = 1;

  // General
  // -------
  // TODO: Check license.
  // TODO: Check cycle detection is properly handled
  // TODO: Check proper error handling
  // TODO: Support for other environments (Rhino?).
  // TODO: "Minify" code / identifiers / structure.
  // TODO: Complete/Review documentation
  //       - Document `require` functions.
  //       - Refactor of documentation__instantiateEnd.
  // TODO: Unit tests...
  //
  // General Features
  // ----
  // TODO: Plugins, _unnormalized ids ***
  // TODO: .JS <> bare interop? *** 
  //       Compose <node.id> with .js?
  // TODO: trimDots -> absolutizeId ***
  // TODO: RequireJS supports mapping regular modules (not initially plugin calls) to plugin calls...
  // TODO: Implement canonicalIdByUrl for Import Maps URLs.
  // TODO: Flag to not overwrite define, require? Keep backup?
  // TODO: Flag to allow top-level modules without a specified path (fallback to `name`)?
  //
  // Config
  // ------
  // TODO: config.shim ***
  // TODO: config.deps, config.callback (using setTimout to let any following extras to be installed)
  // 
  // Require
  // -------
  // TODO: require.toUrl ***
  // TODO: root.require.undef ***
  // TODO: require.defined
  // TODO: require.specified
  //
  // Loader Plugins
  // --------------
  // TODO: config argument ***
  //       what needs to be done to maintain config on pair and will it then
  //       subsume the use of nodes?? Requirejs derives bundleMap and pkgs index properties
  //       from the config.
  // TODO: onload.fromText *** - eval text as if it were a module script being loaded  
  //       assuming its id is resourceId.
  //
  // JS
  // ---
  // TODO: _log
  // TODO: "__proto__" map lookup loophole

  // Not Supported
  //
  // AMD
  // ---
  // https://github.com/amdjs/amdjs-api
  //
  // - Modules with paths/URLs with fragments, as they're used for other purposes.
  // - A dependency ending with ".js" being considered an URL and not a module identifier.
  //   - The top-level require's `jsExtRegExp` property; used to filter out dependencies that are already URLs.
  // - Being able to `map` a regular identifier to a loader plugin call identifier.
  // - Being able to specify `paths` fallbacks; when an array is provided, only the first value is considered.
  //
  // RequireJS
  // ---------
  // https://requirejs.org
  //
  // - CommonJS-style factory: detection of `require(.)` dependencies in factory function code, using `toString`.
  // - require.defined/specified ? Are these worth it?
  // - require.onError, require.createNode, require.load
  // - error.requireModules on error handlers allowing to undef and then retry loading of modules with different config/paths,
  //   allowing functionality equivalent to paths fallbacks
  //   (https://requirejs.org/docs/api.html#errbacks)
  // - config.nodeRequire / all special NodeJS/CommonJS features
  // - Environments such as: PSn, Opera...
  // - Creating new require contexts.
  // - Specifying `data-main` in the `script` element used to load the AMD/RequireJS extra;
  //   the `skipDataMain` configuration property is also not supported.

  // ---

  // SystemJS, as it is before loading this script.

  /**
   * The `SystemJS` class.
   * 
   * @name SystemJS
   * @class
   */
  const SystemJS = global.System.constructor;
  
  // #region AmdSystemJS class

  // A copy of the methods of the SystemJS prototype which will be overridden.
  const base = assignProps({}, SystemJS.prototype, ["resolve", "instantiate", "getRegister"]);

  /**
   * The `AmdSystemJS` class adds support for AMD modules to SystemJS.
   * 
   * To that end, the following methods are overridden:
   * [resolve]{@link AmdSystemJS#resolve}, 
   * [instantiate]{@link AmdSystemJS#resolve} and
   * [getRegister]{@link AmdSystemJS#resolve}.
   * 
   * The property [amd]{@link AmdSystemJS#amd}  
   * gives access to a hierarchical object model of modules, 
   * each represented by a node in the hierarchy, 
   * reflecting the current AMD configuration.
   * 
   * For certain one-off operations, registering new nodes in the hierarchy
   * would be costly (memory leak or waste).
   * For these cases, missing nodes can be obtained _dettached_ from the hierarchy.
   * 
   * @name AmdSystemJS
   * @extends SystemJS
   * @class
   */
  function AmdSystemJS() {

    SystemJS.call(this);
    
    this._initAmd();
  }
  
  classExtendHijack(AmdSystemJS, SystemJS, /** @lends AmdSystemJS# */{

    /**
     * Initializes the AMD aspects of this instance.
     * 
     * @protected
     */
    _initAmd: function() {
      /**
       * Gets the root node of the AMD module's namespace.
       * 
       * @memberof AmdSystemJS#
       * @type {RootModuleNode}
       * @readonly
       */
      this.amd = new RootModuleNode(this);
      
      /**
       * Queue of AMD definitions added during the load of a script file
       * and which are pending processing.
       * 
       * Filled in by calling the {@link AmdSystemJS#__queueAmdDef} method.
       * 
       * @memberof AmdSystemJS#
       * @type {Array.<({id: string?, deps: string[], execute: function})>}
       * @readonly
       * @private
       */
      this.__amdDefQueue = [];

      /**
       * When not `undefined`, the {@link AmdSystemJS#getRegister} method returns this value.
       * 
       * @memberof AmdSystemJS#
       * @type {Array|undefined}
       * @private
       * 
       * @see AmdSystemJS#getRegister
       * @see AmdSystemJS#__processRegister
       */
      this.__forcedGetRegister = undefined;
    },

    /** 
     * Logs a given text.
     * 
     * @param {string} text - The text to log.
     * @param {string} [type="warn"] - The type of the log entry.
     * @protected
     */
    _log: function(text, type) {
      const method = type || "warn";
      console[method](text);
    },

    /** @override */
    resolve: function(depId, parentUrl) {
      try {
        // Give precedence to other resolution strategies.
        // Any isAbsoluteWeakUrl(depId) is handled by import maps.
        // Any name in the name registry is returned.
        return base.resolve.apply(this, arguments);

      } catch (error) {
        // No isAbsoluteWeakUrl URLs here!
        if (DEBUG && isAbsoluteUrlWeak(depId)) {
          throw error;
        }

        const refNode = this.__getOrCreateNodeDetachedByUrl(parentUrl);
        const normalizedId = refNode.normalizeDep(depId);
        
        // Throw if normalizedId has no assigned URL (i.e. does not have a defined path or bundle).
        const node = this.amd.getOrCreateDetached(normalizedId);
        const url = node.url;
        if (url === null) {
          throw error;
        }

        return url;
      }
    },

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
      // ## SystemJS Common.
      // 1. What?
      if (!url) {
        // Returning `null` would not help when overriding,
        // as it means "no URL found" from lower layer.
        throw new Error("Argument 'url' is required.");
      }

      // 2. If the fragment #!mid=<id> is there, just trust it and return the module identifier.
      const moduleFragmentIndex = url.indexOf(URL_MODULE_FRAGMENT);
      if (moduleFragmentIndex >= 0) {
        return url.substr(moduleFragmentIndex + URL_MODULE_FRAGMENT.length);
      }

      // ## SystemJS - Import Maps

      // ## SystemJS - AMD
      return this.amd.canonicalIdByUrl(url);
    },

    /** @override */
    instantiate: function(loadUrl, parentUrl) {
      
      // The AMD node corresponding to the regular URL (not a plugin call) being imported.
      let importNode = null;

      let resolvedId = this.canonicalIdByUrl(loadUrl);
      if (resolvedId !== null) {
        // Already in the named registry?
        const register = this.__getByName(loadUrl);
        if (register !== null) {
          return register;
        }

        // If it's a plugin call, then get the plugin module, first.
        // Then, call its plugin interface with the argument to determine 
        // the composite module (resolvedId).
        const index = resolvedId.indexOf("!");
        const isPluginCall = index !== -1;
        if (isPluginCall) {
          const pluginId = resolvedId.substring(0, index);
          const resourceId = resolvedId.substring(index + 1) || null;
          
          // Attempt going a bit faster by providing the plugin id url directly?
          // const pluginUrl = removeUrlFragment(loadUrl) + URL_MODULE_FRAGMENT + pluginId;

          return this.import(pluginId, parentUrl)
            .then(this.__instantiatePluginCallEnd.bind(this, pluginId, resourceId, parentUrl));
        }

        // Get or create the AMD child node.
        importNode = this.amd.getOrCreate(resolvedId);
        // loadNode = importNode.bundleOrSelf;
        // - module.js#!mid=module/id             - the module itself (even if bundle or plugin)
        // - bundle.js#!mid=bundled/module/id     - a bundled module, within bundle.js
        // - plugin.js#!mid=plugin/id!resource-id - a plugin call module
      }

      return Promise.resolve(base.instantiate.call(this, loadUrl, parentUrl))
        .then(this.__instantiateEnd.bind(this, loadUrl, importNode));
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
     * @see AmdSystemJS#__processRegister
     */
    getRegister: function() {

      const result = this.__forcedGetRegister;
      if (result !== undefined) {
        this.__forcedGetRegister = undefined;
        return result;
      }

      return base.getRegister.call(this);
    },

    /**
     * Processes a _new_ SystemJS register. 
     * 
     * Subclasses may process the new register by either overriding 
     * the {@link AmdSystemJS#getRegister} method or this method, directly.
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

    // -> AbstractChildModuleNode
    __getOrCreateNodeDetachedByUrl: function(url) {
      if (url == null) {
        return this.amd;
      }

      let id = this.canonicalIdByUrl(url);
      if (id === null) {
        return new AnonymousChildModuleNode(url, this.amd);
      }

      return this.amd.getOrCreateDetached(id);
    },
    
    __instantiatePluginCallEnd: function(pluginId, resourceId, parentUrl, plugin) {

      // let id = pluginId + "!" + (resourceId || "");

      let refNode = this.__getOrCreateNodeDetachedByUrl(parentUrl);

      return new Promise(function(resolve, reject) {
        let config = {};

        function onLoadCallback(value) {

          const constantRegister = [[], function(_export) {
            _export({ default: value, __useDefault: true });
            return {};
          }];

          resolve(constantRegister);
        }

        onLoadCallback.error = reject;

        onLoadCallback.fromText = function(text, textAlt) {
          if (textAlt) {
            text = textAlt;
          }

          // eval
          // define is called..
        };

        plugin.load(resourceId, refNode.require, onLoadCallback, config);
      });
    },

    /** 
     * Handles the end phase of instantiation of either a URL or 
     * a _normal_ AMD module (i.e. not a loader plugin module).
     * 
     * Processes any queued AMD `define` calls by creating and registering corresponding SystemJS registers.
     * 
     * If any AMD modules are processed and if an AMD module had been requested, 
     * as represented by the given `importNode` argument, 
     * then this module's SystemJS register is read from the named registry and returned.
     * 
     * Otherwise, if an anonymous AMD module is processed, its SystemJS register is returned.
     * 
     * Otherwise, the SystemJS register in argument `baseRegister` is returned.
     * Lastly, if this is `null`, an empty SystemJS register is returned.
     * 
     * It is expected that a script file contains either AMD or SystemJS definitions.
     * 
     * @param {string} loadUrl - The URL of the file being loaded.
     * @param {ChildModuleNode?} importNode - The AMD child node being imported; `null`, otherwise.
     * @param {Array} baseRegister - The SystemJS register returned by 
     * the base implementation, {@link SystemJS#instantiate}. Assuming it is defined.
     * 
     * @return {Array} A SystemJS register.
     * @private
     */
    __instantiateEnd: function(loadUrl, importNode, baseRegister) {
      // loadNode = importNode.bundleOrSelf.
      // Process any queued AMD definitions.
      // 1. When there is no AMD context, the first found anonymous AMD module is returned by __processAmdDefs, 
      //    and is not registered, yet.
      //    In that case, return it, thus becoming associated with the requested URL, in the core registry.
      // 
      // 2. (importNode !== null) - An AMD module was imported using its identifier?
      //   assert loadNode !== null
      //   If any anonymous AMD was found by __processAmdDefs, 
      //   it has been associated with the bundle module (loadNode) and registered by its id.
      //   In the "normal" module case (not-a-bundle), 
      //   this became associated with the imported module (importNode).
      //   If no module was registered for the imported module (importNode), 
      //   it is either the case of: 
      //   a) a "normal" module which doesn't call define (importNode === loadNode), or
      //   b) a bundle module (loadNode) which doesn't carry the requested module (importNode) after all,
      //      probably due to an incorrect `bundles` configuration.
      //   TODO: For now, assuming both cases are tolerable and assuming this means the module is empty...
      //   Case b) probably should signal an error.
      // 
      // 3. No AMD context, or anonymous AMD modules, 
      //    so just return any register determined by the base implementation.
      return this.__processAmdDefs(loadUrl) ||
        (importNode
          ? (this.__getByName(importNode.url) || EMTPY_AMD_REGISTER)
          : baseRegister);
    },

    /**
     * Queues an AMD (module definition).
     * 
     * @param {string?} id - The AMD identifier of the AMD (definition).
     * @param {Array.<string>} deps - An array of AMD references of the dependencies of the AMD (definition), possibly empty.
     * @param {function} execute - The AMD factory function.
     * @protected
     * @internal
     */
    __queueAmdDef: function(id, deps, execute) {
      this.__amdDefQueue.push({id: id, deps: deps, execute: execute});
    },

    /**
     * Processes all queued AMD (module definitions).
     * 
     * @param {string} loadUrl - The URL of the file being loaded.
     * 
     * @return {Array|undefined} The first found anonymous AMD register, 
     * if any was processed and there is no AMD context for `loadUrl`; `undefined`, otherwise.
     * @private
     */
    __processAmdDefs: function(loadUrl) {
      
      let amdDef;
      let firstAnonymousRegister = undefined;
      
      if (this.__amdDefQueue.length > 0) {
        // There's at least one AMD definition.
        let loadNode = this.__getOrCreateNodeDetachedByUrl(removeUrlFragment(loadUrl));

        while((amdDef = this.__amdDefQueue.shift()) !== undefined) {
          const anonymousRegister = this.__processAmdDef(loadNode, amdDef.id, amdDef.deps, amdDef.execute);
          if (anonymousRegister !== undefined) {
            if (firstAnonymousRegister === undefined) {
              firstAnonymousRegister = anonymousRegister;
            } else {
              // Second, third, ... anonymous module in a script without AMD context (loadNode).
              this._log("More than one anonymous AMD module found in a script. Ignoring.", "warn");
            }
          }
        }
      }

      return firstAnonymousRegister;
    },

    /**
     * Processes an AMD (module definition).
     * 
     * If `id` is `null` and `loadNode.id` is not, 
     * then the identifier is assumed to be that of `loadNode`.
     * Otherwise, if `id` is `null` and `loadNode.id` as well,
     * then the AMD module remains anonymous.
     * 
     * A SystemJS register is created.
     * 
     * For named registers are immediately registered in the named register and `undefined` is returned.
     * For unnamed/anonymous registers, the register is returned.
     * 
     * @param {AbstractChildModuleNode} loadNode - The AMD child node being loaded.
     * @param {string?} id - The AMD identifier of the AMD (definition).
     * @param {Array.<string>} deps - An array of AMD references of the dependencies of the AMD (definition).
     * @param {function} execute - The AMD factory function.
     * 
     * @return {Array|undefined} The created AMD register, if it remains anonymous; `undefined`, otherwise.
     * @private
     */
    __processAmdDef: function(loadNode, id, deps, execute) {
      
      // Capture id from loading AMD module, if any.
      let node;
      if (id !== null) {
        // Ensure normalized (assumes normalize is idempotent...)
        let fullyNormalizedId = this.amd.normalizeDefined(id);

        if (fullyNormalizedId !== null && this.__getByName(fullyNormalizedId) !== null) {
          this._log("Module '" + fullyNormalizedId + "' is already defined. Ignoring.", "warn");
          return undefined;
        }

        node = this.amd.getOrCreate(fullyNormalizedId);

        // J.I.C. be sure to set the bundle.
        if (node !== loadNode) {
          node.bundle = loadNode;
        }
      } else {
        node = loadNode;
      }

      if (DEBUG && node.isRoot) {
        throw new Error("Invalid state.");
      }

      // Need to let `amdRegister` be processed by any subclasses.
      let amdRegister = this._processRegister(createAmdRegister(node, deps, execute));
      const url = node.url;
      if (url !== null) {
        // No other way to register multiple modules by URL loaded by a single URL...
        this.__nameRegistry[url] = amdRegister;
        return undefined;
      }

      // Anonymous and yet unregistered AMD register.
      return amdRegister;
    },

    /**
     * Gets a named register with the given name, if any.
     * 
     * @param {string} name - The name of the register.
     * @return {Array?} The register with the given name, if any; `null`, otherwise.
     * @private
     */
    __getByName: function(name) {
      return getOwn(this.__nameRegistry, name) || null;
    },

    get __nameRegistry() {
      const register = this.registerRegistry;
      // Must include extras/named-register.js.
      if (!register) {
        throw Error("The named-register.js extra for SystemJS is required.");
      }

      return register;
    }
  });
  // #endregion

  // #region AbstractModuleNode Class

  /**
   * @classdesc The `AbstractModuleNode` class describes a module in the AMD identifier namespace.
   * 
   * AMD modules which have no defined bare name, and thus are loaded directly by URL, 
   * do *NOT* have an associated module node.
   * 
   * ## Class Hierarchy
   * 
   * `AbstractModuleNode`
   *   |- `RootModuleNode`
   *   |- `AbstractChildModuleNode`
   *        |- `AnonymousChildModuleNode`
   *        |- `ChildModuleNode`
   * 
   * @name AbstractModuleNode
   * @class
   * 
   * @description Constructs a node.
   * @constructor
   * @param {Object.<string, string>?} aliasMap - The map of aliases to use for this node.
   */
  function AbstractModuleNode(aliasMap) {

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
     * @type {Array.<ChildModuleNode>?}
     * @readonly
     * @private
     */
    this.__children = null;

    /**
     * Gets the map of attached child nodes by their name.  Lazily created.
     * 
     * @type {Object.<string, ChldModuleNode>}
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
     * @see AbstractModuleNode#require
     */
    this.__require = null;
  }

  objectCopy(AbstractModuleNode.prototype, /** @lends AbstractModuleNode# */{
    /**
     * Gets a value that indicates if this module is a root module.
     * 
     * @name isRoot
     * @memberOf AbstractModuleNode#
     * @type {boolean}
     * @readonly
     * @abstract
     */

    /**
     * Gets the root module of this module.
     * 
     * The root node returns itself.
     * 
     * @name root
     * @memberOf AbstractModuleNode#
     * @type {RootModuleNode}
     * @readonly
     * @abstract
     */

    /**
     * Gets the identifier of this module, if any; `null`, otherwise.
     * 
     * @type {string?}
     * @readonly
     */
    get id() {
      return null;
    },

    /**
     * Gets the parent module of this module, if any; `null`, otherwise.
     * 
     * @name parent
     * @memberOf AbstractModuleNode#
     * @type {AbstractModuleNode?}
     * @readonly
     * @abstract
     */

    /**
     * Gets the identifier of this module's parent module, if any; `null`, otherwise.
     * 
     * @name parentId
     * @memberOf AbstractModuleNode#
     * @type {string?}
     * @readonly
     * @abstract
     */

    /**
     * Gets the name by which this module is known by its parent module, 
     * if any; `null`, otherwise.
     * 
     * @type {string?}
     * @readonly
     */
    get name() {
      return null;
    },

    /** 
     * @name configure
     * @memberOf AbstractModuleNode#
     * @method
     * @param {object} config - The configuration object.
     * @virtual
     */

    /**
     * Gets the array of attached child modules, if any; `null` otherwise.
     * 
     * @type {Array.<ChildModuleNode>?}
     * @readonly
     */
    get children() {
      return this.__children;
    },

    /**
     * Gets the child module with the given name, creating it if desired.
     * 
     * @param {string} name - The name of the child node.
     * @param {boolean} [createIfMissing=false] - Indicates that a child node with 
     * the given name should be created, if one does not exist.
     * @param {boolean} [createDetached=false] - Indicates that missing child nodes 
     * should be created detached from their parents.
     * Only applies if `createIfMissing` is `true`.
     * 
     * @return {ChildModuleNode?} The child node, if any; `null` otherwise.
     */
    childByName: function(name, createIfMissing, createDetached) {
      let child = getOwn(this.__byName, name) || null;
      if (child === null && createIfMissing) {
        child = new ChildModuleNode(name, this, createDetached);
      }

      return child;
    },

    eachChild: function(f, x) {
      const children = this.children;
      if (children !== null) {
        children.forEach(f, x || this);
      }
    },

    /** 
     * Adds the given child module to the list of children.
     * 
     * @param {ChildModuleNode} child - The child module.
     * @private
     * @internal
     */
    __addChild: function(child) {

      if (DEBUG && (child.parent !== this || this.childByName(child.name))) {
        throw new Error("Invalid argument.");
      }

      if (this.__children === null) {
        this.__children = [];
        this.__byName = Object.create(null);
      }
      
      this.__children.push(child);
      this.__byName[child.name] = child;
    },

    // @virtual
    getRelative: function(normalizedId, createIfMissing, createDetached) {
      
      let parent = this;

      const names = normalizedId.split("/");
      const L = names.length;
      let i = -1;
      while ((++i < L) && (node = parent.childByName(names[i], createIfMissing, createDetached)) !== null) {
        parent = node;
      }
      
      return node;
    },

    // #region normalization

    // Supports AMD plugins.
    // When DEBUG and !Lax: 
    // - Throws on URLs via normalizeSingle
    normalize: function(id, isFull, isLax) {
      if (isLax) {
        if (!id) {
          return null;
        }
      } else if (DEBUG) {
        if (!id) {
          throw new Error("Invalid empty id.");
        }
      }

      let normalizedId;
      let resourceId = null;

      const index = id.indexOf("!");
      const isPluginCall = index !== -1;
      if (isPluginCall) {
        normalizedId = id.substring(0, index);
        resourceId = id.substring(index + 1);
      } else {
        normalizedId = id;
      }

      normalizedId = this.normalizeSingle(normalizedId, isFull, isLax);
      
      if (isPluginCall) {
        resourceId = this.__normalizePluginResource(normalizedId, resourceId);
        
        return normalizedId + "!" + resourceId;
      }
      
      return normalizedId;
    },

    // Does not support Amd plugin identifiers (e.g. "css!./styles").
    // Does not support URLs.
    // Resolves "./" and "../" relative to this node's identifier.
    // - Throws on going above this node's id.
    //
    // Strict / NonLax
    // - Throws on STAR.
    // - Throws on empty.
    // - Throws on containing "!".
    // - Throws on (isAbsoluteUrlWeak) URL.
    //
    // Lax
    // - Returns `null` if empty.
    //
    // Full normalization:
    // - applies maps
    // - resolves package main
    // isLax: allows "*" and the "!" character; for use in resource ids.
    normalizeSingle: function(singleId, isFull, isLax) {
      
      if (isLax) {
        if (!singleId) {
          return null;
        }
      } else if (DEBUG) {
        this.validateSingle(singleId);
      }
      
      let normalizedId = absolutizeId(singleId, this.parentId);
      
      if (isFull) {
        // Mapping.
        normalizedId = this.applyMap(normalizedId);

        // For now, assuming map cannot return a plugin call.
        if (DEBUG) {
          this.validateSingle(normalizedId);
        }
        
        // Main.
        const node = this.root.get(normalizedId);
        if (node !== null) {
          normalizedId = node.mainOrSelf.id;
        }
      }

      return normalizedId;
    },

    validateSingle: function(singleId) {
      if (!singleId) {
        throw new Error("Invalid empty id.");
      }

      if (singleId === STAR) {
        throw new Error("Invalid id '" + STAR + "'.");
      }

      if (singleId.indexOf("!") >= 0) {
        throw new Error("Plugin call id not allowed: '" + singleId + "'.");
      }

      if (isAbsoluteUrlWeak(singleId)) {
        throw new Error("URL not allowed: '" + singleId + "'.");
      }

      return singleId;
    },

    // require(["idOrAbsURL", ...]
    normalizeDep: function(depId) {
      return isAbsoluteUrlWeak(depId) 
        ? depId 
        : this.normalize(depId, true);
    },

    // define(id, ...
    normalizeDefined: function(definedId) {
      return this.normalize(definedId, true);
    },

    __normalizePluginResource: function(normalizedPluginId, resourceId) {
      // If the plugin is loaded, use if to normalize resourceId.
      const plugin = resolveUseDefault(this.get(normalizedPluginId));
      if (!plugin) {
        // Mark unnormalized and fix later.
        return resourceId + "_unnormalized" + (unnormalizedCounter++);
      }

      if (plugin.normalize) {
        return plugin.normalize(resourceId, this.normalizeResource.bind(this));
      }
      
      // Per RequireJS, nested plugin calls would not normalize correctly...
      if (resourceId.indexOf("!") < 0) {
        return this.normalizeResource(resourceId);
      }
      
      return resourceId;
    },

    // Default normalization used when loader plugin does not have a normalize method.
    // pluginCallId = "<singleId>!<resourceId>"
    normalizeResource: function(resourceId) {
      return this.normalizeSingle(resourceId, true, true);
    },

    /**
     * Applies mapping configurations to a given normalized identifier and 
     * returns the mapped identifier.
     * 
     * When no mapping configurations apply to the given identifier,
     * it is returned unchanged.
     * 
     * @param {string} normalizedId - A normalized identifier.
     * @return {string} The mapped identifier, possibly identical to `normalizedId`.
     */
    applyMap: function(normalizedId) {
     
      // For each prefix of normalizedId
      //   For each contextNode in this...root
      //     "a/b/c" -> "a/b" -> "*"

      let prefixId = normalizedId;
      let prefixIndex = -1;
      while (true) {
        const resolvedPrefixId = this._aliasMap[prefixId];
        if (resolvedPrefixId) {
          // Was mapped.
          return prefixIndex < 0
            // Matched wholy, upon first iteration.
            ? resolvedPrefixId
            // Join the resolved prefix with the remainder in normalizedId.
            : (resolvedPrefixId + normalizedId.substring(prefixIndex));
        }

        // Get next greatest prefix.
        prefixIndex = prefixId.lastIndexOf("/");
        if (prefixIndex < 0) {
          // Last segment.
          // No match occurred for any of the prefixes, 
          // so just return the original normalizedId.
          return normalizedId;
        }

        prefixId = prefixId.substring(0, prefixIndex);
      }
    },
    // #endregion

    configMap: function(mapSpec) {

      Object.keys(mapSpec).forEach(function(aliasId) {
        this._aliasMap[this.validateSingle(aliasId)] = this.validateSingle(mapSpec[aliasId]);
      }, this);
    },

    getDependency: function(depRef, callback) {
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
    },

    /**
     * Gets this node's AMD contextual `require` function.
     * @type {function}
     * @readonly
     * @see AbstractModuleNode#_createRequire
     */
    get require() {
      return this.__require || (this.__require = this._createRequire());
    }

    /**
     * Creates an AMD `require` function which has this node as the context node.
     * @name _createRequire
     * @memberOf AbstractModuleNode#
     * @return {function} A AMD `require` function.
     * @protected
     * @abstract
     */
  });

  // #endregion

  // #region AbstractChildModuleNode Class
  function AbstractChildModuleNode(parent, aliasMap) {
    
    AbstractModuleNode.call(this, aliasMap);

    this.__parent = parent;
    this.__root = parent.root;

    // The "module" dependency. Lazily created.
    this.__amdModule = null;
  }

  classExtend(AbstractChildModuleNode, AbstractModuleNode, /** @lends AbstractChildModuleNode# */{
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
      return this.__parent !== null ? this.__parent.id : null;
    },

    get amdModule() {
      return this.__amdModule;
    },

    /**
     * Gets a value that indicates if this module node is detached from the hierarchy.
     * 
     * @name isDetached
     * @memberOf AbstractChildModuleNode#
     * @type {boolean}
     * @readonly
     * @abstract
     */

    /**
     * Gets the URL of this module.
     * 
     * @name url
     * @memberof AbstractChildModuleNode#
     * @type {string?}
     * @readonly
     * @abstract
     */

    /**
     * Gets the configuration of this node, if any; `null`, otherwise.
     * 
     * @name config
     * @memberOf AbstractChildModuleNode#
     * @type {object?}
     * @readonly
     * @abstract
     */

    __getOrCreateAmdModule() {
      return this.__amdModule || this.__initAmdModule();
    },

    __initAmdModule: function() {
      if (DEBUG && this.__amdModule) {
        throw new Error("Invalid State!");
      }

      return (this.__amdModule = createAmdModule(null, this));
    },

    __assertAttached: function() {
      if (this.isDetached) {
        throw new Error("Operation invalid on dettached module nodes.");
      }
    },

    /** @override */
    _createRequire: function() {
      return createRequire(this);
    }
  });
  // #endregion

  // #region AnonymousChildModuleNode Class
  function AnonymousChildModuleNode(url, parent) {

    if (DEBUG && !(url || parent || !parent.isRoot)) {
      throw new Error("Invalid arguments.");
    }

    AbstractChildModuleNode.call(this, parent, parent._aliasMap);

    this.__url = url;
  }

  classExtend(AnonymousChildModuleNode, AbstractChildModuleNode, /** @lends AnonymousChildModuleNode# */{
    /** @override */
    get isDetached() {
      return true;
    },

    /** @override */
    get url() {
      return this.__url;
    },

    /** @override */
    get config() {
      return null;
    }
  });
  // #endregion
  
  // #region ChildModuleNode Class
  function ChildModuleNode(name, parent, isDetached) {

    if (DEBUG && !(name || parent)) {
      throw new Error("Invalid arguments.");
    }
    // When detached, no new configurations can be made, so reuse the parent's alias map.
    const aliasMap = isDetached ? parent._aliasMap : Object.create(parent._aliasMap);

    AbstractChildModuleNode.call(this, parent, aliasMap);

    this.__id = composeIds(parent.id, name);
    this.__name = name;
    this.__isDetached = !!isDetached;
    
    // ---
    // Configuration properties.
    this.__config = null;

    // Package main
    this.__main = null;

    this.__bundle = null;
    
    // The fixed path, if any.
    this.__fixedPath = null;

    // `null` means no fixed path was defined for self of any of the ascendant nodes (except root).
    this.__cachedPath = undefined;

    // `null` means no fixed path was defined (idem)...
    this.__cachedUrlRegular = undefined;

    // ---

    if (!isDetached) {
      this.__root.__indexNode(this);
      parent.__addChild(this);
    }
  }

  classExtend(ChildModuleNode, AbstractChildModuleNode, /** @lends ChildModuleNode# */{
    /** @override */
    get isDetached() {
      return this.__isDetached;
    },

    /** @override */
    get id() {
      return this.__id;
    },

    /** @override */
    get name() {
      return this.__name;
    },

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
     * @type {ChildModuleNode?}
     * @readonly
     * @see ChildModuleNode#setMain
     */
    get main() {
      return this.__main;
    },

    /**
     * Gets this modules's main module, 
     * when this module is an AMD package; this module, otherwise.
     * 
     * @type {ChildModuleNode}
     * @readonly
     */
    get mainOrSelf() {
      return this.__main || this;
    },

    /**
     * Sets the main module of this module.
     * 
     * Should be a regular module identifier (without "!").
     * 
     * @param {string?} relativeId - A relative identifier to the main sub-module of this module.
     * The identifier is considered relative to this module,
     * even when a bare name (without starting with `./`).
     * If the value has the extension `.js`, it is removed.
     * 
     * @see ChildModuleNode#main
     */
    setMain: function(relativeId) {

      this.__assertAttached();

      this.__main = relativeId
        ? this.getRelative(this.normalizeSingle(removeJsExtension(relativeId)), true)
        : null;
    },

    /**
     * Gets or sets this modules's bundle module.
     * 
     * @type {ChildModuleNode?}
     */
    get bundle() {
      return this.__bundle;
    },

    set bundle(value) {

      this.__assertAttached();

      const bundleNew = value || null;
      if (bundleNew !== this.__bundle) {
        this.__invalidateRegularUrl(function applyChange() {
          this.__bundle = bundleNew;
        });
      }
    },

    /**
     * Gets this modules's bundle module, if any; this module, otherwise.
     * 
     * @type {ChildModuleNode}
     * @readonly
     */
    get bundleOrSelf() {
      return this.__bundle || this;
    },

    /**
     * Gets or sets the path of this module.
     * 
     * When relative, it is relative to the root module's
     * {@link RootModuleNode#baseUrl}.
     * When not specified, 
     * the path is built from the parent module's [path]{@link ChildModuleNode#path} 
     * and this module's [name]{@link AbstractModuleNode#name}.
     * 
     * When set, a trailing slash is removed.
     * 
     * @type {string?}
     * @see ChildModuleNode#path
     */
    get fixedPath() {
      return this.__fixedPath;
    },

    set fixedPath(value) {

      this.__assertAttached();

      const fixedPathNew = value ? removeTrailingSlash(value) : null;
      if (fixedPathNew !== this.__fixedPath) {
        this.__invalidateRegularUrl(function applyChange() {
          this.__fixedPath = fixedPathNew;
          this.__invalidatePath();
        });
      }
    },

    /**
     * Gets the effective path of this module, if one can be determined; `null`, otherwise.
     * 
     * When {@link ChildModuleNode#fixedPath} is specified, it is returned.
     * Otherwise, the path is built from the parent module's [path]{@link ChildModuleNode#path} 
     * and this module's [name]{@link AbstractModuleNode#name}.
     * If the none of the ascendant modules has a specified `fixedPath`, `null` is returned.
     * 
     * @type {string?}
     * @readonly
     */
    get path() {
      if (this.__cachedPath === undefined) {
        this.__cachedPath = this.__buildPath();
      }

      return this.__cachedPath;
    },

    get config() {
      return this.__config;
    },

    /** @override */
    configure: function(config) {
      if (!this.__config) {
        this.__config = {};
      }

      mixin(this.__config, config);
    },

    configPackage: function(packageSpec) {

      this.setMain(packageSpec.main || "main");
      
      if (packageSpec.location) {
        this.fixedPath = packageSpec.location;
      }
    },
    
    configPath: function(pathSpec) {
      
      if (Array.isArray(pathSpec)) {
        pathSpec = pathSpec[0];
      }

      this.fixedPath = pathSpec;
    },

    configBundle: function(bundleSpec) {

      this.__assertAttached();

      if (bundleSpec) {  
        const bundleId = this.id;
        bundleSpec.forEach(function(id) {
          if (id !== bundleId) {
            this.getOrCreate(id).bundle = this;
          }
        }, this);
      }
    },

    /**
     * Gets the URL of this module.
     * 
     * For purposes of better supporting canonicalIdByUrl and 
     * to integrate better with SystemJS's resolve semantics,
     * module URLs include a fragment annotation:
     * 
     * - module.js#!mid=module/id             - regular module
     * - bundle.js#!mid=bundle/id             - bundle module
     * - plugin.js#!mid=plugin/id             - plugin module
     * - bundle.js#!mid=bundled/module/id     - bundled module, within
     * - plugin.js#!mid=plugin/id!resource-id - plugin call module
     * 
     * The URL is determined from the module's {@link AbstractModuleNode#id}
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
     * @type {string?}
     * @readonly
     * @override
     */
    get url() {
      const bundle = this.bundle;
      if (bundle !== null) {
        // bundle.js#!mid=bundled/module/id
        return setUrlFragment(bundle.url, URL_MODULE_FRAGMENT + this.id);
      }

      let url = this.regularUrl;
      if (url !== null) {
        
        // Add .js extension.
        const isDataOrBlobUrl = RE_URL_DATA_OR_BLOB.test(url);
        if (!isDataOrBlobUrl && url.indexOf("?") < 0) {
          url += ".js";
        }
        
        const urlArgs = this.root.urlArgs;
        if (urlArgs) {
          const isBlobUrl = isDataOrBlobUrl && RE_URL_BLOB.test(url);
          if (!isBlobUrl) {
            // Append any query parameters to URL.
            // Function should detect if ? or & is needed...
            url += urlArgs(this.id, url);
          }
        }

        // module.js#!mid=module/id
        // bundle.js#!mid=bundle/id
        // plugin.js#!mid=plugin/id
        url = setUrlFragment(url, URL_MODULE_FRAGMENT + this.id);
      }
      
      return url;
    },

    get regularUrl() {
      if (this.__cachedUrlRegular === undefined) {
        this.__cachedUrlRegular = this.__buildRegularUrl();
      }

      return this.__cachedUrlRegular;
    },

    __invalidatePath: function() {
      
      this.__cachedPath = undefined;

      this.eachChild(function(child) {
        // Stop invalidation propagation if child node does not inherit the parent's path.
        if (child.fixedPath === null) {
          child.__invalidatePath();
        }
      });
    },

    // ~ on fixedPath and on parent.path
    __buildPath: function() {
      
      const fixedPath = this.fixedPath;
      if (fixedPath !== null) {
        return fixedPath;
      }

      const parent = this.parent;

      // Do not allow top-level modules without a fixed path.
      if (parent.isRoot) {
        return null;
      }
      
      // Propagate `null` to child modules.
      const parentPath = parent.path;
      return parentPath && (parentPath + "/" + this.name);
    },

    // Called when the root node's baseUrl is changed.
    __onBaseUrlChanged: function() {
      
      this.__invalidateRegularUrl();
      
      this.eachChild(function(child) {
        child.__onBaseUrlChanged();
      });
    },

    __invalidateRegularUrl: function(applyChange) {
      // If regular URL was or will be indexed (before and after applyChange).
      let wasOrWillBeIndexed = this.__isIndexedByRegularUrl;

      // "Cold" value.
      let regularUrlOld;
      let regularUrlNew;

      if (wasOrWillBeIndexed) {
        regularUrlOld = this.__cachedUrlRegular || null;
      }

      if (applyChange) {
        applyChange.call(this);

        // Has it become "index by regular URL"?
        if (!wasOrWillBeIndexed) {
          wasOrWillBeIndexed = this.__isIndexedByRegularUrl;
        }
      }

      this.__cachedUrlRegular = undefined;

      if (wasOrWillBeIndexed) {
        regularUrlNew = this.regularUrl;

        // If either old or new value are non-null, 
        // then this node needs to have its regularUrl re-indexed!
        // Also, only need to re-index if regularUrl actually changed.
        // If both are null, then they're equal, so the !== test covers both conditions.
        if (regularUrlNew !== regularUrlOld) {
          this.root.__onNodeRegularUrlChanged(this, regularUrlNew, regularUrlOld);
        }
      }
    },

    // Module is indexed by regularUrl only if it has a fixedPath.
    get __isIndexedByRegularUrl() {
      return this.fixedPath !== null;
    },

    // ~ on path, bundle and baseUrl
    __buildRegularUrl: function() {
      if (this.bundle !== null) {
        return null;
      }

      // If there is no `path`, there can be no URL.
      const path = this.path;
      if (path === null) {
        return null;
      }

      let url = path;

      // Not "//foo", "/foo" or "http://foo".
      if (!isAbsoluteUrlWeak(url)) {
        url = this.root.baseUrl + url;
      }

      // Let base implementation apply further URL normalizations and URL mappings via Import Map!
      return base.resolve.call(this.root._systemJS, url);
    }
  });
  // #endregion

  // #region RootModuleNode Class

  function RootModuleNode(systemJS) {

    const aliasMap = Object.create(null);

    AbstractModuleNode.call(this, aliasMap);
    
    /**
     * The associated SystemJS instance.
     * 
     * @type {SystemJS}
     * @readonly
     * @protected
     * @internal
     */
    this._systemJS = systemJS;

    /**
     * A map of all descendant modules by id.
     * 
     * @type {Object.<string, ChildModuleNode>}
     * @readonly
     * @private
     */ 
    this.__byId = Object.create(null);

    /**
     * A map of all descendant modules by _regular_ URL.
     * 
     * @type {Object.<string, ChildModuleNode>}
     * @readonly
     * @private
     * 
     * @see ChildModuleNode#url
     */ 
    this.__byUrl = Object.create(null);

    /**
     * The base URL for relative paths.
     * 
     * The default is `"./"`.
     * 
     * @type {string?}
     * @private
     */
    this.__baseUrl = "./";

    /**
     * A function which receives a module identifier and its URL
     * and returns a new URL possibly containing additionall query parameters.
     * 
     * @type {(function(string, string): string)?}
     * @private
     */
    this.__urlArgs = null;

    /**
     * Gets the AMD `define` function of this context.
     * 
     * @type {function}
     * @readonly
     */
    this.define = createDefine(this);
  }

  const baseGetRelative = AbstractModuleNode.prototype.getRelative;

  classExtend(RootModuleNode, AbstractModuleNode, /** @lends RootModuleNode# */{
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
          // in `ChildModuleNode#regularUrl`, 
          // would give incorrect results or throw.
          newValue = "./" + newValue;
        }
      } else {
        newValue = "./";
      }
      
      if (this.__baseUrl !== newValue) {
        this.__baseUrl = newValue;

        this.eachChild(function(child) {
          child.__onBaseUrlChanged();
        });
      }
    },

    get urlArgs() {
      return this.__urlArgs;
    },

    set urlArgs(value) {
      if (typeof value === 'string') {
          var urlArgs = value;
          value = function(id, url) {
            return (url.indexOf('?') === -1 ? '?' : '&') + urlArgs;
          };
      }
      // else assume it's a function or null.

      this.__urlArgs = value || null;
    },

    /** @override */
    getRelative: function(normalizedId, createIfMissing/*, createDetached*/) {
      
      let node = getOwn(this.__byId, normalizedId) || null;
      if (node === null && createIfMissing) {
        node = baseGetRelative.apply(this, arguments);
      }

      return node;
    },

    get: function(normalizedId) {
      return this.getRelative(normalizedId);
    },

    getOrCreate: function(normalizedId) {
      return this.getRelative(normalizedId, true);
    },

    getOrCreateDetached: function(normalizedId) {
      return this.getRelative(normalizedId, true, true);
    },

    /** @override */
    configure: function(config) {

      const baseUrl = config.baseUrl;
      if (baseUrl !== undefined) {
        this.basePath = baseUrl;
      }
  
      const urlArgs = config.urlArgs;
      if (urlArgs !== undefined) {
        this.urlArgs = urlArgs;
      }
      
      const root = this;

      function getOrCreateSingle(id) {
        return root.getOrCreate(root.validateSingle(id));
      }

      if (config.packages) {
        config.packages.forEach(function(pkgSpec) {
          if (pkgSpec) {
            if (typeof pkgSpec === "string") {
              pkgSpec = {name: pkgSpec};
            }

            getOrCreateSingle(pkgSpec.name).configPackage(pkgSpec);
          }
        });
      }

      eachOwn(config.paths, function(pathSpec, id) {
        if (pathSpec) {
          getOrCreateSingle(id).configPath(pathSpec);
        }
      });
      
      eachOwn(config.map, function(mapSpec, id) {
        if (mapSpec) {
          const node = id === STAR ? root : getOrCreateSingle(id);
          node.configMap(mapSpec);
        }
      });

      eachOwn(config.bundles, function(bundleSpec, id) {
        getOrCreateSingle(id).configBundle(bundleSpec);
      });

      eachOwn(config.config, function(config, id) {
        getOrCreateSingle(id).configure(config);
      });
    },

    /**
     * Gets the canonical identifier of the module which has the given URL, if any;
     * `null`, if one does not exist.
     *
     * Note that the given URL cannot correspond to the identifier of a _loader plugin call_, 
     * as these types of modules are virtual and don't have a URL.
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
     * 2. it was already part of the module's `regularUrl`.
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
     * @return {string?} The canonical identifier or `null`.
     * @private
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
      let urlPrevious = null;
      let idSuffix = "";

      while (true) {
        // Has URL changed (or is it the first iteration)?
        if (urlPrevious !== url) {
          const node = getOwn(this.__byUrl, url);
          if (node) {
            return node.id + idSuffix;
          }

          urlPrevious = url;
        }
        // Else only the state changed.

        if (state === STATE_INIT) {
          // Is there a query part?
          indexQuery = url.indexOf("?");
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
            url = url.substring(0, indexQuery);
            // E.g. `foo.org/bar.js`
            state = STATE_FIRST_PATH_SEGMENT;
          } else {
            // E.g. `foo.org/bar.js?a=b&c=d`
            ur = url.substring(0, index);
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
          const index = url.lastIndexOf("/");
          if (index < 0) {
            // No (more) segments. No match found.
            // E.g. `foo.org`
            return null;
          }

          // Accumulate the removed path segment (prepending).
          idSuffix = url.substring(index) + idSuffix;

          // Remove the path segment.
          // a) foo.org/bar
          // b) foo.org/bar/
          // c) http://foo.org
          // d) http:/
          url = url.substring(0, index);
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

    /** @internal */
    __indexNode: function(node) {
      if (DEBUG && this.get(node.id) !== null) {
        throw new Error("A node with id '" + node.id + "' is already defined.");
      }

      this.__byId[node.id] = node;
    },

    /** 
     * Updates the URL index to account for the change of 
     * _regular URL_ of a descendant node.
     * 
     * Only called for nodes having (or stopping to have) a {@link ChildModuleNode#fixedPath}.
     * 
     * @param {ChildModuleNode} childNode - The descendant node.
     * @param {string?} regularUrlNew - The new regular URL value.
     * @param {string?} regularUrlOld - The old regular URL value.
     * @internal
     * @private
     * @see ChildModuleNode#url
     */
    __onNodeRegularUrlChanged: function(childNode, regularUrlNew, regularUrlOld) {
      // Don't delete if old regular url is taken by other node.
      if (regularUrlOld && getOwn(this.__byUrl, regularUrlOld) === childNode) {
        delete this.__byUrl[regularUrlOld];
      }

      // Don't add if new regular url is taken by another node.
      if (regularUrlNew && !getOwn(this.__byUrl, regularUrlNew)) {
        this.__byUrl[regularUrlNew] = childNode;
      }
    }
  });
  
  // #endregion

  // #region Amd and SystemJS stuff

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

      if (typeof id !== "string") {
        // Anonymous define. Shift arguments right.
        execute = deps;
        deps = id;
        id = null; 
      }

      if (typeof deps === "function") {
        execute = deps;
        deps = REQUIRE_EXPORTS_MODULE;

      } else if (!Array.isArray(deps)) {
        // deps is an object or some other value.
        execute = constantFun(deps);
        deps = [];

      } // else, `deps` is an array and assuming but not checking that `execute` is a fun...

      rootNode._systemJS.__queueAmdDef(id, deps, execute);
    }
  }

  function createRequire(node) {

    const rootNode = node.root;
    const systemJS = rootNode._systemJS;
    
    return objectCopy(require, {
      isBrowser: isBrowser,

      toUrl: function(moduleNamePlusExt) {
      },

      // As soon as the exports object is created and
      // the module is loading or has been loaded.
      defined: function(id) {
      },

      // There is an attached node for it?
      // 1. Normalize id.
      //    1.1. If there is a plugin in it:
      //      1.1.1. If the plugin is loaded and has a normalize method then use it to normalize resource name.
      //      1.1.2. If the resource name has no "!" then normalize resource name normally.
      //      1.1.3. Else, do not normalize name.
      //    1.2. Else, normalize id normally.
      // 2. Apply mapping to id.
      specified: function(id) {
      }
    });

    // ---

    function require(depRefs, callback, errback) {
      return Array.isArray(depRefs)
        ? requireManyAsync(depRefs, callback, errback)
        : requireOneSync(depRefs);
    }

    function requireManyAsync(depRefs, callback, errback) {

      // For dependencies which are _not_ AMD special dependencies.
      const registerPromises = [];

      const L = depRefs.length;
      const depValues = new Array(L);
      
      for (let i = 0; i < L; i++) {
        node.getDependency(depRefs[i], function(normalizedDepRef, value, hasDep) {
          if (hasDep) {
            depValues[i] = value;
          } else {
            const promise = systemJS.import(normalizedDepRef)
              .then(createDepSetter(depValues, i));
  
            registerPromises.push(promise);
          }
        });
      }

      Promise
        .all(registerPromises)
        .then(function() {
          callback.apply(null, depValues);
        }, errback);

      return require;
    }

    function requireOneSync(depRef) {

      return node.getDependency(depRef, function(normalizedDepRef, value, hasDep) {
        if (hasDep) {
          return value;
        }

        const resolvedDepId = systemJS.resolve(normalizedDepRef);
        if (systemJS.has(resolvedDepId)) {
          return resolveUseDefault(systemJS.get(resolvedDepId));
        }
        
        throw new Error("Dependency '" + normalizedDepRef + "' isn't loaded yet.");
      });
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
      
      const isString = typeof deps === "string";
      if (!isString && !Array.isArray(deps)) {
        
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
        
        if (Array.isArray(callback)) {
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
      return isString ? result : rootRequire;
    }
  }

  // when loading a script with no canonical id, node is null.
  // when creating a module to satisfy 
  function createAmdModule(loadUrl, node) {
    const moduleUrl = node ? node.bundleOrSelf.url : loadUrl;
    let hasExports = false;
    let exports;
    const module = {
      // Per RequireJS, when there is no AMD context, 
      // the id of a module is its URL.
      id: node ? node.id : moduleUrl,
      uri: moduleUrl,
      config: function() {
        return (node && node.config) || {};
      },
      get exports() {
        if (!hasExports) {
          hasExports = true;
          exports = {};
        }

        return exports;
      },
      set exports(value) {
        exports = value;
      }
    };

    return module;
  }

  /**
   * Creates a SystemJS register for an AMD (module definition).
   * 
   * @param {AbstractChildModuleNode} node - The AMD child node of the module being defined.
   * @param {Array.<string>} depRefs - An array of AMD references of the dependencies of the AMD (definition).
   * @param {function} execute - The AMD factory function.
   * @return {Array} A SystemJS register.
   * @private
   */
  function createAmdRegister(node, depRefs, execute) {
    
    const module = node.__initAmdModule();
    const exports = module.exports;

    // Dependencies which are _not_ AMD special dependencies.
    const registerDepIds = [];
    const registerDepSetters = [];

    // Process dependencies.
    const L = depRefs.length;
    const depValues = new Array(L);

    // Handle special AMD dependencies.
    // Add setters for other dependencies.
    for (let i = 0; i < L; i++) {
      node.getDependency(depRefs[i], function(depRef, value, hasDep) {
        if (hasDep) {
          depValues[i] = value;
        } else {
          registerDepIds.push(depRef);
          registerDepSetters.push(createDepSetter(depValues, i));
        }
      });
    }

    return [registerDepIds, declareAmd];
    
    function declareAmd(_export, _context) {
      
      _export({ default: exports, __useDefault: true });

      return {
        setters: registerDepSetters,
        execute: function() {
          const exported = execute.apply(exports, depValues);
          if(exported !== undefined) {
            // Replace exports value.
            module.exports = exported;
            _export("default", exported);

          } else if(exports !== module.exports) {
            // Requested "module" and replaced exports, internally.
            _export("default", module.exports);
          }
        }
      };
    }
  }
  
  function createDepSetter(depValues, depIndex) {
    return function depSetter(ns) {
      depValues[depIndex] = resolveUseDefault(ns);
    };
  }
  // #endregion

  // #region Utilities

  function constantFun(value) {
    return function() {
      return value;
    };
  }

  function getOwn(o, p, dv) {
    return o && O_HAS_OWN.call(o, p) ? o[p] : dv;
  }

  function eachOwn(o, f, x) {
    if (o) {
      Object.keys(o).forEach(function(p) {
        f.call(x, o[p], p);
      });
    }
  }

  // Adapted from RequireJS to merge the _config_ configuration option.
  function mixin(target, source) {
    eachOwn(source, function(value, prop) {
      if (!O_HAS_OWN.call(target, prop)) {
        // Not a null object. Not Array. Not RegExp.
        if (value && typeof value === "object" && !Array.isArray(value) && !(value instanceof RegExp)) {
          if (!target[prop]) {
            target[prop] = {};
          }

          mixin(target[prop], value);
        } else {
          target[prop] = value;
        }
      }
    });
  
    return target;
  }

  function objectCopy(to, from) {
    for (const p in from) {
      const desc = Object.getOwnPropertyDescriptor(from, p);
      if (desc !== undefined) {
        Object.defineProperty(to, p, desc);
      }
    }

    return to;
  }

  function assignProps(to, from, props) {
    props.forEach(function(p) {
      to[p] = from[p];
    });

    return to;
  }

  function getGlobal(path) {
    if (!path) {
      return path;
    }

    let value = global;
    const props = path.split('.');
    const L = props.length;
    let i = -1
    while (++i < L && (value = value[props[i]]) != null);
    return value;
  }

  function classExtend(Sub, Base, subSpec) {
    Sub.prototype = Object.create(Base.prototype);
    Sub.prototype.constructor = Sub;
    if (subSpec) {
      objectCopy(Sub.prototype, subSpec);
    }

    return Sub;
  }

  // Replace SystemJS with the locally declared AmdSystemJS.
  // Hijack its prototype and use it for AmdSystemJS.
  function classExtendHijack(Sub, Base, subSpec) {

    const basePrototype = Base.prototype;
    
    basePrototype.constructor = Sub;
    Sub.prototype = basePrototype;

    if (subSpec) {
      objectCopy(basePrototype, subSpec);
    }

    return Sub;
  }

  function resolveUseDefault(ns) {
    return ns && ns.__useDefault ? ns.default : ns;
  }

  function absolutizeId(id, parentId) {
    
    // Anything not starting with a "." needs no handling.
    if (!id || id[0] !== ".") {
      return id;
    }

    const baseIds = parentId ? parentId.split("/") : null;
    const names = id.split("/");

    // Remove _leading_ "./" or "../".
    while (names.length > 0) {
      const name = names[0];
      if (name === "..") {
        // Go up one base name.
        if (baseIds === null || baseIds.length === 0) {
          throw new Error("Invalid identifier '" + id + "'.");
        }

        baseIds.pop();
      } else if (name !== ".") {
        
        // Found first non "." or "..".

        if (name && name[0] === ".") {
          // Something like "..."...
          throw new Error("Invalid identifier '" + id + "'.");
        }

        if (baseIds !== null && baseIds.length > 0) {
          names.unshift.apply(names, baseIds);
        }
    
        return names.join("/");
      }

      // Discard "." or "..".
      names.shift();
    }
  }

  function removeJsExtension(value) {
    return value.replace(RE_JS_EXT, "");
  }

  function removeTrailingSlash(value) {
    return value[value.length - 1] === "/" 
      ? value.substring(0, value.length - 1) 
      : value;
  }

  function ensureTrailingSlash(value) {
    return value[value.length - 1] === "/" ? value : (value + "/");
  }

  function composeIds(baseId, childId) {
    return baseId ? (baseId + "/" + childId) : childId;
  }

  function removeUrlFragment(url) {
    const index = url.indexOf("#");
    return index < 0 ? url : url.substring(0, index);
  }

  function setUrlFragment(url, fragment) {
    const index = url.indexOf("#");
    return index < 0
      ? (url + fragment)
      : (url.substring(0, index) + fragment);
  }

  // "/a" - origin relative 
  // "//a" - protocol relative
  // "http://" - absolute
  function isAbsoluteUrlWeak(text) {
    return !!text && RE_URL_ABSOLUTE.test(text);
  }

  function isBareName(text) {
    return !!text && !isAbsoluteUrlWeak(text) && text[0] !== ".";
  }
  // #endregion

  (function initGlobal() {
    
    const globalSystemJS = global.System;

    // Replace the constructor of the only instance of SystemJS, System.
    // This is needed because others have explicitly set a local constructor property on System.
    // Otherwise, the proper value would be inherited via __proto__.
    globalSystemJS.constructor = AmdSystemJS;

    globalSystemJS._initAmd();

    const amd = globalSystemJS.amd;

    // Read configuration, if any.
    const readConfig = function(cfg) {
      return cfg != null && typeof cfg !== "function" ? cfg : null;
    };

    // Capture configuration before overwriting global variables.
    const config = readConfig(global.require) || readConfig(global.requirejs);
    
    // Publish in global scope.
    global.define = amd.define;
    global.require = global.requirejs = amd.require;

    if (config) {
      amd.configure(config);
    }
  })();

})(typeof self !== 'undefined' ? self : global);
