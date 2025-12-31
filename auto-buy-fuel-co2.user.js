// ==UserScript==
// @name         ShippingManager - Auto-Buy Fuel/CO2
// @namespace    http://tampermonkey.net/
// @version      3.3
// @description  Auto-buy fuel and CO2 when prices are below threshold
// @author       https://github.com/justonlyforyou/
// @match        https://shippingmanager.cc/*
// @grant        none
// @run-at       document-end
// @enabled      false
// ==/UserScript==

(function() {
    'use strict';

    const SCRIPT_NAME = 'Auto-Buy Fuel/CO2';
    const STORAGE_KEY = 'rebelship_autobuy_settings';
    const CHECK_INTERVAL = 10000; // Check every 10 seconds
    const PRICES_API_URL = 'https://shippingmanager.cc/api/bunker/get-prices';

    // Default settings (matching copilot barrel boss / atmosphere broker defaults)
    // Modes: 'off', 'basic', 'intelligent', 'emergency'
    const DEFAULT_SETTINGS = {
        // Fuel settings
        fuelMode: 'off',
        fuelPriceThreshold: 400,      // Basic mode: buy when price <= this
        fuelMinCash: 1000000,         // All modes: keep this much cash
        fuelIntelligentMaxPrice: 500, // Intelligent mode: max price to pay
        fuelEmergencyBelow: 500,      // Emergency mode: trigger when bunker below this (tons)
        fuelEmergencyShips: 5,        // Emergency mode: trigger when this many ships at port
        fuelEmergencyMaxPrice: 600,   // Emergency mode: max price to pay

        // CO2 settings
        co2Mode: 'off',
        co2PriceThreshold: 6,         // Basic mode: buy when price <= this
        co2MinCash: 1000000,          // All modes: keep this much cash
        co2IntelligentMaxPrice: 10,   // Intelligent mode: max price to pay
        co2EmergencyBelow: 500,       // Emergency mode: trigger when bunker below this (tons)
        co2EmergencyShips: 5,         // Emergency mode: trigger when this many ships at port
        co2EmergencyMaxPrice: 12      // Emergency mode: max price to pay
    };

    const isMobile = window.innerWidth < 1024;

    // ============================================
    // REBELSHIP MENU SYSTEM
    // ============================================
    const REBELSHIP_LOGO = '<svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor"><path d="M20 21c-1.39 0-2.78-.47-4-1.32-2.44 1.71-5.56 1.71-8 0C6.78 20.53 5.39 21 4 21H2v2h2c1.38 0 2.74-.35 4-.99 2.52 1.29 5.48 1.29 8 0 1.26.65 2.62.99 4 .99h2v-2h-2zM3.95 19H4c1.6 0 3.02-.88 4-2 .98 1.12 2.4 2 4 2s3.02-.88 4-2c.98 1.12 2.4 2 4 2h.05l1.89-6.68c.08-.26.06-.54-.06-.78s-.34-.42-.6-.5L20 10.62V6c0-1.1-.9-2-2-2h-3V1H9v3H6c-1.1 0-2 .9-2 2v4.62l-1.29.42c-.26.08-.48.26-.6.5s-.15.52-.06.78L3.95 19zM6 6h12v3.97L12 8 6 9.97V6z"/></svg>';

    function getOrCreateMobileRow() {
        var existing = document.getElementById('rebel-mobile-row');
        if (existing) return existing;

        var row = document.createElement('div');
        row.id = 'rebel-mobile-row';
        row.style.cssText = 'position:fixed;top:0;left:0;right:0;display:flex;justify-content:center;align-items:center;gap:10px;background:#1a1a2e;padding:4px 6px;font-size:14px;z-index:9999;';

        document.body.appendChild(row);

        var appContainer = document.querySelector('#app') || document.body.firstElementChild;
        if (appContainer) {
            appContainer.style.marginTop = '2px';
        }

        return row;
    }

    function getOrCreateRebelShipMenu() {
        let menu = document.getElementById('rebelship-menu');
        if (menu) {
            return menu.querySelector('.rebelship-dropdown');
        }

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
            console.log('[Auto-Buy] RebelShip Menu created (mobile)');
            return dropdown;
        }

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
            const isVisible = dropdown.style.display === 'block';
            dropdown.style.display = isVisible ? 'none' : 'block';
        });

        document.addEventListener('click', (e) => {
            if (!container.contains(e.target)) {
                dropdown.style.display = 'none';
            }
        });

        if (messagingIcon.parentNode) {
            messagingIcon.parentNode.insertBefore(container, messagingIcon);
        }

        console.log('[Auto-Buy] RebelShip Menu created');
        return dropdown;
    }

    function addMenuItem(label, onClick) {
        const dropdown = getOrCreateRebelShipMenu();
        if (!dropdown) {
            setTimeout(() => addMenuItem(label, onClick), 1000);
            return null;
        }

        if (dropdown.querySelector(`[data-rebelship-item="${label}"]`)) {
            return dropdown.querySelector(`[data-rebelship-item="${label}"]`);
        }

        const item = document.createElement('div');
        item.dataset.rebelshipItem = label;
        item.style.cssText = 'position:relative;';

        const itemBtn = document.createElement('div');
        itemBtn.style.cssText = 'padding:10px 12px;cursor:pointer;color:#fff;font-size:13px;display:flex;justify-content:space-between;align-items:center;border-bottom:1px solid #374151;';
        itemBtn.innerHTML = '<span>' + label + '</span>';

        itemBtn.addEventListener('mouseenter', () => itemBtn.style.background = '#374151');
        itemBtn.addEventListener('mouseleave', () => itemBtn.style.background = 'transparent');

        if (onClick) {
            itemBtn.addEventListener('click', () => {
                dropdown.style.display = 'none';
                onClick();
            });
        }

        item.appendChild(itemBtn);
        dropdown.appendChild(item);

        return item;
    }

    // ============================================
    // SETTINGS STORAGE
    // ============================================
    function loadSettings() {
        try {
            const stored = localStorage.getItem(STORAGE_KEY);
            if (stored) {
                return { ...DEFAULT_SETTINGS, ...JSON.parse(stored) };
            }
        } catch (e) {
            console.error('[Auto-Buy] Failed to load settings:', e);
        }
        return { ...DEFAULT_SETTINGS };
    }

    function saveSettings(settings) {
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
            console.log('[Auto-Buy] Settings saved:', settings);
        } catch (e) {
            console.error('[Auto-Buy] Failed to save settings:', e);
        }
    }

    // ============================================
    // PINIA STORE ACCESS
    // ============================================
    function getPinia() {
        const app = document.getElementById('app');
        if (!app || !app.__vue_app__) return null;
        return app.__vue_app__.config.globalProperties.$pinia;
    }

    function getModalStore() {
        try {
            const pinia = getPinia();
            if (!pinia || !pinia._s) return null;
            return pinia._s.get('modal');
        } catch (e) {
            console.error('[Auto-Buy] Failed to get modalStore:', e);
            return null;
        }
    }

    function getUserStore() {
        try {
            const pinia = getPinia();
            if (!pinia || !pinia._s) return null;
            return pinia._s.get('user');
        } catch (e) {
            console.error('[Auto-Buy] Failed to get userStore:', e);
            return null;
        }
    }

    function getVesselStore() {
        try {
            const pinia = getPinia();
            if (!pinia || !pinia._s) return null;
            return pinia._s.get('vessel');
        } catch (e) {
            console.error('[Auto-Buy] Failed to get vesselStore:', e);
            return null;
        }
    }

    // ============================================
    // FUEL/CO2 CALCULATION (from game formulas)
    // ============================================

    /**
     * Get vessel capacity for formulas
     * Container: dry + refrigerated (TEU)
     * Tanker: (fuel + crude_oil) / 74
     */
    function getVesselCapacity(vessel) {
        if (!vessel || !vessel.capacity_max) return 0;
        const cap = vessel.capacity_max;

        if (vessel.capacity_type === 'tanker') {
            return ((cap.fuel || 0) + (cap.crude_oil || 0)) / 74;
        }
        return (cap.dry || 0) + (cap.refrigerated || 0);
    }

    /**
     * Calculate fuel consumption for a vessel route
     * Formula: fuel = (capacity / 2000) * distance * sqrt(speed) / 20 * fuel_factor
     * Returns fuel in TONS
     */
    function calculateFuelConsumption(vessel, distance, speed) {
        const capacity = getVesselCapacity(vessel);
        if (capacity <= 0 || distance <= 0 || speed <= 0) return 0;

        const fuelFactor = vessel.fuel_factor || 1;
        const fuelKg = (capacity / 2000) * distance * Math.sqrt(speed) / 20 * fuelFactor;
        return fuelKg / 1000; // Convert to tons
    }

    /**
     * Calculate CO2 consumption for a vessel route
     * Formula: co2 = (2 - capacity / 15000) * co2_factor * cargo * distance
     * Returns CO2 in TONS
     */
    function calculateCO2Consumption(vessel, distance, cargo) {
        const capacity = getVesselCapacity(vessel);
        if (capacity <= 0 || distance <= 0) return 0;

        const co2Factor = vessel.co2_factor || 1;
        const co2PerTeuNm = (2 - capacity / 15000) * co2Factor;
        const cargoAmount = cargo || capacity; // Use max capacity if no cargo specified
        const co2Kg = co2PerTeuNm * cargoAmount * distance;
        return co2Kg / 1000; // Convert to tons
    }

    /**
     * Get vessels ready to depart (at port with route planned)
     */
    function getVesselsReadyToDepart() {
        const vesselStore = getVesselStore();
        if (!vesselStore || !vesselStore.vessels) return [];

        return vesselStore.vessels.filter(v =>
            v.status === 'port' &&
            !v.is_parked &&
            v.route_destination &&
            v.route_distance > 0
        );
    }

    /**
     * Get count of vessels at port
     */
    function getVesselsAtPortCount() {
        const vesselStore = getVesselStore();
        if (!vesselStore || !vesselStore.vessels) return 0;

        return vesselStore.vessels.filter(v => v.status === 'port').length;
    }

    /**
     * Calculate total fuel needed for all ready-to-depart vessels
     */
    function calculateTotalFuelNeeded() {
        const vessels = getVesselsReadyToDepart();
        let totalFuel = 0;

        for (const vessel of vessels) {
            const distance = vessel.route_distance;
            const speed = vessel.route_speed || vessel.max_speed;

            // Use route_fuel_required if available, otherwise calculate
            let fuelNeeded = vessel.route_fuel_required || vessel.fuel_required;
            if (!fuelNeeded) {
                fuelNeeded = calculateFuelConsumption(vessel, distance, speed) * 1000; // API returns kg
            }
            totalFuel += fuelNeeded || 0;
        }

        return totalFuel / 1000; // Return in tons
    }

    /**
     * Calculate total CO2 needed for all ready-to-depart vessels
     */
    function calculateTotalCO2Needed() {
        const vessels = getVesselsReadyToDepart();
        let totalCO2 = 0;

        for (const vessel of vessels) {
            const distance = vessel.route_distance;
            const cargo = getVesselCapacity(vessel); // Use max capacity for buffer

            // Use route_co2_required if available, otherwise calculate
            let co2Needed = vessel.route_co2_required || vessel.co2_required;
            if (!co2Needed) {
                co2Needed = calculateCO2Consumption(vessel, distance, cargo) * 1000; // API returns kg
            }
            totalCO2 += co2Needed || 0;
        }

        return totalCO2 / 1000; // Return in tons
    }

    // ============================================
    // PRICE COLOR FUNCTIONS (fixed ranges from game)
    // ============================================
    function getFuelColor(price) {
        if (price > 750) return '#ef4444';  // red
        if (price >= 650) return '#fbbf24'; // yellow
        if (price >= 500) return '#60a5fa'; // blue
        return '#4ade80';                   // green
    }

    function getCO2Color(price) {
        if (price >= 20) return '#ef4444';  // red
        if (price >= 15) return '#fbbf24';  // yellow
        if (price >= 10) return '#60a5fa';  // blue
        return '#4ade80';                   // green
    }

    // ============================================
    // NUMBER FORMATTING (thousand separators)
    // ============================================
    function formatNumber(num) {
        if (num === null || num === undefined || isNaN(num)) return '';
        return num.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    }

    function parseFormattedNumber(str) {
        if (!str) return 0;
        return parseInt(str.replace(/,/g, ''), 10) || 0;
    }

    function setupCashInputFormatting(inputId) {
        const input = document.getElementById(inputId);
        if (!input) return;

        input.addEventListener('input', function() {
            const cursorPos = this.selectionStart;
            const oldLen = this.value.length;
            const raw = parseFormattedNumber(this.value);
            this.value = formatNumber(raw);
            const newLen = this.value.length;
            const newPos = cursorPos + (newLen - oldLen);
            this.setSelectionRange(newPos, newPos);
        });
    }

    // ============================================
    // FETCH PRICES FROM API
    // ============================================
    function findCurrentPrice(prices) {
        if (!prices || prices.length === 0) return null;

        const now = new Date();
        const currentHour = now.getHours();
        const currentMin = now.getMinutes();

        for (const p of prices) {
            if (!p || !p.start_time) continue;
            const [h, m] = p.start_time.split(':').map(Number);
            const endM = m + 30;
            if (h === currentHour) {
                if (m <= currentMin && currentMin < endM) {
                    return p;
                }
            }
        }
        return prices[0];
    }

    async function fetchCurrentPrices() {
        try {
            const response = await fetch(PRICES_API_URL, {
                credentials: 'include'
            });
            if (!response.ok) {
                console.error('[Auto-Buy] Price fetch failed:', response.status);
                return null;
            }
            const data = await response.json();
            console.log('[Auto-Buy] Price data:', data);

            const prices = data && data.data && data.data.prices;
            if (!prices || prices.length === 0) {
                console.error('[Auto-Buy] No prices in response');
                return null;
            }

            const discountedFuel = data.data.discounted_fuel;
            const discountedCo2 = data.data.discounted_co2;

            let fuelPrice, co2Price;
            if (discountedFuel !== undefined) {
                fuelPrice = discountedFuel;
            } else {
                const current = findCurrentPrice(prices);
                fuelPrice = current ? current.fuel_price : null;
            }

            if (discountedCo2 !== undefined) {
                co2Price = discountedCo2;
            } else {
                const current = findCurrentPrice(prices);
                co2Price = current ? current.co2_price : null;
            }

            console.log('[Auto-Buy] Parsed prices:', { fuelPrice, co2Price });
            return { fuelPrice, co2Price };
        } catch (e) {
            console.error('[Auto-Buy] Failed to fetch prices:', e);
            return null;
        }
    }

    // ============================================
    // SETTINGS MODAL CSS
    // ============================================
    const SETTINGS_CSS = `
        .autobuy-settings {
            padding: 12px;
            color: #fff;
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            font-size: 12px;
        }
        .autobuy-settings .columns {
            display: flex;
            gap: 12px;
        }
        .autobuy-settings .column {
            flex: 1;
            min-width: 0;
        }
        .autobuy-settings h3 {
            margin: 0 0 8px 0;
            font-size: 13px;
            color: #60a5fa;
            border-bottom: 1px solid #374151;
            padding-bottom: 6px;
        }
        .autobuy-settings .mode-select {
            padding: 4px 8px;
            border: 1px solid #374151;
            border-radius: 4px;
            background: #1f2937;
            color: #fff;
            font-size: 12px;
            cursor: pointer;
            min-width: 100px;
        }
        .autobuy-settings .mode-select:focus {
            outline: none;
            border-color: #3b82f6;
        }
        .autobuy-settings .section {
            background: rgba(255,255,255,0.03);
            border-radius: 4px;
            padding: 8px;
            margin-bottom: 8px;
        }
        .autobuy-settings .setting-info {
            font-size: 10px;
            color: #6b7280;
            margin-top: 4px;
            font-style: italic;
        }
        .autobuy-settings .section-title {
            font-size: 11px;
            color: #9ca3af;
            margin-bottom: 6px;
            text-transform: uppercase;
            letter-spacing: 0.5px;
        }
        .autobuy-settings .setting-row {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 6px;
            padding: 4px 0;
        }
        .autobuy-settings .setting-row:last-child {
            margin-bottom: 0;
        }
        .autobuy-settings .setting-label {
            font-size: 12px;
            color: #e5e7eb;
        }
        .autobuy-settings input[type="number"] {
            width: 70px;
            padding: 4px 6px;
            border: 1px solid #374151;
            border-radius: 3px;
            background: #1f2937;
            color: #fff;
            font-size: 12px;
            text-align: right;
        }
        .autobuy-settings input[type="number"]:focus {
            outline: none;
            border-color: #3b82f6;
        }
        .autobuy-settings input.cash-input {
            width: 120px;
            padding: 4px 6px;
            border: 1px solid #374151;
            border-radius: 3px;
            background: #1f2937;
            color: #fff;
            font-size: 12px;
            text-align: right;
        }
        .autobuy-settings input.cash-input:focus {
            outline: none;
            border-color: #3b82f6;
        }
        .autobuy-settings .toggle-sm {
            position: relative;
            width: 36px;
            height: 18px;
            flex-shrink: 0;
        }
        .autobuy-settings .toggle-sm input {
            opacity: 0;
            width: 0;
            height: 0;
        }
        .autobuy-settings .toggle-slider-sm {
            position: absolute;
            cursor: pointer;
            top: 0;
            left: 0;
            right: 0;
            bottom: 0;
            background-color: #374151;
            transition: 0.2s;
            border-radius: 18px;
        }
        .autobuy-settings .toggle-slider-sm:before {
            position: absolute;
            content: "";
            height: 14px;
            width: 14px;
            left: 2px;
            bottom: 2px;
            background-color: white;
            transition: 0.2s;
            border-radius: 50%;
        }
        .autobuy-settings input:checked + .toggle-slider-sm {
            background-color: #3b82f6;
        }
        .autobuy-settings input:checked + .toggle-slider-sm:before {
            transform: translateX(18px);
        }
        .autobuy-settings .btn-save {
            width: 100%;
            padding: 10px;
            background: linear-gradient(135deg, #3b82f6, #1d4ed8);
            color: white;
            border: none;
            border-radius: 4px;
            font-size: 13px;
            font-weight: 600;
            cursor: pointer;
            margin-top: 8px;
        }
        .autobuy-settings .btn-save:hover {
            background: linear-gradient(135deg, #2563eb, #1e40af);
        }
        .autobuy-settings .price-box {
            background: rgba(59, 130, 246, 0.1);
            border: 1px solid rgba(59, 130, 246, 0.3);
            border-radius: 4px;
            padding: 8px;
            margin-bottom: 10px;
            display: flex;
            justify-content: space-around;
        }
        .autobuy-settings .price-item {
            text-align: center;
        }
        .autobuy-settings .price-label {
            font-size: 10px;
            color: #9ca3af;
        }
        .autobuy-settings .price-value {
            font-size: 14px;
            font-weight: 600;
        }
        .autobuy-settings .toast {
            position: fixed;
            bottom: 20px;
            left: 50%;
            transform: translateX(-50%);
            background: #22c55e;
            color: white;
            padding: 10px 20px;
            border-radius: 6px;
            font-size: 13px;
            z-index: 100000;
            animation: fadeInOut 2s ease-in-out;
        }
        @keyframes fadeInOut {
            0% { opacity: 0; transform: translateX(-50%) translateY(10px); }
            15% { opacity: 1; transform: translateX(-50%) translateY(0); }
            85% { opacity: 1; transform: translateX(-50%) translateY(0); }
            100% { opacity: 0; transform: translateX(-50%) translateY(-10px); }
        }

        /* Override game modal - aggressive background fix */
        #modal-container.autobuy-mode,
        #modal-container.autobuy-mode #modal-content,
        #modal-container.autobuy-mode #modal-content > *,
        #modal-container.autobuy-mode #modal-content div,
        #modal-container.autobuy-mode .modal-body,
        #modal-container.autobuy-mode [class*="modal"],
        #modal-container.autobuy-mode [class*="content"] {
            background: #1e2235 !important;
            background-color: #1e2235 !important;
        }
        #modal-container.autobuy-mode #modal-content {
            height: auto !important;
            max-height: none !important;
            overflow: visible !important;
        }
        #modal-container.autobuy-mode #central-container {
            padding: 0 !important;
            margin: 0 !important;
            overflow: visible !important;
            background: #1e2235 !important;
            height: auto !important;
            max-height: none !important;
        }
        #modal-container.autobuy-mode #bottom-controls,
        #modal-container.autobuy-mode #bottom-nav,
        #modal-container.autobuy-mode #top-nav {
            display: none !important;
        }
    `;

    // ============================================
    // SETTINGS MODAL
    // ============================================
    let titleObserver = null;
    const MODAL_TITLE = 'Auto-Buy Fuel/CO2 Settings';

    function openSettingsModal() {
        const modalStore = getModalStore();
        if (!modalStore) {
            console.error('[Auto-Buy] modalStore not found');
            return;
        }

        // Clean up previous observer
        if (titleObserver) {
            titleObserver.disconnect();
            titleObserver = null;
        }

        const settings = loadSettings();

        // Open routeResearch modal (loads faster as it can be opened empty)
        modalStore.open('routeResearch');

        // Wait for modal to render, then replace content
        setTimeout(() => {
            // Change title and remove controls in modalStore (reactive)
            if (modalStore.modalSettings) {
                modalStore.modalSettings.title = MODAL_TITLE;
                modalStore.modalSettings.navigation = [];
                modalStore.modalSettings.controls = [];
            }

            const modalContainer = document.getElementById('modal-container');
            if (modalContainer) {
                modalContainer.classList.add('autobuy-mode');

                // Find and update title element directly in DOM
                const titleSelectors = [
                    '#modal-container .modal-title',
                    '#modal-container #modal-title',
                    '#modal-container [class*="title"]',
                    '#modal-container h2',
                    '#modal-container h3',
                    '.modal-title',
                    '#modal-title'
                ];

                let titleElement = null;
                for (const sel of titleSelectors) {
                    const el = document.querySelector(sel);
                    if (el && el.textContent && el.textContent.trim().length > 0) {
                        titleElement = el;
                        break;
                    }
                }

                if (titleElement) {
                    titleElement.textContent = MODAL_TITLE;
                    // Use MutationObserver to keep title in sync
                    titleObserver = new window.MutationObserver(() => {
                        if (titleElement.textContent !== MODAL_TITLE) {
                            titleElement.textContent = MODAL_TITLE;
                        }
                    });
                    titleObserver.observe(titleElement, { childList: true, characterData: true, subtree: true });
                }
            }

            const centralContainer = document.getElementById('central-container');
            if (!centralContainer) {
                console.error('[Auto-Buy] central-container not found');
                return;
            }

            // Build compact settings HTML with two columns and radio buttons
            centralContainer.innerHTML = `
                <div class="autobuy-settings">
                    <div class="price-box">
                        <div class="price-item">
                            <div class="price-label">FUEL</div>
                            <div class="price-value" id="autobuy-fuel-price">...</div>
                        </div>
                        <div class="price-item">
                            <div class="price-label">CO2</div>
                            <div class="price-value" id="autobuy-co2-price">...</div>
                        </div>
                    </div>

                    <div class="columns">
                        <!-- FUEL COLUMN -->
                        <div class="column">
                            <h3>Fuel Auto-Rebuy</h3>

                            <div class="setting-row">
                                <span class="setting-label">Mode</span>
                                <select id="ab-fuel-mode" class="mode-select">
                                    <option value="off" ${settings.fuelMode === 'off' ? 'selected' : ''}>Off</option>
                                    <option value="basic" ${settings.fuelMode === 'basic' ? 'selected' : ''}>Basic</option>
                                    <option value="intelligent" ${settings.fuelMode === 'intelligent' ? 'selected' : ''}>Intelligent</option>
                                    <option value="emergency" ${settings.fuelMode === 'emergency' ? 'selected' : ''}>Emergency</option>
                                </select>
                            </div>

                            <div class="section" id="fuel-basic-section">
                                <div class="section-title">Basic Settings</div>
                                <div class="setting-row">
                                    <span class="setting-label">Price Threshold</span>
                                    <input type="number" id="ab-fuel-threshold" value="${settings.fuelPriceThreshold}" min="1">
                                </div>
                            </div>

                            <div class="section" id="fuel-intelligent-section">
                                <div class="section-title">Intelligent Settings</div>
                                <div class="setting-row">
                                    <span class="setting-label">Max Price</span>
                                    <input type="number" id="ab-fuel-intel-max" value="${settings.fuelIntelligentMaxPrice}" min="1">
                                </div>
                                <div class="setting-info">Calculates fuel needs for all ready-to-depart vessels</div>
                            </div>

                            <div class="section" id="fuel-emergency-section">
                                <div class="section-title">Emergency Settings</div>
                                <div class="setting-row">
                                    <span class="setting-label">Below (t)</span>
                                    <input type="number" id="ab-fuel-emerg-below" value="${settings.fuelEmergencyBelow}" min="0">
                                </div>
                                <div class="setting-row">
                                    <span class="setting-label">Ships at Port</span>
                                    <input type="number" id="ab-fuel-emerg-ships" value="${settings.fuelEmergencyShips}" min="1">
                                </div>
                                <div class="setting-row">
                                    <span class="setting-label">Max Price</span>
                                    <input type="number" id="ab-fuel-emerg-max" value="${settings.fuelEmergencyMaxPrice}" min="1">
                                </div>
                            </div>

                            <div class="section">
                                <div class="section-title">Common</div>
                                <div class="setting-row">
                                    <span class="setting-label">Min Cash</span>
                                    <input type="text" id="ab-fuel-mincash" class="cash-input" value="${formatNumber(settings.fuelMinCash)}">
                                </div>
                            </div>
                        </div>

                        <!-- CO2 COLUMN -->
                        <div class="column">
                            <h3>CO2 Auto-Rebuy</h3>

                            <div class="setting-row">
                                <span class="setting-label">Mode</span>
                                <select id="ab-co2-mode" class="mode-select">
                                    <option value="off" ${settings.co2Mode === 'off' ? 'selected' : ''}>Off</option>
                                    <option value="basic" ${settings.co2Mode === 'basic' ? 'selected' : ''}>Basic</option>
                                    <option value="intelligent" ${settings.co2Mode === 'intelligent' ? 'selected' : ''}>Intelligent</option>
                                    <option value="emergency" ${settings.co2Mode === 'emergency' ? 'selected' : ''}>Emergency</option>
                                </select>
                            </div>

                            <div class="section" id="co2-basic-section">
                                <div class="section-title">Basic Settings</div>
                                <div class="setting-row">
                                    <span class="setting-label">Price Threshold</span>
                                    <input type="number" id="ab-co2-threshold" value="${settings.co2PriceThreshold}" min="1">
                                </div>
                            </div>

                            <div class="section" id="co2-intelligent-section">
                                <div class="section-title">Intelligent Settings</div>
                                <div class="setting-row">
                                    <span class="setting-label">Max Price</span>
                                    <input type="number" id="ab-co2-intel-max" value="${settings.co2IntelligentMaxPrice}" min="1">
                                </div>
                                <div class="setting-info">Calculates CO2 needs for all ready-to-depart vessels</div>
                            </div>

                            <div class="section" id="co2-emergency-section">
                                <div class="section-title">Emergency Settings</div>
                                <div class="setting-row">
                                    <span class="setting-label">Below (t)</span>
                                    <input type="number" id="ab-co2-emerg-below" value="${settings.co2EmergencyBelow}" min="0">
                                </div>
                                <div class="setting-row">
                                    <span class="setting-label">Ships at Port</span>
                                    <input type="number" id="ab-co2-emerg-ships" value="${settings.co2EmergencyShips}" min="1">
                                </div>
                                <div class="setting-row">
                                    <span class="setting-label">Max Price</span>
                                    <input type="number" id="ab-co2-emerg-max" value="${settings.co2EmergencyMaxPrice}" min="1">
                                </div>
                            </div>

                            <div class="section">
                                <div class="section-title">Common</div>
                                <div class="setting-row">
                                    <span class="setting-label">Min Cash</span>
                                    <input type="text" id="ab-co2-mincash" class="cash-input" value="${formatNumber(settings.co2MinCash)}">
                                </div>
                            </div>
                        </div>
                    </div>

                </div>
            `;

            // Setup cash input formatting
            setupCashInputFormatting('ab-fuel-mincash');
            setupCashInputFormatting('ab-co2-mincash');

            // Function to show/hide sections based on mode
            function updateSectionVisibility() {
                const fuelMode = document.getElementById('ab-fuel-mode')?.value || 'off';
                const co2Mode = document.getElementById('ab-co2-mode')?.value || 'off';

                // Fuel sections
                document.getElementById('fuel-basic-section').style.display = fuelMode === 'basic' ? 'block' : 'none';
                document.getElementById('fuel-intelligent-section').style.display = fuelMode === 'intelligent' ? 'block' : 'none';
                document.getElementById('fuel-emergency-section').style.display = fuelMode === 'emergency' ? 'block' : 'none';

                // CO2 sections
                document.getElementById('co2-basic-section').style.display = co2Mode === 'basic' ? 'block' : 'none';
                document.getElementById('co2-intelligent-section').style.display = co2Mode === 'intelligent' ? 'block' : 'none';
                document.getElementById('co2-emergency-section').style.display = co2Mode === 'emergency' ? 'block' : 'none';
            }

            // Initial visibility
            updateSectionVisibility();

            // Auto-save function - called on every change
            function autoSave() {
                // Update section visibility when mode changes
                updateSectionVisibility();

                const newSettings = {
                    // Fuel settings
                    fuelMode: document.getElementById('ab-fuel-mode')?.value || 'off',
                    fuelPriceThreshold: parseInt(document.getElementById('ab-fuel-threshold').value) || DEFAULT_SETTINGS.fuelPriceThreshold,
                    fuelMinCash: parseFormattedNumber(document.getElementById('ab-fuel-mincash').value) || DEFAULT_SETTINGS.fuelMinCash,
                    fuelIntelligentMaxPrice: parseInt(document.getElementById('ab-fuel-intel-max').value) || DEFAULT_SETTINGS.fuelIntelligentMaxPrice,
                    fuelEmergencyBelow: parseInt(document.getElementById('ab-fuel-emerg-below').value) || DEFAULT_SETTINGS.fuelEmergencyBelow,
                    fuelEmergencyShips: parseInt(document.getElementById('ab-fuel-emerg-ships').value) || DEFAULT_SETTINGS.fuelEmergencyShips,
                    fuelEmergencyMaxPrice: parseInt(document.getElementById('ab-fuel-emerg-max').value) || DEFAULT_SETTINGS.fuelEmergencyMaxPrice,

                    // CO2 settings
                    co2Mode: document.getElementById('ab-co2-mode')?.value || 'off',
                    co2PriceThreshold: parseInt(document.getElementById('ab-co2-threshold').value) || DEFAULT_SETTINGS.co2PriceThreshold,
                    co2MinCash: parseFormattedNumber(document.getElementById('ab-co2-mincash').value) || DEFAULT_SETTINGS.co2MinCash,
                    co2IntelligentMaxPrice: parseInt(document.getElementById('ab-co2-intel-max').value) || DEFAULT_SETTINGS.co2IntelligentMaxPrice,
                    co2EmergencyBelow: parseInt(document.getElementById('ab-co2-emerg-below').value) || DEFAULT_SETTINGS.co2EmergencyBelow,
                    co2EmergencyShips: parseInt(document.getElementById('ab-co2-emerg-ships').value) || DEFAULT_SETTINGS.co2EmergencyShips,
                    co2EmergencyMaxPrice: parseInt(document.getElementById('ab-co2-emerg-max').value) || DEFAULT_SETTINGS.co2EmergencyMaxPrice
                };
                saveSettings(newSettings);
                console.log('[Auto-Buy] Auto-saved:', newSettings);

                // Restart monitoring if any mode is enabled
                if (newSettings.fuelMode !== 'off' || newSettings.co2Mode !== 'off') {
                    startMonitoring();
                } else {
                    stopMonitoring();
                }
            }

            // Add auto-save listeners to all inputs and selects
            const allInputs = centralContainer.querySelectorAll('input, select');
            allInputs.forEach(input => {
                input.addEventListener('change', autoSave);
            });

            // Fetch and display current prices with fixed game colors
            fetchCurrentPrices().then(prices => {
                const fuelPriceEl = document.getElementById('autobuy-fuel-price');
                const co2PriceEl = document.getElementById('autobuy-co2-price');

                if (prices) {
                    if (fuelPriceEl && prices.fuelPrice !== null) {
                        fuelPriceEl.textContent = '$' + prices.fuelPrice;
                        fuelPriceEl.style.color = getFuelColor(prices.fuelPrice);
                    }
                    if (co2PriceEl && prices.co2Price !== null) {
                        co2PriceEl.textContent = '$' + prices.co2Price;
                        co2PriceEl.style.color = getCO2Color(prices.co2Price);
                    }
                } else {
                    if (fuelPriceEl) fuelPriceEl.textContent = 'Error';
                    if (co2PriceEl) co2PriceEl.textContent = 'Error';
                }
            });

        }, 150);
    }

    // ============================================
    // AUTO-BUY LOGIC
    // ============================================
    let monitoringInterval = null;

    function startMonitoring() {
        if (monitoringInterval) {
            clearInterval(monitoringInterval);
        }

        console.log('[Auto-Buy] Starting price monitoring');
        monitoringInterval = setInterval(checkAndBuy, CHECK_INTERVAL);

        // Also check immediately
        checkAndBuy();
    }

    function stopMonitoring() {
        if (monitoringInterval) {
            clearInterval(monitoringInterval);
            monitoringInterval = null;
            console.log('[Auto-Buy] Stopped price monitoring');
        }
    }

    async function checkAndBuy() {
        const settings = loadSettings();

        // Check if any mode is enabled
        if (settings.fuelMode === 'off' && settings.co2Mode === 'off') {
            return;
        }

        // Fetch current prices from API
        const prices = await fetchCurrentPrices();
        if (!prices) {
            console.log('[Auto-Buy] No price data available');
            return;
        }

        const { fuelPrice, co2Price } = prices;

        // Get bunker data from Pinia userStore
        const bunkerData = getBunkerData();
        if (!bunkerData) {
            console.log('[Auto-Buy] No bunker data available');
            return;
        }

        console.log('[Auto-Buy] Bunker:', bunkerData, 'Prices:', prices);

        // ========== FUEL ==========
        if (settings.fuelMode !== 'off' && fuelPrice) {
            const fuelSpace = bunkerData.maxFuel - bunkerData.fuel;
            const availableCash = Math.max(0, bunkerData.cash - settings.fuelMinCash);
            let amountToBuy = 0;
            let reason = '';

            if (settings.fuelMode === 'basic') {
                // BASIC: Buy when price <= threshold, fill bunker
                if (fuelPrice <= settings.fuelPriceThreshold) {
                    const maxAffordable = Math.floor(availableCash / fuelPrice);
                    amountToBuy = Math.min(fuelSpace, maxAffordable);
                    reason = `Basic: price $${fuelPrice} <= $${settings.fuelPriceThreshold}`;
                }

            } else if (settings.fuelMode === 'intelligent') {
                // INTELLIGENT: Only buy if price <= maxPrice, calculate vessel needs
                if (fuelPrice <= settings.fuelIntelligentMaxPrice) {
                    const fuelNeeded = calculateTotalFuelNeeded();
                    const shortfall = Math.ceil(fuelNeeded - bunkerData.fuel);

                    if (shortfall > 0) {
                        // Buy shortfall
                        const maxAffordable = Math.floor(availableCash / fuelPrice);
                        amountToBuy = Math.min(shortfall, fuelSpace, maxAffordable);
                        reason = `Intelligent: shortfall ${shortfall}t for ${getVesselsReadyToDepart().length} vessels`;
                    } else if (fuelSpace > 0) {
                        // No shortfall but not full - refill
                        const maxAffordable = Math.floor(availableCash / fuelPrice);
                        amountToBuy = Math.min(fuelSpace, maxAffordable);
                        reason = `Intelligent: refilling (no shortfall)`;
                    }
                }

            } else if (settings.fuelMode === 'emergency') {
                // EMERGENCY: Buy when bunker critically low AND ships waiting
                if (bunkerData.fuel < settings.fuelEmergencyBelow) {
                    const shipsAtPort = getVesselsAtPortCount();
                    if (shipsAtPort >= settings.fuelEmergencyShips && fuelPrice <= settings.fuelEmergencyMaxPrice) {
                        const maxAffordable = Math.floor(availableCash / fuelPrice);
                        amountToBuy = Math.min(fuelSpace, maxAffordable);
                        reason = `EMERGENCY: bunker ${bunkerData.fuel.toFixed(0)}t < ${settings.fuelEmergencyBelow}t, ${shipsAtPort} ships at port`;
                    }
                }
            }

            if (amountToBuy > 0) {
                console.log(`[Auto-Buy] Fuel: ${reason}, buying ${amountToBuy.toFixed(0)}t @ $${fuelPrice}`);
                await buyFuel(amountToBuy);
            }
        }

        // ========== CO2 ==========
        if (settings.co2Mode !== 'off' && co2Price) {
            // Get fresh bunker data after potential fuel purchase
            const updatedBunkerData = getBunkerData();
            if (!updatedBunkerData) return;

            const co2Space = updatedBunkerData.maxCO2 - updatedBunkerData.co2;
            const availableCash = Math.max(0, updatedBunkerData.cash - settings.co2MinCash);
            let amountToBuy = 0;
            let reason = '';

            if (settings.co2Mode === 'basic') {
                // BASIC: Buy when price <= threshold, fill bunker
                if (co2Price <= settings.co2PriceThreshold) {
                    const maxAffordable = Math.floor(availableCash / co2Price);
                    amountToBuy = Math.min(co2Space, maxAffordable);
                    reason = `Basic: price $${co2Price} <= $${settings.co2PriceThreshold}`;
                }

            } else if (settings.co2Mode === 'intelligent') {
                // INTELLIGENT: Only buy if price <= maxPrice, calculate vessel needs
                if (co2Price <= settings.co2IntelligentMaxPrice) {
                    const co2Needed = calculateTotalCO2Needed();
                    const shortfall = Math.ceil(co2Needed - updatedBunkerData.co2);

                    if (shortfall > 0) {
                        // Buy shortfall
                        const maxAffordable = Math.floor(availableCash / co2Price);
                        amountToBuy = Math.min(shortfall, co2Space, maxAffordable);
                        reason = `Intelligent: shortfall ${shortfall}t for ${getVesselsReadyToDepart().length} vessels`;
                    } else if (co2Space > 0) {
                        // No shortfall but not full - refill
                        const maxAffordable = Math.floor(availableCash / co2Price);
                        amountToBuy = Math.min(co2Space, maxAffordable);
                        reason = `Intelligent: refilling (no shortfall)`;
                    }
                }

            } else if (settings.co2Mode === 'emergency') {
                // EMERGENCY: Buy when bunker critically low AND ships waiting
                if (updatedBunkerData.co2 < settings.co2EmergencyBelow) {
                    const shipsAtPort = getVesselsAtPortCount();
                    if (shipsAtPort >= settings.co2EmergencyShips && co2Price <= settings.co2EmergencyMaxPrice) {
                        const maxAffordable = Math.floor(availableCash / co2Price);
                        amountToBuy = Math.min(co2Space, maxAffordable);
                        reason = `EMERGENCY: bunker ${updatedBunkerData.co2.toFixed(0)}t < ${settings.co2EmergencyBelow}t, ${shipsAtPort} ships at port`;
                    }
                }
            }

            if (amountToBuy > 0) {
                console.log(`[Auto-Buy] CO2: ${reason}, buying ${amountToBuy.toFixed(0)}t @ $${co2Price}`);
                await buyCO2(amountToBuy);
            }
        }
    }

    function getBunkerData() {
        const userStore = getUserStore();
        if (!userStore || !userStore.user || !userStore.settings) {
            console.log('[Auto-Buy] userStore not available');
            return null;
        }

        return {
            cash: userStore.user.cash,
            fuel: userStore.user.fuel / 1000,
            co2: userStore.user.co2 / 1000,
            maxFuel: userStore.settings.max_fuel / 1000,
            maxCO2: userStore.settings.max_co2 / 1000
        };
    }

    function updateUserStore(userData) {
        const userStore = getUserStore();
        if (userStore && userData) {
            userStore.$patch(function(state) {
                if (userData.fuel !== undefined) state.user.fuel = userData.fuel;
                if (userData.co2 !== undefined) state.user.co2 = userData.co2;
                if (userData.cash !== undefined) state.user.cash = userData.cash;
            });
            console.log('[Auto-Buy] Updated userStore with new values');
        }
    }

    async function buyFuel(amountTons) {
        try {
            const amountKg = Math.floor(amountTons * 1000);
            const response = await fetch('https://shippingmanager.cc/api/bunker/purchase-fuel', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({ amount: amountKg })
            });

            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }

            const data = await response.json();
            console.log('[Auto-Buy] Fuel purchase response:', data);
            if (data.user) {
                updateUserStore(data.user);
            }
            return data;
        } catch (e) {
            console.error('[Auto-Buy] Fuel purchase failed:', e);
            return null;
        }
    }

    async function buyCO2(amountTons) {
        try {
            const amountKg = Math.floor(amountTons * 1000);
            const response = await fetch('https://shippingmanager.cc/api/bunker/purchase-co2', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({ amount: amountKg })
            });

            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }

            const data = await response.json();
            console.log('[Auto-Buy] CO2 purchase response:', data);
            if (data.user) {
                updateUserStore(data.user);
            }
            return data;
        } catch (e) {
            console.error('[Auto-Buy] CO2 purchase failed:', e);
            return null;
        }
    }

    // ============================================
    // CLEANUP ON MODAL CLOSE
    // ============================================
    function setupModalCloseHandler() {
        const observer = new window.MutationObserver((_mutations) => {
            const modalContainer = document.getElementById('modal-container');
            if (modalContainer && !modalContainer.classList.contains('hidden')) {
                // Modal is visible, do nothing
            } else if (modalContainer) {
                // Modal closed, clean up
                if (modalContainer.classList.contains('autobuy-mode')) {
                    modalContainer.classList.remove('autobuy-mode');
                    // Clean up title observer
                    if (titleObserver) {
                        titleObserver.disconnect();
                        titleObserver = null;
                    }
                    // Immediately check if we need to buy something
                    console.log('[Auto-Buy] Modal closed, checking for purchases...');
                    checkAndBuy();
                }
            }
        });

        const modalContainer = document.getElementById('modal-container');
        if (modalContainer) {
            observer.observe(modalContainer, { attributes: true, attributeFilter: ['class'] });
        }
    }

    // ============================================
    // INITIALIZATION
    // ============================================
    function init() {
        // Inject CSS
        const style = document.createElement('style');
        style.textContent = SETTINGS_CSS;
        document.head.appendChild(style);

        // Add menu item
        addMenuItem(SCRIPT_NAME, openSettingsModal);
        console.log('[Auto-Buy] Menu item added');

        // Setup modal close handler
        setTimeout(setupModalCloseHandler, 2000);

        // Start monitoring if any auto-rebuy is enabled
        const settings = loadSettings();
        if (settings.autoRebuyFuel || settings.autoRebuyCO2) {
            // Wait a bit for the game to fully load
            setTimeout(startMonitoring, 5000);
        }
    }

    // Wait for page to be ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => setTimeout(init, 2000));
    } else {
        setTimeout(init, 2000);
    }
})();
