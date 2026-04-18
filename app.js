// --- KONŠTANTY PRE RIZIKO ---
const RISK_THRESHOLDS = {
    LTV_HIGH: 73,       // Zmenené zo 70 na 73 (Margin Call 1)
    LTV_MEDIUM: 40,
    DIST_CRITICAL: 9.5, // Približná vzdialenosť k likvidácii pri LTV 86%
    DIST_WARNING: 23.2, // Približná vzdialenosť k likvidácii pri LTV 73%
    CONCENTRATION_WARN: 25, 
    CONCENTRATION_CRITICAL: 35,
    PORTFOLIO_RISK_WARN: 20, 
    PORTFOLIO_RISK_CRITICAL: 30
};

const CURRENCY_SYMBOLS = {
    EUR: '€', USDC: 'USDC', USDT: 'USDT', CHF: 'CHF', CZK: 'Kč', PLN: 'zł'
};

const state = {
    rawData: [], displayData: [], currentBtcPrice: 0,
    charts: {}, sortCol: 'endDate', sortAsc: true,
    totalInvestedForTooltip: 0, myId: null, currentRoleView: 'investor',
    currency: 'EUR', currencySymbol: '€', hasImportedData: false,
    exchangeRates: null
};

Chart.register(window['chartjs-plugin-annotation']);

// --- PREKLADY (i18n) LOGIKA ---
const userLang = (navigator.language || navigator.userLanguage).split('-')[0];
const currentLang = translations[userLang] ? userLang : 'en';

function t(key) {
    return translations[currentLang][key] || key;
}

function translateStaticDOM() {
    document.querySelectorAll('[data-i18n]').forEach(el => {
        const key = el.getAttribute('data-i18n');
        if (translations[currentLang][key]) {
            el.innerHTML = translations[currentLang][key];
        }
    });
    if (document.title && document.querySelector('title[data-i18n]')) {
        document.title = t(document.querySelector('title[data-i18n]').getAttribute('data-i18n'));
    }
}
// ------------------------------

const parseNum = (val) => {
    if (!val) return 0;
    const cleaned = val.toString().replace(/\s/g, '').replace(',', '.');
    const num = Number(cleaned);
    return isNaN(num) ? 0 : num;
};

const convertCurrency = (amount, fromCurr, toCurr) => {
    if (fromCurr === toCurr || !state.exchangeRates) return amount;
    const fromApi = (fromCurr === 'USDT' || fromCurr === 'USDC') ? 'USD' : fromCurr;
    const toApi = (toCurr === 'USDT' || toCurr === 'USDC') ? 'USD' : toCurr;
    const rateFrom = parseFloat(state.exchangeRates[fromApi]);
    const rateTo = parseFloat(state.exchangeRates[toApi]);
    if (!rateFrom || !rateTo) return amount;
    return amount * (rateTo / rateFrom);
};

const sunIcon = document.getElementById('themeSwitchSun');
const moonIcon = document.getElementById('themeSwitchMoon');

const getPreferredTheme = () => {
    const storedTheme = localStorage.getItem('theme');
    if (storedTheme) { return storedTheme; }
    return 'dark'; 
}

const setTheme = (theme) => {
    document.documentElement.setAttribute('data-bs-theme', theme);
    localStorage.setItem('theme', theme);
}

setTheme(getPreferredTheme());

sunIcon.addEventListener('click', () => {
    setTheme('light');
    if (!document.getElementById('dashboard').classList.contains('d-none')) { renderCharts(); }
});

moonIcon.addEventListener('click', () => {
    setTheme('dark');
    if (!document.getElementById('dashboard').classList.contains('d-none')) { renderCharts(); }
});

const getDom = () => ({
    stressSlider: document.getElementById('stressSlider'),
    statusFilter: document.getElementById('statusFilter'),
    stressModeBadge: document.getElementById('stressModeBadge')
});

// --- NOVÁ LOGIKA PRE CENU BTC CEZ COINBASE API ---
async function fetchBtcPrice() {
    const priceLabel = document.getElementById('btcPriceLabel');
    try {
        const response = await fetch(`https://api.coinbase.com/v2/exchange-rates?currency=BTC`);
        const json = await response.json();
        
        state.exchangeRates = json.data.rates;
        localStorage.setItem(`firefish_exchange_rates`, JSON.stringify(state.exchangeRates));

        let apiCurrency = state.currency;
        if (apiCurrency === 'USDC' || apiCurrency === 'USDT') {
            apiCurrency = 'USD';
        }
        
        state.currentBtcPrice = parseFloat(state.exchangeRates[apiCurrency]);
        localStorage.setItem(`lastBtcPrice_${state.currency}`, state.currentBtcPrice);
        
        const now = new Date();
        const timeString = now.toLocaleTimeString(currentLang === 'sk' ? 'sk-SK' : 'en-US');
        priceLabel.innerHTML = `${t('price_live')} <strong>${state.currentBtcPrice.toLocaleString('sk-SK', {maximumFractionDigits: 2})} ${state.currencySymbol}</strong> (${t('price_upd')} ${timeString})`;
    } catch (error) {
        const savedRates = localStorage.getItem(`firefish_exchange_rates`);
        if (savedRates) {
            try { state.exchangeRates = JSON.parse(savedRates); } catch(e) {}
        }

        const savedPrice = localStorage.getItem(`lastBtcPrice_${state.currency}`);
        state.currentBtcPrice = savedPrice ? parseFloat(savedPrice) : (state.currency === 'EUR' ? 60000 : 0);
        priceLabel.innerHTML = `${t('price_err')} <strong>${state.currentBtcPrice.toLocaleString('sk-SK', {maximumFractionDigits: 2})} ${state.currencySymbol}</strong>`;
    }
}

function recalculateBaseData() {
    state.rawData.forEach(d => {
        const collateralValue = d.collateralBtc * state.currentBtcPrice;
        d.ltv = collateralValue > 0 ? (d.due / collateralValue) * 100 : 0;
        
        if (d.isActive && d.liquidationPrice > 0 && state.currentBtcPrice > 0) {
            d.distancePct = ((state.currentBtcPrice - d.liquidationPrice) / state.currentBtcPrice) * 100;
        } else {
            d.distancePct = 0;
        }
    });
}

function refreshDashboard() {
    if (state.rawData.length === 0) return;

    const dom = getDom();
    const filter = dom.statusFilter.value;
    const stressPct = parseInt(dom.stressSlider.value);
    const role = state.currentRoleView;

    let filteredData = state.rawData.filter(d => 
        (filter === 'ALL' || d.status === filter) && d.role === role
    );

    if (stressPct < 0) {
        const stressedBtcPrice = state.currentBtcPrice * (1 + stressPct / 100);
        filteredData = filteredData.map(d => {
            if (!d.isActive || d.collateralBtc <= 0) return { ...d };
            if (stressedBtcPrice <= 0) return { ...d, ltv: 0, distancePct: 0 };
            
            const stressedCollateralValue = d.collateralBtc * stressedBtcPrice;
            const stressedLtv = stressedCollateralValue > 0 ? (d.due / stressedCollateralValue) * 100 : 0;
            const stressedDistance = d.liquidationPrice > 0
                ? ((stressedBtcPrice - d.liquidationPrice) / stressedBtcPrice) * 100
                : 0;
            return { ...d, ltv: stressedLtv, distancePct: stressedDistance };
        });
    }

    state.displayData = filteredData;
    
    sortDisplayData();
    updateDynamicLabels(); 
    const metrics = calculateMetrics(state.displayData);
    updateKPIs(metrics);
    updateAIInsight(metrics);
    renderCharts();
    renderTable();
}

setInterval(async () => {
    await fetchBtcPrice();
    if (state.rawData && state.rawData.length > 0) {
        recalculateBaseData();
        refreshDashboard();
    }
}, 60000);

function getMyId(data) {
    const counts = {};
    data.forEach(r => {
        const inv = r['Investor id']; const bor = r['Borrower id'];
        if(inv) counts[inv] = (counts[inv] || 0) + 1;
        if(bor) counts[bor] = (counts[bor] || 0) + 1;
    });
    let bestId = null; let maxCount = 0;
    for(let id in counts) {
        if(counts[id] > maxCount) { maxCount = counts[id]; bestId = id; }
    }
    return bestId;
}

