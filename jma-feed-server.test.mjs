import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createJmaFeedLoader,createJmaReportLoader,validJmaFloodReportUrl} from './jma-feed-server.mjs';

test('feed loader caches briefly, conditionally revalidates, and never returns stale data on failure',async()=>{
 let now=Date.parse('2026-11-03T00:00:00Z'),calls=0,fail=false;
 const loader=createJmaFeedLoader({clock:()=>now,fetcher:async(url,options)=>{calls++;assert.equal(url,'https://www.data.jma.go.jp/developer/xml/feed/extra_l.xml');if(fail)throw Error('network');if(calls===1)return new Response('<feed xmlns="http://www.w3.org/2005/Atom"></feed>',{status:200,headers:{etag:'"v1"'}});assert.equal(options.headers['If-None-Match'],'"v1"');return new Response(null,{status:304})}});
 const first=await loader();assert.equal((await loader()).fetchedAt,first.fetchedAt);assert.equal(calls,1);
 now+=60000;const refreshed=await loader();assert.equal(calls,2);assert.notEqual(refreshed.fetchedAt,first.fetchedAt);assert.equal(refreshed.xml,first.xml);
 now+=60000;fail=true;await assert.rejects(loader(),/network/);
});

test('oversized or unexpected feed data is refused',async()=>{
 const tooLarge=createJmaFeedLoader({fetcher:async()=>new Response('x',{headers:{'content-length':'5000001'}})});
 await assert.rejects(tooLarge(),/サイズ/);
 const invalid=createJmaFeedLoader({fetcher:async()=>new Response('<!DOCTYPE feed><feed/>')});
 await assert.rejects(invalid(),/形式/);
});

test('short feed uses a fixed official endpoint and separate cache from long feed',async()=>{
 const urls=[],fetcher=async url=>{urls.push(url);return new Response('<feed xmlns="http://www.w3.org/2005/Atom"></feed>')};
 const long=createJmaFeedLoader({fetcher}),recent=createJmaFeedLoader({frequency:'recent',fetcher});
 await Promise.all([long(),recent()]);await recent();
 assert.deepEqual(urls.sort(),['https://www.data.jma.go.jp/developer/xml/feed/extra.xml','https://www.data.jma.go.jp/developer/xml/feed/extra_l.xml']);
 assert.throws(()=>createJmaFeedLoader({frequency:'https://other.example/'}));
});

test('bulletin loader only fetches allowed JMA URLs, limits size and reuses retrieved bulletins',async()=>{
 const url='https://www.data.jma.go.jp/developer/xml/data/20251118064500_0_VXKO50_000000.xml';let calls=0;
 const loader=createJmaReportLoader({fetcher:async(_,options)=>{calls++;assert.equal(options.redirect,'error');return new Response('<Report/>')}});
 assert.equal(validJmaFloodReportUrl(url),true);assert.equal(validJmaFloodReportUrl('https://evil.test/a_VXKO50_1.xml'),false);
 await assert.rejects(loader(url+'?x=1'));const [a,b]=await Promise.all([loader(url),loader(url)]);assert.deepEqual(a,b);assert.equal(calls,1);await loader(url);assert.equal(calls,1);
 const tooLarge=createJmaReportLoader({fetcher:async()=>new Response('x',{headers:{'content-length':'1000001'}})});await assert.rejects(tooLarge(url));
 const bad=createJmaReportLoader({fetcher:async()=>new Response('<!DOCTYPE Report><Report/>')});await assert.rejects(bad(url));
});

test('bulletin cache expires, re-fetches after clock rollback and never hides a failed refresh',async()=>{
 const url='https://www.data.jma.go.jp/developer/xml/data/20251118064500_0_VXKO50_000000.xml';
 let now=Date.parse('2026-11-03T00:00:00Z'),calls=0,fail=false;
 const loader=createJmaReportLoader({clock:()=>now,fetcher:async()=>{
  calls++;if(fail)throw Error('network');return new Response(`<Report><version>${calls}</version></Report>`);
 }});
 const first=await loader(url);now+=59999;assert.equal((await loader(url)).xml,first.xml);assert.equal(calls,1);
 now+=1;const refreshed=await loader(url);assert.equal(calls,2);assert.notEqual(refreshed.xml,first.xml);assert.notEqual(refreshed.fetchedAt,first.fetchedAt);
 now+=60000;fail=true;await assert.rejects(loader(url),/network/);assert.equal(calls,3);
 fail=false;now-=120000;const rolledBack=await loader(url);assert.equal(calls,4);assert.notEqual(rolledBack.xml,refreshed.xml);
});
