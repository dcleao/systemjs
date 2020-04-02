define(["module"], function(module) {

  return {
    load: function(resourceName, referralRequire, onLoadCallback, config) {
      Promise.resolve().then(function() {
        onLoadCallback({
          plugin: module.id,
          resource: resourceName
        });
      });
    }
  };
});
