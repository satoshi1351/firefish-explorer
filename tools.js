// analytics.js

let isCompassLoaded = false;

async function renderMarketCompass() {
    if (isCompassLoaded) return; 

    const meterContainer = document.getElementById('compassMeter');
    const insightBox = document.getElementById('compassInsight');
    
    if(!meterContainer || !insightBox) return;

    try {
        const response = await fetch('https://api.alternative.me/fng/');
        const data = await response.json();
        
        if(data && data.data && data.data.length > 0) {
            const fngValue = parseInt(data.data[0].value, 10);
            
            // --- MOŽNOSŤ 3: MATEMATIKA PRE NOVÚ PÔŽIČKU ---
            const dropFactor = (0.5 / 0.95); 
            const liqPrice = state.currentBtcPrice * dropFactor;
            const dropPct = 47.4; 
            
            // OPRAVENÉ FORMÁTOVANIE CENY (Bezpečné pre USDC/USDT)
            const symbol = state.currencySymbol || state.currency || '€';
            const formattedPrice = Math.round(liqPrice).toLocaleString() + ' ' + symbol;

            let advantage = 'neutral';
            let advantageText = '';
            let alertClass = 'alert-secondary';
            let iconClass = 'bi-info-circle-fill text-secondary';
            
            if (fngValue <= 35) {
                advantage = 'borrower';
                alertClass = 'alert-danger bg-danger-subtle border-danger-subtle';
                iconClass = 'bi-shield-fill-check text-danger';
                advantageText = t('compass_adv_bor')
                    .replace('{fng}', fngValue)
                    .replace('{price}', formattedPrice)
                    .replace('{drop}', dropPct);
            } else if (fngValue >= 65) {
                advantage = 'investor';
                alertClass = 'alert-success bg-success-subtle border-success-subtle';
                iconClass = 'bi-lightning-fill text-success';
                advantageText = t('compass_adv_inv')
                    .replace('{fng}', fngValue)
                    .replace('{price}', formattedPrice)
                    .replace('{drop}', dropPct);
            } else {
                advantage = 'neutral';
                alertClass = 'alert-warning bg-warning-subtle border-warning-subtle';
                iconClass = 'bi-activity text-warning';
                advantageText = t('compass_adv_neu')
                    .replace('{fng}', fngValue)
                    .replace('{price}', formattedPrice)
                    .replace('{drop}', dropPct);
            }

            // --- MINIMALISTICKÝ MODERNÝ PRO GAUGE (Segmented Slider) ---
            meterContainer.innerHTML = `
                <div class="px-3 mt-4 mb-5 pb-2 pt-3 bg-body-tertiary rounded-4 border shadow-inner">
                    <div class="position-relative" 
                         style="height: 14px; 
                                background: linear-gradient(to right, 
                                    #dc3545 0%, #dc3545 24%, 
                                    #fd7e14 25%, #fd7e14 49%, 
                                    #ffc107 50%, #ffc107 50%, 
                                    #a0d468 51%, #a0d468 75%, 
                                    #198754 76%, #198754 100%
                                ); 
                                border-radius: 7px; 
                                box-shadow: inset 0 2px 4px rgba(0,0,0,0.15);
                                border: 1px solid rgba(0,0,0,0.1);">
                        
                        <div class="position-absolute" 
                             style="left: ${fngValue}%; top: -11px; transform: translateX(-50%); z-index: 5;">
                            
                            <div class="d-flex align-items-center justify-content-center shadow-lg bg-body text-body" 
                                 style="width: 36px; height: 36px; 
                                        border-radius: 50%; 
                                        border: 3px solid var(--bs-body-color); 
                                        font-weight: 800; font-size: 1.1rem;
                                        filter: drop-shadow(0 4px 6px rgba(0,0,0,0.15));">
                                ${fngValue}
                            </div>
                        </div>
                    </div>
                    
                    <div class="d-flex justify-content-between mt-2 text-muted fw-bold" style="font-size: 0.7rem; opacity: 0.8;">
                        <span>0</span>
                        <span>25</span>
                        <span>50</span>
                        <span>75</span>
                        <span>100</span>
                    </div>
                </div>
            `;

            insightBox.innerHTML = `
                <div class="alert ${alertClass} shadow-sm border-0 d-flex align-items-start gap-3 fade-in">
                    <i class="bi ${iconClass} fs-3 mt-1"></i>
                    <div class="small">
                        ${advantageText}
                    </div>
                </div>
            `;
            isCompassLoaded = true;
        }
    } catch (error) {
        console.error("Compass error:", error);
        insightBox.innerHTML = `<div class="alert alert-light small text-muted">Nedostupné (Offline)</div>`;
    }
}

