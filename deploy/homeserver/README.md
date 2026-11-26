# Passo sul server di casa

Passo gira sull'iMac di casa (`samuserver`) e si raggiunge da qualsiasi dispositivo tramite
Tailscale Funnel:

- app: https://passo.taile433a5.ts.net (Next.js, `passo-web`, 127.0.0.1:3000)
- API: https://passo.taile433a5.ts.net:8443 (FastAPI, `passo-api`, 127.0.0.1:8000)

L'API ha una porta sua perché il frontend costruisce gli URL con `new URL(path, API_BASE_URL)`:
un prefisso `/api` sullo stesso host verrebbe perso.

## Deploy automatico

`passo-autodeploy.timer` controlla GitHub ogni minuto. Quando `development` ha un commit
nuovo, `deploy.sh` lo costruisce in `/opt/passo/releases/<sha>` (venv e `.next` propri),
sposta il link `/opt/passo/current` e riavvia i servizi. Se la build fallisce resta online
la versione precedente, e quel commit non viene ritentato finché non ne arriva uno nuovo.

È un deploy "pull": su GitHub non servono segreti, sul router non servono porte aperte, e
nessun runner esegue codice di PR esterne (il repo è pubblico).

```sh
journalctl -u passo-autodeploy -f          # seguire un deploy
cat /opt/passo/deployed-sha                # commit online
/opt/passo/repo/deploy/homeserver/deploy.sh   # deploy manuale (anche di un commit fallito)
```

Rollback: `ln -sfn /opt/passo/releases/<sha> /opt/passo/current && sudo systemctl restart passo-api passo-web`
(restano le ultime 3 release).

## File

- `/opt/passo/api.env`, `/opt/passo/web.env`: segreti (600), mai in git. Template: `*.env.example`.
  `set-secrets.sh` li compila dal Mac chiedendoli uno alla volta.
- `install.sh`: setup una tantum (unit systemd, regola sudo che consente solo il riavvio dei
  due servizi, primo deploy): `sudo bash /opt/passo/repo/deploy/homeserver/install.sh`.
- `passo-agents-cron.timer`: sveglia gli agenti alle 03:15 UTC (prima era GitHub Actions).
