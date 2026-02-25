const fs = require('fs');

function normalizeBirthday(str) {
    if (!str) return '';
    // Normalize "Mar 18, 2008" to "March 18, 2008"
    const months = {
        'Jan': 'January', 'Feb': 'February', 'Mar': 'March', 'Apr': 'April',
        'May': 'May', 'Jun': 'June', 'Jul': 'July', 'Aug': 'August',
        'Sep': 'September', 'Oct': 'October', 'Nov': 'November', 'Dec': 'December',
        'oct': 'October', 'sept': 'September', 'aug': 'August', 'july': 'July'
    };
    let out = str.trim();
    for (const [short, full] of Object.entries(months)) {
        const regex = new RegExp('^' + short + '\\.?\\s+', 'i');
        if (regex.test(out)) {
            out = out.replace(regex, full + ' ');
            break;
        }
    }
    return out;
}

function parseCSV(content) {
    const lines = content.split(/\r?\n/);
    // Headers start at line 3 (index 2)
    // Actually lines 1-2 are junk, line 3-4 is header.
    // Let's just skip until we find "Name,Voice Type"
    let startIdx = lines.findIndex(l => l.startsWith('Name,Voice Type'));
    if (startIdx === -1) return [];
    
    // The header might have a newline in "Remaining Balance"
    // So we skip the next line too if it's "(Sinking Fund)"
    let dataLines = lines.slice(startIdx + 1);
    if (dataLines[0].trim().includes('(Sinking Fund)')) {
        dataLines = dataLines.slice(1);
    }

    const members = [];
    dataLines.forEach(line => {
        if (!line.trim() || line.startsWith('\u200e')) return;
        
        // Simple regex to split CSV with quotes
        const parts = line.match(/(".*?"|[^",\s]+)(?=\s*,|\s*$)/g) || [];
        // Wait, the above regex is tricky for empty fields. Let's use a better approach.
        const row = [];
        let inQuotes = false;
        let current = '';
        for (let i = 0; i < line.length; i++) {
            const char = line[i];
            if (char === '"') {
                inQuotes = !inQuotes;
            } else if (char === ',' && !inQuotes) {
                row.push(current.trim());
                current = '';
            } else {
                current += char;
            }
        }
        row.push(current.trim());

        if (row.length < 5) return;

        members.push({
            name: row[0].replace(/"/g, ''),
            voice_type: row[1].replace(/"/g, ''),
            birthday: normalizeBirthday(row[2].replace(/"/g, '')),
            age: row[3] ? parseInt(row[3]) : null,
            gender: row[4].replace(/"/g, ''),
            uniform_size: row[5].replace(/"/g, ''),
            cellphone_number: row[6] ? (row[6].startsWith('9') ? '0' + row[6] : row[6]) : '',
            address: row[7].replace(/"/g, ''),
            balance: row[8] ? parseFloat(row[8]) : 0
        });
    });
    return members;
}

const existing = JSON.parse(fs.readFileSync('infos.json', 'utf8'));
const csvContent = fs.readFileSync('ASC Profiling - backup.csv', 'utf8');
const updates = parseCSV(csvContent);

console.log(`Read ${updates.length} records from CSV.`);

updates.forEach(u => {
    // Find matching member (ignore suffixes)
    let match = existing.find(e => {
        const cleanE = e.name.replace(/ - (Leader|Treasurer|Choir Master Director|Choir Director|President)/g, '').trim().toLowerCase();
        const cleanU = u.name.replace(/ - (Leader|Treasurer|Choir Master Director|Choir Director|President)/g, '').trim().toLowerCase();
        return cleanE === cleanU;
    });

    if (match) {
        if (u.birthday) match.birthday = u.birthday;
        if (u.age) match.age = u.age;
        if (u.gender) match.gender = u.gender;
        if (u.uniform_size) match.uniform_size = u.uniform_size;
        if (u.cellphone_number) match.cellphone_number = u.cellphone_number;
        if (u.address) match.address = u.address;
        if (u.balance !== undefined) match.sinking_fund_balance = u.balance;
        if (u.voice_type && u.voice_type !== 'Director') match.voice_type = u.voice_type;
    } else {
        console.log(`Adding new member: ${u.name}`);
        existing.push({
            name: u.name,
            voice_type: u.voice_type === 'Director' ? '' : u.voice_type,
            birthday: u.birthday,
            age: u.age,
            gender: u.gender,
            sinking_fund_balance: u.balance,
            uniform_size: u.uniform_size,
            cellphone_number: u.cellphone_number,
            address: u.address,
            attendance_presents: 0,
            attendance_absents: 0
        });
    }
});

fs.writeFileSync('infos.json', JSON.stringify(existing, null, 2));
console.log('Merge complete. Updated infos.json.');
