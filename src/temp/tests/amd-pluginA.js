define(["module"], function(module) {

  return {
    load: function(resourceName, referralRequire, onLoadCallback, config) {
      Promise.resolve().then(function() {
        onLoadCallback(module.id + "!" + resourceName + ":" + " Hello! " + (new Date().getTime()));
      });
    }
  };
});
