const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');

const GRID_WIDTH = 13, GRID_HEIGHT = 11, TILE_SIZE = 40;
const EMPTY = 0, WALL = 1, BLOCK = 2;
const MAX_PLAYERS = 4, BOMB_TIME = 3000, EXPLOSION_TIME = 700;
const SPAWNS = [
    {x:1,y:1,color:'#00eeff'}, {x:11,y:1,color:'#ff4444'},
    {x:1,y:9,color:'#66ff44'}, {x:11,y:9,color:'#ff66ff'}
];

let map = [], players = {}, bombs = [], explosions = [];
let myId = null, isHost = false, peer = null, hostConn = null, clientConns = [];
let nextBombId = 1, nextExplosionId = 1;
const localExplosionStart = {};
let lastMove = 0;

function initPeer() {
    peer = new Peer();
    peer.on('open', id => { myId = id; });
    peer.on('connection', conn => {
        if (!isHost) return;
        if (Object.keys(players).length >= MAX_PLAYERS) {
            conn.on('open', () => conn.send({full:true}));
            return;
        }
        clientConns.push(conn);
        const slot = Object.keys(players).length;
        const s = SPAWNS[slot];
        players[conn.peer] = {x:s.x,y:s.y,color:s.color,isAlive:true,slot};

        conn.on('data', data => handleClientInput(conn.peer, data));
        conn.on('open', () => broadcastState("Joueur " + (slot + 1) + " connecte."));
        conn.on('close', () => {
            delete players[conn.peer];
            clientConns = clientConns.filter(c => c !== conn);
            broadcastState();
        });
    });
}

function startHost() {
    isHost = true;
    initPeer();
    peer.on('open', id => {
        myId = id;
        document.getElementById('roomCode').innerText = id.substring(0,5);
        document.getElementById('host-info').style.display = 'block';
        document.getElementById('status').innerText = "En attente de joueurs...";
        map = generateMap();
        const s = SPAWNS[0];
        players[id] = {x:s.x,y:s.y,color:s.color,isAlive:true,slot:0};
    });
}

function joinGame() {
    isHost = false;
    const code = document.getElementById('joinCodeInput').value.trim();
    if (!code) return;
    peer = new Peer();
    peer.on('open', id => {
        myId = id;
        peer.listAllPeers(peers => {
            const hostId = peers.find(p => p.startsWith(code)) || code;
            hostConn = peer.connect(hostId);
            hostConn.on('open', () => {
                document.getElementById('status').innerText = "Connecte au reseau !";
            });
            hostConn.on('data', data => {
                if (data.full) {
                    document.getElementById('status').innerText = "Partie pleine (4 joueurs max).";
                    return;
                }
                if (data.map) map = data.map;
                if (data.players) players = data.players;
                if (data.bombs) bombs = data.bombs;
                if (data.explosions) {
                    for (const e of data.explosions) {
                        if (!localExplosionStart[e.id]) localExplosionStart[e.id] = performance.now();
                    }
                    explosions = data.explosions;
                }
                if (data.statusText) document.getElementById('status').innerText = data.statusText;
            });
        });
    });
}

function broadcastState(statusText = "") {
    if (!isHost) return;
    const state = {map,players,bombs,explosions,statusText};
    clientConns = clientConns.filter(c => c.open);
    clientConns.forEach(c => c.send(state));
}

function generateMap() {
    const safe = new Set();
    SPAWNS.forEach(s => {
        for (let dy=-1; dy<=1; dy++) for (let dx=-1; dx<=1; dx++) safe.add((s.x+dx)+','+(s.y+dy));
    });
    const m = [];
    for (let y=0; y<GRID_HEIGHT; y++) {
        const row=[];
        for (let x=0; x<GRID_WIDTH; x++) {
            if (y===0 || y===GRID_HEIGHT-1 || x===0 || x===GRID_WIDTH-1 || (x%2===0 && y%2===0)) row.push(WALL);
            else if (!safe.has(x+','+y) && Math.random()<0.35) row.push(BLOCK);
            else row.push(EMPTY);
        }
        m.push(row);
    }
    return m;
}

function bombAt(x,y) { return bombs.find(b => b.x===x && b.y===y); }

function canMove(p, dx, dy) {
    const x=p.x+dx, y=p.y+dy;
    if (x<0 || x>=GRID_WIDTH || y<0 || y>=GRID_HEIGHT) return false;
    if (map[y][x]===WALL || map[y][x]===BLOCK) return false;
    // Une bombe bloque l'entree, mais le joueur peut sortir de celle qu'il vient de poser.
    if (bombAt(x,y)) return false;
    return true;
}

function movePlayer(p, dx, dy) {
    if (canMove(p,dx,dy)) { p.x += dx; p.y += dy; }
}

function handleClientInput(playerId, action) {
    const p=players[playerId];
    if (!p || !p.isAlive || !action) return;
    if (action.type==='move') movePlayer(p,action.dx,action.dy);
    else if (action.type==='bomb') placeBomb(p,playerId);
    broadcastState();
}

function placeBomb(player, ownerId) {
    if (bombAt(player.x,player.y)) return;
    const b={id:nextBombId++,x:player.x,y:player.y,owner:ownerId};
    bombs.push(b);
    broadcastState();
    setTimeout(() => explodeBomb(b.id), BOMB_TIME);
}

