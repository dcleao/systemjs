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

#### Identifiers without a mapped bundle or path

AMD allows module identifiers whose URL is not configured via `bundles` or `paths` configuration properties,
in which case, module identifiers are taken relative to `baseUrl`.

This is not supported because it would go against the spirit of import maps which, instead,
throws for unmapped bare names.
Additionally, SystemJS depends on `resolve` implementations to throw to enable fallback to
other resolution mechanisms.

Still, if use cases exist, a configuration option could be supported.

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

#### Simplified CommonJS wrapper

Detection of inline `require(.)` dependencies in the code of the factory function, using `toString`.

This is not supported due to probable complexity of implementation, performance impact and rarity of use.

#### Require function `jsExtRegExp` property

RequireJS supports specifying the property `jsExtRegExp` of the top-level `require` function,
for customizing the module identifiers which are considered to be URLs.

This is not supported because module identifiers with a `js` extension are not considered
URLs anymore. This property could allow interfering with that necessary behaviour.

#### Configuration property `nodeIdCompat`

The configuration property `nodeIdCompat` is not supported as the effect that it achieved with a `true`
value is now mandatory in this implementation, treating modules with or without a `js` extension
as the same module. 

#### JavaScript engines

RequireJS supports many JavaScript engines, such as Rhino, Nashorn, PlayStation 3 and Opera.

This is not supported because this extra aligns with SystemJS' supported engines.

#### Configuration property `context`

Creating and configuring new, non-global `require` functions via the `context` configuration
is not supported.

However, new AMD contexts can be obtained simply by creating new `SystemJS` instances.

#### Script attribute `data-main` and configuration property `skipDataMain`

Specifying `data-main` in the `script` element used to load the AMD/RequireJS extra is not supported.
It is thus also not used to default the `baseUrl` configuration option.

Likewise, the `skipDataMain` configuration property is not supported.

However, the following achieves the same effect:

```html
<script type="systemjs-module" src="import:my/main/module/id"></script> 
```

#### Not overwriting global `define` or `require` functions

Unlike RequireJS, 
this implementation overwrites the global `define` and `require` functions, 
if any are defined, with the ones associated with the global SystemJS AMD context.

Is there a use case for not installing the global functions? 
In this case, a configuration to do so could be supported.

#### Require function `defined` and `specified` methods

RequireJS' `require` functions have two special methods: `defined` and `specified`.
This is not supported due to possibly not having direct equivalents in SystemJS and to probable rarity of use.

#### Require function `onError` method

Any module loading errors are better handled using SystemJS' provided means.

#### Error objects' `requireType` and `requireModules` properties

RequireJS adds the `requireModules` property to error object that it creates following the failed loading of a module. 
It is useful for "undefining" the failed module and then retrying their loading using an alternate, fallback location.

This is not supported due to the same reasons why fallback paths are not supported as well.

#### Configuration property `nodeRequire`

RequireJS supports this configuration option to enable a mode in NodeJS in which modules not mapped
using the AMD configuration are then loaded via NodeJS' top-level `require` function.

This is not supported because module resolution fallback is handled in SystemJS by 
setting it up with appropriate extras.

#### Controlling the creation of script tags

RequireJS supports several options for fine-tuning the script tags created to download script modules, 
such 
as the `xhtml` and `scriptType` configuration options, 
as well as the `createNode` method of the global `require` function.

SystemJS provides the `createScript` method to the same end. 

#### Controlling the loading of modules

RequireJS supports the `load` method of the global `require` function to change how script modules are loaded.
Likewise, it supports the `waitSeconds` configuration property which allows to specify a load timeout for modules. 

SystemJS provides the `shouldFetch`, `fetch` and `createScript` methods which allow achieving 
similar functionality.

#### Configuration option `enforceDefine`

The RequireJS `enforceDefine` configuration option allows enforcing that all loaded scripts 
either call `define` to define a module or have a `shim` configuration.

In this implementation, 
AMD definitions can be made from a script whose identifier was resolved 
via import maps or via AMD configuration.
As such, it generally isn't an error for a script to not have a `define` call. 


## Canonical Module Identifier

Explain!
Is there any issue with directly `import`ing URLs with fragments yielding different module instances?
Are there any best practices to avoid the issue?
