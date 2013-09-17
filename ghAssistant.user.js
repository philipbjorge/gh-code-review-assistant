// ==UserScript==
// @name            GitHub code review assistant
// @description     Toggle diff visibility per file in the commit. Mark reviewed files (preserves refreshes). Useful to review commits with lots of files changed.
// @icon            https://github.com/favicon.ico
// @version         0.10.1.20130917
// @namespace       http://jakub-g.github.com/
// @author          http://jakub-g.github.com/
// @downloadURL     https://raw.github.com/jakub-g/gh-code-review-assistant/master/ghAssistant.user.js
// @userscriptsOrg  http://userscripts.org/scripts/show/153049
// @grant           none
// @include         http*://github.com/*/*/commit/*
// @include         http*://github.com/*/*/pull/*
// @include         http*://github.com/*/*/compare/*
// ==/UserScript==

/*jshint -W043,scripturl:true */

// Changelog:
// 0.1
//  initial version
// 0.1.2
//  includes pull requests
// 0.1.3
//  do not fire the event on child nodes
// 0.1.4
//  fire intelligently on some child nodes
// 0.2.0
//  'expand all' / 'collapse all' button
//  auto hiding on long diff
//  code refactor
// 0.3.0
//  code review mark button
// 0.4.0-20130201
//  accomodated to new GH HTML markup
// 0.4.1-20130212
//  enabled also on /compare/ URLs
// 0.5.0-20130305
//  Works also in Chrome (Tampermonkey) now!
// 0.6.0-20130404
//  Added sidebar and footer to quickly go to the beginning of the current file.
//  Added additional button to mark file as problematic (OK / Fail).
//  After clicking "Reviewed" on file n, scroll to file n, and make the file n+1 expanded.
// 0.6.1.20130417
//  Fix the ugly text shadow on marked files
// 0.6.2.20130417
//  Refactor, comments
// 0.9.0.20130418
//  Local storage support to preserve the review across page refreshes!
// 0.9.1.20130418
//  Moved to separate GitHub repository
// 0.9.2.20130418
//  Fixed regression from 0.6.2 (reviewed file was not hiding on Fail/Ok click)
// 0.9.3.20130419
//  Major code refactor; fixed margin issue with inline comment button on the left
// 0.9.4.20130603
//  Do not hide files passed in the hash of the URL
// 0.9.5.20130801
//  Bring back 'Wipe GHA storage' buttons that disappeared after GH markup change
// 0.9.6.20130913
//  After reviewing an item, the next item is not expanded if it was reviewed; first unreviewed is expanded.
//  (Experimental, disabled) Add 'contenteditable' to be able to inline edit the code of the diffs (each line separately);
//    edits are not saved, not preserved on refresh
// 0.10.0.20130913
//  Support for navigating and executing all the buttons from keyboard.
//  Upon finishing the review of a diff, the next item's to be reviewed filename gets focus.
//  Updating the view accordingly on GHA storage wipe.
// 0.10.1.20130917
//  Expand/collapse button was not keyboard-friendly. Fixed.

// TODO
// 1. On compare pages with really long diffs, it can take a few seconds to load everything.
//    To profile and see if something can be improved.
// 4. Storing CONFIG in the browser instead of the script (script should only provide defaults)

// ============================================ CONFIG =============================================

var CONFIG = {};
// If there's more than N commits in the diff, automatically collapse them all.
// Use 0 to disable that feature.
CONFIG.hideAllWhenMoreThanFiles = 4;

// Automatically collapse entries that have changed more than N lines.
CONFIG.hideFileWhenDiffGt = 0;

// Do not do any of above if small number of files changed in that commit
CONFIG.dontHideUnlessMoreThanFiles = 2;

// Whether to show 'Reviewed' button next to each file
CONFIG.enableReviewedButton = true;

