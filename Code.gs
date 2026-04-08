// ============================================================
// URBANA LANGSUAN — LOYALTY PROGRAM
// Single GAS deployment — serves HTML pages + handles all API calls
// No CORS, no redirect issues, no external hosting needed
// Deploy: Web App > Execute as Me > Anyone
// ============================================================

var CONFIG = {
  SHEET_ID: '1udEItVt354UvnYmg4Aih6JFkjZAV2thEZC1xUEbjImo',
  SHEET_MEMBERS: 'Members',
  SHEET_TRANSACTIONS: 'Transactions',
  SHEET_REDEMPTIONS: 'RedemptionCatalogue',
  ADMIN_PASSWORD: 'UrbanaAdmin2025!',
  OTP_EXPIRY_MINUTES: 10,
  POINTS_PER_BAHT: 0.01,
  TIERS: {
    MEMBER:   { name: 'Member',   min: 0    },
    GOLD:     { name: 'Gold',     min: 1000 },
    PLATINUM: { name: 'Platinum', min: 3000 },
    DIAMOND:  { name: 'Diamond',  min: 5000 },
  },
};

// ── ROUTER ────────────────────────────────────────────────────
// GAS serves HTML pages via doGet (page param)
// API calls come via doPost (action param in JSON body)
// This avoids ALL redirect/CORS issues because:
// - HTML is served directly by GAS (same origin)
// - API calls are POST from that same GAS origin (no CORS)

function doGet(e) {
  var page = e.parameter.page || 'enroll';

  if (page === 'enroll')  return serveEnroll();
  if (page === 'portal')  return servePortal();
  if (page === 'admin')   return serveAdmin();

  return HtmlService.createHtmlOutput('<h2>Page not found</h2>');
}

function doPost(e) {
  var params = {};
  try {
    if (e.postData && e.postData.contents) {
      params = JSON.parse(e.postData.contents);
    }
  } catch(err) {}

  var action = params.action ? params.action.toString().trim() : '';
  var result;

  try {
    if      (action === 'enroll')          { result = enrollMember(params); }
    else if (action === 'requestOTP')      { result = requestOTP(params); }
    else if (action === 'verifyOTP')       { result = verifyOTP(params); }
    else if (action === 'getMember')       { result = getMember(params); }
    else if (action === 'getTransactions') { result = getTransactions(params); }
    else if (action === 'adminLogin')      { result = adminLogin(params); }
    else if (action === 'searchMember')    { result = searchMember(params); }
    else if (action === 'postPoints')      { result = postPoints(params); }
    else if (action === 'redeemPoints')    { result = redeemPoints(params); }
    else if (action === 'getCatalogue')    { result = getCatalogue(params); }
    else if (action === 'getDashboard')    { result = getDashboard(params); }
    else { result = { success: false, error: 'Unknown action: [' + action + ']' }; }
  } catch (err) {
    result = { success: false, error: 'Error: ' + err.message };
  }

  return ContentService
    .createTextOutput(JSON.stringify(result))
    .setMimeType(ContentService.MimeType.JSON);
}

// ── HTML PAGE SERVERS ─────────────────────────────────────────

function serveEnroll() {
  var html = HtmlService.createHtmlOutput(getEnrollHtml());
  html.setTitle('Join Urbana Privileges');
  html.setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
  return html;
}

function servePortal() {
  var html = HtmlService.createHtmlOutput(getPortalHtml());
  html.setTitle('My Urbana Privileges');
  html.setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
  return html;
}

function serveAdmin() {
  var html = HtmlService.createHtmlOutput(getAdminHtml());
  html.setTitle('Urbana Privileges — Admin');
  html.setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
  return html;
}

// ── TEST ──────────────────────────────────────────────────────

function testDirect() {
  var params = { action: 'getDashboard' };
  var fakePost = { postData: { contents: JSON.stringify(params) } };
  var result = doPost(fakePost);
  Logger.log(result.getContent());
}

// ── HELPERS ───────────────────────────────────────────────────

function getSheet(name) {
  return SpreadsheetApp.openById(CONFIG.SHEET_ID).getSheetByName(name);
}

function generateMemberId() {
  var yr   = new Date().getFullYear().toString().slice(-2);
  var rand = Math.floor(Math.random() * 90000) + 10000;
  return 'UL' + yr + rand;
}

function getTier(pts) {
  if (pts >= 5000) return 'DIAMOND';
  if (pts >= 3000) return 'PLATINUM';
  if (pts >= 1000) return 'GOLD';
  return 'MEMBER';
}

function getNextTier(pts) {
  if (pts >= 5000) return { name: 'Diamond',  needed: 0,          at: 5000 };
  if (pts >= 3000) return { name: 'Diamond',  needed: 5000 - pts, at: 5000 };
  if (pts >= 1000) return { name: 'Platinum', needed: 3000 - pts, at: 3000 };
  return                  { name: 'Gold',     needed: 1000 - pts, at: 1000 };
}

function str(v) { return v !== undefined && v !== null ? v.toString().trim() : ''; }

// ── ENROLL ────────────────────────────────────────────────────

function enrollMember(p) {
  var firstName = str(p.firstName);
  var lastName  = str(p.lastName);
  var email     = str(p.email).toLowerCase();
  var phone     = str(p.phone);

  if (!firstName || !lastName || !email || !phone) {
    return { success: false, error: 'Required fields missing' };
  }

  var sheet = getSheet(CONFIG.SHEET_MEMBERS);
  var data  = sheet.getDataRange().getValues();
  for (var i = 1; i < data.length; i++) {
    if (str(data[i][3]).toLowerCase() === email) {
      return { success: false, error: 'Email already registered' };
    }
  }

  var memberId = generateMemberId();
  var joinDate = Utilities.formatDate(new Date(), 'Asia/Bangkok', 'yyyy-MM-dd');
  var mktg     = (p.marketing === 'true' || p.marketing === true) ? 'YES' : 'NO';

  sheet.appendRow([memberId, firstName, lastName, email, phone,
    str(p.nationality), str(p.dob), joinDate, 0, 'MEMBER', mktg, 'ACTIVE', '', '']);

  try { sendWelcomeEmail(email, firstName, memberId); } catch(e) {}

  return { success: true, memberId: memberId,
    message: 'Welcome to Urbana Privileges! Your Member ID is ' + memberId };
}

// ── OTP ───────────────────────────────────────────────────────

function requestOTP(p) {
  var email = str(p.email).toLowerCase();
  if (!email) return { success: false, error: 'Email required' };

  var sheet = getSheet(CONFIG.SHEET_MEMBERS);
  var data  = sheet.getDataRange().getValues();
  var rowIndex = -1, memberName = '';

  for (var i = 1; i < data.length; i++) {
    if (str(data[i][3]).toLowerCase() === email) {
      rowIndex = i + 1; memberName = str(data[i][1]); break;
    }
  }
  if (rowIndex === -1) return { success: false, error: 'Email not found. Please enrol first.' };

  var otp    = Math.floor(100000 + Math.random() * 900000).toString();
  var expiry = Utilities.formatDate(
    new Date(Date.now() + CONFIG.OTP_EXPIRY_MINUTES * 60000),
    'Asia/Bangkok', 'yyyy-MM-dd HH:mm:ss');

  sheet.getRange(rowIndex, 13).setValue(otp);
  sheet.getRange(rowIndex, 14).setValue(expiry);

  try { sendOTPEmail(email, memberName, otp); } catch(e) {}
  return { success: true, message: 'Code sent to ' + email };
}

function verifyOTP(p) {
  var email = str(p.email).toLowerCase();
  var otp   = str(p.otp);
  if (!email || !otp) return { success: false, error: 'Email and OTP required' };

  var sheet = getSheet(CONFIG.SHEET_MEMBERS);
  var data  = sheet.getDataRange().getValues();

  for (var i = 1; i < data.length; i++) {
    if (str(data[i][3]).toLowerCase() === email) {
      if (str(data[i][12]) !== otp) return { success: false, error: 'Invalid code.' };
      if (new Date() > new Date(str(data[i][13]))) return { success: false, error: 'Code expired.' };
      sheet.getRange(i + 1, 13).setValue('');
      sheet.getRange(i + 1, 14).setValue('');
      return { success: true, memberId: str(data[i][0]),
        token: Utilities.base64Encode(email + ':' + Date.now()) };
    }
  }
  return { success: false, error: 'Email not found' };
}

// ── MEMBER DATA ───────────────────────────────────────────────

function getMember(p) {
  var memberId = str(p.memberId).toUpperCase();
  var email    = str(p.email).toLowerCase();

  var sheet = getSheet(CONFIG.SHEET_MEMBERS);
  var data  = sheet.getDataRange().getValues();

  for (var i = 1; i < data.length; i++) {
    var row = data[i];
    if ((memberId && str(row[0]).toUpperCase() === memberId) ||
        (email    && str(row[3]).toLowerCase() === email)) {
      var pts  = Number(row[8]) || 0;
      var tier = getTier(pts);
      return { success: true, member: {
        memberId:    str(row[0]),
        firstName:   str(row[1]),
        lastName:    str(row[2]),
        email:       str(row[3]),
        phone:       str(row[4]),
        nationality: str(row[5]),
        joinDate:    str(row[7]),
        points:      pts,
        tier:        tier,
        tierConfig:  CONFIG.TIERS[tier],
        nextTier:    getNextTier(pts),
        status:      str(row[11]),
      }};
    }
  }
  return { success: false, error: 'Member not found' };
}

function getTransactions(p) {
  var memberId = str(p.memberId).toUpperCase();
  if (!memberId) return { success: false, error: 'Member ID required' };

  var sheet = getSheet(CONFIG.SHEET_TRANSACTIONS);
  var data  = sheet.getDataRange().getValues();
  var txns  = [];

  for (var i = 1; i < data.length; i++) {
    if (str(data[i][1]).toUpperCase() === memberId) {
      txns.push({
        date: str(data[i][0]), memberId: str(data[i][1]),
        type: str(data[i][2]), description: str(data[i][3]),
        amount: Number(data[i][4]), points: Number(data[i][5]),
        balance: Number(data[i][6]), postedBy: str(data[i][7]),
      });
    }
  }
  txns.sort(function(a,b){ return new Date(b.date) - new Date(a.date); });
  return { success: true, transactions: txns.slice(0, 50) };
}

// ── ADMIN ─────────────────────────────────────────────────────

