// ==UserScript==
// @name        Shipping Manager - Export All Vessels
// @description Export all vessels with details as CSV
// @version     1.1
// @author      https://github.com/justonlyforyou/
// @match       https://shippingmanager.cc/*
// @run-at      document-end
// @enabled     false
// ==/UserScript==

(function() {
    'use strict';

    const isMobile = window.innerWidth < 1024;

    // RebelShip Menu Logo SVG (simple ship icon)
    const REBELSHIP_LOGO = '<svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor"><path d="M20 21c-1.39 0-2.78-.47-4-1.32-2.44 1.71-5.56 1.71-8 0C6.78 20.53 5.39 21 4 21H2v2h2c1.38 0 2.74-.35 4-.99 2.52 1.29 5.48 1.29 8 0 1.26.65 2.62.99 4 .99h2v-2h-2zM3.95 19H4c1.6 0 3.02-.88 4-2 .98 1.12 2.4 2 4 2s3.02-.88 4-2c.98 1.12 2.4 2 4 2h.05l1.89-6.68c.08-.26.06-.54-.06-.78s-.34-.42-.6-.5L20 10.62V6c0-1.1-.9-2-2-2h-3V1H9v3H6c-1.1 0-2 .9-2 2v4.62l-1.29.42c-.26.08-.48.26-.6.5s-.15.52-.06.78L3.95 19zM6 6h12v3.97L12 8 6 9.97V6z"/></svg>';

    // Get or create shared mobile row (fixed at top)
    function getOrCreateMobileRow() {
        var existing = document.getElementById('rebel-mobile-row');
        if (existing) return existing;

        // Create fixed row at top of screen
        var row = document.createElement('div');
        row.id = 'rebel-mobile-row';
        row.style.cssText = 'position:fixed;top:0;left:0;right:0;display:flex;justify-content:center;align-items:center;gap:10px;background:#1a1a2e;padding:4px 6px;font-size:14px;z-index:9999;';

        document.body.appendChild(row);

        // Add margin to push page content down
        var appContainer = document.querySelector('#app') || document.body.firstElementChild;
        if (appContainer) {
            appContainer.style.marginTop = '2px';
        }

        return row;
    }

    // Get or create RebelShip menu
    function getOrCreateRebelShipMenu() {
        let menu = document.getElementById('rebelship-menu');
        if (menu) {
            return menu.querySelector('.rebelship-dropdown');
        }

        // Mobile: insert into mobile row
        if (isMobile) {
            var row = getOrCreateMobileRow();
            if (!row) return null;

            const container = document.createElement('div');
            container.id = 'rebelship-menu';
            container.style.cssText = 'position:relative;display:inline-block;margin-left:auto;';

            const btn = document.createElement('button');
            btn.id = 'rebelship-menu-btn';
            btn.innerHTML = REBELSHIP_LOGO;
            btn.style.cssText = 'display:flex;align-items:center;justify-content:center;width:18px;height:18px;background:linear-gradient(135deg,#3b82f6,#1d4ed8);color:white;border:none;border-radius:6px;cursor:pointer;';
            btn.title = 'RebelShip Menu';

            const dropdown = document.createElement('div');
            dropdown.className = 'rebelship-dropdown';
            dropdown.style.cssText = 'display:none;position:absolute;top:100%;right:0;background:#1f2937;border:1px solid #374151;border-radius:4px;min-width:180px;z-index:99999;box-shadow:0 4px 12px rgba(0,0,0,0.3);margin-top:4px;';

            container.appendChild(btn);
            container.appendChild(dropdown);

            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                dropdown.style.display = dropdown.style.display === 'block' ? 'none' : 'block';
            });

            document.addEventListener('click', (e) => {
                if (!container.contains(e.target)) {
                    dropdown.style.display = 'none';
                }
            });

            row.appendChild(container);
            return dropdown;
        }

        // Desktop: insert before messaging icon
        let messagingIcon = document.querySelector('div.messaging.cursor-pointer');
        if (!messagingIcon) messagingIcon = document.querySelector('.messaging');
        if (!messagingIcon) return null;

        const container = document.createElement('div');
        container.id = 'rebelship-menu';
            container.style.cssText = 'position:relative;display:inline-block;vertical-align:middle;margin-right:10px;margin-left:auto;';

        const btn = document.createElement('button');
        btn.id = 'rebelship-menu-btn';
        btn.innerHTML = REBELSHIP_LOGO;
        btn.style.cssText = 'display:flex;align-items:center;justify-content:center;width:36px;height:36px;background:linear-gradient(135deg,#3b82f6,#1d4ed8);color:white;border:none;border-radius:6px;cursor:pointer;box-shadow:0 2px 4px rgba(0,0,0,0.2);';
        btn.title = 'RebelShip Menu';

        const dropdown = document.createElement('div');
        dropdown.className = 'rebelship-dropdown';
        dropdown.style.cssText = 'display:none;position:absolute;top:100%;right:0;background:#1f2937;border:1px solid #374151;border-radius:4px;min-width:180px;z-index:99999;box-shadow:0 4px 12px rgba(0,0,0,0.3);margin-top:4px;';

        container.appendChild(btn);
        container.appendChild(dropdown);

        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            dropdown.style.display = dropdown.style.display === 'block' ? 'none' : 'block';
        });

        document.addEventListener('click', (e) => {
            if (!container.contains(e.target)) {
                dropdown.style.display = 'none';
            }
        });

        if (messagingIcon.parentNode) {
            messagingIcon.parentNode.insertBefore(container, messagingIcon);
        }

        return dropdown;
    }

    // Add menu item to RebelShip menu
    function addMenuItem(label, hasSubmenu, onClick) {
        const dropdown = getOrCreateRebelShipMenu();
        if (!dropdown) {
            setTimeout(() => addMenuItem(label, hasSubmenu, onClick), 1000);
            return null;
        }

        // Check if item already exists
        if (dropdown.querySelector(`[data-rebelship-item="${label}"]`)) {
            return dropdown.querySelector(`[data-rebelship-item="${label}"]`);
        }

        const item = document.createElement('div');
        item.dataset.rebelshipItem = label;
        item.style.cssText = 'position:relative;';

        const itemBtn = document.createElement('div');
        itemBtn.style.cssText = 'padding:10px 12px;cursor:pointer;color:#fff;font-size:13px;display:flex;justify-content:space-between;align-items:center;border-bottom:1px solid #374151;';
        itemBtn.innerHTML = '<span>' + label + '</span>' + (hasSubmenu ? '<span style="font-size:10px;">&#9654;</span>' : '');

        itemBtn.addEventListener('mouseenter', () => itemBtn.style.background = '#374151');
        itemBtn.addEventListener('mouseleave', () => itemBtn.style.background = 'transparent');

        if (!hasSubmenu && onClick) {
            itemBtn.addEventListener('click', () => {
                dropdown.style.display = 'none';
                onClick();
            });
        }

        item.appendChild(itemBtn);
        dropdown.appendChild(item);

        return item;
    }

    // Add export button to menu
    function addExportMenuItem() {
        addMenuItem('Export All Vessels', false, exportVessels);
        console.log('[ExportVessels] Menu item added');
    }

    async function exportVessels() {
        try {
            const response = await fetch('https://shippingmanager.cc/api/vessel/get-all-user-vessels', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Accept': 'application/json'
                },
                body: JSON.stringify({ include_routes: true }),
                credentials: 'include'
            });

            if (!response.ok) {
                throw new Error('API request failed: ' + response.status);
            }

            const data = await response.json();
            const vessels = data.data?.user_vessels || [];

            if (vessels.length === 0) {
                alert('No vessels found.');
                return;
            }

            // Define CSV columns
            const columns = [
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
            let csv = columns.join(';') + '\n';

            // Build CSV rows
            for (const v of vessels) {
                const row = [
                    v.id || '', escapeCSV(v.name || ''), escapeCSV(v.type_name || ''),
                    v.capacity_type || '', v.status || '', v.current_port_code || '',
                    v.imo || '', v.mmsi || '', v.year || '', v.length || '', v.width || '',
                    v.range || '', v.kw || '', v.max_speed || '',
                    v.capacity_max?.dry || '', v.capacity_max?.refrigerated || '',
                    v.capacity?.dry || '', v.capacity?.refrigerated || '',
                    v.prices?.dry || '', v.prices?.refrigerated || '',
                    v.fuel_capacity || '', v.fuel_factor || '', v.co2_factor || '',
                    v.wear || '', v.hours_until_check || '', v.hours_between_service || '',
                    v.travelled_hours || '', v.total_distance_traveled || '',
                    v.is_parked ? '1' : '0', v.gearless || '0', v.bulbous_bow || '0',
                    v.enhanced_thrusters || '0', v.antifouling || '',
                    escapeCSV(v.route_name || ''), v.route_origin || '', v.route_destination || '',
                    v.route_distance || '', v.route_speed || '', v.route_end_time || '',
                    v.time_acquired || '', v.time_arrival || '', v.engine_type || '', v.price || ''
                ];
                csv += row.join(';') + '\n';
            }

            // Download CSV
            const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8;' });
            const url = URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = url;
            link.download = 'vessels_' + new Date().toISOString().slice(0,10) + '.csv';
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            URL.revokeObjectURL(url);

            alert('Exported ' + vessels.length + ' vessels to CSV!');

        } catch (err) {
            console.error('Export error:', err);
            alert('Export failed: ' + err.message);
        }
    }

    function escapeCSV(str) {
        if (str === null || str === undefined) return '';
        str = String(str);
        if (str.includes('"') || str.includes(';') || str.includes('\n')) {
            return '"' + str.replace(/"/g, '""') + '"';
        }
        return str;
    }

    // Initialize
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => setTimeout(addExportMenuItem, 2000));
    } else {
        setTimeout(addExportMenuItem, 2000);
    }
})();
