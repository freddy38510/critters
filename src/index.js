/**
 * Copyright 2018 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License"); you may not
 * use this file except in compliance with the License. You may obtain a copy of
 * the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS, WITHOUT
 * WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied. See the
 * License for the specific language governing permissions and limitations under
 * the License.
 */

const path = require('path');
const postcss = require('postcss');
const cssnano = require('cssnano');
const prettyBytes = require('pretty-bytes');
const {
  createDocument,
  serializeDocument,
  serializeElement
} = require('./dom');
const {
  parseStylesheet,
  serializeStylesheet,
  walkStyleRules,
  walkStyleRulesWithReverseMirror,
  markOnly,
  applyMarkedSelectors
} = require('./css');
const { createLogger } = require('./util');

/**
 * Controls which keyframes rules are inlined.
 *
 * - **"critical":** _(default)_ inline keyframes rules that are used by the critical CSS.
 * - **"all":** Inline all keyframes rules.
 * - **"none":** Remove all keyframes rules.
 * @typedef {('critical'|'all'|'none')} KeyframeStrategy
 * @private
 * @property {String} keyframes     Which {@link KeyframeStrategy keyframe strategy} to use (default: `critical`)_
 */

/**
 * Controls log level of the plugin. Specifies the level the logger should use. A logger will
 * not produce output for any log level beneath the specified level. Available levels and order
 * are:
 *
 * - **"info"** _(default)_
 * - **"warn"**
 * - **"error"**
 * - **"trace"**
 * - **"debug"**
 * - **"silent"**
 * @typedef {('info'|'warn'|'error'|'trace'|'debug'|'silent')} LogLevel
 * @public
 */

/**
 * Custom logger interface:
 * @typedef {object} Logger
 * @public
 * @property {function(String)} trace - Prints a trace message
 * @property {function(String)} debug - Prints a debug message
 * @property {function(String)} info - Prints an information message
 * @property {function(String)} warn - Prints a warning message
 * @property {function(String)} error - Prints an error message
 */

/**
 * All optional. Pass them to `new Critters({ ... })`.
 * @public
 * @typedef Options
 * @property {Boolean} external Inline styles from external stylesheets _(default: `true`)_
 * @property {Number} inlineThreshold Inline external stylesheets smaller than a given size _(default: `0`)_
 * @property {Number} minimumExternalSize If the non-critical external stylesheet would be below this size, just inline it _(default: `0`)_
 * @property {Boolean} pruneSource  Remove inlined rules from the external stylesheet _(default: `false`)_
 * @property {Boolean} mergeStylesheets Merged inlined stylesheets into a single <style> tag _(default: `true`)_
 * @property {Boolean} reduceInlineStyles Reduced all styles to only critical CSS _(default: `true`)_
 * @property {Boolean} ssrMode Do not compress merged inlined stylesheets (useful if page is prerendered in ssr mode) _(default: `false`)_
 * @property {String[]} additionalStylesheets Glob for matching other stylesheets to be used while looking for critical CSS _(default: `[]`)_.
 * @property {String} preload Preload stylesheets _(default: `true`)_
 * @property {Boolean} asyncLoadCss Load external stylesheets asynchronously _(default: `true`)_
 * @property {Boolean} noscriptFallback Add `<noscript>` fallback to JS-based strategies _(default: `true`)_
 * @property {String} noscriptPosition Put `<noscript>` at head tag or at the end of body tag _(default: `body`)_
 * @property {Boolean} inlineFonts  Inline critical font-face rules _(default: `false`)_
 * @property {Boolean} preloadFonts Preloads critical fonts _(default: `true`)_
 * @property {Boolean} fonts Shorthand for setting `inlineFonts` and `preloadFonts`
 *  - Values:
 *  - `true` to inline critical font-face rules and preload the fonts
 *  - `false` to don't inline any font-face rules and don't preload fonts
 * @property {String} keyframes     Controls which keyframes rules are inlined.
 *  - Values:
 *  - `"critical"`: _(default)_ inline keyframes rules used by the critical CSS
 *  - `"all"` inline all keyframes rules
 *  - `"none"` remove all keyframes rules
 * @property {Boolean} compress     Compress resulting critical CSS _(default: `true`)_
 * @property {String} logLevel      Controls {@link LogLevel log level} of the plugin _(default: `"info"`)_
 * @property {object} logger        Provide a custom logger interface {@link Logger logger}
 */

