let state = {
    members: [],
    sections: ['Soprano', 'Alto', 'Tenor', 'Bass', 'Choir Director'],
    activeTab: 'attendance-section',
    activeVoice: 'all',
    searchQuery: '',
    dayTitle: '',
    transactions: [],
    events: [],
    currentDate: new Date(),
    viewDate: new Date(),
    charts: {
        attendance: null
    },
    listeners: {
        members: null,
        attendance: null
    },
    attendanceRecords: [], // Cache for all historical records
    currentPresentIds: []  // Source of truth for checkboxes on CURRENT date
};

// Helper for consistent date keys (YYYY-MM-DD) in local time
const getLocalISO = (date) => {
    const d = date || new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

// Safety helper to clean up stuck Bootstrap backdrops
function forceCleanupBackdrop() {
    const backdrops = document.querySelectorAll('.modal-backdrop');
    backdrops.forEach(b => b.remove());
    document.body.classList.remove('modal-open');
    document.body.style.overflow = '';
    document.body.style.paddingRight = '';
}

// Helper to get SMART Initial Date (Sunday -> Today, else -> Next Saturday)
function getInitialDate() {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    const day = d.getDay();
    
    // If it's Sunday (0), stay on today
    if (day === 0) return d;
    
    // Otherwise, find the next Saturday (6)
    const diff = (6 - day + 7) % 7;
    const target = new Date(d);
    target.setDate(d.getDate() + (diff === 0 ? 0 : diff)); // If today is Sat, stay Sat
    return target;
}

// Initialize State with persistence
const savedDate = localStorage.getItem('lastOpenedDate');
if (savedDate && !isNaN(Date.parse(savedDate))) {
    state.currentDate = new Date(savedDate);
} else {
    state.currentDate = getInitialDate();
}
state.currentDate.setHours(0, 0, 0, 0);

state.viewDate = new Date(state.currentDate);
state.viewDate.setHours(0, 0, 0, 0);
state.viewDate.setDate(1); 

// Initialize
document.addEventListener('DOMContentLoaded', async () => {
    console.log("App Initializing...");
    
    // Ensure FirebaseService is available (waitForModule if needed)
    let retryCount = 0;
    while (!window.FirebaseService && retryCount < 50) {
        await new Promise(r => setTimeout(r, 100));
        retryCount++;
    }

    if (!window.FirebaseService) {
        console.error("FirebaseService failed to load after 5 seconds. App might be broken.");
        const title = document.getElementById('page-title');
        if (title) title.innerText = "Error: Service Unavailable";
        return;
    }

    // 1. Initial UI setup (Status: Pending Auth)
    updateHeaderDate();
    updateAutomaticTitle();

    // 2. Initialize Interactive Components
    // We init them early so they are ready, but display:none on #app 
    // keeps them hidden until initAuth -> onAuthChange(user)

    // 3. Initialize Interactive Components (Defensively)
    const initFunctions = [
        { name: 'Auth', fn: initAuth },
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

async function fetchAttendanceRecord(date) {
    const dateKey = getLocalISO(date);
    let record = await window.FirebaseService.fetchData('attendance_records', dateKey);
    
    if (!record) {
        // Fallback to local
        const saved = localStorage.getItem(`attendance-${dateKey}`);
        const savedTitle = localStorage.getItem(`title-${dateKey}`);
        if (saved) {
            record = {
                presentIds: JSON.parse(saved),
                title: savedTitle || ""
            };
        }
    }
    return record;
}

async function loadData() {
    // 1. Live Listen to Members (Global List)
    if (state.listeners.members) state.listeners.members(); // Cleanup old
    
    state.listeners.members = window.FirebaseService.listenToDoc('app_data', 'members_list', (data) => {
        if (data && data.members) {
            processMembersUpdate(data.members);
        } else {
            // Initial seed if totally empty
            fetch('infos.json').then(r => r.json()).then(json => {
                if (window.FirebaseService && window.FirebaseService.currentUser) {
                    window.FirebaseService.saveData('app_data', 'members_list', { members: json });
                }
            }).catch(err => console.error("Could not load backup infos.json:", err));
        }
    });

    // 2. Pre-load Cache from Local Storage (Zero-Lag Start)
    const localRecords = [];
    for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key.startsWith('attendance_records-')) {
            try {
                const data = JSON.parse(localStorage.getItem(key));
                if (data) localRecords.push({ id: key.replace('attendance_records-', ''), ...data });
            } catch(e) {}
        }
    }
    state.attendanceRecords = localRecords;

    // 3. Fetch fresh historical attendance from Firestore
    const cloudRecords = await window.FirebaseService.fetchAllDocs('attendance_records');
    
    // 4. MIGRATION: Push any missing or newer local records to Cloud
    // This handles the "store to firebase from localstorage too" request
    for (const local of localRecords) {
        const cloudMatch = cloudRecords.find(r => r.id === local.id);
        
        // If it's missing from cloud or local is newer (idempotency safety)
        if (!cloudMatch || (local.updatedAt && cloudMatch.updatedAt && local.updatedAt > cloudMatch.updatedAt)) {
            console.log(`Migrating local record ${local.id} to cloud...`);
            window.FirebaseService.saveData('attendance_records', local.id, local);
        }
    }

    state.attendanceRecords = cloudRecords;
    console.log(`Synced ${cloudRecords.length} records from cloud.`);

    // 5. REFRESH EVERYTHING after cloud sync (Persistence Fix)
    await computeStats();
    await updateAttendanceCharts();
    renderAttendance();

    // 6. Setup Attendance Listener for CURRENT date
    refreshAttendanceListener();
}

function processMembersUpdate(membersData) {
    state.members = membersData.map((m, index) => {
        let name = m.name || "Unknown Member";
        let isLeader = name.includes(" - Leader");
        let isTreasurer = name.includes(" - Treasurer");
        let isDirector = name.includes(" - Choir Director");
        name = name.replace(" - Leader", "").replace(" - Treasurer", "").replace(" - Choir Director", "").trim();

        // Special override for Panchonilo Pedroza
        if (name.toLowerCase().includes("panchonilo")) {
            m.voice_type = "Choir Director";
            isDirector = true;
        }

        return {
            id: m.id || `ASC-${(index + 1).toString().padStart(3, '0')}`,
            ...m,
            name: name,
            isLeader: isLeader || m.isLeader,
            isTreasurer: isTreasurer || m.isTreasurer,
            isDirector: isDirector || m.isDirector,
            selected: state.currentPresentIds.includes(m.id || `ASC-${(index + 1).toString().padStart(3, '0')}`),
            voice_type: m.voice_type || 'Unassigned',
            at_cebu: m.at_cebu || false,
            mostly_absent: m.mostly_absent || false
        };
    });
    
    // Recalculate stats immediately since we have a pre-loaded cache
    computeStats().then(() => {
        renderAttendance();
        renderMembers();
    });
}

async function refreshAttendanceListener() {
    if (state.listeners.attendance) state.listeners.attendance(); // Unsubscribe
    
    const dateKey = getLocalISO(state.currentDate);
    
    // 1. Immediately check cache for the new date (Instant Feel)
    const cachedRecord = state.attendanceRecords.find(r => r.id === dateKey);
    if (cachedRecord) {
        state.currentPresentIds = cachedRecord.presentIds || [];
        state.dayTitle = cachedRecord.title || "";
    } else {
        state.currentPresentIds = [];
        state.dayTitle = "";
    }

    // Apply selection to existing members immediately
    state.members.forEach(m => {
        m.selected = state.currentPresentIds.includes(m.id);
    });
    
    updateAutomaticTitle();
    await computeStats();
    await updateAttendanceCharts();
    renderAttendance();

    // 2. Setup Real-time Listener (Sync with cloud)
    state.listeners.attendance = window.FirebaseService.listenToDoc('attendance_records', dateKey, async (record) => {
        if (!record) {
            // Document deleted or doesn't exist yet
            // If local state is already empty, no need to refresh UI
            if (state.currentPresentIds.length === 0 && state.dayTitle === "") return;

            console.log("Cloud record removed. Resetting local state.");
            state.currentPresentIds = [];
            state.dayTitle = "";
            state.members.forEach(m => m.selected = false);
        } else {
            // ANTI-FLICKER SHIELD: 
            // If the incoming cloud data matches our local "current" state, ignore it.
            // This prevents "re-checking" an item we just unchecked.
            const incomingIds = (record.presentIds || []).sort().join(',');
            const localIds = [...state.currentPresentIds].sort().join(',');
            
            if (incomingIds === localIds && (record.title || "") === state.dayTitle) {
                console.log("Flicker shielded: Cloud data matches local state.");
                return; 
            }

            // Update local cache
            const idx = state.attendanceRecords.findIndex(r => r.id === dateKey);
            if (idx > -1) state.attendanceRecords[idx] = record;
            else state.attendanceRecords.push(record);

            state.currentPresentIds = record.presentIds || [];
            state.dayTitle = record.title || "";
            
            state.members.forEach(m => {
                m.selected = state.currentPresentIds.includes(m.id);
            });
        }
        
        updateAutomaticTitle();
        await computeStats();
        await updateAttendanceCharts();
        renderAttendance();
    });
}

function initAuth() {
    const loginScreen = document.getElementById('login-screen');
    const appContainer = document.getElementById('app');
    const loginBtn = document.getElementById('google-login-btn');

    if (loginBtn) {
        loginBtn.addEventListener('click', async () => {
            try {
                await window.FirebaseService.login();
            } catch (e) {
                alert("Login failed. Please try again.");
            }
        });
    }

    // Timeout: If Firebase hasn't responded in 2s, show login screen
    let authResolved = false;
    const loginTimeout = setTimeout(() => {
        if (!authResolved) {
            console.log("Auth timeout: showing login screen.");
            loginScreen.classList.add('visible');
        }
    }, 2000);

    window.FirebaseService.onAuthChange((user) => {
        authResolved = true;
        clearTimeout(loginTimeout);

        if (user) {
            console.log("User logged in:", user.email);
            loginScreen.classList.remove('visible');
            appContainer.style.display = 'block';
            
            // Re-load data to ensure we have the latest from Firebase
            loadData();
        } else {
            console.log("User not logged in. Showing login screen.");
            loginScreen.classList.add('visible');
            appContainer.style.display = 'none';
        }
    });
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
                if (!m.at_cebu && !m.isDirector) {
                    m.selected = isChecked;
                    if (isChecked) {
                        if (!state.currentPresentIds.includes(m.id)) state.currentPresentIds.push(m.id);
                    } else {
                        state.currentPresentIds = state.currentPresentIds.filter(pid => pid !== m.id);
                    }
                }
            });
            saveAttendance(); // Auto-save for Select All
            renderAttendance();
        });
    }
}

