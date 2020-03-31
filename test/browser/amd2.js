suite("SystemJS AMD2 Extra Tests", function() {

  const FIXTURES_PATH = "./fixtures/browser/amd2";

  // region Utilities
  function assertNormalizeDep(systemJS, id, expectedId) {
    let normalizedId = systemJS.amd.normalizeDep(id);
    if (normalizedId) {
      normalizedId = normalizedId.replace(/_unnormalized\d+$/, "_unnormalized");
    }

    assert.equal(normalizedId, expectedId);
  }

  function assertResolve(systemJS, id, expectedUrl) {
    let url = systemJS.resolve(id);
    if (url) {
      url = url.replace(/_unnormalized\d+$/, "_unnormalized");
    }

    assert.equal(url, expectedUrl);
  }

  function assertCanonicalId(systemJS, url, expectedId) {
    assert.equal(systemJS.canonicalIdByUrl(url), expectedId);
  }

  function createSystemJS() {
    return System;

    // AMD2 is currently broken for non-global SystemJS...
    // const SystemJS = System.constructor;
    // return new SystemJS();
  }

  function configureAmd(systemJS) {

    systemJS.amd.require.config({
      "paths": {
        "fixtures": FIXTURES_PATH
      },
      "map": {
        "*": {
          "fixtures-global-alias": "fixtures"
        },
        "fixtures/amd-scoped-dep": {
          "A": "fixtures/amd-dependencyA"
        }
      },
      "shim": {
        "fixtures/amd-shimmed": {
          "deps": ["./amd-dependencyA", "fixtures/amd-dependencyB"],
          "exports": "myGlobal.prop",
          "init": function(depA, depB) {

          }
        }
      },
      "bundles": {
        "fixtures/amd-bundleA": [
          "amd-bundleA-bundled-module1",
          "amd-bundleA-bundled-module2"
        ]
      }
    });

    return systemJS;
  }
  // endregion

  function configSpec(systemJS, spec) {
    systemJS.amd.require.config(spec);
    return systemJS;
  }

  function configBasic(systemJS, extraSpec) {

    return configSpec(systemJS, {
      "paths": {
        "fixtures": FIXTURES_PATH
      }
    });
  }

  suite("Script with a single anonymous AMD definition", function() {

    test("A module is only instantiated the first time it is imported", function () {

      const systemJS = configBasic(createSystemJS());

      return systemJS.import("fixtures/anonymous").then(function(value1) {

        assert.ok(value1 instanceof Object);

        return systemJS.import("fixtures/anonymous").then(function(value2) {
          assert.equal(value1, value2);
        });
      });
    });

    suite("Dependencies", function() {

      test("Can load a module which has no dependencies", function () {

        const systemJS = configBasic(createSystemJS());

        return systemJS.import("fixtures/anonymous").then(function(value) {
          assert.ok(value instanceof Object);
          assert.equal(value.name, "anonymous");
        });
      });

      test("Can load a module which has the special 'module' dependency", function () {

        const systemJS = configBasic(createSystemJS());

        return systemJS.import("fixtures/dependency-special-module").then(function(value) {
          assert.ok(value instanceof Object);
          assert.equal(value.name, "dependency-special-module");
        });
      });

      test("Can load a module which has a dependency known as a contextual alias", function () {

        const systemJS = configSpec(configBasic(createSystemJS()), {
          "map": {
            "fixtures/dependency-context-alias": {
              "A": "fixtures/dependencyA"
            }
          }
        });

        return systemJS.import("fixtures/dependency-context-alias").then(function(value) {
          assert.ok(value instanceof Object);
          assert.equal(value.name, "dependency-context-alias");
          assert.equal(value.dependency, "dependencyA");
        });
      });

      test("Can load a module which has a resource dependency", function () {

        const systemJS = configBasic(createSystemJS());

        return systemJS.import("fixtures/dependency-resource").then(function(value) {
          assert.ok(value instanceof Object);
          assert.equal(value.name, "dependency-resource");

          const resource = value.resource;
          assert.equal(resource.plugin, "fixtures/pluginA.js");
          assert.equal(resource.resource, "foobar");
        });
      });
    });

    suite("Shimmed", function() {

      function configShim(systemJS) {

        return configSpec(systemJS, {
          "shim": {
            "fixtures/shimmed": {
              "deps": ["./dependencyA", "fixtures/dependencyB"],
              "exports": "myGlobal.prop",
              "init": function(depA, depB) {

              }
            }
          }
        });
      }

      test("Can load a module which is shimmed and extract its 'exports' variable path", function () {

        const systemJS = configShim(configBasic(createSystemJS()));

        return systemJS.import("fixtures/shimmed").then(function(value) {
          assert.equal(value, "shimmed");
        });
      });
    });
  });

  suite("Bundle script", function() {

    function configBundle(systemJS) {

      return configSpec(systemJS, {
        "bundles": {
          "fixtures/bundleA": [
            "bundleA-bundled-module1",
            "bundleA-bundled-module2"
          ]
        }
      });
    }

    test("Can load the bundle module", function () {

      const systemJS = configBundle(configBasic(createSystemJS()));

      return systemJS.import("fixtures/bundleA").then(function(value) {
        assert.equal(value, undefined);
      });
    });

    test("Can load a module which is bundled in a bundle module", function () {

      const systemJS = configBundle(configBasic(createSystemJS()));

      return systemJS.import("bundleA-bundled-module1").then(function(value) {
        assert.ok(value instanceof Object);
        assert.equal(value.name, "bundleA-bundled-module1");
        assert.equal(value.id, "bundleA-bundled-module1.js");
      });
    });
  });
});
