export function configureSpeech(utterance, speaker, voices) {
  const japanese=voices.filter(voice=>/^ja(?:-|$)/i.test(voice.lang));
  const profile=speaker==='ソラ'?{index:0,pitch:1.12,rate:1.03}:
    speaker==='ナギ'?{index:1,pitch:.9,rate:.97}:{index:0,pitch:1,rate:1};
  utterance.lang='ja-JP';utterance.pitch=profile.pitch;utterance.rate=profile.rate;
  if(japanese.length)utterance.voice=japanese[profile.index%japanese.length];
  return utterance;
}

export function trackSpeech(utterance, row, radio, enabled, onError=()=>{}, onStart=()=>{}) {
  utterance.onstart=()=>{
    if(!enabled()||!row.isConnected)return;
    onStart();
    row.classList.add('speaking');
    radio.scrollTop+=row.getBoundingClientRect().top-radio.getBoundingClientRect().top-radio.clientHeight/3;
  };
  utterance.onend=()=>row.classList.remove('speaking');
  utterance.onerror=event=>{row.classList.remove('speaking');if(!['canceled','interrupted'].includes(event?.error)&&enabled()&&row.isConnected)onError()};
  return utterance;
}
