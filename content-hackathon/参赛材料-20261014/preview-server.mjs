// Local review files only; no APIs, uploads, account actions, or remote requests.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.dirname(fileURLToPath(import.meta.url));
const types={'.html':'text/html; charset=utf-8','.md':'text/plain; charset=utf-8','.json':'application/json','.srt':'text/plain; charset=utf-8','.png':'image/png','.jpg':'image/jpeg','.mp4':'video/mp4'};
http.createServer((req,res)=>{
 if(!['GET','HEAD'].includes(req.method)){res.writeHead(405);res.end();return;}
 let name;try{name=decodeURIComponent(new URL(req.url,'http://127.0.0.1').pathname)}catch{res.writeHead(400);res.end();return;}
 const p=path.resolve(root,'.'+name);if(!p.startsWith(root+path.sep)){res.writeHead(403);res.end();return;}
 fs.stat(p,(err,s)=>{
  if(err||!s.isFile()){res.writeHead(404);res.end();return;}
  const headers={'Content-Type':types[path.extname(p)]||'application/octet-stream','Accept-Ranges':'bytes','Cache-Control':'no-cache','X-Content-Type-Options':'nosniff'};
  let start=0,end=s.size-1,code=200;
  if(req.headers.range){
   const match=/^bytes=(\d*)-(\d*)$/.exec(req.headers.range);
   if(!match){res.writeHead(416,{'Content-Range':`bytes */${s.size}`});res.end();return;}
   if(!match[1])start=Math.max(0,s.size-Number(match[2]));
   else{start=Number(match[1]);if(match[2])end=Math.min(end,Number(match[2]));}
   if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start>end||start>=s.size){res.writeHead(416,{'Content-Range':`bytes */${s.size}`});res.end();return;}
   code=206;headers['Content-Range']=`bytes ${start}-${end}/${s.size}`;
  }
  headers['Content-Length']=end-start+1;res.writeHead(code,headers);
  if(req.method==='HEAD'){res.end();return;}
  const stream=fs.createReadStream(p,{start,end});req.on('close',()=>stream.destroy());stream.on('error',()=>res.destroy());stream.pipe(res);
 });
}).listen(4198,'127.0.0.1',()=>console.log('Local review preview 127.0.0.1:4198 with byte ranges'));
