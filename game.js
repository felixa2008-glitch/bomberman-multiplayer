const canvas=document.getElementById('gameCanvas'),ctx=canvas.getContext('2d');
const W=13,H=11,T=40,EMPTY=0,WALL=1,BLOCK=2;
let map=[],players={},myId=null,isHost=false,peer=null,hostConn=null,clientConns=[],slot=0;
const colors=['#00eeff','#ff4444','#55ff55','#ff55ff'];
const spawns=[{x:1,y:1},{x:W-2,y:H-2},{x:W-2,y:1},{x:1,y:H-2}];
let bombs=[],fires=[];

function newId(){return 'bm-'+Math.random().toString(36).slice(2,8);}
function initPeer(id){
  peer=new Peer(id||undefined);
  peer.on('error',e=>{document.getElementById('status').innerText='Erreur reseau: '+e.type;});
  peer.on('open',id=>{myId=id;if(isHost) setupHost(id);});
  peer.on('connection',conn=>{
    if(!isHost||clientConns.length>=3){conn.close();return;}
    const s=clientConns.length+1,pid=conn.peer,sp=spawns[s];
    clientConns.push(conn); players[pid]={x:sp.x,y:sp.y,color:colors[s],isAlive:true,slot:s,bomb:false};
    conn.on('data',d=>handleInput(pid,d));
    conn.on('close',()=>{delete players[pid];broadcast();});
    conn.on('open',()=>broadcast('Joueur '+(s+1)+' connecte.'));
  });
}
function setupHost(id){
  document.getElementById('roomCode').innerText=id;
  document.getElementById('host-info').style.display='block';
  document.getElementById('status').innerText='Partie creee. Donne ce code a tes amis.';
  map=generateMap();players[id]={...spawns[0],color:colors[0],isAlive:true,slot:0,bomb:false};
}
function startHost(){if(peer)return;isHost=true;initPeer(newId());}
function joinGame(){
  const code=document.getElementById('joinCodeInput').value.trim().toLowerCase();if(!code)return;
  isHost=false;peer=new Peer();
  peer.on('error',e=>document.getElementById('status').innerText='Impossible de rejoindre: '+e.type);
  peer.on('open',id=>{myId=id;hostConn=peer.connect(code,{reliable:true});
    hostConn.on('open',()=>document.getElementById('status').innerText='Connecte a la partie !');
    hostConn.on('data',d=>{map=d.map;players=d.players;bombs=d.bombs||[];fires=d.fires||[];if(d.statusText)document.getElementById('status').innerText=d.statusText;});
    hostConn.on('close',()=>document.getElementById('status').innerText='Connexion perdue.');
  });
}
function state(statusText=''){return {map,players,bombs,fires,statusText};}
function broadcast(t=''){if(!isHost)return;const s=state(t);clientConns=clientConns.filter(c=>c.open);clientConns.forEach(c=>c.send(s));}
function generateMap(){
 let m=[];for(let y=0;y<H;y++){m[y]=[];for(let x=0;x<W;x++)m[y][x]=(y==0||y==H-1||x==0||x==W-1||(x%2==0&&y%2==0))?WALL:(Math.random()<.35?BLOCK:EMPTY);}
 spawns.forEach(p=>{for(let dy=0;dy<=1;dy++)for(let dx=0;dx<=1;dx++)if(m[p.y+dy]?.[p.x+dx]!==undefined)m[p.y+dy][p.x+dx]=EMPTY;});return m;
}
function bombAt(x,y){return bombs.find(b=>b.x===x&&b.y===y)}
function canMove(x,y){return x>=0&&x<W&&y>=0&&y<H&&map[y][x]===EMPTY;}
function handleInput(id,a){
 const p=players[id];if(!p||!p.isAlive)return;
 if(a.type==='move'){const nx=p.x+a.dx,ny=p.y+a.dy;if(canMove(nx,ny)&&!(bombAt(nx,ny)&&!(nx===p.x&&ny===p.y))){p.x=nx;p.y=ny;}}
 if(a.type==='bomb')placeBomb(p);
 broadcast();
}
function placeBomb(p){if(bombAt(p.x,p.y)||p.bomb)return;p.bomb=true;const b={x:p.x,y:p.y,owner:p.slot,passX:p.x,passY:p.y};bombs.push(b);broadcast();setTimeout(()=>explode(b),2500);}
function explode(b){if(!bombs.includes(b))return;bombs=bombs.filter(x=>x!==b);const area=[{x:b.x,y:b.y}],dirs=[[0,-1],[0,1],[-1,0],[1,0]],range=2;
 for(const [dx,dy] of dirs)for(let i=1;i<=range;i++){const x=b.x+dx*i,y=b.y+dy*i;if(map[y][x]===WALL)break;area.push({x,y});if(map[y][x]===BLOCK){map[y][x]=EMPTY;break;}}
 for(const id in players){const p=players[id];if(p.isAlive&&area.some(c=>c.x===p.x&&c.y===p.y))p.isAlive=false;}
 fires.push(...area.map(c=>({...c,t:Date.now()+500})));broadcast();setTimeout(()=>{fires=fires.filter(f=>f.t>Date.now());for(const p of Object.values(players))if(p.bomb&&p.x===b.x&&p.y===b.y)p.bomb=false;broadcast();},500);
}
window.addEventListener('keydown',e=>{
 if(!myId)return;let a=null,k=e.key.toLowerCase();
 // Clavier canadien QWERTY: WASD + espace. Fleches conservees.
 if(k==='w'||e.key==='arrowup')a={type:'move',dx:0,dy:-1};
 else if(k==='s'||e.key==='arrowdown')a={type:'move',dx:0,dy:1};
 else if(k==='a'||e.key==='arrowleft')a={type:'move',dx:-1,dy:0};
 else if(k==='d'||e.key==='arrowright')a={type:'move',dx:1,dy:0};
 else if(e.code==='Space'||e.key==='enter')a={type:'bomb'};
 if(a){e.preventDefault();if(isHost)handleInput(myId,a);else if(hostConn?.open)hostConn.send(a);}
});
function draw(){ctx.clearRect(0,0,canvas.width,canvas.height);for(let y=0;y<H;y++)for(let x=0;x<W;x++){const c=map[y][x],px=x*T,py=y*T;ctx.fillStyle=c===WALL?'#555':c===BLOCK?'#b87333':'#222';ctx.fillRect(px,py,T,T);ctx.strokeStyle='#333';ctx.strokeRect(px,py,T,T);}
 for(const b of bombs){const px=b.x*T+20,py=b.y*T+20;ctx.fillStyle='#111';ctx.beginPath();ctx.arc(px,py,14,0,7);ctx.fill();ctx.fillStyle='#f00';ctx.beginPath();ctx.arc(px,py,5,0,7);ctx.fill();}
 for(const f of fires){const px=f.x*T,py=f.y*T,age=Math.max(0,f.t-Date.now());ctx.fillStyle=age%100<50?'#ff7a00':'#ffd000';ctx.fillRect(px+4,py+4,T-8,T-8);ctx.fillStyle='#fff36b';ctx.fillRect(px+12,py+12,T-24,T-24);}
 for(const [id,p] of Object.entries(players))if(p.isAlive){ctx.fillStyle=p.color;ctx.fillRect(p.x*T+5,p.y*T+5,T-10,T-10);ctx.fillStyle='#000';ctx.font='bold 12px Arial';ctx.fillText('P'+(p.slot+1),p.x*T+12,p.y*T+25);}
 requestAnimationFrame(draw);
}draw();