// Whether to show sidebar and footer that scroll to the top of the file on click.
// Below related look'n'feel config
CONFIG.enableDiffSidebarAndFooter = true;
CONFIG.sidebarSize = 12; // in pixels
CONFIG.footerSize = 8;
CONFIG.sidebarColor1 = '#eee';
CONFIG.sidebarColor2 = '#aaa';

// =================================================================================================

var L10N = {
    ok: 'Ok',
    fail: 'Fail',
    expandAll: 'Expand all',
    collapseAll: 'Collapse all',
    buttonWipeAllStorage: 'Wipe ALL GHA storage',
    buttonWipeRepoStorage: 'Wipe GH Assistant storage for this repo',
    alertWipeDone: "Done",
    sidebarFooterTooltip: "Click me to scroll to the top of this file",
    questionWipeAll: "Really want to wipe *all* the GH Assistant storage ",
    questionWipeRepo: "Really want to wipe GH Assistant storage for the repo ",
};

var gha = {
    classes : {},  // classes to be instantiated
    util : {},     // classes with static methods
    instance : {}  // holder of instantiated storage
};

// =================================================================================================

gha.util.DomReader = {};

/**
 * Get a list of containers of the each diff-file.
 */
gha.util.DomReader.getDiffContainers = function() {
    var mainDiffDiv = document.getElementById('files');
    var children = mainDiffDiv.children;
    var nbOfCommits = children.length;

    var out = [];
    for(var i=0, ii = nbOfCommits; i<ii; i++) {
        var child = children[i];
        if(child.id && child.id.indexOf('diff-') === 0){
            out.push(child);
        }
    }
    return out;
};

gha.util.DomReader.getFilePathFromDiffContainerHeader = function (diffContainerHeader) {
    return diffContainerHeader.querySelector('.info').children[1].innerHTML.trim();
};

// =================================================================================================

gha.util.DomWriter = {};

gha.util.DomWriter.ghaReviewButtonClassNameBase = 'ghAssistantButtonState';

