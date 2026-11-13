/**
 * Meter Log – Google Sheet backend.
 *
 * One-time setup (see README.md):
 *   1. Paste this file into Extensions > Apps Script of a new Google Sheet.
 *   2. Run the function `setup` once and approve the permissions.
 *   3. Deploy > New deployment > Web app (Execute as: Me, Access: Anyone).
 *   4. Paste the Web app URL into the Settings tab, then use the
 *      "Meter Log" menu > "Reception setup link".
 */

var TAB = { R: 'Readings', S: 'Settings', A: 'Analysis', C: 'Changes', W: 'Weather', P: 'Photos' };
var FIELDS = ['m1p', 'm1o', 'm2p', 'm2o'];
var R_HEAD = ['Date', 'Saved at', 'Meter 1 Peak', 'Meter 1 Off-peak', 'Meter 2 Peak', 'Meter 2 Off-peak',
  'Rooms occupied (that night)', 'Note', 'Flags', 'Photos'];
var A_HEAD = ['Date', 'Days since last reading', 'Peak units / day', 'Off-peak units / day', 'Total units / day',
  'Energy cost Rs / day', 'Rooms occupied (night before)', 'Rooms occupied (this night)',
  'Units per occupied room', 'Rs per occupied room', 'Temp high C', 'Temp low C',
  'Meter 1 units / day', 'Meter 2 units / day', 'Complete?'];

var SETTINGS = [
  ['Access key', '', 'Secret the reception phone uses. Change it to lock out an old phone.'],
  ['Web app URL', '', 'Paste the URL you get from Deploy > New deployment (ends in /exec).'],
  ['Page URL', 'https://abnaeem0.github.io/utilities-log/', 'Where the entry page lives.'],
  ['Total rooms', 8, ''],
  ['Meter 1 name', 'Meter 1', 'Shown on the entry page, e.g. "Left side".'],
  ['Meter 2 name', 'Meter 2', ''],
  ['Meter 1 multiplier', 1, 'Leave at 1 unless the bill shows a multiplying factor (MF).'],
  ['Meter 2 multiplier', 1, ''],
  ['Peak rate Rs per unit', '', 'From your bill. Needed for cost columns.'],
  ['Off-peak rate Rs per unit', '', ''],
  ['Jump flag (times normal)', 3, 'Flag a reading when the day\'s use is this many times the usual.'],
  ['Latitude', 33.6844, 'For outside temperature (Islamabad).'],
  ['Longitude', 73.0479, ''],
  ['Photo folder ID', '', 'Filled in automatically on first photo.']
];

/* ------------------------------------------------------------------ */
/* Pure logic (no Google services) – also unit-tested outside Sheets.  */
/* ------------------------------------------------------------------ */

function dayDiff(a, b) { // b - a in days, both 'yyyy-MM-dd'
  var pa = a.split('-'), pb = b.split('-');
  return Math.round((Date.UTC(+pb[0], pb[1] - 1, +pb[2]) - Date.UTC(+pa[0], pa[1] - 1, +pa[2])) / 86400000);
}

function numOrNull(x) {
  if (x === '' || x === null || x === undefined) return null;
  var n = typeof x === 'number' ? x : parseFloat(String(x).replace(/[, ]/g, ''));
  return isFinite(n) ? n : null;
}

/** Last non-blank value of each register strictly before `date`. */
function prevFor(rows, date) {
  var out = [null, null, null, null];
  for (var i = 0; i < rows.length; i++) {
    if (rows[i].date >= date) break;
    for (var f = 0; f < 4; f++) {
      if (rows[i].v[f] !== null) out[f] = { value: rows[i].v[f], date: rows[i].date };
    }
  }
  return out;
}

/** Per-day change of one register for every row (null when unknown). */
function perDay(rows, f) {
  var out = [], last = null;
  for (var i = 0; i < rows.length; i++) {
    var v = rows[i].v[f];
    if (v !== null && last !== null) {
      var d = dayDiff(last.date, rows[i].date);
      out.push(d > 0 ? { perDay: (v - last.value) / d, days: d } : null);
    } else out.push(null);
    if (v !== null) last = { value: v, date: rows[i].date };
  }
  return out;
}

