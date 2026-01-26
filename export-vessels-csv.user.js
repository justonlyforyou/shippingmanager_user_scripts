// ==UserScript==
// @name        ShippingManager - Export all your vessels details
// @description Export all your vessels with details as CSV
// @version     1.19
// @author      https://github.com/justonlyforyou/
// @order        12
// @match       https://shippingmanager.cc/*
// @grant       none
// @run-at      document-end
// @enabled     false
// @RequireRebelShipMenu true
// ==/UserScript==
/* globals Blob, URL, addMenuItem */

(function() {
    'use strict';

    // Add export button to menu
    function addExportMenuItem() {
        addMenuItem('Export All Vessels', exportVessels, 997);
        console.log('[ExportVessels] Menu item added');
    }

    function exportVessels() {
        var dropdown = document.getElementById('rebelship-dropdown');
        if (dropdown) dropdown.style.display = 'none';

        fetch('https://shippingmanager.cc/api/vessel/get-all-user-vessels', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Accept': 'application/json'
            },
            body: JSON.stringify({ include_routes: true }),
            credentials: 'include'
        })
        .then(function(response) {
            if (!response.ok) {
                throw new Error('API request failed: ' + response.status);
            }
            return response.json();
        })
        .then(function(data) {
            var vessels = data.data && data.data.user_vessels ? data.data.user_vessels : [];

            if (vessels.length === 0) {
                alert('No vessels found.');
                return;
            }

            // Define CSV columns
            var columns = [
                'id', 'name', 'type_name', 'capacity_type', 'status', 'current_port_code',
                'imo', 'mmsi', 'year', 'length', 'width', 'range', 'kw', 'max_speed',
                'capacity_max_dry', 'capacity_max_refrigerated', 'capacity_dry', 'capacity_refrigerated',
                'price_dry', 'price_refrigerated', 'fuel_capacity', 'fuel_factor', 'co2_factor',
                'wear', 'hours_until_check', 'hours_between_service', 'travelled_hours',
                'total_distance_traveled', 'is_parked', 'gearless', 'bulbous_bow', 'enhanced_thrusters',
                'antifouling', 'route_name', 'route_origin', 'route_destination', 'route_distance',
                'route_speed', 'route_end_time', 'time_acquired', 'time_arrival', 'engine_type', 'price'
            ];

            // Build CSV header
            var csv = columns.join(';') + '\n';

            // Build CSV rows
            vessels.forEach(function(v) {
                var row = [
                    v.id !== undefined ? v.id : '',
                    escapeCSV(v.name),
                    escapeCSV(v.type_name),
                    v.capacity_type !== undefined ? v.capacity_type : '',
                    v.status !== undefined ? v.status : '',
                    v.current_port_code !== undefined ? v.current_port_code : '',
                    v.imo !== undefined ? v.imo : '',
                    v.mmsi !== undefined ? v.mmsi : '',
                    v.year !== undefined ? v.year : '',
                    v.length !== undefined ? v.length : '',
                    v.width !== undefined ? v.width : '',
                    v.range !== undefined ? v.range : '',
                    v.kw !== undefined ? v.kw : '',
                    v.max_speed !== undefined ? v.max_speed : '',
                    v.capacity_max && v.capacity_max.dry !== undefined ? v.capacity_max.dry : '',
                    v.capacity_max && v.capacity_max.refrigerated !== undefined ? v.capacity_max.refrigerated : '',
                    v.capacity && v.capacity.dry !== undefined ? v.capacity.dry : '',
                    v.capacity && v.capacity.refrigerated !== undefined ? v.capacity.refrigerated : '',
                    v.prices && v.prices.dry !== undefined ? v.prices.dry : '',
                    v.prices && v.prices.refrigerated !== undefined ? v.prices.refrigerated : '',
                    v.fuel_capacity !== undefined ? v.fuel_capacity : '',
                    v.fuel_factor !== undefined ? v.fuel_factor : '',
                    v.co2_factor !== undefined ? v.co2_factor : '',
                    v.wear !== undefined ? v.wear : '',
                    v.hours_until_check !== undefined ? v.hours_until_check : '',
                    v.hours_between_service !== undefined ? v.hours_between_service : '',
                    v.travelled_hours !== undefined ? v.travelled_hours : '',
                    v.total_distance_traveled !== undefined ? v.total_distance_traveled : '',
                    v.is_parked ? '1' : '0',
                    v.gearless !== undefined ? v.gearless : '0',
                    v.bulbous_bow !== undefined ? v.bulbous_bow : '0',
                    v.enhanced_thrusters !== undefined ? v.enhanced_thrusters : '0',
                    v.antifouling !== undefined ? v.antifouling : '',
                    escapeCSV(v.route_name),
                    v.route_origin !== undefined ? v.route_origin : '',
                    v.route_destination !== undefined ? v.route_destination : '',
                    v.route_distance !== undefined ? v.route_distance : '',
                    v.route_speed !== undefined ? v.route_speed : '',
                    v.route_end_time !== undefined ? v.route_end_time : '',
                    v.time_acquired !== undefined ? v.time_acquired : '',
                    v.time_arrival !== undefined ? v.time_arrival : '',
                    v.engine_type !== undefined ? v.engine_type : '',
                    v.price !== undefined ? v.price : ''
                ];
                csv += row.join(';') + '\n';
            });

            // Download CSV
            var blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8;' });
            var url = URL.createObjectURL(blob);
            var link = document.createElement('a');
            link.href = url;
            link.download = 'vessels_' + new Date().toISOString().slice(0, 10) + '.csv';
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            URL.revokeObjectURL(url);

            alert('Exported ' + vessels.length + ' vessels to CSV!');
        })
        .catch(function(err) {
            console.error('Export error:', err);
            alert('Export failed: ' + err.message);
        });
    }

    function escapeCSV(str) {
        if (str === null || str === undefined) return '';
        str = String(str);
        if (str.indexOf('"') !== -1 || str.indexOf(';') !== -1 || str.indexOf('\n') !== -1) {
            return '"' + str.replace(/"/g, '""') + '"';
        }
        return str;
    }

    // Initialize
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', function() { setTimeout(addExportMenuItem, 2000); });
    } else {
        setTimeout(addExportMenuItem, 2000);
    }
})();
