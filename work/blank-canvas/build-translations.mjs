import fs from 'node:fs';

const input=JSON.parse(fs.readFileSync(new URL('./translatable-sl.json',import.meta.url),'utf8'));
const marker='[ZXQ]';

async function request(text,target,attempt=0){
  const url=new URL('https://translate.googleapis.com/translate_a/single');
  url.searchParams.set('client','gtx');
  url.searchParams.set('sl','sl');
  url.searchParams.set('tl',target);
  url.searchParams.set('dt','t');
  url.searchParams.set('q',text);
  try{
    const response=await fetch(url,{headers:{'User-Agent':'Mozilla/5.0'}});
    if(!response.ok)throw new Error(`HTTP ${response.status}`);
    const body=await response.json();
    return body[0].map(part=>part[0]).join('');
  }catch(error){
    if(attempt>=4)throw error;
    await new Promise(resolve=>setTimeout(resolve,500*(attempt+1)));
    return request(text,target,attempt+1);
  }
}

function batches(values){
  const result=[];
  let current=[],size=0;
  for(const value of values){
    if(current.length>=12 || size+value.length>2800){result.push(current);current=[];size=0}
    current.push(value);size+=value.length+marker.length+4;
  }
  if(current.length)result.push(current);
  return result;
}

async function translateBatch(values,target){
  if(values.length===1)return [await request(values[0],target)];
  const translated=await request(values.join(`\n${marker}\n`),target);
  const parts=translated.split(new RegExp(`\\s*\\[ZXQ\\]\\s*`));
  if(parts.length===values.length)return parts.map(value=>value.trim());
  const middle=Math.ceil(values.length/2);
  return [...await translateBatch(values.slice(0,middle),target),...await translateBatch(values.slice(middle),target)];
}

async function translateAll(target){
  const output={};
  const groups=batches(input.strings);
  for(let index=0;index<groups.length;index++){
    const values=groups[index];
    const translated=await translateBatch(values,target);
    values.forEach((source,i)=>output[source]=translated[i]
      .replaceAll('Insurance Skornšek','Zavarovanje Skornšek')
      .replaceAll('Versicherung Skornšek','Zavarovanje Skornšek'));
    if((index+1)%10===0)console.log(`${target}: ${index+1}/${groups.length}`);
    await new Promise(resolve=>setTimeout(resolve,80));
  }
  return output;
}

const translations={en:await translateAll('en'),de:await translateAll('de')};
fs.writeFileSync(new URL('./translations.json',import.meta.url),JSON.stringify(translations,null,2));
console.log(`Completed ${input.strings.length} strings in 2 languages`);