gha.util.DomWriter.attachGlobalCss = function () {
    var css = [];

    css.push('a.ghAssistantFileNameSpan {text-decoration: none; margin-left: -10px;  padding: 0 10px;}'); // so that the box's outline looks nicer when focused

    css.push('.ghAssistantButtonStateNormal {\
        background-image:   linear-gradient(to bottom, #fafafa, #eaeaea) !important;\
    }');
    css.push('.ghAssistantButtonStateOk {\
        background-image:   linear-gradient(to bottom, #333, #444) !important;\
        text-shadow: none !important;\
    }');
    css.push('.ghAssistantButtonStateFail {\
        background-image:   linear-gradient(to bottom, #833, #844) !important;\
        text-shadow: none !important;\
    }');

    css.push('.ghAssistantButtonStateNormal a.ghAssistantFileNameSpan { color: #555 !important;}');
    css.push('.ghAssistantButtonStateOk     a.ghAssistantFileNameSpan { color: #fff !important;}');
    css.push('.ghAssistantButtonStateFail   a.ghAssistantFileNameSpan { color: #fff !important;}');

    // we have border, let's tell Firefox not to add its default dotted outline
    css.push('.minibutton:focus {outline: 0;}');

    css.push('.ghAssistantButtonStateNormal .minibutton{text-shadow: none !important; background-image: linear-gradient(to bottom, #fafafa, #eaeaea) !important;}');
    css.push('.ghAssistantButtonStateFail   .minibutton{text-shadow: none !important; background-image: linear-gradient(to bottom, #833, #844) !important;       color:#fff !important;}');
    css.push('.ghAssistantButtonStateOk     .minibutton{text-shadow: none !important; background-image: linear-gradient(to bottom, #333, #344) !important;       color:#fff !important;}');

    // default GH CSS is suited only for their one button "view file", let's fix it as we add 2 more buttons
    css.push('.ghAssistantButtonStateNormal .minibutton:focus {border-radius: 3px; box-shadow: 0 0 3px 4px rgba(81, 167, 232, 0.5);}');
    css.push('.ghAssistantButtonStateFail   .minibutton:focus {border-radius: 3px; box-shadow: 0 0 3px 4px #fc0; border-color: #da0;}');
    css.push('.ghAssistantButtonStateOk     .minibutton:focus {border-radius: 3px; box-shadow: 0 0 3px 4px #fc0; border-color: #da0;}');

    css.push('.ghAssistantFileNameSpan:focus {outline:0; border-radius:5px;}');
    css.push('.ghAssistantButtonStateNormal .ghAssistantFileNameSpan:focus {box-shadow: 0 0 3px 4px rgba(81, 167, 232, 0.5);}');
    css.push('.ghAssistantButtonStateFail   .ghAssistantFileNameSpan:focus {box-shadow: 0 0 3px 4px #fc0;}');
    css.push('.ghAssistantButtonStateOk     .ghAssistantFileNameSpan:focus {box-shadow: 0 0 3px 4px #fc0;}');

    css.push('.ghAssistantStorageWipe {\
        margin:40px 5px 20px 20px;\
    }');

    if (CONFIG.enableDiffSidebarAndFooter) {
        css.push('.ghAssistantFileFoot {\
            height: ' + CONFIG.footerSize + 'px;\
            border-top: 1px solid rgb(216, 216, 216);\
            background-image: linear-gradient(' + CONFIG.sidebarColor1 + ', ' + CONFIG.sidebarColor2 + ');\
            font-size: 6pt;}\
        ');
        css.push('.ghAssistantFileSide {\
            width: '+ CONFIG.sidebarSize + 'px;  border-right: 1px solid rgb(216, 216, 216);\
            background-image: linear-gradient(to right, ' + CONFIG.sidebarColor2 + ', ' + CONFIG.sidebarColor1 + ');\
            font-size: 6pt;\
            height: 100%;\
            float: left;\
            position: absolute;\
            top:0;\
            left:-' + (CONFIG.sidebarSize+2) + 'px;\
            border-radius:0 0 0 10px;}\
        ');

        css.push('.ghAssistantFileFoot > a:hover, .ghAssistantFileFoot > a:focus {\
            background-image: linear-gradient(' + CONFIG.sidebarColor2 + ', ' + CONFIG.sidebarColor1 + ');\
            outline: 0;\
        }');
        css.push('.ghAssistantFileSide> a:hover {\
            background-image: linear-gradient(to right, ' + CONFIG.sidebarColor1 + ', ' + CONFIG.sidebarColor2 + ');\
        }');

        css.push('.ghAssistantFileFoot > a {display: block; height:100%;}');
        css.push('.ghAssistantFileSide > a {display: block; height:100%;}');

        // override GH's CSS with the "+" button on the side to add the comments
        css.push('#files .add-line-comment  { margin-left:-'+ (25+CONFIG.sidebarSize)+'px} !important');
    }

    gha.util.DomUtil.addCss(css.join('\n'));
};

/**
 * Attach click listeners to each of the headers of the files in the diff
 */
gha.util.DomWriter.attachToggleDisplayOnClickListeners = function() {
    var diffContainers = gha.util.DomReader.getDiffContainers();

    for(var i=0, ii = diffContainers.length; i<ii; i++) {
        gha.util.DomWriter._attachClickListenersToChild(diffContainers[i]);
    }
};

gha.util.DomWriter._attachClickListenersToChild = function (diffContainer) {
    if(!diffContainer.id || diffContainer.id.indexOf('diff-') == -1){
        return;
    }

    // We want the evt to fire on the header and some, but not all of the children...
    var diffContainerHeader = diffContainer.children[0];
    var diffContainerFileNameHeader = diffContainerHeader.children[0];

    var diffContainerBody = diffContainer.children[1];

    var handlerForFileNameHeader = gha.util.ClickHandlers.createToggleDisplayHandler(diffContainerBody, false);
    var handlerForHeader         = gha.util.ClickHandlers.createToggleDisplayHandler(diffContainerBody, true);

    diffContainerFileNameHeader.addEventListener('click', handlerForFileNameHeader, false);
    diffContainerHeader        .addEventListener('click', handlerForHeader, true);
    diffContainerHeader        .style.cursor = 'pointer';
};

