# Firefish EXPLORER

A powerful, privacy-first, client-side dashboard for analyzing your investments and loans on the [Firefish.io](https://firefish.io?ref=satoshi1351) platform. 

![Firefish Explorer Dashboard](screenshot.jpg)

## 🌟 Why Firefish Explorer?
The official Firefish platform is great, but as your portfolio grows, you need advanced analytics, risk management, and market simulations. Firefish Explorer takes your raw CSV data and turns it into a professional financial dashboard—**all without your data ever leaving your computer.**

## 🔥 Key Features

- **🛡️ 100% Secure & Offline:** No backend, no databases, no tracking. The app runs entirely in your local browser. Your financial data is parsed and analyzed locally.
- **🔄 Dual-Mode (Lender & Borrower):** Automatically detects if you are lending money (Assets) or borrowing money (Liabilities) and toggles the entire UI, math, and terminology accordingly.
- **📉 Market Simulation (Stress Test):** A real-time slider to simulate Bitcoin price drops (up to -70%). Instantly see which loans hit Margin Call 1 or liquidation limits.
- **🤖 Smart AI Analyst:** Contextual alerts that warn you about high concentration risks, upcoming liquidations, and required safety margins.
- **📊 Advanced Visualizations:** Interactive charts for Cashflow, Liquidation Distances, Interest Rate distributions, and TOP Counterparties.
- **🧮 Built-in Simulator:** Plan new investments or loans and see how they impact your overall portfolio risk before executing them.
- **🌍 Multi-language:** Auto-detects your browser language (Currently supports English and Slovak).
- **🌓 Dark/Light Mode:** Because staring at numbers should be easy on the eyes.

## 🚀 How to Use (Quick Start)

You don't need to install anything or set up a server.

1. **Download the project** (Clone the repo or download as ZIP).
2. **Open `index.html`** directly in your modern web browser (Chrome, Edge, Firefox, Safari).
3. **Export your data:** Go to your Firefish account and export your loans/investments as a `.csv` file.
4. **Upload:** Drop the `.csv` file into the Explorer. 
5. *Enjoy your insights!*

## 🛠️ Tech Stack
- Vanilla JavaScript (ES6+)
- HTML5 & CSS3
- [Bootstrap 5.3](https://getbootstrap.com/) for responsive UI
- [Chart.js](https://www.chartjs.org/) for beautiful data visualization
- [PapaParse](https://www.papaparse.com/) for fast, local CSV parsing
- Binance Public API (only used to fetch the live BTC price)

## 🧡 Support the Project
This tool is open-source and free to use. If it helped you manage your portfolio, prevent a liquidation, or just saved you time, consider buying me a coffee (in sats)! You can find the **Lightning** and **On-Chain** donation addresses directly in the footer of the application.

*Created by [@satoshi1351](https://github.com/satoshi1351)*

---
**Disclaimer:** *This project is a community-built tool and is not officially affiliated with, maintained by, or endorsed by Firefish.io. Always verify your numbers. Use at your own risk.*