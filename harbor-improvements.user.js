// ==UserScript==
// @name         Shipping Manager - Harbor Improvements
// @namespace    https://rebelship.org/
// @version      2.5
// @description  Fixes harbor map UI issues like port popup button positioning
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
})();
