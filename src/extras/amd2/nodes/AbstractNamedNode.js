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
  createError,
  createObject
} from "../util.js";

import {
  composeIds,
  URL_MODULE_FRAGMENT
} from "../common.js";

import AbstractChildNode from "./AbstractChildNode.js";

/**
 * @class
 * @extends AbstractChildNode
 * @abstract
 */
export default function AbstractNamedNode(name, parent, isDetached) {

  if (!process.env.SYSTEM_PRODUCTION && (!name || !parent)) {
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
