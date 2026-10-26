const { chromium } = require('playwright'); const fs=require('fs');
const [,, out, mode] = process.argv; // mode: "all" or comma list of seconds
(async()=>{const b=await chromium.launch({channel:'chrome'});
const p=await b.newPage({viewport:{width:1280,height:720},deviceScaleFactor:1.5});
p.on('pageerror',e=>console.error('PAGEERR',e.message));
await p.goto('file://'+__dirname+'/demo.html');
await p.evaluate(s=>init(s), fs.readFileSync(__dirname+'/../logo.svg','utf8'));
fs.mkdirSync(out,{recursive:true});
for (const w of [0,10,20]) { await p.evaluate(t=>render(t),w); await p.screenshot(); }
const D=await p.evaluate(()=>DURATION), fps=30;
const ts = mode==='all' ? Array.from({length:D*fps},(_,i)=>i/fps) : mode.split(',').map(Number);
for (let i=0;i<ts.length;i++){ await p.evaluate(t=>render(t),ts[i]);
  await p.screenshot({path:`${out}/${mode==='all'?String(i).padStart(5,'0'):'t'+ts[i]}.png`}); }
await b.close();})();