function adminLogin(p) {
  if (str(p.password) === CONFIG.ADMIN_PASSWORD) {
    return { success: true, token: Utilities.base64Encode('admin:' + Date.now()) };
  }
  return { success: false, error: 'Invalid password' };
}

function searchMember(p) {
  var query = str(p.query).toLowerCase();
  if (query.length < 2) return { success: false, error: 'Query too short' };

  var sheet   = getSheet(CONFIG.SHEET_MEMBERS);
  var data    = sheet.getDataRange().getValues();
  var results = [];

  for (var i = 1; i < data.length; i++) {
    var row = data[i];
    var s   = [row[0],row[1],row[2],row[3],row[4]].join(' ').toLowerCase();
    if (s.indexOf(query) !== -1) {
      var pts = Number(row[8]) || 0;
      results.push({ memberId: str(row[0]), firstName: str(row[1]),
        lastName: str(row[2]), email: str(row[3]), phone: str(row[4]),
        points: pts, tier: getTier(pts), status: str(row[11]) });
    }
    if (results.length >= 10) break;
  }
  return { success: true, results: results };
}

function postPoints(p) {
  var memberId    = str(p.memberId).toUpperCase();
  var folioAmount = str(p.folioAmount);
  var description = str(p.description);
  var postedBy    = str(p.postedBy) || 'Front Desk';

  if (!memberId || !folioAmount) return { success: false, error: 'Member ID and folio amount required' };

  var amount = parseFloat(folioAmount);
  if (isNaN(amount) || amount <= 0) return { success: false, error: 'Invalid folio amount' };

  var pointsEarned = Math.floor(amount * CONFIG.POINTS_PER_BAHT);
  if (pointsEarned === 0) return { success: false, error: 'Minimum amount 100 THB' };

  var mSheet = getSheet(CONFIG.SHEET_MEMBERS);
  var mData  = mSheet.getDataRange().getValues();
  var rowIdx = -1, curPts = 0, mEmail = '', mName = '';

  for (var i = 1; i < mData.length; i++) {
    if (str(mData[i][0]).toUpperCase() === memberId) {
      rowIdx = i + 1; curPts = Number(mData[i][8]) || 0;
      mName  = str(mData[i][1]); mEmail = str(mData[i][3]); break;
    }
  }
  if (rowIdx === -1) return { success: false, error: 'Member not found' };

  var newPts   = curPts + pointsEarned;
  var newTier  = getTier(newPts);
  var prevTier = getTier(curPts);

  mSheet.getRange(rowIdx, 9).setValue(newPts);
  mSheet.getRange(rowIdx, 10).setValue(newTier);

  var now  = Utilities.formatDate(new Date(), 'Asia/Bangkok', 'yyyy-MM-dd HH:mm:ss');
  var desc = description || ('Stay folio ' + amount + ' THB');
  getSheet(CONFIG.SHEET_TRANSACTIONS).appendRow(
    [now, memberId, 'EARN', desc, amount, pointsEarned, newPts, postedBy]);

  if (newTier !== prevTier) {
    try { sendTierUpgradeEmail(mEmail, mName, newTier); } catch(e) {}
  }

  return { success: true, pointsEarned: pointsEarned, newBalance: newPts,
    newTier: newTier, tierUpgraded: newTier !== prevTier,
    message: pointsEarned + ' points added. Balance: ' + newPts + ' pts' };
}

function redeemPoints(p) {
  var memberId = str(p.memberId).toUpperCase();
  var rewardId = str(p.rewardId);
  var postedBy = str(p.postedBy) || 'Front Desk';

  if (!memberId || !rewardId) return { success: false, error: 'Member ID and reward required' };

  var cSheet = getSheet(CONFIG.SHEET_REDEMPTIONS);
  var cData  = cSheet.getDataRange().getValues();
  var reward = null, catRow = -1;

  for (var i = 1; i < cData.length; i++) {
    if (str(cData[i][0]) === rewardId) {
      reward = { id: str(cData[i][0]), name: str(cData[i][1]),
        points: Number(cData[i][2]), active: str(cData[i][3]) === 'YES' };
      catRow = i + 1; break;
    }
  }
  if (!reward || !reward.active) return { success: false, error: 'Reward not found or inactive' };

  var mSheet = getSheet(CONFIG.SHEET_MEMBERS);
  var mData  = mSheet.getDataRange().getValues();
  var rowIdx = -1, curPts = 0;

  for (var i = 1; i < mData.length; i++) {
    if (str(mData[i][0]).toUpperCase() === memberId) {
      rowIdx = i + 1; curPts = Number(mData[i][8]) || 0; break;
    }
  }
  if (rowIdx === -1) return { success: false, error: 'Member not found' };
  if (curPts < reward.points) return { success: false, error: 'Insufficient points' };

  var newPts  = curPts - reward.points;
  var newTier = getTier(newPts);
  mSheet.getRange(rowIdx, 9).setValue(newPts);
  mSheet.getRange(rowIdx, 10).setValue(newTier);

  var now = Utilities.formatDate(new Date(), 'Asia/Bangkok', 'yyyy-MM-dd HH:mm:ss');
  getSheet(CONFIG.SHEET_TRANSACTIONS).appendRow(
    [now, memberId, 'REDEEM', reward.name, 0, -reward.points, newPts, postedBy]);

  var cnt = Number(cData[catRow - 1][4]) || 0;
  cSheet.getRange(catRow, 5).setValue(cnt + 1);

  return { success: true, rewardRedeemed: reward.name,
    pointsUsed: reward.points, newBalance: newPts,
    message: reward.name + ' redeemed. Remaining: ' + newPts + ' pts' };
}

function getCatalogue(p) {
  var sheet = getSheet(CONFIG.SHEET_REDEMPTIONS);
  var data  = sheet.getDataRange().getValues();
  var items = [];
  for (var i = 1; i < data.length; i++) {
    if (str(data[i][3]) === 'YES') {
      items.push({ id: str(data[i][0]), name: str(data[i][1]),
        points: Number(data[i][2]),
        category: str(data[i][5]) || 'General',
        description: str(data[i][6]) });
    }
  }
  items.sort(function(a,b){ return a.points - b.points; });
  return { success: true, catalogue: items };
}

function getDashboard(p) {
  var mData = getSheet(CONFIG.SHEET_MEMBERS).getDataRange().getValues();
  var tData = getSheet(CONFIG.SHEET_TRANSACTIONS).getDataRange().getValues();
  var today = new Date(), tm = today.getMonth(), ty = today.getFullYear();
  var total=0, active=0, gold=0, platinum=0, diamond=0, newM=0, earnedM=0;

  for (var i = 1; i < mData.length; i++) {
    if (!mData[i][0]) continue;
    total++;
    if (str(mData[i][11]) === 'ACTIVE') active++;
    var t = str(mData[i][9]);
    if (t==='GOLD') gold++; else if (t==='PLATINUM') platinum++; else if (t==='DIAMOND') diamond++;
    try {
      var d = new Date(str(mData[i][7]));
      if (d.getMonth()===tm && d.getFullYear()===ty) newM++;
    } catch(e){}
  }
  for (var i = 1; i < tData.length; i++) {
    try {
      var d = new Date(str(tData[i][0]));
      if (d.getMonth()===tm && d.getFullYear()===ty && str(tData[i][2])==='EARN') {
        earnedM += Number(tData[i][5]) || 0;
      }
    } catch(e){}
  }
  return { success: true, stats: {
    total: total, active: active, gold: gold, platinum: platinum,
    diamond: diamond, newThisMonth: newM, earnedThisMonth: earnedM }};
}

// ── EMAIL ─────────────────────────────────────────────────────

function sendWelcomeEmail(email, firstName, memberId) {
  GmailApp.sendEmail(email,
    'Welcome to Urbana Privileges',
    'Dear ' + firstName + ',\n\nYour Member ID: ' + memberId + '\n\n'
    + 'Earn 1 point per 100 THB spent. Points never expire.\n'
    + 'Gold: 1,000 pts | Platinum: 3,000 pts | Diamond: 5,000 pts\n\n'
    + 'Warm regards,\nUrbana Langsuan Hotel & Residence');
}

function sendOTPEmail(email, firstName, otp) {
  GmailApp.sendEmail(email,
    'Your Urbana Privileges login code: ' + otp,
    'Dear ' + firstName + ',\n\nYour login code is: ' + otp
    + '\n\nValid for ' + CONFIG.OTP_EXPIRY_MINUTES + ' minutes.\n\n'
    + 'Urbana Langsuan Hotel & Residence');
}

function sendTierUpgradeEmail(email, firstName, newTier) {
  var n = CONFIG.TIERS[newTier] ? CONFIG.TIERS[newTier].name : newTier;
  GmailApp.sendEmail(email,
    'Congratulations! Upgraded to ' + n,
    'Dear ' + firstName + ',\n\nYou are now an Urbana Privileges ' + n + ' member.\n\n'
    + 'Warm regards,\nUrbana Langsuan Hotel & Residence');
}

// ── SETUP ─────────────────────────────────────────────────────

function setupSheets() {
  var ss = SpreadsheetApp.openById(CONFIG.SHEET_ID);

  function makeSheet(name, headers) {
    var sh = ss.getSheetByName(name) || ss.insertSheet(name);
    sh.getRange(1,1,1,headers.length).setValues([headers]);
    sh.setFrozenRows(1);
    sh.getRange(1,1,1,headers.length).setFontWeight('bold')
      .setBackground('#0d1b2a').setFontColor('#ffffff');
    return sh;
  }

  makeSheet(CONFIG.SHEET_MEMBERS,
    ['MemberID','FirstName','LastName','Email','Phone','Nationality','DOB',
     'JoinDate','Points','Tier','Marketing','Status','OTP','OTPExpiry']);
  makeSheet(CONFIG.SHEET_TRANSACTIONS,
    ['DateTime','MemberID','Type','Description','FolioAmount','Points','Balance','PostedBy']);

  var cat = makeSheet(CONFIG.SHEET_REDEMPTIONS,
    ['RewardID','Name','Points','Active','TimesRedeemed','Category','Description']);
  cat.getRange(2,1,9,7).setValues([
    ['R001','2x Breakfast',          100,'YES',0,'F&B',     'Complimentary breakfast for 2 guests'],
    ['R002','F&B Credit 300 THB',    200,'YES',0,'F&B',     '300 THB credit at any F&B outlet'],
    ['R003','F&B Credit 500 THB',    300,'YES',0,'F&B',     '500 THB credit at any F&B outlet'],
    ['R004','Late Checkout 2pm',     300,'YES',0,'Stay',    'Check out at 2:00 PM'],
    ['R005','Free Room Upgrade',     500,'YES',0,'Stay',    'Upgrade to next available category'],
    ['R006','Airport Transfer',      800,'YES',0,'Service', 'One-way airport transfer in Bangkok'],
    ['R007','Free Night Standard',   800,'YES',0,'Stay',    'One night in a Standard room'],
    ['R008','Spa Treatment 60 min', 1000,'YES',0,'Wellness','60-minute relaxation massage'],
    ['R009','Free Night Deluxe',    1500,'YES',0,'Stay',    'One night in a Deluxe room'],
  ]);
  Logger.log('Setup complete.');
}