function parseAndInitApp(csvText) {
    Papa.parse(csvText, {
        header: true, skipEmptyLines: true,
        complete: async function(results) {
            if (results.data && results.data.length > 0) {
                const firstRow = results.data[0];
                const hasAmount = ('Investment amount' in firstRow) || ('Loan amount' in firstRow);
                if (!hasAmount || !('Amount due' in firstRow) || !('Status' in firstRow)) {
                    alert(t('msg_err_csv'));
                    localStorage.removeItem('firefish_saved_csv');
                    document.getElementById('csvFileInput').value = '';
                    return; 
                }

                state.hasImportedData = true;

                if (firstRow['Currency']) {
                    const detectedCurrency = firstRow['Currency'].toUpperCase().trim();
                    const allowedCurrencies = ['EUR', 'USDC', 'USDT', 'CHF', 'CZK', 'PLN'];
                    if (allowedCurrencies.includes(detectedCurrency)) {
                        state.currency = detectedCurrency;
                        state.currencySymbol = CURRENCY_SYMBOLS[state.currency] || state.currency;
                    }
                }
            }

            state.myId = getMyId(results.data);
            await fetchBtcPrice();
            state.rawData = parseRawData(results.data);

            const savedSims = JSON.parse(localStorage.getItem('firefish_simulated_loans') || '[]');
            savedSims.forEach(s => {
                s.startDate = new Date(s.startDate);
                s.endDate = new Date(s.endDate);
                state.rawData.push(s);
            });
            
            const hasInvestments = state.rawData.some(d => d.role === 'investor');
            const hasDebts = state.rawData.some(d => d.role === 'borrower');
            
            const radioInv = document.getElementById('roleInvestor');
            const radioBor = document.getElementById('roleBorrower');
            
            radioInv.disabled = false;
            radioBor.disabled = false;

            if (hasInvestments && !hasDebts) {
                radioInv.checked = true; state.currentRoleView = 'investor';
            } else if (!hasInvestments && hasDebts) {
                radioBor.checked = true; state.currentRoleView = 'borrower';
            } else {
                radioInv.checked = true; state.currentRoleView = 'investor'; 
            }

            document.getElementById('statusFilter').disabled = false;
            document.getElementById('welcomeScreen').classList.add('d-none');
            document.getElementById('mainControlPanel').classList.remove('d-none');
            document.getElementById('btnOpenSimulation').removeAttribute('disabled');
            document.getElementById('btnOpenAnalytics').removeAttribute('disabled');
            document.getElementById('btnOpenCycle').removeAttribute('disabled');
            document.getElementById('stressPlaceholder').classList.add('d-none');
            document.getElementById('stressPanel').classList.remove('d-none');

            recalculateBaseData();
            
            const dom = getDom();
            if (dom.stressSlider) {
                dom.stressSlider.value = 0;
                updateStressUI(0); 
            }

            refreshDashboard();
            document.getElementById('dashboard').classList.remove('d-none');
        }
    });
}

// Inicializácia modálneho okna kalkulačky pred zobrazením
document.getElementById('simulationModal').addEventListener('show.bs.modal', function () {
    const currSel = document.getElementById('simCurrencySelect');
    if (currSel) {
        currSel.value = state.currency;
        currSel.disabled = state.hasImportedData || state.rawData.length > 0; 
    }
    const l1 = document.getElementById('simCurrencyLabel1');
    const l2 = document.getElementById('simCurrencyLabel2');
    if(l1) l1.innerText = state.currencySymbol;
    if(l2) l2.innerText = state.currencySymbol;

    // Aktualizácia farieb a nadpisov v modálnom okne podľa toho čo je zaškrtnuté
    const simRoleEl = document.querySelector('input[name="simRole"]:checked');
    if(simRoleEl) {
        const isInv = simRoleEl.value === 'investor';
        const titleEl = document.getElementById('lblModalTitle');
        const amtEl = document.getElementById('lblModalAmount');
        const iconEl = document.getElementById('simModalIcon');
        
        if(titleEl) titleEl.innerText = isInv ? t('dyn_plan_inv') : t('dyn_plan_bor');
        if(amtEl) amtEl.innerText = isInv ? t('dyn_amt_inv') : t('dyn_amt_bor');
        if(iconEl) iconEl.style.color = isInv ? '#20c997' : '#dc3545';
    }
});

// Zmena typu v modálnom okne (Investícia / Pôžička) dynamicky mení UI
document.querySelectorAll('input[name="simRole"]').forEach(radio => {
    radio.addEventListener('change', (e) => {
        const isInv = e.target.value === 'investor';
        const titleEl = document.getElementById('lblModalTitle');
        const amtEl = document.getElementById('lblModalAmount');
        const iconEl = document.getElementById('simModalIcon');
        
        if(titleEl) titleEl.innerText = isInv ? t('dyn_plan_inv') : t('dyn_plan_bor');
        if(amtEl) amtEl.innerText = isInv ? t('dyn_amt_inv') : t('dyn_amt_bor');
        if(iconEl) iconEl.style.color = isInv ? '#20c997' : '#dc3545';
    });
});

const simCurrSelect = document.getElementById('simCurrencySelect');
if (simCurrSelect) {
    simCurrSelect.addEventListener('change', function(e) {
        if(!state.hasImportedData) {
            const sym = CURRENCY_SYMBOLS[e.target.value] || e.target.value;
            const l1 = document.getElementById('simCurrencyLabel1');
            const l2 = document.getElementById('simCurrencyLabel2');
            if(l1) l1.innerText = sym;
            if(l2) l2.innerText = sym;
        }
    });
}

document.getElementById('csvFileInput').addEventListener('change', function(e) {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = function(event) {
        const csvText = event.target.result;
        localStorage.setItem('firefish_saved_csv', csvText);
        parseAndInitApp(csvText);
    };
    reader.readAsText(file);
});

window.addEventListener('DOMContentLoaded', async () => {
    translateStaticDOM();

   try {
        const myAddr = atob('c2F0b3NoaTEzNTFAd2FsbGV0b2ZzYXRvc2hpLmNvbQ==');
        const qrImg = document.querySelector('.qr-code-wrapper img');
        const lnInput = document.getElementById('lnAddress');
        
        if (qrImg) qrImg.src = `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${myAddr}`;
        if (lnInput) lnInput.value = myAddr;

    
        const ffUrl = atob('aHR0cHM6Ly9maXJlZmlzaC5pbz9yZWY9c2F0b3NoaTEzNTE=');
        const ffLink = document.getElementById('firefishRegLink');
        
        if (ffLink) {
            
            ffLink.addEventListener('click', function(udalost) {
                
                udalost.preventDefault(); 
                
                
                window.open(ffUrl, '_blank', 'noopener,noreferrer');
            });
        }
    } catch(e) {}
    
    
    const savedCsv = localStorage.getItem('firefish_saved_csv');
    if (savedCsv) {
        parseAndInitApp(savedCsv);
    } else {
        const savedCurrency = localStorage.getItem('firefish_simulated_currency');
        if (savedCurrency) {
            state.currency = savedCurrency;
            state.currencySymbol = CURRENCY_SYMBOLS[state.currency] || state.currency;
        }
        await fetchBtcPrice();

        const savedSims = JSON.parse(localStorage.getItem('firefish_simulated_loans') || '[]');
        if (savedSims.length > 0) {
            savedSims.forEach(s => {
                s.startDate = new Date(s.startDate);
                s.endDate = new Date(s.endDate);
                state.rawData.push(s);
            });
            
            const hasInvestments = state.rawData.some(d => d.role === 'investor');
            const hasDebts = state.rawData.some(d => d.role === 'borrower');
            
            document.getElementById('roleInvestor').disabled = false;
            document.getElementById('roleBorrower').disabled = false;
            
            if (hasInvestments && !hasDebts) {
                document.getElementById('roleInvestor').checked = true; state.currentRoleView = 'investor';
            } else if (!hasInvestments && hasDebts) {
                document.getElementById('roleBorrower').checked = true; state.currentRoleView = 'borrower';
            } else {
                document.getElementById('roleInvestor').checked = true; state.currentRoleView = 'investor'; 
            }
            
            document.getElementById('welcomeScreen').classList.add('d-none');
            document.getElementById('mainControlPanel').classList.remove('d-none');
            document.getElementById('dashboard').classList.remove('d-none');
            document.getElementById('statusFilter').disabled = false;
            
            // --- ODOMKNUTIE TLAČIDLA PLÁNOVAČA ---
            document.getElementById('btnOpenSimulation').removeAttribute('disabled');
            document.getElementById('btnOpenAnalytics').removeAttribute('disabled');
            document.getElementById('btnOpenCycle').removeAttribute('disabled'); 
            
            document.getElementById('stressPlaceholder').classList.add('d-none');
            document.getElementById('stressPanel').classList.remove('d-none');
            
            recalculateBaseData();
            refreshDashboard();
        }
    }
});

