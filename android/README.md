# DrillGRE Android app

Android Trusted Web Activity wrapper for https://drillgre.com/.

- Application ID: `com.drillgre.app`
- Debug package ID: `com.drillgre.app.debug`
- Minimum Android: API 23
- Target SDK: 35
- Web content and backend remain hosted by DrillGRE.

## Build a test APK

1. Open the repository's **Actions** tab.
2. Select **Build DrillGRE Android app**.
3. Select **Run workflow**.
4. Download the `drillgre-debug-apk` artifact from the completed run.
5. Transfer `app-debug.apk` to an Android device and install it. Android may ask you to allow installation from that source.

This debug APK is for testing, not Google Play publication.

## Release signing for direct APK and Google Play

Create a long-lived Android upload/release keystore locally and keep a secure backup. Never commit it to GitHub or send it in chat. Add these repository Actions secrets:

- `ANDROID_KEYSTORE_BASE64`: base64-encoded keystore file
- `ANDROID_KEYSTORE_PASSWORD`: keystore password
- `ANDROID_KEY_ALIAS`: key alias
- `ANDROID_KEY_PASSWORD`: key password

After the secrets are configured, run the workflow again. It will produce a signed release APK and an AAB. Keep the same key for future direct APK updates. For Google Play, enrol in Play App Signing and use the upload key as instructed by Play Console.

## Verify the website association (required for a full-screen TWA)

After the release signing key is created, obtain its SHA-256 certificate fingerprint with:

```bash
keytool -list -v -keystore drillgre-release.jks -alias YOUR_KEY_ALIAS
```

Publish the following file at `https://drillgre.com/.well-known/assetlinks.json`, replacing the fingerprint with the actual release certificate SHA-256 value:

```json
[
  {
    "relation": ["delegate_permission/common.handle_all_urls"],
    "target": {
      "namespace": "android_app",
      "package_name": "com.drillgre.app",
      "sha256_cert_fingerprints": ["REPLACE_WITH_RELEASE_CERTIFICATE_SHA256"]
    }
  }
]
```

The Android app and website must use the same package ID and certificate fingerprint. Do not publish a placeholder fingerprint. Once this association is live, validate it with Google's Digital Asset Links tool and test the app on a physical Android device.

## Notes

- A TWA requires a compatible browser such as Chrome on Android.
- Without a valid Digital Asset Links association, Android may show browser UI rather than a fully trusted full-screen experience.
- Live login, Supabase data, quizzes, and analytics require connectivity. The website's PWA service worker provides only the basic offline shell.
