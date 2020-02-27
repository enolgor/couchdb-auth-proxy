'use strict';

function _interopDefault (ex) { return (ex && (typeof ex === 'object') && 'default' in ex) ? ex['default'] : ex; }

var crypto = require('crypto');
var url = require('url');
var httpProxy = _interopDefault(require('http-proxy'));
var transformerProxy = _interopDefault(require('transformer-proxy'));

var name = "couchdb-auth-proxy";
var version = "0.0.0-edge";

var asyncGenerator = function () {
  function AwaitValue(value) {
    this.value = value;
  }

  function AsyncGenerator(gen) {
    var front, back;

    function send(key, arg) {
      return new Promise(function (resolve, reject) {
        var request = {
          key: key,
          arg: arg,
          resolve: resolve,
          reject: reject,
          next: null
        };

        if (back) {
          back = back.next = request;
        } else {
          front = back = request;
          resume(key, arg);
        }
      });
    }

    function resume(key, arg) {
      try {
        var result = gen[key](arg);
        var value = result.value;

        if (value instanceof AwaitValue) {
          Promise.resolve(value.value).then(function (arg) {
            resume("next", arg);
          }, function (arg) {
            resume("throw", arg);
          });
        } else {
          settle(result.done ? "return" : "normal", result.value);
        }
      } catch (err) {
        settle("throw", err);
      }
    }

    function settle(type, value) {
      switch (type) {
        case "return":
          front.resolve({
            value: value,
            done: true
          });
          break;

        case "throw":
          front.reject(value);
          break;

        default:
          front.resolve({
            value: value,
            done: false
          });
          break;
      }

      front = front.next;

      if (front) {
        resume(front.key, front.arg);
      } else {
        back = null;
      }
    }

    this._invoke = send;

    if (typeof gen.return !== "function") {
      this.return = undefined;
    }
  }

  if (typeof Symbol === "function" && Symbol.asyncIterator) {
    AsyncGenerator.prototype[Symbol.asyncIterator] = function () {
      return this;
    };
  }

  AsyncGenerator.prototype.next = function (arg) {
    return this._invoke("next", arg);
  };

  AsyncGenerator.prototype.throw = function (arg) {
    return this._invoke("throw", arg);
  };

  AsyncGenerator.prototype.return = function (arg) {
    return this._invoke("return", arg);
  };

  return {
    wrap: function (fn) {
      return function () {
        return new AsyncGenerator(fn.apply(this, arguments));
      };
    },
    await: function (value) {
      return new AwaitValue(value);
    }
  };
}();

var asyncToGenerator = function (fn) {
  return function () {
    var gen = fn.apply(this, arguments);
    return new Promise(function (resolve, reject) {
      function step(key, arg) {
        try {
          var info = gen[key](arg);
          var value = info.value;
        } catch (error) {
          reject(error);
          return;
        }

        if (info.done) {
          resolve(value);
        } else {
          return Promise.resolve(value).then(function (value) {
            step("next", value);
          }, function (err) {
            step("throw", err);
          });
        }
      }

      return step("next");
    });
  };
};

function couchdbAuthProxy(fn) {
	let opts = arguments.length > 1 && arguments[1] !== undefined ? arguments[1] : {};

	if (typeof fn === "object") {
		;

		var _ref = [fn, opts];
		opts = _ref[0];
		fn = _ref[1];
	}var _opts = opts;
	let via = _opts.via,
	    secret = _opts.secret;
	var _opts$target = _opts.target;
	let target = _opts$target === undefined ? "http://localhost:5984" : _opts$target;
	var _opts$headerFields = _opts.headerFields;
	let headerFields = _opts$headerFields === undefined ? {} : _opts$headerFields;
	var _opts$info = _opts.info;
	let info = _opts$info === undefined ? { name, version } : _opts$info;
	var _opts$proxyOpts = _opts.proxyOpts;
	let proxyOpts = _opts$proxyOpts === undefined ? {} : _opts$proxyOpts;


	headerFields = Object.assign({
		username: "X-Auth-CouchDB-UserName",
		roles: "X-Auth-CouchDB-Roles",
		token: "X-Auth-CouchDB-Token"
	}, headerFields);

	const injectProxyInfo = info ? transformerProxy(function (data) {
		if (Buffer.isBuffer(data)) data = data.toString("utf-8");

		try {
			const body = JSON.parse(data);
			body.proxy = info;
			return JSON.stringify(body);
		} catch (e) {
			return data;
		}
	}) : null;

	const proxy = httpProxy.createProxyServer(Object.assign(proxyOpts, { target }));

	proxy.on("proxyRes", function (proxyRes, req, res) {
		const existing = res.getHeader("Via");
		const viaheader = `${existing ? existing + ", " : ""}${req.httpVersion} ${via} (${name}/${version})`;
		res.setHeader("Via", viaheader);
	});

	return (() => {
		var _ref2 = asyncToGenerator(function* (req, res, next) {
			try {
				// hijack the root response and inject proxy information
				if (injectProxyInfo && url.parse(req.url).pathname === "/") {
					yield confusedAsync(injectProxyInfo, null, [req, res]);
				}

				// inject couchdb proxy headers into request
				const ctx = yield confusedAsync(fn, null, [req, res]);
				if (ctx != null) {
					var _headerFields = headerFields;
					const username = _headerFields.username,
					      roles = _headerFields.roles,
					      token = _headerFields.token;

					cleanHeaders(req, [username, roles, token]);
					const n = typeof ctx.name === "string" ? ctx.name : "";
					req.headers[username] = n;
					req.headers[roles] = Array.isArray(ctx.roles) ? ctx.roles.join(",") : "";
					if (secret) req.headers[token] = sign(n, secret);
				}

				proxy.web(req, res);
			} catch (e) {
				if (next) next(e);else throw e;
			}
		});

		return function (_x2, _x3, _x4) {
			return _ref2.apply(this, arguments);
		};
	})();
}

// couchdb proxy signed token
const sign = couchdbAuthProxy.sign = function (user, secret) {
	return crypto.createHmac("sha1", secret).update(user).digest("hex");
};

// for methods that we don't know if they are callback or promise async
function confusedAsync(fn, ctx) {
	let args = arguments.length > 2 && arguments[2] !== undefined ? arguments[2] : [];

	if (fn.length > args.length) {
		return new Promise(function (resolve, reject) {
			fn.apply(ctx, args.concat(function (err, r) {
				if (err) reject(err);else resolve(r);
			}));
		});
	} else {
		return Promise.resolve(fn.apply(ctx, args));
	}
}

// removes a list of headers from a request
// accounts for Node.js lowercase headers
// https://github.com/tyler-johnson/couchdb-auth-proxy/issues/7
function cleanHeaders(req, headers) {
	headers.forEach(header => {
		delete req.headers[header];
		delete req.headers[header.toLowerCase()];
	});
}

module.exports = couchdbAuthProxy;