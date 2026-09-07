# Tego dnia

Wpisujesz dzień i miesiąc — dostajesz jedną, wybraną i napisaną przez model językowy historię z tego dnia, sprzed lat, wraz z ilustracją.

## Jak to działa

- `index.html` — statyczna strona (bez budowania), hostowana na GitHub Pages. Pyta backend o gotową historię dla wybranej daty i ją wyświetla.
- `worker/` — mały backend (Cloudflare Worker), który dla danej daty: pobiera artykuł-kalendarz z polskiej Wikipedii, prosi Claude o wybranie najciekawszego wątku i napisanie krótkiej opowieści, szuka ilustracji na Wikimedia Commons, i zapamiętuje wynik (żeby nie generować tego samego dnia dwa razy). Zobacz `worker/README.md` po instrukcję wdrożenia.

Backend trzeba wdrożyć osobno i wkleić jego adres do `index.html` (`WORKER_BASE_URL`), zanim strona zacznie działać na żywo.

## Uruchomienie lokalnie

Otwórz `index.html` w przeglądarce (po wdrożeniu backendu i uzupełnieniu `WORKER_BASE_URL`).

## GitHub Pages

Ustawienia repozytorium → Pages → Source: branch `gh-pages`, folder `/ (root)`.