/**
 * Add buttons that collapse/expand all the diffs on the current page.
 */
gha.util.DomWriter.attachCollapseExpandDiffsButton = function (hiddenByDefault) {

    var buttonBarContainer = document.querySelector('#toc');
    var buttonBar = buttonBarContainer.children[0];

    var newButton = document.createElement('a');
    newButton.className = 'minibutton';
    newButton.tabIndex = 0;
    newButton.href = 'javascript:void(0);';

    newButton.innerHTML = hiddenByDefault ? L10N.expandAll : L10N.collapseAll;

    var nowHidden = hiddenByDefault; // closure to keep state
    newButton.addEventListener('click', function(evt) {
        if(nowHidden){
            gha.util.VisibilityManager.toggleDisplayAll(true);
            nowHidden = false;
            newButton.innerHTML = L10N.collapseAll;
        } else {
            gha.util.VisibilityManager.toggleDisplayAll(false);
            nowHidden = true;
            newButton.innerHTML = L10N.expandAll;
        }
    });

    buttonBar.appendChild(newButton);
};

/**
 * Attach Ok/Fail buttons for code review, and sidebars/footers for navigating to the top of the file,
 * for each of the files on the diff list.
 */
gha.util.DomWriter.attachPerDiffFileFeatures = function () {

    var mainDiffDiv = document.getElementById('files');
    var children = mainDiffDiv.children;
    var nbOfCommits = children.length;

    for(var i=0, ii = nbOfCommits; i<ii; i++) {
        var child = children[i];
        if(!child.id) {
            continue;
        }
        if (CONFIG.enableReviewedButton) {
            gha.util.DomWriter._attachReviewStatusButton(child, L10N.ok);
            gha.util.DomWriter._attachReviewStatusButton(child, L10N.fail);
            gha.util.DomWriter.makeFileNameKeyboardAccessible(child);
        }
        if (CONFIG.enableDiffSidebarAndFooter) {
            gha.util.DomWriter._attachSidebarAndFooter(child);
        }
    }
};

gha.util.DomWriter.makeFileNameKeyboardAccessible = function (child) {
    var fileNameSpan = child.querySelector('.info > .js-selectable-text');
    // turns out getting parent is impossible after changing outerHTML, let's do it now
    var diffContainerBody = fileNameSpan.parentNode.parentNode.parentNode.children[1];
    fileNameSpan.className += ' ghAssistantFileNameSpan';

    // Yeah this is bad and fragile, but I don't want to create yet another button.
    // Let's make this span be an anchor, so it magically gets support for executing 'onclick' from keyboard event
    // See http://jakub-g.github.io/accessibility/onclick/
    fileNameSpan.tabIndex = 0;
    fileNameSpan.outerHTML = fileNameSpan.outerHTML.replace('span', 'a');

    // Firefox bug (or feature): after writing to outerHTML, can't use the handle to 'fileNameSpan' to write 'href';
    // it's discarded, probably the browser still think it's a span
    child.querySelector('.ghAssistantFileNameSpan').href = 'javascript:void(0);';

    // Ok, now we're keyboard-reachable, let's add an event listener then which shows/hides the diff
    var handler = gha.util.ClickHandlers.createToggleDisplayHandler(diffContainerBody, true);
    fileNameSpan.addEventListener('click', handler, false);
};

gha.util.DomWriter._attachReviewStatusButton = function (diffContainer, text /*also cssClassNamePostfix*/) {
    if(!diffContainer.id || diffContainer.id.indexOf('diff-') == -1){
        return;
    }

    var newButton = document.createElement('a');
    newButton.className = 'minibutton';
    newButton.href = "javascript:void(0)"; // crucial to make it launchable from keyboard
    newButton.tabIndex = 0;
    newButton.innerHTML = text;
    newButton.addEventListener('click', gha.util.ClickHandlers.createReviewButtonHandler(text, diffContainer));

    var parentOfNewButton = diffContainer.querySelector('div.actions > div.button-group');
    gha.util.DomUtil.insertAsFirstChild(newButton, parentOfNewButton);
};

