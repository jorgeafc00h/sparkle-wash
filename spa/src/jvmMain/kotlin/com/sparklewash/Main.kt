package com.sparklewash

import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.height
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.Text
import androidx.compose.material3.Button
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.material3.icons.Icons
import androidx.compose.material3.icons.filled.Person
import androidx.compose.material3.icons.filled.BarChart
import androidx.compose.material3.icons.filled.Home
import androidx.compose.material3.icons.filled.Historogram
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.runtime.getValue
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.Scaffold
import androidx.compose.material.icons.filled.Home
import androidx.compose.material.icons.filled.History
import androidx.compose.material.icons.filled.People
import androidx.compose.material.icons.filled.Settings
import androidx.compose.runtime.Composable
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.platform.LocalLifecycleRegistry
import androidx.compose.foundation.layout.fillMaxWidth

// === KPI Data ===
val kpiData = mapOf(
    "total_revenue" to "$2,985.41",
    "daily_jobs" to 37f,
    "avg_duration_min" to 62f,
    "on_time_rate" to 94f
)

// === Job History (simulated YOLO inference) ===
val jobs = listOf(
    mapOf("job_id" to 1, "car_model" to "Honda Civic", "plate" to "AB-123-CD", "color" to "red"),
    mapOf("job_id" to 2, "car_model" to "Tesla Model 3", "plate" to "XY-789-ZA", "color" to "white"),
    mapOf("job_id" to 3, "car_model" to "Toyota Camry", "plate" to "EF-456-GH", "color" to "blue")
)

// === Employee Leaderboard ===
val employees = listOf(
    mapOf("rank" to 1, "name" to "Maria Garcia", "jobs" to 23, "revenue" to "$1,890.00"),
    mapOf("rank" to 2, "name" to "Alex Chen", "jobs" to 18, "revenue" to "$1,456.00")
)

// === Main App ===
@Composable
fun App() {
    val scope = rememberCoroutineScope()
    var currentTab by remember { mutableStateOf(0) }

    Scaffold(
        navigationBar = {
            NavigationBar {
                NavigationBarItem(
                    icon = { Icon(Icons.Filled.Home, contentDescription = "Dashboard", tint = MaterialTheme.colorScheme.primary) },
                    label = { Text("Dashboard") },
                    selected = currentTab == 0,
                    onClick = { currentTab = 0 }
                )
                NavigationBarItem(
                    icon = { Icon(Icons.Filled.History, contentDescription = "History", tint = MaterialTheme.colorScheme.primary) },
                    label = { Text("Job History") },
                    selected = currentTab == 1,
                    onClick = { currentTab = 1 }
                )
                NavigationBarItem(
                    icon = { Icon(Icons.Filled.People, contentDescription = "Employees", tint = MaterialTheme.colorScheme.primary) },
                    label = { Text("Employees") },
                    selected = currentTab == 2,
                    onClick = { currentTab = 2 }
                )
                NavigationBarItem(
                    icon = { Icon(Icons.Filled.Settings, contentDescription = "Settings", tint = MaterialTheme.colorScheme.primary) },
                    label = { Text("Settings") },
                    selected = currentTab == 3,
                    onClick = { currentTab = 3 }
                )
            }
        }
    ) { paddingValues ->
        Column(modifier = Modifier.padding(paddingValues)) {
            when (currentTab) {
                0 -> Dashboard()
                1 -> JobHistory(jobs = jobs)
                2 -> Employees(employees = employees)
                3 -> SettingsView()
            }
        }
    }
}

