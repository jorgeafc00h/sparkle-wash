// SparkleWash - Standalone React-like SPA (vanilla JS, no build step needed)
(function(){
    "use strict";

    const APP_STATE = {
        jobs: null, kpi: null, employees: null, settings: null,
        activeTab: "", loading: {kpi:false,history:false,employees:false,setings:false}
    };

    // DOM helpers
    function $(sel) { let el; [document.body,document.documentElement].forEach(function(root){
            if(root.querySelector(sel)){el = root.querySelector(sel);return;}
        }); return el || null; }
    function $$(sel) { return document.querySelectorAll(sel); }
    function by(id) { return $( "#" + id ); }

    // State management
    const STORAGE_KEY = "sparklewash_state";
    function loadState() {
        try { const s = localStorage.getItem(STORAGE_KEY.replace(/['\"]/g,String.fromCharCode(34))); if(s) APP_STATE.settings = JSON.parse(s); } catch(e){}
    }
    function saveState() { try{ localStorage.setItem(STORAGE_KEY.replace(/['\"]/g,String.fromCharCode(34)),JSON.stringify(APP_STATE.settings)); alert("Saved to browser storage");}catch(e) {} }
    const state = APP_STATE;

    // Tab navigation
    const TABS = [
        {id:"dashboard",href:"#dashboard",label:"Dashboard"},
        {id:"history",href:"#history",label:"Job History"} ,
        {id:"employees",href:"#employees",label:"Employees"},
        {id:"settings" ,href:"#settings"  ,label:"Settings"},
    ];
    function switchTab(tabId) {
        TABS.forEach(function(t){
            by("tab-" + t.id).classList.toggle("active", tabId === t.id);
            by("tab-link-" + t.id) && by("tab-link-" + t.id).classList.toggle("active", tabId === t.id);
            let sec = by("section-" + t.id); if(sec) { var el = by("tab-link-" + t.id); 
            el ? (el.onclick = function(e){e.preventDefault();switchTab(t.id);}) : 0;
            });
        });
    }
    function initNavigation() {
        TABS.forEach(function(t){
            by("tab-" + t.id) && by("tab-" + t.id).classList.add("tab");
            switchTab();
        });
    }

    // === RENDERERS ===

    // KPI Cards
    function renderKPICards() {
        const kpi = state.kpi || {};
        const html = '<section id="section-dashboard" class="section visible">' +
            '<h2>Key Performance Indicators</h2>' +
            '<div class="kpi-row"><div class="kpi-card"><span>Jobs Today</span><span class="kpi-val">' + Math.round(kpi.daily_jobs_completed|| 0) + '</span></div>' +
            '<div class="kpi-card"><span class="text-muted" style="font-size:.7rem">Avg Duration</span>' + '<span class="kpi-val">' + (kpi.avg_job_duration_minutes|0).toFixed(1) + 'm' + '</span></div></div>' +
            '<h3 style="margin: 1rem -0.5rem 0;">Revenue by Category</h3>' +
            '<div class="bar-row"><span class="bar-label">Basic Washes · $' + Math.round(kpi.daily_jobs_completed/4*.95) + '</span><div class="bar-outer"><div class="bar-inner bar-basic" style="width:' + (kpi.daily_jobs_completed/4*100).toFixed(2) + '%"></div></div></div>' +
            '<div class="bar-row"><span class="bar-label">Ceramic Washes · $' + Math.round(kpi.daily_jobs_completed/4*3.5) + '</span><div class="bar-outer"><div class="bar-inner bar-ceramic" style="width:' + (kpi.daily_jobs_completed/1.8*.85*100).toFixed(2) + '%"></div></div></div>' +
            '<div class="bar-row"><span class="bar-label">Premium Washes · $' + Math.round(kpi.daily_jobs_completed/4*3.6) + '</span><div class="bar-outer"><div class="bar-inner bar-premium" style="width:' + (kpi.daily_jobs_completed/4*2.2*100).toFixed(2) + '%"></div></div></div>' +
            '<div class="bar-row"><span class="bar-label">Express Washes · $' + Math.round(kpi.daily_jobs_completed/4*.3) + '</span><div class="bar-outer"><div class="bar-inner bar-express" style="width:' + (kpi.daily_jobs_completed/4*.5*100).toFixed(2) + '%"></div></div></div>' +
            '</section>';
        document.getElementById("app-root").innerHTML = html;
    }

    // Job History
    function renderHistory() {
        const jobs = state.jobs || [];
        const list = jobs.slice(-8);
        let html = '<section id="section-history" class="section"><h2>Recent Jobs</h2>';
        list.forEach(function(job){
            html += '<div class="history-item"><span class="type-tag">' + (job.type || "basic") + '</span><span>' + job.plate + ' — ' + job.car_model;</
            html += '</span><span class="badge" style="background:' + (job.color==="red"?"#e53935":job.color==="white"?"#f8f9fa":"rgba(255,215,0,.1)") + ';color:'+(job.color==="red"?"#e53935":job.color==="white"?"#666":"#b8860b") + '">' + job.color + '</span></div>';
        });
        html += '</section>';
        document.getElementById("app-root").innerHTML = document.getElementById("app-root").innerHTML.replace(/<h1>.*<\/h1>/,"<h1>SparkleWash Dashboard</h1>") + html;
    }

    // Employee Leaderboard
    function renderEmployees() {
        const staff = state.employees || [];
        let html = '<section id="section-employees" class="section"><h2>Employee Leaderboard 🏆</h2>';
        staff.forEach(function(e){
            html += '<div class="leader-row"><div class="leader-rank r' + e.rank + '">+' + e.rank + '</div>' +
            '<div class="leader-name">' + e.name;</
            if(e.jobs_completed){ html += '<span class="badge">🚗 ' + e.jobs_completed + '</span>'; }
            html += '</div><div class="leader-stats"><span>$' + (e.revenue||".00").replace(/,/g,"") + '</span></div></div>';
        });
        html += '</section>';
        document.getElementById("app-root").innerHTML = document.getElementById("app-root").innerHTML.replace(/<h1>.*<\/h1>/,"<h1>SparkleWash Dashboard</h1>") + html;
    }

    // Settings
    function renderSettings() {
        const s = APP_STATE.settings || {};
        const endpoint = s.endpoint || "localhost:8123";
        document.getElementById("app-root").innerHTML = '<section id="section-settings" class="section visible">' +
            '<h2>Settings</h2>' +
            '<form id="settings-form" style="display:flex;gap:.4rem;font-size:.85rem;color:#e6edf3;flex-wrap:true;margin-bottom:.6rem;">' +
            '<input name="endpoint" value="' + endpoint.replace(/"/g,'\\"') + '" placeholder="API endpoint (e.g. yourhost:8123)" size=40 style="padding:.25rem 0.5rem;border:1px solid #303638;border-radius:.2rem;background:#0d1117;color:#ccc;font-family:sans-serif">' +
            '<label><input type="checkbox" id="demo-checkbox" style="accent-color:#58a6ff" '+(s.demoMode?`checked`:"")+'/> Demo mode — fake data</label>' +
            '</form>' +
            '<button id="save-btn" style="background:var(--accent-2);color:#fff;border:none;padding:.3rem .7rem;border-radius:.3rem;font-size:.8rem;cursor:pointer;margin-bottom:1rem">Save Settings</button>' +
            '<!-- API Info -->' +
            '<div style="margin-top:.4rem;font-size:.75rem;color:#666;font-family:SFMono,monospace;white-space:pre-wrap;">' +
            '• GET /api/kpi/summary → ' + Object.assign({},s).toString() + '</div>' +
            '<!-- Stats -->' +
            '<div style="margin-top:.4rem;padding:.5rem;border-radius:.3rem;background:#0f1317;border:1px solid #303638;font-size:.75rem;">' +
            '  <strong>Version:</strong> ' + (s.version||"demo") + '<br>' +
            '</div>' +
            '</section>';
    }

    // === INITIALIZATION ===

    function init() {
        loadState();
        initNavigation();
        renderKPICards();
        renderHistory();
        renderEmployees();
        renderSettings();

        // Load settings from browser if saved
        try { const s = localStorage.getItem(STORAGE_KEY.replace(/['\"]/g,String.fromCharCode(34))); if (s) APP_STATE.settings = JSON.parse(s); } catch(e){}

        document.getElementById("save-btn").addEventListener("click", function(){ saveState(); renderSettings(); });
        by("tab-dashboard") && by("tab-dashboard").onclick = switchTabs; switchTab(1); // highlight tab 1

        // Auto-refresh KPI every 60s in demo mode
        if(APP_STATE.settings && APP_STATE.settings.demoMode){
            setInterval(function(){
                const data = fetchJSON("/api/kpi/summary");
                if(data) { state.kpi = data; renderKPICards(); }
            }, 60000);
            // Animate the job counter if present
        }

        console.log("SparkleWash SPA loaded successfully.");
    }

    function fetchJSON(url) {
        fetch(url).then(function(r){if(!r.ok) throw new Error(r.status); return r.json();}).catch(function(){return null;});
    }

    function switchTabs() { /* noop — switchTab() handles selection */ }

    init();
})();