/**
 * Add sidebar and footer to each of the files in the diff. When clicked, that sidebar/footer
 * scrolls page to the top of the current file.
 */
gha.util.DomWriter._attachSidebarAndFooter = function (child) {
    if(!child.id || child.id.indexOf('diff-') == -1){
        return;
    }

    var diffContainer = child;
    var diffContainerBody = diffContainer.children[1];

    var hLink = '<a tabIndex=0 title="' + L10N.sidebarFooterTooltip + '" href="#' + diffContainer.id + '">&nbsp;</a>';

    var dfoot = document.createElement('div');
    dfoot.className = 'ghAssistantFileFoot';
    dfoot.innerHTML = hLink;
    diffContainer.appendChild(dfoot);

    var dsidebar = document.createElement('div');
    dsidebar.className = 'ghAssistantFileSide';
    dsidebar.innerHTML = hLink.replace('tabIndex=0', 'tabIndex=-1'); // let only footer be TAB-navigable, no need to have both
    diffContainer.appendChild(dsidebar);
};

gha.util.DomWriter.attachStorageWipeButtons = function () {
    var footer = document.querySelector('body > .container');

    var div = document.createElement('div');
    var buttonAll = document.createElement('button');
    buttonAll.innerHTML = L10N.buttonWipeAllStorage;
    buttonAll.className = 'minibutton ghAssistantStorageWipe';
    buttonAll.tabIndex = 0;
    buttonAll.addEventListener('click', function () {
        var msg = L10N.questionWipeAll + " (" + gha.instance.storage.checkSize() + " entries)?";
        if( window.confirm(msg) ) {
            gha.instance.storage.wipeStorage(null);
            window.alert(L10N.alertWipeDone);
        }
    });

    var repoId = gha.instance.storage._repoId;
    var prefix = gha.instance.storage._prefix + repoId;

    var buttonRepo = document.createElement('button');
    buttonRepo.innerHTML = L10N.buttonWipeRepoStorage;
    buttonRepo.className = 'minibutton ghAssistantStorageWipe';
    buttonRepo.tabIndex = 0;
    buttonRepo.addEventListener('click', function () {
        var msg = L10N.questionWipeRepo + repoId + " (" + gha.instance.storage.checkSize(prefix) + " entries)?";
        if( window.confirm(msg) ) {
            gha.instance.storage.wipeStorage(prefix);
            window.alert(L10N.alertWipeDone);
        }
    });

    div.appendChild(buttonRepo);
    div.appendChild(buttonAll);
    footer.appendChild(div);
};

gha.util.DomWriter.enableEditing = function () {
    document.getElementById('files').setAttribute('contenteditable', true);
    document.body.setAttribute('spellcheck', false); // needs to be set on BODY to not mark contenteditable elements in red
    /*var items = document.querySelectorAll('td.diff-line-code');
    for(var i=0, ii = items.length, item; item = items[i], i < ii; i++) {
        item.setAttribute('contenteditable', true); // setting it on some parent elements results in not so good behavior in Firefox
    }*/
};

// =================================================================================================

gha.util.VisibilityManager = {};

/**
 * Hide long diffs, i.e. those whose diff size is > @minDiff
 * @param {Integer} minDiff
 */
gha.util.VisibilityManager.hideLongDiffs = function(minDiff) {

    var mainDiffDiv = document.getElementById('files');
    var children = mainDiffDiv.children;
    var nbOfCommits = children.length;

    var hashInUrl = document.location.hash.replace('#', '');
    for(var i=0, ii = nbOfCommits; i<ii; i++) {
        var child = children[i];
        if(!child.id || child.id.indexOf('diff-') == -1){
            continue;
        }

        var diffContainer = child;
        var diffContainerBody = diffContainer.children[1];

        var diffStats = parseInt(diffContainer.children[0].children[0].children[0].firstChild.textContent, 10);
        //console.log(diffStats);

        var fileName = diffContainer.querySelector('.meta').getAttribute('data-path');
        if(diffStats > minDiff && fileName != hashInUrl){
            diffContainerBody.style.display = 'none';
        }
    }
};

