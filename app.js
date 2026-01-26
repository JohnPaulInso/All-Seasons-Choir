let state = {
    members: [],
    sections: ['Soprano', 'Alto', 'Tenor', 'Bass'],
    activeTab: 'attendance-section',
    activeVoice: 'all',
    searchQuery: '',
    dayTitle: '',
    transactions: [],
    events: [],
    currentDate: new Date(),
    viewDate: new Date(),
    charts: {
        sunday: null,
        practice: null
    }
};

// Helper for consistent date keys (YYYY-MM-DD) in local time
const getLocalISO = (date) => {
    const d = date || new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

// RESET State to local today immediately
state.currentDate.setHours(0, 0, 0, 0);
state.viewDate.setHours(0, 0, 0, 0);
state.viewDate.setDate(1); 

// Initialize
document.addEventListener('DOMContentLoaded', async () => {
    console.log("App Initializing...");
    
    // 1. Initial UI setup (Status: Pending Data)
    updateHeaderDate();
    updateAutomaticTitle();

    // 2. Load Data First
    try {
        await loadData();
        console.log("Data loaded. Rendering attendance...");
        renderAttendance(); 
    } catch (e) {
        console.error("Data load failed:", e);
    }

    // 3. Initialize Interactive Components (Defensively)
    const initFunctions = [
        { name: 'Nav', fn: initNav },
        { name: 'VoiceTabs', fn: initVoiceTabs },
        { name: 'Search', fn: initSearch },
        { name: 'SelectAll', fn: initSelectAll },
        { name: 'DayTitle', fn: initDayTitle },
        { name: 'DateNav', fn: initDateNav },
        { name: 'Swipe', fn: initSwipe },
        { name: 'Login', fn: initLogin },
        { name: 'ScrollTop', fn: initScrollTop },
        { name: 'SaveButton', fn: initSaveButton },
        { name: 'Calendar', fn: initCalendar },
        { name: 'Finance', fn: initFinance },
        { name: 'ContextMenu', fn: initContextMenu },
        { name: 'HeaderDatePicker', fn: initHeaderDatePicker }
    ];

    initFunctions.forEach(comp => {
        try {
            comp.fn();
            console.log(`Initialized: ${comp.name}`);
        } catch (e) {
            console.warn(`Failed to initialize component: ${comp.name}`, e);
        }
    });

    console.log("App Ready.");
});

async function loadData() {
    const list = document.getElementById('attendance-list');
    try {
        const response = await fetch('infos.json');
        if (!response.ok) throw new Error(`Could not fetch infos.json (Status: ${response.status})`);
        
        const data = await response.json();
        
        state.members = data.map((m, index) => {
            let name = m.name || "Unknown Member";
            let isLeader = false;
            if (name.includes(" - Leader")) {
                isLeader = true;
                name = name.replace(" - Leader", "").trim();
            }
            let isTreasurer = false;
            if (name.includes(" - Treasurer")) {
                isTreasurer = true;
                name = name.replace(" - Treasurer", "").trim();
            }

            return {
                id: m.id || `ASC-${(index + 1).toString().padStart(3, '0')}`,
                ...m,
                name: name,
                isLeader: isLeader,
                isTreasurer: isTreasurer,
                selected: false,
                voice_type: m.voice_type || 'Unassigned',
                attendance_presents: m.attendance_presents || 0,
                attendance_absents: m.attendance_absents || 0,
                at_cebu: m.at_cebu || false,
                mostly_absent: m.mostly_absent || false,
                exemptions: m.exemptions || 0
            };
        });
        
        // Refresh selection state based on currentDate
        const dateKey = getLocalISO(state.currentDate);
        const saved = localStorage.getItem(`attendance-${dateKey}`);
        
        state.members.forEach(m => m.selected = false);
        if (saved) {
            try {
                const selectedIds = JSON.parse(saved);
                state.members.forEach(m => {
                    if (selectedIds.includes(m.id)) m.selected = true;
                });
            } catch (e) { console.warn("Saved state corrupted", e); }
        }
        
        // 4. Compute Dynamic Stats
        computeStats();
        updateAttendanceCharts();
    } catch (e) {
        console.error("Critical: loadData error", e);
        if (list) {
            list.innerHTML = `<div style="padding: 30px; text-align: center; color: var(--error);">
                <h3 style="margin-bottom:10px;">Data Error</h3>
                <p style="font-size:13px;">${e.message}</p>
                <small>Check if infos.json exists in the folder.</small>
            </div>`;
        }
    }
}

function initNav() {
    document.querySelectorAll('.nav-item').forEach(item => {
        item.addEventListener('click', () => switchTab(item.getAttribute('data-target')));
    });
}

function initVoiceTabs() {
    document.querySelectorAll('.voice-tab').forEach(tab => {
        tab.addEventListener('click', () => {
            document.querySelectorAll('.voice-tab').forEach(t => t.classList.remove('active'));
            tab.classList.add('active');
            state.activeVoice = tab.getAttribute('data-voice');
            renderAttendance();
        });
    });
}

function initSearch() {
    const input = document.getElementById('member-search');
    if (input) {
        input.addEventListener('input', (e) => {
            state.searchQuery = e.target.value.toLowerCase();
            renderAttendance();
        });
    }
}

function initSelectAll() {
    const el = document.getElementById('select-all');
    if (el) {
        el.addEventListener('change', (e) => {
            const isChecked = e.target.checked;
            getFilteredMembers().forEach(m => {
                if (!m.at_cebu && !m.mostly_absent) m.selected = isChecked;
            });
            saveAttendance(); // Auto-save for Select All
            renderAttendance();
        });
    }
}

function initDayTitle() {
    const input = document.getElementById('day-title-input');
    if (input) {
        input.addEventListener('input', (e) => {
            state.dayTitle = e.target.value;
            localStorage.setItem(`title-${getLocalISO(state.currentDate)}`, state.dayTitle);
        });
    }
}

function initDateNav() {
    const prev = document.getElementById('prev-date');
    const next = document.getElementById('next-date');
    if (prev) prev.addEventListener('click', () => changeDate(-1));
    if (next) next.addEventListener('click', () => changeDate(1));
}

function initHeaderDatePicker() {
    const title = document.getElementById('page-title');
    const picker = document.getElementById('header-date-picker');
    
    if (title && picker) {
        title.addEventListener('click', () => {
            // Set current value to picker before showing
            picker.value = getLocalISO(state.currentDate);
            picker.showPicker(); 
        });

        picker.addEventListener('change', (e) => {
            if (e.target.value) {
                const newDate = new Date(e.target.value);
                // Adjust for local time offset if needed? 
                // HTML date input returns YYYY-MM-DD which matches our setHours(0,0,0,0)
                const delta = (newDate.getTime() - state.currentDate.getTime()) / (1000 * 3600 * 24);
                if (delta !== 0) {
                    jumpToDate(newDate);
                }
            }
        });
    }
}

function jumpToDate(newDate) {
    const wrapper = document.getElementById('transition-wrapper');
    if (!wrapper) return;

    wrapper.style.opacity = '0';
    wrapper.style.transform = 'scale(0.98)';
    
    setTimeout(() => {
        state.currentDate = new Date(newDate);
        state.currentDate.setHours(0,0,0,0);

        // Reload state for new date
        state.members.forEach(m => m.selected = false);
        const saved = localStorage.getItem(`attendance-${getLocalISO(state.currentDate)}`);
        if (saved) {
            const ids = JSON.parse(saved);
            state.members.forEach(m => { if (ids.includes(m.id)) m.selected = true; });
        }

        updateHeaderDate();
        updateAutomaticTitle();
        renderAttendance();

        wrapper.style.transition = 'all 0.3s ease';
        wrapper.style.opacity = '1';
        wrapper.style.transform = 'scale(1)';
    }, 200);
}

function initSwipe() {
    let startX = 0, startY = 0;
    const area = document.getElementById('content');
    if (!area) return;
    
    area.addEventListener('touchstart', e => {
        startX = e.changedTouches[0].screenX;
        startY = e.changedTouches[0].screenY;
    }, false);

    area.addEventListener('touchend', e => {
        const dx = e.changedTouches[0].screenX - startX;
        const dy = e.changedTouches[0].screenY - startY;
        if (Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > 70) {
            changeDate(dx < 0 ? 1 : -1);
        }
    }, false);
}

function initScrollTop() {
    const btn = document.getElementById('scroll-top');
    const main = document.getElementById('content');
    if (!btn || !main) return;
    
    main.addEventListener('scroll', () => {
        btn.classList.toggle('visible', main.scrollTop > 300);
    });
    btn.addEventListener('click', () => main.scrollTo({ top: 0, behavior: 'smooth' }));
}

function initSaveButton() {
    const btn = document.getElementById('save-attendance');
    if (btn) btn.addEventListener('click', () => saveAttendance(true));
}

function saveAttendance(showNotification = false) {
    const dateKey = getLocalISO(state.currentDate);
    const selectedIds = state.members.filter(m => m.selected).map(m => m.id);
    
    if (selectedIds.length > 0) {
        localStorage.setItem(`attendance-${dateKey}`, JSON.stringify(selectedIds));
    } else {
        localStorage.removeItem(`attendance-${dateKey}`);
    }
    
    // Recalculate stats whenever we save
    computeStats();
    updateAttendanceCharts();
    renderAttendance();
    
    if (showNotification) {
        const btn = document.getElementById('save-attendance');
        const original = btn.innerHTML;
        btn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><path d="M20 6L9 17L4 12"/></svg>';
        btn.style.background = '#10B981';
        setTimeout(() => {
            btn.innerHTML = original;
            btn.style.background = '';
        }, 2000);
    }
}

function changeDate(delta) {
    const wrapper = document.getElementById('transition-wrapper');
    if (!wrapper) return;
    
    const direction = delta > 0 ? 'peek-left' : 'peek-right';
    const opposite = delta > 0 ? 'peek-right' : 'peek-left';

    wrapper.classList.add(direction);
    
    // Header swipe animation
    const headerTitles = document.querySelector('.header-titles');
    if (headerTitles) {
        headerTitles.style.transition = 'all 0.3s ease';
        headerTitles.style.transform = delta > 0 ? 'translateX(-20px)' : 'translateX(20px)';
        headerTitles.style.opacity = '0';
    }
    
    setTimeout(() => {
        state.currentDate.setDate(state.currentDate.getDate() + delta);
        
        // Reload state for new date
        state.members.forEach(m => m.selected = false);
        const saved = localStorage.getItem(`attendance-${getLocalISO(state.currentDate)}`);
        if (saved) {
            const ids = JSON.parse(saved);
            state.members.forEach(m => { if (ids.includes(m.id)) m.selected = true; });
        }

        updateHeaderDate();
        updateAutomaticTitle();
        renderAttendance();
        
        if (headerTitles) {
            headerTitles.style.transition = 'none';
            headerTitles.style.transform = delta > 0 ? 'translateX(20px)' : 'translateX(-20px)';
            headerTitles.offsetHeight; // force reflow
            headerTitles.style.transition = 'all 0.3s ease';
            headerTitles.style.transform = 'translateX(0)';
            headerTitles.style.opacity = '1';
        }

        wrapper.style.transition = 'none';
        wrapper.classList.remove(direction);
        wrapper.classList.add(opposite);
        wrapper.offsetHeight; // force reflow
        wrapper.style.transition = '';
        wrapper.classList.remove(opposite);
    }, 300);
}

function updateHeaderDate() {
    const d = state.currentDate;
    const names = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
    const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    const str = `${names[d.getDay()]}, ${months[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
    const title = document.getElementById('page-title');
    if (title) title.innerText = str;
}

function updateAutomaticTitle() {
    const day = state.currentDate.getDay();
    const stored = localStorage.getItem(`title-${getLocalISO(state.currentDate)}`);
    const input = document.getElementById('day-title-input');
    
    if (stored) {
        state.dayTitle = stored;
    } else {
        state.dayTitle = (day === 0) ? "Sunday Service" : (day === 6 ? "Practice" : "Service");
    }
    if (input) input.value = state.dayTitle;
}

function getFilteredMembers() {
    // Filter by voice type or special tab
    const filtered = state.members.filter(m => {
        if (state.activeVoice === 'at-cebu') {
            return m.at_cebu;
        } else if (state.activeVoice === 'mostly-absent') {
            return m.mostly_absent;
        } else if (state.activeVoice !== 'all') {
            return m.voice_type === state.activeVoice && !m.at_cebu && !m.mostly_absent;
        }
        return true; // If 'all' or no specific filter, include all
    });

    // Apply search query
    let searched = filtered;
    if (state.searchQuery) {
        const q = state.searchQuery.toLowerCase();
        searched = filtered.filter(m => 
            m.name.toLowerCase().includes(q) || m.id.toLowerCase().includes(q)
        );
    }

    // Sort: Leaders/Treasurers first, then by name
    return searched.sort((a, b) => {
        const aIsSpecial = a.isLeader || a.isTreasurer;
        const bIsSpecial = b.isLeader || b.isTreasurer;

        if (aIsSpecial && !bIsSpecial) return -1;
        if (!aIsSpecial && bIsSpecial) return 1;
        return a.name.localeCompare(b.name);
    });
}

function switchTab(targetId) {
    document.querySelectorAll('.nav-item').forEach(b => {
        b.classList.toggle('active', b.getAttribute('data-target') === targetId);
    });
    document.querySelectorAll('.page-content').forEach(s => {
        s.classList.toggle('active', s.id === targetId);
    });

    const labels = {
        'attendance-section': 'ATTENDANCE',
        'calendar-section': 'CALENDAR',
        'sinking-fund-section': 'FINANCE',
        'members-section': 'MEMBERS'
    };
    
    const label = document.getElementById('page-label');
    if (label) label.innerText = labels[targetId] || 'APP';
    
    if(targetId === 'attendance-section') {
        updateHeaderDate();
        renderAttendance();
    } else if(targetId === 'calendar-section') {
        const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
        const title = document.getElementById('page-title');
        if (title) title.innerText = `${months[state.viewDate.getMonth()]} ${state.viewDate.getFullYear()}`;
        renderCalendar();
    } else {
        const title = document.getElementById('page-title');
        if (title) title.innerText = labels[targetId].charAt(0) + labels[targetId].slice(1).toLowerCase();
    }

    if(targetId === 'sinking-fund-section') renderFinance();
    if(targetId === 'members-section') renderMembers();
}

function renderAttendance() {
    const list = document.getElementById('attendance-list');
    if (!list) return;
    
    const filtered = getFilteredMembers();
    const count = document.querySelector('.member-count');
    if (count) count.innerText = `${filtered.length} Members`;
    
    // Update Select All Label with counter
    const selectedCount = filtered.filter(m => m.selected && !m.at_cebu && !m.mostly_absent).length;
    const selectAllLabel = document.getElementById('select-all-label');
    if (selectAllLabel) {
        selectAllLabel.innerText = `Select All (${selectedCount})`;
    }
    
    updateSummary();

    const selectAll = document.getElementById('select-all');
    if (selectAll) {
        const selectable = filtered.filter(m => !m.at_cebu && !m.mostly_absent);
        selectAll.checked = selectable.length > 0 && selectable.every(m => m.selected);
    }

    const fragment = document.createDocumentFragment();

    // Sections
    state.sections.forEach(section => {
        const members = filtered.filter(m => m.voice_type === section && !m.at_cebu && !m.mostly_absent);
        if (members.length === 0) return;

        const h = document.createElement('div');
        h.className = 'section-header';
        h.innerText = section;
        fragment.appendChild(h);

        members.forEach(m => fragment.appendChild(createMemberItem(m)));
    });

    // 2. Mostly Absent Section
    const mostlyAbsentMembers = filtered.filter(m => m.mostly_absent);
    if (mostlyAbsentMembers.length > 0) {
        const header = document.createElement('div');
        header.className = 'section-header';
        header.innerText = 'Mostly Absent';
        fragment.appendChild(header);
        mostlyAbsentMembers.forEach(m => fragment.appendChild(createMemberItem(m)));
    }

    // 3. Unassigned
    const others = filtered.filter(m => !state.sections.includes(m.voice_type) && !m.at_cebu && !m.mostly_absent);
    if (others.length > 0) {
        const h = document.createElement('div');
        h.className = 'section-header';
        h.innerText = 'Others';
        fragment.appendChild(h);
        others.forEach(m => fragment.appendChild(createMemberItem(m)));
    }

    // 4. Cebu
    const cebu = filtered.filter(m => m.at_cebu);
    if (cebu.length > 0) {
        const h = document.createElement('div');
        h.className = 'section-header';
        h.innerText = 'Mostly Absent (At Cebu)';
        fragment.appendChild(h);
        cebu.forEach(m => fragment.appendChild(createMemberItem(m)));
    }

    list.innerHTML = '';
    list.appendChild(fragment);
}

function createMemberItem(m) {
    const div = document.createElement('div');
    div.className = `member-item ${m.at_cebu ? 'at-cebu-member' : ''}`;
    div.dataset.id = m.id;
    div.onclick = () => toggleMember(m.id);
    
    // Long Press Handling
    let pressTimer;
    const startPress = (e) => {
        if (e.type === 'click' && e.button !== 0) return;
        pressTimer = setTimeout(() => showContextMenu(e, m), 600);
    };
    const cancelPress = () => clearTimeout(pressTimer);

    div.addEventListener('mousedown', startPress);
    div.addEventListener('touchstart', startPress, {passive: true});
    div.addEventListener('mouseup', cancelPress);
    div.addEventListener('mouseleave', cancelPress);
    div.addEventListener('touchend', cancelPress);
    div.addEventListener('touchmove', cancelPress);

    const initials = (m.name || "??").split(' ').filter(n => n).map(n => n[0]).join('').slice(0, 2).toUpperCase();
    
    div.innerHTML = `
        <div class="member-avatar">${initials}</div>
        <div class="member-info">
            <div class="member-name-row">
                <div class="member-name">${m.name}</div>
                ${m.isLeader ? '<div class="leader-chip">Leader</div>' : ''}
                ${m.isTreasurer ? '<div class="treasurer-chip">Treasurer</div>' : ''}
            </div>
            <div class="member-id-row">
                <span class="member-id">ID: ${m.id}</span>
                <span class="stat-mini p">P: ${m.attendance_presents || 0}</span>
                <span class="stat-mini a">A: ${m.attendance_absents || 0}</span>
                ${m.at_cebu ? '<span class="exemption-badge">At Cebu</span>' : ''}
            </div>
        </div>
        <div class="checkbox-container ${m.selected ? 'checked' : ''}">
            <input type="checkbox" ${m.selected ? 'checked' : ''} tabindex="-1">
        </div>
    `;
    return div;
}

function initContextMenu() {
    window.addEventListener('click', hideContextMenu);
    window.addEventListener('scroll', hideContextMenu, true);
}

function showContextMenu(e, member) {
    hideContextMenu();
    
    const x = e.touches ? e.touches[0].clientX : e.clientX;
    const y = e.touches ? e.touches[0].clientY : e.clientY;

    const backdrop = document.createElement('div');
    backdrop.className = 'menu-backdrop';
    backdrop.id = 'menu-backdrop';
    backdrop.onclick = hideContextMenu;
    document.body.appendChild(backdrop);

    const menu = document.createElement('div');
    menu.className = 'context-menu';
    menu.id = 'context-menu';
    
    const actions = [
        { 
            label: 'View Profile', 
            icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>`, 
            action: () => alert(`Viewing profile of ${member.name}`), 
            color: 'menu-blue' 
        },
        { 
            label: member.selected ? 'Mark Absent' : 'Mark Present', 
            icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>`, 
            action: () => toggleMember(member.id), 
            color: 'menu-green' 
        },
        { 
            label: 'Move to Mostly Absent', 
            icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>`, 
            action: () => updateMemberFlag(member.id, 'mostly_absent', true), 
            color: 'menu-yellow' 
        },
        { 
            label: 'Mark as At Cebu', 
            icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>`, 
            action: () => updateMemberFlag(member.id, 'at_cebu', true), 
            color: 'menu-yellow' 
        }
    ];

    actions.forEach(item => {
        const div = document.createElement('div');
        div.className = `menu-item ${item.color}`;
        div.innerHTML = `<span class="menu-icon">${item.icon}</span> <span>${item.label}</span>`;
        div.onclick = (ev) => {
            ev.stopPropagation();
            item.action();
            hideContextMenu();
        };
        menu.appendChild(div);
    });

    document.body.appendChild(menu);

    // Position adjustments
    const rect = menu.getBoundingClientRect();
    let finalX = x;
    let finalY = y;

    if (x + rect.width > window.innerWidth) finalX = window.innerWidth - rect.width - 10;
    if (y + rect.height > window.innerHeight) finalY = window.innerHeight - rect.height - 10;

    menu.style.left = `${finalX}px`;
    menu.style.top = `${finalY}px`;
}

function hideContextMenu() {
    const menu = document.getElementById('context-menu');
    const backdrop = document.getElementById('menu-backdrop');
    if (menu) menu.remove();
    if (backdrop) backdrop.remove();
}

function updateMemberFlag(id, flag, value) {
    const m = state.members.find(m => m.id === id);
    if (m) {
        m[flag] = value;
        // In a real app, we'd persist this back to the server. 
        // For now, it stays in state during the session.
        computeStats(); // Recompute in case flags changed (though currently flags are global)
        renderAttendance();
    }
}

function computeStats() {
    // 1. Reset dynamic fields using base stats from infos.json if available
    // (Note: in loadData we already mapped them, but we need to reset to the original base)
    // For simplicity, let's assume the current state.members values are the 'original' 
    // but we need to avoid double-counting if computeStats is called multiple times.
    // So we need a reference to the 'base' values.
    
    // Better way: Store base values in a separate property if they aren't there
    state.members.forEach(m => {
        if (m.baseP === undefined) m.baseP = m.attendance_presents || 0;
        if (m.baseA === undefined) m.baseA = m.attendance_absents || 0;
        m.attendance_presents = m.baseP;
        m.attendance_absents = m.baseA;
    });

    // 2. Fetch all attendance records from localStorage
    const records = [];
    for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key.startsWith('attendance-')) {
            try {
                records.push(JSON.parse(localStorage.getItem(key)));
            } catch(e) {}
        }
    }

    // 3. Aggregate
    records.forEach(presentIds => {
        state.members.forEach(m => {
            if (presentIds.includes(m.id)) {
                m.attendance_presents++;
            } else {
                // If they are not present, they are absent UNLESS they are At Cebu
                // (Assuming "At Cebu" is a current status that implies past exemptions too)
                if (!m.at_cebu) {
                    m.attendance_absents++;
                }
            }
        });
    });
}

function updateAttendanceCharts() {
    const ctxSunday = document.getElementById('sundayChart');
    const ctxPractice = document.getElementById('practiceChart');
    if (!ctxSunday || !ctxPractice) return;

    let sunPresent = 0, sunAbsent = 0;
    let pracPresent = 0, pracAbsent = 0;

    const totalMembers = state.members.filter(m => !m.at_cebu).length; // Exclude Cebu from denominator
    if (totalMembers === 0) return;

    // Iterate through all records in localStorage
    for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key.startsWith('attendance-')) {
            const dateStr = key.replace('attendance-', '');
            if (dateStr < '2026-01-01') continue;

            const [y, m, d] = dateStr.split('-').map(Number);
            const date = new Date(y, m - 1, d);
            
            const isSunday = date.getDay() === 0;
            const isSaturday = date.getDay() === 6;
            
            if (!isSunday && !isSaturday) continue;

            const presentIds = JSON.parse(localStorage.getItem(key));
            // Only count presents who are NOT at_cebu currently (or just use length if at_cebu is updated)
            // To be precise, we filter presentIds against current members who are NOT in Cebu
            const currentNonCebuIds = state.members.filter(mem => !mem.at_cebu).map(mem => mem.id);
            const validPresentCount = presentIds.filter(pid => currentNonCebuIds.includes(pid)).length;
            const validAbsentCount = totalMembers - validPresentCount;

            if (isSunday) {
                sunPresent += validPresentCount;
                sunAbsent += validAbsentCount;
            } else if (isSaturday) {
                pracPresent += validPresentCount;
                pracAbsent += validAbsentCount;
            }
        }
    }

    const sunTotal = sunPresent + sunAbsent;
    const pracTotal = pracPresent + pracAbsent;
    const sunRate = sunTotal > 0 ? Math.round((sunPresent / sunTotal) * 100) : 0;
    const pracRate = pracTotal > 0 ? Math.round((pracPresent / pracTotal) * 100) : 0;
    
    // UI Helpers
    const drawCenterText = (chart, rate) => {
        const {ctx, width, height} = chart;
        ctx.save();
        ctx.font = "bold 16px Inter";
        ctx.fillStyle = "#1E293B";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(`${rate}%`, width / 2, height / 2);
        ctx.restore();
    };

    const plugin = {
        id: 'centerText',
        afterDraw: (chart) => {
            if (chart.config.options.elements.centerText) {
                drawCenterText(chart, chart.config.options.elements.centerText);
            }
        }
    };

    // Sunday Chart
    if (state.charts.sunday) state.charts.sunday.destroy();
    state.charts.sunday = new Chart(ctxSunday, {
        type: 'doughnut',
        plugins: [plugin],
        data: {
            labels: ['Present', 'Absent'],
            datasets: [{
                data: [sunPresent || 0, sunAbsent || (sunPresent ? 0 : 1)],
                backgroundColor: ['#FF8C00', '#F1F5F9'],
                borderWidth: 0,
                hoverOffset: 4
            }]
        },
        options: {
            cutout: '60%', // Slightly thicker than before
            plugins: { legend: { display: false }, tooltip: { enabled: true } },
            elements: { centerText: sunRate }
        }
    });

    // Practice Chart
    if (state.charts.practice) state.charts.practice.destroy();
    state.charts.practice = new Chart(ctxPractice, {
        type: 'doughnut',
        plugins: [plugin],
        data: {
            labels: ['Present', 'Absent'],
            datasets: [{
                data: [pracPresent || 0, pracAbsent || (pracPresent ? 0 : 1)],
                backgroundColor: ['#3B82F6', '#F1F5F9'],
                borderWidth: 0,
                hoverOffset: 4
            }]
        },
        options: {
            cutout: '60%', // Slightly thicker than before
            plugins: { legend: { display: false }, tooltip: { enabled: true } },
            elements: { centerText: pracRate }
        }
    });

    // Update Status Labels
    updateStatusLabel('sunday', sunRate);
    updateStatusLabel('practice', pracRate);

    // Click to view absent members (Dropdown/Modal) - only on canvas click
    const sundayCard = document.getElementById('sundayChart').parentElement;
    const practiceCard = document.getElementById('practiceChart').parentElement;
    
    // Remove any existing listeners
    sundayCard.onclick = null;
    practiceCard.onclick = null;
    
    // Add click listener only to the canvas itself
    document.getElementById('sundayChart').onclick = (e) => {
        e.stopPropagation();
        showAbsentDetails('Sunday Services', '0');
    };
    document.getElementById('practiceChart').onclick = (e) => {
        e.stopPropagation();
        showAbsentDetails('Practices', '6');
    };
}

function updateStatusLabel(type, rate) {
    const card = document.getElementById(type === 'sunday' ? 'sundayChart' : 'practiceChart').parentElement;
    let label = card.querySelector('.chart-status');
    if (!label) {
        label = document.createElement('div');
        label.className = 'chart-status';
        card.appendChild(label);
    }
    
    let statusText, statusClass;
    if (rate >= 85) {
        statusText = "Excellent";
        statusClass = "status-excellent";
    } else if (rate >= 70) {
        statusText = "Good";
        statusClass = "status-good";
    } else {
        statusText = "Needs Improvement";
        statusClass = "status-poor";
    }
    
    label.innerHTML = `<span class="status-prefix">Status:</span> <span class="status-chip ${statusClass}">${statusText}</span>`;
}

function showAbsentDetails(title, dayNum) {
    // Collect all unique members who have been absent in this category since 2026-01-01
    const absentCounts = {};
    const totalSessions = 0;
    
    for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key.startsWith('attendance-')) {
            const dateStr = key.replace('attendance-', '');
            if (dateStr < '2026-01-01') continue;
            const [y, m, d] = dateStr.split('-').map(Number);
            const date = new Date(y, m - 1, d);
            if (date.getDay().toString() !== dayNum) continue;

            const presentIds = JSON.parse(localStorage.getItem(key));
            state.members.forEach(m => {
                if (!m.at_cebu && !presentIds.includes(m.id)) {
                    absentCounts[m.id] = (absentCounts[m.id] || 0) + 1;
                }
            });
        }
    }

    const sortedAbsentees = Object.entries(absentCounts)
        .map(([id, count]) => ({ member: state.members.find(m => m.id === id), count }))
        .filter(entry => entry.member)
        .sort((a, b) => b.count - a.count);

    if (sortedAbsentees.length === 0) {
        alert(`Great news! No absences recorded for ${title} yet.`);
        return;
    }

    const modalHtml = `
        <div class="absent-modal" id="absent-modal">
            <div class="absent-modal-content">
                <div class="absent-modal-header">
                    <h3>${title} - Absentees</h3>
                    <button onclick="document.getElementById('absent-modal').remove()">×</button>
                </div>
                <div class="absent-modal-list">
                    ${sortedAbsentees.map(a => `
                        <div class="absent-row">
                            <span>${a.member.name}</span>
                            <span class="absent-count">${a.count}x</span>
                        </div>
                    `).join('')}
                </div>
            </div>
        </div>
    `;
    document.body.insertAdjacentHTML('beforeend', modalHtml);
}

function toggleMember(id) {
    const m = state.members.find(m => m.id === id);
    if (m) {
        m.selected = !m.selected;
        saveAttendance();
        renderAttendance();
    }
}

function updateSummary() {
    const presentCount = document.getElementById('summary-present');
    const absentCount = document.getElementById('summary-absent');
    const exemptCount = document.getElementById('summary-exempt');
    if (!presentCount || !absentCount || !exemptCount) return;

    const filtered = getFilteredMembers();
    presentCount.innerText = filtered.filter(m => m.selected && !m.at_cebu).length;
    absentCount.innerText = filtered.filter(m => !m.selected && !m.at_cebu).length;
    exemptCount.innerText = filtered.filter(m => m.at_cebu).length;
}

// STUBS for missing functions to prevent crashes
function initLogin() {}
function initCalendar() {}
function initFinance() {}
function renderCalendar() {
    const grid = document.getElementById('calendar-grid');
    if (grid) grid.innerHTML = '<div style="padding:20px;text-align:center;">Calendar View</div>';
}
function renderFinance() {
    const hist = document.getElementById('transaction-history');
    if (hist) hist.innerHTML = '<div style="padding:20px;text-align:center;">Finance History</div>';
}
function renderMembers() {
    const list = document.getElementById('members-list');
    if (list) {
        list.innerHTML = state.members.map(m => `
            <div class="member-card" style="padding:15px; margin-bottom:10px; background:white; border-radius:12px; border:1px solid #eee;">
                <strong>${m.name}</strong><br><small>${m.voice_type} • ID: ${m.id}</small>
            </div>
        `).join('');
    }
}
