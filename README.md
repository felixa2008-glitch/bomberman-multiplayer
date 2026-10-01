# Bomberman multijoueur — correctif P2P

## Utilisation

1. Servez ce dossier depuis un site HTTPS (ou `localhost`) dans un navigateur récent.
2. Le host clique **CREER UNE PARTIE** et partage le code affiché, sans le modifier.
3. Les autres joueurs collent ce code exact dans **REJOINDRE**.
4. Le host clique **START** lorsque tout le monde est dans le lobby. Quatre joueurs au maximum sont pris en charge.

Le jeu utilise PeerJS uniquement pour la signalisation; les commandes et l’état du jeu passent ensuite directement entre le host et chaque joueur par WebRTC. Le host reste autoritaire.

## Changements inclus

- Le code de salon est maintenant conservé exactement tel qu’il a été partagé (aucune minuscule ni préfixe inventé).
- Les connexions déjà ouvertes sont acceptées correctement, les connexions en double et les lobbys pleins sont refusés avec une raison claire, et les échecs/expirations permettent de réessayer.
- Les joueurs qui quittent libèrent réellement leur emplacement; les slots ne peuvent plus se chevaucher.
- Le lobby n’écrase plus son propre HTML et le statut de chaque joueur se met à jour correctement.
- Les murs extérieurs sont préservés, les joueurs ne peuvent pas se traverser et une bombe appartient à son vrai créateur même si des joueurs partent.
- Les erreurs PeerJS/WebRTC ont des messages exploitables au lieu d’un vague échec P2P.

## Réseaux où le P2P échoue encore

Certains réseaux d’entreprise, écoles ou réseaux mobiles utilisent un NAT symétrique. Aucun correctif frontend ne peut établir une connexion directe dans ce cas : il faut configurer un relais TURN. Vous pouvez aussi remplacer le service de signalisation public par un PeerServer privé.

Ajoutez ce bloc dans `index.html`, juste avant `<script src="game.js"></script>`, avec vos propres valeurs :

```html
<script>
window.BOMBERMAN_PEER_OPTIONS = {
  host: 'peer.example.com',
  port: 443,
  path: '/peerjs',
  secure: true,
  config: {
    iceServers: [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'turn:turn.example.com:3478', username: 'TURN_USERNAME', credential: 'TURN_PASSWORD' }
    ]
  }
};
</script>
```

Le host et tous les joueurs doivent utiliser la même configuration PeerServer. Ne placez pas de secrets TURN permanents dans un site statique public : en production, fournissez plutôt des identifiants temporaires depuis un backend.