// ── HTML TEMPLATES ────────────────────────────────────────────
// Each function returns the full HTML for that page.
// The HTML uses google.script.run to call GAS functions directly —
// no fetch(), no CORS, no redirects, no external URLs needed.

function getEnrollHtml() { return '<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Join Urbana Privileges</title><link rel="preconnect" href="https://fonts.googleapis.com"><link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,300;0,400;0,600;1,300&family=Jost:wght@300;400;500&display=swap" rel="stylesheet"><style>:root{--navy:#0d1b2a;--navy-mid:#1a2f45;--gold:#c9a84c;--gold-light:#e8c97a;--gold-pale:#f5eed8;--cream:#faf8f3;--text:#1a1a2e;--muted:#6b7280;--border:#ddd5c0;--error:#9b2c2c;--success:#1a5c3a}*{box-sizing:border-box;margin:0;padding:0}body{font-family:"Jost",sans-serif;background:var(--cream);color:var(--text);min-height:100vh}header{background:var(--navy);padding:0 2rem;display:flex;align-items:center;justify-content:space-between;height:72px;border-bottom:1px solid rgba(201,168,76,0.3)}.logo-name{font-family:"Cormorant Garamond",serif;font-size:1.25rem;font-weight:600;color:var(--gold-light);letter-spacing:.08em;text-transform:uppercase}.logo-sub{font-size:.6rem;letter-spacing:.2em;color:rgba(201,168,76,.6);text-transform:uppercase}.hero{background:var(--navy);padding:4rem 2rem 3rem;text-align:center}.hero-eyebrow{font-size:.7rem;letter-spacing:.25em;color:var(--gold);text-transform:uppercase;margin-bottom:1.5rem}.hero-title{font-family:"Cormorant Garamond",serif;font-size:clamp(2.5rem,5vw,4rem);font-weight:300;color:#fff;line-height:1.15;margin-bottom:1rem}.hero-title em{color:var(--gold-light);font-style:italic}.hero-sub{font-size:.875rem;color:rgba(255,255,255,.55);max-width:420px;margin:0 auto;line-height:1.8}.tier-strip{display:flex;justify-content:center;background:var(--navy-mid);border-top:1px solid rgba(201,168,76,.15);border-bottom:1px solid rgba(201,168,76,.15)}.tier-item{flex:1;max-width:200px;padding:1.25rem 1rem;text-align:center;border-right:1px solid rgba(201,168,76,.1)}.tier-item:last-child{border-right:none}.tier-dot{width:8px;height:8px;border-radius:50%;margin:0 auto .5rem}.tier-pts{font-size:.7rem;letter-spacing:.15em;color:var(--gold);text-transform:uppercase;margin-bottom:.2rem}.tier-name{font-family:"Cormorant Garamond",serif;font-size:1rem;color:rgba(255,255,255,.85)}main{max-width:680px;margin:0 auto;padding:3rem 1.5rem 5rem}.section-label{font-size:.65rem;letter-spacing:.2em;text-transform:uppercase;color:var(--gold);margin-bottom:.75rem}.section-title{font-family:"Cormorant Garamond",serif;font-size:1.75rem;font-weight:400;color:var(--navy);margin-bottom:2rem;padding-bottom:1rem;border-bottom:1px solid var(--border)}.form-grid{display:grid;grid-template-columns:1fr 1fr;gap:1.25rem}.form-group{display:flex;flex-direction:column;gap:.4rem}.form-group.full{grid-column:1/-1}label{font-size:.7rem;letter-spacing:.12em;text-transform:uppercase;color:var(--muted);font-weight:500}.req{color:var(--gold);margin-left:2px}input,select{font-family:"Jost",sans-serif;font-size:.9rem;padding:.75rem 1rem;border:1px solid var(--border);border-radius:4px;background:#fff;color:var(--text);transition:border-color .2s;width:100%;appearance:none}input:focus,select:focus{outline:none;border-color:var(--gold);box-shadow:0 0 0 3px rgba(201,168,76,.12)}.consent-block{margin-top:1.5rem;padding:1.25rem;background:var(--gold-pale);border:1px solid var(--border);border-radius:4px}.consent-row{display:flex;gap:.75rem;align-items:flex-start;margin-bottom:.75rem}.consent-row:last-child{margin-bottom:0}.consent-row input[type=checkbox]{width:16px;height:16px;min-width:16px;margin-top:2px;padding:0;border:none}.consent-text{font-size:.8rem;color:var(--muted);line-height:1.6;text-transform:none;letter-spacing:0}.btn-submit{width:100%;margin-top:2rem;padding:1rem;background:var(--navy);color:var(--gold-light);font-family:"Jost",sans-serif;font-size:.8rem;font-weight:500;letter-spacing:.2em;text-transform:uppercase;border:none;border-radius:4px;cursor:pointer;transition:background .2s}.btn-submit:hover{background:var(--navy-mid)}.btn-submit:disabled{opacity:.6;cursor:not-allowed}.alert{padding:1rem 1.25rem;border-radius:4px;font-size:.85rem;line-height:1.6;display:none;margin-top:1.25rem}.alert.show{display:block}.alert-error{background:#fef2f2;border:1px solid #fecaca;color:var(--error)}.alert-success{background:#f0fdf4;border:1px solid #bbf7d0;color:var(--success);text-align:center}.member-id-display{font-family:"Cormorant Garamond",serif;font-size:2rem;font-weight:600;letter-spacing:.1em;color:var(--navy);margin:.75rem 0 .25rem;display:block}.spinner{display:inline-block;width:14px;height:14px;border:2px solid rgba(201,168,76,.3);border-top-color:var(--gold-light);border-radius:50%;animation:spin .7s linear infinite;vertical-align:middle;margin-right:6px}@keyframes spin{to{transform:rotate(360deg)}}.login-prompt{text-align:center;margin-top:2.5rem;padding-top:1.5rem;border-top:1px solid var(--border);font-size:.8rem;color:var(--muted)}.login-prompt a{color:var(--navy);font-weight:500;text-decoration:none;border-bottom:1px solid var(--border)}footer{background:var(--navy);color:rgba(255,255,255,.35);text-align:center;padding:2rem;font-size:.7rem;letter-spacing:.1em}@media(max-width:540px){.form-grid{grid-template-columns:1fr}}</style></head><body><header><div><div class="logo-name">Urbana Langsuan</div><div class="logo-sub">Hotel &amp; Residence</div></div><a href="?page=portal" style="color:rgba(255,255,255,.6);font-size:.78rem;letter-spacing:.1em;text-decoration:none;text-transform:uppercase">Member Login</a></header><section class="hero"><div class="hero-eyebrow">Urbana Privileges</div><h1 class="hero-title">Stay more,<br><em>earn more.</em></h1><p class="hero-sub">Earn 1 point for every &#3647;100 spent. Points never expire.</p></section><div class="tier-strip"><div class="tier-item"><div class="tier-dot" style="background:#888780"></div><div class="tier-pts">0 pts</div><div class="tier-name">Member</div></div><div class="tier-item"><div class="tier-dot" style="background:#c9a84c"></div><div class="tier-pts">1,000 pts</div><div class="tier-name">Gold</div></div><div class="tier-item"><div class="tier-dot" style="background:#378ADD"></div><div class="tier-pts">3,000 pts</div><div class="tier-name">Platinum</div></div><div class="tier-item"><div class="tier-dot" style="background:#7F77DD"></div><div class="tier-pts">5,000 pts</div><div class="tier-name">Diamond</div></div></div><main><div class="section-label">Enrolment</div><h2 class="section-title">Become a member</h2><div id="form-view"><form id="enrollForm" novalidate><div class="form-grid"><div class="form-group"><label>First name <span class="req">*</span></label><input type="text" id="firstName" placeholder="Given name" autocomplete="given-name"></div><div class="form-group"><label>Last name <span class="req">*</span></label><input type="text" id="lastName" placeholder="Family name" autocomplete="family-name"></div><div class="form-group full"><label>Email address <span class="req">*</span></label><input type="email" id="email" placeholder="your@email.com" autocomplete="email"></div><div class="form-group"><label>Phone number <span class="req">*</span></label><input type="tel" id="phone" placeholder="+66 8x xxx xxxx"></div><div class="form-group"><label>Nationality</label><select id="nationality"><option value="">&#8212; Select &#8212;</option><option>Thai</option><option>Chinese</option><option>Japanese</option><option>Korean</option><option>Indian</option><option>American</option><option>British</option><option>German</option><option>French</option><option>Australian</option><option>Singapore</option><option>Malaysian</option><option>Other</option></select></div><div class="form-group full"><label>Date of birth</label><input type="date" id="dob"></div></div><div class="consent-block"><div class="consent-row"><input type="checkbox" id="terms"><label for="terms" class="consent-text"><strong>I agree to the Terms &amp; Conditions</strong> of Urbana Privileges.</label></div><div class="consent-row"><input type="checkbox" id="marketing"><label for="marketing" class="consent-text">I would like to receive exclusive offers from Urbana Langsuan Hotel &amp; Residence.</label></div></div><button type="submit" class="btn-submit" id="submitBtn">Create my membership</button><div class="alert alert-error" id="formError"></div></form></div><div id="success-view" style="display:none"><div class="alert alert-success show"><div style="font-size:.75rem;letter-spacing:.15em;text-transform:uppercase;color:#166534;margin-bottom:.5rem">Welcome to Urbana Privileges</div><span class="member-id-display" id="displayMemberId">&#8212;</span><div style="font-size:.8rem;color:#166534;margin-top:.25rem">Your Member ID &#8212; save this for reference</div><p style="margin-top:1.25rem;font-size:.82rem;color:#15803d;line-height:1.7">A confirmation email has been sent with your membership details.</p><div style="margin-top:1.5rem"><a href="?page=portal" style="display:inline-block;padding:.75rem 2rem;background:#0d1b2a;color:#e8c97a;font-family:Jost,sans-serif;font-size:.75rem;letter-spacing:.15em;text-transform:uppercase;text-decoration:none;border-radius:4px">Go to member portal &#8594;</a></div></div></div><div class="login-prompt">Already enrolled? <a href="?page=portal">Access your member portal</a></div></main><footer>&copy; 2025 Urbana Langsuan Hotel &amp; Residence &nbsp;|&nbsp; Operated by Vari Asset Co., Ltd.</footer><script>function $(id){return document.getElementById(id)}function validate(){var valid=true;var fields=[{id:"firstName",test:function(v){return v.trim().length>=1}},{id:"lastName",test:function(v){return v.trim().length>=1}},{id:"email",test:function(v){return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)}},{id:"phone",test:function(v){return v.trim().length>=6}}];fields.forEach(function(f){var el=$(f.id);var ok=f.test(el.value);el.style.borderColor=ok?"":"#9b2c2c";if(!ok)valid=false});if(!$("terms").checked){$("formError").textContent="Please accept the Terms & Conditions.";$("formError").className="alert alert-error show";valid=false}else{$("formError").className="alert alert-error"}return valid}$("enrollForm").addEventListener("submit",function(e){e.preventDefault();if(!validate())return;var btn=$("submitBtn");btn.disabled=true;btn.innerHTML=\'<span class="spinner"></span> Creating membership\u2026\';var payload={firstName:$("firstName").value.trim(),lastName:$("lastName").value.trim(),email:$("email").value.trim().toLowerCase(),phone:$("phone").value.trim(),nationality:$("nationality").value,dob:$("dob").value,marketing:$("marketing").checked};google.script.run.withSuccessHandler(function(data){if(data.success){$("displayMemberId").textContent=data.memberId;$("form-view").style.display="none";$("success-view").style.display="block"}else{$("formError").textContent=data.error||"Enrollment failed.";$("formError").className="alert alert-error show";btn.disabled=false;btn.innerHTML="Create my membership"}}).withFailureHandler(function(err){$("formError").textContent="Error: "+err.message;$("formError").className="alert alert-error show";btn.disabled=false;btn.innerHTML="Create my membership"}).enrollMember(payload)});</script></body></html>'; }

