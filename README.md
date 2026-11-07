# Fz Cerberus

Build "Project Cerberus" — an Institutional Market Maker & Delta-Neutral Hedging Terminal.

Features:

1. Canvas Heatmap: 60 FPS HTML5 2D canvas with Emerald Green passive liquidity depth (#052e16 to #10b981) and Crimson Red market maker overlays (#ef4444).

2. Live WebSocket Feeds: Direct sub-100ms streams for Binance Spot (BTCUSDT depth + aggTrade) and Binance USD-M Perpetual Futures.

3. Market Maker Surveillance (Citadel/Wintermute/Jump):

   - Cross-venue Echo Matcher: Detects Spot maker fills paired with Perp taker hedges within 10-50ms.

   - Avellaneda-Stoikov Inventory Skew Inversion: Calculates whether MMs are holding hot long or short inventory.

   - Toxic Retreat Detector: Flags when >5 BTC depth is pulled in <5ms before a market trade.

4. Algorithmic MM Bot (Jane Street / Jump Trading):

   - Avellaneda-Stoikov two-sided quoting with inventory skew.

   - Zero-delta instantaneous flash hedging on Perp futures (Net Delta = 0.00 BTC).

   - High-Sharpe, smooth upward-sloping paper Equity Curve tracking spread capture and basis harvest.

5. Visual Canvas Overlays:

   - Pulsing Crimson Echo Arcs bridging Spot to Perp fills with latency tags.

   - Dynamic Skew Ribbon and Toxic Retreat Ghost boxes.

6. Institutional HUD & UK MAR Art. 12 Compliance Audit Ledger.

This project was built with [Lovable](https://lovable.dev).

**Live app**: https://fz-cerberus.lovable.app

## Build with Lovable

Continue developing this project in the [Lovable editor](https://lovable.dev/projects/d061205f-8696-479e-9575-db031d288773).

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: every change made in Lovable is committed straight to this repository.
- **Full ownership**: this code is yours. Push to `main` on GitHub and your changes sync back into Lovable, ready for your next prompt.

## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```
