import fs from 'node:fs';
import {JSDOM, VirtualConsole} from '/tmp/codex-jsdom/node_modules/jsdom/lib/api.js';

const file=new URL('../../outputs/zavarovanje-skornsek-nova-agencijska-stran.html',import.meta.url);
const html=fs.readFileSync(file,'utf8');
const virtualConsole=new VirtualConsole();
virtualConsole.on('jsdomError',()=>{});
const dom=new JSDOM(html,{
  runScripts:'dangerously',
  url:'https://zav-skornsek.local/#home',
  pretendToBeVisual:true,
  virtualConsole,
  beforeParse(window){
    window.scrollTo=()=>{};
    window.fetch=async()=>({ok:true,json:async()=>({reply:'Preizkusni odgovor'})});
  }
});
const {window}=dom;
const seen=new Set();
const queue=['home'];
const strings=new Set();

function collect(){
  const walker=window.document.createTreeWalker(window.document.body,window.NodeFilter.SHOW_TEXT);
  while(walker.nextNode()){
    if(walker.currentNode.parentElement?.closest('script,style,noscript'))continue;
    const value=walker.currentNode.nodeValue.replace(/\s+/g,' ').trim();
    if(value && !/^[\d\s/·→←↗↑×+–—.,:;!?()]+$/.test(value))strings.add(value);
  }
  for(const el of window.document.querySelectorAll('[placeholder],[aria-label],[title],[alt],[data-q],[data-ai-q]')){
    for(const name of ['placeholder','aria-label','title','alt','data-q','data-ai-q']){
      const value=(el.getAttribute(name)||'').trim();
      if(value)strings.add(value);
    }
  }
  for(const a of window.document.querySelectorAll('a[href^="#"]')){
    const route=a.getAttribute('href').slice(1).split(/[?#]/)[0];
    if(route && !seen.has(route) && !queue.includes(route))queue.push(route);
  }
}

[
  'Pošiljam','Sporočilo uspešno poslano!','Napaka pri pošiljanju.','Trenutno nimam odgovora.',
  'AI asistent piše','Chatbot frontend je pripravljen. Za delovanje povežite Vercel backend /api/chat in dodajte OPENAI_API_KEY. Za pomoč lahko pokličete Aljaža ali Igorja.',
  'AI stran je pripravljena. Za delovanje je treba projekt objaviti na Vercel in povezati /api/chat z OpenAI API ključem. Za pomoč lahko pokličete Aljaža ali Igorja.',
  'Zapri','Zapri meni','Meni','Odpri meni','Zavarovanje','Zavarovanje Skornšek logo',
  'Zavarovanje Skornšek | Vsa zavarovanja na enem mestu'
].forEach(value=>strings.add(value));

while(queue.length){
  const route=queue.shift();
  if(seen.has(route))continue;
  seen.add(route);
  window.location.hash=route;
  window.dispatchEvent(new window.HashChangeEvent('hashchange'));
  collect();
}

const result={routes:[...seen],strings:[...strings].sort((a,b)=>a.localeCompare(b,'sl'))};
fs.writeFileSync(new URL('./translatable-sl.json',import.meta.url),JSON.stringify(result,null,2));
console.log(`${result.routes.length} routes, ${result.strings.length} unique strings`);
window.close();