// Spusti načítanie DÁT AŽ vtedy, keď používateľ reálne otvorí modálne okno Analytiky
const analyticsModal = document.getElementById('analyticsModal');
if (analyticsModal) {
    analyticsModal.addEventListener('show.bs.modal', function () {
        renderMarketCompass();
    });
}

// --- HODL vs FIREFISH SIMULATOR ---

// Nová funkcia, ktorá prepočíta rozsah posuvníka podľa toho, koľko mesiacov si zvolil
function updateHodlSliderRange() {
    if (state.currentBtcPrice <= 0) return;
    
    const slider = document.getElementById('hodlPriceSlider');
    const months = parseInt(document.getElementById('hodlDuration').value) || 12;

    let minMult = 0.4;
    let maxMult = 2.5;

    // Logika realistických cenových pohybov BTC podľa času
    switch(months) {
        case 3: minMult = 0.6; maxMult = 1.5; break;   // 3 mesiace: pád max o 40%, rast max o 50%
        case 6: minMult = 0.5; maxMult = 2.0; break;   // 6 mesiacov: pád max o 50%, rast max o 100%
        case 12: minMult = 0.4; maxMult = 2.5; break;  // 1 rok: pád max o 60%, rast max o 150%
        case 18: minMult = 0.3; maxMult = 3.0; break;  // 1,5 roka: pád o 70%, rast o 200%
        case 24: minMult = 0.2; maxMult = 4.0; break;  // 2 roky: pád o 80%, rast o 300%
    }

    const dynamicMin = Math.floor(state.currentBtcPrice * minMult);
    const dynamicMax = Math.floor(state.currentBtcPrice * maxMult);

    slider.min = dynamicMin;
    slider.max = dynamicMax;
    slider.step = state.currentBtcPrice > 100000 ? 1000 : 500;

    // Ak po zmene mesiacov zostal posuvník mimo nového rozsahu, vrátime ho na aktuálnu cenu
    if (slider.value < dynamicMin || slider.value > dynamicMax) {
    slider.value = Math.floor(state.currentBtcPrice);
}
}

function renderHodlSimulator() {
    const currentPrice = state.currentBtcPrice;
    const currencySym = state.currencySymbol || '€';
    
    if (!currentPrice || currentPrice <= 0) return;

    const elAmount = document.getElementById('hodlAmount');
    const elYield = document.getElementById('hodlYield');
    const elDuration = document.getElementById('hodlDuration'); 
    const elSlider = document.getElementById('hodlPriceSlider');
    const elFutureLabel = document.getElementById('hodlFuturePriceLabel');
    const elSym = document.getElementById('hodlCurrencySymbol');
    
    if(elSym) elSym.innerText = currencySym;

    // Bezpečné načítanie hodnôt s predvolenými číslami
    const amount = parseFloat(elAmount.value) || 10000;
    const annualYield = parseFloat(elYield.value) || 10;
    const months = parseInt(elDuration.value) || 12;
    const futurePrice = parseFloat(elSlider.value) || currentPrice;

    elFutureLabel.innerText = futurePrice.toLocaleString('sk-SK') + ' ' + currencySym;

    // --- MATEMATIKA ---
    // 1. Firefish zisk alikvotne prepočítaný na mesiace (p.a. úrok / 12 * počet mesiacov)
    const timeRatio = months / 12;
    const firefishProfit = amount * (annualYield / 100) * timeRatio;
    
    // 2. HODL Stratégia
    const btcBought = amount / currentPrice;
    const futureBtcValue = btcBought * futurePrice;
    const hodlProfit = futureBtcValue - amount;
    
    // 3. Bod zlomu (Zohľadňuje časový úsek)
    const breakEvenPrice = currentPrice * (1 + ((annualYield / 100) * timeRatio));

    // --- VYKRESLENIE ---
    document.getElementById('hodlBreakEven').innerText = breakEvenPrice.toLocaleString('sk-SK', {maximumFractionDigits: 0}) + ' ' + currencySym;
    
    const ffProfitEl = document.getElementById('hodlFirefishProfit');
    ffProfitEl.innerText = `+ ${firefishProfit.toLocaleString('sk-SK', {maximumFractionDigits: 0})} ${currencySym}`;
    
    const hodlProfitEl = document.getElementById('hodlBtcProfit');
    const hodlSign = hodlProfit >= 0 ? '+' : '';
    hodlProfitEl.innerText = `${hodlSign} ${hodlProfit.toLocaleString('sk-SK', {maximumFractionDigits: 0})} ${currencySym}`;
    hodlProfitEl.className = hodlProfit >= 0 ? 'fs-5 fw-bold text-warning' : 'fs-5 fw-bold text-danger';

    // Výpočet šírky pásikov (progress bars)
    const maxProfit = Math.max(firefishProfit, hodlProfit, 1); 
    
    let ffWidth = (firefishProfit / maxProfit) * 100;
    let hodlWidth = hodlProfit > 0 ? (hodlProfit / maxProfit) * 100 : 0; 

    // Pásik pre Firefish
    document.getElementById('barFirefish').style.width = `${Math.max(5, ffWidth)}%`; 
    
    // Pásik pre HODL
    const barHodlEl = document.getElementById('barHODL');
    if (hodlProfit < 0) {
        barHodlEl.style.width = '15%'; 
        barHodlEl.className = 'progress-bar bg-danger text-white fw-bold';
        // Vymazali sme text, zostane len čistý vizuálny červený indikátor
        barHodlEl.innerHTML = ''; 
    } else {
        barHodlEl.style.width = `${Math.max(5, hodlWidth)}%`;
        barHodlEl.className = 'progress-bar bg-warning text-dark fw-bold';
        barHodlEl.innerHTML = '';
    }

    // Textové vyhodnotenie víťaza
    const alertBox = document.getElementById('hodlWinnerAlert');
    if (hodlProfit > firefishProfit) {
        const diffFmt = (hodlProfit - firefishProfit).toLocaleString('sk-SK', {maximumFractionDigits: 0}) + ' ' + currencySym;
        const hodlWinText = (t('hodl_win_hodl') || `Pri tejto cene sa ti oplatí <strong>HODL</strong> (zarobíš o {diff} viac).`).replace('{diff}', diffFmt);
        
        alertBox.className = 'alert alert-warning shadow-sm py-2 mb-4 text-dark border-warning-subtle';
        alertBox.innerHTML = `<i class="bi bi-piggy-bank-fill me-1"></i> ${hodlWinText}`;
    } else {
        alertBox.className = 'alert alert-success shadow-sm py-2 mb-4 border-success-subtle';
        alertBox.innerHTML = `<i class="bi bi-lightning-fill me-1"></i> ${t('hodl_win_ff') || 'Pri tejto cene s istotou vyhráva <strong>Firefish investícia</strong>.'}`;
    }
}


