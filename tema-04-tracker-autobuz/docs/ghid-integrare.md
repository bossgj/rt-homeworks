# Ghid de integrare pentru studenți

Aplicația **CTP Cluj live** colectează două fluxuri de date în timp real din Cluj-Napoca
și le pune la dispoziție pentru aplicațiile voastre:

- **pozițiile vehiculelor** de transport public (autobuze, troleibuze, tramvaie);
- **locurile libere din parcările publice** cu barieră.

Vă puteți conecta în două moduri: cereți datele prin **HTTP** (API REST) sau le primiți
pe măsură ce apar, prin **RabbitMQ**.

```
                                ┌──────────────────────┐
  CTP Cluj-Napoca (vehicule) ──▶│                      │──▶ API REST   /api/live, /api/lines,
                                │    CTP Cluj live     │               /api/line, /api/parking
  Primăria Cluj (parcări)    ──▶│                      │──▶ RabbitMQ   coadă + 2 exchange-uri fanout
                                └──────────────────────┘
```

## 1. Date de conectare

Le primiți de la profesor. În exemplele de mai jos apar ca variabile.

| Ce | Notație în exemple |
|---|---|
| Adresa aplicației | `URL_APLICATIE` (de exemplu `https://exemplu.ro`) |
| Cheia API | `CHEIE_API` |
| Broker RabbitMQ: gazdă și port | `RABBIT_HOST`, `RABBIT_PORT` |
| Broker RabbitMQ: utilizator și parolă | `RABBIT_USER`, `RABBIT_PASS` |

Nu puneți cheia sau parola în cod urcat pe GitHub; citiți-le din variabile de mediu sau
dintr-un fișier de configurare ignorat de git.

## 2. Ce alegeți: HTTP sau RabbitMQ

| Aveți nevoie de… | Folosiți |
|---|---|
| starea curentă, la cerere (toate vehiculele, toate parcările) | API REST |
| lista de linii, trasee și stații | API REST (doar acolo există) |
| fiecare poziție nouă, imediat ce apare | RabbitMQ, exchange `cluj.vehicles` |
| actualizări periodice ale parcărilor | RabbitMQ, exchange `cluj.parking` |
| împărțirea mesajelor între mai mulți lucrători | RabbitMQ, coada `ctp.cluj.vehicles` |

## 3. API REST

### Autentificare

Fiecare cerere trebuie să conțină cheia API, în headerul `X-API-Key` (recomandat) sau
ca parametru `?key=`. Fără cheie, răspunsul este `401`.

```bash
curl -H "X-API-Key: $CHEIE_API" "$URL_APLICATIE/api/parking"
curl "$URL_APLICATIE/api/line?route_id=1&key=$CHEIE_API"
```

### Endpoint-uri

Toate sunt `GET` și răspund cu JSON (UTF-8).

| Endpoint | Ce întoarce |
|---|---|
| `/api/live` | vehiculele aflate acum în circulație |
| `/api/lines` | toate liniile, cu sensurile lor |
| `/api/line?route_id=N` | traseul și stațiile unei linii, pe fiecare sens |
| `/api/parking` | parcările, cu locuri libere și ocupate |

### `/api/live`: vehiculele

```json
{
  "fetched_at": "2026-11-10T07:41:28.353624+00:00",
  "total": 416, "fresh": 356, "poll_s": 20, "paused": false,
  "live": [
    {"id": 8, "label": "848", "route_id": 84, "trip_id": "84_0",
     "timestamp": "2026-11-10T07:40:59.000Z", "lat": 46.7786816, "lon": 23.6162583,
     "speed": 0, "age": 29, "line": "M45", "route_name": "Str. A. Vlaicu - Pata",
     "color": "#f3513c", "headsign": "M-Primarie Pata Sos", "type": "autobuz"}
  ]
}
```

- `live` conține doar vehiculele considerate „în circulație”: au raportat poziția
  recent, sunt atribuite unei linii și fie sunt într-o cursă, fie se mișcă.
- `total` este mărimea flotei, `fresh` numărul de vehicule cu poziție recentă.
- `poll_s` arată la câte secunde își reîmprospătează serverul datele. **Nu are rost să
  interogați mai des de atât**: veți primi același răspuns.
- `paused` este `true` dacă citirea a fost oprită de administrator (datele pot fi vechi).

Câmpurile unui vehicul sunt descrise în secțiunea 5.

### `/api/lines`: lista de linii

