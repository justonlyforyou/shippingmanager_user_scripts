// ==UserScript==
// @name         Shipping Manager - Distance Filter for Route Planner
// @namespace    http://tampermonkey.net/
// @description  Filter ports by distance when creating new routes!
// @version      8.2
// @order        13
// @author       RebelShip
// @match        https://shippingmanager.cc/*
// @grant        none
// @run-at       document-end
// @enabled      false
// ==/UserScript==

/* eslint-env browser */
/* global MutationObserver */

(function() {
    var injected = false;
    var dropdownOpen = false;

    var RANGES = [
        { label: "All", min: 0, max: 999999 },
        { label: "< 1000 nm", min: 0, max: 1000 },
        { label: "1k-3k nm", min: 1000, max: 3000 },
        { label: "3k-6k nm", min: 3000, max: 6000 },
        { label: "6k-10k nm", min: 6000, max: 10000 },
        { label: "> 10k nm", min: 10000, max: 999999 }
    ];

    function haversine(lat1, lon1, lat2, lon2) {
        var R = 3440.065;
        var dLat = (lat2 - lat1) * Math.PI / 180;
        var dLon = (lon2 - lon1) * Math.PI / 180;
        var a = Math.sin(dLat/2) * Math.sin(dLat/2) +
                Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
                Math.sin(dLon/2) * Math.sin(dLon/2);
        return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    }

    function getPinia() {
        var appEl = document.querySelector("#app");
        if (!appEl || !appEl.__vue_app__) return null;
        var app = appEl.__vue_app__;
        return app._context.provides.pinia || app.config.globalProperties.$pinia;
    }

    function getStore(name) {
        var pinia = getPinia();
        if (!pinia || !pinia._s) return null;
        return pinia._s.get(name);
    }

    function getVesselCoords() {
        var rs = getStore("route");
        if (!rs || !rs.selectedVessel || !rs.ports) return null;
        var code = rs.selectedVessel.current_port_code;
        var port = rs.ports.find(function(p) { return p.code === code; });
        if (!port) return null;
        return { lat: parseFloat(port.lat), lon: parseFloat(port.lon) };
    }

    function clickShowAll() {
        var btns = document.querySelectorAll("#createRoutePopup button");
        for (var i = 0; i < btns.length; i++) {
            var t = btns[i].textContent.toLowerCase();
            if (t.indexOf("all") !== -1 && t.indexOf("port") !== -1) {
                btns[i].click();
                return true;
            }
        }
        return false;
    }

    // Get Leaflet map from mapStore
    function getLeafletMap() {
        var ms = getStore("mapStore");
        if (!ms || !ms.map) return null;

        var mapVal = ms.map;
        // Check if it's a Vue ref
        if (mapVal && typeof mapVal.value !== "undefined" && mapVal.value !== null) {
            return mapVal.value;
        }
        if (mapVal && typeof mapVal.eachLayer === "function") {
            return mapVal;
        }
        return null;
    }

    function filterByDistance(range, btn) {
        var vesselCoords = getVesselCoords();
        if (!vesselCoords) {
            console.log("[DistFilter] No vessel coords");
            return;
        }

        var map = getLeafletMap();
        if (!map) {
            console.log("[DistFilter] No map");
            return;
        }

        console.log("[DistFilter] Vessel at:", vesselCoords.lat, vesselCoords.lon);
        console.log("[DistFilter] Filtering for range:", range.label);

        var kept = 0;
        var hidden = 0;
        var total = 0;

        map.eachLayer(function(layer) {
            // Check if this layer has port data
            if (layer.options && layer.options.port) {
                total++;
                var port = layer.options.port;
                var pLat = parseFloat(port.lat);
                var pLon = parseFloat(port.lon);
                var dist = haversine(vesselCoords.lat, vesselCoords.lon, pLat, pLon);

                var shouldShow = (range.label === "All") || (dist >= range.min && dist < range.max);

                if (shouldShow) {
                    // Show marker
                    if (layer._icon) {
                        layer._icon.style.display = "";
                    }
                    if (layer.setOpacity) {
                        layer.setOpacity(1);
                    }
                    kept++;
                } else {
                    // Hide marker
                    if (layer._icon) {
                        layer._icon.style.display = "none";
                    }
                    if (layer.setOpacity) {
                        layer.setOpacity(0);
                    }
                    hidden++;
                }
            }
        });

        console.log("[DistFilter] Total:", total, "Kept:", kept, "Hidden:", hidden);

        // Update button text
        var inner = btn.querySelector(".btn-content-wrapper");
        if (inner) inner.textContent = range.label === "All" ? "DISTANCE" : range.label;
    }

    function applyFilter(range, btn) {
        // First click "Show all ports" to ensure all markers are on the map
        clickShowAll();

        // Wait for markers to appear, then filter
        var attempts = 0;
        var maxAttempts = 30;

        var check = setInterval(function() {
            attempts++;
            var map = getLeafletMap();
            var markerCount = 0;

            if (map) {
                map.eachLayer(function(layer) {
                    if (layer.options && layer.options.port) markerCount++;
                });
            }

            console.log("[DistFilter] Attempt", attempts, "markers:", markerCount);

            if (markerCount > 5) {
                clearInterval(check);
                // Give a bit more time for rendering
                setTimeout(function() {
                    filterByDistance(range, btn);
                }, 200);
            } else if (attempts >= maxAttempts) {
                clearInterval(check);
                console.log("[DistFilter] Timeout - trying filter anyway");
                filterByDistance(range, btn);
            }
        }, 100);
    }

    function createDropdown(btn) {
        var dd = document.getElementById("rebel-dist-dropdown");
        if (dd) dd.remove();

        var dropdown = document.createElement("div");
        dropdown.id = "rebel-dist-dropdown";
        dropdown.style.cssText = "position:absolute;bottom:100%;left:0;background:#1a1a2e;border:1px solid #3a3a5e;border-radius:4px;min-width:120px;z-index:9999;margin-bottom:4px;";

        RANGES.forEach(function(range) {
            var item = document.createElement("div");
            item.style.cssText = "padding:8px 12px;cursor:pointer;color:#fff;font-size:13px;";
            item.textContent = range.label;
            item.onmouseenter = function() { item.style.background = "#2a2a4e"; };
            item.onmouseleave = function() { item.style.background = "transparent"; };
            item.onclick = function(e) {
                e.stopPropagation();
                dropdown.remove();
                dropdownOpen = false;
                applyFilter(range, btn);
            };
            dropdown.appendChild(item);
        });

        btn.style.position = "relative";
        btn.appendChild(dropdown);
        dropdownOpen = true;
    }

    function inject() {
        if (injected) return;
        var container = document.querySelector("#createRoutePopup .buttonContainer");
        if (!container || document.getElementById("rebel-dist-btn")) return;

        var btn = document.createElement("button");
        btn.id = "rebel-dist-btn";
        btn.type = "button";
        btn.className = "default light-blue";
        btn.setAttribute("data-v-67942aae", "");

        var inner = document.createElement("div");
        inner.className = "btn-content-wrapper fit-btn-text";
        inner.textContent = "DISTANCE";
        btn.appendChild(inner);

        btn.onclick = function(e) {
            e.stopPropagation();
            e.preventDefault();
            if (dropdownOpen) {
                var dd = document.getElementById("rebel-dist-dropdown");
                if (dd) dd.remove();
                dropdownOpen = false;
            } else {
                createDropdown(btn);
            }
        };

        container.appendChild(btn);
        injected = true;
        console.log("[DistFilter] Button injected");
    }

    function reset() {
        injected = false;
        dropdownOpen = false;
    }

    var obs = new MutationObserver(function() {
        var popup = document.querySelector("#createRoutePopup");
        if (popup && !document.getElementById("rebel-dist-btn")) inject();
        if (!popup) reset();
    });
    obs.observe(document.body, { childList: true, subtree: true });

    document.addEventListener("click", function(e) {
        if (dropdownOpen && !e.target.closest("#rebel-dist-btn")) {
            var dd = document.getElementById("rebel-dist-dropdown");
            if (dd) dd.remove();
            dropdownOpen = false;
        }
    });
})();
