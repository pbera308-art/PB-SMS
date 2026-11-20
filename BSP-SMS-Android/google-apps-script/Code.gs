/**
 * BSP-SMS Serverless Auth, 30-Day Activation, Single-Device Lock & Admin Monitor
 * Deploy as Web App:
 *   Execute as: Me
 *   Who has access: Anyone
 */

const SHEET_NAME = "Users";
const TIMEZONE = "Asia/Kolkata";
const ADMIN_ID = "9679843774";
const ADMIN_PASSWORD = "9933115114";

const HEADERS = [
  "user_id",
  "phone_number",
  "password",
  "status",
  "expiry_date",
  "active_device_id",
  "last_login",
  "last_activity",
  "created_at"
];

function doGet() {
  return jsonOut({ ok: true, message: "BSP-SMS Auth Service Ready" });
}

function doPost(e) {
  const lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    const raw = (e && e.postData && e.postData.contents) ? e.postData.contents : "{}";
    const body = JSON.parse(raw);
    const action = String(body.action || "").trim();

    switch (action) {
      case "register":
        return jsonOut(handleRegister(body));
      case "login":
        return jsonOut(handleLogin(body));
      case "check_session":
        return jsonOut(handleCheckSession(body));
      case "update_activity":
        return jsonOut(handleUpdateActivity(body));
      case "admin_login":
        return jsonOut(handleAdminLogin(body));
      case "admin_list_users":
        return jsonOut(handleAdminListUsers(body));
      case "admin_activate_user":
        return jsonOut(handleAdminActivateUser(body));
      case "admin_deactivate_user":
        return jsonOut(handleAdminDeactivateUser(body));
      case "admin_reset_device":
        return jsonOut(handleAdminResetDevice(body));
      default:
        return jsonOut({ ok: false, code: "UNKNOWN_ACTION", message: "Unsupported action: " + action });
    }
  } catch (err) {
    return jsonOut({ ok: false, code: "SERVER_ERROR", message: String(err && err.message ? err.message : err) });
  } finally {
    lock.releaseLock();
  }
}

function normalizeHeaderKey(raw) {
  return String(raw || "").trim().toLowerCase().replace(/[^a-z0-9]/g, "");
}

function getSheetSchema(sheet) {
  const lastCol = Math.max(sheet.getLastColumn(), HEADERS.length);
  const headerRow = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  const map = {};
  for (let i = 0; i < headerRow.length; i++) {
    const key = normalizeHeaderKey(headerRow[i]);
    if (key && map[key] === undefined) {
      map[key] = i;
    }
  }

  function findCol(aliases, fallbackIndex) {
    for (let i = 0; i < aliases.length; i++) {
      const norm = normalizeHeaderKey(aliases[i]);
      if (map[norm] !== undefined) return map[norm];
    }
    return fallbackIndex;
  }

  const schema = {
    colCount: lastCol,
    userId: findCol(["user_id", "userid", "id", "uid"], 0),
    phone: findCol(["phone_number", "phonenumber", "phone", "mobile", "mobilenumber", "contact"], 1),
    password: findCol(["password", "pass", "pwd"], 2),
    status: findCol(["status", "state", "account_status"], 3),
    expiryDate: findCol(["expiry_date", "expirydate", "expiry", "valid_until", "validuntil", "expires_at"], 4),
    activeDeviceId: findCol(["active_device_id", "activedeviceid", "device_id", "deviceid", "device"], 5),
    lastLogin: findCol(["last_login", "lastlogin", "lastloginat", "login_time"], 6),
    lastActivity: findCol(["last_activity", "lastactivity", "activity", "updated_at"], 7),
    createdAt: findCol(["created_at", "createdat", "registered_at"], 8)
  };
  return schema;
}

/**
 * Optional Google Sheets installable/simple trigger:
 * When you manually change status -> "active" in the Google Sheet and expiry_date is empty,
 * this automatically sets expiry_date to 30 days from today.
 */
function onEdit(e) {
  if (!e || !e.range) return;
  const sheet = e.range.getSheet();
  if (sheet.getName() !== SHEET_NAME) return;
  const row = e.range.getRow();
  const col = e.range.getColumn();
  const schema = getSheetSchema(sheet);
  if (row <= 1 || col !== schema.status + 1) return;

  const newStatus = String(e.value || "").trim().toLowerCase();
  if (newStatus === "active") {
    const expiryCell = sheet.getRange(row, schema.expiryDate + 1);
    const currentExpiry = formatDateValue(expiryCell.getValue());
    if (!currentExpiry || todayStr() > currentExpiry) {
      expiryCell.setNumberFormat("@").setValue(addDaysStr(30));
    }
    sheet.getRange(row, schema.activeDeviceId + 1).setValue("");
    sheet.getRange(row, schema.lastActivity + 1).setValue("Activated 30d & device unlocked in Sheet (" + nowStr() + ")");
  }
}

function getUsersSheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(SHEET_NAME);
    sheet.appendRow(HEADERS);
    sheet.getRange(1, 1, 1, HEADERS.length).setFontWeight("bold");
    sheet.setFrozenRows(1);
  } else if (sheet.getLastRow() === 0) {
    sheet.appendRow(HEADERS);
    sheet.getRange(1, 1, 1, HEADERS.length).setFontWeight("bold");
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function normalizePhone(raw) {
  const digits = String(raw || "").replace(/\D+/g, "");
  if (digits.length > 10) {
    if (digits.startsWith("91") && digits.length >= 12) {
      return digits.slice(digits.length - 10);
    }
    if (digits.startsWith("0") && digits.length === 11) {
      return digits.slice(1);
    }
    return digits.slice(digits.length - 10);
  }
  return digits;
}

function hashPassword(plain) {
  const bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, String(plain), Utilities.Charset.UTF_8);
  const hex = bytes.map(b => ((b < 0 ? b + 256 : b).toString(16)).padStart(2, "0")).join("");
  return "sha256:" + hex;
}

function verifyPassword(stored, inputPlain) {
  const s = String(stored || "");
  const p = String(inputPlain || "");
  const sTrimmed = s.trim();
  const pTrimmed = p.trim();
  if (!sTrimmed) return false;
  if (sTrimmed.startsWith("sha256:")) {
    return sTrimmed === hashPassword(p) || sTrimmed === hashPassword(pTrimmed);
  }
  // Supports manual plaintext password edits in the Google Sheet
  return s === p || sTrimmed === pTrimmed;
}

function todayStr() {
  return Utilities.formatDate(new Date(), TIMEZONE, "yyyy-MM-dd");
}

function nowStr() {
  return Utilities.formatDate(new Date(), TIMEZONE, "yyyy-MM-dd HH:mm:ss");
}

function addDaysStr(days) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return Utilities.formatDate(d, TIMEZONE, "yyyy-MM-dd");
}

function formatDateValue(val) {
  if (!val) return "";
  if (Object.prototype.toString.call(val) === "[object Date]" && !isNaN(val.getTime())) {
    return Utilities.formatDate(val, TIMEZONE, "yyyy-MM-dd");
  }
  const s = String(val).trim();
  if (!s) return "";
  const token = s.split("T")[0].split(" ")[0].replace(/\//g, "-");
  if (/^\d{4}-\d{2}-\d{2}$/.test(token)) {
    return token;
  }
  const dmy = /^(\d{2})-(\d{2})-(\d{4})$/.exec(token);
  if (dmy) {
    return dmy[3] + "-" + dmy[2] + "-" + dmy[1];
  }
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) {
    return s.slice(0, 10);
  }
  return s;
}

function formatTimestampValue(val) {
  if (!val) return "";
  if (Object.prototype.toString.call(val) === "[object Date]" && !isNaN(val.getTime())) {
    return Utilities.formatDate(val, TIMEZONE, "yyyy-MM-dd HH:mm:ss");
  }
  return String(val).trim();
}

function rowToUser(row, schema) {
  return {
    userId: String(row[schema.userId] || "").trim().toUpperCase(),
    phone: normalizePhone(row[schema.phone]) || String(row[schema.phone] || "").trim(),
    status: String(row[schema.status] || "inactive").trim().toLowerCase(),
    expiryDate: formatDateValue(row[schema.expiryDate]),
    activeDeviceId: String(row[schema.activeDeviceId] || "").trim(),
    lastLogin: formatTimestampValue(row[schema.lastLogin]),
    lastActivity: String(row[schema.lastActivity] || "").trim(),
    createdAt: formatTimestampValue(row[schema.createdAt])
  };
}

