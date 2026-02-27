const fs = require('fs');
let members = JSON.parse(fs.readFileSync('infos.json', 'utf8'));

// Clean data: remove null/undefined and assign deterministic IDs
members = members.map((m, index) => {
    const obj = { ...m };
    if (!obj.id) obj.id = `ASC-${(index + 1).toString().padStart(3, '0')}`;
    Object.keys(obj).forEach(key => {
        if (obj[key] === undefined || obj[key] === null) {
            delete obj[key];
        }
    });
    return obj;
});

const script = `(async () => {
    if (!window.FirebaseService || !window.FirebaseService.currentUser) {
        alert('Please log in to the main ASC Tracker app first!');
        return;
    }
    const members = ${JSON.stringify(members)};
    const ok = confirm('Sync ' + members.length + ' members to Firestore?');
    if (!ok) return;
    try {
        console.log('Sending to Firestore...');
        await window.FirebaseService.saveData('app_data', 'members_list', { members: members });
        localStorage.clear();
        alert('SUCCESS! 73 Members synced. Page will now refresh.');
        window.location.reload();
    } catch (e) {
        alert('Error: ' + e.message);
        console.error(e);
    }
})();`;
fs.writeFileSync('CONSOLE_SYNC_SCRIPT.txt', script);
console.log('Script generated in CONSOLE_SYNC_SCRIPT.txt');
