BigInt.prototype.toJSON = function () {
  return Number(this.valueOf());
};

const ACCESS_DENIED_ERROR = 1045;

module.exports = {
  async connect(connectionInfo) {
    return; //
  },

  disconnect(connectionInfo, logger, callback, app) {
    callback();
  },

  async testConnection(connectionInfo, logger, callback, app) {
    const log = createLogger({
      title: "Test connection",
      hiddenKeys: connectionInfo.hiddenKeys,
      logger,
    });

    try {
      logger.clear();
      logger.log(
        "info",
        connectionInfo,
        "connectionInfo",
        connectionInfo.hiddenKeys,
      );

      const connection = await this.connect(connectionInfo);

      log.info("Connected successfully");

      callback(null);
    } catch (error) {
      log.error(error);
      if (error.errno === ACCESS_DENIED_ERROR) {
        callback({
          message: `Access denied for user "${connectionInfo.userName}". Please, check whether the password is correct and the user has enough permissions to connect to the database server.`,
          stack: error.stack,
        });
      } else {
        callback({ message: error.message, stack: error.stack });
      }
    }
  },

  async getDbCollectionsNames(connectionInfo, logger, callback, app) {
    const log = createLogger({
      title: "Retrieving databases and tables information",
      hiddenKeys: connectionInfo.hiddenKeys,
      logger,
    });

    try {
      logger.clear();
      logger.log(
        "info",
        connectionInfo,
        "connectionInfo",
        connectionInfo.hiddenKeys,
      );
      const systemDatabases = connectionInfo.includeSystemCollection
        ? []
        : ["metadata"];

      const connection = await this.connect(connectionInfo);
      const databases = [connectionInfo.databaseName];

      const collections = await databases.reduce(async (next, dbName) => {
        const result = await next;
        try {
          const entities = [];
          const dbCollections = getDbCollectionNames(
            entities,
            dbName,
            connectionInfo.includeSystemCollection,
          );

          return result.concat({
            dbName,
            dbCollections,
            isEmpty: dbCollections.length === 0,
          });
        } catch (error) {
          log.info(`Error reading database "${dbName}"`);
          log.error(error);

          return result.concat({
            dbName,
            dbCollections: [],
            isEmpty: true,
            status: true,
          });
        }
      }, Promise.resolve([]));

      log.info("Names retrieved successfully");

      callback(null, collections);
    } catch (error) {
      log.error(error);
      callback({ message: error.message, stack: error.stack });
    }
  },

  async getDbCollectionsData(data, logger, callback, app) {
    const _ = app.require("lodash");
    const async = app.require("async");
    const log = createLogger({
      title: "Reverse-engineering process",
      hiddenKeys: data.hiddenKeys,
      logger,
    });

    try {
      logger.log("info", data, "data", data.hiddenKeys);

      const collections = data.collectionData.collections;
      const dataBaseNames = data.collectionData.dataBaseNames;
      const connection = await this.connect(data);

      const result = await async.mapSeries(dataBaseNames, async (dbName) => {
        const tables = (collections[dbName] || []).filter(
          (name) => !isViewName(name),
        );
        const views = (collections[dbName] || [])
          .filter(isViewName)
          .map(getViewName);

        log.info(`Parsing database "${dbName}"`);
        log.progress(`Parsing database "${dbName}"`, dbName);

        log.info(`Parsing functions`);
        log.progress(`Parsing functions`, dbName);

        log.info(`Parsing procedures`);
        log.progress(`Parsing procedures`, dbName);
      });
    } catch (error) {
      log.error(error);
      callback({ message: error.message, stack: error.stack });
    }
  },
};

const createLogger = ({ title, logger, hiddenKeys }) => {
  return {
    info(message) {
      logger.log("info", { message }, title, hiddenKeys);
    },

    progress(message, dbName = "", tableName = "") {
      logger.progress({
        message,
        containerName: dbName,
        entityName: tableName,
      });
    },

    error(error) {
      logger.log(
        "error",
        {
          message: error.message,
          stack: error.stack,
          meta: error.meta,
        },
        title,
      );
    },
  };
};

const getDbCollectionNames = (entities, dbName, includeSystemCollection) => {
  const isView = (type) => {
    return ["VIEW"].includes(type);
  };

  return entities
    .filter((table) => {
      if (table["Table_type"] === "SYSTEM VIEW") {
        return false;
      }

      if (includeSystemCollection) {
        return true;
      }

      const isSystem = !["BASE TABLE", "VIEW", "SEQUENCE"].includes(
        table["Table_type"],
      );

      return !isSystem;
    })
    .map((table) => {
      const name = table[`Tables_in_${dbName}`];

      if (isView(table["Table_type"])) {
        return `${name} (v)`;
      } else {
        return name;
      }
    });
};

const getLimit = (count, recordSamplingSettings) => {
  const per = recordSamplingSettings.relative.value;
  const size =
    recordSamplingSettings.active === "absolute"
      ? recordSamplingSettings.absolute.value
      : Math.round((count / 100) * per);
  return size;
};

const isViewName = (name) => {
  return /\ \(v\)$/i.test(name);
};

const getViewName = (name) => name.replace(/\ \(v\)$/i, "");

const containsJson = (columns) => {
  return columns.some(
    (column) => column["Type"] === "longtext" || column["Type"] === "json",
  );
};

const getVersion = (version) => {
  if (/^8\./.test(String(version))) {
    return "v8.x";
  } else {
    return "v5.x";
  }
};

const prepareDdl = (ddl) => {
  return ddl
    .replace(/\/\*\!80016 ((NOT )?ENFORCED) \*\//g, "$1")
    .replace(
      /\/\*\!50100 (TABLESPACE `[\s\S]+?`( STORAGE (DISK|MEMORY))?) \*\//i,
      "$1 ",
    );
};

const getMajorVersionNumber = (dbVersion) => {
  return Number(dbVersion.split(".")[0]);
};
