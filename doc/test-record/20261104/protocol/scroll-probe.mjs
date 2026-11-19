import { chromium } from '/Users/Shared/Development/Source/Library/org/datagraph/jsui/node_modules/playwright-core/index.mjs';
import { readFileSync } from 'node:fs'; import { homedir } from 'node:os';
const ORIGIN='http://localhost:8100', UP='https://nl4.dydra.com', ACCT='playwright';
const TOKEN=readFileSync(`${homedir()}/.dydra/nl4.dydra.com.playwright.token`,'utf8').trim();
const api=(p,i={})=>fetch(`${UP}${p}`,{...i,headers:{Authorization:`Bearer ${TOKEN}`,...(i.headers||{})}});
const names=['sp1','sp2','sp3'];
for(const n of names) await api(`/system/accounts/${ACCT}/repositories/test/views/${n}`,{method:'PUT',
  headers:{'Content-Type':'application/sparql-query',Accept:'application/n-quads'},body:'SELECT * WHERE { ?s ?p ?o } LIMIT 10'});
const b=await chromium.launch(); const p=await b.newPage({viewport:{width:1440,height:900}});
await p.goto(`${ORIGIN}/ui/user`); await p.waitForTimeout(1500);
await p.fill('[data-testid="login-host-input"]',ORIGIN);
await p.fill('[data-testid="login-username-input"]',ACCT);
await p.fill('[data-testid="login-password-input"]',`:${TOKEN}`);
await p.click('[data-testid="login-submit"]'); await p.waitForTimeout(4000);
await p.locator('a[href*="/repositories/test"]').first().click(); await p.waitForTimeout(4000);
for(const n of names){ const l=p.locator(`[data-testid="view-edit-${n}"]`).first();
  if(await l.count()){ await l.click().catch(()=>{}); await p.waitForTimeout(3000);} }
console.log(JSON.stringify(await p.evaluate(()=>{
  const c=document.querySelector('.view-editors-container');
  const chain=[]; let e=c;
  while(e&&e!==document.documentElement){ const s=getComputedStyle(e);
    chain.push({tag:e.tagName.toLowerCase(), cls:(e.className||'').toString().split(' ')[0],
      id:e.id||null, overflowY:s.overflowY, scrollH:e.scrollHeight, clientH:e.clientHeight,
      scrollable: e.scrollHeight>e.clientHeight+2 && /auto|scroll/.test(s.overflowY)});
    e=e.parentElement; }
  return { viewport: window.innerHeight, docScrollH: document.documentElement.scrollHeight,
           bodyScrollH: document.body.scrollHeight, chain };
}),null,1));
await p.screenshot({path:`${process.argv[2]}/editor-scroll-defect.png`});
await b.close();
for(const n of names) await api(`/system/accounts/${ACCT}/repositories/test/views/${n}`,{method:'DELETE',headers:{Accept:'application/n-quads'}});
