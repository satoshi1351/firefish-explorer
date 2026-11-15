// cycle.js - Interaktívny zmluvný sprievodca Firefish.io napojený na LaSA a CSV dáta

function getLoanStages() {
    return [
        { id: 'origination', icon: 'bi-lock-fill', color: 'primary', title: t('guide_s1_title'), content: t('guide_s1_content') },
        { id: 'disbursement_conf', icon: 'bi-bank', color: 'info', title: t('guide_s2_title'), content: t('guide_s2_content') },
        { id: 'disbursement_res', icon: 'bi-shield-exclamation', color: 'danger', title: t('guide_s3_title'), content: t('guide_s3_content') },
        { id: 'monitoring', icon: 'bi-activity', color: 'warning', title: t('guide_s4_title'), content: t('guide_s4_content') },
        { id: 'liquidation', icon: 'bi-fire', color: 'danger', title: t('guide_s5_title'), content: t('guide_s5_content') },
        { id: 'maturity_conf', icon: 'bi-calendar2-check', color: 'info', title: t('guide_s6_title'), content: t('guide_s6_content') },
        { id: 'maturity_res', icon: 'bi-hammer', color: 'danger', title: t('guide_s7_title'), content: t('guide_s7_content') },
        { id: 'closed', icon: 'bi-check-circle-fill', color: 'success', title: t('guide_s8_title'), content: t('guide_s8_content') }
    ];
}

// Koľko dní pred splatnosťou posiela Firefish e-mail "Pripomienka splatnosti investície".
// Od tohto dňa zmluva prechádza z Monitorovania do fázy 6. Splatnosť.
const MATURITY_REMINDER_DAYS = 7;

// Zmluvy pre Cyklus: celé portfólio aktuálnej roly, NEZÁVISLE od filtra statusu
function getCycleLoans() {
    const appState = typeof state !== 'undefined' ? state : (window.state || null);
    if (!appState || !appState.rawData) return [];
    return appState.rawData.filter(d => d.role === appState.currentRoleView);
}

// Zmluva po splatnosti, ktorá je v CSV stále ACTIVE (čaká na potvrdenie / čerstvý CSV)
function isLoanAwaiting(loan) {
    if (!loan.isActive || loan.isSimulated || !loan.endDate) return false;
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const end = new Date(loan.endDate); end.setHours(0, 0, 0, 0);
    return today >= end;
}

// Funkcia, ktorá roztriedi reálne zmluvy na základe ich aktuálneho stavu a dátumov
function getLoansByStage(stageId) {
    const appState = typeof state !== 'undefined' ? state : (window.state || null);

    const cycleLoans = getCycleLoans();
    if (!appState || cycleLoans.length === 0) {
        return []; 
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0); 
    const MS_IN_DAY = 1000 * 60 * 60 * 24;

    // --- NOVINKA: PREPOJENIE NA STRESS TEST ---
    // Zistíme hodnotu posuvníka (ak je posunutý na -50, hodnota bude -50)
    const stressSlider = document.getElementById('stressSlider');
    const stressDrop = stressSlider ? parseInt(stressSlider.value) : 0;
    
    // Vypočítame simulovanú cenu BTC (reálna cena upravená o stress test)
    const effectiveBtcPrice = appState.currentBtcPrice * (1 + stressDrop / 100);

    return cycleLoans.filter(loan => {
        // Ukončené zmluvy (aj predčasne splatené) patria výhradne do položky "Ukončené"
        if (loan.isClosed || loan.status === 'CLOSED') return stageId === 'closed';
        if (stageId === 'closed') return false;
        // Zrušené zmluvy do cyklu nepatria
        if (loan.status === 'CANCELED') return false;

        const startDate = loan.startDate ? new Date(loan.startDate) : null;
        if (startDate) startDate.setHours(0, 0, 0, 0);
        
        const endDate = loan.endDate ? new Date(loan.endDate) : null;
        if (endDate) endDate.setHours(0, 0, 0, 0);

        const diffStartDays = startDate ? Math.floor((today - startDate) / MS_IN_DAY) : null;
        const diffEndDays = endDate ? Math.floor((today - endDate) / MS_IN_DAY) : null;
        
        // Zisťujeme aktuálne LTV pomocou EFEKTÍVNEJ (simulovanej) ceny BTC
        let isLiquidated = false;
        if (loan.collateralBtc && loan.collateralBtc > 0 && effectiveBtcPrice) {
            const currentBtcValue = loan.collateralBtc * effectiveBtcPrice;
            const currentLtv = (loan.due) / currentBtcValue * 100;
            if (currentLtv >= 95) { // Likvidačná hranica LaSA
                isLiquidated = true;
            }
        }

        if (diffStartDays === null) {
            return stageId === 'origination';
        }

        switch(stageId) {
            case 'origination':
                return diffStartDays < 0; 
            case 'disbursement_conf':
                return diffStartDays >= 0 && diffStartDays <= 4;
            case 'disbursement_res':
                return diffStartDays > 4 && diffStartDays <= 11;
            case 'monitoring':
                return diffStartDays > 11 && diffEndDays < -MATURITY_REMINDER_DAYS && !isLiquidated;
            case 'liquidation':
                return isLiquidated; // Ak Stress Test stlačí cenu dole, pôžička spadne sem!
            case 'maturity_conf':
                // Začína pripomienkou pred splatnosťou a trvá do 4. dňa po nej
                return diffStartDays > 11 && diffEndDays >= -MATURITY_REMINDER_DAYS && diffEndDays <= 4 && !isLiquidated;
            case 'maturity_res':
                // Sem sa dostanú len zmluvy, ktoré sú v CSV stále otvorené viac než 4 dni po splatnosti
                return diffStartDays > 11 && diffEndDays > 4 && !isLiquidated;
            default:
                return false;
        }
    });
}

