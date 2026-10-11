export function datFiles(files) {
  const accepted=[], rejected=[];
  for(const file of files) (/\.dat$/i.test(file.name)?accepted:rejected).push(file);
  return {accepted,rejected};
}
export function installFileDrop(target, {show, hide, receive, blocked=()=>false}) {
  let depth=0;
  const isFile=e=>Array.from(e.dataTransfer?.types??[]).includes('Files');
  const reset=()=>{depth=0;hide();};
  target.addEventListener('dragenter',e=>{if(!isFile(e))return;e.preventDefault();depth++;if(!blocked())show();});
  target.addEventListener('dragover',e=>{if(!isFile(e))return;e.preventDefault();e.dataTransfer.dropEffect=blocked()?'none':'copy';});
  target.addEventListener('dragleave',e=>{if(!isFile(e))return;e.preventDefault();depth=Math.max(0,depth-1);if(!depth)hide();});
  target.addEventListener('drop',e=>{e.preventDefault();reset();if(isFile(e))receive(Array.from(e.dataTransfer.files));});
  target.addEventListener('dragend',reset);
  return reset;
}