document.getElementById('statusFilter').addEventListener('change', refreshDashboard);

document.querySelectorAll('input[name="roleToggle"]').forEach(radio => {
    radio.addEventListener('change', (e) => {
        state.currentRoleView = e.target.value;
        refreshDashboard();
    });
});

document.getElementById('stressSlider').addEventListener('input', function() {
    updateStressUI(parseInt(this.value));
});

document.getElementById('stressSlider').addEventListener('change', function() {
    refreshDashboard();
});

document.querySelectorAll('th.sortable').forEach(th => {
    th.addEventListener('click', () => {
        const col = th.dataset.sort;
        if (state.sortCol === col) { state.sortAsc = !state.sortAsc; }
        else { state.sortCol = col; state.sortAsc = true; }

        document.querySelectorAll('th.sortable .sort-icon').forEach(icon => {
            icon.innerHTML = '↕'; icon.classList.remove('sort-active');
        });
        th.querySelector('.sort-icon').innerHTML = state.sortAsc ? '↑' : '↓';
        th.querySelector('.sort-icon').classList.add('sort-active');

        refreshDashboard();
    });
});

function parseSlovakDate(dateStr) {
    if (!dateStr) return null;
    const parts = dateStr.split('.');
    if (parts.length === 3) {
        const dt = new Date(parts[2].trim(), parts[1].trim() - 1, parts[0].trim());
        return isNaN(dt.getTime()) ? null : dt;
    }
    return null;
}

function parseRawData(data) {
    const today = new Date();
    const parsed = [];

    for (let row of data) {
        let invested = parseNum(row['Investment amount'] || row['Loan amount']);
        if (invested <= 0) continue;

        let due = parseNum(row['Amount due']);
        const rate = parseNum(row['Interest rate (% p.a.)']);
        const collateralBtc = parseNum(row['Collateral sum (BTC)']);
        let liquidationPrice = parseNum(row['Liquidation price']);
        const status = (row['Status'] || 'UNKNOWN').toUpperCase();

        const rowCurrency = (row['Currency'] || state.currency).toUpperCase().trim();
        if (rowCurrency !== state.currency) {
            invested = convertCurrency(invested, rowCurrency, state.currency);
            due = convertCurrency(due, rowCurrency, state.currency);
            if (liquidationPrice > 0) {
                liquidationPrice = convertCurrency(liquidationPrice, rowCurrency, state.currency);
            }
        }

        const startDate = parseSlovakDate(row['Start date (dd. mm. yyyy)']);
        const endDate = parseSlovakDate(row['Maturity date (dd. mm. yyyy)']);

        const investorId = row['Investor id'] || 'Neznámy';
        const borrowerId = row['Borrower id'] || 'Neznámy';
        const role = (investorId === state.myId) ? 'investor' : 'borrower';

        const collateralValue = collateralBtc * state.currentBtcPrice;
        const ltv = collateralValue > 0 ? (due / collateralValue) * 100 : 0;
        const profit = due - invested;
        const isClosed = status === 'CLOSED';
        const isActive = status === 'ACTIVE';

        let distancePct = 0;
        if (isActive && liquidationPrice > 0 && state.currentBtcPrice > 0) {
            distancePct = ((state.currentBtcPrice - liquidationPrice) / state.currentBtcPrice) * 100;
        }

        let annualYield = 0; let totalDays = 0;
        if (startDate && endDate) {
            totalDays = (endDate - startDate) / (1000 * 60 * 60 * 24);
            if (totalDays > 0 && invested > 0) {
                annualYield = (profit / invested) * (365 / totalDays) * 100;
            }
        }

        let progressPct = 0; let remainingDays = 0;
        if (startDate && endDate) {
            const elapsedDays = (today - startDate) / (1000 * 60 * 60 * 24);
            remainingDays = Math.ceil((endDate - today) / (1000 * 60 * 60 * 24));
            if (totalDays > 0) {
                progressPct = Math.max(0, Math.min((elapsedDays / totalDays) * 100, 100));
            }
        }
        if (isClosed) progressPct = 100;

        let cashflowMonth = null;
        if (endDate) {
            const m = (endDate.getMonth() + 1).toString().padStart(2, '0');
            cashflowMonth = `${endDate.getFullYear()}-${m}`;
        }

        parsed.push({
            id: row['Investment id'] || row['Loan id'] || 'N/A', invested, due, rate, status, profit,
            isClosed, isActive, cashflowMonth, liquidationPrice, collateralBtc, annualYield, ltv, distancePct,
            investorId, borrowerId, role, 
            startDate, endDate, progressPct, remainingDays,
            rawMaturity: row['Maturity date (dd. mm. yyyy)']
        });
    }
    return parsed;
}

function sortDisplayData() {
    state.displayData.sort((a, b) => {
        let valA = a[state.sortCol]; let valB = b[state.sortCol];
        if (state.sortCol === 'endDate') { if (!valA) return 1; if (!valB) return -1; }
        if (valA < valB) return state.sortAsc ? -1 : 1;
        if (valA > valB) return state.sortAsc ? 1 : -1;
        return 0;
    });
}

function updateDynamicLabels() {
    const isInv = state.currentRoleView === 'investor';
    
    document.getElementById('lblKpiInvested').innerText = isInv ? t('dyn_inv_cap') : t('dyn_bor_cap');
    document.getElementById('lblKpiProfit').innerText = isInv ? t('dyn_net_profit') : t('dyn_int_cost');
    document.getElementById('lblChartBorrowers').innerText = isInv ? t('dyn_top_bor') : t('dyn_top_inv');
    document.getElementById('lblTableInvested').innerText = isInv ? t('dyn_tbl_inv') : t('dyn_tbl_debt');
    
    document.getElementById('lblKpiYield').innerText = isInv ? t('dyn_yield') : t('dyn_interest');

    // Nadpisy v modálnom okne teraz rieši samostatný event listener hore
    // document.getElementById('lblModalTitle').innerText = isInv ? t('dyn_plan_inv') : t('dyn_plan_bor'); ...

    document.querySelectorAll('[data-i18n="chart_int_title"]').forEach(el => {
        el.innerText = t('chart_int_title').replace('€', state.currencySymbol);
    });

    document.getElementById('lblUpcomingTitle').innerText = isInv ? t('kpi_upcoming_inv') : t('kpi_upcoming_bor');

    const accruedDom = document.getElementById('kpiAccruedProfit');
    const expectedDom = document.getElementById('kpiExpectedProfit');
    const realizedDom = document.getElementById('kpiRealizedProfit');

    if(isInv) {
        accruedDom.className = 'fs-4 fw-bold text-success';
        expectedDom.className = 'fs-6 fw-bold text-secondary';
        realizedDom.className = 'fs-6 fw-bold text-secondary';
    } else {
        accruedDom.className = 'fs-4 fw-bold text-danger';
        expectedDom.className = 'fs-6 fw-bold text-danger';
        realizedDom.className = 'fs-6 fw-bold text-danger';
    }
}

