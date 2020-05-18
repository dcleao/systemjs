# AMD2 Extra

This SystemJS extra implements a mostly complete [AMD](https://github.com/amdjs/amdjs-api) implementation.
For what is unspecified, and for some additional features, it follows the implementation of 
the [RequireJS](https://requirejs.org) library.

Some AMD features are purposely not supported in favor of better interoperability with SystemJS, 
[Import Maps](https://github.com/WICG/import-maps) and ES6 modules. 

[Unsupported Features](#unsupported-features)

## Module specifiers

Ideally, any SystemJS module should be able to depend on any other module made available to SystemJS, whatever its
module system or named module registry.  

Additionally, for true isolation, SystemJS modules should not be aware of the module system of their dependencies
and, as such, should refer to other modules using the module specifier rules of their own module system. 

As such, an AMD module should use AMD specifiers for referring to any other SystemJS modules,
and, conversely, ES6 modules should use ES6 and Import Maps specifier rules to refer to any other SystemJS modules.

Unfortunately, achieving this is not generally possible.

To give an example, if an AMD module depends on another module, `a/b`, should this refer to the 
Import Maps specifier `a/b` or `a/b.js`? Both would have to be tested for, because, unlike AMD, 
Import Maps does have the concept of a default extension (AMD has a default extension of `js`).
While possibly hard to implement, this could be achieved.

Another example is if an AMD module depends on a module `a/b.js`. By AMD rules, this would identify an URL which
does not use
Now imagine an opposite scenario, of an ES6 module depending on another module, `a/b`.
For this to match an AMD module, it would need to either be configured as a package or denote the `a/b.js`.

## Unsupported Features

This implementation specifically breaks with some AMD/RequireJS features so that it becomes interoperable with 
ES6 modules and .

First, let's look at how each of the systems, AMD and import-maps, deals with various kinds of **module specifiers**. 
A module specifier is what is used to *specify* a module.

In ES6, module specifiers are the arguments of the `import from "specifier"` statements and the `import("specifier")` pseudo-function.
In ES6, these arguments are always taken as URLs, and, crucially, URLs which start as a *bare name* are not allowed (e.g. `"my/module.js"`).

The import-maps specification extends ES6 module specifiers to include *bare names* which are converted to URLs via an import map. 
An import map is a set of mappings where each maps a *base* module specifier to a *base* URL.
In the import-maps specification, *names* are always absolute — there is no way to indicate a relative name.
Please note that the import maps specification allows mapping both names or URLs to other URLs.
  
In AMD, module specifiers are arguments of the `require([...deps], ...)` functions and arguments of the `define(id, [...deps], .)` function. 
These can either be *identifiers* or URLs. An AMD module identifier is equivalent to an import-maps' *name*.
So, to simplify the description, will refer to AMD identifiers also as *names*.
Converting an AMD module name to an URL is achieved via a set of AMD configurations: `map`, `paths`, `bundles` and `baseUrl`.
Unlike with import-maps, these "mapping" configurations do not apply to URL specifiers.

Another notable difference is that AMD names can be relative, 
but only when specified as the dependency (the `deps` arguments) of a *named module*.
The first argument of the `define(name, ...)` function is always an absolute (and normalized) name.

The following table shows specifiers having different traits and the type of specifier these are taken to be 
— Name or URL — by the AMD and import-maps systems. 

| **Specifier Trait**                      | **Examples**                                 | **AMD**                          | **Import Maps**                   |
|------------------------------------------|----------------------------------------------|----------------------------------|-----------------------------------|
| Protocol-prefixed                        | `http://foo`<br>`git+ssh://foo`<br>`urn:foo` | URL                              | URL                               |
| Protocol-relative                        | `//foo`                                      | URL                              | URL                               |
| Host-relative                            | `/foo`                                       | URL                              | URL                               |
| Name-prefixed<br>without `js` extension  | `foo/bar`                                    | Name<br>(absolute)               | Name                              |
| Name-prefixed<br>with `js` extension     | `foo/bar.js`                                 | ***URL***<br>(document-relative) | ***Name***                        |
| Directory-relative                       | `./foo`                                      | ***Name***<br>(relative \*)      | ***URL***<br>(document-relative)  |
| Parent-directory-relative                | `../foo`                                     | ***Name***<br>(relative \*\*)    | ***URL***<br>(document-relative)  |

(\*) as a dependency of the global `require`, an anonymous module, or a named root module, 
    `./foo` is considered equivalent to `foo`;
     as a dependency of a non-root named module, it is taken to be its sibling.

(\*\*) as a dependency of a non-root named module, it is taken to be a sibling of its parent module, even if there is no grandparent module;
       cannot be used in other contexts.

The first three listed specifier traits correspond to different forms of "absolute" URLs and are naturally taken by 
both module systems as absolute URLs.
The remaining traits correspond to different forms of "relative" URLs.
While the fourth trait, *name-prefixed without `js` extension*, is still taken equivalently by both systems, as an absolute name,
the other three are taken differently.

Let's look closer at each of these.

### Name-prefixed with JS extension

The import-maps specification treats all *name-prefixed* specifiers as *names*.
AMD, on the other hand, takes any specifier ending with a `js` extension as a document-relative URL.
When a specifier is an URL, AMD only applies the `urlArgs` configuration to it, to obtain a final URL. 
The AMD configurations `map`, `paths`, `bundles` and `baseUrl` are not applied, nor a `js` extension is added.

```js
// AMD considers the first specifier to be an absolute name and
// the second specifier to be a document-relative URL.
global.require(["foo/bar", "foo/bar.js"], function(foo1, foo2) {
  assert.not.equals(foo1, foo2);
});
```

```js
// Import-maps considers the specifier to be a name.
import fooBar from "foo/bar.js";
```

The difference in treatment for these two types of specifiers is worrying as
it does not allow for an AMD module to consume an ES6 module without knowing it is an ES6 module,
and that it requires the JS extension to be included in the specifier.

Likewise nor an ES6 module to consume an AMD module,
using the same syntax for same things.

### Directory and Parent-directory relative

The import-maps specification does not support relative names and so specifiers starting with a `.` are considered directory-relative URLs.
However, note, unlike with AMD, the mappings of import-maps are applied to both names and URL specifiers.

On the other hand,
AMD supports relative identifiers and so specifiers starting with a `.` are considered relative identifiers.

AMD
```js
// AMD considers both specifiers to be identifiers.
global.require(["foo", "./foo"], function(foo1, foo2) {
  assert.equals(foo1, foo2);
});

// AMD considers this specifier invalid at global scope.
global.require(["../foo"], function(foo) {

});
```

Import Maps
```js
// Import-maps considers this specifier to be a name.
import foo1 from "foo";

// Import-maps considers this specifier to be a directory-relative URL.
import foo2 from "./foo";

assert.not.equals(foo1, foo2);
```

### Conclusion


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

## Code naming scheme

Properties naming scheme to support indicating class accessibility *and* mangling.

- `public` - public member; preserved
- `_protected` - protected member; preserved
- `__private` - private member; mangled
- `$internal` - internal member (can be used by all AMD2 code); mangled
