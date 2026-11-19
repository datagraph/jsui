import { chromium } from '/Users/Shared/Development/Source/Library/org/datagraph/jsui/node_modules/playwright-core/index.mjs';
import { readFileSync } from 'node:fs'; import { homedir } from 'node:os';
const ORIGIN='http://localhost:8100', UP='https://nl4.dydra.com', ACCT='playwright';
const TOKEN=readFileSync(`${homedir()}/.dydra/nl4.dydra.com.playwright.token`,'utf8').trim();
const api=(p,i={})=>fetch(`${UP}${p}`,{...i,headers:{Authorization:`Bearer ${TOKEN}`,...(i.headers||{})}});
const names=['sv1','sv2','sv3','sv4'];
for(const n of names) await api(`/system/accounts/${ACCT}/repositories/test/views/${n}`,{method:'PUT',
  headers:{'Content-Type':'application/sparql-query',Accept:'application/n-quads'},body:'SELECT * WHERE { ?s ?p ?o } LIMIT 10'});

const b=await chromium.launch(); const p=await b.newPage({viewport:{width:1440,height:900}});
await p.goto(`${ORIGIN}/ui/user`); await p.waitForTimeout(1500);
await p.fill('[data-testid="login-host-input"]',ORIGIN);
await p.fill('[data-testid="login-username-input"]',ACCT);
await p.fill('[data-testid="login-password-input"]',`:${TOKEN}`);
await p.click('[data-testid="login-submit"]'); await p.waitForTimeout(4000);
await p.locator('a[href*="/repositories/test"]').first().click(); await p.waitForTimeout(4000);

const measure = () => p.evaluate((n) => {
  const c = document.querySelector('.view-editors-container');
  const eds = [...c.querySelectorAll('.view-editor')];
  const last = eds[eds.length-1];
  const cb = c.getBoundingClientRect(), lb = last ? last.getBoundingClientRect() : null;
  return { n, editors: eds.length, scrollTop: Math.round(c.scrollTop),
           scrollH: c.scrollHeight, clientH: c.clientHeight,
           lastTopInPane: lb ? Math.round(lb.top - cb.top) : null,
           lastVisible: lb ? (lb.top < cb.bottom - 20 && lb.bottom > cb.top + 20) : null };
}, null);

const rows=[];
for(const n of names){
  const l=p.locator(`[data-testid="view-edit-${n}"]`).first();
  if(await l.count()){ await l.click().catch(()=>{}); await p.waitForTimeout(3500); }
  const m = await measure(); m.added = n; rows.push(m);
}
for(const r of rows) console.log(`add ${r.added}: editors=${r.editors} scrollTop=${r.scrollTop} (max ${r.scrollH-r.clientH})  newEditorTopInPane=${r.lastTopInPane}  visible=${r.lastVisible}`);
await p.screenshot({path:process.argv[2]+'/editor-scroll-fixed.png'});
await b.close();
for(const n of names) await api(`/system/accounts/${ACCT}/repositories/test/views/${n}`,{method:'DELETE',headers:{Accept:'application/n-quads'}});
