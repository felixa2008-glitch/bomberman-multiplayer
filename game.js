const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');

const GRID_WIDTH = 13;
const GRID_HEIGHT = 11;
const TILE_SIZE = 40;

const EMPTY = 0;
const WALL = 1;
const BLOCK = 2;
const BOMB = 3;

let map = [];
let players = {};

function generateMap() {
    let newMap = [];
    for (let y = 0; y < GRID_HEIGHT; y++) {
        let row = [];
        for (let x = 0; x < GRID_WIDTH; x++) {
            // Piliers et bordures
            if (y === 0 || y === GRID_HEIGHT - 1 || x === 0 || x === GRID_WIDTH - 1 || (x % 2 === 0 && y % 2 === 0)) {
                row.push(WALL);
            } 
            // Blocs destructibles (avec zone de départ sécurisée pour P1 et P2)
            else if (Math.random() < 0.35 && !(x <= 2 && y <= 2) && !(x >= GRID_WIDTH - 3 && y >= GRID_HEIGHT - 3)) {
                row.push(BLOCK);
            } 
            else {
                row.push(EMPTY);
            }
        }
        newMap.push(row);
    }
    return newMap;
}

function initGame() {
    map = generateMap();
    document.getElementById('status').innerText = "";
    
    players = {
        p1: { x: 1, y: 1, color: '#00eeff', isAlive: true, name: "Joueur 1 (Bleu)" },
        p2: { x: GRID_WIDTH - 2, y: GRID_HEIGHT - 2, color: '#ff4444', isAlive: true, name: "Joueur 2 (Rouge)" }
    };
}

function movePlayer(player, dx, dy) {
    if (!player.isAlive) return;

    const targetX = player.x + dx;
    const targetY = player.y + dy;

    // Déplacement case par case : Murs (1) et Blocs (2) bloquent.
    // Les bombes (3) et les cases vides (0) sont entièrement traversables.
    if (targetX >= 0 && targetX < GRID_WIDTH && targetY >= 0 && targetY < GRID_HEIGHT) {
        const cell = map[targetY][targetX];
        if (cell !== WALL && cell !== BLOCK) {
            player.x = targetX;
            player.y = targetY;
        }
    }
}

function placeBomb(player) {
    if (!player.isAlive) return;

    const gx = player.x;
    const gy = player.y;

    if (map[gy][gx] === EMPTY || map[gy][gx] === BOMB) {
        map[gy][gx] = BOMB;

        // Détonation après 3 secondes
        setTimeout(() => {
            explodeBomb(gx, gy);
        }, 3000);
    }
}

function explodeBomb(bx, by) {
    if (map[by][bx] === BOMB) {
        map[by][bx] = EMPTY;
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
                map[ty][tx] = EMPTY;
                break;
            }
        }
    }

    // Détection des éliminations
    for (let key in players) {
        let p = players[key];
        if (p.isAlive) {
            let hit = blastArea.some(cell => cell.x === p.x && cell.y === p.y);
            if (hit) {
                p.isAlive = false;
                checkWinner();
            }
        }
    }
}

function checkWinner() {
    const statusEl = document.getElementById('status');
    if (!players.p1.isAlive && !players.p2.isAlive) {
        statusEl.innerText = "Égalité ! Les deux joueurs sont éliminés.";
    } else if (!players.p1.isAlive) {
        statusEl.innerText = "Victoire du Joueur 2 (Rouge) !";
    } else if (!players.p2.isAlive) {
        statusEl.innerText = "Victoire du Joueur 1 (Bleu) !";
    }
}

// Gestion des entrées clavier
window.addEventListener('keydown', (e) => {
    // Joueur 1 (ZQSD + Espace)
    if (e.key === 'z' || e.key === 'Z') movePlayer(players.p1, 0, -1);
    if (e.key === 's' || e.key === 'S') movePlayer(players.p1, 0, 1);
    if (e.key === 'q' || e.key === 'Q') movePlayer(players.p1, -1, 0);
    if (e.key === 'd' || e.key === 'D') movePlayer(players.p1, 1, 0);
    if (e.key === ' ') placeBomb(players.p1);

    // Joueur 2 (Flèches + Entrée)
    if (e.key === 'ArrowUp') movePlayer(players.p2, 0, -1);
    if (e.key === 'ArrowDown') movePlayer(players.p2, 0, 1);
    if (e.key === 'ArrowLeft') movePlayer(players.p2, -1, 0);
    if (e.key === 'ArrowRight') movePlayer(players.p2, 1, 0);
    if (e.key === 'Enter') placeBomb(players.p2);
});

// Boucle de rendu Canvas
function draw() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Dessin de la carte
    for (let y = 0; y < map.length; y++) {
        for (let x = 0; x < map[y].length; x++) {
            const cell = map[y][x];
            if (cell === WALL) {
                ctx.fillStyle = '#666666';
                ctx.fillRect(x * TILE_SIZE, y * TILE_SIZE, TILE_SIZE, TILE_SIZE);
            } else if (cell === BLOCK) {
                ctx.fillStyle = '#b87333';
                ctx.fillRect(x * TILE_SIZE, y * TILE_SIZE, TILE_SIZE, TILE_SIZE);
            } else if (cell === BOMB) {
                ctx.fillStyle = '#ff0000';
                ctx.beginPath();
                ctx.arc(x * TILE_SIZE + TILE_SIZE / 2, y * TILE_SIZE + TILE_SIZE / 2, TILE_SIZE / 3, 0, Math.PI * 2);
                ctx.fill();
            }
        }
    }

    // Dessin des joueurs
    for (let key in players) {
        let p = players[key];
        if (p.isAlive) {
            ctx.fillStyle = p.color;
            ctx.fillRect(p.x * TILE_SIZE + 5, p.y * TILE_SIZE + 5, TILE_SIZE - 10, TILE_SIZE - 10);
        }
    }

    requestAnimationFrame(draw);
}

// Initialisation au chargement
initGame();
draw();