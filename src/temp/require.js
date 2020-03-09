/*
 * Support for AMD.
 *
 * Caveats:
 * - 
 * // - loader.prepareImport() : Promise<>
// - loader.import(id, parentUrl)
//   - loader.prepareImport()
//   - loader.resolve(id, parentUrl)
//   - loader.getOrCreateLoad(resolvedId, parentUrl) -> moduleLoad
//     - loader[REGISTRY][resolvedId] = moduleLoad = {...};
//     - Promise defer
//     - loader.instantiate(resolvedId, parentUrl) -> registration
//     - let moduleDef = registration.declare(_export, _context);
//     - for each registration.depsId
//       - loader.resolve(depId, id)
//       - loader.getOrCreateLoad(resolvedDepId, id) -> depModuleLoad
//       - wait for dependency _instantiate_ is finished.
//       - if depSetter, call it, so that parent module gets the exports.
//   - topLevelLoad
//      - linkAll
//        - wait linking of all 
//
// - loader.instantiate(id, parentUrl) : [depIds, declare] (register array)
//
//    function declare(_export, _context) {
//      return {
//        setters: [...depSetters...],
//        execute: function() {
// 
//        }
//      };
//    }
 */
(function(global) {

  const DEBUG = true;
  const O_HAS_OWN = Object.prototype.hasOwnProperty;
  const REQUIRE_EXPORTS_MODULE = ["require", "exports", "module"];
  const OVERRIDDEN_PROPS = ["resolve", "instantiate", "getRegister"];
  const EMTPY_REGISTER = [[], function() { return {}; }];
  const STAR = "*";
  const RE_JS_EXT = /\.js$/i;
  const RE_URL_PROTOCOL = /^[\w\+\.\-]+:/i
  
  // ---

  if (!global.System.registerRegistry) {
    throw Error("Include the named register extra for SystemJS named AMD support.");
  }

  /**
   * The `SystemJS` class.
   * 
   * @name SystemJS
   * @class
   */
  // SystemJS, as it is before loading this script.
  const SystemJSBase = global.System.constructor;
  
  // A copy of the methods of the SystemJS prototype which will be overridden.
  const base = captureBasePrototype(SystemJSBase);

  // ---
  
  /**
   * The `AmdSystemJS` class.
   * 
   * @name AmdSystemJS
   * @extends SystemJS
   * @class
   */
  function AmdSystemJS() {

    SystemJSBase.call(this);
    
    this._initAmd();
  }
  
  extendSystemJS(/** @lends AmdSystemJS# */{

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
     * @param {string} [type="warn"] - The type of log entry.
     * @protected
     */
    _log: function(text, type) {
      const method = type || "warn";
      console[method](text);
    },

    /** @override */
    resolve: function(id, parentUrl) {
      try {
        // Give precedence to other resolution strategies.
        return base.resolve.apply(this, arguments);

      } catch (error) {

        // TODO: normalize???
        const resolvedId = this.amd.normalize(id, parentUrl);

        // TODO: Check has path/bundle or throw.
        return resolvedId
        // throw error;
      }
    },

    /** @override */
    instantiate: function(resolvedId, parentUrl) {

      let loadUrl = resolveId;

      // When AMD.
      let node = null;
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
          return this._instantiatePluginCall(idInfo.id, idInfo.resource, parentUrl);
        }

        // Get or create the AMD node. Must be a child node.
        node = this.amd.nodeById(idInfo.id, true);
        loadNode = node.bundleOrSelf;

        loadUrl = loadNode.getLoadUrl();
      }

      return Promise.resolve(base.instantiate.call(this, loadUrl, parentUrl))
        .then(this.__instantiateEnd.bind(this, node, loadNode, loadUrl));
    },

    _instantiatePluginCall: function(pluginId, resourceId, parentUrl) {

      // Unfortunately, `pluginId` will be resolved, again.
      return this.import(pluginId, parentUrl)
        .then(this._instantiatePluginCallEnd.bind(this, pluginId, resourceId, parentUrl));
    },

    _instantiatePluginCallEnd: function(pluginId, resourceId, parentUrl, plugin) {

      let id = pluginId + "!" + (resourceId || "");

      // Determine the identifier of the dependent module (parentUrl), if AMD.
      let dependentId = parentUrl != null ? this._urlToId(parentUrl) : null;
      let dependentModule = dependentId !== null ? this.amd.nodeById(dependentId, true) : this.amd;

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

        plugin.load(resourceId, dependentModule.require, onLoadCallback, config);
      });
    },

    // Id cannot be that of an AMD loader plugin call, as these don't really have a URL...
    // If URL is that of a bundle, it must have a fragment such as `#!mid=original/bundled/module`,
    // or the returned module identifier is that of the bundle itself.
    // If URL is the result of a previous `resolve` operation, looking up the inverse resolutions map immediately yields the result.
    // Otherwise, must go through: `map`, `paths`, `bundles`, `packages`.
    // Ultimately, if no correspondence is found, null is returned.
    _urlToId: function(url) {
      // TODO: implement me!!
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
        this.__forcedGetRegister = null;
      }
    },

    /** 
     * Handles the end phase of instantiation of either a URL or 
     * a _normal_ AMD module (i.e. not a loader plugin module).
     * 
     * Processes any queued AMD `define` calls by creating and registering corresponding SystemJS registers.
     * 
     * If any AMD modules are processed and if an AMD module had been requested, 
     * as represented by the given `node` argument, 
     * then this module's SystemJS register is read from the named registry and returned.
     * Otherwise, if an anonymous AMD module is processed, its SystemJS register is returned.
     * Otherwise, the SystemJS register in argument `register` is returned.
     * Lastly, if this is `null`, an empty SystemJS register is returned.
     * 
     * It is expected that a script file contains either AMD or SystemJS definitions.
     * 
     * @param {ChildModuleNode?} node - The AMD child node being instantiated, or `null`, if none.
     * @param {ChildModuleNode?} loadNode - The AMD child node being loaded, or `null`, if none.
     * When the node being instantiated is provided by a bundle file, 
     * then this will be the bundle module node. Otherwise, it is identical to the `node` parameter.
     * @param {string} loadUrl - The URL of the file being loaded.
     * @param {Array?|undefined} register - The SystemJS register returned by 
     * the base implementation, {@link SystemJS#instantiate}.
     * 
     * @return {Array} A SystemJS register.
     * @private
     */
    __instantiateEnd: function(node, loadNode, loadUrl, register) {

      // Process any queued AMD definitions.
      const anonymousAmdRegister = this.__processAmdDefs(loadNode, loadUrl);

      // Get the initially desired AMD module.
      if (node !== null) {
        // TODO: throw if not defined after all?
        return this.__getByName(node.id);
      }
      
      return anonymousAmdRegister || register || EMTPY_REGISTER;
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
     * @param {ChildModuleNode?} loadNode - The AMD child node being laoded, or `null`, if none.
     * @param {string} loadUrl - The URL of the file being loaded.
     * 
     * @return {Array|undefined} The first anonymous AMD register, if any was processed; `undefined`, otherwise.
     * @private
     */
    __processAmdDefs: function(loadNode, loadUrl) {
      
      let amdDef;
      let firstAnonymousRegister = undefined;

      while((amdDef = this.__amdDefQueue.shift()) !== undefined) {
        
        const anonymousRegister = this.__processAmdDef(loadNode, loadUrl, amdDef.id, amdDef.deps, amdDef.execute);

        if (firstAnonymousRegister === undefined && anonymousRegister !== undefined) {
          firstAnonymousRegister = anonymousRegister;
        }
      }

      return firstAnonymousRegister;
    },

    /**
     * Processes an AMD (module definition).
     * 
     * @param {ChildModuleNode?} loadNode - The AMD child node being laoded, or `null`, if none.
     * @param {string} loadUrl - The URL of the file being loaded.
     * @param {string?} id - The AMD identifier of the AMD (definition).
     * @param {Array.<string>} deps - An array of AMD references of the dependencies of the AMD (definition).
     * @param {function} execute - The AMD factory function.
     * 
     * @return {Array|undefined} The created AMD register, if it is anonymous; `undefined`, otherwise.
     * @private
     */
    __processAmdDef: function(loadNode, loadUrl, id, deps, execute) {
      
      // Capture id from loading AMD module, if any.
      let fullyNormalizedId = null;
      if (id !== null) {
        fullyNormalizedId = this.amd.normalize(id, true);
      } else if (loadNode !== null) {
        fullyNormalizedId = loadNode.id;
      }

      if (fullyNormalizedId !== null && this.__getByName(fullyNormalizedId) !== null) {
        this._log("Module '" + fullyNormalizedId + "' is already defined.", "warn");
        return undefined;
      }

      const node = fullyNormalizedId !== null ? this.amd.nodeById(fullyNormalizedId, true) : null;

      if (DEBUG && node !== null && node.isRoot) {
        throw new Error("Invalid state.");
      }

      let amdRegister = this.__createAmdRegister(loadUrl, node, deps, execute);
      
      // Need to let `amdRegister` be processed by any subclasses.
      amdRegister = this._processRegister(amdRegister);
      
      if (fullyNormalizedId !== null) {
        this.registerRegistry[fullyNormalizedId] = amdRegister;
        return undefined;
      }

      return amdRegister;
    },

    /**
     * Creates a SystemJS register for an AMD (module definition).
     * 
     * @param {string} loadUrl - The URL of the file being loaded.
     * @param {ChildModuleNode?} node - The AMD child node of the named module being defined, or `null`, if the module is anonymous.
     * @param {Array.<string>} depRefs - An array of AMD references of the dependencies of the AMD (definition).
     * @param {function} execute - The AMD factory function.
     * @return {Array} A SystemJS register.
     * @private
     */
    __createAmdRegister: function(loadUrl, node, depRefs, execute) {
      
      const exports = {};
      const module = {
        id: node && node.id,
        uri: loadUrl,
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

      const refNode = node ? node.parent : this.amd;

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
          // Simple normalization gets rid of relative references.
          registerDepIds.push(refNode.normalize(depRef));
          registerDepSetters.push(createDepSetter(depValues, i));
        }
      }

      const amdRegister = [registerDepIds, declareAmd];
      if (module.id !== null) {
        amdRegister.unshift(module.id);
      }

      return amdRegister;
      
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
  
  initGlobal();

  // ---

  function captureBasePrototype(SystemJSBase) {
    const systemJSPrototype = SystemJSBase.prototype;
    const basePrototype = Object.create(null);
    
    OVERRIDDEN_PROPS.forEach(function(p) {
      basePrototype[p] = systemJSPrototype[p];
    });
    
    return basePrototype;
  }

  // Replace SystemJSBase with the locally declared SystemJS.
  // Hijack its prototype and use it for SystemJS.
  // Replace the constructor of the only instance of SystemJSBase, System.
  function extendSystemJS(spec) {
    const systemJSPrototype = SystemJSBase.prototype;
    systemJSPrototype.constructor = AmdSystemJS;
    AmdSystemJS.prototype = systemJSPrototype;

    objectCopy(systemJSPrototype, spec);
  }

  function initGlobal() {
    
    const globalSystemJS = global.System;
    
    // TODO: this should not be needed, as is already done in `systemJSPrototype.constructor`,
    // and `constructor` is inherited via __proto__.
    globalSystemJS.constructor = AmdSystemJS;

    globalSystemJS._initAmd();

    // Publish in global scope.
    // TODO: Always overwrite? Keep backup?
    global.define = globalSystemJS.amd.define;
    global.require = globalSystemJS.amd.require;
  }
  
  // ---

  // #region Module Node Classes

  /**
   * @classdesc The `AbstractModuleNode` class describes a node in the AMD identifier namespace.
   * 
   * @name AbstractModuleNode
   * @class
   * 
   * @description Constructs a node.
   * @constructor
   * @param {string} name - The name of the node
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
    this._aliasMap = aliasMap || Object.create(null);

    /**
     * Gets the array of child nodes.
     * 
     * @type {Array.<ChldModuleNode>}
     * @readonly
     */
    this.children = [];

    /**
     * Gets the map of child nodes by their name.
     * 
     * @type {Object.<string, ChldModuleNode>}
     * @readonly
     * @private
     */
    this.__byName = Object.create(null);

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
     * Gets a value that indicates if this node is a root node.
     * 
     * @name isRoot
     * @memberOf AbstractModuleNode#
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
     * @memberOf AbstractModuleNode#
     * @type {RootModuleNode}
     * @readonly
     * @abstract
     */

    /**
     * Gets the identifier of this node, if any; `null`, otherwise.
     * 
     * @name id
     * @memberOf AbstractModuleNode#
     * @type {string?}
     * @readonly
     * @abstract
     */

    /**
     * Gets the parent node of this node, if any; `null`, otherwise.
     * 
     * @name parent
     * @memberOf AbstractModuleNode#
     * @type {AbstractModuleNode?}
     * @readonly
     * @abstract
     */

    /**
     * Gets the name by which this node is known by its parent node, 
     * if any; `null`, otherwise.
     * 
     * @name name
     * @memberOf AbstractModuleNode#
     * @type {string?}
     * @readonly
     * @abstract
     */

    /**
     * Gets the child module with the given name, creating it if desired.
     * 
     * @param {string} name - The name of the child node.
     * @param {boolean} [createIfMissing=false] - Indicates that a child node with 
     * the given name should be created, if one does not exist.
     * 
     * @return {ChildModuleNode?} The child node, if any; `null` otherwise.
     */
    childByName: function(name, createIfMissing) {
      let child = getOwn(this.__byName, name) || null;
      if (child === null && createIfMissing) {
        child = new ChildModuleNode(name, this);
      }

      return child;
    },

    /** 
     * Adds the given child node to the list of children.
     * 
     * @param {ChildModuleNode} child - The child node.
     * @private
     * @internal
     */
    __addChild: function(child) {

      if (DEBUG && (child.parent !== this || this.childByName(child.name))) {
        throw new Error("Invalid argument.");
      }

      this.children.push(child);
      this.__byName[child.name] = child;
    },

    // @virtual
    nodeByRelativeId: function(normalizedRelativeId, createIfMissing) {
      
      let parent = this;

      const names = normalizedRelativeId.split("/");
      const L = names.length;
      let i = -1;
      while ((++i < L) && (node = parent.childByName(names[i], createIfMissing)) !== null) {
        parent = node;
      }
      
      return node;
    },

    // Supports Amd plugins.
    normalize: function(id, isFull, isLax) {
      if (isLax) {
        if (!id) {
          return null;
        }
      } else if(DEBUG) {
        if (!id) {
          throw new Error("Invalid empty id.");
        }
      }
      

      // TODO: integrate with parseAmdId?
      let normalizedId;
      let resourceId = null;

      const index = id.indexOf("!");
      const isPlugin = index !== -1;
      if (isPlugin) {
        normalizedId = id.substring(0, index);
        resourceId = id.substring(index + 1);
      } else {
        normalizedId = id;
      }

      normalizedId = this.normalizeSingle(normalizedId, isFull, isLax);
      
      // Compose.
      return isPlugin
        ? (normalizedId + "!" + absolutizeId(resourceId, this.id))
        : normalizedId;
    },

    // Does not support Amd plugin identifiers (e.g. "css!./styles").
    // Resolves "./" and "../" relative to this node's identifier.
    // - Throws on going above this node's id.
    // Strict / NonLax
    // - Throws on STAR.
    // - Throws on empty.
    // - Throws on containing "!".
    // Full normalization:
    // - applies maps
    // - resolves package main
    // isLax: allows "*" and the "!" character; for use in resource ids.
    normalizeSingle: function(id, isFull, isLax) {
      
      if (isLax) {
        if (!id) {
          return null;
        }
      } else if(DEBUG) {
        if (!id) {
          throw new Error("Invalid empty id.");
        }

        if (id === STAR) {
          throw new Error("Invalid id '" + STAR + "'.");
        }
  
        if (id.indexOf("!") >= 0) {
          throw new Error("Non-plugin id expected. Got '" + id + "'.");
        }
      }
      
      let normalizedId = absolutizeId(id, this.id);
      
      if (isFull) {
        // Mapping.
        normalizedId = this.applyMap(normalizedId);

        // Main.
        const node = this.root.nodeById(normalizedId);
        if (node !== null) {
          normalizedId = node.mainOrSelf.id;
        }
      }

      return normalizedId;
    },

    /**
     * Applies mapping configurations to a given normalized identifier and 
     * returns the mapped identifier.
     * 
     * When no mapping configurations apply to the given identifier,
     * it is returned unchanged.
     * 
     * @param {string} normalizedId - A normalized identifier.
     * @return {string} The mapped identifier, possibly identical `normalizedId`.
     */
    applyMap: function(normalizedId) {
     
      // For each prefix of normalizedId
      //   For each contextNode in this...root
      //     "a/b/c" -> "a/b" -> "*"

      let prefixId = normalizedId;
      let prefixIndex = -1;
      while (true) {
        // TODO: ignoring "__proto__" property loophole...
        const resolvedPrefixId = this.__aliasMap[prefixId];
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

    configMap: function(mapSpec) {

      Object.keys(mapSpec).forEach(function(aliasId) {
        this.__aliasMap[this.normalizeSingle(aliasId)] = this.normalizeSingle(mapSpec[aliasId]);
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

  // ---

  function ChildModuleNode(name, parent) {

    if (DEBUG && (!parent || !name)) {
      throw new Error("Invalid arguments.");
    }

    const aliasMap = Object.create(parent._aliasMap);

    AbstractModuleNode.call(this, aliasMap);

    this.__id = composeIds(parent.id, name);
    this.__name = name;
    this.__parent = parent;
    this.__root = parent.root;
    
    // ---
    // Configuration properties.
    this.config = null;

    // Package main
    this.__main = null;
    
    // The fixed path, if any.
    this.__fixedPath = null;
    this.__cachedPath = null;

    // ---

    this.__root.__indexNode(this);
    parent.__addChild(this);
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
    get id() {
      return this.__id;
    },

    /** @override */
    get parent() {
      return this.__parent;
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

      this.__main = relativeId  
        ? this.nodeByRelativeId(this.normalizeSingle(removeJsExtension(relativeId)), true)
        : null;
    },

    /**
     * Gets this modules's bundle module, if any; this module, otherwise.
     * 
     * @type {ChildModuleNode}
     * @readonly
     */
    get bundleOrSelf() {
      // TODO
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

      value = value ? removeTrailingSlash(value) : null;
      
      // Check if changed.
      if (this.__fixedPath !== value) {
        this.__fixedPath = value;
        this.__invalidatePath();
      }
    },

    /**
     * Gets the effective path of this module.
     * 
     * When {@link ChildModuleNode#fixedPath} is specified, it is returned.
     * Otherwise, the path is built from the parent module's [path]{@link ChildModuleNode#path} 
     * and this module's [name]{@link AbstractModuleNode#name}.
     * 
     * @type {string}
     * @readonly
     */
    get path() {
      if (this.__cachedPath === null) {
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
      
      let url = this.path + ".js";
      
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
      
      this.__cachedPath = null;

      this.children.forEach(function(child) {
        if (child.fixedPath === null) {
          child.__invalidatePath();
        }
      });
    },

    __buildPath: function() {
      
      const fixedPath = this.fixedPath;
      if (fixedPath !== null) {
        return fixedPath;
      }

      const parent = this.parent;
      
      return parent.isRoot
        ? this.name 
        : (parent.path + "/" + this.name);
    },

    /** @override */
    _createRequire: function() {
      return createRequire(this);
    }
  });

  // ---

  function RootModuleNode(systemJS) {

    AbstractModuleNode.call(this);
    
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

  const baseNodeByRelativeId = AbstractModuleNode.prototype.nodeByRelativeId;

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
    get id() {
      return null;
    },

    /** @override */
    get parent() {
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
    nodeByRelativeId: function(normalizedRelativeId, createIfMissing) {
      
      let node = getOwn(this.__byId, normalizedRelativeId) || null;
      if (node === null && createIfMissing) {
        node = baseNodeByRelativeId.apply(this, arguments);
      }

      return node;
    },

    nodeById: function(normalizedId, createIfMissing) {
      return this.nodeByRelativeId(normalizedId, createIfMissing);
    },

    // @internal
    __indexNode: function(node) {
      if (DEBUG && this.nodeById(node.id) !== null) {
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

            this.nodeById(this.normalizeSingle(packageSpec.name), true)
              .configPackage(packageSpec);
          }
        }, this);
      }

      eachOwn(config.paths, function(pathSpec, id) {
        var pathSpec = paths[id];
        if (pathSpec) {
          this.nodeById(this.normalizeSingle(id), true)
            .configPath(pathSpec);
        }
      }, this);
      
      eachOwn(config.map, function(mapSpec, id) {
        if (mapSpec) {
          const node = id === STAR
            ? this
            : this.nodeById(this.normalizeSingle(id), true);
          
          node.configMap(mapSpec);
        }
      }, this);

      // TODO: Config
      // TODO: Shim
      // TODO: Bundles
    },

    /** @override */
    _createRequire: function() {
      return createRootRequire(this);
    }
  });
  // #endregion

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

      rootNode._systemJs._queueAmdDef(id, deps, execute);
    }
  }

  function createRootRequire(rootNode) {

    const baseRequire = createRequire(rootNode);
    
    return objectCopy(objectCopy(rootRequire, baseRequire), {
      config: function(cfg) {
        return rootRequire(cfg);
      },

      undef: function(id) {
        // TODO
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

  function createRequire(parentNode) {

    const rootNode = parentNode.root;

    return objectCopy(require, {
      // TODO
      isBrowser: true,

      toUrl: function(moduleNamePlusExt) {
        // TODO
      },

      // As soon as the exports object is created and
      // the module is loading or has been loaded.
      defined: function(id) {
        // TODO
      },

      // There is a node for it?
      // 1. Normalize id.
      //    1.1. If there is a plugin in it:
      //      1.1.1. If the plugin is loaded and has a normalize method then use it to normalize resource name.
      //      1.1.2. If the resource name has no "!" then normalize resource name normally.
      //      1.1.3. Else, do not normalize name.
      //    1.2. Else, normalize id normally.
      // 2. Apply mapping to id.
      specified: function(id) {
        // TODO
        return rootNode.nodeById(parentNode.normalize(id), false) !== null;
      }
    });

    // ---

    function require(deps, callback, errback) {
      
      if (Array.isArray(deps)) {
        // Asynchronous interface.

        return require;
      }
  
      // Synchronous interface. 
      // TODO: Throw if not loaded yet.
      const id = deps;

      // TODO: resolve.
      return rootNode._systemJS.get(id);
    }
  }

  function createDepSetter(depValues, depIndex) {
    return function depSetter(ns) {
      depValues[depIndex] = ns.__useDefault ? ns.default : ns;
    };
  }

  // #region Utilities

  function constantFun(value) {
    return function() {
      return value;
    };
  }

  function getOwn(o, p) {
    return O_HAS_OWN.call(o, p) && o[p];
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
      if(desc !== undefined) {
        Object.defineProperty(to, p, desc);
      }
    }

    return to;
  }

  function classExtend(Sub, Base, subSpec) {
    Sub.prototype = Object.create(Base.prototype);
    Sub.prototype.constructor = Sub;
    if (subSpec) {
      objectCopy(Sub.prototype, subSpec);
    }

    return Sub;
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

})(typeof self !== 'undefined' ? self : global);
