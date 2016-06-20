'use strict';
var Generators = require('yeoman-generator');
var Parser = require('swagger-parser');
var Fs = require('fs');
var Path = require('path');
var _ = require('underscore.string');
var Util = require('../../lib/util');
var Frameworks = Util.Frameworks;
var operationType = Util.operationType;

module.exports = Generators.Base.extend({
    constructor: function () {
        Generators.Base.apply(this, arguments);
        /*
         * Options :
         *  --framework
         *  --apiPath
         *  --handlerPath
         */
        this.option('framework');
        this.option('apiPath');
        this.option('handlerPath');
    },
    initializing: {
        //Validate the apiPath option in the beginning itself. Prompt for user input if the option is an invalid path.
        apiPath: function () {
            var done = this.async();
            this.apiPath = this.options.apiPath;
            this.api = this.options.api;
            if (this.api) {
                //API available. Swagger parser already validated the API and the local copy got generated.
                this.configGenerated = true;
            } else if (this.apiPath) {
                //If API is not passed as an option and the apiPath is valid, then, validate the api Spec.
                this._validateSpec(done);
                return;
            }
            done();
        },
        sefDefaults: function () {
            var self = this;
            /**
             * Assume that this.destinationRoot() is the base path and direcory name is the appname default.
             */
            var basePath = this.destinationRoot();
            var pkgPath = Path.resolve(basePath, 'package.json');
            var framework;
            var apiPathRel = '.' + Path.sep + 'config' + Path.sep + 'swagger.json';
            this.appName = Path.basename(basePath);
            //If package.json exists, get the default framework details from package.json dependencies
            if (Fs.existsSync(pkgPath)) {
                this.appPkg = require(pkgPath);
                for (var i in Frameworks) {
                    framework = Frameworks[i];
                    if (this.appPkg.dependencies && Object.keys(this.appPkg.dependencies).indexOf(framework) !== -1) {
                        self.framework = framework;
                        break;
                    }
                }
            }
            this.framework = this.options.framework || this.framework;
            this.handlerPath = this.options.handlerPath || '.' + Path.sep + 'handlers';
            this.dataPath = this.options.dataPath || '.' + Path.sep + 'data';
            this.apiConfigPath = this.options.apiConfigPath || Path.join(this.destinationPath(), apiPathRel);
        }
    },
    _validateSpec: function (done) {
        var self = this;
        Parser.validate(this.apiPath, function (error, api) {
            if (error) {
                done(error);
                return;
            }
            self.api = api;
            done();
        });
    },
    prompting: function () {
        var done = this.async();
        var self = this;
        var validate = function (propName) {
            return !!propName;
        }
        this.prompt([
        {
            name: 'apiPath',
            message: 'Path (or URL) to swagger document:',
            required: true,
            when: function () {
                return !self.apiPath;
            },
            default: this.apiPath,
            validate: validate
        },
        {
            type: 'list',
            name: 'framework',
            message: 'Framework:',
            default: this.framework,
            when: function () {
                return !self.framework;
            },
            choices: Frameworks.map(function (framework) {
                return {
                    name: framework,
                    value: framework
                };
            })
        }], function (answers) {
            var self = this;
            Object.keys(answers).forEach(function (prop) {
                if (answers[prop] !== null && answers[prop] !== undefined) {
                    self[prop] = answers[prop];
                }
            });

            //parse and validate the Swagger API entered by the user.
            if (answers.apiPath) {
                this._validateSpec(done);
            } else {
                done();
            }

        }.bind(this));
    },
    configuring: function () {
        var done = this.async();
        if (Frameworks.indexOf(this.framework) === -1) {
            done(new Error('Invalid framework ' + this.framework + '. Framework should be one of these : ' + Frameworks));
        } else {
            done();
        }
    },
    writing: {
        config: function () {
            var self = this;
            var done = this.async();
            //Write to local config file only if the API is already validated
            //Dereferenced and resolved $ref objects cannot be used in the local copy.
            //So use `parse` API and then stringify the Objects to json format.
            if(this.api && !this.configGenerated) {
                //Write the contents of the apiPath location to local config file.
                Parser.parse(this.apiPath, function (error, api) {
                    if (error) {
                        done(error);
                        return;
                    }
                    //Write as a JSON file.
                    //TODO handle the yml file usecase
                    self.write(self.apiConfigPath, JSON.stringify(api, null, 4));
                    done();
                });
            } else {
                done();
            }
        },
        data: function () {
            this.composeWith('swaggerize:data', {
                options: {
                    api: this.api,
                    apiPath: this.apiPath,
                    apiConfigPath: this.apiConfigPath
                }
            }, {
                local: require.resolve('../data')
            });
        },
        handlers: function () {
            var self = this;
            var paths = this.api.paths
            if (paths) {
                Object.keys(paths).forEach(function (path) {
                    var pathStr = path.replace(/^\/|\/$/g, '');
                    var handlerPath = Path.join(self.handlerPath, pathStr + '.js');
                    var dataPath = Path.join(self.dataPath, pathStr + '.js');
                    var pathObj = paths[path];

                    var route = {
                        path: path,
                        dataPath: Util.relative(self.destinationPath(handlerPath), self.destinationPath(dataPath)),
                        operations: []
                    };
                    Object.keys(pathObj).forEach(function (method) {
                        var commonParams = [];
                        var operationObj = pathObj[method];
                        method = method.toLowerCase();
                        if (method === 'parameters') {
                            /*
                             * A list of parameters that are applicable for all the operations described under this path.
                             * These parameters can be overridden at the operation level, but cannot be removed there.
                             * The list MUST NOT include duplicated parameters
                             */
                            commonParams = operationObj;
                        } else if (operationType.indexOf(method) !== -1) {
                            /*
                             * The operation for the Path. get, post. put etc.
                             */
                            var parameters = commonParams;
                            if (operationObj.parameters) {
                                parameters = commonParams.concat(operationObj.parameters);
                            }

                            route.operations.push({
                                name: operationObj.operationId,
                                description: operationObj.description,
                                summary: operationObj.summary,
                                method: method,
                                parameters: parameters && parameters.map(function (p) { return p.name }).join(', '),
                                produces: operationObj.produces && operationObj.produces.join(', '),
                                responses: operationObj.responses ? Object.keys(operationObj.responses): [],
                            });
                        }
                    });
                    /*
                     * Schema Extensions for Handlers: (x-handler)
                     * An alternative to automatically determining handlers based on a directory structure,
                     * handlers can be specified using x-handler
                     */
                    if (pathObj['x-handler']) {
                        handlerPath = pathObj['x-handler'];
                    }
                    self.fs.copyTpl(
                        self.templatePath(Path.join(self.framework, 'handler.js')),
                        self.destinationPath(handlerPath),
                        route
                    );
                });
            }
        }
    }
});
