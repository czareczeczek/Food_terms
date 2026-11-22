# Strażnik świeżości

Nowa aplikacja do domowej spiżarni: terminy przydatności, ilości, historia zużycia, wartości odżywcze i opcjonalna synchronizacja przez Dysk Google. Cały interfejs jest po polsku, działa na telefonie i komputerze oraz ma jasny i ciemny motyw. React, TypeScript i Vite; bez płatnego API i własnego serwera.

## Uruchomienie na Windows

1. Zainstaluj [Node.js 24 LTS](https://nodejs.org/).
2. Rozpakuj aktualne źródła albo pobierz gałąź z kodem. Otwórz terminal w folderze zawierającym `package.json`.
3. Wykonaj:

   ```powershell
   npm ci
   npm run dev
   ```

4. Otwórz adres pokazany przez Vite, zwykle `http://localhost:5173`. Pozostaw terminal otwarty; `Ctrl+C` zatrzymuje aplikację.

Jeśli PowerShell blokuje `npm.ps1`, użyj `npm.cmd` zamiast `npm` lub Wiersza polecenia. Telefon w tej samej prywatnej sieci Wi-Fi może użyć adresu sieciowego Vite; zapora Windows może wymagać zgody. Powiadomienia i synchronizacja wymagają bezpiecznego kontekstu HTTPS albo localhost.

## Co działa

- Produkty z nazwą, opcjonalnym terminem i datą otwarcia, oznaczeniem z opakowania, kategorią, miejscem, ilością, jednostką i notatką. Osobne opakowania mogą mieć różne terminy.
- Edycja, kopiowanie kolejnego opakowania, usuwanie z potwierdzeniem, częściowe zużycie, oznaczenie jako zużyty lub wyrzucony, historia i przywracanie.
- Sześć statusów dat z ikoną i tekstem, wyszukiwanie, filtry i sortowanie. Daty `DD.MM.RRRR` liczone według lokalnego dnia kalendarzowego, także przy zmianie czasu.
- Przypomnienia na 1, 3 lub 7 dni przed terminem oraz opcjonalne powiadomienia aktywnej strony.
- Kcal, białko, tłuszcz i węglowodany wpisywane ręcznie lub pobierane po kodzie z Open Food Facts. Podgląd i jawne zastosowanie wyniku, możliwość korekty i link źródłowy.
- Trwały zapis lokalny, eksport i walidowany import JSON z potwierdzeniem zastąpienia.
- Opcjonalny wariant Google Apps Script z synchronizacją produktów, historii i wartości odżywczych na tym samym koncie Google.

Nowe urządzenie zaczyna pustą listą. Przykłady można dodać wyłącznie osobnym przyciskiem i potwierdzić. Nowa implementacja nie kasuje automatycznie istniejących danych przeglądarki ani pliku na Dysku; kompatybilne kopie wersji danych 1 można nadal importować.

Data otwarcia jest notatką użytkownika. Nie wyliczamy bezpieczeństwa po otwarciu. „Najlepiej spożyć przed” dotyczy jakości — sam upływ daty nie dowodzi, że produkt jest niebezpieczny. Po „należy spożyć do” nie spożywaj produktu. Przestrzegaj informacji z etykiety i warunków przechowywania.

## Wartości odżywcze

Wybierz 100 g lub 100 ml. Puste pole oznacza brak danych (`null`), a wpisane zero oznacza rzeczywiste zero. Nie zgadujemy masy sztuki, opakowania ani gęstości. Sumy są liczone wyłącznie dla zgodnych jednostek: g/kg dla 100 g i ml/l dla 100 ml. Przy częściowym zużyciu suma obejmuje pozostałą ilość.

Open Food Facts otrzymuje wyłącznie wybrany kod po naciśnięciu pobierania i widzi adres IP połączenia. Nie wysyłamy listy, dat ani notatek. Brak produktu, internetu lub błąd usługi nie blokuje ręcznego wpisania. Źródło: [Open Food Facts](https://world.openfoodfacts.org/), [ODbL](https://opendatacommons.org/licenses/odbl/1-0/) i [DbCL](https://opendatacommons.org/licenses/dbcl/1-0/). Baza może być niepełna lub błędna — porównaj z etykietą. Ręcznych produktów i korekt nie publikujemy do bazy. Zachowujemy pierwotny kod źródłowy także po korektach.

## Dane i prywatność

Zapis lokalny używa klucza `straznik-swiezosci:v1`. Jest osobny dla adresu, portu, przeglądarki i urządzenia. Bez połączenia Google lista nie synchronizuje się między urządzeniami. Wyczyszczenie danych witryny, tryb prywatny i ograniczenia pamięci mogą usunąć kopię. Przed migracją i regularnie pobieraj JSON; plik nie jest szyfrowany.

Nieczytelny JSON nie jest automatycznie nadpisywany. Można pobrać surowy zapis, zaimportować poprawną kopię albo potwierdzić rozpoczęcie od nowa. Przy całkowitej blokadzie odczytu pamięci aplikacja wyraźnie przechodzi w pamięć karty: przed zamknięciem lub odświeżeniem pobierz JSON albo zaczekaj na potwierdzony zapis Google. W tym trybie po otwarciu trzeba ponownie połączyć Dysk. Późniejszy błąd zapisu nie jest uznawany za sukces; formularz zachowuje wpisane dane. Ochrona przed nieaktualnym zapisem wykrywa zmiany innej karty, ale unikaj jednoczesnej edycji w wielu kartach.

Limit importu: 2 MiB i 10 000 produktów. Ilość 0,000001–1 000 000 000, do 6 miejsc po przecinku; nazwa do 200, notatka do 2000 znaków. Dane odżywcze są nieujemne, do 6 miejsc po przecinku; kcal do 1000, makra do 100 g przy 100 g lub do 1000 g przy 100 ml. Większy limit dla objętości nie zakłada gęstości równej 1.

Google otrzymuje produkty oraz historię dopiero po połączeniu. Motyw, próg przypomnień i preferencje powiadomień pozostają na urządzeniu. Równoległe zmiany wymagają wyboru i osobnego potwierdzenia; nie scalamy list automatycznie. Token Google pozostaje na serwerze. Brak analityki. Szczegóły publikacji: [GOOGLE_DRIVE.md](GOOGLE_DRIVE.md).

## Powiadomienia i offline

Powiadomienia wymagają zgody, wsparcia przeglądarki i systemu oraz otwartej, aktywnej strony. Nie ma push po zamknięciu, service workera ani zadań w tle. System może je wyciszyć; niektóre przeglądarki mobilne i ramka Google mogą ich nie obsługiwać. Przypomnienia na stronie pozostają dostępne.

Otwartą aplikację można edytować bez połączenia; przy działającym zapisie przeglądarki zmiany czekają lokalnie. Nie oznacza to gwarancji uruchomienia strony offline. W trybie pamięci karty niewysłane zmiany znikają po jej zamknięciu.

## Sprawdzenie i budowanie

```powershell
npm test
npx playwright install chromium
npm run test:e2e
npm run build
npm run build:google
```

Playwright uruchamia serwer automatycznie. Na Linux może użyć systemowego Chromium, a na Windows pobranego przez Playwright. Testy usług korzystają z kontrolowanych odpowiedzi — nie są dowodem autoryzacji prawdziwego konta Google, dostępności Open Food Facts ani dostarczenia powiadomienia przez system.

`npm run build` tworzy `dist` do hostingu statycznego. `npm run preview` uruchamia jego podgląd, z osobnym zapisem dla innego portu. `npm run build:google` tworzy komplet plików do Apps Script. Zwykłe Google Drive lub OneDrive nie są hostingiem tej strony; wersja Google uruchamia się przez Apps Script.

## Struktura

- `src/core` — model, import, daty i koordynator synchronizacji;
- `src/services` — odczyt Open Food Facts i most Google;
- `src/hooks` — zapis lokalny i połączenie z Dyskiem;
- `src/components` — formularze, karty, ustawienia i komunikaty;
- `apps-script` — serwer danych i manifest;
- `e2e` — scenariusze użytkownika w przeglądarce.

Kod należy zapisać w Git. Commit lokalny, wysłanie na GitHub, publikacja witryny i zgoda Google są osobnymi operacjami.