/** Usual daily use of each register: median of the last 7 good days before `date`. */
function typicalFor(rows, date) {
  var before = rows.filter(function (r) { return r.date < date; });
  return [0, 1, 2, 3].map(function (f) {
    var d = perDay(before, f).filter(function (x) { return x && x.perDay >= 0; })
      .map(function (x) { return x.perDay; }).slice(-7);
    if (d.length < 3) return null;
    d.sort(function (a, b) { return a - b; });
    var m = Math.floor(d.length / 2);
    return d.length % 2 ? d[m] : (d[m - 1] + d[m]) / 2;
  });
}

function round(x, dp) { var p = Math.pow(10, dp); return Math.round(x * p) / p; }

/** Rows for the Analysis tab. */
function analysisRows(rows, s, weather) {
  var pd = [0, 1, 2, 3].map(function (f) { return perDay(rows, f); });
  var mult = [s.mult1, s.mult1, s.mult2, s.mult2];
  var out = [];
  for (var i = 1; i < rows.length; i++) {
    var u = [0, 1, 2, 3].map(function (f) { return pd[f][i] ? pd[f][i].perDay * mult[f] : null; });
    var days = Math.max.apply(null, [0, 1, 2, 3].map(function (f) { return pd[f][i] ? pd[f][i].days : 0; }));
    var complete = u.every(function (x) { return x !== null; });
    var peak = complete ? u[0] + u[2] : '';
    var off = complete ? u[1] + u[3] : '';
    var total = complete ? peak + off : '';
    var cost = (complete && s.peakRate !== null && s.offRate !== null) ? peak * s.peakRate + off * s.offRate : '';
    var roomsPrev = rows[i - 1].rooms, roomsNow = rows[i].rooms;
    var w = weather[rows[i].date] || {};
    out.push([
      rows[i].date,
      days || '',
      peak === '' ? '' : round(peak, 2),
      off === '' ? '' : round(off, 2),
      total === '' ? '' : round(total, 2),
      cost === '' ? '' : round(cost, 0),
      roomsPrev === null ? '' : roomsPrev,
      roomsNow === null ? '' : roomsNow,
      (total !== '' && roomsPrev) ? round(total / roomsPrev, 2) : '',
      (cost !== '' && roomsPrev) ? round(cost / roomsPrev, 0) : '',
      w.hi === undefined ? '' : w.hi,
      w.lo === undefined ? '' : w.lo,
      (u[0] !== null && u[1] !== null) ? round(u[0] + u[1], 2) : '',
      (u[2] !== null && u[3] !== null) ? round(u[2] + u[3], 2) : '',
      complete ? 'yes' : 'no'
    ]);
  }
  return out;
}

/** What the entry page needs to show for one date. */
function statusFor(rows, date, s, photoCounts) {
  var entry = null;
  rows.forEach(function (r) { if (r.date === date) entry = r; });
  var hist = rows.slice(-3).reverse().map(function (r) {
    return { date: r.date, v: r.v, rooms: r.rooms, note: r.note, flags: r.flags };
  });
  return {
    ok: true,
    date: date,
    names: [s.name1, s.name2],
    totalRooms: s.totalRooms,
    jump: s.jump,
    entry: entry ? { v: entry.v, rooms: entry.rooms, note: entry.note } : null,
    prev: prevFor(rows, date),
    typical: typicalFor(rows, date),
    history: hist,
    photos: photoCounts[date] || 0
  };
}

/* ------------------------------------------------------------------ */
/* Google Sheet plumbing                                               */
/* ------------------------------------------------------------------ */

function ss_() { return SpreadsheetApp.getActiveSpreadsheet(); }
function tz_() { return ss_().getSpreadsheetTimeZone(); }

function dateStr_(v) {
  if (v instanceof Date) return Utilities.formatDate(v, tz_(), 'yyyy-MM-dd');
  var m = String(v).match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? m[0] : '';
}

function tab_(name, head) {
  var ss = ss_(), sh = ss.getSheetByName(name);
  if (!sh) {
    sh = ss.insertSheet(name);
    if (head) {
      sh.getRange(1, 1, 1, head.length).setValues([head]).setFontWeight('bold').setWrap(true);
      sh.setFrozenRows(1);
    }
  }
  return sh;
}

