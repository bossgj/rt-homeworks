# Exemple: laboratorul 6 din rt-labs-esp32c3

Exemplele pentru această temă nu sunt în acest repository, ci în laboratorul 6 din repository-ul cu laboratoare ESP32 (același ca la tema 02):

**<https://github.com/automatica-cluj/rt-labs-esp32c3/tree/main/lab6-task-patterns>**

Sunt șase schițe Arduino mici, fiecare cu **un singur concept** din temă. Rulează doar cu placa conectată la USB și Serial Monitor: fără Wi-Fi, fără MQTT, fără dashboard. Nu sunt bucăți din soluție: au alt subiect (un LED, o barieră de parcare), dar folosesc exact mecanismele de care aveți nevoie în `esp32_semafor.ino`.

Laboratoarele sunt scrise în engleză. Dacă ați clonat repository-ul pentru tema 02, actualizați-l cu `git pull`; altfel, clonați-l **în afara** fork-ului `rt-homeworks`, ca în [secțiunea 1 din tema 02](../../tema-02-esp32-mqtt/exemple/README.md#1-clonarea).

| Schița | Conceptul | Vă ajută la |
|--------|-----------|-------------|
| [`periodic_absolute`](https://github.com/automatica-cluj/rt-labs-esp32c3/blob/main/lab6-task-patterns/periodic_absolute/periodic_absolute.ino) | task periodic; așteptare absolută și relativă; întârzierea $L_k$, jitterul, deriva | TODO 1, TODO 2 |
| [`torn_state`](https://github.com/automatica-cluj/rt-labs-esp32c3/blob/main/lab6-task-patterns/torn_state/torn_state.ino) | stare partajată de două taskuri; ce se întâmplă fără mutex | TODO 0 |
| [`isr_queue`](https://github.com/automatica-cluj/rt-labs-esp32c3/blob/main/lab6-task-patterns/isr_queue/isr_queue.ino) | butonul BOOT, rutina de întrerupere, `xQueueSendFromISR`; bounce | TODO 3 |
| [`sporadic`](https://github.com/automatica-cluj/rt-labs-esp32c3/blob/main/lab6-task-patterns/sporadic/sporadic.ino) | task sporadic cu interval minim între sosiri; două surse în aceeași coadă | TODO 3 |
| [`aperiodic`](https://github.com/automatica-cluj/rt-labs-esp32c3/blob/main/lab6-task-patterns/aperiodic/aperiodic.ino) | task aperiodic care execută comenzi text, cu `OK` / `ERROR` | – (recapitulare din tema 02) |
| [`fsm_periodic`](https://github.com/automatica-cluj/rt-labs-esp32c3/blob/main/lab6-task-patterns/fsm_periodic/fsm_periodic.ino) | automat cu stări într-un task periodic; al doilea task periodic, cu altă perioadă, pentru ieșire; intermitență | TODO 1, TODO 2 |

## Rularea

1. În Arduino IDE, *File > Open* și alegeți fișierul `.ino` al schiței (folderul și fișierul au același nume, cum cere Arduino IDE).
2. Setările plăcii sunt cele din tema 02: **ESP32C3 Dev Module**, **USB CDC On Boot: Enabled** (vezi [`exemple/README.md` din tema 02](../../tema-02-esp32-mqtt/exemple/README.md#2-configurarea-arduino-ide)).
3. *Upload*, apoi *Tools > Serial Monitor* la **115200 baud**, cu terminatorul de linie **New Line** (sau *Both NL & CR*).
4. Tastele se scriu în linia de intrare din Serial Monitor și se trimit cu Enter.

Doar un program poate folosi portul plăcii: închideți Serial Monitor înainte de *Upload* dacă IDE-ul nu reușește să-l elibereze singur.

## Ce urmăriți în fiecare schiță

Explicațiile complete sunt în [README-ul laboratorului](https://github.com/automatica-cluj/rt-labs-esp32c3/blob/main/lab6-task-patterns/README.md). Pe scurt, pentru temă:

### `periodic_absolute`

Un task periodic cu $T = 100$ ms și un timp de calcul variabil (5–30 ms). La fiecare 20 de joburi se afișează $L$ minim, $L$ maxim și jitterul $J$.

- Cu **`a`** (așteptare absolută, `xTaskDelayUntil`), $L$ rămâne aproape de zero, oricât durează joburile.
- Cu **`r`** (așteptare relativă, `vTaskDelay`), fiecare job adaugă la întârziere timpul lui de calcul (17,5 ms în medie): $L$ crește cu aproximativ 350 ms la fiecare raport de 20 de joburi și nu se mai oprește. Aceasta este **deriva**: eliberările nu mai respectă grila $r_k = r_0 + kT$.

### `torn_state`

Un scriitor (prioritate 2) scrie două câmpuri care trebuie să fie egale; un cititor mai prioritar (prioritate 3, $T = 1$ ms) le copiază și le verifică.

- Cu mutexul **oprit** (`m`), multe citiri găsesc o stare inconsistentă: cititorul preemptează scriitorul între cele două scrieri. Într-un program real fereastra este mult mai mică, iar eroarea apare rar, deci și mai greu de găsit.
- Cu mutexul **pornit**, numărul lor este 0.
- Observați cât de puțin se ține mutexul: doar copierea câmpurilor. Verificarea se face pe copia locală.

### `isr_queue`

Apăsați BOOT. Fiecare front descrescător produce o întrerupere, iar ISR-ul pune momentul ei în coadă. Taskul afișează intervalul dintre întreruperi: la o singură apăsare apar adesea mai multe (**bounce**). ISR-ul nu le filtrează: de asta se ocupă taskul din schița următoare.

### `sporadic`

Aceeași coadă primește apăsări de la BOOT (din ISR) și de la tasta `b` (din `loop()`, cu timeout 0, ca `command_received()`). Taskul acceptă o apăsare doar dacă au trecut cel puțin 1000 ms de la ultima acceptată.

- Apăsați BOOT rar, apoi des: apăsările prea dese și întreruperile din bounce sunt respinse.
- Trimiteți `bbbb`: patru apăsări sosite deodată, doar prima este acceptată.
- Momentul sosirii este pus în elementul cozii de cel care trimite, nu citit de task când preia elementul.

### `aperiodic`

Nu este necesară pentru temă: placa din această temă primește o singură comandă, `BUTTON`, tratată de taskul sporadic. Schița recapitulează taskul aperiodic din tema 02.

### `fsm_periodic`

O barieră de parcare: `CLOSED`, `OPENING` (3 s), `OPEN` (5 s), `CLOSING` (3 s). Tasta `m` aduce o mașină.

- Taskul de **control** ($T = 100$ ms) decide starea; durata fiecărei stări se măsoară cu `millis()` de la momentul intrării în ea.
- Taskul de **ieșire** ($T = 500$ ms) copiază starea și stabilește ce se vede: LED-ul, intermitent în `OPENING` și `CLOSING`, și secundele rămase, rotunjite în sus (0 în `CLOSED`, ca în mesajul `lights` din temă).
- Trimiteți `m` cât bariera e ridicată: cererea rămâne înregistrată și bariera se ridică din nou după ce coboară.
