export function livePort(value){
  if(value===undefined||value==='')return 4385;
  if(!/^\d+$/.test(value))throw new Error('ポート番号が不正です');
  const n=Number(value);if(!Number.isSafeInteger(n)||n<1||n>65535)throw new Error('ポート番号が不正です');return n;
}
