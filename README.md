# Shipping Manager User Scripts - User Manual

A collection of user scripts for [Shipping Manager](https://shippingmanager.cc/) that fix game bugs and add quality-of-life features.

---

## Table of Contents

1. [Installation](#installation)
2. [Scripts Overview](#scripts-overview)
3. [Detailed Documentation](#detailed-documentation)
   - [Depart Manager](#departmanageruserjs---depart-manager)
   - [Yard Foreman (Auto Repair)](#yard-foremanuserjs---auto-repair)
   - [Auto Happy Staff](#auto_happy_stuffuserjs---auto-happy-staff)
   - [Co-Op Tickets Display](#coop-tickets-displayuserjs---auto-co-op)
   - [Reputation Display](#reputation-displayuserjs---auto-reputation)
   - [Fleet Manager](#fleet-manageruserjs---mass-moorresume)
   - [Vessel Shopping Cart](#vessel-cartuserjs---vessel-shopping-cart)
   - [Bunker Price Display](#bunker-price-displayuserjs---bunker-prices)
   - [Forecast Calendar](#forecast-calendaruserjs---forecast-calendar)
   - [Distance Filter](#enable-distance-filteruserjs---distance-filter)
   - [Map Unlock](#map-unlockuserjs---premium-features)
   - [Fast Delivery](#fast-deliveryuserjs---fast-delivery)
   - [Depart All Loop](#depart-all-loopuserjs---depart-all-loop)
   - [Alliance Chat Notification](#alliance-chat-notificationuserjs---chat-notification)
   - [Alliance Search](#alliance-searchuserjs---alliance-search)
   - [Export Scripts](#export-scripts)
   - [Bug Fix Scripts](#bug-fix-scripts)
   - [Admin View](#admin-viewuserjs---admin-view)
4. [Technical Details](#technical-details)
5. [Background Execution (Android)](#background-execution-android)

---

## Installation

### Recommended: RebelShip Browser

The easiest way is using **RebelShip Browser** with pre-installed scripts:

- **Desktop**: [RebelShip Browser](https://github.com/justonlyforyou/RebelShipBrowser)
- **Mobile**: [RebelShip Browser Mobile](https://github.com/AstroNik/RebelShipBrowser_Mobile)

These browsers are optimized for the scripts, especially for background tasks.

### Manual Installation (Browser Extensions)

> **Note**: Chrome no longer supports userscript managers (Manifest V3). Use Firefox or a Chromium browser with Manifest V2 support.

1. Install a userscript manager extension:
   - [Tampermonkey](https://www.tampermonkey.net/) (Firefox, Edge, Safari)
   - [Violentmonkey](https://violentmonkey.github.io/) (Firefox, Edge)
   - [Greasemonkey](https://www.greasespot.net/) (Firefox)

2. Click on a `.user.js` file and then "Raw" to install

---

## Scripts Overview

| Script | Version | Description |
|--------|---------|-------------|
| departmanager.user.js | 2.46 | Unified: Auto-Bunker, Auto-Depart, Smuggler's Eye, Drydock Protection, Route Settings |
| yard-foreman.user.js | 2.10 | Auto-repair at wear threshold |
| auto_happy_stuff.user.js | 1.9 | Auto salary adjustment for crew/management morale |
| coop-tickets-display.user.js | 5.10 | Co-Op display in header, Auto-COOP sending |
| reputation-display.user.js | 5.7 | Reputation in header, auto campaign renewal |
| fleet-manager.user.js | 4.2 | Mass Moor/Resume with checkboxes |
| vessel-cart.user.js | 4.13 | Shopping cart for vessel purchase/build |
| bunker-price-display.user.js | 3.13 | Fuel/CO2 prices and fill level in header |
| forecast-calendar.user.js | 3.10 | Page-flip calendar with price forecasts |
| enable-distance-filter.user.js | 8.1 | Filter ports by distance |
| map-unlock.user.js | 1.3 | Premium Map Themes, Tanker Ops, Metropolis, Zoom |
| fast-delivery.user.js | 1.6 | Fast vessel delivery via drydock bug |
| depart-all-loop.user.js | 2.4 | Clicks Depart All until all departed |
| alliance-chat-notification.user.js | 2.6 | Red dot for unread alliance messages |
| alliance-search.user.js | 3.7 | Search all open alliances |
| demand-summary.user.js | 4.11 | Port demand with capacity overview |
| harbor-improvements.user.js | 2.5 | Details button repositioning in harbor menu |
| at-port-refresh.user.js | 1.2 | Auto-refresh At Port list every 30 sec |
| buy-vip-vessel.user.js | 2.4 | Buy VIP vessels |
| export-vessels-csv.user.js | 1.9 | Export fleet as CSV |
| export-messages.user.js | 1.9 | Export messages as CSV/JSON |
| save-vessel-history.user.js | 3.1 | Save vessel history as CSV |
| fix-alliance-member-exclude.user.js | 1.4 | Fix exclude buttons for CEO |
| fix-alliance-edit-buttons.user.js | 1.3 | Add edit buttons for Interim CEO |
| admin-view.user.js | 8.5 | Shows Admin UI (visual only, no permissions) |

---

## Detailed Documentation

---

### departmanager.user.js - Depart Manager

**Version:** 2.46 | **Background Job:** Yes

The main automation script combining several older scripts, providing comprehensive departure and route management.

#### Accessing Settings

Click the **ship icon** (RebelShip Menu) in the header, then select **"Depart Manager"**.

#### Features and Settings

##### 1. Auto Bunker Refill (Fuel & CO2)

Automatically purchases Fuel and CO2 based on price thresholds. Fuel and CO2 have separate independent settings.

**Modes Explained:**

| Mode | Behavior |
|------|----------|
| **Off** | No automatic purchasing |
| **Basic** | Fills bunker to 100% when price <= Basic Threshold |
| **Intelligent** | Extends Basic with additional logic for higher prices |

**How Modes Work Together:**

```
Price <= Basic Threshold?
    YES -> Fill bunker to 100% (applies to both Basic AND Intelligent)
    NO -> Is Intelligent enabled?
        NO -> Don't buy anything
        YES -> Price <= Intelligent Max Price?
            NO -> Don't buy anything
            YES -> Additional conditions met? (Bunker below X, Ships at port)
                NO -> Don't buy anything
                YES -> Buy only shortfall (what's needed for departures)
```

**Basic Mode Settings:**

| Setting | Description | Default |
|---------|-------------|---------|
| Basic Threshold | Price at which bunker gets filled to 100% | Fuel: $500, CO2: $10 |
| Min Cash | Minimum cash to always keep | $1,000,000 |

**Intelligent Mode Settings** (in addition to Basic):

| Setting | Description | Default |
|---------|-------------|---------|
| Intelligent Max Price | Maximum price for shortfall purchases | Fuel: $600, CO2: $12 |
| Only if bunker below X tons | Only buy when bunker is below this value | Disabled |
| Only if X ships at port | Only buy when at least X ships are at port | Disabled |

**Example Fuel:**
- Basic Threshold: $500
- Intelligent Max Price: $600
- Current Price: $550

Result: Basic doesn't fill (550 > 500). Intelligent buys only the shortfall for pending departures (550 <= 600).

**Depart-Loop Behavior:**

The script works in a loop: Buy -> Depart -> Buy -> Depart...

1. **Before each departure:** If bunker insufficient for the vessel:
   - Basic/Intelligent: Buys shortfall if price is within allowed range
2. **After all departures (Final Fill):**
   - If price <= Basic Threshold: Fills bunker to 100%
   - If price > Basic Threshold: No automatic refill

**Avoid Negative CO2** (Intelligent Mode only):

| Setting | Description |
|---------|-------------|
| Avoid Negative CO2 | Maintains 100t CO2 buffer after departures |

When enabled and CO2 falls below 100t after departures:
- If price <= Intelligent Max Price: Refills to 100t (not 100%!)
- Important for Vessel Utilization as negative CO2 affects the Green Marketing Campaign bonus

##### 2. Auto-Depart

Automatically departs vessels when conditions are met.

| Setting | Description | Default |
|---------|-------------|---------|
| Auto-Depart | Enables automatic departures | Off |

**Which Vessels Are Considered:**
- Status = "port" (at port)
- Not moored (is_parked = false)
- Has an assigned route (route_destination exists)

**Departure Order:**

Vessels are sorted by fuel requirement (highest first). This ensures large vessels depart first while there's still enough fuel.

**Process Per Vessel:**

```
1. Calculate required Fuel and CO2 for the route
2. Check: Is there enough Fuel in bunker?
   NO -> Attempt to buy Fuel:
         - If Fuel Mode != off AND price within allowed range:
           Buy shortfall + 100t buffer
         - Check again: Enough Fuel?
           NO -> Vessel is skipped (message in log)
           YES -> Continue to step 3
   YES -> Continue to step 3
3. Check: Is there enough CO2 in bunker?
   NO -> Attempt to buy CO2 (same logic as Fuel)
4. Depart vessel
5. 300ms pause before next vessel
```

**What Happens With Insufficient Bunker:**

| Situation | Behavior |
|-----------|----------|
| Fuel Mode = off | Vessel is skipped if bunker insufficient |
| Fuel Mode = basic, Price > Threshold | Vessel is skipped |
| Fuel Mode = basic, Price <= Threshold | Buys shortfall, then departs |
| Fuel Mode = intelligent, Price > Intel Max | Vessel is skipped |
| Fuel Mode = intelligent, Price <= Intel Max | Buys shortfall, then departs |

**After All Departures:**

1. **Avoid Negative CO2** (if enabled): Refills CO2 to 100t buffer
2. **Final Fill** (if price <= Basic Threshold): Fills bunker to 100%

**Manual vs Automatic Mode:**

- **Manual** (button click): Shows error messages and skipped vessels as notifications
- **Automatic** (background): Only logs to console, no disruptive popups

##### 3. Smuggler's Eye

Automatic price optimization system.

| Setting | Description | Default |
|---------|-------------|---------|
| Smuggler's Eye enabled | Enables the feature | Off |
| Instant 4% Markup | Sets prices to 4% above auto-price when creating routes | On |
| Gradual Increase | Slowly increases prices to target | On |
| Step Size | Increase per step | 1% |
| Interval | Time between increases | 25 hours |
| Target Percent | Maximum price target | 8% |
| Max Guards on Pirate Routes | Sets guards to 10 on routes with hijacking risk > 0% | On |

**How It Works:**
- For enroute vessels: Changes are saved as "pending" and applied at next departure
- For port vessels: Changes are applied immediately via API

##### 4. Drydock Bug Prevention

Fixes the game bug where route settings (speed, guards, cargo prices) are lost when a vessel is sent to drydock.

**How It Works:**
1. Intercepts drydock requests via Fetch API
2. Saves all route settings before drydock starts
3. Tracks vessel status through drydock lifecycle
4. Automatically restores settings when vessel returns to port

##### 5. Route Settings Tab

Adds a **Settings** tab to the Routes modal allowing editing for **ALL vessels** (including enroute).

**Columns in Settings Tab:**
| Column | Meaning |
|--------|---------|
| Status | P=Port, E=Enroute, A=Anchored, MP=Moored Port, ME=Moored Enroute |
| Route | Origin and destination |
| Vessel | Vessel name |
| Speed | Speed (editable) |
| Prices | Cargo prices (editable) |
| Guards | Number of guards (editable) |
| Risk | Hijacking risk in % |
| Pending | Pending values (shown in purple) |

##### 6. UI Features

- **Auto-Expand Advanced**: Automatically expands "Advanced" sections in route modals
- **Price Difference Badges**: Shows % difference from auto-price next to cargo prices
  - Green = above auto-price
  - Red = below auto-price

##### 7. System Notifications

| Setting | Description | Default |
|---------|-------------|---------|
| System Notifications | Push notifications for actions | Off |

---

### yard-foreman.user.js - Auto Repair

**Version:** 2.10 | **Background Job:** Yes

Automatically repairs vessels when their wear reaches a threshold.

#### Accessing Settings

RebelShip Menu > **"Auto Repair"**

#### Settings

| Setting | Description | Default |
|---------|-------------|---------|
| Enabled | Enables auto-repair | Off |
| Wear Threshold | Repair when wear >= X% (1-99) | 50% |
| Min Cash After Repair | Keep at least this amount | 0 |
| System Notifications | Push notifications | Off |

#### How It Works

Every 15 minutes:
1. Fetches all vessels via API
2. Filters vessels with wear >= threshold (excludes vessels in maintenance/sailing)
3. Gets repair costs
4. Checks if enough cash is available (after Min Cash deduction)
5. Executes bulk repair

---

### auto_happy_stuff.user.js - Auto Happy Staff

**Version:** 1.9 | **Background Job:** Yes

Automatically adjusts salaries to keep crew and management morale at target levels.

#### Accessing Settings

RebelShip Menu > **"Auto Happy Staff"**

#### Settings

| Setting | Description | Default |
|---------|-------------|---------|
| Enabled | Enables auto-adjustment | Off |
| Target Crew Morale | Target morale for crew | Configurable |
| Target Management Morale | Target morale for management | Configurable |
| System Notifications | Push notifications | Off |

#### Affected Positions

**Crew:** Captain, First Officer, Boatswain, Technical Officer
**Management:** CFO, COO, CMO, CTO

---

### coop-tickets-display.user.js - Auto Co-Op

**Version:** 5.10 | **Background Job:** Yes

Shows Co-Op tickets in header and automatically sends COOP vessels to alliance members.

#### Header Display

Next to other header elements, a 2-line display appears:
- Line 1: "CO-OP"
- Line 2: available/maximum

Click opens the Alliance Co-Op tab.

#### Accessing Settings

Click on the Co-Op display in the header.

#### Settings

| Setting | Description | Default |
|---------|-------------|---------|
| Auto-Send Enabled | Automatically sends COOP vessels | Off |
| System Notifications | Push notifications | Off |

#### Auto-COOP Logic

Sends COOP vessels to members who:
- Have at least one vessel
- Have low fuel (< 10t)
- Allow COOP in their settings

---

### reputation-display.user.js - Auto Reputation

**Version:** 5.7

Shows reputation in header and automatically renews expired marketing campaigns.

#### Header Display

Shows the current reputation value in the game header.

#### Accessing Settings

Click on the reputation display in the header.

#### Settings

| Setting | Description | Default |
|---------|-------------|---------|
| Auto Renewal Enabled | Renews expired campaigns | Off |
| Min Cash | Minimum cash to keep | 0 |
| System Notifications | Push notifications | Off |

---

### fleet-manager.user.js - Mass Moor/Resume

**Version:** 4.2

Adds checkboxes to vessel lists for mass mooring and resuming.

#### Where to Find

Checkboxes appear in vessel lists:
- At Port Tab
- At Sea Tab
- Anchored Tab

#### Controls

| Element | Function |
|---------|----------|
| Checkbox | Select individual vessel |
| All Button | Select all vessels |
| None Button | Deselect all |
| Moor Button | Moor all selected vessels |
| Resume Button | Resume all selected moored vessels |

---

### vessel-cart.user.js - Vessel Shopping Cart

**Version:** 4.13

Shopping cart functionality for vessel purchase and building.

#### Where to Find

- **Cart Button**: In header next to RebelShip Menu (shows item count)
- **Add to Cart Button**: Appears next to Order button in vessel/build modals

#### Functions

| Function | Description |
|----------|-------------|
| Add to Cart | Adds vessel/configuration to cart |
| Cart Badge | Shows total item count in header |
| Build Support | Saves complete build configuration (engine, capacity, propeller, etc.) |
| Per-Ship Customization | Configure name and shipyard for each vessel individually |
| +/- Buttons | Adjust quantities |
| Bulk Checkout | Purchases/builds all items sequentially |

---

### bunker-price-display.user.js - Bunker Prices

**Version:** 3.13

Shows current fuel and CO2 prices with fill levels in header.

#### Header Display

Replaces standard bunker display with 3-line format:

**Fuel Block:**
- Line 1: "Fuel"
- Line 2: Fill level in %
- Line 3: Current price

**CO2 Block:**
- Line 1: "CO2"
- Line 2: Fill level in %
- Line 3: Current price

#### Color Coding

**Fuel Prices:**
| Price | Color |
|-------|-------|
| > 750 | Red |
| 650-750 | Orange |
| 500-650 | Blue |
| < 500 | Green |

**CO2 Prices:**
| Price | Color |
|-------|-------|
| >= 20 | Red |
| 15-20 | Orange |
| 10-15 | Blue |
| < 10 | Green |

**Fill Level:**
- <= 30%: Red
- > 30%: Green

---

### forecast-calendar.user.js - Forecast Calendar

**Version:** 3.10

Visual page-flip calendar with cargo demand forecasts.

#### Access

RebelShip Menu > **"Forecast Calendar"**

#### Features

| Feature | Description |
|---------|-------------|
| Page-Flip Animation | Realistic book navigation |
| 24-Hour Forecast | Shows Fuel/CO2 prices for each 30-min interval |
| Color Coding | Green/Blue/Orange/Red based on price quality |
| Current Hour Highlight | Green highlight on current time slot |
| Timezone Conversion | Converts CEST forecast data to local timezone |

#### Color Coding (same as Bunker Price Display)

---

### enable-distance-filter.user.js - Distance Filter

**Version:** 8.1

Filters destination ports by distance when creating new routes.

#### Where to Find

In the **Create Route Popup** a dropdown for distance filtering appears.

#### Available Ranges

| Filter | Distance |
|--------|----------|
| All | All ports |
| < 1000 nm | Under 1000 nautical miles |
| 1k-3k nm | 1000-3000 nautical miles |
| 3k-6k nm | 3000-6000 nautical miles |
| 6k-10k nm | 6000-10000 nautical miles |
| > 10k nm | Over 10000 nautical miles |

---

### map-unlock.user.js - Premium Features

**Version:** 1.3

Unlocks premium features for all players.

#### Unlocked Features

- Premium Map Themes
- Tanker Operations
- Metropolis Mode
- Extended Zoom

---

### fast-delivery.user.js - Fast Delivery

**Version:** 1.6

Uses a game bug to reduce vessel delivery time from days to 60 minutes.

#### How It Works

When a vessel is built, it has a delivery time of several days. If the pending vessel is immediately sent to drydock (Minor Maintenance), the delivery time is replaced by drydock duration (60 min at minimum speed).

#### Usage

The script automatically adds a "Fast Delivery" button to pending vessels.

---

### depart-all-loop.user.js - Depart All Loop

**Version:** 2.4

Repeatedly clicks the "Depart All" button until all vessels have departed.

#### Usage

Adds a "Loop Depart" button next to the normal "Depart All".

---

### alliance-chat-notification.user.js - Chat Notification

**Version:** 2.6

Shows a red dot on the Alliance button when there are unread messages.

#### Display

A small red dot appears on the Alliance button in the game header.

---

### alliance-search.user.js - Alliance Search

**Version:** 3.7

Allows searching through all open alliances.

#### Access

RebelShip Menu > **"Alliance Search"**

#### Features

- Search all open alliances by name
- Shows alliance details
- Results are cached for faster searches

---

### Export Scripts

#### export-vessels-csv.user.js - Fleet Export

**Version:** 1.9

Exports all vessels with details as CSV.

**Access:** RebelShip Menu > **"Export Vessels"**

#### export-messages.user.js - Messages Export

**Version:** 1.9

Exports all messenger conversations as CSV or JSON.

**Access:** RebelShip Menu > **"Export Messages"**

#### save-vessel-history.user.js - Vessel History

**Version:** 3.1

Detects vessel history API calls and offers CSV download.

---

### Bug Fix Scripts

#### fix-alliance-member-exclude.user.js

**Version:** 1.4

Fixes broken exclude buttons for CEO and adds missing ones for management members.

#### fix-alliance-edit-buttons.user.js

**Version:** 1.3

Adds missing edit buttons for alliance name/description for interim_ceo.

---

### admin-view.user.js - Admin View

**Version:** 8.5

Shows Admin/Moderator UI elements.

**IMPORTANT:** This is VISUAL ONLY! The script does NOT grant any admin permissions or functions. It only shows what the admin interface looks like.

---

## Technical Details

### Pinia Store Access

Scripts access game state via Vue's Pinia stores:

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

Scripts that intercept API calls:

```javascript
const originalFetch = window.fetch;

window.fetch = async function() {
    const url = arguments[0];

    // Pre-request hook
    if (url.includes('/some/endpoint')) {
        // Before request
    }

    const response = await originalFetch.apply(this, arguments);

    // Post-response hook
    if (url.includes('/some/endpoint')) {
        const clone = response.clone();
        const data = await clone.json();
        // Process response
    }

    return response;
};
```

### RebelShip Menu System

Scripts share a common menu system. The menu appears before the messaging icon in the header.

---

## Background Execution (Android)

The following scripts support background execution on Android via RebelShip Browser Mobile:

| Script | Background Function |
|--------|---------------------|
| departmanager.user.js | Auto-Bunker purchase, Auto-Depart, Smuggler's Eye |
| yard-foreman.user.js | Auto-Repair |
| auto_happy_stuff.user.js | Auto salary adjustment |
| coop-tickets-display.user.js | Auto-COOP sending |

These scripts have `@background-job-required true` in their header and sync their settings with the Android app via `RebelShipBridge`.

---

## Compatibility

- Tested with Shipping Manager as of January 2026
- Works with Tampermonkey, Violentmonkey and Greasemonkey
- Mobile support via GeckoView-based browsers

## Disclaimer

These scripts interact with the Shipping Manager game interface. Use at your own risk.

## License

MIT License - See [LICENSE](LICENSE) for details.
