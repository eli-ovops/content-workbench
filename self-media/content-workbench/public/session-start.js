// The owner's launcher supplies a short-lived, single-use ticket in the fragment.
const ticket=location.hash.slice(1);
history.replaceState(null,'','/start');
try{
 const response=ticket?await fetch('/session/start',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({ticket})}):await fetch('/api/state');
 if(!response.ok)throw new Error('启动链接已失效');
 location.replace('/');
}catch{
 document.getElementById('startup-status').textContent='打开未完成，请重新双击“启动内容工作台.command”。稿件仍保存在本机。';
}
