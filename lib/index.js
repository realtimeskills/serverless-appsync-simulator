"use strict";

var _amplifyAppsyncSimulator = require("amplify-appsync-simulator");

var _util = require("util");

var _lodash = require("lodash");

var _cfnResolverLib = _interopRequireDefault(require("cfn-resolver-lib"));

var _getAppSyncConfig = _interopRequireDefault(require("./getAppSyncConfig"));

var _NotImplementedDataLoader = _interopRequireDefault(require("./data-loaders/NotImplementedDataLoader"));

var _ElasticDataLoader = _interopRequireDefault(require("./data-loaders/ElasticDataLoader"));

var _HttpDataLoader = _interopRequireDefault(require("./data-loaders/HttpDataLoader"));

var _fbWatchman = _interopRequireDefault(require("fb-watchman"));

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

const resolverPathMap = {
  'AWS::DynamoDB::Table': 'Properties.TableName',
  'AWS::S3::Bucket': 'Properties.BucketName'
};

class ServerlessAppSyncSimulator {
  constructor(serverless) {
    this.serverless = serverless;
    this.options = null;
    this.log = this.log.bind(this);
    this.debugLog = this.debugLog.bind(this);
    this.simulator = null;
    (0, _amplifyAppsyncSimulator.addDataLoader)('HTTP', _HttpDataLoader.default);
    (0, _amplifyAppsyncSimulator.addDataLoader)('AMAZON_ELASTICSEARCH', _ElasticDataLoader.default);
    (0, _amplifyAppsyncSimulator.addDataLoader)('RELATIONAL_DATABASE', _NotImplementedDataLoader.default);
    this.hooks = {
      'before:offline:start:init': this.startServer.bind(this),
      'before:offline:start:end': this.endServer.bind(this)
    };
  }

  log(message, opts = {}) {
    return this.serverless.cli.log(message, 'AppSync Simulator', opts);
  }

  debugLog(message, opts = {}) {
    if (process.env.SLS_DEBUG) {
      this.log(message, opts);
    }
  }

  async startServer() {
    try {
      this.buildResolvedOptions();
      this.buildResourceResolvers();
      this.serverless.service.functions = this.resolveResources(this.serverless.service.functions);
      this.serverless.service.provider.environment = this.resolveResources(this.serverless.service.provider.environment);
      this.serverless.service.custom.appSync = this.resolveResources(this.serverless.service.custom.appSync);
      this.simulator = new _amplifyAppsyncSimulator.AmplifyAppSyncSimulator({
        port: this.options.port,
        wsPort: this.options.wsPort
      });
      await this.simulator.start();

      if (Array.isArray(this.options.watch) && this.options.watch.length > 0) {
        this.watch();
      } else {
        this.initServer();
      }

      this.log(`AppSync endpoint: ${this.simulator.url}/graphql`);
      this.log(`GraphiQl: ${this.simulator.url}`);
    } catch (error) {
      this.log(error, {
        color: 'red'
      });
    }
  }

  initServer() {
    // TODO: suport several API's
    const appSync = Array.isArray(this.serverless.service.custom.appSync) ? this.serverless.service.custom.appSync[0] : this.serverless.service.custom.appSync;
    const config = (0, _getAppSyncConfig.default)({
      plugin: this,
      serverless: this.serverless,
      options: this.options
    }, appSync);
    this.debugLog(`AppSync Config ${appSync.name}`);
    this.debugLog((0, _util.inspect)(config, {
      depth: 4,
      colors: true
    }));
    this.simulator.init(config);
  }

  watch() {
    const client = new _fbWatchman.default.Client();
    const path = this.serverless.config.servicePath; // Try to watch for changes in AppSync configuration

    client.command(['watch-project', path], (error, resp) => {
      if (error) {
        console.error('Error initiating watch:', error);
        console.log('AppSync Simulator hot-reloading will not be available'); // init server once

        this.initServer();
        return;
      }

      if ('warning' in resp) {
        console.log('warning: ', resp.warning);
      } // Watch for changes in vtl and schema files.


      const sub = {
        expression: ['anyof', ...this.options.watch.map(glob => ['match', glob])],
        fields: ['name'],
        since: resp.clock
      };
      const {
        watch,
        relative_path
      } = resp;

      if (relative_path) {
        sub.relative_root = relative_path;
      } // init subscription


      client.command(['subscribe', watch, 'appsync-simulator', sub], error => {
        if (error) {
          console.error('Failed to subscribe: ', error);
          return;
        }
      });
    });
    client.on('subscription', async resp => {
      if (resp.subscription === 'appsync-simulator') {
        console.log('Hot-reloading AppSync simulator...');
        this.initServer();
      }
    });
  }

  endServer() {
    if (this.simulator) {
      this.log('Halting AppSync Simulator');
      this.simulator.stop();
    }
  }

  buildResourceResolvers() {
    const refResolvers = (0, _lodash.reduce)((0, _lodash.get)(this.serverless.service, 'resources.Resources', {}), (acc, res, name) => {
      const path = resolverPathMap[res.Type];

      if (path !== undefined) {
        return { ...acc,
          [name]: (0, _lodash.get)(res, path, null)
        };
      }

      return acc;
    }, {});

    const keyValueArrayToObject = mapping => {
      if (Array.isArray(mapping)) {
        return mapping.reduce((acc, {
          key,
          value
        }) => ({ ...acc,
          [key]: value
        }), {});
      }

      return mapping;
    };

    this.resourceResolvers = {
      RefResolvers: { ...refResolvers,
        ...keyValueArrayToObject(this.options.refMap),
        // Add region for cfn-resolver-lib GetAZs
        'AWS::Region': this.serverless.service.provider.region
      },
      'Fn::GetAttResolvers': keyValueArrayToObject(this.options.getAttMap),
      'Fn::ImportValueResolvers': keyValueArrayToObject(this.options.importValueMap)
    };
  }

  buildResolvedOptions() {
    this.options = (0, _lodash.merge)({
      apiKey: '0123456789',
      port: 20002,
      wsPort: 20003,
      location: '.',
      lambda: {
        loadLocalEnv: false
      },
      refMap: {},
      getAttMap: {},
      importValueMap: {},
      dynamoDb: {
        endpoint: `http://localhost:${(0, _lodash.get)(this.serverless.service, 'custom.dynamodb.start.port', 8000)}`,
        region: 'localhost',
        accessKeyId: 'DEFAULT_ACCESS_KEY',
        secretAccessKey: 'DEFAULT_SECRET'
      }
    }, (0, _lodash.get)(this.serverless.service, 'custom.appsync-simulator', {}));
    this.options = (0, _lodash.defaults)(this.options, {
      watch: ['*.graphql', '*.vtl']
    });
  }
  /**
   * Resolves resourses through `Ref:` or `Fn:GetAtt`
   */


  resolveResources(toBeResolved) {
    // Pass all resources to allow Fn::GetAtt and Conditions resolution
    const node = { ...this.serverless.service.resources,
      toBeResolved
    };
    const evaluator = new _cfnResolverLib.default(node, this.resourceResolvers);
    const result = evaluator.evaluateNodes();

    if (result && result.toBeResolved) {
      return result.toBeResolved;
    }

    return toBeResolved;
  }

}

module.exports = ServerlessAppSyncSimulator;