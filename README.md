# Ma semaine EPFL

App de planning hebdo avec modes (Chill, Normal, Charbon, Exam, Récup), calendrier et notifications.

- `site/` : l'app (web app installable sur iPhone via Safari → Partager → Sur l'écran d'accueil)
- `worker/` : petit serveur Cloudflare qui envoie les notifications à l'heure
- `.github/workflows/deploy.yml` : à chaque push sur `main`, déploie le serveur puis l'app sur GitHub Pages

Secret nécessaire : `CLOUDFLARE_API_TOKEN` (modèle « Edit Cloudflare Workers »).
