
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = 5873;
const HOST = '127.0.0.1';
const SPEC = fs.readFileSync('/Users/jorgeflores/github/carwash/backend/api-spec.openapi.yaml', 'utf8');

const stations = [
  { stationId: 'b4c3', name: 'Bay #1 foam touch', status: 'idle', pressurePsi: 52, soapLevelDm: 20 },
  { stationId: '7d5c', name: 'Bay #2 high pressure', status: 'washing', pressurePsi: 58.5, soapLevelDm: 24 },
  { stationId: 'a1f2', name: 'Bay #3 detail', status: 'idle', pressurePsi: 48, soapLevelDm: 19 },
  { stationId: 'e8f1', name: 'Bay #4 diamond polish', status: 'cleaning', pressurePsi: 63.2, soapLevelDm: 26 }
];

const jobs = [
  { id: 'e8f3c4d9-2a1b-4390-b042-d502f19417c7', plateNumber: 'ABCD-123', model: 'Toyota Camry', color: 'Blue', category: 'basic', employeeName: 'Maria Lopez', completedAt: 1718968302 },
  { id: 'e8f3c4d9-2a1b-4390-b042-d502f19417c8', plateNumber: 'ABCD-456', model: 'BMW X5', color: 'Gray', category: 'ceramic', employeeName: 'David Kim', completedAt: 1718968277 },
  { id: 'e8f3c4d9-2a1b-4390-b042-d502f19417c9', plateNumber: 'ABCD-789', model: 'Toyota Camry', color: 'Blue', category: 'basic', employeeName: 'Maria Lopez', completedAt: 1718968243 },
  { id: 'e8f3c4d9-2a1b-4390-b042-d502f19417ca', plateNumber: 'XYS-111', model: 'BMW X5', color: 'Gray', category: 'ceramic', employeeName: 'David Kim', completedAt: 1718968212 },
  { id: 'e8f3c4d9-2a1b-4390-b042-d502f19417cb', plateNumber: 'ABC-070', model: 'Toyota Camry', color: 'Blue', category: 'basic', employeeName: 'Maria Lopez', completedAt: 1718965943 }
];

const server = http.createServer((req, res) => {
  const u = new URL(req.url, `http://${HOST}`);
  const query = Object.fromEntries(new URLSearchParams(u.search));
  let path = req.url.split('?')[0].toLowerCase();

  if (path === '/healthz' || path === '/health') { res.end(JSON.stringify({ status: 'healthy' })); return; }
  if (path === '/api/metrics') { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(stations)); return; }
  if (path === '/api/metrics/alerts') { res.end(JSON.stringify([{'code':'lowPressure','value':32.5,'threshold':45},{'code':'highSoapLevel','value':78}]),null,2)+'
'); return; }
  if (path === '/jobs/stats') { res.end(JSON.stringify({totalJobs:12,basicJobs:5,ceramicJobs:6,premiumJobs:1,expressJobs:0,revenue:134.5})); return; }
  
  if (path.startsWith('/jobs')) {
    const qs = u.searchParams;
    let page = parseInt(qs.get('page') || '1');
    let size = parseInt(qs.get('size') || '2');

    if (path === '/jobs') { res.end(JSON.stringify({total:5,records:[{id:'e8f3c4d9-...-17c7',plateNumber:'ABCD-123',model:'Toyota Camry',color:'Blue',category:'basic'}]})); return; }
    if (path === '/jobs/history') { return res.end(JSON.stringify({total:5,page,size,records:[{plateNumber:'ABCD-123',model:'Toyota Camry'},{'plateNumber':'ABCD-456',model:'BMW X5'}]})); }
    if (path.startsWith('/jobs/record/')) { return res.end(JSON.stringify({ok:true})); }
  }

  if (path === '/api/upload') { req.on('data', () => {}).on('end', () => { res.end(JSON.stringify({ok:true,uploadId:'demo'})); }); return; }

  res.writeHead(404); res.end();
});

server.listen(PORT, HOST, () => console.log('SparkleWash API listening on http://'+`\:${PORT}`));
