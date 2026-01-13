# Shipping Manager User Scripts

A collection of user scripts for [Shipping Manager](https://shippingmanager.cc/) that fix game bugs the developers won't address and add quality-of-life features.

## Installation

### Recommended: RebelShip Browser

The easiest way to use these scripts is with **RebelShip Browser**, which has all scripts pre-installed:

- **Desktop**: [RebelShip Browser](https://github.com/justonlyforyou/RebelShipBrowser)
- **Mobile**: [RebelShip Browser Mobile](https://github.com/AstroNik/RebelShipBrowser_Mobile)

Why this browsers recommendation? They are build with special requirements for the scripts in fornt of you. Especially when it comes to background tasks some of the scripts use.
All scripts below are shipped with both Browser incl. easy script updates.

### Manual Installation (Browser Extensions)

> **Note**: Chrome no longer supports userscript managers due to Manifest V3 restrictions. Use Firefox or a Chromium-based browser that still supports Manifest V2 or the Rebelship browsers from above!

1. Install a userscript manager extension:
   - [Tampermonkey](https://www.tampermonkey.net/) (Firefox, Edge, Safari)
   - [Violentmonkey](https://violentmonkey.github.io/) (Firefox, Edge)
   - [Greasemonkey](https://www.greasespot.net/) (Firefox)

2. Click on any `.user.js` file in this repository and click "Raw" to install

---

## Scripts Overview

### Core Features

| Script | Description |
|--------|-------------|
| **map-unlock.user.js** | Unlocks premium map themes, tanker ops, metropolis and extended zoom |
| **yard-foreman.user.js** | Auto-repair vessels when wear reaches configurable threshold |
| **drydock_master.user.js** | Auto-drydock + route settings persistence + drydock bug prevention |

### Fleet Management

| Script | Description |
|--------|-------------|
| **fleet-manager.user.js** | Mass Moor and Resume vessels with checkbox selection |
| **vessel-cart.user.js** | Shopping cart for vessels - bookmark, compare, bulk purchase |
| **buy-vip-vessel.user.js** | Purchase VIP vessels directly |
| **at-port-refresh.user.js** | Auto-refresh At Port vessel list every 30 seconds |

### Automation

| Script | Description |
|--------|-------------|
| **auto-bunker-depart.user.js** | Auto-buy fuel/CO2 and auto-depart vessels |
| **depart-all-loop.user.js** | Continuously clicks Depart All until all vessels departed |
| **fast-delivery.user.js** | Fast delivery for built vessels via drydock exploit |

### UI Enhancements

| Script | Description |
|--------|-------------|
| **bunker-price-display.user.js** | Shows current fuel and CO2 bunker prices with fill levels |
| **reputation-display.user.js** | Displays your current reputation score in the header |
| **coop-tickets-display.user.js** | Shows open Co-Op tickets, red dot on alliance tab |
| **forecast-calendar.user.js** | Visual calendar with cargo demand forecasts |
| **auto-expand-advanced.user.js** | Auto-expands "Advanced" menus + price % difference |
| **enable-distance-filter.user.js** | Filter destination ports by distance ranges |

### Alliance Features

| Script | Description |
|--------|-------------|
| **alliance-chat-notification.user.js** | Red dot on Alliance button for unread messages |
| **alliance-search.user.js** | Search all alliances by name |

### Data Export

| Script | Description |
|--------|-------------|
| **export-vessels-csv.user.js** | Export fleet data to CSV |
| **export-messages.user.js** | Export chat messages as CSV or JSON |
| **save-vessel-history.user.js** | Tracks vessel purchase/sale history |

### Bug Fixes

| Script | Description |
|--------|-------------|
| **fix-alliance-member-exclude.user.js** | Fixes broken exclude buttons for CEO |
| **fix-alliance-edit-buttons.user.js** | Adds missing edit buttons for interim_ceo |

### Developer Tools

| Script | Description |
|--------|-------------|
| **admin-view.user.js** | Displays admin/moderator UI elements (client-side only - do not grant admin or moderator rights) |

---

## Detailed Script Documentation

### drydock_master.user.js - Auto Drydock & Route Settings Manager

**Version:** 2.1 | **Order:** 29 | **Background Job:** Yes

This is a comprehensive drydock management script that combines three critical features:

#### 1. Drydock Bug Prevention

When you send a vessel to drydock in Shipping Manager, **all route settings are lost** (speed, guards, cargo prices). This is a known game bug that has never been fixed. The Drydock Master script solves this by:

1. **Intercepting drydock requests** via fetch API hook
2. **Saving all route settings** (speed, guards, prices) to localStorage before drydock starts
3. **Tracking vessel status** through the drydock lifecycle:
   - `pre_drydock` - Settings saved, vessel heading to drydock
   - `past_drydock` - Drydock complete, waiting to restore
4. **Automatically restoring settings** when the vessel returns to port

The script also detects "bug-use" mode (fast delivery exploit) and handles it separately.

#### 2. Route Settings Tab

Adds a **Settings** button to the Routes modal that allows editing route settings for **ALL vessels**, not just those in port:

- **In-Port Vessels**: Changes apply immediately via API
- **Enroute Vessels**: Changes are saved as "pending" and applied automatically at next departure

The Route Settings tab shows:
- Status indicator (P=Port, E=Enroute, A=Anchored, MP=Moored at Port, ME=Moored on Arrival)
- Route origin and destination
- Vessel name
- Speed, cargo prices (Dry/Ref for cargo, Fuel/Crude for tankers), guards
- Hijacking risk percentage
- Pending values (shown in purple) that will apply at next departure

#### 3. Auto-Drydock

Automatically sends vessels to drydock when their "hours until check" drops below a configurable threshold. Uses the game's bulk drydock API which automatically routes vessels to the nearest port with a drydock.

- **Hours Threshold**: 25, 50, 75, 100, or 150 hours
- **Maintenance Type**: Major (100% antifouling) or Minor (60% antifouling)
- **Drydock Speed**: Minimum, Medium, or Maximum
- **Minimum Cash Reserve**: Won't drydock if cash would drop below this amount

#### How It Works Internally

```
User triggers drydock -> Script intercepts via fetch hook
                      -> Saves route settings to localStorage
                      -> Allows drydock request to proceed

Vessel returns to port -> Script detects via vessel data response
                       -> Reads saved settings from localStorage
                       -> Calls update-route-data API to restore
                       -> Deletes saved settings
```

---

### yard-foreman.user.js - Auto Repair

**Version:** 2.6 | **Order:** 15 | **Background Job:** Yes

Automatically repairs vessels when their wear percentage exceeds a configurable threshold.

#### Features

- **Wear Threshold**: Configurable 1-99% (repairs when wear >= threshold)
- **Minimum Cash Balance**: Keeps at least this amount after repairs
- **System Notifications**: Optional push notifications when repairs are executed
- **Bulk Repair**: Repairs all qualifying vessels in a single batch

#### How It Works

Every 15 minutes, the script:
1. Fetches all vessels via `/api/vessel/get-all-user-vessels`
2. Filters vessels with wear >= threshold (excludes vessels in maintenance or sailing)
3. Gets repair cost via `/api/maintenance/get`
4. Checks if user has enough cash (after maintaining minimum balance)
5. Executes bulk repair via `/api/maintenance/do-wear-maintenance-bulk`

#### Settings Access

Click the ship icon (RebelShip Menu) in the header, then select "Auto Repair".

---

### auto-bunker-depart.user.js - Auto Bunker & Depart

**Version:** 10.6 | **Order:** 20 | **Background Job:** Yes

Comprehensive automation for fuel/CO2 purchasing and vessel departures.

#### Fuel & CO2 Modes

**Basic Mode** (fill bunker when price is good):
- When price <= threshold, fills bunker completely
- Respects minimum cash reserve

**Intelligent Mode** (buy only what you need):
- Only buys if price <= max price AND optional conditions are met
- Optional conditions:
  - "Only if bunker below X tons"
  - "Only if X ships are at port"
- Calculates exact fuel/CO2 needed for departing vessels (shortfall)
- Only buys the shortfall amount, not full bunker

#### Auto-Depart

When enabled, automatically departs all vessels that are:
- At port (not moored)
- Have an assigned route
- Have sufficient fuel in bunker

The script uses a "Buy First, Then Depart" loop:
1. Buy fuel if conditions met
2. Buy CO2 if conditions met
3. Check if enough fuel for departures
4. Depart all ready vessels
5. Repeat until no more vessels can depart

#### Avoid Negative CO2

When enabled, automatically refills CO2 if bunker goes negative after departures. This is important for vessel utilization: negative CO2 balance affects the Green Marketing Campaign bonus, which reduces cargo capacity utilization on your vessels.

#### Fuel Consumption Formula

Uses the exact game formula:
```
fuel_kg = capacity * distance * sqrt(actualSpeed) * fuel_factor / 40
```

---

### fleet-manager.user.js - Mass Moor/Resume

**Version:** 4.2 | **Order:** 23

Adds checkbox selection to vessel lists for bulk mooring and resuming.

#### Features

- **Checkbox Selection**: Checkboxes appear next to vessels in At Port, At Sea, and Anchored tabs
- **All/None Buttons**: Quickly select or deselect all vessels
- **Moor Button**: Parks all selected vessels (stops automatic operations)
- **Resume Button**: Resumes all selected moored vessels

#### Tab-Specific Behavior

- **At Port**: Shows checkboxes for all vessels, Moor button parks them
- **At Sea**: Shows checkboxes for enroute vessels, Moor button sets them to park on arrival
- **Anchored**: Only shows checkboxes for moored vessels (is_parked=true), Resume button unparks them

---

### vessel-cart.user.js - Vessel Shopping Cart

**Version:** 4.6 | **Order:** 26

Shopping cart functionality for vessel purchases and builds.

#### Features

- **Add to Cart Button**: Appears next to Order button in vessel/build modals
- **Cart Badge**: Shows item count in header
- **Build Support**: Saves complete build configuration (engine, capacity, propeller, etc.)
- **Per-Ship Customization**: For builds, configure name and shipyard for each vessel individually
- **Quantity Adjustment**: +/- buttons to adjust quantities
- **Bulk Checkout**: Purchases/builds all items sequentially

#### How It Works

1. **Intercepts vessel data** via XHR/fetch hooks to cache available vessels
2. **Reads build config** from Vue components when on build page
3. **Stores cart in localStorage** under `rebelship_vessel_cart`
4. **Checkout** processes items with 1.5s delay between operations

#### Cart Item Types

- **Purchase**: Buying an existing vessel (has vessel ID)
- **Build**: Building a new vessel (has buildConfig with all specifications)

---

### fast-delivery.user.js - Fast Delivery (Bug-Using)

**Version:** 1.6 | **Order:** 24

Exploits a game bug to reduce vessel delivery time from days to 60 minutes.

#### How It Works

When you build a vessel, it has a delivery time of several days. However, if you immediately send the pending vessel to drydock (minor maintenance), the delivery time is replaced by the drydock duration (60 minutes at minimum speed).

#### Usage

1. Build vessels normally
2. Go to "Pending" tab
3. Checkboxes appear for built vessels (not purchased/donated)
4. Select vessels and click "Fast Delivery"
5. Confirm the drydock cost
6. Vessels will arrive in 60 minutes instead of days

#### Cost

Minor drydock maintenance cost applies (usually much less than the time savings is worth).

---

### forecast-calendar.user.js - Forecast Calendar

**Version:** 3.6 | **Order:** 100

Visual page-flip calendar showing cargo demand forecasts.

#### Features

- **Page-Flip Animation**: Uses embedded PageFlip library for realistic book-like navigation
- **24-Hour Forecast**: Shows fuel and CO2 prices for each 30-minute interval
- **Color Coding**:
  - **Fuel**: Green (<500), Blue (500-649), Orange (650-749), Red (750+)
  - **CO2**: Green (<10), Blue (10-14), Orange (15-19), Red (20+)
- **Current Hour Highlight**: Green highlight on current time slot
- **Timezone Conversion**: Converts CEST forecast data to your local timezone

#### Data Source

Fetches forecast data from `https://shippingmanager-forecast.pages.dev/data/forecast.json`

---

### bunker-price-display.user.js

Displays current fuel and CO2 prices in the game header, color-coded by price quality. Also shows bunker fill levels.

---

### alliance-chat-notification.user.js

Monitors for new alliance chat messages and shows a red notification dot on the Alliance button when unread messages exist.

---

### depart-all-loop.user.js

Continuously clicks the "Depart All" button until all vessels have departed. Useful when you have many vessels and the single click doesn't depart all of them.

---

## Script Header Format

All scripts must include a UserScript metadata block at the top of the file.

### Required Header Structure

```javascript
// ==UserScript==
// @name         Script Name Here
// @description  Brief description of what the script does
// @version      1.0
// @author       https://github.com/justonlyforyou/
// @order        20
// @match        https://shippingmanager.cc/*
// @grant        none
// @run-at       document-end
// @enabled      false
// ==/UserScript==
```

### Supported Directives

| Directive | Required | Description |
|-----------|----------|-------------|
| `@name` | Yes | Display name of the script |
| `@description` | Yes | Short description (shown in script manager) |
| `@version` | Yes | Semantic version (e.g., `1.0`, `2.3.1`) |
| `@author` | Yes | Author name or GitHub URL |
| `@order` | Yes | Load order (1-999). Lower numbers load first |
| `@match` | Yes | URL pattern where script runs |
| `@namespace` | No | Optional namespace URL |
| `@grant` | No | Permissions needed. Use `none` for standard scripts |
| `@run-at` | No | When to inject: `document-start`, `document-end` (default), `document-idle` |
| `@enabled` | No | Default state: `true` or `false`. Scripts default to disabled |
| `@background-job-required` | No | Set to `true` if script needs background execution (Android) |

### Order Guidelines

| Range | Category | Examples |
|-------|----------|----------|
| 10-19 | Core/Early | map-unlock (10), yard-foreman (15) |
| 20-29 | Automation/Display | auto-bunker-depart (20), bunker-price-display (22), fleet-manager (23), fast-delivery (24), drydock_master (29) |
| 30-39 | Route Tools | enable-distance-filter (30) |
| 50-59 | Bug Fixes | fix-alliance-member-exclude (51), fix-alliance-edit-buttons (53) |
| 100+ | Special/Optional | forecast-calendar (100) |

---

## Technical Details

### Pinia Store Access

Most scripts access game state through Vue's Pinia stores:

```javascript
function getPinia() {
    const appEl = document.querySelector('#app');
    if (!appEl || !appEl.__vue_app__) return null;
    const app = appEl.__vue_app__;
    return app._context.provides.pinia || app.config.globalProperties.$pinia;
}

function getStore(name) {
    const pinia = getPinia();
    if (!pinia || !pinia._s) return null;
    return pinia._s.get(name);
}

// Available stores: 'user', 'vessel', 'modal', 'toast', 'game', 'port', etc.
```

### Fetch Interceptor Pattern

Scripts that need to intercept API calls use this pattern:

```javascript
const originalFetch = window.fetch;

window.fetch = async function() {
    const url = arguments[0];
    const options = arguments[1];

    // Pre-request hook
    if (url.includes('/some/endpoint')) {
        // Do something before request
    }

    // Execute original fetch
    const response = await originalFetch.apply(this, arguments);

    // Post-response hook
    if (url.includes('/some/endpoint')) {
        const clone = response.clone();
        const data = await clone.json();
        // Process response data
    }

    return response;
};
```

### RebelShip Menu System

Scripts share a common menu system for settings access:

```javascript
function getOrCreateRebelShipMenu() {
    let menu = document.getElementById('rebelship-menu');
    if (menu) return menu.querySelector('.rebelship-dropdown');
    // Create new menu...
}

function addMenuItem(label, onClick) {
    const dropdown = getOrCreateRebelShipMenu();
    // Add menu item...
}
```

---

## Features

- **Cross-Platform**: All scripts work on both desktop and mobile browsers
- **Mobile Detection**: Scripts automatically adapt their UI for mobile screens (width < 800px)
- **Shared Mobile Row**: Mobile scripts share a common header row for compact display
- **Non-Intrusive**: Scripts integrate seamlessly with the game's existing UI
- **Background Mode**: Select scripts (yard-foreman, auto-bunker-depart, drydock_master) support background execution on Android

## Compatibility

- Tested with Shipping Manager as of January 2026
- Works with Tampermonkey, Violentmonkey, and Greasemonkey on supported browsers
- Mobile support via GeckoView-based browsers

## Disclaimer

These scripts interact with the Shipping Manager game interface. Use at your own risk. The authors are not responsible for any issues that may arise from using these scripts.

## License

MIT License - See [LICENSE](LICENSE) for details.
