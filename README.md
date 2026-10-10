# Security Scanner

Audit de sécurité maison pour mes propres sites et dépôts. Il tourne sur mon homelab.

On lui donne un dépôt GitHub, une URL et, si besoin, des identifiants de test. Il lance trois scanners open source, normalise les résultats et fait rédiger le rapport par un modèle local. Chaque jeudi à 20 h, il audite tout et m'envoie le rapport sur Telegram.

Le code et les findings ne quittent jamais la machine.

## Ce qui est scanné

| Surface | Outil |
|---|---|
| Dépendances, secrets, mauvaises configurations | Trivy |
| Code, analyse statique | Semgrep, règles `p/default` |
| Site en ligne | Nuclei, sans templates intrusifs ni DoS, 30 requêtes/s |
| Rapport | Ollama, en local |

## Garde-fous

Un outil de sécurité troué serait ironique.

1. **Allowlist des propriétaires GitHub.** Hors de la liste, aucun dépôt n'est cloné.
2. **Allowlist des domaines.** Hors de la liste, aucun site n'est scanné. Revérifiée à chaque scan.
3. **Scanners en sous-processus, sans shell.** Ils reçoivent un environnement minimal et ne voient aucun secret de l'application.
4. **Jeton GitHub par `GIT_ASKPASS`.** Il n'apparaît ni dans l'URL ni sur la ligne de commande.
5. **Identifiants de test chiffrés en base**, AES-256-GCM. Passés à Nuclei par un fichier `0600` limité au domaine, supprimé après le scan.
6. **Rendu sans `v-html`.** Les findings viennent de sources externes.
7. **Telegram en texte brut**, sans `parse_mode`.

Cet outil n'est fait que pour scanner des cibles dont on est propriétaire, ou avec une autorisation écrite.

## Lancer en local

Prérequis : Node 24, `trivy`, `semgrep`, `nuclei` dans le `PATH`, et Ollama.

```bash
pnpm install
cp .env.example .env    # puis remplir, voir les commentaires
node scripts/hash-password.mjs
pnpm dev
```

## Stack

Nuxt 4 · Nitro · SQLite par `node:sqlite` · nuxt-auth-utils · Nitro scheduled tasks
