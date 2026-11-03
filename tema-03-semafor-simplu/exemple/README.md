# Exemple: conceptele temei, pe rând

Șase schițe Arduino mici, fiecare cu **un singur concept** din temă. Rulează doar cu placa conectată la USB și Serial Monitor: fără Wi-Fi, fără MQTT, fără dashboard. Nu sunt bucăți din soluție: au alt subiect (un LED, o barieră de parcare), dar folosesc exact mecanismele de care aveți nevoie în `esp32_semafor.ino`.

| Exemplul | Conceptul | Vă ajută la |
|----------|-----------|-------------|
| [`01_asteptare_absoluta`](01_asteptare_absoluta/01_asteptare_absoluta.ino) | task periodic; așteptare absolută și relativă; întârzierea $L_k$, jitterul, deriva | TODO 1, TODO 2 |
| [`02_mutex_stare_partajata`](02_mutex_stare_partajata/02_mutex_stare_partajata.ino) | stare partajată de două taskuri; ce se întâmplă fără mutex | TODO 0 |
| [`03_isr_coada`](03_isr_coada/03_isr_coada.ino) | butonul BOOT, rutina de întrerupere, `xQueueSendFromISR`; bounce | TODO 3 |
| [`04_sporadic_interval_minim`](04_sporadic_interval_minim/04_sporadic_interval_minim.ino) | task sporadic cu interval minim între sosiri; două surse în aceeași coadă | TODO 3 |
| [`05_aperiodic_comenzi`](05_aperiodic_comenzi/05_aperiodic_comenzi.ino) | task aperiodic care execută comenzi text, cu `OK` / `ERROR` | – (recapitulare din tema 02) |
| [`06_automat_doua_periodice`](06_automat_doua_periodice/06_automat_doua_periodice.ino) | automat cu stări într-un task periodic; al doilea task periodic, cu altă perioadă, pentru ieșire; intermitență | TODO 1, TODO 2 |

## Rularea

1. În Arduino IDE, *File > Open* și alegeți fișierul `.ino` al exemplului (folderul și fișierul au același nume, cum cere Arduino IDE).
2. Setările plăcii sunt cele din tema 02: **ESP32C3 Dev Module**, **USB CDC On Boot: Enabled** (vezi [`exemple/README.md` din tema 02](../../tema-02-esp32-mqtt/exemple/README.md#2-configurarea-arduino-ide)).
3. *Upload*, apoi *Tools > Serial Monitor* la **115200 baud**, cu terminatorul de linie **New Line** (sau *Both NL & CR*).
4. Tastele se scriu în linia de intrare din Serial Monitor și se trimit cu Enter.

Doar un program poate folosi portul plăcii: închideți Serial Monitor înainte de *Upload* dacă IDE-ul nu reușește să-l elibereze singur.

## Ce urmăriți în fiecare exemplu

### 01 – așteptare absolută

Un task periodic cu $T = 100$ ms și un timp de calcul variabil (5–30 ms). La fiecare 20 de joburi afișează $L$ minim, $L$ maxim și jitterul $J$.

- Cu **`a`** (așteptare absolută, `xTaskDelayUntil`), $L$ rămâne sub 1 ms, oricât durează joburile.
- Cu **`r`** (așteptare relativă, `vTaskDelay`), fiecare job adaugă la întârziere timpul lui de calcul (17,5 ms în medie): $L$ crește cu 300–350 ms la fiecare raport de 20 de joburi și nu se mai oprește. Aceasta este **deriva**: eliberările nu mai respectă grila $r_k = r_0 + kT$. Jitterul calculat pe 20 de joburi ajunge și el la sute de ms, dar nu pentru că $L$ ar oscila: $L$ doar crește.

Exemplu de ieșire:

```
--- așteptare absolută (xTaskDelayUntil), T = 100 ms ---
joburile   20-  39: L min    0.000 ms, L max    0.000 ms, jitter J   0.000 ms
--- așteptare relativă (vTaskDelay), T = 100 ms ---
joburile    0-  19: L min    0.033 ms, L max  302.000 ms, jitter J 301.967 ms
joburile   20-  39: L min  331.000 ms, L max  622.000 ms, jitter J 291.000 ms
```

### 02 – mutex

Un scriitor (prioritate 2) scrie două câmpuri care trebuie să fie egale; un cititor mai prioritar (prioritate 3, $T = 1$ ms) le copiază și le verifică.

- Cu mutexul **oprit** (`m`), aproximativ jumătate din citiri găsesc o stare inconsistentă: cititorul preemptează scriitorul între cele două scrieri. Scriitorul petrece aproape tot timpul între ele, de aceea sunt atât de multe. Într-un program real fereastra este mult mai mică, iar eroarea apare rar, deci și mai greu de găsit.
- Cu mutexul **pornit**, numărul lor este 0. Cititorul se blochează în `xSemaphoreTake` cât timp scriitorul ține mutexul.
- Observați cât de puțin se ține mutexul: doar copierea câmpurilor. Verificarea se face pe copia locală.

### 03 – ISR și coadă

Apăsați BOOT. Fiecare front descrescător produce o întrerupere, iar ISR-ul pune momentul ei în coadă. Taskul afișează intervalul dintre întreruperi: la o singură apăsare apar adesea mai multe, la câteva milisecunde distanță sau chiar în aceeași milisecundă (**bounce**). ISR-ul nu le filtrează: de asta se ocupă exemplul 04.

### 04 – task sporadic

Aceeași coadă primește apăsări de la BOOT (din ISR) și de la tasta `b` (din `loop()`, cu timeout 0, ca `command_received()`). Taskul acceptă o apăsare doar dacă au trecut cel puțin 1000 ms de la ultima acceptată.

- Apăsați BOOT rar, apoi des: apăsările prea dese și întreruperile din bounce sunt respinse.
- Trimiteți `bbbb`: patru apăsări sosite deodată, doar prima este acceptată.
- Momentul sosirii este pus în elementul cozii de cel care trimite, nu citit de task când preia elementul.

### 05 – task aperiodic

Nu este necesar pentru temă: placa din această temă primește o singură comandă, `BUTTON`, tratată de taskul sporadic. Exemplul recapitulează taskul aperiodic din tema 02.

Comenzile `LED ON`, `LED OFF`, `BLINK <ms>`, `STATUS` ajung în coadă ca text (elementul cozii conține tabloul `char`, nu un pointer). Taskul aperiodic le execută, modifică starea LED-ului prin `led_set()`, care ține mutexul doar cât scrie câmpurile, și răspunde cu `OK ...` sau `ERROR ...`. Încercați comenzi greșite (`BLINK`, `BLINK 20`, `BLINK abc`, `xyz`): taskul răspunde cu `ERROR` și continuă. Comenzile se scriu exact, cu majuscule: `led on` este o comandă necunoscută.

### 06 – automat cu stări și două taskuri periodice

O barieră de parcare: `CLOSED`, `OPENING` (3 s), `OPEN` (5 s), `CLOSING` (3 s). Tasta `m` aduce o mașină.

- Taskul de **control** ($T = 100$ ms) decide starea; durata fiecărei stări se măsoară cu `millis()` de la momentul intrării în ea.
- Taskul de **ieșire** ($T = 500$ ms) copiază starea și stabilește ce se vede: LED-ul, intermitent în `OPENING` și `CLOSING` (aprins la un job, stins la următorul), și secundele rămase, rotunjite în sus (0 în `CLOSED`, ca în mesajul `lights` din temă).
- Trimiteți `m` cât bariera e ridicată: cererea rămâne înregistrată și bariera se ridică din nou după ce coboară.
