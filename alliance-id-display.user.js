// ==UserScript==
// @name        ShippingManager - Alliance ID Display
// @description Shows alliance ID next to alliance name in modal, click to copy
// @version     1.0
// @author      https://github.com/justonlyforyou/
// @order        59
// @match       https://shippingmanager.cc/*
// @grant       none
// @run-at      document-end
// @enabled     false
// ==/UserScript==
/* globals Node */

(function() {
    'use strict';

    var MARKER_ATTR = 'data-alliance-id-injected';

    function getPinia() {
        var appEl = document.querySelector('#app');
        if (!appEl || !appEl.__vue_app__) return null;
        var app = appEl.__vue_app__;
        return app._context.provides.pinia || app.config.globalProperties.$pinia;
    }

    function getAllianceStore() {
        var pinia = getPinia();
        if (!pinia || !pinia._s) return null;
        return pinia._s.get('alliance');
    }

    function copyToClipboard(text) {
        if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(text).then(function() {
                showCopiedFeedback();
            });
        } else {
            var textarea = document.createElement('textarea');
            textarea.value = text;
            textarea.style.position = 'fixed';
            textarea.style.opacity = '0';
            document.body.appendChild(textarea);
            textarea.select();
            document.execCommand('copy');
            document.body.removeChild(textarea);
            showCopiedFeedback();
        }
    }

    function showCopiedFeedback() {
        var existing = document.getElementById('alliance-id-copied-toast');
        if (existing) existing.remove();

        var toast = document.createElement('div');
        toast.id = 'alliance-id-copied-toast';
        toast.textContent = 'Alliance ID copied!';
        toast.style.cssText = 'position:fixed;bottom:20px;left:50%;transform:translateX(-50%);background:#22c55e;color:#fff;padding:8px 16px;border-radius:4px;font-size:13px;font-weight:600;z-index:99999;pointer-events:none;opacity:1;transition:opacity 0.3s;';
        document.body.appendChild(toast);

        setTimeout(function() {
            toast.style.opacity = '0';
        }, 1500);
        setTimeout(function() {
            toast.remove();
        }, 1800);
    }

    function createIdBadge(allianceId) {
        var badge = document.createElement('span');
        badge.setAttribute(MARKER_ATTR, 'true');
        badge.textContent = '(' + allianceId + ')';
        badge.title = 'Click to copy Alliance ID';
        badge.style.cssText = 'color:#626b90;font-size:inherit;font-weight:400;margin-left:5px;cursor:pointer;opacity:0.8;';

        badge.addEventListener('mouseenter', function() {
            badge.style.opacity = '1';
            badge.style.textDecoration = 'underline';
        });
        badge.addEventListener('mouseleave', function() {
            badge.style.opacity = '0.8';
            badge.style.textDecoration = 'none';
        });
        badge.addEventListener('click', function(e) {
            e.preventDefault();
            e.stopPropagation();
            copyToClipboard(String(allianceId));
        });

        return badge;
    }

    function injectAllianceId() {
        var allianceStore = getAllianceStore();
        if (!allianceStore || !allianceStore.alliance) return;

        var allianceName = allianceStore.alliance.name;
        var allianceId = allianceStore.alliance.id;
        if (!allianceName || !allianceId) return;

        var modalContainer = document.querySelector('#modal-container');
        if (!modalContainer) return;

        if (modalContainer.querySelector('[' + MARKER_ATTR + ']')) return;

        var allDivs = modalContainer.querySelectorAll('div');
        for (var i = 0; i < allDivs.length; i++) {
            var div = allDivs[i];
            var directText = '';
            for (var j = 0; j < div.childNodes.length; j++) {
                var node = div.childNodes[j];
                if (node.nodeType === Node.TEXT_NODE) {
                    directText += node.textContent.trim();
                }
            }

            if (directText === allianceName) {
                div.appendChild(createIdBadge(allianceId));
                return;
            }
        }
    }

    var observer = new MutationObserver(function() {
        injectAllianceId();
    });

    observer.observe(document.body, {
        childList: true,
        subtree: true
    });

    setInterval(injectAllianceId, 1000);
})();
