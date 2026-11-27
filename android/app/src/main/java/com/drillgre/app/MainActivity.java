package com.drillgre.app;

import android.app.Activity;
import android.net.Uri;
import android.os.Bundle;
import androidx.browser.trusted.TrustedWebActivityIntentBuilder;

public class MainActivity extends Activity {
    private static final String START_URL = "https://drillgre.com/";

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        TrustedWebActivityIntentBuilder builder =
            new TrustedWebActivityIntentBuilder(Uri.parse(START_URL));
        builder.build(null).launchTrustedWebActivity(this);
        finish();
    }
}