```json
{
  "agency_id": 2,
  "lines": [
    {"route_id": 1, "line": "1", "name": "Str. Bucium - P-ta 1 Mai", "type": "troleibuz",
     "directions": [
       {"trip_id": "1_0", "direction_id": 0, "headsign": "P-ța 1 Mai"},
       {"trip_id": "1_1", "direction_id": 1, "headsign": "Disp. Bucium"}
     ]}
  ]
}
```

- `route_id` este identificatorul intern al liniei; îl folosiți la `/api/line` și îl
  regăsiți în fiecare vehicul.
- `line` este numărul afișat pe vehicul (`24B`, `M26`). **Nu este unic**: există două
  linii numite `12`. Pentru legături între date folosiți `route_id`.
- `type` este `autobuz`, `troleibuz` sau `tramvai`.
- `trip_id` identifică un sens al liniei și apare și în vehicule.

### `/api/line?route_id=N`: traseu și stații

```json
{
  "route_id": 1, "line": "1",
  "directions": [
    {"trip_id": "1_0", "direction_id": 0, "headsign": "P-ța 1 Mai",
     "shape": [[46.75174, 23.54385], [46.75181, 23.54553]],
     "stops": [
       {"id": 46, "name": "Disp. Bucium", "lat": 46.7517, "lon": 23.54342},
       {"id": 2, "name": "Primăverii", "lat": 46.75181, "lon": 23.54553}
     ]}
  ]
}
```

- `shape` este traseul, ca listă de puncte `[latitudine, longitudine]`, în ordine.
- `stops` sunt stațiile sensului respectiv, **în ordinea parcurgerii**.
- Stațiile de pe cele două sensuri sunt în general diferite (au `id` și coordonate
  proprii). Stațiile de capăt pot fi comune: apar cu același `id` pe ambele sensuri.
- **Nu există orare** și nici estimări de sosire: sursa nu le oferă.

### `/api/parking`: parcările

```json
{
  "fetched_at": "2026-11-10T05:58:30.012753+00:00", "enabled": true, "poll_s": 60,
  "parkings": [
    {"denumire": "Parking Motilor", "lat": 46.767933, "lon": 23.584979,
     "capacitate": 382, "locuri_libere": 126, "locuri_ocupate": 256,
     "detalii": {"in5min": 6, "out5min": 3, "in10min": 9, "out10min": 4,
                 "in15min": 15, "out15min": 6, "actualizare": "2026-11-10 07:57:32"}}
  ]
}
```

Câmpurile unei parcări sunt descrise în secțiunea 5. Datele se schimbă o dată pe minut.

### Coduri de răspuns

| Cod | Semnificație | Ce faceți |
|---|---|---|
| `200` | răspuns corect | |
| `400` | parametru greșit (de exemplu `route_id` nu e număr) | corectați cererea |
| `401` | cheie API lipsă sau greșită | verificați headerul `X-API-Key` |
| `404` | linie sau adresă necunoscută | luați `route_id` din `/api/lines` |
| `502` | sursa de date (CTP sau primăria) nu a răspuns corect | reîncercați mai târziu |
| `503` | serverul nu are încă date (abia a pornit) | reîncercați în câteva secunde |

La erori, corpul răspunsului este `{"error": "mesaj"}`.

### Exemplu Java (HTTP)

```java
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;

public class ParkingClient {
    public static void main(String[] args) throws Exception {
        String base = System.getenv("URL_APLICATIE");
        String key = System.getenv("CHEIE_API");

        HttpClient client = HttpClient.newHttpClient();
        HttpRequest request = HttpRequest.newBuilder(URI.create(base + "/api/parking"))
                .header("X-API-Key", key)
                .GET()
                .build();
        HttpResponse<String> response = client.send(request, HttpResponse.BodyHandlers.ofString());

        if (response.statusCode() != 200) {
            System.err.println("Eroare " + response.statusCode() + ": " + response.body());
            return;
        }
        System.out.println(response.body());   // JSON; se parsează cu Jackson, Gson sau org.json
    }
}
```

## 4. RabbitMQ

Aplicația **doar publică** mesaje; voi le consumați. Fiecare mesaj este un obiect JSON
(UTF-8) care descrie **un singur** vehicul sau **o singură** parcare.

| Destinație | Tip | Conținut | Când se publică |
|---|---|---|---|
| `cluj.vehicles` | exchange fanout | poziții de vehicule | la fiecare citire, doar pozițiile noi |
| `cluj.parking` | exchange fanout | starea parcărilor | o dată pe minut, toate parcările |
| `ctp.cluj.vehicles` | coadă | aceleași mesaje ca `cluj.vehicles` | la fel |