function calculateMetrics(data) {
    let m = {
        invested: 0, expectedProfit: 0, realizedProfit: 0, accruedProfit: 0,
        weightedLtvSum: 0, weightedLtvBase: 0, weightedAprSum: 0, weightedAprBase: 0,
        capitalAtRisk: 0, otherPartiesData: {},
        totalBtcCollateral: 0, activeCount: 0, nearestLiqPrice: 0, riskiestLoan: null
    };
    
    data.forEach(d => {
        m.invested += d.invested;
        if (d.isActive) {
            m.activeCount++;
            m.expectedProfit += d.profit;
            m.accruedProfit += d.profit * (d.progressPct / 100);
            m.totalBtcCollateral += d.collateralBtc;
            
            if (d.liquidationPrice > 0) {
                if (m.nearestLiqPrice === 0 || d.liquidationPrice > m.nearestLiqPrice) {
                    m.nearestLiqPrice = d.liquidationPrice;
                }
            }
            if (d.liquidationPrice > 0) {
                if (!m.riskiestLoan || d.distancePct < m.riskiestLoan.distancePct) {
                    m.riskiestLoan = d;
                }
            }
            if (d.ltv >= RISK_THRESHOLDS.LTV_HIGH) m.capitalAtRisk += d.invested;
            if (d.ltv > 0) {
                m.weightedLtvSum += (d.ltv * d.invested);
                m.weightedLtvBase += d.invested;
            }
        }
        if (d.isClosed) m.realizedProfit += d.profit;

        if (d.annualYield > 0) {
            m.weightedAprSum += (d.annualYield * d.invested);
            m.weightedAprBase += d.invested;
        }

        const otherParty = state.currentRoleView === 'investor' ? d.borrowerId : d.investorId;
        m.otherPartiesData[otherParty] = (m.otherPartiesData[otherParty] || 0) + d.invested;
    });

    state.totalInvestedForTooltip = m.invested;

    m.maxBorrowerValue = Object.values(m.otherPartiesData).reduce((max, v) => v > max ? v : max, 0);
    m.maxBorrowerShare = m.invested > 0 ? (m.maxBorrowerValue / m.invested) * 100 : 0;

    m.avgLtv = m.weightedLtvBase > 0 ? (m.weightedLtvSum / m.weightedLtvBase) : 0;
    m.avgApr = m.weightedAprBase > 0 ? (m.weightedAprSum / m.weightedAprBase) : 0;
    m.riskCapitalPct = m.invested > 0 ? (m.capitalAtRisk / m.invested) * 100 : 0;
    return m;
}

function updateKPIs(m) {
    const isInv = state.currentRoleView === 'investor';
    const sign = isInv ? '+' : '-'; 

    document.getElementById('kpiTotalValue').innerText = (m.invested + (isInv ? m.accruedProfit : 0)).toLocaleString('sk-SK', {maximumFractionDigits: 0}) + ` ${state.currencySymbol}`;
    document.getElementById('kpiLoanCount').innerText = `${m.activeCount} ${t('kpi_active')}`;
    document.getElementById('kpiNearestLiq').innerText = m.nearestLiqPrice > 0 ? `${m.nearestLiqPrice.toLocaleString('sk-SK', {maximumFractionDigits: 0})} ${state.currencySymbol}` : t('kpi_no_risk');
    document.getElementById('kpiInvested').innerText = m.invested.toLocaleString('sk-SK') + ` ${state.currencySymbol}`;
    document.getElementById('kpiAvgApr').innerText = m.avgApr.toFixed(1) + '%';
    
    document.getElementById('kpiExpectedProfit').innerText = `${sign}${m.expectedProfit.toLocaleString('sk-SK')} ${state.currencySymbol}`;
    document.getElementById('kpiRealizedProfit').innerText = `${sign}${m.realizedProfit.toLocaleString('sk-SK')} ${state.currencySymbol}`;
    document.getElementById('kpiAccruedProfit').innerText = `${sign}${m.accruedProfit.toLocaleString('sk-SK', {maximumFractionDigits: 0})} ${state.currencySymbol}`;

    

    const upcomingContainer = document.getElementById('upcomingPayments');
    const activeLoans = state.displayData.filter(d => d.isActive);
    
    activeLoans.sort((a, b) => a.remainingDays - b.remainingDays);
    const top3 = activeLoans.slice(0, 3);

    if (top3.length === 0) {
        upcomingContainer.innerHTML = `<div class="text-muted opacity-50">${t('kpi_no_upcoming')}</div>`;
    } else {
        let html = '';
        top3.forEach(d => {
            const amountFmt = d.due.toLocaleString('sk-SK', {maximumFractionDigits: 0}) + ` ${state.currencySymbol}`;
            const daysText = d.remainingDays > 0 ? `${d.remainingDays} ${t('tbl_days')}` : t('tbl_due');
            html += `
                <div class="d-flex justify-content-between align-items-center mb-1">
                    <span class="text-secondary fw-bold">${d.id}</span>
                    <span class="text-body fw-bold">${amountFmt}</span>
                    <span class="badge bg-secondary-subtle text-secondary-emphasis border border-secondary-subtle shadow-sm">${daysText}</span>
                </div>
            `;
        });
        upcomingContainer.innerHTML = html;
    }

    // --- NOVÝ KÓD: LOGIKA PRE NAJNOVŠIE ZMLUVY ---
    const latestContainer = document.getElementById('latestInvestments');
    const lblLatestTitle = document.getElementById('lblLatestTitle');
    
    // Zmena nadpisu podľa toho, či sme investor alebo dlžník
    lblLatestTitle.innerText = isInv ? (t('kpi_latest_inv') || 'Najnovšie investície') : (t('kpi_latest_bor') || 'Najnovšie pôžičky');

    // Vyfiltrujeme len aktívne zmluvy, ktoré majú definovaný dátum začiatku
    const activeLoansForLatest = state.displayData.filter(d => d.isActive && d.startDate);
    
    // Zoradíme ich zostupne (od najnovšieho dátumu b.startDate po a.startDate)
    activeLoansForLatest.sort((a, b) => b.startDate - a.startDate);
    
    // Zoberieme len prvé 3 najnovšie
    const latest3 = activeLoansForLatest.slice(0, 3);

    if (latest3.length === 0) {
        latestContainer.innerHTML = `<div class="text-muted opacity-50">${t('kpi_no_active') || 'Žiadne aktívne zmluvy.'}</div>`;
    } else {
        let htmlLatest = '';
        latest3.forEach(d => {
            const amountFmt = d.invested.toLocaleString('sk-SK', {maximumFractionDigits: 0}) + ` ${state.currencySymbol}`;
            // Formátujeme dátum vytvorenia do pekného tvaru
            const dateFmt = d.startDate.toLocaleDateString(currentLang === 'sk' ? 'sk-SK' : 'en-US');
            
            htmlLatest += `
                <div class="d-flex justify-content-between align-items-center mb-1">
                    <span class="text-secondary fw-bold">${d.id}</span>
                    <span class="text-body fw-bold">${amountFmt}</span>
                    <span class="badge bg-secondary-subtle text-secondary-emphasis border border-secondary-subtle shadow-sm">${dateFmt}</span>
                </div>
            `;
        });
        latestContainer.innerHTML = htmlLatest;
    }

    const riskDomEur = document.getElementById('kpiAtRiskEur');
    const riskDomPct = document.getElementById('kpiAtRiskPct');
    const riskCard = document.getElementById('kpiRiskCard');

    riskDomEur.innerText = m.capitalAtRisk.toLocaleString('sk-SK') + ` ${state.currencySymbol}`;
    riskDomPct.innerText = `${m.riskCapitalPct.toFixed(1)} ${t('kpi_risk_pct')}`;
    riskDomEur.className = 'kpi-value ' + (m.capitalAtRisk === 0 ? 'text-success' : 'text-danger');
    riskDomPct.className = m.capitalAtRisk === 0 ? 'text-success fw-bold' : 'text-danger fw-bold';

    riskCard.classList.remove('border-warning', 'border-danger', 'border-success');
    if (m.capitalAtRisk > 0) { riskCard.classList.add('border-danger'); }
    else if (m.invested > 0) { riskCard.classList.add('border-success'); }
    else { riskCard.classList.add('border-warning'); }

    
    const ltvDom = document.getElementById('kpiLtv');
    
    ltvDom.innerText = m.avgLtv.toFixed(1) + ' %';
    ltvDom.className = 'kpi-value ' + (m.avgLtv < RISK_THRESHOLDS.LTV_MEDIUM ? 'text-success' : (m.avgLtv < RISK_THRESHOLDS.LTV_HIGH ? 'text-warning' : 'text-danger'));

    
    
    const btcValue = document.getElementById('btcCollateralValue');
    const btcValueEur = document.getElementById('btcCollateralValueEur');

    if (m.totalBtcCollateral > 0) {
        const btcValueVal = m.totalBtcCollateral * state.currentBtcPrice;
        btcValue.innerText = `${m.totalBtcCollateral.toFixed(4)} BTC`;
        btcValueEur.innerText = `${btcValueVal.toLocaleString('sk-SK', {maximumFractionDigits: 0})} ${state.currencySymbol}`;
    } else {
        btcValue.innerText = `0.0000 BTC`;
        btcValueEur.innerText = `0 ${state.currencySymbol}`;
    }

    const indicator = document.getElementById('ltvIndicator');
    if (indicator) {
        indicator.style.left = Math.min(m.avgLtv, 100) + '%';
    }

    // --- NOVÝ KÓD: TOP 3 LIKVIDÁCIE ---
    const topLiqContainer = document.getElementById('topLiquidationsList');
    const activeRiskForLiq = state.displayData.filter(d => d.isActive && d.liquidationPrice > 0);
    // Zoradíme ich podľa vzdialenosti k likvidácii (od najmenšej = najviac ohrozené)
    activeRiskForLiq.sort((a, b) => a.distancePct - b.distancePct);
    const top3Liq = activeRiskForLiq.slice(0, 3);

    if (top3Liq.length === 0) {
        topLiqContainer.innerHTML = `<div class="text-muted opacity-50">${t('kpi_no_risk_loans') || 'Žiadne ohrozené zmluvy.'}</div>`;
    } else {
        let htmlLiq = '';
        top3Liq.forEach(d => {
            const liqPriceFmt = d.liquidationPrice.toLocaleString('sk-SK', {maximumFractionDigits: 0}) + ` ${state.currencySymbol}`;
            
            // Logika pre farbu odznaku podľa toho, ako blízko je likvidácia
            let distColorClass = 'bg-success-subtle text-success-emphasis border-success-subtle';
            if (d.distancePct < RISK_THRESHOLDS.DIST_WARNING) distColorClass = 'bg-warning-subtle text-warning-emphasis border-warning-subtle';
            if (d.distancePct < RISK_THRESHOLDS.DIST_CRITICAL) distColorClass = 'bg-danger-subtle text-danger-emphasis border-danger-subtle';
            if (d.distancePct < 0) distColorClass = 'bg-dark text-danger fw-bold border-dark'; // Ak už padol pod likvidáciu
            
            const gapLabel = t('tbl_gap') || 'Medzera';
            const gapHtml = `${gapLabel} ${d.distancePct.toFixed(1)}%`;
            
            htmlLiq += `
                <div class="d-flex justify-content-between align-items-center mb-1">
                    <span class="text-secondary fw-bold">${d.id}</span>
                    <span class="text-body fw-bold">${liqPriceFmt}</span>
                    <span class="badge ${distColorClass} border shadow-sm">${gapHtml}</span>
                </div>
            `;
        });
        topLiqContainer.innerHTML = htmlLiq;
    }

    // --- NOVÝ KÓD: TOP 3 KOLATERÁLY ---
    const topColContainer = document.getElementById('topCollateralsList');
    const activeCols = state.displayData.filter(d => d.isActive && d.collateralBtc > 0);
    // Zoradíme ich podľa veľkosti BTC (od najväčšieho po najmenší)
    activeCols.sort((a, b) => b.collateralBtc - a.collateralBtc);
    const top3Col = activeCols.slice(0, 3);

    if (top3Col.length === 0) {
        topColContainer.innerHTML = `<div class="text-muted opacity-50">${t('kpi_no_col') || 'Žiadny kolaterál.'}</div>`;
    } else {
        let htmlCol = '';
        top3Col.forEach(d => {
            const valFmt = (d.collateralBtc * state.currentBtcPrice).toLocaleString('sk-SK', {maximumFractionDigits: 0}) + ` ${state.currencySymbol}`;
            
            htmlCol += `
                <div class="d-flex justify-content-between align-items-center mb-1">
                    <span class="text-secondary fw-bold">${d.id}</span>
                    <span class="text-dark fw-bold"><i class="bi bi-currency-bitcoin text-warning"></i>${d.collateralBtc.toFixed(4)}</span>
                    <span class="badge bg-secondary-subtle text-secondary-emphasis border border-secondary-subtle shadow-sm">${valFmt}</span>
                </div>
            `;
        });
        topColContainer.innerHTML = htmlCol;
    }
}

