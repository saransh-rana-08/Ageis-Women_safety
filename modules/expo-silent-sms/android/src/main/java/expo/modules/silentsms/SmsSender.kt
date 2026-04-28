package expo.modules.silentsms

import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.os.Build
import android.telephony.SmsManager
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.delay
import kotlinx.coroutines.withTimeoutOrNull
import java.util.UUID

class SmsSender(private val context: Context) {

    suspend fun sendWithRetry(
        phoneNumber: String,
        message: String,
        subscriptionId: Int? = null,
        maxRetries: Int = 1,
        isMock: Boolean = false
    ): SmsResult {
        if (isMock) {
            delay(500)
            return SmsResult(phoneNumber, true, true, true)
        }

        // We use the default manager to avoid getGroupIdLevel1 and READ_PHONE_STATE permission issues
        val smsManager = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            context.getSystemService(SmsManager::class.java)
        } else {
            @Suppress("DEPRECATION")
            SmsManager.getDefault()
        }

        val sentAction = "EXPO_SMS_SENT_${UUID.randomUUID()}"
        val sentIntent = PendingIntent.getBroadcast(
            context, 0, Intent(sentAction),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
        )

        val sentDeferred = CompletableDeferred<Boolean>()
        val receiver = object : BroadcastReceiver() {
            override fun onReceive(ctx: Context?, intent: Intent?) {
                if (intent?.action == sentAction) {
                    sentDeferred.complete(resultCode == android.app.Activity.RESULT_OK)
                }
            }
        }

        val filter = IntentFilter(sentAction)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            context.registerReceiver(receiver, filter, Context.RECEIVER_NOT_EXPORTED)
        } else {
            context.registerReceiver(receiver, filter)
        }

        try {
            val parts = smsManager.divideMessage(message)
            val sentIntents = ArrayList<PendingIntent>().apply { repeat(parts.size) { add(sentIntent) } }

            // Fire-and-forget: the system will handle delivery.
            // We dispatch the SMS here; the PendingIntent is best-effort confirmation only.
            smsManager.sendMultipartTextMessage(phoneNumber, null, parts, sentIntents, null)

            // Wait up to 10s for the system to confirm, but assume success if it times out.
            // On many OEMs (especially Xiaomi), the broadcast fires with non-OK code even when SMS is sent.
            val broadcastResult = withTimeoutOrNull(10000) { sentDeferred.await() }
            val wasSent = broadcastResult ?: true  // Assume sent if broadcast didn't respond in time
            return SmsResult(phoneNumber, true, wasSent, false)
        } catch (e: Exception) {
            return SmsResult(phoneNumber, false, false, false, e.message)
        } finally {
            try {
                context.unregisterReceiver(receiver)
            } catch (e: Exception) {}
        }
    }
}
