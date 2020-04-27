# AMD2 Extra

This SystemJS extra implements a mostly complete [AMD](https://github.com/amdjs/amdjs-api) implementation, 
especially, in its [RequireJS](https://requirejs.org) flavour,
and from the point of view of AMD modules, loader plugins and configuration. 

See [Unsupported Features](#unsupported-features), for more information.

## Code naming scheme

Properties naming scheme to support indicating class accessibility and mangling.

- `public` - public
- `_protected` - protected
- `__private` - private; mangled
- `$internal` - internal; mangled

Can be minified using, for example:
```bash
terser require.js
   --mangle keep_fnames='/Node$/'
   --mangle-props regex='/^(__|[$])(?!useDefault)/'
```

## Features To Be Done

*** - Indicates an MVP feature.

### General

- Licensing
- Unit tests
  - Lots more of...
  - Cycle detection
  - Error handling
- Complete/Review documentation

### General Features

- `trimDots` -> `absolutizeId` ***
- Shared general config?
- RequireJS supports mapping regular modules to resource modules.
- Implement `canonicalIdByUrl` for Import Maps URLs.
- Flag to not overwrite global `define`, `require`?
- Flag to allow top-level names without a specified path (fallback to `name`)?

### Configuration

- `config.deps`, `config.callback` (using `setTimeout` to let any following extras to be installed)
  relationship with `data-main` and `<script type="systemjs-module" src="import:name"></script>`

### Require

- `root.require.undef` ***
- `require.defined`
- `require.specified`

### Loader Plugins

- `config` argument ***
  - what needs to be done to maintain config on pair and will it then
    subsume the use of nodes?? RequireJS derives bundleMap and pkgs index properties
    from the config.
  - what information are known AMD plugins reading from the general config? custom config options?

- `onload.fromText` *** 
  - Eval text as if it were a module script being loaded assuming its id is resourceName.

### JS

- `$warn` and `console`
- `__proto__` map lookup loophole

## Unsupported Features

Some AMD/RequireJS features are not supported so that interoperability is possible
with [Import Maps](https://github.com/WICG/import-maps) and ES6 modules.
Most importantly, AMD considers module specifiers ending in `.js` to be URLs
and, as such, does not apply `map`, `paths` or `baseUrl` configurations to it.
Moreover, if these URLs start with a bare segment, these are considered document relative.
By contrast, import maps consider these specifiers to be bare module names and 
applies import maps to these.
Conversely, AMD always adds a `js` extension to module identifiers, 
and so these never include the `js` extension *a priori*.
On the contrary, import maps require extensions to be specified.
To ensure interoperability, 
this AMD implementation interprets module identifiers with a `js` extension as bare modules,
just like import maps do.

There is another AMD "capability" which is not (and cannot be) supported by this implementation.
However, it is very unlikely that you use it: 
AMD `paths` or `urlArgs` configurations that resolve to URLs with a fragment (e.g. `foo.com/bar.js#abc`).
This implementation uses URL fragments to mark resolved URLs with the original module identifier.
See [Canonical Module Identifier](#canonical-module-identifier), for more information.

Some features are not supported because they 
are considered edge cases, 
are probably rarely used, and 
could make the implementation bigger, more complex and less performant.
However, given enough demand, these could be implemented. 

### AMD

#### Module specifiers ending with .js being considered URLs

A leaf module specifier ending with `.js` refers to the same module than 
the identifier without the `.js` suffix.

This is not supported because it is required for interoperability with 
import maps and the ES6 modules import syntax. 

#### Resolving modules to URLs with fragments

This is not supported because URL fragments are needed to support canonical module identifiers.

#### Mapping simple identifiers to resource identifiers

Example:
```json
{
  "map": {
    "*": {
      "my/component": "my/plugin!my/component"
    }
  }
}
```

This is not supported due to complexity of implementation and probable rarity of use.

#### Specifying path fallbacks

When, in the `paths` configuration, a module prefix is mapped to an array, 
only its first value is considered.

```json
{
  "paths": {
    "my/component": [
      "path-1/to/component",
      "path-2/to/component"
    ]
  } 
}
```

This is not supported due to import maps not supporting path fallbacks.
Also, it would probably be difficult to implement it on the AMD extra side. 

#### Shimming resource modules

```json
{
  "shim": {
    "text!my/component/messages": {
      "deps": ["text!my/component/base-messages"]
    }
  } 
}
```

This is not supported due to probable complexity of implementation and rarity of use.

### Require JS

Some RequireJS features are not directly supported because 
SystemJS offers different ways to achieve the same functionality and
these were taken as rarely used and, when used, are so, typically, in central, setup locations.
This is the case of, for example, the `data-main` attribute and the `context` configuration.

#### CommonJS-style factory function

Detection of inline `require(.)` dependencies in the code of the factory function, using `toString`.

This is not supported due to probable complexity of implementation, performance impact and rarity of use.

#### Require function jsExtRegExp property

RequireJS supports specifying the property `jsExtRegExp` of the top-level `require` function,
for customizing the module identifiers which are considered to be URLs.

This is not supported because module identifiers with a `js` extension are not considered
URLs anymore. This property could allow interfering with that necessary behaviour.

#### JavaScript engines

RequireJS supports many JavaScript engines, such as Rhino, PS and Opera.

This is not supported because SystemJS probably does not support these engines as well.

#### Custom RequireJS contexts

Creating and configuring new, non-global `require` functions via the `context` configuration
is not supported.

However, new AMD contexts can be obtained simply by creating new `SystemJS` instances.

#### Data-main attribute

Specifying `data-main` in the `script` element used to load the AMD/RequireJS extra is not supported.
Likewise, the `skipDataMain` configuration property is not supported.

However, the following achieves the same effect:

```html
<script type="systemjs-module" src="import:my/main/module/id"></script> 
```

#### Various

- require.defined/specified ? Are these worth it?
- require.onError, require.createNode, require.load
- error.requireModules on error handlers allowing to undef and then retry loading of modules with different config/paths,
  allowing functionality equivalent to paths fallbacks
  (https://requirejs.org/docs/api.html#errbacks)
- config.nodeRequire / all special NodeJS/CommonJS features

## Canonical Module Identifier

Explain!
