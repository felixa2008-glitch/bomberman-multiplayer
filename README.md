# Bomberman Multijoueur

PeerJS reste utilise pour le multijoueur et l'hote reste autoritaire.

## Clavier canadien QWERTY
- WASD ou fleches : deplacement case par case
- ESPACE : bombe
- Entree : bombe

## Connexion
1. L'hote clique Creer une partie.
2. Il donne le **code complet** affiche a ses amis.
3. Les amis collent ce code dans Rejoindre.
4. Maximum 4 joueurs.

Le code complet est utilise comme Peer ID : il n'y a plus de recherche `listAllPeers`, qui empechait la connexion avec le petit code de 5 caracteres.
