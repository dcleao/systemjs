define([], function() {

  return {
    load: function(resourceName, referralRequire, onLoadCallback) {
      Promise.resolve().then(function() {
        const escapedResourceName = resourceName.replace(/"/, '\\"');
        const text = `
          define(function() {
            return "Resource name is: '${escapedResourceName}'.";
          });
          `;

        onLoadCallback.fromText(text);
      });
    }
  };
});
