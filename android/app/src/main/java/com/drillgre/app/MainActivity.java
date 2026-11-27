package com.drillgre.app;

import android.net.Uri;
import android.os.Bundle;
import androidx.browser.trusted.TrustedWebActivityIntent;
import androidx.browser.trusted.TrustedWebActivityIntentBuilder;
import androidx.browser.customtabs.CustomTabsIntent;
import androidx.browser.customtabs.CustomTabsClient;
import androidx.browser.customtabs.CustomTabsCallback;
import androidx.browser.customtabs.CustomTabsServiceConnection;
import androidx.browser.customtabs.CustomTabsSession;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.ServiceConnection;
import android.app.Activity;

public class MainActivity extends Activity {
    private static final String START_URL = "https://drillgre.com/";

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        Uri uri = Uri.parse(START_URL);
        CustomTabsIntent intent = new TrustedWebActivityIntentBuilder(uri).build(
            new CustomTabsSession(null, null)
        );
        // TWA verification is completed by Android using the domain's
        // /.well-known/assetlinks.json association.
        intent.launchTrustedWebActivity(this);
        finish();
    }
}
