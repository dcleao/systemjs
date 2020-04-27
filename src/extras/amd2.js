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

import { global, isFunction } from "./amd2/util.js";
import { System } from "./amd2/SystemJS.js";
import "./amd2/AmdSystemJSMixin.js";

if (System.registerRegistry) {
  throw Error("The named-register.js extra for SystemJS must be included after the amd2.js extra.");
}

System.$initAmd();

const rootAmdNode = System.amd;

// Read configuration, if any.
function readAmdConfig(cfg) {
  return cfg != null && !isFunction(cfg) ? cfg : null;
}

// Capture configuration before overwriting global variables.
const config = readAmdConfig(global.require) || readAmdConfig(global.requirejs);

// Publish in global scope.
global.define = rootAmdNode.define;
global.require = global.requirejs = rootAmdNode.require;

if (config) {
  rootAmdNode.configure(config);
}