// --- PAMÄŤ KALKULAČIEK (Local Storage) ---

// 1. Zoznam ID všetkých políčok, ktoré si chceme pamätať
const memoryIds = [
    'hodlAmount', 'hodlYield', 'hodlDuration', 'hodlPriceSlider',
    'duelAmtA', 'duelRateA', 'duelMonthsA', 'duelAmtB', 'duelRateB', 'duelMonthsB'
];

// 2. Funkcia na uloženie dát (spustí sa zakaždým, keď používateľ niečo napíše)
function saveToMemory() {
    const memoryData = {};
    memoryIds.forEach(id => {
        const el = document.getElementById(id);
        if (el) memoryData[id] = el.value;
    });
    localStorage.setItem('firefishMemory', JSON.stringify(memoryData));
}

// 3. Funkcia na načítanie dát (spustí sa len raz pri otvorení stránky)
function loadFromMemory() {
    try {
        const saved = localStorage.getItem('firefishMemory');
        if (!saved) return;
        const savedData = JSON.parse(saved);
        memoryIds.forEach(id => {
            const el = document.getElementById(id);
            if (el && savedData[id]) {
                el.value = savedData[id];
            }
        });
    } catch (error) {
        console.warn('Memory load failed, starting fresh.', error);
    }
}


// --- SÚBOJ PÔŽIČIEK (A/B TESTER) ---
function renderDuelSimulator() {
    const sym = state.currencySymbol || '€';

    // Načítanie hodnôt z inputov (ak je pole prázdne, dosadí sa 0)
    const amtA = parseFloat(document.getElementById('duelAmtA').value) || 0;
    const rateA = parseFloat(document.getElementById('duelRateA').value) || 0;
    const monthsA = parseFloat(document.getElementById('duelMonthsA').value) || 1;

    const amtB = parseFloat(document.getElementById('duelAmtB').value) || 0;
    const rateB = parseFloat(document.getElementById('duelRateB').value) || 0;
    const monthsB = parseFloat(document.getElementById('duelMonthsB').value) || 1;

    // MATEMATIKA
    const profitA = amtA * (rateA / 100) * (monthsA / 12);
    const profitB = amtB * (rateB / 100) * (monthsB / 12);

    // Kto je víťaz podľa efektivity?
    let isAWinner = false;
    let isBWinner = false;

    if (amtA > 0 || amtB > 0) {
        if (rateA > rateB) {
            isAWinner = true;
        } else if (rateB > rateA) {
            isBWinner = true;
        } else {
            // Ak je úrok rovnaký, vyhráva kratšia doba
            if (monthsA < monthsB && amtA > 0) isAWinner = true;
            else if (monthsB < monthsA && amtB > 0) isBWinner = true;
        }
    }

    // VYKRESLENIE DO HTML - Zobrazujeme priamo zadaný úrok p.a.
    document.getElementById('duelTotalA').innerHTML = `${profitA.toLocaleString('sk-SK', {maximumFractionDigits: 0})} ${sym} <span class="d-block fs-6 fw-normal text-muted">(${rateA.toFixed(2)} % p.a.)</span>`;
    document.getElementById('duelTotalB').innerHTML = `${profitB.toLocaleString('sk-SK', {maximumFractionDigits: 0})} ${sym} <span class="d-block fs-6 fw-normal text-muted">(${rateB.toFixed(2)} % p.a.)</span>`;

    // ZVÝRAZNENIE VÍŤAZA (Odpoveď na tvoj bod 1)
    document.getElementById('duelTotalA').className = `fs-4 fw-bold ${isAWinner ? 'text-success' : 'text-body-emphasis'}`;
    document.getElementById('duelTotalB').className = `fs-4 fw-bold ${isBWinner ? 'text-success' : 'text-body-emphasis'}`;

    // INTELIGENTNÝ TEXTOVÝ ZÁVER
    const alertBox = document.getElementById('duelWinnerAlert');
    
    if (amtA === 0 && amtB === 0) {
        alertBox.innerHTML = `<i class="bi bi-info-circle text-muted me-2"></i>${t('duel_empty') || 'Vyplň parametre oboch investícií pre porovnanie.'}`;
        return;
    }

    if (isAWinner && rateA > rateB) {
        alertBox.innerHTML = `<i class="bi bi-trophy-fill text-primary me-2"></i>${t('duel_win_a_rate') || '<strong class="text-primary">Investícia A</strong> je efektívnejšia. Tvoje peniaze zarábajú rýchlejšie.'}`;
    } else if (isBWinner && rateB > rateA) {
        alertBox.innerHTML = `<i class="bi bi-trophy-fill text-info me-2"></i>${t('duel_win_b_rate') || '<strong class="text-info">Investícia B</strong> je efektívnejšia. Tvoje peniaze zarábajú rýchlejšie.'}`;
    } else if (isAWinner) {
        alertBox.innerHTML = `<i class="bi bi-trophy-fill text-primary me-2"></i>${t('duel_win_a_time') || '<strong class="text-primary">Investícia A</strong> je lepšia. Výnos je rovnaký, ale peniaze sa ti vrátia skôr.'}`;
    } else if (isBWinner) {
        alertBox.innerHTML = `<i class="bi bi-trophy-fill text-info me-2"></i>${t('duel_win_b_time') || '<strong class="text-info">Investícia B</strong> je lepšia. Výnos je rovnaký, ale peniaze sa ti vrátia skôr.'}`;
    } else {
        alertBox.innerHTML = `<i class="bi bi-hypnotize text-warning me-2"></i>${t('duel_tie') || 'Obe ponuky sú <strong>rovnako</strong> efektívne.'}`;
    }
}

