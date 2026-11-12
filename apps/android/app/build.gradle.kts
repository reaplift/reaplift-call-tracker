import java.util.Properties

plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.android)
    alias(libs.plugins.kotlin.compose)
    alias(libs.plugins.kotlin.serialization)
}

// The release signing key lives outside the repo (team-workflow.md, "APK releases"): by default in
// ~/.reaplift-calls/keystore.properties, or wherever -PcallsKeystore points. Without it, release builds are unsigned.
val keystoreFile = file(
    (findProperty("callsKeystore") as String?) ?: "${System.getProperty("user.home")}/.reaplift-calls/keystore.properties",
)
val keystore = Properties().apply { if (keystoreFile.exists()) keystoreFile.inputStream().use { load(it) } }

// The server a release build pairs with, e.g. ./gradlew assembleRelease -PcallsServerUrl=https://calls.reaplift.com
val serverUrl = (findProperty("callsServerUrl") as String?).orEmpty().trimEnd('/')

android {
    namespace = "com.reaplift.calls"
    compileSdk = 36

    defaultConfig {
        applicationId = "com.reaplift.calls"
        // Android 10 (decision D7).
        minSdk = 29
        targetSdk = 36
        versionCode = 5
        versionName = "0.5.0"
        // Debug builds can type a server (a laptop on the same Wi-Fi); release builds use this one.
        buildConfigField("String", "DEFAULT_SERVER_URL", "\"$serverUrl\"")
    }

    signingConfigs {
        if (keystore.isNotEmpty()) {
            create("release") {
                storeFile = file(keystore.getProperty("storeFile"))
                storePassword = keystore.getProperty("storePassword")
                keyAlias = keystore.getProperty("keyAlias")
                keyPassword = keystore.getProperty("keyPassword")
            }
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            signingConfig = signingConfigs.findByName("release")
        }
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    buildFeatures {
        compose = true
        buildConfig = true
    }
    testOptions {
        unitTests.isReturnDefaultValues = true
    }
}

// Built with the JDK that runs Gradle (21); the bytecode targets 17, like compileOptions above.
kotlin {
    compilerOptions {
        jvmTarget.set(org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_17)
    }
}

dependencies {
    implementation(platform(libs.compose.bom))
    implementation(libs.androidx.activity.compose)
    implementation(libs.compose.material3)
    implementation(libs.compose.ui)
    implementation(libs.compose.ui.tooling.preview)
    debugImplementation(libs.compose.ui.tooling)
    implementation(libs.kotlinx.coroutines.android)
    implementation(libs.kotlinx.serialization.json)
    implementation(libs.okhttp)
    implementation(libs.androidx.work.runtime)
    implementation(libs.androidx.core)

    testImplementation(libs.junit)
    testImplementation(libs.okhttp.mockwebserver)
    testImplementation(libs.kotlinx.coroutines.test)
}