/**
 * Collapse/expand all the diffs on the current page.
 * @param {Boolean} bVisible state after this invocation (true = hide items)
 * @param {Boolean} bKeepItemFromUrlHash whether to skip hiding files that were passed by hash in the URL. Default false.
 */
gha.util.VisibilityManager.toggleDisplayAll = function(bVisible, bKeepItemFromUrlHash) {

    bKeepItemFromUrlHash = (bKeepItemFromUrlHash === true);
    var mainDiffDiv = document.getElementById('files');
    var children = mainDiffDiv.children;
    var nbOfCommits = children.length;

    var newDisplay = bVisible ? 'block' : 'none';

    var hashInUrl = document.location.hash.replace('#', '');
    for(var i=0, ii = nbOfCommits; i<ii; i++) {
        var child = children[i];
        if(!child.id || child.id.indexOf('diff-') == -1){
            continue;
        }

        var diffContainer = child;
        var diffContainerBody = diffContainer.children[1];
        var fileName = diffContainer.querySelector('.meta').getAttribute('data-path');

        if (bKeepItemFromUrlHash && !bVisible && fileName == hashInUrl){
            continue;
        }
        diffContainerBody.style.display = newDisplay;
    }
};

// =================================================================================================

gha.util.ClickHandlers = {};

/**
 * @param elem element to be toggled upon clicking
 * @param bStrictTarget whether the event listener should fire only on its strict target or also children
 */
gha.util.ClickHandlers.createToggleDisplayHandler = function(elem, bStrictTarget) {
    return function(evt){
        if(bStrictTarget){
            if (evt.currentTarget != evt.target) {
                // don't want to trigger the event when clicking on "View file" or "Show comment"
                return;
            }
        }

        var currDisplay = elem.style.display;
        if(currDisplay === 'none') {
            elem.style.display = 'block';
        } else {
            elem.style.display = 'none';
        }
    };
};

gha.util.ClickHandlers.createReviewButtonHandler = function (text, diffContainer) {
    return function(evt) {

        var diffContainerHeader = diffContainer.children[0]; // .meta
        var diffContainerBody = diffContainer.children[1];   // .data
        var currentDiffIdx = Number(diffContainer.id.replace('diff-',''));

        var btnBaseClass = gha.util.DomWriter.ghaReviewButtonClassNameBase;
        var ghaClassName = btnBaseClass + text;
        var ghaClassNameAlt = btnBaseClass + (text === L10N.ok ? L10N.fail : L10N.ok);
        var wasMarked = diffContainerHeader.className.indexOf(ghaClassName) > -1;
        var filePath = gha.util.DomReader.getFilePathFromDiffContainerHeader(diffContainerHeader);

        if(wasMarked){
            /* unmark */

            // remove from localstorage
            gha.instance.storage.clearState(filePath);

            // unmark the header with background color change
            gha.util.ReviewStatusMarker.unmark(diffContainerHeader, ghaClassName);
        } else {
            /* mark as Ok/Fail */

            // save in localstorage
            var newState = (text === L10N.ok ? 1 : 0);
            gha.instance.storage.saveState(filePath, newState);

            // mark the header with background color change
            gha.util.ReviewStatusMarker.mark(diffContainerHeader, ghaClassName, ghaClassNameAlt);

            // hide the just-reviewed file contents
            diffContainerBody.style.display = 'none';

            // scroll the page so that currently reviewed file is in the top
            document.location = '#diff-' + currentDiffIdx;

            // expand the next not-yet-reviewed file, if any (without looping to the beginning)
            var nextFileContainer = gha.util.ReviewStatusMarker.findNextUnmarked(currentDiffIdx);
            if (nextFileContainer) {
                // make the diff visible
                nextFileContainer.children[1].style.display = 'block';

                // move focus to the file name
                nextFileContainer.querySelector('.ghAssistantFileNameSpan').focus();
            }
        }
    };
};

