const fs = require('fs');
const members = JSON.parse(fs.readFileSync('infos.json', 'utf8'));

const script = `(async () => {
    console.clear();
    console.log("%c--- ASC ULTIMATE SYNC ---", "color: #2563eb; font-weight: bold; font-size: 18px;");
    
    if (!window.FirebaseService || !window.FirebaseService.currentUser) {
        console.error("%cERROR: You are not logged in or on the wrong page!", "color: red; font-weight: bold;");
        alert("Please log in to the ASC Tracker first!");
        return;
    }

    const members = ${JSON.stringify(members)};
    console.log("Ready to push " + members.length + " members...");
    
    try {
        // Direct call to saveData which we know handles the db connection
        await window.FirebaseService.saveData('app_data', 'members_list', { members: members });
        
        // CRITICAL: Clear the local cache for the profile page
        localStorage.removeItem('app_data-members_list');
        
        console.log("%cSUCCESS! All data pushed to Firestore.", "color: green; font-weight: bold; font-size: 14px;");
        alert("SUCCESS! 73 Members synced. Clicking OK will refresh the page.");
        window.location.reload();
    } catch (e) {
        console.error("Push failed:", e);
        alert("Error during sync: " + e.message);
    }
})();`;

fs.writeFileSync('URGENT_SYNC_COMMAND.txt', script);
console.log('Generated URGENT_SYNC_COMMAND.txt');