module.exports = class Critters {
  /** @private */
  constructor(options) {
    this.options = Object.assign(
      {
        logLevel: 'info',
        externalStylesheets: [],
        path: '',
        publicPath: '',
        reduceInlineStyles: true,
        pruneSource: false,
        additionalStylesheets: [],
        ssrMode: false,
        asyncLoadCss: true,
        preload: true,
        noscriptFallback: true,
        noscriptPosition: 'body',
        minimumExternalSize: 0,
        inlineThreshold: 0
      },
      options || {}
    );

    this.urlFilter = this.options.filter;
    if (this.urlFilter instanceof RegExp) {
      this.urlFilter = this.urlFilter.test.bind(this.urlFilter);
    }

    this.logger = this.options.logger || createLogger(this.options.logLevel);

    this.noscript = [];
  }

  /**
   * Read the contents of a file from the specified filesystem or disk
   */
  readFile(filename) {
    const fs = this.fs;
    return new Promise((resolve, reject) => {
      const callback = (err, data) => {
        if (err) reject(err);
        else resolve(data);
      };
      if (fs && fs.readFile) {
        fs.readFile(filename, callback);
      } else {
        require('fs').readFile(filename, 'utf8', callback);
      }
    });
  }

  /**
   * Apply critical CSS processing to the html
   */
  async process(html) {
    // Parse the generated HTML in a DOM we can mutate
    const document = createDocument(html);

    if (this.options.additionalStylesheets.length > 0) {
      await this.embedAdditionalStylesheet(document);
    }

    // `external:false` skips processing of external sheets
    if (this.options.external !== false) {
      const externalSheets = [].slice.call(
        document.querySelectorAll('link[rel="stylesheet"]')
      );

      await Promise.all(
        externalSheets.map((link) => this.embedLinkedStylesheet(link, document))
      );
    }

    // go through all the style tags in the document and reduce them to only critical CSS
    const styles = this.getAffectedStyleTags(document);

    await Promise.all(
      styles.map((style) => this.processStyle(style, document))
    );

    if (this.options.mergeStylesheets !== false && styles.length !== 0) {
      await this.mergeStylesheets(document);
    }

    let output;

    output = serializeDocument(document, html);

    if (this.options.noscriptFallback) {
      output = this.addNoscriptToOutput(output);
    }

    return output;
  }

  addNoscriptToOutput(result) {
    result = String(result);
    // Add noscript blocks to the end
    if (this.noscript.length === 0 || this.options.noscriptPosition === false) {
      return result;
    }

    if (this.options.noscriptPosition === 'head') {
      return result.replace(
        /([\s\t]*)(<\/\s*head>)/gim,
        `$1$1${this.noscript.join('\n$1$1')}\n$1$2`
      );
    }

    return result.replace(
      /([\s\t]*)(<\/\s*body>)/gim,
      `$1$1${this.noscript.join('\n$1$1')}\n$1$2`
    );
  }

  /**
   * Get the style tags that need processing
   */
  getAffectedStyleTags(document) {
    const styles = [].slice.call(document.querySelectorAll('style'));

    // `reduceInlineStyles:false` skips processing of inline stylesheets
    if (this.options.reduceInlineStyles === false) {
      return styles.filter((style) => style.$$external);
    }
    return styles;
  }

  async mergeStylesheets(document) {
    const styles = this.getAffectedStyleTags(document);
    if (styles.length === 0) {
      this.logger.warn(
        'Merging inline stylesheets into a single <style> tag skipped, no inline stylesheets to merge'
      );
      return;
    }
    const first = styles[0];
    let sheet = first.textContent;

    for (let i = 1; i < styles.length; i++) {
      const node = styles[i];
      sheet += node.textContent;
      first.attribs = Object.assign(first.attribs, node.attribs)
      node.remove();
    }

    if (!this.options.ssrMode && this.options.compress !== false) {
      const before = sheet;
      const processor = postcss([cssnano()]);
      const result = await processor.process(before, { from: undefined });
      // @todo sourcemap support (elsewhere first)
      sheet = result.css;
    }

    first.textContent = sheet;
  }

  /**
   * Given href, find the corresponding CSS asset
   */
  async getCssAsset(filename) {
    let sheet;

    try {
      sheet = await this.readFile(filename);
    } catch (e) {
      this.logger.warn(`Unable to locate stylesheet: ${filename}`);
    }

    return sheet;
  }

  getFilename(href) {
    const outputPath = this.options.path;
    const publicPath = this.options.publicPath;

    // CHECK - the output path
    // path on disk (with output.publicPath removed)
    let normalizedPath = href.replace(/^\//, '');
    const pathPrefix = (publicPath || '').replace(/(^\/|\/$)/g, '') + '/';
    if (normalizedPath.indexOf(pathPrefix) === 0) {
      normalizedPath = normalizedPath
        .substring(pathPrefix.length)
        .replace(/^\//, '');
    }
    return path.resolve(outputPath, normalizedPath);
  }

  checkInlineThreshold(link, style, sheet) {
    if (
      this.options.inlineThreshold &&
      sheet.length < this.options.inlineThreshold
    ) {
      const href = style.$$name;
      style.$$reduce = false;
      this.logger.info(
        `Inlined all of ${href} (${sheet.length} was below the threshold of ${this.options.inlineThreshold})`
      );
      link.remove();
      return true;
    }

    return false;
  }

  /**
   * Inline the stylesheets from options.additionalStylesheets (assuming it passes `options.filter`)
   */
  async embedAdditionalStylesheet(document) {
    const styleSheetsIncluded = [];

    const sources = await Promise.all(
      this.options.additionalStylesheets.map((cssFile) => {
        if (styleSheetsIncluded.includes(cssFile)) {
          return;
        }
        styleSheetsIncluded.push(cssFile);
        const style = document.createElement('style');
        style.$$external = true;
        const filename = this.getFilename(cssFile)

        return this.getCssAsset(filename, style).then((sheet) => [sheet, style]);
      })
    );

    sources.forEach(([sheet, style]) => {
      if (!sheet) return;
      style.textContent = sheet;
      document.head.appendChild(style);
    });
  }

  addNoscript(link, document) {
    const noscript = document.createElement('noscript');
    noscript.appendChild(link);
    this.noscript = [
      ...new Set([
        ...this.noscript,
        `<noscript>${serializeElement(noscript)}</noscript>`
      ])
    ];
  }

  /**
   * Inline the target stylesheet referred to by a <link rel="stylesheet"> (assuming it passes `options.filter`)
   */
  async embedLinkedStylesheet(link, document) {
    const href = link.getAttribute('href');

    // skip filtered resources, or network resources if no filter is provided
    if (this.urlFilter ? this.urlFilter(href) : !(href || '').match(/\.css$/)) {
      return Promise.resolve();
    }

    // the reduced critical CSS gets injected into a new <style> tag
    const style = document.createElement('style');
    style.$$external = true;
    const filename = this.getFilename(href);
    const sheet = await this.getCssAsset(filename, style);

    if (!sheet) {
      return;
    }

    style.textContent = sheet;
    style.$$name = href;
    style.$$links = [link];
    link.parentNode.insertBefore(style, link); // insert style before link

    if (this.checkInlineThreshold(link, style, sheet)) {
      return; // link removed because inlined totally
    }

    // Allow disabling any mutation of the stylesheet link:
    if (this.options.asyncLoadCss === false) return;

    if (
      this.options.noscriptFallback &&
      !this.options.preload // avoid duplicate loading of css
    ) {
      this.addNoscript(link, document);
    }

    link.setAttribute('rel', 'stylesheet');
    link.setAttribute('media', 'print');
    link.setAttribute('onload', "this.media='all'");

      if (this.options.preload && !document.querySelector(`link[rel="preload"][href="${href}"]`)) {
        const preload = document.createElement('link');
        preload.setAttribute('href', link.getAttribute('href'));
        preload.setAttribute('rel', 'preload');
        preload.setAttribute('as', 'style');
        link.parentNode.insertBefore(preload, link);
      }
  }

  /**
   * Prune the source CSS files
   */
  async pruneSource(style, before, sheetInverse) {
    // if external stylesheet would be below minimum size, just inline everything
    const minSize = this.options.minimumExternalSize;
    const name = style.$$name;
    const filename = this.getFilename(name)
    const asset = await this.getCssAsset(filename)

    if (asset) {
      const fs = require('fs').promises

      if (minSize && sheetInverse.length < minSize) {
        this.logger.info(
          `Inlined all of ${name} (non-critical external stylesheet would have been ${sheetInverse.length}b, which was below the threshold of ${minSize})`
        );
        style.textContent = before;
        // remove any associated external resources/loaders:
        if (style.$$links) {
          for (const link of style.$$links) {
            const parent = link.parentNode;
            if (parent) parent.removeChild(link);
          }
        }

        await fs.unlink(filename)

        return true;
      }

      await fs.writeFile(filename, sheetInverse, 'utf-8')
    } else {
      this.logger.warn('pruneSource is enabled, but a style (' + name + ') could not be located.');
    }

    return false;
  }

  /**
   * Parse the stylesheet within a <style> element, then reduce it to contain only rules used by the document.
   */
  async processStyle(style, document) {
    if (style.$$reduce === false) return;

    const name = style.$$name ? style.$$name.replace(/^\//, '') : 'inline CSS';
    const options = this.options;
    // const document = style.ownerDocument;
    const head = document.querySelector('head');
    let keyframesMode = options.keyframes || 'critical';
    // we also accept a boolean value for options.keyframes
    if (keyframesMode === true) keyframesMode = 'all';
    if (keyframesMode === false) keyframesMode = 'none';

    let sheet = style.textContent;

    // store a reference to the previous serialized stylesheet for reporting stats
    const before = sheet;

    // Skip empty stylesheets
    if (!sheet) return;

    const ast = parseStylesheet(sheet);
    const astInverse = options.pruneSource ? parseStylesheet(sheet) : null;

    // a string to search for font names (very loose)
    let criticalFonts = '';

    const failedSelectors = [];

    const criticalKeyframeNames = [];

    // Walk all CSS rules, marking unused rules with `.$$remove=true` for removal in the second pass.
    // This first pass is also used to collect font and keyframe usage used in the second pass.
    walkStyleRules(
      ast,
      markOnly((rule) => {
        if (rule.type === 'rule') {
          // Filter the selector list down to only those match
          rule.filterSelectors((sel) => {
            // Strip pseudo-elements and pseudo-classes, since we only care that their associated elements exist.
            // This means any selector for a pseudo-element or having a pseudo-class will be inlined if the rest of the selector matches.
            if (sel !== ':root') {
              sel = sel.replace(/(?:>\s*)?::?[a-z-]+\s*(\{|$)/gi, '$1').trim();
            }
            if (!sel) return false;

            try {
              return document.querySelector(sel) != null;
            } catch (e) {
              failedSelectors.push(sel + ' -> ' + e.message);
              return false;
            }
          });
          // If there are no matched selectors, remove the rule:
          if (rule.selectors.length === 0) {
            return false;
          }

          if (rule.declarations) {
            for (let i = 0; i < rule.declarations.length; i++) {
              const decl = rule.declarations[i];

              // detect used fonts
              if (decl.property && decl.property.match(/\bfont(-family)?\b/i)) {
                criticalFonts += ' ' + decl.value;
              }

              // detect used keyframes
              if (
                decl.property === 'animation' ||
                decl.property === 'animation-name'
              ) {
                // @todo: parse animation declarations and extract only the name. for now we'll do a lazy match.
                const names = decl.value.split(/\s+/);
                for (let j = 0; j < names.length; j++) {
                  const name = names[j].trim();
                  if (name) criticalKeyframeNames.push(name);
                }
              }
            }
          }
        }

        // keep font rules, they're handled in the second pass:
        if (rule.type === 'font-face') return;

        // If there are no remaining rules, remove the whole rule:
        const rules = rule.rules && rule.rules.filter((rule) => !rule.$$remove);
        return !rules || rules.length !== 0;
      })
    );

    if (failedSelectors.length !== 0 && this.options.logLevel === 'debug') {
      this.logger.warn(
        `${
          failedSelectors.length
        } rules skipped due to selector errors:\n  ${failedSelectors.join(
          '\n  '
        )}`
      );
    }

    const shouldPreloadFonts =
      options.fonts === true || options.preloadFonts === true;
    const shouldInlineFonts =
      options.fonts !== false && options.inlineFonts === true;

    const preloadedFonts = [];
    // Second pass, using data picked up from the first
    walkStyleRulesWithReverseMirror(ast, astInverse, (rule) => {
      // remove any rules marked in the first pass
      if (rule.$$remove === true) return false;

      applyMarkedSelectors(rule);

      // prune @keyframes rules
      if (rule.type === 'keyframes') {
        if (keyframesMode === 'none') return false;
        if (keyframesMode === 'all') return true;
        return criticalKeyframeNames.indexOf(rule.name) !== -1;
      }

      // prune @font-face rules
      if (rule.type === 'font-face') {
        let family, src;
        for (let i = 0; i < rule.declarations.length; i++) {
          const decl = rule.declarations[i];
          if (decl.property === 'src') {
            // @todo parse this properly and generate multiple preloads with type="font/woff2" etc
            src = (decl.value.match(/url\s*\(\s*(['"]?)(.+?)\1\s*\)/) || [])[2];
          } else if (decl.property === 'font-family') {
            family = decl.value;
          }
        }

        if (src && shouldPreloadFonts && preloadedFonts.indexOf(src) === -1) {
          preloadedFonts.push(src);
          const preload = document.createElement('link');
          preload.setAttribute('rel', 'preload');
          preload.setAttribute('as', 'font');
          preload.setAttribute('crossorigin', 'anonymous');
          preload.setAttribute('href', src.trim());
          head.appendChild(preload);
        }

        // if we're missing info, if the font is unused, or if critical font inlining is disabled, remove the rule:
        if (
          !family ||
          !src ||
          criticalFonts.indexOf(family) === -1 ||
          !shouldInlineFonts
        ) {
          return false;
        }
      }
    });

    sheet = serializeStylesheet(ast, {
      compress: this.options.compress !== false
    }).trim();

    // If all rules were removed, get rid of the style element entirely
    if (sheet.trim().length === 0) {
      if (style.parentNode) {
        style.remove();
      }
      return;
    }

    let afterText = '';
    let styleInlinedCompletely = false;
    if (options.pruneSource) {
      const sheetInverse = serializeStylesheet(astInverse, {
        compress: this.options.compress !== false
      });

      styleInlinedCompletely = await this.pruneSource(style, before, sheetInverse);

      if (styleInlinedCompletely) {
        const percent = (sheetInverse.length / before.length) * 100;
        afterText = `, reducing non-inlined size ${
          percent | 0
        }% to ${prettyBytes(sheetInverse.length)}`;
      }
    }

    // replace the inline stylesheet with its critical'd counterpart
    if (!styleInlinedCompletely) {
      style.textContent = sheet;
    }

    // output stats
    const percent = ((sheet.length / before.length) * 100) | 0;
    this.logger.info(
      'Inlined ' +
        prettyBytes(sheet.length) +
        ' (' +
        percent +
        '% of original ' +
        prettyBytes(before.length) +
        ') of ' +
        name +
        afterText
    );
  }
}
