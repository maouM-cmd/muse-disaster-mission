// The key is kept in this process only and is never written to a project file.
import {stdin, stdout} from 'node:process';
import {normalizePastedKey,isPlausibleMetaKey} from './key-input.mjs';
import {livePort} from './live-port.mjs';
const port=livePort(process.env.PORT);

if (!stdin.isTTY || typeof stdin.setRawMode !== 'function') {
  console.error('対話式のターミナルで起動してください。');
  process.exit(1);
}
stdout.write('Meta Model APIキーを貼り付けて Enter を押してください（画面には表示されません）: ');
const key = await new Promise(resolve=>{
  let value='';
  stdin.setRawMode(true);stdin.resume();stdin.setEncoding('utf8');
  stdin.on('data',chunk=>{
    for (const char of chunk) {
      if(char==='\u0003'){stdin.setRawMode(false);stdout.write('\n中止しました。\n');process.exit(1)}
      if(char==='\r'||char==='\n'){stdin.setRawMode(false);stdin.pause();stdout.write('\n');resolve(value);return}
      if(char==='\u007f'||char==='\b'){value=value.slice(0,-1);continue}
      if(char==='\u001b'||(char>=' '&&char<='~')||char==='…')value+=char;
    }
  });
});
const normalized=normalizePastedKey(key);
if(!isPlausibleMetaKey(normalized)){console.error('LLM_ で始まる省略されていないMeta Model APIキーを入力してください。');process.exit(1)}
process.env.MODEL_API_KEY=normalized;
process.env.MUSE_REAL_ENABLED='1';
const {createServer}=await import('./server.mjs');
const server=createServer();
server.on('error',error=>{
  if(error.code==='EADDRINUSE')console.error(`ポート${port}が使用中です。別のポートで起動してください。`);
  else console.error(`起動に失敗しました: ${error.message}`);
  process.exitCode=1;
});
server.listen(port,'127.0.0.1',()=>console.log(`起動しました。http://127.0.0.1:${port}/ を開いてください。終了するにはこの画面を閉じます。`));
