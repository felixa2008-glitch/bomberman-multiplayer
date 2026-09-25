const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');

const GRID_WIDTH = 13;
const GRID_HEIGHT = 11;
const TILE_SIZE = 40;

const EMPTY = 0;
const WALL = 1;
const BLOCK = 2;
const BOMB = 3;
const FIRE = 4;

let map = [];
let players = {};
let myId = null;
let isHost = false;
let peer = null;
let hostConn = null;
let clientConns = [];

// --- LOGIQUE RÉSEAU (PEERJS) ---

function initPeer() {
    peer = new Peer();

    peer.on('open', (id) => {
        myId = id;
    });

    peer.on('connection', (conn) => {
        if (!isHost) return;
        clientConns.push(conn);

        // Assigner un joueur réseau (P2)
        const p2Id = conn.peer;
        players[p2Id] = { x: GRID_WIDTH - 2, y: GRID_HEIGHT - 2, color: '#ff4444', isAlive: true };

        conn.on('data', (data) => {
            handleClientInput(p2Id, data);
        });

        conn.on('open', () => {
            broadcastState();
        });
    });
}

function startHost() {
    isHost = true;
    initPeer();

    peer.on('open', (id) => {
        const shortCode = id.substring(0, 5);
        document.getElementById('roomCode').innerText = shortCode;
        document.getElementById('host-info').style.display = 'block';
        document.getElementById('status').innerText = "En attente d'un second joueur...";

        map = generateMap();
        players[id] = { x: 1, y: 1, color: '#00eeff', isAlive: true };
    });
}

function joinGame() {
    isHost = false;
    const code = document.getElementById('joinCodeInput').value.trim();
    if (!code) return;

    peer = new Peer();
    peer.on('open', (id) => {
        myId = id;
        // Connexion à l'hôte
        peer.listAllPeers((peers) => {
            const targetPeer = peers.find(p => p.startsWith(code));
            const hostId = targetPeer || code;
            hostConn = peer.connect(hostId);

            hostConn.on('open', () => {
                document.getElementById('status').innerText = "Connecté au réseau !";
            });

            hostConn.on('data', (data) => {
                map = data.map;
                players = data.players;
                if (data.statusText) {
                    document.getElementById('status').innerText = data.statusText;
                }
            });
        });
    });
}

function broadcastState(statusText = "") {
    if (!isHost) return;
    const state = { map, players, statusText };
    clientConns.forEach(conn => {
        if (conn.open) conn.send(state);
    });
}

// --- LOGIQUE DE JEU ---

function generateMap() {
    let newMap = [];
    for (let y = 0; y < GRID_HEIGHT; y++) {
        let row = [];
        for (let x = 0; x < GRID_WIDTH; x++) {
            if (y === 0 || y === GRID_HEIGHT - 1 || x === 0 || x === GRID_WIDTH - 1 || (x % 2 === 0 && y % 2 === 0)) {
                row.push(WALL);
            } else if (Math.random() < 0.35 && !(x <= 2 && y <= 2) && !(x >= GRID_WIDTH - 3 && y >= GRID_HEIGHT - 3)) {
                row.push(BLOCK);
            } else {
                row.push(EMPTY);
            }
        }
        newMap.push(row);
    }
    return newMap;
}

function handleClientInput(playerId, action) {
    const p = players[playerId];
    if (!p || !p.isAlive) return;

    if (action.type === 'move') {
        const targetX = p.x + action.dx;
        const targetY = p.y + action.dy;
        if (targetX >= 0 && targetX < GRID_WIDTH && targetY >= 0 && targetY < GRID_HEIGHT) {
            const cell = map[targetY][targetX];
            if (cell !== WALL && cell !== BLOCK) {
                p.x = targetX;
                p.y = targetY;
            }
        }
    } else if (action.type === 'bomb') {
        placeBomb(p);
    }
    broadcastState();
}

function placeBomb(player) {
    const gx = player.x;
    const gy = player.y;

    if (map[gy][gx] === EMPTY || map[gy][gx] === BOMB) {
        map[gy][gx] = BOMB;
        broadcastState();

        setTimeout(() => {
            explodeBomb(gx, gy);
        }, 3000);
    }
}

