package com.bspsms.android

import android.content.Context
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject
import org.json.JSONTokener
import java.io.BufferedReader
import java.io.InputStreamReader
import java.io.OutputStreamWriter
import java.net.HttpURLConnection
import java.net.URL

class AuthRepository(context: Context) {
    companion object {
        const val ADMIN_ID = "9679843774"
        const val ADMIN_PASS = "9933115114"
        private const val PREFS_NAME = "bsp_sms_auth_prefs"
        private const val KEY_SCRIPT_URL = "custom_apps_script_url"
        private const val KEY_IS_ADMIN = "session_is_admin"
        private const val KEY_USER_ID = "session_user_id"
        private const val KEY_PHONE = "session_phone"
        private const val KEY_EXPIRY = "session_expiry"
        private const val KEY_DEVICE_ID = "session_device_id"
    }

    private val appContext = context.applicationContext
    private val prefs = appContext.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)

    fun getEffectiveScriptUrl(): String {
        val custom = prefs.getString(KEY_SCRIPT_URL, null)?.trim()
        if (!custom.isNullOrBlank()) return custom
        return BuildConfig.APPS_SCRIPT_URL.trim()
    }

    fun saveCustomScriptUrl(url: String) {
        val cleaned = url.trim().replace("\n", "").replace("\r", "")
        prefs.edit().putString(KEY_SCRIPT_URL, cleaned).commit()
    }

    fun isScriptUrlConfigured(): Boolean {
        val url = getEffectiveScriptUrl()
        return url.startsWith("https://", ignoreCase = true) &&
            !url.contains("REPLACE_WITH_YOUR_DEPLOYMENT_ID")
    }

    fun loadSavedSession(): AuthSession? {
        val userId = prefs.getString(KEY_USER_ID, null) ?: return null
        val isAdmin = prefs.getBoolean(KEY_IS_ADMIN, false)
        val phone = prefs.getString(KEY_PHONE, "") ?: ""
        val expiry = prefs.getString(KEY_EXPIRY, "") ?: ""
        val deviceId = prefs.getString(KEY_DEVICE_ID, "") ?: resolveStableDeviceId(appContext)
        return AuthSession(
            isAdmin = isAdmin,
            userId = userId,
            phone = phone,
            expiryDate = expiry,
            deviceId = deviceId
        )
    }

    fun saveSession(session: AuthSession) {
        prefs.edit()
            .putBoolean(KEY_IS_ADMIN, session.isAdmin)
            .putString(KEY_USER_ID, session.userId.trim())
            .putString(KEY_PHONE, session.phone.trim())
            .putString(KEY_EXPIRY, session.expiryDate.trim())
            .putString(KEY_DEVICE_ID, session.deviceId.trim())
            .apply()
    }

    fun clearSession() {
        prefs.edit()
            .remove(KEY_IS_ADMIN)
            .remove(KEY_USER_ID)
            .remove(KEY_PHONE)
            .remove(KEY_EXPIRY)
            .remove(KEY_DEVICE_ID)
            .apply()
    }

    suspend fun register(
        userId: String,
        phone: String,
        password: String,
        deviceId: String
    ): AuthResponse {
        val cleanId = normalizeUserId(userId)
        val cleanPhone = normalizePhoneNumber(phone)
        val cleanPass = normalizePassword(password)
        val cleanDevice = deviceId.trim()
        val payload = JSONObject()
            .put("action", "register")
            .put("userId", cleanId)
            .put("user_id", cleanId)
            .put("phone", cleanPhone)
            .put("phone_number", cleanPhone)
            .put("password", cleanPass)
            .put("deviceId", cleanDevice)
            .put("device_id", cleanDevice)
        return postToAppsScript(payload)
    }

    suspend fun login(
        identifier: String,
        password: String,
        deviceId: String
    ): AuthResponse {
        val cleanIdentifier = normalizeLoginIdentifier(identifier)
        val cleanPass = normalizePassword(password)
        val cleanDevice = deviceId.trim()
        val isPhoneLogin = cleanIdentifier.all { it.isDigit() } && cleanIdentifier.length >= 10
        val payload = JSONObject()
            .put("action", "login")
            .put("identifier", cleanIdentifier)
            .put("password", cleanPass)
            .put("pass", cleanPass)
            .put("deviceId", cleanDevice)
            .put("device_id", cleanDevice)
        if (isPhoneLogin) {
            payload.put("phone", cleanIdentifier)
            payload.put("phone_number", cleanIdentifier)
            payload.put("mobile", cleanIdentifier)
        } else {
            payload.put("userId", cleanIdentifier)
            payload.put("user_id", cleanIdentifier)
        }
        return postToAppsScript(payload)
    }

    suspend fun checkSession(userId: String, deviceId: String): AuthResponse {
        val cleanId = normalizeUserId(userId)
        val cleanDevice = deviceId.trim()
        val payload = JSONObject()
            .put("action", "check_session")
            .put("userId", cleanId)
            .put("user_id", cleanId)
            .put("identifier", cleanId)
            .put("deviceId", cleanDevice)
            .put("device_id", cleanDevice)
        return postToAppsScript(payload)
    }

    suspend fun updateActivity(userId: String, deviceId: String, activity: String) {
        if (!isScriptUrlConfigured()) return
        val cleanId = normalizeUserId(userId)
        val cleanDevice = deviceId.trim()
        val payload = JSONObject()
            .put("action", "update_activity")
            .put("userId", cleanId)
            .put("user_id", cleanId)
            .put("deviceId", cleanDevice)
            .put("device_id", cleanDevice)
            .put("activity", activity.trim())
        try {
            postToAppsScript(payload)
        } catch (_: Exception) {
        }
    }

    fun verifyAdminCredentials(adminId: String, adminPassword: String): Boolean {
        return adminId.trim() == ADMIN_ID && adminPassword.trim() == ADMIN_PASS
    }

    suspend fun adminListUsers(): AuthResponse {
        val payload = JSONObject()
            .put("action", "admin_list_users")
            .put("adminId", ADMIN_ID)
            .put("admin_id", ADMIN_ID)
            .put("adminPassword", ADMIN_PASS)
            .put("admin_password", ADMIN_PASS)
        return postToAppsScript(payload)
    }

    suspend fun adminActivateUser(targetUserId: String): AuthResponse {
        val cleanTarget = normalizeLoginIdentifier(targetUserId)
        val payload = JSONObject()
            .put("action", "admin_activate_user")
            .put("adminId", ADMIN_ID)
            .put("admin_id", ADMIN_ID)
            .put("adminPassword", ADMIN_PASS)
            .put("admin_password", ADMIN_PASS)
            .put("targetUserId", cleanTarget)
            .put("target_user_id", cleanTarget)
            .put("userId", cleanTarget)
            .put("user_id", cleanTarget)
            .put("identifier", cleanTarget)
        return postToAppsScript(payload)
    }

    suspend fun adminDeactivateUser(targetUserId: String): AuthResponse {
        val cleanTarget = normalizeLoginIdentifier(targetUserId)
        val payload = JSONObject()
            .put("action", "admin_deactivate_user")
            .put("adminId", ADMIN_ID)
            .put("admin_id", ADMIN_ID)
            .put("adminPassword", ADMIN_PASS)
            .put("admin_password", ADMIN_PASS)
            .put("targetUserId", cleanTarget)
            .put("target_user_id", cleanTarget)
            .put("userId", cleanTarget)
            .put("user_id", cleanTarget)
            .put("identifier", cleanTarget)
        return postToAppsScript(payload)
    }

    suspend fun adminResetDevice(targetUserId: String): AuthResponse {
        val cleanTarget = normalizeLoginIdentifier(targetUserId)
        val payload = JSONObject()
            .put("action", "admin_reset_device")
            .put("adminId", ADMIN_ID)
            .put("admin_id", ADMIN_ID)
            .put("adminPassword", ADMIN_PASS)
            .put("admin_password", ADMIN_PASS)
            .put("targetUserId", cleanTarget)
            .put("target_user_id", cleanTarget)
            .put("userId", cleanTarget)
            .put("user_id", cleanTarget)
            .put("identifier", cleanTarget)
        return postToAppsScript(payload)
    }

    private suspend fun postToAppsScript(payload: JSONObject): AuthResponse = withContext(Dispatchers.IO) {
        if (!isScriptUrlConfigured()) {
            return@withContext AuthResponse(
                ok = false,
                code = "NOT_CONFIGURED",
                message = "Google Apps Script Web App (/exec) URL is not configured yet. Sign in as Admin to save the URL."
            )
        }

        val initialUrl = getEffectiveScriptUrl()
        val bodyStr = payload.toString()
        val bodyBytes = bodyStr.toByteArray(Charsets.UTF_8)

        var currentUrl = initialUrl
        var method = "POST"
        var redirectCount = 0

        while (redirectCount < 6) {
            val conn = (URL(currentUrl).openConnection() as HttpURLConnection).apply {
                instanceFollowRedirects = false
                requestMethod = method
                connectTimeout = 15000
                readTimeout = 25000
                setRequestProperty("Accept", "application/json, text/plain, */*")
                if (method == "POST") {
                    doOutput = true
                    setRequestProperty("Content-Type", "application/json; charset=UTF-8")
                    setFixedLengthStreamingMode(bodyBytes.size)
                }
            }

            try {
                if (method == "POST") {
                    conn.outputStream.use { out ->
                        out.write(bodyBytes)
                        out.flush()
                    }
                }

                val status = conn.responseCode
                if (status == HttpURLConnection.HTTP_MOVED_TEMP ||
                    status == HttpURLConnection.HTTP_MOVED_PERM ||
                    status == HttpURLConnection.HTTP_SEE_OTHER ||
                    status == 307 || status == 308
                ) {
                    val nextLocation = conn.getHeaderField("Location")
                    if (nextLocation.isNullOrBlank()) {
                        return@withContext AuthResponse(
                            ok = false,
                            code = "NETWORK_ERROR",
                            message = "Redirect missing Location header (HTTP $status)."
                        )
                    }
                    currentUrl = URL(URL(currentUrl), nextLocation).toString()
                    if (status == HttpURLConnection.HTTP_MOVED_TEMP ||
                        status == HttpURLConnection.HTTP_MOVED_PERM ||
                        status == HttpURLConnection.HTTP_SEE_OTHER
                    ) {
                        method = "GET"
                    }
                    redirectCount++
                    continue
                }

                val stream = (if (status in 200..299) conn.inputStream else conn.errorStream)
                    ?: conn.inputStream
                val responseText = if (stream != null) {
                    BufferedReader(InputStreamReader(stream, Charsets.UTF_8)).use { it.readText() }
                } else {
                    ""
                }
                return@withContext parseResponse(responseText, status)
            } catch (e: Exception) {
                return@withContext AuthResponse(
                    ok = false,
                    code = "NETWORK_ERROR",
                    message = "Connection failed: ${e.message ?: "Check internet connection"}"
                )
            } finally {
                conn.disconnect()
            }
        }

        AuthResponse(
            ok = false,
            code = "NETWORK_ERROR",
            message = "Too many redirects from Google Apps Script."
        )
    }

    private fun parseResponse(rawText: String, httpStatus: Int): AuthResponse {
        val trimmed = rawText.trim()
        if (trimmed.isEmpty()) {
            return AuthResponse(
                ok = false,
                code = "EMPTY_RESPONSE",
                message = "Empty response from Google Apps Script (HTTP $httpStatus)."
            )
        }

        return try {
            val tokenerValue = JSONTokener(trimmed).nextValue()
            when (tokenerValue) {
                is JSONArray -> {
                    val users = parseUsers(tokenerValue)
                    AuthResponse(
                        ok = httpStatus in 200..299,
                        code = if (httpStatus in 200..299) "OK" else "HTTP_$httpStatus",
                        message = "Loaded ${users.size} user(s).",
                        users = users
                    )
                }
                is JSONObject -> parseObjectResponse(tokenerValue, httpStatus)
                else -> AuthResponse(
                    ok = false,
                    code = "PARSE_ERROR",
                    message = "Unexpected response from server (HTTP $httpStatus): ${trimmed.take(180)}"
                )
            }
        } catch (_: Exception) {
            val snippet = trimmed
                .replace(Regex("(?is)<style[^>]*>.*?</style>"), " ")
                .replace(Regex("(?is)<script[^>]*>.*?</script>"), " ")
                .replace(Regex("<[^>]+>"), " ")
                .replace(Regex("\\s+"), " ")
                .trim()
                .take(220)
            AuthResponse(
                ok = false,
                code = "PARSE_ERROR",
                message = if (snippet.isNotBlank()) {
                    "Server response (HTTP $httpStatus): $snippet"
                } else {
                    "Unexpected server response (HTTP $httpStatus). Ensure Apps Script is deployed as Web App with access 'Anyone'."
                }
            )
        }
    }

    private fun parseObjectResponse(json: JSONObject, httpStatus: Int): AuthResponse {
        val usersArr = findUsersArray(json)
        val usersList = if (usersArr != null) parseUsers(usersArr) else emptyList()

        val userObj = findSingleUserObject(json)
        val parsedUser = userObj?.let(::parseUser)

        val rawStatus = firstNonBlank(json, "status", "state").lowercase()
        val rawError = firstNonBlank(json, "error", "errorMessage", "error_message")
        val serverMessage = firstNonBlank(json, "message", "msg", "error", "errorMessage", "error_message", "reason", "detail")

        val hasExplicitFalse =
            (json.has("ok") && !json.optBoolean("ok", true)) ||
                (json.has("success") && !json.optBoolean("success", true)) ||
                rawError.isNotBlank() ||
                rawStatus in setOf(
                    "error", "fail", "failed", "false",
                    "inactive", "expired", "locked", "unauthorized", "denied"
                )

        val hasExplicitSuccess =
            (json.has("ok") && json.optBoolean("ok", false)) ||
                (json.has("success") && json.optBoolean("success", false)) ||
                rawStatus in setOf("success", "ok") ||
                serverMessage.contains("login successful", ignoreCase = true)

        val isOk = when {
            hasExplicitFalse -> false
            hasExplicitSuccess -> true
            usersArr != null || parsedUser != null -> httpStatus in 200..299
            else -> httpStatus in 200..299
        }

        val code = firstNonBlank(json, "code", "errorCode", "error_code")
            .ifBlank { if (isOk) "OK" else "SERVER_ERROR" }

        val resolvedMessage = when {
            serverMessage.isNotBlank() -> serverMessage
            usersArr != null && isOk -> "Loaded ${usersList.size} user(s)."
            isOk -> "Done"
            else -> "Request failed (HTTP $httpStatus, $code)."
        }

        return AuthResponse(
            ok = isOk,
            code = code,
            message = resolvedMessage,
            user = parsedUser,
            users = usersList
        )
    }

    private fun optArrayCaseInsensitive(obj: JSONObject, key: String): JSONArray? {
        obj.optJSONArray(key)?.let { return it }
        val iter = obj.keys()
        while (iter.hasNext()) {
            val actual = iter.next()
            if (actual.equals(key, ignoreCase = true)) {
                obj.optJSONArray(actual)?.let { return it }
            }
        }
        return null
    }

    private fun optObjectCaseInsensitive(obj: JSONObject, key: String): JSONObject? {
        obj.optJSONObject(key)?.let { return it }
        val iter = obj.keys()
        while (iter.hasNext()) {
            val actual = iter.next()
            if (actual.equals(key, ignoreCase = true)) {
                obj.optJSONObject(actual)?.let { return it }
            }
        }
        return null
    }

    private fun findUsersArray(json: JSONObject): JSONArray? {
        val arrayKeys = listOf("users", "data", "rows", "items", "result", "records")
        for (key in arrayKeys) {
            optArrayCaseInsensitive(json, key)?.let { return it }
        }
        val nestedObj = optObjectCaseInsensitive(json, "data") ?: optObjectCaseInsensitive(json, "result")
        if (nestedObj != null) {
            for (key in arrayKeys) {
                optArrayCaseInsensitive(nestedObj, key)?.let { return it }
            }
        }
        return null
    }

    private fun findSingleUserObject(json: JSONObject): JSONObject? {
        val objectKeys = listOf("user", "data", "row", "item", "record")
        for (key in objectKeys) {
            optObjectCaseInsensitive(json, key)?.let { candidate ->
                if (looksLikeUserObject(candidate)) return candidate
            }
        }
        return if (looksLikeUserObject(json)) json else null
    }

    private fun looksLikeUserObject(obj: JSONObject): Boolean {
        val identityKeys = setOf("userid", "user_id", "id", "uid", "phone", "phone_number", "phonenumber", "mobile")
        val iter = obj.keys()
        while (iter.hasNext()) {
            if (iter.next().lowercase() in identityKeys) return true
        }
        return false
    }

    private fun parseUser(obj: JSONObject): UserRecord {
        val rawUserId = firstNonBlank(obj, "userId", "user_id", "id", "userid", "UID", "uid")
        val rawPhone = firstNonBlank(obj, "phone", "phone_number", "phoneNumber", "mobile", "mobile_number", "contact")
        val rawPass = firstNonBlank(obj, "password", "pass", "pwd")
        val rawStatusExplicit = firstNonBlank(obj, "status", "state", "account_status")
        val rawStatus = rawStatusExplicit.ifBlank { "inactive" }
        val rawExpiryExplicit = firstNonBlank(obj, "expiryDate", "expiry_date", "expiry", "valid_until", "validUntil", "expires_at")
        val rawDevice = firstNonBlank(obj, "activeDeviceId", "active_device_id", "device_id", "deviceId", "device")
        val rawLastLogin = firstNonBlank(obj, "lastLogin", "last_login", "lastLoginAt", "login_time")
        val rawLastActivity = firstNonBlank(obj, "lastActivity", "last_activity", "activity", "updated_at")
        val rawCreatedAt = firstNonBlank(obj, "createdAt", "created_at", "registered_at")

        return UserRecord(
            userId = normalizeUserId(rawUserId),
            phone = normalizePhoneNumber(rawPhone).ifBlank { rawPhone.trim() },
            password = rawPass.trim(),
            status = rawStatus.trim().lowercase(),
            expiryDate = rawExpiryExplicit.trim(),
            activeDeviceId = rawDevice.trim(),
            lastLogin = rawLastLogin.trim(),
            lastActivity = rawLastActivity.trim(),
            createdAt = rawCreatedAt.trim(),
            hasStatusField = rawStatusExplicit.isNotBlank(),
            hasExpiryField = rawExpiryExplicit.isNotBlank()
        )
    }

    private fun parseUsers(arr: JSONArray): List<UserRecord> {
        val list = mutableListOf<UserRecord>()
        for (i in 0 until arr.length()) {
            arr.optJSONObject(i)?.let { list.add(parseUser(it)) }
        }
        return list
    }

    private fun firstNonBlank(obj: JSONObject, vararg keys: String): String {
        for (k in keys) {
            if (obj.has(k) && !obj.isNull(k)) {
                val v = obj.opt(k)?.toString()?.trim().orEmpty()
                if (v.isNotEmpty() && !v.equals("null", ignoreCase = true)) {
                    return v
                }
            }
        }
        val available = mutableMapOf<String, String>()
        val iter = obj.keys()
        while (iter.hasNext()) {
            val actual = iter.next()
            available[actual.lowercase()] = actual
        }
        for (k in keys) {
            val matched = available[k.lowercase()]
            if (matched != null && !obj.isNull(matched)) {
                val v = obj.opt(matched)?.toString()?.trim().orEmpty()
                if (v.isNotEmpty() && !v.equals("null", ignoreCase = true)) {
                    return v
                }
            }
        }
        return ""
    }
}
