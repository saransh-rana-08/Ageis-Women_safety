package expo.modules.silentsms

import android.Manifest
import android.content.Context
import android.os.Build
import android.telephony.SubscriptionManager
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.Promise
import expo.modules.interfaces.permissions.PermissionsStatus
import kotlinx.coroutines.*

class ExpoSilentSmsModule : Module() {
    private val moduleCoroutineScope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private var isMockMode = false

    override fun definition() = ModuleDefinition {
        Name("ExpoSilentSms")

        AsyncFunction("isAvailableAsync") { ->
            val context = appContext.reactContext ?: return@AsyncFunction false
            val smsManager = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                context.getSystemService(android.telephony.SmsManager::class.java)
            } else {
                @Suppress("DEPRECATION")
                android.telephony.SmsManager.getDefault()
            }
            return@AsyncFunction smsManager != null
        }

        AsyncFunction("enableMockMode") { enabled: Boolean ->
            isMockMode = enabled
        }

        AsyncFunction("requestPermissionsAsync") { promise: Promise ->
            val permissionsManager = appContext.permissions
            if (permissionsManager == null) {
                promise.reject("ERR_SYS", "Permissions module not found", null)
                return@AsyncFunction
            }
            permissionsManager.askForPermissions(
                { permissionsResponse ->
                    val status = permissionsResponse[Manifest.permission.SEND_SMS]
                    val granted = status?.status == PermissionsStatus.GRANTED
                    val canAskAgain = status?.canAskAgain ?: true
                    
                    val result = mutableMapOf<String, Any>()
                    result["granted"] = granted
                    result["canAskAgain"] = canAskAgain
                    promise.resolve(result)
                },
                Manifest.permission.SEND_SMS
            )
        }

        AsyncFunction("getSubscriptionInfoAsync") {
            val context = appContext.reactContext ?: return@AsyncFunction emptyList<Map<String, Any>>()
            val sm = context.getSystemService(Context.TELEPHONY_SUBSCRIPTION_SERVICE) as SubscriptionManager
            val list = sm.activeSubscriptionInfoList ?: return@AsyncFunction emptyList<Map<String, Any>>()
            
            return@AsyncFunction list.map {
                mapOf(
                    "subscriptionId" to it.subscriptionId,
                    "displayName" to it.displayName.toString(),
                    "carrierName" to it.carrierName.toString(),
                    "number" to (it.number ?: "")
                )
            }
        }

        AsyncFunction("getOEMInfoAsync") {
            val manufacturer = Build.MANUFACTURER.lowercase()
            val requiresAutoStart = manufacturer.contains("xiaomi") || 
                                   manufacturer.contains("oppo") || 
                                   manufacturer.contains("vivo") ||
                                   manufacturer.contains("samsung")
            
            return@AsyncFunction mapOf(
                "manufacturer" to Build.MANUFACTURER,
                "requiresAutoStartPermission" to requiresAutoStart
            )
        }

        AsyncFunction("sendSMSAsync") { phoneNumbers: List<String>, message: String, options: Map<String, Any>?, promise: Promise ->
            val context = appContext.reactContext
            if (context == null) {
                promise.reject("ERR_CONTEXT", "React Context missing", null)
                return@AsyncFunction
            }

            val subscriptionId = (options?.get("subscriptionId") as? Number)?.toInt()
            val maxRetries = (options?.get("retryCount") as? Number)?.toInt() ?: 3
            
            // Truncate message if it's too long (10 segments max ~ 1500 chars)
            val finalMessage = if (message.length > 1500) {
                message.substring(0, 1480) + "...[truncated]"
            } else {
                message
            }

            moduleCoroutineScope.launch {
                val sender = SmsSender(context)
                val results = phoneNumbers.map { phone ->
                    async {
                        sender.sendWithRetry(phone, finalMessage, subscriptionId, maxRetries, isMockMode)
                    }
                }.awaitAll()
                
                promise.resolve(results)
            }
        }
    }
}
