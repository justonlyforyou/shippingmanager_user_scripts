# Shipping Manager User Scripts

A collection of user scripts for [Shipping Manager](https://shippingmanager.cc/) that fix game bugs the developers won't address and add quality-of-life features.

## Installation

### Recommended: RebelShip Browser

The easiest way to use these scripts is with **RebelShip Browser**, which has all scripts pre-installed:

- **Desktop**: [RebelShip Browser](https://github.com/justonlyforyou/RebelShipBrowser)
- **Mobile**: [RebelShip Browser Mobile](https://github.com/AstroNik/RebelShipBrowser_Mobile)

### Manual Installation (Browser Extensions)

> **Note**: Chrome no longer supports userscript managers due to Manifest V3 restrictions. Use Firefox or a Chromium-based browser that still supports Manifest V2.

1. Install a userscript manager extension:
   - [Tampermonkey](https://www.tampermonkey.net/) (Firefox, Edge, Safari)
   - [Violentmonkey](https://violentmonkey.github.io/) (Firefox, Edge)
   - [Greasemonkey](https://www.greasespot.net/) (Firefox)

2. Click on any `.user.js` file in this repository and click "Raw" to install

## Scripts

### Gameplay Enhancements

| Script | Description |
|--------|-------------|
| **vessel-cart.user.js** | Shopping cart for vessels - bookmark ships, compare prices, bulk purchase |
| **buy-vip-vessel.user.js** | Purchase VIP vessels directly - a feature not available in the base game |
| **forecast-calendar.user.js** | Visual calendar showing cargo demand forecasts and market predictions |
| **bunker-price-display.user.js** | Shows fuel and CO2 prices directly in the interface |
| **reputation-display.user.js** | Displays your current reputation score in the header |
| **map-unlock.user.js** | Unlocks additional map features and navigation options |

### Automation

| Script | Description |
|--------|-------------|
| **auto-buy-fuel-co2.user.js** | Auto-buy fuel and CO2 with 3 modes: Basic (price threshold), Intelligent (calculates vessel needs), Emergency (low bunker override) |
| **auto-depart.user.js** | Automatically departs vessels when ready |
| **depart-all-loop.user.js** | Continuously departs all ready vessels in a loop |

### Data Export

| Script | Description |
|--------|-------------|
| **export-vessels-csv.user.js** | Export your fleet data to CSV format |
| **export-messages.user.js** | Export chat messages and conversations |
| **save-vessel-history.user.js** | Tracks and saves vessel purchase/sale history |

### Bug Fixes

| Script | Description |
|--------|-------------|
| **fix-alliance-member-exclude.user.js** | Fixes broken exclude buttons for CEO and adds missing ones for regular members |
| **fix-alliance-edit-buttons.user.js** | Adds missing edit buttons for alliance name/description for interim_ceo |

## Script Header Format

All scripts must include a UserScript metadata block at the top of the file. This block is parsed by userscript managers and the RebelShip Browser to determine script properties.

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
| `@match` | Yes | URL pattern where script runs. Use `https://shippingmanager.cc/*` |
| `@namespace` | No | Optional namespace URL |
| `@grant` | No | Permissions needed. Use `none` for standard scripts |
| `@run-at` | No | When to inject: `document-start`, `document-end` (default), `document-idle` |
| `@enabled` | No | Default state: `true` or `false`. Scripts default to disabled |

### Order Guidelines

Scripts are loaded and displayed in order from lowest to highest. Use these ranges:

| Range | Category | Examples |
|-------|----------|----------|
| 10-19 | Core/Early | map-unlock (10) |
| 20-29 | Automation | auto-buy-fuel-co2 (20), auto-depart (21) |
| 30-39 | Bug Fixes | fix-alliance-edit-buttons (30) |
| 50-59 | Export Tools | export-messages (52) |

### Where Headers Are Used

1. **RebelShip Browser (Desktop/Mobile)**: Parses headers to display script info, enable/disable toggles, and determine load order
2. **Tampermonkey/Violentmonkey**: Standard userscript managers parse these headers
3. **Android Background Worker**: Uses headers to determine which scripts to run in background mode
4. **Script Update Service**: Compares `@version` to detect available updates from GitHub

## Features

- **Cross-Platform**: All scripts work on both desktop and mobile browsers
- **Mobile Detection**: Scripts automatically adapt their UI for mobile screens (width < 800px)
- **Shared Mobile Row**: Mobile scripts share a common header row for compact display
- **Non-Intrusive**: Scripts integrate seamlessly with the game's existing UI

## Compatibility

- Tested with Shipping Manager as of December 2025
- Works with Tampermonkey, Violentmonkey, and Greasemonkey on supported browsers
- Mobile support via GeckoView-based browsers

## Disclaimer

These scripts interact with the Shipping Manager game interface. Use at your own risk. The authors are not responsible for any issues that may arise from using these scripts.

## License

MIT License - See [LICENSE](LICENSE) for details.
