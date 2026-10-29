package com.aura.musicplayerlocal;

import android.app.Notification;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.os.Build;
import android.os.IBinder;
import android.os.PowerManager;
import android.util.Log;

import androidx.annotation.Nullable;

public class PlaybackService extends Service {

    public static final String ACTION_START = "com.aura.musicplayerlocal.START_PLAYBACK";
    public static final String ACTION_STOP = "com.aura.musicplayerlocal.STOP_PLAYBACK";
    public static final String EXTRA_NOTIFICATION = "extra_notification";
    private static final int NOTIFICATION_ID = 1001;

    private static volatile boolean serviceRunning = false;
    private static volatile boolean serviceWakeLockHeld = false;

    private PowerManager.WakeLock wakeLock;

    public static boolean isRunning() {
        return serviceRunning;
    }

    public static boolean isWakeLockHeld() {
        return serviceWakeLockHeld;
    }

    @Override
    public void onCreate() {
        super.onCreate();
        serviceRunning = true;
        try {
            PowerManager pm = (PowerManager) getSystemService(Context.POWER_SERVICE);
            if (pm != null) {
                wakeLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "AuraPlayer:PlaybackServiceWakeLock");
                wakeLock.setReferenceCounted(false);
            }
        } catch (Exception e) {
            Log.e("AuraPlayer", "Error creating PlaybackService WakeLock", e);
        }
        MainActivity.logNativeEvent("PlaybackService", "onCreate called");
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        serviceRunning = true;
        if (intent == null) return START_STICKY;
        String action = intent.getAction();

        if (ACTION_START.equals(action)) {
            Notification notification;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                notification = intent.getParcelableExtra(EXTRA_NOTIFICATION, Notification.class);
            } else {
                notification = intent.getParcelableExtra(EXTRA_NOTIFICATION);
            }

            if (notification != null) {
                try {
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                        startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK);
                    } else {
                        startForeground(NOTIFICATION_ID, notification);
                    }
                    Log.d("AuraPlayer", "PlaybackService started in foreground with mediaPlayback type.");
                    MainActivity.logNativeEvent("PlaybackService", "startForeground mediaPlayback active");
                } catch (Exception e) {
                    Log.e("AuraPlayer", "Error starting foreground service", e);
                    MainActivity.logNativeEvent("PlaybackService", "startForeground error: " + e.getMessage());
                }
            }

            if (wakeLock != null && !wakeLock.isHeld()) {
                wakeLock.acquire();
                serviceWakeLockHeld = true;
                Log.d("AuraPlayer", "Playback WakeLock acquired in PlaybackService (CPU will not sleep while playing)");
                MainActivity.logNativeEvent("PlaybackService", "WakeLock acquired");
            }
        } else if (ACTION_STOP.equals(action)) {
            if (wakeLock != null && wakeLock.isHeld()) {
                wakeLock.release();
                serviceWakeLockHeld = false;
                Log.d("AuraPlayer", "Playback WakeLock released in PlaybackService");
                MainActivity.logNativeEvent("PlaybackService", "WakeLock released");
            }
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
                stopForeground(STOP_FOREGROUND_REMOVE);
            } else {
                stopForeground(true);
            }
            serviceRunning = false;
            stopSelf();
            MainActivity.logNativeEvent("PlaybackService", "stopForeground and stopSelf called");
        }

        return START_STICKY;
    }

    @Override
    public void onDestroy() {
        serviceRunning = false;
        serviceWakeLockHeld = false;
        if (wakeLock != null && wakeLock.isHeld()) {
            wakeLock.release();
        }
        MainActivity.logNativeEvent("PlaybackService", "onDestroy called");
        super.onDestroy();
    }

    @Nullable
    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }
}
