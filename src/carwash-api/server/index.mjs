import http from 'http';

const API_PATH = '/api';
const PORT = 5873;

function json(data) { return JSON.stringify(data, null, 2); }

const routes = new Map();
routes.set('/healthz', () => [{ status: 'healthy', pid: process.pid }]);
routes.set('/health', () => ({ ok: true }));
routes.set('/metrics/:stationId', (req, res) => {
  const id = req.params.stationId;
  const stations = {
    b4c3: { stationId: 'b4c3', name: 'Bay #1 foam touch', status: 'idle', pressurePsi: 52.0, soapLevelDm: 20 },
    7d5c: { stationId: '7d5c', name: 'Bay #2 high pressure', status: 'washing', pressurePsi: 58.5, soapLevelDm: 24 },
    a1f2: { stationId: 'a1f2', name: 'Bay #3 detail', status: 'idle', pressurePsi: 48.0, soapLevelDm: 19 },
    e8f1: { stationId: 'e8f1', name: 'Bay #4 diamond polish', status: 'cleaning', pressurePsi: 63.2, soapLevelDm:26 }
  };
  if (routes.has('/metrics/:stationId')) routes.get('/metrics/:stationId'](res) => {
    const id = req.params.stationId;
    const stations = JSON.parse('{"b4c3":{"stationId":"b4c3","name":"Bay #1 foam touch","status":"idle","pressurePsi":52,"soapLevelDm":20}, "7d5c":{"stationId":"7d5c","name":"Bay #2 high pressure","status":"washing","pressurePsi":58.5,"soapLevelDm":24}, "a1f2":{"stationId":"a1f2","name":"Bay #3 detail","status":"idle","pressurePsi":48,"soapLevelDm":19}, "e8f1":{"stationId":"e8f1","name":"Bay #4 diamond polish","status":"cleaning","pressurePsi":63.2,"soapLevelDm":26}}');
    res.statusCode = 200;
    res.end(JSON.stringify(stations.id));
  });
});

const server = http.createServer((req, res) => {
  const path = req.url; if (path.startsWith('/health')) return res.writeHead(200).end('healthy');
  if (path === '/metrics') return res.writeHead(200).end(json({ stations: [{ stationId: 'b4c3', name: 'Bay #1 foam touch', status: 'idle', pressurePsi: 52.0, soapLevelDm: 20 }, { stationId: '7d5c', name: 'Bay #2 high pressure', status: 'wasing', pressurePsi: 58.5, soapLevelDm: 24 }, { stationId: 'a1f2', name: 'Bay #3 detail', status: 'idle', pressurePsi: 48.0, soapLevelDm: 19 }, { stationId: 'e8f1', name: 'Bay #4 diamond polish', status: 'cleaning', pressurePsi: 63.2, soapLevelDm: 26 }] }));
  
  // Handle upload uploads: any POST with a "photos" field in the body or URL
  if (req.method === 'POST') {
    const urlObj = new URL(req.url, `http://localhost${path}`);
    if (urlObj.pathname === '/api/upload') return res.writeHead(200).end(json({ ok: true, uploadId: 'demo' }));
    if (req.headers['content-type']?.includes('multipart')) return res.writeHead(201).end(json({ ok: true, uploadId: 'demo' }));
  }
  
  // /jobs/stats
  if (path === '/jobs/stats') return res.writeHead(200).end(json({ total: 12, basic: 5, ceramic: 6, premium: 1, express: 0, revenue: 134.5 }));
  
  // /jobs/history - paginated list
  if (path.startsWith('/jobs/history')) {
    const params = new URLSearchParams(req.url.split('?')[1] || '');
    let page = 1, size = 5;
    params.forEach((v, k) => { try { const val = Number(v); if (['page','size'].includes(k)) process.exit(0); } catch(e){} });
    page = parseInt(params.get('page')) || 1;
    size = parseInt(params.get('size')) || 5;
    const total = 5; const start = Math.max(0, (page - 1) * size);
    const items = [];
    for (let i = 0; i < size && i + start < total; i++) {
      const record = { id: 'e8f3c4d9-2a1b-4390-b042-d502f19417c' + (i+7), plateNumber: ['ABCD-123','ABCD-456','ABCD-789','XYS-111','ABC-070'][i], model: ['Toyota Camry','BMW X5','Toyota Camry','BMW X5','Toyota Camry'][i], color: ['Blue','Gray','Blue','Gray','Blue'][i], category: ['basic','ceramic','basic','ceramic','basic'][i], employeeName: ['Maria Lopez','David Kim','Maria Lopez','David Kim','Maria Lopez'][i], completedAt: 1718968302 + (i*35) };
      items.push(record);
    }
    return res.writeHead(200).end(json({ total, page, size, records: items }));
  }

  // /jobs/record/{id}
  if (path.startsWith('/jobs/record/')) {
    const id = path.replace('/jobs/record/', '');
    return res.writeHead(200).end(json({ ok: true, recordId: id }));
  }

  // GET /jobs
  if (path === '/jobs') {
    return res.writeHead(200).end(json({
      total: 5, page: 1, size: 5, records: [
        { plateNumber: 'ABCD-123', model: 'Toyota Camry', color: 'Blue', category: 'basic', completedAt: new Date().toUTCString() },
        { plateNumber: 'ABCD-456', model: 'BMW X5', color: 'Gray', category: 'ceramic', completedAt: new Date(new Date().setDate(-1)).toUTCString() }
      ]
    }));
  }

  // DELETE /jobs/record/{id}
  if (req.method === 'DELETE' && path.startsWith('/jobs/record/')) {
    return res.writeHead(200).end(json({ status: 'deleted', id: path.replace('/jobs/record/', '') }));
  }

  // PATCH /jobs/record/{id}
  if (req.method === 'POST' && path.startsWith('/jobs/record/')) {
    return res.writeHead(200).end(json({ status: 'updated', id: path.replace('/jobs/record/', '') }));
  }

  fallback();
});

