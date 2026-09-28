// Build a contact sheet of screenshots via Chromium (no ImageMagick available).
const { chromium } = require('playwright');
const fs=require('fs'),path=require('path');
(async()=>{const [out,cols,...files]=process.argv.slice(2);
const b=await chromium.launch();const p=await b.newPage({viewport:{width:1440,height:900}});
const imgs=files.map(f=>'data:image/png;base64,'+fs.readFileSync(f).toString('base64'));
await p.setContent('<body style="margin:0;display:grid;grid-template-columns:repeat('+cols+',1fr);gap:4px;background:#000">'+imgs.map((s,i)=>'<div style="position:relative"><img style="width:100%;display:block" src="'+s+'"><b style="position:absolute;left:4px;top:2px;color:red;font:14px sans-serif">'+path.basename(files[i])+'</b></div>').join('')+'</body>');
await p.waitForTimeout(300);await p.screenshot({path:out,fullPage:true});await b.close();})();
