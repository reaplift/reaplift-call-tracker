package com.reaplift.calls

import android.app.Application
import com.reaplift.calls.sync.Notifications

class CallsApp : Application() {
    override fun onCreate() {
        super.onCreate()
        Notifications.createChannels(this)
    }
}
