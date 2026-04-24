package expo.modules.silentsms

import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.os.Build
import android.telephony.SmsManager
import android.telephony.SubscriptionManager
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.delay
import kotlinx.coroutines.withTimeoutOrNull
import java.util.UUID

class SmsSender(private val context: Context) {

    suspend fun sendWithRetry(
        phoneNumber: String,
        message: String,
        subscriptionId: Int? = null,
        maxRetries: Int = 3,
        isMock: Boolean = false
    ): SmsResult {
        if (isMock) {
            delay(500)
            return SmsResult(phoneNumber, true, true, true)
        }

        var lastError: String? = null
        val backoffs = listOf(0L, 2000L, 5000L, 10000L)

        for (attempt in 0..maxRetries) {
            if (attempt > 0) delay(backoffs.getOrElse(attempt) { 10000L })

            val result = performSend(phoneNumber, message, subscriptionId)
            if (result.success) return result
            lastError = result.error
        }

        return SmsResult(phoneNumber, false, false, false, lastError ?: "Max retries exceeded")
    }

    private suspend fun performSend(
        phoneNumber: String,
        message: String,
        subscriptionId: Int?
    ): SmsResult {
        val smsManager = try {
            getSmsManager(subscriptionId)
        } catch (e: Exception) {
            return SmsResult(phoneNumber, false, false, false, "SmsManager unavailable: ${e.message}")
        }

        val sentAction = "EXPO_SMS_SENT_${UUID.randomUUID()}"
        val deliveredAction = "EXPO_SMS_DELIVERED_${UUID.randomUUID()}"

        val sentIntent = PendingIntent.getBroadcast(
            context, 0, Intent(sentAction),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
        )
        val deliveredIntent = PendingIntent.getBroadcast(
            context, 0, Intent(deliveredAction),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
        )

        val sentDeferred = CompletableDeferred<Boolean>()
        val deliveredDeferred = CompletableDeferred<Boolean>()

        val receiver = object : BroadcastReceiver() {
            override fun onReceive(ctx: Context?, intent: Intent?) {
                when (intent?.action) {
                    sentAction -> sentDeferred.complete(resultCode == android.app.Activity.RESULT_OK)
                    deliveredAction -> deliveredDeferred.complete(true)
                }
            }
        }

        val filter = IntentFilter().apply {
            addAction(sentAction)
            addAction(deliveredAction)
        }

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            context.registerReceiver(receiver, filter, Context.RECEIVER_NOT_EXPORTED)
        } else {
            context.registerReceiver(receiver, filter)
        }

        try {
            val parts = smsManager.divideMessage(message)
            val sentIntents = ArrayList<PendingIntent>().apply { repeat(parts.size) { add(sentIntent) } }
            val deliveredIntents = ArrayList<PendingIntent>().apply { repeat(parts.size) { add(deliveredIntent) } }

            smsManager.sendMultipartTextMessage(phoneNumber, null, parts, sentIntents, deliveredIntents)

            val wasSent = withTimeoutOrNull(30000) { sentDeferred.await() } ?: false
            if (!wasSent) return SmsResult(phoneNumber, false, false, false, "Send timeout or failure")

            // Delivery is "best effort", we wait up to 60s but don't fail if it doesn't arrive
            val wasDelivered = withTimeoutOrNull(60000) { deliveredDeferred.await() } ?: false

            return SmsResult(phoneNumber, true, true, wasDelivered)
        } catch (e: Exception) {
            return SmsResult(phoneNumber, false, false, false, e.message)
        } finally {
            try {
                context.unregisterReceiver(receiver)
            } catch (e: Exception) {}
        }
    }

    private fun getSmsManager(subscriptionId: Int?): SmsManager {
        return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            val manager = context.getSystemService(SmsManager::class.java)
            if (subscriptionId != null && subscriptionId != -1) {
                manager.createForSubscriptionId(subscriptionId)
            } else {
                manager
            }
        } else {
            @Suppress("DEPRECATION")
            if (subscriptionId != null && subscriptionId != -1) {
                SmsManager.getSmsManagerForSubscriptionId(subscriptionId)
            } else {
                SmsManager.getDefault()
            }
        }
    }
}
