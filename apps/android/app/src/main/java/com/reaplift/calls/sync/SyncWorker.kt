package com.reaplift.calls.sync

import android.content.Context
import androidx.work.Constraints
import androidx.work.CoroutineWorker
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import java.util.concurrent.TimeUnit

/** Runs one sync. Retried with backoff when the server cannot be reached; calls wait in the outbox meanwhile. */
class SyncWorker(context: Context, params: WorkerParameters) : CoroutineWorker(context, params) {
    override suspend fun doWork(): Result =
        when (Tracking.syncNow(applicationContext)) {
            is SendResult.Failed -> Result.retry()
            else -> Result.success()
        }

    companion object {
        private val online = Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build()

        /** Every 15 minutes, and after a reboot, so nothing is missed if the tracking service was stopped. */
        fun schedulePeriodic(context: Context) {
            WorkManager.getInstance(context).enqueueUniquePeriodicWork(
                "sync-periodic",
                ExistingPeriodicWorkPolicy.KEEP,
                PeriodicWorkRequestBuilder<SyncWorker>(15, TimeUnit.MINUTES).setConstraints(online).build(),
            )
        }

        /** Soon after a call: the call log is written a moment after the call ends, so wait a few seconds. */
        fun syncSoon(context: Context, delaySeconds: Long = 3) {
            WorkManager.getInstance(context).enqueueUniqueWork(
                "sync-now",
                ExistingWorkPolicy.REPLACE,
                OneTimeWorkRequestBuilder<SyncWorker>()
                    .setInitialDelay(delaySeconds, TimeUnit.SECONDS)
                    .setConstraints(online)
                    .build(),
            )
        }
    }
}