function getPortalHtml() { return '<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>My Urbana Privileges</title><link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,300;0,400;0,600;1,300&family=Jost:wght@300;400;500&display=swap" rel="stylesheet"><style>:root{--navy:#0d1b2a;--navy-mid:#1a2f45;--gold:#c9a84c;--gold-light:#e8c97a;--gold-pale:#f5eed8;--cream:#faf8f3;--text:#1a1a2e;--muted:#6b7280;--border:#ddd5c0;--error:#9b2c2c;--success:#1a5c3a}*{box-sizing:border-box;margin:0;padding:0}body{font-family:"Jost",sans-serif;background:var(--cream);color:var(--text);min-height:100vh}header{background:var(--navy);padding:0 2rem;display:flex;align-items:center;justify-content:space-between;height:72px;border-bottom:1px solid rgba(201,168,76,0.3)}.logo-name{font-family:"Cormorant Garamond",serif;font-size:1.25rem;font-weight:600;color:var(--gold-light);letter-spacing:.08em;text-transform:uppercase}.logo-sub{font-size:.6rem;letter-spacing:.2em;color:rgba(201,168,76,.6);text-transform:uppercase}.step{display:none}.step.active{display:block}.login-screen{max-width:440px;margin:5rem auto;padding:0 1.5rem}.login-eyebrow{font-size:.65rem;letter-spacing:.2em;text-transform:uppercase;color:var(--gold);margin-bottom:.75rem}.login-title{font-family:"Cormorant Garamond",serif;font-size:2rem;font-weight:300;color:var(--navy);margin-bottom:.5rem}.login-sub{font-size:.82rem;color:var(--muted);line-height:1.7;margin-bottom:2rem}.form-group{display:flex;flex-direction:column;gap:.4rem;margin-bottom:1.25rem}label{font-size:.7rem;letter-spacing:.12em;text-transform:uppercase;color:var(--muted);font-weight:500}input{font-family:"Jost",sans-serif;font-size:.9rem;padding:.75rem 1rem;border:1px solid var(--border);border-radius:4px;background:#fff;color:var(--text);transition:border-color .2s;width:100%}input:focus{outline:none;border-color:var(--gold);box-shadow:0 0 0 3px rgba(201,168,76,.12)}.btn{width:100%;padding:.9rem;font-family:"Jost",sans-serif;font-size:.78rem;font-weight:500;letter-spacing:.18em;text-transform:uppercase;border:none;border-radius:4px;cursor:pointer;transition:background .2s}.btn-primary{background:var(--navy);color:var(--gold-light)}.btn-primary:hover{background:var(--navy-mid)}.btn-primary:disabled{opacity:.6;cursor:not-allowed}.btn-ghost{background:transparent;color:var(--muted);border:1px solid var(--border);margin-top:.75rem}.otp-input{font-size:1.5rem;letter-spacing:.5em;text-align:center;font-family:"Cormorant Garamond",serif}.alert{padding:.85rem 1rem;border-radius:4px;font-size:.82rem;line-height:1.6;margin-top:.75rem;display:none}.alert.show{display:block}.alert-error{background:#fef2f2;border:1px solid #fecaca;color:var(--error)}.alert-info{background:#eff6ff;border:1px solid #bfdbfe;color:#1e40af}.spinner{display:inline-block;width:14px;height:14px;border:2px solid rgba(201,168,76,.3);border-top-color:var(--gold-light);border-radius:50%;animation:spin .7s linear infinite;vertical-align:middle;margin-right:6px}@keyframes spin{to{transform:rotate(360deg)}}#portal{display:none}.portal-header{background:var(--navy);padding:2.5rem 2rem}.portal-inner{max-width:960px;margin:0 auto}.portal-greeting{font-size:.65rem;letter-spacing:.2em;text-transform:uppercase;color:rgba(201,168,76,.7);margin-bottom:.4rem}.portal-name{font-family:"Cormorant Garamond",serif;font-size:2rem;font-weight:300;color:#fff;margin-bottom:.25rem}.portal-id{font-size:.72rem;letter-spacing:.12em;color:rgba(255,255,255,.4)}.tier-badge{display:inline-flex;align-items:center;gap:.5rem;padding:.4rem 1rem .4rem .6rem;border-radius:100px;font-size:.72rem;letter-spacing:.12em;text-transform:uppercase;font-weight:500;margin-top:1rem;border:1px solid}.badge-dot{width:8px;height:8px;border-radius:50%}.badge-MEMBER{background:rgba(136,135,128,.15);border-color:rgba(136,135,128,.4);color:#b4b2a9}.badge-GOLD{background:rgba(186,117,23,.15);border-color:rgba(186,117,23,.4);color:#EF9F27}.badge-PLATINUM{background:rgba(24,95,165,.15);border-color:rgba(24,95,165,.4);color:#85B7EB}.badge-DIAMOND{background:rgba(83,74,183,.15);border-color:rgba(83,74,183,.4);color:#AFA9EC}.points-display{margin-top:1.5rem;display:flex;align-items:baseline;gap:.5rem}.points-number{font-family:"Cormorant Garamond",serif;font-size:3.5rem;font-weight:300;color:#fff;line-height:1}.points-label{font-size:.7rem;letter-spacing:.15em;text-transform:uppercase;color:rgba(255,255,255,.45)}.progress-track{height:3px;background:rgba(255,255,255,.12);border-radius:2px;margin-top:1rem;max-width:400px}.progress-bar{height:3px;border-radius:2px;background:var(--gold);transition:width 1s ease}.progress-text{font-size:.7rem;color:rgba(255,255,255,.4);margin-top:.4rem}.portal-body{max-width:960px;margin:0 auto;padding:2rem 1.5rem 5rem}.section-row{display:grid;grid-template-columns:1fr 1fr;gap:1.5rem;margin-bottom:1.5rem}.card{background:#fff;border:1px solid var(--border);border-radius:8px;padding:1.5rem}.card-full{grid-column:1/-1}.card-title{font-size:.65rem;letter-spacing:.18em;text-transform:uppercase;color:var(--muted);margin-bottom:1.25rem;padding-bottom:.75rem;border-bottom:1px solid var(--border)}.catalogue-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:.75rem}.reward-item{border:1px solid var(--border);border-radius:6px;padding:1rem;position:relative}.reward-item.affordable{border-color:rgba(26,92,58,.3)}.reward-pts{font-family:"Cormorant Garamond",serif;font-size:1.4rem;color:var(--navy)}.reward-pts-label{font-size:.6rem;letter-spacing:.1em;text-transform:uppercase;color:var(--muted)}.reward-name{font-size:.82rem;font-weight:500;color:var(--text);margin:.5rem 0 .25rem}.reward-desc{font-size:.72rem;color:var(--muted);line-height:1.5}.reward-badge{position:absolute;top:.6rem;right:.6rem;font-size:.6rem;letter-spacing:.08em;text-transform:uppercase;padding:2px 6px;border-radius:3px}.badge-enough{background:#dcfce7;color:#15803d}.badge-need{background:#f1f5f9;color:#64748b}.txn-item{display:flex;align-items:center;padding:.75rem 0;border-bottom:1px solid var(--border);gap:1rem}.txn-item:last-child{border-bottom:none}.txn-dot{width:8px;height:8px;border-radius:50%;flex-shrink:0}.dot-earn{background:#16a34a}.dot-redeem{background:var(--gold)}.txn-details{flex:1}.txn-desc{font-size:.82rem;color:var(--text)}.txn-date{font-size:.7rem;color:var(--muted)}.txn-pts{font-family:"Cormorant Garamond",serif;font-size:1.1rem;font-weight:600;text-align:right}.pts-earn{color:#16a34a}.pts-redeem{color:var(--error)}.txn-bal{font-size:.68rem;color:var(--muted);text-align:right}.empty{text-align:center;padding:2rem;color:var(--muted);font-size:.82rem}.enroll-link{text-align:center;margin-top:1.5rem;font-size:.78rem;color:var(--muted)}.enroll-link a{color:var(--navy);font-weight:500;text-decoration:none;border-bottom:1px solid var(--border)}footer{background:var(--navy);color:rgba(255,255,255,.3);text-align:center;padding:2rem;font-size:.7rem}@media(max-width:600px){.section-row{grid-template-columns:1fr}.card-full{grid-column:1}}</style></head><body><header><div><div class="logo-name">Urbana Langsuan</div><div class="logo-sub">Hotel &amp; Residence</div></div><div style="display:flex;align-items:center;gap:1.5rem"><span id="memberName-header" style="display:none;color:rgba(255,255,255,.85);font-size:.78rem"></span><button id="logoutBtn" onclick="logout()" style="display:none;background:none;border:none;color:rgba(255,255,255,.6);font-size:.78rem;letter-spacing:.1em;text-transform:uppercase;cursor:pointer;font-family:Jost,sans-serif">Sign out</button><a href="?page=enroll" style="color:rgba(255,255,255,.6);font-size:.78rem;letter-spacing:.1em;text-decoration:none;text-transform:uppercase">Enroll</a></div></header><div id="loginScreen"><div class="login-screen"><div class="login-eyebrow">Urbana Privileges</div><h1 class="login-title">Member portal</h1><p class="login-sub">Sign in with your registered email. We\'ll send a one-time code.</p><div class="step active" id="step1"><div class="form-group"><label>Email address</label><input type="email" id="loginEmail" placeholder="your@email.com" autocomplete="email"></div><div class="alert alert-error" id="step1Error"></div><button class="btn btn-primary" id="sendOTPBtn" onclick="sendOTP()">Send login code</button><div class="enroll-link">Not a member? <a href="?page=enroll">Join Urbana Privileges</a></div></div><div class="step" id="step2"><p style="font-size:.82rem;color:var(--muted);margin-bottom:1.25rem;line-height:1.7" id="otpSentMsg"></p><div class="form-group"><label>6-digit code</label><input type="text" id="otpInput" class="otp-input" maxlength="6" placeholder="&#8212; &#8212; &#8212; &#8212; &#8212; &#8212;" inputmode="numeric" autocomplete="one-time-code"></div><div class="alert alert-error" id="step2Error"></div><button class="btn btn-primary" id="verifyOTPBtn" onclick="verifyOTP()">Sign in</button><button class="btn btn-ghost" onclick="goBack()">&#8592; Use a different email</button><p style="font-size:.75rem;color:var(--muted);margin-top:.75rem;text-align:center">Didn\'t receive it? <button onclick="sendOTP(true)" style="background:none;border:none;color:var(--gold);font-size:.75rem;cursor:pointer;font-family:Jost,sans-serif;text-decoration:underline">Resend</button></p></div></div></div><div id="portal"><div class="portal-header"><div class="portal-inner"><div class="portal-greeting">Welcome back</div><div class="portal-name" id="portalName">&#8212;</div><div class="portal-id" id="portalId">Member ID: &#8212;</div><div id="tierBadge" class="tier-badge badge-MEMBER"><div class="badge-dot" id="tierDot"></div><span id="tierLabel">Member</span></div><div class="points-display"><div class="points-number" id="pointsNumber">0</div><div class="points-label">points</div></div><div class="progress-track"><div class="progress-bar" id="progressBar" style="width:0%"></div></div><div class="progress-text" id="progressText"></div></div></div><div class="portal-body"><div class="section-row"><div class="card"><div class="card-title">Account summary</div><div style="display:flex;flex-direction:column;gap:1rem"><div><div style="font-size:.7rem;color:var(--muted);letter-spacing:.1em;text-transform:uppercase;margin-bottom:.2rem">Current points</div><div style="font-family:\'Cormorant Garamond\',serif;font-size:1.6rem;color:var(--navy)" id="statTotal">&#8212;</div></div><div><div style="font-size:.7rem;color:var(--muted);letter-spacing:.1em;text-transform:uppercase;margin-bottom:.2rem">Points to next tier</div><div style="font-family:\'Cormorant Garamond\',serif;font-size:1.6rem;color:var(--navy)" id="statNext">&#8212;</div></div><div><div style="font-size:.7rem;color:var(--muted);letter-spacing:.1em;text-transform:uppercase;margin-bottom:.2rem">Member since</div><div style="font-size:.88rem;color:var(--text)" id="statJoin">&#8212;</div></div></div></div><div class="card"><div class="card-title">Tier journey</div><div style="display:flex;align-items:center"><div style="flex:1;text-align:center;padding:.5rem" id="tj-MEMBER"><div style="width:10px;height:10px;border-radius:50%;background:#888780;margin:0 auto .4rem"></div><div style="font-size:.72rem;font-weight:500">Member</div><div style="font-size:.65rem;color:var(--muted)">0 pts</div></div><div style="flex:1;text-align:center;padding:.5rem" id="tj-GOLD"><div style="width:10px;height:10px;border-radius:50%;background:#BA7517;margin:0 auto .4rem"></div><div style="font-size:.72rem;font-weight:500">Gold</div><div style="font-size:.65rem;color:var(--muted)">1,000 pts</div></div><div style="flex:1;text-align:center;padding:.5rem" id="tj-PLATINUM"><div style="width:10px;height:10px;border-radius:50%;background:#185FA5;margin:0 auto .4rem"></div><div style="font-size:.72rem;font-weight:500">Platinum</div><div style="font-size:.65rem;color:var(--muted)">3,000 pts</div></div><div style="flex:1;text-align:center;padding:.5rem" id="tj-DIAMOND"><div style="width:10px;height:10px;border-radius:50%;background:#534AB7;margin:0 auto .4rem"></div><div style="font-size:.72rem;font-weight:500">Diamond</div><div style="font-size:.65rem;color:var(--muted)">5,000 pts</div></div></div></div></div><div class="card card-full" style="margin-bottom:1.5rem"><div class="card-title">Redemption catalogue</div><div class="catalogue-grid" id="catalogueGrid"><div class="empty">Loading rewards&#8230;</div></div></div><div class="card card-full"><div class="card-title">Points history</div><div id="txnList"><div class="empty">Loading history&#8230;</div></div></div></div></div><footer>&copy; 2025 Urbana Langsuan Hotel &amp; Residence &nbsp;|&nbsp; Operated by Vari Asset Co., Ltd.</footer><script>function $(id){return document.getElementById(id)}function saveSession(memberId,email){sessionStorage.setItem("ul_member",JSON.stringify({memberId:memberId,email:email,ts:Date.now()}))}function getSession(){try{return JSON.parse(sessionStorage.getItem("ul_member"))}catch(e){return null}}function clearSession(){sessionStorage.removeItem("ul_member")}function setLoading(btnId,loading,text){var btn=$(btnId);btn.disabled=loading;btn.innerHTML=loading?\'<span class="spinner"></span> Please wait&#8230;\':text}function showAlert(id,msg,isInfo){var el=$(id);el.textContent=msg;el.className="alert "+(isInfo?"alert-info":"alert-error")+" show"}function hideAlert(id){$(id).className="alert "+($(id).className.indexOf("alert-info")>-1?"alert-info":"alert-error")}function sendOTP(isResend){var email=$("loginEmail").value.trim().toLowerCase();if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)){showAlert("step1Error","Please enter a valid email address");return}hideAlert("step1Error");setLoading("sendOTPBtn",true,"Send login code");google.script.run.withSuccessHandler(function(data){setLoading("sendOTPBtn",false,"Send login code");if(data.success){$("otpSentMsg").textContent="A 6-digit code has been sent to "+email+". Check your inbox.";$("step1").className="step";$("step2").className="step active";setTimeout(function(){$("otpInput").focus()},100);if(isResend)showAlert("step2Error","New code sent!",true)}else{showAlert("step1Error",data.error||"Could not send code.")}}).withFailureHandler(function(err){setLoading("sendOTPBtn",false,"Send login code");showAlert("step1Error","Error: "+err.message)}).requestOTP({email:email})}function verifyOTP(){var email=$("loginEmail").value.trim().toLowerCase();var otp=$("otpInput").value.trim();if(otp.length!==6){showAlert("step2Error","Please enter the 6-digit code");return}hideAlert("step2Error");setLoading("verifyOTPBtn",true,"Sign in");google.script.run.withSuccessHandler(function(data){setLoading("verifyOTPBtn",false,"Sign in");if(data.success){saveSession(data.memberId,email);loadPortal(data.memberId)}else{showAlert("step2Error",data.error||"Invalid code.")}}).withFailureHandler(function(err){setLoading("verifyOTPBtn",false,"Sign in");showAlert("step2Error","Error: "+err.message)}).verifyOTP({email:email,otp:otp})}function goBack(){$("step2").className="step";$("step1").className="step active";$("otpInput").value=""}function logout(){clearSession();$("portal").style.display="none";$("loginScreen").style.display="block";$("logoutBtn").style.display="none";$("memberName-header").style.display="none";goBack()}function loadPortal(memberId){google.script.run.withSuccessHandler(function(mData){if(!mData.success){logout();return}var m=mData.member;$("portalName").textContent=m.firstName+" "+m.lastName;$("portalId").textContent="Member ID: "+m.memberId;$("memberName-header").textContent=m.firstName;$("memberName-header").style.display="block";$("logoutBtn").style.display="block";var badge=$("tierBadge");badge.className="tier-badge badge-"+m.tier;var colors={MEMBER:"#888780",GOLD:"#EF9F27",PLATINUM:"#85B7EB",DIAMOND:"#AFA9EC"};$("tierDot").style.background=colors[m.tier];$("tierLabel").textContent=m.tierConfig.name;$("pointsNumber").textContent=m.points.toLocaleString();var ranges={MEMBER:{from:0,to:1000,next:"Gold"},GOLD:{from:1000,to:3000,next:"Platinum"},PLATINUM:{from:3000,to:5000,next:"Diamond"},DIAMOND:{from:5000,to:5000,next:null}};var range=ranges[m.tier];if(range.next){var pct=Math.min(100,((m.points-range.from)/(range.to-range.from))*100);$("progressBar").style.width=pct+"%";$("progressText").textContent=m.nextTier.needed+" pts to "+range.next}else{$("progressBar").style.width="100%";$("progressText").textContent="You have reached Diamond — our highest tier"}$("statTotal").textContent=m.points.toLocaleString();$("statNext").textContent=m.nextTier.needed===0?"Top tier achieved":m.nextTier.needed.toLocaleString()+" pts";$("statJoin").textContent=m.joinDate?new Date(m.joinDate).toLocaleDateString("en-GB",{year:"numeric",month:"long",day:"numeric"}):"&#8212;";["MEMBER","GOLD","PLATINUM","DIAMOND"].forEach(function(tier,i){var el=$("tj-"+tier);if(el)el.style.background=tier===m.tier?"#f5eed8":""});$("loginScreen").style.display="none";$("portal").style.display="block";google.script.run.withSuccessHandler(function(cData){if(cData.success)renderCatalogue(cData.catalogue,m.points)}).getCatalogue({});google.script.run.withSuccessHandler(function(tData){if(tData.success)renderTransactions(tData.transactions)}).getTransactions({memberId:m.memberId})}).getMember({memberId:memberId})}function renderCatalogue(items,pts){var grid=$("catalogueGrid");if(!items.length){grid.innerHTML=\'<div class="empty">No rewards available</div>\';return}grid.innerHTML=items.map(function(item){var can=pts>=item.points;return\'<div class="reward-item\'+(can?" affordable":"")+\'"><span class="reward-badge \'+(can?"badge-enough":"badge-need")+\'">\'+( can?"Redeemable":"Need "+(item.points-pts).toLocaleString()+" more")+\'</span><div class="reward-pts">\'+item.points.toLocaleString()+\'</div><div class="reward-pts-label">points</div><div class="reward-name">\'+item.name+\'</div><div class="reward-desc">\'+item.description+"</div></div>"}).join("")}function renderTransactions(txns){var list=$("txnList");if(!txns.length){list.innerHTML=\'<div class="empty">No transactions yet. Points will appear after your first stay.</div>\';return}list.innerHTML=txns.map(function(t){var isEarn=t.type==="EARN";var d=new Date(t.date).toLocaleDateString("en-GB",{day:"numeric",month:"short",year:"numeric"});return\'<div class="txn-item"><div class="txn-dot \'+(isEarn?"dot-earn":"dot-redeem")+\'"></div><div class="txn-details"><div class="txn-desc">\'+t.description+\'</div><div class="txn-date">\'+d+\'</div></div><div><div class="txn-pts \'+(isEarn?"pts-earn":"pts-redeem")+\'">\'+( isEarn?"+":"")+t.points.toLocaleString()+\'</div><div class="txn-bal">\'+t.balance.toLocaleString()+" pts balance</div></div></div>"}).join("")}window.addEventListener("load",function(){var session=getSession();if(session&&(Date.now()-session.ts)<28800000)loadPortal(session.memberId)});$("otpInput").addEventListener("input",function(){if(this.value.length===6)verifyOTP()});$("loginEmail").addEventListener("keydown",function(e){if(e.key==="Enter")sendOTP()});</script></body></html>'; }

