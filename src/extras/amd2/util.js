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

export const O = Object;
const O_HAS_OWN = prototype(O).hasOwnProperty;
export const isArray = Array.isArray;
export const isBrowser = typeof window !== "undefined" && typeof navigator !== "undefined" && !!window.document;

const envGlobal = typeof self !== 'undefined' ? self : global;

export { envGlobal as global };

export function constantFun(v) {
  return function() {
    return v;
  };
}

export function getOwn(o, p, dv) {
  return o && O_HAS_OWN.call(o, p) ? o[p] : dv;
}

export function hasOwn(o, p) {
  return !!o && O_HAS_OWN.call(o, p);
}

export function eachOwn(o, f, x) {
  if (o) {
    O.keys(o).forEach(function(p) {
      f.call(x, o[p], p);
    });
  }
}

export function objectCopy(to, from) {
  for (const p in from) {
    const desc = O.getOwnPropertyDescriptor(from, p);
    if (desc !== undefined) {
      O.defineProperty(to, p, desc);
    }
  }

  return to;
}

export function assignProps(to, from, props) {
  props.forEach(function(p) {
    to[p] = from[p];
  });

  return to;
}

export function getGlobal(path) {
  if (!path) {
    return path;
  }

  let value = envGlobal;
  const props = path.split('.');
  const L = length(props);
  let i = -1;
  while (++i < L && (value = value[props[i]]) != null) {}
  return value;
}

export function classExtend(Sub, Base, subSpec) {
  const subProto = (Sub.prototype = createObject(prototype(Base)));
  subProto.constructor = Sub;
  if (subSpec) {
    objectCopy(subProto, subSpec);
  }

  return Sub;
}

export function splitAt(text, sep) {
  const index = stringIndexOf(text, sep);
  return index >= 0
    ? [stringPrefix(text, index), stringSuffixFrom(text, index + length(sep))]
    : null;
}

export function createError(text) {
  return new Error(text);
}

export function createObject(proto) {
  return O.create(proto || null);
}

export function isString(v) {
  return typeof v === "string";
}

export function isFunction(v) {
  return typeof v === "function";
}

export function stringPrefix(v, L) {
  return v.substring(0, L);
}

export function stringSuffixFrom(v, from) {
  return v.substring(from);
}

export function stringIndexOf(v, search) {
  return v.indexOf(search);
}

export function stringContains(v, content) {
  return v.indexOf(content) >= 0;
}

export function length(arrayLike) {
  return arrayLike.length;
}

export function prototype(Class) {
  return Class.prototype;
}
