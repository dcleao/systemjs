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

import AbstractChildNode from "./AbstractChildNode.js";

/**
 * @class
 * @extends AbstractChildNode
 */
export default function AnonymousNode(url, parent) {

  if (!process.env.SYSTEM_PRODUCTION && !(url || parent || !parent.isRoot)) {
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
