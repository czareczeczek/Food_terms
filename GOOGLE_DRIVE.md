# Wersja Google: strona i Dysk

Google Apps Script uruchamia aplikację, a prywatny obszar Twojego Dysku zapisuje produkty i historię. Nie potrzebujesz osobnego hostingu, klucza API, klienta OAuth ani sekretów w kodzie. Potrzebne są konto Google i jednorazowa publikacja.

## Przygotowanie

Z aktualnych źródeł wykonaj `npm ci` i `npm run build:google`, albo rozpakuj gotową paczkę Google. Folder `google-drive-deploy` zawiera `Code.gs`, `Index.html`, `appsscript.json` i tę instrukcję jako `INSTRUKCJA.txt`.

1. Na [script.google.com](https://script.google.com/) utwórz własny projekt.
2. Wklej zawartość przygotowanego `Code.gs` do pliku o tej nazwie.
3. Dodaj plik HTML o nazwie **Index** i wklej całą zawartość `Index.html`.
4. W ustawieniach projektu włącz pokazywanie manifestu `appsscript.json`. Zastąp jego zawartość przygotowanym plikiem.
5. Sprawdź usługi projektu: potrzebna jest zaawansowana **Drive API v3**, identyfikator **Drive**. Manifest ją deklaruje. Jeśli jej nie ma, dodaj usługę Drive w edytorze. Przy domyślnym projekcie Cloud dodanie usługi powinno włączyć API; przy własnym standardowym projekcie włącz Google Drive API również w konsoli Cloud.
6. Zapisz wszystkie pliki i utwórz wdrożenie typu **Aplikacja internetowa**.
7. Wybierz wykonywanie jako **użytkownik korzystający z aplikacji** (`USER_ACCESSING`), a dostęp tylko dla siebie (`MYSELF`). Manifest ma takie domyślne ustawienia. Nie publikuj anonimowego dostępu ani wariantu działającego na uprawnieniach właściciela dla innych użytkowników.
8. Opublikuj i otwórz otrzymany adres kończący się **`/exec`**. Wykonaj autoryzację własnego projektu. Nie udzielaj uprawnień nieznanemu projektowi, jeśli nazwa lub właściciel na ekranie zgody się nie zgadzają. Organizacja może blokować takie wdrożenia.

Zakres `drive.appdata` udostępnia wyłącznie dane aplikacji, a `script.external_request` umożliwia serwerowi odczyt jej pliku przez API. Token pozostaje na serwerze. Plik `straznik-swiezosci.json` leży w ukrytym obszarze `appDataFolder` — nie jest zwykłym dokumentem w „Mój dysk”. Do ręcznej kopii służy eksport JSON.

## Telefon i komputer

Na obu urządzeniach otwieraj **ten sam `/exec`** na **tym samym koncie Google**. Nowy adres ma własny zapis przeglądarki; z poprzedniego adresu najpierw wyeksportuj JSON i zaimportuj go tam, gdzie chcesz zachować listę.

W Ustawieniach wybierz **Połącz z Dyskiem Google**. Pusta lista lokalna może zostać uzupełniona z Dysku. Różne listy wymagają wyboru wersji oraz osobnego potwierdzenia zastąpienia. Przed wyborem możesz pobrać kopię lokalną. Jeśli w międzyczasie dane się zmienią, aplikacja poprosi o ponowny wybór.

Po wcześniejszej zgodzie zwykła przeglądarka pamięta połączenie. Zmiany wysyłają się po edycji w otwartej, aktywnej stronie; zapis drugiego urządzenia jest sprawdzany co około 30 sekund, po powrocie lub po wybraniu **Synchronizuj teraz**. Poczekaj na potwierdzenie przed zamknięciem. Otwarte formularze wstrzymują podmianę danych.

Na Dysku są produkty, daty, notatki, historia, kody i odżywianie. Motyw i preferencje powiadomień pozostają lokalne. **Odłącz Dysk** zatrzymuje synchronizację na urządzeniu i nie usuwa zapisu z Dysku. Każde konto ma oddzielne dane.

## Brak połączenia i ograniczenia przeglądarki

Przy działającym zapisie lokalnym niewysłane zmiany czekają na powrót internetu. Nie kasuj danych witryny i regularnie pobieraj JSON. Nie ma service workera ani gwarancji ponownego uruchomienia strony bez internetu.

Jeśli prywatność przeglądarki od początku blokuje odczyt pamięci w ramce Google, aplikacja pokaże ostrzeżenie i użyje pamięci karty. Wtedy połączenie również nie jest zapamiętywane. Przed zamknięciem lub odświeżeniem zaczekaj na zapis Dysku albo wyeksportuj JSON; niewysłane zmiany znikną. Po ponownym otwarciu połącz Dysk jeszcze raz. Nieczytelny zapis JSON jest osobnym przypadkiem — nie zostanie nadpisany bez odzyskania lub potwierdzonego resetu.

Powiadomienia wymagają otwartej, aktywnej aplikacji oraz zgody i wsparcia przeglądarki. Nie działają po zamknięciu i mogą być niedostępne w ramce Google. Apps Script i Drive mają limity zależne od konta i aktualnych zasad Google; nie obiecujemy nielimitowanej usługi.

## Aktualizacja

Wygeneruj pakiet ponownie, zastąp pliki w **tym samym projekcie**, następnie opublikuj nową wersję istniejącego wdrożenia w zarządzaniu wdrożeniami. Zachowaj `USER_ACCESSING` i ograniczony dostęp. Pozostanie ten sam adres `/exec`. Nowy projekt może mieć osobny obszar danych — przed migracją wykonaj eksport.

Testy lokalne symulują Google i nie potwierdzają rzeczywistej publikacji ani zgody konta. Weryfikacja na Twoim koncie następuje po wdrożeniu i autoryzacji. Zapis w Git, `git push`, hosting oraz publikacja w Google to osobne działania.
