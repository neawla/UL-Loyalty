// ============================================================
// URBANA LANGSUAN — LOYALTY PROGRAM BACKEND
// Google Apps Script  |  Deploy: Web App > Execute as Me > Anyone
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

function doGet(e)  { return respond(e); }
function doPost(e) { return respond(e); }

function respond(e) {
  var params = {};

  try {
    if (e && e.parameter) {
      for (var k in e.parameter) { params[k] = e.parameter[k]; }
    }
  } catch (err) {}

  try {
    if (e && e.postData && e.postData.contents) {
      var body = JSON.parse(e.postData.contents);
      for (var k in body) { params[k] = body[k]; }
    }
  } catch (err) {}

  var action   = params.action   ? params.action.toString().trim()   : '';
  var callback = params.callback ? params.callback.toString().trim() : '';
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

  // JSONP — wraps response for cross-origin <script> tag calls
  if (callback) {
    return ContentService
      .createTextOutput(callback + '(' + JSON.stringify(result) + ')')
      .setMimeType(ContentService.MimeType.JAVASCRIPT);
  }

  return ContentService
    .createTextOutput(JSON.stringify(result))
    .setMimeType(ContentService.MimeType.JSON);
}

function testDirect() {
  var e = { parameter: { action: 'getDashboard' }, postData: null };
  var result = respond(e);
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
  var expiry = Utilities.formatDate(new Date(Date.now() + CONFIG.OTP_EXPIRY_MINUTES * 60000), 'Asia/Bangkok', 'yyyy-MM-dd HH:mm:ss');

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
  var desc = description || ('Stay folio ' + amount);
  getSheet(CONFIG.SHEET_TRANSACTIONS).appendRow(
    [now, memberId, 'EARN', desc, amount, pointsEarned, newPts, postedBy]);

  if (newTier !== prevTier) { try { sendTierUpgradeEmail(mEmail, mName, newTier); } catch(e) {} }

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
    if (t === 'GOLD') gold++; else if (t === 'PLATINUM') platinum++; else if (t === 'DIAMOND') diamond++;
    try { var d = new Date(str(mData[i][7])); if (d.getMonth()===tm && d.getFullYear()===ty) newM++; } catch(e){}
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

// ── ONE-TIME SETUP ────────────────────────────────────────────

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