@Composable
fun Dashboard() {
    val kpi = kpiData

    Card(
        modifier = Modifier.fillMaxWidth().padding(16.dp),
        shape = MaterialTheme.shapes.large,
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceVariant)
    ) {
        Column(modifier = Modifier.padding(24.dp)) {
            Text("💰 Revenue This Month", style = MaterialTheme.typography.titleLarge)
            Spacer(Modifier.height(8.dp))
            Text(kpi["total_revenue"] ?: "--", style = MaterialTheme.typography.displaySmall.copy(color = MaterialTheme.colorScheme.primary))

            Spacer(Modifier.height(16.dp))
            Text("🚗 Jobs Completed Today", style = MaterialTheme.typography.titleLarge)
            Spacer(Modifier.height(8.dp))
            Text(kpi["daily_jobs"].toString(), style = MaterialTheme.typography.displaySmall.copy(color = MaterialTheme.colorScheme.primary))

            Spacer(Modifier.height(24.dp))
            Text("⏱️ Avg Duration", style = MaterialTheme.typography.titleSmall)
            Spacer(Modifier.height(4.dp))
            Text("${kpi["avg_duration_min"]?.toInt()} min avg • 94% on-time rate", style = MaterialTheme.typography.bodyMedium)

            Spacer(Modifier.height(24.dp))
            Text("🏆 Top Performer", style = MaterialTheme.typography.titleLarge)
            Spacer(Modifier.height(8.dp))
            Text("Maria Garcia • 23 jobs • $1,890 revenue", style = MaterialTheme.typography.bodyMedium.copy(color = MaterialTheme.colorScheme.primary))
        }
    }
}

@Composable
fun JobHistory(jobs: List<Map<String, Any>>) {
    Column(modifier = Modifier.fillMaxWidth()) {
        Text("📋 Recent Jobs", style = MaterialTheme.typography.titleLarge)
        Spacer(Modifier.height(8.dp))

        val colorToColor = mapOf("red" to "#ef4444", "white" to "#9ca3af", "blue" to "#60a5fa")

        for (job in jobs) {
            val carName = "YOLO inference: ${job["car_model"]}"
            val plate = job["plate"] as? String ?: "--"
            val color = job["color"] as? String ?: "--"

            Card(
                modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 8.dp),
                colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceVariant)
            ) {
                Row(modifier = Modifier.padding(20.dp).fillMaxWidth()) {
                    Text("YOLOv8: ${carName}", style = MaterialTheme.typography.titleMedium)
                    Spacer(Modifier.weight(1f))
                    Text("Plate: $plate • Color: `$color`", style = MaterialTheme.typography.bodySmall.copy(color = colorToColor.getOrNull(color)?.ifEmpty { "#6b7280" }))
                }
            }
        }
    }
}

@Composable
fun Employees(employees: List<Map<String, Any>>) {
    Column(modifier = Modifier.fillMaxWidth()) {
        Text("🏆 Leaderboard", style = MaterialTheme.typography.titleLarge)
        Spacer(Modifier.height(8.dp))

        for (emp in employees) {
            Card(
                modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 8.dp),
                colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceVariant)
            ) {
                Row(modifier = Modifier.padding(20.dp).fillMaxWidth()) {
                    Text("${emp["rank"]}.$emp["name"]", style = MaterialTheme.typography.titleMedium)
                    Spacer(Modifier.weight(1f))
                    Text("🚗 ${emp["jobs"]} jobs • ${emp["revenue"]}", style = MaterialTheme.typography.bodySmall)
                }
            }
        }
    }
}

@Composable
fun SettingsView() {
    Card(modifier = Modifier.fillMaxWidth().padding(16.dp)) {
        Column(modifier = Modifier.padding(24.dp)) {
            Text("🔧 Settings", style = MaterialTheme.typography.titleLarge)
            Spacer(Modifier.height(8.dp))
            Text("This SPA serves on http://localhost:8123 and proxies to the FastAPI backend.", style = MaterialTheme.typography.bodyMedium.copy(color = MaterialTheme.colorScheme.primary))
        }
    }
}

// === Entry point ===
actual fun main() {
    val lifecycleRegistry = androidx.compose.ui.platform.LocalLifecycleRegistry(
        androidx.compose.ui.platform.testTag { null },
        android.app.ActivityManagerFactory.create().application.getMainScreen()
    )
    MainKt.ComposeApp(lifecycleRegistry) { App() }
}

actual class ComposeApp : androidx.compose.ui.platform.ComponentActivity() {
    override fun onContentChanged() {
        super.onContentChanged()
        MainKt.ComposeApp(this) {
            App()
        }
    }
}

fun main() {
    ComposeApp().launchSingleApp()
}