function updateAIInsight(m) {
    const insightBox = document.getElementById('aiInsightBox');
    const aiMessage = document.getElementById('aiMessage');
    const aiIcon = document.getElementById('aiIcon');
    const isInv = state.currentRoleView === 'investor';
    
    insightBox.classList.remove('d-none', 'danger', 'warning');
    aiIcon.className = 'bi fs-4 me-3 ';

    const dom = getDom();
    const stressPct = parseInt(dom.stressSlider.value);
    const isStressed = stressPct < 0;

    if (m.invested === 0) {
        aiMessage.innerHTML = t('ai_no_data');
        aiIcon.classList.add('bi-robot', 'text-secondary');
    } else if (isStressed && m.capitalAtRisk > 0) {
        const stressedPrice = (state.currentBtcPrice * (1 + stressPct / 100)).toLocaleString('sk-SK', {maximumFractionDigits: 0});
        
        // --- ZÁCHRANNÉ KOLESO PRE OBOCH (INVESTOR AJ DLŽNÍK) ---
        if (state.displayData.length > 0) {
            const simPrice = state.currentBtcPrice * (1 + stressPct / 100);
            let riskyLoansDetails = [];
            let liquidatedDetails = [];

            state.displayData.forEach(item => {
                if (!item.isActive || item.collateralBtc <= 0) return;
                const itemLTV = (item.due / (item.collateralBtc * simPrice)) * 100;

                if (itemLTV >= 95) { 
                    // ZLIKVIDOVANÉ
                    liquidatedDetails.push(`Zmluva <span class="fw-bold">${item.id}</span>: <span class="badge bg-dark text-danger border border-danger">${t('insight_liquidated_badge') || 'ZLIKVIDOVANÁ'}</span>`);
                } else if (itemLTV > RISK_THRESHOLDS.LTV_HIGH) { 
                    // OHROZENÉ
                    const targetSafeLTV = 70; 
                    const neededCollateral = (item.due * 100) / (targetSafeLTV * simPrice);
                    const toAddForThisLoan = Math.max(0, neededCollateral - item.collateralBtc);
                    
                    // Text sa mení podľa toho, či to pozerá investor alebo dlžník
                    const actionText = isInv ? '<span class="text-muted text-micro">Dlžník musí doložiť:</span> ' : '+';
                    
                    riskyLoansDetails.push(`Zmluva <span class="fw-bold">${item.id}</span>: ${actionText}<strong>${toAddForThisLoan.toFixed(4)} BTC</strong>`);
                }
            });

            if (liquidatedDetails.length > 0 || riskyLoansDetails.length > 0) {
                let combinedHtml = '';

                // 1. Zlikvidované
                if (liquidatedDetails.length > 0) {
                    combinedHtml += `<div class="mb-2"><strong class="text-danger">${t('insight_liquidated_label') || 'Likvidácia (LTV ≥ 95%):'}</strong><ul class="mb-1 mt-1 ps-3" style="font-size: 0.9em;"><li>${liquidatedDetails.join('</li><li>')}</li></ul></div>`;
                }

                // 2. Ohrozené
                if (riskyLoansDetails.length > 0) {
                    let prefix = '';
                    if (isInv) {
                        prefix = (t('insight_rescue_add_inv') || `Máš <strong>{count} ohrozenú investíciu/ie</strong>. Pre ich bezpečie musia dlžníci doložiť:`)
                            .replace('{count}', riskyLoansDetails.length)
                            .replace('{target}', 70);
                    } else {
                        prefix = (t('insight_rescue_add') || `Máš <strong>{count} ohrozenú pôžičku/y</strong>. Pre návrat do bezpečia (pod {target} % LTV) musíš doložiť:`)
                            .replace('{count}', riskyLoansDetails.length)
                            .replace('{target}', 70);
                    }
                    
                    combinedHtml += `<div>${prefix}<ul class="mb-0 mt-1 ps-3" style="font-size: 0.9em; opacity: 0.9;"><li>${riskyLoansDetails.join('</li><li>')}</li></ul></div>`;
                }

                aiMessage.innerHTML = combinedHtml;
                insightBox.classList.add('danger');
                
                if (liquidatedDetails.length > 0) {
                    aiIcon.className = 'bi fs-4 me-3 bi-x-octagon-fill text-danger';
                } else {
                    aiIcon.className = 'bi fs-4 me-3 bi-life-preserver text-danger';
                }
                
                return; // Skončíme tu
            }
        }
        // --- KONIEC ZÁCHRANNÉHO KOLESA ---

        aiMessage.innerHTML = `${t('ai_stress_warn1')} ${stressPct}% → ${stressedPrice} ${state.currencySymbol}): <strong>${m.capitalAtRisk.toLocaleString('sk-SK')} ${state.currencySymbol}</strong> ${t('ai_stress_warn2')} ${RISK_THRESHOLDS.LTV_HIGH}%). ${t('ai_stress_warn3')} ${m.riskCapitalPct.toFixed(1)}% ${isInv ? t('ai_inv') : t('ai_bor')}.`;
        insightBox.classList.add('danger');
        aiIcon.classList.add('bi-exclamation-triangle-fill', 'text-danger');
    } else if (isStressed && m.capitalAtRisk === 0) {
        aiMessage.innerHTML = `${t('ai_stress_safe')} ${m.avgLtv.toFixed(1)}%.`;
        aiIcon.classList.add('bi-shield-check-fill', 'text-success');
    } else if (m.riskCapitalPct > RISK_THRESHOLDS.PORTFOLIO_RISK_WARN) {
        aiMessage.innerHTML = `${t('ai_info1')} ${m.capitalAtRisk.toLocaleString('sk-SK')} ${state.currencySymbol} ${t('ai_info2')} (LTV > ${RISK_THRESHOLDS.LTV_HIGH}%). ${isInv ? t('ai_expect_inv') : t('ai_expect_bor')}`;
        insightBox.classList.add('warning');
        aiIcon.classList.add('bi-info-circle-fill', 'text-warning');
    } else {
        
        // --- AKTUALIZOVANÁ LOGIKA PRE MARGIN CALL 1, 2 a 3 ---
        if (m.riskiestLoan && m.riskiestLoan.ltv > 0) {
            const mc1Price = (m.riskiestLoan.due / 0.73) / m.riskiestLoan.collateralBtc;
            let dropRequired = 0;
            if (state.currentBtcPrice > mc1Price) {
                dropRequired = ((state.currentBtcPrice - mc1Price) / state.currentBtcPrice) * 100;
            }
            
            let extraInfo = '';
            const ltv = m.riskiestLoan.ltv;

            if (ltv >= 86) {
                extraInfo = `<span class="text-danger">Kritický stav!</span> ${t('ai_risk_pos')} (<strong>${m.riskiestLoan.id}</strong>) prekročila <strong>Margin Call 3</strong> (LTV ${ltv.toFixed(1)}%). Likvidácia je extrémne blízko!`;
            } else if (ltv >= 79) {
                extraInfo = `Vážne varovanie! ${t('ai_risk_pos')} (<strong>${m.riskiestLoan.id}</strong>) je v zóne <strong>Margin Call 2</strong> (LTV ${ltv.toFixed(1)}%).`;
            } else if (ltv >= 73) {
                // Zachovaný tvoj prekladový kľúč z minulosti s defaultným textom ako zálohou
                extraInfo = `Pozor, ${t('ai_risk_pos').toLowerCase()} (<strong>${m.riskiestLoan.id}</strong>) ${t('ai_mc_zone') || `je v zóne Margin Call 1 (LTV ${ltv.toFixed(1)}%).`}`;
            } else if (dropRequired > 0 && dropRequired < 100) {
                extraInfo = `${t('ai_risk_pos')} (<strong>${m.riskiestLoan.id}</strong>) má LTV ${ltv.toFixed(1)}%. ${t('ai_if_drop')} <strong>${dropRequired.toFixed(1)}%</strong>, ${t('ai_mc1')}`;
            }
            
            aiMessage.innerHTML = `${t('ai_ok')} ${extraInfo}`;
        } else {
            aiMessage.innerHTML = `${t('ai_ok')} (LTV ${m.avgLtv.toFixed(1)}%). ${t('ai_no_liq')}`;
        }
        aiIcon.classList.add('bi-check-circle-fill', 'text-success');
    }
}

