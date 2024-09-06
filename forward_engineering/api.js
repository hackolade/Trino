// const reApi = require('../reverse_engineering/api');
// const applyToInstanceHelper = require('./applyToInstanceHelper');

module.exports = {
  generateScript(data, logger, callback, app) {
    callback(null, "");
  },
  generateViewScript(data, logger, callback, app) {
    callback(
      new Error(
        "Forward-Engineering of delta model on view level is not supported",
      ),
    );
  },
  generateContainerScript(data, logger, callback, app) {
    callback(null, "");
  },
  applyToInstance(connectionInfo, logger, callback, app) {
    logger.clear();
    logger.log(
      "info",
      connectionInfo,
      "connectionInfo",
      connectionInfo.hiddenKeys,
    );
  },
  testConnection(connectionInfo, logger, callback, app) {},
};
