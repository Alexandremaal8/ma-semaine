import { encryptPayload } from '../worker/src/index.js';
import worker from '../worker/src/index.js';
const enc=new TextEncoder(), dec=new TextDecoder();
const b64u=b=>Buffer.from(b).toString('base64url'), unb=s=>new Uint8Array(Buffer.from(s,'base64url'));
const hmac=async(k,d)=>new Uint8Array(await crypto.subtle.sign('HMAC',await crypto.subtle.importKey('raw',k,{name:'HMAC',hash:'SHA-256'},false,['sign']),d));
const cat=(...a)=>{const o=new Uint8Array(a.reduce((x,y)=>x+y.length,0));let i=0;for(const x of a){o.set(x,i);i+=x.length}return o};
// fake browser subscription
const ua=await crypto.subtle.generateKey({name:'ECDH',namedCurve:'P-256'},true,['deriveBits']);
const uaPub=new Uint8Array(await crypto.subtle.exportKey('raw',ua.publicKey)); const auth=crypto.getRandomValues(new Uint8Array(16));
const sub={endpoint:'https://web.push.apple.com/abc',keys:{p256dh:b64u(uaPub),auth:b64u(auth)}};
const msg=JSON.stringify({title:'Ça marche ! é',body:'test'});
const body=await encryptPayload(sub,msg);
// decrypt as the browser would
const salt=body.slice(0,16), idlen=body[20], asPub=body.slice(21,21+idlen), ct=body.slice(21+idlen);
const asKey=await crypto.subtle.importKey('raw',asPub,{name:'ECDH',namedCurve:'P-256'},false,[]);
const ecdh=new Uint8Array(await crypto.subtle.deriveBits({name:'ECDH',public:asKey},ua.privateKey,256));
const ikm=await hmac(await hmac(auth,ecdh),cat(enc.encode('WebPush: info\0'),uaPub,asPub,new Uint8Array([1])));
const prk=await hmac(salt,ikm);
const cek=(await hmac(prk,cat(enc.encode('Content-Encoding: aes128gcm\0'),new Uint8Array([1])))).slice(0,16);
const nonce=(await hmac(prk,cat(enc.encode('Content-Encoding: nonce\0'),new Uint8Array([1])))).slice(0,12);
const pt=new Uint8Array(await crypto.subtle.decrypt({name:'AES-GCM',iv:nonce},await crypto.subtle.importKey('raw',cek,'AES-GCM',false,['decrypt']),ct));
console.log('rs',new DataView(body.buffer).getUint32(16),'delim',pt[pt.length-1],'roundtrip',dec.decode(pt.slice(0,-1))===msg);
// worker endpoints with in-memory KV and mocked fetch
const store=new Map(); const KV={get:async(k,t)=>{const v=store.get(k);return v==null?null:(t==='json'?JSON.parse(v):v)},put:async(k,v)=>store.set(k,v),delete:async k=>store.delete(k)};
const env={KV}; const sent=[];
globalThis.fetch=async(u,o)=>{sent.push({u,auth:o.headers.Authorization,len:o.body.length});return new Response(null,{status:201})};
const r1=await (await worker.fetch(new Request('https://w/vapid'),env)).json(); console.log('vapid len',unb(r1.publicKey).length);
const now=Date.now();
const r2=await (await worker.fetch(new Request('https://w/sync',{method:'POST',body:JSON.stringify({subscription:sub,notifications:[{at:now,title:'A',body:'x'},{at:now+5*60e3,title:'B',body:'y'}]})}),env)).json(); console.log('sync',r2);
let waits=[]; worker.scheduled({scheduledTime:now+10e3},env,{waitUntil:p=>waits.push(p)}); await Promise.all(waits);
console.log('pushed',sent.length, sent[0]?.u);
// verify the JWT signature with the public key
const [t]=sent[0].auth.match(/t=([^,]+)/).slice(1); const [h,p,s]=t.split('.');
const pub=await crypto.subtle.importKey('raw',unb(r1.publicKey),{name:'ECDSA',namedCurve:'P-256'},false,['verify']);
console.log('jwt ok',await crypto.subtle.verify({name:'ECDSA',hash:'SHA-256'},pub,unb(s),enc.encode(h+'.'+p)), JSON.parse(Buffer.from(p,'base64url')).aud);
const r3=await (await worker.fetch(new Request('https://w/test',{method:'POST',body:JSON.stringify({subscription:sub})}),env)).json(); console.log('test',r3);
