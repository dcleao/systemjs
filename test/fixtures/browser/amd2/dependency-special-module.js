define(["module"], function(module) {
  return {name: "dependency-special-module", id: (module && module.id)};
});
