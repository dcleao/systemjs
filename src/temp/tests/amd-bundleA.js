define("amd-bundleA-bundled-module1", ["module"], function(module) {
  return "amd-bundleA-bundled-module1: id=" + module.id;
});

define("amd-bundleA-bundled-module2", ["module"], function(module) {
  return "amd-bundleA-bundled-module2: module=" + module.id;
});