function renderGuide() {
    const menuContainer = document.getElementById('guideTimelineMenu');
    if (!menuContainer) return;

    const stages = getLoanStages();
    let menuHTML = '<div class="list-group list-group-flush timeline-nav">';
    
    stages.forEach((stage, index) => {
        const activeClasses = index === 0 ? 'bg-body-secondary border-start border-4 border-info fw-bold' : 'border-start border-4 border-transparent';
        
        // Zistenie počtu pôžičiek pre túto fázu
        const activeLoansInStage = getLoansByStage(stage.id);
        const badgeHTML = activeLoansInStage.length > 0 
            ? `<span class="badge bg-${stage.color} rounded-pill ms-auto shadow-sm">${activeLoansInStage.length}</span>` 
            : '';

        menuHTML += `
            <button class="list-group-item list-group-item-action border-0 mb-1 rounded d-flex align-items-center ${activeClasses}" 
                    data-stage="${stage.id}" 
                    style="border-color: transparent;"
                    onclick="switchGuideStage('${stage.id}')">
                <i class="bi ${stage.icon} fs-4 text-${stage.color} me-3"></i>
                <span class="text-start flex-grow-1">${stage.title}</span>
                ${badgeHTML}
            </button>
        `;
    });
    menuHTML += '</div>';
    menuContainer.innerHTML = menuHTML;
    
    // Automaticky načítaj prvú fázu
    switchGuideStage(stages[0].id);
}

window.switchGuideStage = function(stageId) {
    const buttons = document.querySelectorAll('#guideTimelineMenu .list-group-item');
    buttons.forEach(btn => {
        if (btn.getAttribute('data-stage') === stageId) {
            btn.classList.add('bg-body-secondary', 'border-info', 'fw-bold');
        } else {
            btn.classList.remove('bg-body-secondary', 'border-info', 'fw-bold');
        }
    });

    const stageData = getLoanStages().find(s => s.id === stageId);
    if (stageData) {
        const contentContainer = document.getElementById('guideStepDetail');
        contentContainer.style.opacity = '0';
        
        // Získame reálne pôžičky pre túto fázu
        const matchedLoans = getLoansByStage(stageId);
        let loansHTML = '';

        if (matchedLoans.length > 0) {
            const appState = typeof state !== 'undefined' ? state : (window.state || {});
            const currency = appState.currencySymbol || '€';

            loansHTML = `<div class="mt-4 pt-3 border-top border-light-subtle">
                            <h6 class="text-body-emphasis fw-bold mb-3">
                                <i class="bi bi-folder2-open me-2 text-primary"></i>${t('guide_active_loans') || 'Zmluvy aktuálne v tejto fáze:'}
                            </h6>
                            <div class="list-group shadow-sm">`;
            
            matchedLoans.forEach(loan => {
                const badgeStr = loan.isSimulated ? '<i class="bi bi-calculator me-1"></i> SIM' : loan.id;
                const badgeClass = loan.isSimulated ? 'bg-primary' : 'bg-secondary';
                
                loansHTML += `
                    <div class="list-group-item list-group-item-action d-flex justify-content-between align-items-center bg-body">
                        <div>
                            <span class="badge ${badgeClass} me-2">${badgeStr}</span>
                            <span class="fw-medium">${loan.borrowerId || loan.investorId || 'Zmluva'}</span>
                        </div>
                        <div class="text-end">
                            <div class="fw-bold text-body-emphasis">${Number(loan.invested || loan.due).toLocaleString()} ${currency}</div>
                            <small class="text-muted text-micro">${t('guide_maturity') || 'Splatnosť:'} ${loan.rawMaturity || '-'}</small>
                            ${(stageId === 'closed' && loan.rawClosedAt) ? `<small class="text-success text-micro d-block">${t('guide_closed_at')} ${loan.rawClosedAt}</small>` : ''}
                        </div>
                    </div>`;
            });
            loansHTML += `</div>`;
            if (matchedLoans.some(isLoanAwaiting)) {
                loansHTML += `<div class="alert alert-warning small mt-3 mb-0"><i class="bi bi-cloud-upload me-1"></i>${t('guide_awaiting_hint')}</div>`;
            }
            loansHTML += `</div>`;
        } else {
            loansHTML = `<div class="mt-4 pt-3 border-top border-light-subtle text-center text-muted opacity-50">
                            <i class="bi bi-inbox fs-3 d-block mb-2"></i>
                            <small>${t('guide_no_loans') || 'V tejto fáze sa aktuálne nenachádzajú žiadne zmluvy.'}</small>
                         </div>`;
        }

        setTimeout(() => {
    contentContainer.innerHTML = `
        <div class="w-100 bg-body p-4 rounded shadow-sm border border-light-subtle">
            ${stageData.content}
            ${stageId === 'maturity_conf' ? `<p class="text-muted small"><i class="bi bi-envelope me-1"></i>${t('guide_s6_note').replace('{days}', MATURITY_REMINDER_DAYS)}</p>` : ''}
            ${loansHTML}
            
            <div class="alert alert-secondary border-0 mt-4 mb-0 text-center small opacity-75">
                <i class="bi bi-info-circle me-1"></i> ${t('guide_disclaimer')}
            </div>
        </div>`;
    contentContainer.style.transition = 'opacity 0.2s ease-in-out';
    contentContainer.style.opacity = '1';
}, 150);
    }
}

// Inicializácia pri otvorení modalu
document.addEventListener('DOMContentLoaded', () => {
    const cycleModal = document.getElementById('cycleModal');
    if (cycleModal) {
        cycleModal.addEventListener('show.bs.modal', renderGuide);
    }
});