"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.default = void 0;

var _axios = _interopRequireDefault(require("axios"));

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

class ElasticDataLoader {
  constructor(config) {
    this.config = config;
  }

  async load(req) {
    try {
      const {
        data
      } = await _axios.default.request({
        baseURL: this.config.endpoint,
        url: req.path,
        headers: req.params.headers,
        params: req.params.queryString,
        method: req.operation.toLowerCase(),
        data: req.params.body
      });
      return data;
    } catch (err) {
      console.log(err);
    }

    return null;
  }

}

exports.default = ElasticDataLoader;