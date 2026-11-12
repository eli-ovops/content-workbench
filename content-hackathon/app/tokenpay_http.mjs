export async function handleTokenPay(req,res,service){
 const url=new URL(req.url,'http://127.0.0.1:4197');
 if(!url.pathname.startsWith('/api/tokenpay/'))return false;
 res.setHeader('Cache-Control','no-store');res.setHeader('Referrer-Policy','no-referrer');
 res.setHeader('Content-Type','application/json; charset=utf-8');
 if(req.headers.host!=='127.0.0.1:4197'){res.writeHead(403);res.end('{"error":"请求来源不匹配"}');return true;}
 if(url.pathname==='/api/tokenpay/status'&&req.method==='GET'){res.end(JSON.stringify(await service.status()));return true;}
 if(url.pathname==='/api/tokenpay/callback'&&req.method==='GET'){
  let status='needs-review';
  try{await service.finishAuthorization({flowId:url.searchParams.get('flow'),code:url.searchParams.get('code')});status='connected';}catch{}
  res.writeHead(303,{Location:'/?tokenpay='+status+'#wallet'});res.end();return true;
 }
 const actions={'authorize':'startAuthorization','suggest':'suggest','payment':'createPayment','payment-check':'checkPayment','resume':'resume','balance':'balance','usage-receipt':'usageReceipt'};
 const action=actions[url.pathname.slice('/api/tokenpay/'.length)];
 if(!action||req.method!=='POST'){res.writeHead(404);res.end('{"error":"Not found"}');return true;}
 if(req.headers.origin!=='http://127.0.0.1:4197'||req.headers['x-eli-request']!=='local-workbench'||!req.headers['content-type']?.startsWith('application/json')){res.writeHead(403);res.end('{"error":"请求来源不匹配"}');return true;}
 const chunks=[];let size=0;
 for await(const chunk of req){size+=chunk.length;if(size>100000){res.writeHead(413);res.end('{"error":"文案请求过大"}');return true;}chunks.push(chunk);}
 try{
  const payload=JSON.parse(Buffer.concat(chunks).toString('utf8'));
  const result=await service[action](payload);
  res.end(JSON.stringify(result));
 }catch{res.writeHead(400);res.end('{"error":"授权或调用未完成；请核对权限、额度与状态，不会自动重试。"}');}
 return true;
}