function setup() {
  var ss = ss_();
  ss.setSpreadsheetTimeZone('Asia/Karachi');
  var r = tab_(TAB.R, R_HEAD);
  r.getRange('A:A').setNumberFormat('yyyy-mm-dd');
  r.getRange('B:B').setNumberFormat('yyyy-mm-dd hh:mm');
  tab_(TAB.A, A_HEAD).getRange('A:A').setNumberFormat('yyyy-mm-dd');
  tab_(TAB.C, ['Changed at', 'Reading date', 'Field', 'Old value', 'New value']);
  tab_(TAB.W, ['Date', 'High C', 'Low C']).getRange('A:A').setNumberFormat('yyyy-mm-dd');
  tab_(TAB.P, ['Reading date', 'Uploaded at', 'File', 'Link']);

  var s = ss.getSheetByName(TAB.S);
  if (!s) {
    s = ss.insertSheet(TAB.S);
    var rows = [['Setting', 'Value', 'Notes']].concat(SETTINGS);
    s.getRange(1, 1, rows.length, 3).setValues(rows);
    s.getRange(1, 1, 1, 3).setFontWeight('bold');
    s.getRange(2, 2).setValue(Utilities.getUuid().replace(/-/g, '').slice(0, 16));
    s.setColumnWidth(1, 200); s.setColumnWidth(2, 320); s.setColumnWidth(3, 460);
    s.setFrozenRows(1);
  }
  var first = ss.getSheetByName('Sheet1');
  if (first && first.getLastRow() === 0 && ss.getSheets().length > 1) ss.deleteSheet(first);
  ss.setActiveSheet(r);
  onOpen();
}

function onOpen() {
  SpreadsheetApp.getUi().createMenu('Meter Log')
    .addItem('Reception setup link', 'showSetupLink')
    .addItem('Recalculate analysis', 'rebuildAnalysis')
    .addItem('Update temperatures', 'updateWeather')
    .addToUi();
}

/** Keep Analysis in step when you fix numbers directly in the sheet. */
function onEdit(e) {
  try {
    var n = e.range.getSheet().getName();
    if (n === TAB.R || n === TAB.S) rebuildAnalysis();
  } catch (err) { /* ignore */ }
}

function settings_() {
  var sh = ss_().getSheetByName(TAB.S);
  if (!sh) throw new Error('Run setup first');
  var map = {};
  sh.getDataRange().getValues().forEach(function (r) { map[String(r[0]).trim()] = r[1]; });
  var n = function (k, d) { var x = numOrNull(map[k]); return x === null ? d : x; };
  return {
    key: String(map['Access key'] || '').trim(),
    webUrl: String(map['Web app URL'] || '').trim(),
    pageUrl: String(map['Page URL'] || '').trim(),
    totalRooms: n('Total rooms', 8),
    name1: String(map['Meter 1 name'] || 'Meter 1'),
    name2: String(map['Meter 2 name'] || 'Meter 2'),
    mult1: n('Meter 1 multiplier', 1),
    mult2: n('Meter 2 multiplier', 1),
    peakRate: n('Peak rate Rs per unit', null),
    offRate: n('Off-peak rate Rs per unit', null),
    jump: n('Jump flag (times normal)', 3),
    lat: n('Latitude', 33.6844),
    lon: n('Longitude', 73.0479),
    photoFolder: String(map['Photo folder ID'] || '').trim()
  };
}

function setSetting_(label, value) {
  var sh = ss_().getSheetByName(TAB.S);
  var vals = sh.getRange(1, 1, sh.getLastRow(), 1).getValues();
  for (var i = 0; i < vals.length; i++) {
    if (String(vals[i][0]).trim() === label) { sh.getRange(i + 1, 2).setValue(value); return; }
  }
  sh.appendRow([label, value, '']);
}

function readRows_() {
  var sh = ss_().getSheetByName(TAB.R);
  var last = sh.getLastRow();
  if (last < 2) return [];
  var vals = sh.getRange(2, 1, last - 1, R_HEAD.length).getValues();
  var rows = [];
  vals.forEach(function (r, i) {
    var d = dateStr_(r[0]);
    if (!d) return;
    rows.push({
      row: i + 2, date: d,
      v: [numOrNull(r[2]), numOrNull(r[3]), numOrNull(r[4]), numOrNull(r[5])],
      rooms: numOrNull(r[6]), note: String(r[7] || ''), flags: String(r[8] || '')
    });
  });
  rows.sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : 0; });
  return rows;
}