function explodeBomb(bx, by) {
    if (map[by][bx] === BOMB) {
        map[by][bx] = FIRE;
    }

    let blastArea = [{x: bx, y: by}];
    const dirs = [[0,-1], [0,1], [-1,0], [1,0]];
    const range = 2;

    for (let [dx, dy] of dirs) {
        for (let i = 1; i <= range; i++) {
            let tx = bx + (dx * i);
            let ty = by + (dy * i);

            if (map[ty][tx] === WALL) break;

            blastArea.push({x: tx, y: ty});

            if (map[ty][tx] === BLOCK) {
                map[ty][tx] = FIRE;
                break;
            } else {
                map[ty][tx] = FIRE;
            }
        }
    }

    // Élimination des joueurs touchés par le feu
    for (let id in players) {
        let p = players[id];
        if (p.isAlive) {
            if (blastArea.some(cell => cell.x === p.x && cell.y === p.y)) {
                p.isAlive = false;
            }
        }
    }

    broadcastState();

    // Effet visuel du feu pendant 500 ms
    setTimeout(() => {
        blastArea.forEach(cell => {
            if (map[cell.y][cell.x] === FIRE) {
                map[cell.y][cell.x] = EMPTY;
            }
        });
        broadcastState();
    }, 500);
}

// Gestion des entrées locales
window.addEventListener('keydown', (e) => {
    if (!myId) return;

    let action = null;
    if (e.key === 'z' || e.key === 'Z' || e.key === 'ArrowUp') action = { type: 'move', dx: 0, dy: -1 };
    if (e.key === 's' || e.key === 'S' || e.key === 'ArrowDown') action = { type: 'move', dx: 0, dy: 1 };
    if (e.key === 'q' || e.key === 'Q' || e.key === 'ArrowLeft') action = { type: 'move', dx: -1, dy: 0 };
    if (e.key === 'd' || e.key === 'D' || e.key === 'ArrowRight') action = { type: 'move', dx: 1, dy: 0 };
    if (e.key === ' ' || e.key === 'Enter') action = { type: 'bomb' };

    if (action) {
        if (isHost) {
            handleClientInput(myId, action);
        } else if (hostConn && hostConn.open) {
            hostConn.send(action);
        }
    }
});

// --- DESSIN CANVAS ---

function draw() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    for (let y = 0; y < map.length; y++) {
        for (let x = 0; x < map[y].length; x++) {
            const cell = map[y][x];
            const px = x * TILE_SIZE;
            const py = y * TILE_SIZE;

            if (cell === WALL) { // Murs incassables
                ctx.fillStyle = '#555555';
                ctx.fillRect(px, py, TILE_SIZE, TILE_SIZE);
            } else if (cell === BLOCK) { // Blocs destructibles
                ctx.fillStyle = '#b87333';
                ctx.fillRect(px, py, TILE_SIZE, TILE_SIZE);
            } else if (cell === BOMB) { // Bombe noire avec centre rouge et mèche
                ctx.fillStyle = '#111';
                ctx.beginPath();
                ctx.arc(px + TILE_SIZE / 2, py + TILE_SIZE / 2, TILE_SIZE / 2.8, 0, Math.PI * 2);
                ctx.fill();
                ctx.fillStyle = '#ff0000';
                ctx.beginPath();
                ctx.arc(px + TILE_SIZE / 2, py + TILE_SIZE / 2, TILE_SIZE / 6, 0, Math.PI * 2);
                ctx.fill();
            } else if (cell === FIRE) { // Feu/Flammes
                ctx.fillStyle = '#ff6600';
                ctx.fillRect(px, py, TILE_SIZE, TILE_SIZE);
                ctx.fillStyle = '#ffff00';
                ctx.fillRect(px + 8, py + 8, TILE_SIZE - 16, TILE_SIZE - 16);
            }
        }
    }

    // Dessin des joueurs
    for (let id in players) {
        let p = players[id];
        if (p.isAlive) {
            ctx.fillStyle = p.color;
            ctx.fillRect(p.x * TILE_SIZE + 5, p.y * TILE_SIZE + 5, TILE_SIZE - 10, TILE_SIZE - 10);
        }
    }

    requestAnimationFrame(draw);
}

draw();
