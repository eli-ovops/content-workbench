// Server-only payment sessions. No automatic payment, polling, or model retry.
import {execFile} from 'node:child_process';
const BASE='https://tokendance.space/portal/api/v1';
const TERMINAL=new Set(['paid','failed','closed','refunded','expired']);
const safeId=v=>typeof v==='string'&&/^[A-Za-z0-9_-]{1,100}$/.test(v);
export function paymentStatusUrl(id){if(!safeId(id))throw new Error('invalid_payment_id');return BASE+'/payment/sessions/'+id;}
export function parsePayment(data,expected,now=Date.now()){
 const s=data?.session;
 if(!s||!safeId(s.id)||!Number.isInteger(s.amount)||s.amount<1||s.amount>100000||!['pending','paid','failed','closed','refunded'].includes(s.status)||!Number.isSafeInteger(s.expired_at)||s.expired_at<=0)throw new Error('invalid_payment_response');
 if(expected&&(s.id!==expected.id||s.amount!==expected.amount))throw new Error('payment_identity_mismatch');
 if(s.status_url!==undefined&&s.status_url!==paymentStatusUrl(s.id))throw new Error('unsafe_payment_status_url');
 return {id:s.id,amount:s.amount,status:s.status==='pending'&&s.expired_at*1000<=now?'expired':s.status,expiresAt:s.expired_at*1000};
}
export async function localPaymentQr(value){
 if(typeof value!=='string'||!value||Buffer.byteLength(value)>3000)throw new Error('invalid_payment_code');
 // Existing bundled ReportLab encoder; no installs or third-party QR service.
 const python=process.env.ELI_QR_PYTHON||'/Users/USER/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python3';
 const code="import sys,json\nfrom reportlab.graphics.barcode.qrencoder import QRCode,QRErrorCorrectLevel\nq=QRCode(None,QRErrorCorrectLevel.M);q.addData(json.loads(sys.stdin.read()));q.make();n=q.getModuleCount();paths=' '.join(f'M{x+4},{y+4}h1v1h-1z' for y in range(n) for x in range(n) if q.modules[y][x]);print(f'<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 {n+8} {n+8}\"><path fill=\"white\" d=\"M0,0h{n+8}v{n+8}H0z\"/><path fill=\"black\" d=\"{paths}\"/></svg>')";
 return new Promise((resolve,reject)=>{
  const child=execFile(python,['-c',code],{timeout:10000,maxBuffer:300000},(error,stdout)=>{if(error)return reject(new Error('local_qr_unavailable'));resolve('data:image/svg+xml;base64,'+Buffer.from(stdout.trim()).toString('base64'));});
  child.stdin.on('error',()=>{});child.stdin.end(JSON.stringify(value));
 });
}
export function createTokenPayPayments({permissions={},store,fetchImpl=fetch,qr=localPaymentQr,now=Date.now}={}){
 let busy=false,state=null,lastCheck=0;
 const allowed=()=>permissions.recharge===true&&Number.isInteger(permissions.maxRechargeYuan)&&permissions.maxRechargeYuan>=1&&permissions.maxRechargeYuan<=100000;
 const load=async()=>{if(state===null)state=await store?.readPayment?.()||{phase:'not_started'};return state;};
 const save=async value=>{state=value;await store?.savePayment?.(value);};
 const publicState=s=>({phase:s.phase,amount:s.amount??null,expiresAt:s.expiresAt??null,paid:s.phase==='paid',sessionCreated:!!s.id});
 return {
  async status(){return {...publicState(await load()),rechargeAllowed:allowed(),maxRechargeYuan:allowed()?permissions.maxRechargeYuan:0};},
  async create({amount,confirmed,balanceRequired}){
   if(!allowed())throw new Error('recharge_not_authorized');
   if(confirmed!==true||balanceRequired!==true||!Number.isInteger(amount)||amount<1||amount>permissions.maxRechargeYuan)throw new Error('recharge_confirmation_required');
   if(busy)throw new Error('payment_in_progress');busy=true;
   try{
    if((await load()).phase!=='not_started')throw new Error('existing_payment_requires_review');
    const key=await store.read();
    // Durable before POST. An uncertain outcome must never create another charge.
    const started={phase:'creation_unknown',amount,startedAt:now()};
    if(store.lockPayment){await store.lockPayment(started);state=started;}else await save(started);
    const response=await fetchImpl(BASE+'/payment/sessions',{method:'POST',redirect:'error',signal:AbortSignal.timeout(30000),headers:{Authorization:'Bearer '+key,'Content-Type':'application/json'},body:JSON.stringify({amount})});
    if(!response.ok)throw new Error('payment_creation_unverified');
    const data=await response.json(),session=parsePayment(data,null,now());
    if(session.amount!==amount||session.status!=='pending')throw new Error('payment_creation_unverified');
    await save({...session,phase:session.status});
    const raw=data.session.payment_url;
    const qrDataUrl=await qr(raw);
    // Never fetch payment_url; it is PC QR content, not a redirect destination.
    let alipayUrl=null;
    if(typeof data.session.alipay_url==='string'){
     const u=new URL(data.session.alipay_url);
     if(u.protocol==='alipays:'&&u.hostname==='platformapi'&&u.pathname==='/startapp')alipayUrl=u.href;
    }
    return {...publicState(state),qrDataUrl,alipayUrl};
   }finally{busy=false;}
  },
  async check(){
   if(!allowed())throw new Error('recharge_not_authorized');
   if(busy)throw new Error('payment_in_progress');busy=true;
   try{
    const s=await load();if(!s.id)throw new Error('no_verified_payment_session');
    if(TERMINAL.has(s.phase))return publicState(s);
    if(s.expiresAt<=now()){await save({...s,phase:'expired'});return publicState(state);}
    if(lastCheck&&now()-lastCheck<3000)throw new Error('payment_poll_too_frequent');lastCheck=now();
    const key=await store.read(),response=await fetchImpl(paymentStatusUrl(s.id),{method:'GET',redirect:'error',signal:AbortSignal.timeout(30000),headers:{Authorization:'Bearer '+key}});
    if(!response.ok)throw new Error('payment_status_unverified');
    const data=await response.json(),next=parsePayment(data,s,now());await save({...next,phase:next.status});
    if(next.status==='pending'&&typeof data.session.payment_url==='string')return {...publicState(state),qrDataUrl:await qr(data.session.payment_url)};
    return publicState(state);
   }finally{busy=false;}
  }
 };
}