function renderTable() {
    const tbody = document.querySelector('#investmentsTable tbody');
    const fragment = document.createDocumentFragment();
    const isInv = state.currentRoleView === 'investor';
    const profitColor = isInv ? 'text-success' : 'text-danger';
    const profitSign = isInv ? '+' : '-';

    state.displayData.forEach(d => {
        let ltvLabel = 'NEZNÁME'; let ltvClass = 'bg-secondary';
        if (d.ltv > 0 && d.ltv < RISK_THRESHOLDS.LTV_MEDIUM) { ltvLabel = 'LOW'; ltvClass = 'bg-success'; }
        else if (d.ltv >= RISK_THRESHOLDS.LTV_MEDIUM && d.ltv < RISK_THRESHOLDS.LTV_HIGH) { ltvLabel = 'MEDIUM'; ltvClass = 'bg-warning text-dark'; }
        else if (d.ltv >= RISK_THRESHOLDS.LTV_HIGH) { ltvLabel = 'HIGH'; ltvClass = 'bg-danger'; }

        let statusBadge = d.isActive ? 'bg-success' : (d.isClosed ? 'bg-dark' : 'bg-secondary');
        let statusText = d.status;
        let daysText = d.remainingDays > 0 ? `${t('tbl_days_left')} ${d.remainingDays} ${t('tbl_days')}` : t('tbl_due');
        if (d.isClosed) daysText = t('tbl_closed');
        
        let deleteBtn = '';
        if (d.isSimulated) {
            statusBadge = 'bg-primary text-white';
            statusText = t('tbl_planned');
            deleteBtn = `<button class="btn btn-sm btn-outline-danger py-0 px-2 ms-2 shadow-sm" onclick="deleteSimulation('${d.id}')"><i class="bi bi-trash"></i></button>`;
        }

        const barClass = d.progressPct > 80 ? 'bg-success' : 'bg-primary';

        let distColor = 'text-success';
        if (d.distancePct < RISK_THRESHOLDS.DIST_WARNING) distColor = 'text-warning';
        if (d.distancePct < RISK_THRESHOLDS.DIST_CRITICAL) distColor = 'text-danger';
        if (d.distancePct < 0) distColor = 'text-danger fw-bold bg-dark px-1 rounded';

        let distText = (d.isActive && d.liquidationPrice > 0)
            ? `<div class="mt-1 text-micro">${t('tbl_gap')} <span class="fw-bold ${distColor}">${d.distancePct.toFixed(1)}%</span></div>`
            : '';

        let miniLtvBar = '';
        if (d.isActive && d.ltv > 0) {
            const indicatorPos = Math.min(d.ltv, 100);
            miniLtvBar = `
                <div class="position-relative mt-2 mb-1" style="width: 120px;">
                    <div style="height: 4px; background: linear-gradient(to right, #20c997 0%, #20c997 73%, #0dcaf0 73%, #0dcaf0 79%, #ffc107 79%, #ffc107 86%, #fd7e14 86%, #fd7e14 95%, #dc3545 95%, #dc3545 100%); border-radius: 2px;"></div>
                    <div class="position-absolute shadow-sm" style="top: -2px; width: 3px; height: 8px; background: var(--bs-body-color); border-radius: 1px; left: ${indicatorPos}%; transform: translateX(-50%);"></div>
                </div>
            `;
        }

        const tr = document.createElement('tr');
        if (d.isActive && d.liquidationPrice > 0 && d.distancePct < RISK_THRESHOLDS.DIST_CRITICAL) {
            tr.className = d.distancePct < 0 ? 'table-dark' : 'table-danger';
        }

        const investedFmt = d.invested.toLocaleString('sk-SK');
        const profitFmt = d.profit.toLocaleString('sk-SK');
        const colBtcFmt = d.collateralBtc > 0 ? `${d.collateralBtc.toFixed(4)} BTC` : '-';
        const colValFmt = d.collateralBtc > 0 ? `${(d.collateralBtc * state.currentBtcPrice).toLocaleString('sk-SK', {maximumFractionDigits: 0})} ${state.currencySymbol}` : '';
        const startDateFmt = d.startDate ? d.startDate.toLocaleDateString(currentLang === 'sk' ? 'sk-SK' : 'en-US') : '-';
        const endDateFmt = d.endDate ? d.endDate.toLocaleDateString(currentLang === 'sk' ? 'sk-SK' : 'en-US') : '-';

        tr.innerHTML = `
            <td data-label="ID" class="fw-bold ${d.isSimulated ? 'text-primary' : 'text-secondary'}">
                ${d.isSimulated ? '<i class="bi bi-calculator me-1"></i>' : ''}${d.id}
            </td>
            <td data-label="Splatnosť"><span class="fw-bold">${d.rawMaturity || '-'}</span></td>
            <td data-label="Reálny Úrok">
                <div class="fw-bold">${d.annualYield.toFixed(1)} % <span class="text-micro text-muted">p.a.</span></div>
            </td>
            <td data-label="Investícia / Zisk">
                <div>${investedFmt} ${state.currencySymbol}</div>
                <small class="${profitColor} fw-bold">${profitSign}${profitFmt} ${state.currencySymbol}</small>
            </td>
            <td data-label="Kolaterál">
                <div class="fw-bold text-dark"><i class="bi bi-currency-bitcoin text-warning"></i> ${colBtcFmt}</div>
                <small class="text-muted">${colValFmt}</small>
            </td>
            <td data-label="Riziko / Medzera">
                <div class="mb-1"><span class="badge ${ltvClass}">${ltvLabel} (${d.ltv.toFixed(1)}%)</span></div>
                ${miniLtvBar}
                ${distText}
            </td>
            <td data-label="Priebeh">
                <div class="d-flex flex-column" style="min-width: 180px; width: 100%;">
                    <div class="d-flex justify-content-between days-left mb-1 w-100">
                        <span class="fw-bold text-dark">${d.progressPct.toFixed(0)}%</span>
                        <span>${daysText}</span>
                    </div>
                    <div class="progress progress-container bg-body-secondary w-100" style="height: 8px;">
                        <div class="progress-bar ${barClass}" style="width: ${d.progressPct}%"></div>
                    </div>
                    <div class="d-flex justify-content-between mt-1 text-micro text-muted">
                        <span>${startDateFmt}</span><span>${endDateFmt}</span>
                    </div>
                </div>
            </td>
            <td data-label="Status">
                <span class="badge ${statusBadge}">${statusText}</span>${deleteBtn}
            </td>
        `;
        fragment.appendChild(tr);
    });
    tbody.innerHTML = '';
    tbody.appendChild(fragment);
}

