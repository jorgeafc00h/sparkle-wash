plugins {
    kotlin("jvm") version "1.9.23"
    kotlin("plugin.serialization") version "1.9.23" apply false
    org.jetbrains.compose.application application
}

group = "com.sparklewash"
version = "1.0.0"

repositories {
    mavenCentral()
}

val composeVersion by extra.set("1.6.10")

kotlin {
    jvmToolchain(21).forEach { it }

    jvm {
        withJava()
        val mainDir = file("$buildDir/outputs/jvm/bin/main")
        val sourcesDir = "$projectDir/src/jvmMain/kotlin"
        from(jvmProcessResources.map { jar.source(it) })
        resources.append("file:$sourcesDir".toString())
        tasks.jar { from(jvmBinaryJar.map { it.outputs.files.get(0) }) }
    }

    wasmJs {
        browser {
            commonWebpackConfig {
                cssSupport = org.jetbrains.compose.web.WebpackDevServerConfig.CSSSupport.Browser
                browserName.set(org.jetbrains.compose.web.DevServerConfig.BrowserName.CHROME)
            }
        }
        binaries.library()
        binaries.executable()
    }

    sourceSets {
        val commonMain by getting { dependencies { implementation(compose.desktop.currentSystem) } }
        val jvmMain by getting { dependencies { implementation("org.jetbrains.compose.jna:jna-jvm:5.14.1") } }
    }
}