function handleRegister(body) {
  const userId = String(body.userId || body.user_id || body.id || "").trim().toUpperCase();
  const phone = normalizePhone(body.phone || body.phone_number || body.mobile || "");
  const password = String(body.password || body.pass || "").trim();
  const deviceId = String(body.deviceId || body.device_id || "").trim();

  if (!userId || userId.length < 4) {
    return { ok: false, code: "INVALID_INPUT", message: "Valid User ID is required." };
  }
  if (!phone || phone.length < 10) {
    return { ok: false, code: "INVALID_PHONE", message: "Please enter a valid 10-digit phone number." };
  }
  if (!password || password.length < 4) {
    return { ok: false, code: "WEAK_PASSWORD", message: "Password must be at least 4 characters." };
  }

  const sheet = getUsersSheet();
  const schema = getSheetSchema(sheet);
  const lastRow = sheet.getLastRow();
  if (lastRow > 1) {
    const values = sheet.getRange(2, 1, lastRow - 1, schema.colCount).getValues();
    for (let i = 0; i < values.length; i++) {
      const existingId = String(values[i][schema.userId] || "").trim().toUpperCase();
      const existingPhone = normalizePhone(values[i][schema.phone]);
      if (existingId === userId) {
        return { ok: false, code: "USER_ID_EXISTS", message: "User ID already exists. Generate a new ID and try again." };
      }
      if (existingPhone === phone) {
        return { ok: false, code: "PHONE_EXISTS", message: "This phone number is already registered. Please use General Login." };
      }
    }
  }

  const createdAt = nowStr();
  const newRow = new Array(schema.colCount).fill("");
  newRow[schema.userId] = userId;
  newRow[schema.phone] = phone;
  newRow[schema.password] = hashPassword(password);
  newRow[schema.status] = "inactive";
  newRow[schema.expiryDate] = "";
  newRow[schema.activeDeviceId] = deviceId;
  newRow[schema.lastLogin] = "";
  newRow[schema.lastActivity] = "Registered (awaiting admin activation)";
  newRow[schema.createdAt] = createdAt;
  sheet.appendRow(newRow);

  // Force phone_number column as plain text to preserve formatting
  const newRowIdx = sheet.getLastRow();
  sheet.getRange(newRowIdx, schema.phone + 1).setNumberFormat("@").setValue(phone);

  return {
    ok: true,
    code: "REGISTERED",
    message: "Registration successful. Your account is inactive until activated by Admin.",
    user: {
      userId: userId,
      phone: phone,
      status: "inactive",
      expiryDate: "",
      activeDeviceId: deviceId,
      lastLogin: "",
      lastActivity: "Registered",
      createdAt: createdAt
    }
  };
}

function findUserRow(sheet, schema, identifier) {
  const lastRow = sheet.getLastRow();
  if (lastRow <= 1) return null;

  const rawTrimmed = String(identifier || "").trim();
  const idUpper = rawTrimmed.toUpperCase();
  const phoneNorm = normalizePhone(rawTrimmed);
  const values = sheet.getRange(2, 1, lastRow - 1, schema.colCount).getValues();

  for (let i = 0; i < values.length; i++) {
    const rowUserId = String(values[i][schema.userId] || "").trim().toUpperCase();
    const rowPhoneRaw = String(values[i][schema.phone] || "").trim();
    const rowPhone = normalizePhone(rowPhoneRaw);
    if (
      (idUpper && rowUserId === idUpper) ||
      (phoneNorm && phoneNorm.length >= 10 && rowPhone === phoneNorm) ||
      (rawTrimmed && rowPhoneRaw === rawTrimmed)
    ) {
      return { rowIndex: i + 2, row: values[i] };
    }
  }
  return null;
}

