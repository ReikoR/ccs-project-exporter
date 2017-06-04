const fs = require('fs-extra');
const path = require('path');

const cheerio = require('cheerio');
const async = require('async');
const logger = require('tracer').console({
    format: '{{timestamp}} <{{title}}> {{file}}:{{line}} {{message}}',
    dateformat: 'yyyy-mm-dd HH:MM:ss.l'
});

const projectFolder = 'C:/ti/motorware/motorware_1_01_00_18/sw/solutions/instaspin_motion/boards/boostxldrv8301_revB/f28x/f2806xM/projects/ccs/proj_lab13b';
const projectPath = path.join(projectFolder, '.project');
const cProjectPath = path.join(projectFolder, '.cproject');

const outputFolder = 'out';

let MW_INSTALL_DIR;
let motorwarePath;
const includePaths = [];

const linkedResources = [];

async.series([
    getProjectSettings,
    createOutputFolder,
    getLinkedResources,
    processLinkedResources,
    copyProjectFolder,
    changeLinkedResourcesPaths,
    changeCompilerIncludePaths
], function (err) {
    if (err) {
        logger.log(err);
    } else {
        logger.log('DONE');
    }
});

function createOutputFolder(callback) {
    fs.ensureDir(outputFolder, function (err) {
        if (err) {
            logger.error(err);
            callback(err);
        } else {
            logger.log('Output folder created');
            callback();
        }
    });
}