function getAdminHtml() { return '<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Urbana Privileges &#8212; Admin</title><link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,400;0,600&family=Jost:wght@300;400;500&display=swap" rel="stylesheet"><style>:root{--navy:#0d1b2a;--navy-mid:#1a2f45;--gold:#c9a84c;--gold-light:#e8c97a;--cream:#faf8f3;--text:#1a1a2e;--muted:#6b7280;--border:#ddd5c0;--error:#9b2c2c;--success:#1a5c3a;--gold-pale:#f5eed8}*{box-sizing:border-box;margin:0;padding:0}body{font-family:"Jost",sans-serif;background:#f4f2ed;color:var(--text);min-height:100vh}header{background:var(--navy);height:60px;display:flex;align-items:center;justify-content:space-between;padding:0 2rem;border-bottom:1px solid rgba(201,168,76,.3)}.logo-name{font-family:"Cormorant Garamond",serif;font-size:1.1rem;font-weight:600;color:var(--gold-light);letter-spacing:.08em;text-transform:uppercase}.admin-badge{background:rgba(201,168,76,.15);border:1px solid rgba(201,168,76,.3);color:var(--gold);font-size:.6rem;letter-spacing:.15em;text-transform:uppercase;padding:2px 8px;border-radius:3px;margin-left:.75rem}.admin-login{max-width:380px;margin:6rem auto;padding:0 1.5rem}.login-card{background:#fff;border:1px solid var(--border);border-radius:8px;padding:2rem}.login-eyebrow{font-size:.62rem;letter-spacing:.2em;text-transform:uppercase;color:var(--gold);margin-bottom:.5rem}.login-title{font-family:"Cormorant Garamond",serif;font-size:1.6rem;font-weight:400;color:var(--navy);margin-bottom:1.5rem}label{font-size:.68rem;letter-spacing:.12em;text-transform:uppercase;color:var(--muted);font-weight:500;display:block;margin-bottom:.35rem}input,select{font-family:"Jost",sans-serif;font-size:.88rem;padding:.65rem .9rem;border:1px solid var(--border);border-radius:4px;background:#fff;color:var(--text);transition:border-color .2s;width:100%}input:focus,select:focus{outline:none;border-color:var(--gold);box-shadow:0 0 0 3px rgba(201,168,76,.1)}.field{margin-bottom:1rem}.btn{padding:.7rem 1.25rem;font-family:"Jost",sans-serif;font-size:.75rem;font-weight:500;letter-spacing:.15em;text-transform:uppercase;border:none;border-radius:4px;cursor:pointer;transition:background .2s}.btn-primary{background:var(--navy);color:var(--gold-light)}.btn-primary:hover{background:var(--navy-mid)}.btn-primary:disabled{opacity:.5;cursor:not-allowed}.btn-full{width:100%}.btn-success{background:#14532d;color:#86efac}.btn-success:hover{background:#166534}.btn-danger{background:#7f1d1d;color:#fca5a5}.btn-danger:hover{background:#991b1b}.alert{padding:.75rem 1rem;border-radius:4px;font-size:.8rem;line-height:1.5;margin-top:.75rem;display:none}.alert.show{display:block}.alert-error{background:#fef2f2;border:1px solid #fecaca;color:var(--error)}.alert-success{background:#f0fdf4;border:1px solid #bbf7d0;color:var(--success)}.spinner{display:inline-block;width:12px;height:12px;border:2px solid rgba(201,168,76,.3);border-top-color:var(--gold-light);border-radius:50%;animation:spin .7s linear infinite;vertical-align:middle;margin-right:5px}@keyframes spin{to{transform:rotate(360deg)}}#adminPanel{display:none}.admin-layout{display:grid;grid-template-columns:260px 1fr;min-height:calc(100vh - 60px)}.sidebar{background:var(--navy-mid);border-right:1px solid rgba(201,168,76,.1);padding:1.5rem 0}.sidebar-label{font-size:.58rem;letter-spacing:.2em;text-transform:uppercase;color:rgba(201,168,76,.45);padding:.75rem 1.25rem .4rem}.sidebar-item{display:flex;align-items:center;gap:.6rem;padding:.65rem 1.25rem;cursor:pointer;font-size:.82rem;color:rgba(255,255,255,.55);transition:all .15s;border:none;background:none;font-family:"Jost",sans-serif;width:100%;text-align:left;border-left:2px solid transparent}.sidebar-item:hover{color:rgba(255,255,255,.85);background:rgba(255,255,255,.04)}.sidebar-item.active{color:var(--gold-light);background:rgba(201,168,76,.08);border-left-color:var(--gold)}.sidebar-dot{width:6px;height:6px;border-radius:50%;background:currentColor;opacity:.6;flex-shrink:0}.main-content{padding:2rem;overflow-y:auto}.panel{display:none}.panel.active{display:block}.panel-title{font-family:"Cormorant Garamond",serif;font-size:1.5rem;font-weight:400;color:var(--navy);margin-bottom:.25rem}.panel-sub{font-size:.78rem;color:var(--muted);margin-bottom:1.75rem}.stats-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:1rem;margin-bottom:2rem}.stat-card{background:#fff;border:1px solid var(--border);border-radius:8px;padding:1.25rem}.stat-label{font-size:.62rem;letter-spacing:.15em;text-transform:uppercase;color:var(--muted);margin-bottom:.4rem}.stat-value{font-family:"Cormorant Garamond",serif;font-size:2rem;color:var(--navy)}.member-card{background:#fff;border:1px solid var(--border);border-radius:8px;padding:1.5rem;margin-bottom:1.5rem;display:none}.member-card.show{display:block}.mc-header{display:flex;align-items:flex-start;gap:1rem;margin-bottom:1.25rem;padding-bottom:1rem;border-bottom:1px solid var(--border)}.mc-avatar{width:48px;height:48px;border-radius:50%;background:var(--navy);display:flex;align-items:center;justify-content:center;font-family:"Cormorant Garamond",serif;font-size:1.2rem;color:var(--gold-light);flex-shrink:0}.mc-name{font-family:"Cormorant Garamond",serif;font-size:1.25rem;color:var(--navy)}.mc-id{font-size:.7rem;color:var(--muted);letter-spacing:.08em}.mc-tier-badge{display:inline-block;padding:2px 8px;border-radius:3px;font-size:.65rem;letter-spacing:.1em;text-transform:uppercase;margin-top:.3rem}.tier-MEMBER{background:#f1f0ee;color:#5F5E5A}.tier-GOLD{background:#FAEEDA;color:#854F0B}.tier-PLATINUM{background:#E6F1FB;color:#185FA5}.tier-DIAMOND{background:#EEEDFE;color:#534AB7}.mc-stats{display:grid;grid-template-columns:repeat(3,1fr);gap:1rem}.mc-stat-label{font-size:.62rem;letter-spacing:.12em;text-transform:uppercase;color:var(--muted);margin-bottom:.2rem}.mc-stat-value{font-family:"Cormorant Garamond",serif;font-size:1.4rem;color:var(--navy)}.search-results{background:#fff;border:1px solid var(--border);border-radius:8px;overflow:hidden;margin-top:1rem;display:none}.search-results.show{display:block}.result-item{display:flex;align-items:center;padding:.85rem 1.25rem;border-bottom:1px solid var(--border);cursor:pointer;transition:background .1s;gap:1rem}.result-item:last-child{border-bottom:none}.result-item:hover{background:var(--gold-pale)}.result-name{font-size:.88rem;font-weight:500;color:var(--text)}.result-meta{font-size:.72rem;color:var(--muted);margin-top:1px}.result-pts{font-family:"Cormorant Garamond",serif;font-size:1.1rem;color:var(--navy);margin-left:auto}.form-section{background:#fff;border:1px solid var(--border);border-radius:8px;padding:1.5rem;margin-bottom:1rem}.form-section-title{font-size:.65rem;letter-spacing:.18em;text-transform:uppercase;color:var(--muted);margin-bottom:1rem;padding-bottom:.6rem;border-bottom:1px solid var(--border)}.form-row{display:grid;gap:1rem}.form-2{grid-template-columns:1fr 1fr}.points-preview{background:var(--gold-pale);border:1px solid var(--border);border-radius:6px;padding:1rem;margin-top:.75rem;display:none}.points-preview.show{display:block}.pp-label{font-size:.65rem;letter-spacing:.12em;text-transform:uppercase;color:var(--muted)}.pp-value{font-family:"Cormorant Garamond",serif;font-size:2rem;color:var(--navy)}.cat-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:.75rem}.cat-item{border:1px solid var(--border);border-radius:6px;padding:1rem;cursor:pointer;transition:all .15s}.cat-item:hover{border-color:var(--gold);background:var(--gold-pale)}.cat-item.selected{border-color:var(--navy);background:#eef0f5}.cat-pts{font-family:"Cormorant Garamond",serif;font-size:1.3rem;color:var(--navy)}.cat-name{font-size:.8rem;font-weight:500;margin-top:.25rem}.cat-avail{font-size:.68rem;color:var(--muted)}@media(max-width:800px){.admin-layout{grid-template-columns:1fr}.sidebar{display:none}.stats-grid{grid-template-columns:1fr 1fr}}</style></head><body><header><div style="display:flex;align-items:center"><div class="logo-name">Urbana Privileges</div><span class="admin-badge">Admin</span></div><div style="display:flex;align-items:center;gap:1.5rem"><span id="staffDisplay" style="display:none;color:rgba(255,255,255,.6);font-size:.78rem"></span><button id="adminLogoutBtn" onclick="adminLogout()" style="display:none;background:none;border:1px solid rgba(255,255,255,.2);color:rgba(255,255,255,.5);font-size:.7rem;letter-spacing:.1em;text-transform:uppercase;padding:4px 12px;border-radius:3px;cursor:pointer;font-family:Jost,sans-serif">Sign out</button></div></header><div id="adminLoginScreen"><div class="admin-login"><div class="login-card"><div class="login-eyebrow">Staff access</div><div class="login-title">Admin sign in</div><div class="field"><label>Your name / shift</label><input type="text" id="staffName" placeholder="e.g. Noon / Morning shift"></div><div class="field"><label>Admin password</label><input type="password" id="adminPass" placeholder="Enter password"></div><div class="alert alert-error" id="loginError"></div><button class="btn btn-primary btn-full" style="margin-top:.75rem" onclick="doAdminLogin()">Sign in</button></div></div></div><div id="adminPanel"><div class="admin-layout"><aside class="sidebar"><div class="sidebar-label">Operations</div><button class="sidebar-item active" id="nav-dashboard" onclick="showPanel(\'dashboard\')"><div class="sidebar-dot"></div>Dashboard</button><button class="sidebar-item" id="nav-points" onclick="showPanel(\'points\')"><div class="sidebar-dot"></div>Post points</button><button class="sidebar-item" id="nav-redeem" onclick="showPanel(\'redeem\')"><div class="sidebar-dot"></div>Process redemption</button><button class="sidebar-item" id="nav-lookup" onclick="showPanel(\'lookup\')"><div class="sidebar-dot"></div>Member lookup</button></aside><div class="main-content"><div class="panel active" id="panel-dashboard"><div class="panel-title">Overview</div><div class="panel-sub">Live programme statistics</div><div class="stats-grid"><div class="stat-card"><div class="stat-label">Total members</div><div class="stat-value" id="dash-total">&#8212;</div></div><div class="stat-card"><div class="stat-label">New this month</div><div class="stat-value" id="dash-new">&#8212;</div></div><div class="stat-card"><div class="stat-label">Points earned (month)</div><div class="stat-value" id="dash-earned">&#8212;</div></div><div class="stat-card"><div class="stat-label">Gold / Platinum / Diamond</div><div class="stat-value" id="dash-tiers">&#8212;</div></div></div><div class="form-section"><div class="form-section-title">Quick member lookup</div><input type="text" id="quickSearch" placeholder="Search by name, email, or member ID&#8230;" oninput="liveSearch(this.value,\'quickResults\')"><div class="search-results" id="quickResults"></div></div></div><div class="panel" id="panel-points"><div class="panel-title">Post points</div><div class="panel-sub">Search for member, enter settled folio amount, and post.</div><div class="form-section"><div class="form-section-title">Find member</div><input type="text" id="pointsSearch" placeholder="Name, email, or member ID&#8230;" oninput="liveSearch(this.value,\'pointsResults\')"><div class="search-results" id="pointsResults"></div></div><div class="member-card" id="pointsMemberCard"><div class="mc-header"><div class="mc-avatar" id="pm-avatar">&#8212;</div><div><div class="mc-name" id="pm-name">&#8212;</div><div class="mc-id" id="pm-id">&#8212;</div><span class="mc-tier-badge" id="pm-tier">&#8212;</span></div></div><div class="mc-stats"><div><div class="mc-stat-label">Current points</div><div class="mc-stat-value" id="pm-pts">&#8212;</div></div><div><div class="mc-stat-label">Member since</div><div class="mc-stat-value" style="font-size:1rem;padding-top:.3rem" id="pm-join">&#8212;</div></div><div><div class="mc-stat-label">Status</div><div class="mc-stat-value" style="font-size:1rem;padding-top:.3rem" id="pm-status">&#8212;</div></div></div></div><div class="form-section" id="pointsForm" style="display:none"><div class="form-section-title">Folio details</div><div class="form-row form-2"><div class="field"><label>Folio amount (THB) *</label><input type="number" id="folioAmount" placeholder="e.g. 15000" min="100" oninput="calcPoints()"></div><div class="field"><label>Reference / room no.</label><input type="text" id="folioRef" placeholder="e.g. Room 405"></div></div><div class="points-preview" id="pointsPreview"><div class="pp-label">Points to be awarded</div><div class="pp-value" id="previewPts">0</div></div><div class="alert alert-error" id="pointsError"></div><div class="alert alert-success" id="pointsSuccess"></div><div style="display:flex;gap:.75rem;margin-top:1rem"><button class="btn btn-success" onclick="submitPoints()">Confirm &amp; post points</button><button class="btn" style="background:#f4f2ed;color:var(--muted)" onclick="clearPointsForm()">Clear</button></div></div></div><div class="panel" id="panel-redeem"><div class="panel-title">Process redemption</div><div class="panel-sub">Find member, select reward, confirm.</div><div class="form-section"><div class="form-section-title">Find member</div><input type="text" id="redeemSearch" placeholder="Name, email, or member ID&#8230;" oninput="liveSearch(this.value,\'redeemResults\')"><div class="search-results" id="redeemResults"></div></div><div class="member-card" id="redeemMemberCard"><div class="mc-header"><div class="mc-avatar" id="rm-avatar">&#8212;</div><div><div class="mc-name" id="rm-name">&#8212;</div><div class="mc-id" id="rm-id">&#8212;</div><span class="mc-tier-badge" id="rm-tier">&#8212;</span></div></div><div class="mc-stats"><div><div class="mc-stat-label">Available points</div><div class="mc-stat-value" id="rm-pts">&#8212;</div></div></div></div><div class="form-section" id="redeemForm" style="display:none"><div class="form-section-title">Select reward</div><div class="cat-grid" id="redeemCatGrid">Loading&#8230;</div><div class="alert alert-error" id="redeemError" style="margin-top:1rem"></div><div class="alert alert-success" id="redeemSuccess" style="margin-top:1rem"></div><div style="display:flex;gap:.75rem;margin-top:1.25rem"><button class="btn btn-danger" id="confirmRedeemBtn" onclick="submitRedeem()" disabled>Confirm redemption</button><button class="btn" style="background:#f4f2ed;color:var(--muted)" onclick="clearRedeemForm()">Clear</button></div></div></div><div class="panel" id="panel-lookup"><div class="panel-title">Member lookup</div><div class="panel-sub">View full member profile and transaction history.</div><div class="form-section"><div class="form-section-title">Search</div><input type="text" id="lookupSearch" placeholder="Name, email, or member ID&#8230;" oninput="liveSearch(this.value,\'lookupResults\')"><div class="search-results" id="lookupResults"></div></div><div class="member-card" id="lookupMemberCard"><div class="mc-header"><div class="mc-avatar" id="lk-avatar">&#8212;</div><div><div class="mc-name" id="lk-name">&#8212;</div><div class="mc-id" id="lk-id">&#8212;</div><span class="mc-tier-badge" id="lk-tier">&#8212;</span></div></div><div class="mc-stats"><div><div class="mc-stat-label">Points</div><div class="mc-stat-value" id="lk-pts">&#8212;</div></div><div><div class="mc-stat-label">Email</div><div class="mc-stat-value" style="font-size:.82rem;padding-top:.5rem" id="lk-email">&#8212;</div></div><div><div class="mc-stat-label">Phone</div><div class="mc-stat-value" style="font-size:.82rem;padding-top:.5rem" id="lk-phone">&#8212;</div></div></div></div><div id="lookupTxns" style="display:none"><div style="font-size:.65rem;letter-spacing:.18em;text-transform:uppercase;color:var(--muted);margin-bottom:.75rem">Recent transactions</div><div id="lookupTxnList" style="background:#fff;border:1px solid var(--border);border-radius:8px;overflow:hidden"></div></div></div></div></div></div><script>var staffName="";var selectedRedeemMember=null;var selectedReward=null;var selectedPointsMember=null;var catalogue=[];function $(id){return document.getElementById(id)}function showAlert(id,msg,type){var el=$(id);el.textContent=msg;el.className="alert alert-"+(type||"error")+" show"}function hideAlert(id){$(id).className="alert alert-"+($(id).className.indexOf("alert-success")>-1?"success":"error")}function doAdminLogin(){var name=$("staffName").value.trim();var pass=$("adminPass").value;if(!name){showAlert("loginError","Please enter your name");return}if(!pass){showAlert("loginError","Please enter the password");return}google.script.run.withSuccessHandler(function(data){if(data.success){staffName=name;sessionStorage.setItem("ul_admin",JSON.stringify({name:name,ts:Date.now()}));$("adminLoginScreen").style.display="none";$("adminPanel").style.display="block";$("staffDisplay").textContent=name;$("staffDisplay").style.display="block";$("adminLogoutBtn").style.display="block";loadDashboard();loadCatalogue()}else{showAlert("loginError","Incorrect password")}}).withFailureHandler(function(err){showAlert("loginError","Error: "+err.message)}).adminLogin({password:pass})}function adminLogout(){sessionStorage.removeItem("ul_admin");location.reload()}function showPanel(name){document.querySelectorAll(".panel").forEach(function(p){p.classList.remove("active")});document.querySelectorAll(".sidebar-item").forEach(function(s){s.classList.remove("active")});$("panel-"+name).classList.add("active");$("nav-"+name).classList.add("active")}function loadDashboard(){google.script.run.withSuccessHandler(function(data){if(data.success){var s=data.stats;$("dash-total").textContent=s.total.toLocaleString();$("dash-new").textContent=s.newThisMonth.toLocaleString();$("dash-earned").textContent=s.earnedThisMonth.toLocaleString();$("dash-tiers").textContent=s.gold+" / "+s.platinum+" / "+s.diamond}}).getDashboard({})}function loadCatalogue(){google.script.run.withSuccessHandler(function(data){if(data.success)catalogue=data.catalogue}).getCatalogue({})}var searchTimer=null;function liveSearch(query,resultsId){clearTimeout(searchTimer);if(query.length<2){hideResults(resultsId);return}searchTimer=setTimeout(function(){google.script.run.withSuccessHandler(function(data){if(data.success)renderResults(data.results,resultsId)}).searchMember({query:query})},350)}function renderResults(results,resultsId){var el=$(resultsId);if(!results.length){el.innerHTML=\'<div style="padding:1rem;font-size:.82rem;color:var(--muted)">No members found</div>\';el.className="search-results show";return}el.innerHTML=results.map(function(r){return\'<div class="result-item" onclick="selectMember(\\\'\'+r.memberId+\'\\\',\\\'\'+resultsId+\'\\\')"><div><div class="result-name">\'+r.firstName+" "+r.lastName+\'</div><div class="result-meta">\'+r.memberId+" &nbsp;&middot;&nbsp; "+r.email+\'</div></div><span class="mc-tier-badge tier-\'+r.tier+\'" style="font-size:.6rem">\'+r.tier+\'</span><div class="result-pts">\'+r.points.toLocaleString()+" pts</div></div>"}).join("");el.className="search-results show"}function hideResults(id){$(id).className="search-results"}function selectMember(memberId,resultsId){hideResults(resultsId);google.script.run.withSuccessHandler(function(data){if(!data.success)return;var m=data.member;if(resultsId==="pointsResults"){selectedPointsMember=m;populateMemberCard("pm",m);$("pointsMemberCard").className="member-card show";$("pointsForm").style.display="block"}else if(resultsId==="redeemResults"){selectedRedeemMember=m;selectedReward=null;populateMemberCard("rm",m);$("redeemMemberCard").className="member-card show";$("redeemForm").style.display="block";renderRedeemCatalogue(m.points);$("confirmRedeemBtn").disabled=true}else if(resultsId==="lookupResults"||resultsId==="quickResults"){showLookupMember(m);if(resultsId==="lookupResults")loadLookupTxns(m.memberId)}}).getMember({memberId:memberId})}function populateMemberCard(prefix,m){$(prefix+"-avatar").textContent=m.firstName[0]+m.lastName[0];$(prefix+"-name").textContent=m.firstName+" "+m.lastName;$(prefix+"-id").textContent=m.memberId+" \u00b7 "+m.email;var tierEl=$(prefix+"-tier");tierEl.textContent=m.tier;tierEl.className="mc-tier-badge tier-"+m.tier;if($(prefix+"-pts"))$(prefix+"-pts").textContent=m.points.toLocaleString();if($(prefix+"-join"))$(prefix+"-join").textContent=m.joinDate||"&#8212;";if($(prefix+"-status"))$(prefix+"-status").textContent=m.status||"ACTIVE"}function calcPoints(){var amount=parseFloat($("folioAmount").value);if(isNaN(amount)||amount<100){$("pointsPreview").className="points-preview";return}var pts=Math.floor(amount/100);$("previewPts").textContent=pts.toLocaleString()+" pts";$("pointsPreview").className="points-preview show"}function submitPoints(){if(!selectedPointsMember)return;var amount=parseFloat($("folioAmount").value);if(isNaN(amount)||amount<100){showAlert("pointsError","Minimum folio amount is 100 THB");return}hideAlert("pointsError");hideAlert("pointsSuccess");var ref=$("folioRef").value.trim();var desc=ref?"Stay folio "+amount.toLocaleString()+" THB ("+ref+")":"Stay folio "+amount.toLocaleString()+" THB";google.script.run.withSuccessHandler(function(data){if(data.success){var msg=data.message+(data.tierUpgraded?" — Tier upgraded to "+data.newTier+"!":"");showAlert("pointsSuccess",msg,"success");$("pm-pts").textContent=data.newBalance.toLocaleString();$("folioAmount").value="";$("folioRef").value="";$("pointsPreview").className="points-preview";loadDashboard()}else{showAlert("pointsError",data.error||"Failed to post points")}}).withFailureHandler(function(err){showAlert("pointsError","Error: "+err.message)}).postPoints({memberId:selectedPointsMember.memberId,folioAmount:amount,description:desc,postedBy:staffName})}function clearPointsForm(){selectedPointsMember=null;$("pointsMemberCard").className="member-card";$("pointsForm").style.display="none";$("pointsSearch").value="";hideAlert("pointsError");hideAlert("pointsSuccess");$("pointsPreview").className="points-preview"}function renderRedeemCatalogue(memberPts){var grid=$("redeemCatGrid");grid.innerHTML=catalogue.map(function(item){var enough=memberPts>=item.points;return\'<div class="cat-item" onclick="selectReward(\\\'\'+item.id+\'\\\',\'+enough+\')" data-id="\'+item.id+\'"><div class="cat-pts">\'+item.points.toLocaleString()+\'</div><div style="font-size:.6rem;letter-spacing:.08em;text-transform:uppercase;color:var(--muted)">points</div><div class="cat-name">\'+item.name+\'</div><div class="cat-avail">\'+( enough?"Available":"Need "+(item.points-memberPts).toLocaleString()+" more")+"</div></div>"}).join("")}function selectReward(rewardId,enough){if(!enough){showAlert("redeemError","Member does not have enough points.");return}selectedReward=catalogue.find(function(r){return r.id===rewardId});document.querySelectorAll(".cat-item").forEach(function(el){el.classList.remove("selected")});var el=document.querySelector(\'.cat-item[data-id="\'+rewardId+\'"]\');if(el)el.classList.add("selected");$("confirmRedeemBtn").disabled=false;hideAlert("redeemError")}function submitRedeem(){if(!selectedRedeemMember||!selectedReward)return;$("confirmRedeemBtn").disabled=true;hideAlert("redeemError");hideAlert("redeemSuccess");google.script.run.withSuccessHandler(function(data){if(data.success){showAlert("redeemSuccess",data.message,"success");$("rm-pts").textContent=data.newBalance.toLocaleString();selectedReward=null;document.querySelectorAll(".cat-item").forEach(function(el){el.classList.remove("selected")});renderRedeemCatalogue(data.newBalance)}else{showAlert("redeemError",data.error);$("confirmRedeemBtn").disabled=false}}).withFailureHandler(function(err){showAlert("redeemError","Error: "+err.message);$("confirmRedeemBtn").disabled=false}).redeemPoints({memberId:selectedRedeemMember.memberId,rewardId:selectedReward.id,postedBy:staffName})}function clearRedeemForm(){selectedRedeemMember=null;selectedReward=null;$("redeemMemberCard").className="member-card";$("redeemForm").style.display="none";$("redeemSearch").value="";hideAlert("redeemError");hideAlert("redeemSuccess")}function showLookupMember(m){populateMemberCard("lk",m);$("lk-email").textContent=m.email;$("lk-phone").textContent=m.phone;$("lookupMemberCard").className="member-card show";showPanel("lookup")}function loadLookupTxns(memberId){google.script.run.withSuccessHandler(function(data){if(data.success&&data.transactions.length){var list=$("lookupTxnList");list.innerHTML=data.transactions.slice(0,20).map(function(t){var isEarn=t.type==="EARN";var d=new Date(t.date).toLocaleDateString("en-GB",{day:"numeric",month:"short",year:"numeric"});var ptColor=isEarn?"#16a34a":"#9b2c2c";var bgColor=isEarn?"#16a34a":"#c9a84c";return\'<div style="display:flex;align-items:center;padding:.7rem 1rem;border-bottom:1px solid var(--border);gap:.75rem;font-size:.8rem"><div style="width:7px;height:7px;border-radius:50%;background:\'+bgColor+\';flex-shrink:0"></div><div style="flex:1">\'+t.description+\'<br><span style="font-size:.68rem;color:var(--muted)">\'+d+" &middot; by "+t.postedBy+\'</span></div><div style="text-align:right"><div style="font-family:Cormorant Garamond,serif;font-size:1rem;color:\'+ptColor+\'">\'+( isEarn?"+":"-")+Math.abs(t.points).toLocaleString()+" pts</div><div style=\"font-size:.65rem;color:var(--muted)\">Balance: "+t.balance.toLocaleString()+"</div></div></div>"}).join("");$("lookupTxns").style.display="block"}}).getTransactions({memberId:memberId})}window.addEventListener("load",function(){var session=sessionStorage.getItem("ul_admin");if(session){var s=JSON.parse(session);if(Date.now()-s.ts<28800000){staffName=s.name;$("adminLoginScreen").style.display="none";$("adminPanel").style.display="block";$("staffDisplay").textContent=s.name;$("staffDisplay").style.display="block";$("adminLogoutBtn").style.display="block";loadDashboard();loadCatalogue()}}});$("adminPass").addEventListener("keydown",function(e){if(e.key==="Enter")doAdminLogin()});</script></body></html>'; }
