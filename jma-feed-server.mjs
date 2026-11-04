const FEEDS=Object.freeze({long:'https://www.data.jma.go.jp/developer/xml/feed/extra_l.xml',recent:'https://www.data.jma.go.jp/developer/xml/feed/extra.xml'});
const LIMIT=5_000_000;

export function validJmaFloodReportUrl(value){
  if(typeof value!=='string'||value.length>300)return false;
  try{const url=new URL(value);return url.protocol==='https:'&&url.hostname==='www.data.jma.go.jp'&&!url.port&&!url.username&&!url.password&&!url.search&&!url.hash&&/^\/developer\/xml\/data\/[0-9]{14}_[0-9]+_VXKO(?:5\d|6\d|7\d|8\d)_[0-9]+\.xml$/.test(url.pathname)&&url.href===value}catch{return false}
}
export function validJmaWarningReportUrl(value){
  if(typeof value!=='string'||value.length>300)return false;
  try{const url=new URL(value);return url.protocol==='https:'&&url.hostname==='www.data.jma.go.jp'&&!url.port&&!url.username&&!url.password&&!url.search&&!url.hash&&/^\/developer\/xml\/data\/[0-9]{14}_[0-9]+_VPWW55_[0-9]{6}\.xml$/.test(url.pathname)&&url.href===value}catch{return false}
}

export function createJmaReportLoader({fetcher=fetch,clock=Date.now,validator=validJmaFloodReportUrl}={}){
  const saved=new Map(),pending=new Map();
  return async url=>{
    if(!validator(url))throw new Error('電文URLが不正です');
    const cached=saved.get(url),now=clock();
    if(cached&&now>=cached.checkedAt&&now-cached.checkedAt<60000)return cached.result;
    if(cached)saved.delete(url);
    if(pending.has(url))return pending.get(url);
    const task=(async()=>{
      const response=await fetcher(url,{redirect:'error',signal:AbortSignal.timeout(15000)});if(!response.ok||!response.body||Number(response.headers.get('content-length'))>1_000_000)throw new Error('電文を取得できません');
      const reader=response.body.getReader(),parts=[];let total=0;
      try{for(;;){const {done,value}=await reader.read();if(done)break;total+=value.byteLength;if(total>1_000_000)throw new Error('電文が大きすぎます');parts.push(value)}}finally{await reader.cancel().catch(()=>{})}
      const bytes=new Uint8Array(total);let offset=0;for(const part of parts){bytes.set(part,offset);offset+=part.byteLength}
      const xml=new TextDecoder('utf-8',{fatal:true}).decode(bytes);if(/<!DOCTYPE/i.test(xml)||!xml.includes('<Report'))throw new Error('電文の形式を確認できません');
      const checkedAt=clock(),result={xml,fetchedAt:new Date(checkedAt).toISOString()};if(saved.size>=10)saved.delete(saved.keys().next().value);saved.set(url,{result,checkedAt});return result;
    })();pending.set(url,task);try{return await task}finally{pending.delete(url)}
  };
}

export function createJmaFeedLoader({fetcher=fetch,clock=Date.now,frequency='long'}={}){
  if(!Object.hasOwn(FEEDS,frequency))throw new Error('フィード種別が不正です');
  let saved=null,pending=null;
  return async()=>{
    const now=clock();if(saved&&now-saved.checkedAt<60000&&now>=saved.checkedAt)return {xml:saved.xml,fetchedAt:new Date(saved.checkedAt).toISOString()};
    if(pending)return pending;
    pending=(async()=>{
      const headers={};if(saved?.etag)headers['If-None-Match']=saved.etag;if(saved?.modified)headers['If-Modified-Since']=saved.modified;
      const response=await fetcher(FEEDS[frequency],{headers,redirect:'error',signal:AbortSignal.timeout(15000)});
      if(response.status===304&&saved){saved.checkedAt=clock();return {xml:saved.xml,fetchedAt:new Date(saved.checkedAt).toISOString()}}
      if(!response.ok||!response.body)throw new Error('気象庁フィードを取得できません');
      const declared=Number(response.headers.get('content-length'));if(declared>LIMIT)throw new Error('フィードのサイズが上限を超えました');
      const reader=response.body.getReader(),parts=[];let total=0;
      try{for(;;){const {done,value}=await reader.read();if(done)break;total+=value.byteLength;if(total>LIMIT)throw new Error('フィードのサイズが上限を超えました');parts.push(value)}}finally{await reader.cancel().catch(()=>{})}
      const bytes=new Uint8Array(total);let offset=0;for(const part of parts){bytes.set(part,offset);offset+=part.byteLength}
      const xml=new TextDecoder('utf-8',{fatal:true}).decode(bytes);if(!xml.includes('<feed')||/<!DOCTYPE/i.test(xml))throw new Error('フィードの形式を確認できません');
      saved={xml,etag:response.headers.get('etag'),modified:response.headers.get('last-modified'),checkedAt:clock()};return {xml,fetchedAt:new Date(saved.checkedAt).toISOString()};
    })();
    try{return await pending}finally{pending=null}
  };
}