function explodeBomb(id) {
    const b=bombs.find(v=>v.id===id);
    if (!b) return;
    bombs=bombs.filter(v=>v.id!==id);
    const cells=[{x:b.x,y:b.y}];
    const dirs=[[0,-1],[0,1],[-1,0],[1,0]];
    const range=2;

    for (const [dx,dy] of dirs) {
        for (let i=1;i<=range;i++) {
            const x=b.x+dx*i, y=b.y+dy*i;
            if (map[y][x]===WALL) break;
            cells.push({x,y});
            const other=bombAt(x,y);
            if (other) { setTimeout(()=>explodeBomb(other.id),50); break; }
            if (map[y][x]===BLOCK) { map[y][x]=EMPTY; break; }
        }
    }

    for (const id2 in players) {
        const p=players[id2];
        if (p.isAlive && cells.some(c=>c.x===p.x && c.y===p.y)) p.isAlive=false;
    }

    const e={id:nextExplosionId++,cells};
    explosions.push(e);
    localExplosionStart[e.id]=performance.now();
    broadcastState();

    setTimeout(()=>{
        explosions=explosions.filter(v=>v.id!==e.id);
        delete localExplosionStart[e.id];
        broadcastState();
    },EXPLOSION_TIME);
}

window.addEventListener('keydown', e => {
    if (!myId || e.repeat) return;
    let action=null;
    if (['z','Z','ArrowUp'].includes(e.key)) action={type:'move',dx:0,dy:-1};
    else if (['s','S','ArrowDown'].includes(e.key)) action={type:'move',dx:0,dy:1};
    else if (['q','Q','ArrowLeft'].includes(e.key)) action={type:'move',dx:-1,dy:0};
    else if (['d','D','ArrowRight'].includes(e.key)) action={type:'move',dx:1,dy:0};
    else if (e.key===' ' || e.key==='Enter') action={type:'bomb'};
    if (!action) return;
    e.preventDefault();
    const now=performance.now();
    if (action.type==='move' && now-lastMove<90) return;
    if (action.type==='move') lastMove=now;
    if (isHost) handleClientInput(myId,action);
    else if (hostConn && hostConn.open) hostConn.send(action);
});

function drawBomb(b,t) {
    const px=b.x*TILE_SIZE+20, py=b.y*TILE_SIZE+20;
    const pulse=1+Math.sin(t/120)*0.08;
    ctx.fillStyle='#111'; ctx.beginPath(); ctx.arc(px,py,14*pulse,0,Math.PI*2); ctx.fill();
    ctx.fillStyle='#f22'; ctx.beginPath(); ctx.arc(px,py,5,0,Math.PI*2); ctx.fill();
    ctx.strokeStyle='#ffb000'; ctx.lineWidth=3; ctx.beginPath(); ctx.moveTo(px+8,py-10); ctx.lineTo(px+13,py-16); ctx.stroke();
}

function drawExplosion(e,t) {
    const start=localExplosionStart[e.id] ?? t;
    const p=Math.min(1,(t-start)/EXPLOSION_TIME);
    const alpha=1-p;
    for (const c of e.cells) {
        const px=c.x*TILE_SIZE, py=c.y*TILE_SIZE;
        const r=6+Math.sin(p*Math.PI)*15;
        ctx.globalAlpha=alpha;
        ctx.fillStyle='#ff3b00'; ctx.fillRect(px,py,TILE_SIZE,TILE_SIZE);
        ctx.fillStyle='#ffd400'; ctx.beginPath(); ctx.arc(px+20,py+20,r,0,Math.PI*2); ctx.fill();
        ctx.fillStyle='#fff3a0'; ctx.beginPath(); ctx.arc(px+20,py+20,r*0.45,0,Math.PI*2); ctx.fill();
    }
    ctx.globalAlpha=1;
}

function draw() {
    const t=performance.now();
    ctx.clearRect(0,0,canvas.width,canvas.height);
    for(let y=0;y<GRID_HEIGHT;y++) for(let x=0;x<GRID_WIDTH;x++) {
        const cell=map[y]?.[x] ?? EMPTY, px=x*TILE_SIZE, py=y*TILE_SIZE;
        ctx.fillStyle='#222'; ctx.fillRect(px,py,TILE_SIZE,TILE_SIZE);
        if(cell===WALL){ctx.fillStyle='#555';ctx.fillRect(px,py,TILE_SIZE,TILE_SIZE);}
        else if(cell===BLOCK){ctx.fillStyle='#b87333';ctx.fillRect(px+2,py+2,TILE_SIZE-4,TILE_SIZE-4);}
        ctx.strokeStyle='rgba(255,255,255,.035)'; ctx.strokeRect(px,py,TILE_SIZE,TILE_SIZE);
    }
    bombs.forEach(b=>drawBomb(b,t));
    for(const id in players){
        const p=players[id]; if(!p.isAlive) continue;
        ctx.fillStyle=p.color; ctx.fillRect(p.x*TILE_SIZE+5,p.y*TILE_SIZE+5,TILE_SIZE-10,TILE_SIZE-10);
        ctx.fillStyle='#111'; ctx.font='11px Arial'; ctx.fillText('P'+(p.slot+1),p.x*TILE_SIZE+12,p.y*TILE_SIZE+23);
    }
    explosions.forEach(e=>drawExplosion(e,t));
    requestAnimationFrame(draw);
}

draw();
