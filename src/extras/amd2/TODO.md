# Features To Be Done

*** - Indicates an MVP feature.

### General

- [ ] Check HV licensing.
- [ ] Add more unit tests.
- [ ] Complete/review documentation.

### SystemJS

Proposals for integration into SystemJS.

- [ ] `_init()` method, to avoid having to override SystemJS' constructor.
- [ ] `_processRegister` method to avoid several extras having to implement forced values for `getRegister`
  calls for registering multiple named modules per loaded script.
- [ ] `canonicalIdByUrl` for enabling scenarios of reflection over module identifier and their persistence. 

### General Code

- [ ] Integrate with `err-msg.js` scheme ***
- [ ] `absolutizeId` should perform `trimDots` like RequireJS ***
- [ ] `canonicalIdByUrl` for URLs resolved using import maps.

### Configuration

- [ ] `config.deps`, `config.callback` (using `setTimeout` to let any following extras to be installed)
  relationship with `data-main` and `<script type="systemjs-module" src="import:name"></script>`

### Require Function

- [ ] `root.require.undef`

### Loader Plugins

- [ ] `config` argument ***
  - what needs to be done to maintain config on pair and will it then
    subsume the use of nodes?? RequireJS derives bundleMap and pkgs index properties
    from the config.
  - what information are known AMD plugins reading from the general config? custom config options?

- [ ] `onload.fromText` *** 
  - Eval text as if it were a module script being loaded assuming its id is resourceName.

### JS

- [ ] `$warn` and use of `console`.
- [ ] `__proto__` map lookup loophole.