function photoCounts_() {
  var sh = ss_().getSheetByName(TAB.P), out = {};
  if (!sh || sh.getLastRow() < 2) return out;
  sh.getRange(2, 1, sh.getLastRow() - 1, 1).getValues().forEach(function (r) {
    var d = dateStr_(r[0]); if (d) out[d] = (out[d] || 0) + 1;
  });
  return out;
}

function weatherMap_() {
  var sh = ss_().getSheetByName(TAB.W), out = {};
  if (!sh || sh.getLastRow() < 2) return out;
  sh.getRange(2, 1, sh.getLastRow() - 1, 3).getValues().forEach(function (r) {
    var d = dateStr_(r[0]); if (d) out[d] = { hi: r[1], lo: r[2] };
  });
  return out;
}

/** Daily high / low from Open-Meteo (free, no account). Covers the last 30 days. */
function updateWeather() {
  var s = settings_();
  var url = 'https://api.open-meteo.com/v1/forecast?latitude=' + s.lat + '&longitude=' + s.lon +
    '&daily=temperature_2m_max,temperature_2m_min&timezone=Asia%2FKarachi&past_days=30&forecast_days=1';
  var res = JSON.parse(UrlFetchApp.fetch(url, { muteHttpExceptions: true }).getContentText());
  if (!res.daily || !res.daily.time) return;
  var map = weatherMap_();
  res.daily.time.forEach(function (d, i) {
    var hi = res.daily.temperature_2m_max[i], lo = res.daily.temperature_2m_min[i];
    if (hi !== null && lo !== null) map[d] = { hi: hi, lo: lo };
  });
  var dates = Object.keys(map).sort();
  var sh = ss_().getSheetByName(TAB.W);
  if (sh.getLastRow() > 1) sh.getRange(2, 1, sh.getLastRow() - 1, 3).clearContent();
  if (dates.length) {
    sh.getRange(2, 1, dates.length, 3).setValues(dates.map(function (d) { return [d, map[d].hi, map[d].lo]; }));
  }
}

function rebuildAnalysis() {
  var sh = ss_().getSheetByName(TAB.A);
  var out = analysisRows(readRows_(), settings_(), weatherMap_());
  if (sh.getLastRow() > 1) sh.getRange(2, 1, sh.getLastRow() - 1, A_HEAD.length).clearContent();
  if (out.length) sh.getRange(2, 1, out.length, A_HEAD.length).setValues(out);
}

function saveReading_(p) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(p.date))) throw new Error('Bad date');
  var sh = ss_().getSheetByName(TAB.R);
  var rows = readRows_();
  var now = new Date();
  var v = FIELDS.map(function (f) { return numOrNull(p[f]); });
  var rooms = numOrNull(p.rooms);
  var newVals = [v[0], v[1], v[2], v[3], rooms, String(p.note || ''), String(p.flags || '')]
    .map(function (x) { return x === null ? '' : x; });
  var existing = null;
  rows.forEach(function (r) { if (r.date === p.date) existing = r; });

  if (existing) {
    var old = [existing.v[0], existing.v[1], existing.v[2], existing.v[3], existing.rooms, existing.note, existing.flags]
      .map(function (x) { return x === null ? '' : x; });
    var log = [];
    for (var i = 0; i < 6; i++) { // values, rooms and note (flags are not logged)
      if (String(old[i]) !== String(newVals[i])) log.push([now, p.date, R_HEAD[i + 2], old[i], newVals[i]]);
    }
    if (log.length) {
      var c = ss_().getSheetByName(TAB.C);
      c.getRange(c.getLastRow() + 1, 1, log.length, 5).setValues(log);
    }
    sh.getRange(existing.row, 2, 1, 8).setValues([[now].concat(newVals)]);
  } else {
    sh.appendRow([p.date, now].concat(newVals).concat(['']));
    var last = sh.getLastRow();
    if (last > 2) sh.getRange(2, 1, last - 1, R_HEAD.length).sort(1);
  }
  linkPhotos_(p.date);
}