function initDayTitle() {
    const input = document.getElementById('day-title-input');
    if (input) {
        let debounceTimer;
        input.addEventListener('input', (e) => {
            state.dayTitle = e.target.value;
            localStorage.setItem(`title-${getLocalISO(state.currentDate)}`, state.dayTitle);
            
            // Real-time Cloud Sync: Debounced save to Firebase
            clearTimeout(debounceTimer);
            debounceTimer = setTimeout(() => {
                console.log("Auto-saving title to cloud...");
                saveAttendance(); 
            }, 800); 
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
    
    setTimeout(async () => {
        state.currentDate = new Date(newDate);
        state.currentDate.setHours(0,0,0,0);
        localStorage.setItem('lastOpenedDate', state.currentDate.toISOString());

        // Restart real-time attendance listener for new date
        refreshAttendanceListener();

        updateHeaderDate();
        updateAutomaticTitle();

        wrapper.style.transition = 'all 0.3s ease';
        wrapper.style.opacity = '1';
        wrapper.style.transform = 'scale(1)';
    }, 200);
}

function initSwipe() {
    let startX = 0, startY = 0;
    const area = document.getElementById('header-swipe'); // Moved to header to avoid scroll conflict
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

async function saveAttendance(showNotification = false) {
    const dateKey = getLocalISO(state.currentDate);
    const allMembers = state.members;
    
    const selectedIds = allMembers.filter(m => m.selected).map(m => m.id);
    const absentIds = allMembers.filter(m => !m.selected && !m.at_cebu).map(m => m.id);
    const exemptIds = allMembers.filter(m => m.at_cebu && !m.selected).map(m => m.id);
    const title = state.dayTitle;
    
    const memberSnapshots = allMembers.map(m => ({
        id: m.id,
        name: m.name,
        voice: m.voice_type,
        labels: {
            at_cebu: m.at_cebu || false,
            mostly_absent: m.mostly_absent || false,
            is_leader: m.is_leader || false,
            is_director: m.isDirector || false
        },
        status: m.at_cebu && !m.selected ? 'exempt' : (m.selected ? 'present' : 'absent')
    }));

    const attendanceData = {
        id: dateKey, // ENSURE ID IS PRESENT
        date: dateKey,
        title: title,
        members: memberSnapshots,
        presentIds: selectedIds, 
        absentIds: absentIds,
        exemptIds: exemptIds,
        stats: {
            present: selectedIds.length,
            absent: absentIds.length,
            exempt: exemptIds.length
        },
        updatedAt: new Date().toISOString()
    };

    // 3. Handle Auto-Deletion of Empty Records
    if (selectedIds.length === 0) {
        console.log(`Deleting empty record for ${dateKey}`);
        
        // Remove from local cache
        state.attendanceRecords = state.attendanceRecords.filter(r => r.id !== dateKey && r.date !== dateKey);
        
        // Trigger deletion in service
        window.FirebaseService.deleteData('attendance_records', dateKey);
        
        // Update stats and UI instantly
        await computeStats();
        await updateAttendanceCharts();
        renderAttendance();
        return;
    }

    // 1. UPDATE CACHE IMMEDIATELY (Sync)
    // Use both id and date check for backward compatibility/robustness
    const idx = state.attendanceRecords.findIndex(r => r.id === dateKey || r.date === dateKey);
    if (idx > -1) state.attendanceRecords[idx] = attendanceData;
    else state.attendanceRecords.push(attendanceData);

    // 2. Trigger async background save to Firebase
    window.FirebaseService.saveData('attendance_records', dateKey, attendanceData);

    // 3. Update stats and UI instantly
    await computeStats();
    await updateAttendanceCharts();
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
    
    setTimeout(async () => {
        // Jump to next/prev Saturday (6) or Sunday (0)
        let newDate = new Date(state.currentDate);
        let found = false;
        while (!found) {
            newDate.setDate(newDate.getDate() + delta);
            const day = newDate.getDay();
            if (day === 0 || day === 6) found = true;
        }
        
        state.currentDate = newDate;
        localStorage.setItem('lastOpenedDate', state.currentDate.toISOString());
        
        // Restart real-time attendance listener for new date
        refreshAttendanceListener();

        updateHeaderDate();
        updateAutomaticTitle();
        
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
    const dateKey = getLocalISO(state.currentDate);
    const stored = localStorage.getItem(`title-${dateKey}`);
    const input = document.getElementById('day-title-input');
    const appEl = document.getElementById('app');
    
    // Dynamic Theme Detection
    if (appEl) {
        if (day === 6) { // Saturday
            appEl.classList.add('theme-saturday');
        } else {
            appEl.classList.remove('theme-saturday');
        }
    }
    
    if (stored) {
        state.dayTitle = stored;
    } else {
        if (day === 0) state.dayTitle = "Sunday Service";
        else if (day === 6) state.dayTitle = "Practice";
        else state.dayTitle = "Service";
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
    
    // Update Select All Label with counter (exclude director, cebu, mostly absent)
    const selectedCount = filtered.filter(m => m.selected && !m.at_cebu && !m.mostly_absent && !m.isDirector).length;
    const selectAllLabel = document.getElementById('select-all-label');
    if (selectAllLabel) {
        selectAllLabel.innerText = `Select All (${selectedCount})`;
    }
    
    updateSummary();

    const selectAll = document.getElementById('select-all');
    if (selectAll) {
        const selectable = filtered.filter(m => !m.at_cebu && !m.mostly_absent && !m.isDirector);
        selectAll.checked = selectable.length > 0 && selectable.every(m => m.selected);
    }

    const fragment = document.createDocumentFragment();

    // Sections (Soprano, Alto, Tenor, Bass) — Director excluded from voice sections
    state.sections.forEach(section => {
        const members = filtered.filter(m => {
            if (m.at_cebu || m.mostly_absent || m.isDirector) return false;
            return m.voice_type === section;
        });
        if (members.length === 0) return;

        const h = document.createElement('div');
        h.className = 'section-header';
        h.innerText = section;
        fragment.appendChild(h);

        // const div = document.createElement('div');
        // div.className = 'section-divider';
        // fragment.appendChild(div);

        members.forEach(m => fragment.appendChild(createMemberItem(m)));
    });

    // 2. Mostly Absent Section
    const mostlyAbsentMembers = filtered.filter(m => m.mostly_absent);
    if (mostlyAbsentMembers.length > 0) {
        const header = document.createElement('div');
        header.className = 'section-header mostly-absent-header';
        header.innerText = 'Mostly Absent';
        fragment.appendChild(header);
        mostlyAbsentMembers.forEach(m => fragment.appendChild(createMemberItem(m)));
    }

    // 3. Cebu
    const cebu = filtered.filter(m => m.at_cebu);
    if (cebu.length > 0) {
        const h = document.createElement('div');
        h.className = 'section-header cebu-header';
        h.innerText = 'At Cebu (Exempted)';
        fragment.appendChild(h);
        cebu.forEach(m => fragment.appendChild(createMemberItem(m)));
    }

    // 4. Choir Director — always at the very bottom
    const directors = filtered.filter(m => m.isDirector);
    if (directors.length > 0) {
        const h = document.createElement('div');
        h.className = 'section-header director-header';
        h.innerText = 'Choir Director';
        fragment.appendChild(h);
        directors.forEach(m => fragment.appendChild(createMemberItem(m)));
    }

    list.innerHTML = '';
    list.appendChild(fragment);
}

function createMemberItem(m) {
    const div = document.createElement('div');
    
    // Color-coded left border
    let borderClass = '';
    if (m.at_cebu) borderClass = 'at-cebu-member';
    else if (m.mostly_absent) borderClass = 'mostly-absent-member';
    else borderClass = 'voice-member'; // Gold for Soprano/Alto/Tenor/Bass/Director
    
    div.className = `member-item ${borderClass}`;
    div.dataset.id = m.id;
    div.onclick = () => toggleMember(m.id);
    
    // Right Click & Long Press Handling
    div.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        showContextMenu(e, m);
    });
    
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
                <span class="member-id">${m.id}</span>
                ${m.isDirector ? '<span class="director-chip"><svg viewBox="0 0 24 24" width="9" height="9" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" style="margin-right:2px"><path d="M12 2l3 7h7l-5.5 4 2 7L12 16l-6.5 4 2-7L2 9h7z"/></svg>Director</span>' : ''}
                ${m.at_cebu ? '<span class="exemption-badge"><svg viewBox="0 0 24 24" width="9" height="9" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" style="margin-right:2px"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>At Cebu</span>' : ''}
                ${m.mostly_absent ? '<span class="absent-badge"><svg viewBox="0 0 24 24" width="9" height="9" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" style="margin-right:2px"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>Mostly Absent</span>' : ''}
            </div>
            <div class="member-stats-row">
                ${m.isDirector ? '' : (state.currentDate.getDay() !== 6) ? `
                    <span class="stat-mini s"><svg viewBox="0 0 24 24" width="10" height="10" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" style="margin-right:3px"><polyline points="20 6 9 17 4 12"/></svg>Present: ${m.service_presents || 0}</span>
                    <span class="stat-mini sa"><svg viewBox="0 0 24 24" width="10" height="10" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" style="margin-right:3px"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>Absent: ${m.service_absents || 0}</span>
                ` : `
                    <span class="stat-mini p"><svg viewBox="0 0 24 24" width="10" height="10" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" style="margin-right:3px"><polyline points="20 6 9 17 4 12"/></svg>Present: ${m.practice_presents || 0}</span>
                    <span class="stat-mini pa"><svg viewBox="0 0 24 24" width="10" height="10" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" style="margin-right:3px"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>Absent: ${m.practice_absents || 0}</span>
                `}
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
            action: () => { window.location.href = `profile.html?id=${encodeURIComponent(member.id)}&name=${encodeURIComponent(member.name)}`; }, 
            color: 'menu-blue' 
        },
        { 
            label: member.selected ? 'Mark Absent' : 'Mark Present', 
            icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>`, 
            action: () => toggleMember(member.id), 
            color: 'menu-green' 
        },
        { 
            label: member.mostly_absent ? 'Move back to Active' : 'Move to Mostly Absent', 
            icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>`, 
            action: () => updateMemberFlag(member.id, 'mostly_absent', !member.mostly_absent), 
            color: member.mostly_absent ? 'menu-blue' : 'menu-yellow' 
        },
        { 
            label: member.at_cebu ? 'Remove from Cebu' : 'Mark as At Cebu', 
            icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>`, 
            action: () => updateMemberFlag(member.id, 'at_cebu', !member.at_cebu), 
            color: member.at_cebu ? 'menu-red' : 'menu-yellow' 
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

    // Position adjustments — ensure fully visible
    const rect = menu.getBoundingClientRect();
    const margin = 12;
    const bottomNavHeight = 80;
    
    let finalX = x - (rect.width / 2); // Center horizontally on touch point
    let finalY = y - rect.height - 10; // Prefer showing above touch point

    // Keep within horizontal bounds
    if (finalX < margin) finalX = margin;
    if (finalX + rect.width > window.innerWidth - margin) finalX = window.innerWidth - rect.width - margin;
    
    // If not enough room above, show below
    if (finalY < margin) finalY = y + 10;
    
    // If still overflows bottom (accounting for bottom nav)
    if (finalY + rect.height > window.innerHeight - bottomNavHeight) {
        finalY = window.innerHeight - rect.height - bottomNavHeight - margin;
    }
    
    // Final safety clamp
    if (finalY < margin) finalY = margin;

    menu.style.left = `${finalX}px`;
    menu.style.top = `${finalY}px`;
}

function hideContextMenu() {
    const menu = document.getElementById('context-menu');
    const backdrop = document.getElementById('menu-backdrop');
    if (menu) menu.remove();
    if (backdrop) backdrop.remove();
}

async function saveMembersToFirebase() {
    if (window.FirebaseService.currentUser) {
        try {
            await window.FirebaseService.saveData('app_data', 'members_list', { members: state.members });
            console.log("Entire members list synced to Firestore.");
            return true;
        } catch (e) {
            console.error("Failed to sync members list to Firestore:", e);
            return false;
        }
    }
    return false;
}

async function updateMemberFlag(id, flag, value) {
    const m = state.members.find(m => m.id === id);
    if (m) {
        m[flag] = value;
        
        // Mutual exclusion: at_cebu and mostly_absent shouldn't both be true
        if (flag === 'at_cebu' && value) m.mostly_absent = false;
        if (flag === 'mostly_absent' && value) m.at_cebu = false;
        
        console.log(`Updated ${m.name}: ${flag} = ${value}. Saving to Firebase...`);
        const saved = await saveMembersToFirebase();
        console.log(`Firebase save result: ${saved ? 'SUCCESS' : 'FAILED'}`);
        computeStats();
        renderAttendance();
        renderMembers();
    }
}

async function computeStats() {
    // 1. Reset dynamic fields
    state.members.forEach(m => {
        m.service_presents = 0;
        m.service_absents = 0;
        m.practice_presents = 0;
        m.practice_absents = 0;
    });

    // 2. Aggregate from CACHED records
    state.attendanceRecords.forEach(record => {
        const dateStr = record.date || record.id;
        const [y, mm, dd] = dateStr.split('-').map(Number);
        const date = new Date(y, mm - 1, dd);
        const day = date.getDay();
        
        // STRICT RULE: Only Sunday (0) counts for S/SA, Saturday (6) counts for P/PA
        if (day !== 0 && day !== 6) return;

        const isSunday = (day === 0);
        const presentIds = record.presentIds || [];

        state.members.forEach(m => {
            // Skip director from attendance stats entirely
            if (m.isDirector) return;

            const isPresent = presentIds.includes(m.id);
            const wasExempt = record.members?.find(rm => rm.id === m.id)?.labels?.at_cebu;
            
            if (isPresent) {
                if (isSunday) m.service_presents++;
                else m.practice_presents++;
            } else if (!wasExempt && presentIds.length > 0) {
                // ONLY mark someone absent if at least one person was present on that day.
                // This confirms an event took place and prevents "ghost" absences.
                if (isSunday) m.service_absents++;
                else m.practice_absents++;
            }
        });
    });
}

async function updateAttendanceCharts() {
    const ctx = document.getElementById('attendanceChart');
    if (!ctx) return;

    const dateKey = getLocalISO(state.currentDate);
    const day = state.currentDate.getDay();
    const record = state.attendanceRecords.find(r => r.id === dateKey || r.date === dateKey);
    
    // 1. Calculate Stats (exclude directors)
    const nonDirectorMembers = state.members.filter(m => !m.isDirector);
    const presentCount = record?.presentIds ? record.presentIds.filter(id => !state.members.find(m => m.id === id && m.isDirector)).length : 0;
    const exemptedCount = nonDirectorMembers.filter(m => m.at_cebu).length;
    const expectedCount = Math.max(1, nonDirectorMembers.length - exemptedCount);
    
    // Absent means they are expected (non-exempt, non-director) but didn't show up
    const presentNonExemptCount = nonDirectorMembers.filter(m => !m.at_cebu && record?.presentIds?.includes(m.id)).length;
    const absentCount = record ? (expectedCount - presentNonExemptCount) : 0;
    
    // Rate is (Total Present / Total Expected)
    const rawRate = (presentCount / expectedCount) * 100;
    const rate = Math.round(rawRate);

    // 2. Dynamic UI Config
    const labelElem = document.getElementById('chart-dynamic-label');
    const chartCard = document.getElementById('unified-chart-card');
    const container = document.getElementById('analytics-container');

    // ALWAYS SHOW container (User request: persistently visible)
    if (container) {
        container.style.display = 'grid';
        container.style.marginTop = '50px'; 
    }

    if (labelElem) {
        if (day === 0) labelElem.textContent = "Sunday Service Attendance";
        else if (day === 6) labelElem.textContent = "Choir Practice Attendance";
        else labelElem.textContent = "Weekday Service Attendance";
    }

    const chartColor = day === 6 ? '#3B82F6' : '#FF8C00'; // Blue for Saturday, Gold for others

    // 3. UI Helpers
    const drawCenterText = (chart, rate) => {
        const {ctx, width, height} = chart;
        ctx.save();
        
        // Value Text
        ctx.font = "900 22px Inter"; // Boldest weight, slightly smaller
        ctx.fillStyle = "#0F172A"; // Deep slate
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(`${rate}%`, width / 2, height / 2);
        
        ctx.restore();
    };

    const plugin = {
        id: 'centerText',
        afterDraw: (chart) => {
            if (chart.config.options.elements.centerText !== undefined) {
                drawCenterText(chart, chart.config.options.elements.centerText);
            }
        }
    };

    const openModal = () => openAttendanceModal(record || { id: dateKey, date: dateKey, presentIds: [], title: "" });

    // 4. Render Chart (Always render, even if 0)
    if (state.charts.attendance) state.charts.attendance.destroy();
    state.charts.attendance = new Chart(ctx, {
        type: 'doughnut',
        plugins: [plugin],
        data: {
            labels: ['Present', 'Absent'],
            datasets: [{
                data: [presentCount, Math.max(0.1, absentCount)], // Small offset for visual ring if 0/0
                backgroundColor: [chartColor, '#F1F5F9'],
                borderWidth: 0,
                hoverOffset: 15
            }]
        },
        options: {
            cutout: '68%', // Thicker ring for compact view
            responsive: true,
            maintainAspectRatio: false,
            onClick: openModal,
            plugins: { 
                legend: { display: false }, 
                tooltip: { 
                    enabled: true,
                    backgroundColor: 'rgba(30, 41, 59, 0.95)',
                    padding: 12,
                    titleFont: { size: 12, weight: 'bold' },
                    bodyFont: { size: 12 },
                    callbacks: {
                        label: (context) => ` ${context.label}: ${Math.floor(context.raw)} members`
                    }
                } 
            },
            elements: { centerText: rate }
        }
    });

    // Ensure the whole card triggers the modal
    if (chartCard) {
        chartCard.onclick = openModal;
    }

    // Reuse existing status logic if needed
    updateStatusLabelFromRate(chartCard, rate);
}

function updateStatusLabelFromRate(card, rate) {
    if (!card) return;
    const target = card.querySelector('.chart-info-side');
    if (!target) return;

    let label = target.querySelector('.chart-status');
    if (!label) {
        label = document.createElement('div');
        label.className = 'chart-status';
        target.appendChild(label);
    }
    
    let statusText, statusClass;
    if (rate >= 85) { statusText = "Excellent"; statusClass = "status-excellent"; }
    else if (rate >= 70) { statusText = "Good"; statusClass = "status-good"; }
    else { statusText = "Needs Improvement"; statusClass = "status-poor"; }
    
    label.innerHTML = `<span class="status-prefix">Status:</span> <span class="status-chip ${statusClass}">${statusText}</span>`;
}

/**
 * ATTENDANCE DETAIL MODAL
 * Shows list of present/absent members for a specific day
 */
async function openAttendanceModal(record) {
    const modalEl = document.getElementById('attendance-detail-modal');
    if (!modalEl) return;

    // Use Bootstrap API
    let bsModal = bootstrap.Modal.getInstance(modalEl);
    if (!bsModal) bsModal = new bootstrap.Modal(modalEl);
    
    const dateTitle = document.getElementById('modal-date-title');
    const daySubtitle = document.getElementById('modal-day-subtitle');
    const listContainer = document.getElementById('modal-member-list');
    const tabs = document.querySelectorAll('.at-tab');

    // If no record, create a temporary one for the current date view
    if (!record) {
        const dateKey = getLocalISO(state.currentDate);
        record = { id: dateKey, date: dateKey, presentIds: [], title: "" };
    }

    const dateStr = record.date || record.id;
    const dateObj = new Date(dateStr);
    const formattedDate = dateObj.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
    const isSunday = (dateObj.getDay() === 0);
    const sessionType = record.title || (isSunday ? "Sunday Service" : "Choir Practice");

    dateTitle.textContent = formattedDate;
    daySubtitle.textContent = sessionType;

    // Reset Tabs
    let currentTab = 'present';
    tabs.forEach(t => t.classList.remove('active'));
    tabs[0].classList.add('active');

    const renderModalList = () => {
        const presentIds = record.presentIds || [];
        const absentIds = state.members
            .filter(m => !m.at_cebu && !presentIds.includes(m.id))
            .map(m => m.id);

        const targetIds = currentTab === 'present' ? presentIds : absentIds;
        const targetMembers = state.members.filter(m => targetIds.includes(m.id));
        
        // Update Counts
        const pCount = document.getElementById('modal-present-count');
        const aCount = document.getElementById('modal-absent-count');
        if (pCount) pCount.textContent = presentIds.length;
        if (aCount) aCount.textContent = absentIds.length;

        if (targetMembers.length === 0) {
            listContainer.innerHTML = `<div class="empty-state">No members found in this list.</div>`;
            return;
        }

        listContainer.innerHTML = targetMembers.sort((a,b) => a.name.localeCompare(b.name)).map(m => `
            <div class="modal-member-item">
                <div class="modal-member-info">
                    <div class="modal-member-name">${m.name}</div>
                    <div class="modal-member-id">
                        <span>ID: ${m.id}</span>
                        <span class="modal-badge-chip">${m.voice_type || 'Unassigned'}</span>
                    </div>
                </div>
                <div class="${currentTab === 'present' ? 'p-dot' : 'a-dot'}"></div>
            </div>
        `).join('');
    };

    // Tab Listeners
    tabs.forEach(tab => {
        tab.onclick = () => {
            currentTab = tab.dataset.tab;
            tabs.forEach(t => t.classList.remove('active'));
            tab.classList.add('active');
            renderModalList();
        };
    });

    bsModal.show();
    renderModalList();
}


function toggleMember(id) {
    const m = state.members.find(m => m.id === id);
    if (m) {
        m.selected = !m.selected;
        if (m.selected) {
            if (!state.currentPresentIds.includes(id)) state.currentPresentIds.push(id);
        } else {
            state.currentPresentIds = state.currentPresentIds.filter(pid => pid !== id);
        }
        saveAttendance();
        renderAttendance();
    }
}

function updateSummary() {
    const presentCount = document.getElementById('summary-present');
    const absentCount = document.getElementById('summary-absent');
    const exemptCount = document.getElementById('summary-exempt');
    if (!presentCount || !absentCount || !exemptCount) return;

    const filtered = getFilteredMembers().filter(m => !m.isDirector);
    presentCount.innerText = filtered.filter(m => m.selected).length;
    absentCount.innerText = filtered.filter(m => !m.selected && !m.at_cebu).length;
    exemptCount.innerText = filtered.filter(m => m.at_cebu && !m.selected).length;
}

// Member Editor Modal Functions
function openMemberEditor(member) {
    let editor = document.getElementById('member-editor');
    if (!editor) {
        editor = document.createElement('div');
        editor.id = 'member-editor';
        editor.className = 'modal-overlay';
        document.body.appendChild(editor);
    }

    editor.innerHTML = `
        <div class="modal-box member-edit-box">
            <h3>Edit Member Info</h3>
            <div class="edit-field">
                <label>Full Name</label>
                <input type="text" id="edit-name" value="${member.name}">
            </div>
            <div class="edit-field">
                <label>Voice Type</label>
                <select id="edit-voice">
                    ${['Soprano', 'Alto', 'Tenor', 'Bass'].map(v => `<option value="${v}" ${member.voice_type === v ? 'selected' : ''}>${v}</option>`).join('')}
                </select>
            </div>
            <div class="edit-field">
                <label>Birthday</label>
                <input type="text" id="edit-bday" value="${member.birthday || ''}" placeholder="e.g., October 21, 2005">
            </div>
            <div class="edit-field">
                <label>Gender</label>
                <select id="edit-gender">
                    <option value="Female" ${member.gender === 'Female' ? 'selected' : ''}>Female</option>
                    <option value="Male" ${member.gender === 'Male' ? 'selected' : ''}>Male</option>
                </select>
            </div>
            <div class="modal-actions">
                <button class="modal-btn secondary" onclick="closeMemberEditor()">Cancel</button>
                <button class="modal-btn primary" id="save-member-edit">Save Changes</button>
            </div>
        </div>
    `;

    editor.style.display = 'flex';

    document.getElementById('save-member-edit').onclick = async () => {
        const newName = document.getElementById('edit-name').value;
        const newVoice = document.getElementById('edit-voice').value;
        const newBday = document.getElementById('edit-bday').value;
        const newGender = document.getElementById('edit-gender').value;

        member.name = newName;
        member.voice_type = newVoice;
        member.birthday = newBday;
        member.gender = newGender;

        // Sync to cloud
        const success = await saveMembersToFirebase();
        if (success) {
            closeMemberEditor();
            renderAttendance();
            renderMembers();
        } else {
            alert("Failed to save changes to Firestore. Please check your connection.");
        }
    };
}

function closeMemberEditor() {
    const editor = document.getElementById('member-editor');
    if (editor) editor.style.display = 'none';
}
function initLogin() {}
function initCalendar() {}
function initFinance() {}
function renderCalendar() {
    const grid = document.getElementById('calendar-grid');
    if (!grid) return;

    const month = state.viewDate.getMonth();
    const year = state.viewDate.getFullYear();

    const firstDay = new Date(year, month, 1).getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();

    const days = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
    let html = '<div class="calendar-header-days">' + days.map(d => `<span>${d}</span>`).join('') + '</div>';
    html += '<div class="calendar-days-grid">';

    // Months for birthday checking
    const monthNames = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];

    // Padding for first week
    for (let i = 0; i < firstDay; i++) {
        html += '<div class="calendar-day empty"></div>';
    }

    // Days of month
    for (let day = 1; day <= daysInMonth; day++) {
        const d = new Date(year, month, day);
        const dayOfWeek = d.getDay();
        const dateKey = getLocalISO(d);
        
        // Presence of data
        const hasData = state.attendanceRecords.some(r => r.id === dateKey || r.date === dateKey);
        const isToday = getLocalISO() === dateKey;
        
        // Weekend Tagging
        const isSunday = dayOfWeek === 0;
        const isSaturday = dayOfWeek === 6;
        let dayClass = '';
        let tagHtml = '';
        if (isSunday) {
            dayClass = 'service-day';
            tagHtml = '<div class="day-tag">Serv</div>';
        } else if (isSaturday) {
            dayClass = 'practice-day';
            tagHtml = '<div class="day-tag">Prac</div>';
        }

        // Birthday Checking
        const birthdayMembers = state.members.filter(m => {
            if (!m.birthday) return false;
            const bParts = m.birthday.toLowerCase().split(' ');
            if (bParts.length < 2) return false;
            const bMonth = bParts[0].replace(',', '');
            const bDay = parseInt(bParts[1]);
            return monthNames.indexOf(bMonth) === month && bDay === day;
        });
        const hasBirthday = birthdayMembers.length > 0;
        const birthdayTitle = hasBirthday ? `Birthdays: ${birthdayMembers.map(m => m.name).join(', ')}` : '';

        html += `
            <div class="calendar-day ${dayClass} ${hasData ? 'has-data' : ''} ${isToday ? 'is-today' : ''}" 
                 onclick="jumpToDate(new Date('${dateKey}'))"
                 title="${birthdayTitle}">
                <span>${day}</span>
                ${tagHtml}
                ${hasBirthday ? '<div class="birthday-alert"></div>' : ''}
                ${hasData ? '<div class="data-indicator"></div>' : ''}
            </div>
        `;
    }

    html += '</div>';
    grid.innerHTML = html;
}

function renderFinance() {
    const hist = document.getElementById('transaction-history');
    if (!hist) return;
    hist.innerHTML = '<div style="padding:40px; text-align:center; color:var(--text-muted);">Finance module coming soon...</div>';
}

function renderMembers() {
    const list = document.getElementById('members-list');
    if (!list) return;

    // Reuse getFilteredMembers behavior but for the full list
    const members = state.members.sort((a, b) => a.name.localeCompare(b.name));
    
    // Header Overview
    list.innerHTML = `
        <div style="padding: 10px 20px;">
            <div class="member-stats-overview" style="display:flex; gap:12px; margin-bottom:24px;">
                <div class="stat-card premium-card" style="flex:1; padding:18px; text-align:center;">
                    <div style="font-size:24px; font-weight:900; color:var(--primary); line-height:1;">${members.length}</div>
                    <div style="font-size:10px; font-weight:800; color:var(--text-muted); text-transform:uppercase; margin-top:8px; letter-spacing:0.5px;">Total Members</div>
                </div>
            </div>
            <div id="members-full-list"></div>
        </div>
    `;

    const subList = document.getElementById('members-full-list');
    members.forEach(m => {
        const div = document.createElement('div');
        div.className = 'member-full-card premium-card';
        div.style = 'padding:16px; margin-bottom:12px; display:flex; align-items:center; gap:15px; cursor:pointer;';
        
        div.onclick = () => alert(`Viewing info for ${m.name}`);
        div.oncontextmenu = (e) => {
            e.preventDefault();
            showContextMenu(e, m);
        };

        const initials = (m.name || "??").split(' ').filter(n => n).map(n => n[0]).join('').slice(0, 2).toUpperCase();
        
        div.innerHTML = `
            <div class="member-avatar" style="width:45px; height:45px; font-size:14px;">
                ${initials}
            </div>
            <div style="flex:1;">
                <div style="font-weight:700; font-size:15px;">${m.name}</div>
                <div style="font-size:11px; color:var(--text-muted); font-weight:600;">${m.voice_type} • ${m.id}</div>
            </div>
            <div style="text-align:right;">
                <div style="font-size:10px; font-weight:800; color:var(--primary);">${Math.round(((m.service_presents + m.practice_presents) / Math.max(1, m.service_presents + m.service_absents + m.practice_presents + m.practice_absents)) * 100)}%</div>
                <div style="font-size:8px; font-weight:700; color:var(--text-muted);">ATTENDANCE</div>
            </div>
        `;
        subList.appendChild(div);
    });
}

// --- PWA & SERVICE WORKER ---
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('/sw.js')
            .then(reg => console.log('SW Registered!', reg))
            .catch(err => console.log('SW Fail:', err));
    });
}

// Custom Install Prompt Logic
let deferredPrompt;
const installModalEl = document.getElementById('pwa-install-prompt');
const installBtn = document.getElementById('pwa-install-btn');

window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
    
    const lastSeen = localStorage.getItem('pwaPromptLastSeen');
    const COOLDOWN = 12 * 60 * 60 * 1000;
    const now = Date.now();

    if (!lastSeen || (now - parseInt(lastSeen)) > COOLDOWN) {
        if (installModalEl) {
            setTimeout(() => {
                let bsInstall = bootstrap.Modal.getInstance(installModalEl);
                if (!bsInstall) bsInstall = new bootstrap.Modal(installModalEl);
                bsInstall.show();
            }, 3000); 
        }
    }
});

if (installBtn) {
    installBtn.addEventListener('click', async () => {
        if (!deferredPrompt) return;
        deferredPrompt.prompt();
        const { outcome } = await deferredPrompt.userChoice;
        if (outcome === 'accepted') {
            localStorage.setItem('pwaPromptLastSeen', 'installed');
        } else {
            localStorage.setItem('pwaPromptLastSeen', Date.now().toString());
        }
        deferredPrompt = null;
        const bsInstall = bootstrap.Modal.getInstance(installModalEl);
        if (bsInstall) bsInstall.hide();
    });
}

// Track dismissal via standard close buttons
if (installModalEl) {
    installModalEl.addEventListener('hidden.bs.modal', () => {
        if (localStorage.getItem('pwaPromptLastSeen') !== 'installed') {
            localStorage.setItem('pwaPromptLastSeen', Date.now().toString());
        }
        forceCleanupBackdrop();
    });
}