// =================================================================================================

gha.util.ReviewStatusMarker = {
    mark : function (diffContainerHeader, ghaClassName, ghaClassNameAlt) {
        var btnBaseClass = gha.util.DomWriter.ghaReviewButtonClassNameBase;
        // 0 remove 'Normal'
        // 1 remove 'Ok' if we're setting 'Fail' and the opposite as well
        // 2 add the class name for 'Fail' / 'Ok'
        diffContainerHeader.className = diffContainerHeader.className.replace(btnBaseClass + "Normal",'').replace(ghaClassNameAlt, '') + " " + ghaClassName;
    },

    unmark : function (diffContainerHeader, ghaClassName) {
        var btnBaseClass = gha.util.DomWriter.ghaReviewButtonClassNameBase;
        // remove the added class name for 'Fail' / 'Ok', add class for 'Normal'
        diffContainerHeader.className = diffContainerHeader.className.replace(ghaClassName, '') + " " + btnBaseClass + "Normal";
    },

    findNextUnmarked : function (diffIdx) {
        var btnBaseClass = gha.util.DomWriter.ghaReviewButtonClassNameBase;
        var wasReviewed = true;
        var fileContainer;

        while (wasReviewed) {
            ++diffIdx;
            fileContainer = document.getElementById('diff-' + diffIdx);

            if (!fileContainer) {
                return null;
            }
            var cn = fileContainer.children[0].className;
            wasReviewed = (cn.indexOf(btnBaseClass + "Ok") != -1) || (cn.indexOf(btnBaseClass + "Fail") != -1);
            if (!wasReviewed) {
                return fileContainer;
            } // else continue the loop
        }
    },

    unmarkAll : function () {
        var btnBaseClass = gha.util.DomWriter.ghaReviewButtonClassNameBase;
        var diffContainers = gha.util.DomReader.getDiffContainers();

        for(var i=0, ii = diffContainers.length; i<ii; i++) {
            var diffContainerHeader = diffContainers[i].children[0];
            gha.util.ReviewStatusMarker.unmark (diffContainerHeader, btnBaseClass + "Ok");
            gha.util.ReviewStatusMarker.unmark (diffContainerHeader, btnBaseClass + "Fail");
        }
    }
};

// =================================================================================================

