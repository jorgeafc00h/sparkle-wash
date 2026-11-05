# SparkleWash Feature Research & Additions

Based on industry best practices from leading car wash management systems (CarWright, WashCo, CarPro, detailPRO), I've identified additional useful features to add to the app.

---

## A. Dashboard Metrics — Beyond Job Count

### Recommended KPI Cards (add to Tab 1 Dashboard)

| Card | Data Source | Purpose |
|------|-------------|---------|
| **Hours Today** | `completedAt` timestamps → calculate elapsed hours | Track overtime/understaffing |
| **Avg Job Time** | `durationMs` per job | Spot slow employees or inefficient bays |
| **Avg Revenue/Hour** | `(total revenue) / total hours` | Real-time profitability metric |
| **Top Employee Today** | Sort jobs by `employeeName` count | Gamification / motivation |
| **Bay Utilization%** | Jobs completed / (hours open × stations) | Identify underutilized bays |
| **Rain Flag** | ADC rain probe + `/weather/api/comet/weather` | Adjust staffing dynamically |
| **Soap Level Alerts** | SOAP/PSI sensors | Proactive maintenance |

### Additional Revenue Metrics

- **Revenue per Bay** — shows which bay (1–4) is your revenue driver
- **Revenue per Employee** — fair compensation tracking
- **Revenue vs. Goal** — daily target progress bar (e.g., $500/day goal)

---

## B. Job Status Workflow

Instead of just "completed", add intermediate states:

```json
{
  "status": "check_in_completed",    // car arrived, photo taken
  "status": "washing",              // foam/high-pressure applied
  "status": "ceramic_coating",     // ceramic product applied
  "status": "polishing",           // buffer/polish applied
  "status": "drying",             // drying station
  "status": "completed"           // customer receives invoice
}
```

This allows:
- Real-time WIP (work-in-progress) tracking — see how many cars are in each stage
- Staff allocation hints — e.g., "2 bays need soap refill, 1 bay needs polish buffer"
- Billing gate — can't skip steps (ceramic must be done before polish)

---

## C. Employee Activities

Beyond job count, track:

| Metric | How to derive | Why it matters |
|--------|--------------|----------------|
| **Jobs per hour** | `count(completedAt in last hour)` per employee | Overtime decision making |
| **Avg rating (3/5)** | Collect customer star-rating on invoice | Quality tracking |
| **Tips earned** | `job.revenue - base_revenue` | Fair tip distribution |
| **Perfect jobs** | `(rating == 5) AND (duration <= target_for_category)` | Quality bonus eligibility |

---

## D. ESP32-CAM Station Telemetry

In addition to rain/water ADCs, consider adding:

- **DOPPS water level sensor** on soap tank (ADC11) — publish "soapLow" alert
- **Pressure gauge sensor** (e.g., 30 PSI range with ADC) — validate pump is working
- **Temperature sensor (TMP36 at water inlet)** — detect water freezing in winter

---

## E. Customer-Facing Mobile App Features

If you want to add a *customer-facing* companion app (iOS + Android):

- Upload car photo → get estimated cost + wait time
- Book appointment slot
- Pay via Apple Pay / Google Pay inside the app
- Receive push notification when wash is complete with QR code for invoice
- Rate the service on completion

---

## F. Web App Enhancements

The React PWA could also display:

- Live webcam feed from ESP32-CAM at each bay (via MJPEG stream)
- Queue wait times
- Weather + rain alert banners
- Staffing suggestions — "You need 1 more person if today is rainy"

---

## G. ESPHome / MQTT Integration (Optional)

If you deploy the ESP32s into Home Assistant, they can:

- Auto-publish telemetry to MQTT broker (`ha-mqtt`)
- Trigger Home Assistant automations when rain is detected
- Store car photos in local NAS/SMB share if WiFi is unreliable

Useful for DIY deployments with Home Assistant users.

---

## H. Data Retention Policy

Recommended retention rules:

| Data | TTL | Reason |
|------|-----|--------|
| JPEG photo | 90 days → then convert to WebP thumbnails | Storage savings; photo quality degrades |
| Job record (JSON) | Indefinite (customer records) | Billing/insurance needs |
| Employee stats | Aggregate per month | Privacy — don't expose daily per-employee details |
| Raw YOLO model outputs | 30 days → retrain weekly with new samples | Model degradation detection |

---

