import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { connectXhs, statusXhs, prepareXhs, closeWorker } from './xhs_bridge.mjs';
import {providerBridge,closeProviders} from './provider_bridge.mjs';
import {createTokenPayService,protectedKeyStore} from './tokenpay_service.mjs';
import {handleTokenPay} from './tokenpay_http.mjs';
const root = fileURLToPath(new URL('.', import.meta.url));
// These non-secret switches stay off until the human authorizes the concrete actions.
const tokenpay=createTokenPayService({store:protectedKeyStore(root+'.runtime/tokenpay'),permissions:{keyCreation:process.env.ELI_TOKENPAY_KEY_CREATION_AUTHORIZED==='1',modelCalls:process.env.ELI_TOKENPAY_MODEL_CALLS_AUTHORIZED==='1'&&Number(process.env.ELI_TOKENPAY_MAX_COST_MICROS)>0&&Number(process.env.ELI_TOKENPAY_INPUT_PRICE)>0&&Number(process.env.ELI_TOKENPAY_OUTPUT_PRICE)>0,model:process.env.ELI_TOKENPAY_MODEL,maxCalls:Number(process.env.ELI_TOKENPAY_MAX_CALLS||0),maxOutputTokens:Number(process.env.ELI_TOKENPAY_MAX_OUTPUT_TOKENS||0),maxInputBytes:8000,maxCostMicros:Number(process.env.ELI_TOKENPAY_MAX_COST_MICROS||0),inputPrice:Number(process.env.ELI_TOKENPAY_INPUT_PRICE||0),outputPrice:Number(process.env.ELI_TOKENPAY_OUTPUT_PRICE||0),accountRead:process.env.ELI_TOKENPAY_ACCOUNT_READ_AUTHORIZED==='1',recharge:process.env.ELI_TOKENPAY_RECHARGE_AUTHORIZED==='1',maxRechargeYuan:Number(process.env.ELI_TOKENPAY_MAX_RECHARGE_YUAN||0)}});
const routes = { '/': ['index.html', 'text/html; charset=utf-8'], '/index.html': ['index.html', 'text/html; charset=utf-8'], '/style.css': ['style.css', 'text/css; charset=utf-8'], '/app.js': ['app.js', 'application/javascript; charset=utf-8'], '/storage.js': ['storage.js', 'application/javascript; charset=utf-8'], '/icon.png': ['../assets/eli-social-publisher-icon-v5.png', 'image/png'] };
routes['/xhs-policy.mjs'] = ['xhs-policy.mjs', 'application/javascript; charset=utf-8'];
routes['/bilibili-policy.mjs'] = ['bilibili-policy.mjs', 'application/javascript; charset=utf-8'];
routes['/douyin-policy.mjs'] = ['douyin-policy.mjs', 'application/javascript; charset=utf-8'];
const server = http.createServer(async (req, res) => {
  if (req.headers.host !== '127.0.0.1:4197') { res.writeHead(403); return res.end('Invalid host'); }
  const pathname = new URL(req.url, 'http://127.0.0.1:4197').pathname;
  const route = routes[pathname];
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
  res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' blob: data:; media-src 'self' blob:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'");
  if (pathname.startsWith('/api/')) {
    const origin = req.headers.origin;
    if (origin && origin !== 'http://127.0.0.1:4197') { res.writeHead(403); return res.end('Invalid origin'); }
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    try {
      if(await handleTokenPay(req,res,tokenpay))return;
      const providerRoute=pathname.match(/^\/api\/(douyin|bilibili)\/(status|inspect|connect)$/);
      const settingsRoute=pathname.match(/^\/api\/(bilibili|douyin)\/(catalog|settings-inspect|options)$/);
      if(settingsRoute&&req.method==='POST'){
        if(origin!=='http://127.0.0.1:4197'||req.headers['x-eli-request']!=='local-workbench'||!req.headers['content-type']?.startsWith('application/json')){res.writeHead(403);return res.end('{"error":"请求来源不匹配"}');}
        const limit=settingsRoute[2]==='options'?4*1024*1024:1024;let bytes=0;const parts=[];
        for await(const chunk of req){bytes+=chunk.length;if(bytes>limit){res.writeHead(413);return res.end('{"error":"请求过大"}');}parts.push(chunk);}
        let payload;try{payload=JSON.parse(Buffer.concat(parts).toString('utf8'));}catch{res.writeHead(400);return res.end('{"error":"请求数据格式错误"}');}
        const bridge=providerBridge(settingsRoute[1]);
        return res.end(JSON.stringify(await (settingsRoute[2]==='catalog'?bridge.catalog():settingsRoute[2]==='settings-inspect'?bridge.settingsInspect():bridge.options(payload))));
      }
      const videoPrepareRoute=pathname.match(/^\/api\/(douyin|bilibili)\/prepare$/);
      if(videoPrepareRoute&&req.method==='POST'){
        if(origin!=='http://127.0.0.1:4197'||req.headers['x-eli-request']!=='local-workbench'||!req.headers['content-type']?.startsWith('application/json')){res.writeHead(403);return res.end('{"error":"请求来源不匹配"}');}
        const limit=140*1024*1024;let bytes=0;const parts=[];
        if(Number(req.headers['content-length']||0)>limit){res.writeHead(413);return res.end('{"error":"素材传输超过本地限制"}');}
        for await(const chunk of req){bytes+=chunk.length;if(bytes>limit){res.writeHead(413);return res.end('{"error":"素材传输超过本地限制"}');}parts.push(chunk);}
        let payload;try{payload=JSON.parse(Buffer.concat(parts).toString('utf8'));}catch{res.writeHead(400);return res.end('{"error":"请求数据格式错误"}');}
        return res.end(JSON.stringify(await providerBridge(videoPrepareRoute[1]).prepare(payload)));
      }
      if(providerRoute){
        const [,platform,action]=providerRoute;
        if(action==='status'&&req.method==='GET')return res.end(JSON.stringify(await providerBridge(platform).status()));
        if(action==='inspect'&&req.method==='GET'&&req.headers['x-eli-request']==='local-workbench'&&req.headers['sec-fetch-site']==='same-origin')return res.end(JSON.stringify(await providerBridge(platform).inspect()));
        if(action==='connect'&&req.method==='POST'&&origin==='http://127.0.0.1:4197'&&req.headers['x-eli-request']==='local-workbench'&&req.headers['content-type']?.startsWith('application/json')){
          let bytes=0;const parts=[];
          for await(const chunk of req){bytes+=chunk.length;if(bytes>1024){res.writeHead(413);return res.end('{"error":"请求过大"}');}parts.push(chunk);}
          let payload;try{payload=JSON.parse(Buffer.concat(parts).toString('utf8'));}catch{res.writeHead(400);return res.end('{"error":"请求数据格式错误"}');}
          return res.end(JSON.stringify(await providerBridge(platform).connect({fresh:payload?.fresh===true,kind:payload?.kind||'video'})));
        }
        res.writeHead(403);return res.end('{"error":"请求来源不匹配"}');
      }
      if (req.method === 'GET' && pathname === '/api/xhs/status') return res.end(JSON.stringify(await statusXhs()));
      if (req.method === 'GET' && ['/api/xhs/login-preview','/api/xhs/inspect'].includes(pathname)) {
        if (req.headers['x-eli-request'] !== 'local-workbench' || req.headers['sec-fetch-site'] !== 'same-origin') { res.writeHead(403); return res.end('{"error":"仅本地工作台可查看登录区域"}'); }
        const {rpc} = await import('./xhs_bridge.mjs');
        return res.end(JSON.stringify(await rpc(pathname.endsWith('/inspect')?'inspect':'login_preview')));
      }
      if (req.method !== 'POST' || !['/api/xhs/connect', '/api/xhs/prepare'].includes(pathname)) { res.writeHead(404); return res.end('{"error":"Not found"}'); }
      if (origin !== 'http://127.0.0.1:4197' || req.headers['x-eli-request'] !== 'local-workbench' || !req.headers['content-type']?.startsWith('application/json')) { res.writeHead(403); return res.end('{"error":"请求来源不匹配"}'); }
      const limit = pathname.endsWith('/prepare') ? 140 * 1024 * 1024 : 1024;
      if (Number(req.headers['content-length'] || 0) > limit) { res.writeHead(413); return res.end('{"error":"图片传输超过本地限制"}'); }
      let bytes = 0; const chunks = [];
      for await (const chunk of req) {
        bytes += chunk.length;
        if (bytes > limit) { res.writeHead(413); return res.end('{"error":"图片传输超过本地限制"}'); }
        chunks.push(chunk);
      }
      let payload; try { payload = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { res.writeHead(400); return res.end('{"error":"请求数据格式错误"}'); }
      const result = pathname.endsWith('/connect') ? await connectXhs({fresh:payload?.fresh===true,kind:payload?.kind==='video'?'video':'image'}) : await prepareXhs(payload);
      return res.end(JSON.stringify(result));
    } catch (error) { res.writeHead(400); return res.end(JSON.stringify({error:error.message})); }
  }
  if (!['GET', 'HEAD'].includes(req.method) || !route) { res.writeHead(404); return res.end('Not found'); }
  try { const b = await readFile(root + route[0]); res.writeHead(200, { 'Content-Type': route[1], 'Content-Length': b.length }); res.end(req.method === 'HEAD' ? undefined : b); }
  catch { res.writeHead(500); res.end('Asset unavailable'); }
});
server.listen(4197, '127.0.0.1', () => console.log('Eli 工作台：http://127.0.0.1:4197'));
server.on('error', e => { console.error(e.message); process.exitCode = 1; });
process.on('SIGTERM', () => { closeWorker();closeProviders(); server.close(() => process.exit(0)); });
