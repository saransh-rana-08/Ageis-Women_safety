package expo.modules.silentsms

import expo.modules.kotlin.records.Field
import expo.modules.kotlin.records.Record

class SmsResult(
    @Field val phoneNumber: String,
    @Field val success: Boolean,
    @Field val sent: Boolean,
    @Field val delivered: Boolean,
    @Field val error: String? = null
) : Record
