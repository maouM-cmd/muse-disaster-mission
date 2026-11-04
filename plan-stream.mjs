export async function readPlanStream(response,onSora){
  if(!response.ok){const body=await response.json();throw new Error(body.error||'作戦を取得できません')}
  if(!response.body)throw new Error('作戦の受信を開始できません');
  const reader=response.body.getReader(),decoder=new TextDecoder();let pending='',result=null;
  while(true){
    const chunk=await reader.read();pending+=decoder.decode(chunk.value||new Uint8Array(),{stream:!chunk.done});
    const lines=pending.split('\n');pending=lines.pop();
    for(const line of lines){
      if(!line.trim())continue;
      const event=JSON.parse(line);
      if(event.type==='sora')onSora(event.text);
      if(event.type==='result')result=event.result;
      if(event.type==='error')throw new Error(event.error||'作戦を取得できません');
    }
    if(chunk.done)break;
  }
  if(pending.trim())throw new Error('作戦の受信が途中で終了しました');
  if(!result)throw new Error('作戦の最終結果がありません');
  return result;
}
