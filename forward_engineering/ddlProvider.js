// const defaultTypes = require('./configs/defaultTypes');
// const types = require('./configs/types');
// const templates = require('./configs/templates');
// const getAdditionalOptions = require('./helpers/getAdditionalOptions');
const dropStatementProxy = require("./helpers/dropStatementProxy");

module.exports = (baseProvider, options, app) => {
  const _ = app.require("lodash");
  const {
    tab,
    commentIfDeactivated,
    checkAllKeysDeactivated,
    divideIntoActivatedAndDeactivated,
    hasType,
    wrap,
    clean,
    getDifferentProperties,
  } = app.require("@hackolade/ddl-fe-utils").general;
  const { assignTemplates, compareGroupItems } = app.require(
    "@hackolade/ddl-fe-utils",
  );
};
