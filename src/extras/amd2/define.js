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

"use strict";

import {
  constantFun,
  isArray,
  isFunction,
  isString
} from "./util.js";

/**
 * The information of an AMD `define` call.
 *
 * @typedef {({id: ?string, deps: ?Array.<string>, execute: function})} AmdInfo
 */

const REQUIRE_EXPORTS_MODULE = ["require", "exports", "module"];

/**
 * Queue of AMD definitions added during the load of a script file
 * and which are pending processing.
 *
 * @type {Array.<AmdInfo>}
 * @readonly
 */
const __amdQueue = [];

export function takeDefine() {
  return __amdQueue.shift() || null;
}

/**
 * - define("id", {})
 * - define("id", function(require, exports, module) {})
 * - define("id", [], function() {})
 * - define({})
 * - define(function(require, exports, module) {})
 * - define([], function() {})
 */
export default function define(id, deps, execute) {

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

  __amdQueue.push({id: id, deps: deps, execute: execute});
}

define.amd = {
  // https://github.com/amdjs/amdjs-api/wiki/jQuery-and-AMD
  jQuery: true
};
