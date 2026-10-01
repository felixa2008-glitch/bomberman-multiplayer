const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');
const W = 13, H = 11, T = 40, EMPTY = 0, WALL = 1, BLOCK = 2;
const colors = ['#00eeff', '#ff4444', '#55ff55', '#ff55ff'];
const spawns = [{ x: 1, y: 1 }, { x: W - 2, y: H - 2 }, { x: W - 2, y: 1 }, { x: 1, y: H - 2 }];

/* Set window.BOMBERMAN_PEER_OPTIONS before loading this file to use a private PeerServer or TURN service. */
const PEER_OPTIONS = { debug: 1, ...(window.BOMBERMAN_PEER_OPTIONS || {}) };
let map = [], players = {}, myId = null, isHost = false, peer = null;
let hostConn = null, clientConns = [], bombs = [], fires = [], gameStarted = false;
let joinTimer = null;

function newRoomId() {
  const bytes = new Uint8Array(10);
  crypto.getRandomValues(bytes);
  return 'bm-' + Array.from(bytes, n => n.toString(36).padStart(2, '0')).join('');
}
function status(message) {
  document.getElementById('status').textContent = message;
  const gameStatus = document.getElementById('gameStatus');
  if (gameStatus) gameStatus.textContent = message;
}
function setControlsBusy(busy) {
  document.getElementById('hostBtn').disabled = busy;
  document.getElementById('joinBtn').disabled = busy;
  document.getElementById('joinCodeInput').disabled = busy;
}
function updateView() {
  document.getElementById('menu').style.display = gameStarted ? 'none' : '';
  document.getElementById('gameArea').style.display = gameStarted ? 'block' : 'none';
}
function updateLobby() {
  const list = document.getElementById('lobby-list');
  list.replaceChildren();
  const ordered = Object.values(players).sort((a, b) => a.slot - b.slot);
  if (!ordered.length) {
    const waiting = document.createElement('div');
    waiting.className = 'waiting'; waiting.textContent = 'En attente de joueurs...'; list.append(waiting);
  }
  for (const player of ordered) {
    const row = document.createElement('div');
    row.textContent = `P${player.slot + 1}${player.id === myId ? (isHost ? ' (Host)' : ' (Vous)') : ''}${player.isAlive === false ? ' — elimine' : ''}`;
    list.append(row);
  }
  if (gameStarted) {
    const running = document.createElement('div');
    running.className = 'waiting'; running.textContent = 'Partie en cours'; list.append(running);
  } else if (isHost) {
    const start = document.createElement('button');
    start.type = 'button'; start.textContent = 'START'; start.onclick = startGame; list.append(start);
  } else if (hostConn?.open) {
    const waiting = document.createElement('div');
    waiting.className = 'waiting'; waiting.textContent = 'En attente du host...'; list.append(waiting);
  }
  const gameList = document.getElementById('game-player-list');
  if (gameList) gameList.textContent = ordered.map(p => `P${p.slot + 1}${p.isAlive ? '' : ' OUT'}`).join(' // ') || 'En attente';
  updateView();
}
function lobbyData() {
  return { type: 'lobby', players: Object.values(players).map(({ id, slot, isAlive }) => ({ id, slot, isAlive })), started: gameStarted, map };
}
function state() { return { type: 'state', map, players, bombs, fires, started: gameStarted }; }
function safeSend(connection, message) {
  if (!connection?.open) return false;
  try { connection.send(message); return true; } catch (_) { return false; }
}
function broadcastLobby() {
  if (!isHost) return;
  const message = lobbyData(); clientConns = clientConns.filter(connection => safeSend(connection, message));
}
function broadcast() {
  if (!isHost) return;
  const message = state(); clientConns = clientConns.filter(connection => safeSend(connection, message));
}
function generateMap() {
  const result = [];
  for (let y = 0; y < H; y++) {
    result[y] = [];
    for (let x = 0; x < W; x++) {
      result[y][x] = (y === 0 || y === H - 1 || x === 0 || x === W - 1 || (x % 2 === 0 && y % 2 === 0)) ? WALL : (Math.random() < 0.35 ? BLOCK : EMPTY);
    }
  }
  // Clear escape routes without ever punching holes through the outer wall.
  for (const spawn of spawns) for (const [dx, dy] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]]) {
    const x = spawn.x + dx, y = spawn.y + dy;
    if (x > 0 && x < W - 1 && y > 0 && y < H - 1) result[y][x] = EMPTY;
  }
  return result;
}
function bombAt(x, y) { return bombs.find(bomb => bomb.x === x && bomb.y === y); }
function fireAt(x, y) { return fires.some(fire => fire.x === x && fire.y === y && fire.t > Date.now()); }
function playerAt(x, y, ignoredId) { return Object.values(players).some(player => player.id !== ignoredId && player.isAlive && player.x === x && player.y === y); }
function canMove(x, y, id) { return x >= 0 && x < W && y >= 0 && y < H && map[y]?.[x] === EMPTY && !bombAt(x, y) && !playerAt(x, y, id); }
function nextSlot() {
  const used = new Set(Object.values(players).map(player => player.slot));
  return [0, 1, 2, 3].find(slot => !used.has(slot));
}
function peerErrorMessage(error) {
  const type = error?.type || 'inconnue';
  const messages = {
    'peer-unavailable': 'Cette partie est introuvable. Verifie le code complet et que le host est encore en ligne.',
    network: 'Le serveur de signalisation est inaccessible. Verifie la connexion ou la configuration PeerServer.',
    webrtc: 'La connexion WebRTC a echoue. Ce reseau peut necessiter un serveur TURN.',
    'browser-incompatible': 'Ce navigateur ne prend pas en charge WebRTC.',
    'unavailable-id': 'Ce code de partie est deja utilise. Cree une nouvelle partie.',
    'socket-error': 'La connexion de signalisation a echoue.',
    'socket-closed': 'La connexion de signalisation a ete fermee.'
  };
  return messages[type] || `Erreur reseau: ${type}`;
}
function destroyPeer() {
  clearTimeout(joinTimer); joinTimer = null;
  if (peer && !peer.destroyed) peer.destroy();
  peer = null; hostConn = null; clientConns = []; setControlsBusy(false);
}
function resetLocalGame() {
  map = []; players = {}; bombs = []; fires = []; gameStarted = false; myId = null; isHost = false;
  document.getElementById('host-info').style.display = 'none';
  updateLobby();
}
function bindPeerEvents() {
  peer.on('disconnected', () => {
    status('Signalisation perdue. Tentative de reconnexion...');
    if (!peer.destroyed) peer.reconnect();
  });
  peer.on('error', error => {
    status(peerErrorMessage(error));
    if ((!isHost && !hostConn?.open) || (isHost && !gameStarted)) {
      destroyPeer();
      resetLocalGame();
    }
  });
  peer.on('close', () => { if (!gameStarted) setControlsBusy(false); });
}
function setupHost() {
  map = generateMap();
  players = { [myId]: { id: myId, x: spawns[0].x, y: spawns[0].y, color: colors[0], isAlive: true, slot: 0, bomb: false } };
  document.getElementById('roomCode').textContent = myId;
  document.getElementById('host-info').style.display = 'block';
  status('Partie creee. Donne le code complet a tes amis.'); updateLobby();
}
function startHost() {
  if (peer) return;
  if (typeof Peer !== 'function') return status('PeerJS ne s’est pas charge. Verifie la connexion internet et recharge la page.');
  isHost = true; setControlsBusy(true);
  try { peer = new Peer(newRoomId(), PEER_OPTIONS); } catch (error) { isHost = false; setControlsBusy(false); return status(peerErrorMessage(error)); }
  bindPeerEvents();
  peer.on('open', id => { myId = id; setupHost(); });
  peer.on('connection', acceptClient);
}
function acceptClient(connection) {
  let accepted = false;
  const playerId = connection.peer;
  const removeClient = () => {
    if (!accepted) return;
    accepted = false; clientConns = clientConns.filter(conn => conn !== connection); delete players[playerId];
    broadcastLobby(); broadcast(); updateLobby();
  };
  const reject = reason => { safeSend(connection, { type: 'rejected', reason }); connection.close(); };
  const accept = () => {
    if (!isHost || gameStarted) return reject('La partie a deja commence.');
    if (players[playerId] || clientConns.some(conn => conn.peer === playerId)) return reject('Cette connexion existe deja.');
    const slot = nextSlot(); if (slot === undefined) return reject('La partie est complete.');
    accepted = true;
    players[playerId] = { id: playerId, x: spawns[slot].x, y: spawns[slot].y, color: colors[slot], isAlive: true, slot, bomb: false };
    clientConns.push(connection); safeSend(connection, lobbyData()); safeSend(connection, state()); broadcastLobby(); updateLobby();
  };
  connection.on('data', data => {
    if (!accepted || !data || typeof data !== 'object') return;
    if (data.type === 'join') { safeSend(connection, lobbyData()); safeSend(connection, state()); return; }
    handleInput(playerId, data);
  });
  connection.on('close', removeClient);
  connection.on('error', error => { status(`Connexion d’un joueur perdue: ${peerErrorMessage(error)}`); removeClient(); });
  // PeerJS can emit `connection` after the DataConnection is already open.
  if (connection.open) accept(); else connection.once('open', accept);
}
function applyLobby(data) {
  if (Array.isArray(data.map) && data.map.length) map = data.map;
  players = {};
  for (const player of data.players || []) {
    const spawn = spawns[player.slot];
    if (!spawn || !Number.isInteger(player.slot)) continue;
    players[player.id] = { id: player.id, x: spawn.x, y: spawn.y, color: colors[player.slot], isAlive: player.isAlive !== false, slot: player.slot, bomb: false };
  }
  gameStarted = Boolean(data.started);
  if (gameStarted) status('LIVE');
  updateLobby();
}
function applyState(data) {
  if (Array.isArray(data.map) && data.map.length) map = data.map;
  if (data.players && typeof data.players === 'object') players = data.players;
  bombs = Array.isArray(data.bombs) ? data.bombs : []; fires = Array.isArray(data.fires) ? data.fires : [];
  gameStarted = Boolean(data.started);
  if (gameStarted) status('LIVE');
  updateLobby();
}
function joinGame() {
  if (peer) return;
  if (typeof Peer !== 'function') return status('PeerJS ne s’est pas charge. Verifie la connexion internet et recharge la page.');
  const roomCode = document.getElementById('joinCodeInput').value.trim();
  if (!roomCode) return status('Entre le code complet de la partie.');
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(roomCode)) return status('Le code contient des caracteres non valides. Copie le code complet du host.');
  isHost = false; setControlsBusy(true); status('Connexion a la partie...');
  try { peer = new Peer(PEER_OPTIONS); } catch (error) { setControlsBusy(false); return status(peerErrorMessage(error)); }
  bindPeerEvents();
  peer.on('open', id => {
    myId = id;
    hostConn = peer.connect(roomCode, { label: 'bomberman-game', reliable: false, serialization: 'json' });
    hostConn.on('open', () => { clearTimeout(joinTimer); joinTimer = null; status('Connecte ! En attente du START...'); safeSend(hostConn, { type: 'join' }); });
    hostConn.on('data', data => {
      if (!data || typeof data !== 'object') return;
      if (data.type === 'lobby') applyLobby(data);
      else if (data.type === 'state') applyState(data);
      else if (data.type === 'rejected') { status(data.reason || 'Le host a refuse la connexion.'); destroyPeer(); }
    });
    hostConn.on('close', () => {
      if (joinTimer) return; // The timeout reports a connection that never opened.
      resetLocalGame(); status('Connexion avec le host perdue.'); destroyPeer();
    });
    hostConn.on('error', error => { resetLocalGame(); status(`Connexion avec le host impossible: ${peerErrorMessage(error)}`); destroyPeer(); });
    joinTimer = setTimeout(() => {
      if (!hostConn?.open) { resetLocalGame(); status('La connexion a expire. Le host est peut-etre hors ligne ou ce reseau necessite TURN.'); destroyPeer(); }
    }, 12000);
  });
}
function startGame() {
  if (!isHost || gameStarted) return;
  gameStarted = true; status('LIVE'); updateLobby(); broadcastLobby(); broadcast();
}
function handleInput(id, action) {
  if (!isHost || !gameStarted || !action || typeof action !== 'object') return;
  const player = players[id]; if (!player?.isAlive) return;
  if (action.type === 'move') {
    const { dx, dy } = action;
    if (!Number.isInteger(dx) || !Number.isInteger(dy) || Math.abs(dx) + Math.abs(dy) !== 1) return;
    const x = player.x + dx, y = player.y + dy;
    if (canMove(x, y, id)) { player.x = x; player.y = y; if (fireAt(x, y)) player.isAlive = false; }
  } else if (action.type === 'bomb') placeBomb(player); else return;
  updateLobby(); broadcast();
}
function placeBomb(player) {
  if (bombAt(player.x, player.y) || player.bomb) return;
  player.bomb = true;
  const bomb = { x: player.x, y: player.y, ownerId: player.id };
  bombs.push(bomb); broadcast(); setTimeout(() => explode(bomb), 2500);
}
function explode(bomb) {
  if (!bombs.includes(bomb)) return;
  bombs = bombs.filter(current => current !== bomb);
  const owner = players[bomb.ownerId]; if (owner) owner.bomb = false;
  const area = [{ x: bomb.x, y: bomb.y }];
  for (const [dx, dy] of [[0, -1], [0, 1], [-1, 0], [1, 0]]) for (let distance = 1; distance <= 2; distance++) {
    const x = bomb.x + dx * distance, y = bomb.y + dy * distance;
    if (!map[y] || map[y][x] === WALL) break;
    area.push({ x, y });
    if (map[y][x] === BLOCK) { map[y][x] = EMPTY; break; }
  }
  for (const player of Object.values(players)) if (player.isAlive && area.some(cell => cell.x === player.x && cell.y === player.y)) player.isAlive = false;
  fires.push(...area.map(cell => ({ ...cell, t: Date.now() + 650 })));
  for (const otherBomb of [...bombs]) if (area.some(cell => cell.x === otherBomb.x && cell.y === otherBomb.y)) explode(otherBomb);
  updateLobby(); broadcast();
  setTimeout(() => { fires = fires.filter(fire => fire.t > Date.now()); broadcast(); }, 650);
}
window.addEventListener('keydown', event => {
  if (!gameStarted || !myId || event.repeat) return;
  const key = event.key.toLowerCase(); let action = null;
  if (key === 'w' || event.key === 'ArrowUp') action = { type: 'move', dx: 0, dy: -1 };
  else if (key === 's' || event.key === 'ArrowDown') action = { type: 'move', dx: 0, dy: 1 };
  else if (key === 'a' || event.key === 'ArrowLeft') action = { type: 'move', dx: -1, dy: 0 };
  else if (key === 'd' || event.key === 'ArrowRight') action = { type: 'move', dx: 1, dy: 0 };
  else if (event.code === 'Space' || event.key === 'Enter') action = { type: 'bomb' };
  if (!action) return;
  event.preventDefault(); if (isHost) handleInput(myId, action); else if (hostConn?.open) safeSend(hostConn, action);
});
function draw() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  if (!map.length) { ctx.fillStyle = '#fff'; ctx.font = '24px Arial'; ctx.fillText('Lobby - en attente...', 140, 220); requestAnimationFrame(draw); return; }
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const cell = map[y][x], px = x * T, py = y * T;
    ctx.fillStyle = cell === WALL ? '#555' : cell === BLOCK ? '#b87333' : '#222'; ctx.fillRect(px, py, T, T);
    ctx.strokeStyle = '#333'; ctx.strokeRect(px, py, T, T);
  }
  for (const bomb of bombs) {
    ctx.fillStyle = '#111'; ctx.beginPath(); ctx.arc(bomb.x * T + 20, bomb.y * T + 20, 14, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#f00'; ctx.beginPath(); ctx.arc(bomb.x * T + 20, bomb.y * T + 20, 5, 0, Math.PI * 2); ctx.fill();
  }
  for (const fire of fires) {
    const pulse = Math.sin((fire.t - Date.now()) / 70);
    ctx.fillStyle = pulse > 0 ? '#ff7a00' : '#ffd000'; ctx.fillRect(fire.x * T + 3, fire.y * T + 3, T - 6, T - 6);
    ctx.fillStyle = '#fff36b'; ctx.fillRect(fire.x * T + 11, fire.y * T + 11, T - 22, T - 22);
  }
  for (const player of Object.values(players)) if (player.isAlive) {
    ctx.fillStyle = player.color; ctx.fillRect(player.x * T + 5, player.y * T + 5, T - 10, T - 10);
    ctx.fillStyle = '#000'; ctx.font = 'bold 12px Arial'; ctx.fillText(`P${player.slot + 1}`, player.x * T + 12, player.y * T + 25);
  }
  requestAnimationFrame(draw);
}
draw();
updateLobby();
