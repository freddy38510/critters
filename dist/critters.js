function _interopDefault (ex) { return (ex && (typeof ex === 'object') && 'default' in ex) ? ex['default'] : ex; }

var jsdom = require('jsdom');
var path = _interopDefault(require('path'));
var prettyBytes = _interopDefault(require('pretty-bytes'));
var postcss = _interopDefault(require('postcss'));
var cssnano = _interopDefault(require('cssnano'));

function createDocument(html) {
    var jsdom$$1 = new jsdom.JSDOM(html, {
        contentType: 'text/html'
    });
    var window = jsdom$$1.window;
    var document = window.document;
    document.$jsdom = jsdom$$1;
    return document;
}

function serializeDocument(document) {
    return document.$jsdom.serialize();
}

function setNodeText(node, text) {
    while (node.lastChild) {
        node.removeChild(node.lastChild);
    }
    node.appendChild(node.ownerDocument.createTextNode(text));
}

var css = require('css');
function parseStylesheet(stylesheet) {
    return css.parse(stylesheet);
}

function serializeStylesheet(ast, options) {
    return css.stringify(ast, options);
}

function markOnly(predicate) {
    return function (rule) {
        var sel = rule.selectors;
        if (predicate(rule) === false) {
            rule.$$remove = true;
        }
        rule.$$markedSelectors = rule.selectors;
        if (rule._other) {
            rule._other.$$markedSelectors = rule._other.selectors;
        }
        rule.selectors = sel;
    };
}

function applyMarkedSelectors(rule) {
    if (rule.$$markedSelectors) {
        rule.selectors = rule.$$markedSelectors;
    }
    if (rule._other) {
        applyMarkedSelectors(rule._other);
    }
}

function walkStyleRules(node, iterator) {
    if (node.stylesheet) 
        { return walkStyleRules(node.stylesheet, iterator); }
    node.rules = node.rules.filter(function (rule) {
        if (rule.rules) {
            walkStyleRules(rule, iterator);
        }
        rule._other = undefined;
        rule.filterSelectors = filterSelectors;
        return iterator(rule) !== false;
    });
}

function walkStyleRulesWithReverseMirror(node, node2, iterator) {
    if (node2 === null) 
        { return walkStyleRules(node, iterator); }
    if (node.stylesheet) 
        { return walkStyleRulesWithReverseMirror(node.stylesheet, node2.stylesheet, iterator); }
    var assign;
    (assign = splitFilter(node.rules, node2.rules, function (rule, index, rules, rules2) {
        var rule2 = rules2[index];
        if (rule.rules) {
            walkStyleRulesWithReverseMirror(rule, rule2, iterator);
        }
        rule._other = rule2;
        rule.filterSelectors = filterSelectors;
        return iterator(rule) !== false;
    }), node.rules = assign[0], node2.rules = assign[1]);
}

function splitFilter(a, b, predicate) {
    var aOut = [];
    var bOut = [];
    for (var index = 0;index < a.length; index++) {
        if (predicate(a[index], index, a, b)) {
            aOut.push(a[index]);
        } else {
            bOut.push(a[index]);
        }
    }
    return [aOut,bOut];
}

function filterSelectors(predicate) {
    if (this._other) {
        var ref = splitFilter(this.selectors, this._other.selectors, predicate);
        var a = ref[0];
        var b = ref[1];
        this.selectors = a;
        this._other.selectors = b;
    } else {
        this.selectors = this.selectors.filter(predicate);
    }
}

module.exports.parseStylesheet = parseStylesheet;
module.exports.serializeStylesheet = serializeStylesheet;
module.exports.markOnly = markOnly;
module.exports.applyMarkedSelectors = applyMarkedSelectors;
module.exports.walkStyleRules = walkStyleRules;
module.exports.walkStyleRulesWithReverseMirror = walkStyleRulesWithReverseMirror;

