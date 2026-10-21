pluginManagement {
    repositories {
        google()
        mavenCentral()
        gradlePluginPortal()
        maven { url = uri("https://androidx.dev/storage/compose-plugin/remote") }
    }

    plugins {
        kotlin("jvm") version "1.9.23"
        id("org.jetbrains.compose") version "1.6.10"
    }
}

rootProject.name = "carwash-spa"
