const fs = require('fs');

const members = JSON.parse(fs.readFileSync('infos.json', 'utf8'));

const html = `<!DOCTYPE html>
<html>
<head>
    <title>ASC Final Sync</title>
    <script src="firebase-config.js"></script>
    <style>
        body { font-family: sans-serif; padding: 40px; text-align: center; background: #f8fafc; }
        .card { background: white; padding: 30px; border-radius: 12px; box-shadow: 0 4px 6px -1px rgb(0 0 0 / 0.1); display: inline-block; max-width: 600px; width: 100%; }
        h1 { color: #1e293b; margin-bottom: 10px; }
        #status { font-weight: bold; margin: 20px 0; padding: 15px; border-radius: 8px; background: #f1f5f9; min-height: 40px; }
        .success { background: #dcfce7 !important; color: #166534; }
        .error { background: #fee2e2 !important; color: #991b1b; }
        button { background: #2563eb; color: white; border: none; padding: 12px 24px; border-radius: 6px; cursor: pointer; font-weight: bold; font-size: 16px; margin-top: 10px; }
        button:hover { background: #1d4ed8; }
        .preview { text-align: left; font-size: 12px; max-height: 200px; overflow: auto; background: #f1f5f9; padding: 10px; margin-top: 20px; border-radius: 4px; }
    </style>
</head>
<body>
    <div class="card">
        <h1>ASC Global Sync</h1>
        <p>This will push <strong>${members.length} members</strong> to Firestore.</p>
        
        <div id="status">Checking Auth...</div>
        
        <button id="btn" style="display:none;" onclick="startSync()">Push to Cloud Now</button>
        
        <div class="preview">
            <strong>Data Preview (Zea M. Ramil):</strong><br>
            <pre id="previewData"></pre>
        </div>
    </div>

    <script type="module">
        import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
        import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
        import { getFirestore, doc, setDoc } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

        // Embed the actual data directly
        const members = ${JSON.stringify(members)};
        
        // Show preview of first member to confirm data is there
        const zea = members.find(m => m.name.includes("Zea"));
        if (zea) {
            document.getElementById('previewData').innerText = JSON.stringify({
                phone: zea.cellphone_number,
                address: zea.address,
                uniform: zea.uniform_size,
                fund: zea.sinking_fund_balance
            }, null, 2);
        }

        const app = initializeApp(window.firebaseConfig);
        const auth = getAuth(app);
        const db = getFirestore(app);

        window.startSync = async () => {
            const btn = document.getElementById('btn');
            const status = document.getElementById('status');
            btn.disabled = true;
            status.innerText = "Syncing...";
            
            try {
                await setDoc(doc(db, 'app_data', 'members_list'), { 
                    members: members,
                    updatedAt: new Date().toISOString()
                });
                status.innerText = "SUCCESS! 73 members synced. You can close this page.";
                status.className = "success";
                btn.style.display = "none";
            } catch (err) {
                status.innerText = "ERROR: " + err.message;
                status.className = "error";
                btn.disabled = false;
            }
        };

        onAuthStateChanged(auth, (user) => {
            const status = document.getElementById('status');
            const btn = document.getElementById('btn');
            if (user) {
                status.innerText = "Ready! Authenticated as " + user.email;
                btn.style.display = "inline-block";
            } else {
                status.innerText = "Please log in on the main ASC Tracker app first.";
                status.className = "error";
            }
        });
    </script>
</body>
</html>`;

fs.writeFileSync('sync_now.html', html);
console.log('Built sync_now.html with ' + members.length + ' members.');