function renderCharts() {
    ['cashflow', 'liquidation', 'interest', 'borrowers'].forEach(key => {
        if (state.charts[key]) state.charts[key].destroy();
    });

    const isDark = document.documentElement.getAttribute('data-bs-theme') === 'dark';
    const gridColor = isDark ? 'rgba(255, 255, 255, 0.1)' : 'rgba(0, 0, 0, 0.1)';
    const textColor = isDark ? '#adb5bd' : '#6c757d';
    const isInv = state.currentRoleView === 'investor';
    
    const commonScales = { x: { ticks: { color: textColor }, grid: { color: gridColor } }, y: { ticks: { color: textColor }, grid: { color: gridColor } } };

    let objPrincipal = {}, objProfit = {};
    let activeRiskLoans = [];
    let objRates = {}, objBorrowers = {};

    state.displayData.forEach(d => {
        if (d.cashflowMonth && d.status !== 'CANCELED') {
            objPrincipal[d.cashflowMonth] = (objPrincipal[d.cashflowMonth] || 0) + d.invested;
            objProfit[d.cashflowMonth] = (objProfit[d.cashflowMonth] || 0) + d.profit;
        }
        if (d.isActive && d.liquidationPrice > 0) activeRiskLoans.push({ id: d.id, distance: d.distancePct });
        if (d.rate > 0) {
            const rKey = d.rate.toFixed(1) + '%';
            objRates[rKey] = (objRates[rKey] || 0) + d.invested;
        }
        
        const otherParty = isInv ? d.borrowerId : d.investorId;
        objBorrowers[otherParty] = (objBorrowers[otherParty] || 0) + d.invested;
    });

    const cfLabels = Object.keys(objPrincipal).sort();
    state.charts.cashflow = new Chart(document.getElementById('cashflowChart'), {
        type: 'bar',
        data: {
            labels: cfLabels,
            datasets: [
                { label: (isInv ? t('chart_ret_prin') : t('chart_pay_prin')).replace('€', state.currencySymbol), data: cfLabels.map(l => objPrincipal[l]), backgroundColor: isDark ? '#343a40' : '#e9ecef' },
                { label: (isInv ? t('chart_net_prof') : t('chart_pay_int')).replace('€', state.currencySymbol), data: cfLabels.map(l => objProfit[l]), backgroundColor: isInv ? '#20c997' : '#dc3545' }
            ]
        },
        options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'bottom', labels: { color: textColor } } }, scales: { x: { stacked: true, ...commonScales.x }, y: { stacked: true, ...commonScales.y } } }
    });

    activeRiskLoans.sort((a, b) => a.distance - b.distance);
    
    state.charts.liquidation = new Chart(document.getElementById('liquidationChart'), {
        type: 'bar',
        data: {
            labels: activeRiskLoans.map(l => l.id),
            datasets: [{
                label: t('chart_gap'),
                data: activeRiskLoans.map(l => l.distance),
                backgroundColor: activeRiskLoans.map(l => l.distance <= 0 ? '#000000' : (l.distance < 11.58 ? '#dc3545' : (l.distance < 23.16 ? '#ffc107' : '#20c997'))),
                borderRadius: 4
            }]
        },
        options: {
            responsive: true, 
            maintainAspectRatio: false, 
            layout: { padding: { right: 140 } },
            plugins: { 
                legend: { display: false },
                annotation: {
                    clip: false, 
                    annotations: {
    lineMC1: {
        type: 'line', yMin: 23.16, yMax: 23.16, borderColor: '#ffc107', borderWidth: 2, borderDash: [6, 4],
        label: { display: true, content: 'Margin Call 1 (73%)', position: 'end', backgroundColor: '#ffc107', color: '#000', xAdjust: 105 }
    },
    lineMC2: {
        type: 'line', yMin: 16.84, yMax: 16.84, borderColor: '#fd7e14', borderWidth: 2, borderDash: [6, 4],
        label: { display: true, content: 'Margin Call 2 (79%)', position: 'end', backgroundColor: '#fd7e14', color: '#000', xAdjust: 105 }
    },
    lineMC3: {
        type: 'line', yMin: 9.47, yMax: 9.47, borderColor: '#dc3545', borderWidth: 2, borderDash: [6, 4],
        label: { display: true, content: 'Margin Call 3 (86%)', position: 'end', backgroundColor: '#dc3545', color: '#000', xAdjust: 105 }
    },
    lineLiq: {
        type: 'line', yMin: 0, yMax: 0, borderColor: '#000', borderWidth: 2,
        label: { display: true, content: 'Liquidation (95%)', position: 'end', backgroundColor: '#000', color: '#fff', xAdjust: 105 }
    }
}
                }
            },
            scales: { x: commonScales.x, y: { suggestedMax: 100, ...commonScales.y } }
        }
    });

    const rLabels = Object.keys(objRates).sort((a, b) => parseFloat(a) - parseFloat(b));
    state.charts.interest = new Chart(document.getElementById('interestChart'), {
        type: 'bar',
        data: {
            labels: rLabels,
            datasets: [{ data: rLabels.map(l => objRates[l]), backgroundColor: '#0d6efd', borderRadius: 4 }]
        },
        options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { x: commonScales.x, y: commonScales.y } }
    });

    let sortedBorrowers = Object.entries(objBorrowers).sort((a, b) => b[1] - a[1]);
    let top5 = sortedBorrowers.slice(0, 5);
    let others = sortedBorrowers.slice(5).reduce((sum, item) => sum + item[1], 0);
    let bLabels = top5.map(i => i[0]); let bData = top5.map(i => i[1]);
    if (others > 0) { bLabels.push(t('chart_others')); bData.push(others); }
    state.charts.borrowers = new Chart(document.getElementById('borrowerChart'), {
        type: 'doughnut',
        data: { labels: bLabels, datasets: [{ data: bData, backgroundColor: ['#0d6efd', '#6610f2', '#6f42c1', '#d63384', '#20c997', '#adb5bd'] }] },
        options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'right', labels: { boxWidth: 10, font: { size: 10 }, color: textColor } } } }
    });
}