var Critters = function Critters(options) {
    this.options = Object.assign({
        logLevel: 'info'
    }, options || {});
    this.options.pruneSource = this.options.pruneSource !== false;
    this.urlFilter = this.options.filter;
    if (this.urlFilter instanceof RegExp) {
        this.urlFilter = this.urlFilter.test.bind(this.urlFilter);
    }
    this.logger = options.logger;
    this.outputPath = options.outputPath;
    this.publicPath = options.publicPath;
};
Critters.prototype.readFile = function readFile (filename) {
    var fs = this.fs;
    return new Promise(function (resolve, reject) {
        var callback = function (err, data) {
            if (err) 
                { reject(err); }
             else 
                { resolve(data); }
        };
        if (fs && fs.readFile) {
            fs.readFile(filename, callback);
        } else {
            require('fs').readFile(filename, 'utf8', callback);
        }
    });
};
Critters.prototype.process = function process (html) {
    return new Promise((function ($return, $error) {
            var this$1 = this;

        var document, styles;
        document = createDocument(html);
        document.body.className = this.bodyClasses;
        if (this.options.external !== false) {
            var externalSheets;
            externalSheets = [].slice.call(document.querySelectorAll('link[rel="stylesheet"]'));
            return Promise.all(externalSheets.map(function (link) { return this$1.embedLinkedStylesheet(link); })).then((function ($await_7) {
                try {
                    return $If_3.call(this);
                } catch ($boundEx) {
                    return $error($boundEx);
                }
            }).bind(this), $error);
        }
        function $If_3() {
                var this$1 = this;

            styles = [].slice.call(document.querySelectorAll('style'));
            return Promise.all(styles.map(function (style) { return this$1.processStyle(style, document); })).then((function ($await_8) {
                try {
                    if (this.options.mergeStylesheets !== false && styles.length !== 0) {
                        return this.mergeStylesheets(document).then((function ($await_9) {
                            try {
                                return $If_4.call(this);
                            } catch ($boundEx) {
                                return $error($boundEx);
                            }
                        }).bind(this), $error);
                    }
                    function $If_4() {
                        return $return(serializeDocument(document));
                    }
                        
                    return $If_4.call(this);
                } catch ($boundEx) {
                    return $error($boundEx);
                }
            }).bind(this), $error);
        }
            
        return $If_3.call(this);
    }).bind(this));
};
Critters.prototype.mergeStylesheets = function mergeStylesheets (document) {
    return new Promise((function ($return, $error) {
        var styles, first, sheet;
        styles = [].slice.call(document.querySelectorAll('style'));
        if (styles.length === 0) {
            this.logger.warn('Merging inline stylesheets into a single <style> tag skipped, no inline stylesheets to merge');
            return $return();
        }
        first = styles[0];
        sheet = first.textContent;
        for (var i = 1;i < styles.length; i++) {
            var node = styles[i];
            sheet += node.textContent;
            node.remove();
        }
        if (this.options.compress !== false) {
            var before, processor, result;
            before = sheet;
            processor = postcss([cssnano()]);
            return processor.process(before, {
                from: undefined
            }).then((function ($await_10) {
                try {
                    result = $await_10;
                    sheet = result.css;
                    return $If_5.call(this);
                } catch ($boundEx) {
                    return $error($boundEx);
                }
            }).bind(this), $error);
        }
        function $If_5() {
            setNodeText(first, sheet);
            return $return();
        }
            
        return $If_5.call(this);
    }).bind(this));
};
Critters.prototype.embedLinkedStylesheet = function embedLinkedStylesheet (link) {
    return new Promise((function ($return, $error) {
        var href, media, document, preloadMode, normalizedPath, pathPrefix, filename, relativePath, asset, sheet, cssLoaderPreamble, lazy, style, noscriptFallback;
        href = link.getAttribute('href');
        media = link.getAttribute('media');
        document = link.ownerDocument;
        preloadMode = this.options.preload;
        if (this.urlFilter ? this.urlFilter(href) : href.match(/^(https?:)?\/\//)) 
            { return $return(Promise.resolve()); }
        normalizedPath = href.replace(/^\//, '');
        pathPrefix = (this.publicPath || '').replace(/(^\/|\/$)/g, '') + '/';
        if (normalizedPath.indexOf(pathPrefix) === 0) {
            normalizedPath = normalizedPath.substring(pathPrefix.length).replace(/^\//, '');
        }
        filename = path.resolve(this.outputPath, normalizedPath);
        relativePath = path.relative(this.outputPath, filename).replace(/^\.\//, '');
        asset = false;
        sheet = false;
        if (!sheet) {
            var $Try_1_Post = (function () {
                try {
                    return $If_6.call(this);
                } catch ($boundEx) {
                    return $error($boundEx);
                }
            }).bind(this);
            var $Try_1_Catch = (function (e) {
                try {
                    this.logger.warn(("Unable to locate stylesheet: " + relativePath));
                    return $return();
                } catch ($boundEx) {
                    return $error($boundEx);
                }
            }).bind(this);
            try {
                return this.readFile(filename).then((function ($await_11) {
                    try {
                        sheet = $await_11;
                        this.logger.warn(("Stylesheet \"" + relativePath + "\" not found in assets, but a file was located on disk." + (this.options.pruneSource ? ' This means pruneSource will not be applied.' : '')));
                        return $Try_1_Post();
                    } catch ($boundEx) {
                        return $Try_1_Catch($boundEx);
                    }
                }).bind(this), $Try_1_Catch);
            } catch (e) {
                $Try_1_Catch(e);
            }
        }
        function $If_6() {
            cssLoaderPreamble = "function $loadcss(u,m,l){(l=document.createElement('link')).rel='stylesheet';l.href=u;document.head.appendChild(l)}";
            lazy = preloadMode === 'js-lazy';
            if (lazy) {
                cssLoaderPreamble = cssLoaderPreamble.replace('l.href', "l.media='only x';l.onload=function(){l.media=m};l.href");
            }
            style = document.createElement('style');
            style.appendChild(document.createTextNode(sheet));
            link.parentNode.insertBefore(style, link);
            if (this.options.inlineThreshold && sheet.length < this.options.inlineThreshold) {
                style.$$reduce = false;
                this.logger.info(("\u001b[32mInlined all of " + href + " (" + (sheet.length) + " was below the threshold of " + (this.options.inlineThreshold) + ")\u001b[39m"));
                if (asset) {} else {
                    this.logger.warn(("  > " + href + " was not found in assets. the resource may still be emitted but will be unreferenced."));
                }
                link.parentNode.removeChild(link);
                return $return();
            }
            style.$$name = href;
            style.$$asset = asset;
            style.$$assetName = relativePath;
            style.$$assets = false;
            style.$$links = [link];
            if (preloadMode === false) 
                { return $return(); }
            noscriptFallback = false;
            if (preloadMode === 'body') {
                document.body.appendChild(link);
            } else {
                link.setAttribute('rel', 'preload');
                link.setAttribute('as', 'style');
                if (preloadMode === 'js' || preloadMode === 'js-lazy') {
                    var script;
                    script = document.createElement('script');
                    var js;
                    js = cssLoaderPreamble + "$loadcss(" + (JSON.stringify(href)) + (lazy ? ',' + JSON.stringify(media || 'all') : '') + ")";
                    script.appendChild(document.createTextNode(js));
                    link.parentNode.insertBefore(script, link.nextSibling);
                    style.$$links.push(script);
                    cssLoaderPreamble = '';
                    noscriptFallback = true;
                } else if (preloadMode === 'media') {
                    link.setAttribute('rel', 'stylesheet');
                    link.removeAttribute('as');
                    link.setAttribute('media', 'only x');
                    link.setAttribute('onload', ("this.media='" + (media || 'all') + "'"));
                    noscriptFallback = true;
                } else if (preloadMode === 'swap') {
                    link.setAttribute('onload', "this.rel='stylesheet'");
                    noscriptFallback = true;
                } else {
                    var bodyLink;
                    bodyLink = document.createElement('link');
                    bodyLink.setAttribute('rel', 'stylesheet');
                    if (media) 
                        { bodyLink.setAttribute('media', media); }
                    bodyLink.setAttribute('href', href);
                    document.body.appendChild(bodyLink);
                    style.$$links.push(bodyLink);
                }
            }
            if (this.options.noscriptFallback !== false && noscriptFallback) {
                var noscript;
                noscript = document.createElement('noscript');
                var noscriptLink;
                noscriptLink = document.createElement('link');
                noscriptLink.setAttribute('rel', 'stylesheet');
                noscriptLink.setAttribute('href', href);
                if (media) 
                    { noscriptLink.setAttribute('media', media); }
                noscript.appendChild(noscriptLink);
                link.parentNode.insertBefore(noscript, link.nextSibling);
                style.$$links.push(noscript);
            }
            return $return();
        }
            
        return $If_6.call(this);
    }).bind(this));
};
Critters.prototype.processStyle = function processStyle (style) {
    return new Promise((function ($return, $error) {
        if (style.$$reduce === false) 
            { return $return(); }
        var name = style.$$name ? style.$$name.replace(/^\//, '') : 'inline CSS';
        var options = this.options;
        var document = style.ownerDocument;
        var head = document.querySelector('head');
        var keyframesMode = options.keyframes || 'critical';
        if (keyframesMode === true) 
            { keyframesMode = 'all'; }
        if (keyframesMode === false) 
            { keyframesMode = 'none'; }
        var sheet = style.childNodes.length > 0 && [].map.call(style.childNodes, function (node) { return node.nodeValue; }).join('\n');
        var before = sheet;
        if (!sheet) 
            { return $return(); }
        var ast = parseStylesheet(sheet);
        var astInverse = options.pruneSource ? parseStylesheet(sheet) : null;
        var criticalFonts = '';
        var failedSelectors = [];
        var criticalKeyframeNames = [];
        walkStyleRules(ast, markOnly(function (rule) {
            if (rule.type === 'rule') {
                rule.filterSelectors(function (sel) {
                    if (sel !== ':root') {
                        sel = sel.replace(/(?:>\s*)?::?[a-z-]+\s*(\{|$)/gi, '$1').trim();
                    }
                    if (!sel) 
                        { return false; }
                    try {
                        return document.querySelector(sel) != null;
                    } catch (e) {
                        failedSelectors.push(sel + ' -> ' + e.message);
                        return false;
                    }
                });
                if (rule.selectors.length === 0) {
                    return false;
                }
                if (rule.declarations) {
                    for (var i = 0;i < rule.declarations.length; i++) {
                        var decl = rule.declarations[i];
                        if (decl.property && decl.property.match(/\bfont(-family)?\b/i)) {
                            criticalFonts += ' ' + decl.value;
                        }
                        if (decl.property === 'animation' || decl.property === 'animation-name') {
                            var names = decl.value.split(/\s+/);
                            for (var j = 0;j < names.length; j++) {
                                var name = names[j].trim();
                                if (name) 
                                    { criticalKeyframeNames.push(name); }
                            }
                        }
                    }
                }
            }
            if (rule.type === 'font-face') 
                { return; }
            var rules = rule.rules && rule.rules.filter(function (rule) { return !rule.$$remove; });
            return !rules || rules.length !== 0;
        }));
        if (failedSelectors.length !== 0) {
            this.logger.warn(((failedSelectors.length) + " rules skipped due to selector errors:\n  " + (failedSelectors.join('\n  '))));
        }
        var shouldPreloadFonts = options.fonts === true || options.preloadFonts === true;
        var shouldInlineFonts = options.fonts !== false && options.inlineFonts === true;
        var preloadedFonts = [];
        walkStyleRulesWithReverseMirror(ast, astInverse, function (rule) {
            if (rule.$$remove === true) 
                { return false; }
            applyMarkedSelectors(rule);
            if (rule.type === 'keyframes') {
                if (keyframesMode === 'none') 
                    { return false; }
                if (keyframesMode === 'all') 
                    { return true; }
                return criticalKeyframeNames.indexOf(rule.name) !== -1;
            }
            if (rule.type === 'font-face') {
                var family, src;
                for (var i = 0;i < rule.declarations.length; i++) {
                    var decl = rule.declarations[i];
                    if (decl.property === 'src') {
                        src = (decl.value.match(/url\s*\(\s*(['"]?)(.+?)\1\s*\)/) || [])[2];
                    } else if (decl.property === 'font-family') {
                        family = decl.value;
                    }
                }
                if (src && shouldPreloadFonts && preloadedFonts.indexOf(src) === -1) {
                    preloadedFonts.push(src);
                    var preload = document.createElement('link');
                    preload.setAttribute('rel', 'preload');
                    preload.setAttribute('as', 'font');
                    preload.setAttribute('crossorigin', 'anonymous');
                    preload.setAttribute('href', src.trim());
                    head.appendChild(preload);
                }
                if (!family || !src || criticalFonts.indexOf(family) === -1 || !shouldInlineFonts) 
                    { return false; }
            }
        });
        sheet = serializeStylesheet(ast, {
            compress: this.options.compress !== false
        }).trim();
        if (sheet.trim().length === 0) {
            if (style.parentNode) {
                style.parentNode.removeChild(style);
            }
            return $return();
        }
        var afterText = '';
        if (options.pruneSource) {
            var sheetInverse = serializeStylesheet(astInverse, {
                compress: this.options.compress !== false
            });
            var asset = style.$$asset;
            if (asset) {
                var minSize = this.options.minimumExternalSize;
                if (minSize && sheetInverse.length < minSize) {
                    this.logger.info(("\u001b[32mInlined all of " + name + " (non-critical external stylesheet would have been " + (sheetInverse.length) + "b, which was below the threshold of " + minSize + ")\u001b[39m"));
                    setNodeText(style, before);
                    if (style.$$links) {
                        for (var i = 0, list = style.$$links; i < list.length; i += 1) {
                            var link = list[i];

                                var parent = link.parentNode;
                            if (parent) 
                                { parent.removeChild(link); }
                        }
                    }
                    return $return();
                }
                var percent$1 = sheetInverse.length / before.length * 100;
                afterText = ", reducing non-inlined size " + (percent$1 | 0) + "% to " + (prettyBytes(sheetInverse.length));
            } else {
                this.logger.warn('pruneSource is enabled, but a style (' + name + ') has no corresponding Webpack asset.');
            }
        }
        setNodeText(style, sheet);
        var percent = sheet.length / before.length * 100 | 0;
        this.logger.info('\u001b[32mInlined ' + prettyBytes(sheet.length) + ' (' + percent + '% of original ' + prettyBytes(before.length) + ') of ' + name + afterText + '.\u001b[39m');
        return $return();
    }).bind(this));
};

module.exports = Critters;
//# sourceMappingURL=critters.js.map
