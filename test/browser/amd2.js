suite("SystemJS AMD2 Extra Tests", function() {

  const fixturesPath = "./fixtures/browser/amd2";

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
        "fixtures": fixturesPath
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

  test("Can load a script which has an anonymous AMD definition", function () {

    const systemJS = createSystemJS();

    systemJS.amd.require.config({
      "paths": {
        "fixtures": fixturesPath
      }
    });

    return systemJS.import("fixtures/amd-anonymous").then(function(value) {
      assert.ok(/amd-anonymous/.test(value));
    });
  });
});