function photoRoot_() {
  var s = settings_(), folder = null;
  if (s.photoFolder) { try { folder = DriveApp.getFolderById(s.photoFolder); } catch (e) { folder = null; } }
  if (!folder) {
    folder = DriveApp.createFolder('Meter Log Photos');
    setSetting_('Photo folder ID', folder.getId());
  }
  return folder;
}

function dateFolder_(date, create) {
  var root = photoRoot_(), it = root.getFoldersByName(date);
  if (it.hasNext()) return it.next();
  return create ? root.createFolder(date) : null;
}

/** Put the day's photo-folder link on the Readings row, if both exist. */
function linkPhotos_(date) {
  if (!photoCounts_()[date]) return;
  var folder = dateFolder_(date, false);
  if (!folder) return;
  var rows = readRows_();
  for (var i = 0; i < rows.length; i++) {
    if (rows[i].date === date) {
      ss_().getSheetByName(TAB.R).getRange(rows[i].row, 10).setValue(folder.getUrl());
      return;
    }
  }
}

function savePhoto_(p) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(p.date))) throw new Error('Bad date');
  var mime = String(p.mime || 'application/octet-stream');
  if (!/^(image|audio)\//.test(mime)) throw new Error('Only photos or audio');
  var now = new Date();
  var stamp = Utilities.formatDate(now, tz_(), 'HHmmss');
  var name = p.date + '_' + stamp + '_' + String(p.name || 'file').replace(/[^\w.\-]/g, '_').slice(-60);
  var blob = Utilities.newBlob(Utilities.base64Decode(p.data), mime, name);
  var file = dateFolder_(p.date, true).createFile(blob);
  ss_().getSheetByName(TAB.P).appendRow([p.date, now, name, file.getUrl()]);
  linkPhotos_(p.date);
}

function json_(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}

function doGet() {
  return ContentService.createTextOutput('Meter Log backend is running.');
}

function doPost(e) {
  try {
    var p = JSON.parse(e.postData.contents);
    var s = settings_();
    if (!s.key || String(p.key || '') !== s.key) return json_({ ok: false, error: 'key' });

    if (p.action === 'save' || p.action === 'photo') {
      var lock = LockService.getScriptLock();
      lock.waitLock(20000);
      try {
        if (p.action === 'save') {
          saveReading_(p);
          try { updateWeather(); } catch (w) { /* temperature is optional */ }
          rebuildAnalysis();
        } else {
          savePhoto_(p);
        }
      } finally { lock.releaseLock(); }
    } else if (p.action !== 'status') {
      return json_({ ok: false, error: 'Unknown action' });
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(p.date))) return json_({ ok: false, error: 'Bad date' });
    return json_(statusFor(readRows_(), p.date, s, photoCounts_()));
  } catch (err) {
    return json_({ ok: false, error: String(err && err.message || err) });
  }
}

function showSetupLink() {
  var s = settings_();
  var url = s.webUrl || ScriptApp.getService().getUrl() || '';
  var ui = SpreadsheetApp.getUi();
  if (!/\/exec$/.test(url)) {
    ui.alert('Almost there', 'Deploy the script as a Web app first, then paste its URL (ending in /exec) ' +
      'into the "Web app URL" row of the Settings tab and try again.', ui.ButtonSet.OK);
    return;
  }
  var payload = Utilities.base64EncodeWebSafe(JSON.stringify({ u: url, k: s.key })).replace(/=+$/, '');
  var link = s.pageUrl.replace(/#.*$/, '') + '#s=' + payload;
  var html = HtmlService.createHtmlOutput(
    '<div style="font:14px system-ui,sans-serif">' +
    '<p>Open this link <b>once</b> on the reception phone, then add the page to the home screen. ' +
    'Treat it like a password.</p>' +
    '<textarea readonly style="width:100%;height:110px" onclick="this.select()">' + link + '</textarea></div>'
  ).setWidth(460).setHeight(230);
  ui.showModalDialog(html, 'Reception setup link');
}

if (typeof module !== 'undefined') {
  module.exports = { dayDiff: dayDiff, numOrNull: numOrNull, prevFor: prevFor, perDay: perDay,
    typicalFor: typicalFor, analysisRows: analysisRows, statusFor: statusFor };
}