### Coadă sau exchange fanout?

- **Exchange fanout** (`cluj.vehicles`, `cluj.parking`): fiecare client își creează
  propria coadă și o leagă de exchange. **Toți clienții primesc toate mesajele.**
  Aceasta este varianta potrivită pentru lucrul la laborator.
- **Coada** `ctp.cluj.vehicles` este **comună**: un mesaj ajunge la **un singur**
  consumator. Dacă doi colegi citesc din ea în același timp, își împart mesajele și
  niciunul nu vede toată flota. Folosiți-o doar când vreți exact acest comportament
  (mai mulți lucrători care împart sarcina).

### Dependență Maven

```xml
<dependency>
    <groupId>com.rabbitmq</groupId>
    <artifactId>amqp-client</artifactId>
    <version>5.21.0</version>   <!-- sau versiunea folosită la laborator -->
</dependency>
```

### Consumator pentru un exchange fanout

```java
import com.rabbitmq.client.Channel;
import com.rabbitmq.client.Connection;
import com.rabbitmq.client.ConnectionFactory;
import java.nio.charset.StandardCharsets;

public class VehicleListener {
    public static void main(String[] args) throws Exception {
        ConnectionFactory factory = new ConnectionFactory();
        factory.setHost(System.getenv("RABBIT_HOST"));
        factory.setPort(Integer.parseInt(System.getenv("RABBIT_PORT")));
        factory.setUsername(System.getenv("RABBIT_USER"));
        factory.setPassword(System.getenv("RABBIT_PASS"));

        Connection connection = factory.newConnection();
        Channel channel = connection.createChannel();

        String exchange = "cluj.vehicles";              // sau "cluj.parking"
        channel.exchangeDeclare(exchange, "fanout");    // trebuie declarat exact așa
        String queue = channel.queueDeclare().getQueue();   // coadă temporară, doar a voastră
        channel.queueBind(queue, exchange, "");

        channel.basicConsume(queue, true, (tag, message) -> {
            String json = new String(message.getBody(), StandardCharsets.UTF_8);
            System.out.println(json);
        }, tag -> { });
        // programul rămâne pornit și primește mesajele pe măsură ce sunt publicate
    }
}
```

### Consumator pentru coada comună

```java
channel.queueDeclare("ctp.cluj.vehicles", false, false, false, null);   // exact acești parametri
channel.basicConsume("ctp.cluj.vehicles", true, (tag, message) -> {
    System.out.println(new String(message.getBody(), StandardCharsets.UTF_8));
}, tag -> { });
```

### Ce trebuie să știți despre mesaje

- **Primiți doar ce se publică după ce v-ați conectat.** Un exchange fanout nu păstrează
  istoric. La parcări, starea completă sosește în cel mult un minut. La vehicule, fiecare
  vehicul apare la următoarea lui poziție nouă, deci imaginea întregii flote se adună în
  aproximativ un minut.
- **Un vehicul apare de mai multe ori**, câte un mesaj pentru fiecare poziție nouă.
  Perechea `id` + `timestamp` identifică unic o poziție. Dacă vreți „ultima poziție a
  fiecărui vehicul”, țineți un `Map` cu cheia `id`.
- **Vehiculele retrase nu sunt anunțate.** Un vehicul care iese din circulație pur și
  simplu nu mai trimite mesaje; considerați-l inactiv dacă nu ați primit nimic de la el
  de câteva minute.
- **Mesajele expiră**: cele de vehicule după 60 de secunde, cele de parcări după două
  minute, dacă nu le consumați. Un consumator lent pierde mesaje vechi, nu le primește
  cu întârziere.
- **Declarațiile trebuie să se potrivească.** Exchange-urile și coada sunt nedurabile.
  Dacă le declarați cu alți parametri (de exemplu `durable = true`), brokerul închide
  canalul cu eroarea `PRECONDITION_FAILED`.
- Mesajele din RabbitMQ au, față de API, câmpul suplimentar `fetched_at` (momentul în
  care serverul a citit datele de la sursă).

## 5. Câmpurile datelor

### Vehicul

