define("bundleA-bundled-module1", ["module"], function(module) {
  return {name: "bundleA-bundled-module1", id: module.id}
});

define("bundleA-bundled-module2", ["module"], function(module) {
  return {name: "bundleA-bundled-module2", id: module.id}
});

define("fixtures/bundleA", [], function() {});
