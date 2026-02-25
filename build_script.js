const fs = require('fs');
const members = JSON.parse(fs.readFileSync('infos.json', 'utf8'));
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