function updateStressUI(pct) {
    const stressLabel = document.getElementById('stressLabel');
    const stressBtcPrice = document.getElementById('stressBtcPrice');
    const dom = getDom();
    
    if (dom.stressModeBadge) {
        if (pct === 0) dom.stressModeBadge.classList.add('d-none');
        else dom.stressModeBadge.classList.remove('d-none');
    }

    if (pct === 0) {
        stressLabel.className = 'badge bg-secondary shadow-sm';
        stressLabel.innerText = t('badge_no_stress'); 
        stressBtcPrice.innerText = '';
    } else {
        const stressedPrice = state.currentBtcPrice * (1 + pct / 100);
        const colorClass = pct > -20 ? 'bg-warning text-dark' : (pct > -40 ? 'bg-danger' : 'bg-dark text-white');
        stressLabel.className = 'badge shadow-sm ' + colorClass;
        stressLabel.innerText = `Stres ${pct}%`;
        stressBtcPrice.innerHTML = `${t('stress_sim_price')} <strong>${stressedPrice.toLocaleString('sk-SK', {maximumFractionDigits: 0})} ${state.currencySymbol}</strong>`;
    }
}

// --- ULOŽENIE SIMULÁCIE ---
document.getElementById('btnSaveSimulation').addEventListener('click', async function() {
    const amountStr = document.getElementById('simAmount').value || document.getElementById('simAmount').placeholder;
    const rateStr = document.getElementById('simRate').value || document.getElementById('simRate').placeholder;
    const monthsStr = document.getElementById('simMonths').value || document.getElementById('simMonths').placeholder;

    const amount = parseFloat(amountStr);
    const rate = parseFloat(rateStr);
    const months = parseInt(monthsStr);

    if (isNaN(amount) || amount <= 0 || isNaN(rate) || isNaN(months) || months <= 0) {
        alert(t('msg_fill')); 
        return; 
    }

    const simRoleEl = document.querySelector('input[name="simRole"]:checked');
    const role = simRoleEl ? simRoleEl.value : state.currentRoleView;

    if (!state.hasImportedData) {
        const selectedCurr = document.getElementById('simCurrencySelect').value;
        if (state.currency !== selectedCurr) {
            state.currency = selectedCurr;
            state.currencySymbol = CURRENCY_SYMBOLS[state.currency] || state.currency;
            localStorage.setItem('firefish_simulated_currency', state.currency);
            await fetchBtcPrice(); 
        }
    }

    const profit = amount * (rate / 100) * (months / 12);
    const due = amount + profit;
    const today = new Date();
    const endDate = new Date(today); endDate.setMonth(endDate.getMonth() + months);

    const invId = role === 'investor' ? (state.myId || 'JA') : t('sim_lender');
    const borId = role === 'borrower' ? (state.myId || 'JA') : t('sim_borrower');

    const calculatedCollateral = (state.currentBtcPrice > 0) ? ((due / 0.50) / state.currentBtcPrice) : 0;
    const calculatedLiqPrice = (calculatedCollateral > 0) ? (due / (calculatedCollateral * 0.95)) : 0;

    const simLoan = {
        id: 'SIM-' + Math.floor(Math.random() * 10000), 
        invested: amount, due: due, rate: rate, status: 'ACTIVE', profit: profit,
        isClosed: false, isActive: true, cashflowMonth: `${endDate.getFullYear()}-${(endDate.getMonth() + 1).toString().padStart(2, '0')}`,
        liquidationPrice: calculatedLiqPrice, 
        collateralBtc: calculatedCollateral, 
        annualYield: rate, ltv: 50, distancePct: 0,
        investorId: invId, borrowerId: borId, role: role,
        startDate: today, endDate: endDate, progressPct: 0, 
        remainingDays: Math.ceil((endDate - today) / (1000 * 60 * 60 * 24)),
        rawMaturity: endDate.toLocaleDateString(currentLang === 'sk' ? 'sk-SK' : 'en-US'), isSimulated: true
    };

    state.rawData.push(simLoan);
    const savedSims = JSON.parse(localStorage.getItem('firefish_simulated_loans') || '[]');
    savedSims.push(simLoan);
    localStorage.setItem('firefish_simulated_loans', JSON.stringify(savedSims));

    state.currentRoleView = role;
    document.getElementById('roleInvestor').checked = (role === 'investor');
    document.getElementById('roleBorrower').checked = (role === 'borrower');
    document.getElementById('roleInvestor').disabled = false;
    document.getElementById('roleBorrower').disabled = false;
    document.getElementById('statusFilter').disabled = false;

    // --- ODOMKNUTIE TLAČIDLA PLÁNOVAČA ---
    document.getElementById('btnOpenSimulation').removeAttribute('disabled');
    document.getElementById('btnOpenAnalytics').removeAttribute('disabled');
    document.getElementById('btnOpenCycle').removeAttribute('disabled');

    document.getElementById('welcomeScreen').classList.add('d-none');
    document.getElementById('mainControlPanel').classList.remove('d-none');
    document.getElementById('dashboard').classList.remove('d-none');
    document.getElementById('stressPlaceholder').classList.add('d-none');
    document.getElementById('stressPanel').classList.remove('d-none');

    bootstrap.Modal.getInstance(document.getElementById('simulationModal')).hide();
    document.getElementById('simulationForm').reset();
    
    recalculateBaseData();
    refreshDashboard();
});

window.deleteSimulation = function(id) {
    state.rawData = state.rawData.filter(d => d.id !== id);
    let savedSims = JSON.parse(localStorage.getItem('firefish_simulated_loans') || '[]');
    savedSims = savedSims.filter(d => d.id !== id);
    localStorage.setItem('firefish_simulated_loans', JSON.stringify(savedSims));

    if (state.rawData.length === 0) {
        document.getElementById('dashboard').classList.add('d-none');
        document.getElementById('mainControlPanel').classList.add('d-none');
        document.getElementById('welcomeScreen').classList.remove('d-none');
    } else {
        refreshDashboard(); 
    }
};

document.getElementById('btnClearData').addEventListener('click', function() {
    if(confirm(t('msg_del'))) {
        localStorage.clear(); location.reload();    
    }
});

function updateNetworkStatus() {
    const statusEl = document.getElementById('networkStatus');
    if (navigator.onLine) {
        statusEl.className = 'unified-box text-success fw-medium px-2 shadow-sm network-badge-text';
        statusEl.innerHTML = `<i class="bi bi-wifi me-1"></i> <span id="lblNetworkStatus">${t('status_online')}</span>`;
    } else {
        statusEl.className = 'unified-box text-secondary fw-medium px-2 shadow-sm network-badge-text';
        statusEl.innerHTML = `<i class="bi bi-wifi-off me-1"></i> <span id="lblNetworkStatus">${t('status_offline')}</span>`;
    }
}
window.addEventListener('online', updateNetworkStatus);
window.addEventListener('offline', updateNetworkStatus);
updateNetworkStatus();

window.copyToClipboard = function(elementId) {
    const copyText = document.getElementById(elementId);
    copyText.select();
    copyText.setSelectionRange(0, 99999); 
    navigator.clipboard.writeText(copyText.value);
    
    const btn = copyText.nextElementSibling;
    const originalHtml = btn.innerHTML;
    btn.innerHTML = '<i class="bi bi-check2 text-success"></i>';
    setTimeout(() => { btn.innerHTML = originalHtml; }, 2000);
};