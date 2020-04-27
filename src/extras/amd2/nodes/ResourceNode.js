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
  createError
} from "../util.js";

import {
  isUnnormalizedId,
  parseResourceId,
  buildResourceId,
  RE_RESOURCE_ID_UNNORMALIZED,
  RE_JS_EXT
} from "../common.js";

import AbstractNamedNode from "./AbstractNamedNode.js";

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
export default function ResourceNode(name, parent, isDetached) {

  const isUnnormalized = isUnnormalizedId(name);

  // All unnormalized nodes are necessarily detached.
  const isDetachedEf = isUnnormalized || !!isDetached;

  AbstractNamedNode.call(this, name, parent, isDetachedEf);

  const resourceIdParts = parseResourceId(this.id);

  if (!process.env.SYSTEM_PRODUCTION) {
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

    if (!process.env.SYSTEM_PRODUCTION && !this.isNormalized) {
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
