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
  const RE_URL_PROTOCOL = /^[\w\+\.\-]+:/i
  let unnormalizedCounter = 1;

  // TODO: Check cycle detection is properly handled
  // TODO: plugin onload.fromText
  // TODO: Check proper error handling
  // TODO: plugins, `config` argument ??
  // TODO: Receive configuration through global requirejs variable (when an object).
  // TODO: Other environments (Rhino? )
  // TODO: Review URL Regexps
  // TODO: "Minify" code / identifiers / structure.
  // TODO: complete doclets
  // Not supported:
  // - .js recognized as URL.
  // - Map normal to plugin call.
  // - path fallbacks
  // - Creating new require contexts.
  // - data-main and skipDataMain
  // - PSn, Opera...
  // - CommonJS-style factory dependencies detection (toString).
  // - Configurable require.jsExtRegExp (Used to filter out dependencies that are already paths).
  // - require.onError, require.createNode, require.load
  // - config.nodeRequire / all special NodeJS/CommonJS features
  // - require.defined/specified ? Are these worth it?

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
       * Filled in by calling the {@link AmdSystemJS#_queueAmdDef} method.
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
        return base.resolve.apply(this, arguments);

      } catch (error) {
        // No isAbsoluteWeakUrl URLs here!
        if (DEBUG && isAbsoluteUrlWeak(depId)) {
          throw error;
        }

        const refNode = this.__getOrCreateDetachedByUrl(parentUrl) || this.amd;
        const normalizedId = refNode.normalizeDep(depId);
        
        // Throw if normalizedId has no assigned URL (i.e. does not have a defined path or bundle).
        const node = this.amd.getOrCreateDetached(normalizedId);
        if (node.path === null) {
          throw error;
        }

        return normalizedId
      }
    },

    /** @override */
    instantiate: function(resolvedId, parentUrl) {

      let loadUrl = resolvedId;

      // When AMD.
      let importNode = null;
      let loadNode = null;

      // If it's not a URL, it's an AMD base identifier and it needs further resolution.
      if (!isAbsoluteUrlWeak(loadUrl)) {
        // Already in the named registry?
        const register = this.__getByName(resolvedId);
        if (register !== null) {
          return register;
        }

        // If it's a plugin call, then get the plugin module, first.
        // Then, call its plugin interface with the argument to determine 
        // the composite module (resolvedId).
        const idInfo = parseAmdId(resolvedId);
        if (idInfo.isPluginCall) {
          return this.__instantiatePluginCall(idInfo.id, idInfo.resource, parentUrl);
        }

        // Get or create the AMD node. Must be a child node.
        importNode = this.amd.getOrCreate(idInfo.id);
        loadNode = importNode.bundleOrSelf;

        loadUrl = loadNode.url;
      }

      return Promise.resolve(base.instantiate.call(this, loadUrl, parentUrl))
        .then(this.__instantiateEnd.bind(this, loadUrl, importNode, loadNode));
    },

    __instantiatePluginCall: function(pluginId, resourceId, parentUrl) {

      // Unfortunately, `pluginId` will be resolved, again.
      return this.import(pluginId, parentUrl)
        .then(this.__instantiatePluginCallEnd.bind(this, pluginId, resourceId, parentUrl));
    },

    __instantiatePluginCallEnd: function(pluginId, resourceId, parentUrl, plugin) {

      let id = pluginId + "!" + (resourceId || "");

      // Determine the identifier of the dependent module (parentUrl), if AMD.
      let refNode = this.__getOrCreateDetachedByUrl(parentUrl) || this.amd;

      return new Promise(function(resolve, reject) {
        // TODO: How to build config from this model...
        let config = {};

        function onLoadCallback(value) {
          resolve(value);
        }

        onLoadCallback.error = reject;

        onLoadCallback.fromText = function(text, textAlt) {
          // TODO: resolve from a given text to eval as if it were module _resourceId_.
          if (textAlt) {
            text = textAlt;
          }

          // eval
          // define is called..
        };

        plugin.load(resourceId, refNode.require, onLoadCallback, config);
      });
    },

    // Id cannot be that of an AMD loader plugin call, as these don't really have a URL...
    // If URL is that of a bundle, it must have a fragment such as `#!mid=original/bundled/module`,
    // or the returned module identifier is that of the bundle itself.
    // If URL is the result of a previous `resolve` operation, looking up the inverse resolutions map immediately yields the result.
    // Otherwise, must go through: `map`, `paths`, `bundles`, `packages`.
    // Ultimately, if no correspondence is found, null is returned.
    _urlToId: function(url) {
      // TODO: Implement _urlToId
      if(!url) {
        return null;
      }
    },

    __getOrCreateDetachedByUrl: function(url) {
      let id = this._urlToId(url);
      return id && this.amd.getOrCreateDetached(id);
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

    // TODO: refactor this documentation...
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
     * @param {ChildModuleNode?} importNode - The AMD child node being imported, or `null`, if none.
     * @param {ChildModuleNode?} loadNode - The AMD child node being loaded, or `null`, if none.
     * When the node being instantiated is provided by a bundle file, 
     * then this will be the bundle module node. Otherwise, it is identical to the `importNode` parameter.
     * @param {Array} baseRegister - The SystemJS register returned by 
     * the base implementation, {@link SystemJS#instantiate}. Assuming it is defined.
     * 
     * @return {Array} A SystemJS register.
     * @private
     */
    __instantiateEnd: function(loadUrl, importNode, loadNode, baseRegister) {
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
      return this.__processAmdDefs(loadUrl, loadNode) ||
        (importNode 
          ? (this.__getByName(importNode.id) || EMTPY_AMD_REGISTER) 
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
    _queueAmdDef: function(id, deps, execute) {
      this.__amdDefQueue.push({id: id, deps: deps, execute: execute});
    },

    /**
     * Processes all queued AMD (module definitions).
     * 
     * @param {string} loadUrl - The URL of the file being loaded.
     * @param {ChildModuleNode?} loadNode - The AMD child node being laoded, or `null`, if none.
     * 
     * @return {Array|undefined} The first found anonymous AMD register, 
     * if any was processed and `loadNode` is `null`; `undefined`, otherwise.
     * @private
     */
    __processAmdDefs: function(loadUrl, loadNode) {
      
      let amdDef;
      let firstAnonymousRegister = undefined;

      while((amdDef = this.__amdDefQueue.shift()) !== undefined) {
        const anonymousRegister = this.__processAmdDef(loadUrl, loadNode, amdDef.id, amdDef.deps, amdDef.execute);
        if (anonymousRegister !== undefined) {
          if (firstAnonymousRegister === undefined) {
            firstAnonymousRegister = anonymousRegister;
          } else {
            // Second, third, ... anonymous module in a script without AMD context (loadNode).
            this._log("More than one anonymous AMD module found in a script. Ignoring.", "warn");
          }
        }
      }

      return firstAnonymousRegister;
    },

    /**
     * Processes an AMD (module definition).
     * 
     * If `id` is `null` and `loadNode` is not, 
     * then the identifier is assumed to be that of `loadNode`.
     * Otherwise, if `id` is `null` and `loadNode` as well,
     * then the AMD module remains anonymous.
     * 
     * A SystemJS register is created.
     * 
     * For named registers are immediately registered in the named register and `undefined` is returned.
     * For unnamed/anonymous registers, the register is returned.
     * 
     * @param {string} loadUrl - The URL of the file being loaded.
     * @param {ChildModuleNode?} loadNode - The AMD child node being laoded, or `null`, if none.
     * @param {string?} id - The AMD identifier of the AMD (definition).
     * @param {Array.<string>} deps - An array of AMD references of the dependencies of the AMD (definition).
     * @param {function} execute - The AMD factory function.
     * 
     * @return {Array|undefined} The created AMD register, if it remains anonymous; `undefined`, otherwise.
     * @private
     */
    __processAmdDef: function(loadUrl, loadNode, id, deps, execute) {
      
      // Capture id from loading AMD module, if any.
      let fullyNormalizedId = null;
      let node = null;
      if (id !== null) {
        // Ensure normalized (assumes normalize is idempotent...)
        fullyNormalizedId = this.amd.normalizeDefined(id);

        if (fullyNormalizedId !== null && this.__getByName(fullyNormalizedId) !== null) {
          this._log("Module '" + fullyNormalizedId + "' is already defined. Ignoring.", "warn");
          return undefined;
        }

        node = this.amd.getOrCreate(fullyNormalizedId);
      } else if (loadNode !== null) {
        node = loadNode;
        fullyNormalizedId = node.id;
      }

      if (DEBUG && node !== null && node.isRoot) {
        throw new Error("Invalid state.");
      }

      let amdRegister = this.__createAmdRegister(loadUrl, loadNode, node, deps, execute);
      
      // Need to let `amdRegister` be processed by any subclasses.
      amdRegister = this._processRegister(amdRegister);
      
      if (fullyNormalizedId !== null) {
        this.registerRegistry[fullyNormalizedId] = amdRegister;
        return undefined;
      }

      // Anonymous and yet unregistered AMD register.
      return amdRegister;
    },

    /**
     * Creates a SystemJS register for an AMD (module definition).
     * 
     * @param {string} loadUrl - The URL of the file being loaded.
     * @param {ChildModuleNode?} loadNode - The AMD child node being laoded, or `null`, if none.
     * @param {ChildModuleNode?} node - The AMD child node of the named module being defined, or `null`, if the module is anonymous.
     * @param {Array.<string>} depRefs - An array of AMD references of the dependencies of the AMD (definition).
     * @param {function} execute - The AMD factory function.
     * @return {Array} A SystemJS register.
     * @private
     */
    __createAmdRegister: function(loadUrl, loadNode, node, depRefs, execute) {
      
      // TODO: When a bundle (node !== loadNode), compose URL with #mid=<node.id>?
      const moduleUrl = loadUrl;

      const exports = {};
      const module = {
        // TODO: compose <node.id> with .js?
        // Per RequireJS, when no AMD context, the id of a module is its URL.
        id: node ? node.id : moduleUrl,
        uri: moduleUrl,
        config: function() {
          return (node && node.config) || {};
        },
        exports: exports
      };

      // Dependencies which are _not_ AMD special dependencies.
      const registerDepIds = [];
      const registerDepSetters = [];

      // Process dependencies.
      const L = depRefs.length;
      const depValues = new Array(L);

      const refNode = node || this.amd;

      // Handle special AMD dependencies.
      // Add setters for other dependencies.
      for (let i = 0; i < L; i++) {
        const depRef = depRefs[i];
        if(depRef === "require") {
          // TODO: What's the value of "require" for an anonymous define?
          depValues[i] = refNode.require;
        } else if(depRef === "module") {
          depValues[i] = module;
        } else if(depRef === "exports") {
          depValues[i] = exports;
        } else {
          // TODO: doing full normalization here circumvents resolve not handling parentUrl, yet...
          registerDepIds.push(refNode.normalizeDep(depRef));
          registerDepSetters.push(createDepSetter(depValues, i));
        }
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
    },

    /**
     * Gets a named register with the given name, if any.
     * 
     * @param {string} name - The name of the register.
     * @return {Array?} The register with the given name, if any; `null`, otherwise.
     * @private
     */
    __getByName: function(name) {
      return getOwn(this.registerRegistry, name) || null;
    }
  });
  
  // ---

  function createDepSetter(depValues, depIndex) {
    return function depSetter(ns) {
      depValues[depIndex] = resolveUseDefault(ns);
    };
  }

  // #endregion

  // #region AbstractModuleNode Class

  /**
   * @classdesc The `AbstractModuleNode` class describes a module in the AMD identifier namespace.
   * 
   * AMD modules which have no defined bare name, and thus are loaded directly by URL, 
   * do *NOT* have an associated module node.
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
     * Gets a value that indicates if this module node is detached from the hierarchy.
     * 
     * @name isDetached
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
     * @name id
     * @memberOf AbstractModuleNode#
     * @type {string?}
     * @readonly
     * @abstract
     */

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
     * @name name
     * @memberOf AbstractModuleNode#
     * @type {string?}
     * @readonly
     * @abstract
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
    // DEBUG and !Lax: 
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

      // TODO: integrate with parseAmdId?
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
      }
      
      let normalizedId = absolutizeId(singleId, this.parentId);
      
      if (isFull) {
        // Mapping.
        // TODO: RequireJS supports mapping regular modules (not initially plugin calls) to plugin calls.
        // In that case, main, below, should not be resolved (assumed normalized).
        normalizedId = this.applyMap(normalizedId);

        // Main.
        const node = this.root.get(normalizedId);
        if (node !== null) {
          normalizedId = node.mainOrSelf.id;
        }
      }

      return normalizedId;
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
        // TODO: ignoring "__proto__" property loophole...
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
        this._aliasMap[this.normalizeSingle(aliasId)] = this.normalizeSingle(mapSpec[aliasId]);
      }, this);
    },

    // TODO: document `require` functions.
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

  // #region ChildModuleNode Class
  function ChildModuleNode(name, parent, isDetached) {

    if (DEBUG && (!parent || !name)) {
      throw new Error("Invalid arguments.");
    }

    // When detached, no new configurations can be made, so reuse the parent's alias map.
    const aliasMap = isDetached ? parent._aliasMap : Object.create(parent._aliasMap);

    AbstractModuleNode.call(this, aliasMap);

    this.__id = composeIds(parent.id, name);
    this.__name = name;
    this.__parent = parent;
    this.__root = parent.root;
    this.__isDetached = !!isDetached;
    
    // ---
    // Configuration properties.
    this.config = null;

    // Package main
    this.__main = null;
    
    // The fixed path, if any.
    this.__fixedPath = null;
    // `null` means no fixed path was defined for self of any of the ascendant nodes (except root).
    this.__cachedPath = undefined;

    // ---

    if (!isDetached) {
      this.__root.__indexNode(this);
      parent.__addChild(this);
    }
  }

  classExtend(ChildModuleNode, AbstractModuleNode, {
    /** @override */
    get isRoot() {
      return false;
    },

    /** @override */
    get root() {
      return this.__root;
    },

    /** @override */
    get isDetached() {
      return this.__isDetached;
    },

    __assertAttached: function() {
      if (this.isDetached) {
        throw new Error("Operation invalid on dettached module nodes.");
      }
    },

    /** @override */
    get id() {
      return this.__id;
    },

    /** @override */
    get parent() {
      return this.__parent;
    },

    /** @override */
    get parentId() {
      return this.__parent !== null ? this.__parent.id : null;
    },

    /** @override */
    get name() {
      return this.__name;
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
     * Sets the main module of this module.
     * 
     * @param {string?} relativeId - A relative identifier to the main sub-module of this module.
     * The identifier is considered relative to this module,
     * even when a bare name (without starting with `./`).
     * If the value has the extension `.js`, it is removed.
     * 
     * @see ChildModuleNode#main
     */
    setMain: function(relativeId) {
      // TODO: "foo/bar/main/.js" ?
      // TODO: can main be a plugin?
      
      this.__assertAttached();

      this.__main = relativeId
        ? this.getRelative(this.normalizeSingle(removeJsExtension(relativeId)), true)
        : null;
    },

    /**
     * Gets this modules's bundle module, if any; this module, otherwise.
     * 
     * @type {ChildModuleNode}
     * @readonly
     */
    get bundleOrSelf() {
      // TODO bundleOrSelf
      return this;
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

      value = value ? removeTrailingSlash(value) : null;
      
      // Check if changed.
      if (this.__fixedPath !== value) {
        this.__fixedPath = value;
        this.__invalidatePath();
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

    /**
     * Gets the URL of this module.
     * 
     * @type {string}
     * @readonly
     */
    get url() {
      const root = this.root;
      
      
      const path = this.path;
      if (path === null) {
        // TODO: WIP
      }

      // TODO: URL adds .JS to the path...
      let url = path + ".js";
      
      // "//foo", "/foo" or "http://foo".
      if (!isAbsoluteUrlWeak(url)) {
        url = (root.baseUrl || "./") + url;
      }

      const urlArgs = root.urlArgs;
      if (urlArgs !== null) {
        url += urlArgs(this.id, url);
      }
      
      return url;
    },

    __invalidatePath: function() {
      
      this.__cachedPath = undefined;

      const children = this.children;
      if (children !== null) {
        children.forEach(function(child) {
          if (child.fixedPath === null) {
            child.__invalidatePath();
          }
        });
      }
    },

    __buildPath: function() {
      
      const fixedPath = this.fixedPath;
      if (fixedPath !== null) {
        return fixedPath;
      }

      const parent = this.parent;

      // TODO: Should there be a flag to enable the URL of top-level nodes to fallback to their `name`?
      // Do not allow top-level modules without a fixed path.
      if (parent.isRoot) {
        return null;
      }
      
      // Propagate `null` to child modules.
      const parentPath = parent.path;
      return parentPath && (parentPath + "/" + this.name);
    },

    /** @override */
    _createRequire: function() {
      return createRequire(this);
    }
  });

  function createRequire(refNode) {

    const rootNode = refNode.root;

    return objectCopy(require, {
      // TODO: isBrowser flag
      isBrowser: true,

      toUrl: function(moduleNamePlusExt) {
        // TODO: require.toUrl
      },

      // As soon as the exports object is created and
      // the module is loading or has been loaded.
      defined: function(id) {
        // TODO: require.defined
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
        // TODO: require.specified
        // return rootNode.get(refNode.normalize(id)) !== null;
      }
    });

    // ---

    function require(deps, callback, errback) {
      
      if (Array.isArray(deps)) {
        // TODO: require asynchronous interface.

        return require;
      }
  
      // Synchronous interface. 
      // TODO: require sync interface; throw if not loaded yet.
      const id = deps;

      // TODO: require sync interface; resolve.
      return rootNode._systemJS.get(id);
    }
  }
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
     * The base URL for relative paths.
     * 
     * The default is `"./"`.
     * 
     * @type {string?}
     * @private
     */
    this.__baseUrl = null;

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

  classExtend(RootModuleNode, AbstractModuleNode, {
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
    get id() {
      return null;
    },

    /** @override */
    get parent() {
      return null;
    },

    /** @override */
    get parentId() {
      return null;
    },

    /** @override */
    get name() {
      return null;
    },

    get baseUrl() {
      return this.__baseUrl;
    },

    set baseUrl(value) {
      this.__baseUrl = value ? ensureTrailingSlash(value) : null;
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

    // @internal
    __indexNode: function(node) {
      if (DEBUG && this.get(node.id) !== null) {
        throw new Error("A node with id '" + node.id + "' is already defined.");
      }

      this.__byId[node.id] = node;
    },

    configure: function(config) {

      const baseUrl = config.baseUrl;
      if (baseUrl !== undefined) {
        this.basePath = baseUrl;
      }
  
      const urlArgs = config.urlArgs;
      if (urlArgs !== undefined) {
        this.urlArgs = urlArgs;
      }
      
      const packages = config.packages;
      if (packages) {
        packages.forEach(function(packageSpec) {
          if (packageSpec) {
            if (typeof packageSpec === "string") {
              packageSpec = {name: packageSpec};
            }

            this.getOrCreate(this.normalizeSingle(packageSpec.name))
              .configPackage(packageSpec);
          }
        }, this);
      }

      eachOwn(config.paths, function(pathSpec, id) {
        if (pathSpec) {
          this.getOrCreate(this.normalizeSingle(id))
            .configPath(pathSpec);
        }
      }, this);
      
      eachOwn(config.map, function(mapSpec, id) {
        if (mapSpec) {
          const node = id === STAR
            ? this
            : this.getOrCreate(this.normalizeSingle(id));
          
          node.configMap(mapSpec);
        }
      }, this);

      // TODO: config
      // TODO: shim
      // TODO: bundles
    },

    /** @override */
    _createRequire: function() {
      return createRootRequire(this);
    }
  });
  
  // ---

  function createDefine(rootNode) {

    define.amd = {};

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

      rootNode._systemJS._queueAmdDef(id, deps, execute);
    }
  }

  function createRootRequire(rootNode) {

    const baseRequire = createRequire(rootNode);
    
    return objectCopy(objectCopy(rootRequire, baseRequire), {
      config: function(cfg) {
        return rootRequire(cfg);
      },

      undef: function(id) {
        // TODO: undef
      }
    });

    // Unlike local require functions, accepts a config, object argument.
    function rootRequire(deps, callback, errback, optional) {
      
      const isString = typeof deps === "string";
      if (!isString && !Array.isArray(deps)) {
        
        // require({}, [], function)
        // require({}, [], function, function)
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
        } else {
          deps = [];
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
    
    // TODO: trimDots...

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

  // "/a" - origin relative 
  // "//a" - protocol relative
  // "http://" - absolute
  function isAbsoluteUrlWeak(text) {
    return !!text && (text[0] === "/" || RE_URL_PROTOCOL.test(text));
  }

  function parseAmdId(id) {
    const index = id.indexOf("!");
    if (index >= 0) {
      return {
        isPluginCall: true,
        id: id.substring(0, index),
        resource: id.substring(index + 1) || null
      };
    }

    return {
      isPluginCall: false,
      id: id,
      resource: undefined
    };
  }
  // #endregion

  (function initGlobal() {
    
    const globalSystemJS = global.System;

    // TODO: Validate existence of registerRegistry lazily, to make this extra script load order independent.
    // Include extras/named-register.js.
    if (!globalSystemJS.registerRegistry) {
      throw Error("Include the named register extra for SystemJS named AMD support.");
    }
    
    // Replace the constructor of the only instance of SystemJS, System.
    // This is needed because others have explicitly set a local constructor property on System.
    // Otherwise, the proper value would be inherited via __proto__.
    globalSystemJS.constructor = AmdSystemJS;

    globalSystemJS._initAmd();

    // Publish in global scope.
    // TODO: Always overwrite define, require? Keep backup?
    global.define = globalSystemJS.amd.define;
    global.require = global.requirejs = globalSystemJS.amd.require;
  })();

})(typeof self !== 'undefined' ? self : global);