function handleLogin(body) {
  const identifier = String(
    body.identifier ||
    body.userId ||
    body.user_id ||
    body.phone ||
    body.phone_number ||
    body.mobile ||
    ""
  ).trim();
  const password = String(body.password || body.pass || "").trim();
  const deviceId = String(body.deviceId || body.device_id || "").trim();

  if (!identifier || !password) {
    return { ok: false, code: "INVALID_INPUT", message: "Enter User ID / Phone Number and Password." };
  }
  if (!deviceId) {
    return { ok: false, code: "DEVICE_REQUIRED", message: "Device ID unavailable." };
  }

  const sheet = getUsersSheet();
  const schema = getSheetSchema(sheet);
  const found = findUserRow(sheet, schema, identifier);
  if (!found) {
    return { ok: false, code: "NOT_FOUND", message: "Account not found. Please register first." };
  }

  const { rowIndex, row } = found;
  if (!verifyPassword(row[schema.password], password)) {
    return { ok: false, code: "BAD_PASSWORD", message: "Incorrect password." };
  }

  const user = rowToUser(row, schema);
  const displayId = user.userId || user.phone || identifier;
  if (user.status !== "active") {
    return {
      ok: false,
      code: "INACTIVE",
      message: "Your account (" + displayId + ") is inactive. Contact Admin for 30-day activation.",
      user: user
    };
  }

  // If Admin manually set status='active' in Sheet without filling expiry_date, auto-set 30 days
  let expiryDate = user.expiryDate;
  if (!expiryDate) {
    expiryDate = addDaysStr(30);
    sheet.getRange(rowIndex, schema.expiryDate + 1).setNumberFormat("@").setValue(expiryDate);
    user.expiryDate = expiryDate;
  }

  if (todayStr() > expiryDate) {
    return {
      ok: false,
      code: "EXPIRED",
      message: "Your 1-month (30-day) subscription expired on " + expiryDate + ". Contact Admin to renew.",
      user: user
    };
  }

  if (user.activeDeviceId && user.activeDeviceId !== deviceId) {
    return {
      ok: false,
      code: "DEVICE_LOCKED",
      message: "Account locked to another device (" + user.activeDeviceId.slice(0, 8) + "...). Ask Admin to reset device lock.",
      user: user
    };
  }

  const loginTs = nowStr();
  if (!user.activeDeviceId) {
    sheet.getRange(rowIndex, schema.activeDeviceId + 1).setValue(deviceId);
    user.activeDeviceId = deviceId;
  }
  sheet.getRange(rowIndex, schema.lastLogin + 1).setValue(loginTs);
  sheet.getRange(rowIndex, schema.lastActivity + 1).setValue("Logged in (" + loginTs + ")");
  user.lastLogin = loginTs;
  user.lastActivity = "Logged in (" + loginTs + ")";

  return {
    ok: true,
    code: "OK",
    message: "Login successful.",
    user: user
  };
}

function handleCheckSession(body) {
  const userId = String(body.userId || body.user_id || body.identifier || "").trim();
  const deviceId = String(body.deviceId || body.device_id || "").trim();
  if (!userId || !deviceId) {
    return { ok: false, code: "INVALID_SESSION", message: "Session invalid." };
  }

  const sheet = getUsersSheet();
  const schema = getSheetSchema(sheet);
  const found = findUserRow(sheet, schema, userId);
  if (!found) {
    return { ok: false, code: "NOT_FOUND", message: "Account no longer exists." };
  }

  const { rowIndex, row } = found;
  const user = rowToUser(row, schema);

  if (user.status !== "active") {
    return {
      ok: false,
      code: "INACTIVE",
      message: "Your account is currently inactive. Contact Admin for activation.",
      user: user
    };
  }

  if (!user.expiryDate || todayStr() > user.expiryDate) {
    return {
      ok: false,
      code: "EXPIRED",
      message: "Your 1-month (30-day) subscription expired on " + (user.expiryDate || "N/A") + ". Contact Admin to renew.",
      user: user
    };
  }

  if (!user.activeDeviceId || user.activeDeviceId !== deviceId) {
    return {
      ok: false,
      code: "DEVICE_LOCKED",
      message: "Device lock mismatch or reset by Admin. Please sign in again.",
      user: user
    };
  }

  sheet.getRange(rowIndex, schema.lastActivity + 1).setValue("Session verified (" + nowStr() + ")");
  return { ok: true, code: "OK", message: "Session valid.", user: user };
}

function handleUpdateActivity(body) {
  const userId = String(body.userId || body.user_id || body.identifier || "").trim();
  const deviceId = String(body.deviceId || body.device_id || "").trim();
  const activity = String(body.activity || "Active").trim();

  const sheet = getUsersSheet();
  const schema = getSheetSchema(sheet);
  const found = findUserRow(sheet, schema, userId);
  if (!found) {
    return { ok: false, code: "NOT_FOUND", message: "Account not found." };
  }
  const { rowIndex, row } = found;
  const user = rowToUser(row, schema);
  if (user.activeDeviceId && deviceId && user.activeDeviceId !== deviceId) {
    return { ok: false, code: "DEVICE_LOCKED", message: "Device lock mismatch." };
  }
  sheet.getRange(rowIndex, schema.lastActivity + 1).setValue(activity + " (" + nowStr() + ")");
  return { ok: true, code: "OK", message: "Activity updated." };
}

function verifyAdmin(body) {
  const adminId = String(body.adminId || body.admin_id || "").trim();
  const adminPass = String(body.adminPassword || body.admin_password || "").trim();
  return adminId === ADMIN_ID && adminPass === ADMIN_PASSWORD;
}

function handleAdminLogin(body) {
  if (!verifyAdmin(body)) {
    return { ok: false, code: "UNAUTHORIZED", message: "Invalid Admin ID or Password." };
  }
  return { ok: true, code: "ADMIN_OK", message: "Admin verified." };
}

