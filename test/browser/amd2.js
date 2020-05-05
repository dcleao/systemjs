
/* globals baseURL, rootURL, assert, suite, test */

suite("SystemJS AMD2 Extra Tests", function() {

  const FIXTURES_PATH = "./fixtures/browser/amd2";
  const FIXTURES_URL = baseURL + "fixtures/browser/amd2/";

  // region Utilities
  function createSystemJS() {
    // return System;

    // TODO: AMD2 is currently broken for non-global SystemJS...
    const SystemJS = System.constructor;
    return new SystemJS();
  }

  function configSpec(systemJS, spec) {
    systemJS.amd.require.config(spec);
    return systemJS;
  }

  function configBasic(systemJS) {

    return configSpec(systemJS, {
      "paths": {
        "fixtures": FIXTURES_PATH
      }
    });
  }

  function configGlobalAlias(systemJS) {

    systemJS.amd.require.config({
      "map": {
        "*": {
          "fixtures-global-alias": "fixtures"
        }
      }
    });

    return systemJS;
  }

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

  function setupBasicSystemJS() {
    return configBasic(createSystemJS());
  }

  function setupBundleSystemJS() {
    return configBundle(setupBasicSystemJS());
  }

  function setupShimSystemJS() {
    return configShim(setupBasicSystemJS());
  }

  function setupGlobalAliasSystemJS() {
    return configGlobalAlias(setupBasicSystemJS());
  }

  function setupPluginLoadedSystemJS() {

    const systemJS = configBasic(createSystemJS());

    return systemJS.import("fixtures/plugin-loaded")
      .then(function() { return systemJS; });
  }
  // endregion

  function testRequire(require, systemJS) {

    test("Is defined", function() {
      assert.equal(typeof require, "function");
    });

    suite("isBrowser", function() {

      test("Is defined", function() {
        assert.equal(typeof require.isBrowser, "boolean");
      });
    });

    suite("toUrl(.)", function() {

      test("Is defined", function() {
        assert.equal(typeof require.toUrl, "function");
      });

      test("Returns the URL of an absolute module with an extension != .js", function() {

        configBasic(systemJS);

        assert.equal(require.toUrl("fixtures/module-dep.css"), FIXTURES_URL + "module-dep.css");
      });

      test("Returns the URL of an absolute module with an extension == .js", function() {

        configBasic(systemJS);

        assert.equal(require.toUrl("fixtures/module-dep.js"), FIXTURES_URL + "module-dep.js");
      });

      test("Returns the URL of an absolute module without extension", function() {

        configBasic(systemJS);

        assert.equal(require.toUrl("fixtures/module-dep"), FIXTURES_URL + "module-dep");
      });

      test("Returns null for an unmapped module", function() {
        assert.equal(require.toUrl("unmapped/module"), null);
      });
    });

    suite("require([deps...], callback, errback)", function() {

      test("Calls callback when given an empty dependencies array", function() {

        const systemJS = setupBasicSystemJS();

        return new Promise(function(resolve, reject) {
          systemJS.amd.require([], resolve, reject);
        });
      });

      test("Calls errback when given at least one unmapped dependency", function() {

        const systemJS = setupBasicSystemJS();

        return new Promise(function(resolve, reject) {
          systemJS.amd.require([
            "fixtures/anonymous",
            "missing/dependency"
          ], function() {
            reject(new Error("Should have called errback."));
          }, function(error) {
            try {
              assert.ok(error instanceof Error);
            } catch(ex) {
              reject(ex);
            }

            resolve();
          });
        });
      });

      test("Calls callback when given absolute module identifiers", function() {

        const systemJS = setupBasicSystemJS();

        return new Promise(function(resolve, reject) {
          systemJS.amd.require([
            "fixtures/anonymous",
            "fixtures/dependency-special-module"
          ], function(anonymous, dep) {

            assert.ok(anonymous instanceof Object);
            assert.equal(anonymous.name, "anonymous");

            assert.ok(dep instanceof Object);
            assert.equal(dep.name, "dependency-special-module");

            resolve();
          }, reject);
        });
      });
    });

    suite("require(dep)", function() {

      test("Returns the module value when given an absolute module identifier", function() {

        const systemJS = setupBasicSystemJS();

        return new Promise(function(resolve, reject) {
          systemJS.amd.require([
            "fixtures/anonymous",
            "fixtures/dependency-special-module"
          ], function(anonymous, dep) {

            assert.equal(systemJS.amd.require("fixtures/anonymous"), anonymous);
            assert.equal(systemJS.amd.require("fixtures/dependency-special-module"), dep);

            resolve();
          }, reject);
        });
      });
    });
  }

  suite("Global define function", function() {

    const globalDefine = typeof define !== "undefined" ? define : undefined;

    test("Is defined", function() {
      assert.equal(typeof globalDefine, "function");
    });

    /*
    test("It is the value of System.amd.define", function() {
      assert.equal(globalDefine, System.amd.define);
    });
    */

    suite("amd", function() {

      test("Is defined", function() {
        assert.ok(globalDefine.amd != null);
        assert.equal(typeof globalDefine.amd, "object");
      });

      test("Has a jQuery property with the value `true`", function() {
        assert.equal(globalDefine.amd.jQuery, true);
      });
    });
  });

  suite("RootNode.define(id, ...)", function() {

    test("Can define a virtual module", function() {

      const systemJS = createSystemJS();
      const exportedValue = {};

      systemJS.amd.define("abc", function() {
        return exportedValue;
      });

      return systemJS.import("abc").then(function(value) {
        assert.equal(value, exportedValue);
      });
    });
  });

  suite("Global require function", function() {

    const globalRequire = typeof require !== "undefined" ? require : undefined;

    testRequire(globalRequire, System);

    test("It is the value of System.amd.require", function() {
      assert.equal(globalRequire, System.amd.require);
    });

    suite("config(.)", function() {
      test("Is defined", function() {
        assert.equal(typeof globalRequire.config, "function");
      });
    });

    suite("undef(.)", function() {
      test("Is defined", function() {
        assert.equal(typeof globalRequire.undef, "function");
      });
    });
  });

  suite("resolve(nameOrUrl, referralUrl)", function() {

    function fixUnnormalized(idOrUrl) {
      if (idOrUrl) {
        idOrUrl = idOrUrl.replace(/_unnormalized\d+$/, "_unnormalized");
      }

      return idOrUrl;
    }

    function testResolve(getSystemJS, id, expectedUrl) {

      test("Resolves '" + id + "'", function() {
        return Promise.resolve(getSystemJS()).then(function(systemJS) {

          let url = fixUnnormalized(systemJS.resolve(id));

          assert.equal(url, expectedUrl);
        });
      });
    }

    suite("AbstractNode.normalizeDep(nameOrUrl)", function() {

      function testNormalizeDep(getSystemJS, id, expectedId) {

        test("Normalizes '" + id + "'", function() {
          return Promise.resolve(getSystemJS()).then(function(systemJS) {

            let normalizedId = fixUnnormalized(systemJS.amd.normalizeDep(id));

            assert.equal(normalizedId, expectedId);
          });
        });
      }

      suite("basic", function() {

        const testCase = testNormalizeDep.bind(null, setupBasicSystemJS);

        testCase("fixtures/anonymous", "fixtures/anonymous.js");
        testCase("fixtures/anonymous.js", "fixtures/anonymous.js");
        testCase("fixtures/bundleA", "fixtures/bundleA.js");
        testCase("fixtures/pluginA", "fixtures/pluginA.js");
        testCase("fixtures/plugin-unloaded.js!foo", "fixtures/plugin-unloaded.js!foo_unnormalized");
      });

      suite("global alias", function() {

        const testCase = testNormalizeDep.bind(null, setupGlobalAliasSystemJS);

        testCase("fixtures-global-alias", "fixtures.js");
        testCase("fixtures-global-alias/anonymous", "fixtures/anonymous.js");
      });

      suite("loaded plugin", function() {

        const testCase = testNormalizeDep.bind(null, setupPluginLoadedSystemJS);

        testCase("fixtures/plugin-loaded!foo", "fixtures/plugin-loaded.js!foo");
      });

      suite("relative", function() {

        function testRelative(id, expectedId) {

          test("Normalizes '" + id + "'", function() {

            const systemJS = setupBasicSystemJS();
            const refNode = systemJS.amd.get("fixtures/anonymous", true);

            assert.equal(refNode.normalizeDep(id), expectedId);
          });
        }

        testRelative("./Model", "fixtures/Model.js");
        testRelative("./Model.js", "fixtures/Model.js");
      });
    });

    suite("basic", function() {

      const testCase = testResolve.bind(null, setupBasicSystemJS);

      testCase("fixtures/anonymous.js", FIXTURES_URL + "anonymous.js#!mid=fixtures/anonymous.js");
      testCase("fixtures/anonymous", FIXTURES_URL + "anonymous.js#!mid=fixtures/anonymous.js");
      testCase("fixtures/module-dep", FIXTURES_URL + "module-dep.js#!mid=fixtures/module-dep.js");
      testCase("fixtures/plugin-unloaded!foo", FIXTURES_URL + "plugin-unloaded.js#!mid=fixtures/plugin-unloaded.js!foo_unnormalized");
    });

    suite("global alias", function() {

      const testCase = testResolve.bind(null, setupGlobalAliasSystemJS);

      testCase("fixtures-global-alias/anonymous", FIXTURES_URL + "anonymous.js#!mid=fixtures/anonymous.js");
    });

    suite("loaded plugin", function() {

      const testCase = testResolve.bind(null, setupPluginLoadedSystemJS);

      testCase("fixtures/plugin-loaded.js!foo", FIXTURES_URL + "plugin-loaded.js#!mid=fixtures/plugin-loaded.js!foo");
      testCase("fixtures/plugin-loaded!foo", FIXTURES_URL + "plugin-loaded.js#!mid=fixtures/plugin-loaded.js!foo");
      testCase("fixtures/plugin-loaded!foo.js", FIXTURES_URL + "plugin-loaded.js#!mid=fixtures/plugin-loaded.js!foo");
    });

    suite("bundle", function() {

      const testCase = testResolve.bind(null, setupBundleSystemJS);

      testCase("bundleA-bundled-module1", FIXTURES_URL + "bundleA.js#!mid=fixtures/bundleA.js#!mid=bundleA-bundled-module1.js");
    });
  });

  suite("import(nameOrUrl, referralUrl)", function() {

    suite("Script with single anonymous module", function() {

      test("A module is only instantiated the first time it is imported", function () {

        const systemJS = setupBasicSystemJS();

        return systemJS.import("fixtures/anonymous").then(function(value1) {

          assert.ok(value1 instanceof Object);

          return systemJS.import("fixtures/anonymous").then(function(value2) {
            assert.equal(value1, value2);
          });
        });
      });

      suite("Dependencies", function() {

        test("Can load a module which has no dependencies", function () {

          const systemJS = setupBasicSystemJS();

          return systemJS.import("fixtures/anonymous").then(function(value) {
            assert.ok(value instanceof Object);
            assert.equal(value.name, "anonymous");
          });
        });

        test("Can load a module which has the special 'module' dependency", function () {

          const systemJS = setupBasicSystemJS();

          return systemJS.import("fixtures/dependency-special-module").then(function(value) {
            assert.ok(value instanceof Object);
            assert.equal(value.name, "dependency-special-module");
          });
        });

        test("Can load a module which has a dependency known as a contextual alias", function () {

          const systemJS = configSpec(setupBasicSystemJS(), {
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

          const systemJS = setupBasicSystemJS();

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

        test("Can load a module which is shimmed and extract its 'exports' variable path", function () {

          const systemJS = setupShimSystemJS();

          return systemJS.import("fixtures/shimmed").then(function(value) {
            assert.equal(value, "shimmed");
          });
        });
      });

      suite("Resource", function() {

        test("Can load a resource", function() {

          const systemJS = setupBasicSystemJS();

          return systemJS.import("fixtures/pluginA!a-resource").then(function(value) {
            assert.ok(value instanceof Object);
            assert.equal(value.plugin, "fixtures/pluginA.js");
            assert.equal(value.resource, "a-resource");
          });
        });

        test("Can load a resource with a different name", function() {

          const systemJS = setupBasicSystemJS();

          return systemJS.import("fixtures/pluginA!b-resource").then(function(value) {
            assert.ok(value instanceof Object);
            assert.equal(value.plugin, "fixtures/pluginA.js");
            assert.equal(value.resource, "b-resource");
          });
        });

        test("A resource is only instantiated the first time it is imported", function() {

          const systemJS = setupBasicSystemJS();

          return systemJS.import("fixtures/pluginA!a-resource").then(function(value1) {

            assert.ok(value1 instanceof Object);

            return systemJS.import("fixtures/pluginA!a-resource").then(function(value2) {
              assert.ok(value1 === value2);
            });
          });
        });

        test("Can load a resource from text", function() {

          const systemJS = setupBasicSystemJS();

          return systemJS.import("fixtures/plugin-load-from-text!c-resource").then(function(value) {
            assert.equal(value, "Resource name is: 'c-resource'.");
          });
        });
      });
    });

    suite("Bundle script", function() {

      test("Can load the bundle module", function () {

        const systemJS = setupBundleSystemJS();

        return systemJS.import("fixtures/bundleA").then(function(value) {
          assert.equal(value, undefined);
        });
      });

      test("Can load a module which is bundled in a bundle module", function () {

        const systemJS = setupBundleSystemJS();

        return systemJS.import("bundleA-bundled-module1").then(function(value) {
          assert.ok(value instanceof Object);
          assert.equal(value.name, "bundleA-bundled-module1");
          assert.equal(value.id, "bundleA-bundled-module1.js");
        });
      });
    });
  });

  suite("canonicalIdByUrl(url)", function() {

    function testCanonicalId(getSystemJS, url, expectedId) {

      let title = "Inverts ";
      if (url && url.length < 20) {
        title += "'" +  url + "' ";
      }

      title += "to '" + expectedId + "'";

      test(title, function() {
        return Promise.resolve(getSystemJS()).then(function(systemJS) {
          assert.equal(systemJS.canonicalIdByUrl(url), expectedId);
        });
      });
    }

    suite("basic", function() {

      const testCase = testCanonicalId.bind(null, setupBasicSystemJS);

      testCase(FIXTURES_URL + "anonymous.js", "fixtures/anonymous.js");
    });

    suite("unmapped", function() {

      const testCase = testCanonicalId.bind(null, createSystemJS);

      testCase("foo", null);
      testCase("foo.js", null);
    });

    suite("fragment annotation", function() {

      const testCase = testCanonicalId.bind(null, createSystemJS);

      testCase("foo#!mid=a/b/c", "a/b/c");
      testCase("foo.js#!mid=a/b/c", "a/b/c");
      testCase(FIXTURES_URL + "bundleA.js#!mid=fixtures/bundleA#!mid=bundleA-bundled-module1.js", "bundleA-bundled-module1.js");
    });
  });
});