// BEZPEČNÉ PRIPOJENIE POSLUCHÁČOV
document.addEventListener('DOMContentLoaded', () => {
    
    // --- NOVÉ: NAJPRV NAČÍTAME DÁTA Z PAMÄTE PREHLIADAČA ---
    loadFromMemory();
    
    // 1. Pripojenie na inputy HODL
    ['hodlAmount', 'hodlYield', 'hodlPriceSlider', 'hodlDuration'].forEach(id => {
        const el = document.getElementById(id);
        if(el) {
            el.addEventListener('input', (e) => {
                // Ak používateľ zmenil počet mesiacov, prepočítaj limity posuvníka!
                if (e.target.id === 'hodlDuration') {
                    updateHodlSliderRange();
                }
                renderHodlSimulator();
                saveToMemory(); // Uloží zmenu do pamäte
            });
        }
    });

    // 2. Pripojenie na Tab HODL
    const hodlTab = document.getElementById('hodl-tab');
    if (hodlTab) {
        hodlTab.addEventListener('shown.bs.tab', function (e) {
            // Zavoláme našu smart funkciu namiesto toho, aby sme to tu písali znova
            updateHodlSliderRange(); 
            renderHodlSimulator();
        });
    }

    // 3. Pripojenie na inputy Duel
    ['duelAmtA', 'duelRateA', 'duelMonthsA', 'duelAmtB', 'duelRateB', 'duelMonthsB'].forEach(id => {
        const el = document.getElementById(id);
        if(el) {
            el.addEventListener('input', () => {
                renderDuelSimulator();
                saveToMemory(); // Uloží zmenu do pamäte
            });
        }
    });

    // 4. Pripojenie na Tab Duel
    const duelTab = document.getElementById('duel-tab');
    if (duelTab) {
        duelTab.addEventListener('shown.bs.tab', renderDuelSimulator);
    }
});