gha.classes.GHALocalStorage = function () {

    this._prefix = "__GHA__";

    // @type {String} objectId either
    this._objectId = null;
    this._repoId = null;

    this.init = function () {
        var loc = document.location.pathname.replace(/\//g,'#'); // for easier regexes
        var matches = loc.match(/^#([a-z0-9\-]+#[a-z0-9\-]+)#(commit|pull|compare)#([a-z0-9\-]+)/);
        if (matches) {
            this._objectId = matches[0];
            this._repoId = "#" + matches[1]; // we want repoId to be a leading substring of objectId
        } else {
            console.error("Unable to create a local storage key for " + loc);
            this.saveState = this.loadState = this.clearState = function () {};
        }
    };

    /**
     * @param {String} filePath
     * @param {Integer} state 0 (fail), 1 (ok)
     */
    this.saveState = function (filePath, state) {
        var sKey = this._getKeyFromObjId(filePath);
        window.localStorage.setItem(sKey, state);
    };

    /**
     * @param {String} filePath
     */
    this.loadState = function (filePath) {
        var sKey = this._getKeyFromObjId(filePath);
        var value = window.localStorage.getItem(sKey);
        return value;
    };

    this.clearState = function (filePath) {
        var sKey = this._getKeyFromObjId(filePath);
        window.localStorage.removeItem(sKey);
    };

    this.wipeStorage = function (arbitraryPrefix) {
        arbitraryPrefix = arbitraryPrefix || this._prefix;

        for (var key in window.localStorage){
            if(key.slice(0, arbitraryPrefix.length) === arbitraryPrefix) {
                window.localStorage.removeItem(key);
            }
        }

        gha.util.ReviewStatusMarker.unmarkAll();
    };

    this.checkSize = function (arbitraryPrefix) {
        arbitraryPrefix = arbitraryPrefix || this._prefix;

        var n = 0;
        for (var key in window.localStorage){
            if(key.slice(0, arbitraryPrefix.length) === arbitraryPrefix) {
                n++;
            }
        }
        return n;
    };

    this._getKeyFromObjId = function (filePath) {
        return this._prefix + this._objectId + filePath.replace(/\//g, '#');
    };
};

// =================================================================================================

gha.classes.GHALocalStorageLoader = function (storage) {

    this._storage = storage;

    this.run = function () {
        var diffContainers = gha.util.DomReader.getDiffContainers();

        for(var i=0, ii = diffContainers.length; i<ii; i++) {
            this._updateStateFromStorage(diffContainers[i]);
        }
    };

    this._updateStateFromStorage = function(diffContainer) {
        var diffContainerHeader = diffContainer.children[0];

        var filePath = gha.util.DomReader.getFilePathFromDiffContainerHeader(diffContainerHeader);
        var state = this._storage.loadState(filePath); // might be 0, 1 or undefined

        var btnBaseClass = gha.util.DomWriter.ghaReviewButtonClassNameBase;
        if(state !== null) {
            var text = (state === "0") ? L10N.fail : L10N.ok;
            var ghaClassName = btnBaseClass + text;
            var ghaClassNameAlt = btnBaseClass + (text === L10N.ok ? L10N.fail : L10N.ok);

            gha.util.ReviewStatusMarker.mark (diffContainerHeader, ghaClassName, ghaClassNameAlt);
        } else {
            gha.util.ReviewStatusMarker.unmark (diffContainerHeader, null);
        }
    };
};

// =================================================================================================

gha.util.DomUtil = {
    addCss : function (sCss) {
        var dStyle = document.createElement('style');
        dStyle.type = 'text/css';
        dStyle.appendChild(document.createTextNode(sCss));
        document.getElementsByTagName('head')[0].appendChild(dStyle);
    },

    insertAsFirstChild : function (element, parent) {
        parent.insertBefore(element, parent.firstChild);
    }
};

// =================================================================================================

var main = function () {
    // read config
    var mainDiffDiv = document.getElementById('files');
    var nbOfFiles = mainDiffDiv.children.length;

    var autoHide = false;
    var autoHideLong = false;
    if(nbOfFiles > CONFIG.dontHideUnlessMoreThanFiles) {
        if(CONFIG.hideAllWhenMoreThanFiles > 0 && nbOfFiles > CONFIG.hideAllWhenMoreThanFiles){
            autoHide = true;
        }else if(CONFIG.hideFileWhenDiffGt > 0) {
            autoHideLong = true;
        }
    }

    // let's go
    gha.instance.storage = new gha.classes.GHALocalStorage();
    gha.instance.storage.init();

    var storageLoader = new gha.classes.GHALocalStorageLoader(gha.instance.storage);
    storageLoader.run();

    gha.util.DomWriter.attachGlobalCss();
    gha.util.DomWriter.attachToggleDisplayOnClickListeners();
    if(autoHide) {
        gha.util.VisibilityManager.toggleDisplayAll(false, true);
    }else if(autoHideLong) {
        gha.util.VisibilityManager.hideLongDiffs(CONFIG.hideFileWhenDiffGt);
    }
    gha.util.DomWriter.attachCollapseExpandDiffsButton(autoHide);

    gha.util.DomWriter.attachPerDiffFileFeatures();
    gha.util.DomWriter.attachStorageWipeButtons();

    // gha.util.DomWriter.enableEditing();
};

main();