function getProjectSettings(callback) {
    fs.readFile(cProjectPath, function (err, content) {
        if (err) {
            logger.error(err);
            callback(err);
        } else {
            const $ = cheerio.load(content, {xmlMode: true});

            const getIncludePaths = function () {
                $('configuration[name=Release]').find('option[valueType=includePath]').children('listOptionValue').each(function (index, item) {
                    const $item = $(item);

                    const value = $item.attr('value').replace(/"/g, '');

                    if (value.search('\\${MW_INSTALL_DIR}') > -1) {
                        includePaths.push(path.resolve(value.replace('${MW_INSTALL_DIR}', motorwarePath)));
                    } else if (value.search('\\${PROJECT_ROOT}') > -1) {
                        includePaths.push(path.resolve(value.replace('${PROJECT_ROOT}', projectFolder)));
                    }
                });

                logger.log('includePaths', includePaths);

                callback();
            };

            MW_INSTALL_DIR = $('stringMacro[name=MW_INSTALL_DIR]').attr('value');

            logger.log('MW_INSTALL_DIR', MW_INSTALL_DIR);

            if (MW_INSTALL_DIR) {
                motorwarePath = path.resolve(MW_INSTALL_DIR.replace('${PROJECT_ROOT}', projectFolder));

                logger.log('motorwarePath', motorwarePath);

                getIncludePaths();
            } else {
                logger.error('MW_INSTALL_DIR not found');
                callback('MW_INSTALL_DIR not found');
            }
        }
    });
}

function changeCompilerIncludePaths(callback) {
    let newCProjectPath = path.join(outputFolder, '.cproject');

    fs.readFile(cProjectPath, 'utf8', function (err, content) {
        if (err) {
            logger.error(err);
            callback(err);
        } else {
            const $ = cheerio.load(content, {xmlMode: true});

            const include = $('configuration').find('option[valueType=includePath]').each(function (i, option) {
                const $option = $(option);

                $option.empty();
                $option.append('<listOptionValue builtIn="false" value="&quot;${CG_TOOL_ROOT}/include&quot;"/>');
                $option.append('<listOptionValue builtIn="false" value="&quot;${PROJECT_ROOT}&quot;"/>');
            });

            fs.writeFile(newCProjectPath, $.xml(), 'utf8', function (err) {
                if (err) {
                    logger.error(err);
                    callback(err);
                } else {
                    logger.log('Compiler include paths changed');
                    callback();
                }
            });
        }
    });
}

function copyProjectFolder(callback) {
    fs.copy(projectFolder, outputFolder, function (err) {
        if (err) {
            logger.error(err);
            callback(err);
        } else {
            callback();
        }
    });
}

function changeLinkedResourcesPaths(callback) {
    let newProjectPath = path.join(outputFolder, '.project');

    fs.readFile(newProjectPath, 'utf8', function (err, content) {
        if (err) {
            logger.error(err);
            callback(err);
        } else {
            const $ = cheerio.load(content, {xmlMode: true});

            $('linkedResources').children('link').each(function (index, item) {
                const $item = $(item);
                const path = $item.children('locationURI').text()/*.replace('MW_INSTALL_DIR', motorwarePath)*/;

                const newPath = getNewPath($item.children('locationURI').text());

                content = content.replace(path, '${PROJECT_LOC}/' + newPath);

                //logger.log(newPath);
            });

            fs.writeFile(newProjectPath, content, 'utf8', function (err) {
                if (err) {
                    logger.error(err);
                    callback(err);
                } else {
                    logger.log('Linked resource paths changed');
                    callback();
                }
            });
        }
    });
}

function getLinkedResources(callback) {
    fs.readFile(projectPath, function (err, content) {
        if (err) {
            logger.error(err);
            callback(err);
        } else {
            const $ = cheerio.load(content, {xmlMode: true});

            $('linkedResources').children('link').each(function (index, item) {
                const $item = $(item);
                const path = $item.children('locationURI').text().replace('MW_INSTALL_DIR', motorwarePath);

                //logger.log(path);

                linkedResources.push(path);
            });

            if (linkedResources.length === 0) {
                logger.error('No linked resources found');
                callback('No linked resources found');
            } else {
                callback();
            }
        }
    });
}

function processLinkedResources(callback) {
    async.eachSeries(linkedResources, processLinkedResource, function (err) {
        logger.log('Linked resources processed');

        callback(err);
    });
}

function processLinkedResource(filePath, callback) {
    //logger.log('Processing', filePath);

    const extension = path.extname(filePath);

    const newPath = path.join(outputFolder, getNewPath(filePath));

    logger.log(newPath);

    fs.copy(filePath, newPath, function (err) {
        if (err) {
            logger.error(err);
            callback(err);
        } else {
            if (extension === '.c') {
                processIncludes(filePath, newPath, callback);
            } else {
                callback();
            }
        }
    });
}

function processIncludes(oldPath, newPath, callback) {
    const includePattern = /#include\s+?"(.+)"/g;

    fs.readFile(newPath, 'utf8', function (err, content) {
        if (err) {
            logger.error(err);
            callback(err);
        } else {
            const matches = [];
            let match;

            while ((match = includePattern.exec(content)) !== null) {
                if (Array.isArray(match) && match.length === 2) {
                    matches.push(match);
                }
            }

            if (matches.length > 0) {
                async.eachSeries(matches, function (match, cb) {
                    //logger.log(match[0], match[1]);

                    const newIncludePath = getNewPath(match[1]);

                    //logger.log('includePath', match[1], '->', newIncludePath);

                    getIncludeFullPath(match[1], [path.dirname(oldPath)].concat(includePaths), function (fullPath) {
                        //logger.log('fullPath', newPath, match[1], fullPath);

                        if (!fullPath) {
                            cb();
                            return;
                        }

                        const newRelativePath = getNewPath(match[1]);
                        const newIncludeFilePath = path.join(outputFolder, newRelativePath);

                        //logger.log('newRelativePath', newRelativePath);
                        //logger.log('newIncludeFilePath', newIncludeFilePath);

                        //logger.log('replace', match[1], '->', newIncludePath);
                        content = content.replace(match[1], newIncludePath);

                        fs.copy(fullPath, newIncludeFilePath, function (err) {
                            if (err) {
                                logger.error(err);
                                cb(err);
                            } else {
                                processIncludes(fullPath, newIncludeFilePath, cb);
                            }
                        });
                    });

                }, function (err) {
                    if (err) {
                        callback(err);
                    } else {
                        fs.writeFile(newPath, content, 'utf8', function (err) {
                            if (err) {
                                logger.error(err);
                                callback(err);
                            } else {
                                //logger.log(newPath, 'processed');
                                callback();
                            }
                        });
                    }
                });
            } else {
                callback();
            }
        }
    });
}

function getIncludeFullPath(filePath, paths, callback) {
    async.detect(paths, function (includePath, callback) {
        fs.access(path.join(includePath, filePath), function (err) {
            callback(null, !err)
        });
    }, function(err, existingFilePath) {
        if (existingFilePath) {
            callback(path.join(existingFilePath, filePath));
        } else {
            callback();
        }
    });
}

function getNewPath(oldPath) {
    const pattern = /(modules|drivers)\/(.+?)\/.*\/(.+?)$/;
    const match = pattern.exec(oldPath);
    const fileName = path.basename(oldPath);

    if (Array.isArray(match) && match.length === 4) {
        return path.posix.join.apply(this, match.slice(1));
    } else {
        return fileName;
    }
}