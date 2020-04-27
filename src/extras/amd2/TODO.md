# Features To Be Done

*** - Indicates an MVP feature.

## General

- [ ] Check HV licensing.
- [ ] Add more unit tests.
- [ ] Complete/review documentation.

## SystemJS

Proposals for integration into SystemJS.

- [ ] `_init()` method, to avoid having to override SystemJS' constructor.
- [ ] `_processRegister` method to avoid several extras having to implement forced values for `getRegister`
  calls for registering multiple named modules per loaded script.
- [ ] `canonicalIdByUrl` for enabling scenarios of reflection over module identifier and their persistence. 

## General Code

- [ ] let and const to var.
- [ ] Integrate with `err-msg.js` scheme ***
- [ ] `absolutizeId` should perform `trimDots` like RequireJS does ***
- [ ] `canonicalIdByUrl` for URLs resolved using import maps.
- [ ] `__proto__` map lookup loophole.
- [ ] `$warn` and use of `console`.

## Require Function

- [ ] `root.require.undef`

## Loader Plugins

- [ ] `config` argument ***
  - What needs to be done to maintain config on pair and will it then
    subsume the use of nodes?? RequireJS derives bundleMap and pkgs index properties
    from the config.
  - What information are known AMD plugins reading from the general config? custom config options?

- [ ] `onload.fromText` *** 
  - Eval text as if it were a module script being loaded assuming its id is resourceName.