| Câmp | Tip | Descriere |
|---|---|---|
| `id` | număr | identificator intern al vehiculului, stabil |
| `label` | text | numărul de parc, scris pe vehicul |
| `route_id` | număr | linia pe care circulă (vezi `/api/lines`); **rar, poate lipsi din `/api/lines`** |
| `trip_id` | text sau `null` | sensul de mers; **poate lipsi** chiar la vehicule în mișcare |
| `line` | text | numărul liniei, cum e afișat (`24B`, `M26`); `"?"` dacă `route_id` nu e în `/api/lines` |
| `route_name` | text | numele traseului; gol dacă `route_id` nu e în `/api/lines` |
| `headsign` | text | destinația; gol dacă `trip_id` lipsește |
| `type` | text | `autobuz`, `troleibuz` sau `tramvai` |
| `lat`, `lon` | număr | poziția GPS (WGS84) |
| `speed` | număr | viteza raportată de vehicul; unitatea nu e documentată de sursă (cel mai probabil km/h) |
| `timestamp` | text | momentul la care vehiculul a raportat poziția, **în UTC** (ISO 8601) |
| `age` | număr | vechimea poziției, în secunde, în momentul citirii de către server |
| `color` | text | culoarea liniei din sursă; nu deosebește liniile între ele |
| `fetched_at` | text | doar în RabbitMQ: momentul citirii, în UTC |

### Parcare

| Câmp | Tip | Descriere |
|---|---|---|
| `denumire` | text | numele parcării |
| `lat`, `lon` | număr | poziția GPS (WGS84) |
| `capacitate` | număr | numărul total de locuri |
| `locuri_libere` | număr sau `null` | locuri libere; **`null` când parcarea nu raportează date** |
| `locuri_ocupate` | număr sau `null` | calculat: `capacitate - locuri_libere` |
| `detalii.in5min`, `in10min`, `in15min` | număr sau `null` | intrări în ultimele 5, 10, 15 minute |
| `detalii.out5min`, `out10min`, `out15min` | număr sau `null` | ieșiri în ultimele 5, 10, 15 minute |
| `detalii.actualizare` | text | ultima actualizare la sursă, **în ora României** (`AAAA-LL-ZZ hh:mm:ss`) |
| `zone` | obiect, opțional | doar la unele parcări: `capacitate` și `locuri_libere` pe zone (de exemplu „Electric”, „Taxi”) |
| `fetched_at` | text | doar în RabbitMQ: momentul citirii, în UTC |

## 6. Recomandări

- **Tratați valorile lipsă.** `trip_id`, `locuri_libere` și contoarele din `detalii` pot
  fi `null`; unele parcări nu raportează deloc. Un program care presupune că sunt mereu
  numere se va opri cu o excepție. La fel, nu presupuneți că `route_id` al unui vehicul
  există mereu în `/api/lines`: sursa trimite uneori vehicule pe rute necunoscute.
- **Atenție la fusul orar.** `timestamp` și `fetched_at` sunt în UTC; `actualizare` este
  în ora României. Convertiți înainte să le comparați.
- **Nu interogați API-ul în buclă strânsă.** Respectați `poll_s` din răspuns (vehicule)
  și un minut pentru parcări. Datele statice (`/api/lines`, `/api/line`) se schimbă rar:
  citiți-le o dată și păstrați-le în memorie.
- **Datele reale au imperfecțiuni.** Un vehicul poate sta pe loc la capăt de linie, poate
  raporta poziții vechi de un minut sau poate apărea fără sens de mers. Numărătoarea de la
  bariere se poate decala față de realitate. Proiectați aplicația astfel încât să suporte
  asemenea situații.
- **Închideți conexiunile.** La oprirea programului, închideți canalul și conexiunea
  RabbitMQ; cozile temporare se șterg automat.

## 7. Probleme frecvente

| Simptom | Cauză probabilă |
|---|---|
| `401` la orice cerere | cheia lipsește, e greșită sau headerul e scris altfel decât `X-API-Key` |
| `404` la `/api/line` | `route_id` nu există; folosiți valorile din `/api/lines`, nu numărul liniei |
| `502` sau `503` | sursa de date e indisponibilă sau serverul abia a pornit; reîncercați |
| Nu sosește niciun mesaj din exchange | ați legat coada după publicare (așteptați următorul ciclu) sau numele exchange-ului e greșit |
| Sosesc doar o parte din vehicule | citiți din coada comună `ctp.cluj.vehicles` în același timp cu alt coleg; treceți pe `cluj.vehicles` |
| `PRECONDITION_FAILED` la declarare | parametrii nu se potrivesc: exchange `fanout` nedurabil, coadă `false, false, false, null` |
| `ACCESS_REFUSED` la conectare | utilizator sau parolă greșite pentru broker |
| Caractere stricate (`È™`, `Äƒ`) | mesajul nu a fost decodat ca UTF-8 |