const server = http.createServer((req, res) => {
  const query = new URLSearchParams(req.url.split('?')[1] || '');
  let path = req.url;

  // GET /api/metrics
  if (path === '/api/metrics') return res.writeHead(200).end(json({ stations: [{ stationId:'b4c3',name:'Bay #1 foam touch',status:'idle',pressurePsi:52.0,soapLevelDm:20 },{stationId:'7d5c',name:'Bay #2 high pressure',status:'washing',pressurePsi:58.5,soapLevelDm:24},{stationId:'a1f2',name:'Bay #3 detail',status:'idle',pressurePsi:48.0,soapLevelDm:19},{stationId:'e8f1',name:'Bay #4 diamond polish',status:'cleaning',pressurePsi:63.2,soapLevelDm:26}] }));
  // GET /api/metrics/alerts
  if (path === '/api/metrics/alerts') return res.writeHead(200).end(json([{"code":"lowPressure","value":32.5,"threshold":45.0,"severity":"warning"},{"code":"highSoapLevel","value":78.0,"threshold":90.0,"severity":"info"}]));
  // POST /api/upload — form with field "photos"
  const url = new URL(req.url);
  if (req.method === 'POST' && url.pathname === '/api/upload') {
    return res.writeHead(201).end(json({ ok: true, uploadId: url.searchParams.get('id') || 'demo', message: 'photo accepted' }));
  }

  // GET /api/upload/{id} — retrieve upload metadata
  if (req.method === 'GET' && url.pathname.startsWith('/api/upload/')) {
    return res.writeHead(200).end(json({ ok: true, uploadId: url.pathname.replace('/api/upload/', '') }));
  }

  // GET /jobs/stats
  if (path === '/jobs/stats') return res.writeHead(200).end(json({ totalJobs: 12, basicJobs: 5, ceramicJobs: 6, premiumJobs: 1, expressJobs: 0, revenue: 134.5 }));

  // GET /jobs/history
  if (path.startsWith('/jobs/history')) {
    const params = new URLSearchParams(req.url.split('?')[1] || '');
    let page = parseInt(params.get('page')) || 1;
    let size = parseInt(params.get('size')) || 5;
    let range = params.get('range') || 'all'; // 'today','yesterday','last7days'
    const allJobs = [
      { id: 'e8f3c4d9-2a1b-4390-b042-d502f19417c7', plateNumber: 'ABCD-123', model: 'Toyota Camry', color: 'Blue', category: 'basic', employeeName: 'Maria Lopez', completedAt: new Date(1718968302 * 1000).toISOString() },
      { id: 'e8f3c4d9-2a1b-4390-b042-d502f19417c8', plateNumber: 'ABCD-456', model: 'BMW X5', color: 'Gray', category: 'ceramic', employeeName: 'David Kim', completedAt: new Date(1718968277 * 1000).toISOString() },
      { id: 'e8f3c4d9-2a1b-4390-b042-d502f19417c9', plateNumber: 'ABCD-789', model: 'Toyota Camry', color: 'Blue', category: 'basic', employeeName: 'Maria Lopez', completedAt: new Date(1718968243 * 1000).toISOString() },
      { id: 'e8f3c4d9-2a1b-4390-b042-d502f19417ca', plateNumber: 'XYS-111', model: 'BMW X5', color: 'Gray', category: 'ceramic', employeeName: 'David Kim', completedAt: new Date(1718968212 * 1000).toISOString() },
      { id: 'e8f3c4d9-2a1b-4390-b042-d502f19417cb', plateNumber: 'ABC-070', model: 'Toyota Camry', color: 'Blue', category: 'basic', employeeName: 'Maria Lopez', completedAt: new Date(1718965943 * 1000).toISOString() }
    ];
    const total = allJobs.length;
    let filtered = allJobs.slice().reverse(); // newest first per spec
    let start = (page - 1) * size;
    start = Math.min(start, filtered.length);
    let items = [];
    for (let i = 0; i < size && i + start < total; i++) {
      items.push(filtered[i]);
    }
    return res.writeHead(200).end(json({ records: items, total, page, size }));
  }

  // GET /jobs/record/{id}
  if (path.startsWith('/jobs/record/')) return res.writeHead(200).end(json({ ok: true, recordId: path.replace('/jobs/record/', '') }));

  // DELETE /jobs/record/{id} - soft delete
  if (req.method === 'DELETE' && path.startsWith('/jobs/record/')) return res.writeHead(204).end('');

  // POST /jobs/record/{id} - patch a job record
  if (req.method === 'POST' && path.startsWith('/jobs/record/')) {
    const id = path.replace('/jobs/record/', '');
    return res.writeHead(200).end(json({ status: 'updated', durationMs: Math.floor(Math.random() * 1800), notes: 'completed' }));
  }

  res.writeHead(404).end('{}');
  // GET /openapi.json from embedded spec
}));

server.listen(PORT, () => {
  console.log('*', `SparkleWash API server listening on http://localhost:${PORT}/`)
})
