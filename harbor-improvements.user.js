// ==UserScript==
// @name         Shipping Manager - Harbor Improvements
// @namespace    https://rebelship.org/
// @version      2.5
// @description  Just a simple repositioning of the details button on harbor menu.
// @author       https://github.com/justonlyforyou/
// @order        26
// @match        https://shippingmanager.cc/*
// @grant        none
// @run-at       document-end
// @enabled      false
// ==/UserScript==

(function() {
    'use strict';

    var style = document.createElement('style');
    style.textContent = [
        '.port-popup .popup_data {',
        '    position: relative !important;',
        '    padding-bottom: 40px !important;',
        '}',
        '.port-popup .buttonWrapper {',
        '    position: absolute !important;',
        '    bottom: 2px !important;',
        '    left: 0 !important;',
        '    right: 0 !important;',
        '    padding: 0 !important;',
        '    margin: 0 !important;',
        '    text-align: center !important;',
        '}'
    ].join('\n');
    document.head.appendChild(style);

    // Keep popups within viewport
    function adjustPopupPosition(popup) {
        if (!popup) return;

        var rect = popup.getBoundingClientRect();
        var viewportWidth = window.innerWidth;
        var viewportHeight = window.innerHeight;
        var margin = 10;

        // Check if popup goes beyond right edge
        if (rect.right > viewportWidth - margin) {
            var overflowRight = rect.right - viewportWidth + margin;
            var currentLeft = parseFloat(popup.style.left) || rect.left;
            popup.style.left = (currentLeft - overflowRight) + 'px';
        }

        // Check if popup goes beyond left edge
        rect = popup.getBoundingClientRect();
        if (rect.left < margin) {
            popup.style.left = margin + 'px';
        }

        // Check if popup goes beyond bottom edge
        rect = popup.getBoundingClientRect();
        if (rect.bottom > viewportHeight - margin) {
            var overflowBottom = rect.bottom - viewportHeight + margin;
            var currentTop = parseFloat(popup.style.top) || rect.top;
            popup.style.top = (currentTop - overflowBottom) + 'px';
        }

        // Check if popup goes beyond top edge
        rect = popup.getBoundingClientRect();
        if (rect.top < margin) {
            popup.style.top = margin + 'px';
        }
    }

    // Observe for popup changes
    var observer = new window.MutationObserver(function(mutations) {
        mutations.forEach(function(mutation) {
            // Check added nodes for popups
            mutation.addedNodes.forEach(function(node) {
                if (node.nodeType === 1) {
                    if (node.classList && node.classList.contains('port-popup')) {
                        setTimeout(function() { adjustPopupPosition(node); }, 10);
                    }
                    var popup = node.querySelector && node.querySelector('.port-popup');
                    if (popup) {
                        setTimeout(function() { adjustPopupPosition(popup); }, 10);
                    }
                }
            });

            // Check for style/position changes on existing popups
            if (mutation.type === 'attributes' && mutation.attributeName === 'style') {
                var target = mutation.target;
                if (target.classList && target.classList.contains('port-popup')) {
                    setTimeout(function() { adjustPopupPosition(target); }, 10);
                }
            }
        });
    });

    observer.observe(document.body, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['style']
    });
})();
