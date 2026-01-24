// ==UserScript==
// @name         ShippingManager - Distance Filter for Route Planner
// @namespace    http://tampermonkey.net/
// @description  Filter ports by distance when creating new routes!
// @version      9.18
// @order        10
// @author       RebelShip
// @match        https://shippingmanager.cc/*
// @grant        none
// @run-at       document-end
// @enabled      false
// ==/UserScript==
/* globals MutationObserver */

(function() {
    var API_BASE = 'https://shippingmanager.cc/api';
    var injected = false;
    var dropdownOpen = false;
    var _activeDistanceFilter = null;
    var _activeVesselCoords = null;
    var filteredPortCodes = null;
    var markerFilterInterval = null;

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

    async function fetchVesselPorts(vesselId) {
        try {
            var response = await fetch(API_BASE + '/route/get-vessel-ports', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({ user_vessel_id: vesselId })
            });
            if (!response.ok) return null;
            var data = await response.json();
            if (data && data.data && data.data.all && data.data.all.ports) {
                return data.data.all.ports;
            }
        } catch (err) {
            console.log("[DistFilter] fetchVesselPorts error:", err);
        }
        return null;
    }

    async function fetchPortCoords(portCode) {
        try {
            var response = await fetch(API_BASE + '/port/get-ports', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({ port_code: [portCode] })
            });
            if (!response.ok) return null;
            var data = await response.json();
            if (data && data.data && data.data.port && data.data.port.length > 0) {
                var port = data.data.port[0];
                return { lat: parseFloat(port.lat), lon: parseFloat(port.lon) };
            }
        } catch (err) {
            console.log("[DistFilter] fetchPortCoords error:", err);
        }
        return null;
    }

    function filterPortsByDistance(ports, range, vesselCoords) {
        if (!ports || !range || range.label === "All" || !vesselCoords) {
            return ports;
        }
        return ports.filter(function(port) {
            var pLat = parseFloat(port.lat);
            var pLon = parseFloat(port.lon);
            var dist = haversine(vesselCoords.lat, vesselCoords.lon, pLat, pLon);
            return dist >= range.min && dist < range.max;
        });
    }

    function removeOutOfRangeMarkers() {
        if (!filteredPortCodes || filteredPortCodes.length === 0) return;

        var mapStore = getStore("mapStore");
        if (!mapStore || !mapStore.map) return;

        var map = mapStore.map;
        var markersToRemove = [];

        map.eachLayer(function(layer) {
            if (layer.options && layer.options.port) {
                var portCode = layer.options.port.code;
                if (!filteredPortCodes.includes(portCode)) {
                    markersToRemove.push(layer);
                }
            }
        });

        markersToRemove.forEach(function(marker) {
            map.removeLayer(marker);
        });

        if (markersToRemove.length > 0) {
            console.log("[DistFilter] Removed", markersToRemove.length, "out-of-range markers");
        }
    }

    function startMarkerFilter() {
        if (markerFilterInterval) {
            clearInterval(markerFilterInterval);
        }
        markerFilterInterval = setInterval(removeOutOfRangeMarkers, 300);
        console.log("[DistFilter] Started marker filter interval");
    }

    function stopMarkerFilter() {
        if (markerFilterInterval) {
            clearInterval(markerFilterInterval);
            markerFilterInterval = null;
            console.log("[DistFilter] Stopped marker filter interval");
        }
        filteredPortCodes = null;
        _activeDistanceFilter = null;
        _activeVesselCoords = null;
    }

    async function applyDistanceFilter(range, btn) {
        var rs = getStore("route");
        if (!rs) {
            console.log("[DistFilter] No route store");
            return;
        }

        var selectedVessel = rs.selectedVessel;
        if (!selectedVessel) {
            console.log("[DistFilter] No vessel selected");
            return;
        }

        if (btn) {
            var inner = btn.querySelector(".btn-content-wrapper");
            if (inner) inner.textContent = "Loading...";
        }

        console.log("[DistFilter] Fetching vessel port coords for:", selectedVessel.current_port_code);
        var vesselCoords = await fetchPortCoords(selectedVessel.current_port_code);
        if (!vesselCoords) {
            console.log("[DistFilter] Could not get vessel coordinates");
            if (btn) {
                var inner2 = btn.querySelector(".btn-content-wrapper");
                if (inner2) inner2.textContent = "ERROR";
            }
            return;
        }
        console.log("[DistFilter] Vessel coords:", vesselCoords);

        console.log("[DistFilter] Fetching all reachable ports...");
        var allPorts = await fetchVesselPorts(selectedVessel.id);
        if (!allPorts || allPorts.length === 0) {
            console.log("[DistFilter] No ports returned from API");
            if (btn) {
                var inner3 = btn.querySelector(".btn-content-wrapper");
                if (inner3) inner3.textContent = "ERROR";
            }
            return;
        }
        console.log("[DistFilter] Total ports from API:", allPorts.length);

        var filteredPorts = filterPortsByDistance(allPorts, range, vesselCoords);
        console.log("[DistFilter] Filtered to", filteredPorts.length, "ports for range:", range.label);

        if (filteredPorts.length === 0) {
            console.log("[DistFilter] No ports in this distance range!");
            if (btn) {
                var inner4 = btn.querySelector(".btn-content-wrapper");
                if (inner4) inner4.textContent = "0 PORTS";
            }
            return;
        }

        _activeDistanceFilter = range;
        _activeVesselCoords = vesselCoords;
        filteredPortCodes = filteredPorts.map(function(p) { return p.code; });

        rs.$patch(function(state) {
            state.routeSelection.activePorts = filteredPorts;
            state.routeSelection.isMinified = true;
            state.routeSelection.doingDryOps = false;
            state.routeSelection.metropolroute = false;
            state.routeSelection.routeWasSuggested = false;
            state.routeSelection.routeCreationStep = 2;
        });

        console.log("[DistFilter] Applied! routeCreationStep=2, activePorts count:", filteredPorts.length);

        startMarkerFilter();

        if (btn) {
            var inner5 = btn.querySelector(".btn-content-wrapper");
            if (inner5) inner5.textContent = range.label === "All" ? "DISTANCE" : range.label;
        }

        var mapStore = getStore("mapStore");
        if (mapStore && mapStore.map) {
            var bounds = [];
            filteredPorts.forEach(function(p) {
                bounds.push([parseFloat(p.lat), parseFloat(p.lon)]);
            });
            if (bounds.length > 0) {
                try {
                    mapStore.map.fitBounds(bounds, { padding: [50, 50] });
                } catch (e) {
                    console.log("[DistFilter] fitBounds error:", e);
                }
            }
        }

        setTimeout(removeOutOfRangeMarkers, 100);
        setTimeout(removeOutOfRangeMarkers, 500);
        setTimeout(removeOutOfRangeMarkers, 1000);
    }

    function createDropdown(btn) {
        var dd = document.getElementById("rebel-dist-dropdown");
        if (dd) dd.remove();

        var dropdown = document.createElement("div");
        dropdown.id = "rebel-dist-dropdown";
        dropdown.style.cssText = "position:absolute;bottom:100%;left:50%;transform:translateX(-50%);background:#1a1a2e;border:1px solid #3a3a5e;border-radius:4px;min-width:90px;max-width:110px;z-index:9999;margin-bottom:4px;";

        RANGES.forEach(function(range) {
            var item = document.createElement("div");
            item.style.cssText = "padding:6px 10px;cursor:pointer;color:#fff;font-size:12px;text-align:center;white-space:nowrap;";
            item.textContent = range.label;
            item.onmouseenter = function() { item.style.background = "#2a2a4e"; };
            item.onmouseleave = function() { item.style.background = "transparent"; };
            item.onclick = function(e) {
                e.stopPropagation();
                dropdown.remove();
                dropdownOpen = false;
                applyDistanceFilter(range, btn);
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
        stopMarkerFilter();
    }

    var obs = new MutationObserver(function() {
        var popup = document.querySelector("#createRoutePopup");
        if (popup && !document.getElementById("rebel-dist-btn")) inject();
        if (!popup && injected) reset();
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