function handleAdminListUsers(body) {
  if (!verifyAdmin(body)) {
    return { ok: false, code: "UNAUTHORIZED", message: "Unauthorized admin credentials." };
  }
  const sheet = getUsersSheet();
  const schema = getSheetSchema(sheet);
  const lastRow = sheet.getLastRow();
  const users = [];
  if (lastRow > 1) {
    const values = sheet.getRange(2, 1, lastRow - 1, schema.colCount).getValues();
    for (let i = 0; i < values.length; i++) {
      if (!values[i][schema.userId] && !values[i][schema.phone]) continue;
      users.push(rowToUser(values[i], schema));
    }
  }
  return { ok: true, code: "OK", message: "Loaded " + users.length + " user(s).", users: users };
}

function resolveTargetUserId(body) {
  return String(
    body.targetUserId ||
    body.target_user_id ||
    body.userId ||
    body.user_id ||
    body.identifier ||
    ""
  ).trim();
}

function handleAdminActivateUser(body) {
  if (!verifyAdmin(body)) {
    return { ok: false, code: "UNAUTHORIZED", message: "Unauthorized admin credentials." };
  }
  const targetUserId = resolveTargetUserId(body);
  const sheet = getUsersSheet();
  const schema = getSheetSchema(sheet);
  const found = findUserRow(sheet, schema, targetUserId);
  if (!found) {
    return { ok: false, code: "NOT_FOUND", message: "User not found: " + targetUserId };
  }

  const expiry = addDaysStr(30);
  const ts = nowStr();
  sheet.getRange(found.rowIndex, schema.status + 1).setValue("active");
  sheet.getRange(found.rowIndex, schema.expiryDate + 1).setNumberFormat("@").setValue(expiry);
  sheet.getRange(found.rowIndex, schema.activeDeviceId + 1).setValue("");
  sheet.getRange(found.rowIndex, schema.lastActivity + 1).setValue("Activated 30d & device unlocked by Admin (" + ts + ")");

  const updatedRow = sheet.getRange(found.rowIndex, 1, 1, schema.colCount).getValues()[0];
  const updatedUser = rowToUser(updatedRow, schema);
  return {
    ok: true,
    code: "ACTIVATED",
    message: "Activated " + (updatedUser.userId || updatedUser.phone) + " until " + expiry + " (device lock reset)",
    user: updatedUser
  };
}

function handleAdminDeactivateUser(body) {
  if (!verifyAdmin(body)) {
    return { ok: false, code: "UNAUTHORIZED", message: "Unauthorized admin credentials." };
  }
  const targetUserId = resolveTargetUserId(body);
  const sheet = getUsersSheet();
  const schema = getSheetSchema(sheet);
  const found = findUserRow(sheet, schema, targetUserId);
  if (!found) {
    return { ok: false, code: "NOT_FOUND", message: "User not found: " + targetUserId };
  }

  const ts = nowStr();
  sheet.getRange(found.rowIndex, schema.status + 1).setValue("inactive");
  sheet.getRange(found.rowIndex, schema.lastActivity + 1).setValue("Deactivated by Admin (" + ts + ")");

  const updatedRow = sheet.getRange(found.rowIndex, 1, 1, schema.colCount).getValues()[0];
  const updatedUser = rowToUser(updatedRow, schema);
  return {
    ok: true,
    code: "DEACTIVATED",
    message: "Deactivated " + (updatedUser.userId || updatedUser.phone),
    user: updatedUser
  };
}

function handleAdminResetDevice(body) {
  if (!verifyAdmin(body)) {
    return { ok: false, code: "UNAUTHORIZED", message: "Unauthorized admin credentials." };
  }
  const targetUserId = resolveTargetUserId(body);
  const sheet = getUsersSheet();
  const schema = getSheetSchema(sheet);
  const found = findUserRow(sheet, schema, targetUserId);
  if (!found) {
    return { ok: false, code: "NOT_FOUND", message: "User not found: " + targetUserId };
  }

  const ts = nowStr();
  sheet.getRange(found.rowIndex, schema.activeDeviceId + 1).setValue("");
  sheet.getRange(found.rowIndex, schema.lastActivity + 1).setValue("Device lock reset by Admin (" + ts + ")");

  const updatedRow = sheet.getRange(found.rowIndex, 1, 1, schema.colCount).getValues()[0];
  const updatedUser = rowToUser(updatedRow, schema);
  return {
    ok: true,
    code: "DEVICE_RESET",
    message: "Device lock cleared for " + (updatedUser.userId || updatedUser.phone),
    user: updatedUser
  };
}

function jsonOut(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
