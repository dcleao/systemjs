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

  "use strict";

  const DEBUG = true;
  const O = Object;
  const O_HAS_OWN = prototype(O).hasOwnProperty;
  const REQUIRE_EXPORTS_MODULE = ["require", "exports", "module"];
  const EMPTY_AMD_REGISTER = constantRegister();
  const MAP_SCOPE_ANY_MODULE = "*";
  const isArray = Array.isArray;

  const JS_EXT = ".js";
  const RE_JS_EXT = /\.js$/i;

  // Absolute or Protocol Relative or Origin Relative
  const RE_URL_ABSOLUTE = /^\/|[\w+.\-]+:/i;
  const RE_URL_BLOB = /^blob:/i;
  const RE_URL_DATA_OR_BLOB = /^(data|blob):/i;
  const RE_RESOURCE_ID_UNNORMALIZED = /_unnormalized\d+$/;
  const RESOURCE_UNNORMALIZED = "_unnormalized";
  const RESOURCE_SEPARATOR = "!";
  const PATH_SEPARATOR = "/";
  const URL_MODULE_FRAGMENT = "#!mid=";
  const isBrowser = typeof window !== "undefined" && typeof navigator !== "undefined" && !!window.document;

  let unnormalizedCounter = 1;

  /**
   * Properties naming scheme to support indicating class accessibility and mangling.
   *
   * - `public` - public
   * - `_protected` - protected
   * - `__private` - private; mangled
   * - `$internal` - internal; mangled
   *
   * Can be minified using, for example:
   * ```bash
   * terser require.js
   *    -c "passes=2,keep_fargs=false"
   *    -m keep_fnames='/Node$/'
   *    --mangle-props regex='/^(__|[$])(?!useDefault)/'
   * ```
   */

  /*

  *** - MVP issue.

  General
  -------
  TODO: Check license.
  TODO: Unit tests, including cycle detection, error handling, integrate with existing tests
  TODO: Integrate with existing extras and extras build tool.
  TODO: Support for other environments (PhantomJS, Rhino?)
  TODO: Complete/Review documentation

  General Features
  ----
  TODO: trimDots -> absolutizeId ***
  TODO: Shared general config?
  TODO: RequireJS supports mapping regular modules to resource modules.
  TODO: Implement canonicalIdByUrl for Import Maps URLs.
  TODO: Flag to not overwrite define, require? Keep backup?
  TODO: Flag to allow top-level modules without a specified path (fallback to `name`)?

  Config
  ------
  TODO: config.deps, config.callback (using setTimeout to let any following extras to be installed)
        relationship with data-main and `<script type="systemjs-module" src="import:name"></script>`

  Require
  -------
  TODO: root.require.undef ***
  TODO: require.defined
  TODO: require.specified
  TODO: Fix define not working for non-global SystemJS instance.

  Loader Plugins
  --------------
  TODO: config argument ***
        - what needs to be done to maintain config on pair and will it then
          subsume the use of nodes?? RequireJS derives bundleMap and pkgs index properties
          from the config.
        - what information are known AMD plugins reading from the general config? custom config options?

  TODO: onload.fromText *** - eval text as if it were a module script being loaded
        assuming its id is resourceName.

  JS
  ---
  TODO: $warn
  TODO: "__proto__" map lookup loophole

  */

  /*

  NOT SUPPORTED
  =============

  AMD
  ---
  https://github.com/amdjs/amdjs-api

  - Modules with paths/URLs with fragments, as they're used for other purposes.
  - A dependency ending with ".js" being considered an URL and not a module identifier.
    - The top-level require's `jsExtRegExp` property; used to filter out dependencies that are already URLs.
    - This is required for interoperability with ES6 modules ".js".
  - Being able to `map` a simple identifier to a resource identifier.
  - Being able to specify `paths` fallbacks; when an array is provided, only the first value is considered.
  - Being able to shim a resource module.

  RequireJS
  ---------
  https://requirejs.org

  - CommonJS-style factory: detection of `require(.)` dependencies in factory function code, using `toString`.
  - require.defined/specified ? Are these worth it?
  - require.onError, require.createNode, require.load
  - error.requireModules on error handlers allowing to undef and then retry loading of modules with different config/paths,
    allowing functionality equivalent to paths fallbacks
    (https://requirejs.org/docs/api.html#errbacks)
  - config.nodeRequire / all special NodeJS/CommonJS features
  - Environments such as: PSn, Opera...
  - Creating new require contexts.
  - Specifying `data-main` in the `script` element used to load the AMD/RequireJS extra;
    the `skipDataMain` configuration property is also not supported.
    -> It's equivalent to add <script type="systemjs-module" src="import:name"></script>
  */

  // ---

  // SystemJS, as it is before loading this script.

  /**
   * The `SystemJS` class.
   *
   * @name SystemJS
   * @class
   */
  const SystemJS = global.System.constructor;

  // region AmdSystemJS class

  // A copy of the methods of the SystemJS prototype which will be overridden.
  const base = assignProps({}, prototype(SystemJS), ["_init", "resolve", "instantiate", "getRegister"]);

  /**
   * The information of an AMD `define` call.
   *
   * @typedef {({id: ?string, deps: ?Array.<string>, execute: function})} AmdInfo
   */

  /**
   * The AMD shim configuration.
   *
   * @typedef {({exports: ?string, deps: ?Array.<string>, init: ?function})} AmdShimConfig
   */

  /**
   * The AMD module object.
   *
   * The type of the special AMD "module" dependency.
   *
   * @typedef {({id: ?string, uri: string, config: object, exports: *})} AmdModule
   */

  /**
   * A regular node is a (non-abstract) child node which is _not_ a resource node.
   *
   * @typedef {SimpleNode | AnonymousNode} RegularNode
   */

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
   * For these cases, missing nodes can be obtained _dettached_ from the hierarchy.
   *
   * @name AmdSystemJSMixin
   * @class
   * @mixin
   */

  objectCopy(prototype(SystemJS), /** @lends AmdSystemJSMixin# */{

    /** @override */
    _init: function() {

      base._init.call(this);

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
       * Queue of AMD definitions added during the load of a script file
       * and which are pending processing.
       *
       * Filled in by calling the {@link AmdSystemJSMixin#$queueAmd} method.
       *
       * @memberOf AmdSystemJSMixin#
       * @type {Array.<AmdInfo>}
       * @readonly
       * @private
       */
      this.__amdQueue = [];

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
        return base.resolve.apply(this, arguments);

      } catch (error) {
        // No isAbsoluteUrl URLs here!
        if (DEBUG && isAbsoluteUrl(specifier)) {
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
      if (DEBUG && !isAbsoluteUrl(loadUrl)) {
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
        return Promise.resolve(base.instantiate.call(this, loadUrl, referralUrl))
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

      return base.getRegister.call(this);
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

      const queue = this.__amdQueue;
      if (length(queue) > 0) {
        const scriptNode = getScriptNode();
        let amdInfo;
        while((amdInfo = queue.shift()) !== undefined) {
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
      this.__amdQueue.push({id: id, deps: deps, execute: execute});
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

      if (DEBUG) {
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
    }
  });
  // endregion

  // region AbstractNode Class

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
   *          |
   *          +- SimpleNode
   *          |   .fixedPath: string?         [.path, .configPath(.), .configPackage(.)]
   *          |   .main:      SimpleNode?     [.configPackage(.)]
   *          |   .shim       {deps, factory} [.configShim(.)]
   *          |   .config:    object?         [.configConfig(.)]
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
  function AbstractNode(aliasMap) {

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

      if (DEBUG && (child.parent !== this || this.childByName(child.name))) {
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
    // When DEBUG and !Lax:
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
      } else if (DEBUG) {
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
      } else if (DEBUG) {
        assertSimple(simpleId);
      }

      let normalizedId = absolutizeId(removeJsExtension(simpleId), this.parentId);

      if (isFull) {

        // Mapping.
        normalizedId = this.applyMap(normalizedId);

        // For now, assuming map cannot return a resource identifier.
        if (DEBUG) {
          assertSimple(normalizedId);
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
        this._aliasMap[assertSimple(aliasId)] = assertSimple(mapSpec[aliasId]);
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

  // endregion

  // region AbstractChildNode Class
  /**
   * @class
   * @extends AbstractNode
   * @abstract
   */
  function AbstractChildNode(parent, aliasMap) {

    AbstractNode.call(this, aliasMap);

    this.__parent = parent;
    this.__root = parent.root;

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
      if (DEBUG && this.__amdModule) {
        throw createError("Invalid State!");
      }

      const url = this.url;
      let hasExports = false;
      let exports;

      /** @type AmdModule */
      const amdModule = {
        // NOTE: that the AMD module utilizes the leaf identifier!
        // Per RequireJS, when there is no AMD context,
        // the id of a "module" dependency is its URL.
        id: (this.leafId || url),
        uri: url,

        config: function() {
          return this.config || {};
        }.bind(this),

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
  // endregion

  // region AnonymousNode Class
  /**
   * @class
   * @extends AbstractChildNode
   */
  function AnonymousNode(url, parent) {

    if (DEBUG && !(url || parent || !parent.isRoot)) {
      throw createError("Invalid arguments.");
    }

    AbstractChildNode.call(this, parent, parent._aliasMap);

    this.__url = url;
  }

  classExtend(AnonymousNode, AbstractChildNode, /** @lends AnonymousNode# */{
    /** @override */
    get isDetached() {
      return true;
    },

    /** @override */
    getUrl: function(extension, omitFragment) {

      const url = extension ? (this.__url + extension) : this.__url;

      return this.$applyUrlArgs(url);
    },

    /** @override */
    get config() {
      return null;
    }
  });
  // endregion

  // region AbstractNamedNode Class
  /**
   * @class
   * @extends AbstractChildNode
   * @abstract
   */
  function AbstractNamedNode(name, parent, isDetached) {

    if (DEBUG && (!name || !parent)) {
      throw createError("Invalid arguments.");
    }

    // When detached, no new configurations can be made, so reuse the parent's alias map.
    const aliasMap = isDetached ? parent._aliasMap : createObject(parent._aliasMap);

    AbstractChildNode.call(this, parent, aliasMap);

    // module
    // bundle
    // plugin
    // For resources, the name is the whole id
    // plugin-id!./resource-name
    // plugin-id!./resource-name_unnormalized123
    this.__name = name;

    // parent-id/child-name
    this.__id = composeIds(parent.id, name);

    this.__isDetached = !!isDetached;

    /**
     * This node's bundle node.
     *
     * @type {?AbstractNamedNode}
     * @private
     */
    this.__bundle = null;

    if (!isDetached) {
      this.__root.$indexNode(this);
      parent.$addChild(this);
    }
  }

  classExtend(AbstractNamedNode, AbstractChildNode, /** @lends AbstractNamedNode# */{
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
     * Gets or sets this modules's bundle module.
     *
     * @type {?AbstractNamedNode}
     */
    get bundle() {
      return this.__bundle;
    },

    set bundle(value) {

      this.$assertAttached();

      const bundleNew = value || null;
      if (bundleNew !== this.__bundle) {
        this._invalidateRegularUrl(function applyChange() {
          /** @this AbstractNamedNode */
          this.__bundle = bundleNew;
        });
      }
    },

    configBundle: function(bundleSpec) {

      this.$assertAttached();

      if (bundleSpec) {
        const bundleId = this.id;
        bundleSpec.forEach(function(id) {
          if (id !== bundleId) {
            this.root.$getOrCreate(id).bundle = this;
          }
        }, this);
      }
    },

    /** @override */
    getUrl: function(extension, omitFragment) {
      const bundle = this.__bundle;
      if (bundle) {
        // bundle.js#!mid=bundle/id#!mid=bundled/module/id
        // bundle.js#!mid=bundle/id#!mid=plugin/id!resource/name
        return bundle.getUrl(extension, omitFragment) + URL_MODULE_FRAGMENT + this.leafId;
      }

      return this._getUnbundledUrl(extension, omitFragment);
    },

    /**
     * Gets the URL of the leaf module of this node,
     * for the case where it is not bundled.
     *
     * @name _getUnbundledUrl
     * @memberOf AbstractNamedNode#
     * @method
     * @param {?string} [extension] - The extension to use (e.g. `".css"`).
     * When `null`, no extension is used.
     * When `undefined`, the default extension is used (`".js"` for simple modules).
     *
     * @param {?boolean} [omitFragment=false] - Indicates that the URL fragment annotation
     * containing the module's leaf identifier should be omitted.
     *
     * @return {?string} The unbundled URL.
     *
     * @readonly
     * @abstract
     * @protected
     */

    /**
     * Called whenever the regular URL of the node may change
     * after the function `applyChange` is called.
     *
     * @param {function} [applyChange] - The function which applies a change
     * which may impact the URL value. Called with `this` as its JS context.
     *
     * @protected
     * @overridable
     *
     * @see SimpleNode#__regularUrl
     * @see RootNode#$onNodeRegularUrlChanged
     */
    _invalidateRegularUrl: function(applyChange) {
      if (applyChange) {
        applyChange.call(this);
      }
    },

    /**
     * Called when the root node's baseUrl is changed.
     * @internal
     * @overridable
     */
    $onBaseUrlChanged: function() {

      this._invalidateRegularUrl();

      this.$eachChild(function(child) {
        child.$onBaseUrlChanged();
      });
    },
  });
  // endregion

  // region SimpleNode Class
  /**
   * @class
   * @extends AbstractNamedNode
   */
  function SimpleNode(name/*, parent, isDetached*/) {

    if (DEBUG && isResourceId(name)) {
      throw createError("Resource must be child of root.");
    }

    AbstractNamedNode.apply(this, arguments);

    this.__config = null;

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
    /** @override */
    get leafId() {
      return this.id + JS_EXT;
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

    get config() {
      return this.__config;
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

    configConfig: function(config) {

      this.$assertAttached();

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
          url += URL_MODULE_FRAGMENT + this.leafId;
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
      return base.resolve.call(this.root.sys, url);
    }
  });
  // endregion

  // region ResourceNode Class
  /**
   * - normalize id issues resulting in schizophrenia upon unification?
   * - all _unnormalized_ should be created detached (although the unnormalized counter already ensures no reuse)
   *   so that only the final normalized id is registered and loaded...
   * - the problem is that for SystemJS, it will regard all unnormalized as relevant modules
   *   which will end up being registered in its url registry.
   * - when the _unnormalized_ resource module is finally loaded, it should be deleted from the registry??
   * - `require`   does not make much sense...
   * - `amdModule` does not make sense because there's never an actual AMD to read it.
   * - alias map
   *   - should work like anonymous modules.
   *   - should be child of root / have root as parent.
   *   - but then name is the whole composed id?
   *
   * @class
   * @extends AbstractNamedNode
   */
  function ResourceNode(name, parent, isDetached) {

    const isUnnormalized = isUnnormalizedId(name);

    // All unnormalized nodes are necessarily detached.
    const isDetachedEf = isUnnormalized || !!isDetached;

    AbstractNamedNode.call(this, name, parent, isDetachedEf);

    const resourceIdParts = parseResourceId(this.id);

    if (DEBUG) {
      if (!parent.isRoot) {
        throw createError("Invalid argument 'parent'.");
      }

      if (!resourceIdParts) {
        throw createError("Invalid argument 'name'.");
      }

      if (!RE_JS_EXT.test(resourceIdParts[0])) {
        throw createError("Argument 'name' is not normalized.");
      }
    }

    /**
     * The associated loader plugin node.
     *
     * @type {SimpleNode}
     * @private
     */
    this.__plugin = this.root.$getOrCreate(resourceIdParts[0], isDetachedEf);
    this.__resourceName = resourceIdParts[1];

    this.__isNormalized = !isUnnormalized;
  }

  classExtend(ResourceNode, AbstractNamedNode, /** @lends ResourceNode# */{

    // id is already a leaf id.
    /** @override */
    get leafId() {
      return this.id;
    },

    /** @override */
    get isNormalized() {
      return this.__isNormalized;
    },

    /**
     * Gets the associated loader plugin node.
     *
     * @type {SimpleNode}
     * @readonly
     */
    get plugin() {
      return this.__plugin;
    },

    /**
     * Gets the associated resource name.
     *
     * @type {string}
     * @readonly
     */
    get resourceName() {
      return this.__resourceName;
    },

    /**
     * Gets the associated original resource name.
     *
     * When the resource is normalized, returns {@link ResourceNode#resourceName}.
     * Otherwise, returns `resourceName` without the unnormalized mark -- the original resource name.
     *
     * @type {string}
     * @readonly
     */
    get $originalResourceName() {
      return this.__isNormalized ? this.__resourceName : this.__resourceName.replace(RE_RESOURCE_ID_UNNORMALIZED, "");
    },

    get $originalId() {
      return this.__isNormalized ? this.id : buildResourceId(this.__plugin.id, this.$originalResourceName);
    },

    /** @override */
    _getUnbundledUrl: function(extension, omitFragment) {
      // e.g. plugin.getUrl():
      // - unbundled: plugin.js#!mid=plugin/id
      // - bundled:   bundle.js#!mid=bundle/id#!mid=plugin/id
      // e.g. result:
      // - unbundled: plugin.js#!mid=plugin/id!resource/name
      // - bundled:   bundle.js#!mid=bundle/id#!mid=plugin/id!resource/name
      return buildResourceId(this.plugin.getUrl(extension, omitFragment), this.resourceName);
    },

    loadWithPlugin: function(pluginInstance, referralNode) {

      if (DEBUG && !this.isNormalized) {
        throw createError("Invalid operation.");
      }

      const resourceNode = this;

      return new Promise(function(resolve, reject) {

        const config = {};

        const onLoadCallback = createOnloadCallback(resolve, reject);

        pluginInstance.load(resourceNode.resourceName, referralNode.require, onLoadCallback, config);
      });

      // ---

      function createOnloadCallback(resolve, reject) {

        function onLoadCallback(value) {
          resolve(value);
        }

        onLoadCallback.createError = reject;

        onLoadCallback.fromText = function(text, textAlt) {
          if (textAlt) {
            text = textAlt;
          }

          // eval
          // define is called..
        };

        return onLoadCallback;
      }
    }
  });
  // endregion

  // region RootNode Class

  /**
   * @class
   * @extends AbstractNode
   */
  function RootNode(systemJS) {

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

    get: function(normalizedId) {
      return this.getDescendant(normalizedId);
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
      if (DEBUG && this.get(namedNode.id)) {
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

  // endregion

  // region Amd and SystemJS stuff

  function createRequire(node) {

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
      },

      defined: function(id) {
      },

      specified: function(id) {
      }
    });

    // ---

    function require(depRefs, callback, errback) {
      return isArray(depRefs)
        ? node.requireManyAsync(depRefs)
          .then(function(depValues) { callback.apply(null, depValues); }, errback)
        : node.requireOne(depRefs);
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

  /**
   * Creates a SystemJS register for a given AMD definition.
   *
   * @param {AbstractChildNode} node - The AMD child node of the module being defined.
   * @param {AmdInfo} amdInfo - An AMD information object.
   * @return {Array} A SystemJS register.
   * @private
   */
  function createAmdRegister(node, amdInfo) {

    const module = node.$initAmdModule();
    const exports = module.exports;

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

      _export({ default: exports, __useDefault: true });

      return {
        setters: registerDepSetters,
        execute: function() {
          const exported = amdInfo.execute.apply(exports, depValues);
          if (exported !== undefined) {
            // Replace exports value.
            module.exports = exported;
            _export("default", exported);

          } else if (exports !== module.exports) {
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

  function assertSimple(simpleId) {
    if (!simpleId) {
      throw createError("Invalid empty id.");
    }

    if (simpleId === MAP_SCOPE_ANY_MODULE) {
      throw createError("Invalid id '" + MAP_SCOPE_ANY_MODULE + "'.");
    }

    if (isResourceId(simpleId)) {
      throw createError("Plugin call id not allowed: '" + simpleId + "'.");
    }

    if (isAbsoluteUrl(simpleId)) {
      throw createError("URL not allowed: '" + simpleId + "'.");
    }

    return simpleId;
  }
  // endregion

  // region Utilities
  function constantFun(v) {
    return function() {
      return v;
    };
  }

  function getOwn(o, p, dv) {
    return o && O_HAS_OWN.call(o, p) ? o[p] : dv;
  }

  function hasOwn(o, p) {
    return !!o && O_HAS_OWN.call(o, p);
  }

  function eachOwn(o, f, x) {
    if (o) {
      O.keys(o).forEach(function(p) {
        f.call(x, o[p], p);
      });
    }
  }

  // Adapted from RequireJS to merge the _config_ configuration option.
  function mixin(target, source) {
    eachOwn(source, function(value, prop) {
      if (!hasOwn(target, prop)) {
        // Not a null object. Not Array. Not RegExp.
        if (value && typeof value === "object" && !isArray(value) && !(value instanceof RegExp)) {
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
      const desc = O.getOwnPropertyDescriptor(from, p);
      if (desc !== undefined) {
        O.defineProperty(to, p, desc);
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
    const L = length(props);
    let i = -1;
    while (++i < L && (value = value[props[i]]) != null) {}
    return value;
  }

  function classExtend(Sub, Base, subSpec) {
    const subProto = (Sub.prototype = createObject(prototype(Base)));
    subProto.constructor = Sub;
    if (subSpec) {
      objectCopy(subProto, subSpec);
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

  function removeJsExtension(value) {
    const L = length(value);
    if (L >= 3 && value[L - 3] === "." && value[L - 2].toLowerCase() === "j" && value[L - 1].toLowerCase() === "s") {
      return stringPrefix(value, L - 3);
    }

    return value;
  }

  function removeTrailingSlash(value) {
    const lastIndex = length(value) - 1;
    return value[lastIndex] === PATH_SEPARATOR ? stringPrefix(value, lastIndex) : value;
  }

  function ensureTrailingSlash(value) {
    return value[length(value) - 1] === PATH_SEPARATOR ? value : (value + PATH_SEPARATOR);
  }

  function composeIds(baseId, childId) {
    return baseId ? (baseId + PATH_SEPARATOR + childId) : childId;
  }

  function removeUrlFragment(url) {
    const index = stringIndexOf(url, "#");
    return index < 0 ? url : stringPrefix(url, index);
  }

  function parseUrlWithModuleFragment(url) {

    let index = stringIndexOf(url, URL_MODULE_FRAGMENT);
    if (index < 0) {
      return null;
    }

    const LEN = length(URL_MODULE_FRAGMENT);

    const scriptUrl = stringPrefix(url, index);
    let scriptName = stringSuffixFrom(url, index + LEN);
    let bundledName = null;

    index = stringIndexOf(scriptName, URL_MODULE_FRAGMENT);
    if (index >= 0) {
      bundledName = stringSuffixFrom(scriptName, index + LEN);
      scriptName = stringPrefix(scriptName, index);
    }

    return [scriptUrl, scriptName, bundledName];
  }

  // "/a" - origin relative
  // "//a" - protocol relative
  // "http://" - absolute
  function isAbsoluteUrl(text) {
    return !!text && RE_URL_ABSOLUTE.test(text);
  }

  function isDataOrBlobUrl(text) {
    return RE_URL_DATA_OR_BLOB.test(text);
  }

  function isBlobUrl(text) {
    return RE_URL_BLOB.test(text);
  }

  function isBareName(text) {
    return !!text && !isAbsoluteUrl(text) && text[0] !== ".";
  }

  function parseResourceId(id) {
    return splitAt(id, RESOURCE_SEPARATOR);
  }

  function buildResourceId(plugin, resource) {
    return plugin + RESOURCE_SEPARATOR + resource;
  }

  function isResourceId(id) {
    return !!id && stringContains(id, RESOURCE_SEPARATOR);
  }

  function isUnnormalizedId(id) {
    return RE_RESOURCE_ID_UNNORMALIZED.test(id);
  }

  function constantRegister(value) {
    return [[], function(_export) {
      _export({ default: value, __useDefault: true });
      return {};
    }];
  }

  function splitAt(text, sep) {
    const index = stringIndexOf(text, sep);
    return index >= 0
      ? [stringPrefix(text, index), stringSuffixFrom(text, index + length(sep))]
      : null;
  }

  function createError(text) {
    return new Error(text);
  }

  function createObject(proto) {
    return O.create(proto || null);
  }

  function isString(v) {
    return typeof v === "string";
  }

  function isFunction(v) {
    return typeof v === "function";
  }

  function stringPrefix(v, L) {
    return v.substring(0, L);
  }

  function stringSuffixFrom(v, from) {
    return v.substring(from);
  }

  function stringIndexOf(v, search) {
    return v.indexOf(search);
  }

  function stringContains(v, content) {
    return v.indexOf(content) >= 0;
  }

  function length(arrayLike) {
    return arrayLike.length;
  }

  function prototype(Class) {
    return Class.prototype;
  }

  // endregion

  (function initGlobal() {

    const globalSystemJS = global.System;

    if (globalSystemJS.registerRegistry) {
      throw Error("The named-register.js extra for SystemJS must be included after the require.js extra.");
    }

    globalSystemJS.$initAmd();

    const amd = globalSystemJS.amd;

    // Read configuration, if any.
    function readConfig(cfg) {
      return cfg != null && !isFunction(cfg) ? cfg : null;
    }

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
